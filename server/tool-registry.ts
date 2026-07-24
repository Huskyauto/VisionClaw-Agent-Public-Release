import { logSilentCatch } from "./lib/silent-catch";
import { isExpensiveTool } from "./tool-rate-limiter";
export type SpeedClass = "fast" | "normal" | "slow" | "very_slow";

export interface ToolMeta {
  categories: string[];
  speed: SpeedClass;
  isProductOutput: boolean;
  isNetworkTool: boolean;
}

const registry = new Map<string, ToolMeta>();

export function registerTool(name: string, meta: ToolMeta): void {
  registry.set(name, meta);
}

export function getToolMeta(name: string): ToolMeta | undefined {
  return registry.get(name);
}

export function getAllRegisteredTools(): string[] {
  return Array.from(registry.keys());
}

export function getToolsByCategory(category: string): string[] {
  const tools: string[] = [];
  for (const [name, meta] of registry) {
    if (meta.categories.includes(category)) tools.push(name);
  }
  return tools;
}

export function getAllCategories(): string[] {
  const cats = new Set<string>();
  for (const meta of registry.values()) {
    for (const c of meta.categories) cats.add(c);
  }
  return [...cats];
}

export function getSlowTools(): Set<string> {
  const s = new Set<string>();
  for (const [name, meta] of registry) {
    if (meta.speed === "slow" || meta.speed === "very_slow") s.add(name);
  }
  return s;
}

export function getVerySlowTools(): Set<string> {
  const s = new Set<string>();
  for (const [name, meta] of registry) {
    if (meta.speed === "very_slow") s.add(name);
  }
  return s;
}

export function getProductOutputTools(): Set<string> {
  const s = new Set<string>();
  for (const [name, meta] of registry) {
    if (meta.isProductOutput) s.add(name);
  }
  return s;
}

export function getNetworkTools(): Set<string> {
  const s = new Set<string>();
  for (const [name, meta] of registry) {
    if (meta.isNetworkTool) s.add(name);
  }
  return s;
}

export function buildCategoryMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const [name, meta] of registry) {
    for (const cat of meta.categories) {
      if (!map[cat]) map[cat] = [];
      if (!map[cat].includes(name)) map[cat].push(name);
    }
  }
  return map;
}

export function auditRegistry(
  toolDefinitions: { function: { name: string; description?: string; parameters?: any } }[],
): string[] {
  const warnings: string[] = [];
  const definedNames = new Set(toolDefinitions.map(d => d.function.name));
  for (const def of toolDefinitions) {
    const name = def.function.name;
    if (!registry.has(name)) {
      // Custom tools are registered by tool-learning at load time via registerCustomTool().
      // If we still see an unregistered custom_ tool here, it means the loader missed it — informational only.
      if (name.startsWith("custom_")) continue;
      warnings.push(`[tool-registry] WARNING: Tool "${name}" has no registry entry — it won't appear in any router category, timeout class, or product verification.`);
    }
    // R110.13 — Tool design hygiene linter (Barry Zhang seminar §7.5):
    // sharp scope requires a real description AND a typed object schema.
    // Skip custom_ tools (user-emitted, separate review queue gates them).
    if (!name.startsWith("custom_")) {
      const desc = def.function.description ?? "";
      if (desc.trim().length < 30) {
        warnings.push(`[tool-registry] HYGIENE: Tool "${name}" has a thin description (${desc.trim().length} chars < 30). Models pick the wrong tool when descriptions are vague.`);
      }
      const params = def.function.parameters;
      if (params && typeof params === "object" && params.type !== undefined && params.type !== "object") {
        warnings.push(`[tool-registry] HYGIENE: Tool "${name}" input schema type="${params.type}" — must be "object" for the tool-use API to bind named arguments.`);
      }
    }
  }
  for (const regName of registry.keys()) {
    if (!definedNames.has(regName)) {
      warnings.push(`[tool-registry] INFO: Registry entry "${regName}" has no matching tool definition (may be an alias or future tool).`);
    }
  }
  try {
    // R74.13y: was `require("./tool-rate-limiter")` — CommonJS in an ESM
    // module silently failed every startup ("require is not defined"),
    // leaving the very_slow rate-limit coverage check disabled. Top-level
    // ESM import now guarantees the audit actually runs.
    const uncoveredVerySlow: string[] = [];
    for (const [name, meta] of registry.entries()) {
      if (meta.speed === "very_slow" && definedNames.has(name) && !isExpensiveTool(name)) {
        uncoveredVerySlow.push(name);
      }
    }
    if (uncoveredVerySlow.length > 0) {
      warnings.push(`[tool-registry] WARNING: ${uncoveredVerySlow.length} very_slow tools fall through to default rate limit (add to EXPENSIVE_TOOLS in tool-rate-limiter.ts): ${uncoveredVerySlow.join(", ")}`);
    }
  } catch (_silentErr) { logSilentCatch("server/tool-registry.ts", _silentErr); }
  return warnings;
}

