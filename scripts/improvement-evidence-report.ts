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
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { ADMIN_TENANT_ID } from "../server/tenant-constants";
import {
  skillOptimizationCandidates,
  skillOptimizationVersions,
} from "../shared/schema";
import {
  evaluateImprovementEvidence,
  summarizeImprovementEvidence,
  type ImprovementVersionEvidence,
} from "../server/lib/improvement-evidence-evaluator";

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
  const candidateWhere = skillId
    ? and(
        eq(skillOptimizationCandidates.tenantId, ADMIN_TENANT_ID),
        eq(skillOptimizationCandidates.skillId, skillId),
      )
    : eq(skillOptimizationCandidates.tenantId, ADMIN_TENANT_ID);

  // Explicit projection is a privacy boundary: candidateContent and free-form
  // descriptions never enter the reporting process or serialized output.
  const candidates = await db
    .select({
      id: skillOptimizationCandidates.id,
      tenantId: skillOptimizationCandidates.tenantId,
      skillId: skillOptimizationCandidates.skillId,
      label: skillOptimizationCandidates.label,
      state: skillOptimizationCandidates.state,
      seedHash: skillOptimizationCandidates.seedHash,
      candidateHash: skillOptimizationCandidates.candidateHash,
      evalSetHash: skillOptimizationCandidates.evalSetHash,
      policyVersion: skillOptimizationCandidates.policyVersion,
      evidence: skillOptimizationCandidates.evidence,
      juryDecision: skillOptimizationCandidates.juryDecision,
      juryDecisionHash: skillOptimizationCandidates.juryDecisionHash,
      promotedVersionId: skillOptimizationCandidates.promotedVersionId,
      rolledBackAt: skillOptimizationCandidates.rolledBackAt,
      createdAt: skillOptimizationCandidates.createdAt,
    })
    .from(skillOptimizationCandidates)
    .where(candidateWhere)
    .orderBy(desc(skillOptimizationCandidates.createdAt), desc(skillOptimizationCandidates.id))
    .limit(limit);

  const promotedVersionIds = candidates
    .map((candidate) => candidate.promotedVersionId)
    .filter((id): id is number => id !== null);
  const versions = promotedVersionIds.length === 0
    ? []
    : await db
        .select({
          id: skillOptimizationVersions.id,
          candidateId: skillOptimizationVersions.candidateId,
          contentHash: skillOptimizationVersions.contentHash,
          kind: skillOptimizationVersions.kind,
        })
        .from(skillOptimizationVersions)
        .where(and(
          eq(skillOptimizationVersions.tenantId, ADMIN_TENANT_ID),
          inArray(skillOptimizationVersions.id, promotedVersionIds),
        ))
        .orderBy(desc(skillOptimizationVersions.id))
        .limit(promotedVersionIds.length);

  const versionsById = new Map<number, ImprovementVersionEvidence>(
    versions.map((version) => [version.id, version]),
  );
  const reports = candidates.map((candidate) =>
    evaluateImprovementEvidence(
      candidate,
      candidate.promotedVersionId === null
        ? null
        : versionsById.get(candidate.promotedVersionId) ?? null,
    ),
  );
  const summary = summarizeImprovementEvidence(reports);
  const payload = {
    generatedFrom: "durable_skill_optimizer_evidence",
    tenantScope: ADMIN_TENANT_ID,
    reportOnly: true,
    autonomyChanged: false,
    summary,
    reports,
  };

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
  console.error(`[improvement-evidence-report] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});