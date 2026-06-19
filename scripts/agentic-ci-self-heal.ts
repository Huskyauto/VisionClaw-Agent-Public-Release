// ─────────────────────────────────────────────────────────────────────────────
// Agentic CI Self-Healer
// ─────────────────────────────────────────────────────────────────────────────
// Polls GitHub Actions for the latest CI run on main. If failed, pulls the
// failed-job logs, classifies the failure against a pattern registry, runs the
// matching auto-fix, verifies locally, and lets the Auto Git Push workflow
// commit + push the result.
//
// Bob's directive (May 3 2026):
//   "The whole goal of being an agentic system is when the system finds an
//    error it auto repairs itself. Stop emailing me 'I got an error and I
//    don't know how to fix it.' Build a repair solution that runs on the
//    back end so the end user doesn't see any type of errors."
//
// What this does:
//   1. Polls GitHub Actions every POLL_SECONDS (default 120s)
//   2. If the latest run is failure on main AND we haven't already healed it,
//      fetches the failed job's logs.
//   3. Walks the FIX_REGISTRY in order. First pattern that matches the log
//      runs its fix command, then runs its verify command.
//   4. On success: writes state, leaves the file changes for Auto Git Push.
//      Sends a "self-healed" email (single, not spammy) to OWNER_ALERT_EMAIL
//      describing what was fixed and how.
//   5. On unmatched failure: sends a single "needs human attention" email
//      with the failure signature so we can grow the FIX_REGISTRY next round.
//      Throttled to one email per (run_id, signature) pair so Bob doesn't
//      get repeats.
//
// State file: /tmp/ci-self-heal-state.json (per-process; intentionally not
// in the repo to avoid auto-push churn).
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import { execSync, spawnSync } from "child_process";
import { sanitizeSpawnEnv } from "../server/safety/spawn-env-guard";
import { computeRevertSet } from "./lib/heal-revert-set";

// Defense-in-depth (architect MEDIUM, 2026-06-09): this is a privileged
// automation path that shells out repeatedly. Scrub loader-hijack vectors
// (LD_PRELOAD, DYLD_*, NODE_OPTIONS, NODE_PATH, …) from the env handed to
// every child process so a poisoned parent env can't turn a verify/revert
// into code execution. Tokens/PATH are preserved.
const SAFE_ENV = sanitizeSpawnEnv(process.env);
import { getOrCreateTenantInbox, sendEmail } from "../server/email";
import { claimAutonomousBudget } from "../server/agentic/autonomous-budget";
import { waitForProductionClear } from "./lib/production-priority";

const REPO = process.env.GITHUB_REPO || "Huskyauto/VisionClaw-Agent";
const TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN_2 || process.env.GITHUB_TOKEN || "";
const OWNER_EMAIL =
  process.env.OWNER_ALERT_EMAIL ||
  process.env.OWNER_EMAIL ||
  process.env.SITE_OWNER_EMAIL ||
  process.env.SITE_CONTACT_EMAIL ||
  "";
const POLL_SECONDS = parseInt(process.env.CI_HEAL_POLL_SECONDS || "120", 10);
const STATE_FILE = "/tmp/ci-self-heal-state.json";
const ONESHOT = process.argv.includes("--once");

interface FixRule {
  id: string;
  description: string;
  match: RegExp;
  fix: () => Promise<{ summary: string; touchedFiles: string[] }>;
  verify: string; // shell command; non-zero exit = verify fail
}

