import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import {
  calculateCommercialOpportunityScore,
  commercialOpportunityCreateSchema,
  mergeCommercialOpportunityPatch,
} from "../server/lib/commercial-research-frontier";
import {
  registerCommercialResearchFrontierRoutes,
  type CommercialResearchFrontierStore,
} from "../server/routes/commercial-research-frontier";

const scoreInputs = {
  painUrgency: 4,
  buyerAccess: 3,
  willingnessToPay: 4,
  visionClawAdvantage: 5,
  evidenceStrength: 3,
  speedToFirstSale: 4,
  repeatability: 4,
  deliveryConfidence: 4,
  buildCost: 1,
  fulfillmentCost: 2,
  legalSafetyRisk: 1,
  integrationDependence: 1,
  supportBurden: 2,
};

const createBody = {
  idempotencyKey: "astra-market-research-v1",
  title: "Evidence-first market research reports",
  originType: "external_report",
  originRef: "drive-report-1",
  buyer: "Independent investors and advisory firms",
  painfulJob: "Separating credible market evidence from generated trading claims",
  offerHypothesis: "A fixed-scope, human-reviewed market evidence report",
  evidenceSummary: "Architecture pattern is useful; profit claims remain unverified.",
  evidenceConfidence: "medium",
  evidenceState: "mixed",
  assumptions: ["Buyers will pay for independent evidence review"],
  unknowns: ["Demand and acceptable price"],
  risks: ["Financial-services credibility risk"],
  killCriterion: "No qualified buyer agrees to a discovery call after 20 targeted conversations.",
  maturity: "concept-ready",
  lifecycleStatus: "active",
  nextTest: {
    type: "buyer_interview",
    description: "Ask five qualified buyers how they validate generated market research.",
    successCriterion: "At least two describe an urgent paid need.",
  },
  scoreInputs,
};

const persisted = {
  id: 17,
  tenantId: 41,
  ...createBody,
  scoreResult: calculateCommercialOpportunityScore(scoreInputs),
  validationEvidence: null,
  createdAt: new Date("2026-09-11T12:00:00Z"),
  updatedAt: new Date("2026-09-11T12:00:00Z"),
};

function emptyStore(overrides: Partial<CommercialResearchFrontierStore> = {}): CommercialResearchFrontierStore {
  return {
    list: async () => ({ opportunities: [], total: 0 }),
    findById: async () => undefined,
    findByKey: async () => undefined,
    create: async row => ({ id: 17, ...row, createdAt: new Date(), updatedAt: new Date() } as any),
    update: async () => ({ kind: "not_found" }),
    ...overrides,
  };
}

async function withRoutes(options: {
  tenantId?: number | null;
  owner?: boolean;
  authenticated?: boolean;
  store?: CommercialResearchFrontierStore;
}, run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  registerCommercialResearchFrontierRoutes(app, {
    authMiddleware: (_req, res, next) => {
      if (options.authenticated === false) return res.status(401).json({ error: "Authentication required" });
      next();
    },
    requirePlatformAdmin: (_req, res) => {
      if (!options.owner) {
        res.status(403).json({ error: "Owner access required" });
        return false;
      }
      return true;
    },
    getTenantFromRequest: () => options.tenantId ?? null,
    store: options.store ?? emptyStore(),
  });
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("score is deterministic, bounded, and separates upside from burden", () => {
  const result = calculateCommercialOpportunityScore(scoreInputs);
  assert.deepEqual(result, {
    rubricVersion: "commercial-opportunity-v1",
    positiveTotal: 31,
    riskTotal: 7,
    opportunityScore: 64,
    maxPositive: 40,
    maxRisk: 25,
  });
  assert.equal(calculateCommercialOpportunityScore({
    ...scoreInputs,
    painUrgency: 5,
    buyerAccess: 5,
    willingnessToPay: 5,
    visionClawAdvantage: 5,
    evidenceStrength: 5,
    speedToFirstSale: 5,
    repeatability: 5,
    deliveryConfidence: 5,
    buildCost: 0,
    fulfillmentCost: 0,
    legalSafetyRisk: 0,
    integrationDependence: 0,
    supportBurden: 0,
  }).opportunityScore, 100);
});

test("create contract rejects unknown fields, caller totals, and unsupported revenue validation", () => {
  assert.equal(commercialOpportunityCreateSchema.safeParse(createBody).success, true);
  assert.equal(commercialOpportunityCreateSchema.safeParse({ ...createBody, scoreResult: { opportunityScore: 100 } }).success, false);
  assert.equal(commercialOpportunityCreateSchema.safeParse({ ...createBody, unexpected: true }).success, false);
  assert.equal(commercialOpportunityCreateSchema.safeParse({ ...createBody, maturity: "revenue-validated" }).success, false);
  assert.equal(commercialOpportunityCreateSchema.safeParse({
    ...createBody,
    maturity: "revenue-validated",
    evidenceState: "verified",
    validationEvidence: {
      type: "payment",
      reference: "authoritative-payment-record-1",
      observedAt: "2026-09-11T12:00:00.000Z",
    },
  }).success, true);
});

test("owner and tenant guards run before persistence", async () => {
  let touched = false;
  const store = emptyStore({ list: async () => { touched = true; return { opportunities: [], total: 0 }; } });
  await withRoutes({ tenantId: 41, owner: false, store }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/research-frontier/opportunities`);
    assert.equal(response.status, 403);
  });
  assert.equal(touched, false);

  await withRoutes({ tenantId: null, owner: true, store }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/research-frontier/opportunities`);
    assert.equal(response.status, 401);
  });
  assert.equal(touched, false);
});

