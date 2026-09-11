/**
 * Central pre-INSERT PII redaction guard (gate-1 at the storage boundary).
 *
 * The threat model (root `threat_model.md`, OWASP LLM04 / MITRE AML.T0070 row)
 * flagged that PII redaction before persistence into the durable agent stores
 * (`memory_entries`, `agent_knowledge`) was applied *per call site*, not centrally.
 * A forgotten call site = a live secret, SSN, or card number silently persisted
 * from an untrusted-ingest path. This module is the single choke-point so it
 * can't be forgotten: it is wired into `storage.createMemoryEntry()` and
 * `storage.createKnowledge()` (the only two write paths for those tables).
 *
 * Design (deliberately tiered to avoid destroying legitimate business data):
 *   - ALWAYS redacted (high-liability; never legitimately stored in a free-text
 *     fact): credential-shaped secrets (composed from the 48-pattern catalog in
 *     `lib/secret-scan`), credit-card numbers (Luhn-validated), and US SSNs.
 *   - DETECTED but NOT stripped by default: email + phone. These are frequently
 *     legitimate CRM/business facts ("customer X's email is ..."), so blanket
 *     stripping would make memory useless. Callers that ingest genuinely
 *     untrusted free text can opt in via `redactContactInfo: true`.
 *
 * Pure / synchronous / no IO — safe to call on every write. Idempotent on the
 * already-redacted markers it emits.
 */
import { redactSecretsByPattern } from "../lib/secret-scan";

export type PiiClass = "secret" | "ssn" | "credit_card" | "email" | "phone";

export interface PiiRedactionOptions {
  /**
   * Also redact contact info (email + phone). Default false — these are often
   * legitimate business data, so by default we DETECT (for classification /
   * telemetry) but do not strip them. Set true for untrusted public ingest.
   */
  redactContactInfo?: boolean;
}

export interface PiiRedactionResult {
  redacted: string;
  /** Classes actually replaced in the output. */
  redactedClasses: PiiClass[];
  /** Classes detected in the input (superset of redactedClasses). */
  detectedClasses: PiiClass[];
}

// Email — standard local@domain.tld.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// US SSN — require separators (dash or space) so we don't nuke arbitrary
// 9-digit numbers; exclude the structurally-invalid ranges the SSA never issues.
const SSN_RE = /\b(?!000|666|9\d\d)\d{3}[-\s](?!00)\d{2}[-\s](?!0000)\d{4}\b/g;
// Phone — conservative NANP shape (optional +1, area code, 7 digits) with
// mandatory separators to keep false positives low.
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}\b/g;
// Credit-card CANDIDATE — 13–19 digits possibly separated by single spaces or
// dashes. Validated by Luhn before redaction to avoid stripping ordinary long
// numbers (IDs, timestamps concatenated, etc.).
const CC_CANDIDATE_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Redact high-liability PII + secrets from a free-text value before it is
 * persisted into a durable agent store. See module header for the tiering.
 */
export function redactPiiForStorage(
  input: unknown,
  opts: PiiRedactionOptions = {},
): PiiRedactionResult {
  if (typeof input !== "string" || input.length === 0) {
    // Coerce to string so the declared `redacted: string` contract holds even
    // for non-string inputs (e.g. a number leaf) — `?? ""` alone would leak a
    // non-string through and violate the return type at runtime.
    return { redacted: String(input ?? ""), redactedClasses: [], detectedClasses: [] };
  }
  const redacted = new Set<PiiClass>();
  const detected = new Set<PiiClass>();
  let out = input;

  // 1. Secrets / credentials (ALWAYS) — compose the existing 48-pattern scanner.
  const sec = redactSecretsByPattern(out);
  if (sec.report.hits.length > 0) {
    redacted.add("secret");
    detected.add("secret");
    out = sec.redacted;
  }

  // 2. Credit cards (ALWAYS, Luhn-validated).
  out = out.replace(CC_CANDIDATE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (luhnValid(digits)) {
      detected.add("credit_card");
      redacted.add("credit_card");
      return "[REDACTED_CC]";
    }
    return m;
  });

  // 3. SSN (ALWAYS).
  out = out.replace(SSN_RE, () => {
    detected.add("ssn");
    redacted.add("ssn");
    return "[REDACTED_SSN]";
  });

  // 4. Email — detect always; strip only if opted in.
  out = out.replace(EMAIL_RE, (m) => {
    detected.add("email");
    if (opts.redactContactInfo) {
      redacted.add("email");
      return "[REDACTED_EMAIL]";
    }
    return m;
  });

  // 5. Phone — detect always; strip only if opted in.
  out = out.replace(PHONE_RE, (m) => {
    detected.add("phone");
    if (opts.redactContactInfo) {
      redacted.add("phone");
      return "[REDACTED_PHONE]";
    }
    return m;
  });

  return {
    redacted: out,
    redactedClasses: [...redacted],
    detectedClasses: [...detected],
  };
}

/**
 * Apply `redactPiiForStorage` to the named string fields of a record before a
 * durable-store INSERT/UPDATE. Returns the (possibly new) object plus the union
 * of redacted classes. Only allocates a copy when something was actually
 * redacted, so the no-PII hot path is allocation-free.
 */
export function redactRecordFields<T extends Record<string, any>>(
  data: T,
  fields: (keyof T)[],
  opts: PiiRedactionOptions = {},
): { data: T; redactedClasses: PiiClass[] } {
  let out = data;
  const all = new Set<PiiClass>();
  for (const field of fields) {
    const val = data[field];
    if (typeof val !== "string" || val.length === 0) continue;
    const r = redactPiiForStorage(val, opts);
    if (r.redactedClasses.length > 0) {
      if (out === data) out = { ...data };
      (out as Record<string, unknown>)[field as string] = r.redacted;
      for (const c of r.redactedClasses) all.add(c);
    }
  }
  return { data: out, redactedClasses: [...all] };
}

/**
 * Deep-redact an arbitrary JSON-serializable value BEFORE `JSON.stringify`, so
 * the persisted blob stays valid JSON. String leaves run through
 * `redactPiiForStorage`; numeric leaves are checked for a bare credit-card
 * number (the only PII class that can appear as an unquoted JSON number — SSN/
 * email/phone all require separators) and replaced with a string marker if so.
 * Use this for code paths that serialize a structured object into a free-text
 * column (e.g. the step-ledger), instead of redacting the stringified text
 * (which could corrupt the JSON).
 */
export function redactObjectForStorage(
  value: unknown,
  opts: PiiRedactionOptions = {},
): { redacted: unknown; redactedClasses: PiiClass[] } {
  const all = new Set<PiiClass>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = redactPiiForStorage(v, opts);
      for (const c of r.redactedClasses) all.add(c);
      return r.redacted;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      const digits = String(Math.trunc(Math.abs(v)));
      if (luhnValid(digits)) {
        all.add("credit_card");
        return "[REDACTED_CC]";
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return { redacted: walk(value), redactedClasses: [...all] };
}
