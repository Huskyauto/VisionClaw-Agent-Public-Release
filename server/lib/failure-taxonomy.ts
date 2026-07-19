// Failure taxonomy for the durable agent job queue.
//
// PROBLEM (Forge roadmap, reliability layer): the queue retried every failure
// with the same fixed exponential backoff regardless of WHY it failed. That
// wastes money and loops on DETERMINISTIC failures — a validation error or a
// guardrail block will fail identically on every retry, so retrying just
// repeats the same bad call. Conversely, a rate-limit wants a LONGER cooldown
// than a one-off socket reset.
//
// This module is a pure, dependency-free, fully-testable classifier. It maps a
// raw error string to a FailureClass, and each class to a retry policy. It is
// deliberately conservative: anything it cannot confidently classify falls
// through to "unknown", whose policy is identical to the queue's previous
// behavior (retryable, normal backoff) — so unclassified errors are a no-op
// regression-wise. Only the clearly-deterministic classes short-circuit to
// terminal, and only rate-limits back off longer.

export type FailureClass =
  | "rate_limit"          // 429 / quota — retryable, LONGER backoff
  | "network_transient"   // ECONNRESET, 502/503/504, fetch failed — retryable
  | "timeout"             // deadline/timed out — retryable
  | "auth_expired"        // 401/403, token expired — retryable (may be a refresh race)
  | "validation_error"    // 400/422, bad schema/input — NON-retryable (deterministic)
  | "guardrail_blocked"   // policy/safety refusal — NON-retryable (deterministic)
  | "not_found"           // 404, resource missing — NON-retryable (won't appear on retry)
  | "deterministic_input" // no handler / unsupported kind — NON-retryable
  | "internal_bug"        // TypeError/ReferenceError — retryable (could be a transient race)
  | "unknown";            // unclassified — retryable, normal backoff (legacy behavior)

export interface RetryPolicy {
  retryable: boolean;
  /** Multiplier applied on top of the base exponential backoff. */
  backoffMultiplier: number;
}

// Policy table. NON-retryable classes are the money/loop savers: they go
// straight to the dead-letter queue instead of repeating a call that cannot
// succeed. Retryable classes keep the existing exponential schedule; rate_limit
// stretches it so we don't hammer a throttled upstream.
const POLICIES: Record<FailureClass, RetryPolicy> = {
  rate_limit:          { retryable: true,  backoffMultiplier: 3 },
  network_transient:   { retryable: true,  backoffMultiplier: 1 },
  timeout:             { retryable: true,  backoffMultiplier: 1 },
  auth_expired:        { retryable: true,  backoffMultiplier: 1 },
  validation_error:    { retryable: false, backoffMultiplier: 1 },
  guardrail_blocked:   { retryable: false, backoffMultiplier: 1 },
  not_found:           { retryable: false, backoffMultiplier: 1 },
  deterministic_input: { retryable: false, backoffMultiplier: 1 },
  internal_bug:        { retryable: true,  backoffMultiplier: 1 },
  unknown:             { retryable: true,  backoffMultiplier: 1 },
};

export function retryPolicyFor(cls: FailureClass): RetryPolicy {
  return POLICIES[cls] ?? POLICIES.unknown;
}

// Ordered rules — first match wins. Order matters: the most specific /
// highest-confidence signals (explicit HTTP status, distinctive substrings)
// are checked before broader ones, and non-retryable classes are checked
// before the retryable catch-alls so a deterministic failure is never
// mis-bucketed as a transient one.
const RULES: Array<{ cls: FailureClass; test: (msg: string) => boolean }> = [
  // Rate limiting — distinct 429 / quota language.
  { cls: "rate_limit", test: (m) => /\b429\b|rate[ _-]?limit|too many requests|quota (?:exceeded|exhausted)|throttl/i.test(m) },

  // Auth — 401/403, token/key problems. Checked before not_found (403 is auth,
  // not "missing") and before validation.
  { cls: "auth_expired", test: (m) => /\b401\b|\b403\b|unauthor|forbidden|token (?:expired|invalid)|invalid api key|authenticat|credentials? (?:expired|invalid|missing)/i.test(m) },

  // Validation / bad input — 400/422, schema/zod. Deterministic.
  { cls: "validation_error", test: (m) => /\b400\b|\b422\b|validation (?:error|failed)|invalid (?:input|argument|parameter|request|payload)|malformed|zod|schema (?:error|mismatch|validation)|required (?:field|parameter)|missing required/i.test(m) },

  // Guardrail / policy / safety refusal. Deterministic.
  { cls: "guardrail_blocked", test: (m) => /guardrail|blocked by (?:policy|guard)|policy (?:violation|blocked)|content[ _-]?policy|safety (?:block|refus)|refused (?:by|due)|not (?:permitted|allowed)|disallow|tool policy/i.test(m) },

  // Not found — 404 / missing resource. Deterministic.
  { cls: "not_found", test: (m) => /\b404\b|not found|no such (?:file|object|record|row|resource)|does not exist|enoent/i.test(m) },

  // No handler / unsupported — deterministic queue-shape error.
  { cls: "deterministic_input", test: (m) => /no handler registered|unsupported (?:kind|type|operation)|unknown (?:kind|job type)|cannot parse|unparse/i.test(m) },

  // Timeout — checked before network_transient (a timed-out fetch is a timeout).
  { cls: "timeout", test: (m) => /\b504\b|timed out|timeout|deadline exceeded|etimedout|esockettimedout/i.test(m) },

  // Transient network — sockets, DNS, 502/503, gateway.
  { cls: "network_transient", test: (m) => /\b502\b|\b503\b|econnreset|econnrefused|enotfound|eai_again|epipe|socket hang up|fetch failed|network (?:error|unreachable)|bad gateway|service unavailable|connection (?:reset|refused|closed)/i.test(m) },

  // Code bug — JS runtime errors. Retryable but flagged (could be a race).
  { cls: "internal_bug", test: (m) => /typeerror|referenceerror|rangeerror|is not a function|undefined is not|cannot read propert|null is not an object/i.test(m) },
];

/**
 * Classify a raw error message into a FailureClass. Pure and side-effect free.
 * Falls back to "unknown" (retryable, normal backoff) when nothing matches, so
 * an unrecognized error behaves exactly as the queue did before this taxonomy
 * existed.
 */
export function classifyFailure(errorMsg: string | null | undefined): FailureClass {
  const msg = String(errorMsg ?? "").trim();
  if (!msg) return "unknown";
  for (const rule of RULES) {
    if (rule.test(msg)) return rule.cls;
  }
  return "unknown";
}

/** Convenience: classify and resolve the policy in one call. */
export function classifyAndPolicy(errorMsg: string | null | undefined): {
  failureClass: FailureClass;
  policy: RetryPolicy;
} {
  const failureClass = classifyFailure(errorMsg);
  return { failureClass, policy: retryPolicyFor(failureClass) };
}
