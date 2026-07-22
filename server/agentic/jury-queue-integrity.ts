/**
 * Jury-queue integrity (HIGH-1 closure, fable-5 review of R125+52.9).
 *
 * `data/jury-decisions/queue.json` is an app-writable file that the drainer
 * (`scripts/drain-jury-queue.ts`) treats as AUTHORIZATION: it trusts each
 * entry's `verdict`, forwards a `precomputedJury` (no re-vote at drain), and —
 * most dangerously — honors `securityCoreAllowed`, the flag that lets
 * repo-surgeon skip the owner-HITL pause on a sensitive surface. Any local write
 * primitive (another script, a compromised dependency postinstall, an auto-fix's
 * own `newFiles`) could forge an "approved" entry and ride that trust.
 *
 * This module adds a keyed-HMAC integrity envelope so the drainer can tell a
 * producer-authored entry apart from a forged one:
 *
 *   · Producers call `signQueueEntry(entry)` before pushing. With a secret
 *     configured it stamps `_sig` (HMAC-SHA256 over the trust-relevant fields);
 *     with NO secret it returns the entry untouched — fully backward-compatible,
 *     so the default config behaves exactly as before.
 *   · The drainer calls `verifyQueueEntry(entry)`:
 *       - General forgery gate is OPT-IN: only enforced when a secret is
 *         configured (so enabling signing is a deliberate, additive step that
 *         never silently breaks the existing CI-self-healer drain).
 *       - The `securityCoreAllowed` HITL-skip privilege is FAIL-CLOSED by
 *         default: it is honored ONLY against a verified signature, so absent a
 *         configured secret + valid `_sig` the privilege is stripped and the fix
 *         falls back to owner HITL — strictly safer than today.
 *
 * The signature covers ONLY the trust-relevant fields and EXCLUDES the
 * drainer-added bookkeeping (`_drained`/`_drainedAt`/`_outcome`) and `_sig`
 * itself, so the drainer stamping an entry as processed never invalidates it.
 *
 * The secret lives in `JURY_QUEUE_HMAC_SECRET` (env / Replit Secret) — outside
 * the writable repo tree the attacker is assumed to be able to write.
 */
import * as crypto from "crypto";

/** Minimum secret length — a too-short secret is treated as "not configured"
 *  (fail closed for the security-core gate) rather than weak protection. */
const MIN_SECRET_LEN = 16;

/** The trust-relevant fields the signature commits to. Anything a forger would
 *  flip to gain trust (verdict / the security-core privilege / the pinned files
 *  / the proposal body) is in here; cosmetic fields are not. */
export interface SignableQueueEntry {
  verdict?: string;
  majority?: number;
  /** Jury concordance fields — the drainer forwards these into `precomputedJury`
   *  and `mapJuryDecision` uses them for routing (fixConcordance gates the
   *  Goodhart guard), so they MUST be signed. */
  concordance?: number | null;
  fixConcordance?: number | null;
  /** Per-model votes — `votes.length` is the unanimity denominator downstream,
   *  so the vote roster (model + verdict) is signed too. */
  votes?: Array<{ model?: string; verdict?: string; rationale?: string }>;
  shouldEscalate?: boolean;
  fixProposal?: string;
  auditSourced?: boolean;
  securityCoreAllowed?: boolean;
  candidateFiles?: string[];
  tenantId?: number;
  issueSlug?: string;
  /** `source` feeds isSensitive() in the drainer — sign it so the sensitive-path
   *  skip decision cannot be altered post-write. */
  source?: string;
  triagedAt?: string;
  _sig?: string;
  [k: string]: unknown;
}

/** Resolve the queue HMAC secret, or null when none is configured (or it is too
 *  short to be meaningful). Null means "signing not in force". */
export function getQueueSecret(explicit?: string | null): string | null {
  const s = (explicit ?? process.env.JURY_QUEUE_HMAC_SECRET ?? "").trim();
  return s.length >= MIN_SECRET_LEN ? s : null;
}

/** Deterministic serialization of the trust-relevant fields — fixed key order,
 *  normalized types, EXCLUDING `_sig` and the drainer bookkeeping fields so the
 *  signature is stable across drain-time stamping. */
