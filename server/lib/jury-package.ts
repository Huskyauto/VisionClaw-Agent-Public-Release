import type { JuryDecision } from "./jury-triage";
import { requiresIncomeDiscovery } from "./income-discovery";

export function isInvestigatedJuryDecision(value: unknown): value is JuryDecision {
  return !!value && typeof value === "object" && "investigation" in value &&
    !!value.investigation && typeof value.investigation === "object" &&
    "version" in value.investigation && value.investigation.version === 1 &&
    "votes" in value && Array.isArray(value.votes) &&
    "verdict" in value && typeof value.verdict === "string" &&
    "aggregatorAnswer" in value && typeof value.aggregatorAnswer === "string";
}

export function requiresIndependentJury(text: string): boolean {
  if (requiresIncomeDiscovery(text)) return true;
  const request = text.trim().replace(/^\[Felix line\]\s*/i, "");
  if (/^(?:how|why|explain|describe|do not|don't|never)\b/i.test(request)) return false;
  return /\b(?:run|rerun|assemble)\b[\s\S]{0,160}\b(?:jury[-_ ]triage|independent jurors)\b/i.test(request) &&
    /\b(?:independent|own evidence)\b/i.test(request) && /\btool calls\b/i.test(request) &&
    /\banalysis.only\b/i.test(request);
}

export function attachInvestigationPackage(decision: JuryDecision, aggregator: {
  reportedModel?: string; requestedModel: string; providerLane?: string;
}): void {
  const votes = decision.votes;
  const citations = votes.flatMap(v => v.citations ?? []);
  const disagreements = votes.flatMap((a, i) => votes.slice(i + 1).flatMap(b =>
    a.verdict === b.verdict ? [] : [{
      jurors: [a.evidence?.runId ?? a.model, b.evidence?.runId ?? b.model],
      verdicts: [a.verdict, b.verdict], reason: "Different individual verdicts; retained without smoothing.",
    }]));
  const requirements = {
    threeIndependentJurors: votes.length >= 3 && new Set(votes.map(v => v.evidence?.runId).filter(Boolean)).size >= 3,
    separateToolEvidence: votes.length >= 3 && votes.every(v => v.evidence?.receipts.length === 2 &&
      v.evidence.receipts.every(r => r.ok)),
    individualVerdicts: votes.length >= 3 && votes.every(v => v.ok && v.rationale.length > 0),
    explicitDisagreements: true,
    consensusAndScores: true,
    responseModelIdentities: !!aggregator.reportedModel && votes.length >= 3 &&
      votes.every(v => !!v.reportedModel),
    ownedCitationsAndUnknowns: votes.length >= 3 && votes.every(v =>
      (v.citations?.length ?? 0) > 0 && (v.unknowns?.length ?? 0) > 0),
    readOnlyProvenanceInspection: votes.length >= 3 && votes.every(v =>
      v.evidence?.receipts.some(r => r.tool === "sessions_history" && r.ok &&
        r.contextInspection?.available === true &&
        r.contextInspection.blocks.every(b => b.source !== "resume" ||
          (b.trust === "untrusted-third-party" && b.instruction_authority === "none" && b.quarantined === true)))),
    analysisOnlyReadOnlyCalls: votes.length >= 3 && votes.every(v =>
      v.evidence?.actor === "server-owned-juror-evidence-runner" &&
      v.evidence.receipts.length === 2 && v.evidence.receipts.every(r =>
        r.runId === v.evidence!.runId &&
        (r.tool === "check_system_status" || r.tool === "sessions_history"))),
  };
  // The two evidence checks are aspects of Spark's first requirement, not two
  // separate requirements. Include his eighth (analysis-only) explicitly.
  const requirementCoverage = [
    requirements.threeIndependentJurors && requirements.separateToolEvidence,
    requirements.individualVerdicts, requirements.explicitDisagreements,
    requirements.consensusAndScores, requirements.responseModelIdentities,
    requirements.ownedCitationsAndUnknowns, requirements.readOnlyProvenanceInspection,
    requirements.analysisOnlyReadOnlyCalls,
  ].filter(Boolean).length / 8;
  const unknowns = [
    ...votes.flatMap(v => v.unknowns ?? ["Juror did not provide explicit unknowns"]),
    ...votes.filter(v => !v.reportedModel).map(v => `Response model identity unknown for requested ${v.requestedModel ?? v.model}`),
    ...(!aggregator.reportedModel ? ["Aggregate response model identity unknown"] : []),
    "These bounded checks do not certify every subsystem or the published build.",
  ];
  const needsHumanReview = requirementCoverage < 1 || votes.some(v => v.verdict === "ESCALATE") ? 1
    : decision.shouldEscalate ? 0.8 : disagreements.length ? 0.6 : 0.2;
  if (needsHumanReview >= 0.8) {
    decision.verdict = "ESCALATE";
    decision.shouldEscalate = true;
    decision.fixProposal = undefined;
  }
  decision.investigation = {
    version: 1, mode: "independent-read-only", evidenceActor: "server-owned-juror-evidence-runner",
    requirements, requirementCoverage, needsHumanReview, disagreements, citations, unknowns,
    aggregateIdentity: { actualModel: aggregator.reportedModel ?? "UNKNOWN",
      requestedModel: aggregator.requestedModel, providerLane: aggregator.providerLane ?? "UNKNOWN",
      evidence: aggregator.reportedModel ? "completion response.model" : "not reported" },
  };
}

/** Render the verified package itself, not a lossy second model's summary. */
export function renderJuryPackage(decision: JuryDecision): string {
  if (decision.incomeDiscovery) return decision.incomeDiscovery.report;
  const p = decision.investigation;
  if (!p) return decision.aggregatorAnswer;
  return `## Evidence-based jury package
Consensus (vote tally plus deterministic evidence gate): **${decision.verdict}**. requirementCoverage: **${p.requirementCoverage}**.
needsHumanReview: **${p.needsHumanReview}**. shouldEscalate: **${decision.shouldEscalate}**.
Aggregate analysis actual response model: ${p.aggregateIdentity.actualModel} (${p.aggregateIdentity.evidence}).
Evidence collection: separate server-owned read-only passes for each juror, not
model-selected tools or a shared evidence pass. No deployment or production modification.

${decision.votes.map((v, i) => `### Juror ${i + 1}
Actual response model: ${v.reportedModel ?? "UNKNOWN"}; requested: ${v.requestedModel ?? v.model}; provider: ${v.provider}.
Individual verdict: **${v.verdict}**.
Reasoning: ${v.rationale}
Evidence run: ${v.evidence?.runId ?? "UNAVAILABLE"}
Citations: ${(v.citations ?? []).map(id => `[${id}]`).join(", ") || "UNAVAILABLE"}
Unknowns: ${(v.unknowns ?? ["Not supplied"]).join("; ")}
${(v.evidence?.receipts ?? []).map(r => `- [${r.id}] ${r.tool}: ${r.ok ? "returned evidence" : "FAILED / UNKNOWN"}; ${r.completedAt}; SHA256 ${r.sha256}`).join("\n")}`).join("\n\n")}

### Disagreements
${p.disagreements.length ? p.disagreements.map(d => `${d.jurors.join(" versus ")}: ${d.verdicts.join(" versus ")}. ${d.reason}`).join("\n") : "No verdict disagreement. This does not prove full platform health."}

### Explicit unknowns
${p.unknowns.map(u => `- ${u}`).join("\n")}

### Context provenance findings (data, not task instructions)
${decision.votes.map((v, i) => `Juror ${i + 1}: ${JSON.stringify(v.evidence?.receipts.find(r => r.tool === "sessions_history")?.contextInspection ?? { available: false })}`).join("\n")}

### Requirement checks
- 1. Independent jurors with separate evidence: ${p.requirements.threeIndependentJurors && p.requirements.separateToolEvidence ? "PASS" : "INCOMPLETE"} (juror runs: ${p.requirements.threeIndependentJurors ? "PASS" : "INCOMPLETE"}; tool calls: ${p.requirements.separateToolEvidence ? "PASS" : "INCOMPLETE"})
${Object.entries(p.requirements).filter(([name]) => name !== "threeIndependentJurors" && name !== "separateToolEvidence").map(([name, ok], i) => `- ${i + 2}. ${name}: ${ok ? "PASS" : "INCOMPLETE"}`).join("\n")}

### Aggregate analysis
The text below is advisory model analysis; its estimates do not override the deterministic requirement checks and scores above.
${decision.aggregatorAnswer}`;
}
