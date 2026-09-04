/**
 * repo-surgeon-guards.ts — extracted from repo-surgeon.ts (Task 104 girth split,
 * 2026-07-31; mechanical move, zero behavior change). The GUARD & SURFACE
 * DETECTION cluster of the Repo Surgeon autopilot: the out-of-band diff-content
 * weakener scan, the sensitive / HARD-HITL / security-core surface classifiers,
 * the symlink-proof hard-zone resolver, and the audit-autofix caps + mandatory
 * security regression suite. All pure (fs is read-only realpath resolution),
 * exported for unit tests. repo-surgeon.ts re-exports the public names so
 * existing importers are unchanged.
 */

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { logSilentCatch } from "../lib/silent-catch";
import type { FixProposal } from "./repo-surgeon";

/** Normalize a repo-relative path for textual scope comparison (slashes, ./, //). */
export function normRepoPath(p: string): string {
  return String(p ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

// ─────────────────────────────────────────────────────────────────────────────
// Guard invariant — out-of-band diff CONTENT scan (complements the path denylist)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lines ADDED by the diff that would silence/disable a check. Matched against
 * the `replace` side of each edit (and new-file content).
 */
const ADDED_WEAKENER_RE = [
  /@ts-nocheck/i,
  /@ts-ignore/i,
  /eslint-disable/i,
  /istanbul ignore/i,
  /\bxit\s*\(|\bxdescribe\s*\(|\bxtest\s*\(/, // disabled tests
  /\b(it|test|describe|context)\s*\.\s*skip\s*\(/, // .skip(...)
  /\b(it|test|describe)\s*\.\s*only\s*\(/, // .only narrows the suite to hide others
  /\bassert\s*\.\s*ok\s*\(\s*true\s*\)/, // assert.ok(true) — a no-op pass
  /\bexpect\s*\(\s*true\s*\)\s*\.\s*to/i,
  /\breturn\s+true\s*;?\s*\/\/.*(bypass|skip|disable|temp)/i,
  /BWB_VOICE_OVERRIDE_OK|JURY_AUTOAPPLY\s*=\s*1|STRICT_TENANT_SCOPE\s*=\s*(0|false|off)/i,
] as const;

/**
 * Guard / safety / test constructs whose REMOVAL weakens a check. Matched
 * against the `find` side of each edit: a token present in `find` but absent
 * from `replace` means the diff deleted that guard.
 */
const REMOVED_GUARD_RE = [
  /\benforceToolPolicy\b/,
  /\benforceSafetyRouting\b/,
  /\btouchesProtectedSurface\b/,
  /\bguardFiredCorrectly\b/,
  /\bdetectRefusal\b/,
  /\brequire(s)?Approval\b/i,
  /\bcreateApproval\b/,
  /\bassertBobVoice\b/,
  /\bassertProjectInTenant\b/,
  /\bcheckRateLimit\b/,
  /\bintentGate\b/i,
  /\bsafety[_-]?profile\b/i,
  /\brestrictedCategories\b/,
  /\b(assert|expect)\b/, // a removed assertion (test weakening)
  /\bthrow\s+new\s+\w*Error\b/, // a removed guard throw
  /\btenant_?Id\b/i, // dropped tenant scoping
  /\bcsrf\b/i,
] as const;

function splitLines(s: string): string[] {
  return (s || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * OUT-OF-BAND CHECK on the diff content. Fail-closed: returns `weakened:true`
 * with reasons if the diff would disable/weaken/delete a guard, test, or safety
 * construct. Pure — exported for unit testing.
 *
 * Complements the path denylist: even when every touched file is OUTSIDE the
 * protected-surface set, a diff that strips an `enforceToolPolicy` call from
 * server/tools.ts, drops a `tenantId` WHERE clause, or adds `@ts-nocheck` to
 * silence a real type error is blocked here.
 */
export function diffWeakensGuard(proposal: FixProposal): { weakened: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const consider = (path: string, find: string, replace: string) => {
    const addedLines = splitLines(replace).filter((l) => !splitLines(find).includes(l));
    const removedLines = splitLines(find).filter((l) => !splitLines(replace).includes(l));

    for (const line of addedLines) {
      for (const re of ADDED_WEAKENER_RE) {
        if (re.test(line)) reasons.push(`${path}: adds a check-silencing construct (${re.source}) → "${line.slice(0, 120)}"`);
      }
    }
    for (const line of removedLines) {
      for (const re of REMOVED_GUARD_RE) {
        if (re.test(line)) reasons.push(`${path}: removes a guard/assertion (${re.source}) → "${line.slice(0, 120)}"`);
      }
    }
  };

  for (const e of proposal.edits || []) consider(e.path, e.find, e.replace);
  // New files can ONLY add content — scan their body for added weakeners.
  for (const nf of proposal.newFiles || []) consider(nf.path, "", nf.content);

  return { weakened: reasons.length > 0, reasons: [...new Set(reasons)] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sensitive-surface detection (auth / payments / schema / safety → HITL)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paths that require owner HITL sign-off before landing. Mirrors the
 * scripts/jury-triage.ts sensitive-path denylist (auth, payments, schema,
 * safety, secrets) but applied to the diff's TOUCHED FILES.
 */
const SENSITIVE_SURFACE_RE = [
  /(^|[\/\\])server[\/\\]auth\.ts$/i,
  /(^|[\/\\])server[\/\\]replit_integrations[\/\\]auth/i,
  /(^|[\/\\])server[\/\\]middleware[\/\\]admin/i,
  /(^|[\/\\])server[\/\\]safety[\/\\]/i,
  /(^|[\/\\])server[\/\\]safety-guard/i,
  /(^|[\/\\])server[\/\\]external-content-security/i,
  /(^|[\/\\])server[\/\\]routes[\/\\]stripe/i,
  /(^|[\/\\])server[\/\\]coinbase-commerce/i,
  /(^|[\/\\])server[\/\\]webhookHandlers/i,
  /stripe|coinbase|payment|billing|invoice|checkout/i,
  /(^|[\/\\])shared[\/\\]schema\.ts$/i,
  /(^|[\/\\])shared[\/\\]models[\/\\]auth/i,
  /(^|[\/\\])drizzle(\.config|[\/\\])/i,
  /\.env(\.|$)/i,
  /createCsrfMiddleware|csrf/i,
  // Broad aggregator files that carry auth/payment/session/tool-routing logic
  // inside one big module — a path-token denylist alone would miss them, so an
  // autofix touching them must pause for owner HITL (the gate only ever ADDS a
  // pause, so over-inclusion is fail-safe). (R125+ post-edit-review finding.)
  /(^|[\/\\])server[\/\\]routes\.ts$/i,
  /(^|[\/\\])server[\/\\]routes[\/\\]/i,
  /(^|[\/\\])server[\/\\]tools\.ts$/i,
  /(^|[\/\\])server[\/\\]chat-engine\.ts$/i,
  /(^|[\/\\])server[\/\\]replitAuth\.ts$/i,
  /(^|[\/\\])server[\/\\]guarded-tool-executor\.ts$/i,
] as const;

/** True when any touched file is a sensitive surface that needs owner sign-off. */
export function isSensitiveSurface(files: string[]): { sensitive: boolean; hits: string[] } {
  const hits: string[] = [];
  for (const f of files) {
    for (const re of SENSITIVE_SURFACE_RE) {
      if (re.test(f)) {
        hits.push(f);
        break;
      }
    }
  }
  return { sensitive: hits.length > 0, hits: [...new Set(hits)] };
}

/**
 * The HARD subset of sensitive surfaces — auth, payments, schema, safety,
 * secrets, CSRF, the guarded executor. These ALWAYS require owner sign-off and
 * are NEVER auto-applied, even for an audit-sourced tenant-isolation fix. The
 * broad app-source aggregators (server/routes/*, server/tools.ts,
 * server/chat-engine.ts) are sensitive-but-RELAXABLE when the incident is
 * audit-sourced AND env SECURITY_CORE_AUTOFIX=1 — that is where the nightly
 * tenant-isolation findings actually live.
 */
const HARD_HITL_SURFACE_RE = [
  /(^|[\/\\])server[\/\\]auth\.ts$/i,
  /(^|[\/\\])server[\/\\]replit_integrations[\/\\]auth/i,
  /(^|[\/\\])server[\/\\]replitAuth\.ts$/i,
  /(^|[\/\\])server[\/\\]middleware[\/\\]admin/i,
  /(^|[\/\\])server[\/\\]safety[\/\\]/i,
  /(^|[\/\\])server[\/\\]safety-guard/i,
  /(^|[\/\\])server[\/\\]external-content-security/i,
  /(^|[\/\\])server[\/\\]routes[\/\\]stripe/i,
  /(^|[\/\\])server[\/\\]coinbase-commerce/i,
  /(^|[\/\\])server[\/\\]webhookHandlers/i,
  /stripe|coinbase|payment|billing|invoice|checkout/i,
  /(^|[\/\\])shared[\/\\]schema\.ts$/i,
  /(^|[\/\\])shared[\/\\]models[\/\\]auth/i,
  /(^|[\/\\])drizzle(\.config|[\/\\])/i,
  /\.env(\.|$)/i,
  /createCsrfMiddleware|csrf/i,
  /(^|[\/\\])server[\/\\]guarded-tool-executor\.ts$/i,
] as const;

/** True when any touched file is a HARD sensitive surface that ALWAYS needs
 *  owner sign-off (never relaxed, even for audit-sourced autopilot). */
export function isHardHitlSurface(files: string[]): { hard: boolean; hits: string[] } {
  const hits: string[] = [];
  for (const f of files) {
    for (const re of HARD_HITL_SURFACE_RE) {
      if (re.test(f)) {
        hits.push(f);
        break;
      }
    }
  }
  return { hard: hits.length > 0, hits: [...new Set(hits)] };
}

/** Content-level HARD surface markers. Path regexes (HARD_HITL_SURFACE_RE) can't
 *  see auth / payment / schema logic that lives INSIDE a broad aggregator file
 *  (server/routes.ts, server/tools.ts, server/chat-engine.ts). Without this, an
 *  audit-sourced fix that edits auth/payment code in such a file would skip the
 *  owner HITL pause because the FILENAME doesn't match. A pure tenant-isolation
 *  fix (adds a `WHERE tenant_id` clause / ownership check) carries none of these
 *  markers, so it stays eligible for autopilot. Over-trigger = HITL = safe. */
const HARD_CONTENT_RE = [
  // payments
  /\bstripe\b/i, /\bcoinbase\b/i, /\bpayments?\b/i, /\bpaymentintent\b/i, /\bbilling\b/i,
  /\binvoice\b/i, /\bcheckout\b/i, /\bsubscriptions?\b/i, /\bprice[_]?id\b/i, /\brefunds?\b/i,
  // auth / session
  /\bpassword\b/i, /\bbcrypt\b/i, /\bhashpassword\b/i, /\bverifypassword\b/i, /\bpassport\b/i,
  /\bsetupauth\b/i, /\bisauthenticated\b/i, /\brequireauth\b/i, /\bjwt\b/i, /req\.session/i,
  /\badmin_pin\b/i, /\bsession_secret\b/i, /\bhitl_token_secret\b/i,
  // schema DDL
  /\balter\s+table\b/i, /\bdrop\s+(table|column)\b/i, /\bcreate\s+table\b/i, /\bpgtable\s*\(/i,
  // csrf / secrets
  /\bcsrf\b/i, /process\.env\.[a-z0-9_]*(secret|token|key|pin)\b/i,
] as const;

/** True when the PROPOSED EDIT CONTENT (not just the path) touches an auth /
 *  payment / schema / secret region — the in-file blind spot of the path-only
 *  HARD_HITL_SURFACE_RE. Scans each edit's anchored region (find+replace, which
 *  carries the LLM's surrounding context) plus any new-file body. */
export function proposalTouchesHardContent(proposal: FixProposal): { hard: boolean; hits: string[] } {
  const hits: string[] = [];
  const scan = (path: string, text: string) => {
    if (!text) return;
    for (const re of HARD_CONTENT_RE) {
      if (re.test(text)) hits.push(`${path}: ${re.source}`);
    }
  };
  for (const e of proposal.edits || []) scan(e.path, `${e.find}\n${e.replace}`);
  for (const nf of proposal.newFiles || []) scan(nf.path, nf.content);
  return { hard: hits.length > 0, hits: [...new Set(hits)] };
}

/**
 * SECURITY-CORE & CI surfaces — the trust pipeline that GOVERNS the autopilot
 * itself, plus the CI it runs in. A fix that edits any of these is NEVER eligible
 * for the audit-sourced relax (always owner HITL): a self-modifying autopilot
 * editing its own gates / signer / drainer / budget governor — or the
 * .github/workflows that run them — is the highest-blast-radius change there is.
 * Separate from HARD_HITL_SURFACE_RE (auth/payments/schema/secrets) so the intent
 * is legible. Matched against the REALPATH-CANONICALIZED path (resolveHardZoneTouch)
 * so a symlink / `./` / `//` alias of one of these files cannot dodge the gate.
 */
const SECURITY_CORE_SURFACE_RE = [
  /(^|[\/\\])\.github[\/\\]workflows[\/\\]/i,                       // CI render/deploy farm
  /(^|[\/\\])server[\/\\]agentic[\/\\]repo-surgeon\.ts$/i,         // the autopilot itself
  /(^|[\/\\])server[\/\\]agentic[\/\\]jury-queue-integrity\.ts$/i, // the queue signer/verifier
  /(^|[\/\\])server[\/\\]agentic[\/\\]autonomous-budget\.ts$/i,    // the spend governor
  /(^|[\/\\])server[\/\\]agentic[\/\\]repair-incident\.ts$/i,      // the capture/route seam
  /(^|[\/\\])server[\/\\]agentic[\/\\]escalation-resolver\.ts$/i,  // the HITL escalation path
  /(^|[\/\\])scripts[\/\\]drain-jury-queue\.ts$/i,                 // the drainer
  /(^|[\/\\])scripts[\/\\]jury-triage\.ts$/i,                      // a queue producer
  /(^|[\/\\])scripts[\/\\]agentic-ci-self-heal\.ts$/i,             // a queue producer
  /(^|[\/\\])scripts[\/\\]tenant-isolation-audit\.ts$/i,           // the audit producer
  /(^|[\/\\])tests[\/\\]security[\/\\]/i,                          // the safety regression suite
  /(^|[\/\\])tests[\/\\]storage[\/\\]/i,                           // the tenant-isolation suite
] as const;

const OUTSIDE_REPO_SENTINEL = "\u0000OUTSIDE_REPO";

/** Walk up from a (possibly not-yet-existent) absolute path to the nearest
 *  EXISTING ancestor dir, realpath that ancestor (resolving symlinks), then
 *  re-append the un-resolved tail. Lets a path the proposal would CREATE still get
 *  its PARENT symlinks resolved — the symlink-evasion vector for new files. */
function resolveViaExistingAncestor(abs: string): string {
  const parts: string[] = [];
  let cur = abs;
  while (true) {
    const parent = nodePath.dirname(cur);
    if (parent === cur) break; // reached fs root
    parts.unshift(nodePath.basename(cur));
    try {
      const realParent = nodeFs.realpathSync(parent);
      return nodePath.join(realParent, ...parts);
    } catch {
      cur = parent;
    }
  }
  return abs;
}

/** Canonicalize a proposal-supplied (UNTRUSTED) path to a repo-relative form with
 *  ALL symlinks resolved. Returns OUTSIDE_REPO_SENTINEL if it escapes repoRoot
 *  (forces "hard"). The realpath resolution is what makes the hard-zone gate
 *  symlink-proof — the textual HARD_HITL_SURFACE_RE alone could be dodged by a
 *  symlink alias to a protected file. */
function canonicalRepoPath(repoRoot: string, p: string): string {
  const abs = nodePath.resolve(repoRoot, String(p ?? ""));
  let real: string;
  try {
    real = nodeFs.realpathSync(abs);
  } catch {
    real = resolveViaExistingAncestor(abs); // new file — resolve existing ancestors
  }
  let realRoot = repoRoot;
  try { realRoot = nodeFs.realpathSync(repoRoot); } catch (_silentErr) { logSilentCatch("server/agentic/repo-surgeon.ts", _silentErr); }
  const rel = nodePath.relative(realRoot, real);
  if (!rel || rel.startsWith("..") || nodePath.isAbsolute(rel)) return OUTSIDE_REPO_SENTINEL;
  return normRepoPath(rel);
}

/**
 * HIGH-3 closure (fable-5 review of R125+52.9): classify the relax gate on the
 * RESOLVED EFFECTS of a proposal, not only on an evadable content denylist. Every
 * touched path is realpath-canonicalized (symlinks + `./`/`//` aliases collapsed,
 * out-of-repo escapes sentinelled) and matched against the HARD path surfaces
 * (auth/payments/schema/secrets) PLUS the SECURITY-CORE/CI surfaces (the autopilot's
 * own gates + the CI that runs them). ANY hit ⇒ hard ⇒ owner HITL, regardless of
 * the diff's phrasing — closing the gap where a rename / symlink / encoding dodged
 * the path-text or content-text checks. proposalTouchesHardContent() stays as an
 * ADDITIVE signal (it can only ever ADD a pause). Does read-only fs (realpathSync);
 * the CALLER wraps it in try/catch and treats a throw as hard (fail closed).
 */
export function resolveHardZoneTouch(
  touched: string[],
  repoRoot: string = process.cwd(),
): { hard: boolean; hits: string[] } {
  const hits: string[] = [];
  for (const raw of touched || []) {
    let canon: string;
    try {
      canon = canonicalRepoPath(repoRoot, raw);
    } catch {
      hits.push(`${raw}: unresolvable`); // fail closed per-path
      continue;
    }
    if (canon === OUTSIDE_REPO_SENTINEL) {
      hits.push(`${raw}: resolves outside repo`);
      continue;
    }
    for (const re of [...HARD_HITL_SURFACE_RE, ...SECURITY_CORE_SURFACE_RE]) {
      if (re.test(canon)) {
        hits.push(canon);
        break;
      }
    }
  }
  return { hard: hits.length > 0, hits: [...new Set(hits)] };
}

/** Max files an audit-sourced fix may touch and still skip the HITL pause. A
 *  legitimate single missing-WHERE-clause / ownership-check fix is tiny; a
 *  sprawling diff is suspicious and falls back to owner sign-off. */
export const AUDIT_AUTOFIX_MAX_FILES = Math.max(1, Number(process.env.AUDIT_AUTOFIX_MAX_FILES) || 3);

/** The MANDATORY regression suite gating any audit-sourced security-core fix
 *  before it lands without a human — the tenant-isolation + AHB + tool-policy
 *  tests that would catch a fix that compiles but breaks isolation/safety. */
export const SECURITY_REGRESSION_SUITE = [
  "tests/security/ahb-regression.test.ts",
  "tests/security/rls-isolation.test.ts",
  "tests/security/delivery-tenant-isolation.test.ts",
  "tests/security/tenant-checkout-isolation.test.ts",
  "tests/security/anonymous-checkout-isolation.test.ts",
  "tests/security/tool-policy-enforcement.test.ts",
  "tests/security/auth-bypass-probe.test.ts",
  "tests/storage/tenant-isolation.test.ts",
  "tests/storage/tenant-scope.test.ts",
  "tests/storage/tenant-context.test.ts",
];
