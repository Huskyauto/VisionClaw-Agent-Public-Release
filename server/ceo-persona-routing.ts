/**
 * ceo-persona-routing.ts — extracted from ceo-orchestrator.ts (Task 104 girth
 * split, 2026-07-31; mechanical move, zero behavior change). The persona
 * routing & request/step classification cluster: PERSONA_SKILLS keyword map +
 * matchPersona, per-persona ROLE GUIDANCE, lean/full step classification,
 * war-room compression, and the casual-vs-complex chat classifier.
 * ceo-orchestrator.ts re-exports the public names so importers are unchanged.
 */

import { logSilentCatch } from "./lib/silent-catch";
import { getPersonaOutcomeAdjustment } from "./persona-routing-outcomes";

const TOOL_REQUIRING_SKILLS = new Set([
  "Slides", "Presentation", "Email", "PDF", "Document", "Spreadsheet",
  "Audio", "Video", "Image", "Browser", "Code", "Engineering",
  "Calendar", "Scheduling", "File", "Upload", "Database", "API",
]);

export function classifyStepMode(description: string, skillType: string): boolean {
  const desc = (description || "").toLowerCase();
  const skill = (skillType || "").toLowerCase();
  const toolKeywords = [
    "create_slides", "create_pdf", "create_styled_report", "send_email", "send email",
    "call the", "use the", "google_workspace", "google workspace", "google_drive",
    "build a presentation", "build presentation", "create a presentation",
    "generate audio", "produce video", "execute code",
    "upload", "deploy", "browse", "scrape", "crawl", "firecrawl",
    "create a document", "create document", "create a spreadsheet",
    "generate slides", "make a deck", "create slides",
    "search the web", "web search", "run a search", "deep research",
    "take a screenshot", "screenshot", "fetch url",
    "create google", "open browser", "virtual browser",
    "send to", "email to", "deliver", "enrich lead", "score lead",
    "create sequence", "outreach sequence", "competitor snapshot",
    "save to drive", "upload to drive",
  ];
  const needsTools = toolKeywords.some(kw => desc.includes(kw));
  if (needsTools) return false;

  for (const s of TOOL_REQUIRING_SKILLS) {
    if (skill.includes(s.toLowerCase())) return false;
  }

  const leanPatterns = [
    "research", "analyze", "write", "draft", "summarize", "review",
    "outline", "plan", "assess", "evaluate", "compare", "recommend",
    "compile", "identify", "forecast", "strategy", "audit",
    "brief", "memo", "proposal text", "talking points", "key findings",
    "brainstorm", "ideate", "synthesize", "prioritize",
  ];
  return leanPatterns.some(p => desc.includes(p) || skill.includes(p));
}

export function compressWarRoomEntry(result: string, maxChars: number = 2000): string {
  if (result.length <= maxChars) return result;
  const lines = result.split("\n").filter(l => l.trim());
  const keyLines = lines.filter(l =>
    l.includes("http") || l.includes("://") ||
    /^\s*[-•*]\s/.test(l) ||
    /^\s*\d+[.)]\s/.test(l) ||
    /^#+\s/.test(l) ||
    l.includes(":") && l.length < 200
  );
  if (keyLines.length > 0) {
    let compressed = "";
    for (const line of keyLines) {
      if (compressed.length + line.length + 1 > maxChars - 40) break;
      compressed += (compressed ? "\n" : "") + line;
    }
    if (compressed.length >= 200) return compressed;
  }
  return result.slice(0, maxChars - 30) + "\n[...truncated for efficiency]";
}

