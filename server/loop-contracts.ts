// ─────────────────────────────────────────────────────────────────────────────
// Loop Contracts — explicit stop+escalate discipline for VisionClaw's autonomous loops
// ─────────────────────────────────────────────────────────────────────────────
// Inspired by Forward Future's Loop Library (Matthew Berman et al.,
// https://signals.forwardfuture.ai/loop-library/) reviewed 2026-06-23. Their
// thesis: a good agentic loop is a feedback system with TERMINAL STATES, not a
// licence for endless autonomy. Every loop must answer four questions:
//
//   1. objective — what is the agent trying to accomplish?
//   2. check     — how will it know whether the latest attempt worked?
//   3. feedback  — what does it do with what it learned?
//   4. stop[] + escalate[] — when does it finish, and when does it hand back to a human?
//
// VisionClaw already RUNS all of these loops (workflow scripts + in-process
// heartbeat). What it lacked was that discipline written down as a single,
// type-checked, machine-auditable contract. This module is that contract; the
// Loop Doctor (`scripts/loop-contract-audit.ts`) enforces it, and
// `tests/unit/loop-contracts.test.ts` keeps it green in CI.
//
// NO external framework or prompt was imported — only the doctrine. Adding a new
// autonomous loop (a new long-running workflow or a heartbeat-driven cadence)
// MUST add its contract here, or the Loop Doctor / CI test goes red — the
// completeness gate (`auditLoopCoverage`) derives the expected loop set from the
// live `.replit` workflows so an uncontracted loop can't slip through silently.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** How much authority the loop wields when it acts. Ordered least → most risky. */
export type LoopAuthority = "read-only" | "self-healing" | "mutating" | "destructive";

/** Safety posture when the loop hits an error or an undecidable state. */
export type LoopFailMode = "open" | "closed";

export interface LoopContract {
  /** Stable slug. */
  id: string;
  /** Human name — matches the `.replit` workflow name where one exists. */
  name: string;
  /** Repo-relative path to the loop's entry source file. Audited for existence. */
  source: string;
  /** `.replit` workflow name, or null for an in-process / heartbeat-driven loop. */
  workflow: string | null;
  /** What wakes the loop (poll cadence, cron, autostart, heartbeat tick, flag file). */
  trigger: string;
  /** Q1 — what the loop is trying to accomplish. */
  objective: string;
  /** Q2 — how it verifies the latest attempt actually worked. */
  check: string;
  /** Q3 — what it does with what it learned each pass. */
  feedback: string;
  /** Q4a — terminal / stopping conditions. MUST be non-empty (no unbounded loops). */
  stop: string[];
  /** Q4b — when it hands control back to a human. MUST be non-empty (no silent forever-runs). */
  escalate: string[];
  /** How much it can change. */
  authority: LoopAuthority;
  /** Mutating / destructive loops MUST fail CLOSED (VisionClaw invariant). */
  failMode: LoopFailMode;
  /**
   * The generator/evaluator split (Osmani / Rajasekaran, "Loop Engineering" 2026,
   * IEEE-reformat reviewed 2026-06-25). The paper's central claim: a loop's floor is
   * its evaluator, and an agent grading its OWN output praises it — "a loop that has
   * never once said 'no' to itself is proof no real check exists." So who says "no"?
   *   "independent"   — the latest attempt is judged by a DIFFERENT model/agent or by
   *                     a deterministic gate (typecheck, tests, validators, a separate
   *                     jury), never by the generator that produced it.
   *   "self"          — the generator judges its own output (the "nodding loop"). The
   *                     Loop Doctor FAILS on this — it is the anti-pattern this field
   *                     exists to surface, not hide.
   *   "deterministic" — no LLM-generated artifact to judge (pure transforms: git,
   *                     doc regeneration from a registry). The `check` field still
   *                     describes its (deterministic) verification.
   */
  verifier: "independent" | "self" | "deterministic";
  /**
   * The token-cap guard (Loop Engineering First-Loop Checklist, Table VI: "Did you
   * set a spending ceiling? Who stops it if it runs off?"). A loop that retries and
   * spawns helpers freely overnight runs up "token blowout" — a bill due all at once.
   *   "capped"    — reserves an estimate against an atomic per-tenant budget cap
   *                 BEFORE any paid model spend (claimAutonomousBudget) and fails
   *                 CLOSED when over budget. The Loop Doctor PROVES this label by
   *                 requiring the loop's source to reference claimAutonomousBudget —
   *                 a declared "capped" with no claim seam is an ERROR, not trusted.
   *   "bounded"   — makes paid calls but over a FINITE fixed work-set per run (e.g.
   *                 one embedding per registry row), with no open-ended retry/fan-out.
   *   "none"      — makes no paid model calls at all.
   *   "unbounded" — open-ended paid calls with no ceiling. The Loop Doctor FAILS on
   *                 this; it is the token-blowout anti-pattern.
   */
  spend: "capped" | "bounded" | "none" | "unbounded";
}

