/**
 * tests/unit/repair-incident-classifier.test.ts
 *
 * Repo Surgeon Task #51 — judgment classifier (bug vs guard).
 *
 * Pins the HARD INVARIANT: a safety-guard-firing-correctly incident, OR any
 * incident whose fix would touch a test / guard / safety-profile surface, is
 * NEVER routed to an automated code fix — it surfaces or escalates. Also covers
 * the four normal classifications, the confidence/jury-mapping rules, and the
 * coupled-verifier fix-concordance guard.
 *
 * These exercise the PURE decision functions only (no DB, no LLM jury) — the
 * classifier module pulls every heavy dependency in via dynamic import, so this
 * file is fully deterministic and DB-independent.
 *
 * Run: node --import tsx --test tests/unit/repair-incident-classifier.test.ts
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  classifyIncidentHeuristic,
  enforceSafetyRouting,
  touchesProtectedSurface,
  guardFiredCorrectly,
  isProtectedCiRule,
  mapJuryDecision,
  type RawIncident,
} from "../../server/agentic/repair-incident";

function base(over: Partial<RawIncident> = {}): RawIncident {
  return { tenantId: 1, source: "runtime_self_heal", ...over };
}

// ── Predicates ──────────────────────────────────────────────────────────────

test("touchesProtectedSurface flags test/guard/safety files", () => {
  assert.equal(touchesProtectedSurface(base({ candidateFiles: ["tests/security/ahb-regression.test.ts"] })), true);
  assert.equal(touchesProtectedSurface(base({ candidateFiles: ["server/safety/destructive-tool-policy.ts"] })), true);
  assert.equal(touchesProtectedSurface(base({ candidateFiles: ["server/foo.spec.ts"] })), true);
  assert.equal(touchesProtectedSurface(base({ candidateFiles: ["server/routes/projects.ts"] })), false);
});

test("guardFiredCorrectly recognizes refusal / policy-block / content-filter", () => {
  assert.equal(guardFiredCorrectly(base({ refused: true })), true);
  assert.equal(guardFiredCorrectly(base({ toolPolicyBlocked: true })), true);
  assert.equal(guardFiredCorrectly(base({ error: "Response stopped by provider content filter" })), true);
  assert.equal(guardFiredCorrectly(base({ error: "Tool blocked by policy: requires approval" })), true);
  assert.equal(guardFiredCorrectly(base({ error: "ETIMEDOUT connecting to upstream" })), false);
});

test("isProtectedCiRule flags the human-review-gate CI rules", () => {
  assert.equal(isProtectedCiRule(base({ ciRuleId: "noop-heal:sql-raw-callsite" })), true);
  assert.equal(isProtectedCiRule(base({ ciRuleId: "stale-string-preflight" })), true);
  assert.equal(isProtectedCiRule(base({ ciNoAutoFix: true })), true);
  assert.equal(isProtectedCiRule(base({ ciRuleId: "noop-heal:silent-catch-burndown" })), false);
});

// ── Heuristic classifications ────────────────────────────────────────────────

test("guard firing correctly → safety_guard, surface, NEVER auto-fixed", () => {
  const r = classifyIncidentHeuristic(base({ refused: true, error: "Refusal: cannot comply" }))!;
  assert.equal(r.classification, "safety_guard");
  assert.equal(r.routedTo, "surface");
  assert.equal(r.safetyBlockedAutofix, true);
  assert.notEqual(r.routedTo, "repo_surgeon");
});

test("protected CI rule → safety_guard, never auto-fixed", () => {
  const r = classifyIncidentHeuristic(base({ source: "ci_self_heal", ciRuleId: "noop-heal:sql-raw-callsite", error: "drift" }))!;
  assert.equal(r.classification, "safety_guard");
  assert.equal(r.safetyBlockedAutofix, true);
  assert.notEqual(r.routedTo, "repo_surgeon");
});

test("transient infra error → transient_infra, retry", () => {
  const r = classifyIncidentHeuristic(base({ error: "ECONNRESET: socket hang up" }))!;
  assert.equal(r.classification, "transient_infra");
  assert.equal(r.routedTo, "retry");
  assert.equal(r.safetyBlockedAutofix, false);
});

test("Felix grade-below-bar → deliverable_quality, felix_revise (not a code fix)", () => {
  const r = classifyIncidentHeuristic(base({ source: "felix_deliverable", felixFailureKind: "grade_below_bar", error: "scored below the passing bar" }))!;
  assert.equal(r.classification, "deliverable_quality");
  assert.equal(r.routedTo, "felix_revise");
  assert.notEqual(r.routedTo, "repo_surgeon");
});

test("Felix delivery-infra → transient_infra, retry", () => {
  const r = classifyIncidentHeuristic(base({ source: "felix_deliverable", felixFailureKind: "delivery_infra", error: "Drive upload failed" }))!;
  assert.equal(r.classification, "transient_infra");
  assert.equal(r.routedTo, "retry");
});

test("deterministic code defect → code_defect, repo_surgeon", () => {
  const r = classifyIncidentHeuristic(base({ error: "TypeError: cannot read property 'id' of undefined", candidateFiles: ["server/routes/projects.ts"] }))!;
  assert.equal(r.classification, "code_defect");
  assert.equal(r.routedTo, "repo_surgeon");
  assert.equal(r.safetyBlockedAutofix, false);
});

test("ambiguous incident → heuristic returns null (defer to jury)", () => {
  const r = classifyIncidentHeuristic(base({ error: "the widget produced an unexpected result" }));
  assert.equal(r, null);
});

// ── Safety enforcement (belt-and-suspenders final gate) ──────────────────────

test("INVARIANT: code-defect whose fix touches a TEST file is rerouted to escalate_owner", () => {
  const raw = base({ error: "TS2345: type mismatch", candidateFiles: ["tests/security/ahb-regression.test.ts"] });
  const heur = classifyIncidentHeuristic(raw)!;
  assert.equal(heur.routedTo, "repo_surgeon"); // heuristic alone would auto-fix
  const enforced = enforceSafetyRouting(raw, heur);
  assert.equal(enforced.routedTo, "escalate_owner");
  assert.equal(enforced.safetyBlockedAutofix, true);
  assert.notEqual(enforced.routedTo, "repo_surgeon");
});

test("INVARIANT: code-defect touching a safety/ file is rerouted away from auto-fix", () => {
  const raw = base({ error: "ReferenceError: x is not defined", candidateFiles: ["server/safety/destructive-tool-policy.ts"] });
  const enforced = enforceSafetyRouting(raw, classifyIncidentHeuristic(raw)!);
  assert.equal(enforced.routedTo, "escalate_owner");
  assert.equal(enforced.safetyBlockedAutofix, true);
});

test("enforceSafetyRouting: a guard-fired signal overrides even a FIX verdict", () => {
  const raw = base({ refused: true });
  const juryFix = mapJuryDecision({ verdict: "FIX", majority: 3, fixConcordance: 0.9 });
  assert.equal(juryFix.routedTo, "repo_surgeon");
  const enforced = enforceSafetyRouting(raw, juryFix);
  assert.equal(enforced.classification, "safety_guard");
  assert.equal(enforced.routedTo, "surface");
  assert.equal(enforced.safetyBlockedAutofix, true);
});

test("enforceSafetyRouting: a non-protected code defect passes through to repo_surgeon", () => {
  const raw = base({ error: "TypeError", candidateFiles: ["server/routes/projects.ts"] });
  const enforced = enforceSafetyRouting(raw, classifyIncidentHeuristic(raw)!);
  assert.equal(enforced.routedTo, "repo_surgeon");
  assert.equal(enforced.safetyBlockedAutofix, false);
});

// ── Jury decision mapping ────────────────────────────────────────────────────

test("jury UNANIMOUS FIX (high concordance) → code_defect, repo_surgeon", () => {
  const r = mapJuryDecision({ verdict: "FIX", majority: 3, fixConcordance: 0.8, aggregatorAnswer: "fix the null guard" });
  assert.equal(r.classification, "code_defect");
  assert.equal(r.routedTo, "repo_surgeon");
});

test("INVARIANT: jury FIX 2-of-3 SPLIT → escalate_owner (never auto-fix a contested judgment)", () => {
  const r = mapJuryDecision({ verdict: "FIX", majority: 2, fixConcordance: 0.9 });
  assert.equal(r.classification, "code_defect");
  assert.equal(r.routedTo, "escalate_owner");
  assert.notEqual(r.routedTo, "repo_surgeon");
});

test("INVARIANT: jury shouldEscalate=true overrides a unanimous FIX → escalate_owner", () => {
  const r = mapJuryDecision({ verdict: "FIX", majority: 3, fixConcordance: 0.9, shouldEscalate: true });
  assert.equal(r.routedTo, "escalate_owner");
  assert.notEqual(r.routedTo, "repo_surgeon");
});

test("jury FIX but split fix-direction (low concordance) → escalate_owner (Goodhart guard)", () => {
  const r = mapJuryDecision({ verdict: "FIX", majority: 3, fixConcordance: 0.3 });
  assert.equal(r.routedTo, "escalate_owner");
  assert.notEqual(r.routedTo, "repo_surgeon");
});

test("jury ACCEPT / REJECT → safety_guard, surface (not an auto-fix candidate)", () => {
  const acc = mapJuryDecision({ verdict: "ACCEPT", majority: 3 });
  assert.equal(acc.routedTo, "surface");
  assert.equal(acc.classification, "safety_guard");
  assert.equal(mapJuryDecision({ verdict: "REJECT", majority: 2 }).routedTo, "surface");
});

test("jury ESCALATE / split → escalate_owner", () => {
  assert.equal(mapJuryDecision({ verdict: "ESCALATE", majority: 1 }).routedTo, "escalate_owner");
});

test("INVARIANT: classifier NEVER emits an 'unknown' classification for any jury outcome", () => {
  const allowed = new Set(["transient_infra", "deliverable_quality", "safety_guard", "code_defect"]);
  const cases = [
    { verdict: "FIX", majority: 3, fixConcordance: 0.9 },
    { verdict: "FIX", majority: 2, fixConcordance: 0.9 },
    { verdict: "FIX", majority: 3, fixConcordance: 0.1 },
    { verdict: "FIX", majority: 3, fixConcordance: 0.9, shouldEscalate: true },
    { verdict: "ACCEPT", majority: 3 },
    { verdict: "ACCEPT", majority: 2, shouldEscalate: true },
    { verdict: "REJECT", majority: 2 },
    { verdict: "ESCALATE", majority: 1 },
    { verdict: "ESCALATE", majority: 0 },
    {},
  ];
  for (const c of cases) {
    const r = mapJuryDecision(c);
    assert.ok(allowed.has(r.classification), `unexpected classification "${r.classification}" for ${JSON.stringify(c)}`);
  }
});

after(() => {
  // Defensive: ensure the process exits even if a dynamic import warmed a timer.
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});