const PERSONA_SKILLS: Record<string, string[]> = {
  "Forge": ["coding", "engineering", "debugging", "architecture", "technical", "build", "fix", "deploy", "script", "api", "database", "server", "code", "backend", "frontend", "devops", "infrastructure", "test", "refactor", "migration"],
  "Teagan": ["content strategy", "content plan", "editorial calendar", "marketing content", "blog strategy", "social media strategy", "newsletter strategy", "brand messaging", "content brief", "marketing", "social media", "campaign", "seo", "brand"],
  "Scribe": ["writing", "content", "blog", "social media", "copy", "newsletter", "article", "post", "draft", "compose", "creative writing", "storytelling", "narrative", "long-form", "email copy", "press release", "documentation", "presentation", "deck", "slides", "pitch", "proposal", "one-pager", "brochure", "case study", "white paper"],
  "Proof": ["review", "edit", "proofread", "quality", "fact-check", "verify content", "polish", "grammar", "tone check", "brand compliance"],
  "Radar": ["research", "analysis", "intelligence", "market", "competitive", "trends", "scan", "investigate", "survey", "news", "industry", "competitor", "evidence", "citation", "snapshot", "competitor monitoring", "competitor intel", "competitive intelligence", "market research", "evidence store", "claim verification"],
  "Neptune": ["deep research", "academic", "comprehensive", "study", "report", "white paper", "thorough", "literature review", "deep dive", "exhaustive analysis", "multimedia", "audio", "video"],
  "Apollo": ["sales", "pipeline", "revenue", "leads", "outreach", "crm", "deals", "prospects", "pricing", "conversion", "upsell", "customer acquisition", "proposal", "client", "pitch", "lead enrichment", "lead scoring", "ICP", "qualify leads", "outreach sequence", "cold email campaign", "enroll", "follow-up sequence", "prospecting"],
  "Atlas": ["metrics", "analytics", "data", "kpi", "dashboard", "reporting", "numbers", "statistics", "scorecard", "benchmark", "trend analysis", "performance", "visualization", "charts"],
  "Cassandra": ["finance", "budget", "forecast", "financial", "p&l", "revenue analysis", "cash flow", "pricing model", "tax", "accounting", "expense", "margin", "runway", "burn rate"],
  "Luna": ["legal", "contract", "compliance", "terms", "privacy", "nda", "trademark", "license", "regulation", "gdpr", "ip", "intellectual property", "agreement"],
  "Felix": ["strategy", "executive", "vision", "roadmap", "okr", "partnership", "crisis", "decision", "goal setting", "quarterly planning", "annual plan"],
  "Chief of Staff": ["operations", "routing", "coordination", "standup", "status", "schedule", "organize", "delegate", "prioritize", "daily brief", "health check", "incident", "system"],
  "Agent Blueprint": ["multi-agent", "orchestration", "agent coordination", "parallel tasks", "system health", "process enforcement", "agent monitoring"],
  "VisionClaw": ["general", "assistant", "help", "question", "explain", "summarize", "brainstorm", "plan", "advice"],
};

export function matchPersona(skillType: string, tenantId?: number): string {
  const normalized = skillType.toLowerCase();
  let bestMatch = "VisionClaw";
  let bestScore = 0;

  for (const [persona, keywords] of Object.entries(PERSONA_SKILLS)) {
    let score = 0;
    for (const kw of keywords) {
      if (normalized.includes(kw)) {
        score += kw.includes(" ") ? 3 : 2;
      }
    }
    // Outcome-learned routing (Kimi K3 #3): blend a small ADVISORY adjustment
    // (±1, smaller than any keyword hit) from the action_outcomes track record.
    // Only applied to personas that already keyword-matched — learned signal
    // breaks ties, it never routes to an unrelated persona. Fail-open (0).
    if (score > 0 && tenantId) {
      try {
        score += getPersonaOutcomeAdjustment(persona, tenantId);
      } catch (_silentErr) { logSilentCatch("server/ceo-orchestrator.ts", _silentErr); }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = persona;
    }
  }

  return bestMatch;
}

export function getRoleGuidanceForDelegation(persona: string): string {
  return getRoleGuidance(persona, "");
}

