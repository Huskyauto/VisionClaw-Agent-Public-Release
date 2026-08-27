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
import { loadEvalFile, normalizeRunConfig, writeRunArtifacts } from "../server/skill-optimizer-run";

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
      process.stderr.write("[skill-optimize] APPLY=1 ignored — seed was not loaded from the skills table.\n");
    } else if (!result.improved) {
      process.stderr.write("[skill-optimize] APPLY=1 ignored — run did not strictly improve; DB left unchanged.\n");
    } else {
      const { storage } = await import("../server/storage");
      // Optimistic-concurrency guard: re-read the row and confirm it still holds the
      // exact seed we optimized. If it changed mid-run, abort rather than clobber a
      // concurrent manual edit — the improved doc is already saved to best_skill.md.
      const current = (await storage.getSkills()).find((s) => s.id === dbSkillId);
      if (!current) {
        die(4, `APPLY conflict — skills.id=${dbSkillId} no longer exists; DB left unchanged.`);
      }
      if (current.promptContent !== seedDoc) {
        die(
          4,
          `APPLY conflict — skills.id=${dbSkillId} was modified during the run; DB left unchanged. ` +
            `Improved doc saved to ${bestPath} — re-run or apply manually.`,
        );
      }
      await storage.updateSkill(dbSkillId, { promptContent: result.bestSkill });
      process.stderr.write(`[skill-optimize] APPLIED improved doc to skills.id=${dbSkillId}.\n`);
    }
  }

  process.exit(0);
}

main().catch((e) => die(3, `unexpected: ${String((e as Error)?.stack || e)}`));
