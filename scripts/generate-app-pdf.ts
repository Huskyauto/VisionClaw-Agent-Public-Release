import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import fs from "fs";
import path from "path";

const platformTitle = process.env.SITE_PLATFORM_NAME ? `${process.env.SITE_PLATFORM_NAME} Agent` : "VisionClaw Agent";
const MARGIN = 50;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 14;
const HEADING_SIZE = 20;
const SUBHEADING_SIZE = 14;
const BODY_SIZE = 10;
const SMALL_SIZE = 8;

interface PdfState {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  pageNum: number;
  font: PDFFont;
  boldFont: PDFFont;
}

function newPage(state: PdfState): PDFPage {
  const page = state.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  state.page = page;
  state.y = PAGE_HEIGHT - MARGIN;
  state.pageNum++;
  page.drawText(`Page ${state.pageNum}`, {
    x: PAGE_WIDTH - MARGIN - 40,
    y: 20,
    size: 8,
    font: state.font,
    color: rgb(0.5, 0.5, 0.5),
  });
  page.drawText(`${platformTitle} — Confidential`, {
    x: MARGIN,
    y: 20,
    size: 8,
    font: state.font,
    color: rgb(0.5, 0.5, 0.5),
  });
  return page;
}

function ensureSpace(state: PdfState, needed: number) {
  if (state.y < MARGIN + needed) {
    newPage(state);
  }
}

function drawHeading(state: PdfState, text: string, size: number = HEADING_SIZE, color = rgb(0.1, 0.1, 0.4)) {
  ensureSpace(state, size + 10);
  state.y -= size + 6;
  state.page.drawText(text, {
    x: MARGIN,
    y: state.y,
    size,
    font: state.boldFont,
    color,
  });
  state.y -= 8;
}

function drawSubheading(state: PdfState, text: string) {
  drawHeading(state, text, SUBHEADING_SIZE, rgb(0.15, 0.15, 0.5));
}

function drawLine(state: PdfState) {
  ensureSpace(state, 10);
  state.page.drawLine({
    start: { x: MARGIN, y: state.y },
    end: { x: PAGE_WIDTH - MARGIN, y: state.y },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });
  state.y -= 8;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, size);
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function drawParagraph(state: PdfState, text: string, indent: number = 0) {
  const lines = wrapText(text, state.font, BODY_SIZE, CONTENT_WIDTH - indent);
  for (const line of lines) {
    ensureSpace(state, LINE_HEIGHT);
    state.page.drawText(line, {
      x: MARGIN + indent,
      y: state.y,
      size: BODY_SIZE,
      font: state.font,
      color: rgb(0.1, 0.1, 0.1),
    });
    state.y -= LINE_HEIGHT;
  }
  state.y -= 4;
}

function drawBullet(state: PdfState, text: string, indent: number = 10) {
  const lines = wrapText(text, state.font, BODY_SIZE, CONTENT_WIDTH - indent - 12);
  for (let i = 0; i < lines.length; i++) {
    ensureSpace(state, LINE_HEIGHT);
    if (i === 0) {
      state.page.drawText("•", {
        x: MARGIN + indent,
        y: state.y,
        size: BODY_SIZE,
        font: state.boldFont,
        color: rgb(0.3, 0.3, 0.6),
      });
    }
    state.page.drawText(lines[i], {
      x: MARGIN + indent + 12,
      y: state.y,
      size: BODY_SIZE,
      font: state.font,
      color: rgb(0.1, 0.1, 0.1),
    });
    state.y -= LINE_HEIGHT;
  }
}

function drawBoldLabel(state: PdfState, label: string, value: string, indent: number = 10) {
  ensureSpace(state, LINE_HEIGHT);
  const labelWidth = state.boldFont.widthOfTextAtSize(label, BODY_SIZE);
  state.page.drawText(label, {
    x: MARGIN + indent,
    y: state.y,
    size: BODY_SIZE,
    font: state.boldFont,
    color: rgb(0.1, 0.1, 0.1),
  });
  const valueLines = wrapText(value, state.font, BODY_SIZE, CONTENT_WIDTH - indent - labelWidth - 4);
  for (let i = 0; i < valueLines.length; i++) {
    if (i > 0) {
      ensureSpace(state, LINE_HEIGHT);
    }
    state.page.drawText(valueLines[i], {
      x: MARGIN + indent + labelWidth + 4 + (i > 0 ? 10 : 0),
      y: state.y,
      size: BODY_SIZE,
      font: state.font,
      color: rgb(0.2, 0.2, 0.2),
    });
    if (i < valueLines.length - 1) state.y -= LINE_HEIGHT;
  }
  state.y -= LINE_HEIGHT + 2;
}