export function getRegistryStats(): { total: number; bySpeed: Record<SpeedClass, number>; productOutput: number; networkTools: number; categories: number } {
  const bySpeed: Record<SpeedClass, number> = { fast: 0, normal: 0, slow: 0, very_slow: 0 };
  let productOutput = 0;
  let networkTools = 0;
  const cats = new Set<string>();
  for (const meta of registry.values()) {
    bySpeed[meta.speed]++;
    if (meta.isProductOutput) productOutput++;
    if (meta.isNetworkTool) networkTools++;
    for (const c of meta.categories) cats.add(c);
  }
  return { total: registry.size, bySpeed, productOutput, networkTools, categories: cats.size };
}

registerTool("readability_extract", { categories: ["research"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("monid_discover", { categories: ["research", "discovery", "web"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("monid_inspect", { categories: ["research", "discovery", "web"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("monid_catalog_browse", { categories: ["research", "discovery", "web"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("monid_run", { categories: ["research", "discovery", "web"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("template_scrape", { categories: ["research"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("template_scraper_stats", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("test_api_keys", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("scan_file", { categories: ["system", "security", "files"], speed: "normal", isProductOutput: false, isNetworkTool: false });
// R85/R88/R89 — context-hygiene + analytics tools exposed to agents
registerTool("scan_for_prompt_injection", { categories: ["security", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("get_usage_analytics", { categories: ["system", "finance"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("compress_context", { categories: ["system", "memory"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("check_system_status", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_models", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("ensemble_query", { categories: ["reasoning", "research", "system"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("jury_triage", { categories: ["reasoning", "system", "safety"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("second_opinion", { categories: ["reasoning", "research", "system"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("aeo_score", { categories: ["marketing", "content", "research"], speed: "fast", isProductOutput: false, isNetworkTool: false });
// R98.25 — surfaced by startup tool-registry audit (server/index.ts boot warning).
// `plan_video_production` is the R98.3 director sub-agent (LLM call to decompose
// topic → per-scene narration + image prompts); `verify_outbound_safety` is the
// R95 outbound redaction preflight gate. Both were live but un-registered, so
// they didn't appear in any router category, timeout class, or curator embedding.
registerTool("plan_video_production", { categories: ["media", "video", "reasoning"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("verify_outbound_safety", { categories: ["security", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
// R77.5 (KisMATH) — causal CoT step audit + math-chain verification.
registerTool("audit_reasoning_step", { categories: ["reasoning", "system"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("verify_math_chain", { categories: ["reasoning", "finance", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("recursive_synthesize", { categories: ["reasoning", "research"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("forecast_ticker", { categories: ["finance", "research", "system"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("analyze_portfolio", { categories: ["finance", "system"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("agent_status", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("agent_security_scan", { categories: ["system"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("context_budget_audit", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("create_plan", { categories: ["planning", "minerva"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("simulate_plan", { categories: ["planning", "felix", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("recommend_best_tool", { categories: ["planning", "system"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("list_plans", { categories: ["planning", "minerva"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("get_plan", { categories: ["planning", "minerva"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("get_minerva_roster", { categories: ["planning", "minerva", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("search_memory", { categories: ["memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("create_memory", { categories: ["memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
// R112.15 — L2 session memory: scoped to one conversation, not persona-lifetime.
registerTool("remember_for_this_session", { categories: ["memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("update_memory", { categories: ["memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("recall_context", { categories: ["memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("graph_memory", { categories: ["memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("search_knowledge", { categories: ["knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
// R125+3.9 — unified capability self-recall (rounds + skills + tools). Read-only.
registerTool("recall_capabilities", { categories: ["knowledge", "system", "reasoning"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("create_knowledge", { categories: ["knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
// R105 — PageIndex nugget: hierarchical heading-tree navigation for long uploaded docs.
registerTool("knowledge_navigate", { categories: ["knowledge", "research"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("store_triple", { categories: ["knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("query_triples", { categories: ["knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
// R75 — GraphRAG Five
registerTool("query_communities", { categories: ["memory", "knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("query_causal", { categories: ["memory", "knowledge", "reasoning"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("chunk_code", { categories: ["code", "knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
// R76 — Trust-Tier Policy Engine + Deliverable Contracts
registerTool("set_policy", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("set_my_profile_photo", { categories: ["system", "media"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("verify_deliverable", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
// R98.7 — Felix Self-Thinking Loop: failure-pattern memory + structural quality sensor (sentrux-inspired)
registerTool("record_failure_pattern", { categories: ["memory", "self_improvement"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("slash_command", { categories: ["system", "code"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("run_command", { categories: ["system", "code"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("recall_failure_patterns", { categories: ["memory", "self_improvement"], speed: "normal", isProductOutput: false, isNetworkTool: false });
// R98.12 — W7 positive-exemplar memory + W2 refuse-to-declare-done gate + W5 HTML app builder
registerTool("record_strategic_win", { categories: ["memory", "self_improvement"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("recall_strategic_wins", { categories: ["memory", "self_improvement"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("verify_delivery_proof", { categories: ["validation", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
// R98.27.7 — durable per-task workspace artifacts (Anthropic long-running agent pattern)
registerTool("workspace_init", { categories: ["system", "memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("workspace_update_status", { categories: ["system", "memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("workspace_log_artifact", { categories: ["system", "memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("workspace_read", { categories: ["system", "memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("workspace_finalize", { categories: ["system", "memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("workspace_list", { categories: ["system", "memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
// R98.27.8 — Codebase self-knowledge graph + diff-impact analysis (Understand-Anything-inspired). Read-only introspection over data/codebase-graph.json.
registerTool("codebase_graph_query", { categories: ["system", "code"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("codebase_diff_impact", { categories: ["system", "code", "validation"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("build_html_app", { categories: ["product_output", "code"], speed: "slow", isProductOutput: true, isNetworkTool: false });
// R98.13 — W4 prompt→contract router + W3 vision/audio quality grader
registerTool("plan_deliverable", { categories: ["system", "validation"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("grade_deliverable", { categories: ["validation", "system"], speed: "slow", isProductOutput: false, isNetworkTool: false });
// R98.21 — Hyperagent-cross-pollination: skill auto-emission queue + cross-run A/B
registerTool("propose_skill", { categories: ["self_improvement", "memory", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("run_ab_eval", { categories: ["evaluation", "self_improvement", "system"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
// R98.14 — W1.3+W1.4 background video jobs + reference learner (taste transfer)
registerTool("start_video_job", { categories: ["product_output", "media"], speed: "normal", isProductOutput: true, isNetworkTool: false });
registerTool("build_video_from_brief", { categories: ["product_output", "media"], speed: "normal", isProductOutput: true, isNetworkTool: true });
registerTool("check_video_job", { categories: ["system", "media"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("finalize_video", { categories: ["product_output", "media"], speed: "slow", isProductOutput: true, isNetworkTool: false });
// R99 — Felix Visual Continuity (ViMax #1+#2): portrait registry + reference + best-of-N selectors
registerTool("register_character_portrait", { categories: ["media", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_character_portraits", { categories: ["media", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("init_character_portraits", { categories: ["media", "product_output"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("select_references_for_frame", { categories: ["media", "system"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("select_best_image", { categories: ["media", "system"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("learn_from_reference", { categories: ["memory", "self_improvement", "research"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("recall_references", { categories: ["memory", "self_improvement"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("quality_baseline_save", { categories: ["code", "system", "self_improvement"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("quality_baseline_check", { categories: ["code", "system", "self_improvement"], speed: "normal", isProductOutput: false, isNetworkTool: false });
// R79 — MarTech Bundle (ported from charlie947/social-media-skills, MIT)
registerTool("build_voice_profile", { categories: ["content", "branding"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("get_voice_profile", { categories: ["content", "branding"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("generate_hooks", { categories: ["content", "social"], speed: "normal", isProductOutput: true, isNetworkTool: true });
registerTool("format_post", { categories: ["content", "social"], speed: "normal", isProductOutput: true, isNetworkTool: true });
registerTool("generate_content_matrix", { categories: ["content", "social", "planning"], speed: "normal", isProductOutput: true, isNetworkTool: true });
registerTool("score_post", { categories: ["content", "social", "evaluation"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("expire_triple", { categories: ["knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("doc_search", { categories: ["knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("get_daily_notes", { categories: ["notes"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("write_daily_note", { categories: ["notes"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("read_scratchpad", { categories: ["notes"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("write_scratchpad", { categories: ["notes"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("list_conversations", { categories: ["conversations"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("web_fetch", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("web_search", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
// R125+4 — Legitimate academic / scholarly search (4 free public APIs + 1 fan-out meta tool).
registerTool("academic_search", { categories: ["research", "web", "knowledge"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("arxiv_search", { categories: ["research", "web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("pubmed_search", { categories: ["research", "web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("openalex_search", { categories: ["research", "web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("crossref_lookup", { categories: ["research", "web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
// R125+35 — Public-API live-data pack (Agenvoy-inspired): 6 free, no-auth, read-only GETs.
registerTool("fetch_weather", { categories: ["research", "web"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("fetch_crypto_price", { categories: ["research", "web"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("generate_design_doc", { categories: ["research", "web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("fetch_exchange_rate", { categories: ["research", "web"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("fetch_wikipedia", { categories: ["research", "web", "knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("fetch_hacker_news", { categories: ["research", "web"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("lookup_ip_geo", { categories: ["research", "web"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("outlook_list_inbox", { categories: ["communication", "knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("outlook_search_inbox", { categories: ["communication", "knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("outlook_read_message", { categories: ["communication", "knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("browser", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("deep_research", { categories: ["web", "ai"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("trend_research", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("browser_workflow", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("stealth_browse", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("stealth_browse_camofox", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("vision_browse", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("site_login", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });

registerTool("send_email", { categories: ["email"], speed: "normal", isProductOutput: true, isNetworkTool: true });
registerTool("check_inbox", { categories: ["email"], speed: "normal", isProductOutput: false, isNetworkTool: true });

registerTool("sessions_list", { categories: ["sessions"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("sessions_history", { categories: ["sessions"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("sessions_send", { categories: ["sessions"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("sessions_spawn", { categories: ["sessions"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("subagents", { categories: ["sessions"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("analyze_pdf", { categories: ["pdf"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("create_pdf", { categories: ["pdf", "presentations"], speed: "normal", isProductOutput: true, isNetworkTool: false });
registerTool("fill_pdf", { categories: ["pdf"], speed: "normal", isProductOutput: true, isNetworkTool: false });
registerTool("edit_pdf", { categories: ["pdf"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_pdf_fields", { categories: ["pdf"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("create_styled_report", { categories: ["docs"], speed: "normal", isProductOutput: true, isNetworkTool: false });
registerTool("create_document", { categories: ["docs"], speed: "normal", isProductOutput: true, isNetworkTool: false });
registerTool("create_spreadsheet", { categories: ["docs"], speed: "normal", isProductOutput: true, isNetworkTool: false });
registerTool("render_diagram", { categories: ["docs"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("list_uploads", { categories: ["files"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("google_drive", { categories: ["files"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("read_file", { categories: ["files"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("write_file", { categories: ["files"], speed: "normal", isProductOutput: true, isNetworkTool: false });
registerTool("read_output_blob", { categories: ["files", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("code_slice", { categories: ["files", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("google_workspace", { categories: ["workspace"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("calendar_sync", { categories: ["workspace"], speed: "slow", isProductOutput: false, isNetworkTool: true });

registerTool("whatsapp", { categories: ["whatsapp"], speed: "normal", isProductOutput: false, isNetworkTool: true });

registerTool("deliver_product", { categories: ["delivery"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("delivery_status", { categories: ["delivery"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("generate_evidence_docket", { categories: ["delivery", "validation"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });

registerTool("draft_social_post", { categories: ["marketing"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("manage_content_calendar", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("marketing_analytics", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("marketing_experiment", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("generate_social_image", { categories: ["marketing", "media"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("search_stock_media", { categories: ["marketing", "media"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("compose_social_post", { categories: ["marketing"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("publish_social_post", { categories: ["marketing"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("manage_social_accounts", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("x_post_tweet", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("x_delete_tweet", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("x_get_tweet", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("x_get_mentions", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("x_get_timeline", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("x_search", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("x_like_tweet", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("x_retweet", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("x_get_me", { categories: ["marketing"], speed: "normal", isProductOutput: false, isNetworkTool: true });

registerTool("generate_audio", { categories: ["media"], speed: "slow", isProductOutput: true, isNetworkTool: true });
registerTool("create_slideshow_video", { categories: ["media"], speed: "slow", isProductOutput: true, isNetworkTool: true });
registerTool("produce_video", { categories: ["media"], speed: "very_slow", isProductOutput: true, isNetworkTool: true });
registerTool("mpeg_produce", { categories: ["media"], speed: "very_slow", isProductOutput: true, isNetworkTool: true });
registerTool("mpeg_produce_parallel", { categories: ["media"], speed: "very_slow", isProductOutput: true, isNetworkTool: true });
registerTool("mpeg_concat", { categories: ["media"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("bwb_weekly_build", { categories: ["media", "video", "social"], speed: "very_slow", isProductOutput: true, isNetworkTool: true });
registerTool("record_bwb_weight", { categories: ["data"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("mpeg_add_audio", { categories: ["media"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("vibevoice_transcribe", { categories: ["media"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("youtube", { categories: ["media"], speed: "normal", isProductOutput: false, isNetworkTool: true });

// Owner-only venture/business discovery loop (9-stage HITL). Dry-run by default
// ($0); live mode calls the ideation engine (network) under a daily cost cap.
registerTool("venture_discovery", { categories: ["research", "planning"], speed: "slow", isProductOutput: false, isNetworkTool: true });
// Simulation Sandbox (S4) — what-if replay of historical corpora under override
// bundles inside the side-effect firewall. sandbox_run spends LLM budget on the
// model-swap corpora (capped $5/run); sandbox_report is a tenant-scoped read.
registerTool("sandbox_run", { categories: ["evaluation", "system"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("sandbox_report", { categories: ["evaluation", "system"], speed: "fast", isProductOutput: false, isNetworkTool: false });
// sandbox_promote — promotes a tested sandbox upgrade into the jury-vetted
// Improvement list (NOT auto-apply); jury vote is an LLM call (network).
registerTool("sandbox_promote", { categories: ["evaluation", "system"], speed: "slow", isProductOutput: false, isNetworkTool: true });
// Verified Revenue Missions (S5a) — owner-only mission spine tools. Approve/kill
// are HITL-only (admin UI), deliberately NOT tools. draft_experiment reads Gmail
// + drafts via LLM (network, slow) but sends NOTHING (awaiting_approval packet).
registerTool("revenue_mission_create", { categories: ["business", "planning"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("revenue_mission_list", { categories: ["business"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("revenue_mission_status", { categories: ["business"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("revenue_mission_draft_experiment", { categories: ["business", "planning"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("mission_portfolio_review", { categories: ["business"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("product_listing_create", { categories: ["business"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("product_listing_list", { categories: ["business"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("create_payment_link", { categories: ["business"], speed: "normal", isProductOutput: false, isNetworkTool: true });

registerTool("create_slides", { categories: ["presentations"], speed: "very_slow", isProductOutput: true, isNetworkTool: true });

registerTool("exec", { categories: ["code"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("execute_code", { categories: ["code"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("project", { categories: ["code"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("generate_chart", { categories: ["charts"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("generate_dashboard", { categories: ["charts"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("delegate_task", { categories: ["ai"], speed: "very_slow", isProductOutput: false, isNetworkTool: false });
registerTool("llm_task", { categories: ["ai"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("plan_and_execute", { categories: ["ai"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("lobster", { categories: ["ai"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("orchestrate", { categories: ["ai"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("fork_conversation", { categories: ["ai"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("autonomous_task", { categories: ["ai"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("create_crew", { categories: ["crews"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("create_flow", { categories: ["crews"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("create_mind", { categories: ["crews"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("mind_ticket", { categories: ["crews"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("create_tool", { categories: ["tools"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_custom_tools", { categories: ["tools"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("delete_custom_tool", { categories: ["tools"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("manage_skills", { categories: ["tools"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("skill_seeker", { categories: ["tools"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("skillify", { categories: ["tools"], speed: "slow", isProductOutput: false, isNetworkTool: false });

registerTool("research_digest", { categories: ["experiments", "research"], speed: "normal", isProductOutput: true, isNetworkTool: false });
registerTool("log_experiment", { categories: ["experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("get_experiments", { categories: ["experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("run_self_improvement", { categories: ["experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("run_agent_eval", { categories: ["experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("get_eval_report", { categories: ["experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("sculptor_session", { categories: ["experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("sculptor_review", { categories: ["experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("ideation_session", { categories: ["ideation"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("user_model_query", { categories: ["userModeling"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("tool_performance_report", { categories: ["skillEvolution"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("knowledge_nudge_stats", { categories: ["skillEvolution"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("show_diff", { categories: ["diff"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("finance_news", { categories: ["finance"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("finance_stock_price", { categories: ["finance"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("finance_stock_search", { categories: ["finance"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("finance_market_overview", { categories: ["finance"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("financial_snapshot", { categories: ["finance", "reporting"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("create_invoice", { categories: ["invoicing"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_invoices", { categories: ["invoicing"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("update_invoice_status", { categories: ["invoicing"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("invoice_aging_report", { categories: ["invoicing"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("log_expense", { categories: ["expenses"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_expenses", { categories: ["expenses"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("expense_report", { categories: ["expenses"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("add_customer", { categories: ["crm"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("update_customer", { categories: ["crm"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_customers", { categories: ["crm"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("log_interaction", { categories: ["crm"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("customer_pipeline", { categories: ["crm"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("create_contract", { categories: ["contracts"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_contracts", { categories: ["contracts"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("update_contract_status", { categories: ["contracts"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("record_kpi", { categories: ["kpi"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("kpi_dashboard", { categories: ["kpi"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("kpi_trend", { categories: ["kpi"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("profit_and_loss", { categories: ["reporting"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("revenue_report", { categories: ["reporting"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("cash_flow_summary", { categories: ["reporting"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("business_health_score", { categories: ["reporting"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("legal_review", { categories: ["legal"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("compliance_audit", { categories: ["legal"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("generate_legal_document", { categories: ["legal"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("generate_schema_markup", { categories: ["legal"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("seo_content_audit", { categories: ["legal"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("strategic_interview", { categories: ["personas"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("export_persona", { categories: ["personas"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("sync_personas", { categories: ["personas"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("save_evidence", { categories: ["evidence"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("query_evidence", { categories: ["evidence"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("synthesize_research", { categories: ["evidence"], speed: "slow", isProductOutput: false, isNetworkTool: false });

registerTool("add_competitor", { categories: ["competitorIntel"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_competitors", { categories: ["competitorIntel"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("take_competitor_snapshot", { categories: ["competitorIntel"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("detect_competitor_changes", { categories: ["competitorIntel"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("competitor_briefing", { categories: ["competitorIntel"], speed: "slow", isProductOutput: false, isNetworkTool: false });

registerTool("define_icp", { categories: ["leadEnrichment"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("enrich_lead", { categories: ["leadEnrichment"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("score_leads", { categories: ["leadEnrichment"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("qualify_leads", { categories: ["leadEnrichment"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("create_sequence", { categories: ["outreachSequencing"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("enroll_in_sequence", { categories: ["outreachSequencing"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("advance_sequence", { categories: ["outreachSequencing"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("classify_reply", { categories: ["outreachSequencing"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_sequences", { categories: ["outreachSequencing"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("firecrawl_search", { categories: ["scraping"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("firecrawl_scrape", { categories: ["scraping"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("firecrawl_crawl", { categories: ["scraping"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("firecrawl_map", { categories: ["scraping"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("scraped_pages_query", { categories: ["scraping"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("scraped_page_read", { categories: ["scraping"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("scraped_pages_delete", { categories: ["scraping"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("build_presentation_distributed", { categories: ["presentations"], speed: "very_slow", isProductOutput: true, isNetworkTool: true });
registerTool("debate", { categories: ["ai"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("tree_of_thought", { categories: ["ai"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("estimate_cost", { categories: ["ai"], speed: "slow", isProductOutput: false, isNetworkTool: false });

registerTool("check_background_task", { categories: ["ai"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("get_user_info", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("run_background_task", { categories: ["ai"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("list_background_tasks", { categories: ["ai"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("introspect_tools", { categories: ["tools", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("self_diagnose", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("critique_response", { categories: ["ai"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("manage_desk", { categories: ["sessions"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("post_to_channel", { categories: ["sessions"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("read_channels", { categories: ["sessions"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("emit_event", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("track_outcome", { categories: ["ai"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("manage_watchlist", { categories: ["competitorIntel"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("parallel_research", { categories: ["web", "ai", "agentic"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("run_supervisor", { categories: ["ai", "agentic"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("list_agent_runs", { categories: ["agentic", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("get_agent_run", { categories: ["agentic", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("agentic_cache_stats", { categories: ["agentic", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("request_approval", { categories: ["agentic", "governance"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("decide_approval", { categories: ["agentic", "governance"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_pending_approvals", { categories: ["agentic", "governance"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("commit_decision", { categories: ["agentic", "ai", "governance"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("revenue_vs_cost", { categories: ["agentic", "finance"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("agent_cost_summary", { categories: ["agentic", "finance", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("self_heal", { categories: ["agentic", "governance", "ai"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("self_heal_log", { categories: ["agentic", "governance", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("self_heal_inspect", { categories: ["agentic", "governance", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });

// R56: Wellness / safety intervention tools (research proposals #13, #14, #15)
// Felix-wellness mission: late-night fatigue + shame-spiral + frozen-state interventions.
registerTool("stress_intervention",     { categories: ["wellness", "felix"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("detect_fatigue",          { categories: ["wellness", "felix"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("micro_sabbatical",        { categories: ["wellness", "felix"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("detect_emotional_state",  { categories: ["wellness", "safety", "felix"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("grounding_intervention",  { categories: ["wellness", "safety", "felix"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("track_intervention",      { categories: ["wellness", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("felix_loop_status",         { categories: ["agentic", "felix", "governance", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_felix_loop_runs",      { categories: ["agentic", "felix", "governance", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_felix_proposals",      { categories: ["agentic", "felix", "governance"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("approve_felix_proposal",    { categories: ["agentic", "felix", "governance"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("reject_felix_proposal",     { categories: ["agentic", "felix", "governance"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("felix_loop_run_now",        { categories: ["agentic", "felix", "governance"], speed: "slow",   isProductOutput: false, isNetworkTool: false });
registerTool("verify_felix_proposal_spec",{ categories: ["agentic", "felix", "governance", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("execute_felix_proposal",    { categories: ["agentic", "felix", "governance"], speed: "slow",   isProductOutput: false, isNetworkTool: false });

// R57 (Apr 22 2026): Close the 16 registry-gap warnings flagged by tool-registry audit.
// These tools existed in TOOL_DEFINITIONS but had no registry entry, so the tool-router
// could not match them to any category — meaning agents only saw them when ALWAYS_INCLUDE
// listed them or by coincidence. Each one is now categorised so routeTools() can surface it.

// Messaging family (SMS/WhatsApp/scheduled outbound)
registerTool("send_message",              { categories: ["messaging", "delivery"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("messaging_status",          { categories: ["messaging", "system"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("schedule_message",          { categories: ["messaging", "delivery"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_scheduled_messages",   { categories: ["messaging"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("cancel_scheduled_message",  { categories: ["messaging"], speed: "normal", isProductOutput: false, isNetworkTool: false });

// Skill candidate / synthesis pipeline (auto-skillify outputs)
registerTool("synthesize_skill",          { categories: ["skillEvolution", "tools", "experiments"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("list_skill_candidates",     { categories: ["skillEvolution", "tools"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("promote_skill_candidate",   { categories: ["skillEvolution", "tools"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("reject_skill_candidate",    { categories: ["skillEvolution", "tools"], speed: "normal", isProductOutput: false, isNetworkTool: false });

// Reflection / self-improvement
registerTool("nudge_self",                { categories: ["memory", "skillEvolution", "experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("auto_memorize_now",         { categories: ["memory", "experiments"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("cross_critique",            { categories: ["reasoning", "experiments", "ai"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("list_critiques",            { categories: ["reasoning", "experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });

// Video editing pipeline (whisper word-level cuts)
registerTool("video_transcribe_words",    { categories: ["media"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("video_cut_fillers",         { categories: ["media"], speed: "slow", isProductOutput: true, isNetworkTool: false });
registerTool("video_burn_captions",       { categories: ["media"], speed: "slow", isProductOutput: true, isNetworkTool: false });

// Figma REST API bridge (Apr 22 2026)
registerTool("figma",                     { categories: ["design", "research"], speed: "normal", isProductOutput: false, isNetworkTool: true });

// R74.13z-quint+2 (Apr 29 2026): Tensions + ADRs — shared brain primitives.
// Registered under memory/planning/reasoning so the semantic router surfaces them
// whenever a persona is reasoning about predictions, decisions, or contradictions.
registerTool("create_tension",            { categories: ["memory", "reasoning", "experiments", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_open_tensions",        { categories: ["memory", "reasoning", "experiments", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("resolve_tension",           { categories: ["memory", "reasoning", "experiments", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("create_adr",                { categories: ["memory", "planning", "reasoning", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_adrs",                 { categories: ["memory", "planning", "reasoning", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("supersede_adr",             { categories: ["memory", "planning", "reasoning", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });

// R100/R101/R102 (May 9, 2026): TNR + Causality Graphs + Admission Control.
// All three are trusted-only system tools (gated via TOOL_POLICIES.trustedPersonasOnly).
registerTool("undo_last_action",          { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("query_trace",               { categories: ["system", "memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("system_load_status",        { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });

// R104 (May 9, 2026): Inbox quarantine + commitments primitive.
registerTool("inbox_sender_approve",      { categories: ["system", "communication", "security"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("inbox_sender_block",        { categories: ["system", "communication", "security"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("inbox_quarantine_list",     { categories: ["system", "communication"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("inbox_allowlist_list",      { categories: ["system", "communication"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("commitment_create",         { categories: ["system", "planning", "memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("commitment_list",           { categories: ["system", "planning", "memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("commitment_heartbeat",      { categories: ["system", "planning", "memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("commitment_complete",       { categories: ["system", "planning", "memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("commitment_cancel",         { categories: ["system", "planning", "memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });

// R106 (May 9, 2026): LuaN1aoAgent nuggets — failure attribution + parallel
// findings bus + pinned hypotheses + plan-on-graph DAG editing. All seven
// tools are platform-wide primitives (NOT trusted-only) so every persona can
// call them as part of routine reflexive operation.
registerTool("attribute_failure",         { categories: ["system", "reasoning", "experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("findings_publish",          { categories: ["system", "memory", "experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("findings_read",             { categories: ["system", "memory", "experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("hypothesis_pin",            { categories: ["system", "memory", "reasoning"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("hypothesis_list_pinned",    { categories: ["system", "memory", "reasoning"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("plan_graph_edit",           { categories: ["system", "planning", "reasoning"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("plan_graph_query",          { categories: ["system", "planning", "reasoning"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("memory_geometry_scan",      { categories: ["system", "memory", "experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("get_unified_memory_context",{ categories: ["system", "memory", "conversations", "knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("verify_with_cove",          { categories: ["system", "quality", "research"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("hypothesis_attach_evidence",{ categories: ["system", "memory", "reasoning"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("hypothesis_evidence_chain", { categories: ["system", "memory", "reasoning"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("scan_for_secrets",           { categories: ["system", "safety", "security"], speed: "normal", isProductOutput: false, isNetworkTool: false });

// R112 (May 2026): Paper ingestion (Cassandra research pipeline).
registerTool("ingest_paper",              { categories: ["research", "memory"], speed: "slow", isProductOutput: false, isNetworkTool: false });

// R113.4 (May 16, 2026): Output-skills library — hash-pinned deliverable templates.
registerTool("lookup_output_skill",       { categories: ["planning", "system", "memory"], speed: "fast", isProductOutput: false, isNetworkTool: false });

// R113.5/6 (May 16, 2026): Self-hosted multi-platform social-post scheduler.
// schedule_cross_platform_post is destructive (mutates scheduled_posts + emits to external
// platforms on the runner tick) — gated via TOOL_POLICIES.requireApproval.
registerTool("schedule_cross_platform_post", { categories: ["messaging", "delivery", "marketing"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("repurpose_content",            { categories: ["content", "marketing"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("cancel_scheduled_post",        { categories: ["messaging", "marketing"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_scheduled_posts",         { categories: ["messaging", "marketing"], speed: "fast", isProductOutput: false, isNetworkTool: false });

// R114 — AEvo Meta-Editing of Procedure Context (Zhang et al., arXiv:2605.13821).
// Meta-agent proposes minimal surgical edits to output-skill playbooks based
// on accumulated evidence. HITL-gated, CAS-pinned, rollback-capable.
registerTool("propose_procedure_edit",  { categories: ["governance", "system"], speed: "slow",   isProductOutput: false, isNetworkTool: false });
registerTool("list_procedure_edits",    { categories: ["governance", "system"], speed: "fast",   isProductOutput: false, isNetworkTool: false });
registerTool("approve_procedure_edit",  { categories: ["governance", "system"], speed: "fast",   isProductOutput: false, isNetworkTool: false });
registerTool("reject_procedure_edit",   { categories: ["governance", "system"], speed: "fast",   isProductOutput: false, isNetworkTool: false });
registerTool("apply_procedure_edit",    { categories: ["governance", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("rollback_procedure_edit", { categories: ["governance", "system"], speed: "normal", isProductOutput: false, isNetworkTool: false });

// R115.5 — Sprint Contract / pre-flight done-condition pin (Osmani harness-
// engineering nugget). Non-destructive (no external side-effects), pure DB.
registerTool("pin_done_condition",       { categories: ["planning", "governance", "system"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("get_done_condition",       { categories: ["planning", "governance", "system"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("evaluate_against_contract",{ categories: ["planning", "governance", "system"], speed: "fast", isProductOutput: false, isNetworkTool: false });

// R125+14 — Autonomous corporate operations: durable wake sequences, departmental
// budgets, scoped task-forces, A/B experiments, off-cycle OKR review. Pure DB except
// run_okr_review (LLM). Mutators classified in TOOL_POLICIES (sensitive; budget/charge
// trustedPersonasOnly). Registered so the router surfaces them to agents (Felix owns).
registerTool("schedule_wake",            { categories: ["agentic", "planning"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("cancel_wake",              { categories: ["agentic", "planning"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("list_wakes",               { categories: ["agentic", "planning"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("set_department_budget",    { categories: ["agentic", "governance", "finance"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("check_department_budget",  { categories: ["agentic", "governance", "finance"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("create_task_force",        { categories: ["agentic", "governance"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("list_task_forces",         { categories: ["agentic", "governance"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("charge_task_force",        { categories: ["agentic", "governance", "finance"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("sunset_task_force",        { categories: ["agentic", "governance"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("create_ab_experiment",     { categories: ["agentic", "experiments"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("record_ab_event",          { categories: ["agentic", "experiments"], speed: "fast", isProductOutput: false, isNetworkTool: false });
registerTool("run_okr_review",           { categories: ["agentic", "governance", "felix"], speed: "slow", isProductOutput: false, isNetworkTool: true });

// R74.13b (Apr 25, 2026) / updated R74.13z-quint+2 (Apr 29, 2026):
// The agent-primitives audit confirms the registry stays 1:1 with TOOL_DEFINITIONS.
// As of May 9 2026 R102: 315 top-level LLM-callable tools ↔ 315 registered entries.
// Whenever new tools land, re-run the gap audit:
//   python3 /tmp/find-real-gap.py   # should print 0 unregistered, 0 ghosts
// (or use the inline audit pattern in chat-engine self-tests)
