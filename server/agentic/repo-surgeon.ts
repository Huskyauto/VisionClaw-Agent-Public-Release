/**
 * repo-surgeon.ts — Repo Surgeon Task #52
 *
 * The GUARDED CODE-FIX EXECUTOR. The missing self-repair loop: take an incident
 * the #51 classifier routed to `repo_surgeon` (a genuine code defect), diagnose
 * the root cause in real source, write a minimal diff that mirrors house
 * patterns, verify it for real (typecheck + targeted tests + golden-path replay
 * + re-running the failed job), and LAND it on green or ROLL BACK cleanly on red.
 * It is ONE guarded executor that every detector routes into — not a fourth
 * parallel self-repair system.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HARD INVARIANTS (non-negotiable — task #52 / replit.md AHB):
 *  1. NEVER make a check pass by weakening, disabling, or deleting a guard,
 *     test, or safety profile. Enforced TWICE, fail-closed:
 *       (a) PATH DENYLIST — re-run `enforceSafetyRouting()` from the #51
 *           classifier with the ACTUAL diff's touched files (the apply-time
 *           contract documented at repair-incident.ts:356). If the would-be fix
 *           touches a test/guard/safety surface, it escalates — never applies.
 *       (b) OUT-OF-BAND DIFF SCAN — `diffWeakensGuard()` inspects the diff
 *           CONTENT (not just paths): removed assertions/guard calls, added
 *           `.skip`/`@ts-nocheck`/`eslint-disable`, dropped tenant scoping, etc.
 *           Any hit escalates. This catches a guard weakened INSIDE a
 *           non-protected file, which the path denylist alone would miss.
 *  2. SENSITIVE SURFACES (auth / payments / schema / safety) PAUSE for owner
 *     HITL sign-off before landing — the diff is produced and guard-checked,
 *     then an approval is opened and the executor stops (a Resume task applies
 *     it after sign-off). It never auto-merges a sensitive surface.
 *  3. AFTER TWO FAILED FIX ATTEMPTS on the same incident, STOP — summarize and
 *     escalate rather than loop (mirrors the replit.md 2-failed-corrections
 *     rule). The cap is durable (counted from `repo_surgeon_attempts`) so it
 *     holds across separate executor invocations, not just the in-process loop.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The pure decision helpers (`touchedFilesFromProposal`, `runGuardInvariant`,
 * `diffWeakensGuard`, `isSensitiveSurface`, `attemptBudget`,
 * `buildVerificationPlan`) are exported and side-effect-free so they can be
 * unit-tested without a DB, the LLM, or a shell — mirroring the #51 classifier's
 * pure/stateful split. `runRepoSurgeon()` is the stateful orchestrator; every
 * heavy dependency is injectable (defaults wire the real LLM / fs / shell / DB)
 * so the loop is fully testable with stubs.
 *
 * Untrusted-input note (replit.md): an incident's text and the LLM's diff
 * proposal are UNTRUSTED. The executor never builds a shell string from them —
 * verification runs via `spawnSync` with argv arrays (no shell), test targets
 * are validated against a strict path allowlist, and the "re-run the failed job"
 * step re-invokes the failed TOOL through the guarded executor, never an
 * arbitrary command.
 */

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { logSilentCatch } from "../lib/silent-catch";
import {
  PriorCollapseTracker,
  type PriorCollapseLike,
  renderFixProposalText,
  buildPerturbationDirective,
  safeCollapseCheck,
  safeCollapseRemember,
} from "../lib/prior-collapse";
// (verification subprocess env is built from a strict allowlist below, not sanitizeSpawnEnv)
import {
  enforceSafetyRouting,
  touchesProtectedSurface,
  type RawIncident,
  type ClassificationResult,
} from "./repair-incident";

// After this many failed attempts on the SAME incident, stop + escalate.
export const MAX_FIX_ATTEMPTS = 2;
// Per-tenant hourly ceiling — defence-in-depth against a runaway loop (mirrors
// the runtime self-heal limiter). The 2-attempt-per-incident cap is the primary
// stop; this is a coarse backstop.
export const MAX_FIXES_PER_TENANT_PER_HOUR = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A single find/replace edit — the executor's diff representation. `find` must
 *  match the existing file content EXACTLY and occur exactly once. */
export interface FileEdit {
  path: string;
  find: string;
  replace: string;
}

export interface NewFile {
  path: string;
  content: string;
}

/**
 * A before/after content snapshot of one file the fix edited (Task #65). Stored
 * at land time so the revert is a deterministic, full-content restore rather than
 * a fragile reverse find/replace — this is the ONLY shape that can correctly undo
 * a deletion edit (`replace === ""`) and detect a stale tree before clobbering it.
 */
export interface RevertFileSnapshot {
  path: string;
  /** Content before the fix touched this path — what revert restores. */
  before: string;
  /** Content after the fix — revert refuses if the live file no longer matches. */
  after: string;
}

/** The deterministic undo plan for a landed fix (Task #65). */
export interface RevertPlan {
  /** Edited files, restored to `before` iff the live file still equals `after`. */
  files: RevertFileSnapshot[];
  /** Files the fix created, deleted iff the live file still equals `content`. */
  createdFiles: NewFile[];
}

/** The LLM's structured fix proposal (the "minimal diff" + its rationale). */
export interface FixProposal {
  diagnosis: string;
  rootCause: string;
  /** The existing pattern/precedent being mirrored (not a one-off invention). */
  precedent: string;
  edits: FileEdit[];
  newFiles?: NewFile[];
  /** Test files the executor should run to verify (validated before use). */
  targetedTests?: string[];
  /** Set true when the model itself judged it cannot safely produce a fix. */
  cannotFix?: boolean;
  /**
   * Fable-method borrow (spec-vs-test authority rule): true when the proposer
   * judged the FAILING TEST itself contradicts the documented spec / house
   * pattern / code intent. The surgeon must NEVER "fix" correct code to satisfy
   * a wrong test — this surfaces the conflict for human/escalation review.
   */
  specTestConflict?: boolean;
  confidence?: number;
}

/** What a detector hands the executor (a #51 code-defect incident). */
export interface RepoSurgeonIncident {
  incidentId?: number | null;
  tenantId: number;
  title?: string;
  error?: string;
  errorStack?: string;
  logs?: string;
  stage?: string;
  /** Files implicated by the failure (from the #51 record). */
  candidateFiles?: string[];
  /** Files changed in the repo in the last 72h (broad fixer context). */
  recentChanges?: string[];
  /** Runtime tool that failed — used to re-run the failed job on verify. */
  lastToolName?: string;
  lastToolArgs?: any;
  /** Explicit test files to run (else inferred from touched files). */
  targetedTests?: string[];
  /** Opt-in to the (cost-bearing) golden-path replay verification step. */
  runGoldenPath?: boolean;
  /**
   * Audit-sourced autopilot signal (set ONLY by the tenant-isolation audit, via
   * the jury queue → captureIncident). Lets this incident skip the owner-HITL
   * pause for a NON-hard sensitive surface — gated again by env
   * SECURITY_CORE_AUTOFIX and a small blast radius. Also forces the full
   * security regression suite into the verification plan. The cardinal-sin
   * guards (runGuardInvariant) are unaffected and still run.
   */
  securityCoreAllowed?: boolean;
  metadata?: any;
}

