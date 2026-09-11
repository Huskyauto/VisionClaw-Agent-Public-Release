#!/usr/bin/env tsx
/**
 * scripts/skill-optimize-nightly.ts — jury-gated autonomous skill self-improvement.
 *
 * Bob's design (2026-06-03): the skill optimizer runs nightly in AUTO-APPLY, but
 * every proposed upgrade must clear the existing 3-LLM jury before it touches the
 * live skills table. Two safety gates in series:
 *
 *   GATE 1 — strict-improvement (offline, deterministic): optimizeSkill proposes
 *            bounded edits and keeps a candidate ONLY when it scores strictly
 *            higher on a held-out validation set. No improvement → nothing to ship.
 *   GATE 2 — 3-LLM jury (jury_triage): a candidate that cleared gate 1 is put to a
 *            3-frontier-model vote. 2-of-3 FIX = "yes, apply". Anything short of
 *            that does NOT touch the DB.
 *
 * Per-skill action:
 *   apply    (jury FIX, 2/3)              → write improved doc to skills table,
 *                                           optimistic-concurrency guarded; DB skills only.
 *   hold     (ACCEPT / REJECT)            → keep current skill; decision logged.
 *   escalate (ESCALATE / no majority)     → owner-notification; keep current skill.
 *
 * Registry: data/skill-optimization/registry.json (override via REGISTRY env).
 *   { skills: [ { skillId?|skillName?, evalFile, label?, enabled?,
 *                 optimizerModel?, targetModel?, graderModel?,
 *                 epochs?, valSplit?, minibatchSize?, seed?, minImprovement? } ] }
 *   A DB target (skillId/skillName) is REQUIRED to auto-apply. An entry that only
 *   resolves a file/eval seedSkill runs the full optimize→jury pipeline but can
 *   only save best_skill.md (no DB write) — safe for demos.
 *
 * Built for a Replit Scheduled Deployment (nightly cron). Single-shot, no TTY,
 * env-configured. Exit codes:
 *   0  ran clean (including zero registered skills)
 *   2  bad registry / config
 *   3  fatal runtime error
 *
 * Flags / env:
 *   --dry-run | SKILL_OPT_DRY_RUN=1   run optimizer + jury + write artifacts and
 *                                     decision logs, but NEVER write the skills table.
 *   REGISTRY=<path>                   override the registry file location.
 *   SKILL_OPT_CROSSOVER=off           disable the Frontis-MA1 crossover step
 *            (arXiv:2607.28568) — merging the accepted best with the highest
 *            baseline-beating rejected runner-up into one child candidate,
 *            gated by the same strict val-improvement rule (fail OPEN).
 *   SKILL_OPT_SHIFT=off               disable the SEED behavior-shift pre-jury
 *                                     inert filter (default on; fail-open).
 */

import fs from "node:fs";
import path from "node:path";
import { optimizeSkill } from "../server/skill-optimizer";
import { PriorCollapseTracker, priorCollapseEnabled } from "../server/lib/prior-collapse";
import {
  loadEvalFile,
  normalizeRunConfig,
  writeRunArtifacts,
  buildUpgradeIssue,
  mapVerdictToAction,
} from "../server/skill-optimizer-run";
import type { OptimizeResult } from "../server/skill-optimizer";
import type { JuryDecision } from "../server/lib/jury-triage";
import { runEvaluatorAB } from "../server/lib/bineval";
import type { EvaluatorABResult } from "../server/lib/bineval";
import { runBehaviorShiftProbe } from "../server/lib/behavior-shift";
import type { BehaviorShiftResult } from "../server/lib/behavior-shift";
import {
  expireHeldSkillOptimizationCandidates,
  finalizeSkillOptimizationVerification,
  promoteSkillOptimizationCandidate,
  recordSkillOptimizationJuryDecision,
  registerSkillOptimizationCandidate,
  sha256,
  transitionSkillOptimizationCandidate,
} from "../server/lib/skill-optimizer-promotion";
import {
  loadSkillEvolutionLessons,
  persistSkillEvolutionLesson,
  renderEvolutionLessonsForProposer,
  type SkillEvolutionLessonInput,
} from "../server/lib/skill-evolution-lessons";
import { waitForProductionClear } from "./lib/production-priority";

