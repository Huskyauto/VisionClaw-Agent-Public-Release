/**
 * Simulation Sandbox (S4) — handlers for `sandbox_run` / `sandbox_report`.
 * Contract: data/feature-contracts/simulation-sandbox/spec.md
 *
 * Trust seam: tenant is read from `ctx.tenantId` (platform-stamped), NEVER
 * from params. sandbox_run is trustedPersonasOnly + requiresStructuredArgs
 * in TOOL_POLICIES (the guarded executor enforces both BEFORE this handler
 * runs); sandbox_report is safe/LOW but tenant-scoped in the query.
 *
 * Long runs: sandbox_run awaits the replay for a bounded window; if the run
 * is still going it detaches (the replay engine persists its own completion
 * or failure into sandbox_runs) and directs the caller to sandbox_report.
 * Setup/claim failures (invalid args, refused budget claim) throw within
 * the window and surface synchronously.
 *
 * Backing lib pulled via call-time dynamic import (acyclicity invariant).
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { sandboxRunDefinition, sandboxReportDefinition, sandboxPromoteDefinition } from "./definitions";

/** How long sandbox_run waits before detaching to the background. */
const SYNC_WAIT_MS = 20_000;

async function sandboxRunHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const tenantId = ctx.tenantId as number;

  const corpus = params.corpus;
  if (corpus !== "safety" && corpus !== "conversation" && corpus !== "orchestration") {
    return { error: "sandbox_run: corpus must be 'safety', 'conversation', or 'orchestration'" };
  }
  const sampleSize = Number(params.sampleSize);
  if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 200) {
    return { error: "sandbox_run: sampleSize must be an integer between 1 and 200" };
  }

  try {
    const replay = await import("../../../lib/sandbox/replay");

    let runPromise: Promise<{ runId: number; report: unknown }>;
    if (corpus === "safety") {
      const mode = params.intentGateMode;
      if (mode !== "off" && mode !== "moderate" && mode !== "strict") {
        return { error: "sandbox_run: safety corpus requires intentGateMode ('off' | 'moderate' | 'strict')" };
      }
      const restrictedCategories = Array.isArray(params.restrictedCategories)
        ? params.restrictedCategories.filter((c: unknown) => typeof c === "string")
        : [];
      runPromise = replay.runSafetyReplay({
        tenantId,
        sampleSize,
        overrides: { intentGateMode: mode, restrictedCategories },
      });
    } else {
      const model = params.model;
      if (typeof model !== "string" || !model.trim()) {
        return { error: `sandbox_run: ${corpus} corpus requires a non-empty model id` };
      }
      // Clamp the per-run cap to (0, 5] — the tool can never RAISE the spec's $5 default.
      const requestedCap = Number(params.perRunCapUsd);
      const perRunCapUsd =
        Number.isFinite(requestedCap) && requestedCap > 0 ? Math.min(requestedCap, 5) : 5;
      runPromise = replay.runModelSwapReplay({
        tenantId,
        corpus,
        sampleSize,
        overrides: { model: model.trim() },
        perRunCapUsd,
      });
    }

    // Bounded wait: fast runs (and setup/claim failures) surface synchronously;
    // long runs detach — the engine persists completion/failure to sandbox_runs.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"pending">((resolve) => {
      timer = setTimeout(() => resolve("pending"), SYNC_WAIT_MS);
    });
    try {
      const settled = await Promise.race([runPromise, timeout]);
      if (settled !== "pending") {
        return { success: true, status: "complete", runId: settled.runId, report: settled.report };
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
    // Detached: swallow the eventual rejection here (the engine already
    // persisted status='failed' + error to sandbox_runs before rethrowing).
    runPromise.catch((err: any) => {
      console.error(`[sandbox_run] background ${corpus} replay failed: ${err?.message || err}`);
    });
    return {
      success: true,
      status: "running",
      corpus,
      sampleSize,
      note: "Run continues in the background. Call sandbox_report (no args = latest run) to get the verdict.",
    };
  } catch (err: any) {
    return { error: `sandbox_run failed: ${err.message}` };
  }
}

