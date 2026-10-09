/**
 * Manual workspace-only evaluation. No arguments = dry-run. Only --run spends.
 * Fixed suite ID is once-only: a crash cannot silently repeat paid requests.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { db } from "../server/db";
import { agentCostLedger } from "../shared/schema";
import { ADMIN_TENANT_ID } from "../server/auth";
import { getClientForModel } from "../server/providers";
import { claimAutonomousBudget } from "../server/agentic/autonomous-budget";
import { recordCost } from "../server/agentic/cost-ledger";
import { haikuTrialRunRequested } from "../server/lib/haiku-effort";
import {
  HAIKU_TRIAL_MODEL, HAIKU_TRIAL_VERSION, HAIKU_TRIAL_FIXTURES,
  HAIKU_TRIAL_MAX_INPUT, HAIKU_TRIAL_MAX_OUTPUT, HAIKU_TRIAL_CALL_BOUND_USD,
  runHaikuEffortTrial, type TrialObservation,
} from "../server/lib/haiku-effort-trial";

async function main(): Promise<void> {
  const run = haikuTrialRunRequested(process.argv.slice(2), {
    nodeEnv: process.env.NODE_ENV, deployment: process.env.REPLIT_DEPLOYMENT,
  });
  // Includes exact fixture bytes, evaluator code and policy code, not just labels.
  const { readFile } = await import("node:fs/promises");
  const digest = createHash("sha256")
    .update(await readFile("server/lib/haiku-effort-trial.ts"))
    .update(await readFile("server/lib/haiku-effort.ts"))
    .update(HAIKU_TRIAL_VERSION).digest("hex").slice(0, 24);
  const trialId = `haiku-effort:${digest}`;
  if (!run) {
    console.log(JSON.stringify({ mode: "dry-run", trialId, fixtures: HAIKU_TRIAL_FIXTURES.map(f => f.id),
      plannedInferenceCalls: 14, reserveUsd: 0.05, productionEnabled: false }));
    return;
  }

  // Reuse authorized owner direct-key resolution; never borrow customer keys.
  // Native credential remains process-local and is never exported or logged.
  const resolved = await getClientForModel(HAIKU_TRIAL_MODEL, ADMIN_TENANT_ID, { meteredOverride: true });
  if (resolved.actualModelId !== HAIKU_TRIAL_MODEL ||
      resolved.client.baseURL.replace(/\/$/, "") !== "https://api.anthropic.com/v1" ||
      !resolved.client.apiKey.startsWith("sk-ant-")) throw new Error("NATIVE_OWNER_ROUTE_UNAVAILABLE");
  const native = new Anthropic({ apiKey: resolved.client.apiKey, baseURL: "https://api.anthropic.com",
    timeout: 20_000, maxRetries: 0 });
  const observed: TrialObservation[] = [];
  const report = await runHaikuEffortTrial({
    reserve: async usd => {
      const claim = await claimAutonomousBudget({ tenantId: ADMIN_TENANT_ID,
        estimatedUsd: usd, label: trialId, ttlMinutes: 60 });
      // Reject degraded claims even if some unrelated global fail-open is enabled.
      return claim.ok && !claim.degraded && claim.claimedUsd >= usd;
    },
    begin: async () => {
      const rows = await db.insert(agentCostLedger).values({
        tenantId: ADMIN_TENANT_ID, toolName: "evaluation.haiku-effort",
        model: HAIKU_TRIAL_MODEL, costUsd: "0", operation: "trial_started",
        idempotencyKey: `${trialId}:started`,
      }).onConflictDoNothing().returning({ id: agentCostLedger.id });
      return rows.length === 1;
    },
    call: async (request, streamed) => {
      // One wall clock covers token counting, stream establishment and reading.
      const signal = AbortSignal.timeout(20_000);
      // Token-count the exact synthetic payload before each paid request. No
      // provider inference proceeds outside the reserved short-context envelope.
      const count = await native.messages.countTokens({
        model: HAIKU_TRIAL_MODEL,
        messages: request.messages as Anthropic.MessageParam[],
        ...(request.tools ? { tools: request.tools as Anthropic.Tool[] } : {}),
      }, { signal, maxRetries: 0 });
      if (!Number.isSafeInteger(count.input_tokens) || count.input_tokens < 0 ||
          count.input_tokens > HAIKU_TRIAL_MAX_INPUT) throw new Error("FIXTURE_INPUT_ENVELOPE_EXCEEDED");
      if (typeof request.max_tokens !== "number" || request.max_tokens > HAIKU_TRIAL_MAX_OUTPUT) {
        throw new Error("FIXTURE_OUTPUT_ENVELOPE_EXCEEDED");
      }
      const params = request as unknown as Anthropic.MessageCreateParamsNonStreaming;
      const response = streamed
        ? await native.messages.stream(params, { signal, maxRetries: 0 }).finalMessage()
        : await native.messages.create(params, { signal, maxRetries: 0 });
      console.log(JSON.stringify({ event: "haiku_effort_trial_response", trialId,
        effort: (request.output_config as { effort: string }).effort, streamed: !!streamed,
        model: response.model, stopReason: response.stop_reason, outputTokens: response.usage.output_tokens }));
      return response;
    },
    record: async row => {
      observed.push(row);
      const recorded = await recordCost({
        tenantId: ADMIN_TENANT_ID, model: HAIKU_TRIAL_MODEL, toolName: "llm.haiku-effort-trial",
        // Unknown paid completion is conservatively accounted, never silently $0.
        costUsd: row.costUsd ?? HAIKU_TRIAL_CALL_BOUND_USD,
        tokensIn: row.tokensIn ?? 0, tokensOut: row.tokensOut ?? 0,
        cachedTokensIn: row.costUsd === null ? 0 : row.cachedRead,
        cacheWriteTokens: row.costUsd === null ? 0 : row.cachedWrite,
        operation: JSON.stringify({ trialId, fixture: row.fixture, effort: row.effort,
          streamed: row.streamed, correct: row.correct, complete: row.complete,
          accounting: row.costUsd === null ? "uncertain_reserved_bound" : "observed_usage" }),
        idempotencyKey: `${trialId}:${row.fixture}:${row.effort}:${row.streamed ? "stream" : "ordinary"}`,
      });
      if (!recorded) throw new Error("TRIAL_LEDGER_FAILURE");
      console.log(JSON.stringify({ event: "haiku_effort_trial_result", ...row }));
    },
  });
  const exportPath = `docs/research/haiku-effort-trial-${digest}.json`;
  await mkdir("docs/research", { recursive: true });
  await writeFile(`${exportPath}.tmp`, JSON.stringify({ trialId, ...report,
    observedCostUsd: observed.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
    unknownCostCalls: observed.filter(row => row.costUsd === null).length }, null, 2));
  await rename(`${exportPath}.tmp`, exportPath);
  console.log(JSON.stringify({ event: "haiku_effort_trial_complete", trialId, status: report.status,
    parameterValidated: report.parameterValidated, observations: report.observations.length,
    comparisons: report.comparisons, exportPath, productionEnabled: false }));
  if (report.status !== "completed") process.exitCode = 1;
}

main().catch((error: unknown) => {
  // Do not dump provider exception objects: they can carry request/credential data.
  const message = (error as { message?: string })?.message ?? "";
  const code = /^[A-Z][A-Z0-9_]{1,64}$/.test(message) ? message : "UNEXPECTED_TRIAL_FAILURE";
  console.error(`Haiku effort trial stopped (${code}); no automatic retry. Inspect tenant-scoped trial ledger records.`);
  process.exitCode = 1;
});
