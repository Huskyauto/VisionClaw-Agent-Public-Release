import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { pilotSchemas, type PilotKind } from "../../shared/business-pilots";
import { RELEASE_AREAS } from "../../shared/business-pilots/release";
import { GOVERNANCE_CONTROLS } from "../../shared/business-pilots/governance";
import { appendPilotRun, PilotError } from "./business-pilot-state";
import type { withPilotStore } from "./business-pilot-store";
import { requirePilotInvocation } from "./business-pilot-invocation";
import type { ToolContext, ToolResult } from "../tools/types";
import type { safeFetchText } from "../audit-engine";
import { collectAgentJourney } from "./agent-journey";

const kindSchema = z.enum(["health", "release", "governance", "cost", "readiness"]);
const requestSchema = z.object({
  action: z.enum(["describe", "run", "list", "get"]),
  kind: kindSchema,
  input: z.unknown().optional(),
  requestId: z.string().uuid().optional(),
  baselineId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
}).strict();
const readinessInput = z.object({
  url: z.string().url().max(2000).refine(value => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === "/";
  }, "Use a public homepage URL without credentials, query, fragment or action path"),
}).strict();
const instructions = "Owner-requested advisory analysis only. Describe first; supply source-backed inputs, never invent evidence or numbers. Unknown health values are null, never zero. Reuse the same requestId for unchanged save retries. Reports do not approve releases, certify compliance, reconcile billing or change model routing. Use the owner UI to delete records.";

type Dependencies = { store?: typeof withPilotStore; fetchText?: typeof safeFetchText };
export async function executeBusinessPilot(
  raw: Record<string, unknown>, ctx: ToolContext, deps: Dependencies = {},
): Promise<ToolResult> {
  try {
    requirePilotInvocation(raw, ctx);
    // trustedConversationScope adds its public alias after model args at ingress.
    // It is routing metadata, not part of any pilot input contract.
    const publicArgs = Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith("_") && key !== "conversationId"));
    if (Buffer.byteLength(JSON.stringify(publicArgs)) > 64_000) return { error: "Pilot input exceeds 64KB" };
    const request = requestSchema.parse(publicArgs);
    const { action, kind } = request;
    if (action === "describe") return {
      ok: true, kind, instructions,
      actions: kind === "readiness" ? ["describe", "run"] : ["describe", "run", "list", "get"],
      inputSchema: zodToJsonSchema(kind === "readiness" ? readinessInput : pilotSchemas[kind], { $refStrategy: "none" }),
      ...(kind === "release" ? { requiredAreas: RELEASE_AREAS } : {}),
      ...(kind === "governance" ? { requiredControls: GOVERNANCE_CONTROLS } : {}),
      persistence: kind === "readiness" ? "Returned only; use existing website audit for saved audit history" : "Private owner history shared with Business Pilot Tools; maximum 50 runs per kind",
    };
    if (kind === "readiness") {
      if (action !== "run") return { error: "Readiness supports describe/run only; saved audits remain in the existing website audit UI" };
      const input = readinessInput.parse(request.input);
      const fetchText = deps.fetchText ?? (await import("../audit-engine")).safeFetchText;
      const home = await fetchText(input.url, { timeoutMs: 6000, maxBytes: 100_000, maxRedirects: 0 });
      if (!home.ok) return { error: `Homepage could not be inspected: ${home.reason}`, retryable: false };
      if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(home.contentType))
        return { error: "Homepage did not return HTML; no readiness conclusion was drawn" };
      return { ok: true, saved: false, result: await collectAgentJourney({ url: home.finalUrl, html: home.text, truncated: home.truncated }, fetchText),
        instructions: "Read-only website evidence, not an assistant benchmark or completed booking. Missing evidence is not proof of absence." };
    }
    if (action === "run" && (!request.requestId || request.input === undefined))
      return { error: "run requires requestId (stable UUID) and input; use describe first" };
    if (action === "get" && !request.runId) return { error: "get requires runId" };
    const store = deps.store ?? (await import("./business-pilot-store")).withPilotStore;
    return await store<ToolResult>(ctx.tenantId!, kind as PilotKind, runs => {
      if (action === "list") return { value: { ok: true, kind, runs: runs.map(run => ({
        id: run.id, createdAt: run.createdAt, title: run.result.title,
        verdict: run.result.verdict, baselineId: run.baselineId,
      })) } };
      if (action === "get") {
        const run = runs.find(run => run.id === request.runId);
        if (!run) throw new PilotError("Run not found", 404);
        return { value: { ok: true, run } };
      }
      const saved = appendPilotRun(runs, kind, {
        requestId: request.requestId, input: request.input,
        ...(request.baselineId ? { baselineId: request.baselineId } : {}),
      });
      return { runs: saved.runs, value: { ok: true, run: saved.run } };
    });
  } catch (error) {
    return { error: error instanceof z.ZodError
      ? error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 2000)
      : error instanceof PilotError ? error.message
      : "Pilot authorization or operation failed; no successful result is claimed" };
  }
}
