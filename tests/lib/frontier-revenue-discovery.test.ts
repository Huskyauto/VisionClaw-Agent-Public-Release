import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyRevenueOpportunityNovelty,
  isFrontierRevenueDiscoveryEnabled,
  isFrontierRevenueDiscoveryPaidFinalEnabled,
  loadRevenueSurfaceInventory,
  parseRevenueDiscoveryResponse,
  listFrontierRevenueConcepts,
  readFrontierRevenueConcept,
  persistRevenueDiscoveryArtifacts,
  type RevenueSurface,
} from "../../server/lib/frontier-revenue-discovery";

const inventory: RevenueSurface[] = [
  {
    id: "audit-pro",
    name: "AI-Native Readiness Audit Pro",
    aliases: ["ai readiness audit", "website audit", "competitor audit", "website refresh"],
    customerOutcome: "A paid AI-readiness or website-positioning audit with optional refresh work.",
  },
];

test("frontier revenue discovery is disabled until the owner explicitly enables it", () => {
  assert.equal(isFrontierRevenueDiscoveryEnabled({}), false);
  assert.equal(isFrontierRevenueDiscoveryEnabled({ FRONTIER_REVENUE_DISCOVERY_ENABLED: "0" }), false);
  assert.equal(isFrontierRevenueDiscoveryEnabled({ FRONTIER_REVENUE_DISCOVERY_ENABLED: "1" }), true);
  assert.equal(isFrontierRevenueDiscoveryPaidFinalEnabled({}), false);
  assert.equal(isFrontierRevenueDiscoveryPaidFinalEnabled({ FRONTIER_REVENUE_DISCOVERY_PAID_FINAL: "0" }), false);
  assert.equal(isFrontierRevenueDiscoveryPaidFinalEnabled({ FRONTIER_REVENUE_DISCOVERY_PAID_FINAL: "1" }), true);
});

test("the curated revenue-surface inventory loads the audit and Smart Leads exclusions", async () => {
  const loaded = await loadRevenueSurfaceInventory("data/money-opportunities/existing-revenue-surfaces.md");

  assert.ok(loaded.some((surface) => surface.id === "audit-pro"));
  assert.ok(loaded.some((surface) => surface.id === "smart-leads"));
});

test("a renamed website audit is rejected as an existing revenue surface", () => {
  const result = classifyRevenueOpportunityNovelty(
    {
      title: "Local visibility diagnostic",
      targetBuyer: "Local HVAC contractors",
      painfulJob: "Know why competitors appear above them in search.",
      paidOffer: "A competitor audit.",
      existingSurfaceComparison: "Different packaging for smaller businesses.",
      buildDelta: "A prettier PDF template.",
    },
    inventory,
  );

  assert.equal(result.status, "overlap/rejected");
  assert.deepEqual(result.overlaps, ["audit-pro"]);
});

test("a renamed Smart Leads offer is rejected on one known alias", () => {
  const result = classifyRevenueOpportunityNovelty(
    {
      title: "Warm Pipeline Accelerator",
      targetBuyer: "Independent sales consultants",
      painfulJob: "Know which prospects to pursue first.",
      paidOffer: "A lead research package.",
      existingSurfaceComparison: "A faster price point for consultants.",
      buildDelta: "A new dossier cover.",
    },
    [{
      id: "smart-leads",
      name: "Smart Leads, Zero Research",
      aliases: ["smart leads", "sales dossier", "lead research"],
      customerOutcome: "Research dossiers and suggested outreach for a customer's raw leads.",
    }],
  );

  assert.equal(result.status, "overlap/rejected");
  assert.deepEqual(result.overlaps, ["smart-leads"]);
});

test("a discovery response missing required proof evidence is rejected", () => {
  const response = {
    schema_version: 1,
    candidates: Array.from({ length: 3 }, (_, index) => ({
      title: `Candidate ${index + 1}`,
      target_buyer: "Independent operators",
      painful_job: "Prove a recurring operational problem is being solved.",
      paid_offer: "A fixed-scope operational intelligence service.",
      existing_surface_comparison: "It is not an audit or prospecting dossier.",
      build_delta: "A small evidence collection workflow.",
      proof_experiment: "Interview five qualified buyers and offer a paid pilot.",
      price_cost_model: "$500 setup; under $50 in model and delivery cost.",
      operational_risks: "Sensitive customer data must remain customer-scoped.",
      kill_criterion: "No paid pilot after five qualified conversations.",
      scores: {
        novelty: 80,
        buyer_pain: 75,
        willingness_to_pay: 70,
        build_effort: 35,
        time_to_proof: 45,
        evidence_quality: 50,
        operational_risk: 30,
      },
    })),
    final_selection: {
      candidate_title: "Candidate 1",
      rationale: "Best balance of pain and build effort.",
      handoff: "Review before creating a feature contract or Revenue Mission.",
    },
  };

  const parsed = parseRevenueDiscoveryResponse(JSON.stringify(response));

  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /evidence_plan/i);
});

