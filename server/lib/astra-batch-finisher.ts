import { ADMIN_TENANT_ID } from "../auth";
import { getAstraOutputTokenLimit } from "./astra-finisher";
import { parseAstraReportDraft } from "../research-report-fulfillment";

export interface AstraBatchInput {
  tenantId: number;
  orderId: string;
  preparedDraft: string;
  expectedHeadings: string[];
  baselineSections: { heading: string; body: string }[];
  evidence: string;
  task: string;
}

export interface AstraBatchRecord {
  phase: "claimed" | "submitted" | "completed";
  submissionKey: string;
  inputFileId?: string;
  providerBatchId?: string;
  outputFileId?: string;
  finalText?: string;
  usedAstra?: boolean;
  providerStatus?: string;
  tokensIn?: number;
  tokensOut?: number;
  cachedTokensIn?: number;
}

export type AstraBatchAdvance =
  | { kind: "pending"; record: AstraBatchRecord }
  | { kind: "completed"; record: AstraBatchRecord; text: string; usedAstra: boolean };

interface AstraBatchDeps {
  enabled?: boolean;
  uploadFile?: (jsonl: string, options: Record<string, any>) => Promise<any>;
  createBatch?: (params: Record<string, any>, options: Record<string, any>) => Promise<any>;
  retrieveBatch?: (batchId: string) => Promise<any>;
  findBatchByKey?: (submissionKey: string) => Promise<any | null>;
  readFileContent?: (fileId: string) => Promise<string>;
}

const TERMINAL_FAILURES = new Set(["failed", "expired", "cancelled"]);

function extractResponseText(body: any): string {
  const direct = String(body?.output_text || "").trim();
  if (direct) return direct;
  return (Array.isArray(body?.output) ? body.output : [])
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((item: any) => item?.type === "output_text")
    .map((item: any) => String(item?.text || ""))
    .join("")
    .trim();
}

function parseBatchOutput(jsonl: string): { text: string; usage: any } {
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.custom_id !== "astra-report") continue;
    if (Number(row?.response?.status_code) !== 200) return { text: "", usage: null };
    return { text: extractResponseText(row?.response?.body), usage: row?.response?.body?.usage };
  }
  return { text: "", usage: null };
}

function buildRequest(input: AstraBatchInput): Record<string, any> {
  const outputLimit = getAstraOutputTokenLimit(input.preparedDraft);
  if (outputLimit === null) throw new Error("Prepared draft cannot safely fit the Astra 25K output ceiling");
  return {
    custom_id: "astra-report",
    method: "POST",
    url: "/v1/responses",
    body: {
      model: "gpt-6-astra",
      instructions:
        "You are the final reasoning and quality layer. Preserve every exact section marker in order, " +
        "correct unsupported claims, and return only the complete final deliverable. Do not invent evidence.",
      input: `TASK\n${input.task.slice(0, 8_000)}\n\nVERIFIED EVIDENCE\n${input.evidence.slice(0, 48_000)}\n\nPREPARED DRAFT\n${input.preparedDraft.slice(0, 72_000)}`,
      reasoning: { effort: "high" },
    max_output_tokens: outputLimit,
      prompt_cache_key: "visionclaw-research-report-astra-batch-v1",
      prompt_cache_retention: "24h",
    },
  };
}

async function defaultDeps(tenantId: number): Promise<Required<Omit<AstraBatchDeps, "enabled">>> {
  const { getClientForModel } = await import("../providers");
  const { client } = await getClientForModel("gpt-6-astra", tenantId, {
    explicitOwnerSelection: true,
    platformAdminVerified: true,
    meteredOverride: true,
  });
  const { toFile } = await import("openai");
  return {
    uploadFile: async (jsonl, options) => client.files.create({
      file: await toFile(Buffer.from(jsonl), "astra-report-batch.jsonl", { type: "application/jsonl" }),
      purpose: "batch",
    } as any, { ...options, maxRetries: 0 }),
    createBatch: async (params, options) => client.batches.create(params as any, { ...options, maxRetries: 0 }),
    retrieveBatch: async (batchId) => client.batches.retrieve(batchId),
    findBatchByKey: async (submissionKey) => {
      for await (const batch of client.batches.list({ limit: 100 })) {
        if (batch.metadata?.submission_key === submissionKey) return batch;
      }
      return null;
    },
    readFileContent: async (fileId) => (await client.files.content(fileId)).text(),
  };
}

