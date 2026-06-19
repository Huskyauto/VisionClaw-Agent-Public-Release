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
 */

import fs from "node:fs";
import path from "node:path";
import { optimizeSkill } from "../server/skill-optimizer";
import {
  loadEvalFile,
  normalizeRunConfig,
  writeRunArtifacts,
  buildUpgradeIssue,
  mapVerdictToAction,
} from "../server/skill-optimizer-run";
import type { OptimizeResult } from "../server/skill-optimizer";
import type { JuryDecision } from "../server/lib/jury-triage";
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

/** Owner-notification on ESCALATE (jury split / no 2-of-3 majority). Best-effort. */
async function notifyOwner(subject: string, body: string) {
  const ownerEmail = process.env.OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL || process.env.SITE_OWNER_EMAIL;
  if (!ownerEmail) {
    log(`escalation but no OWNER_*_EMAIL env — decision logged for manual review.`);
    return;
  }
  try {
    const { ADMIN_TENANT_ID } = await import("../server/tenant-constants");
    const { getOrCreateTenantInbox, sendEmail } = await import("../server/email");
    const inboxResult = await getOrCreateTenantInbox(ADMIN_TENANT_ID);
    const inboxId =
      typeof inboxResult === "string" ? inboxResult : (inboxResult as any).inboxId || (inboxResult as any).email;
    await sendEmail({ inboxId, to: ownerEmail, subject, text: body });
    log(`escalation emailed to ${ownerEmail}`);
  } catch (e) {
    log(`escalation email failed (decision still logged): ${(e as Error).message}`);
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

type EntryStatus =
  | "applied"
  | "approved-dry-run"
  | "approved-no-target"
  | "held"
  | "escalated"
  | "no-improvement"
  | "conflict"
  | "error";

interface EntryResult {
  label: string;
  status: EntryStatus;
  detail: string;
}

async function processEntry(entry: RegistryEntry, dryRun: boolean): Promise<EntryResult> {
  let label = entry.label || "skill";
  const cfg = normalizeRunConfig(entry);
  const loaded = loadEvalFile(entry.evalFile);

  // Resolve the seed doc + (optionally) the DB row to write back to.
  let seedDoc: string | undefined;
  let dbSkillId: number | undefined;
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
    label = entry.label || row.name;
  } else if (loaded.seedSkill) {
    seedDoc = loaded.seedSkill;
    label = entry.label || loaded.label || label;
  } else {
    return { label, status: "error", detail: "no seed skill — set skillId/skillName, or give the eval file a seedSkill" };
  }

  // GATE 1 — strict-improvement optimizer.
  const result = await optimizeSkill(seedDoc, loaded.cases, cfg);
  const arts = writeRunArtifacts(label, dbSkillId ?? null, cfg, result);
  if (!result.improved) {
    return {
      label,
      status: "no-improvement",
      detail: `baseline=${result.baselineScore.toFixed(3)} best=${result.bestScore.toFixed(3)} (no jury call)`,
    };
  }

  // GATE 2 — 3-LLM jury vote on whether to apply.
  const { issueText, context } = buildUpgradeIssue(label, result);
  const { juryTriage } = await import("../server/lib/jury-triage");
  const { ADMIN_TENANT_ID } = await import("../server/tenant-constants");
  const decision = await juryTriage({
    issueText,
    context,
    tenantId: cfg.tenantId ?? ADMIN_TENANT_ID,
    invokedVia: "skill-optimizer-nightly",
  });
  const action = mapVerdictToAction(decision);
  const decisionPath = writeJuryDecision(arts.outDir, label, result, decision, action);
  const verdictTag = `verdict=${decision.verdict} ${decision.majority}/3`;

  if (action === "escalate") {
    await notifyOwner(
      `SKILL SELF-IMPROVEMENT ESCALATE: ${label}`,
      `The nightly skill optimizer found a validated improvement for skill "${label}" ` +
        `(baseline ${result.baselineScore.toFixed(3)} → candidate ${result.bestScore.toFixed(3)}), ` +
        `but the 3-LLM jury did not reach a 2-of-3 majority.\n\n` +
        `Verdict: ${decision.verdict} (majority ${decision.majority}/3, κ=${decision.concordance?.toFixed(3) ?? "n/a"})\n` +
        `The current skill was left UNCHANGED.\n\n` +
        `Candidate doc + full decision: ${decisionPath}\nBest doc: ${arts.bestPath}`,
    );
    return { label, status: "escalated", detail: `${verdictTag} → owner notified; DB unchanged; ${decisionPath}` };
  }

  if (action === "hold") {
    return { label, status: "held", detail: `${verdictTag} (current skill kept) → ${decisionPath}` };
  }

  // action === "apply"
  if (dbSkillId === undefined) {
    return {
      label,
      status: "approved-no-target",
      detail: `jury approved (${verdictTag}) but seed is file/eval-seed — saved ${arts.bestPath}, no DB write`,
    };
  }
  if (dryRun) {
    return { label, status: "approved-dry-run", detail: `jury approved (${verdictTag}) — DRY RUN, DB unchanged; ${arts.bestPath}` };
  }
  // Optimistic-concurrency guard: confirm the row still holds the exact seed we
  // optimized before clobbering it. The improved doc is already in best_skill.md.
  const { storage } = await import("../server/storage");
  const current = (await storage.getSkills()).find((s) => s.id === dbSkillId);
  if (!current) return { label, status: "conflict", detail: `skills.id=${dbSkillId} no longer exists; DB unchanged` };
  if (current.promptContent !== seedDoc)
    return { label, status: "conflict", detail: `skills.id=${dbSkillId} changed during run; DB unchanged; ${arts.bestPath}` };
  await storage.updateSkill(dbSkillId, { promptContent: result.bestSkill });
  return { label, status: "applied", detail: `jury approved (${verdictTag}) → applied to skills.id=${dbSkillId}` };
}

async function main() {
  await waitForProductionClear({ label: "skill-optimize-nightly" });
  const dryRun = process.argv.includes("--dry-run") || process.env.SKILL_OPT_DRY_RUN === "1";
  const registryPath = process.env.REGISTRY || DEFAULT_REGISTRY;
  const entries = loadRegistry(registryPath);

  if (entries.length === 0) {
    log(`no enabled skills registered in ${registryPath} — nothing to do.`);
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
      process.exit(0);
    }
  }

  log(`${entries.length} skill(s) registered${dryRun ? " — DRY RUN (no DB writes)" : ""}. Registry: ${registryPath}`);
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
  const applied = results.filter((r) => r.status === "applied").length;
  const errored = results.filter((r) => r.status === "error");
  const conflicts = results.filter((r) => r.status === "conflict");
  log(`applied=${applied} errors=${errored.length} conflicts=${conflicts.length} of ${results.length}${dryRun ? " (dry run)" : ""}`);

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
  const operational = [...errored, ...conflicts];
  if (operational.length > 0 || harnessFatal) {
    await notifyOwner(
      `SKILL OPTIMIZER NIGHTLY: ${errored.length} error(s), ${conflicts.length} conflict(s)${harnessFatal ? ", harness FATAL" : ""}`,
      `The nightly self-improvement run finished with operational problems (live state left safe):\n\n` +
        (operational.length
          ? operational.map((r) => `- [${r.status}] ${r.label}: ${r.detail}`).join("\n")
          : "(no skill-phase problems)") +
        `\n\nApplied this run: ${applied}. Total entries: ${results.length}.` +
        (harnessSummary ? `\n\n${harnessSummary}` : ""),
    );
    process.exit(3);
  }
  if (harnessSummary) log(harnessSummary.split("\n")[0]);
  process.exit(0);
}

main().catch((e) => die(3, `fatal: ${String((e as Error)?.stack || e)}`));