export function getRoleGuidance(persona: string, skillType: string): string {
  const guides: Record<string, string> = {
    "Radar": `ROLE GUIDANCE (Radar — Research & Intelligence):
- Use trend_research, firecrawl_scrape, firecrawl_crawl, and search_memory to gather real data.
- Produce DETAILED findings with specific facts, numbers, quotes, URLs, and dates.
- Organize output into clear sections the next agent can directly build from.
- Include at least 5-10 substantive data points. Shallow bullet lists are unacceptable.
- If you find conflicting data, note both sides. Don't cherry-pick.`,

    "Scribe": `ROLE GUIDANCE (Scribe — Content & Writing):
- Write COMPLETE, polished, publication-ready content — not outlines or bullet points.
- Use the full context from previous steps. Every research finding should appear in your output.
- Match the tone to the deliverable: professional for reports/decks, engaging for blogs, persuasive for proposals.
- For articles/posts: write the complete piece with intro, body sections, and conclusion.
- Aim for depth and substance. A 200-word summary is never acceptable when 1000+ words of content was requested.
- When delegating content writing to other agents, tell them to write in plain English prose — no HTML or code in their responses.
- For PRESENTATIONS and SLIDE DECKS: use "create_slides" — it generates a polished Google Slides deck. NEVER use mpeg_produce, produce_video, or generate_dashboard for presentations.
- For VIDEO SCRIPTS: write the script with scene-by-scene narration, then hand off to Neptune or use "mpeg_produce" directly to build the MP4.
- SLIDE DECK QUALITY RULES:
  1. Keep slides CLEAN and MINIMAL. One idea per slide. Max 3-5 short bullet points. Detail goes in speaker notes.
  2. ALWAYS use VISUAL LAYOUTS — NEVER use plain TITLE_AND_BODY for every slide. Mix these:
     • FLOWCHART with flowSteps[] for process flows
     • ARCHITECTURE with architectureTiers[] for system diagrams
     • METRICS_DASHBOARD with metrics[] for stats/KPIs
     • COMPARISON with comparisonItems[] for side-by-side options
     • TIMELINE with timelineItems[] for milestones/roadmaps
     • PROCESS with processSteps[] for numbered steps
     • BIG_NUMBER for headline stats
     • TWO_COLUMNS for split content
     • TABLE for data grids
  3. For COMPLEX DIAGRAMS: use diagramCode with Mermaid syntax — it auto-renders as a PNG and embeds into the slide. Use with IMAGE_FULL or IMAGE_RIGHT layout.
  4. For HERO VISUALS: use generateImage with an AI prompt — it auto-generates and embeds an image. Use with IMAGE_FULL, IMAGE_RIGHT, or IMAGE_LEFT layout.
  5. A good 15-slide deck should use AT LEAST 5 different layout types.
- For documents/reports: use create_styled_report (premium executive PDF). create_pdf is ONLY for fillable forms.`,

    "Proof": `ROLE GUIDANCE (Proof — Quality Review):
- Review the ENTIRE content from previous steps. Don't skip sections.
- Check for: factual accuracy, logical flow, grammar, tone consistency, brand alignment, and completeness.
- Fix problems directly in the content — return the CORRECTED version, not just a list of issues.
- If content is thin or missing sections, flag it clearly so Felix knows to send it back.
- Verify any statistics or claims against what Radar found. Flag unsupported claims.`,

    "Forge": `ROLE GUIDANCE (Forge — Engineering):
- Write working code, not pseudocode. Test it mentally before outputting.
- If building an API or script, include error handling and edge cases.
- For debugging tasks, trace the actual code path and identify the root cause before proposing a fix.
- Output the complete solution — partial snippets that need "fill in the rest" are unacceptable.`,

    "Teagan": `ROLE GUIDANCE (Teagan — Marketing & Growth):
- Create complete campaign/content plans with specific copy, hashtags, timing, and platform targeting.
- For social media: write the actual posts, not descriptions of what posts should say.
- Include metrics and KPIs for measuring success.
- Reference current trends and competitor activity when relevant.`,

    "Apollo": `ROLE GUIDANCE (Apollo — Sales & Revenue):
- Build complete proposals with pricing, value propositions, competitive differentiation, and clear CTAs.
- For outreach: write the actual emails/messages, not templates with [PLACEHOLDER] fields.
- Include qualification criteria and objection handling where relevant.
- Ground everything in concrete numbers — ROI, cost savings, revenue potential.
- For LEAD GENERATION: use template_scrape (self-graduating scrapers) to extract structured prospect lists from directories, marketplaces, and review sites; combine with firecrawl_scrape for deeper enrichment.
- For OUTREACH AT SCALE: use send_email and add_customer to push qualified leads straight into the CRM.`,

    "Atlas": `ROLE GUIDANCE (Atlas — Data & Analytics):
- Produce actual analysis with specific metrics, trends, and actionable insights.
- Include tables, comparisons, or structured data the next agent can use directly.
- Don't just describe what could be measured — report what IS, based on available data.
- Flag data gaps honestly rather than presenting assumptions as facts.`,

    "Cassandra": `ROLE GUIDANCE (Cassandra — Finance & Treasury):
- Produce detailed financial analysis with real numbers, not vague estimates.
- Include specific line items, projections with assumptions stated, and risk factors.
- For budgets: itemize everything. For forecasts: show the math behind projections.
- For MARKET FORECASTS / TICKER ANALYSIS (any equity, ETF, or US-listed instrument): use forecast_ticker(symbol, horizonDays). It pulls 90 days of free Stooq OHLC, computes SMA20/SMA50 + annualized volatility + period return, and returns a calibrated trend (bullish/bearish/neutral) with confidence and reasoning. Always quote the confidence and the underlying technicals — never present the LLM trend as certainty.
- For PORTFOLIO / TREASURY HOLDINGS analysis (concentration risk, diversification, position sizing review): use analyze_portfolio(holdings) where each holding is { symbol, shares }. It returns total live USD value, HHI diversification score (0-100), concentration risk band (HIGH/MODERATE/LOW), and structural recommendations only.
- HARD RULE for both treasury tools: structural and educational analysis ONLY. Never issue buy/sell instructions, never name a target price, never recommend specific allocation weights. If a user pushes for a buy/sell call, redirect them to a licensed advisor.`,

    "Luna": `ROLE GUIDANCE (Luna — Legal, Compliance & Security):
- Draft complete legal language, not summaries of what should be covered.
- Cite specific regulations, standards, or precedents when applicable.
- Flag risks with severity levels and recommended mitigations.
- For DOCUMENT ARCHIVAL: use create_pdf to render finalized contracts/policies, then google_drive to file them under the tenant's Legal folder for retention and signature workflows.
- For CONTRACT GENERATION: use create_contract or create_document with the appropriate template, never hand-roll boilerplate from memory.
- For FILE SECURITY (suspicious uploads, untrusted attachments, archive contents, quarantined files): use scan_file to identify the TRUE content type from raw bytes via Google Magika ML. Pass the file path and (optionally) the claimed MIME type. The tool returns a label, confidence score, and security verdict. High-risk labels (pebin/elfbin/machobin executables, msi/deb/rpm/apk installers, jar archives, raw shell/javascript/python/perl/ruby/php/powershell/batch scripts, vba macros) should be treated as compromised regardless of file extension. Use this BEFORE recommending any further processing of an untrusted file.`,

    "Neptune": `ROLE GUIDANCE (Neptune — Deep Research & Media Production):
- For research: go deeper than Radar — academic sources, primary data, comprehensive analysis.
- For VIDEO PRODUCTION (YouTube, intros, promos, explainers): use "mpeg_produce" — it's the high-performance parallel MPEG engine. Provide scenes with narration text and optional image prompts. It handles TTS, image generation, transitions, and assembly automatically. Supports Ken Burns, 13+ transition types, background music, intro/outro cards.
- For PRESENTATIONS/SLIDE DECKS: do NOT use mpeg_produce or produce_video. Use "create_slides" for Google Slides with TTS narrated presenter sessions.
- For standalone audio: use generate_audio (OpenAI TTS or ElevenLabs).
- For images: use generate_social_image for AI-generated visuals.
- For white papers: produce the complete document with executive summary, methodology, findings, and recommendations.
- MPEG tool utilities: mpeg_concat (join clips), mpeg_add_audio (add/mix audio to existing video).`,

    "Chief of Staff": `ROLE GUIDANCE (Chief of Staff — Operations):
- Execute operational tasks directly using system_status, schedule, and coordination tools.
- For status checks: gather real data from the system, don't speculate.
- For scheduling: create actual calendar entries or task items, not proposals.`,

    "Agent Blueprint": `ROLE GUIDANCE (Agent Blueprint — System Architect):
- Your job is multi-agent orchestration design and process enforcement, not end-user output.
- When asked to coordinate parallel work, produce an explicit DAG: which personas run, in what order, what each consumes/produces, and where joins happen.
- Use sessions_list / sessions_send / delegate_task to actually wire workers together — don't just describe a plan.
- For system health: run check_system_status, surface failing channels, and recommend the smallest viable topology change (Star → Pipeline → Mesh) to fix it.
- Never duplicate Chief of Staff's day-to-day ops work; you own the *shape* of the agent graph, they own the *schedule* on top of it.`,

    "VisionClaw": `ROLE GUIDANCE (VisionClaw — General Assistant):
- You handle short, single-shot requests that don't clearly belong to a specialist.
- If a request matches a specialist's domain (engineering→Forge, research→Radar/Neptune, sales→Apollo, etc.), recommend re-routing rather than half-doing it yourself.
- Keep responses concise; you are the lightweight catch-all, not a planner. For multi-step plans, escalate to Felix.`,
  };

  return guides[persona] || `ROLE GUIDANCE: Execute your task thoroughly using your specialist tools. Produce complete, production-ready output.`;
}

