import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { cheaperInferenceReady, CHEAPER_INFERENCE_BASE_URL } from "./cheaper-inference";
import { currentTenantId } from "./tenant-context";

export function cheaperMinimumDiscount(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CHEAPER_INFERENCE_MIN_DISCOUNT_PERCENT ?? "40";
  if (!/^(?:0|[1-9]\d?|100)$/.test(raw))
    throw new Error("CheaperInference minimum discount must be an integer from 0 to 100");
  return Number(raw);
}

export function cheaperAutomaticAllowed(tenantId: number | undefined, env = process.env): boolean {
  return tenantId === 1 && (currentTenantId() === null || currentTenantId() === 1) &&
    env.CHEAPER_INFERENCE_AUTOMATIC_ENABLED === "1" &&
    cheaperInferenceReady(env);
}

export interface CheaperCatalogEntry {
  id: string;
  type: "text" | "image" | "video";
  endpoint: string;
  vision: boolean;
  context: number;
  input: number;
  output: number;
  maximumInput: number;
  maximumOutput: number;
  imagePrice?: number;
  discount: number;
}

function rate(value: unknown, optional = false): number {
  if (optional && value == null) return 0;
  if ((typeof value !== "string" && typeof value !== "number") ||
      String(value).trim() === "" || !Number.isFinite(Number(value)) ||
      Number(value) < 0 || Number(value) > 1_000) {
    throw new Error("CheaperInference catalog contains invalid pricing");
  }
  return Number(value);
}

/** Typed projection only: never import provider descriptions, URLs or instructions. */
export function parseCheaperCatalog(body: any): CheaperCatalogEntry[] {
  if (!Array.isArray(body?.data) || body.data.length < 1 || body.data.length > 300) {
    throw new Error("CheaperInference catalog shape is invalid");
  }
  const ids = new Set<string>();
  return body.data.flatMap((m: any): CheaperCatalogEntry[] => {
    if (typeof m?.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(m.id) ||
        ids.has(m.id) || !["text", "image", "video", "decision"].includes(m.type) ||
        !(m.type === "text" ? ["/v1/chat/completions", "/v1/responses"] :
          m.type === "image" ? ["/v1/images/generations"] :
          m.type === "decision" ? ["/v1/decisions"] : ["/v1/videos/generations"]).includes(m.endpoint)) {
      throw new Error("CheaperInference catalog identity or endpoint is invalid");
    }
    ids.add(m.id);
    // Recognized discovery-only modality, not a chat/media dispatch capability.
    // Validate its identity and exact endpoint, but never admit it for inference.
    if (m.type === "decision") return [];
    const context = m.type !== "text" ? 0 : Number(m.context_length);
    if (m.type === "text" && (!Number.isSafeInteger(context) || context < 1 || context > 10_000_000)) {
      throw new Error("CheaperInference context bound is invalid");
    }
    const p = m.pricing;
    const input = rate(p?.input_per_million);
    const output = rate(p?.output_per_million);
    // Include long-context, cache-write and all service-tier rates conservatively.
    // Reserve full maker rates, regardless of the operator's discount floor.
    let maximumInput = Math.max(input, rate(p?.list_input_per_million, true));
    let maximumOutput = Math.max(output, rate(p?.list_output_per_million, true));
    const scan = (node: any, depth: number): void => {
      if (!node || typeof node !== "object" || depth > 12) return;
      for (const [key, value] of Object.entries(node)) {
        if (["input_per_million", "cache_write_input_per_million", "list_input_per_million"].includes(key)) {
          maximumInput = Math.max(maximumInput, rate(value, true));
        } else if (["output_per_million", "list_output_per_million"].includes(key)) {
          maximumOutput = Math.max(maximumOutput, rate(value, true));
        } else if (["input_tokens", "cache_write_tokens"].includes(key)) {
          maximumInput = Math.max(maximumInput, rate(value, true) * 1_000_000);
        } else if (key === "output_tokens") {
          maximumOutput = Math.max(maximumOutput, rate(value, true) * 1_000_000);
        } else if (typeof value === "object") scan(value, depth + 1);
      }
    };
    scan(p, 0);
    return [{ id: m.id, type: m.type, endpoint: m.endpoint, context, vision: m.capabilities?.vision === true,
      input, output, maximumInput, maximumOutput,
      imagePrice: p?.media_unit === "image" && p.media_unit_price != null ? rate(p.media_unit_price) : undefined,
      discount: rate(p?.discount_percent, true) }];
  });
}

