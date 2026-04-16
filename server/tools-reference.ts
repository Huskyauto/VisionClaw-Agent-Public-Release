import { getAllToolDefinitions } from "./tools";

interface ToolRef {
  name: string;
  what: string;
  params: string;
  example?: string;
}

const TOOL_CATEGORIES: Record<string, { label: string; tools: string[] }> = {
  system: {
    label: "SYSTEM & DIAGNOSTICS",
    tools: ["test_api_keys", "check_system_status", "list_models", "agent_status", "agent_security_scan"],
  },
  memory: {
    label: "MEMORY & KNOWLEDGE",
    tools: ["search_memory", "create_memory", "update_memory", "recall_context", "search_knowledge", "create_knowledge", "graph_memory", "store_triple", "query_triples", "expire_triple"],
  },
  notes: {
    label: "DAILY NOTES & LOGS",
    tools: ["write_daily_note", "get_daily_notes", "list_conversations", "read_scratchpad", "write_scratchpad"],
  },
  web: {
    label: "WEB RESEARCH",
    tools: ["web_search", "web_fetch", "firecrawl_search", "firecrawl_scrape", "firecrawl_crawl", "firecrawl_map", "deep_research", "trend_research"],
  },
  browser: {
    label: "VIRTUAL BROWSER",
    tools: ["browser", "browser_workflow", "stealth_browse", "vision_browse", "site_login"],
  },
  scrapedData: {
    label: "SCRAPED DATA MANAGEMENT",
    tools: ["scraped_pages_query", "scraped_page_read", "scraped_pages_delete"],
  },
  files: {
    label: "FILES & GOOGLE DRIVE",
    tools: ["google_drive", "read_file", "write_file", "list_uploads"],
  },
  email: {
    label: "EMAIL",
    tools: ["send_email", "check_inbox"],
  },
  docs: {
    label: "DOCUMENT PRODUCTION",
    tools: ["create_pdf", "create_styled_report", "create_document", "create_spreadsheet", "create_slides", "analyze_pdf", "fill_pdf", "edit_pdf", "list_pdf_fields", "render_diagram"],
  },
  media: {
    label: "MEDIA PRODUCTION",
    tools: ["produce_video", "generate_audio", "create_slideshow_video", "generate_social_image", "search_stock_media", "vibevoice_transcribe"],
  },
  social: {
    label: "SOCIAL MEDIA & MARKETING",
    tools: ["draft_social_post", "compose_social_post", "publish_social_post", "manage_social_accounts", "manage_content_calendar", "marketing_analytics", "marketing_experiment"],
  },
  xtwitter: {
    label: "X/TWITTER",
    tools: ["x_post_tweet", "x_get_mentions", "x_get_timeline", "x_get_tweet", "x_like_tweet", "x_retweet", "x_delete_tweet", "x_search", "x_get_me"],
  },
  delegation: {
    label: "DELEGATION & ORCHESTRATION",
    tools: ["delegate_task", "orchestrate", "plan_and_execute", "estimate_cost", "fork_conversation", "autonomous_task"],
  },
  multiagent: {
    label: "MULTI-AGENT SYSTEMS",
    tools: ["create_crew", "create_flow", "create_mind", "mind_ticket", "sculptor_session", "sculptor_review"],
  },
  sessions: {
    label: "AGENT SESSIONS",
    tools: ["sessions_list", "sessions_history", "sessions_send", "sessions_spawn", "subagents"],
  },
  project: {
    label: "PROJECT MANAGEMENT",
    tools: ["project"],
  },
  data: {
    label: "DATA & VISUALIZATION",
    tools: ["generate_chart", "generate_dashboard", "execute_code", "exec"],
  },
  reasoning: {
    label: "REASONING & QUALITY",
    tools: ["critique_response", "debate", "tree_of_thought", "llm_task"],
  },
  desk: {
    label: "AGENT DESK & CHANNELS",
    tools: ["manage_desk", "post_to_channel", "read_channels", "emit_event"],
  },
  tracking: {
    label: "TRACKING & MONITORING",
    tools: ["track_outcome", "manage_watchlist", "delivery_status", "deliver_product"],
  },
  skills: {
    label: "SKILLS & SELF-IMPROVEMENT",
    tools: ["manage_skills", "create_tool", "list_custom_tools", "delete_custom_tool", "run_self_improvement", "skill_seeker", "skillify", "log_experiment", "get_experiments", "run_agent_eval", "get_eval_report", "context_budget_audit", "strategic_interview", "export_persona", "sync_personas"],
  },
  ideation: {
    label: "IDEATION & INNOVATION",
    tools: ["ideation_session"],
  },
  userModeling: {
    label: "USER MODELING & ADAPTATION",
    tools: ["user_model_query"],
  },
  skillEvolution: {
    label: "SKILL EVOLUTION & OPTIMIZATION",
    tools: ["tool_performance_report", "knowledge_nudge_stats"],
  },
  finance: {
    label: "BUSINESS & FINANCE",
    tools: ["create_invoice", "list_invoices", "update_invoice_status", "invoice_aging_report", "log_expense", "list_expenses", "expense_report", "add_customer", "update_customer", "list_customers", "customer_pipeline", "create_contract", "list_contracts", "update_contract_status", "record_kpi", "kpi_dashboard", "kpi_trend", "revenue_report", "profit_and_loss", "cash_flow_summary", "business_health_score", "financial_snapshot"],
  },
  legal: {
    label: "LEGAL & COMPLIANCE",
    tools: ["legal_review", "compliance_audit", "generate_legal_document", "generate_schema_markup", "seo_content_audit"],
  },
  workspace: {
    label: "GOOGLE WORKSPACE",
    tools: ["google_workspace", "calendar_sync", "doc_search"],
  },
  background: {
    label: "BACKGROUND TASKS",
    tools: ["run_background_task", "check_background_task", "list_background_tasks"],
  },
  comms: {
    label: "MESSAGING & COMMUNICATIONS",
    tools: ["whatsapp", "youtube", "lobster"],
  },
  evidence: {
    label: "EVIDENCE & RESEARCH STORE",
    tools: ["save_evidence", "query_evidence", "synthesize_research"],
  },
  competitorIntel: {
    label: "COMPETITOR INTELLIGENCE",
    tools: ["add_competitor", "list_competitors", "take_competitor_snapshot", "detect_competitor_changes", "competitor_briefing"],
  },
  leadEnrichment: {
    label: "LEAD ENRICHMENT & SCORING",
    tools: ["enrich_lead", "score_leads", "qualify_leads", "define_icp"],
  },
  outreachSequencing: {
    label: "OUTREACH SEQUENCING",
    tools: ["create_sequence", "enroll_in_sequence", "advance_sequence", "classify_reply", "list_sequences"],
  },
};

