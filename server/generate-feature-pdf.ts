import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { uploadToDrive } from "./google-drive";
import fs from "fs";

function sanitizeText(text: string): string {
  const replacements: Record<string, string> = {
    '\u2713': '[x]', '\u2714': '[x]', '\u2717': '[ ]', '\u2718': '[ ]',
    '\u25B8': '>', '\u25BA': '>', '\u25CF': '*', '\u25CB': 'o',
    '\u25A0': '#', '\u25A1': '[]', '\u2192': '->', '\u2190': '<-',
    '\u21D2': '=>', '\u2014': '--', '\u2013': '-',
    '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"',
    '\u2026': '...', '\u00A0': ' ', '\u2212': '-',
    '\u2264': '<=', '\u2265': '>=', '\u2260': '!=',
    '\u2605': '*', '\u2606': '*', '\u00B7': '*',
  };
  let result = text;
  for (const [u, a] of Object.entries(replacements)) {
    result = result.split(u).join(a);
  }
  return result.replace(/[^\x00-\xFF]/g, '?');
}

export async function generateComprehensiveFeaturePDF(): Promise<{
  success: boolean;
  driveUrl?: string;
  error?: string;
}> {
  const dateStr = new Date().toISOString().split("T")[0];
  const fileName = `VisionClaw-Complete-Feature-Report-${dateStr}.pdf`;
  const localPath = `/tmp/${fileName}`;

  try {
    const doc = await PDFDocument.create();
    doc.setTitle("VisionClaw Agent - Complete Feature Report");
    doc.setAuthor(process.env.SITE_COMPANY_LEGAL || "Platform");
    doc.setCreator("VisionClaw Agent Platform");
    doc.setProducer(process.env.SITE_COMPANY_LEGAL || "Platform");

    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontMono = await doc.embedFont(StandardFonts.Courier);

    const PAGE_W = 612;
    const PAGE_H = 792;
    const MARGIN = 50;
    const MAX_X = PAGE_W - MARGIN;
    const LINE_H = 14;
    const SECTION_GAP = 10;

    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    function newPage() {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }

    function checkSpace(needed: number) {
      if (y - needed < MARGIN) newPage();
    }

    function drawTitle(rawText: string, size: number = 20) {
      const text = sanitizeText(rawText);
      checkSpace(size + 10);
      page.drawText(text, { x: MARGIN, y, size, font: fontBold, color: rgb(0.1, 0.1, 0.4) });
      y -= size + 8;
    }

    function drawHeading(rawText: string) {
      const text = sanitizeText(rawText);
      checkSpace(30);
      y -= SECTION_GAP;
      page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: MAX_X, y: y + 4 }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
      y -= 4;
      page.drawText(text, { x: MARGIN, y, size: 13, font: fontBold, color: rgb(0.15, 0.15, 0.5) });
      y -= 18;
    }

    function drawSubheading(rawText: string) {
      const text = sanitizeText(rawText);
      checkSpace(22);
      y -= 4;
      page.drawText(text, { x: MARGIN, y, size: 11, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
      y -= 16;
    }

    function drawText(rawText: string, indent: number = 0) {
      const text = sanitizeText(rawText);
      const maxWidth = MAX_X - MARGIN - indent;
      const words = text.split(" ");
      let line = "";
      for (const word of words) {
        const testLine = line ? line + " " + word : word;
        const width = font.widthOfTextAtSize(testLine, 10);
        if (width > maxWidth && line) {
          checkSpace(LINE_H);
          page.drawText(line, { x: MARGIN + indent, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
          y -= LINE_H;
          line = word;
        } else {
          line = testLine;
        }
      }
      if (line) {
        checkSpace(LINE_H);
        page.drawText(line, { x: MARGIN + indent, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
        y -= LINE_H;
      }
    }

    function drawBullet(text: string, indent: number = 10) {
      checkSpace(LINE_H);
      page.drawText("\u2022", { x: MARGIN + indent, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
      drawText(text, indent + 12);
    }

    function drawTableRow(cols: string[], widths: number[], bold: boolean = false) {
      checkSpace(LINE_H);
      let x = MARGIN;
      const f = bold ? fontBold : font;
      for (let i = 0; i < cols.length; i++) {
        const txt = sanitizeText(cols[i].slice(0, Math.floor(widths[i] / 5.5)));
        page.drawText(txt, { x, y, size: 9, font: f, color: rgb(0.1, 0.1, 0.1) });
        x += widths[i];
      }
      y -= LINE_H;
    }

    // === COVER PAGE ===
    y = PAGE_H - 150;
    page.drawText("VISIONCLAW AGENT", { x: MARGIN, y, size: 28, font: fontBold, color: rgb(0.1, 0.1, 0.4) });
    y -= 36;
    page.drawText("Complete Feature Report", { x: MARGIN, y, size: 20, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    y -= 30;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MAX_X, y }, thickness: 2, color: rgb(0.1, 0.1, 0.4) });
    y -= 40;
    page.drawText("Agentic AI Corporation Platform", { x: MARGIN, y, size: 16, font, color: rgb(0.2, 0.2, 0.2) });
    y -= 24;
    page.drawText(`Built by ${process.env.SITE_COMPANY_LEGAL || "Platform"}`, { x: MARGIN, y, size: 14, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 60;

    const metrics = [
      ["AI Personas", "14 specialized roles"],
      ["AI Models", "36+ models across 8+ providers"],
      ["AI Providers", "8+ connected (+ Claude Runner CLI bridge)"],
      ["AI Tools", "89 built-in capabilities + custom tools"],
      ["Active Skills", "23 (8 business ops + 15 platform)"],
      ["Governance Rules", "40 rules across 7 categories"],
      ["Trust Scores", "9 categories, 40 scores across 13 agents"],
      ["Express Lanes", "12 agent-to-agent direct handoff routes"],
      ["Proactive Triggers", "32 triggers across 9 personas"],
      ["Decision Protocols", "5 collective intelligence protocols"],
      ["Evaluators", "9 real-time system evaluators"],
      ["Op Scaffolds", "65 governance-wired, 12 departments"],
      ["Research Programs", "11 autonomous (5 nightly + 6 business)"],
      ["Research Schedules", "7 automated (6 weekly Sunday + 1 nightly)"],
      ["Heartbeat Tasks", "13 scheduled autonomous operations"],
      ["Project Folders", "3 (configurable project folders)"],
      ["Server Modules", "120 TypeScript files (~60,000 lines)"],
      ["Frontend Pages", "38 React pages"],
      ["Database Tables", "66 PostgreSQL tables"],
      ["Vector Search", "pgvector w/ HNSW indexes, cross-persona"],
      ["Design Patterns", "6 book-inspired patterns"],
      ["Comm Channels", "AgentMail, WhatsApp, Discord, Telegram"],
      ["YouTube", "OAuth channel management"],
      ["Auto-Project", "Automatic project detection"],
      ["Context Guard", "Zero-loss compaction w/ archive"],
      ["Model Routing", "OAuth-first, 3-pass priority, 60s log dedup"],
    ];
    drawSubheading("Key Metrics");
    for (const [label, value] of metrics) {
      drawTableRow([label, value], [160, 350]);
    }

    y -= 40;
    page.drawText(`Generated: ${new Date().toISOString()}`, { x: MARGIN, y, size: 9, font: fontMono, color: rgb(0.5, 0.5, 0.5) });

    // === SECTION 1: ARCHITECTURE ===
    newPage();
    drawTitle("Section 1: System Architecture");

    drawSubheading("Frontend Stack");
    const feItems = [
      "React 18 with Vite build system",
      "shadcn/ui component library with TailwindCSS",
      "Wouter for client-side routing, TanStack Query v5",
      "Command Center Dashboard with grouped sidebar",
      "Auto-named conversations, 3-step onboarding flow",
      "Usage dashboard, legal pages, cookie consent, error boundary",
      "Dark mode with localStorage persistence, code splitting",
      "Over 25 frontend pages",
    ];
    for (const item of feItems) drawBullet(item);

    drawSubheading("Backend Stack");
    const beItems = [
      "Express.js with TypeScript, Drizzle ORM, Zod, Helmet",
      "Real-time AI responses via Server-Sent Events (SSE)",
      "Multi-auth: Replit Auth (OAuth), Email/Password, Admin PIN (HMAC-SHA256)",
      "DB-backed sessions, timing-safe cryptography, email verification",
      "Strict multi-tenant data isolation across all queries",
    ];
    for (const item of beItems) drawBullet(item);

    drawSubheading("Database");
    const dbItems = [
      "PostgreSQL with Drizzle ORM, 66 tables",
      "pgvector for native vector similarity search with HNSW indexes",
      "Automated schema management with safe migration patterns",
      "Production-only pgvector initialization (avoids migration conflicts)",
    ];
    for (const item of dbItems) drawBullet(item);

    // === SECTION 2: AI PERSONAS ===
    drawHeading("Section 2: AI Personas (14 Total)");
    const personas = [
      ["1", "VisionClaw", "CEO & Primary Agent - orchestrates all operations"],
      ["2", "Felix", "Operations Manager - task approval, delegation oversight"],
      ["3", "Forge", "Full-Stack Developer - code generation, debugging, architecture"],
      ["4", "Teagan", "Customer Success - engagement, onboarding, support"],
      ["5", "Blueprint", "Project Manager - planning, milestones, documentation"],
      ["6", "Chief of Staff", "Infrastructure & Stability - watchdog, monitoring"],
      ["7", "Scribe", "Content Writer - copywriting, documentation, marketing"],
      ["8", "Proof", "QA & Testing - quality assurance, validation, compliance"],
      ["9", "Radar", "Market Research - competitive analysis, trend monitoring"],
      ["10", "Neptune", "Data Analyst - data processing, insights, visualization"],
      ["11", "Apollo", "Creative Director - branding, design concepts, visual identity"],
      ["12", "Atlas", "Strategy Consultant - business strategy, growth planning"],
      ["13", "Cassandra", "Risk Analyst - risk assessment, security auditing, forecasting"],
      ["14", "Luna", "HR & People - team culture, process optimization, training"],
    ];
    drawTableRow(["ID", "Name", "Role"], [25, 100, 390], true);
    for (const p of personas) drawTableRow(p, [25, 100, 390]);

    y -= 8;
    drawText("Each persona features unique brand voice, expert rules, operating loops, per-agent reasoning config, and Personality Files (SOUL.md, STYLE.md, USER.md, RULES.md, CONTEXT.md).");

    // === SECTION 3: AI PROVIDERS ===
    drawHeading("Section 3: AI Providers (8+ Connected)");
    const providers = [
      ["OpenAI", "GPT-5.4, GPT-4.1, GPT-4.1 Mini, GPT-5 Mini, o4-mini"],
      ["Anthropic", "Claude Opus 4.6, Sonnet 4.6, Opus 4, Sonnet 4"],
      ["Google Gemini", "Gemini 3.1 Pro, 3 Pro, 3 Flash, 2.5 Flash"],
      ["xAI", "Grok 4, Grok 3, Grok 3 Mini"],
      ["OpenRouter (14)", "GLM-5/Turbo/4.7/Flash/4.5V, Nemotron 3 Super, Qwen 3.5 Plus/122B"],
      ["OpenRouter (cont)", "Kimi K2.5, MiniMax M2.7, Mistral Large 3, DeepSeek R1, Llama 4"],
      ["Perplexity", "Sonar Pro, Sonar, Sonar Reasoning Pro, Deep Research"],
      ["Claude Runner", "All Anthropic models via CLI bridge (optional)"],
    ];
    drawTableRow(["Provider", "Models"], [110, 400], true);
    for (const p of providers) drawTableRow(p, [110, 400]);

    y -= 8;
    drawSubheading("Claude Runner Bridge");
    drawBullet("Local OpenAI-compatible bridge on port 7779 spawning Claude Code CLI");
    drawBullet("All Anthropic requests auto-routed through CLI when bridge healthy");
    drawBullet("With Anthropic Pro/Max plan: uses your subscription quota (rolling window). With API key: per-token billing");
    drawBullet("Env sanitization (allowlist), health degradation, 2-min timeout, graceful fallback");
    drawBullet("Status: GET /api/admin/claude-runner");

    y -= 8;
    drawSubheading("Subscription-First Routing (BYOS)");
    const byosItems = [
      "OAuth subscription tokens (ChatGPT Plus, Google Gemini) used as PRIMARY inference source",
      "GPT-5.4 is the primary OAuth model (maps to OpenAI GPT-4.1 via subscription)",
      "Replit-provider models correctly matched against OpenAI OAuth via mapReplitToOpenAI()",
      "OpenAI OAuth with PKCE - code-paste flow with STS token exchange",
      "Google OAuth with PKCE - redirect flow with generative-language scope",
      "Tiered failover TTLs: 429 rate limit = 2-min cooldown, 401/403 auth = 10-min cooldown",
      "Automatic API key fallback when subscription quota exhausted",
      "YouTube OAuth - Web Application flow with PKCE for YouTube Data API v3",
      "Token refresh loop every 45 minutes for all active subscriptions",
    ];
    for (const item of byosItems) drawBullet(item);

    y -= 4;
    drawSubheading("OAuth-First Tier Routing");
    const tierRouting = [
      "Fast: Gemini 2.5 Flash > Gemini 3 Flash > GPT-4.1 Mini > GLM-4.7 Flash",
      "Balanced: GPT-5.4 (OAuth) > Gemini 3 Flash > Gemini 2.5 Flash > GLM-5 Turbo",
      "Powerful: GPT-5.4 (OAuth) > Gemini 3.1 Pro > Gemini 3 Pro > GLM-5 > Nemotron 3 Super",
      "Reasoning: GPT-5.4 (OAuth) > Gemini 3.1 Pro > DeepSeek R1 > Qwen 3.5 Plus",
    ];
    for (const item of tierRouting) drawBullet(item);

    y -= 4;
    drawSubheading("Smart Model Auto-Selection");
    const autoSelect = [
      "10-category auto-router: simple-chat, general, writing, coding, reasoning, research, etc.",
      "Cost-Aware Auto-Routing: every model tagged with costClass (free/cheap/paid)",
      "Auto-router sorts by cost for ALL complexity levels, not just simple tasks",
      "Dynamic Cost Classification: Anthropic models = free when Runner up, paid when down",
      "High-complexity coding auto-routes to Claude Opus 4.6 / Gemini 3.1 Pro",
      "Multimodal-Aware Routing - detects images/files, routes to vision models (GLM-4.5V, Gemini)",
      "Auto-Thinking Mode - enables extended thinking for complex queries",
      "Persona Cost Tier Integration - respects per-persona cost budgets",
      "Adaptive Model Upgrade/Downgrade - per-round complexity assessment in tool loops",
      "Failover Cascade: Claude Runner > OAuth subscription > API keys > Replit built-in",
    ];
    for (const item of autoSelect) drawBullet(item);

    drawSubheading("Cost Class Distribution");
    drawTableRow(["Cost Class", "Count", "Routing Priority"], [80, 50, 380], true);
    drawTableRow(["Free", "15", "Always tried first (Runner, Replit OpenAI, Gemini Integration)"], [80, 50, 380]);
    drawTableRow(["Cheap", "12", "Tried after free exhausted (OpenRouter models)"], [80, 50, 380]);
    drawTableRow(["Paid", "10", "Last resort only (xAI, Perplexity, premium OpenRouter)"], [80, 50, 380]);
    y -= 4;
    drawBullet("Three Subscription-Quota Channels: Claude Runner (Anthropic plan), Replit OpenAI Integration (Replit credits), Google Gemini Integration (Gemini plan)");
    drawBullet("Free models cover fast, balanced, powerful, and reasoning tiers");
    drawBullet("Paid APIs only used when no free model can handle the specific task category");

    // === SECTION 4: AUTONOMOUS OPERATIONS ===
    drawHeading("Section 4: Autonomous Operations");
    drawSubheading("Heartbeat Engine");
    drawBullet("Background task scheduler (active: 60s, idle: 5m cycles)");
    drawBullet("Processes delegations, scheduled tasks, health checks");
    drawBullet("Automatic restart on failure via health monitor");

    drawSubheading("Felix Approval Gate");
    drawBullet("All delegation tasks created with enabled=false, approval_status='pending'");
    drawBullet("Tasks must be approved via UI or API before execution");
    drawBullet("Prevents runaway autonomous actions");

    drawSubheading("Human-in-the-Loop (HITL)");
    drawBullet("Confirmation gate for high-risk actions");
    drawBullet("Actions classified by risk level (low/medium/high/critical)");
    drawBullet("Timeout-based escalation for pending approvals");

    // === SECTION 5: AGENTIC INFRASTRUCTURE ===
    drawHeading("Section 5: Agentic Infrastructure");
    drawSubheading("Agent Desks & Channels");
    drawBullet("Persistent workspace per persona with desk state, notes, priority queue");
    drawBullet("Cross-persona communication via named channels");
    drawBullet("Publish/subscribe Event Bus with event log and retention");

    drawSubheading("Autonomy Rules");
    drawBullet("Four levels: full_auto, notify_after, approve_before, blocked");
    drawBullet("Per-tenant configurable, audit log for all decisions");

    drawSubheading("Outcome Tracking & Watchlist");
    drawBullet("Pattern recognition on action results, success/failure tracking");
    drawBullet("Proactive alerting on watched metrics with configurable thresholds");

    // === SECTION 6: PROCESS GOVERNOR ===
    drawHeading("Section 6: Process Governor");
    drawBullet("40-rule governance engine across 7 categories (incl. agency_expansion)");
    drawBullet("25 condition evaluators including 9 live evaluator-backed conditions");
    drawBullet("Emergency Kill Switch for immediate shutdown");
    drawBullet("Governance Frameworks: NIST, OWASP, Singapore IMDA");
    drawBullet("Automated Framework Review (quarterly)");
    drawBullet("Rules #32-#40 tie agency evaluators to automated responses");
    drawBullet("Tiered escalation with multi-channel notification and audit trail");

    // === SECTION 7: INTELLIGENCE & MEMORY ===
    drawHeading("Section 7: Intelligence & Memory");
    drawSubheading("Three-Tier Semantic Memory");
    drawBullet("Facts - user preferences, learned information, contextual data");
    drawBullet("Notes - daily observations, interaction summaries");
    drawBullet("Vector Knowledge Base - semantic search across agent knowledge");

    drawSubheading("Document Search");
    drawBullet("BM25 text search, vector similarity via pgvector, hybrid search");
    drawBullet("HNSW indexes for fast approximate nearest neighbor queries");

    drawSubheading("Zero-Loss Compaction");
    drawBullet("Archives FULL transcript to compaction_archives table before summarizing");
    drawBullet("Local file backup as secondary archive");
    drawBullet("SAFETY GATE: compaction aborts if archive save fails");

    drawSubheading("Cross-Persona Vector Knowledge Library");
    drawBullet("Research findings auto-embedded with text-embedding-3-small (1536 dims) at injection time");
    drawBullet("pgvector HNSW indexes for fast similarity search across all agent knowledge");
    drawBullet("Cross-persona retrieval: any agent can pull findings from any domain via semantic similarity");
    drawBullet("2000-char knowledge budget: persona-specific entries ranked first, cross-domain fills remaining");
    drawBullet("30-second embedding cache (max 50 entries) prevents duplicate API calls per request");
    drawBullet("Startup backfill auto-generates embeddings for existing findings without vectors");

    drawSubheading("OAuth-First Smart Model Routing");
    drawBullet("3-pass priority: OAuth/Claude Runner first, direct API keys second, Replit proxy last");
    drawBullet("Google OAuth (Gemini 3.1 Pro, 3 Flash) and OpenAI OAuth (GPT-4.1, o4-mini) prioritized");
    drawBullet("Claude Runner bridge routes Anthropic models through CLI using your plan quota (no per-token API billing)");
    drawBullet("OpenRouter models (DeepSeek, Qwen, Llama, etc.) used only as last-resort fallback");
    drawBullet("Auto-route logging with 60-second per-tier dedup to prevent log spam");
    drawBullet("Research programs auto-corrected on startup if assigned model doesn't exist");

    // === SECTION 8: DATA PROTECTION ===
    drawHeading("Section 8: Data Protection System");
    drawSubheading("Soft-Delete for Conversations");
    drawBullet("Deleted conversations marked with deleted_at timestamp");
    drawBullet("30-day recovery window before permanent deletion");
    drawBullet("Viewable at /api/conversations/trash, recoverable via POST /api/conversations/:id/recover");

    drawSubheading("Message Save Verification");
    drawBullet("User message must persist to database before AI responds");
    drawBullet("If DB write fails, request rejected with clear error");

    drawSubheading("Google Drive Backup");
    drawBullet("Per-tenant backup to organized Drive folders");
    drawBullet("Includes conversations (with archives), memories, knowledge, projects");
    drawBullet("Admin endpoints for full tenant backup and expired purge");

    // === SECTION 9: DESIGN PATTERNS ===
    drawHeading("Section 9: Agentic Design Patterns (Book-Inspired)");
    const patterns = [
      ["1. Parallel Tool Execution", "Read-only tools run concurrently via Promise.all, mutating tools sequential"],
      ["2. Critique Agent / Self-Correction", "Auto-evaluates on accuracy, completeness, relevance, clarity; refines below threshold"],
      ["3. Chain of Debates", "Convenes 3-6 specialist personas, synthesizes recommendation with consensus level"],
      ["4. Tree-of-Thought Reasoning", "Generates 2-5 reasoning branches, scores each, selects or synthesizes best"],
      ["5. Proactive Resource Prediction", "Estimates token usage, API costs, execution time, risk level before execution"],
      ["6. Adaptive Model Downgrade", "Per-round complexity check, downgrades to cheaper tier when simple"],
    ];
    for (const [name, desc] of patterns) {
      drawSubheading(name);
      drawText(desc, 10);
    }

    // === SECTION 10: TOOLS ===
    drawHeading("Section 10: 89+ AI Tools");
    const toolCategories = [
      ["Communication", "Email (AgentMail), WhatsApp, Discord, Telegram, channel messaging"],
      ["Research", "Web search, Firecrawl extraction, Jina AI reader, deep research sessions"],
      ["Finance", "Market news (10+ sources), stock price (A-Share/HK), ticker search, market overview"],
      ["Documents", "PDF generation, Google Drive upload, file management, data export"],
      ["Code", "Code execution, debugging, architecture review"],
      ["Virtual Browser", "Browserless headless Chrome, screenshots, form fill, vision, multi-page workflows"],
      ["Agentic", "Desk mgmt, event emission, delegation, watchlist, orchestration, autonomy rules"],
      ["Google Workspace", "Drive file management, document creation"],
      ["System", "Health monitoring, usage tracking, model routing, dashboard generation"],
    ];
    drawTableRow(["Category", "Tools"], [110, 400], true);
    for (const tc of toolCategories) drawTableRow(tc, [110, 400]);

    y -= 8;
    drawSubheading("Finance Market Intelligence (server/finance-tools.ts)");
    drawBullet("4 tools: finance_news, finance_stock_price, finance_stock_search, finance_market_overview");
    drawBullet("Free APIs (NewsNow, EastMoney Direct) - no API keys required");
    drawBullet("Mapped to Cassandra (primary) and Radar via tool router");
    drawBullet("Rate limited: news 3/min 15/hr, stock tools 5/min 30/hr");

    drawSubheading("Per-Tool Rate Limiter (server/tool-rate-limiter.ts)");
    drawBullet("Sliding-window per tenant per tool. Prevents runaway agent loops");
    drawBullet("Expensive tools: deep_research 1/min, produce_video 1/min, browser 2/min");
    drawBullet("Actionable error messages with retry timing");

    // === SECTION 11: OPENCLAW FEATURES ===
    drawHeading("Section 11: OpenClaw-Inspired Features");
    const openclawItems = [
      "MCP Client Support - Model Context Protocol integration",
      "Webhook Triggers - external event webhooks with retry logic",
      "Channel Routing - rule-based message routing between personas",
      "Skills Marketplace - installable skill packages with versioning",
      "Live Canvas - rendered HTML components from agent responses in sandboxed iframes",
      "Personality Files - per-tenant SOUL/STYLE/USER/RULES/CONTEXT customization",
      "Firecrawl Search - web search returning clean LLM-ready markdown",
      "Per-Agent Reasoning Config - custom model, thinking level, token limits per persona",
      "Smart Error Classification - transient vs permanent failure detection",
    ];
    for (const item of openclawItems) drawBullet(item);

    // === SECTION 12: COMMUNICATION ===
    drawHeading("Section 12: Communication & Marketing");
    drawBullet("AgentMail - corporate email inbox, send/receive emails with attachments");
    drawBullet("WhatsApp Integration - Baileys library, QR pairing, approval whitelist");
    drawBullet("Discord Bot - Discord.js, server messaging, command processing");
    drawBullet("Telegram Bot - grammy framework, pairing/approval, admin-only management");
    drawBullet("Social Marketing - content generation, multi-platform adaptation");

    // === SECTION 13: BROWSER & WEB ===
    drawHeading("Section 13: Virtual Browser & Web");
    drawBullet("Puppeteer-core with Browserless cloud-based headless Chrome API");
    drawBullet("Agent tools: browse_web (navigate + screenshot), browser_action (click, type, scroll, JS)");
    drawBullet("Multi-page workflows - navigate, interact with forms, extract data across pages");
    drawBullet("Vision-enabled: screenshots passed as base64 to vision-capable LLMs (GPT-4o, Claude 3.5)");
    drawBullet("SSRF protection - DNS-based URL validation blocks internal/private IP navigation");
    drawBullet("Tenant isolation - isolated browser contexts and cookie storage per tenant");
    drawBullet("Credential Vault with encrypted login storage per tenant");

    // === SECTION 13B: YOUTUBE INTEGRATION ===
    drawHeading("Section 13B: YouTube Integration");
    drawBullet("YouTube OAuth - Web application flow with PKCE for YouTube Data API v3");
    drawBullet("Channel management - upload videos, read analytics, manage comments, view subscribers");
    drawBullet("Token auto-refresh via OAUTH_PROVIDERS config (45-min refresh loop)");
    drawBullet("Scopes: youtube, youtube.upload, youtube.readonly, youtubepartner");
    drawBullet("Stored as provider='youtube' in oauth_subscriptions table");
    drawBullet("Status endpoint returns channel name, subscriber count, video count");

    // === SECTION 14: CHAT UX ===
    drawHeading("Section 14: Chat User Experience");
    drawSubheading("Streaming & Control");
    drawBullet("Smart Auto-Scroll - only scrolls when user is near bottom; respects scroll position during streaming");
    drawBullet("Scroll-to-Bottom button - floating pill button visible during streaming and idle states");
    drawBullet("Stop Generating - one-click abort of AI response mid-stream with clean state reset");
    drawBullet("Regenerate Response - retry last response with preserved file/image attachments");

    drawSubheading("Keyboard Shortcuts");
    drawBullet("Ctrl/Cmd+N - create new chat from any page");
    drawBullet("Escape - stop generation (streaming) or clear input (idle)");
    drawBullet("Shift+Enter - newline in message input");
    drawBullet("Shortcut hints displayed below input area");

    drawSubheading("Rich Content");
    drawBullet("Inline charts (Bar, Line, Pie, Area) rendered from AI responses via Recharts");
    drawBullet("Live Canvas - sandboxed HTML rendering from agent responses");
    drawBullet("Markdown with syntax-highlighted code blocks and copy buttons");
    drawBullet("Thinking/Reasoning blocks - toggleable AI reasoning traces");
    drawBullet("Tool Call display - live execution status with expandable details");
    drawBullet("Orchestration Plan Cards - visual progress for multi-step CEO Orchestrator plans");

    drawSubheading("Voice & Multi-Modal");
    drawBullet("Speech-to-text voice recording with live transcript preview");
    drawBullet("Text-to-speech playback on any assistant message (Google TTS)");
    drawBullet("Talk Mode - continuous hands-free voice conversation");
    drawBullet("Camera capture for mobile/desktop image input");
    drawBullet("Multi-modal input: drag-and-drop files, image paste, camera capture");
    drawBullet("Model badge showing auto-selected AI model per response");
    drawBullet("ObjectURL memory management - preview URLs properly revoked to prevent leaks");

    drawSubheading("ElevenLabs Voice AI");
    drawBullet("Creator plan - 110,000 characters/month, 23 premium voices");
    drawBullet("Text-to-Speech via eleven_flash_v2_5 model");
    drawBullet("Speech-to-Text via scribe_v1 model for audio transcription");
    drawBullet("Configurable per-tenant via TTS config settings");

    // === SECTION 14B: PLATFORM CAPABILITIES BRIEFING ===
    drawHeading("Section 14B: Platform Capabilities Briefing");
    drawBullet("Auto-injected into every persona's system prompt via buildPlatformCapabilities()");
    drawBullet("Enumerates all configured API keys and OAuth subscriptions");
    drawBullet("Lists server capabilities: FFmpeg, pgvector, Node.js, Object Storage, Chromium");
    drawBullet("Shows connected services: Google Drive, AgentMail, YouTube, Telegram, Discord");
    drawBullet("Categorizes all 89+ tools with descriptions");
    drawBullet("Lists all available AI models grouped by provider");
    drawBullet("5-minute cache to avoid regeneration overhead");
    drawBullet("Prevents personas from asking users to set up already-configured services");

    // === SECTION 14C: AGENT SKILLS SYSTEM ===
    drawHeading("Section 14C: Agent Skills System (23 Active)");
    drawText("Skills are injected into agent system prompts via the ## ACTIVE SKILLS block. Each skill teaches agents exactly which tools to use, in what order, with what parameters for specific business domains. Skills with personaId=null load for every persona.");
    y -= 6;

    drawSubheading("Business Operations Skills (8 skills)");
    const bizSkills = [
      ["Document & Delivery", "create_pdf -> Drive -> send_email, deliver_product one-step delivery"],
      ["Research & Intel", "deep_research, firecrawl, competitor analysis, due diligence, trends"],
      ["Project Management", "Project lifecycle, delegation, milestones, orchestration"],
      ["Financial Analysis", "Revenue, budgets, cash flow, ROI, pricing, financial reports"],
      ["Content Marketing", "Brand voice, content calendars, social media, email marketing, KPIs"],
      ["Legal & Compliance", "Contracts, ToS/privacy, compliance checklists, contract review"],
      ["Sales & Client", "Prospecting, outreach, proposals, deal tracking, onboarding"],
      ["Business Ops", "Business Model Canvas, SWOT, OKR, SOPs, KPI dashboards, hiring"],
    ];
    drawTableRow(["Skill", "What It Teaches"], [130, 380], true);
    for (const s of bizSkills) drawTableRow(s, [130, 380]);

    y -= 6;
    drawSubheading("Platform Skills (15 skills)");
    drawBullet("Reasoning & Logic, Code Generation, Web Research, Writing & Editing, Data Analysis");
    drawBullet("Email Drafting, Math & Calculations, Summarization, Homepage Audit, Small Business AI");
    drawBullet("De-AI-ify Text, Content Idea Generator, AI Discoverability Audit, Morning Briefing, Self-Diagnostics");

    y -= 6;
    drawSubheading("Governance-Wired Scaffolding");
    drawBullet("All 65 operation scaffolds now include inline governance rules in every prompt");
    drawBullet("Trust score checks, never-auto action enforcement, express lane awareness");
    drawBullet("PAB verification, blocker escalation protocol, autonomy level thresholds");
    drawBullet("Felix delegation context includes full governance rules for routing decisions");
    drawBullet("Cross-department workflows carry governance for multi-agent coordination");

    // === SECTION 15: PAYMENTS ===
    drawHeading("Section 15: Payments & Billing");
    drawBullet("Stripe - subscriptions, Connect, BYOK tier, webhook handling");
    drawBullet("Coinbase - CDP SDK, Commerce API, crypto payments, multi-currency");
    drawBullet("Usage Metering - per-tenant message, conversation, tool call tracking");

    // === SECTION 16: FILE & STORAGE ===
    drawHeading("Section 16: File & Storage");
    drawBullet("Secure Tenant File Storage via Replit Object Storage");
    drawBullet("File Manager UI with upload, download, delete, preview");
    drawBullet("Google Drive Integration - organized folders, shareable links");
    drawBullet("PDF Toolkit - generation, report export, templates");

    // === SECTION 17: STABILITY ===
    drawHeading("Section 17: Stability & Monitoring");
    drawSubheading("Stability Watchdog (Chief of Staff)");
    drawBullet("Runs every 10 minutes with zero AI credit cost");
    drawBullet("Auto-kills stuck tasks (8min), auto-disables flaky tasks (4 errors/2h)");
    drawBullet("Heartbeat restart, memory pressure management, stale data cleanup");
    drawBullet("Pool health monitoring, reports to operations channel");

    drawSubheading("Health Monitor");
    drawBullet("6-check health system every 5 minutes");
    drawBullet("DB connectivity, API availability, memory, heartbeat, watchdog status");

    drawSubheading("Self-Healing Port Management");
    drawBullet("Express server (port 5000): auto-detects EADDRINUSE, kills stale processes, retries 3x");
    drawBullet("Claude Runner bridge (port 7779): same pattern with escalating wait times (500ms/1s/1.5s)");
    drawBullet("Process safety: never kills own PID; SIGKILL for Express, SIGTERM for Runner");
    drawBullet("Zero manual intervention - eliminates most common restart failure (port conflicts)");

    // === SECTION 18: SECURITY ===
    drawHeading("Section 18: Security");
    drawBullet("IronClaw-inspired SafetyLayer - 17 secret patterns, PolicyEngine, injection protection");
    drawBullet("Helmet CSP headers for content security");
    drawBullet("Provider Key Proxy for centralized API key management with encryption");
    drawBullet("Multi-auth: Replit Auth, Email/Password, Admin PIN (HMAC-SHA256 with salt)");
    drawBullet("Timing-safe cryptography, DB-persisted password reset tokens");
    drawBullet("Multi-tenant data isolation on all queries, parameterized SQL everywhere");
    drawBullet("Atomic trust updates - CTE-based SQL prevents race conditions");
    drawBullet("Never-auto actions: payment, destructive, kill-switch always require human approval");
    drawBullet("SSRF protection - DNS-based URL validation blocks private IP browser navigation");
    drawBullet("Claude Runner env sanitization - only allowlisted vars passed to CLI subprocess");
    drawBullet("GitHub secret scanner - pre-push blocks commits with 10+ secret patterns");
    drawBullet("Context window guard - archive-before-condense preserves full history");
    drawBullet("Soft account deletion with recovery");

    // === SECTION 19: AGENCY EXPANSION FRAMEWORK ===
    drawHeading("Section 19: Agency Expansion Framework (6 Tiers)");

    drawSubheading("Tier 1: Real-Time Evaluators (server/evaluators.ts)");
    drawBullet("9 evaluators: daily_spend, pii_exposure, agent_spend_ratio, failover_rate, purpose_drift");
    drawBullet("  auth_failures, desk_queue, content_pipeline, tool_boundary_violations");
    drawBullet("Each exposes live metrics; feeds governance rules #32-#40 automatically");
    drawBullet("Snapshot storage in evaluator_snapshots table for historical trending");

    drawSubheading("Tier 2: Trust Score Engine (server/trust-engine.ts)");
    drawBullet("9 trust categories: task_execution, communication, resource_management, security_compliance");
    drawBullet("  learning_adaptation, proactive_initiative, collaboration, decision_quality, user_satisfaction");
    drawBullet("40 scores across 13 agents; starting scores seeded from autonomy level");
    drawBullet("Hysteresis: rises by 1-5 pts (positive events), drops by 3-15 pts (negative events)");
    drawBullet("Autonomy levels: restricted (<20), supervised (20-39), assisted (40-59), autonomous (60-79), trusted (80+)");
    drawBullet("Never-auto actions: payment, destructive, kill-switch always require human approval");
    drawBullet("Atomic CTE-based SQL updates prevent concurrent race conditions");

    drawSubheading("Tier 3: Proactive Initiative Engine (server/proactive-engine.ts)");
    drawBullet("Proactive Action Budget (PAB): daily limits by trust level (restricted=0, trusted=12)");
    drawBullet("32 triggers across 9 personas (VisionClaw, Felix, Forge, Blueprint, Cassandra, Radar, etc.)");
    drawBullet("Action types: scan (1 PAB), suggest (2), create_draft (3), alert (1), execute (5)");
    drawBullet("Quality tracking: accept/reject/ignore with trust score feedback loop");

    drawSubheading("Tier 4: Express Lanes (server/express-lanes.ts)");
    drawBullet("12 agent-to-agent direct handoff routes (e.g., VisionClaw->Felix, Forge->Proof)");
    drawBullet("Eligibility: sender trust >= 60 in task_execution category");
    drawBullet("Volume caps: 10 handoffs/day/lane, auto-suspend after 3 consecutive failures");
    drawBullet("Felix notified of all express lane handoffs for oversight");

    drawSubheading("Tier 5: Environmental Awareness (server/environmental-awareness.ts)");
    drawBullet("8 scan types: market, competitor, technology, regulatory, internal, security, user_behavior, resource");
    drawBullet("Signal classification: NOISE -> INFO -> NOTABLE -> IMPORTANT -> URGENT -> CRITICAL");
    drawBullet("Routing matrix maps signal types to responsible personas");

    drawSubheading("Tier 6: Collective Intelligence (server/collective-intelligence.ts)");
    drawBullet("5 decision protocols: individual, specialist_critique, chain_of_debates, tree_of_thought, full_council");
    drawBullet("Complexity classifier auto-selects protocol based on impact/urgency/reversibility");
    drawBullet("Token budget controls prevent runaway costs during multi-agent deliberation");

    // === SECTION 19B: INTELLIGENCE LOOP ===
    drawHeading("Section 19B: Auto-Deposit Intelligence Loop");
    drawSubheading("Automatic Research-to-Knowledge Pipeline");
    drawBullet("Every completed research session auto-deposits findings into the correct project AND knowledge base");
    drawBullet("Routing map: Programs are mapped to project folders for organized knowledge deposit");
    drawBullet("Each kept finding (score >= 6) becomes its own agent_knowledge entry with category metadata");
    drawBullet("Session summary deposited as project note for long-term project context");
    drawBullet("Immediate vector embedding generation (text-embedding-3-small) at deposit time");
    drawBullet("Findings become instantly searchable via semantic similarity by ALL personas");
    drawBullet("System gets measurably smarter with every completed research session");

    drawSubheading("Weekly Research Schedule");
    drawBullet("Programs can be configured to run on a weekly schedule, staggered 15 minutes apart");
    drawBullet("Nightly platform programs (5 programs) continue running at 2:00 AM daily");
    drawBullet("7 total research schedules managed via research_schedules table");

    drawSubheading("Self-Improvement Cycle");
    drawBullet("Nightly: AI scans for new models, tools, security threats, architecture patterns");
    drawBullet("Weekly: Business research covers health psychology, marketing, competitors, legal");
    drawBullet("Auto-inject: Findings land in knowledge base with embeddings for instant retrieval");
    drawBullet("Cross-persona: Any agent answering questions pulls latest research automatically");
    drawBullet("Code proposals: High-scoring findings (>= 8) generate actionable code proposals");
    drawBullet("Closed loop: Research -> Knowledge -> Better Agent Responses -> More Research");

    // === SECTION 20: AUTO-PROJECT DETECTION ===
    drawHeading("Section 20: Auto-Project Detection");
    drawBullet("Automatically creates a project when conversation signals intent to build");
    drawBullet("Trigger: 4+ messages with at least 1 project signal (build, create, launch, design, etc.)");
    drawBullet("Excludes casual patterns: greetings, general questions, single-word messages");
    drawBullet("Atomic CTE-based DB write: project + conversation link in single SQL query");
    drawBullet("In-chat banner notification with project name and navigation link");
    drawBullet("Inline rename on projects page with reactive URL query parameter support");
    drawBullet("Project brain auto-created for continuity tracking");

    // === SECTION 21: DATABASE ===
    drawHeading("Section 21: Database Schema (66 Tables)");
    const tableGroups = [
      ["Core", "tenants, conversations, messages, personas"],
      ["Intelligence", "memory_entries, agent_knowledge, daily_notes, compaction_archives"],
      ["Projects", "projects, project_notes, project_files"],
      ["Heartbeat", "heartbeat_tasks, heartbeat_logs"],
      ["Agentic", "agent_desks, agent_channels, channel_messages, channel_subscriptions"],
      ["Events", "event_log, event_subscriptions"],
      ["Governance", "governance_rules, governance_actions, governance_frameworks"],
      ["Autonomy", "autonomy_rules, autonomy_log"],
      ["Analytics", "action_outcomes, outcome_patterns, watchlist_items, watchlist_alerts"],
      ["Agency", "trust_scores, proactive_actions, express_lane_usage, evaluator_snapshots"],
      ["Research", "research_programs, research_sessions, research_experiments, research_schedules"],
      ["System", "skills, custom_tools, experiments, provider_keys, tenant_provider_keys"],
      ["Config", "mcp_servers, model_registry_updates, personality_files, oauth_subscriptions"],
      ["Payments", "stripe_customers, stripe_subscriptions, stripe_products, stripe_prices"],
    ];
    drawTableRow(["Category", "Tables"], [90, 420], true);
    for (const tg of tableGroups) drawTableRow(tg, [90, 420]);

    // === FOOTER ===
    y -= 30;
    checkSpace(60);
    page.drawLine({ start: { x: MARGIN, y: y + 10 }, end: { x: MAX_X, y: y + 10 }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
    y -= 10;
    page.drawText("PREPARED BY: VisionClaw Agent Platform", { x: MARGIN, y, size: 9, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    y -= 14;
    page.drawText(`COMPANY: ${process.env.SITE_COMPANY_LEGAL || "Platform"}`, { x: MARGIN, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 14;
    page.drawText(`DATE: ${new Date().toISOString()}`, { x: MARGIN, y, size: 9, font: fontMono, color: rgb(0.3, 0.3, 0.3) });
    y -= 14;
    page.drawText(`Copyright ${process.env.SITE_COMPANY_LEGAL || "Platform"}. All Rights Reserved.`, { x: MARGIN, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) });

    const pdfBytes = await doc.save();
    fs.writeFileSync(localPath, pdfBytes);
    console.log(`[pdf] Generated ${fileName} (${pdfBytes.length} bytes, ${doc.getPageCount()} pages)`);

    const result = await uploadToDrive({
      filePath: localPath,
      fileName,
      mimeType: "application/pdf",
      description: `Comprehensive feature report - ${dateStr}`,
      folderLabel: "Platform-Reports",
      share: true,
    });

    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);

    if (result.success) {
      return { success: true, driveUrl: result.shareableLink };
    }
    return { success: false, error: result.error };
  } catch (err: any) {
    console.error("[pdf] Generation failed:", err.message);
    return { success: false, error: err.message };
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("generate-feature-pdf.ts");
if (isMain) {
  generateComprehensiveFeaturePDF().then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  });
}