export async function advanceAstraBatch(
  input: AstraBatchInput,
  record: AstraBatchRecord,
  deps: AstraBatchDeps = {},
): Promise<AstraBatchAdvance> {
  const enabled = deps.enabled ?? process.env.ASTRA_BATCH_ENABLED === "1";
  if (!enabled || input.tenantId !== ADMIN_TENANT_ID || !input.preparedDraft.trim()) {
    const completed = { ...record, phase: "completed" as const, finalText: input.preparedDraft, usedAstra: false };
    return { kind: "completed", record: completed, text: input.preparedDraft, usedAstra: false };
  }
  if (record.phase === "completed") {
    return {
      kind: "completed",
      record,
      text: record.finalText ?? input.preparedDraft,
      usedAstra: record.usedAstra === true,
    };
  }

  const runtime = { ...(await (deps.uploadFile && deps.createBatch && deps.retrieveBatch && deps.readFileContent
    ? Promise.resolve(deps as Required<Omit<AstraBatchDeps, "enabled">>)
    : defaultDeps(input.tenantId))) };

  if (!record.providerBatchId) {
    const reconciled = await runtime.findBatchByKey?.(record.submissionKey);
    if (reconciled?.id) {
      return {
        kind: "pending",
        record: {
          ...record,
          phase: "submitted",
          inputFileId: reconciled.input_file_id || record.inputFileId,
          providerBatchId: reconciled.id,
          providerStatus: reconciled.status,
        },
      };
    }
    const jsonl = `${JSON.stringify(buildRequest(input))}\n`;
    const file = record.inputFileId
      ? { id: record.inputFileId }
      : await runtime.uploadFile(jsonl, { idempotencyKey: `${record.submissionKey}-file` });
    const batch = await runtime.createBatch({
      input_file_id: file.id,
      endpoint: "/v1/responses",
      completion_window: "24h",
      metadata: {
        order_id: input.orderId.slice(0, 512),
        submission_key: record.submissionKey.slice(0, 512),
      },
    }, { idempotencyKey: `${record.submissionKey}-batch` });
    return {
      kind: "pending",
      record: {
        ...record,
        phase: "submitted",
        inputFileId: file.id,
        providerBatchId: batch.id,
        providerStatus: batch.status,
      },
    };
  }

  const batch = await runtime.retrieveBatch(record.providerBatchId);
  if (batch.status !== "completed") {
    if (!TERMINAL_FAILURES.has(String(batch.status))) {
      return { kind: "pending", record: { ...record, providerStatus: String(batch.status) } };
    }
    const completed = {
      ...record,
      phase: "completed" as const,
      providerStatus: String(batch.status),
      finalText: input.preparedDraft,
      usedAstra: false,
    };
    return { kind: "completed", record: completed, text: input.preparedDraft, usedAstra: false };
  }

  const outputFileId = String(batch.output_file_id || "");
  const output = outputFileId ? await runtime.readFileContent(outputFileId) : "";
  const parsedOutput = parseBatchOutput(output);
  const candidate = parsedOutput.text;
  const tokensIn = Number(parsedOutput.usage?.input_tokens);
  const tokensOut = Number(parsedOutput.usage?.output_tokens);
  if (
    !Number.isSafeInteger(tokensIn) || tokensIn <= 0 ||
    !Number.isSafeInteger(tokensOut) || tokensOut <= 0
  ) {
    throw new Error("GPT-6 Astra Batch completed without valid nonzero usage accounting");
  }
  const parsed = candidate
    ? parseAstraReportDraft(candidate, input.expectedHeadings, input.baselineSections)
    : null;
  const finalText = parsed ? candidate : input.preparedDraft;
  const completed = {
    ...record,
    phase: "completed" as const,
    providerStatus: "completed",
    outputFileId: outputFileId || undefined,
    finalText,
    usedAstra: Boolean(parsed),
    tokensIn: Number.isSafeInteger(tokensIn) ? tokensIn : 0,
    tokensOut: Number.isSafeInteger(tokensOut) ? tokensOut : 0,
    cachedTokensIn: Number(parsedOutput.usage?.input_tokens_details?.cached_tokens || 0),
  };
  return { kind: "completed", record: completed, text: finalText, usedAstra: Boolean(parsed) };
}