import { createHash, randomUUID } from "node:crypto";
import { runIncomeDiscovery, type IncomeCandidate } from "./income-discovery";
import { collectJuryEvidence, type JuryEvidencePass, type JuryEvidenceReceipt } from "./jury-evidence";
import { scoutIncomePublicEvidence } from "./income-discovery-scout";
import type { JuryDecision } from "./jury-triage";
import { selectIncomeClaudeRoute } from "./income-claude-route";

/** Host-owned adapter; no model-selected tool names or write operations. */
export async function incomeDiscoveryRuntime(input: {
  request: string; tenantId: number; conversationId: number;
  persona: { name: string; role: string };
}): Promise<JuryDecision> {
  if (process.env.INCOME_DISCOVERY_ENABLED === "0") throw new Error("Income-discovery jury disabled by owner");
  const { ADMIN_TENANT_ID } = await import("../auth");
  if (input.tenantId !== ADMIN_TENANT_ID || !Number.isSafeInteger(input.conversationId) || input.conversationId <= 0) {
    throw new Error("Trusted owner conversation required for income discovery");
  }
  const { executeGuardedTool } = await import("../guarded-tool-executor");
  const allowed = ["check_system_status", "sessions_history", "web_search", "introspect_tools"];
  const execute = (name: string, args: Record<string, unknown>) => {
    if (process.env.INCOME_DISCOVERY_ENABLED === "0") throw new Error("Income-discovery jury disabled by owner");
    return executeGuardedTool(name, args, {
    signal: AbortSignal.timeout(5000),
    onDispatch: () => {
      if (process.env.INCOME_DISCOVERY_ENABLED === "0") throw new Error("Income discovery stopped before dispatch");
    },
    tenantId: input.tenantId, conversationId: input.conversationId,
    personaName: input.persona.name, personaRole: input.persona.role,
    invokedVia: "chat_engine", allowedToolNames: allowed,
    });
  };
  let catalog: string | undefined;
  try {
    // Do NOT use listIncomeOpportunities: it also bootstraps writes. Only
    // read the tenant's rows and the immutable bootstrap catalog here.
    const { db } = await import("../db");
    const { incomeOpportunities } = await import("../../shared/schema");
    const { eq } = await import("drizzle-orm");
    const { INCOME_OPPORTUNITIES } = await import("../../client/src/data/income-opportunities");
    const rows = await db.select().from(incomeOpportunities).where(eq(incomeOpportunities.tenantId, input.tenantId)).limit(101);
    const offers = new Map([...INCOME_OPPORTUNITIES, ...rows].map(c => [c.slug, {
      name: c.name, buyer: c.buyer, problem: c.problem, offer: c.entryOffer,
    }]));
    const serialized = JSON.stringify({ source: "tenant catalog plus canonical bootstrap offers", offers: [...offers.values()] });
    if (rows.length <= 100 && serialized.length <= 14_000) catalog = serialized;
  } catch { console.warn("[income-jury] Catalog read unavailable; novelty coverage incomplete"); }
  const research = async (seat: number, candidates: IncomeCandidate[]): Promise<JuryEvidencePass> => {
    const pass = await collectJuryEvidence({ seatId: `income-seat-${seat + 1}`, tenantId: input.tenantId,
      conversationId: input.conversationId, execute, timeoutMs: 12_000 });
    // Bound source excerpts without concealing whether they were clipped.
    pass.receipts = pass.receipts.map(r => ({ ...r, excerpt: boundExcerpt(r.excerpt) }));
    const calls: [string, Record<string, unknown>][] = [
      ["introspect_tools", { action: "search", query: "income report document delivery billing" }],
      ...candidates.map(c => ["web_search", { free_only: true,
        query: `${c.buyer} ${c.problem} ${c.offer} competitor pricing demand`.slice(0, 240) }] as [string, Record<string, unknown>]),
    ];
    for (let i = 0; i < calls.length; i++) {
      const [tool, args] = calls[i];
      const startedAt = new Date().toISOString();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let output: unknown;
      try {
        output = await Promise.race([execute(tool, args), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Read-only research deadline exceeded")), 12_000);
        })]);
      } catch { output = { error: "Research failed or exceeded deadline; result unknown" }; }
      finally { if (timer) clearTimeout(timer); }
      const serialized = JSON.stringify(output ?? { error: "No result" });
      const bad = !output || typeof output !== "object" ||
        "error" in output || ("blocked" in output && output.blocked === true) ||
        ("success" in output && output.success === false);
      const receipt: JuryEvidenceReceipt = {
        ...(tool === "web_search" ? { candidateId: candidates[i - 1]?.id } : {}),
        ...(tool === "web_search" && output && typeof output === "object" && "results" in output &&
          Array.isArray(output.results) ? { sources: output.results.slice(0, 4).flatMap((r: unknown) => {
            if (!r || typeof r !== "object" || !("url" in r) || !("text" in r) ||
              typeof r.url !== "string" || typeof r.text !== "string" || !/^https?:\/\//.test(r.url)) return [];
            return [{ url: r.url.slice(0, 600), text: r.text.slice(0, 650) }];
          }) } : {}),
        id: `${pass.runId}/${tool}-${i + 1}`, runId: pass.runId, tool, ok: !bad, startedAt,
        completedAt: new Date().toISOString(),
        sha256: `sha256-base64url:${createHash("sha256").update(serialized).digest("base64url")}`,
        excerpt: boundExcerpt(JSON.stringify({ query: args.query, instruction_authority: "none", quarantined: true, result: output })),
      };
      pass.receipts.push(receipt);
    }
    return pass;
  };
  const { executeIncomeDiscoverySeats, persistIncomeDiscovery } = await import("../moa");
  const started = Date.now();
  const runId = randomUUID();
  const claudeRoute = selectIncomeClaudeRoute(input.request);
  const result = await runIncomeDiscovery({ request: input.request, catalog, research, claudeRoute,
    scout: seat => scoutIncomePublicEvidence(seat, input.request, execute),
    infer: (_phase, prompt, evidence) => {
      if (process.env.INCOME_DISCOVERY_ENABLED === "0") throw new Error("Income-discovery jury disabled by owner");
      const explicitNative = /\b(?:use|select|choose)\s+(?:direct\s+)?(?:gpt[- ]5\.4|(?:claude[- ]?)?(?:sonnet|opus)[- ]5[.-]5)\b/i.test(input.request);
      return executeIncomeDiscoverySeats(prompt, input.tenantId, evidence, claudeRoute,
        explicitNative ? { preferSubscription: false } : undefined);
    } });
  let loggedAs: number | undefined;
  try {
    loggedAs = await persistIncomeDiscovery(input.tenantId, result);
    if (!loggedAs) throw new Error("Durable report receipt missing");
  }
  catch {
    result.unknowns.push("Durable full-report persistence failed; chat output is not a durable receipt");
    result.requirements.durableReport = false;
    result.status = "INCOMPLETE";
    result.requirementCoverage = Object.values(result.requirements).filter(Boolean).length / Object.keys(result.requirements).length;
    const { renderIncomeReport } = await import("./income-discovery-report");
    result.report = renderIncomeReport(result);
    console.warn("[income-jury] Full-report persistence failed");
  }
  console.log(`[income-jury] ${runId} status=${result.status} concepts=${result.candidates.length} assessments=${result.assessments.length} coverage=${result.requirementCoverage}`);
  const verdict = result.status === "COMPLETE" ? result.consensus.verdict : "ESCALATE";
  return { incomeDiscovery: result, verdict, majority: result.consensus.majority, concordance: null,
    shouldEscalate: verdict === "ESCALATE", aggregatorAnswer: result.report,
    totalLatencyMs: Date.now() - started, loggedAs,
    votes: result.phases.assessment.map((p, seat) => ({ model: p.modelId, provider: p.provider,
      reportedModel: p.reportedModel, requestedModel: p.requestedModel, evidence: p.evidence,
      verdict: result.consensus.votes[seat]?.verdict ?? "ESCALATE",
      rationale: result.consensus.votes[seat]?.rationale ?? "Overall judgment unavailable", ok: p.ok })),
    investigation: { version: 1, mode: "income-discovery", evidenceActor: "server-owned-juror-evidence-runner",
      requirements: result.requirements, requirementCoverage: result.requirementCoverage,
      needsHumanReview: verdict === "ESCALATE" ? 1 : 0.6,
      disagreements: [], citations: result.assessments.flatMap(a => a.citations), unknowns: result.unknowns,
      aggregateIdentity: { actualModel: "NOT_APPLICABLE", requestedModel: "deterministic-income-renderer",
        providerLane: "server", evidence: "deterministic rendering; no aggregate model call" } } };
}

function boundExcerpt(value: string): string {
  return value.length <= 1800 ? value : `${value.slice(0, 1800)}\n[TRUNCATED; remainder not inspected]`;
}
