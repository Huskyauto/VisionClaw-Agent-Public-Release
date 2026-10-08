import test from "node:test";
import assert from "node:assert/strict";
import { requiresIncomeDiscovery, runIncomeDiscovery, incomeDiscoveryApproach, publicIncomeScoutQuery } from "../../server/lib/income-discovery";
import { parseIncomeAssessments } from "../../server/lib/income-discovery";
const compliantPolicy = { oneTimeBilling: "compliant", employmentDecisions: "compliant", ownerApproval: "compliant" };

test("income jury generates concepts then cross-scores the frozen pool and preserves full report", async () => {
  assert.equal(requiresIncomeDiscovery("Run an independent jury for new income source opportunities with novel hypotheses and a ranked top-3"), true);
  const phases: string[] = [];
  const result = await runIncomeDiscovery({
    request: "Find new income opportunities. Exclude generic websites.",
    infer: async (phase, prompt, evidence) => {
      phases.push(phase);
      const candidates = phase === "assessment" ? JSON.parse(prompt.split("CANDIDATES_JSON\n")[1].split("\nEND_CANDIDATES")[0]) : [];
      return [0, 1, 2].map(seat => ({
        modelId: `model-${seat}`, provider: `provider-${seat}`, reportedModel: `actual-${seat}`,
        ok: true, latencyMs: 1, evidence: evidence?.[seat],
        answer: JSON.stringify(phase === "ideation" ? {
          hypotheses: [0, 1].map(n => ({ title: `Distinct offer ${seat}-${n}`, buyer: `Buyer ${seat}-${n}`,
            problem: `Problem ${seat}-${n}`, offer: `Deliverable ${seat}-${n}`, novelty: "Different buyer and outcome; not generic websites",
            proposedPrice: "$99 proposed, not observed", assumptions: ["Demand unknown"], validation: "Ask a buyer about a sample" })),
        } : { overallVerdict: "ESCALATE", overallRationale: "Buyer validation is unknown; keep the promising concepts and validate them.",
          assessments: candidates.map((c: any) => ({
          candidateId: c.id, verdict: "VALIDATE-FIRST", scores: { willingnessToPay: null, speed: 3, deliveryCost: 4, ownerFit: 4, claimHonesty: 5 },
          confidence: "LOW", rationale: "A creative proposal, not verified buyer demand", unknowns: ["Buyer demand"], claims: [],
          citations: [], validation: "Prepare a sample; contact requires approval", exclusionCheck: "distinct",
          policyCompliance: seat === 0 && c.id === candidates[0].id
            ? { ...compliantPolicy, oneTimeBilling: "conflict" } : compliantPolicy,
        })) }),
      }));
    },
    research: async seat => ({ seatId: String(seat), runId: `run-${seat}`,
      actor: "server-owned-juror-evidence-runner", receipts: [] }),
  });
  assert.deepEqual(phases, ["ideation", "assessment"]);
  assert.equal(result.candidates.length, 6);
  assert.equal(result.rankings.length, 3);
  assert.ok(!result.rankings.some(r => r.candidateId === result.candidates[0].id),
    "a single hard-policy conflict must veto ranking, even when two jurors disagree");
  assert.equal(result.consensus.verdict, "ESCALATE", "completed analysis is not proof of a credible income path");
  assert.ok(result.candidates.every(c => result.assessments.filter(a => a.candidateId === c.id).length === 3));
  assert.ok(result.report.includes("VALIDATE-FIRST"));
  assert.ok(result.report.includes("actual-2"));
  assert.ok(result.requirementCoverage < 1, "no evidence must never receive full coverage");
});