let catalog: { entries: CheaperCatalogEntry[]; expires: number } | undefined;
let inFlight: Promise<CheaperCatalogEntry[]> | undefined;
export async function getCheaperCatalog(): Promise<CheaperCatalogEntry[]> {
  if (!cheaperInferenceReady()) throw new Error("CheaperInference is disabled");
  if (catalog && catalog.expires > Date.now()) return catalog.entries;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const client = new OpenAI({ apiKey: process.env.CHEAPER_INFERENCE_API_KEY!.trim(),
      baseURL: CHEAPER_INFERENCE_BASE_URL, timeout: 10_000, maxRetries: 0 });
    const entries = parseCheaperCatalog(await client.models.list());
    catalog = { entries, expires: Date.now() + 15 * 60_000 };
    return entries;
  })();
  try { return await inFlight; } finally { inFlight = undefined; }
}

export function catalogUsageCost(usage: any, entry: CheaperCatalogEntry): number | undefined {
  if (typeof usage?.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0) return usage.cost;
  const input = usage?.prompt_tokens;
  const output = usage?.completion_tokens;
  if (![input, output].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)) return undefined;
  // Upper-bound estimate for admission settlement; never treat missing usage as zero.
  return (input * entry.maximumInput + output * entry.maximumOutput) / 1_000_000;
}

export function cheaperRequestMaximum(payload: any, entry: CheaperCatalogEntry): number {
  const messages = payload.messages;
  if (!Array.isArray(messages) || messages.length > 256) throw new Error("CheaperInference requires bounded messages");
  const vision = messages.some((m: any) => Array.isArray(m?.content) &&
    m.content.some((part: any) => part?.type === "image_url"));
  if (vision && !entry.vision) throw new Error("This CheaperInference model does not support vision");
  if (messages.some((m: any) => Array.isArray(m?.content) &&
    m.content.some((part: any) => !["text", "image_url"].includes(part?.type)))) {
    throw new Error("CheaperInference chat accepts text and declared vision inputs only");
  }
  // Remote image tokenization is unknown: reserve the entire declared context.
  // For text, UTF-8 bytes plus a generous serialization/framing allowance bound input.
  const inputBound = vision ? entry.context : Math.min(entry.context,
    Buffer.byteLength(JSON.stringify(payload), "utf8") * 4 + messages.length * 64 + 4096);
  const cost = (inputBound * entry.maximumInput +
    payload.max_completion_tokens * entry.maximumOutput) / 1_000_000;
  if (!Number.isFinite(cost) || cost < 0 || cost > 20) throw new Error("CheaperInference request exceeds the $20 shared budget bound");
  return Math.max(0.01, cost);
}

interface BudgetDeps {
  reserve: (args: { tenantId: number; attemptKey: string; maximumCostCents: number }) =>
    Promise<{ id: number; attemptKey: string }>;
  settle: (args: { tenantId: number; reservationId: number; attemptKey: string; actualCostCents: number }) => Promise<unknown>;
}

/** Independent admission authority, not a ledger row; uncertain attempts stay held. */
export async function runCheaperBudgeted(
  tenantId: number, maximumUsd: number, invoke: () => Promise<any>,
  usageCost: (usage: any) => number | undefined, injected?: BudgetDeps,
): Promise<any> {
  if (tenantId !== 1 || (currentTenantId() !== null && currentTenantId() !== 1) ||
      !Number.isFinite(maximumUsd) || maximumUsd <= 0 || maximumUsd > 20) {
    throw new Error("CheaperInference paid admission requires owner scope and a proven request bound");
  }
  const module = injected ? undefined : await import("../agentic/aggregate-ai-spend-budget");
  const deps = injected ?? { reserve: module!.reserveAggregateAiSpend, settle: module!.settleAggregateAiSpend };
  const held = await deps.reserve({ tenantId, attemptKey: `cheaperinference:${randomUUID()}`,
    maximumCostCents: Math.ceil(maximumUsd * 100) });
  const finish = async (usage: any) => {
    const cost = usageCost(usage);
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
      console.warn("[cheaper-budget] No usable receipt; retaining the reservation");
      return;
    }
    // No retry and no release on failure; a persisted hold still protects the cap.
    try {
      await deps.settle({ tenantId, reservationId: held.id, attemptKey: held.attemptKey,
        actualCostCents: Math.ceil(cost * 100) });
    } catch (error) {
      console.error("[cheaper-budget] Settlement failed; reservation remains held", error);
    }
  };
  const result = await invoke();
  if (!result?.[Symbol.asyncIterator]) { await finish(result?.usage); return result; }
  let started = false;
  return new Proxy(result, {
    get(target, property) {
      if (property === Symbol.asyncIterator) return async function* () {
        if (started) throw new Error("CheaperInference stream cannot be consumed twice");
        started = true;
        let usage: any;
        for await (const chunk of target) { if (chunk.usage) usage = chunk.usage; yield chunk; }
        // This line is intentionally not in finally: disconnects must not settle.
        await finish(usage);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