export const LOOP_CONTRACTS: LoopContract[] = [
  {
    id: "agentic-ci-self-healer",
    name: "Agentic CI Self-Healer",
    source: "scripts/agentic-ci-self-heal.ts",
    workflow: "Agentic CI Self-Healer",
    trigger: "Continuous poll of GitHub Actions on main (POLL_SECONDS, default 120s).",
    objective:
      "Detect failed CI runs on main and auto-repair them from a pattern registry so end users (and Bob) never see raw errors.",
    check:
      "After applying the first matching FIX_REGISTRY fix, run that fix's verify command locally before leaving the changes for Auto Git Push to land.",
    feedback:
      "On a verified fix, persist state + send a single 'self-healed' note; on an unmatched signature, capture it so the registry can grow next round.",
    stop: [
      "Latest run on main is green or already healed (state file).",
      "No registry pattern matches the failure → give up on that run, record it, skip it next poll.",
    ],
    escalate: [
      "Unmatched failure signature → single 'needs human attention' owner email, throttled per (run_id, signature).",
    ],
    authority: "self-healing",
    failMode: "closed",
    verifier: "independent",
    spend: "capped",
  },
  {
    id: "auto-git-push",
    name: "Auto Git Push",
    source: "scripts/git-auto-push.sh",
    workflow: "Auto Git Push",
    trigger: "Poll of the working tree (POLL_SECONDS, default 30s).",
    objective:
      "Commit + push the working tree to the private repo on Bob's behalf (the agent sandbox blocks direct git commit), and force the sanitized public mirror on the mirror flag.",
    check:
      "Only commit when the tree is dirty AND has been stable for QUIET_SECONDS (no mid-edit commits); the public mirror push runs zero-leak verification first (fails closed).",
    feedback:
      "A failed push is logged and retried on the next cycle; nothing is force-applied.",
    stop: [
      "Working tree clean → no-op.",
      "ENABLE_SELF_PUSH != 1 → auto-push disabled, idle (forks never push upstream).",
    ],
    escalate: [
      "Push wedged (stale *.lock in .git / refs / worktrees) → operator clears the stale ref-locks per the documented unwedge runbook.",
    ],
    authority: "mutating",
    failMode: "closed",
    verifier: "deterministic",
    spend: "none",
  },
  {
    id: "jury-queue-drainer",
    name: "Jury Queue Drainer",
    source: "scripts/drain-jury-queue.ts",
    workflow: "Jury Queue Drainer",
    trigger: "Poll of data/jury-decisions/queue.json (JURY_DRAIN_POLL_SECONDS, default 300s).",
    objective:
      "Close the jury → implement → repo-surgeon loop by routing each unprocessed FIX verdict into captureIncident() — the same guarded seam the CI self-healer uses.",
    check:
      "mapJuryDecision routes ONLY a unanimous (3/3) FIX with adequate concordance and no escalation flag to repo_surgeon, which itself runs typecheck/test and lands-or-rolls-back; budget is claimed atomically before any spend (fails closed).",
    feedback:
      "Each handled entry is stamped _drained and skipped next run; a transient capture failure is left un-stamped so it retries.",
    stop: [
      "Queue fully drained — every entry processed or _drained.",
      "JURY_AUTOAPPLY unset → nothing is ever written to the queue to drain.",
    ],
    escalate: [
      "A 2/3 split, low fix-concordance, or shouldEscalate verdict → owner-notification instead of auto-fix.",
      "Sensitive-path FIX verdicts are kept out of the queue and never auto-applied.",
    ],
    authority: "self-healing",
    failMode: "closed",
    verifier: "independent",
    spend: "capped",
  },
  {
    id: "skill-optimizer-nightly",
    name: "Skill Optimizer Nightly",
    source: "scripts/skill-optimize-nightly.ts",
    workflow: "Skill Optimizer Nightly",
    trigger: "Nightly cron (single-shot scheduled run).",
    objective:
      "Autonomously self-improve skills in auto-apply mode, where every proposed upgrade must clear two safety gates before touching the live skills table.",
    check:
      "Gate 1 — keep a candidate ONLY if it scores strictly higher on a held-out validation set; Gate 2 — a 3-LLM jury must return 2-of-3 FIX before the DB write (optimistic-concurrency guarded).",
    feedback:
      "apply (jury FIX) writes the improved doc; hold (ACCEPT/REJECT) keeps current + logs; no-improvement candidates ship nothing.",
    stop: [
      "All registered skills processed for the night.",
      "Zero registered skills → clean exit (0).",
    ],
    escalate: [
      "ESCALATE verdict or no jury majority → owner-notification; the current skill is kept unchanged.",
    ],
    authority: "mutating",
    failMode: "closed",
    verifier: "independent",
    spend: "capped",
  },
  {
    id: "tenant-isolation-audit",
    name: "Tenant Isolation Audit Nightly",
    source: "scripts/tenant-isolation-audit.ts",
    workflow: "Tenant Isolation Audit Nightly",
    trigger: "Nightly cron (single-shot scheduled run).",
    objective:
      "Hold many server query/route/middleware sites in one flagship-model context and verify the app-level tenant_id WHERE-clause invariant across all of them at once.",
    check:
      "Code is fed to the model as DATA (prompt-injection safe); a green (exit 0) run is emitted ONLY on FULL chunk coverage — any failed/unparseable chunk forces DEGRADED (exit 5), never a silent 'all clear'.",
    feedback:
      "Writes a report; optional remediation (ships OFF) jury-votes AUTO-tier findings into the repo-surgeon pipeline; HARD-tier findings are never auto-queued.",
    stop: [
      "All chunks audited with full coverage and no HIGH/CRITICAL findings → exit 0.",
      "Nothing in scope to audit → exit 2.",
    ],
    escalate: [
      "HIGH/CRITICAL findings → owner email (exit 4).",
      "DEGRADED coverage (a chunk failed to run/parse) → owner email (exit 5).",
      "HARD-tier (schema/auth/payments/safety) findings → owner in-chat sign-off via pending-approval file, never auto-fixed.",
    ],
    authority: "read-only",
    failMode: "closed",
    verifier: "independent",
    spend: "capped",
  },
  {
    id: "bwb-weekly-render",
    name: "BWB Weekly Render",
    source: "scripts/bwb-weekly-orchestrator.ts",
    workflow: null,
    trigger:
      "In-process weekly cron (server/bwb-weekly-cron.ts, started from server/index.ts via startBwbWeeklyScheduler) spawns the single-shot orchestrator on a configurable wall-clock slot; disarmed unless BWB_WEEKLY_AUTONOMOUS=1.",
    objective:
      "Auto-discover the week's short-form dailies, synthesize one ~5-min weekly recap in Bob's Fish voice clone, generate a thumbnail, and deliver the MP4 via the canonical delivery pipeline.",
    check:
      "The builder writes a machine-readable result sidecar per produced video; brand/voice/weight-honesty validation (assertBobVoice etc.) runs before render and fails closed; budget is claimed before paid model spend.",
    feedback:
      "Picks up the produced sidecar and proceeds to the launch-posture step only on a real produced artifact.",
    stop: [
      "Recap produced + delivered (and published if BWB_WEEKLY_AUTOPUBLISH=1).",
      "Nothing produced → exit 2; build failed → exit 3.",
    ],
    escalate: [
      "Approval-first default: a durable approval row + one-tap approve/deny email to Bob before any public publish.",
      "Publish/notify failure → exit 4 (surfaces to scheduler/operator).",
    ],
    authority: "mutating",
    failMode: "closed",
    verifier: "independent",
    spend: "capped",
  },
  {
    id: "agent-knowledge-refresh",
    name: "Agent Knowledge Refresh",
    source: "scripts/agent-knowledge-refresh.ts",
    workflow: "Agent Knowledge Refresh",
    trigger: "Recurring workflow (idempotent, safe to re-run any time).",
    objective:
      "Keep every active persona current with the live tool inventory + recent capability releases by regenerating tools_doc/agents_doc and upserting cross-persona briefings.",
    check:
      "Runs verify-agent-wiring after the sync; the wiring-audit exit code (dead tools / drift) is propagated so a broken sync surfaces non-zero.",
    feedback:
      "Briefings are keyed by stable title so re-runs UPDATE rather than duplicate; persona docs are regenerated from the live registry each pass.",
    stop: [
      "Sync + knowledge upsert complete and wiring audit clean → exit 0.",
    ],
    escalate: [
      "Sync failure (exit 1), knowledge-upsert failure (exit 2), or wiring-audit failure (exit 3+) surfaces to the scheduler/operator for attention.",
    ],
    authority: "mutating",
    failMode: "closed",
    verifier: "deterministic",
    spend: "bounded",
  },
  {
    id: "heartbeat-scheduled-tasks",
    name: "Heartbeat (scheduled tasks)",
    source: "server/heartbeat.ts",
    workflow: null,
    trigger: "In-process heartbeat tick (due-filtered scheduled tasks).",
    objective:
      "Execute due autonomous corporate tasks on cadence (the in-app loop behind scheduled tasks and recurring operations).",
    check:
      "Tasks run only when due (cron + DB-lastRunAt floor); heavy activity-gated tasks are bounded below their cron interval to avoid double-runs. Paid model calls are bounded by a hard hourly ceiling (MAX_AI_CALLS_PER_HOUR) plus reserved-slot protection — a FINITE per-tick/per-hour work-set, not the atomic claim-before-spend the script loops use.",
    feedback:
      "Each run stamps lastRunAt so the next tick re-evaluates due-ness from persisted state.",
    stop: [
      "No task is due on this tick → no-op.",
      "Task disabled / removed → not scheduled.",
    ],
    escalate: [
      "HITL-gated tasks pause for owner approval before acting; fail-closed safety outcomes route to the owner.",
    ],
    authority: "mutating",
    failMode: "closed",
    verifier: "independent",
    spend: "bounded",
  },
];