export function canonicalizeForSig(e: SignableQueueEntry): string {
  const norm = {
    verdict: typeof e.verdict === "string" ? e.verdict : null,
    majority: Number(e.majority) || 0,
    // Concordance fields drive routing in mapJuryDecision (fixConcordance gates
    // the Goodhart guard) — sign them so they can't be raised post-write.
    concordance: typeof e.concordance === "number" ? e.concordance : null,
    fixConcordance: typeof e.fixConcordance === "number" ? e.fixConcordance : null,
    // votes.length is the unanimity denominator downstream — commit to the
    // roster (model + verdict, the routing-relevant projection) so neither the
    // count nor any vote can be altered without breaking the signature.
    votes: Array.isArray(e.votes)
      ? e.votes.map((v) => ({
          model: typeof v?.model === "string" ? v.model : "",
          verdict: typeof v?.verdict === "string" ? v.verdict : "",
        }))
      : [],
    shouldEscalate: e.shouldEscalate === true,
    fixProposal: typeof e.fixProposal === "string" ? e.fixProposal : "",
    auditSourced: e.auditSourced === true,
    securityCoreAllowed: e.securityCoreAllowed === true,
    candidateFiles: Array.isArray(e.candidateFiles)
      ? e.candidateFiles.map((f) => String(f))
      : [],
    tenantId: Number(e.tenantId) || 0,
    issueSlug: typeof e.issueSlug === "string" ? e.issueSlug : "",
    // source feeds isSensitive() — sign it so the sensitive-path skip can't be
    // flipped by editing the queue file.
    source: typeof e.source === "string" ? e.source : "",
    triagedAt: typeof e.triagedAt === "string" ? e.triagedAt : "",
  };
  return JSON.stringify(norm);
}

/** Compute the hex HMAC-SHA256 of an entry's trust-relevant fields. */
export function computeSig(e: SignableQueueEntry, secret: string): string {
  return crypto.createHmac("sha256", secret).update(canonicalizeForSig(e)).digest("hex");
}

/**
 * Secret-INDEPENDENT content fingerprint of an entry — the replay-ledger key
 * (HIGH-1 residual closure). A plain SHA-256 over the SAME canonical projection
 * the signature commits to, so it is:
 *   · stable across drain-time `_drained`/`_outcome` stamping (those fields are
 *     excluded from the canonicalization),
 *   · identical for a genuine entry and any byte-for-byte replay of it (flipping
 *     `_drained` back to false does not change the fingerprint), and
 *   · distinct for two genuinely-different triages (triagedAt + issueSlug +
 *     verdict + proposal all participate).
 * Computable WITHOUT the HMAC secret, so the drainer can dedup signed AND unsigned
 * entries alike. The authoritative store is the DB (`jury_drain_ledger`), which an
 * app-writable queue.json cannot forge a "not yet processed" answer for.
 */
export function entryFingerprint(e: SignableQueueEntry): string {
  return crypto.createHash("sha256").update(canonicalizeForSig(e)).digest("hex");
}

/**
 * Stamp `_sig` on an entry when a secret is configured; otherwise return it
 * unchanged (backward-compatible no-op). Producers call this immediately before
 * pushing the entry to the queue.
 */
export function signQueueEntry<T extends SignableQueueEntry>(
  entry: T,
  explicitSecret?: string | null,
): T {
  const secret = getQueueSecret(explicitSecret);
  if (!secret) return entry;
  return { ...entry, _sig: computeSig(entry, secret) };
}

/**
 * Verify an entry's `_sig` against the configured secret using a constant-time
 * comparison. Returns false when: no secret is configured, the entry carries no
 * `_sig`, the signature is malformed, or it does not match. Never throws.
 */
export function verifyQueueEntry(e: SignableQueueEntry, explicitSecret?: string | null): boolean {
  try {
    const secret = getQueueSecret(explicitSecret);
    if (!secret) return false;
    const provided = typeof e?._sig === "string" ? e._sig : "";
    if (!provided) return false;
    const expected = computeSig(e, secret);
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * The effective `securityCoreAllowed` the drainer should forward to
 * captureIncident. FAIL-CLOSED: the HITL-skip privilege is granted ONLY for a
 * genuinely audit-sourced entry whose signature VERIFIES. No configured secret,
 * no `_sig`, or a bad `_sig` ⇒ privilege stripped ⇒ owner HITL.
 */
export function effectiveSecurityCoreAllowed(
  e: SignableQueueEntry,
  sigValid: boolean,
): boolean {
  return e.auditSourced === true && e.securityCoreAllowed === true && sigValid === true;
}
