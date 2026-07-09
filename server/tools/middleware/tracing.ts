/**
 * Tools-layer-split S24 — middleware extraction, phase 1 of the middleware
 * order (tracing → performance ledger → step ledger → instant-play → product
 * verification → autonomy → rate-limit LAST).
 *
 * MECHANICAL move of the inline tool-span glue out of `executeTool`
 * (server/tools.ts) — ZERO behavior change. This helper:
 *   - builds the allowlisted `_spanMeta` payload (paramKeys + the safe scalar
 *     topic/department/persona/conversationId enrichment) verbatim, and
 *   - opens a "tool" span via `withSpanOrRoot` (which opens an implicit root
 *     span when no trace context is active), running `inner` inside it.
 *
 * The span IMPLEMENTATION stays in `server/lib/agent-trace.ts`; it is pulled
 * via a call-time dynamic import that mirrors the previous lazy load EXACTLY
 * (same first-call timing) and keeps this module free of a static edge into
 * the app graph — the import-cycle invariant from
 * `data/feature-contracts/tools-layer-split/spec.md` (Unknowns / acyclicity).
 *
 * NOT moved here (different concerns, later middleware slices, all still in
 * `executeTool`): the TNR actionId injection, the tool_performance finally
 * ledger, instant-play / product verification, and the step-ledger
 * auto-record.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

export async function runWithToolSpan<T>(
  name: string,
  params: Record<string, any>,
  inner: () => Promise<T>,
): Promise<T> {
  // R101 — Causality: every tool call gets a span. withSpanOrRoot opens an
  // implicit root span when no trace context is active so the feature is
  // immediately useful even before the chat route is instrumented.
  const { withSpanOrRoot } = await import("../../lib/agent-trace");
  // R118+sec — span metadata enrichment surfaced by architect: the generic
  // {paramKeys} payload meant AEvo lookupCount + R118 topic_hint resolution
  // had nothing to join on (queries hit metadata->>topic / conversationId).
  // Allowlist a small set of safe scalar params so telemetry queries land.
  // Strings length-capped at 200 chars; numbers passed through; everything
  // else dropped (no objects, no arrays, no underscore-prefix runtime keys
  // that could leak credentials).
  const _spanMeta: Record<string, unknown> = {
    paramKeys: Object.keys(params).filter((k) => !k.startsWith("_")),
  };
  const _safeStr = (v: unknown) =>
    typeof v === "string" && v.length > 0 && v.length < 200 ? v : undefined;
  const _safeNum = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const _topic = _safeStr((params as any).topic);
  const _department = _safeStr((params as any).department);
  const _persona = _safeStr((params as any).persona);
  const _convId =
    _safeNum((params as any)._conversationId) ??
    _safeNum((params as any).conversationId);
  if (_topic !== undefined) _spanMeta.topic = _topic;
  if (_department !== undefined) _spanMeta.department = _department;
  if (_persona !== undefined) _spanMeta.persona = _persona;
  if (_convId !== undefined) _spanMeta.conversationId = _convId;
  return await withSpanOrRoot(
    {
      kind: "tool",
      toolName: name,
      agentName:
        typeof params._personaName === "string" ? params._personaName : undefined,
      summary: name,
      metadata: _spanMeta,
    },
    inner,
  );
}
