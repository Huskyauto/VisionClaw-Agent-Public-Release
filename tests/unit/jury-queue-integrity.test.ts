/**
 * tests/unit/jury-queue-integrity.test.ts
 *
 * Pins HIGH-1 (fable-5 review of R125+52.9): the jury queue is an app-writable
 * file, so its trust-relevant fields must be authenticated before the drainer
 * acts on them. These tests cover the HMAC integrity envelope:
 *
 *   - signing is a no-op without a configured secret (backward compatible);
 *   - a signed entry verifies; tampering ANY trust field breaks verification;
 *   - drainer bookkeeping (_drained/_drainedAt/_outcome) does NOT invalidate it;
 *   - the securityCoreAllowed HITL-skip privilege is FAIL-CLOSED — granted only
 *     for an audit-sourced entry whose signature verifies.
 *
 * Run: node --import tsx --test tests/unit/jury-queue-integrity.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getQueueSecret,
  signQueueEntry,
  verifyQueueEntry,
  effectiveSecurityCoreAllowed,
  entryFingerprint,
  type SignableQueueEntry,
} from "../../server/agentic/jury-queue-integrity";

const SECRET = "test-secret-0123456789abcdef"; // >= 16 chars
const sampleEntry = (): SignableQueueEntry => ({
  triagedAt: "2026-06-09T00:00:00.000Z",
  tenantId: 1,
  source: "tenant-isolation-audit",
  issueSlug: "tenant-iso:server/routes.ts:42",
  verdict: "FIX",
  majority: 3,
  concordance: 0.82,
  fixConcordance: 0.71,
  votes: [
    { model: "a", verdict: "FIX", rationale: "x" },
    { model: "b", verdict: "FIX", rationale: "y" },
    { model: "c", verdict: "FIX", rationale: "z" },
  ],
  shouldEscalate: false,
  fixProposal: "Add the missing WHERE tenant_id clause.",
  auditSourced: true,
  securityCoreAllowed: true,
  candidateFiles: ["server/routes.ts"],
});

// ── getQueueSecret ───────────────────────────────────────────────────────────

test("getQueueSecret: null when unset, too short, or whitespace; value when >=16", () => {
  assert.equal(getQueueSecret(""), null);
  assert.equal(getQueueSecret("short"), null, "a too-short secret is treated as not configured");
  assert.equal(getQueueSecret("               "), null, "whitespace-only is not configured");
  assert.equal(getQueueSecret(SECRET), SECRET);
});

test("getQueueSecret: reads JURY_QUEUE_HMAC_SECRET from env", () => {
  const prev = process.env.JURY_QUEUE_HMAC_SECRET;
  try {
    delete process.env.JURY_QUEUE_HMAC_SECRET;
    assert.equal(getQueueSecret(), null);
    process.env.JURY_QUEUE_HMAC_SECRET = SECRET;
    assert.equal(getQueueSecret(), SECRET);
  } finally {
    if (prev === undefined) delete process.env.JURY_QUEUE_HMAC_SECRET;
    else process.env.JURY_QUEUE_HMAC_SECRET = prev;
  }
});

// ── signing / verifying ──────────────────────────────────────────────────────

test("signQueueEntry: no-op without a configured secret (backward compatible)", () => {
  const e = sampleEntry();
  const signed = signQueueEntry(e, "");
  assert.equal(signed._sig, undefined, "no secret ⇒ no _sig stamped");
});

test("signQueueEntry + verifyQueueEntry: round-trips with a secret", () => {
  const signed = signQueueEntry(sampleEntry(), SECRET);
  assert.equal(typeof signed._sig, "string");
  assert.ok((signed._sig as string).length > 0);
  assert.equal(verifyQueueEntry(signed, SECRET), true);
});

test("verifyQueueEntry: false when no secret is configured", () => {
  const signed = signQueueEntry(sampleEntry(), SECRET);
  assert.equal(verifyQueueEntry(signed, ""), false, "cannot verify without the secret");
});

test("verifyQueueEntry: false when _sig is absent", () => {
  assert.equal(verifyQueueEntry(sampleEntry(), SECRET), false);
});

test("verifyQueueEntry: false under a wrong secret", () => {
  const signed = signQueueEntry(sampleEntry(), SECRET);
  assert.equal(verifyQueueEntry(signed, "another-secret-0123456789"), false);
});

test("verifyQueueEntry: malformed _sig does not throw and returns false", () => {
  const e = { ...sampleEntry(), _sig: "not-hex-zzz" };
  assert.equal(verifyQueueEntry(e, SECRET), false);
  const e2 = { ...sampleEntry(), _sig: "abcd" }; // valid hex, wrong length
  assert.equal(verifyQueueEntry(e2, SECRET), false);
});

// ── tamper detection (each trust field) ──────────────────────────────────────

test("verifyQueueEntry: flipping verdict breaks the signature", () => {
  const signed = signQueueEntry(sampleEntry(), SECRET);
  const tampered = { ...signed, verdict: "ACCEPT" };
  assert.equal(verifyQueueEntry(tampered, SECRET), false);
});

test("verifyQueueEntry: flipping securityCoreAllowed breaks the signature", () => {
  const signed = signQueueEntry({ ...sampleEntry(), securityCoreAllowed: false }, SECRET);
  const tampered = { ...signed, securityCoreAllowed: true };
  assert.equal(verifyQueueEntry(tampered, SECRET), false, "forging the HITL-skip privilege must be detected");
});

test("verifyQueueEntry: flipping candidateFiles breaks the signature", () => {
  const signed = signQueueEntry(sampleEntry(), SECRET);
  const tampered = { ...signed, candidateFiles: ["server/auth.ts"] };
  assert.equal(verifyQueueEntry(tampered, SECRET), false);
});

test("verifyQueueEntry: editing source (isSensitive input) breaks the signature", () => {
  const signed = signQueueEntry(sampleEntry(), SECRET);
  const tampered = { ...signed, source: "ci-failure:spoofed" };
  assert.equal(verifyQueueEntry(tampered, SECRET), false, "source feeds isSensitive — must be signed");
});

test("verifyQueueEntry: editing fixProposal body breaks the signature", () => {
  const signed = signQueueEntry(sampleEntry(), SECRET);
  const tampered = { ...signed, fixProposal: "rm -rf / ; drop a backdoor" };
  assert.equal(verifyQueueEntry(tampered, SECRET), false);
});

test("verifyQueueEntry: raising fixConcordance (Goodhart-guard bypass) is detected", () => {
  const signed = signQueueEntry({ ...sampleEntry(), fixConcordance: 0.2 }, SECRET);
  const tampered = { ...signed, fixConcordance: 0.99 };
  assert.equal(verifyQueueEntry(tampered, SECRET), false, "forging fix-direction concordance must break the sig");
});

test("verifyQueueEntry: altering concordance breaks the signature", () => {
  const signed = signQueueEntry(sampleEntry(), SECRET);
  const tampered = { ...signed, concordance: 0.1 };
  assert.equal(verifyQueueEntry(tampered, SECRET), false);
});

test("verifyQueueEntry: shrinking the votes roster (unanimity-math forge) is detected", () => {
  const signed = signQueueEntry(sampleEntry(), SECRET);
  // votes.length is the unanimity denominator — drop two votes so majority>=total
  const tampered = { ...signed, votes: [{ model: "a", verdict: "FIX", rationale: "x" }] };
  assert.equal(verifyQueueEntry(tampered, SECRET), false, "changing the vote count must break the sig");
});

test("verifyQueueEntry: flipping a single vote's verdict breaks the signature", () => {
  const signed = signQueueEntry(sampleEntry(), SECRET);
  const votes = sampleEntry().votes!.map((v) => ({ ...v }));
  votes[2].verdict = "REJECT";
  const tampered = { ...signed, votes };
  assert.equal(verifyQueueEntry(tampered, SECRET), false);
});

test("verifyQueueEntry: rewriting a vote's rationale only (cosmetic) does NOT break the sig", () => {
  // rationale is intentionally NOT part of the routing-relevant projection.
  const signed = signQueueEntry(sampleEntry(), SECRET);
  const votes = sampleEntry().votes!.map((v) => ({ ...v, rationale: "rewritten" }));
  const cosmetic = { ...signed, votes };
  assert.equal(verifyQueueEntry(cosmetic, SECRET), true, "rationale is cosmetic — must not affect verification");
});

// ── drain-time stamping must NOT invalidate the signature ─────────────────────

test("verifyQueueEntry: drainer bookkeeping fields do not invalidate the sig", () => {
  const signed = signQueueEntry(sampleEntry(), SECRET);
  const stamped = {
    ...signed,
    _drained: true,
    _drainedAt: "2026-06-09T01:00:00.000Z",
    _outcome: "captured:repo_surgeon",
  };
  assert.equal(verifyQueueEntry(stamped, SECRET), true, "stamping _drained must not break verification");
});

// ── effectiveSecurityCoreAllowed (fail-closed privilege) ─────────────────────

// ── entryFingerprint (HIGH-1 replay-ledger key) ──────────────────────────────
test("entryFingerprint: deterministic for identical content", () => {
  const e = sampleEntry();
  assert.equal(entryFingerprint(e as any), entryFingerprint(sampleEntry() as any));
  assert.match(entryFingerprint(e as any), /^[0-9a-f]{64}$/); // sha256 hex
});

test("entryFingerprint: REPLAY-STABLE across drainer bookkeeping flips", () => {
  // The whole point of the ledger: a tampered queue that flips `_drained` back to
  // false (to replay a past fix) MUST still map to the same ledger key, so the
  // replay is caught. Drainer bookkeeping is excluded from canonicalizeForSig.
  const base = sampleEntry();
  const replayed = {
    ...sampleEntry(),
    _drained: false, // attacker cleared this to re-trigger routing
    _drainedAt: "2026-06-09T12:00:00.000Z",
    _outcome: "captured:repo-surgeon",
    _sig: "deadbeef",
  };
  assert.equal(entryFingerprint(base as any), entryFingerprint(replayed as any));
});

test("entryFingerprint: distinct when a routing-relevant field changes", () => {
  const a = sampleEntry();
  const b = { ...sampleEntry(), issueSlug: "tenant-iso:server/routes.ts:99" };
  const c = { ...sampleEntry(), verdict: "ACCEPT" };
  assert.notEqual(entryFingerprint(a as any), entryFingerprint(b as any));
  assert.notEqual(entryFingerprint(a as any), entryFingerprint(c as any));
});

test("entryFingerprint: distinct when securityCoreAllowed differs (privilege can't be silently aliased)", () => {
  const a = sampleEntry();
  const b = { ...sampleEntry(), securityCoreAllowed: false };
  assert.notEqual(entryFingerprint(a as any), entryFingerprint(b as any));
});

test("effectiveSecurityCoreAllowed: granted only for audit-sourced + verified sig", () => {
  const e = sampleEntry();
  assert.equal(effectiveSecurityCoreAllowed(e, true), true, "audit + flag + valid sig ⇒ granted");
  assert.equal(effectiveSecurityCoreAllowed(e, false), false, "invalid/absent sig ⇒ stripped → HITL");
});

test("effectiveSecurityCoreAllowed: stripped when not audit-sourced even with a valid sig", () => {
  const e = { ...sampleEntry(), auditSourced: false };
  assert.equal(effectiveSecurityCoreAllowed(e, true), false, "a non-audit entry can never gain the privilege");
});

test("effectiveSecurityCoreAllowed: stripped when the flag itself is false", () => {
  const e = { ...sampleEntry(), securityCoreAllowed: false };
  assert.equal(effectiveSecurityCoreAllowed(e, true), false);
});

test("end-to-end: a forged audit entry (no valid sig) loses the privilege under enforcement", () => {
  // Attacker writes a plausible audit entry but cannot produce a valid _sig.
  const forged = sampleEntry(); // auditSourced + securityCoreAllowed, but unsigned
  const sigValid = verifyQueueEntry(forged, SECRET); // false (no _sig)
  assert.equal(sigValid, false);
  assert.equal(effectiveSecurityCoreAllowed(forged, sigValid), false, "forged privilege is stripped → owner HITL");
});
