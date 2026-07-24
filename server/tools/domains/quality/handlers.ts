/**
 * Tools-layer-split S10 — quality-domain migrated handlers.
 *
 * Selection per plan.md smallest-safe-batch precedent: 12 of the 13
 * quality-cluster tools migrate — `sculptor_review`,
 * `verify_felix_proposal_spec`, `cross_critique`, `list_critiques`,
 * `critique_response`, `quality_baseline_save`, `quality_baseline_check`,
 * `verify_deliverable`, `verify_math_chain`, `grade_deliverable`,
 * `verify_delivery_proof`, `verify_with_cove`. Their only trust channels are
 * `_tenantId` / `_personaId` / `_conversationId`, all covered by the trusted
 * ToolContext seams. `evaluate_against_contract` STAYS LEGACY: it also reads
 * `_personaName` + `_userId`, which ToolContext does not carry (S5
 * `write_file` precedent — needs a dedicated trust-seam slice first).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim). The ONLY
 * edits: caller-supplied `params._tenantId` / `params._personaId` /
 * `params._conversationId` reads become `ctx.tenantId` / `ctx.personaId` /
 * `ctx.conversationId` (the dispatcher strips + re-stamps these from the
 * trusted context), relative import paths gain the `../../../` prefix, and
 * `logSilentCatch` is a call-time dynamic import (package acyclicity —
 * mirrors the files/knowledge/web slices). No tools.ts module-scope helpers
 * moved: every dependency is an external module the legacy arms already
 * dynamic-imported (./sculptor, ./cross-critique, ./deliverable-grader,
 * ./deliverable-verifier, ./sensors/structural-signal, ./math-chain-verify,
 * ./critique-agent, ./felix-loop, ./lib/cove-verifier, ./agentic/*).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  sculptorReviewDefinition,
  verifyFelixProposalSpecDefinition,
  crossCritiqueDefinition,
  listCritiquesDefinition,
  critiqueResponseDefinition,
  qualityBaselineSaveDefinition,
  qualityBaselineCheckDefinition,
  verifyDeliverableDefinition,
  verifyMathChainDefinition,
  gradeDeliverableDefinition,
  verifyDeliveryProofDefinition,
  verifyWithCoveDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function sculptorReviewHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.tenantId !== 1) return { error: "Admin-only tool" };
  if (!ctx.tenantId) return { error: "Tenant context required for sculptor_review" };
  const tenantId = ctx.tenantId;
  const command = params.command || "list";

  if (command === "review") {
    if (!params.sessionId) return { error: "sessionId required for review" };
    const { reviewSessionWork } = await import("../../../sculptor");
    return reviewSessionWork(params.sessionId, tenantId);
  }
  if (command === "compare") {
    if (!params.comparisonGroup) return { error: "comparisonGroup required for compare" };
    const { compareSessionResults } = await import("../../../sculptor");
    return compareSessionResults(params.comparisonGroup, tenantId);
  }
  if (command === "replay") {
    if (!params.sessionId) return { error: "sessionId required for replay" };
    const { getSessionReplay } = await import("../../../sculptor");
    return getSessionReplay(params.sessionId, tenantId);
  }
  if (command === "list") {
    const { listSessions } = await import("../../../sculptor");
    return listSessions(tenantId);
  }
  return { error: `Unknown sculptor command: ${command}` };
}

async function verifyFelixProposalSpecHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (ctx.tenantId !== 1) return { error: "verify_felix_proposal_spec is Bob-only (owner tenant)" };
  if (!params.id) return { error: "id is required" };
  const { verifyFelixProposalSpec } = await import("../../../felix-loop");
  return await verifyFelixProposalSpec(Number(params.id), ctx.tenantId);
}

async function crossCritiqueHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for cross_critique" };
  const { crossCritique } = await import("../../../cross-critique");
  const r = await crossCritique({
    target: String(params.target || ""),
    context: params.context ? String(params.context) : undefined,
    panelists: Array.isArray(params.panelists) ? params.panelists : undefined,
    tenantId: ctx.tenantId,
    personaId: ctx.personaId,
  });
  return r;
}

async function listCritiquesHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for list_critiques" };
  const { listCritiques } = await import("../../../cross-critique");
  const items = await listCritiques({ limit: Number(params.limit) || 10, tenantId: ctx.tenantId });
  return { success: true, count: items.length, critiques: items };
}

async function critiqueResponseHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { critiqueToolForAgent } = await import("../../../critique-agent");
  return critiqueToolForAgent(params.content, params.context);
}

async function qualityBaselineSaveHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  // R98.7 — Sentrux-inspired structural sensor. Saves a labelled snapshot
  // of file count / LOC / god-files / fan-in/out / score to a sidecar JSON
  // (.local/structural-baselines.json). Pure-TS, sub-2s, no external deps.
  try {
    const { saveBaseline } = await import("../../../sensors/structural-signal");
    const label = String(params.label || "").trim();
    if (!label) return { error: "label is required" };
    const includeCycles = params.include_cycles === true;
    const snap = await saveBaseline(label, { includeCycles });
    return {
      success: true,
      label,
      score: snap.score,
      score_breakdown: snap.scoreBreakdown,
      file_count: snap.fileCount,
      total_loc: snap.totalLoc,
      god_files: snap.godFiles.slice(0, 5),
      biggest_file: snap.biggestFile,
      top_fan_in: snap.topFanIn.slice(0, 3),
      top_fan_out: snap.topFanOut.slice(0, 3),
      duration_ms: snap.durationMs,
      note: "Baseline saved. Run quality_baseline_check with this label before declaring the task done.",
    };
  } catch (e: any) {
    return { error: `quality_baseline_save failed: ${e?.message || String(e)}` };
  }
}

async function qualityBaselineCheckHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const action = String(params.action || "compare").toLowerCase();
    if (action === "list") {
      const { listBaselines } = await import("../../../sensors/structural-signal");
      const list = await listBaselines();
      return { success: true, baselines: list, count: list.length };
    }
    if (action === "delete") {
      const { deleteBaseline } = await import("../../../sensors/structural-signal");
      const label = String(params.label || "").trim();
      if (!label) return { error: "label is required for delete" };
      const ok = await deleteBaseline(label);
      return { success: ok, deleted: ok ? label : null };
    }
    const label = String(params.label || "").trim();
    if (!label) return { error: "label is required (or use action='list')" };
    const includeCycles = params.include_cycles === true;
    const { compareToBaseline } = await import("../../../sensors/structural-signal");
    const { baseline, current, delta } = await compareToBaseline(label, { includeCycles });
    if (!baseline) {
      return {
        success: false,
        error: `No baseline named '${label}'. Save one first with quality_baseline_save({label:'${label}'}).`,
        current_score: current.score,
        current_file_count: current.fileCount,
        current_total_loc: current.totalLoc,
      };
    }
    return {
      success: true,
      regressed: delta?.regressed,
      score_delta: delta?.scoreDelta,
      baseline_score: baseline.score,
      current_score: current.score,
      file_count_delta: delta?.fileCountDelta,
      total_loc_delta: delta?.totalLocDelta,
      new_god_files: delta?.newGodFiles || [],
      god_files_grown: delta?.godFilesGrown || [],
      notes: delta?.notes || [],
      baseline_at: baseline.takenAt,
      current_at: current.takenAt,
      duration_ms: current.durationMs,
      guidance: delta?.regressed
        ? "REGRESSED — the codebase got structurally worse since baseline. Address the regression OR explicitly tell Bob why you're shipping anyway. Consider record_failure_pattern if this caught a mistake worth remembering."
        : "OK — no structural regression detected. Proceed with confidence.",
    };
  } catch (e: any) {
    return { error: `quality_baseline_check failed: ${e?.message || String(e)}` };
  }
}

async function verifyDeliverableHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { verifyDeliverable } = await import("../../../deliverable-verifier");
  // R76 — Fail-closed on missing tenant context.
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) {
    return { error: "verify_deliverable requires explicit _tenantId" };
  }
  const type = String(params.deliverable_type || "");
  if (!type) return { error: "deliverable_type is required" };
  if (!params.file_path && !params.file_url) return { error: "file_path or file_url is required" };
  try {
    const result = await verifyDeliverable({
      tenantId: tid,
      deliverableType: type,
      filePath: params.file_path,
      fileUrl: params.file_url,
    });
    return { success: true, ...result };
  } catch (e) {
    return { error: `verify_deliverable failed: ${(e as Error).message}` };
  }
}

async function verifyMathChainHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  // No tenant requirement — pure deterministic arithmetic, no LLM, no DB writes.
  try {
    const { verifyMathChain } = await import("../../../math-chain-verify");
    const rawSteps = Array.isArray(params.steps) ? params.steps : [];
    if (rawSteps.length === 0) return { error: "steps must be a non-empty array" };
    const steps = rawSteps.map((s: any) => ({
      id: String(s?.id || ""),
      expression: String(s?.expression || ""),
      claimedValue: typeof s?.claimed_value === "number" ? s.claimed_value : undefined,
      unit: s?.unit ? String(s.unit) : undefined,
    }));
    const bindings: Record<string, number> = {};
    if (params.bindings && typeof params.bindings === "object") {
      for (const [k, v] of Object.entries(params.bindings)) {
        if (typeof v === "number" && Number.isFinite(v) && /^[A-Za-z_][\w]*$/.test(k)) {
          bindings[k] = v;
        }
      }
    }
    const result = verifyMathChain({
      steps,
      bindings,
      expectedFinal: typeof params.expected_final === "number" ? params.expected_final : undefined,
      tolerance: typeof params.tolerance === "number" ? params.tolerance : undefined,
    });
    return { success: true, ...result };
  } catch (e) {
    return { error: `verify_math_chain failed: ${(e as Error).message}` };
  }
}

async function gradeDeliverableHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R98.13 W3 — Per-format quality grader.
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "grade_deliverable requires tenant context" };
  try {
    const { gradeDeliverable } = await import("../../../deliverable-grader");
    const { resolveGradeDecision, failOpenCompletionGate } = await import("../../../agentic/grade-decision");
    const res = await gradeDeliverable({
      tenantId: tid,
      deliverableType: String(params.deliverable_type || ""),
      filePath: params.file_path ? String(params.file_path) : undefined,
      fileUrl: params.file_url ? String(params.file_url) : undefined,
      expectedSpec: params.expected_spec || undefined,
      model: params.model ? String(params.model) : undefined,
    });

    // Independent completion gate for custom / non-rubric deliverables. The
    // six per-format graders (video/audio/pdf/slides/html_app/image) carry
    // real rubrics; everything else (custom dynamically-composed plans,
    // unsupported types) returns skipped/unsupported, which previously meant
    // a custom deliverable's "done" rode on the workers' self-report (or a
    // false "unsupported ⇒ fail"). When acceptance_notes (composeDynamicPlan
    // always supplies them) and/or the original request are passed for such
    // a deliverable, run the SAME independent completion evaluator the CEO
    // loop uses — a structurally-distinct judge, never the worker — against a
    // goal contract built from those acceptance criteria, and let ITS verdict
    // drive `ok`. Fail-OPEN: any evaluator failure / degradation PASSES the
    // gate (the worker proceeds; next_step warns to double-check) rather than
    // hard-failing the custom deliverable on the default unsupported verdict.
    // R125+137.81 — GOLD EXEMPLAR CAPTURE (fire-and-forget, fail-open). When a
    // deliverable passes with a top score, store its production text (script /
    // outline / copy — `content_excerpt`, falling back to expected_spec.transcript)
    // as a few-shot exemplar for future productions of the same format+tenant.
    // Never blocks or fails the grade.
    try {
      const exemplarText = String(params.content_excerpt || params.expected_spec?.transcript || "");
      if (res.ok && typeof res.score === "number" && exemplarText.length >= 80) {
        const { maybeStoreExemplar } = await import("../../../lib/deliverable-exemplars");
        void maybeStoreExemplar({
          tenantId: tid,
          format: String(res.graderFormat || params.deliverable_type || ""),
          score: res.score,
          content: exemplarText,
          title: params.request ? String(params.request).slice(0, 200) : undefined,
          metadata: { filePath: params.file_path ? String(params.file_path).slice(0, 300) : undefined },
        }).catch(() => { /* fail-open by contract; maybeStoreExemplar logs internally */ });
      }
    } catch (_exemplarErr) {
      const { logSilentCatch } = await import("../../../lib/silent-catch");
      logSilentCatch("server/tools/domains/quality/handlers.ts", _exemplarErr);
    }

    const rubricSkipped = res.graderFormat === "unsupported" || !!res.skipped;
    const acceptanceNotes = params.acceptance_notes ? String(params.acceptance_notes).slice(0, 1200) : "";
    const requestText = params.request ? String(params.request).slice(0, 2000) : "";
    let completionGate: { verdict: string; reason: string; degraded: boolean; unmet?: string[] } | undefined;
    if (rubricSkipped && (acceptanceNotes || requestText)) {
      try {
        const { buildGoalContract } = await import("../../../agentic/goal-contract");
        const { evaluateCompletion } = await import("../../../agentic/completion-evaluator");
        const objective = (requestText || acceptanceNotes).slice(0, 2000);
        const contract = await buildGoalContract(objective, { tenantId: tid });
        if (acceptanceNotes) {
          contract.verificationMethod = `${acceptanceNotes}\n\n(plus: ${contract.verificationMethod})`.slice(0, 800);
        }
        const completion = await evaluateCompletion(contract, {
          steps: [],
          summarySnippet: `${res.critique || ""}\n${(res.issues || []).map((i) => i.message).join("; ")}`.slice(0, 2000),
          deliverableLinks: [params.file_url, params.file_path].filter(Boolean).map((x) => String(x)),
          elapsedMs: 0,
        }, { tenantId: tid });
        completionGate = {
          verdict: completion.verdict,
          reason: completion.reason,
          degraded: !!completion.evaluatorDegraded,
          unmet: completion.unmetCriteria,
        };
      } catch (_silentErr) {
        const { logSilentCatch } = await import("../../../lib/silent-catch");
        logSilentCatch("server/tools/domains/quality/handlers.ts", _silentErr);
        // Fail-OPEN: if buildGoalContract (or anything before the evaluator)
        // throws, do NOT let a non-rubric deliverable hard-fail on the default
        // unsupported ⇒ ok:false. Emit a degraded, PASSING gate so the worker
        // proceeds; the next_step warns to double-check. evaluateCompletion
        // itself never throws (falls open to evaluatorDegraded internally), so
        // this catch is the goal-contract-setup safety net.
        completionGate = failOpenCompletionGate();
      }
    }
    // For non-rubric deliverables the completion judge REPLACES the trivial
    // rubric verdict; for the six rubric formats it never runs, so res.ok
    // stands unchanged. Decision logic lives in ./agentic/grade-decision
    // (pure, unit-tested in tests/unit/grade-decision.test.ts).
    //
    // Bounded revise loop: the caller is TOLD (via next_step) to thread
    // `attempt`/`prev_scores` back on each re-grade, but bounding must NOT depend
    // on caller honesty (a reset attempt=1 each call would loop forever). When a
    // conversationId is present we reconcile the caller-supplied values against a
    // server-authoritative per-(tenant, conversation, deliverable-type) tracker
    // that never shrinks — a caller can only make the loop escalate SOONER, not
    // run longer. Without a conversationId (internal/one-off callers that don't
    // loop) we fall back to the pure caller-supplied bound (default 3).
    const maxAttempts = params.max_attempts !== undefined ? Number(params.max_attempts) : undefined;
    let attemptCtx: { attempt?: number; maxAttempts?: number; priorScores?: number[] };
    let loopKey: string | undefined;
    if (typeof ctx.conversationId === "number" && ctx.conversationId > 0) {
      const { reviseLoopKey, reconcileReviseAttempt } = await import("../../../agentic/revise-loop-tracker");
      loopKey = reviseLoopKey(tid, ctx.conversationId, String(params.deliverable_type || ""));
      const reconciled = reconcileReviseAttempt(
        loopKey,
        params.attempt !== undefined ? Number(params.attempt) : undefined,
        Array.isArray(params.prev_scores) ? params.prev_scores : undefined,
      );
      attemptCtx = { attempt: reconciled.attempt, maxAttempts, priorScores: reconciled.priorScores };
    } else {
      attemptCtx = {
        attempt: params.attempt !== undefined ? Number(params.attempt) : undefined,
        maxAttempts,
        priorScores: Array.isArray(params.prev_scores) ? params.prev_scores : undefined,
      };
    }
    const { finalOk, nextStep, escalated } = resolveGradeDecision(
      { ok: res.ok, score: res.score, passingBar: res.passingBar },
      completionGate,
      attemptCtx,
    );
    if (loopKey) {
      const { recordReviseOutcome } = await import("../../../agentic/revise-loop-tracker");
      recordReviseOutcome(
        loopKey,
        attemptCtx.attempt ?? 1,
        attemptCtx.priorScores ?? [],
        res.score,
        finalOk || escalated,
      );
    }
    return {
      ok: finalOk,
      score: res.score,
      passing_bar: res.passingBar,
      issues: res.issues,
      critique: res.critique,
      metrics: res.metrics,
      grader_format: res.graderFormat,
      skipped: res.skipped,
      completion_gate: completionGate,
      next_step: nextStep,
    };
  } catch (e: any) {
    return { error: `grade_deliverable failed: ${e?.message || String(e)}` };
  }
}

