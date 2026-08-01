/**
 * tests/unit/autonomous-budget.test.ts — autonomous-spend governor
 *
 * The spend lookup is INJECTED, so this never touches the cost ledger / pg pool
 * (node:test DB-pool-hang lesson). Covers the cap-resolution precedence and the
 * three governor outcomes: within-budget, cap-exceeded (fail closed), and a
 * ledger-read failure (fail OPEN, loud, degraded).
 *
 * Run: node --import tsx --test tests/unit/autonomous-budget.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkAutonomousBudget,
  claimAutonomousBudget,
  resolveDailyCapUsd,
  DEFAULT_DAILY_BUDGET_USD,
} from "../../server/agentic/autonomous-budget";

const silent = () => {};

// The owner tenant defaults to 1 (OWNER_TENANT_ID env can override). These tests
// pin the env clean so the default holds.
const OWNER = 1;
const OTHER = 7;

// ── cap resolution precedence (OWNER tenant) ─────────────────────────────────

test("resolveDailyCapUsd: owner tenant — explicit > env > default", () => {
  delete process.env.AUTONOMOUS_DAILY_BUDGET_USD;
  delete process.env.AUTONOMOUS_TENANT_BUDGETS_USD;
  assert.equal(resolveDailyCapUsd(OWNER), DEFAULT_DAILY_BUDGET_USD);
  assert.equal(resolveDailyCapUsd(OWNER, 50), 50);

  process.env.AUTONOMOUS_DAILY_BUDGET_USD = "12.5";
  try {
    assert.equal(resolveDailyCapUsd(OWNER), 12.5, "env used when no explicit");
    assert.equal(resolveDailyCapUsd(OWNER, 7), 7, "explicit wins over env");
  } finally {
    delete process.env.AUTONOMOUS_DAILY_BUDGET_USD;
  }
});

test("resolveDailyCapUsd: owner — $0 / negative / garbage env can never set an always-blocked cap", () => {
  delete process.env.AUTONOMOUS_TENANT_BUDGETS_USD;
  assert.equal(resolveDailyCapUsd(OWNER, 0), DEFAULT_DAILY_BUDGET_USD);
  assert.equal(resolveDailyCapUsd(OWNER, -5), DEFAULT_DAILY_BUDGET_USD);
  process.env.AUTONOMOUS_DAILY_BUDGET_USD = "0";
  try {
    assert.equal(resolveDailyCapUsd(OWNER), DEFAULT_DAILY_BUDGET_USD, "env 0 falls through to default");
  } finally {
    delete process.env.AUTONOMOUS_DAILY_BUDGET_USD;
  }
  process.env.AUTONOMOUS_DAILY_BUDGET_USD = "not-a-number";
  try {
    assert.equal(resolveDailyCapUsd(OWNER), DEFAULT_DAILY_BUDGET_USD, "garbage env falls through to default");
  } finally {
    delete process.env.AUTONOMOUS_DAILY_BUDGET_USD;
  }
});

// ── owner-only economics (non-owner tenants) ─────────────────────────────────

test("resolveDailyCapUsd: a non-owner tenant with no provisioned budget gets $0", () => {
  delete process.env.AUTONOMOUS_TENANT_BUDGETS_USD;
  process.env.AUTONOMOUS_DAILY_BUDGET_USD = "25"; // owner default must NOT leak to others
  try {
    assert.equal(resolveDailyCapUsd(OTHER), 0, "owner's wallet is never spent on an unpaid tenant");
  } finally {
    delete process.env.AUTONOMOUS_DAILY_BUDGET_USD;
  }
});

test("resolveDailyCapUsd: a provisioned per-tenant budget is honored (incl. explicit 0)", () => {
  process.env.AUTONOMOUS_TENANT_BUDGETS_USD = JSON.stringify({ "7": 10, "9": 0 });
  try {
    assert.equal(resolveDailyCapUsd(OTHER), 10, "paying tenant brings their own budget");
    assert.equal(resolveDailyCapUsd(9), 0, "a tenant capped to 0 is honored exactly");
    assert.equal(resolveDailyCapUsd(OTHER, 3), 3, "explicit caller cap still wins");
  } finally {
    delete process.env.AUTONOMOUS_TENANT_BUDGETS_USD;
  }
});

test("resolveDailyCapUsd: malformed AUTONOMOUS_TENANT_BUDGETS_USD never silently grants budget", () => {
  process.env.AUTONOMOUS_TENANT_BUDGETS_USD = "{not valid json";
  try {
    assert.equal(resolveDailyCapUsd(OTHER), 0, "garbage map → non-owner still $0");
  } finally {
    delete process.env.AUTONOMOUS_TENANT_BUDGETS_USD;
  }
});

test("checkAutonomousBudget: non-owner with no budget is BLOCKED before any ledger read", async () => {
  delete process.env.AUTONOMOUS_TENANT_BUDGETS_USD;
  let readSpend = false;
  const r = await checkAutonomousBudget(
    { tenantId: OTHER, label: "t" },
    {
      getSpendToday: async () => {
        readSpend = true;
        return 0;
      },
      log: silent,
    },
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-budget-provisioned");
  assert.equal(r.capUsd, 0);
  assert.equal(readSpend, false, "no ledger read when there's no budget to check against");
});

// ── governor outcomes ─────────────────────────────────────────────────────────

test("within budget → ok:true with remaining", async () => {
  const r = await checkAutonomousBudget(
    { tenantId: 1, capUsd: 25, label: "t" },
    { getSpendToday: async () => 10, log: silent },
  );
  assert.equal(r.ok, true);
  assert.equal(r.spentUsd, 10);
  assert.equal(r.capUsd, 25);
  assert.equal(r.remainingUsd, 15);
  assert.equal(r.degraded, false);
});

test("spend == cap → BLOCKED (fail closed, boundary is inclusive)", async () => {
  const r = await checkAutonomousBudget(
    { tenantId: 1, capUsd: 25 },
    { getSpendToday: async () => 25, log: silent },
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "daily-cap-exceeded");
  assert.equal(r.remainingUsd, 0);
});

test("spend over cap → BLOCKED", async () => {
  const r = await checkAutonomousBudget(
    { tenantId: 1, capUsd: 25 },
    { getSpendToday: async () => 40, log: silent },
  );
  assert.equal(r.ok, false);
  assert.equal(r.remainingUsd, -15);
});

test("ledger read throws → fails CLOSED by default (hard ceiling)", async () => {
  let logged = "";
  const r = await checkAutonomousBudget(
    { tenantId: 1, capUsd: 25, label: "resolver" },
    {
      getSpendToday: async () => {
        throw new Error("db down");
      },
      log: (m) => (logged = m),
    },
  );
  assert.equal(r.ok, false, "can't prove under budget ⇒ don't spend");
  assert.equal(r.degraded, true);
  assert.equal(r.reason, "ledger-read-failed-fail-closed");
  assert.match(logged, /failing CLOSED/);
});

test("ledger read throws + AUTONOMOUS_BUDGET_FAILOPEN=true → fails OPEN (loud override)", async () => {
  process.env.AUTONOMOUS_BUDGET_FAILOPEN = "true";
  let logged = "";
  try {
    const r = await checkAutonomousBudget(
      { tenantId: 1, capUsd: 25, label: "resolver" },
      {
        getSpendToday: async () => {
          throw new Error("db down");
        },
        log: (m) => (logged = m),
      },
    );
    assert.equal(r.ok, true, "operator opted into keeping autonomy alive through a ledger blip");
    assert.equal(r.degraded, true);
    assert.equal(r.reason, "ledger-read-failed-fail-open-override");
    assert.match(logged, /failing OPEN/);
  } finally {
    delete process.env.AUTONOMOUS_BUDGET_FAILOPEN;
  }
});

test("tenant id is threaded to the spend lookup", async () => {
  let seenTenant = -1;
  await checkAutonomousBudget(
    { tenantId: 7, capUsd: 25 },
    {
      getSpendToday: async (t) => {
        seenTenant = t;
        return 0;
      },
      log: silent,
    },
  );
  assert.equal(seenTenant, 7);
});

// ── claimAutonomousBudget (atomic claim-before-spend) ─────────────────────────
// The claim transaction is INJECTED so these never touch the db / pg pool.

test("claim: non-owner with no budget is BLOCKED before any claim transaction", async () => {
  delete process.env.AUTONOMOUS_TENANT_BUDGETS_USD;
  let claimRan = false;
  const r = await claimAutonomousBudget(
    { tenantId: OTHER, estimatedUsd: 1, label: "t" },
    {
      claim: async () => {
        claimRan = true;
        return { ok: true, spentUsd: 0, claimedUsd: 1 };
      },
      log: silent,
    },
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-budget-provisioned");
  assert.equal(r.capUsd, 0);
  assert.equal(r.claimedUsd, 0);
  assert.equal(claimRan, false, "no claim transaction when there's no budget to reserve against");
});

test("claim: granted → ok:true carries the claimId, reserved estimate, and remaining", async () => {
  const r = await claimAutonomousBudget(
    { tenantId: 1, estimatedUsd: 4, capUsd: 25, label: "t" },
    {
      claim: async (args) => {
        assert.equal(args.tenantId, 1);
        assert.equal(args.estimatedUsd, 4, "estimate threaded to the claim tx");
        assert.equal(args.capUsd, 25);
        return { ok: true, spentUsd: 10, claimedUsd: 4, claimId: 99 };
      },
      log: silent,
    },
  );
  assert.equal(r.ok, true);
  assert.equal(r.claimId, 99);
  assert.equal(r.claimedUsd, 4);
  assert.equal(r.spentUsd, 10);
  assert.equal(r.remainingUsd, 25 - 10 - 4);
  assert.equal(r.reason, "claim-granted");
});

test("claim: a reservation that would breach the cap is REFUSED (fail closed)", async () => {
  const r = await claimAutonomousBudget(
    { tenantId: 1, estimatedUsd: 5, capUsd: 25, label: "t" },
    {
      // spend 22 + outstanding claims already at the ceiling → this estimate loses.
      claim: async () => ({ ok: false, spentUsd: 23, claimedUsd: 0 }),
      log: silent,
    },
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "daily-cap-exceeded");
  assert.equal(r.claimedUsd, 0, "a refused claim reserves nothing");
});

test("claim: a zero/negative estimate is floored, never a no-op reservation", async () => {
  let seenEstimate = -1;
  await claimAutonomousBudget(
    { tenantId: 1, estimatedUsd: 0, capUsd: 25, label: "t" },
    {
      claim: async (args) => {
        seenEstimate = args.estimatedUsd;
        return { ok: true, spentUsd: 0, claimedUsd: args.estimatedUsd };
      },
      log: silent,
    },
  );
  assert.ok(seenEstimate > 0, "0 estimate floored to a positive reservation");
});

test("claim: the claim transaction throwing fails CLOSED by default", async () => {
  let logged = "";
  const r = await claimAutonomousBudget(
    { tenantId: 1, estimatedUsd: 1, capUsd: 25, label: "resolver" },
    {
      claim: async () => {
        throw new Error("advisory lock timeout");
      },
      log: (m) => (logged = m),
    },
  );
  assert.equal(r.ok, false, "can't prove the reservation landed ⇒ don't spend");
  assert.equal(r.degraded, true);
  assert.equal(r.reason, "claim-failed-fail-closed");
  assert.equal(r.claimedUsd, 0);
  assert.match(logged, /failing CLOSED/);
});

test("claim: throwing + AUTONOMOUS_BUDGET_FAILOPEN=true fails OPEN (loud override)", async () => {
  process.env.AUTONOMOUS_BUDGET_FAILOPEN = "true";
  let logged = "";
  try {
    const r = await claimAutonomousBudget(
      { tenantId: 1, estimatedUsd: 1, capUsd: 25, label: "resolver" },
      {
        claim: async () => {
          throw new Error("db down");
        },
        log: (m) => (logged = m),
      },
    );
    assert.equal(r.ok, true, "operator opted into keeping autonomy alive through a claim blip");
    assert.equal(r.degraded, true);
    assert.equal(r.reason, "claim-failed-fail-open-override");
    assert.match(logged, /failing OPEN/);
  } finally {
    delete process.env.AUTONOMOUS_BUDGET_FAILOPEN;
  }
});