async function generatePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const siteConfig = (await import("../server/site-config")).siteConfig;
  const pn = siteConfig.platformName;
  const co = siteConfig.companyLegal || siteConfig.companyName || pn;
  doc.setTitle(`${pn} Agent — Complete Platform Documentation`);
  doc.setAuthor(co);
  doc.setSubject(`Comprehensive documentation of the ${pn} Agentic AI Corporation Platform`);
  doc.setCreator(`${pn} Agent`);

  const state: PdfState = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN,
    pageNum: 1,
    font,
    boldFont,
  };

  // ============ COVER PAGE ============
  state.y = PAGE_HEIGHT - 180;
  state.page.drawText(`${pn} Agent`, {
    x: MARGIN,
    y: state.y,
    size: 36,
    font: boldFont,
    color: rgb(0.1, 0.1, 0.4),
  });
  state.y -= 40;
  state.page.drawText("Agentic AI Corporation Platform", {
    x: MARGIN,
    y: state.y,
    size: 22,
    font: boldFont,
    color: rgb(0.3, 0.3, 0.6),
  });
  state.y -= 30;
  state.page.drawText("Complete Platform Documentation", {
    x: MARGIN,
    y: state.y,
    size: 16,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  state.y -= 60;

  drawLine(state);
  state.y -= 10;

  const coverItems = [
    ["Company:", process.env.SITE_COMPANY_LEGAL || "Your Company"],
    ["Platform:", process.env.SITE_WEBSITE_URL || "your-domain.com"],
    ["Version:", "3.1 — March 23, 2026"],
    ["Codebase:", "~80,000 lines of TypeScript across 200+ files"],
    ["Pages:", "38 page components"],
    ["API Endpoints:", "300+"],
    ["Agentic Tools:", "59+"],
    ["AI Providers:", "8 (OpenAI, Anthropic, Google, xAI, Perplexity, OpenRouter, Google Drive, Replit AI)"],
    ["AI Models:", "40+ models with intelligent auto-routing"],
    ["Agent Personas:", "14 specialized AI personas"],
    ["Classification:", `Confidential — ${co} Internal`],
  ];
  for (const [label, value] of coverItems) {
    drawBoldLabel(state, label + " ", value, 20);
  }

  state.page.drawText("Page 1", {
    x: PAGE_WIDTH - MARGIN - 40, y: 20, size: 8, font, color: rgb(0.5, 0.5, 0.5),
  });
  state.page.drawText(`${platformTitle} — Confidential`, {
    x: MARGIN, y: 20, size: 8, font, color: rgb(0.5, 0.5, 0.5),
  });

  // ============ TABLE OF CONTENTS ============
  newPage(state);
  drawHeading(state, "Table of Contents");
  drawLine(state);
  const tocItems = [
    "1. Executive Summary",
    "2. Architecture Overview",
    "3. AI Agent System (14 Personas)",
    "4. Multi-Provider AI Routing",
    "5. Subscription-First Routing & OAuth",
    "6. Intelligent Auto-Select Router",
    "7. Deep Research Engine",
    "8. Agentic Intelligence Engines",
    "9. Autonomous Heartbeat Engine",
    "10. Intelligence & Memory System",
    "11. Agentic Tools (59+)",
    "12. Agentic Design Patterns",
    "13. Communication & Marketing",
    "14. Virtual Browser & Credential Vault",
    "15. Voice Conversations",
    "16. Payments & Billing",
    "17. File & Storage Management",
    "18. Daily Briefing & Weather",
    "19. Security & Authentication",
    "20. Frontend Architecture",
    "21. Backend Architecture",
    "22. Database Schema",
    "23. Model Failover & Resilience",
    "24. Multi-Tenant Architecture",
    "25. Deployment & DevOps",
    "26. Version History",
  ];
  for (const item of tocItems) {
    drawParagraph(state, item, 10);
  }

  // ============ 1. EXECUTIVE SUMMARY ============
  newPage(state);
  drawHeading(state, "1. Executive Summary");
  drawLine(state);
  drawParagraph(state, `${pn} Agent is a self-actualizing AI corporation platform developed by ${co}. It is a full-stack, multi-agent AI assistant platform built with React, TypeScript, Express, and PostgreSQL. The platform features streaming multi-model chat, a 14-persona agent team, autonomous background tasks, semantic memory, agentic tool-calling with sub-agent spawning, voice conversations, email integration, dual payment processing (Stripe + Coinbase crypto), Google Workspace integration, WhatsApp and Discord bot integration, cloud backups, intelligent model cost routing, multi-tenant isolation, and a Karpathy-inspired autonomous Deep Research engine.`);
  state.y -= 6;
  drawParagraph(state, "The platform operates as an autonomous AI corporation where 14 specialized AI personas collaborate under a chain-of-command structure. The CEO (Felix) orchestrates task decomposition, Intelligence (Radar) detects trends and escalates to Deep Research (Neptune), Content (Scribe) drafts and Quality (Proof) reviews, CFO (Cassandra) manages finances, and Legal (Luna) handles compliance — all running autonomously via the heartbeat engine.");
  state.y -= 6;
  drawParagraph(state, "Key differentiators include: subscription-first routing that uses customers' existing OpenAI/Google subscriptions before API keys; zero-loss memory compaction that preserves every fact before summarizing conversations; per-tenant WhatsApp/Coinbase/email isolation; three agentic intelligence engines (Decision, Predictive, Optimization); and an autonomous research system inspired by Andrej Karpathy's vision of AI doing deep work overnight.");

  // ============ 2. ARCHITECTURE ============
  newPage(state);
  drawHeading(state, "2. Architecture Overview");
  drawLine(state);
  drawParagraph(state, `${pn} is a modular monolith — frontend and backend live in one repository, deployed as a single service on Replit. The application serves both the Vite-built frontend and the Express API on a single port (5000).`);
  state.y -= 4;
  drawSubheading(state, "Frontend Stack");
  drawBullet(state, "React 18 + TypeScript with Vite build system");
  drawBullet(state, "TailwindCSS + shadcn/ui component library");
  drawBullet(state, "Wouter for client-side routing (31 page components)");
  drawBullet(state, "TanStack Query v5 for server state management");
  drawBullet(state, "Code splitting with React.lazy() + Suspense");
  drawBullet(state, "Full dark/light mode with localStorage persistence");
  drawBullet(state, "PWA support with service worker for mobile install");

  drawSubheading(state, "Backend Stack");
  drawBullet(state, "Express.js + TypeScript with Helmet security headers");
  drawBullet(state, "Drizzle ORM over PostgreSQL with Zod validation");
  drawBullet(state, "Server-Sent Events (SSE) for real-time AI streaming");
  drawBullet(state, "Multi-tenant session management with DB-backed sessions");
  drawBullet(state, "190+ API endpoints across 6000+ lines of routes");

  drawSubheading(state, "Database");
  drawBullet(state, "PostgreSQL with 40+ tables");
  drawBullet(state, "Drizzle ORM for schema definition in shared/schema.ts");
  drawBullet(state, "Direct SQL migrations via ALTER TABLE (no drizzle-kit push)");
  drawBullet(state, "Vector embeddings stored as text[] arrays for semantic search");

  // ============ 3. AI AGENT SYSTEM ============
  newPage(state);
  drawHeading(state, "3. AI Agent System (14 Personas)");
  drawLine(state);
  drawParagraph(state, "Every AI interaction is shaped by a persona — a structured identity configuration with 8 document fields that compose the system prompt. Each persona has a unique Soul, Operating Loop, Identity, Memory Doc, Heartbeat Doc, Tools Doc, Agents Doc, and Brand Voice Doc.");
  state.y -= 6;

  const personas = [
    [pn, "Personal Assistant", "Default conversational agent for general tasks"],
    ["Felix", "CEO", "Revenue growth, high-leverage execution, task orchestration"],
    ["Forge", "Staff Engineer", "Code quality, reliability, engineering standards"],
    ["Teagan", "Content Marketing", "Content strategy and sharp marketing copy"],
    ["Chief of Staff", "Operations Director", "Task routing and chain of command hub"],
    ["Scribe", "Content Creator", "Blog posts, social media drafts, email content"],
    ["Proof", "Content Reviewer", "Quality gate — approves/revises Scribe's output"],
    ["Radar", "Intelligence Analyst", "Daily surface scans, trend detection, escalation"],
    ["Neptune", "Deep Research", "Complex multi-stage analysis (via Radar escalation)"],
    ["Apollo", "Revenue & Pipeline", "Sales tracking and deal progression"],
    ["Atlas", "Metrics & Reporting", "ROI tracking, cost analysis, dashboards"],
    ["Agent Blueprint", "Multi-Agent Operator", "Agent orchestration and coordination"],
    ["Cassandra", "CFO", "Financial stewardship, P&L, tax strategy, monthly close"],
    ["Luna", "Legal & Compliance", "Contracts, regulatory, privacy, trademark"],
  ];
  for (const [name, role, desc] of personas) {
    drawBoldLabel(state, `${name} (${role}): `, desc);
  }

  state.y -= 6;
  drawSubheading(state, "Chain of Command Rules");
  drawBullet(state, "Neptune only activates via Radar escalation — no direct CEO access");
  drawBullet(state, "Content two-gate rule: Scribe drafts, Proof must review before shipping");
  drawBullet(state, "CEO Orchestrator decomposes complex tasks via the War Room pattern");
  drawBullet(state, "Semantic Tool Router optimizes token usage by dynamically selecting tools");

  // ============ 4. MULTI-PROVIDER AI ROUTING ============
  newPage(state);
  drawHeading(state, "4. Multi-Provider AI Routing");
  drawLine(state);
  drawParagraph(state, `${pn} routes requests across 6+ AI providers with dynamic model discovery, cost tier indicators, and automatic failover. The system maintains a registry of 40+ models with accurate token limits and context window guards.`);
  state.y -= 6;

  const providers = [
    ["OpenAI", "GPT-5.4, GPT-5.1, GPT-5, GPT-5-Mini, GPT-5-Nano, GPT-4o, o4-mini"],
    ["Anthropic", "Claude Opus 4.6, Claude Sonnet 4.6, Claude Sonnet 4"],
    ["Google", "Gemini 3 Pro Preview, Gemini 3 Flash, Gemini 2.5 Pro, Gemini 2.5 Flash"],
    ["xAI", "Grok 4.1, Grok-3, Grok-3-mini"],
    ["Perplexity", "Sonar, Sonar Pro, Sonar Deep Research, Sonar Reasoning Pro"],
    ["OpenRouter", "DeepSeek V3.2, DeepSeek R1, GLM-5, Kimi K2.5, MiniMax M2.5, Qwen 3.5+"],
  ];
  for (const [provider, models] of providers) {
    drawBoldLabel(state, `${provider}: `, models);
  }

  state.y -= 4;
  drawSubheading(state, "Routing Priority Chain");
  drawBullet(state, "1. Subscription OAuth token (OpenAI ChatGPT Plus/Google Gemini Advanced)");
  drawBullet(state, "2. Tenant BYOK (Bring Your Own Key)");
  drawBullet(state, "3. Platform API Key (environment secrets)");
  drawBullet(state, "4. Replit Built-in AI Integrations");

  drawSubheading(state, "Cost Tier System");
  drawBullet(state, "Fast ($): GPT-5-Nano — background scans, metrics, routing tasks");
  drawBullet(state, "Balanced ($$): GPT-5-Mini — revenue analysis, engineering, content");
  drawBullet(state, "Powerful ($$$): Conversation model — strategy, deep reasoning, research");

  // ============ 5. SUBSCRIPTION-FIRST ROUTING ============
  newPage(state);
  drawHeading(state, "5. Subscription-First Routing & OAuth");
  drawLine(state);
  drawParagraph(state, `${pn}'s subscription-first routing allows users to connect their existing OpenAI ChatGPT Plus/Team/Enterprise or Google Gemini Advanced subscriptions to use them for inference instead of API billing. This uses OAuth 2.0 with PKCE (Proof Key for Code Exchange) for secure browser-based authentication.`);
  state.y -= 4;

  drawSubheading(state, "OpenAI OAuth Flow");
  drawBullet(state, `OAuth client: Codex CLI app (${process.env.OPENAI_OAUTH_CLIENT_ID || "your-openai-oauth-client-id"})`);
  drawBullet(state, "Scopes: openid, profile, email, offline_access, model.request, api.model.read");
  drawBullet(state, "STS Exchange: Converts id_token to openai-api-key via RFC 8693 token exchange");
  drawBullet(state, "Tokens encrypted at rest via AES-256-GCM, auto-refreshed before expiry");

  drawSubheading(state, "Google OAuth Flow");
  drawBullet(state, "Uses Replit Google Drive connector for token provisioning");
  drawBullet(state, "Scopes include generative-language for Gemini inference");
  drawBullet(state, "Automatic environment detection (production vs development)");

  drawSubheading(state, "Failure Handling");
  drawBullet(state, "401/403 errors trigger markSubscriptionFailed() with 10-minute TTL cache");
  drawBullet(state, "Failed subscriptions are skipped in subsequent requests until cache expires");
  drawBullet(state, "Automatic failover to next provider in the chain on auth failure");

  // ============ 6. AUTO-SELECT ROUTER ============
  drawHeading(state, "6. Intelligent Auto-Select Router");
  drawLine(state);
  drawParagraph(state, "The auto-routing system classifies each message and routes to the optimal model. It uses fast heuristic pattern matching (<1ms) with LLM fallback for ambiguous messages.");
  state.y -= 4;
  drawBullet(state, "10 task categories: simple-chat, coding, reasoning, research, vision, agentic, writing, translation, data-analysis, general");
  drawBullet(state, "Route decisions streamed as SSE events and displayed as amber badges in UI");
  drawBullet(state, "Meta-model exclusion prevents routing loops");
  drawBullet(state, "Only routes to models the user has configured and available");

  // ============ 7. DEEP RESEARCH ============
  newPage(state);
  drawHeading(state, "7. Deep Research Engine");
  drawLine(state);
  drawParagraph(state, "A Karpathy-inspired autonomous research loop system that runs experiment sessions overnight using cost-efficient AI models. Research programs define objectives, constraints, success metrics, and exploration strategies.");
  state.y -= 4;

  drawSubheading(state, "Autonomous Experiment Loop");
  drawBullet(state, "1. Generate hypothesis based on objective and previous results");
  drawBullet(state, "2. Execute research/analysis using cost-efficient models");
  drawBullet(state, "3. Self-evaluate with quality score (1-10)");
  drawBullet(state, "4. KEEP (score >= 6) or DISCARD (score < 6) the result");
  drawBullet(state, "5. Chain results — each experiment builds on all previous findings");
  drawBullet(state, "6. Repeat every 30 seconds until max experiments or 3 consecutive failures");

  drawSubheading(state, "Features");
  drawBullet(state, "Research Programs with named objectives, constraints, and strategies");
  drawBullet(state, "Three exploration strategies: conservative, balanced, aggressive");
  drawBullet(state, "Batch execution: 'Run All Programs' starts all programs simultaneously");
  drawBullet(state, "Cron-based scheduling with timezone support (nightly, morning, weekly)");
  drawBullet(state, "AI-generated executive summaries with actionable insights");
  drawBullet(state, "Dev-to-production auto-sync on publish (zero manual steps)");

  // ============ 8. AGENTIC INTELLIGENCE ============
  drawHeading(state, "8. Agentic Intelligence Engines");
  drawLine(state);

  drawSubheading(state, "Decision-Making Engine");
  drawParagraph(state, "Autonomous strategic analysis pulling usage stats, research findings, and operational data to generate actionable recommendations across resource allocation, marketing, agent optimization, cost reduction, and growth opportunities. Runs daily at 6am.");

  drawSubheading(state, "Predictive Analytics Engine");
  drawParagraph(state, "Trend forecasting analyzing platform metrics, experiment success rates, and conversation patterns. Identifies market trends, product opportunities, growth forecasts, risk alerts, and competitive insights. Runs weekly Monday 7am.");

  drawSubheading(state, "Process Optimization Engine");
  drawParagraph(state, "Workflow efficiency analyzer examining heartbeat task performance, scheduling patterns, email/social output, and resource utilization. Suggests concrete improvements. Runs daily at 5am.");

  // ============ 9. HEARTBEAT ENGINE ============
  newPage(state);
  drawHeading(state, "9. Autonomous Heartbeat Engine");
  drawLine(state);
  drawParagraph(state, "The heartbeat engine is the autonomous pulse of the platform, checking every 60 seconds for due tasks and executing them. It powers all background operations including backups, self-reflection, agentic engine runs, and custom scheduled tasks.");
  state.y -= 4;
  drawBullet(state, "Tenant-scoped AI call limits with guardrails");
  drawBullet(state, "13 pre-built task templates (Self-Reflection, Daily Briefing, Backup, etc.)");
  drawBullet(state, "Intelligent cost routing: automatically assigns cheapest appropriate model");
  drawBullet(state, "User-friendly scheduling with business-friendly frequencies");
  drawBullet(state, "Full execution history with logs, errors, and delegation tracking");
  drawBullet(state, "Human-in-the-Loop (HITL) confirmation gate for high-risk actions");
  drawBullet(state, "Delegation chain: tasks can spawn sub-tasks to other personas");

  // ============ 10. MEMORY SYSTEM ============
  drawHeading(state, "10. Intelligence & Memory System");
  drawLine(state);

  drawSubheading(state, "Three-Tier Semantic Memory");
  drawBullet(state, "Durable Facts: Long-term preferences, identity, and key information auto-extracted from chat");
  drawBullet(state, "Daily Notes: Temporal logs of events, decisions, and lessons learned");
  drawBullet(state, "Vector Knowledge Base: Embeddings-based RAG for permanent reference documents");

  drawSubheading(state, "Zero-Loss Compaction");
  drawParagraph(state, "Before compacting conversation history, AI extracts and permanently saves key facts/preferences as durable memories. Full pre-compaction transcripts are archived in the compaction_archives table and recoverable via the recall_context tool. Compaction summary token limit is 1200 with expanded preservation rules.");

  drawSubheading(state, "Memory Backup");
  drawBullet(state, "Per-tenant export of all memories (active, archived, superseded)");
  drawBullet(state, `One-click Google Drive backup to ${pn} Backups/Tenant Memory Backups`);
  drawBullet(state, "MMR diversity re-ranking for relevant, non-redundant retrieval");

  // ============ 11. AGENTIC TOOLS ============
  newPage(state);
  drawHeading(state, "11. Agentic Tools (59+)");
  drawLine(state);
  drawParagraph(state, "The AI can invoke 59+ server-side tools with multi-round execution loops (up to 5 rounds per turn). Tool calls stream as real-time SSE events showing name, arguments, and results inline in chat.");
  state.y -= 4;

  const toolCategories = [
    ["System", "test_api_keys, check_system_status, list_models, info, list, kill, killAll"],
    ["Memory", "search_memory, create_memory, update_memory, get_daily_notes, write_daily_note, recall_context"],
    ["Knowledge", "search_knowledge, create_knowledge, doc_search"],
    ["Communication", "send_email, check_inbox, send_whatsapp"],
    ["Browser", "browser (navigate, click, type, screenshot), smart_browse, form_fill, close_session"],
    ["Research", "web_fetch, web_search, deep_research, log_experiment"],
    ["Code", "execute_code (sandboxed JS), exec (shell), show_diff"],
    ["Documents", "analyze_pdf, create_pdf, google_workspace (Gmail, Calendar, Sheets, Docs)"],
    ["Orchestration", "delegate_task, plan_and_execute, orchestrate, sessions_spawn, sessions_send, subagents"],
    ["Agentic Reasoning", "critique_response, debate, tree_of_thought, estimate_cost"],
    ["Marketing", "draft_social_post, compose_social_post, publish_social_post, generate_social_image"],
    ["Visualization", "generate_chart (bar, line, pie, area via Recharts), generate_dashboard"],
    ["Self-Improvement", "create_tool, list_custom_tools, delete_custom_tool, self_reflect"],
    ["Agent Ops", "manage_desk, emit_event, post_to_channel, read_channels, credential_vault"],
    ["Collections", "collection_create, collection_delete, collection_add_doc, collection_search"],
  ];
  for (const [category, tools] of toolCategories) {
    drawBoldLabel(state, `${category}: `, tools);
  }

  // ============ 12. AGENTIC DESIGN PATTERNS ============
  newPage(state);
  drawHeading(state, "12. Agentic Design Patterns");
  drawLine(state);
  drawParagraph(state, `${pn} implements six agentic design patterns inspired by academic research and production AI system engineering, delivering autonomous reasoning, quality assurance, and cost optimization capabilities.`);
  state.y -= 6;

  drawSubheading(state, "1. Parallel Tool Execution");
  drawParagraph(state, "Read-only tools (search_memory, web_search, etc.) execute concurrently via Promise.all for maximum speed. Mutating tools (send_email, browser, exec, etc.) execute sequentially to preserve causal ordering. A SIDE_EFFECT_TOOLS set of 40+ tools ensures correct classification.");

  drawSubheading(state, "2. Critique Agent / Self-Correction Loop");
  drawParagraph(state, "Every response above 100 characters is automatically evaluated across 4 dimensions: accuracy, completeness, relevance, and clarity (each scored 1-10). Responses scoring below 6.0/10 are auto-refined before delivery. Available as the critique_response tool for explicit invocation.");

  drawSubheading(state, "3. Chain of Debates");
  drawParagraph(state, `Multi-persona deliberation system that convenes 3-6 specialist agents to argue complex questions. Each persona provides perspective, key points, recommendation, and confidence from their specialty. ${pn} synthesizes a final recommendation with consensus level (unanimous/strong/moderate/divided). Covers 12 topic categories.`);

  drawSubheading(state, "4. Tree-of-Thought Reasoning");
  drawParagraph(state, "Multi-branch deliberative reasoning engine generating 2-5 distinct analytical approaches for complex questions. A meta-reasoning evaluator scores each branch on logical soundness, completeness, accuracy, and practical value (1-10), then selects or synthesizes the best answer. Reports a confidence gain metric (0-100%). Auto-triggers when thinking level is 'high'. Available as tree_of_thought tool.");

  drawSubheading(state, "5. Proactive Resource Prediction");
  drawParagraph(state, "Pre-execution cost and resource estimation engine with a 27+ model pricing database. Forecasts token usage, API costs ($), execution time, and risk level (low/medium/high) before any multi-step plan runs. Auto-integrated into the plan_and_execute pipeline. Available as estimate_cost tool for on-demand predictions.");

  drawSubheading(state, "6. Adaptive Model Downgrade");
  drawParagraph(state, "Per-round complexity assessment that dynamically switches to cheaper or more powerful models mid-conversation. After each tool-loop round, assessRoundComplexity() classifies the message and maps it to an optimal tier. Downgrades powerful to balanced/fast when context is simple; upgrades back when complexity increases. Only activates on 'auto' model conversations.");

  // ============ 13. COMMUNICATION ============
  newPage(state);
  drawHeading(state, "13. Communication & Marketing");
  drawLine(state);

  drawSubheading(state, "AgentMail Email Integration");
  drawBullet(state, "Auto-provisioned @agentmail.to inboxes for each tenant");
  drawBullet(state, "Full inbox with compose, reply, attachments, and auto-refresh");
  drawBullet(state, "System notifications: welcome, verification, usage warnings, plan changes");

  drawSubheading(state, "WhatsApp Integration");
  drawBullet(state, "Per-tenant WhatsApp Web connections via QR code scanning");
  drawBullet(state, "Dedicated approval channels for Human-in-the-Loop confirmation");
  drawBullet(state, "Auto-reply capability and phone number management");
  drawBullet(state, "Multi-tenant isolation with separate auth stores");

  drawSubheading(state, "Discord Bot");
  drawBullet(state, "Bot control and messaging integration");
  drawBullet(state, "Event hooks for message routing");

  drawSubheading(state, "Social Marketing");
  drawBullet(state, "Tools for drafting social posts and managing content calendars");
  drawBullet(state, "Scribe/Proof two-gate workflow for content quality");

  // ============ 13. BROWSER & VAULT ============
  drawHeading(state, "14. Virtual Browser & Credential Vault");
  drawLine(state);
  drawBullet(state, "Tenant-scoped virtual browser using Puppeteer with session isolation");
  drawBullet(state, "SSRF protection and configurable browser profiles");
  drawBullet(state, "Vision Browsing: screenshots with element mapping for visual LLM interaction");
  drawBullet(state, "Credential Vault: AES-256-GCM encrypted storage for website logins");
  drawBullet(state, "AI auto-login capability for authenticated sites");
  drawBullet(state, "Screenshot management with auto-pruning after 24 hours");

  // ============ 14. VOICE ============
  newPage(state);
  drawHeading(state, "15. Voice Conversations");
  drawLine(state);
  drawBullet(state, "Talk Mode: continuous voice conversation with ElevenLabs TTS/STT");
  drawBullet(state, "Voice Wake: hands-free activation with wake word detection");
  drawBullet(state, "Multi-provider TTS: ElevenLabs, OpenAI TTS, Google Cloud TTS, Edge TTS");
  drawBullet(state, "Speaker toggle in chat for auto-reading responses");
  drawBullet(state, "Camera capture integration for vision-based interactions");

  // ============ 15. PAYMENTS ============
  drawHeading(state, "16. Payments & Billing");
  drawLine(state);

  drawSubheading(state, "Stripe Integration");
  drawBullet(state, "Subscription checkout with 3 tiers: Starter ($29/mo), Pro ($99/mo), Enterprise ($299/mo)");
  drawBullet(state, "Stripe Connect for marketplace payouts");
  drawBullet(state, "Managed and BYOK (Bring Your Own Key) modes");

  drawSubheading(state, "Coinbase Integration");
  drawBullet(state, "Per-tenant CDP Wallet with EVM support");
  drawBullet(state, "Commerce API for crypto payment charges");
  drawBullet(state, "Isolated key management per tenant");

  drawSubheading(state, "Usage Metering");
  drawBullet(state, "Messages/day, tool calls/day, conversations/month tracking");
  drawBullet(state, "Plan-tier enforcement with BYOK tier system for enhanced limits");

  // ============ 16. FILE & STORAGE ============
  drawHeading(state, "17. File & Storage Management");
  drawLine(state);
  drawBullet(state, "Per-tenant isolated file storage via Replit Object Storage");
  drawBullet(state, "File Manager UI with drag-and-drop upload, search, and sort");
  drawBullet(state, "Google Drive integration: auto-upload and sharing to organized subfolders");
  drawBullet(state, "PDF Toolkit: create, analyze, merge, split, compress, and auto-upload PDFs");
  drawBullet(state, "All files/images/deliverables go to Google Drive (local URLs banned)");

  // ============ 17. BRIEFING ============
  newPage(state);
  drawHeading(state, "18. Daily Briefing & Weather");
  drawLine(state);
  drawBullet(state, "AI-powered personalized daily briefings with customizable widgets");
  drawBullet(state, "Server-side IP geolocation via ip-api.com");
  drawBullet(state, "Weather data from Open-Meteo API");
  drawBullet(state, "Text-to-speech option for listening to briefings");
  drawBullet(state, "Tech headlines and self-reflection widgets");

  // ============ 18. SECURITY ============
  drawHeading(state, "19. Security & Authentication");
  drawLine(state);

  drawSubheading(state, "Triple Authentication");
  drawBullet(state, "Replit Auth: social login via Replit account");
  drawBullet(state, "Email + Password: with email verification and password policy enforcement");
  drawBullet(state, "Admin PIN: HMAC-SHA256 with salt, timing-safe comparison");

  drawSubheading(state, "Security Features");
  drawBullet(state, "Provider Key Proxy: two-tier key architecture (platform-owned + BYOK)");
  drawBullet(state, "Content Security Policy (CSP) via Helmet with explicit allowlists");
  drawBullet(state, "AES-256-GCM encryption for all stored API keys and credentials");
  drawBullet(state, "Password reset tokens with DB persistence and auto-cleanup");
  drawBullet(state, "Health monitor with auto-remediation and email alerts");
  drawBullet(state, "Account deletion: soft-delete with 30-day grace period");
  drawBullet(state, "Path traversal protection and SSRF guards");
  drawBullet(state, "Sanitization for external content (XSS prevention)");

  // ============ 19. FRONTEND ============
  newPage(state);
  drawHeading(state, "20. Frontend Architecture");
  drawLine(state);
  drawParagraph(state, "The frontend is a React 18 single-page application with 38 page components, grouped sidebar navigation, and a Command Center dashboard with progressive disclosure.");
  state.y -= 4;

  drawSubheading(state, "Page Components (38)");
  const pages = [
    "Home (Dashboard), Chat, Landing, Login, Signup, Forgot Password, Reset Password",
    "Personas (AI Team), Research, Insights, Memory, Knowledge, Documents",
    "Files, Vault (Saved Logins), Scheduled Tasks, Projects, Analytics",
    "Email, WhatsApp, WhatsApp Approval, Public Chat",
    "Settings, Heartbeat Engine, Payments, Account",
    "Terms of Service, Privacy Policy, Not Found (404)",
  ];
  for (const line of pages) {
    drawBullet(state, line);
  }

  drawSubheading(state, "Key UI Features");
  drawBullet(state, "Streaming chat with Markdown, LaTeX, syntax highlighting, and thinking blocks");
  drawBullet(state, "Inline Recharts visualization (bar, line, pie, area charts in chat)");
  drawBullet(state, "Auto-named conversations with grouped sidebar (Today, Yesterday, This Week)");
  drawBullet(state, "3-step onboarding flow for new users");
  drawBullet(state, "Cookie consent, error boundaries, and full dark mode support");
  drawBullet(state, "PWA install button and service worker for mobile");

  // ============ 20. BACKEND ============
  drawHeading(state, "21. Backend Architecture");
  drawLine(state);
  drawParagraph(state, "The backend is an Express.js server with 50+ server-side modules handling routes, AI providers, tools, integrations, and autonomous engines.");
  state.y -= 4;

  const serverModules = [
    ["routes.ts", "Central routing (8000+ lines, 300+ endpoints)"],
    ["providers.ts", "Model registry (40+ models), API key management, subscription auth"],
    ["model-failover.ts", "Automatic provider switching with tool-support recomputation"],
    ["chat-engine.ts", "System prompt, context management, parallel tool execution, ToT, critique"],
    ["auto-router.ts", "Task classification, model routing, adaptive downgrade"],
    ["heartbeat.ts", "Background task engine (60s tick), cost routing, delegation"],
    ["research-engine.ts", "Autonomous experiment loop orchestration"],
    ["agentic-engines.ts", "Decision, Predictive, and Optimization engines"],
    ["memory-intelligence.ts", "Fact extraction, deduplication, contradiction detection"],
    ["critique-agent.ts", "4-dimension response scoring, auto-refinement"],
    ["debate-engine.ts", "Multi-persona deliberation, consensus synthesis"],
    ["tree-of-thought.ts", "Multi-branch reasoning, meta-evaluation"],
    ["resource-predictor.ts", "Pre-execution cost/time/risk estimation"],
    ["task-planner.ts", "Autonomous plan decomposition, adaptive re-planning"],
    ["ceo-orchestrator.ts", "Persona-based task delegation, War Room pattern"],
    ["tools.ts", "59+ agentic tool definitions and registry"],
    ["browser-tool.ts", "Puppeteer virtual browser with vision capability"],
    ["google-drive.ts", "File upload, sharing, and backup automation"],
    ["crypto.ts", "AES-256-GCM encryption for secrets and keys"],
  ];
  for (const [file, desc] of serverModules) {
    drawBoldLabel(state, `${file}: `, desc);
  }

  // ============ 21. DATABASE ============
  newPage(state);
  drawHeading(state, "22. Database Schema");
  drawLine(state);
  drawParagraph(state, "PostgreSQL with 58+ tables managed via Drizzle ORM. Key tables include:");
  state.y -= 4;

  const tables = [
    ["tenants", "Multi-tenant user accounts with settings and subscription info"],
    ["conversations", "Chat threads with model, persona, and tenant isolation"],
    ["messages", "Individual messages with role, content, metadata, and tool calls"],
    ["personas", "14 agent definitions with 8 document fields each"],
    ["memories", "Three-tier semantic memory (facts, notes, knowledge)"],
    ["heartbeat_tasks", "Scheduled autonomous tasks with cron expressions"],
    ["heartbeat_logs", "Execution history with status, errors, and timing"],
    ["research_programs", "Named research objectives with strategies and constraints"],
    ["research_sessions", "Experiment session tracking with keep/discard/crash counts"],
    ["research_experiments", "Individual experiment results with scores and findings"],
    ["ai_insights", "Agentic engine outputs with priority, status, and data"],
    ["oauth_subscriptions", "Encrypted OAuth tokens for subscription-first routing"],
    ["tenant_provider_keys", "Per-tenant BYOK API key storage (encrypted)"],
    ["compaction_archives", "Full pre-compaction conversation transcripts"],
    ["auth_sessions", "DB-backed session management with timing-safe tokens"],
    ["file_storage", "Per-tenant file metadata with binary data"],
    ["credential_vault", "AES-256-GCM encrypted website login credentials"],
  ];
  for (const [table, desc] of tables) {
    drawBoldLabel(state, `${table}: `, desc);
  }

  // ============ 22. MODEL FAILOVER ============
  drawHeading(state, "23. Model Failover & Resilience");
  drawLine(state);
  drawBullet(state, "Automatic failover when primary model returns 401, 429, 500, 502, 503");
  drawBullet(state, "Finds fallback model from same tier with tool-support recomputation");
  drawBullet(state, "Subscription failure cache: 10-minute TTL prevents repeated auth failures");
  drawBullet(state, "Self-healing tool loop: injects error analysis hints for retry (up to 2 retries)");
  drawBullet(state, "Failover events streamed to UI with model switch indicators");

  // ============ 23. MULTI-TENANT ============
  newPage(state);
  drawHeading(state, "24. Multi-Tenant Architecture");
  drawLine(state);
  drawParagraph(state, "Strict tenant_id isolation across all data, communication channels, API keys, browser sessions, and file storage. Every database query filters by tenant_id to prevent cross-tenant data leaks.");
  state.y -= 4;
  drawBullet(state, "Per-tenant WhatsApp Web connections with dedicated approval channels");
  drawBullet(state, "Per-tenant Coinbase CDP wallets with isolated key management");
  drawBullet(state, "Per-tenant AgentMail email inboxes (@agentmail.to)");
  drawBullet(state, "Per-tenant browser sessions with separate credential vaults");
  drawBullet(state, "Per-tenant file storage with Google Drive folder isolation");
  drawBullet(state, "Per-tenant BYOK API keys with subscription OAuth tokens");
  drawBullet(state, "Tenant-scoped memory, knowledge, and conversation isolation");
  drawBullet(state, "Admin tenant (ID 1) has elevated privileges for system management");

  // ============ 24. DEPLOYMENT ============
  drawHeading(state, "25. Deployment & DevOps");
  drawLine(state);
  drawBullet(state, "Deployed on Replit as a single service (frontend + backend on port 5000)");
  drawBullet(state, `Production URL: ${process.env.SITE_WEBSITE_URL || "your-domain.com"}`);
  drawBullet(state, `GitHub repository: ${process.env.GITHUB_REPO || "your-org/your-repo"}`);
  drawBullet(state, "Three-tier automated backup: Google Drive JSON, memory snapshots (12h), GitHub auto-push");
  drawBullet(state, "Dev-to-production research sync on publish via script/sync-dev-to-prod.ts");
  drawBullet(state, "Health monitor with 5 automated checks and email alerts");

  // ============ 25. VERSION HISTORY ============
  newPage(state);
  drawHeading(state, "26. Version History");
  drawLine(state);

  const versions = [
    ["v3.1 (March 23, 2026)", "Standalone Architecture & Provider Hardening — DB-first API key architecture, AES-256-GCM encrypted key management, OpenRouter SDK integration with required headers, 5-provider failover cascade, hardened seed script, 8/8 providers connected, 80K+ lines"],
    ["v3.0 (March 22, 2026)", "Agentic Design Patterns — Tree-of-Thought reasoning, Proactive Resource Prediction, Adaptive Model Downgrade, Parallel Tool Execution, Critique Agent, Chain of Debates, Virtual Browser with Credential Vault, 59+ tools"],
    ["v2.9 (March 21, 2026)", "Subscription-First Routing & Auth Failover — OAuth scopes fix, 401 failover, subscription failure cache, tenant provider keys, Gemini 3 Pro, tenantId threading"],
    ["v2.8 (March 2026)", "Agentic Intelligence & Auto-Routing — Auto-select router, task planner, code sandbox, deep research pipeline, self-healing tool loop, expanded model registry"],
    ["v2.4 (March 2026)", "Adaptive Execution & Google Drive Pipeline — Error pattern matching, Google Drive auto-upload, adaptive autonomous execution"],
    ["v2.3 (March 2026)", "Lobster Workflows & Security — YAML workflows, approval gates, path traversal protection"],
    ["v2.2 (March 2026)", "Browser, PDF & Shell Tools — Remote browser, PDF analysis, secure shell execution"],
    ["v2.1 (March 2026)", "Voice, Sessions & Content Security — Voice wake, agent sessions, Firecrawl, tool loop detection"],
    ["v2.0 (March 2026)", "Enhanced Agent Capabilities — Thinking mode, tool safety, model failover, 32 tools"],
    ["v1.0 (February 2026)", "Initial Release — Multi-conversation chat, 12 personas, semantic memory, heartbeat engine, Stripe payments, Google Drive backup"],
  ];
  for (const [version, desc] of versions) {
    drawBoldLabel(state, `${version}: `, desc);
  }

  // ============ FINAL PAGE ============
  newPage(state);
  state.y = PAGE_HEIGHT - 250;
  state.page.drawText(`${pn} Agent`, {
    x: MARGIN, y: state.y, size: 28, font: boldFont, color: rgb(0.1, 0.1, 0.4),
  });
  state.y -= 36;
  state.page.drawText("A Self-Actualizing Personal AI Corporation Platform", {
    x: MARGIN, y: state.y, size: 14, font, color: rgb(0.3, 0.3, 0.6),
  });
  state.y -= 50;
  drawLine(state);
  state.y -= 20;

  const finalItems = [
    ["Developed by:", process.env.SITE_COMPANY_LEGAL || "Your Company"],
    ["Website:", process.env.SITE_WEBSITE_URL || "your-domain.com"],
    ["Generated:", new Date().toISOString().split("T")[0]],
    ["Total Pages:", `${state.pageNum}`],
  ];
  for (const [label, value] of finalItems) {
    drawBoldLabel(state, `${label} `, value, 20);
  }

  state.y -= 30;
  state.page.drawText("Built with care on Replit", {
    x: MARGIN + 20, y: state.y, size: 10, font, color: rgb(0.5, 0.5, 0.5),
  });

  // Save
  const pdfBytes = await doc.save();
  const safeName = pn.replace(/[^a-zA-Z0-9]/g, "_");
  const outputPath = path.join(process.cwd(), "uploads", `${safeName}_Agent_Documentation.pdf`);
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, pdfBytes);
  console.log(`PDF generated: ${outputPath} (${pdfBytes.length} bytes, ${state.pageNum} pages)`);
}

generatePdf().catch(console.error);