const DEFAULT_REGISTRY = path.join("data", "skill-optimization", "registry.json");

interface RegistryEntry {
  skillId?: number;
  skillName?: string;
  evalFile: string;
  label?: string;
  enabled?: boolean;
  optimizerModel?: string;
  targetModel?: string;
  graderModel?: string;
  epochs?: number;
  valSplit?: number;
  minibatchSize?: number;
  seed?: number;
  minImprovement?: number;
}

function die(code: number, msg: string): never {
  process.stderr.write(`[skill-nightly] ${msg}\n`);
  process.exit(code);
}

function log(msg: string) {
  process.stderr.write(`[skill-nightly] ${msg}\n`);
}

function loadRegistry(file: string): RegistryEntry[] {
  if (!fs.existsSync(file)) {
    log(`registry ${file} not found — nothing to optimize.`);
    return [];
  }
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    die(2, `registry is not valid JSON: ${String(e)}`);
  }
  const entries = Array.isArray(parsed) ? parsed : parsed?.skills;
  if (!Array.isArray(entries)) {
    die(2, "registry must be an array, or an object with a `skills` array.");
  }
  return entries.filter((e: any): e is RegistryEntry => {
    if (!e || typeof e !== "object") return false;
    if (e.enabled === false) return false;
    if (typeof e.evalFile !== "string" || !e.evalFile.trim()) return false;
    return true;
  });
}

/** Required owner-notification result; callers decide whether failure is fatal. */
async function notifyOwner(subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const ownerEmail = process.env.OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL || process.env.SITE_OWNER_EMAIL;
  if (!ownerEmail) {
    const error = "no OWNER_*_EMAIL env is configured";
    log(`owner notification failed: ${error}`);
    return { ok: false, error };
  }
  try {
    const { ADMIN_TENANT_ID } = await import("../server/tenant-constants");
    const { getOrCreateTenantInbox, sendEmail } = await import("../server/email");
    const inboxResult = await getOrCreateTenantInbox(ADMIN_TENANT_ID);
    const inboxId =
      typeof inboxResult === "string" ? inboxResult : (inboxResult as any).inboxId || (inboxResult as any).email;
    await sendEmail({ inboxId, to: ownerEmail, subject, text: body });
    log(`owner notification emailed to ${ownerEmail}`);
    return { ok: true };
  } catch (e) {
    const error = (e as Error).message;
    log(`owner notification failed (decision remains durable): ${error}`);
    return { ok: false, error };
  }
}

function writeJuryDecision(
  outDir: string,
  label: string,
  result: OptimizeResult,
  decision: JuryDecision,
  action: string,
): string {
  const dir = path.join(outDir, "jury");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const p = path.join(dir, `${stamp}.md`);
  const lines: string[] = [];
  lines.push(`# Jury decision — skill upgrade "${label}"`);
  lines.push("");
  lines.push(`- **When**: ${new Date().toISOString()}`);
  lines.push(`- **Verdict**: **${decision.verdict}** (majority ${decision.majority}/3)`);
  lines.push(`- **Action**: **${action}**`);
  lines.push(`- **Concordance κ**: ${decision.concordance?.toFixed(3) ?? "n/a"}`);
  lines.push(`- **Score**: baseline ${result.baselineScore.toFixed(3)} → candidate ${result.bestScore.toFixed(3)}`);
  lines.push(`- **Accepted edits**: ${result.acceptedEdits.length} · **Rejected**: ${result.rejectedCount}`);
  lines.push("");
  lines.push(`## Votes`);
  lines.push("");
  for (const v of decision.votes) {
    lines.push(`### ${v.model} (${v.provider}) — ${v.verdict}`);
    lines.push("");
    lines.push(v.rationale || "(no rationale)");
    lines.push("");
  }
  lines.push(`## Aggregator synthesis`);
  lines.push("");
  lines.push(decision.aggregatorAnswer || "(none)");
  lines.push("");
  fs.writeFileSync(p, lines.join("\n"));
  return p;
}