test("invented observations and another candidate's receipt cannot establish demand", () => {
  const candidates: any[] = [{ id: "C1" }, { id: "C2" }];
  const seats: any[] = [0, 1, 2].map(seat => ({
    ok: true, evidence: { receipts: [{ id: `r${seat}`, tool: "web_search", candidateId: "C1",
      ok: true, excerpt: "https://example.com pricing starts at $49" }] },
    answer: JSON.stringify({ assessments: candidates.map(c => ({
      candidateId: c.id, verdict: "PROCEED", scores: { willingnessToPay: 5, speed: 5, deliveryCost: 5, ownerFit: 5, claimHonesty: 5 },
      confidence: "HIGH", rationale: "Should be easy", unknowns: [], citations: [`r${seat}`],
      validation: "Ask a buyer", exclusionCheck: "distinct",
      policyCompliance: compliantPolicy,
      claims: [{ text: "100 paying customers", kind: "observed", citations: [`r${seat}`],
        quote: "100 paying customers", url: "https://example.com" }],
    })) }),
  }));
  const parsed = parseIncomeAssessments(seats, candidates);
  assert.equal(parsed.complete, false);
  assert.ok(parsed.assessments.every(a => a.verdict !== "PROCEED"));
});

async function researchedFixture(request: string, backed = false) {
  return runIncomeDiscovery({
    request,
    catalog: "Existing catalog: generic websites; do not repackage them",
    scout: async seat => ({ seatId: String(seat), runId: `scout-${seat}`,
      actor: "server-owned-juror-evidence-runner", receipts: [{
        id: `scout-${seat}/search`, runId: `scout-${seat}`, tool: "web_search", ok: true,
        startedAt: "now", completedAt: "now", sha256: "test", excerpt: "Public problem",
        sources: [{ url: "https://example.com", text: "Documented customer problem" }],
      }] }),
    research: async (seat, candidates) => ({ seatId: String(seat), runId: `seat-${seat}`,
      actor: "server-owned-juror-evidence-runner", receipts: [
        { id: `seat-${seat}/sessions`, runId: `seat-${seat}`, tool: "sessions_history", ok: true,
          startedAt: "now", completedAt: "now", sha256: "test", excerpt: "provenance",
          contextInspection: { available: true, blocks: [] } },
        { id: `seat-${seat}/registry`, runId: `seat-${seat}`, tool: "introspect_tools", ok: true,
          startedAt: "now", completedAt: "now", sha256: "test", excerpt: "Registered capabilities; runtime unverified" },
        ...candidates.map(c => ({ id: `seat-${seat}/${c.id}`, runId: `seat-${seat}`, candidateId: c.id,
          tool: "web_search", ok: true, startedAt: "now", completedAt: "now", sha256: "test",
          excerpt: "https://example.com public weak market signal; no buyer trial",
          sources: [{ url: "https://example.com", text: "Documented customer problem" }] })),
      ] }),
    infer: async (phase, prompt, evidence) => [0, 1, 2].map(seat => {
      const candidates = phase === "assessment" ? JSON.parse(prompt.split("CANDIDATES_JSON\n")[1].split("\nEND_CANDIDATES")[0]) : [];
      return { modelId: `model-${seat}`, provider: `lane-${seat}`, reportedModel: `actual-${seat}`,
        ok: true, latencyMs: 1, evidence: evidence?.[seat], answer: JSON.stringify(phase === "ideation" ? {
          hypotheses: [0, 1].map(n => ({ title: `Concept ${seat}-${n}`, buyer: `New buyer ${seat}-${n}`,
            problem: `Different problem ${seat}-${n}`, offer: `Different outcome ${seat}-${n}`,
            novelty: "Different buyer and outcome, not a renamed website", proposedPrice: "unknown",
            assumptions: ["Unvalidated demand"], validation: "Prepare an example" })),
        } : { overallVerdict: "ESCALATE", overallRationale: "Demand remains unverified; candidates are suitable for validation, not a proven income path",
          assessments: candidates.map((c: any) => ({
          candidateId: c.id, verdict: "VALIDATE-FIRST", scores: { willingnessToPay: null, speed: seat + 2,
            deliveryCost: 4, ownerFit: 4, claimHonesty: 5 }, confidence: "LOW",
          rationale: "Interesting but buyer validation absent", unknowns: ["Buyer willingness to pay"],
          citations: [`seat-${seat}/${c.id}`], claims: backed ? [{
            kind: "observed", text: "Documented customer problem", quote: "Documented customer problem",
            url: "https://example.com", citations: [`seat-${seat}/${c.id}`],
          }] : [], validation: "Prepare a sample first",
          validationCostUsd: 0, validationMinutes: 20 - seat * 5,
          exclusionCheck: "distinct",
          policyCompliance: compliantPolicy,
        })) }) };
    }),
  });
}