async function sandboxReportHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const tenantId = ctx.tenantId as number;
  try {
    const { pool } = await import("../../../db");
    let row: any;
    if (params.runId !== undefined && params.runId !== null) {
      const runId = Number(params.runId);
      if (!Number.isInteger(runId) || runId <= 0) {
        return { error: "sandbox_report: runId must be a positive integer" };
      }
      const res = await pool.query(
        `SELECT id, corpus, status, overrides, sample_size, report, error, started_at, completed_at
         FROM sandbox_runs WHERE id = $1 AND tenant_id = $2`,
        [runId, tenantId],
      );
      row = res.rows[0];
      if (!row) return { error: `sandbox_report: no run ${runId} for this tenant` };
    } else {
      const res = await pool.query(
        `SELECT id, corpus, status, overrides, sample_size, report, error, started_at, completed_at
         FROM sandbox_runs WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`,
        [tenantId],
      );
      row = res.rows[0];
      if (!row) return { error: "sandbox_report: no sandbox runs for this tenant yet" };
    }
    return {
      success: true,
      runId: row.id,
      corpus: row.corpus,
      status: row.status,
      overrides: row.overrides,
      sampleSize: row.sample_size,
      verdict: row.report?.verdict ?? null,
      report: row.report ?? null,
      error: row.error ?? null,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  } catch (err: any) {
    return { error: `sandbox_report failed: ${err.message}` };
  }
}