async function verifyDeliveryProofHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R98.12 W2 — refuse-to-declare-done gate. Three independent proofs.
  const tid = ctx.tenantId;
  if (typeof tid !== "number" || tid <= 0) return { error: "verify_delivery_proof requires tenant context" };
  const deliverableType = String(params.deliverable_type || "").trim();
  if (!deliverableType) return { error: "deliverable_type is required" };
  const filePath = params.file_path ? String(params.file_path) : undefined;
  const fileUrl = params.file_url ? String(params.file_url) : undefined;
  const projectId = typeof params.project_id === "number" ? params.project_id : undefined;
  const fileName = params.file_name ? String(params.file_name) : undefined;
  const requireProjectFile = params.require_project_file === true;
  const proofs: any = { artifact: false, url: false, projectFile: false };
  const missing: string[] = [];
  const evidence: any = {};

  // Proof 1 — artifact passes deliverable-contract verification.
  try {
    const { verifyDeliverable } = await import("../../../deliverable-verifier");
    const v = await verifyDeliverable({
      tenantId: tid,
      deliverableType,
      filePath,
      fileUrl,
      personaId: ctx.personaId,
      conversationId: ctx.conversationId,
    });
    evidence.artifact = { status: v.status, failures: v.failures, detected: v.detected, verificationId: v.verificationId };
    if (v.status === "passed") proofs.artifact = true;
    else if (v.status === "skipped") missing.push(`artifact verification skipped: ${v.failures.join("; ") || "no contract or url-only"}`);
    else missing.push(`artifact verification FAILED: ${v.failures.join("; ")}`);
  } catch (e: any) {
    missing.push(`artifact verification crashed: ${e?.message || String(e)}`);
  }

  // Proof 2 — customer-reachable URL points to a trusted host.
  if (!fileUrl) {
    missing.push("file_url is missing — Felix MUST surface a customer-clickable URL (Drive viewUrl, our /uploads/ stream, or /v/ instant-play).");
  } else {
    try {
      const u = new URL(fileUrl);
      const host = u.hostname.toLowerCase();
      const path = u.pathname || "";
      const isDrive = host === "drive.google.com" || host === "docs.google.com";
      const isOurUploads = path.startsWith("/uploads/") || path.startsWith("/v/") || path.startsWith("/watch/") || path.startsWith("/d/");
      // Architect HIGH #2 fix: drop `localhost` from production allowlist —
      // a "trusted" loopback URL handed to Bob's mobile inbox would 404
      // anyway, and listing it as trusted creates an SSRF-shaped escape
      // hatch if any downstream code actually fetches the URL. Only allow
      // localhost when explicitly running in non-production environments.
      const allowLoopback = process.env.NODE_ENV !== "production";
      const isOurHost = /\.replit\.(app|dev|co)$/.test(host) || /agenticcorporation\.net$/.test(host) || (allowLoopback && (host === "localhost" || host === "127.0.0.1"));
      if (isDrive || (isOurHost && isOurUploads)) {
        proofs.url = true;
        evidence.url = { host, path: path.slice(0, 120), kind: isDrive ? "drive" : "self-hosted-stream" };
      } else {
        missing.push(`file_url host '${host}' is not in the trusted set (drive.google.com / docs.google.com / our self-hosted /uploads /v /watch). Use deliverDigitalProduct's signed URL.`);
      }
    } catch (e: any) {
      missing.push(`file_url is not parseable: ${e?.message || String(e)}`);
    }
  }

  // Proof 3 — optional project_files row.
  if (projectId != null) {
    try {
      const { db } = await import("../../../db");
      const { sql } = await import("drizzle-orm");
      const lookup = fileName || (filePath ? filePath.split("/").pop() : undefined);
      if (!lookup) {
        if (requireProjectFile) missing.push("project_id given but file_name (or file_path) needed to look up project_files row");
      } else {
        const row = await db.execute(sql`
          SELECT id, file_name, drive_url, created_at FROM project_files
          WHERE tenant_id = ${tid} AND project_id = ${projectId} AND file_name = ${lookup}
          ORDER BY created_at DESC LIMIT 1
        `);
        const found = (row as any).rows?.[0];
        if (found) { proofs.projectFile = true; evidence.projectFile = { id: found.id, file_name: found.file_name, drive_url: found.drive_url }; }
        else if (requireProjectFile) missing.push(`no project_files row for project_id=${projectId} file_name='${lookup}'`);
      }
    } catch (e: any) {
      if (requireProjectFile) missing.push(`project_files lookup crashed: ${e?.message || String(e)}`);
    }
  }

  const ok = proofs.artifact && proofs.url && (!requireProjectFile || proofs.projectFile);
  const summary = ok
    ? `DELIVERY PROVEN: artifact ✓, url ✓${proofs.projectFile ? ", project_file ✓" : ""}. Safe to tell Bob this is done.`
    : `DELIVERY NOT PROVEN — ${missing.length} missing proof(s). DO NOT tell Bob this is done. Fix the issues above first.`;
  return { ok, proofs, missing, evidence, summary };
}