/** Lookup by id. */
export function getLoopContract(id: string): LoopContract | undefined {
  return LOOP_CONTRACTS.find((c) => c.id === id);
}

// ─── Completeness gate ───────────────────────────────────────────────────────
// The contract list is only a real forcing function if a NEW autonomous loop
// can't be added without a contract. `auditLoopCoverage` derives the live set of
// `.replit` workflows and fails when an agentic loop has no contract. The only
// way to exclude a workflow is to name it in NON_LOOP_WORKFLOWS below — a curated,
// reviewed decision, not a silent omission.

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPLIT_PATH = path.resolve(MODULE_DIR, "..", ".replit");

/**
 * `.replit` workflows that are intentionally NOT autonomous agentic loops
 * (the dev server + build/maintenance tasks). Anything here is exempt from the
 * coverage gate; everything else must have a LoopContract.
 */
export const NON_LOOP_WORKFLOWS: string[] = [
  "Project",            // run-button umbrella that launches the others in parallel — not a loop
  "Start application",  // the app server
  "typecheck",          // build-time type check
  "lockfile-resync",    // dependency maintenance task
];

/**
 * Curated inventory of autonomous loops that run IN-PROCESS rather than as a
 * `.replit` workflow (so they have `workflow: null` in their contract).
 *
 * Why a curated list and not a code-scan: there is no machine-readable source of
 * truth for in-process loops the way `.replit` is for workflows. The codebase has
 * ~77 `setInterval` sites, but the overwhelming majority are watchdogs, polling,
 * timeouts, debounces and keepalives — NOT autonomous decide-act-observe loops.
 * A code-scan gate over those would be almost entirely false positives (a ~77-entry
 * exclude list = the exact stale-doc theater this contract system exists to prevent).
 * So the reviewed boundary for in-process loops is THIS list: adding an in-process
 * loop means adding its id here, which forces a matching contract (and vice-versa).
 * This parity is checkable even when `.replit` is absent (e.g. the prod bundle),
 * because both sides are in-code constants.
 */
