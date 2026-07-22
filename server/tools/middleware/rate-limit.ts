/**
 * Tools-layer-split S24 — middleware extraction, phase 7 of the middleware
 * order (tracing → performance ledger → step ledger → instant-play → product
 * verification → autonomy → rate-limit LAST).
 *
 * MECHANICAL move of the inline expensive-tool rate-limit gate out of
 * `executeTool` (server/tools.ts) — ZERO behavior change. This is the
 * fail-CLOSED backstop + the `_rateLimitChecked` handshake, so it is extracted
 * LAST and its semantics are preserved verbatim:
 *   - happy path: for tenant-scoped, not-already-checked calls, throttle
 *     expensive tools via the limiter, record usage, and STAMP
 *     `params._rateLimitChecked = true` (mutates the caller's params object by
 *     reference — the handshake executeGuardedTool relies on to avoid
 *     double-counting).
 *   - catch path (limiter import/runtime error): FAIL-CLOSED for expensive
 *     tools using the canonical `EXPENSIVE_TOOL_NAMES` snapshot with a
 *     hardcoded backstop set; cheap tools fall through (DoS surface only).
 *
 * Returns a `{ error }` envelope to short-circuit the call, or `null` to
 * proceed. The limiter module is pulled via a call-time dynamic import that
 * mirrors the previous lazy load EXACTLY and keeps this module free of a static
 * edge into the app graph (acyclicity invariant —
 * data/feature-contracts/tools-layer-split/spec.md).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

export async function enforceRateLimitGate(
  name: string,
  params: Record<string, any>,
): Promise<{ error: string } | null> {
  // R74.13z-tris (architect Area A #2): enforce expensive-tool rate limits at the
  // dispatcher boundary. executeGuardedTool already checks before calling here
  // and sets _rateLimitChecked=true to avoid double-counting. Direct callers
  // (mcp-server, research-pipeline, skill-seeker, task-planner, recursive-llm
  // recovery hook, internal recursive tool calls) previously bypassed all
  // throttling — recursive_synthesize in particular is fan-out-heavy and must
  // be capped here too.
  try {
    const rlTenant = typeof params._tenantId === "number" ? params._tenantId : undefined;
    if (rlTenant && !(params as any)._rateLimitChecked) {
      const { checkToolRateLimit, recordToolUsage, isExpensiveTool } = await import("../../tool-rate-limiter");
      if (isExpensiveTool(name)) {
        const rl = checkToolRateLimit(rlTenant, name);
        if (!rl.allowed) {
          console.warn(`[executeTool] RATE LIMITED tool=${name} tenant=${rlTenant} reason=${rl.reason}`);
          return { error: `RATE LIMITED: ${rl.reason} Use a different tool or approach instead.` };
        }
        recordToolUsage(rlTenant, name);
        (params as any)._rateLimitChecked = true;
      }
    }
  } catch (e: any) {
    // R110.11 — fail-CLOSED for expensive tools when limiter import/runtime errors.
    // R110 raised costly-tool ceilings 30x (generate_audio 2/10/30 → 60/600/2000 etc.);
    // a fail-OPEN limiter combined with relaxed limits would amplify spend/quota
    // blast radius if the limiter ever broke (Redis outage, module corruption).
    // Cheap tools still fall through (DoS surface only, no $ at stake).
    console.error("[executeTool] rate-limit gate error:", e?.message || e);
    // Hardcoded backstop list — verbatim mirror of EXPENSIVE_TOOLS keys in
    // server/tool-rate-limiter.ts. Used only when limiter module is unloadable
    // AND the EXPENSIVE_TOOL_NAMES export below is also unreachable (extreme
    // edge case). Architect-flagged R110.11 round-2: previous 14-entry list
    // missed 26 limiter-classified tools; this is the full set.
    const HARDCODED_EXPENSIVE = new Set([
      "deep_research", "monid_run", "monid_discover", "monid_inspect",
      "ensemble_query", "recursive_synthesize", "produce_video", "generate_audio",
      "create_slideshow_video", "browser", "firecrawl_crawl", "firecrawl_scrape",
      "orchestrate", "plan_and_execute", "debate", "tree_of_thought", "analyze_pdf",
      "web_search", "web_fetch", "finance_news", "finance_stock_price",
      "finance_stock_search", "finance_market_overview", "forecast_ticker",
      "cross_critique", "video_transcribe_words", "analyze_portfolio",
      "generate_social_image", "mpeg_produce", "mpeg_produce_parallel",
      "start_video_job", "finalize_video", "build_presentation_distributed",
      "create_slides", "run_supervisor", "delegate_task", "google_workspace",
      "deliver_product", "run_ab_eval", "propose_skill", "generate_design_doc",
      "second_opinion", "venture_discovery",
    ]);
    let expensive = HARDCODED_EXPENSIVE.has(name);
    try {
      const mod = await import("../../tool-rate-limiter");
      // Prefer canonical exported snapshot (auto-derived from EXPENSIVE_TOOLS).
      if (Array.isArray(mod.EXPENSIVE_TOOL_NAMES)) {
        expensive = expensive || mod.EXPENSIVE_TOOL_NAMES.includes(name);
      }
      try { expensive = expensive || mod.isExpensiveTool(name); }
      catch (classifyErr: any) {
        console.error(`[executeTool] isExpensiveTool threw — using hardcoded+snapshot fallback (expensive=${expensive}):`, classifyErr?.message || classifyErr);
      }
    } catch (importErr: any) {
      console.error(`[executeTool] limiter module unloadable — using hardcoded expensive list (expensive=${expensive}):`, importErr?.message || importErr);
    }
    if (expensive) {
      console.error(`[executeTool] FAIL-CLOSED expensive tool=${name} on limiter error`);
      return { error: `RATE LIMITED: rate-limit checker unavailable; expensive tool "${name}" blocked. Retry shortly or use a different approach.` };
    }
  }
  return null;
}