test("a valid novel discovery writes collision-safe project briefs without overwriting prior runs", async () => {
  const response = {
    schema_version: 1,
    candidates: Array.from({ length: 3 }, (_, index) => ({
      title: `Compliance Evidence Desk ${index + 1}`,
      target_buyer: "Small regulated service firms",
      painful_job: "Prepare auditable evidence without recreating the same documents each quarter.",
      paid_offer: "A fixed-scope recurring evidence-readiness desk.",
      existing_surface_comparison: "It is a customer-owned evidence workflow, not an audit or prospect dossier.",
      build_delta: "A scoped evidence register and approval-aware document assembly workflow.",
      proof_experiment: "Offer a paid readiness sprint to five firms with an upcoming renewal.",
      price_cost_model: "$750 setup and $149 monthly; under $75 in model and delivery cost.",
      evidence_plan: "Verify renewals, document volume, and buyer interviews before outreach.",
      operational_risks: "Customer documents require tenant isolation and human approval before delivery.",
      kill_criterion: "No paid readiness sprint after five qualified conversations.",
      scores: {
        novelty: 82,
        buyer_pain: 78,
        willingness_to_pay: 70,
        build_effort: 40,
        time_to_proof: 45,
        evidence_quality: 55,
        operational_risk: 35,
      },
    })),
    final_selection: {
      candidate_title: "Compliance Evidence Desk 1",
      rationale: "It offers a recurring problem with a contained initial build.",
      handoff: "Human review before creating a feature contract or Revenue Mission.",
    },
  };
  const parsed = parseRevenueDiscoveryResponse(JSON.stringify(response));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "frontier-revenue-discovery-"));
  try {
    const input = {
      rootDir,
      prompt: "Discover net-new revenue opportunities.",
      rawResponse: JSON.stringify(response),
      discovery: parsed.value,
      inventory,
      now: new Date("2026-08-22T12:00:00.000Z"),
    };
    const first = await persistRevenueDiscoveryArtifacts(input);
    const second = await persistRevenueDiscoveryArtifacts(input);

    assert.equal(first.status, "promoted");
    assert.equal(first.briefs.length, 3);
    assert.notEqual(first.directory, second.directory);
    assert.match(path.basename(second.directory), /-2$/);
    assert.deepEqual((await readdir(first.directory)).sort(), [
      "candidate-01-compliance-evidence-desk-1.md",
      "candidate-02-compliance-evidence-desk-2.md",
      "candidate-03-compliance-evidence-desk-3.md",
      "run.json",
    ]);
    const brief = await readFile(first.briefs[0], "utf8");
    assert.match(brief, /Status: new/);
    assert.match(brief, /Human decision required/i);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("an all-overlap discovery is retained as rejected and never promoted", async () => {
  const response = {
    schema_version: 1,
    candidates: Array.from({ length: 3 }, (_, index) => ({
      title: `Website Audit Rebrand ${index + 1}`,
      target_buyer: "Local service businesses",
      painful_job: "Find why competitors rank above them.",
      paid_offer: "An AI readiness audit plus website refresh.",
      existing_surface_comparison: "A new price point for the same website audit.",
      build_delta: "A fresh report cover.",
      proof_experiment: "Offer the audit to five businesses.",
      price_cost_model: "$300 fixed fee; under $20 delivery cost.",
      evidence_plan: "Confirm buyer demand before selling.",
      operational_risks: "Claims must remain evidence-backed.",
      kill_criterion: "No purchase after five qualified conversations.",
      scores: {
        novelty: 5,
        buyer_pain: 70,
        willingness_to_pay: 60,
        build_effort: 10,
        time_to_proof: 10,
        evidence_quality: 60,
        operational_risk: 20,
      },
    })),
    final_selection: {
      candidate_title: "Website Audit Rebrand 1",
      rationale: "It is familiar to buyers.",
      handoff: "Human review before any future work.",
    },
  };
  const parsed = parseRevenueDiscoveryResponse(JSON.stringify(response));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "frontier-revenue-overlap-"));
  try {
    const persisted = await persistRevenueDiscoveryArtifacts({
      rootDir,
      prompt: "Discover net-new revenue opportunities.",
      rawResponse: JSON.stringify(response),
      discovery: parsed.value,
      inventory,
      now: new Date("2026-08-22T12:00:00.000Z"),
    });

    assert.equal(persisted.status, "rejected");
    assert.equal(persisted.statusCounts["overlap/rejected"], 3);
    const run = JSON.parse(await readFile(persisted.runFile, "utf8"));
    assert.equal(run.status, "rejected");
    assert.equal(run.external_commitments, "none");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("a mixed run is rejected when the jury selects an overlapping candidate", async () => {
  const response = {
    schema_version: 1,
    candidates: [
      {
        title: "Website Audit Rebrand",
        target_buyer: "Local service businesses",
        painful_job: "Find why competitors rank above them.",
        paid_offer: "An AI readiness audit.",
        existing_surface_comparison: "A lower price for the same audit.",
        build_delta: "A fresh report cover.",
        proof_experiment: "Offer the audit to five businesses.",
        price_cost_model: "$300 fixed fee; under $20 delivery cost.",
        evidence_plan: "Confirm buyer demand before selling.",
        operational_risks: "Claims must remain evidence-backed.",
        kill_criterion: "No purchase after five qualified conversations.",
        scores: { novelty: 5, buyer_pain: 70, willingness_to_pay: 60, build_effort: 10, time_to_proof: 10, evidence_quality: 60, operational_risk: 20 },
      },
      ...Array.from({ length: 2 }, (_, index) => ({
        title: `New Evidence Product ${index + 1}`,
        target_buyer: "Small regulated firms",
        painful_job: "Keep recurring evidence ready without duplicate work.",
        paid_offer: "A fixed-scope evidence-readiness service.",
        existing_surface_comparison: "Customer-owned evidence workflow, not a current surface.",
        build_delta: "A scoped evidence register.",
        proof_experiment: "Offer a paid sprint to five renewal-bound firms.",
        price_cost_model: "$750 setup; under $75 delivery cost.",
        evidence_plan: "Verify renewals and buyer interviews first.",
        operational_risks: "Customer documents require human approval.",
        kill_criterion: "No paid sprint after five qualified conversations.",
        scores: { novelty: 82, buyer_pain: 78, willingness_to_pay: 70, build_effort: 40, time_to_proof: 45, evidence_quality: 55, operational_risk: 35 },
      })),
    ],
    final_selection: {
      candidate_title: "Website Audit Rebrand",
      rationale: "The jury selected the familiar offer.",
      handoff: "Human review before any future work.",
    },
  };
  const parsed = parseRevenueDiscoveryResponse(JSON.stringify(response));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "frontier-revenue-mixed-"));
  try {
    const persisted = await persistRevenueDiscoveryArtifacts({
      rootDir,
      prompt: "Discover net-new revenue opportunities.",
      rawResponse: JSON.stringify(response),
      discovery: parsed.value,
      inventory,
      now: new Date("2026-08-22T12:00:00.000Z"),
    });

    assert.equal(persisted.status, "rejected");
    assert.equal(persisted.statusCounts.new, 2);
    assert.equal(persisted.statusCounts["overlap/rejected"], 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("promoted concepts get an archive index and repeated discoveries add history without duplication", async () => {
  const response = {
    schema_version: 1,
    candidates: Array.from({ length: 3 }, (_, index) => ({
      title: `Evidence Desk ${index + 1}`,
      target_buyer: "Small regulated service firms",
      painful_job: "Prepare recurring evidence without recreating the same documents.",
      paid_offer: "A fixed-scope evidence-readiness desk.",
      existing_surface_comparison: "A customer-owned evidence workflow, not an audit or prospecting dossier.",
      build_delta: "A scoped evidence register and approval-aware document workflow.",
      proof_experiment: "Offer a paid readiness sprint to five qualified firms.",
      price_cost_model: "$750 setup; under $75 delivery cost.",
      evidence_plan: "Verify renewal deadlines and buyer interviews.",
      operational_risks: "Customer documents require tenant isolation and human approval.",
      kill_criterion: "No paid sprint after five qualified conversations.",
      scores: {
        novelty: 82,
        buyer_pain: 78,
        willingness_to_pay: 70,
        build_effort: 40,
        time_to_proof: 45,
        evidence_quality: 55,
        operational_risk: 35,
      },
    })),
    final_selection: {
      candidate_title: "Evidence Desk 1",
      rationale: "It has a contained initial build.",
      handoff: "Human review before creating a feature contract or Revenue Mission.",
    },
  };
  const parsed = parseRevenueDiscoveryResponse(JSON.stringify(response));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "frontier-revenue-archive-"));
  try {
    const input = {
      rootDir,
      prompt: "Discover net-new revenue opportunities.",
      rawResponse: JSON.stringify(response),
      discovery: parsed.value,
      inventory,
      now: new Date("2026-08-22T12:00:00.000Z"),
    };
    const first = await persistRevenueDiscoveryArtifacts(input);
    const second = await persistRevenueDiscoveryArtifacts(input);
    assert.equal(first.status, "promoted");
    assert.equal(second.status, "promoted");

    const concepts = await listFrontierRevenueConcepts(rootDir);
    assert.equal(concepts.length, 3);
    assert.ok(concepts.every((concept) => concept.noveltyStatus === "new"));
    assert.ok(concepts.every((concept) => concept.sourceRunCount === 2));
    assert.ok(concepts.every((concept) => concept.humanReviewState === "needs_review"));

    const concept = await readFrontierRevenueConcept(rootDir, concepts[0].id);
    assert.ok(concept);
    assert.equal(concept?.candidate.title, concepts[0].title);
    assert.equal(concept?.sourceRunIds.length, 2);
    assert.match(concept?.briefMarkdown || "", /Human decision required/i);
    assert.match(concept?.files.brief || "", /README\.md/);
    assert.equal(await readFrontierRevenueConcept(rootDir, "../run.json"), null);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});