export type RepoSurgeonOutcome =
  | "landed" // verified all-green, change left in the working tree to push
  | "rolled_back" // a verification step went red; reverted cleanly
  | "blocked_guard_invariant" // would weaken a guard/test/safety surface — refused
  | "awaiting_hitl" // sensitive surface — owner sign-off requested, not applied
  | "stopped_attempt_limit" // 2 failed attempts already — stopped + escalated
  | "rate_limited"
  | "diagnosis_failed" // LLM could not produce a usable proposal
  | "no_fix_proposed"; // model declined / empty diff

/**
 * Terminal outcomes that count toward the durable two-failed-attempts stop
 * (hard-invariant #3). Spans BOTH "we tried and it went red" (rolled_back),
 * "we refused" (blocked_guard_invariant), AND "we couldn't even produce a
 * usable fix" (diagnosis_failed / no_fix_proposed) — otherwise a proposer that
 * keeps declining could be re-invoked forever on the same incident without ever
 * hitting the global stop. HITL pause + rate-limit are NOT failures.
 */
export const FAILED_OUTCOMES: RepoSurgeonOutcome[] = [
  "rolled_back",
  "blocked_guard_invariant",
  "diagnosis_failed",
  "no_fix_proposed",
];

export interface VerificationStepResult {
  name: string;
  ok: boolean;
  output: string;
}

export interface VerificationReport {
  ok: boolean;
  steps: VerificationStepResult[];
}