const TOOL_EXAMPLES: Record<string, string> = {
  delegate_task: `delegate_task({ targetAgent: "Neptune", taskName: "Generate narration audio", prompt: "Use generate_audio with the script text: [script]. Use provider 'elevenlabs', filename 'narration'. Save to Drive.", schedule: "once" })`,
  produce_video: `produce_video({ slide_scripts: [{ narration: "Slide 1 voiceover text...", title: "Intro" }, { narration: "Slide 2 voiceover...", title: "Features" }], title: "My Video", email_to: "user@example.com", crossfade_ms: 500, project_id: 14 })`,
  generate_audio: `generate_audio({ text: "Your narration text here...", provider: "elevenlabs", filename: "narration", project_id: 14 })`,
  create_slideshow_video: `create_slideshow_video({ pdf_path: "uploads/slides.pdf", audio_path: "project-assets/narration.mp3", output_filename: "final_video", project_id: 14 })`,
  orchestrate: `orchestrate({ objective: "Research AI trends, write a blog post, and draft a LinkedIn announcement" })`,
  create_pdf: `create_pdf({ title: "Proposal", sections: [{ heading: "Overview", body: "..." }, { heading: "Pricing", body: "..." }], outputPath: "proposal.pdf" })`,
  project: `project({ action: "add_file", project_id: 14, file_name: "narration.mp3", file_url: "https://drive.google.com/...", file_type: "audio" })`,
  send_email: `send_email({ to: "client@example.com", subject: "Your deliverable", text: "Here is your file: [Drive link]" })`,
  generate_chart: `generate_chart({ type: "bar", title: "Revenue by Month", data: [{ month: "Jan", revenue: 5000 }, { month: "Feb", revenue: 7200 }], xKey: "month", yKey: "revenue" })`,
  compose_social_post: `compose_social_post({ platform: "linkedin", topic: "AI automation", style: "thought-leadership", image_style: "professional", campaign: "Q1 Launch" })`,
  search_memory: `search_memory({ query: "brand voice guidelines" })`,
  create_memory: `create_memory({ fact: "Client prefers formal tone in all communications", category: "preference" })`,
  web_search: `web_search({ query: "latest AI agent frameworks 2026" })`,
  analyze_pdf: `analyze_pdf({ pdf: "https://example.com/contract.pdf", prompt: "Summarize key terms and flag any risks" })`,
  deep_research: `deep_research({ query: "competitive landscape for AI agent platforms", depth: "comprehensive" })`,
  manage_desk: `manage_desk({ action: "update_task", taskId: "video-production", progressNote: "Audio generated, assembling video next" })`,
  create_crew: `create_crew({ name: "Content Pipeline", description: "Research, write, review, and publish", agents: [{ personaId: 9, role: "Researcher" }, { personaId: 7, role: "Writer" }, { personaId: 8, role: "Reviewer" }], tasks: [{ title: "Research topic", assignedRole: "Researcher" }, { title: "Write article", assignedRole: "Writer", dependsOn: ["Research topic"] }] })`,
  create_flow: `create_flow({ name: "Weekly Report Pipeline", steps: [{ stepOrder: 1, personaId: 9, instruction: "Research latest trends" }, { stepOrder: 2, personaId: 7, instruction: "Write executive summary" }, { stepOrder: 3, personaId: 8, instruction: "QA review" }] })`,
  financial_snapshot: `financial_snapshot({ period: "q1", year: 2026 })`,
  trend_research: `trend_research({ query: "AI agent frameworks", sources: ["reddit", "hackernews", "polymarket"] })`,
  legal_review: `legal_review({ document: "https://example.com/contract.pdf", review_type: "full" })`,
  x_post_tweet: `x_post_tweet({ text: "Excited to announce our new AI platform! #VisionClaw" })`,
  save_evidence: `save_evidence({ claim: "The AI agent market is projected to reach $65B by 2030", source_url: "https://example.com/report", source_title: "Gartner AI Report 2026", confidence: 85, theme: "market_size", supporting_quote: "According to our analysis..." })`,
  add_competitor: `add_competitor({ name: "CompetitorX", website: "https://competitorx.com", pricing_url: "https://competitorx.com/pricing", product_url: "https://competitorx.com/product" })`,
  enrich_lead: `enrich_lead({ name: "Jane Smith", company: "Acme Corp", company_url: "https://acme.com" })`,
  create_sequence: `create_sequence({ name: "Cold Outreach Q2", steps: [{ step_number: 1, subject: "Quick question about {{company}}", body: "Hi {{name}}, I noticed...", wait_days: 0 }, { step_number: 2, subject: "Following up", body: "Hi {{name}}, just wanted...", wait_days: 3 }] })`,
  ideation_session: `ideation_session({ idea: "An AI agent that autonomously manages social media for small businesses", phase: "full", frameworks: ["scamper", "first_principles", "jtbd"], context: "Target market: small business owners with less than 10 employees", save_as_note: true })`,
  user_model_query: `user_model_query({ question: "What communication style does this user prefer?" })`,
  tool_performance_report: `tool_performance_report({ action: "report" })`,
  knowledge_nudge_stats: `knowledge_nudge_stats({})`,
};

