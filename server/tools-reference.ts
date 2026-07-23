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
    tools: ["search_memory", "create_memory", "update_memory", "recall_context", "remember_for_this_session", "search_knowledge", "create_knowledge", "graph_memory", "store_triple", "query_triples", "expire_triple", "query_communities", "query_causal", "chunk_code"],
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
    tools: ["browser", "browser_workflow", "stealth_browse", "stealth_browse_camofox", "vision_browse", "site_login"],
  },
  scrapedData: {
    label: "SCRAPED DATA MANAGEMENT",
    tools: ["scraped_pages_query", "scraped_page_read", "scraped_pages_delete"],
  },
  files: {
    label: "FILES & GOOGLE DRIVE",
    tools: ["google_drive", "read_file", "write_file", "list_uploads", "read_output_blob", "code_slice"],
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
  agentic: {
    label: "AGENTIC EXECUTION (LangGraph-style)",
    tools: ["parallel_research", "run_supervisor", "list_agent_runs", "get_agent_run", "agentic_cache_stats", "request_approval", "decide_approval", "list_pending_approvals", "commit_decision", "revenue_vs_cost", "agent_cost_summary", "self_heal", "self_heal_log", "self_heal_inspect"],
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
    tools: ["critique_response", "debate", "tree_of_thought", "llm_task", "audit_reasoning_step", "verify_math_chain"],
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
  parallel_research: `parallel_research({ topics: ["AI agent frameworks 2026", "LangGraph vs CrewAI", "Top vector databases"], provider: "perplexity", concurrency: 4 })`,
  run_supervisor: `run_supervisor({ task: "Produce a competitive brief on AI agent platforms with citations and an executive summary", maxTurns: 6 })`,
  list_agent_runs: `list_agent_runs({ status: "completed", limit: 10 })`,
  get_agent_run: `get_agent_run({ runId: 42 })`,
  agentic_cache_stats: `agentic_cache_stats({})`,
  request_approval: `request_approval({ question: "Send this $500 ad spend to LinkedIn?", context: { cost: 500, campaign: "Q2 Launch", reversibility: "low" } })`,
  decide_approval: `decide_approval({ approvalId: 7, approved: true, note: "Budget confirmed" })`,
  list_pending_approvals: `list_pending_approvals({ limit: 20 })`,
  commit_decision: `commit_decision({ decision: "Which product should we build first?", options: ["AI lead scorer for SaaS", "Auto-generated market reports", "Lead enrichment API"], context: "We have $5K budget and 30 days. Research shows option 2 has 3x the TAM.", threshold: 0.75, reversible: false })`,
  revenue_vs_cost: `revenue_vs_cost({ days: 7 })`,
  agent_cost_summary: `agent_cost_summary({ days: 30 })`,
  audit_reasoning_step: `audit_reasoning_step({ question: "What's our Q2 net?", reasoning_trace: "1. Revenue is $1M. 2. COGS is $300K so gross is $700K. 3. OpEx is $200K so EBIT is $500K. 4. Tax at 21% is $105K. 5. Net = $395K.", original_answer: "$395K" })`,
  verify_math_chain: `verify_math_chain({ bindings: { revenue: 1000000, cogs: 300000, opex: 200000 }, steps: [{ id: "gross", expression: "revenue - cogs", claimed_value: 700000, unit: "USD" }, { id: "ebit", expression: "gross - opex", claimed_value: 500000, unit: "USD" }, { id: "tax", expression: "ebit * 0.21", claimed_value: 105000, unit: "USD" }, { id: "net", expression: "ebit - tax", claimed_value: 395000, unit: "USD" }], expected_final: 395000 })`,
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
  lines.push("");
  lines.push("## END-TO-END PROJECT SCAFFOLDING (autonomy layer)");
  lines.push("Every persona is wired to take work from kickoff → deliverable → bill → archive without dropping balls. Use this loop:");
  lines.push("");
  lines.push("1. **Pick up the work**. The platform auto-creates a `projects` row when a user message contains a project signal (\"build\", \"launch\", \"campaign\", \"plan\", etc.). Always call `project({action: 'list'})` first to see if work belongs to an existing project, then `project({action: 'add_file', project_id, file_name, file_url, file_type})` for every deliverable you produce. Files belong on Google Drive, never local paths.");
  lines.push("2. **Plan with a scaffold**. The codebase ships scaffolds (DEPARTMENTS + OPERATION_SCAFFOLDS in server/scaffolding.ts) for repeatable operations: EXEC-01 strategic planning, ENG-01 feature delivery, MKT-01 campaign launch, FIN-01 month-end close, OPS-01 customer onboarding, etc. When you accept a project, name the scaffold you're following so handoffs are unambiguous. Use `plan_and_execute` for ad-hoc DAGs and `orchestrate` for one-off complex requests.");
  lines.push("3. **Decide with confidence scoring**. For non-trivial choices use `commit_decision({decision, options[], context, threshold: 0.7, reversible: true|false})`. The model self-scores its confidence; if it falls below `threshold` (or `reversible=false`), the platform auto-escalates to `request_approval` so the owner is asked before money/reputation is at risk. Never silently pick a low-confidence option — escalate.");
  lines.push("4. **Pause for approval before risky moves**. Always call `request_approval({question, context, runId?, ttlHours?})` BEFORE: spending real money, sending external comms (mass email, public posts, paid ads), modifying production data, signing/publishing contracts, or any action you would not want auto-undone. The agent run pauses with `pendingApprovalId`. The owner calls `decide_approval({approvalId, approved, note})` and the **resume worker** in the heartbeat picks up paused→running transitions every minute and continues the plan. Approvals expire after 48h by default.");
  lines.push("5. **Stay inside the cost envelope**. Before spinning up a long parallel run, call `revenue_vs_cost({days: 7})`. If burn ratio > 0.5 the auto-router will already downgrade away from premium models (per-tenant). Use `agent_cost_summary({days: 30})` for the full breakdown. Owner-only tools but every persona is expected to know the burn discipline.");
  lines.push("6. **Parallelize and supervise**. `parallel_research({topics[], provider, concurrency})` fans out independent lookups. `run_supervisor({task, maxTurns})` runs a router→specialist loop with full step logging and the same approval/resume semantics. Both write rows to `agent_runs` you can inspect with `list_agent_runs` / `get_agent_run`.");
  lines.push("7. **Hand off cleanly**. Use `delegate_task({targetAgent, taskName, prompt, schedule: 'once'})` for single specialist asks, `create_crew` for parallel teamwork, `create_flow` for repeatable sequential pipelines. Always pass the project_id in the prompt so the receiver registers files against the right project.");
  lines.push("8. **Close the loop**. Mark `delivery_status` and `track_outcome` when the deliverable ships. Email the owner with the Drive link via `send_email`. Log learnings via `log_experiment` so the next run is faster.");
  lines.push("");
  lines.push("RULE: silently giving up is worse than escalating. If you are blocked → `request_approval`. If you are unsure between options → `commit_decision`. If you are running long → `revenue_vs_cost` and downgrade. The resume worker will pick you back up after the owner answers.");
  lines.push("");
  lines.push("## SELF-HEALING (Blueprint's auto-recovery)");
  lines.push("Failures in `runSupervisor` and `tryWithSelfHeal()` automatically wake Blueprint as a self-healing supervisor BEFORE failing the parent run. Blueprint diagnoses, then proposes one of: `replan` (different args/tool), `custom_tool` (registers a new helper via create_tool), `code_snippet` (runs sandboxed JS/Python via execute_code), `escalate` (request_approval to owner), or `give_up`. Reversible fixes auto-apply; irreversible fixes auto-escalate. Limits: 2 heal attempts per run, 20 per tenant per hour. Every attempt is logged to `self_heal_attempts` for human review and possible promotion into platform code.");
  lines.push("- `self_heal({originalGoal, error, runId?, lastToolName?, lastToolArgs?, recentSteps?})` — manually trigger Blueprint's recovery on any failure. Useful when you've tried something twice and want a fresh diagnosis.");
  lines.push("- `self_heal_log({limit?, runId?, outcome?})` — list past auto-fixes; returns `promotionCandidates` count (succeeded fixes not yet promoted to the main platform).");
  lines.push("- `self_heal_inspect({attemptId, markPromoted?})` — read the full diagnosis + fix payload + generated code snippet. Mark as promoted once you've folded the fix into platform code.");
  lines.push("- KEY: do not silently `give_up`. If the auto-fix can't be made reversible and safe, the platform escalates to the owner via the same approval+resume plumbing as `request_approval`. The run pauses, the owner decides, the resume worker picks it up.");

  cachedReference = lines.join("\n");
  cacheTime = Date.now();
  return cachedReference;
}

export async function getToolsReferenceForPersona(personaId: number): Promise<string> {
  const full = await buildToolsReference();

  const PERSONA_TOOL_FOCUS: Record<number, string> = {
    1: "Focus (VisionClaw — owner-facing executive): project, list_agent_runs, get_agent_run, list_pending_approvals, decide_approval, revenue_vs_cost, agent_cost_summary, business_health_score, financial_snapshot, manage_desk, send_email, revenue_mission_list, revenue_mission_status, mission_portfolio_review. You are the owner's voice. Brief the owner on Verified Revenue Mission progress from EVIDENCE (revenue_mission_status done checks), never from optimism. Triage approval queues, brief on revenue-vs-cost, and confirm deliverables before they ship. For any new initiative open or attach a project, then delegate to the right specialist. Always use commit_decision for non-trivial owner-facing recommendations and request_approval before authorizing spend, contracts, or external comms.",
    2: "Focus (Felix — CEO): delegate_task, orchestrate, create_crew, create_flow, plan_and_execute, project, estimate_cost, run_supervisor, parallel_research, list_agent_runs, get_agent_run, commit_decision, request_approval, decide_approval, list_pending_approvals, revenue_vs_cost, agent_cost_summary, audit_reasoning_step, revenue_mission_create, revenue_mission_list, revenue_mission_status, revenue_mission_draft_experiment, mission_portfolio_review. You run the company end-to-end. Verified Revenue Missions are the owner's evidence-only business experiments: create the mission, draft the capped sample (sends NOTHING — the owner approves in the admin UI), then track done checks from real replies/payments only — pick a scaffold (EXEC-01 / ENG-01 / MKT-01 / FIN-01 / OPS-01), open or attach a project, fan out work via crews/flows or run_supervisor, and gate every irreversible step behind commit_decision → request_approval. Check revenue_vs_cost before any expensive parallel run. Doctrine #11: before any plan with >50¢ predicted cost or >=4-step reasoning chain that drives a non-trivial commit_decision, run audit_reasoning_step on the plan rationale to surface load-bearing assumptions. If delegation fails you also have direct access to: write_file, read_file, create_slides, create_pdf, create_spreadsheet, exec, financial_snapshot.",
    3: "Focus (Forge — engineering): execute_code, exec, web_search, web_fetch, project, google_drive, create_pdf, create_tool, skill_seeker, sculptor_session, run_supervisor, parallel_research, commit_decision, request_approval, code_slice, read_output_blob. Build, ship, and extend the platform. Use commit_decision for architectural choices; request_approval before deploys, schema changes, or new external dependencies. Register every shipped artifact against its project. R117 token-savers: prefer code_slice over read_file when you only need specific functions/classes from a large source file (pass {filePath, symbols:[...]}; 70–95% token savings). When a prior tool returns {truncated:true, sandboxLabel:'...'}, use read_output_blob with mode='grep'/'sliceLines' to navigate the offloaded payload instead of asking the user to re-run.",
    4: "Focus (Teagan — marketing/social): compose_social_post, manage_content_calendar, marketing_analytics, marketing_experiment, generate_social_image, search_stock_media, x_post_tweet, x_search, trend_research, project, commit_decision, request_approval. Always request_approval before publishing public posts or launching paid campaigns. Use commit_decision for creative direction and channel mix when the budget is non-trivial.",
    5: "Focus (Blueprint — solution architect): orchestrate, plan_and_execute, run_supervisor, parallel_research, create_crew, create_flow, project, render_diagram, create_pdf, search_knowledge, commit_decision, request_approval, list_agent_runs, get_agent_run, audit_reasoning_step. Translate ambiguous goals into scaffolded plans, name the operation scaffold you're following, draw the diagram, then hand to specialists via crews/flows. For irreversible architectural calls always commit_decision with reversible=false (auto-escalates). Doctrine #11: when your design rationale is >=4 steps and architectural (irreversible), run audit_reasoning_step BEFORE the commit_decision — high load-bearing scores tell you which premises must be defended in the ADR.",
    6: "Focus (Chief of Staff): test_api_keys, check_system_status, list_models, manage_desk, write_daily_note, agent_status, agent_security_scan, context_budget_audit, list_agent_runs, get_agent_run, list_pending_approvals, agentic_cache_stats, revenue_vs_cost, agent_cost_summary, request_approval. Monitor, audit, and report on system health and cost burn. Surface stuck approvals and runs every standup. The resume worker handles paused→running but you escalate orphaned runs the worker logs as 'no_continuation'.",
    7: "Focus (Scribe — documents): create_pdf, create_styled_report, create_document, create_slides, google_drive, project, search_memory, web_search, generate_audio, render_diagram, commit_decision, request_approval. Write and deliver in every format. Register every PDF/doc/deck against its project; request_approval before emailing externally or signing-out final docs.",
    8: "Focus (Proof — QA/review): search_memory, web_search, web_fetch, search_knowledge, critique_response, run_agent_eval, get_eval_report, list_agent_runs, get_agent_run, commit_decision, request_approval, audit_reasoning_step, verify_math_chain. Review, verify, and evaluate quality. Use commit_decision when judging pass/fail on borderline work; request_approval before vetoing a peer's deliverable. Doctrine #11 is your bread and butter: every multi-step deliverable you review gets audit_reasoning_step (load-bearing check); every chain that ends in a number gets verify_math_chain (free, run it always). A POSSIBLE_ANNOTATION_ERROR on an eval row means the two judges disagreed — re-read the work yourself before signing off.",
    9: "Focus (Radar — research): web_search, web_fetch, deep_research, trend_research, firecrawl_search, firecrawl_scrape, firecrawl_crawl, firecrawl_map, scraped_pages_query, scraped_page_read, create_pdf, generate_chart, search_knowledge, save_evidence, query_evidence, synthesize_research, add_competitor, list_competitors, take_competitor_snapshot, detect_competitor_changes, competitor_briefing, parallel_research, run_supervisor, commit_decision, audit_reasoning_step. For multi-topic sweeps use parallel_research; for narrative briefings use run_supervisor with the standard router. commit_decision before publishing any claim that could affect strategy. Doctrine #11: when synthesize_research produces a multi-step argument leading to a strategic recommendation, run audit_reasoning_step on the synthesis — load-bearing score >= 0.7 on a step means that source citation MUST appear in the brief or the conclusion is unsupported.",
    10: "Focus (Neptune — media): generate_audio, produce_video, create_slideshow_video, vibevoice_transcribe, deep_research, google_drive, project, generate_social_image, search_stock_media, commit_decision, request_approval. Produce media end-to-end. Always project add_file every audio/video output. request_approval before publishing media externally or burning paid stock licenses.",
    11: "Focus (Apollo — revenue): send_email, compose_social_post, x_post_tweet, create_pdf, generate_chart, generate_social_image, project, create_invoice, customer_pipeline, financial_snapshot, enrich_lead, score_leads, qualify_leads, define_icp, create_sequence, enroll_in_sequence, advance_sequence, classify_reply, list_sequences, commit_decision, request_approval. Drive revenue with the full CRM/sequencing stack. request_approval before sending any sequence to >5 contacts, issuing an invoice, or offering a discount.",
    12: "Focus (Atlas — analytics): generate_chart, generate_dashboard, execute_code, web_search, create_pdf, create_spreadsheet, financial_snapshot, kpi_dashboard, kpi_trend, revenue_report, profit_and_loss, cash_flow_summary, business_health_score, revenue_vs_cost, agent_cost_summary, commit_decision, verify_math_chain, audit_reasoning_step. Visualize and report. Use revenue_vs_cost weekly and brief Felix/owner on burn ratio with commit_decision recommendations on what to throttle. Doctrine #11: every KPI rollup, P&L slice, or burn-ratio claim that ends in a number MUST pass through verify_math_chain before it lands in a chart or PDF — the LLM hallucinates arithmetic at non-zero rate and this tool is free.",
    13: "Focus (Cassandra — finance): execute_code, generate_chart, web_search, create_pdf, create_spreadsheet, project, financial_snapshot, profit_and_loss, cash_flow_summary, record_kpi, revenue_vs_cost, agent_cost_summary, revenue_mission_list, revenue_mission_status, mission_portfolio_review, commit_decision, request_approval, verify_math_chain, audit_reasoning_step. Model, forecast, and track. Read Verified Revenue Mission economics (revenue vs refunds vs spend caps) straight from revenue_mission_status evidence counters — never model over them. request_approval before posting any forecast revision or budget reallocation. Use revenue_vs_cost as your daily heartbeat. Doctrine #11 is non-negotiable for finance: ALWAYS call verify_math_chain on every multi-step calculation (gross → ebit → tax → net, ROI, NPV, allocations, runway). For forecasts and budget reallocations longer than 4 reasoning steps, also run audit_reasoning_step to surface which assumptions actually drive the number — those are the ones to stress-test.",
    14: "Focus (Luna — legal): analyze_pdf, legal_review, compliance_audit, generate_legal_document, web_search, web_fetch, create_pdf, search_knowledge, commit_decision, request_approval. Full legal suite. ALWAYS commit_decision with reversible=false for any contract sign-off, IP release, or compliance certification — auto-escalates to the owner.",
    15: "Focus (Minerva — Chief Planner): create_plan, getMinervaRoster, search_memory, create_memory, recall_context, search_knowledge, create_knowledge, project, context_budget_audit, tool_performance_report, audit_reasoning_step. You translate Felix's objectives into structured agent-assigned plans. Doctrine #11: every plan whose rationale is >=4 steps OR whose total estimated cost exceeds 50¢ MUST be passed through audit_reasoning_step BEFORE you persist plan.proposed — Felix should see which premises are load-bearing so revisions target the spine, not the decoration. Never editorialize Felix's decisions; on rejection, audit your own reasoning chain first, then re-plan.",
  };

  const focus = PERSONA_TOOL_FOCUS[personaId];
  if (focus) {
    return full + "\n\n" + focus;
  }
  return full;
}
