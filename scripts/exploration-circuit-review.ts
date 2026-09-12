/**
 * Exploration circuit-breaker jury review (Bob 2026-06-28).
 *
 * The memory exploration ranker runs ON by default. If it misbehaves at
 * runtime, a circuit breaker AUTO-DISABLES it and persists a "pending review"
 * trip to data/exploration-circuit.json. This script lets the 3-model jury
 * adjudicate whether that auto-off was VALID:
 *
 *   • jury ACCEPT  ⇒ disabling was correct ⇒ confirmExplorationCircuitOff()
 *                    (status confirmed-off; stays off across reboots).
 *   • jury REJECT  ⇒ false alarm ⇒ resetExplorationCircuit("cleared-by-jury")
 *                    (re-enables on the app's next boot — benefit of the doubt).
 *   • jury FIX/ESCALATE ⇒ leave the trip pending and notify the owner.
 *
 * This process is SEPARATE from the running app: it can only update the
 * persisted circuit file. The running app re-reads that file at boot, so a
 * re-enable takes effect on the next restart/deploy (acceptable for a rare
 * safety event).
 *
 * One-line agent-runnable, no prompts, env-configured, meaningful exit codes:
 *   0  = nothing to review, OR a verdict was applied successfully
 *   3  = jury ran but produced no parseable verdict
 *   4  = jury spawn failed
 *   5  = FIX/ESCALATE — left pending, owner notified (action may be required)
 *
 *   npx tsx scripts/exploration-circuit-review.ts
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getExplorationCircuitState,
  resetExplorationCircuit,
  confirmExplorationCircuitOff,
} from "../server/memory-ranking";

/**
 * Pure parser for the jury CLI's stdout. jury-triage.ts prints a line like
 * `Verdict: ACCEPT (majority 3/3)`. Returns the upper-case verdict token or
 * null if no parseable verdict line is present. Exported for regression tests.
 */
export function parseJuryVerdict(stdout: string): string | null {
  const m = stdout.match(/^Verdict:\s*([A-Z]+)/m);
  return m?.[1] ?? null;
}

/** Map a parsed verdict to this script's exit code (0 applied / 3 unparseable / 5 needs-attention). */
export function exitCodeForVerdict(verdict: string | null): 0 | 3 | 5 {
  if (verdict === "ACCEPT" || verdict === "REJECT") return 0;
  if (!verdict) return 3;
  return 5; // FIX / ESCALATE / anything else
}

function buildIssueMarkdown(reason: string, trippedAt: string | null): string {
  return `# Issue: memory exploration was auto-disabled — was that valid?

The memory-ranking **exploration** feature (Stage 1 SA-CTS cold-start bonus)
runs **ON by default**. Its safety **circuit breaker auto-disabled** it at
runtime after detecting misbehaviour.

- **Trip reason:** ${reason || "(unspecified)"}
- **Tripped at:** ${trippedAt || "(unknown)"}

## What this issue asserts

Keeping exploration **DISABLED** is the correct, safe action until the
underlying fault is understood — i.e. the auto-off was a TRUE positive.

## How to vote

- **ACCEPT** — the auto-off was valid; exploration genuinely misbehaved and
  should stay disabled.
- **REJECT** — this was a **false alarm**; exploration should be re-enabled
  (it runs ON by default, benefit of the doubt).
- **FIX / ESCALATE** — needs human attention; leave it disabled and notify the
  owner.

Exploration only ever adds a small, confidence/quality-respecting cold-start
bonus to brand-new memories; the breaker can only ever turn it OFF, never on.
`;
}

// jury-triage.ts already routes ESCALATE to owner-notification internally; this
// is the belt-and-suspenders surface so a FIX/ESCALATE never passes silently.
function notifyOwner(subject: string, body: string): void {
  console.error(`[exploration-circuit-review] OWNER ALERT: ${subject}\n${body}`);
}

async function main(): Promise<number> {
  const state = getExplorationCircuitState();

  if (state.status !== "tripped-pending-review") {
    console.log(
      `[exploration-circuit-review] nothing to review (status=${state.status}, tripped=${state.tripped}).`,
    );
    return 0;
  }

  const reason = state.reason || "(unspecified)";
  console.log(`[exploration-circuit-review] pending trip detected — reason: ${reason}`);

  // Write the issue to a temp file for the jury CLI.
  const tmpDir = join(process.cwd(), "data", "jury-decisions");
  try {
    mkdirSync(tmpDir, { recursive: true });
  } catch {
    /* dir may already exist */
  }
  const issuePath = join(tmpDir, `exploration-circuit-review-${Date.now()}.md`);
  writeFileSync(issuePath, buildIssueMarkdown(reason, state.trippedAt));

  // Run the 3-model jury.
  const res = spawnSync("npx", ["tsx", "scripts/jury-triage.ts", `--issue-file=${issuePath}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env,
  });

  if (res.error || res.status !== 0 || !res.stdout) {
    console.error(
      `[exploration-circuit-review] jury spawn failed (status=${res.status}, error=${res.error?.message ?? "none"}). Leaving trip pending.`,
    );
    return 4;
  }

  process.stdout.write(res.stdout);

  const verdict = parseJuryVerdict(res.stdout);
  if (!verdict) {
    console.error("[exploration-circuit-review] could not parse a Verdict from jury output. Leaving trip pending.");
    return 3;
  }

  if (verdict === "ACCEPT") {
    confirmExplorationCircuitOff(`jury ACCEPT — auto-off valid: ${reason}`);
    console.log("[exploration-circuit-review] jury ACCEPT ⇒ exploration stays OFF (confirmed-off).");
    return 0;
  }

  if (verdict === "REJECT") {
    resetExplorationCircuit(`jury REJECT — false alarm: ${reason}`);
    console.log(
      "[exploration-circuit-review] jury REJECT ⇒ false alarm; exploration re-enabled on next app boot (cleared-by-jury).",
    );
    return 0;
  }

  // FIX / ESCALATE — leave pending, notify owner.
  notifyOwner(
    `[VisionClaw] Exploration circuit ${verdict} — needs attention`,
    `The memory exploration circuit breaker tripped (reason: ${reason}) and the jury returned ${verdict}.\n` +
      `Exploration remains DISABLED pending review. Inspect data/exploration-circuit.json and the jury decision log under data/jury-decisions/.`,
  );
  console.log(`[exploration-circuit-review] jury ${verdict} ⇒ left pending, owner notified.`);
  return 5;
}

// Only auto-run when invoked directly as a script — importing this module
// (e.g. from a regression test for parseJuryVerdict) must NOT execute main().
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`[exploration-circuit-review] fatal: ${e?.message || e}`);
      process.exit(1);
    });
}