let cachedReference: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000;

export async function buildToolsReference(): Promise<string> {
  if (cachedReference && Date.now() - cacheTime < CACHE_TTL) {
    return cachedReference;
  }

  const allTools = await getAllToolDefinitions();
  const toolMap = new Map<string, any>();
  for (const t of allTools) {
    toolMap.set(t.function.name, t.function);
  }

  const lines: string[] = [];
  lines.push("# TOOLS REFERENCE MANUAL");
  lines.push(`${allTools.length} tools available. Use them — don't describe what you could do.\n`);

  for (const [catKey, cat] of Object.entries(TOOL_CATEGORIES)) {
    const catTools = cat.tools.filter(name => toolMap.has(name));
    if (catTools.length === 0) continue;

    lines.push(`## ${cat.label}`);

    for (const name of catTools) {
      const def = toolMap.get(name)!;
      const props = def.parameters?.properties || {};
      const required = def.parameters?.required || [];
      const desc = (def.description || "").split(/[.\n]/)[0].trim().slice(0, 100);

      const paramParts: string[] = [];
      for (const [pName, pDef] of Object.entries(props) as [string, any][]) {
        const isReq = required.includes(pName);
        paramParts.push(`${pName}${isReq ? "*" : ""}`);
      }

      const paramStr = paramParts.length > 0 ? ` (${paramParts.join(", ")})` : "";
      const exampleStr = TOOL_EXAMPLES[name] ? `\n  Ex: \`${TOOL_EXAMPLES[name]}\`` : "";
      lines.push(`- **${name}**${paramStr} — ${desc}${exampleStr}`);
    }
    lines.push("");
  }

  lines.push("## KEY RULES");
  lines.push("- * = required parameter");
  lines.push("- All files MUST go to Google Drive via the tool's built-in upload. Never give users local file paths.");
  lines.push("- delegate_task with schedule='once' executes INLINE and returns the specialist's result immediately.");
  lines.push("- generate_audio supports providers: 'elevenlabs' (quality) or 'openai' (speed). Has automatic fallback.");
  lines.push("- produce_video with slide_scripts array generates per-slide TTS audio with perfect sync. Each slide displays exactly as long as its narration. Use crossfade_ms for smooth transitions. This is the RECOMMENDED approach for narrated videos.");
  lines.push("- create_slideshow_video accepts pdf_path (auto-converts PDF pages to images) OR slides array with per-slide audio_path. Always pass pdf_path when you have a PDF deck.");
  lines.push("- project add_file registers deliverables. Always register files you produce.");
  lines.push("- Use compose_social_post (not draft_social_post) when you want text + image together.");
  lines.push("");
  lines.push("## MULTI-AGENT SYSTEMS");
  lines.push("- **Crews**: Create multi-agent teams with defined roles, task dependencies, and parallel execution. Use create_crew for complex projects needing multiple specialists working together (e.g., content pipeline: research → write → review → publish).");
  lines.push("- **Flows**: Sequential multi-step pipelines where each step runs a specific persona with instructions. Results flow step-to-step. Use create_flow for repeatable processes (e.g., weekly report pipeline).");
  lines.push("- **Minds**: Autonomous reasoning entities with 4 roles (visionary/architect/critic/executor) that process tickets through deliberation. Use create_mind for strategic planning and complex problem-solving.");
  lines.push("- **Orchestrate**: Ad-hoc DAG planner for one-off complex requests. Auto-decomposes into parallel/sequential steps with the right persona for each.");
  lines.push("- **When to use what**: Crews = parallel teamwork. Flows = sequential pipelines. Minds = autonomous reasoning. Orchestrate = one-off complex tasks.");
  lines.push("");
  lines.push("## BUSINESS & FINANCE TOOLS");
  lines.push("- Full CRM: add_customer, update_customer, list_customers, customer_pipeline for sales tracking.");
  lines.push("- Invoicing: create_invoice, list_invoices, update_invoice_status, invoice_aging_report for AR management.");
  lines.push("- Expenses: log_expense, list_expenses, expense_report for AP tracking.");
  lines.push("- Contracts: create_contract, list_contracts, update_contract_status for agreement management.");
  lines.push("- KPIs: record_kpi, kpi_dashboard, kpi_trend for performance tracking.");
  lines.push("- Financial Reports: revenue_report, profit_and_loss, cash_flow_summary, business_health_score, financial_snapshot for executive-level financial visibility.");
  lines.push("- financial_snapshot gives a complete period summary (monthly/quarterly/annual) with revenue, expenses, P&L, KPIs, and health score in one call.");
  lines.push("");
  lines.push("## X/TWITTER TOOLS");
  lines.push("- 9 tools for full X/Twitter management: x_post_tweet, x_get_mentions, x_get_timeline, x_get_tweet, x_like_tweet, x_retweet, x_delete_tweet, x_search, x_get_me.");
  lines.push("- Use x_post_tweet to publish tweets. Use x_search for social listening. Use x_get_mentions to monitor engagement.");
  lines.push("");
  lines.push("## EVIDENCE & RESEARCH STORE");
  lines.push("- save_evidence: Store a claim with source URL, confidence score (0-100), theme tag, and supporting quote. Builds a rigorous evidence base.");
  lines.push("- query_evidence: Search stored evidence by theme, confidence threshold, or keywords. Returns cited claims with sources.");
  lines.push("- synthesize_research: Generate a structured, citation-backed research report from all collected evidence. Auto-detects contradictions and gaps.");
  lines.push("");
  lines.push("## COMPETITOR INTELLIGENCE");
  lines.push("- add_competitor: Register a competitor with website, pricing page, product page, and changelog URLs for monitoring.");
  lines.push("- list_competitors: View all tracked competitors and their monitored URLs.");
  lines.push("- take_competitor_snapshot: Capture current state of a competitor's pages (pricing, features, messaging) for baseline or comparison.");
  lines.push("- detect_competitor_changes: Compare two snapshots to identify pricing, feature, messaging, and positioning shifts with significance ratings.");
  lines.push("- competitor_briefing: Generate an executive briefing summarizing all competitor changes and strategic implications over a monitoring period.");
  lines.push("");
  lines.push("## LEAD ENRICHMENT & SCORING");
  lines.push("- define_icp: Create an Ideal Customer Profile scoring rule with criteria (industry, company size, role, budget signals). Used by score_leads.");
  lines.push("- enrich_lead: Pull company data (industry, size, description) from a company URL. Auto-enriches lead records for scoring.");
  lines.push("- score_leads: Score leads 0-100 against ICP criteria and assign A-F grades. Returns ranked pipeline.");
  lines.push("- qualify_leads: Segment scored leads into qualified (70+), nurture (40-70), and disqualified (<40) with recommended actions.");
  lines.push("");
  lines.push("## OUTREACH SEQUENCING");
  lines.push("- create_sequence: Build a multi-step email sequence with templates (subject + body) and wait intervals between steps. Supports {{name}}, {{company}} placeholders.");
  lines.push("- enroll_in_sequence: Add a contact to an active sequence with personalization context. AI personalizes each template before sending.");
  lines.push("- advance_sequence: Send the next step in a sequence for enrolled contacts whose wait period has elapsed.");
  lines.push("- classify_reply: Analyze a reply email and classify as positive/negative/neutral/unsubscribe. Auto-pauses sequence for positive, stops for unsubscribe.");
  lines.push("- list_sequences: View all sequences with their step counts, enrollment numbers, and status.");

  cachedReference = lines.join("\n");
  cacheTime = Date.now();
  return cachedReference;
}

