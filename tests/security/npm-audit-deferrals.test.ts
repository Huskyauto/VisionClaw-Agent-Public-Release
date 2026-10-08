/**
 * npm-audit-deferrals — the fail-closed contract for weekly-maintenance Pass 1's
 * documented-deferral downgrade (scripts/lib/npm-audit-deferrals.ts).
 *
 * Pins the security invariants demanded by the completion review:
 *   1. Only the approved GHSA advisory chain downgrades.
 *   2. A NEW severe advisory on an already-listed package stays RED (not deferred).
 *   3. Malformed / missing / expired allowlist ⇒ nothing deferred.
 *   4. Severe fallout with no resolvable advisory id ⇒ nothing deferred.
 *
 * Pure-logic tests: no DB, no network, no fs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeferrals, classifySevere } from "../../scripts/lib/npm-audit-deferrals";

const NOW = new Date("2026-07-31T00:00:00Z");

const GOOD_FILE = {
  deferrals: [
    {
      advisory: "GHSA-mh99-v99m-4gvg",
      reason: "brace-expansion DoS; no upstream fix",
      reference: "docs/architecture-notes.md",
      deferredAt: "2026-07-30",
      reviewBy: "2026-10-31",
    },
  ],
};

// Mirrors the real npm-audit shape: root advisory object on brace-expansion,
// chained string-vias on the dependents.
const CHAIN_VULNS = {
  "brace-expansion": {
    severity: "high",
    via: [{ name: "brace-expansion", severity: "high", url: "https://github.com/advisories/GHSA-mh99-v99m-4gvg", title: "DoS" }],
  },
  minimatch: { severity: "high", via: ["brace-expansion"] },
  glob: { severity: "high", via: ["minimatch"] },
  exceljs: { severity: "high", via: ["glob"] },
};

test("approved GHSA chain downgrades (allSevereDeferred=true)", () => {
  const deferrals = parseDeferrals(GOOD_FILE, NOW);
  assert.equal(deferrals.length, 1);
  const cls = classifySevere(CHAIN_VULNS as any, deferrals);
  assert.equal(cls.allSevereDeferred, true);
  assert.deepEqual(cls.severeAdvisories, ["GHSA-mh99-v99m-4gvg"]);
  assert.deepEqual(cls.undeferredAdvisories, []);
});

test("a NEW severe advisory on a listed package stays RED", () => {
  const vulns = {
    ...CHAIN_VULNS,
    exceljs: {
      severity: "high",
      via: [
        "glob",
        { name: "exceljs", severity: "critical", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", title: "new RCE" },
      ],
    },
  };
  const cls = classifySevere(vulns as any, parseDeferrals(GOOD_FILE, NOW));
  assert.equal(cls.allSevereDeferred, false);
  assert.ok(cls.undeferredAdvisories.includes("GHSA-aaaa-bbbb-cccc"));
});

test("missing / malformed allowlist defers nothing", () => {
  for (const bad of [undefined, null, 42, "x", {}, { deferrals: "nope" }, { deferrals: [{ advisory: "GHSA-mh99-v99m-4gvg" }] }]) {
    const deferrals = parseDeferrals(bad, NOW);
    assert.equal(deferrals.length, 0);
    assert.equal(classifySevere(CHAIN_VULNS as any, deferrals).allSevereDeferred, false);
  }
});

test("expired deferral (reviewBy in the past) defers nothing", () => {
  const expired = { deferrals: [{ ...GOOD_FILE.deferrals[0], reviewBy: "2026-07-01" }] };
  const deferrals = parseDeferrals(expired, NOW);
  assert.equal(deferrals.length, 0);
  assert.equal(classifySevere(CHAIN_VULNS as any, deferrals).allSevereDeferred, false);
});

test("non-GHSA / package-name-style allowlist entry is rejected", () => {
  const pkgStyle = { deferrals: [{ ...GOOD_FILE.deferrals[0], advisory: "brace-expansion" }] };
  assert.equal(parseDeferrals(pkgStyle, NOW).length, 0);
});

test("severe package with no resolvable advisory id is never deferred (fail closed)", () => {
  const vulns = {
    mystery: { severity: "high", via: [{ name: "mystery", severity: "high", title: "no url/source" }] },
    ...CHAIN_VULNS,
  };
  const cls = classifySevere(vulns as any, parseDeferrals(GOOD_FILE, NOW));
  assert.equal(cls.allSevereDeferred, false);
  assert.ok(cls.unresolvedPackages.includes("mystery"));
});

test("no severe packages at all is not 'deferred' (downgrade never applies)", () => {
  const cls = classifySevere({ uuid: { severity: "moderate", via: [] } } as any, parseDeferrals(GOOD_FILE, NOW));
  assert.equal(cls.allSevereDeferred, false);
  assert.deepEqual(cls.severePackages, []);
});