test("complete independently researched six-concept fixture reaches full task coverage without claiming buyer validation", async () => {
  const result = await researchedFixture("Run an independent jury for novel income sources, cross-score and rank three, analysis only.");
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.consensus.verdict, "ESCALATE");
  assert.equal(result.requirementCoverage, 1);
  assert.equal(result.assessments.length, 18);
  assert.equal(result.disagreements.length, 6);
  assert.equal(result.rankings.length, 3);
  assert.ok(result.rankings.every(r => r.verdict === "VALIDATE-FIRST" && r.confidence === "LOW"));
  assert.ok(result.rankings.every(r => r.validationMinutes === 10));
  assert.ok(result.report.includes("willingnessToPay=UNKNOWN"));
});

test("evidence-first retains unsupported hypotheses but cannot shortlist or certify them as backed", async () => {
  const result = await researchedFixture("Run an income jury for novel ideas with real evidence");
  assert.equal(result.candidates.length, 6);
  assert.equal(result.assessments.length, 18);
  assert.equal(result.rankings.length, 0);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.requirements.evidenceBackedShortlist, false);
});

test("source-attributed evidence-first completion still does not claim proven willingness to pay", async () => {
  const result = await researchedFixture("Run an income jury for novel ideas with real evidence", true);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.requirements.evidenceBackedShortlist, true);
  assert.equal(result.rankings.length, 3);
  assert.equal(result.consensus.verdict, "ESCALATE");
  assert.ok(result.assessments.every(a => a.scores.willingnessToPay === null));
  assert.match(result.report, /source quote: "Documented customer problem"; URL: https:\/\/example.com/);
});

test("request profile does not turn explanations or negative instructions into jury runs", () => {
  assert.equal(requiresIncomeDiscovery("Assemble three independent jurors to find new income-source hypotheses"), true);
  assert.equal(requiresIncomeDiscovery("How does the income discovery jury find ideas?"), false);
  assert.equal(requiresIncomeDiscovery("Do not run a jury for income opportunities"), false);
  assert.equal(requiresIncomeDiscovery("Run a jury to review a code defect"), false);
});

test("the original request selects creative-first or evidence-first proposals without a caller-controlled mode", () => {
  assert.equal(incomeDiscoveryApproach("Run an income jury to invent six novel ideas"), "hypothesis-first");
  assert.equal(incomeDiscoveryApproach("Run an income jury and back the proposals with real evidence"), "evidence-first");
  assert.equal(incomeDiscoveryApproach("Run an income jury; research first and cite actual sources"), "evidence-first");
  assert.equal(incomeDiscoveryApproach("Run an income jury; don't require real evidence for brainstorming"), "hypothesis-first");
});

test("public scouting varies the source angle without sending the owner's private request", () => {
  const privateRequest = "Research HVAC income for my secret product at https://private.example and contact private@example.com";
  const queries = [0, 1, 2].map(seat => publicIncomeScoutQuery(privateRequest, seat));
  assert.equal(new Set(queries).size, 3);
  assert.ok(queries.every(q => q.startsWith("hvac ") && q.length < 200));
  assert.ok(queries.every(q => !q.includes("private") && !q.includes("secret") && !q.includes("contact")));
  assert.match(publicIncomeScoutQuery("Unknown market", 0), /^small business /);
});

