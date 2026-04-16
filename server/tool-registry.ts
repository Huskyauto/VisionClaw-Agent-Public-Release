export type SpeedClass = "normal" | "slow" | "very_slow";

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

export function auditRegistry(toolDefinitions: { function: { name: string } }[]): string[] {
  const warnings: string[] = [];
  const definedNames = new Set(toolDefinitions.map(d => d.function.name));
  for (const def of toolDefinitions) {
    const name = def.function.name;
    if (!registry.has(name)) {
      warnings.push(`[tool-registry] WARNING: Tool "${name}" has no registry entry — it won't appear in any router category, timeout class, or product verification.`);
    }
  }
  for (const regName of registry.keys()) {
    if (!definedNames.has(regName)) {
      warnings.push(`[tool-registry] INFO: Registry entry "${regName}" has no matching tool definition (may be an alias or future tool).`);
    }
  }
  return warnings;
}

export function getRegistryStats(): { total: number; bySpeed: Record<SpeedClass, number>; productOutput: number; networkTools: number; categories: number } {
  const bySpeed: Record<SpeedClass, number> = { normal: 0, slow: 0, very_slow: 0 };
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

registerTool("test_api_keys", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("check_system_status", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("list_models", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("agent_status", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("agent_security_scan", { categories: ["system"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("context_budget_audit", { categories: ["system"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("search_memory", { categories: ["memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("create_memory", { categories: ["memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("update_memory", { categories: ["memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("recall_context", { categories: ["memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("graph_memory", { categories: ["memory"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("search_knowledge", { categories: ["knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("create_knowledge", { categories: ["knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("store_triple", { categories: ["knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("query_triples", { categories: ["knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("expire_triple", { categories: ["knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("doc_search", { categories: ["knowledge"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("get_daily_notes", { categories: ["notes"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("write_daily_note", { categories: ["notes"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("read_scratchpad", { categories: ["notes"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("write_scratchpad", { categories: ["notes"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("list_conversations", { categories: ["conversations"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("web_fetch", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("web_search", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("browser", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("deep_research", { categories: ["web", "ai"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("trend_research", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("browser_workflow", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
registerTool("stealth_browse", { categories: ["web"], speed: "slow", isProductOutput: false, isNetworkTool: true });
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
registerTool("write_file", { categories: ["files"], speed: "normal", isProductOutput: false, isNetworkTool: false });

registerTool("google_workspace", { categories: ["workspace"], speed: "very_slow", isProductOutput: false, isNetworkTool: true });
registerTool("calendar_sync", { categories: ["workspace"], speed: "slow", isProductOutput: false, isNetworkTool: true });

registerTool("whatsapp", { categories: ["whatsapp"], speed: "normal", isProductOutput: false, isNetworkTool: true });

registerTool("deliver_product", { categories: ["delivery"], speed: "normal", isProductOutput: false, isNetworkTool: false });
registerTool("delivery_status", { categories: ["delivery"], speed: "normal", isProductOutput: false, isNetworkTool: false });

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
registerTool("mpeg_add_audio", { categories: ["media"], speed: "slow", isProductOutput: false, isNetworkTool: false });
registerTool("vibevoice_transcribe", { categories: ["media"], speed: "normal", isProductOutput: false, isNetworkTool: true });
registerTool("youtube", { categories: ["media"], speed: "normal", isProductOutput: false, isNetworkTool: true });

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