// ───────────────────────────────────────────────────────────────────────────
// FIX REGISTRY — grow this every time CI surfaces a new fixable pattern.
// Order matters: first match wins.
// ───────────────────────────────────────────────────────────────────────────
const FIX_REGISTRY: FixRule[] = [
  {
    id: "stale-string-preflight",
    description: "Stale-string preflight gate (R110.12) — surface marketing-string drift; fail-loud only (no auto-edit). Bumps human attention without silently rewriting customer-facing copy.",
    match: /preflight-stale.*FAIL|stale string\(s\) found/,
    fix: async () => {
      // Intentionally NO auto-fix: rewriting marketing copy automatically
      // is a brand-risk surface (per replit.md "Ask before major architectural
      // changes"). Re-run the gate to capture findings into the email digest;
      // human fixes them in a website-surface-sync pass.
      let findings = "";
      try {
        findings = execSync("npx tsx scripts/preflight-stale-strings.ts --json 2>&1 || true", { encoding: "utf8", env: SAFE_ENV });
      } catch (err: any) {
        findings = `gate-rerun-failed: ${err?.message || err}`;
      }
      return {
        summary: `Stale-string preflight surfaced drift — NOT auto-fixed (brand-risk surface). Findings:\n${findings.slice(0, 4000)}\n\nRun a website-surface-sync pass + re-run gate.`,
        touchedFiles: [],
      };
    },
    verify: "true", // Don't block CI on this rule; the email digest IS the fix.
  },
  {
    id: "silent-catch-burndown",
    description: "Empty catch blocks in server/ — auto-seal with logSilentCatch",
    match: /no empty catch blocks in server.*not ok|Empty catch blocks hide bugs/,
    fix: async () => {
      const before = listEmptyCatchFiles();
      execSync("node scripts/seal-silent-catches.mjs", { stdio: "pipe", env: SAFE_ENV });
      const after = listEmptyCatchFiles();
      const touched = before.filter(f => !after.includes(f));
      // Patch missing logSilentCatch imports if TS check fails after seal
      patchMissingLogSilentCatchImports();
      return {
        summary: `Sealed ${touched.length} empty catch block(s) in: ${touched.join(", ")}`,
        touchedFiles: touched,
      };
    },
    verify: "node --import tsx --test tests/safety/no-silent-catch.test.ts && npm run check",
  },
  {
    id: "missing-logSilentCatch-import",
    description: "TS error: Cannot find name 'logSilentCatch' — inject import",
    match: /TS2304: Cannot find name 'logSilentCatch'/,
    fix: async () => {
      const touched = patchMissingLogSilentCatchImports();
      return { summary: `Injected logSilentCatch import in ${touched.length} file(s)`, touchedFiles: touched };
    },
    verify: "npm run check",
  },
  {
    // R98.25 — bundleHash drift after a SKILL.md edit is a deliberate update
    // by the agent; the registry manifest is the authority and re-hashing is
    // the documented refresh path. Safe to auto-heal: this only re-records
    // hashes of files the agent itself edited; it does NOT bypass the LLM
    // audit (flagged-review skills still fail validate even after manifest).
    id: "skill-registry-bundlehash-drift",
    description: "Skill registry bundleHash drift after deliberate SKILL.md edit — refresh manifest",
    match: /bundleHash drift for skill|Skill registry validation FAILED/,
    fix: async () => {
      const out = execSync("npx tsx scripts/skills-registry.ts manifest 2>&1", { encoding: "utf8", env: SAFE_ENV });
      const hashed = out.match(/(\d+) skill\(s\) hashed/)?.[1] ?? "?";
      return { summary: `Refreshed skill manifest (${hashed} skills hashed)`, touchedFiles: [".agents/skills/_registry.json"] };
    },
    verify: "npx tsx scripts/skills-registry.ts validate",
  },
  {
    // R98.25 — sql.raw / sql.identifier callsite snapshot drift is a SECURITY
    // guard. We do NOT auto-update the baseline (that would defeat the point).
    // Instead we surface the diff in a structured email so the human review
    // is one copy-paste, not an investigation. The "fix" emits a diff and
    // intentionally returns no touchedFiles so verify fails and the human is
    // re-notified — but with actionable text instead of a raw test failure.
    id: "sql-raw-callsite-snapshot-drift",
    description: "sql.raw / sql.identifier callsite snapshot drift — emit diff for human review (NEVER auto-update baseline)",
    // R115.6 — must require `not ok` prefix: the bare test name appears in
    // TAP output for BOTH passing AND failing runs as the subtest header
    // ("# Subtest: ...") and the result line ("ok N - ..."), so the prior
    // pattern matched any CI failure log that incidentally ran this test
    // (e.g. an unrelated security suite failure) and mis-routed it here.
    match: /not ok \d+ - sql\.(raw|identifier) callsites match the audited content snapshot/,
    fix: async () => {
      let diff = "";
      try {
        diff = execSync("node --import tsx --test tests/security/sql-raw-callsite-allowlist.test.ts 2>&1 | grep -E 'AssertionError|expected|actual|\\[\\+\\]|\\[-\\]' | head -60", { encoding: "utf8", env: SAFE_ENV });
      } catch (e) { diff = (e as any)?.stdout?.toString?.() ?? "(no diff captured)"; }
      return {
        summary: `sql.raw/sql.identifier baseline drift detected — REVIEW REQUIRED. Diff:\n\n${diff}\n\nUpdate SQL_RAW_BASELINE / SQL_IDENTIFIER_BASELINE in tests/security/sql-raw-callsite-allowlist.test.ts after auditing each new callsite for tainted input.`,
        touchedFiles: [],
      };
    },
    verify: "false", // intentionally fails so the rule re-emails next run if not addressed
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────
function listEmptyCatchFiles(): string[] {
  try {
    const out = execSync("node scripts/seal-silent-catches.mjs --check", { encoding: "utf8", env: SAFE_ENV });
    return out.split("\n").filter(l => /^\s+\d+\s+server\//.test(l)).map(l => l.trim().split(/\s+/)[1]);
  } catch { return []; }
}

function patchMissingLogSilentCatchImports(): string[] {
  let touched: string[] = [];
  try {
    const tscOut = execSync("npx tsc --noEmit 2>&1 || true", { encoding: "utf8", env: SAFE_ENV });
    const offenders = new Set<string>();
    for (const line of tscOut.split("\n")) {
      const m = line.match(/^(server\/[^\s(]+)\(\d+,\d+\): error TS2304: Cannot find name 'logSilentCatch'/);
      if (m) offenders.add(m[1]);
    }
    for (const file of offenders) {
      if (!fs.existsSync(file)) continue;
      const src = fs.readFileSync(file, "utf8");
      if (/from ['"][^'"]*silent-catch['"]/.test(src)) continue;
      const importPath = file.startsWith("server/lib/") ? "./silent-catch" : "./lib/silent-catch";
      const importLine = `import { logSilentCatch } from "${importPath}";`;
      const importMatch = src.match(/^import [^\n]+;$/m);
      let next: string;
      if (importMatch) {
        next = src.replace(importMatch[0], importMatch[0] + "\n" + importLine);
      } else {
        // Inject after the file's leading header comment block
        const headerEnd = src.search(/\n(?!\/\/|\s*$)/);
        const insertAt = headerEnd >= 0 ? headerEnd + 1 : 0;
        next = src.slice(0, insertAt) + "\n" + importLine + "\n" + src.slice(insertAt);
      }
      fs.writeFileSync(file, next);
      touched.push(file);
    }
  } catch (e) {
    console.warn("[heal] patch import probe failed:", (e as Error).message);
  }
  return touched;
}

interface State {
  healedRuns: Record<string, { id: string; ruleId: string; healedAt: string; summary: string }>;
  notifiedRuns: Record<string, string>; // run_id → signature, for un-fixable
}
function loadState(): State {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { healedRuns: {}, notifiedRuns: {} }; }
}
function saveState(s: State) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

async function gh(path: string): Promise<any> {
  if (!TOKEN) throw new Error("No GitHub token in env (GITHUB_PERSONAL_ACCESS_TOKEN_2 or GITHUB_TOKEN)");
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`GitHub ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}
async function ghLogs(jobId: number): Promise<string> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/jobs/${jobId}/logs`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" }, redirect: "follow",
  });
  if (!r.ok) return "";
  return r.text();
}

async function notifyHealed(runId: string, runUrl: string, rule: FixRule, summary: string, verifyOk: boolean) {
  if (!OWNER_EMAIL) {
    console.warn("[heal] notify-healed skipped: no OWNER_ALERT_EMAIL/OWNER_EMAIL/SITE_OWNER_EMAIL/SITE_CONTACT_EMAIL configured");
    return;
  }
  try {
    const inboxResult = await getOrCreateTenantInbox(1);
    const inboxId = typeof inboxResult === "string" ? inboxResult : (inboxResult as any).inboxId || (inboxResult as any).email;
    await sendEmail({
      inboxId, to: OWNER_EMAIL,
      subject: `CI self-healed: ${rule.id} (run ${runId})`,
      text: `VisionClaw CI failure auto-repaired.

Run: ${runUrl}
Rule: ${rule.id}
Description: ${rule.description}
Action: ${summary}
Local verify: ${verifyOk ? "PASS" : "PASS (degraded — reached here only because R125+12+sec fail-closed gate let it through; investigate notifyHealed call path)"}

Auto Git Push will commit + push within 90s. No action required.

— Agentic CI Self-Healer`,
    });
  } catch (e) { console.warn("[heal] notify-healed failed:", (e as Error).message); }
}

async function notifyUnfixable(runId: string, runUrl: string, signature: string, snippet: string, fullLog?: string, ruleId?: string) {
  // R125+3.6 — before emailing Bob for human review, ask the 3-model jury.
  // 2-of-3 majority on FIX/ACCEPT/REJECT may resolve the failure without
  // human input. Verdicts are logged to data/jury-decisions/queue.json;
  // the email still fires so Bob has the final signal, but it includes the
  // jury verdict so he can rubber-stamp or override quickly.
  let juryLine = "";
  let juryDecision: any = null;
  try {
    const { juryTriage } = await import("../server/lib/jury-triage");
    const d = await juryTriage({
      issueText: `CI failure (run ${runId}, signature ${signature}).\n\nFirst failing chunk:\n${snippet}`,
      context: `Source: ${runUrl}\nAgentic CI Self-Healer has no auto-fix rule for this signature.`,
      tenantId: 1,
      invokedVia: "ci-self-heal-noop",
    });
    juryDecision = d;
    juryLine = `\n\nJURY VERDICT: ${d.verdict} (majority ${d.majority}/3, κ=${d.concordance?.toFixed(3) ?? "n/a"}${d.shouldEscalate ? ", ESCALATE" : ""})\n` +
      d.votes.map(v => `  · ${v.model}: ${v.verdict} — ${v.rationale.slice(0, 200).replace(/\n/g, " ")}`).join("\n") +
      (d.fixProposal ? `\n\nFix proposal (NL, advisory only):\n${d.fixProposal.slice(0, 1500)}` : "");
    // R125+3.6+sec.1 — auto-apply seam (queue.json) is GATED behind JURY_AUTOAPPLY=1.
    // Default OFF protects forks / public-mirror users. The jury verdict is still
    // included in the owner email above as ADVISORY text; only the machine-readable
    // queue.json (the implementer-pickup seam) stays dark unless explicitly opted-in.
    if (process.env.JURY_AUTOAPPLY === "1") {
      try {
        // HIGH-1 (fable-5): stamp the entry with an HMAC `_sig` (no-op when no
        // JURY_QUEUE_HMAC_SECRET is set) so the drainer's opt-in forgery gate
        // recognizes this as producer-authored.
        const { signQueueEntry } = await import("../server/agentic/jury-queue-integrity");
        // MEDIUM closed 2026-06-10: append via the shared lock-coordinated store so
        // a concurrent producer/drainer write never clobbers this entry (the old
        // inline read→push→tmp+rename was atomic per-write but not serialized
        // across writers — overlapping appends dropped to last-writer-wins).
        const { appendQueueEntries } = await import("../server/agentic/jury-queue-store");
        appendQueueEntries([signQueueEntry({
          triagedAt: new Date().toISOString(),
          tenantId: 1,
          source: `ci-failure:${runId}`,
          issueSlug: `ci-${runId}`,
          verdict: d.verdict,
          majority: d.majority,
          concordance: d.concordance,
          shouldEscalate: d.shouldEscalate,
          fixProposal: d.fixProposal,
          ...(d.fixProposal ? { fixProposalUntrusted: true } : {}),
          votes: d.votes.map(v => ({ model: v.model, verdict: v.verdict, rationale: v.rationale })),
        })]);
        // Bob 2026-06-04 autonomy upgrade: tell Bob whether the queued verdict
        // will actually be acted on (Repo Surgeon enabled) or is advisory-only.
        juryLine += process.env.REPAIR_AUTOFIX_ENABLED === "1"
          ? `\n\n(Auto-apply ON + Repo Surgeon ENABLED: verdict queued to data/jury-decisions/queue.json; a test-gated fix will be attempted and rolled back on red. You only get a follow-up if it can't fix it.)`
          : `\n\n(Auto-apply ON: verdict queued to data/jury-decisions/queue.json. Set REPAIR_AUTOFIX_ENABLED=1 to let Repo Surgeon attempt the fix automatically.)`;
      } catch (qe) { console.warn("[heal] jury-queue write failed:", (qe as Error).message); }
    } else {
      juryLine += `\n\n(Auto-apply gate: JURY_AUTOAPPLY is not set to "1" — verdict shown above is advisory only; no queue entry written.)`;
    }
  } catch (je) {
    juryLine = `\n\n(jury-triage failed: ${(je as Error).message?.slice(0, 200)})`;
  }

  // Repo Surgeon (#51): emit a structured incident for the unified classifier.
  // Reuses the jury decision already computed above so the jury isn't paid for
  // twice. Best-effort — never break the notify path. Protected CI rules
  // (sql.raw drift, stale-string, ahb-regression) classify as safety_guard and
  // are never routed to an automated code fix.
  try {
    const { captureIncident } = await import("../server/agentic/repair-incident");
    // Timeout-bounded so a hung DB/jury can never stall the owner notification.
    const capture = captureIncident({
      tenantId: 1,
      source: "ci_self_heal",
      title: `CI failure (run ${runId})`.slice(0, 200),
      signature,
      // ONLY set ciRuleId to an actual rule identifier (passed by callers that
      // matched a FIX_REGISTRY rule). For the no-rule-matched path it stays
      // undefined — `signature` is free-form failure text (e.g. "FAIL
      // tests/security/...") and must NEVER be treated as a protected rule id.
      ciRuleId: ruleId,
      error: snippet,
      // Full combined CI job logs (not just the filtered snippet) so the
      // incident record carries complete failure context for tuning + the fixer.
      logs: fullLog || snippet,
      stage: "ci",
      precomputedJury: juryDecision,
      metadata: { runId, runUrl },
    });
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 15000));
    await Promise.race([capture, timeout]);
  } catch (ie) {
    console.warn("[heal] incident capture failed (non-fatal):", (ie as Error).message);
  }

  if (!OWNER_EMAIL) {
    console.warn("[heal] notify-unfixable skipped (no OWNER_*_EMAIL env). Jury verdict still written to data/jury-decisions/ if JURY_AUTOAPPLY=1.");
    return;
  }
  try {
    const inboxResult = await getOrCreateTenantInbox(1);
    const inboxId = typeof inboxResult === "string" ? inboxResult : (inboxResult as any).inboxId || (inboxResult as any).email;
    await sendEmail({
      inboxId, to: OWNER_EMAIL,
      subject: `CI failure NEEDS HUMAN: no auto-fix rule (run ${runId})`,
      text: `VisionClaw CI failed and the self-healer has no rule for it yet.

Run: ${runUrl}
Signature: ${signature}

First failing chunk:
${snippet}${juryLine}

Add a rule to scripts/agentic-ci-self-heal.ts FIX_REGISTRY so this auto-heals next time.

— Agentic CI Self-Healer (one email per run_id, no spam)`,
    });
  } catch (e) { console.warn("[heal] notify-unfixable failed:", (e as Error).message); }
}

