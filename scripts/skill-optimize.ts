// Operator CLI for the SkillOpt-style validation-gated skill optimizer.
//
// Concept: microsoft/SkillOpt (arXiv:2605.23904). Trains a skill DOCUMENT against a
// real eval set — propose one bounded edit per epoch, accept only on strict
// held-out improvement — and writes the improved doc out (zero inference-time cost).
//
// This is the ON-DEMAND single-skill runner. For nightly jury-gated AUTO-APPLY over
// a registry of skills, see scripts/skill-optimize-nightly.ts. Shared loading /
// config / artifact helpers live in server/skill-optimizer-run.ts.
//
// Env-configured, no TTY, meaningful exit codes (operator-script convention):
//   0 = ran clean (whether or not it improved)
//   2 = bad config / missing inputs
//   3 = runtime error
//   4 = APPLY write-back conflict (skill changed during the run; DB left unchanged)
//
// Inputs (env):
//   EVAL_FILE    (required) JSON: an array of {input,reference?,rubric?} OR
//                {"seedSkill"?: string, "cases": [...]}.
//   SKILL_ID     load the seed doc from the `skills` table by id (promptContent).
//   SKILL_NAME   load the seed doc from the `skills` table by name.
//   SKILL_FILE   load the seed doc from a .md/.txt file.
//                (precedence: SKILL_ID > SKILL_NAME > SKILL_FILE > EVAL_FILE.seedSkill)
//   EPOCHS, VAL_SPLIT, MINIBATCH, SEED, MIN_IMPROVEMENT
//   OPTIMIZER_MODEL, TARGET_MODEL, GRADER_MODEL, TENANT_ID
//   APPLY=1      write the improved doc back to the `skills` table (only when the
//                seed was loaded from the DB AND the run strictly improved).
//
// Example:
//   EVAL_FILE=data/skill-optimization/examples/concise-support-reply.json \
//     npx tsx scripts/skill-optimize.ts

import fs from "node:fs";
import path from "node:path";
import { optimizeSkill } from "../server/skill-optimizer";
import {
  buildUpgradeIssue,
  loadEvalFile,
  mapVerdictToAction,
  normalizeRunConfig,
  writeRunArtifacts,
} from "../server/skill-optimizer-run";
import { runEvaluatorAB } from "../server/lib/bineval";
import {
  finalizeSkillOptimizationVerification,
  promoteSkillOptimizationCandidate,
  recordSkillOptimizationJuryDecision,
  registerSkillOptimizationCandidate,
  sha256,
  transitionSkillOptimizationCandidate,
} from "../server/lib/skill-optimizer-promotion";

function die(code: number, msg: string): never {
  process.stderr.write(`[skill-optimize] ${msg}\n`);
  process.exit(code);
}