export interface RepoSurgeonResult {
  outcome: RepoSurgeonOutcome;
  /** Number of fix attempts this invocation actually ran. */
  attempts: number;
  diagnosis?: string;
  rootCause?: string;
  touchedFiles?: string[];
  verification?: VerificationReport;
  /** The find/replace edits that were applied (present on a `landed` outcome) —
   *  the actual diff, surfaced so an owner notification can show what changed. */
  edits?: FileEdit[];
  /** New files created by the fix (present on a `landed` outcome). */
  newFiles?: NewFile[];
  /** Deterministic before/after undo plan (present on a `landed` outcome) — the
   *  data the owner's one-click revert (Task #65) replays to safely undo. */
  revertPlan?: RevertPlan;
  /** Guard-block / sensitive-surface / escalation reasons. */
  reasons: string[];
  escalated: boolean;
  reason: string;
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
const AUDIT_AUTOFIX_MAX_FILES = Math.max(1, Number(process.env.AUDIT_AUTOFIX_MAX_FILES) || 3);

/** The MANDATORY regression suite gating any audit-sourced security-core fix
 *  before it lands without a human — the tenant-isolation + AHB + tool-policy
 *  tests that would catch a fix that compiles but breaks isolation/safety. */
const SECURITY_REGRESSION_SUITE = [
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

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/** All repo-relative paths the proposal would touch (edits + new files). */
export function touchedFilesFromProposal(proposal: FixProposal): string[] {
  const files = [
    ...(proposal.edits || []).map((e) => e.path),
    ...(proposal.newFiles || []).map((n) => n.path),
  ].filter(Boolean);
  return [...new Set(files)];
}

/** Normalize a repo-relative path for textual scope comparison (slashes, ./, //). */
export function normRepoPath(p: string): string {
  return String(p ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

/**
 * SCOPE PIN (fail-closed) for the audit-sourced autopilot relax: every touched
 * file MUST be inside the producer-pinned `candidateFiles` (the finding's own
 * target). An empty/absent pin OR any out-of-scope touched file ⇒ `false` ⇒ the
 * relax is denied and the fix falls back to owner HITL. Closes the gap where a
 * finding in file A could yield a proposal silently editing unrelated non-hard
 * files B/C and still skip sign-off. Pure; textual-path only (symlink/realpath
 * canonicalization tracked as a follow-up). Throws are the CALLER's job to catch
 * and treat as out-of-scope.
 */
export function isWithinPinnedScope(touched: string[], candidateFiles?: string[]): boolean {
  if (!Array.isArray(touched) || touched.length === 0) return false;
  const pinned = new Set((candidateFiles || []).map(normRepoPath));
  if (pinned.size === 0) return false;
  return touched.every((f) => pinned.has(normRepoPath(f)));
}

/** Repo-relative roots the surgeon is ever allowed to mutate. */
const ALLOWED_WRITE_ROOTS = ["server/", "shared/", "client/", "scripts/", "tests/"];

/**
 * A proposal file path is safe to apply only if it is a repo-relative path
 * under an allowed root, with no traversal or absolute targeting. The proposal
 * is model-generated from untrusted incident text, so paths must be validated
 * before ANY fs touch (path-traversal / out-of-repo write containment). Pure.
 */
export function isSafeRepoPath(p: string): boolean {
  if (typeof p !== "string" || !p) return false;
  if (p.includes("\0")) return false; // null byte
  if (p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\")) return false; // absolute / drive / UNC
  if (p.includes("..")) return false; // traversal
  // Normalize separators, collapse "./", then re-check it stays under a root.
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  if (norm.startsWith("/") || norm.includes("..")) return false;
  return ALLOWED_WRITE_ROOTS.some((root) => norm.startsWith(root));
}

/**
 * THE guard invariant. Runs BOTH halves of hard-invariant #1, fail-closed:
 *   (a) path denylist via the #51 `enforceSafetyRouting` apply-time contract
 *   (b) out-of-band diff-content scan via `diffWeakensGuard`
 * Returns `ok:false, escalate:true` (with reasons) if EITHER trips. Pure.
 */
export function runGuardInvariant(
  incident: RepoSurgeonIncident,
  proposal: FixProposal,
): { ok: boolean; escalate: boolean; reasons: string[] } {
  const touched = touchedFilesFromProposal(proposal);
  const reasons: string[] = [];

  // (0) Path containment — the proposal is model-generated from untrusted
  //     incident text. Reject ANY path that escapes the repo (traversal /
  //     absolute) or falls outside an allowed write root, BEFORE any other
  //     check or fs touch. Fail-closed + escalate.
  const unsafePaths = touched.filter((f) => !isSafeRepoPath(f));
  if (unsafePaths.length > 0) {
    reasons.push(
      `Diff targets path(s) outside the allowed repo roots (${unsafePaths.join(", ")}) — path-traversal / out-of-repo writes are forbidden.`,
    );
  }

  // (a) Path denylist — re-run the classifier's authoritative gate with the
  //     ACTUAL diff files populated (apply-time contract, repair-incident.ts:356).
  const raw: RawIncident = {
    tenantId: incident.tenantId,
    source: "runtime_self_heal",
    error: incident.error,
    candidateFiles: touched,
  };
  const candidate: ClassificationResult = {
    classification: "code_defect",
    confidence: 0.8,
    reason: "Repo Surgeon apply-time re-check",
    routedTo: "repo_surgeon",
    classifiedBy: "heuristic",
    safetyBlockedAutofix: false,
  };
  const enforced = enforceSafetyRouting(raw, candidate);
  if (enforced.routedTo !== "repo_surgeon") {
    const offending = touched.filter((f) => touchesProtectedSurface({ tenantId: incident.tenantId, source: "runtime_self_heal", candidateFiles: [f] }));
    reasons.push(
      `Diff touches a protected test/guard/safety surface (${offending.join(", ") || "see error text"}) — the path denylist forbids auto-fixing it.`,
    );
  }

  // (b) Out-of-band content scan — catches a guard weakened inside a
  //     non-protected file (the path denylist alone would miss this).
  const oob = diffWeakensGuard(proposal);
  if (oob.weakened) reasons.push(...oob.reasons);

  const ok = reasons.length === 0;
  return { ok, escalate: !ok, reasons };
}

/**
 * Two-failed-attempts stop. Given the count of prior failed/rolled-back attempts
 * on this incident, decide whether a new attempt may proceed. Pure.
 */
export function attemptBudget(priorFailedAttempts: number): { blocked: boolean; remaining: number } {
  const remaining = Math.max(0, MAX_FIX_ATTEMPTS - priorFailedAttempts);
  return { blocked: remaining <= 0, remaining };
}

/** A test target is runnable only if it's a real-looking repo test path with no
 *  shell metacharacters (untrusted-input safety — these feed spawnSync argv). */
export function isSafeTestTarget(p: string): boolean {
  if (typeof p !== "string" || !p) return false;
  if (/[;&|`$(){}<>*?!\s\\]/.test(p)) return false; // no shell metachars / spaces
  if (p.includes("..")) return false; // no traversal
  if (p.startsWith("/")) return false; // repo-relative only
  return /^(tests|test|server|client|shared|scripts)\/[\w./-]+\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
}

/**
 * Build the ordered verification plan: typecheck → targeted tests →
 * golden-path replay (opt-in) → re-run the failed job. Pure description; the
 * runner (`runVerification`) executes it. Test targets default to ones inferred
 * from the touched files when the incident/proposal didn't specify any.
 */
export function buildVerificationPlan(
  incident: RepoSurgeonIncident,
  proposal: FixProposal,
): { typecheck: boolean; tests: string[]; goldenPath: boolean; rerunTool: string | null } {
  const declared = [...(incident.targetedTests || []), ...(proposal.targetedTests || [])];
  let tests = declared.filter(isSafeTestTarget);
  if (tests.length === 0) {
    // Infer "<area>.test.ts" candidates from touched source basenames.
    const bases = touchedFilesFromProposal(proposal)
      .map((f) => f.split("/").pop()?.replace(/\.[cm]?[jt]sx?$/, ""))
      .filter(Boolean) as string[];
    tests = bases
      .flatMap((b) => [`tests/unit/${b}.test.ts`, `tests/integration/${b}.test.ts`])
      .filter(isSafeTestTarget);
  }
  // Audit-sourced security-core fix → the full tenant-isolation + safety
  // regression suite is a MANDATORY gate before it can land without a human.
  if (incident.securityCoreAllowed === true) {
    tests = [...SECURITY_REGRESSION_SUITE.filter(isSafeTestTarget), ...tests];
  }
  return {
    typecheck: true,
    tests: [...new Set(tests)],
    goldenPath: incident.runGoldenPath === true,
    rerunTool: incident.lastToolName || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Injectable dependencies (defaults wire the real LLM / fs / shell / DB)
// ─────────────────────────────────────────────────────────────────────────────

export interface RepoSurgeonDeps {
  /** Produce a fix proposal from the incident (+ prior failure feedback). */
  propose: (incident: RepoSurgeonIncident, priorFailure: string | null, attempt: number) => Promise<FixProposal | null>;
  /** Read a source file (repo-relative). Throws if missing. */
  readFile: (path: string) => string;
  /** Write a source file (repo-relative). */
  writeFile: (path: string, content: string) => void;
  /** Delete a file (rollback of a created new file). */
  deleteFile: (path: string) => void;
  /** True if a file exists. */
  exists: (path: string) => boolean;
  /** Run a verification command via argv (no shell). ok = exit 0. */
  runCommand: (cmd: string, args: string[], timeoutMs: number) => { ok: boolean; output: string };
  /** Re-run the failed tool through the guarded executor. */
  rerunTool: (toolName: string, args: any, tenantId: number) => Promise<{ ok: boolean; output: string }>;
  /** Count prior failed/rolled-back attempts for an incident. */
  countPriorFailedAttempts: (tenantId: number, incidentId: number | null) => Promise<number>;
  /** Count fixes attempted this hour for a tenant (rate-limit backstop). */
  countFixesThisHour: (tenantId: number) => Promise<number>;
  /** Persist one attempt record. Returns the row id (or null on failure). */
  recordAttempt: (row: {
    tenantId: number;
    incidentId: number | null;
    attemptNumber: number;
    diagnosis: string;
    rootCause: string;
    touchedFiles: string[];
    outcome: RepoSurgeonOutcome;
    outcomeDetail: any;
    escalated: boolean;
  }) => Promise<number | null>;
  /** Open an owner HITL approval (sensitive surface). */
  requestApproval: (params: { tenantId: number; question: string; context: any }) => Promise<void>;
  /** Emit an escalation event onto the attention bus. */
  escalate: (params: { tenantId: number; incidentId: number | null; reason: string; data: any }) => Promise<void>;
  /**
   * Prior-collapse detector (arXiv:2603.23420): flags a proposal semantically
   * near-identical to a prior FAILED attempt so the loop perturbs instead of
   * re-verifying a proven-failed diff. OPTIONAL — when absent (hermetic
   * tests), detection is off and the loop behaves exactly as before.
   * defaultDeps() wires the real embedding-backed tracker (env-gated by
   * PRIOR_COLLAPSE, fail-open internally).
   */
  collapseTracker?: PriorCollapseLike;
  /**
   * Metered escalation valve (Anvil borrow, verdict 2026-07-17): on a detected
   * stall (prior-collapse), spend exactly ONE frontier diagnostic turn —
   * judgment only, no diff — and feed it back into the next CHEAP propose
   * call. Capped at one fire per invocation. OPTIONAL + fail-open: absent or
   * throwing ⇒ the loop behaves exactly as before (perturbation directive only).
   */
  fireValve?: (incident: RepoSurgeonIncident, stallContext: string) => Promise<import("./escalation-valve").ValveDiagnosis | null>;
}

const PER_STEP_TIMEOUT_MS = 8 * 60 * 1000;

function defaultDeps(): RepoSurgeonDeps {
  return {
    propose: async (incident, priorFailure, attempt) => {
      const { proposeFix } = await import("./repo-surgeon-llm");
      return proposeFix(incident, priorFailure, attempt);
    },
    readFile: (p) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs") as typeof import("node:fs");
      return fs.readFileSync(p, "utf8");
    },
    writeFile: (p, c) => {
      const fs = require("node:fs") as typeof import("node:fs");
      fs.writeFileSync(p, c);
    },
    deleteFile: (p) => {
      const fs = require("node:fs") as typeof import("node:fs");
      try { fs.unlinkSync(p); } catch (e) { logSilentCatch("server/agentic/repo-surgeon.ts", e); }
    },
    exists: (p) => {
      const fs = require("node:fs") as typeof import("node:fs");
      return fs.existsSync(p);
    },
    runCommand: (cmd, args, timeoutMs) => {
      const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
      // Untrusted-input hardening: verification runs LLM-PROPOSED code (newFiles
      // + targetedTests) — a poisoned proposal's test could exfiltrate secrets if
      // it inherited the ambient env. Stripping loader-hijack vectors alone is not
      // enough (credentials would still pass through), so build a STRICT allowlist:
      // just enough for tsc + `node --test` (PATH/HOME/tmp/locale), with ZERO
      // provider tokens / DB / session secrets. argv form already prevents shell
      // injection; cwd is pinned.
      const verifyEnv: NodeJS.ProcessEnv = {};
      for (const k of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "NODE_ENV", "LANG", "LC_ALL", "SHELL", "TERM"]) {
        if (process.env[k] !== undefined) verifyEnv[k] = process.env[k];
      }
      const verifyHome = verifyEnv.HOME || "/home/runner";
      verifyEnv.XDG_CONFIG_HOME = verifyEnv.XDG_CONFIG_HOME || `${verifyHome}/.config`;
      verifyEnv.XDG_CACHE_HOME = verifyEnv.XDG_CACHE_HOME || `${verifyHome}/.cache`;
      const r = spawnSync(cmd, args, {
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: verifyEnv,
        cwd: process.cwd(),
      });
      const output = `${r.stdout || ""}\n${r.stderr || ""}`.slice(-8000);
      return { ok: r.status === 0, output };
    },
    rerunTool: async (toolName, args, tenantId) => {
      try {
        const { executeGuardedTool } = await import("../guarded-tool-executor");
        const clean: any = {};
        for (const k of Object.keys(args || {})) if (!k.startsWith("_")) clean[k] = args[k];
        const out = await executeGuardedTool(toolName, { ...clean, _tenantId: tenantId, _invokedByModel: true }, {
          tenantId,
          invokedVia: "self_heal",
        });
        const ok = !(out && typeof out === "object" && "error" in out && out.error);
        return { ok, output: JSON.stringify(out).slice(0, 4000) };
      } catch (e: any) {
        return { ok: false, output: `re-run threw: ${e?.message || e}` };
      }
    },
    countPriorFailedAttempts: async (tenantId, incidentId) => {
      try {
        const { db } = await import("../db");
        const { sql } = await import("drizzle-orm");
        const { ensureRepoSurgeonAttemptsTable } = await import("./repo-surgeon-table");
        await ensureRepoSurgeonAttemptsTable();
        const idClause = incidentId == null
          ? sql`incident_id IS NULL`
          : sql`incident_id = ${incidentId}`;
        const r: any = await db.execute(sql`
          SELECT count(*)::int AS c FROM repo_surgeon_attempts
          WHERE tenant_id = ${tenantId} AND ${idClause}
            AND outcome = ANY(${`{${FAILED_OUTCOMES.join(",")}}`}::text[])
        `);
        return Number((r.rows || r)[0]?.c || 0);
      } catch (e: any) {
        // Fail CLOSED: if the attempt ledger is unreadable we must NOT let the
        // durable two-failed-attempts stop silently reset to zero. Return the
        // cap so attemptBudget() blocks and the run escalates instead of looping.
        logSilentCatch("server/agentic/repo-surgeon.ts", e);
        console.error(`[repo-surgeon] countPriorFailedAttempts read failed — failing CLOSED (blocking this run): ${e?.message || e}`);
        return MAX_FIX_ATTEMPTS;
      }
    },
    countFixesThisHour: async (tenantId) => {
      try {
        const { db } = await import("../db");
        const { sql } = await import("drizzle-orm");
        const { ensureRepoSurgeonAttemptsTable } = await import("./repo-surgeon-table");
        await ensureRepoSurgeonAttemptsTable();
        const r: any = await db.execute(sql`
          SELECT count(*)::int AS c FROM repo_surgeon_attempts
          WHERE tenant_id = ${tenantId} AND created_at >= NOW() - INTERVAL '1 hour'
        `);
        return Number((r.rows || r)[0]?.c || 0);
      } catch (e: any) {
        // Fail CLOSED: an unreadable rate-limit ledger blocks new fixes rather
        // than allowing an unbounded auto-fix burst under DB degradation.
        logSilentCatch("server/agentic/repo-surgeon.ts", e);
        console.error(`[repo-surgeon] countFixesThisHour read failed — failing CLOSED (rate-limiting this run): ${e?.message || e}`);
        return MAX_FIXES_PER_TENANT_PER_HOUR;
      }
    },
    recordAttempt: async (row) => {
      try {
        const { db } = await import("../db");
        const { repoSurgeonAttempts } = await import("@shared/schema");
        const { ensureRepoSurgeonAttemptsTable } = await import("./repo-surgeon-table");
        await ensureRepoSurgeonAttemptsTable();
        const [r] = await db
          .insert(repoSurgeonAttempts)
          .values({
            tenantId: row.tenantId,
            incidentId: row.incidentId ?? null,
            attemptNumber: row.attemptNumber,
            diagnosis: (row.diagnosis || "").slice(0, 4000),
            rootCause: (row.rootCause || "").slice(0, 4000),
            touchedFiles: row.touchedFiles,
            outcome: row.outcome,
            outcomeDetail: row.outcomeDetail as any,
            escalated: row.escalated,
            completedAt: new Date(),
          })
          .returning({ id: repoSurgeonAttempts.id });
        return r?.id ?? null;
      } catch (e: any) {
        console.error(`[repo-surgeon] recordAttempt failed (non-fatal): ${e?.message || e}`);
        return null;
      }
    },
    requestApproval: async ({ tenantId, question, context }) => {
      const { createApproval } = await import("./approvals");
      await createApproval({ tenantId, question, context, ttlHours: 48, requestedBy: "repo-surgeon" });
    },
    escalate: async ({ tenantId, incidentId, reason, data }) => {
      try {
        const { emitEvent } = await import("../event-bus");
        await emitEvent({
          type: "repair.repo_surgeon.escalated",
          source: "repo-surgeon",
          tenantId,
          data: { incidentId, reason: reason.slice(0, 500), ...data },
        });
      } catch (e: any) {
        console.warn(`[repo-surgeon] escalate emit failed (non-fatal): ${e?.message || e}`);
      }
    },
    // Prior-collapse detection is ON in production (env-gated by PRIOR_COLLAPSE,
    // fail-open internally). Hermetic tests build their own deps and omit this.
    collapseTracker: new PriorCollapseTracker(),
    fireValve: async (incident, stallContext) => {
      const { fireEscalationValve } = await import("./escalation-valve");
      return fireEscalationValve(incident, stallContext);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply / rollback
// ─────────────────────────────────────────────────────────────────────────────

interface AppliedChange {
  rollback: () => void;
  /** Deterministic before/after undo plan, captured during apply (Task #65). */
  revertPlan: RevertPlan;
}

/**
 * Apply the proposal to the working tree, returning a rollback closure plus the
 * deterministic revert plan. Each edit's `find` must occur EXACTLY ONCE (fail
 * otherwise — refuse an ambiguous or stale patch). New files must not already
 * exist. Throws on any problem; the caller rolls back whatever was applied so far.
 *
 * The revert plan records, per edited path, the content BEFORE the first edit and
 * AFTER the last edit. That full-content snapshot — not a reverse find/replace —
 * is what makes the owner's later undo (Task #65) deterministic even for deletion
 * edits and safe against a tree that changed underneath it.
 */
function applyProposal(proposal: FixProposal, deps: RepoSurgeonDeps): AppliedChange {
  const originals: { path: string; content: string }[] = [];
  const created: string[] = [];
  // Per unique edited path: the content before the FIRST edit and after the LAST.
  const firstBefore = new Map<string, string>();
  const lastAfter = new Map<string, string>();
  const undo = () => {
    for (const o of originals) {
      try { deps.writeFile(o.path, o.content); } catch (e) { logSilentCatch("server/agentic/repo-surgeon.ts", e); }
    }
    for (const p of created) {
      try { deps.deleteFile(p); } catch (e) { logSilentCatch("server/agentic/repo-surgeon.ts", e); }
    }
  };
  try {
    // Defense-in-depth: the guard invariant already rejects unsafe paths, but
    // refuse again here so applyProposal can never be reached with one.
    for (const p of touchedFilesFromProposal(proposal)) {
      if (!isSafeRepoPath(p)) throw new Error(`refusing to touch out-of-repo path: ${p}`);
    }
    for (const e of proposal.edits || []) {
      if (!deps.exists(e.path)) throw new Error(`edit target does not exist: ${e.path}`);
      const before = deps.readFile(e.path);
      const occurrences = before.split(e.find).length - 1;
      if (occurrences === 0) throw new Error(`edit 'find' not found in ${e.path}`);
      if (occurrences > 1) throw new Error(`edit 'find' is ambiguous (${occurrences} matches) in ${e.path}`);
      originals.push({ path: e.path, content: before });
      if (!firstBefore.has(e.path)) firstBefore.set(e.path, before);
      const after = before.replace(e.find, e.replace);
      deps.writeFile(e.path, after);
      lastAfter.set(e.path, after);
    }
    for (const nf of proposal.newFiles || []) {
      if (deps.exists(nf.path)) throw new Error(`new file already exists: ${nf.path}`);
      deps.writeFile(nf.path, nf.content);
      created.push(nf.path);
    }
  } catch (err) {
    undo();
    throw err;
  }
  const revertPlan: RevertPlan = {
    files: [...firstBefore.keys()].map((path) => ({
      path,
      before: firstBefore.get(path)!,
      after: lastAfter.get(path)!,
    })),
    createdFiles: (proposal.newFiles || []).map((nf) => ({ path: nf.path, content: nf.content })),
  };
  return { rollback: undo, revertPlan };
}

// ─────────────────────────────────────────────────────────────────────────────
// Revert a LANDED fix (owner-driven undo — Task #65)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal fs seam for reverting — a subset of RepoSurgeonDeps. */
export interface RevertFsDeps {
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  deleteFile: (path: string) => void;
  exists: (path: string) => boolean;
}

export interface RevertResult {
  ok: boolean;
  revertedFiles: string[];
  deletedFiles: string[];
  reasons: string[];
}

/**
 * Reverse-apply a previously LANDED Repo Surgeon fix — the owner's one-click
 * "this fix was wrong, undo it" action (Task #65). It replays the stored
 * deterministic {@link RevertPlan} (before/after full-content snapshots captured
 * at land time — NOT a fragile reverse find/replace):
 *   - for each edited file: restore `before` IFF the live file still equals the
 *     fix's `after` (already-reverted or stale → skip / refuse, never clobber);
 *   - for each created file: delete it IFF the live file still equals the stored
 *     `content` (already-gone → skip; modified-since → refuse, never destroy
 *     unrelated later work).
 *
 * Why snapshots and not a reverse patch: a deletion edit (`replace === ""`) has
 * no text to anchor a reverse find/replace on, and string-matching a reversal can
 * silently corrupt or delete later edits. A full-content compare-then-restore is
 * deterministic for every edit shape and refuses (rather than guesses) on drift.
 *
 * Deliberately does NOT run a typecheck/verification gate: reverting a fix that
 * corrected a compile error necessarily REINTRODUCES that error, and gating on a
 * green tree would make such a revert impossible. Safety comes from (a) the
 * exact-content stale check, (b) the out-of-repo path guard, and (c) all-or-
 * nothing rollback so a partial revert never leaves the tree half-undone. The
 * reversed change is left in the working tree for the Auto Git Push workflow.
 *
 * Pure except for the injected fs seam (defaults to the real fs) — unit-testable.
 * NEVER throws; failures come back as `{ ok: false, reasons }`.
 */
export function revertAppliedFix(
  plan: RevertPlan | undefined,
  depsOverride?: Partial<RevertFsDeps>,
): RevertResult {
  const base = defaultDeps();
  const deps: RevertFsDeps = {
    readFile: base.readFile,
    writeFile: base.writeFile,
    deleteFile: base.deleteFile,
    exists: base.exists,
    ...(depsOverride || {}),
  };

  const fileList = plan?.files || [];
  const createdList = plan?.createdFiles || [];
  if (!fileList.length && !createdList.length) {
    return { ok: false, revertedFiles: [], deletedFiles: [], reasons: ["No stored undo plan for this fix — revert it by hand."] };
  }

  // Path guard (defense-in-depth — a landed fix can't have touched a protected
  // surface, but never trust stored data blindly).
  for (const p of [...fileList.map((f) => f.path), ...createdList.map((f) => f.path)]) {
    if (!isSafeRepoPath(p)) {
      return { ok: false, revertedFiles: [], deletedFiles: [], reasons: [`Refusing to revert an out-of-repo path: ${p}`] };
    }
  }

  // Pre-flight: validate EVERY action is safe before mutating anything, so the
  // common stale/already-reverted cases never leave a half-applied tree.
  type Action =
    | { kind: "restore"; path: string; before: string }
    | { kind: "noop_restore"; path: string }
    | { kind: "delete"; path: string }
    | { kind: "noop_delete"; path: string };
  const actions: Action[] = [];
  for (const f of fileList) {
    const exists = deps.exists(f.path);
    const current = exists ? deps.readFile(f.path) : null;
    if (current === f.after) {
      actions.push({ kind: "restore", path: f.path, before: f.before });
    } else if (current === f.before) {
      // Already at the pre-fix content (revert is a no-op for this file).
      actions.push({ kind: "noop_restore", path: f.path });
    } else {
      return {
        ok: false,
        revertedFiles: [],
        deletedFiles: [],
        reasons: [`${f.path} has changed since the fix landed — refusing to revert (would clobber later edits). Undo by hand.`],
      };
    }
  }
  for (const nf of createdList) {
    if (!deps.exists(nf.path)) {
      actions.push({ kind: "noop_delete", path: nf.path });
      continue;
    }
    const current = deps.readFile(nf.path);
    if (current === nf.content) {
      actions.push({ kind: "delete", path: nf.path });
    } else {
      return {
        ok: false,
        revertedFiles: [],
        deletedFiles: [],
        reasons: [`${nf.path} was modified after the fix created it — refusing to delete it (would destroy later work). Undo by hand.`],
      };
    }
  }

  // Apply, capturing originals for an all-or-nothing rollback on any failure.
  const restored: { path: string; content: string }[] = [];
  const removed: { path: string; content: string }[] = [];
  const undo = () => {
    for (const o of restored) {
      try { deps.writeFile(o.path, o.content); } catch (e) { logSilentCatch("server/agentic/repo-surgeon.ts", e); }
    }
    for (const r of removed) {
      try { deps.writeFile(r.path, r.content); } catch (e) { logSilentCatch("server/agentic/repo-surgeon.ts", e); }
    }
  };

  const revertedFiles: string[] = [];
  const deletedFiles: string[] = [];
  try {
    for (const a of actions) {
      if (a.kind === "restore") {
        restored.push({ path: a.path, content: deps.readFile(a.path) });
        deps.writeFile(a.path, a.before);
        revertedFiles.push(a.path);
      } else if (a.kind === "delete") {
        removed.push({ path: a.path, content: deps.readFile(a.path) });
        deps.deleteFile(a.path);
        deletedFiles.push(a.path);
      }
      // noop_restore / noop_delete: nothing to do (already in target state).
    }
  } catch (err: any) {
    undo();
    return { ok: false, revertedFiles: [], deletedFiles: [], reasons: [String(err?.message || err)] };
  }

  return { ok: true, revertedFiles, deletedFiles, reasons: [] };
}

async function runVerification(
  incident: RepoSurgeonIncident,
  proposal: FixProposal,
  deps: RepoSurgeonDeps,
): Promise<VerificationReport> {
  const plan = buildVerificationPlan(incident, proposal);
  const steps: VerificationStepResult[] = [];

  if (plan.typecheck) {
    const r = deps.runCommand("npm", ["run", "check"], PER_STEP_TIMEOUT_MS);
    steps.push({ name: "typecheck", ok: r.ok, output: r.output });
    if (!r.ok) return { ok: false, steps }; // fail fast — cheapest gate first
  }

  for (const t of plan.tests) {
    if (!deps.exists(t)) continue; // an inferred-but-absent test is not a failure
    const r = deps.runCommand("node", ["--import", "tsx", "--test", t], PER_STEP_TIMEOUT_MS);
    steps.push({ name: `test:${t}`, ok: r.ok, output: r.output });
    if (!r.ok) return { ok: false, steps };
  }

  if (plan.goldenPath) {
    const r = deps.runCommand("npx", ["tsx", "scripts/golden-path-replay.ts"], PER_STEP_TIMEOUT_MS);
    steps.push({ name: "golden-path-replay", ok: r.ok, output: r.output });
    if (!r.ok) return { ok: false, steps };
  }

  if (plan.rerunTool) {
    const r = await deps.rerunTool(plan.rerunTool, incident.lastToolArgs || {}, incident.tenantId);
    steps.push({ name: `rerun:${plan.rerunTool}`, ok: r.ok, output: r.output });
    if (!r.ok) return { ok: false, steps };
  }

  return { ok: true, steps };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the guarded fix loop for one code-defect incident. Diagnose → minimal
 * diff → guard invariant (fail-closed) → sensitive-surface HITL → apply →
 * verify → land (green) / roll back (red), up to the remaining attempt budget.
 * NEVER throws — self-repair must not break its caller.
 */
export async function runRepoSurgeon(
  incident: RepoSurgeonIncident,
  depsOverride?: Partial<RepoSurgeonDeps>,
): Promise<RepoSurgeonResult> {
  const deps: RepoSurgeonDeps = { ...defaultDeps(), ...(depsOverride || {}) };
  const incidentId = incident.incidentId ?? null;
  const finish = async (
    outcome: RepoSurgeonOutcome,
    attempt: number,
    extra: Partial<RepoSurgeonResult> & { proposal?: FixProposal | null; valve?: any },
  ): Promise<RepoSurgeonResult> => {
    const escalated = !!extra.escalated;
    const touchedFiles = extra.touchedFiles ?? (extra.proposal ? touchedFilesFromProposal(extra.proposal) : []);
    await deps.recordAttempt({
      tenantId: incident.tenantId,
      incidentId,
      attemptNumber: attempt,
      diagnosis: extra.diagnosis || extra.proposal?.diagnosis || "",
      rootCause: extra.rootCause || extra.proposal?.rootCause || "",
      touchedFiles,
      outcome,
      outcomeDetail: {
        reasons: extra.reasons || [],
        verification: extra.verification,
        // Metered escalation valve fire record (Anvil borrow) — presence of the
        // `valve` key is what the Harness Health valve-fire-rate query counts.
        ...(extra.valve ? { valve: extra.valve } : {}),
      },
      escalated,
    });
    if (escalated) {
      await deps.escalate({
        tenantId: incident.tenantId,
        incidentId,
        reason: extra.reason || outcome,
        data: { outcome, attempt, reasons: extra.reasons || [], touchedFiles },
      });
    }
    return {
      outcome,
      attempts: attempt,
      diagnosis: extra.diagnosis || extra.proposal?.diagnosis,
      rootCause: extra.rootCause || extra.proposal?.rootCause,
      touchedFiles,
      verification: extra.verification,
      // Surface the actual diff only on a landed fix — that's the change the
      // owner notification needs to show. (Non-landed paths leave it undefined.)
      edits: outcome === "landed" ? extra.proposal?.edits : undefined,
      newFiles: outcome === "landed" ? extra.proposal?.newFiles : undefined,
      revertPlan: outcome === "landed" ? extra.revertPlan : undefined,
      reasons: extra.reasons || [],
      escalated,
      reason: extra.reason || outcome,
    };
  };

  // Rate-limit backstop.
  const hour = await deps.countFixesThisHour(incident.tenantId);
  if (hour >= MAX_FIXES_PER_TENANT_PER_HOUR) {
    return finish("rate_limited", 0, {
      escalated: true,
      reasons: [`Tenant hourly fix cap hit (${hour}/${MAX_FIXES_PER_TENANT_PER_HOUR}).`],
      reason: "Repo Surgeon rate-limited for this tenant.",
    });
  }

  // Two-failed-attempts stop (durable — counts prior invocations too).
  const priorFailed = await deps.countPriorFailedAttempts(incident.tenantId, incidentId);
  let budget = attemptBudget(priorFailed);
  if (budget.blocked) {
    return finish("stopped_attempt_limit", priorFailed, {
      escalated: true,
      reasons: [`Already ${priorFailed} failed fix attempt(s) on this incident (max ${MAX_FIX_ATTEMPTS}). Stopping and escalating instead of looping.`],
      reason: "Two failed fix attempts — stopped and escalated to the owner.",
    });
  }

  let priorFailureFeedback: string | null = null;
  let lastResult: RepoSurgeonResult | null = null;
  // Metered escalation valve: at most ONE frontier diagnostic turn per invocation.
  let valveFired = false;

  for (let i = 0; i < budget.remaining; i++) {
    const attemptNumber = priorFailed + i + 1;

    // 1. Diagnose + minimal diff.
    let proposal: FixProposal | null;
    try {
      proposal = await deps.propose(incident, priorFailureFeedback, attemptNumber);
    } catch (e: any) {
      lastResult = await finish("diagnosis_failed", attemptNumber, {
        escalated: true,
        reasons: [`Diagnosis threw: ${e?.message || e}`],
        reason: "Repo Surgeon could not diagnose the defect.",
      });
      break;
    }
    if (!proposal || proposal.cannotFix || proposal.specTestConflict === true) {
      // Spec-vs-test authority conflict (fable-method borrow): the proposer judged
      // the failing TEST contradicts the spec/house pattern. Surface the conflict
      // distinctly — never silently "fix" correct code to satisfy a wrong test.
      // The conflict flag is AUTHORITATIVE at the executor: even if a proposer
      // illegally ships edits alongside it (cannotFix=false), nothing is applied.
      const specConflict = proposal?.specTestConflict === true;
      lastResult = await finish("no_fix_proposed", attemptNumber, {
        escalated: true,
        proposal,
        reasons: specConflict
          ? [`SPEC-VS-TEST CONFLICT: ${proposal?.diagnosis || "the failing test appears to contradict the documented spec/house pattern"}`]
          : [proposal?.diagnosis || "Model declined to propose a fix."],
        reason: specConflict
          ? "Failing test appears to contradict the spec — auto-fix refused; needs human ruling on which authority is right."
          : "No safe automated fix could be produced.",
      });
      break;
    }
    if (!proposal.edits?.length && !proposal.newFiles?.length) {
      lastResult = await finish("no_fix_proposed", attemptNumber, {
        escalated: true,
        proposal,
        reasons: ["Proposal contained no edits."],
        reason: "No safe automated fix could be produced.",
      });
      break;
    }

    const touched = touchedFilesFromProposal(proposal);

    // 2. GUARD INVARIANT (fail-closed) — path denylist + out-of-band diff scan.
    const guard = runGuardInvariant(incident, proposal);
    if (!guard.ok) {
      lastResult = await finish("blocked_guard_invariant", attemptNumber, {
        escalated: true,
        proposal,
        touchedFiles: touched,
        reasons: guard.reasons,
        reason: "Refused: the fix would weaken a guard/test/safety surface.",
      });
      break; // a guard-weakening proposal is not retried — escalate immediately.
    }

    // 2b. PRIOR-COLLAPSE (Bilevel Autoresearch borrow, arXiv:2603.23420) —
    //     if this attempt's diff is SEMANTICALLY near-identical to a prior
    //     FAILED attempt's diff (cosmetic rewording the failure feedback
    //     didn't shake), don't burn a full apply+verify gate on a proven-
    //     losing idea: record a failed attempt (counts toward the durable
    //     two-attempt stop) and feed a perturbation directive into the next
    //     propose call. Runs AFTER the guard invariant (safety visibility
    //     first) and BEFORE the HITL gate (never ask the owner to approve a
    //     proven-failed dupe). Fail-OPEN: tracker absent / embedding
    //     unavailable ⇒ normal path.
    const proposalText = renderFixProposalText(proposal);
    if (deps.collapseTracker) {
      const collapse = await safeCollapseCheck(deps.collapseTracker, proposalText);
      if (collapse.collapsed) {
        priorFailureFeedback = buildPerturbationDirective(collapse.similarity, "fix-proposal");
        const collapseIsLast = i === budget.remaining - 1;
        // METERED ESCALATION VALVE (Anvil borrow, verdict 2026-07-17): a
        // genuine stall is the ONE place the frontier reserve is spent —
        // exactly one diagnostic turn (judgment only, no diff), then demote
        // back to the cheap loop. Only fires when a NEXT cheap attempt exists
        // to consume the diagnosis, and at most once per invocation. Fail-OPEN:
        // valve absent/null/throw ⇒ perturbation directive alone, as before.
        let valveRecord: { model: string; stallDiagnosis: string; suggestedDirection: string } | null = null;
        let valveTriedNow = false;
        if (deps.fireValve && !valveFired && !collapseIsLast) {
          valveFired = true; // metered: one turn per invocation, even if it fails.
          valveTriedNow = true;
          try {
            const stallContext = `REPEATED FAILED PROPOSAL (cosine ${collapse.similarity == null ? "?" : collapse.similarity.toFixed(3)} to a prior failed attempt):\n${proposalText.slice(0, 3000)}\n\nPRIOR FAILURE FEEDBACK:\n${(priorFailureFeedback || "").slice(0, 1000)}`;
            const d = await deps.fireValve(incident, stallContext);
            if (d) {
              valveRecord = { model: d.model, stallDiagnosis: d.stallDiagnosis.slice(0, 1500), suggestedDirection: d.suggestedDirection.slice(0, 1500) };
              priorFailureFeedback = `${priorFailureFeedback}\n\nSENIOR (frontier) STALL DIAGNOSIS — one-time escalation, follow this direction:\n- Why stuck: ${valveRecord.stallDiagnosis}\n- Try instead: ${valveRecord.suggestedDirection}`;
            }
          } catch (e) {
            logSilentCatch("server/agentic/repo-surgeon.ts", e);
          }
        }
        lastResult = await finish("rolled_back", attemptNumber, {
          proposal,
          touchedFiles: touched,
          escalated: collapseIsLast,
          valve: valveRecord ? { fired: true, ...valveRecord } : (valveTriedNow ? { fired: true, failed: true } : undefined),
          reasons: [
            `Prior-collapse: proposal near-identical (cosine ${collapse.similarity == null ? "?" : collapse.similarity.toFixed(3)}) to a previously failed attempt — apply/verify skipped.${valveRecord ? " Escalation valve fired: one frontier diagnostic turn fed into the next attempt." : ""}`,
          ],
          reason: collapseIsLast
            ? "Prior-collapse on the final attempt — escalated instead of re-verifying a proven-failed diff."
            : "Prior-collapse — near-identical re-proposal; retrying with a perturbation directive.",
        });
        continue;
      }
    }

    // 3. SENSITIVE SURFACE → owner HITL. Produce + guard-check the diff, request
    //    sign-off, and STOP (a Resume task applies it after approval). Never
    //    auto-merge a sensitive surface.
    const sensitive = isSensitiveSurface(touched);
    // Audit-sourced autopilot: a nightly tenant-isolation finding may auto-apply
    // a fix to a BROAD app-source aggregator (server/routes/*, tools.ts,
    // chat-engine.ts) WITHOUT the owner-HITL pause — but ONLY when every guard
    // below holds. Any failure falls back to the normal HITL pause. The
    // cardinal-sin guards (runGuardInvariant, above) already ran and passed; the
    // full security regression suite gates the verify (buildVerificationPlan).
    const hardHitl = isHardHitlSurface(touched);
    // Content-level gate: catches auth/payment/schema logic edited INSIDE a broad
    // aggregator file whose FILENAME doesn't match HARD_HITL_SURFACE_RE.
    const hardContent = proposalTouchesHardContent(proposal);
    // Resolved-effects gate (HIGH-3): realpath-canonicalize every touched path and
    // match HARD + security-core/CI zones. Symlink/alias-proof and AUTHORITATIVE —
    // any touch to a protected/security-core surface forces HITL regardless of how
    // the diff is phrased. Fails CLOSED: any throw ⇒ treated as hard ⇒ owner HITL.
    let resolvedHard: { hard: boolean; hits: string[] } = { hard: true, hits: ["uncomputed"] };
    try {
      resolvedHard = resolveHardZoneTouch(touched);
    } catch (e: any) {
      logSilentCatch("server/agentic/repo-surgeon.ts", e);
      resolvedHard = { hard: true, hits: ["resolve-threw"] };
    }
    const auditEligible =
      incident.securityCoreAllowed === true && process.env.SECURITY_CORE_AUTOFIX === "1";
    // SCOPE PIN (fail-closed): an audit-sourced relax may touch ONLY the files the
    // producer pinned in `candidateFiles` (the finding's own target). An empty pin
    // OR any touched file outside the pin forces HITL — closes the gap where a
    // finding in file A yields a proposal silently editing unrelated non-hard
    // files B/C and still skips sign-off. The whole eligibility computation fails
    // CLOSED: any throw in a gate ⇒ no relax ⇒ owner HITL.
    // NOTE: the HARD-ZONE gate (resolvedHard, above) is realpath-canonicalized
    // (symlink/alias-proof) and authoritative; the scope pin below remains textual-
    // path (acceptable — the security-critical hard-zone classification is the
    // canonicalized one, and isSafeRepoPath already blocks traversal/absolute).
    let inScope = false;
    try {
      inScope = isWithinPinnedScope(touched, incident.candidateFiles);
    } catch (e: any) {
      logSilentCatch("server/agentic/repo-surgeon.ts", e);
      inScope = false;
    }
    let auditRelax = false;
    try {
      auditRelax =
        auditEligible &&
        !hardHitl.hard &&
        !hardContent.hard &&
        !resolvedHard.hard &&
        inScope &&
        touched.length <= AUDIT_AUTOFIX_MAX_FILES;
    } catch (e: any) {
      logSilentCatch("server/agentic/repo-surgeon.ts", e);
      auditRelax = false;
    }
    if (sensitive.sensitive && auditRelax) {
      console.log(
        `[repo-surgeon] audit-autopilot: applying sensitive-surface fix WITHOUT HITL ` +
          `(audit-sourced, ${touched.length} file(s): ${touched.join(", ")}); ` +
          `security regression suite gates the verify.`,
      );
    } else if (sensitive.sensitive && auditEligible) {
      // Eligible for autopilot but a guard denied the relax → falls back to HITL.
      const why = hardHitl.hard
        ? `hard path surface (${hardHitl.hits.join(", ")})`
        : resolvedHard.hard
          ? `hard/security-core zone by resolved path (${resolvedHard.hits.slice(0, 3).join("; ")})`
          : hardContent.hard
            ? `hard content in diff — auth/payment/schema (${hardContent.hits.slice(0, 3).join("; ")})`
            : !inScope
              ? `touched files outside pinned candidateFiles scope (touched: ${touched.join(", ")}; pinned: ${(incident.candidateFiles || []).join(", ") || "none"})`
              : `${touched.length} file(s) > cap ${AUDIT_AUTOFIX_MAX_FILES}`;
      console.log(`[repo-surgeon] audit-autopilot DENIED relax → owner HITL: ${why}`);
    }
    if (sensitive.sensitive && !auditRelax) {
      try {
        await deps.requestApproval({
          tenantId: incident.tenantId,
          question: `[REPO SURGEON] Proposed fix touches a sensitive surface (${sensitive.hits.join(", ")}). Approve before landing?`,
          context: {
            incidentId,
            diagnosis: proposal.diagnosis,
            rootCause: proposal.rootCause,
            precedent: proposal.precedent,
            touchedFiles: touched,
            edits: proposal.edits,
            newFiles: proposal.newFiles,
            _untrusted: true,
          },
        });
      } catch (e: any) {
        logSilentCatch("server/agentic/repo-surgeon.ts", e);
      }
      lastResult = await finish("awaiting_hitl", attemptNumber, {
        escalated: true,
        proposal,
        touchedFiles: touched,
        reasons: [`Sensitive surface (${sensitive.hits.join(", ")}) — owner sign-off requested; not auto-applied.`],
        reason: "Paused for owner sign-off (sensitive surface).",
      });
      break; // HITL pause does NOT consume the failed-attempt budget.
    }

    // 4. Apply + verify.
    let applied: AppliedChange;
    try {
      applied = applyProposal(proposal, deps);
    } catch (e: any) {
      // A bad/stale patch is a failed attempt — feed it back for the next try.
      priorFailureFeedback = `Attempt ${attemptNumber} could not be applied: ${e?.message || e}`;
      await safeCollapseRemember(deps.collapseTracker, proposalText);
      lastResult = await finish("rolled_back", attemptNumber, {
        proposal,
        touchedFiles: touched,
        reasons: [priorFailureFeedback],
        reason: "Patch did not apply cleanly.",
      });
      continue;
    }

    let report: VerificationReport;
    try {
      report = await runVerification(incident, proposal, deps);
    } catch (e: any) {
      applied.rollback();
      priorFailureFeedback = `Attempt ${attemptNumber} verification threw: ${e?.message || e}`;
      await safeCollapseRemember(deps.collapseTracker, proposalText);
      lastResult = await finish("rolled_back", attemptNumber, {
        proposal,
        touchedFiles: touched,
        reasons: [priorFailureFeedback],
        reason: "Verification crashed; rolled back.",
      });
      continue;
    }

    if (report.ok) {
      // 5a. LAND — leave the change in the working tree for the Auto Git Push
      //     workflow (CI self-healer precedent). All gates green.
      lastResult = await finish("landed", attemptNumber, {
        proposal,
        touchedFiles: touched,
        verification: report,
        revertPlan: applied.revertPlan,
        reason: "All verification gates passed — change landed.",
      });
      break;
    }

    // 5b. RED — roll back cleanly, record a failed attempt, feed the failing
    //     step into the next attempt's diagnosis (sharper context, not a blind
    //     re-roll — replit.md 2-failed-corrections rule).
    applied.rollback();
    const failedStep = report.steps.find((s) => !s.ok);
    priorFailureFeedback = `Attempt ${attemptNumber} failed verification at "${failedStep?.name}":\n${(failedStep?.output || "").slice(-2000)}`;
    await safeCollapseRemember(deps.collapseTracker, proposalText);
    const isLastAttempt = i === budget.remaining - 1;
    lastResult = await finish("rolled_back", attemptNumber, {
      proposal,
      touchedFiles: touched,
      verification: report,
      escalated: isLastAttempt,
      reasons: [`Verification failed at ${failedStep?.name}.`],
      reason: isLastAttempt
        ? "Verification failed on the final attempt — rolled back and escalated."
        : "Verification failed — rolled back; retrying with sharper context.",
    });
  }

  return (
    lastResult ?? {
      outcome: "no_fix_proposed",
      attempts: 0,
      reasons: ["No attempt produced a result."],
      escalated: true,
      reason: "Repo Surgeon produced no result.",
    }
  );
}
