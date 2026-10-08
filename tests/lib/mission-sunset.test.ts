// Query-free tests for the mission sunset guard's pure decision logic.
// (No DB calls — importing the module is safe; only sweepMissionSunset queries.)
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { decideSunset, SUNSET_RULES, SUNSET_MARKER, SUNSET_ELIGIBLE_STAGES } from "../../server/lib/mission-sunset";
import { assessMission } from "../../server/lib/mission-capital-allocator";

const NOW = new Date("2026-07-25T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function input(overrides: Partial<Parameters<typeof decideSunset>[0]> & { mission?: any } = {}) {
  const mission = {
    id: 1,
    name: "Test mission",
    stage: "experiment_live",
    leads_contacted: 3,
    positive_replies: 1,
    revenue_usd_cents: 0,
    refunds_usd_cents: 0,
    spend_usd_cents: 500,
    ...(overrides.mission || {}),
  };
  return {
    stage: "experiment_live",
    notes: null,
    createdAt: daysAgo(5),
    lastActivityAt: daysAgo(2),
    assessment: assessMission(mission),
    ...overrides,
  };
}

test("healthy fresh mission is left alone", () => {
  const d = decideSunset(input(), NOW);
  assert.equal(d.action, "none");
});

test("ineligible stages never sunset (hypothesis, killed, scale_ready)", () => {
  for (const stage of ["hypothesis", "experiment_draft", "killed", "scale_ready", "presell"]) {
    const d = decideSunset(input({ stage }), NOW);
    assert.equal(d.action, "none", stage);
  }
  // sanity: the eligible list is what the sweep queries
  assert.deepEqual([...SUNSET_ELIGIBLE_STAGES], ["experiment_live", "evaluating"]);
});

test("allocator kill signal triggers pause", () => {
  const d = decideSunset(
    input({ mission: { leads_contacted: 12, positive_replies: 0 } }),
    NOW,
  );
  assert.equal(d.action, "pause");
  assert.match(d.reasons.join(" "), /kill signal/);
});

test("staleness triggers pause after staleActivityDays of no activity", () => {
  const d = decideSunset(input({ lastActivityAt: daysAgo(SUNSET_RULES.staleActivityDays + 1) }), NOW);
  assert.equal(d.action, "pause");
  assert.match(d.reasons.join(" "), /stale/);
  // one day inside the window: no pause
  const fresh = decideSunset(input({ lastActivityAt: daysAgo(SUNSET_RULES.staleActivityDays - 1) }), NOW);
  assert.equal(fresh.action, "none");
});

test("missing lastActivityAt falls back to createdAt for staleness", () => {
  const d = decideSunset(
    input({ lastActivityAt: null, createdAt: daysAgo(SUNSET_RULES.staleActivityDays + 2) }),
    NOW,
  );
  assert.equal(d.action, "pause");
});

test("unproven lifetime cap pauses; positive margin exempts", () => {
  const old = input({
    createdAt: daysAgo(SUNSET_RULES.maxUnprovenLifetimeDays + 1),
    lastActivityAt: daysAgo(1), // active, so staleness doesn't fire
  });
  const d = decideSunset(old, NOW);
  assert.equal(d.action, "pause");
  assert.match(d.reasons.join(" "), /lifetime/);

  // Same age but first-dollar proven (margin > 0) → scale_candidate, no lifetime pause.
  const proven = decideSunset(
    input({
      createdAt: daysAgo(SUNSET_RULES.maxUnprovenLifetimeDays + 1),
      lastActivityAt: daysAgo(1),
      mission: { revenue_usd_cents: 5000, spend_usd_cents: 500 },
    }),
    NOW,
  );
  assert.equal(proven.action, "none");
});

test("sunset marker in notes short-circuits (idempotent, no re-notify)", () => {
  const d = decideSunset(
    input({
      notes: `${SUNSET_MARKER} 2026-07-01: paused — stale]`,
      mission: { leads_contacted: 50, positive_replies: 0 },
    }),
    NOW,
  );
  assert.equal(d.action, "none");
  assert.match(d.reasons.join(" "), /already sunset/);
});

test("junk dates never throw and fail toward no action", () => {
  const d = decideSunset(
    input({ createdAt: new Date("garbage"), lastActivityAt: null }),
    NOW,
  );
  assert.equal(d.action, "none");
});

test("SQL pin: last_activity_at is COALESCE-wrapped so no-evidence missions keep fresh updated_at (GREATEST NULL regression)", () => {
  const src = readFileSync("server/lib/mission-sunset.ts", "utf8");
  assert.match(src, /COALESCE\(\s*GREATEST\(/, "GREATEST must be wrapped in COALESCE — GREATEST(x, NULL) is NULL in Postgres");
  assert.match(src, /\),\s*m\.updated_at,\s*m\.created_at\s*\)\s*AS last_activity_at/, "COALESCE fallback chain must end with m.updated_at, m.created_at");
});

test("no-evidence mission with recent activity but old createdAt is NOT stale-paused", () => {
  const d = decideSunset(
    input({ createdAt: daysAgo(SUNSET_RULES.maxUnprovenLifetimeDays + 30), lastActivityAt: daysAgo(1),
      mission: { revenue_usd_cents: 5000, spend_usd_cents: 500 } }),
    NOW,
  );
  assert.equal(d.action, "none");
});
