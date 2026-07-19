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
import { sandboxRunDefinition, sandboxReportDefinition } from "./definitions";

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

/** Registered by ./index.ts at import time. */
export const sandboxDomainTools: RegisteredTool[] = [
  defineTool(sandboxRunDefinition, sandboxRunHandler),
  defineTool(sandboxReportDefinition, sandboxReportHandler),
];