test("evidence-first investigates independently before inventing ideas and never calls missing proof complete", async () => {
  const order: string[] = [];
  let ideationEvidence: Parameters<Parameters<typeof runIncomeDiscovery>[0]["infer"]>[2];
  const result = await runIncomeDiscovery({
    request: "Run an income jury for HVAC opportunities with real evidence behind the proposals",
    scout: async seat => {
      order.push(`scout-${seat}`);
      return { seatId: `seat-${seat}`, runId: `scout-${seat}`,
        actor: "server-owned-juror-evidence-runner", receipts: [{
          id: `scout-${seat}/search`, runId: `scout-${seat}`, tool: "web_search", ok: true,
          startedAt: "now", completedAt: "now", sha256: "test",
          excerpt: "Public source is only an idea lead",
          sources: [{ url: "https://example.org/public", text: "Public source is only an idea lead" }],
        }] };
    },
    infer: async (phase, _prompt, evidence) => {
      order.push(phase);
      if (phase === "ideation") {
        ideationEvidence = evidence;
      }
      return [];
    },
    research: async seat => ({ seatId: `seat-${seat}`, runId: "", actor: "server-owned-juror-evidence-runner", receipts: [] }),
  });
  assert.deepEqual(order.slice(0, 4), ["scout-0", "scout-1", "scout-2", "ideation"]);
  assert.equal(ideationEvidence?.length, 3);
  assert.ok(ideationEvidence?.every((pass, seat) => pass.receipts[0]?.id === `scout-${seat}/search`));
  assert.equal(result.approach, "evidence-first");
  assert.equal(result.scouting.length, 3);
  assert.match(result.report, /scout-0\/search/, "failed ideation must not erase completed scouting receipts");
  assert.equal(result.requirements.evidenceFirstScouting, true);
  assert.equal(result.status, "INCOMPLETE");
  assert.match(result.report, /Evidence-first/);
});

test("query echoes and source mixing cannot authenticate observed claims", () => {
  for (const sources of [[], [{ url: "https://example.com", text: "Actual text says nothing about customers" }],
    [{ url: "https://other.example", text: "100 paying customers" }, { url: "https://example.com", text: "Pricing only" }]]) {
    const parsed = parseIncomeAssessments([0, 1, 2].map(seat => ({
      modelId: `m${seat}`, provider: `p${seat}`, ok: true, latencyMs: 0,
      evidence: { seatId: String(seat), runId: String(seat), actor: "server-owned-juror-evidence-runner",
        receipts: [{ id: `r${seat}`, candidateId: "C1", runId: String(seat), tool: "web_search",
          ok: true, startedAt: "now", completedAt: "now", sha256: "test",
          excerpt: "QUERY: https://example.com 100 paying customers", sources }] },
      answer: JSON.stringify({ assessments: [{ candidateId: "C1", verdict: "PROCEED",
        scores: { willingnessToPay: 5, speed: 5, deliveryCost: 5, ownerFit: 5, claimHonesty: 5 },
        confidence: "HIGH", rationale: "Unsupported", unknowns: [], citations: [`r${seat}`],
        validation: "Prepare a sample", exclusionCheck: "distinct",
        policyCompliance: compliantPolicy,
        claims: [{ kind: "observed", text: "100 paying customers", quote: "100 paying customers",
          url: "https://example.com", citations: [`r${seat}`] }] }] }),
    })), [{ id: "C1" } as any]);
    assert.equal(parsed.complete, false);
    assert.equal(parsed.assessments.length, 0);
  }
});

test("business-policy conflicts reject an opportunity and unknown policy cannot proceed", () => {
  for (const status of ["conflict", "unknown"]) {
    const parsed = parseIncomeAssessments([0, 1, 2].map(seat => ({
      modelId: `m${seat}`, provider: `p${seat}`, ok: true, latencyMs: 0,
      answer: JSON.stringify({ assessments: [{ candidateId: "C1", verdict: "PROCEED",
        scores: { willingnessToPay: null, speed: 3, deliveryCost: 3, ownerFit: 3, claimHonesty: 3 },
        confidence: "LOW", rationale: "Policy check", unknowns: [], claims: [], citations: [],
        validation: "Prepare a sample", exclusionCheck: "distinct",
        policyCompliance: { ...compliantPolicy, employmentDecisions: status } }] }),
    })), [{ id: "C1" } as any]);
    assert.equal(parsed.assessments.length, 3);
    assert.ok(parsed.assessments.every(a => a.verdict === (status === "conflict" ? "REJECT" : "VALIDATE-FIRST")));
  }
});