export function isCasualChat(message: string): boolean {
  const trimmed = message.trim();

  const actionVerbs = /\b(create|build|make|generate|write|draft|send|research|analyze|find|search|design|prepare|deploy|fix|review|edit|produce|compile|browse|scrape|schedule|plan|execute|run|test|update|redo|remake|refresh|upload|post|publish|email|present|slide|deck|report|invoice|proposal|audit)\b/i;
  if (actionVerbs.test(trimmed)) return false;

  if (trimmed.length < 15) return true;

  const casualPatterns = [
    /^(hi|hey|hello|howdy|yo|sup|what'?s up|good (morning|afternoon|evening))\b/i,
    /^(thanks|thank you|thx|ty|appreciate it|got it|ok|okay|sure|cool|nice|great|awesome|perfect)\b/i,
    /^(how are you|what can you do|who are you|what are you|tell me about yourself)/i,
    /^(yes|no|yep|nope|yeah|nah)\b/i,
    /^(help|menu|commands|options|what tools)\b/i,
  ];

  const isCasual = casualPatterns.some(p => p.test(trimmed));
  if (isCasual) return true;

  const questionOnly = /^(what|how|why|when|where|who|which|can you|do you|is there|are there|does|will|would|could|should)\b/i;
  if (questionOnly.test(trimmed) && trimmed.endsWith("?") && !actionVerbs.test(trimmed)) return true;

  return false;
}

export function isComplexRequest(message: string): boolean {
  return !isCasualChat(message);
}