export const IN_PROCESS_LOOPS: string[] = [
  "heartbeat-scheduled-tasks",
  "bwb-weekly-render",
];

export interface LoopCoverage {
  /** false when `.replit` is absent (e.g. prod bundle) — the WORKFLOW side can't be checked. */
  checked: boolean;
  /** All workflow names found in `.replit`. */
  workflows: string[];
  /** Agentic-loop workflows with no contract (ERROR — the forcing-function gap). */
  missing: string[];
  /** Contracts naming a workflow that no longer exists in `.replit` (WARN — stale). */
  orphan: string[];
  /** IN_PROCESS_LOOPS ids with no matching contract (ERROR). Always checkable. */
  missingInProcess: string[];
  /** In-process contracts (workflow: null) whose id is not in IN_PROCESS_LOOPS (WARN). */
  orphanInProcess: string[];
}

/** Parse the workflow names declared in a `.replit` file. Exported for regression tests. */
export function parseReplitWorkflowNames(raw: string): string[] {
  const names: string[] = [];
  let inWorkflow = false;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("[[workflows.workflow]]")) {
      inWorkflow = true;
      continue;
    }
    if (t.startsWith("[")) {
      inWorkflow = false; // entered a sub-table or new section
      continue;
    }
    if (inWorkflow) {
      const m = t.match(/^name\s*=\s*["']((?:[^"'\\]|\\.)*)["']/);
      if (m) {
        names.push(m[1]);
        inWorkflow = false; // one name per workflow block
      }
    }
  }
  return names;
}