async function tick(): Promise<void> {
  // NOTE: the autonomous-spend claim is deliberately NOT taken here. The vast
  // majority of 120s ticks are no-ops (green run / superseded / already-healed /
  // already-given-up) and reach no paid work — claiming up-front would orphan a
  // reservation on every idle poll and pile false pressure against the daily cap.
  // The claim is taken below, only once a genuine un-handled failure is confirmed.
  const state = loadState();
  const runs = await gh(`/repos/${REPO}/actions/runs?branch=main&per_page=3`);
  const latest = (runs.workflow_runs || []).find((r: any) => r.status === "completed");
  if (!latest) return;
  const runIdStr = String(latest.id);

  if (latest.conclusion === "success") {
    console.log(`[heal] latest run ${runIdStr} green — nothing to do`);
    return;
  }
  // A completed run can conclude as `cancelled` (Auto Git Push fires commits in
  // rapid succession and ci.yml's `concurrency: cancel-in-progress` supersedes
  // the older in-flight run), or `skipped`/`neutral`/`action_required` — none of
  // which are CI failures. Only `failure` and `timed_out` warrant the expensive
  // jobs+logs fetch and the fixer pipeline. Short-circuit everything else here
  // so a steady stream of superseded runs doesn't spam "failed — investigating"
  // (and burn a GH jobs API call) on every 120s poll.
  if (latest.conclusion !== "failure" && latest.conclusion !== "timed_out") {
    console.log(`[heal] latest run ${runIdStr} ${latest.conclusion ?? "incomplete"} (not a failure) — nothing to do`);
    return;
  }
  if (state.healedRuns[runIdStr]) {
    console.log(`[heal] run ${runIdStr} already healed (${state.healedRuns[runIdStr].ruleId})`);
    return;
  }
  // R115.6 — short-circuit re-investigation of runs we've already given up on.
  // notifiedRuns is set in the no-rule path AND the noop-heal path (line 333),
  // but BOTH were set AFTER doing the expensive GH-jobs+logs fetch and re-running
  // the fixer, so a stuck-failed historical run polled every 120s would re-fetch
  // logs and re-run the rule forever (just suppressing the email). Skip here
  // before any work happens.
  if (state.notifiedRuns[runIdStr]) {
    console.log(`[heal] run ${runIdStr} already investigated and given up on (${state.notifiedRuns[runIdStr]}) — skipping`);
    return;
  }

  console.log(`[heal] run ${runIdStr} failed — investigating`);
  // The jobs fetch is a cheap GH API read, not a spend — do it BEFORE claiming so a
  // failure with no actionable failed-job payload (e.g. a workflow-level failure)
  // never reserves budget. Stamp state so the same payload-less run isn't re-fetched
  // (and re-checked) on every 120s poll.
  const jobs = await gh(`/repos/${REPO}/actions/runs/${latest.id}/jobs`);
  const failedJobs = (jobs.jobs || []).filter((j: any) => j.conclusion === "failure");
  if (failedJobs.length === 0) {
    console.log(`[heal] run ${runIdStr} failed but exposed no failed jobs — nothing actionable`);
    state.notifiedRuns[runIdStr] = "no-failed-jobs";
    saveState(state);
    return;
  }

  // Paid work is now CERTAIN: an actionable failure drives the fixer/jury +
  // captureIncident. Atomic claim-before-spend reserves an estimate under a
  // per-tenant lock so a concurrent loop can't double-spend; over-budget skips
  // this run and the poll loop re-checks next interval (budget frees when spend
  // drops / the day rolls). Fails CLOSED unless AUTONOMOUS_BUDGET_FAILOPEN.
  const budget = await claimAutonomousBudget({ tenantId: 1, estimatedUsd: 1, label: "ci-self-heal" });
  if (!budget.ok) {
    console.warn(
      `[heal] budget gate: ${budget.reason} (spent $${budget.spentUsd.toFixed(2)} / cap $${budget.capUsd.toFixed(2)}) — skipping run ${runIdStr}`,
    );
    return;
  }

  // Concatenate logs from all failed jobs for pattern-matching
  let combined = "";
  for (const j of failedJobs) combined += `\n=== ${j.name} ===\n` + (await ghLogs(j.id));

  const rule = FIX_REGISTRY.find(r => r.match.test(combined));
  if (!rule) {
    const sig = (combined.match(/(?:not ok \d+ - [^\n]+|error TS\d+: [^\n]+|FAIL[^\n]+)/) || ["unclassified"])[0].slice(0, 200);
    if (state.notifiedRuns[runIdStr] === sig) return; // already told Bob
    const snippet = combined.split("\n").filter(l => /not ok|FAIL|Error|error TS|✗/.test(l)).slice(0, 8).join("\n");
    await notifyUnfixable(runIdStr, latest.html_url, sig, snippet, combined);
    state.notifiedRuns[runIdStr] = sig;
    saveState(state);
    return;
  }

  console.log(`[heal] applying rule ${rule.id}`);
  // Snapshot the working-tree dirty set BEFORE the fixer runs. The verify-fail
  // revert below uses this so it can NEVER roll back files that were already
  // uncommitted (e.g. a live editing session in the same workspace). Only files
  // the fixer ITSELF dirties become eligible for revert. If this snapshot fails
  // we cannot tell pre-existing dirt from fixer dirt, so the revert falls back
  // to the rule's self-reported touchedFiles only (never the git-dirty union).
  let preFixDirty = new Set<string>();
  let preFixSnapshotOk = false;
  try {
    const out = execSync("git status --porcelain", { encoding: "utf8", env: SAFE_ENV });
    preFixDirty = new Set(out.split("\n").map(l => l.slice(3).trim()).filter(Boolean));
    preFixSnapshotOk = true;
  } catch (e) {
    console.warn(`[heal] pre-fix git status failed: ${(e as Error).message}`);
  }
  // Strict live-edit protection (architect 2026-06-11): without a trustworthy
  // pre-fix snapshot we cannot guarantee a later verify-fail revert won't roll
  // back work that was ALREADY uncommitted. Rather than run the fixer and risk
  // it, fail CLOSED before any mutation — skip the auto-fix and route to the
  // dedup'd unfixable path so main is left untouched and Bob gets one email.
  // This makes "never revert in-progress edits" an absolute, not a best-effort.
  if (!preFixSnapshotOk) {
    const sig = `prefix-snapshot-unavailable:${rule.id}`;
    if (state.notifiedRuns[runIdStr] === sig) return;
    console.warn(`[heal] rule ${rule.id} matched but pre-fix git snapshot unavailable — skipping fix to protect the working tree; routing to unfixable`);
    await notifyUnfixable(runIdStr, latest.html_url, sig, `Rule '${rule.id}' matched the CI failure, but the self-healer could not snapshot the working tree (git status failed) before applying the fix. Skipped the auto-fix to avoid any risk of reverting in-progress edits. Manual look needed.`, combined, rule.id);
    state.notifiedRuns[runIdStr] = sig;
    saveState(state);
    return;
  }
  let summary = "";
  let touchedFiles: string[] = [];
  try {
    const result = await rule.fix();
    summary = result.summary;
    touchedFiles = result.touchedFiles || [];
    console.log(`[heal] fix done: ${summary}`);
  } catch (e) {
    console.error(`[heal] fix threw:`, e);
    return;
  }

  let verifyOk = true;
  try {
    execSync(rule.verify, { stdio: "pipe", env: SAFE_ENV });
    console.log(`[heal] verify PASS`);
  } catch (e) {
    verifyOk = false;
    console.warn(`[heal] verify FAIL`);
  }

  // R109.3-fix — Bob May 10 2026: stop the false-heal loop. If a rule matches
  // but its fixer touches 0 files AND verify also fails, recording the run as
  // "healed" lets the same CI failure re-fire on the next push (Auto Git Push
  // commits nothing meaningful, GitHub re-runs CI, GitHub emails Bob again,
  // ad infinitum). Treat zero-touch + verify-fail as unfixable instead, so
  // the run goes through the dedup'd notifyUnfixable path (one email per
  // signature, not one per CI run) and the loop dies on its own.
  // Exception: rules that intentionally touch zero files (e.g. sql.raw
  // baseline drift) declare verify="false" and live in the notify path.
  const noopHeal = touchedFiles.length === 0 && !verifyOk;
  if (noopHeal) {
    const sig = `noop-heal:${rule.id}`;
    if (state.notifiedRuns[runIdStr] === sig) return;
    console.warn(`[heal] rule ${rule.id} matched but touched 0 files AND verify failed — emitting unfixable, NOT recording as healed`);
    await notifyUnfixable(runIdStr, latest.html_url, sig, `Rule '${rule.id}' matched the failure log but its fixer found nothing to touch. Likely the failure is a different instance of the same error class than the rule was written for, OR the underlying issue was already fixed by a parallel commit. Manual look needed: ${summary || "(no summary)"}`, combined, rule.id);
    state.notifiedRuns[runIdStr] = sig;
    saveState(state);
    return;
  }

  // R125+12+sec (architect HIGH closed 2026-05-24): fail-CLOSED when the
  // fixer touched files but verify FAILED. Previously this still recorded
  // the run as healed and emitted "FAIL — pushed anyway", which let broken
  // auto-fixes land via Auto Git Push (typecheck/test bypass). Now we revert
  // the touched files and route to notifyUnfixable so Bob gets one email
  // and nothing bad ships.
  // R125+13.3+sec (architect HIGH closed 2026-05-24): revert based on the
  // REAL git working-tree diff, not just the rule-reported `touchedFiles` list.
  // Some rules (e.g. silent-catch-burndown -> patchMissingLogSilentCatchImports)
  // mutate additional files that they don't report; reverting only the reported
  // list left dirty state behind.
  // Live-editing-session protection (Bob 2026-06-11): the dirty set is now
  // diffed against the pre-fix snapshot so the revert only ever touches files
  // the FIXER dirtied — never files that were already uncommitted when the
  // healer started. Previously this reverted the union of touchedFiles and ALL
  // git-dirty files, which could roll back an in-progress editing session.
  if (!verifyOk) {
    const sig = `verify-fail-after-touch:${rule.id}`;
    if (state.notifiedRuns[runIdStr] === sig) return;
    let postFixDirty: string[] = [];
    try {
      const out = execSync("git status --porcelain", { encoding: "utf8", env: SAFE_ENV });
      postFixDirty = out.split("\n").map(l => l.slice(3).trim()).filter(Boolean);
    } catch (e) { console.warn(`[heal] git status failed pre-revert: ${(e as Error).message}`); }
    // Only revert files the FIXER dirtied: post-fix dirty MINUS the pre-fix
    // snapshot. Files already uncommitted before the healer ran (a live editing
    // session) are excluded by construction, so the healer can no longer roll
    // back work in progress — including a rule-reported touchedFile that happened
    // to already be dirty. preFixSnapshotOk is guaranteed true here (the
    // snapshot-unavailable case fails closed above before rule.fix() runs); the
    // flag is passed through to the pure helper for defence + test coverage.
    const revertSet = computeRevertSet({ touchedFiles, postFixDirty, preFixDirty, preFixSnapshotOk });
    console.warn(`[heal] rule ${rule.id} verify FAILED; reverting ${revertSet.length} fixer-dirtied file(s) (protected ${preFixDirty.size} pre-existing dirty file(s)) and routing to unfixable (no push, no healed-state)`);
    for (const f of revertSet) {
      // Argument-array spawnSync (shell:false): a filename from `git status`
      // is attacker-influenceable in a poisoned repo, and JSON.stringify does
      // NOT neutralize `$(...)`/backtick shell expansion inside double quotes.
      // Passing the path as a discrete argv element means it can never be
      // interpreted as a shell command. `--` stops a filename like `-rf` being
      // read as a flag.
      const checkout = spawnSync("git", ["checkout", "--", f], { stdio: "pipe", env: SAFE_ENV });
      if (checkout.status !== 0) {
        const clean = spawnSync("git", ["clean", "-f", "--", f], { stdio: "pipe", env: SAFE_ENV });
        if (clean.status !== 0) {
          console.warn(`[heal] revert failed for ${f}: ${clean.stderr?.toString().slice(0, 200) || "unknown error"}`);
        }
      }
    }
    await notifyUnfixable(
      runIdStr,
      latest.html_url,
      sig,
      `Rule '${rule.id}' touched ${touchedFiles.length} file(s) but verify FAILED. Reverted to keep main green. Summary: ${summary || "(none)"}\n\nFiles attempted: ${touchedFiles.join(", ")}`,
      combined,
      rule.id,
    );
    state.notifiedRuns[runIdStr] = sig;
    saveState(state);
    return;
  }

  state.healedRuns[runIdStr] = { id: runIdStr, ruleId: rule.id, healedAt: new Date().toISOString(), summary };
  saveState(state);
  await notifyHealed(runIdStr, latest.html_url, rule, summary, verifyOk);
}

(async () => {
  if (ONESHOT) { await waitForProductionClear({ label: "agentic-ci-self-heal" }); await tick(); process.exit(0); }
  console.log(`[heal] agentic CI self-healer online — polling every ${POLL_SECONDS}s`);
  while (true) {
    // Stand down for the duration of any BWB production run before EACH tick — the
    // healer rewrites the working tree, which must not race a render reading files.
    await waitForProductionClear({ label: "agentic-ci-self-heal" });
    try { await tick(); }
    catch (e) { console.error("[heal] tick error:", (e as Error).message); }
    await new Promise(r => setTimeout(r, POLL_SECONDS * 1000));
  }
})();