/** Persist a behavior-shift probe result (SEED filter) for later analysis. */
function writeShiftProbe(outDir: string, label: string, shift: BehaviorShiftResult): string {
  const dir = path.join(outDir, "behavior-shift");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const p = path.join(dir, `${stamp}.json`);
  fs.writeFileSync(p, JSON.stringify({ label, when: new Date().toISOString(), ...shift }, null, 2));
  return p;
}

/** Persist a BINEVAL-vs-holistic A/B measurement for later analysis. */
function writeBinevalAB(outDir: string, label: string, ab: EvaluatorABResult): string {
  const dir = path.join(outDir, "bineval-ab");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const p = path.join(dir, `${stamp}.json`);
  fs.writeFileSync(p, JSON.stringify({ label, when: new Date().toISOString(), ...ab }, null, 2));
  return p;
}

type EntryStatus =
  | "promoted"
  | "rolled-back"
  | "rejected"
  | "held"
  | "escalated"
  | "no-improvement"
  | "inert-culled"
  | "conflict"
  | "error";

interface EntryResult {
  label: string;
  status: EntryStatus;
  detail: string;
}

type LessonDraft = Omit<SkillEvolutionLessonInput, "outcome">;

async function recordEvolutionLesson(
  draft: LessonDraft,
  result: EntryResult,
  extra: Pick<SkillEvolutionLessonInput, "candidateId" | "promotedVersionId"> = {},
): Promise<EntryResult> {
  try {
    await persistSkillEvolutionLesson({
      ...draft,
      ...extra,
      outcome: result.status,
    });
  } catch (error) {
    // Knowledge is an advisory record-only surface. A storage failure must not
    // change the optimizer or promotion result.
    log(`  evolution lesson skipped (fail open): ${(error as Error).message}`);
  }
  return result;
}