test("create is tenant-scoped and exactly idempotent", async () => {
  const tenantCalls: number[] = [];
  const store = emptyStore({
    findByKey: async tenantId => {
      tenantCalls.push(tenantId);
      return persisted as any;
    },
  });
  await withRoutes({ tenantId: 41, owner: true, store }, async baseUrl => {
    const exact = await fetch(`${baseUrl}/api/admin/research-frontier/opportunities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody),
    });
    assert.equal(exact.status, 200);
    assert.equal((await exact.json()).idempotent, true);

    const changed = await fetch(`${baseUrl}/api/admin/research-frontier/opportunities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...createBody, buyer: "A different buyer" }),
    });
    assert.equal(changed.status, 409);
  });
  assert.deepEqual(tenantCalls, [41, 41]);
});

test("updates cannot cross tenants or smuggle computed scores", async () => {
  let updateArgs: unknown[] | undefined;
  const store = emptyStore({
    update: async (...args) => {
      updateArgs = args;
      return { kind: "not_found" };
    },
  });
  await withRoutes({ tenantId: 99, owner: true, store }, async baseUrl => {
    const smuggled = await fetch(`${baseUrl}/api/admin/research-frontier/opportunities/17`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scoreResult: { opportunityScore: 100 } }),
    });
    assert.equal(smuggled.status, 400);

    const response = await fetch(`${baseUrl}/api/admin/research-frontier/opportunities/17`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lifecycleStatus: "parked" }),
    });
    assert.equal(response.status, 404);
  });
  assert.equal(updateArgs?.[0], 99);
  assert.equal(updateArgs?.[1], 17);
});

test("updates cannot leave revenue validation attached to contradictory evidence", async () => {
  const revenueValidated = {
    ...persisted,
    maturity: "revenue-validated",
    evidenceState: "verified",
    validationEvidence: {
      type: "payment",
      reference: "authoritative-payment-record-1",
      observedAt: "2026-09-11T12:00:00.000Z",
    },
  };
  const result = mergeCommercialOpportunityPatch(revenueValidated as any, { evidenceState: "contradictory" });
  assert.equal(result.success, false);
});

test("production update contract locks before validating and writing", () => {
  const source = fs.readFileSync(new URL("../server/routes/commercial-research-frontier.ts", import.meta.url), "utf8");
  const lockIndex = source.indexOf('.for("update")');
  const mergeIndex = source.indexOf("const merged = mergeCommercialOpportunityPatch(", lockIndex);
  const updateIndex = source.indexOf(".update(commercialResearchOpportunities)", mergeIndex);
  assert.ok(lockIndex > 0);
  assert.ok(mergeIndex > lockIndex);
  assert.ok(updateIndex > mergeIndex);
});

test("feature flag fails closed before persistence", async () => {
  const previous = process.env.RESEARCH_FRONTIER_ENABLED;
  process.env.RESEARCH_FRONTIER_ENABLED = "0";
  let touched = false;
  try {
    await withRoutes({
      tenantId: null,
      owner: false,
      authenticated: false,
      store: emptyStore({ list: async () => { touched = true; return { opportunities: [], total: 0 }; } }),
    }, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/research-frontier/opportunities`);
      assert.equal(response.status, 404);
    });
  } finally {
    if (previous === undefined) delete process.env.RESEARCH_FRONTIER_ENABLED;
    else process.env.RESEARCH_FRONTIER_ENABLED = previous;
  }
  assert.equal(touched, false);
});

test("database failures are logged with operation context while responses stay sanitized", async () => {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { calls.push(args); };
  try {
    await withRoutes({
      tenantId: 41,
      owner: true,
      store: emptyStore({
        list: async () => { throw new Error("private-db-detail"); },
      }),
    }, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/research-frontier/opportunities`);
      assert.equal(response.status, 500);
      const body = JSON.stringify(await response.json());
      assert.doesNotMatch(body, /private-db-detail/);
    });
  } finally {
    console.error = original;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.[0], "[commercial-research-frontier:error]");
  assert.deepEqual(calls[0]?.[1], { operation: "list", tenantId: 41 });
  assert.match(String((calls[0]?.[2] as Error)?.message), /private-db-detail/);
});

test("create logs both the primary and reconciliation failures", async () => {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { calls.push(args); };
  let reads = 0;
  try {
    await withRoutes({
      tenantId: 41,
      owner: true,
      store: emptyStore({
        findByKey: async () => {
          reads += 1;
          if (reads > 1) throw new Error("reconcile-failed");
          return undefined;
        },
        create: async () => { throw new Error("insert-failed"); },
      }),
    }, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/research-frontier/opportunities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createBody),
      });
      assert.equal(response.status, 500);
    });
  } finally {
    console.error = original;
  }
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => (call[1] as any).operation), ["create", "create-reconcile"]);
});