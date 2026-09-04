// R98.16 #3 — Translate opaque LLM/provider error strings into one actionable
// line for the operator. IJFW shipped this for their auditor stalls (Codex
// auth-token-expired etc.); we apply the same idea to our model-failover
// error-return path and the delegate_task error surface.
//
// Goal: replace `codex_models_manager::manager: failed to refre…` with
// "Codex auth token expired. Run `codex login` to refresh, then retry."
// — exactly one line, exactly one suggested action, no stack trace.
//
// This is purely a UX layer: callers still propagate the original error
// for log forensics, but they ALSO surface .friendly so a human (or Felix)
// can act on it without grep-trawling.

import { logSilentCatch } from "./silent-catch";
// R98.19+sec — architect HIGH fix: was `require("./sanitize-untrusted")` inside
// a `try` block, which throws "require is not defined" under "type":"module"
// and silently swallowed the error → secret redaction never ran. Static ESM
// import binds at load time so redaction is always applied.
import { redactSecrets } from "./sanitize-untrusted";

export interface TranslatedError {
  /** One-line, action-oriented message. Always populated. */
  friendly: string;
  /** Best-guess root cause category (matches model-failover FailoverReason). */
  category:
    | "rate_limit"
    | "billing"
    | "auth"
    | "auth_permanent"
    | "overloaded"
    | "timeout"
    | "model_not_found"
    | "network"
    | "format"
    | "spawn"
    | "missing_key"
    | "unknown";
  /** Optional shell command to run as a fix. */
  suggestedAction?: string;
  /** Original error string (truncated) for forensics. */
  raw: string;
}

interface Pattern {
  rx: RegExp;
  category: TranslatedError["category"];
  friendly: (m: RegExpMatchArray, raw: string) => string;
  suggestedAction?: (m: RegExpMatchArray) => string;
}

const PATTERNS: Pattern[] = [
  // Missing API keys — by far the most common stall.
  {
    rx: /(OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|DEEPSEEK_API_KEY|OPENROUTER_API_KEY|XAI_API_KEY|PERPLEXITY_API_KEY|ELEVENLABS_API_KEY|STRIPE_SECRET_KEY|FAL_KEY)\b.*\b(?:not\s+set|missing|undefined|empty|required)/i,
    category: "missing_key",
    friendly: (m) => `Missing API key: ${m[1]} is not set in this environment. Add it via the secrets manager and restart.`,
    suggestedAction: (m) => `# set ${m[1]} in Replit Secrets, then restart workflow`,
  },
  {
    rx: /\b(401|403)\b.*(unauthorized|forbidden|invalid api key|invalid_api_key|incorrect api key|authentication)/i,
    category: "auth_permanent",
    friendly: () => `Auth rejected (401/403). The provider says the API key is invalid or revoked. Rotate the key in Replit Secrets.`,
    suggestedAction: () => `# rotate the relevant *_API_KEY secret, then restart`,
  },
  {
    rx: /\b(401|403)\b/,
    category: "auth",
    friendly: (_m, raw) => `Auth failure: provider returned 401/403. Likely an expired or stale token. (raw: ${truncate(raw, 80)})`,
  },
  // Rate limit / quota.
  {
    rx: /\b429\b|rate[_ ]?limit|too many requests|quota exceeded|resource[_ ]exhausted|tokens? per (?:minute|day)/i,
    category: "rate_limit",
    friendly: (_m, raw) => `Rate-limited by provider. Failover should switch model automatically. If persistent, you've hit a daily/monthly quota. (raw: ${truncate(raw, 80)})`,
  },
  // Billing.
  {
    rx: /billing|insufficient.*(?:credit|balance|funds)|payment.*required|account.*suspend|exceeded.*(?:budget|spend)/i,
    category: "billing",
    friendly: () => `Billing issue: provider says the account is out of credit / suspended / over budget. Top up or move to fallback model.`,
  },
  // Overloaded.
  {
    rx: /\b(503|529)\b|overload|service[_ ]unavailable|server.*busy|temporarily unavailable/i,
    category: "overloaded",
    friendly: () => `Provider is overloaded (503/529). Failover should retry on a different provider; if all are red, wait 30-60s.`,
  },
  // Timeout.
  {
    rx: /\b(?:request|operation|call|connect)\s*timed?\s*out\b|\bETIMEDOUT\b|exceeded.*timeout|timeout.*ms/i,
    category: "timeout",
    friendly: (_m, raw) => `Request timed out. The model may be slow or the network may be flaky; retry once before assuming it's broken. (raw: ${truncate(raw, 80)})`,
  },
  // DNS / network.
  {
    rx: /\bENOTFOUND\b|\bgetaddrinfo\b|DNS lookup|EAI_AGAIN/i,
    category: "network",
    friendly: () => `Network/DNS failure (ENOTFOUND). Either the provider hostname is wrong or this container has no outbound DNS. Check the URL and the network policy.`,
  },
  {
    rx: /\bECONN(?:RESET|REFUSED|ABORTED)\b|socket hang up|read ECONNRESET/i,
    category: "network",
    friendly: (_m, raw) => `Network drop (${(raw.match(/ECONN\w+/) || ["ECONN"])[0]}). Provider closed the socket mid-request; retry safely. (raw: ${truncate(raw, 80)})`,
  },
  // Spawned subprocess missing.
  {
    rx: /\bspawn\s+(\S+)\s+ENOENT\b/i,
    category: "spawn",
    friendly: (m) => `Subprocess '${m[1]}' is not on PATH in this container. Either install it or remove the call site.`,
    suggestedAction: (m) => `# install '${m[1]}' (e.g. nix-env / npm i -g) or remove the call`,
  },
  // Model not found.
  {
    rx: /\bmodel.*(?:not\s*found|does not exist|invalid model|unknown model|deprecated)\b/i,
    category: "model_not_found",
    friendly: (_m, raw) => `Model not recognized by the provider. Check the model id or pick a current one from MODEL_REGISTRY. (raw: ${truncate(raw, 80)})`,
  },
  // Schema / JSON.
  {
    rx: /JSON.*parse|invalid json|unexpected token|schema.*(?:invalid|fail)|validation (?:failed|error)/i,
    category: "format",
    friendly: () => `Output failed JSON/schema validation. The model returned prose or malformed JSON; lower temperature or strengthen the schema prompt.`,
  },
];