export async function getToolsReferenceForPersona(personaId: number): Promise<string> {
  const full = await buildToolsReference();

  const PERSONA_TOOL_FOCUS: Record<number, string> = {
    2: "Focus: delegate_task, orchestrate, create_crew, create_flow, plan_and_execute, project, estimate_cost. You are the CEO — delegate work to specialists, create multi-agent crews for complex pipelines, and build flows for repeatable processes. If delegation fails or is unavailable, you also have direct access to: write_file, read_file, create_slides, create_pdf, create_spreadsheet, exec, financial_snapshot. Use create_crew for parallel multi-agent work. Use create_flow for sequential pipelines. Use orchestrate for ad-hoc DAG plans.",
    3: "Focus: execute_code, exec, web_search, web_fetch, project, google_drive, create_pdf, create_tool, skill_seeker, sculptor_session. Build, ship, and extend the platform with new tools and skills.",
    4: "Focus: compose_social_post, manage_content_calendar, marketing_analytics, marketing_experiment, generate_social_image, search_stock_media, x_post_tweet, x_search, trend_research. Full social media and marketing toolkit including X/Twitter and stock media.",
    6: "Focus: test_api_keys, check_system_status, list_models, manage_desk, write_daily_note, agent_status, agent_security_scan, context_budget_audit. Monitor, audit, and report on system health.",
    7: "Focus: create_pdf, create_styled_report, create_document, create_slides, google_drive, project, search_memory, web_search, generate_audio, render_diagram. Write and deliver in every format — PDF, Word, Slides, diagrams.",
    8: "Focus: search_memory, web_search, web_fetch, search_knowledge, critique_response, run_agent_eval, get_eval_report. Review, verify, and evaluate quality.",
    9: "Focus: web_search, web_fetch, deep_research, trend_research, firecrawl_search, firecrawl_scrape, firecrawl_crawl, firecrawl_map, scraped_pages_query, scraped_page_read, create_pdf, generate_chart, search_knowledge, save_evidence, query_evidence, synthesize_research, add_competitor, list_competitors, take_competitor_snapshot, detect_competitor_changes, competitor_briefing. Research, scrape, analyze, monitor trends, collect cited evidence, and run competitor intelligence programs.",
    10: "Focus: generate_audio, produce_video, create_slideshow_video, vibevoice_transcribe, deep_research, google_drive, project, generate_social_image, search_stock_media. Produce media — video, audio, transcription — stock footage sourcing — and research.",
    11: "Focus: send_email, compose_social_post, x_post_tweet, create_pdf, generate_chart, generate_social_image, project, create_invoice, customer_pipeline, financial_snapshot, enrich_lead, score_leads, qualify_leads, define_icp, create_sequence, enroll_in_sequence, advance_sequence, classify_reply, list_sequences. Drive revenue with full CRM, invoicing, lead enrichment, ICP scoring, and automated outreach sequencing tools.",
    12: "Focus: generate_chart, generate_dashboard, execute_code, web_search, create_pdf, create_spreadsheet, financial_snapshot, kpi_dashboard, kpi_trend, revenue_report, profit_and_loss, cash_flow_summary, business_health_score. Analyze, visualize, and report on financials and KPIs.",
    13: "Focus: execute_code, generate_chart, web_search, create_pdf, create_spreadsheet, project, financial_snapshot, profit_and_loss, cash_flow_summary, record_kpi. Model, forecast, and track financial performance.",
    14: "Focus: analyze_pdf, legal_review, compliance_audit, generate_legal_document, web_search, web_fetch, create_pdf, search_knowledge. Full legal suite — contract review, compliance audits, document generation, and advisory.",
  };

  const focus = PERSONA_TOOL_FOCUS[personaId];
  if (focus) {
    return full + "\n\n" + focus;
  }
  return full;
}