async function verifyWithCoveHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tid = ctx.tenantId;
  if (!tid || typeof tid !== "number") return { error: "Tenant context required for verify_with_cove" };
  const draft = typeof params.draft === "string" ? params.draft : "";
  if (!draft.trim()) return { error: "verify_with_cove requires a non-empty `draft` string" };
  try {
    const { verifyWithCoVe, gradeClaims } = await import("../../../lib/cove-verifier");
    const modelTier = (params.modelTier === "fast" || params.modelTier === "balanced" || params.modelTier === "powerful") ? params.modelTier : undefined;
    // Opt-in graded-verdict report (5-level taxonomy + pass/fail gate +
    // cost-aware sampling). Default off → identical behavior + zero extra
    // cost. Pass grade:true (optionally gradeMode:"draft"|"final") to add it.
    if (params.grade === true) {
      const report = await gradeClaims({
        draft,
        topic: typeof params.topic === "string" ? params.topic : undefined,
        tenantId: tid,
        mode: params.gradeMode === "draft" ? "draft" : "final",
        maxQuestions: typeof params.maxQuestions === "number" ? params.maxQuestions : undefined,
        modelTier,
      });
      return { verdictReport: report };
    }
    const result = await verifyWithCoVe({
      draft,
      topic: typeof params.topic === "string" ? params.topic : undefined,
      tenantId: tid,
      maxQuestions: typeof params.maxQuestions === "number" ? params.maxQuestions : undefined,
      modelTier,
    });
    return result;
  } catch (e: any) {
    return { error: `verify_with_cove failed: ${e?.message || String(e)}` };
  }
}

/** Registered by ./index.ts at import time. */
export const qualityDomainTools: RegisteredTool[] = [
  defineTool(sculptorReviewDefinition, sculptorReviewHandler),
  defineTool(verifyFelixProposalSpecDefinition, verifyFelixProposalSpecHandler),
  defineTool(crossCritiqueDefinition, crossCritiqueHandler),
  defineTool(listCritiquesDefinition, listCritiquesHandler),
  defineTool(critiqueResponseDefinition, critiqueResponseHandler),
  defineTool(qualityBaselineSaveDefinition, qualityBaselineSaveHandler),
  defineTool(qualityBaselineCheckDefinition, qualityBaselineCheckHandler),
  defineTool(verifyDeliverableDefinition, verifyDeliverableHandler),
  defineTool(verifyMathChainDefinition, verifyMathChainHandler),
  defineTool(gradeDeliverableDefinition, gradeDeliverableHandler),
  defineTool(verifyDeliveryProofDefinition, verifyDeliveryProofHandler),
  defineTool(verifyWithCoveDefinition, verifyWithCoveHandler),
];