async function sandboxPromoteHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required" };
  const tenantId = ctx.tenantId as number;

  const runId = Number(params.runId);
  if (!Number.isInteger(runId) || runId <= 0) {
    return { error: "sandbox_promote: runId must be a positive integer" };
  }
  const title = typeof params.title === "string" ? params.title.trim().slice(0, 200) : "";
  if (title.length < 5) {
    return { error: "sandbox_promote: title must be at least 5 characters" };
  }
  const rationale = typeof params.rationale === "string" ? params.rationale.trim().slice(0, 4000) : "";

  try {
    const { pool } = await import("../../../db");

    const runRes = await pool.query(
      `SELECT id, corpus, status, overrides, sample_size, report, completed_at
       FROM sandbox_runs WHERE id = $1 AND tenant_id = $2`,
      [runId, tenantId],
    );
    const run = runRes.rows[0];
    if (!run) return { error: `sandbox_promote: no run ${runId} for this tenant` };
    if (run.status !== "complete") {
      return { error: `sandbox_promote: run ${runId} is '${run.status}' — only completed runs can be promoted` };
    }

    // One proposal per run — re-promoting returns the existing row.
    const dupRes = await pool.query(
      `SELECT id, status, jury_verdict FROM sandbox_improvements WHERE run_id = $1 AND tenant_id = $2 LIMIT 1`,
      [runId, tenantId],
    );
    if (dupRes.rows[0]) {
      const d = dupRes.rows[0];
      return {
        success: true,
        alreadyPromoted: true,
        improvementId: d.id,
        status: d.status,
        juryVerdict: d.jury_verdict,
        note: `Run ${runId} was already promoted (improvement #${d.id}).`,
      };
    }

    const report = run.report || {};
    const verdict = report?.verdict ?? "UNKNOWN";
    const overrides = run.overrides || {};

    // Proposal snapshot survives run purge (run_id goes NULL on retention).
    const proposal = {
      corpus: run.corpus,
      overrides,
      sampleSize: run.sample_size,
      sandboxVerdict: verdict,
      reportSnapshot: report,
      rationale: rationale || null,
      completedAt: run.completed_at,
    };

    // Insert BEFORE the jury call so a jury failure never loses the evidence:
    // on a thrown jury call the row stays 'jury_pending' (surfaced on the
    // Improvement list for manual review); ESCALATE maps to 'escalated' below.
    // Partial unique index uq_sandbox_improvements_tenant_run makes this
    // race-safe: a concurrent duplicate promote hits ON CONFLICT and we
    // return the existing row instead of double-inserting.
    const insRes = await pool.query(
      `INSERT INTO sandbox_improvements (tenant_id, run_id, title, summary, proposal, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'jury_pending')
       ON CONFLICT (tenant_id, run_id) WHERE run_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [tenantId, runId, title, rationale || `Sandbox run ${runId} (${run.corpus}) verdict ${verdict}`, JSON.stringify(proposal)],
    );
    if (!insRes.rows[0]) {
      // Lost the race — another promote landed between the dup-check and this INSERT.
      const raceRes = await pool.query(
        `SELECT id, status, jury_verdict FROM sandbox_improvements WHERE run_id = $1 AND tenant_id = $2 LIMIT 1`,
        [runId, tenantId],
      );
      const r = raceRes.rows[0];
      return {
        success: true,
        alreadyPromoted: true,
        improvementId: r?.id,
        status: r?.status,
        juryVerdict: r?.jury_verdict,
        note: `Run ${runId} was already promoted concurrently (improvement #${r?.id}).`,
      };
    }
    const improvementId = insRes.rows[0].id;

    const { juryTriage } = await import("../../../lib/jury-triage");
    const issueText =
      `Proposed system upgrade (from Simulation Sandbox run ${runId}, corpus '${run.corpus}', ` +
      `${run.sample_size} historical items replayed, sandbox verdict ${verdict}): ${title}. ` +
      `Should this configuration change be adopted into the live platform? ` +
      `Vote ACCEPT if the sandbox evidence supports adopting it, REJECT if not, FIX if it needs modification first.`;
    const context =
      `Override bundle tested: ${JSON.stringify(overrides).slice(0, 1500)}\n` +
      `Sandbox report: ${JSON.stringify(report).slice(0, 3000)}\n` +
      (rationale ? `Proposer rationale: ${rationale.slice(0, 1500)}` : "");

    const decision = await juryTriage({ issueText, context, tenantId, invokedVia: "sandbox_promote" });

    const status =
      decision.verdict === "ACCEPT" ? "approved" :
      decision.verdict === "FIX" ? "approved" : // approved-with-changes; fixProposal carried in votes
      decision.verdict === "REJECT" ? "rejected" : "escalated";

    await pool.query(
      `UPDATE sandbox_improvements
       SET jury_verdict = $1, jury_votes = $2::jsonb, status = $3, decided_at = now()
       WHERE id = $4 AND tenant_id = $5`,
      [
        decision.verdict,
        JSON.stringify({ votes: decision.votes, majority: decision.majority, concordance: decision.concordance, aggregatorAnswer: decision.aggregatorAnswer, fixProposal: decision.fixProposal ?? null }),
        status,
        improvementId,
        tenantId,
      ],
    );

    return {
      success: true,
      improvementId,
      juryVerdict: decision.verdict,
      majority: decision.majority,
      status,
      note:
        status === "approved"
          ? `Jury ${decision.verdict} (${decision.majority} votes) — on the Improvement list at /admin/sandbox. NOT auto-applied; a human/agent picks it up from the list.`
          : status === "rejected"
            ? `Jury rejected the proposal (${decision.majority} votes). Logged for the record.`
            : `No jury majority — escalated for owner review on the Improvement list.`,
    };
  } catch (err: any) {
    return { error: `sandbox_promote failed: ${err.message}` };
  }
}

/** Registered by ./index.ts at import time. */
export const sandboxDomainTools: RegisteredTool[] = [
  defineTool(sandboxRunDefinition, sandboxRunHandler),
  defineTool(sandboxReportDefinition, sandboxReportHandler),
  defineTool(sandboxPromoteDefinition, sandboxPromoteHandler),
];