async function processEntry(entry: RegistryEntry, dryRun: boolean): Promise<EntryResult> {
  let label = entry.label || "skill";
  const cfg = normalizeRunConfig(entry);
  const loaded = loadEvalFile(entry.evalFile);

  // Resolve the seed doc + (optionally) the DB row to write back to.
  let seedDoc: string | undefined;
  let dbSkillId: number | undefined;
  let dbSkillName: string | undefined;
  let dbSkillDescription: string | undefined;
  if (entry.skillId !== undefined || entry.skillName) {
    const { storage } = await import("../server/storage");
    const all = await storage.getSkills();
    const row =
      entry.skillId !== undefined
        ? all.find((s) => s.id === Number(entry.skillId))
        : all.find((s) => s.name.toLowerCase() === String(entry.skillName).toLowerCase());
    if (!row) return { label, status: "error", detail: `skill not found (id=${entry.skillId ?? ""} name=${entry.skillName ?? ""})` };
    if (!row.promptContent || !row.promptContent.trim())
      return { label, status: "error", detail: `skill "${row.name}" has empty promptContent` };
    seedDoc = row.promptContent;
    dbSkillId = row.id;
    dbSkillName = row.name;
    dbSkillDescription = row.description;
    label = entry.label || row.name;
  } else if (loaded.seedSkill) {
    seedDoc = loaded.seedSkill;
    label = entry.label || loaded.label || label;
  } else {
    return { label, status: "error", detail: "no seed skill — set skillId/skillName, or give the eval file a seedSkill" };
  }

  const { ADMIN_TENANT_ID } = await import("../server/tenant-constants");
  const candidateTenantId = cfg.tenantId ?? ADMIN_TENANT_ID;
  let evolutionLessons = "";
  try {
    const prior = await loadSkillEvolutionLessons({
      tenantId: candidateTenantId,
      skillId: dbSkillId ?? null,
      seedContent: seedDoc,
    });
    const rendered = renderEvolutionLessonsForProposer(prior);
    evolutionLessons = rendered.context;
    if (rendered.invalidCount > 0) {
      log(`  evolution lessons: DEGRADED — ignored ${rendered.invalidCount} malformed stored row(s)`);
    }
    if (prior.length > 0) log(`  evolution lessons: loaded ${prior.length} prior attempt(s)`);
  } catch (error) {
    log(`  evolution lessons: unavailable (fail open: ${(error as Error).message})`);
  }

  // GATE 1 — strict-improvement optimizer. A fresh per-run prior-collapse
  // tracker (arXiv:2603.23420) skips val-scoring spend on semantically
  // near-duplicate re-proposals; kill switch PRIOR_COLLAPSE=off.
  console.log(`[skill-optimize] prior-collapse detection: ${priorCollapseEnabled() ? "on" : "off (PRIOR_COLLAPSE=off)"}`);
  const crossoverEnabled = process.env.SKILL_OPT_CROSSOVER !== "off";
  console.log(`[skill-optimize] crossover operator: ${crossoverEnabled ? "on" : "off (SKILL_OPT_CROSSOVER=off)"}`);
  const branchEnabled = process.env.SKILL_OPT_BRANCH !== "off";
  console.log(`[skill-optimize] branch-on-stall (AIDE): ${branchEnabled ? "on" : "off (SKILL_OPT_BRANCH=off)"}`);
  const result = await optimizeSkill(seedDoc, loaded.cases, {
    ...cfg,
    collapseTracker: new PriorCollapseTracker(),
    crossover: crossoverEnabled,
    branchOnStall: branchEnabled,
    evolutionLessons,
  });
  if (result.crossoverApplied) {
    console.log(`[skill-optimize] crossover child became the final candidate (score ${result.bestScore.toFixed(3)})`);
  }
  const arts = writeRunArtifacts(label, dbSkillId ?? null, cfg, result);
  const evalSetHash = sha256(fs.readFileSync(entry.evalFile, "utf8"));
  const lessonDraft: LessonDraft = {
    tenantId: candidateTenantId,
    skillId: dbSkillId ?? null,
    label,
    seedContent: seedDoc,
    candidateContent: result.bestSkill,
    evalSetHash,
    baselineScore: result.baselineScore,
    bestScore: result.bestScore,
    acceptedEdits: result.acceptedEdits.length,
    rejectedEdits: result.rejectedCount,
    evidenceRefs: [arts.runPath, arts.bestPath],
  };
  const finish = (
    entryResult: EntryResult,
    extra: Pick<SkillEvolutionLessonInput, "candidateId" | "promotedVersionId"> = {},
  ) => recordEvolutionLesson(lessonDraft, entryResult, extra);

  if (!result.improved) {
    return finish({
      label,
      status: "no-improvement",
      detail: `baseline=${result.baselineScore.toFixed(3)} best=${result.bestScore.toFixed(3)} (no jury call)`,
    });
  }

  const candidate = await registerSkillOptimizationCandidate({
    tenantId: candidateTenantId,
    skillId: dbSkillId ?? null,
    label,
    seedContent: seedDoc,
    candidateContent: result.bestSkill,
    evalSetHash,
    source: "nightly",
    name: dbSkillName,
    description: dbSkillDescription,
    evidence: {
      baselineScore: result.baselineScore,
      bestScore: result.bestScore,
      acceptedEdits: result.acceptedEdits.length,
      rejectedEdits: result.rejectedCount,
      runPath: arts.runPath,
      bestPath: arts.bestPath,
      policyVersion: "skillopt-promotion-v1",
    },
  });
  if (candidate.state === "rejected" || candidate.state === "failed") {
    return finish({
      label,
      status: candidate.state,
      detail: candidate.detail || "candidate was already terminal",
    }, { candidateId: candidate.id });
  }
  if (candidate.state === "promoted" || candidate.state === "rolled_back") {
    return finish({
      label,
      status: candidate.state === "promoted" ? "promoted" : "rolled-back",
      detail: `existing candidate identity is already ${candidate.state.replace("_", " ")}`,
    }, { candidateId: candidate.id });
  }
  if (candidateTenantId !== ADMIN_TENANT_ID) {
    await transitionSkillOptimizationCandidate(candidateTenantId, candidate.id, "rejected", {
      reason: "global skill optimizer candidates require the admin tenant",
    });
    return finish(
      { label, status: "rejected", detail: "global skill optimizer candidates require the admin tenant" },
      { candidateId: candidate.id },
    );
  }
  if (dbSkillId === undefined) {
    await transitionSkillOptimizationCandidate(candidateTenantId, candidate.id, "rejected", {
      reason: "file/eval-seed candidates have no live skill target and cannot be promoted",
    });
    return finish(
      {
        label,
        status: "rejected",
        detail: `file/eval-seed candidate retained as evidence only; no DB target; ${arts.bestPath}`,
      },
      { candidateId: candidate.id },
    );
  }

  // PRE-JURY INERT FILTER — SEED behavior-shift probe (arXiv:2607.14777).
  // Replays a bounded sample of eval cases with seed vs candidate doc and
  // culls the candidate BEFORE the paid jury call ONLY on clean, unanimous
  // evidence the candidate changes the model's behavior on zero cases (its
  // gate-1 "improvement" is then judge noise). Pure spend/noise filter: it can
  // only SKIP a jury call, never force an apply. Every failure path fails OPEN
  // (candidate proceeds to jury). Kill switch: SKILL_OPT_SHIFT=off.
  if (process.env.SKILL_OPT_SHIFT !== "off") {
    try {
      const shift = await runBehaviorShiftProbe({
        docBefore: seedDoc,
        docAfter: result.bestSkill,
        cases: loaded.cases,
        cfg: { targetModel: cfg.targetModel, tenantId: cfg.tenantId },
      });
      const shiftPath = writeShiftProbe(arts.outDir, label, shift);
      log(`  behavior-shift: ${shift.notes} → ${shiftPath}`);
      if (shift.inert) {
        await transitionSkillOptimizationCandidate(candidateTenantId, candidate.id, "rejected", {
          reason: `behavior-shift probe found no observable change across ${shift.usable} usable cases`,
        });
        return finish(
          {
            label,
            status: "inert-culled",
            detail:
              `candidate is behaviorally inert (0/${shift.usable} probed cases shifted) — ` +
              `jury call skipped, DB unchanged; ${shiftPath}`,
          },
          { candidateId: candidate.id },
        );
      }
    } catch (e) {
      log(`  behavior-shift: skipped (fail open: ${(e as Error).message})`);
    }
  }

  // NON-BLOCKING A/B — measure the BINEVAL binary-question evaluator
  // (arXiv:2606.27226) AND the RULER-style relative group-ranking judge
  // (OpenPipe ART borrow, server/lib/ruler-rank.ts) against the current holistic
  // scalar judge on the SAME before/after outputs. This NEVER changes the apply
  // decision (measure-first, per the acceptance-gate non-regression principle) —
  // it only records which judge discriminates the upgrade more sharply. Fully
  // fail-open: a measurement error can't disturb the nightly run. Disable all
  // with SKILL_OPT_EVAL=off; disable just the ruler lane with SKILL_OPT_RULER=off.
  if (process.env.SKILL_OPT_EVAL !== "off") {
    try {
      const ab = await runEvaluatorAB({
        docBefore: seedDoc,
        docAfter: result.bestSkill,
        cases: loaded.cases,
        cfg: {
          targetModel: cfg.targetModel,
          graderModel: cfg.graderModel,
          binevalModel: process.env.BINEVAL_MODEL || cfg.graderModel,
          tenantId: cfg.tenantId,
          rulerEnabled: process.env.SKILL_OPT_RULER !== "off",
        },
      });
      const abPath = writeBinevalAB(arts.outDir, label, ab);
      log(`  bineval-ab: ${ab.notes} → ${abPath}`);
    } catch (e) {
      log(`  bineval-ab: skipped (${(e as Error).message})`);
    }
  }

  // GATE 2 — 3-LLM jury vote on whether to apply.
  const { issueText, context } = buildUpgradeIssue(label, result);
  const { juryTriage } = await import("../server/lib/jury-triage");
  let decision: JuryDecision;
  try {
    decision = await juryTriage({
      issueText,
      context,
      tenantId: cfg.tenantId ?? ADMIN_TENANT_ID,
      invokedVia: "skill-optimizer-nightly",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await transitionSkillOptimizationCandidate(candidateTenantId, candidate.id, "failed", {
      reason: `jury failed: ${detail}`,
    });
    return finish(
      { label, status: "error", detail: `jury failed; candidate terminalized: ${detail}` },
      { candidateId: candidate.id },
    );
  }
  const action = mapVerdictToAction(decision);
  const decisionPath = writeJuryDecision(arts.outDir, label, result, decision, action);
  const verdictTag = `verdict=${decision.verdict} ${decision.majority}/3`;
  const decisionRecorded = await recordSkillOptimizationJuryDecision(
    candidateTenantId,
    candidate.id,
    decision,
    action,
  );
  if (!decisionRecorded) {
    return finish(
      {
        label,
        status: "conflict",
        detail: `candidate ${candidate.id} changed before jury decision could be recorded; DB unchanged`,
      },
      { candidateId: candidate.id },
    );
  }

  if (action === "escalate") {
    return finish(
      { label, status: "escalated", detail: `${verdictTag} → owner review required; DB unchanged; ${decisionPath}` },
      { candidateId: candidate.id },
    );
  }

  if (action === "reject") {
    return finish(
      { label, status: "rejected", detail: `${verdictTag} → candidate rejected; DB unchanged; ${decisionPath}` },
      { candidateId: candidate.id },
    );
  }

  if (action === "hold") {
    return finish(
      { label, status: "held", detail: `${verdictTag} (current skill kept) → ${decisionPath}` },
      { candidateId: candidate.id },
    );
  }

  // action === "apply"
  const promotion = await promoteSkillOptimizationCandidate({
    tenantId: candidateTenantId,
    candidateId: candidate.id,
    dryRun,
  });
  if (!promotion.ok) {
    return finish(
      {
        label,
        status: promotion.state === "held" ? "held" : "error",
        detail: `jury approved (${verdictTag}) but promotion refused: ${promotion.detail}; ${arts.bestPath}`,
      },
      { candidateId: candidate.id },
    );
  }

  // Independent post-promotion check. This is intentionally a fresh evaluator
  // run after the exact reviewed hash becomes live. Any unavailable or
  // non-improving result rolls back conditionally; a quality verifier may never
  // leave an unverified prompt active.
  let postVerify: EvaluatorABResult;
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
    return finish(
      {
        label,
        status: finalized.state === "rolled_back" ? "rolled-back" : "error",
        detail: finalized.detail,
      },
      { candidateId: candidate.id, promotedVersionId: promotion.promotedVersionId },
    );
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
  if (!finalized.ok) {
    return finish(
      {
        label,
        status: finalized.state === "rolled_back" ? "rolled-back" : "error",
        detail:
          `post-promotion non-regression failed ` +
          `(${postVerify.holistic.before.toFixed(3)}→${postVerify.holistic.after.toFixed(3)}); ${finalized.detail}`,
      },
      { candidateId: candidate.id, promotedVersionId: promotion.promotedVersionId },
    );
  }
  return finish(
    { label, status: "promoted", detail: `jury approved (${verdictTag}) → promoted skills.id=${dbSkillId}` },
    { candidateId: candidate.id, promotedVersionId: promotion.promotedVersionId },
  );
}

async function main() {
  await waitForProductionClear({ label: "skill-optimize-nightly" });
  const dryRun = process.argv.includes("--dry-run") || process.env.SKILL_OPT_DRY_RUN === "1";
  const registryPath = process.env.REGISTRY || DEFAULT_REGISTRY;
  const notificationFailures: string[] = [];
  const { ADMIN_TENANT_ID } = await import("../server/tenant-constants");
  const expiredHolds = await expireHeldSkillOptimizationCandidates(ADMIN_TENANT_ID);
  if (expiredHolds > 0) {
    log(`terminalized ${expiredHolds} expired optimizer hold(s) as rejected.`);
    const notification = await notifyOwner(
      `SKILL OPTIMIZER: ${expiredHolds} held candidate(s) expired`,
      `${expiredHolds} optimizer candidate(s) reached their owner-review deadline and were rejected automatically. No live skill was changed.`,
    );
    if (!notification.ok) notificationFailures.push(`expired holds: ${notification.error}`);
  }
  let entries = loadRegistry(registryPath);

  // Outcome-driven promotion (Grok item #2, fail-open): refresh the generated
  // manifest from the grade-event ledger, then merge its entries. Generated
  // entries are file-seed ONLY (no skillId/skillName — loadGeneratedEntries
  // strips any that appear), so they can never write the skills DB; the
  // hand-authored registry.json is never mutated.
  try {
    const { scanOutcomePromotions, GENERATED_MANIFEST } = await import("../server/lib/outcome-promotion");
    const scan = await scanOutcomePromotions();
    log(`outcome-promotion: scanned ${scan.scanned} (tenant,format) group(s), promoted ${scan.promoted.length}.`);
    if (fs.existsSync(GENERATED_MANIFEST)) {
      const generated = loadRegistry(GENERATED_MANIFEST).map((e) => ({
        ...e,
        skillId: undefined,
        skillName: undefined, // hard rule: generated entries stay file-seed
        label: e.label ? `[generated] ${e.label}` : "[generated]",
      }));
      if (generated.length > 0) {
        log(`outcome-promotion: merging ${generated.length} generated entr${generated.length === 1 ? "y" : "ies"}.`);
        entries = entries.concat(generated);
      }
    }
  } catch (e) {
    log(`outcome-promotion merge failed (fail-open, hand-authored registry unaffected): ${(e as Error).message}`);
  }

  if (entries.length === 0) {
    log(`no enabled skills registered in ${registryPath} — nothing to do.`);
    if (notificationFailures.length > 0) {
      die(3, `required owner notification failed: ${notificationFailures.join("; ")}`);
    }
    process.exit(0);
  }

  // Autonomous-spend governor: optimizeSkill + the jury are paid. Gate the run
  // BEFORE the per-skill loop; over-budget exits clean (0) so the scheduler doesn't
  // flag a failure — the next nightly run picks up once budget frees. A dry run
  // still calls the optimizer/jury (real spend), so it gates too.
  {
    const { ADMIN_TENANT_ID } = await import("../server/tenant-constants");
    const { claimAutonomousBudget } = await import("../server/agentic/autonomous-budget");
    const budget = await claimAutonomousBudget({ tenantId: ADMIN_TENANT_ID, estimatedUsd: 2, label: "skill-optimize-nightly" });
    if (!budget.ok) {
      log(
        `budget gate: ${budget.reason} (spent $${budget.spentUsd.toFixed(2)} / cap $${budget.capUsd.toFixed(2)}) — skipping this run.`,
      );
      if (notificationFailures.length > 0) {
        die(3, `required owner notification failed: ${notificationFailures.join("; ")}`);
      }
      process.exit(0);
    }
  }

  log(`${entries.length} skill(s) registered${dryRun ? " — DRY RUN (no skill promotion; evaluation evidence is retained)" : ""}. Registry: ${registryPath}`);
  const results: EntryResult[] = [];
  for (const entry of entries) {
    const tag = entry.label || entry.skillName || `id:${entry.skillId ?? "?"}`;
    log(`--- optimizing "${tag}" ---`);
    try {
      const r = await processEntry(entry, dryRun);
      log(`  ${r.status}: ${r.detail}`);
      results.push(r);
    } catch (e) {
      const detail = (e as Error)?.message || String(e);
      log(`  error: ${detail}`);
      results.push({ label: tag, status: "error", detail });
    }
  }

  log(`=== SUMMARY (${results.length}) ===`);
  for (const r of results) log(`  ${r.status.padEnd(18)} ${r.label}`);
  const promoted = results.filter((r) => r.status === "promoted").length;
  const rolledBack = results.filter((r) => r.status === "rolled-back");
  const rejected = results.filter((r) => r.status === "rejected").length;
  const held = results.filter((r) => r.status === "held" || r.status === "escalated").length;
  const errored = results.filter((r) => r.status === "error");
  const conflicts = results.filter((r) => r.status === "conflict");
  log(
    `promoted=${promoted} rejected=${rejected} held=${held} rolled-back=${rolledBack.length} ` +
    `errors=${errored.length} conflicts=${conflicts.length} of ${results.length}${dryRun ? " (dry run)" : ""}`,
  );
  const reviewVisible = results.filter(
    (r) => r.status === "rejected" || r.status === "held" || r.status === "escalated",
  );
  if (reviewVisible.length > 0) {
    const notification = await notifyOwner(
      `SKILL OPTIMIZER: ${reviewVisible.length} candidate outcome(s) need visibility`,
      [
        "No listed candidate was promoted.",
        ...reviewVisible.map((r) => `- ${r.label}: ${r.status} — ${r.detail}`),
      ].join("\n"),
    );
    if (!notification.ok) notificationFailures.push(`review outcomes: ${notification.error}`);
  }

  // ---- PHASE 2: per-model harness adaptation (Self-Harness, arXiv:2606.09498) ----
  // Reuses the SAME trace-mining + jury + held-out gates as the skill phase, but
  // groups failures BY originating model and proposes minimal per-model system-
  // prompt addenda, injected at runtime by harness-injection.ts. Same nightly run,
  // no new workflow. Its own budget claim (the proposer + held-out judge + jury are
  // paid); soft per-model non-results are logged, only a FATAL phase error fails
  // the run closed.
  let harnessFatal = false;
  let harnessSummary = "";
  try {
    const { ADMIN_TENANT_ID } = await import("../server/tenant-constants");
    const { claimAutonomousBudget } = await import("../server/agentic/autonomous-budget");
    const hb = await claimAutonomousBudget({ tenantId: ADMIN_TENANT_ID, estimatedUsd: 2, label: "harness-adaptation-nightly" });
    if (!hb.ok) {
      log(`--- harness adaptation: budget gate (${hb.reason}, spent $${hb.spentUsd.toFixed(2)} / cap $${hb.capUsd.toFixed(2)}) — skipping ---`);
    } else {
      const { runHarnessAdaptation } = await import("../server/agentic/harness-adaptation");
      const hr = await runHarnessAdaptation({ dryRun });
      log(`--- harness adaptation: scanned ${hr.scanned} failures across ${hr.modelsConsidered} model(s); applied ${hr.applied}${dryRun ? " (dry run)" : ""} ---`);
      for (const r of hr.results) {
        log(`  harness ${r.status.padEnd(12)} ${r.modelId}${r.weakness ? ` (${r.weakness})` : ""}: ${r.detail}`);
      }
      const hErr = hr.results.filter((r) => r.status === "error");
      if (hErr.length) harnessFatal = true;
      harnessSummary =
        `harness: scanned=${hr.scanned} models=${hr.modelsConsidered} applied=${hr.applied} soft-errors=${hErr.length}` +
        (hErr.length ? `\n` + hErr.map((r) => `- [harness-${r.status}] ${r.modelId}: ${r.detail}`).join("\n") : "");
    }
  } catch (e) {
    harnessFatal = true;
    const detail = (e as Error)?.stack || (e as Error)?.message || String(e);
    log(`--- harness adaptation: FATAL phase error: ${detail} ---`);
    harnessSummary = `harness: FATAL — ${detail}`;
  }

  // Fail closed: a run with hard errors or apply-conflicts (skill phase) or a fatal
  // harness-phase error must NOT report green to the scheduler, and the owner is
  // notified so a silently-broken nightly run can't sit unseen. (Jury holds/escalates
  // are expected outcomes, not failures — escalate already notified the owner inline;
  // held/no-improvement/shadow are clean.)
  const operational = [...errored, ...conflicts, ...rolledBack];
  if (operational.length > 0 || harnessFatal || notificationFailures.length > 0) {
    await notifyOwner(
      `SKILL OPTIMIZER NIGHTLY: ${errored.length} error(s), ${conflicts.length} conflict(s)` +
        `${harnessFatal ? ", harness FATAL" : ""}${notificationFailures.length ? ", owner-delivery failure" : ""}`,
      `The nightly self-improvement run finished with operational problems (live state left safe):\n\n` +
        (operational.length
          ? operational.map((r) => `- [${r.status}] ${r.label}: ${r.detail}`).join("\n")
          : "(no skill-phase problems)") +
        `\n\nPromoted this run: ${promoted}. Total entries: ${results.length}.` +
        (notificationFailures.length
          ? `\n\nOwner-delivery failures:\n${notificationFailures.map((f) => `- ${f}`).join("\n")}`
          : "") +
        (harnessSummary ? `\n\n${harnessSummary}` : ""),
    );
    process.exit(3);
  }
  if (harnessSummary) log(harnessSummary.split("\n")[0]);
  process.exit(0);
}

main().catch((e) => die(3, `fatal: ${String((e as Error)?.stack || e)}`));