/**
 * Cross-check the contract registry against the live `.replit` workflows.
 * Used by both the Loop Doctor (`scripts/loop-contract-audit.ts`) and the CI
 * test so the completeness rule has a single source of truth.
 */
export function auditLoopCoverage(replitPath: string = DEFAULT_REPLIT_PATH): LoopCoverage {
  // In-process parity is independent of `.replit` — both sides are in-code constants,
  // so it is always checkable (including in the prod bundle where `.replit` is absent).
  const inProcessContractIds = new Set(
    LOOP_CONTRACTS.filter((c) => c.workflow == null).map((c) => c.id),
  );
  const inventory = new Set(IN_PROCESS_LOOPS);
  const missingInProcess = IN_PROCESS_LOOPS.filter((id) => !inProcessContractIds.has(id));
  const orphanInProcess = [...inProcessContractIds].filter((id) => !inventory.has(id));

  if (!fs.existsSync(replitPath)) {
    return {
      checked: false,
      workflows: [],
      missing: [],
      orphan: [],
      missingInProcess,
      orphanInProcess,
    };
  }
  const workflows = parseReplitWorkflowNames(fs.readFileSync(replitPath, "utf8"));
  const contracted = new Set(
    LOOP_CONTRACTS.map((c) => c.workflow).filter((w): w is string => !!w),
  );
  const excluded = new Set(NON_LOOP_WORKFLOWS);
  const missing = workflows.filter((w) => !excluded.has(w) && !contracted.has(w));
  const orphan = [...contracted].filter((w) => !workflows.includes(w));
  return { checked: true, workflows, missing, orphan, missingInProcess, orphanInProcess };
}