async function main() {
  const evalFile = process.env.EVAL_FILE;
  if (!evalFile) die(2, "EVAL_FILE is required (path to a JSON eval set).");

  let loaded;
  try {
    loaded = loadEvalFile(evalFile);
  } catch (e) {
    die(2, (e as Error).message);
  }

  // Resolve the seed skill document + (optionally) the DB row to write back to.
  let seedDoc: string | undefined;
  let dbSkillId: number | undefined;
  let dbSkillName: string | undefined;
  let dbSkillDescription: string | undefined;
  let label = "skill";

  if (process.env.SKILL_ID || process.env.SKILL_NAME) {
    const { storage } = await import("../server/storage");
    const all = await storage.getSkills();
    const row = process.env.SKILL_ID
      ? all.find((s) => s.id === Number(process.env.SKILL_ID))
      : all.find((s) => s.name.toLowerCase() === String(process.env.SKILL_NAME).toLowerCase());
    if (!row) die(2, `skill not found (SKILL_ID=${process.env.SKILL_ID ?? ""} SKILL_NAME=${process.env.SKILL_NAME ?? ""}).`);
    if (!row.promptContent || !row.promptContent.trim()) die(2, `skill "${row.name}" has empty promptContent — nothing to optimize.`);
    seedDoc = row.promptContent;
    dbSkillId = row.id;
    dbSkillName = row.name;
    dbSkillDescription = row.description;
    label = row.name;
  } else if (process.env.SKILL_FILE) {
    if (!fs.existsSync(process.env.SKILL_FILE)) die(2, `SKILL_FILE not found: ${process.env.SKILL_FILE}`);
    seedDoc = fs.readFileSync(process.env.SKILL_FILE, "utf8");
    label = path.basename(process.env.SKILL_FILE).replace(/\.[^.]+$/, "");
  } else if (loaded.seedSkill) {
    seedDoc = loaded.seedSkill;
    label = loaded.label || "eval-seed-skill";
  }

  if (!seedDoc || !seedDoc.trim()) {
    die(2, "no seed skill document — set SKILL_ID, SKILL_NAME, SKILL_FILE, or EVAL_FILE.seedSkill.");
  }

  let cfg;
  try {
    cfg = normalizeRunConfig({
      epochs: process.env.EPOCHS,
      minibatchSize: process.env.MINIBATCH,
      valSplit: process.env.VAL_SPLIT,
      seed: process.env.SEED,
      minImprovement: process.env.MIN_IMPROVEMENT,
      optimizerModel: process.env.OPTIMIZER_MODEL,
      targetModel: process.env.TARGET_MODEL,
      graderModel: process.env.GRADER_MODEL,
      tenantId: process.env.TENANT_ID,
    });
  } catch (e) {
    die(2, (e as Error).message);
  }

  process.stderr.write(
    `[skill-optimize] "${label}" — ${loaded.cases.length} cases, ${cfg.epochs} epochs, ` +
      `target=${cfg.targetModel} optimizer=${cfg.optimizerModel} grader=${cfg.graderModel}\n`,
  );

  let result;
  try {
    result = await optimizeSkill(seedDoc, loaded.cases, cfg);
  } catch (e) {
    die(3, `optimization failed: ${String((e as Error)?.stack || e)}`);
  }

  const { outDir, bestPath } = writeRunArtifacts(label, dbSkillId ?? null, cfg, result);
  process.stderr.write(
    `[skill-optimize] baseline=${result.baselineScore.toFixed(3)} best=${result.bestScore.toFixed(3)} ` +
      `improved=${result.improved} accepted=${result.acceptedEdits.length} rejected=${result.rejectedCount}\n` +
      `[skill-optimize] wrote ${bestPath} (+ run JSON in ${outDir})\n`,
  );

  if (process.env.APPLY === "1") {
    if (dbSkillId === undefined) {
      process.stderr.write("[skill-optimize] APPLY=1 rejected — seed was not loaded from the skills table.\n");
    } else if (!result.improved) {
      process.stderr.write("[skill-optimize] APPLY=1 ignored — run did not strictly improve; DB left unchanged.\n");
    } else {
      const { ADMIN_TENANT_ID } = await import("../server/tenant-constants");
      const candidateTenantId = cfg.tenantId ?? ADMIN_TENANT_ID;
      const candidate = await registerSkillOptimizationCandidate({
        tenantId: candidateTenantId,
        skillId: dbSkillId,
        label,
        seedContent: seedDoc,
        candidateContent: result.bestSkill,
        evalSetHash: sha256(fs.readFileSync(evalFile, "utf8")),
        source: "manual",
        name: dbSkillName,
        description: dbSkillDescription,
        evidence: {
          baselineScore: result.baselineScore,
          bestScore: result.bestScore,
          acceptedEdits: result.acceptedEdits.length,
          rejectedEdits: result.rejectedCount,
          bestPath,
          policyVersion: "skillopt-promotion-v1",
        },
      });
      if (candidateTenantId !== ADMIN_TENANT_ID) {
        await transitionSkillOptimizationCandidate(candidateTenantId, candidate.id, "rejected", {
          reason: "global skill optimizer candidates require the admin tenant",
        });
        die(4, "APPLY rejected — global skill optimizer candidates require the admin tenant.");
      }
      if (candidate.state === "rejected" || candidate.state === "failed") {
        die(4, `APPLY rejected — ${candidate.detail || "candidate is terminal"}.`);
      }
      if (candidate.state === "promoted" || candidate.state === "rolled_back") {
        die(4, `APPLY refused — this exact candidate is already ${candidate.state.replace("_", " ")}.`);
      }

      const { issueText, context } = buildUpgradeIssue(label, result);
      const { juryTriage } = await import("../server/lib/jury-triage");
      let decision;
      try {
        decision = await juryTriage({
          issueText,
          context,
          tenantId: candidateTenantId,
          invokedVia: "skill-optimizer-manual",
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await transitionSkillOptimizationCandidate(candidateTenantId, candidate.id, "failed", {
          reason: `jury failed: ${detail}`,
        });
        die(4, `jury failed; candidate terminalized: ${detail}`);
      }
      const action = mapVerdictToAction(decision);
      const recorded = await recordSkillOptimizationJuryDecision(
        candidateTenantId,
        candidate.id,
        decision,
        action,
      );
      if (!recorded) {
        die(4, `APPLY conflict — candidate ${candidate.id} changed before jury decision persistence.`);
      }
      if (action !== "apply") {
        process.stderr.write(
          `[skill-optimize] APPLY ${action.toUpperCase()} — jury ${decision.verdict} ${decision.majority}/3; DB unchanged.\n`,
        );
      } else {
        const promotion = await promoteSkillOptimizationCandidate({
          tenantId: candidateTenantId,
          candidateId: candidate.id,
          dryRun: process.env.SKILL_OPT_DRY_RUN === "1",
        });
        if (!promotion.ok) {
          if (promotion.state === "held") {
            process.stderr.write(`[skill-optimize] APPLY HELD — ${promotion.detail}; DB unchanged.\n`);
          } else {
            die(4, `APPLY ${promotion.state.toUpperCase()} — ${promotion.detail}; DB unchanged.`);
          }
        } else {
          let postVerify;
          try {
            postVerify = await runEvaluatorAB({
              docBefore: seedDoc,
              docAfter: result.bestSkill,
              cases: loaded.cases,
              cfg: {
                targetModel: cfg.targetModel,
                graderModel: cfg.graderModel,
                binevalModel: process.env.BINEVAL_MODEL || cfg.graderModel,
                tenantId: candidateTenantId,
                rulerEnabled: process.env.SKILL_OPT_RULER !== "off",
              },
            });
          } catch (error) {
            const finalized = await finalizeSkillOptimizationVerification({
              tenantId: candidateTenantId,
              candidateId: candidate.id,
              passed: false,
              evidence: {
                error: error instanceof Error ? error.message : String(error),
              },
            });
            die(4, finalized.detail);
          }
          const postVerified =
            postVerify.cases > 0 &&
            postVerify.holistic.after > postVerify.holistic.before + Math.max(0, cfg.minImprovement);
          const finalized = await finalizeSkillOptimizationVerification({
            tenantId: candidateTenantId,
            candidateId: candidate.id,
            passed: postVerified,
            evidence: {
              ok: postVerified,
              cases: postVerify.cases,
              holistic: postVerify.holistic,
              bineval: postVerify.bineval,
              ruler: postVerify.ruler,
            },
          });
          if (!finalized.ok) die(4, finalized.detail);
          process.stderr.write(`[skill-optimize] PROMOTED reviewed candidate to skills.id=${dbSkillId}.\n`);
        }
      }
    }
  }

  process.exit(0);
}

main().catch((e) => die(3, `unexpected: ${String((e as Error)?.stack || e)}`));