function truncate(s: string, n: number): string {
  if (typeof s !== "string") return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Translate any error (string, Error, or unknown) into a structured,
 * action-oriented summary. Pure / cheap — safe to call on every error.
 */
export function translateLlmError(err: unknown): TranslatedError {
  const rawDirty = (() => {
    if (!err) return "";
    if (err instanceof Error) return err.message || String(err);
    if (typeof err === "string") return err;
    try { return JSON.stringify(err).slice(0, 500); } catch { return String(err); }
  })();
  // R98.16+sec — architect CRITICAL fix: provider error strings can contain
  // request-header / request-body fragments with raw API keys (some HTTP
  // clients echo the auth header into the thrown message on a 401). Redact
  // ALL known secret literals before embedding `raw` into either `friendly`
  // or the returned `.raw` field. redactSecrets is best-effort string
  // replacement against process.env values; it cannot redact a key value
  // that doesn't live in our env, but it closes the by-far-most-likely
  // leak path (our own keys round-tripping through a provider error).
  let raw: string;
  try {
    raw = redactSecrets(rawDirty);
  } catch (_silentErr) {
    // Fail closed: if redactor itself throws, drop to a placeholder rather
    // than echoing potentially-secret-bearing rawDirty.
    logSilentCatch("server/lib/translate-llm-error.ts", _silentErr);
    raw = "[error message redacted: redactor unavailable]";
  }
  if (!raw) {
    return { friendly: "Unknown error (no message).", category: "unknown", raw: "" };
  }
  for (const p of PATTERNS) {
    const m = raw.match(p.rx);
    if (m) {
      return {
        friendly: p.friendly(m, raw),
        category: p.category,
        suggestedAction: p.suggestedAction ? p.suggestedAction(m) : undefined,
        raw: truncate(raw, 500),
      };
    }
  }
  return { friendly: `Unhandled error class. (raw: ${truncate(raw, 160)})`, category: "unknown", raw: truncate(raw, 500) };
}

/**
 * Convenience: format as a single line suitable for chat / log surfaces.
 */
export function formatTranslated(t: TranslatedError): string {
  return t.suggestedAction
    ? `${t.friendly}  Fix: ${t.suggestedAction}`
    : t.friendly;
}
