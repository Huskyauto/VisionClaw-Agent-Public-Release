/**
 * Read-only evidence report for VisionClaw's demonstrated improvement ability.
 *
 * This intentionally measures existing Skill Optimizer records. It never calls
 * a model, writes state, exposes candidate prompt content, or changes promotion
 * authority. Current schema can support L0-L3 claims only; L4/L5 remain
 * insufficient-evidence until repeated version-bound held-out cohorts exist.
 *
 * Usage:
 *   npx tsx scripts/improvement-evidence-report.ts
 *   npx tsx scripts/improvement-evidence-report.ts --json --limit 50
 *   npx tsx scripts/improvement-evidence-report.ts --skill-id 123
 */
import {
  buildImprovementEvidenceCliPayload,
} from "../server/lib/improvement-evidence-report";

function positiveIntArg(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be followed by a positive integer`);
  }
  return value;
}

async function main(): Promise<void> {
  const limit = Math.min(positiveIntArg("--limit") ?? 100, 500);
  const skillId = positiveIntArg("--skill-id");
  const json = process.argv.includes("--json");
  const payload = await buildImprovementEvidenceCliPayload({ limit, skillId });
  const { summary, reports } = payload;

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  console.log("VisionClaw Improvement Evidence Report");
  console.log(`Candidates evaluated: ${summary.evaluatedCandidates}`);
  console.log(`Highest supported level: L${summary.highestEvidenceLevel}`);
  console.log(`Bound held-out gains demonstrated: ${summary.demonstratedBoundHeldOutGains}`);
  console.log(`Validated promotions: ${summary.validatedPromotions}`);
  console.log("Persistent inherited gains demonstrated: 0 (insufficient evidence)");
  console.log(`Claim: ${summary.abilityClaim}`);
  for (const report of reports) {
    const closed = report.currentTask.headroomClosed === null
      ? "n/a"
      : `${(report.currentTask.headroomClosed * 100).toFixed(1)}%`;
    console.log(
      `- #${report.candidateId} ${report.label}: L${report.evidenceLevel} ${report.levelName}; ` +
      `headroom closed=${closed}; persistence=${report.persistentInheritance.status}`,
    );
  }
}

main().catch((error) => {
  console.error("[improvement-evidence-report] failed:", error);
  process.exitCode = 1;
});