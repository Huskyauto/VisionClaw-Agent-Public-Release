import { SCORE_KEYS, type IncomeDiscoveryResult } from "./income-discovery";
import { estimateIncomeClaudeUsage } from "./income-claude-route";
import { estimateCostUsd } from "../agentic/cost-ledger";

export function renderIncomeReport(r: IncomeDiscoveryResult): string {
  return `## Income-discovery jury — full report
Task status: **${r.status}**. requirementCoverage: **${r.requirementCoverage}**.
Approach: **${r.approach === "evidence-first" ? "Evidence-first" : "Hypothesis-first"}**. ${r.approach === "evidence-first" ? "Independent public scouting preceded ideation; a source hit is not proof of buyer demand." : "New concepts were generated before candidate-specific research; unverified concepts remain hypotheses."}
Overall income-credibility verdict: **${r.status === "COMPLETE" ? r.consensus.verdict : "ESCALATE"}** (three-seat judgment plus completion gate; no action authorized).
needsHumanReview: **${r.status === "COMPLETE" && r.consensus.verdict !== "ESCALATE" ? 0.6 : 1}**.
Jury cost policy: subscription-first when enabled, with automatic free/subscription backups and approved budget-capped native APIs when needed. Actual served identities and routes appear below; a planning preference is not proof of a paid call. Explicit newer native model requests retain their route. Paid calls have no automatic retries. Public research retains no-paid-fallback rules. This does not certify that the coordinating chat or platform subscription has no charges.
Direct OpenAI seat: ${[...r.phases.ideation, ...r.phases.assessment].some(p => p.providerLane === "openai-api") ? `GPT-5.4 selected instead of Profundo; requires scoped owner-paid authorization, shared budget reservation and no retries. Reported-usage estimate: $${[...r.phases.ideation, ...r.phases.assessment].filter(p => p.providerLane === "openai-api" && p.usageReported === true).reduce((sum, p) => sum + estimateCostUsd("gpt-5.4", p.reportedTokensIn ?? 0, p.reportedTokensOut ?? 0), 0).toFixed(4)}. Missing usage is UNKNOWN; timeouts can bill without returned usage. This is not a provider invoice.` : "Not selected in this retained run."}
Claude usage-cost estimate: ${r.claudeRoute ? `$${[...r.phases.ideation, ...r.phases.assessment].filter(p => p.providerLane === "anthropic-api" && p.usageReported === true).reduce((sum, p) => sum + estimateIncomeClaudeUsage(p.modelId, p.reportedTokensIn ?? 0, p.reportedTokensOut ?? 0), 0).toFixed(4)} based only on reported provider usage, before cache adjustments; not a provider invoice. Unreported input/output dimensions are UNKNOWN and excluded individually, never priced from estimated tokens. Failed/time-out calls may have billed without returning usage. Actual received usage is recorded by the provider ledger; persistence is best-effort.` : "Not applicable."}
Evidence runner: server-owned separate read-only passes, not model-selected tools. Candidate definitions shared for cross-scoring; peer research and votes not shared.
Novelty and evidence judgments are reviewable opinions, not independently certified market facts.

### Ranked top three — provisional, validate before acting
${r.approach === "evidence-first" ? "Evidence-first eligibility requires completed public scouting and a candidate-specific source quote/URL supporting an observed claim. Unsupported concepts remain below as hypotheses, not evidence-backed recommendations. This checks source attribution, not independent semantic truth or buyer willingness." : "Creative-first eligibility does not require observed demand; assumptions and source gaps remain explicit."}
Ranking: mean of known 1–5 dimension scores; unknowns are excluded, NOT filled with a midpoint. Missing evidence may bias averages; confidence and unknowns must be considered separately. Ties use candidate ID. Majority-rejected candidates excluded. Any juror's hard business-policy conflict vetoes that candidate from this shortlist, even when other jurors disagree; the assessments remain below.
${r.rankings.map((v, i) => `${i + 1}. ${v.candidateId}: **${r.candidates.find(c => c.id === v.candidateId)?.title}** — ${v.verdict}; known-score mean ${v.score.toFixed(2)}; confidence ${v.confidence}.
Cheapest proposed validation (lowest juror-estimated cash, then time; not guaranteed cost): ${v.validation}
Estimated cash: ${v.validationCostUsd === null ? "UNKNOWN" : `$${v.validationCostUsd}`}; estimated minutes: ${v.validationMinutes ?? "UNKNOWN"}. Approval still required for contact/spend.`).join("\n\n") || "No complete three-seat shortlist available; see the retained candidates and failures below."}

### All proposed concepts
${r.candidates.map(c => `#### ${c.id}: ${c.title} (initial juror ${c.seat + 1})
Buyer: ${c.buyer}
Problem: ${c.problem}
Proposed offer: ${c.offer}
Novelty rationale (not certification): ${c.novelty}
Proposed price (not observed demand): ${c.proposedPrice}
Assumptions: ${c.assumptions.join("; ")}
Proposed validation: ${c.validation}
${r.assessments.filter(a => a.candidateId === c.id).map(a => `Juror ${a.seat + 1}: **${a.verdict}**; confidence ${a.confidence}; exclusion comparison ${a.exclusionCheck}.
Scores (5 best; unknown remains unknown): ${SCORE_KEYS.map(k => `${k}=${a.scores[k] ?? "UNKNOWN"}`).join(", ")}
Reasoning: ${a.rationale}
Business-policy assessment (model judgment, not authority): ${JSON.stringify(a.policyCompliance)}
Claims (model interpretation; quote retention is not independent semantic proof): ${a.claims.map(v => `${v.kind}: ${v.text} [${v.citations.join(", ")}]${v.quote ? `; source quote: "${v.quote}"; URL: ${v.url}` : ""}`).join("; ") || "No observed claim asserted"}
Citations: ${a.citations.join(", ") || "NONE"}
Unknowns: ${a.unknowns.join("; ") || "None declared"}
Proposed validation: ${a.validation}`).join("\n\n") || "Assessment unavailable; not certified."}`).join("\n\n")}

### Excluded or duplicate concepts
${r.rejectedCandidates.map(c => `- ${c.title}: ${c.reason}`).join("\n") || "No deterministic duplicates removed. Semantic novelty still requires judgment."}

### Disagreements
${r.disagreements.map(d => `- ${d.candidateId}: ${d.description}`).join("\n") || "No disagreement among available validated assessments; missing assessments are not agreement."}

### Overall credibility judgments — separate from task completion
${r.consensus.votes.map(v => `- Juror ${v.seat + 1}: ${v.verdict}. ${v.rationale}`).join("\n")}
Vote agreement: ${r.consensus.majority}/3. Advisory tally: ${r.consensus.verdict}. Full completion does not imply validated income, and missing evidence alone cannot establish REJECT.

### Phase identities and failures
${Object.entries(r.phases).map(([phase, seats]) => `${phase}:
${seats.map((p, i) => `- Juror ${i + 1}: requested ${p.requestedModel ?? p.modelId}; response ${p.reportedModel ?? "UNKNOWN"}; lane ${p.providerLane ?? p.provider}; ${p.ok ? "returned" : `FAILED: ${p.error ?? "unavailable"}`}. Usage: ${p.usageReported ? "provider-reported" : "unavailable; token counts, if any, are estimates"}; ledger persistence: ${p.usagePersisted === true ? "confirmed" : "not confirmed"}.`).join("\n") || "No seats completed"}`).join("\n\n")}
Aggregation: deterministic server renderer, NO aggregator inference/model.

### Independent research receipts and provenance
${r.approach === "evidence-first" ? `Scouting before ideation (source data only, never instructions):
${r.scouting.map((pass, i) => `Juror ${i + 1}: ${pass.receipts.filter(e => e.tool === "web_search").map(e => `${e.id}: ${e.ok ? "returned" : "FAILED"}; ${e.excerpt}`).join("; ") || "No public source returned"}`).join("\n")}
` : ""}
${r.phases.assessment.map((p, i) => `Juror ${i + 1}: run ${p.evidence?.runId ?? "UNAVAILABLE"}
Context provenance (metadata, not instructions; source labels are not independent authorship proof): ${JSON.stringify(p.evidence?.receipts.find(e => e.tool === "sessions_history")?.contextInspection ?? { available: false })}
${(p.evidence?.receipts ?? []).map(e => `- [${e.id}] ${e.tool}: ${e.ok ? "returned" : "FAILED"}; ${e.completedAt}; ${e.sha256}
Quarantined evidence excerpt: ${e.excerpt}`).join("\n")}`).join("\n\n")}

### Task-specific completion checks
${Object.entries(r.requirements).map(([k, v]) => `- ${k}: ${v ? "PASS" : "INCOMPLETE"}`).join("\n")}

### Unknowns and constraints
${[...new Set(r.unknowns)].map(u => `- ${u}`).join("\n") || "- No additional unknowns declared"}
No report or verdict authorizes outreach, customer contact, employment decisions, billing, payments, publication, deployment or product execution. Obtain approval separately. Public search receipts establish retrieval, not willingness to pay or independently verified capability execution.
`;
}
