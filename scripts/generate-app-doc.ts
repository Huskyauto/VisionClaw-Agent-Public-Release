import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fs from "fs";
import path from "path";

const OUTPUT_PATH = path.join(process.cwd(), "uploads", "VisionClaw_Agent_Complete_Documentation.pdf");

interface Section {
  title: string;
  content: string[];
}

async function generateDocumentation() {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  const PAGE_WIDTH = 612;
  const PAGE_HEIGHT = 792;
  const MARGIN = 60;
  const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
  const LINE_HEIGHT = 14;
  const HEADING_SIZE = 20;
  const SUBHEADING_SIZE = 14;
  const BODY_SIZE = 10;
  const SMALL_SIZE = 8;

  let currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let yPos = PAGE_HEIGHT - MARGIN;

  function ensureSpace(needed: number) {
    if (yPos - needed < MARGIN + 30) {
      currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      yPos = PAGE_HEIGHT - MARGIN;
    }
  }

  function drawText(text: string, opts: { font?: any; size?: number; color?: any; x?: number; maxWidth?: number }) {
    const font = opts.font || helvetica;
    const size = opts.size || BODY_SIZE;
    const color = opts.color || rgb(0.1, 0.1, 0.1);
    const x = opts.x || MARGIN;
    const maxWidth = opts.maxWidth || CONTENT_WIDTH;

    const words = text.split(" ");
    let line = "";
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, size);
      if (width > maxWidth && line) {
        ensureSpace(LINE_HEIGHT);
        currentPage.drawText(line, { x, y: yPos, size, font, color });
        yPos -= LINE_HEIGHT;
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) {
      ensureSpace(LINE_HEIGHT);
      currentPage.drawText(line, { x, y: yPos, size, font, color });
      yPos -= LINE_HEIGHT;
    }
  }

  function drawHeading(text: string, level: number = 1) {
    const size = level === 1 ? HEADING_SIZE : level === 2 ? SUBHEADING_SIZE : 12;
    const font = helveticaBold;
    const color = level === 1 ? rgb(0.08, 0.18, 0.42) : level === 2 ? rgb(0.12, 0.25, 0.50) : rgb(0.15, 0.30, 0.55);
    const spacing = level === 1 ? 30 : level === 2 ? 22 : 16;

    ensureSpace(spacing + size);
    yPos -= (level === 1 ? 14 : 8);

    if (level <= 2) {
      currentPage.drawRectangle({
        x: MARGIN,
        y: yPos - 4,
        width: CONTENT_WIDTH,
        height: 2,
        color: rgb(0.08, 0.45, 0.72),
      });
      yPos -= 10;
    }

    currentPage.drawText(text, { x: MARGIN, y: yPos, size, font, color });
    yPos -= size + 6;
  }

  function drawBullet(text: string, indent: number = 0) {
    const x = MARGIN + 10 + indent;
    const maxWidth = CONTENT_WIDTH - 20 - indent;
    ensureSpace(LINE_HEIGHT);
    currentPage.drawText("\u2022", { x: x - 8, y: yPos, size: BODY_SIZE, font: helvetica, color: rgb(0.08, 0.45, 0.72) });
    drawText(text, { x, maxWidth });
  }

  function drawSubBullet(text: string) {
    drawBullet(text, 15);
  }

  function spacer(px: number = 8) { yPos -= px; }

  // ===================== COVER PAGE =====================
  yPos = PAGE_HEIGHT - 180;
  currentPage.drawRectangle({ x: 0, y: PAGE_HEIGHT - 120, width: PAGE_WIDTH, height: 120, color: rgb(0.08, 0.18, 0.42) });
  currentPage.drawText("VISIONCLAW AGENT", { x: MARGIN, y: PAGE_HEIGHT - 75, size: 32, font: helveticaBold, color: rgb(1, 1, 1) });
  currentPage.drawText("Complete Platform Documentation", { x: MARGIN, y: PAGE_HEIGHT - 100, size: 16, font: helvetica, color: rgb(0.7, 0.8, 0.95) });

  yPos = PAGE_HEIGHT - 200;
  drawText(process.env.SITE_COMPANY_LEGAL || "Platform Documentation", { font: helveticaBold, size: 14, color: rgb(0.08, 0.18, 0.42) });
  spacer(20);
  drawText(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, { font: helveticaOblique, size: 11, color: rgb(0.4, 0.4, 0.4) });
  drawText("Version: Phase 1 Complete (Agentic Infrastructure)", { font: helveticaOblique, size: 11, color: rgb(0.4, 0.4, 0.4) });
  spacer(30);

  currentPage.drawRectangle({ x: MARGIN, y: yPos - 2, width: CONTENT_WIDTH, height: 1, color: rgb(0.8, 0.8, 0.8) });
  yPos -= 20;

  drawText("VisionClaw is an enterprise-grade agentic AI platform that enables businesses to deploy autonomous AI agents for operations, marketing, research, and customer engagement. Built on a multi-tenant architecture with 14 specialized AI personas, a reactive event bus, and 50+ tools, VisionClaw transforms how companies leverage artificial intelligence.", { size: 11 });
  spacer(20);

  drawText("CONFIDENTIAL - Platform Documentation", { font: helveticaBold, size: 9, color: rgb(0.6, 0.2, 0.2) });

  // ===================== TABLE OF CONTENTS =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("Table of Contents", 1);
  spacer(10);

  const tocItems = [
    "1. Platform Overview & Architecture",
    "2. AI Agent System (14 Personas)",
    "3. Autonomous Operations (Heartbeat Engine)",
    "4. Agentic Infrastructure (Phase 1)",
    "5. Deep Research Engine",
    "6. Intelligence Engines (Decision, Prediction, Optimization)",
    "7. Memory & Knowledge System",
    "8. Communication Suite (WhatsApp, Email, Discord)",
    "9. Browser & Web Tools",
    "10. Payments & Billing (Stripe, Coinbase)",
    "11. File Management & Google Drive",
    "12. Security & Authentication",
    "13. Complete Tool Catalog (50+)",
    "14. API Reference (90+ Endpoints)",
    "15. Frontend Pages & Navigation",
    "16. Database Schema",
    "17. External Integrations",
    "18. Deployment & Operations",
  ];
  for (const item of tocItems) {
    drawText(item, { font: helveticaBold, size: 11, color: rgb(0.08, 0.35, 0.65) });
    spacer(4);
  }

  // ===================== SECTION 1: OVERVIEW =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("1. Platform Overview & Architecture", 1);
  spacer(6);

  drawText("VisionClaw Agent is an enterprise-grade, multi-tenant agentic AI platform. It provides businesses with autonomous AI capabilities through a team of 14 specialized AI personas, each with their own identity, skills, and operating procedures.", { size: 11 });
  spacer(12);

  drawHeading("Technology Stack", 2);
  drawBullet("Frontend: React 18, Vite, shadcn/ui, TailwindCSS, Wouter router, TanStack Query v5");
  drawBullet("Backend: Express.js, TypeScript, Drizzle ORM, Zod validation, Helmet security");
  drawBullet("Database: PostgreSQL with vector embeddings for semantic search");
  drawBullet("Real-time: Server-Sent Events (SSE) for streaming AI responses");
  drawBullet("Storage: Replit Object Storage (tenant-isolated), Google Drive integration");
  drawBullet("Authentication: Multi-method (Replit Auth, Email+Password, Admin PIN)");
  drawBullet("Deployment: Single-port architecture (5000) serving both frontend and API");
  spacer(10);

  drawHeading("Multi-Tenant Architecture", 2);
  drawText("Every data operation is scoped by tenantId, ensuring complete isolation between customer accounts. The admin tenant (ID 1) has access to all management features, tenant overview, and system configuration.", { size: 10 });
  spacer(6);
  drawBullet("Tenant registration with email verification and password policy enforcement");
  drawBullet("Plan tiers: Free, Starter, Professional, Enterprise with usage metering");
  drawBullet("BYOK (Bring Your Own Key) support for AI providers, enhancing rate limits");
  drawBullet("Soft-delete account management with 30-day grace period");
  spacer(10);

  drawHeading("Core Design Principles", 2);
  drawBullet("Cost-Conscious: Intelligent model routing minimizes AI token spend");
  drawBullet("Security-First: AES-256-GCM encryption, CSP headers, SSRF protection, timing-safe auth");
  drawBullet("Autonomous: Agents work independently via heartbeat engine and event bus");
  drawBullet("Observable: Full audit trails, heartbeat logs, event logs, usage tracking");

  // ===================== SECTION 2: AI AGENT SYSTEM =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("2. AI Agent System", 1);
  spacer(6);

  drawText("VisionClaw operates with 14 specialized AI personas, each configured with unique system prompts defining their Soul (identity), Operating Loop (workflow), and Brand Voice (communication style).", { size: 10 });
  spacer(10);

  drawHeading("The 14 Personas", 2);
  const personas = [
    ["VisionClaw (ID 1)", "CEO & primary interface. Strategic decision-making, task delegation, and business oversight."],
    ["Felix (ID 2)", "Creative director and content strategist. Marketing campaigns, social media, brand voice."],
    ["Forge (ID 3)", "Lead engineer. Code generation, technical architecture, debugging, and system design."],
    ["Teagan (ID 4)", "Project manager. Sprint planning, task tracking, deadline management."],
    ["Agent Blueprint (ID 5)", "System architect. Platform design, infrastructure planning, scalability."],
    ["Chief of Staff (ID 6)", "Operations manager. Process optimization, team coordination, reporting."],
    ["Scribe (ID 7)", "Documentation specialist. Technical writing, SOPs, knowledge base management."],
    ["Proof (ID 8)", "Quality assurance. Testing, validation, error detection, compliance review."],
    ["Radar (ID 9)", "Intelligence analyst. Market research, competitive analysis, trend monitoring."],
    ["Neptune (ID 10)", "Customer success. Client relations, onboarding, support, retention strategies."],
    ["Apollo (ID 11)", "Sales specialist. Lead generation, pipeline management, deal closing."],
    ["Atlas (ID 12)", "Data analyst. Metrics, analytics, dashboards, performance tracking."],
    ["Cassandra (ID 13)", "Risk manager. Forecasting, risk assessment, contingency planning."],
    ["Luna (ID 14)", "CFO. Financial planning, budgeting, cost analysis, revenue optimization."],
  ];
  for (const [name, desc] of personas) {
    drawBullet(`${name}: ${desc}`);
  }
  spacer(10);

  drawHeading("CEO Orchestrator", 2);
  drawText("The CEO Orchestrator is an LLM-powered system for complex multi-step tasks. When invoked, it creates a 'War Room' that:", { size: 10 });
  spacer(4);
  drawBullet("Decomposes complex requests into subtasks");
  drawBullet("Routes each subtask to the best-suited persona");
  drawBullet("Synthesizes results from multiple agents into a unified response");
  drawBullet("Manages dependencies between parallel and sequential work streams");
  spacer(10);

  drawHeading("Auto Model Router", 2);
  drawText("Intelligent model selection analyzes each message and routes to the optimal AI model:", { size: 10 });
  spacer(4);
  drawBullet("Coding/technical tasks routed to GPT-5 or Claude Opus 4");
  drawBullet("Creative/writing tasks routed to Claude Sonnet 4");
  drawBullet("Research queries routed to Perplexity Sonar");
  drawBullet("Quick/simple questions routed to GPT-5 Mini for cost savings");
  drawBullet("Fallback logic ensures graceful degradation on model failures");

  // ===================== SECTION 3: AUTONOMOUS OPERATIONS =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("3. Autonomous Operations", 1);
  spacer(6);

  drawHeading("Heartbeat Engine", 2);
  drawText("The Heartbeat Engine is VisionClaw's autonomous background task system. It checks every 60 seconds for due tasks and executes them without human intervention.", { size: 10 });
  spacer(6);
  drawBullet("13 pre-built task templates (Self-Reflection, Daily Briefing, Email Check, etc.)");
  drawBullet("Cron-based scheduling with timezone support");
  drawBullet("Per-tenant AI call limits with guardrails to prevent runaway spending");
  drawBullet("Task history with success/error status tracking");
  drawBullet("Skips tasks when no new activity detected since last run");
  spacer(10);

  drawHeading("Human-in-the-Loop (HITL) Confirmation", 2);
  drawText("High-risk AI actions require explicit human approval before execution:", { size: 10 });
  spacer(4);
  drawBullet("Tool risk classification: low, medium, high, critical");
  drawBullet("Frontend approval modal with action details and risk warnings");
  drawBullet("WhatsApp approval channel: receive requests and reply YES/NO from phone");
  drawBullet("10-minute timeout with auto-deny and notification");
  drawBullet("Full audit trail of all approval decisions");
  spacer(10);

  drawHeading("Scheduled Tasks", 2);
  drawBullet("User-friendly frequency selection (daily, weekly, hourly, custom cron)");
  drawBullet("Business-friendly labels ('Every morning at 6am', 'Weekly on Mondays')");
  drawBullet("Task execution history with timestamps and results");
  drawBullet("Pause/resume capability for individual tasks");
  spacer(10);

  drawHeading("Corporation Report", 2);
  drawText("One-click PDF generation that creates a comprehensive report including all persona statuses, performance metrics, and operational data. Reports are automatically uploaded to Google Drive.", { size: 10 });

  // ===================== SECTION 4: AGENTIC INFRASTRUCTURE =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("4. Agentic Infrastructure (Phase 1)", 1);
  spacer(6);

  drawText("Phase 1 introduces three foundational systems that enable agents to coordinate, communicate, and react to business events autonomously.", { size: 10 });
  spacer(10);

  drawHeading("Agent Desks", 2);
  drawText("Each persona has a persistent 'desk' that tracks their current working state:", { size: 10 });
  spacer(4);
  drawBullet("Active Tasks: Currently in-progress work items with priority and status");
  drawBullet("Task Queue: Pending work items waiting to be started");
  drawBullet("Waiting-On: Items blocked waiting for external input or other agents");
  drawBullet("Focus Area: Current area of concentration (e.g., 'Q2 Marketing Campaign')");
  drawBullet("Status Note: Free-form status update visible to other agents");
  drawBullet("Recent Completions: Last 10 completed tasks with timestamps");
  drawText("Desk context is automatically injected into each persona's system prompt, so agents always know their current state when responding.", { size: 10 });
  spacer(10);

  drawHeading("Internal Channels", 2);
  drawText("9 default async communication channels enable inter-agent messaging:", { size: 10 });
  spacer(4);
  drawBullet("#general - Team-wide announcements and updates");
  drawBullet("#content-pipeline - Content creation workflow coordination");
  drawBullet("#revenue-alerts - Sales, payment, and revenue notifications");
  drawBullet("#intelligence - Market research and competitive intelligence");
  drawBullet("#engineering - Technical discussions and deployment updates");
  drawBullet("#customer-success - Customer feedback and support escalations");
  drawBullet("#strategy - High-level strategic planning discussions");
  drawBullet("#operations - Day-to-day operational coordination");
  drawBullet("#alerts - System alerts and critical notifications");
  spacer(4);
  drawText("Features: Per-persona subscriptions, unread tracking, message types (text, alert, update, decision, request), and thread support.", { size: 10 });
  spacer(10);

  drawHeading("Event Bus", 2);
  drawText("Reactive event routing system where agents emit business events that get routed to subscribed personas:", { size: 10 });
  spacer(4);
  drawBullet("Event types: lead.qualified, content.published, deal.closed, task.completed, alert.triggered, and more");
  drawBullet("Subscription-based routing with priority levels");
  drawBullet("Heartbeat processes pending events every tick (60s)");
  drawBullet("Event log with full payload and processing status");
  drawBullet("Stats dashboard showing event volume by type");
  spacer(10);

  drawHeading("Agentic Operations Dashboard", 2);
  drawText("Admin-only monitoring page (/agentic) with three tabs:", { size: 10 });
  spacer(4);
  drawBullet("Agent Desks Tab: Per-persona cards showing active tasks, queue, waiting-on, focus area, and completed today counts");
  drawBullet("Channels Tab: Channel list with subscriber counts, message viewer with persona names and message types");
  drawBullet("Event Bus Tab: Event log table, subscription management view, event stats with top event types");

  // ===================== SECTION 5: DEEP RESEARCH =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("5. Deep Research Engine", 1);
  spacer(6);

  drawText("VisionClaw's Deep Research Engine enables autonomous experiment loops for exploring complex business questions overnight.", { size: 10 });
  spacer(10);

  drawHeading("Research Programs", 2);
  drawBullet("Define named programs with objectives, constraints, and exploration strategies");
  drawBullet("Programs can target specific topics (market analysis, competitor research, etc.)");
  drawBullet("Active/inactive status with batch execution capability");
  spacer(8);

  drawHeading("Autonomous Sessions", 2);
  drawBullet("Start/stop experiment loops using cost-efficient models");
  drawBullet("Run All Programs: One-click batch execution for every active research program");
  drawBullet("Sessions chain experiments, building on previous findings");
  drawBullet("Keep/Discard/Crash tracking for experiment self-evaluation");
  spacer(8);

  drawHeading("Research Scheduling", 2);
  drawBullet("Cron-based scheduling with preset times (nightly, morning, weekly, every 6/12 hours)");
  drawBullet("Timezone support for business-appropriate scheduling");
  drawBullet("Per-program or run-all targeting");
  drawBullet("Heartbeat engine auto-fires sessions when due");
  spacer(8);

  drawHeading("Research Dashboard", 2);
  drawText("The /research page provides four tabs: Programs (create/manage), Sessions (monitor active), All Experiments (browse results), and Schedules (configure timing).", { size: 10 });
  spacer(8);

  drawHeading("Dev-to-Prod Sync", 2);
  drawText("Research conducted in development automatically syncs to production during publishing. The build process exports all research data to a JSON snapshot, which seed.ts imports on production startup.", { size: 10 });

  // ===================== SECTION 6: INTELLIGENCE ENGINES =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("6. Intelligence Engines", 1);
  spacer(6);

  drawHeading("Decision-Making Engine", 2);
  drawText("Autonomous strategic analysis that pulls usage stats, research findings, and operational data to generate actionable recommendations:", { size: 10 });
  spacer(4);
  drawBullet("Resource allocation optimization");
  drawBullet("Marketing strategy recommendations");
  drawBullet("Agent performance optimization");
  drawBullet("Cost reduction opportunities");
  drawBullet("Growth opportunity identification");
  drawText("Runs daily at 6am via heartbeat, with manual 'Run Now' capability.", { size: 10 });
  spacer(10);

  drawHeading("Predictive Analytics Engine", 2);
  drawText("Trend forecasting that analyzes platform metrics, experiment success rates, and conversation patterns:", { size: 10 });
  spacer(4);
  drawBullet("Market trend identification and analysis");
  drawBullet("Product opportunity discovery");
  drawBullet("Growth forecasting with confidence intervals");
  drawBullet("Risk alerts and mitigation recommendations");
  drawBullet("Competitive intelligence insights");
  drawText("Runs weekly on Mondays at 7am via heartbeat.", { size: 10 });
  spacer(10);

  drawHeading("Process Optimization Engine", 2);
  drawText("Workflow efficiency analyzer that examines operational patterns:", { size: 10 });
  spacer(4);
  drawBullet("Heartbeat task performance analysis");
  drawBullet("Scheduling pattern optimization");
  drawBullet("Email and social media output efficiency");
  drawBullet("Resource utilization tracking");
  drawBullet("Concrete improvement suggestions with implementation steps");
  drawText("Runs daily at 5am via heartbeat.", { size: 10 });
  spacer(10);

  drawHeading("Insights Dashboard", 2);
  drawText("The /insights page provides tabs per engine with priority/status badges, Apply/Dismiss actions, and engine performance statistics.", { size: 10 });

  // ===================== SECTION 7: MEMORY =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("7. Memory & Knowledge System", 1);
  spacer(6);

  drawHeading("Three-Tier Semantic Memory", 2);
  drawBullet("Durable Facts: Long-term memories automatically extracted from conversations (preferences, decisions, key information)");
  drawBullet("Daily Notes: Short-term contextual notes that decay over time");
  drawBullet("Knowledge Base: Vector-embedded documents with BM25, Vector, and Hybrid search modes");
  spacer(10);

  drawHeading("Zero-Loss Compaction", 2);
  drawText("When conversation history grows too long, the system compacts it while preserving all important information:", { size: 10 });
  spacer(4);
  drawBullet("AI extracts key facts and preferences before compaction");
  drawBullet("Extracted items saved as permanent durable memories");
  drawBullet("Full pre-compaction transcripts archived in database (compaction_archives table)");
  drawBullet("Archived conversations recoverable via recall_context tool");
  drawBullet("1200-token summary limit with expanded preservation rules");
  spacer(10);

  drawHeading("Memory Backup & Export", 2);
  drawBullet("GET /api/memory/export: Export all memories (active, archived, superseded) plus compaction archives");
  drawBullet("POST /api/memory/backup-to-drive: One-click Google Drive backup to 'VisionClaw Backups/Tenant Memory Backups'");
  drawBullet("Compaction Archive Viewer: Browse archived conversation segments with message counts and summaries");

  // ===================== SECTION 8: COMMUNICATIONS =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("8. Communication Suite", 1);
  spacer(6);

  drawHeading("WhatsApp Integration", 2);
  drawText("Full WhatsApp Web integration via Baileys library, enabling AI agents to communicate through WhatsApp:", { size: 10 });
  spacer(4);
  drawBullet("Per-tenant WhatsApp connections with QR code pairing");
  drawBullet("Self-chat support for sending messages to yourself");
  drawBullet("Auto-reply mode for incoming messages from external contacts");
  drawBullet("Approval channel: receive HITL approval requests and respond via WhatsApp");
  drawBullet("Phone number management for approval routing");
  drawBullet("LID JID support for modern WhatsApp message formats");
  drawBullet("Session persistence across server restarts");
  spacer(10);

  drawHeading("AgentMail Email System", 2);
  drawBullet("Integrated email client with @agentmail.to addresses");
  drawBullet("Send and receive emails through AI agents");
  drawBullet("Email notifications for system events (welcome, verification, usage warnings)");
  drawBullet("HTML email templates for professional communication");
  spacer(10);

  drawHeading("Discord Bot", 2);
  drawBullet("Bot control and messaging capabilities");
  drawBullet("Channel-based interaction with AI agents");
  drawBullet("Status monitoring from the dashboard");

  // ===================== SECTION 9: BROWSER =====================
  spacer(20);
  drawHeading("9. Browser & Web Tools", 1);
  spacer(6);

  drawHeading("Virtual Browser", 2);
  drawBullet("Tenant-scoped virtual browser sessions using Puppeteer");
  drawBullet("Session isolation prevents cross-tenant data leakage");
  drawBullet("SSRF protection blocks access to internal networks");
  drawBullet("Screenshot capture and page content extraction");
  drawBullet("Form filling and navigation capabilities");
  spacer(8);

  drawHeading("Credential Vault", 2);
  drawBullet("AES-256-GCM encrypted storage for website credentials");
  drawBullet("AI agents can auto-login to websites using stored credentials");
  drawBullet("Per-tenant isolation of stored credentials");
  drawBullet("Secure retrieval with encryption key management");

  // ===================== SECTION 10: PAYMENTS =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("10. Payments & Billing", 1);
  spacer(6);

  drawHeading("Stripe Integration", 2);
  drawBullet("Subscription checkout with multiple plan tiers (Free, Starter, Professional, Enterprise)");
  drawBullet("Stripe Connect for marketplace payouts to content creators and partners");
  drawBullet("BYOK (Bring Your Own Key) management - users can add their own AI provider keys");
  drawBullet("Webhook handling for subscription lifecycle events");
  drawBullet("Payment history and invoice management");
  spacer(10);

  drawHeading("Coinbase Integration", 2);
  drawBullet("CDP Wallet: Per-tenant cryptocurrency wallet management via Coinbase CDP SDK");
  drawBullet("Commerce API: Accept crypto payments for subscriptions and services");
  drawBullet("Isolated key management per tenant");
  spacer(10);

  drawHeading("Usage Metering", 2);
  drawBullet("Messages per day tracking with plan-tier enforcement");
  drawBullet("Tool calls per day monitoring");
  drawBullet("Conversations per month limits");
  drawBullet("BYOK presence enhances rate limits for paid plans");
  drawBullet("Usage dashboard with visual charts and trends");

  // ===================== SECTION 11: FILES =====================
  spacer(20);
  drawHeading("11. File Management & Google Drive", 1);
  spacer(6);
  drawBullet("Secure per-tenant file storage via Replit Object Storage with PostgreSQL metadata");
  drawBullet("File Manager UI with drag-and-drop upload, search, and sort");
  drawBullet("Google Drive integration: automatic upload and sharing to organized subfolders");
  drawBullet("PDF Toolkit: Create multi-page PDFs, analyze existing PDFs, auto-upload to Drive");
  drawBullet("All generated files (reports, exports, backups) automatically saved to Google Drive");

  // ===================== SECTION 12: SECURITY =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("12. Security & Authentication", 1);
  spacer(6);

  drawHeading("Authentication Methods", 2);
  drawBullet("Replit Auth: SSO for Replit users");
  drawBullet("Email + Password: Standard registration with email verification and password policy");
  drawBullet("Admin PIN: HMAC-SHA256 with salt for admin access (timing-safe comparison)");
  drawBullet("DB-backed sessions with configurable expiry");
  spacer(10);

  drawHeading("Security Features", 2);
  drawBullet("Provider Key Proxy: Two-tier key architecture (platform-owned + BYOK) prevents key exposure");
  drawBullet("Content Security Policy (CSP): Helmet with strict allowlists");
  drawBullet("AES-256-GCM encryption for credential vault storage");
  drawBullet("SSRF protection in browser tool blocks internal network access");
  drawBullet("Password reset tokens: database-persisted with auto-cleanup");
  drawBullet("Admin authorization: dashboard endpoints enforce admin-only access via isAdminRequest()");
  drawBullet("SQL injection prevention: parameterized queries throughout, no sql.raw() with user input");
  spacer(10);

  drawHeading("Health Monitor", 2);
  drawBullet("Automated checks for core services every 5 minutes");
  drawBullet("Auto-remediation for recoverable failures");
  drawBullet("Email alerts for persistent issues");
  drawBullet("6 health check categories monitored");

  // ===================== SECTION 13: TOOLS =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("13. Complete Tool Catalog (50+)", 1);
  spacer(6);

  const toolCategories = [
    ["Memory & Knowledge", "search_memory, save_memory, archive_memory, create_knowledge, search_knowledge, recall_context"],
    ["Communication", "send_email, check_email, reply_to_email, send_whatsapp_message, post_to_channel, read_channels"],
    ["Browser & Web", "browser_action, web_fetch, web_search (Perplexity), deep_research"],
    ["File & Document", "analyze_pdf, create_pdf, google_drive (upload/share/list), file_manager"],
    ["Code Execution", "execute_code (sandboxed JS), shell_exec (system commands)"],
    ["Agent Coordination", "delegate_task, sessions_list, sessions_send, sessions_spawn, orchestrate (CEO mode)"],
    ["Desk & Events", "manage_desk, emit_event, post_to_channel, read_channels"],
    ["Marketing & Social", "draft_social_post, content_calendar, marketing_experiment"],
    ["Research", "start_research_session, list_research_programs, run_all_programs"],
    ["Analytics", "generate_chart (bar/line/pie via Recharts), usage_stats, platform_metrics"],
    ["Self-Improvement", "run_self_improvement, create_custom_tool, list_models"],
    ["Credentials & Security", "vault_store, vault_retrieve, vault_list"],
    ["Weather & Briefing", "get_weather, generate_briefing, text_to_speech"],
    ["Payments", "stripe_checkout, stripe_status, coinbase_wallet"],
  ];

  for (const [category, tools] of toolCategories) {
    drawBullet(`${category}: ${tools}`);
    spacer(2);
  }
  spacer(10);

  drawHeading("Tool Safety Features", 2);
  drawBullet("Semantic Tool Router: Dynamically selects relevant tools based on message keywords, reducing token usage");
  drawBullet("Tool Loop Detection: Prevents infinite tool execution cycles");
  drawBullet("Risk Classification: Tools categorized by risk level (low/medium/high/critical)");
  drawBullet("Mutation Tracking: Records all write operations for audit");
  drawBullet("Adaptive Execution: System analyzes failures and injects recovery hints for retries");

  // ===================== SECTION 14: API REFERENCE =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("14. API Reference (90+ Endpoints)", 1);
  spacer(6);

  const apiGroups = [
    ["Authentication & Tenants", "POST /api/auth/login, POST /api/auth/pin, GET /api/auth/status, POST /api/tenants/register, GET /api/tenants/me, POST /api/auth/forgot-password, POST /api/auth/reset-password"],
    ["Conversations & Messages", "GET/POST /api/conversations, GET /api/conversations/:id, POST /api/conversations/:id/messages (SSE streaming), DELETE /api/conversations/:id, PATCH /api/conversations/:id/rename"],
    ["Personas & Skills", "GET/POST /api/personas, PATCH /api/personas/:id, GET/POST /api/skills, GET/POST /api/knowledge"],
    ["Memory", "GET /api/memory, POST /api/memory, DELETE /api/memory/:id, GET /api/memory/export, POST /api/memory/backup-to-drive, GET /api/memory/compaction-archives"],
    ["Heartbeat & Tasks", "GET /api/heartbeat/tasks, POST /api/heartbeat/tasks, PATCH /api/heartbeat/tasks/:id, GET /api/heartbeat/history"],
    ["Research", "GET/POST /api/research/programs, GET/POST /api/research/sessions, GET /api/research/experiments, GET/POST /api/research/schedules"],
    ["Agent Desks", "GET /api/desks, GET /api/desks/overview (admin), GET /api/desks/:personaId, PATCH /api/desks/:personaId"],
    ["Channels", "GET /api/channels, GET /api/channels/:id/messages, POST /api/channels/messages, GET /api/channels/unread"],
    ["Events", "GET /api/events/log (admin), GET /api/events/types, POST /api/events/emit, GET/POST/PATCH/DELETE /api/events/subscriptions (admin), GET /api/events/stats (admin)"],
    ["WhatsApp", "GET /api/whatsapp/status, POST /api/whatsapp/connect, POST /api/whatsapp/disconnect, POST /api/whatsapp/send, GET/POST /api/whatsapp/approval-phone, POST /api/whatsapp/test-approval"],
    ["Email", "GET /api/email/inbox, POST /api/email/send, GET /api/email/addresses"],
    ["Files & Storage", "GET /api/files, POST /api/upload, DELETE /api/files/:id, GET /api/files/:id/download"],
    ["Payments", "POST /api/public/stripe/create-checkout, POST /api/stripe/webhook, GET /api/stripe-connect/status, POST /api/stripe/byok"],
    ["Insights", "GET /api/insights, POST /api/insights/run/:engine, PATCH /api/insights/:id"],
    ["Admin", "GET /api/admin/tenants, GET /api/settings, PATCH /api/settings, GET /api/models, POST /api/provider-keys"],
    ["Public", "GET /api/public/stats, GET /api/c/:slug (vanity URL chats)"],
  ];

  for (const [group, endpoints] of apiGroups) {
    drawBullet(`${group}: ${endpoints}`);
    spacer(3);
  }

  // ===================== SECTION 15: FRONTEND PAGES =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("15. Frontend Pages & Navigation", 1);
  spacer(6);

  drawHeading("Sidebar Navigation Groups", 2);
  spacer(4);

  drawText("Main Section:", { font: helveticaBold, size: 10 });
  drawBullet("/ - Home Dashboard (stats, quick actions, recent activity)");
  drawBullet("/personas - AI Persona Management (14 agents, customization)");
  drawBullet("/skills - Skill Configuration (per-persona skill toggles)");
  drawBullet("/knowledge - Knowledge Base (document upload, search)");
  drawBullet("/memory - Memory Manager (facts, notes, archives)");
  spacer(6);

  drawText("Tools Section:", { font: helveticaBold, size: 10 });
  drawBullet("/vault - Credential Vault (encrypted website login storage)");
  drawBullet("/projects - Project Manager (task boards, project tracking)");
  drawBullet("/files - File Manager (upload, organize, share files)");
  drawBullet("/email - Email Client (AgentMail inbox)");
  drawBullet("/whatsapp - WhatsApp Manager (connection, auto-reply settings)");
  drawBullet("/research - Research Dashboard (programs, sessions, experiments)");
  drawBullet("/analytics - Analytics Dashboard (usage, trends, charts)");
  drawBullet("/insights - Intelligence Insights (AI engine recommendations)");
  spacer(6);

  drawText("Admin Section (Admin Only):", { font: helveticaBold, size: 10 });
  drawBullet("/heartbeat - Heartbeat Engine (autonomous task management)");
  drawBullet("/agentic - Agentic Operations (desks, channels, event bus monitoring)");
  drawBullet("/payments - Payments & Billing (Stripe, Coinbase, plans)");
  drawBullet("/settings - Settings (general config, tenant management, provider keys)");
  spacer(6);

  drawText("Other Pages:", { font: helveticaBold, size: 10 });
  drawBullet("/chat/:id - Conversation View (AI chat with streaming responses)");
  drawBullet("/login, /signup - Authentication (multi-method login)");
  drawBullet("/account - Account Management (profile, plan, deletion)");
  drawBullet("/landing - Public Landing Page");
  drawBullet("/terms, /privacy - Legal Pages");

  // ===================== SECTION 16: DATABASE =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("16. Database Schema", 1);
  spacer(6);

  drawText("PostgreSQL database with Drizzle ORM. Schema defined in shared/schema.ts with additional tables created via direct SQL in seed.ts.", { size: 10 });
  spacer(10);

  const dbTables = [
    ["Identity & Auth", "tenants, users, auth_sessions - Multi-tenant account management with session tracking"],
    ["Conversations", "conversations, messages - Chat history with model/persona/thinking settings per conversation"],
    ["Agents", "personas, agent_settings, skills, custom_tools - Agent configuration and custom tooling"],
    ["Memory", "memory_entries, agent_knowledge, daily_notes, compaction_archives - Three-tier memory system"],
    ["Automation", "heartbeat_tasks, heartbeat_logs - Background task scheduling and execution logs"],
    ["Research", "research_programs, research_sessions, research_experiments - Autonomous research pipeline"],
    ["Agentic (Phase 1)", "agent_desks, agent_channels, channel_subscriptions, channel_messages, event_log, event_subscriptions - Inter-agent coordination"],
    ["Intelligence", "ai_insights - Engine outputs with category, priority, status tracking"],
    ["Files", "file_storage, projects, doc_collections, doc_chunks - File management and vector document storage"],
    ["Usage & Billing", "usage_tracking, provider_keys, delivery_logs - Metering and key management"],
    ["Communication", "briefing_reports - Daily briefing generation and history"],
  ];

  for (const [category, desc] of dbTables) {
    drawBullet(`${category}: ${desc}`);
    spacer(2);
  }

  // ===================== SECTION 17: EXTERNAL INTEGRATIONS =====================
  spacer(20);
  drawHeading("17. External Integrations", 1);
  spacer(6);

  drawHeading("AI Providers", 2);
  drawBullet("OpenAI: GPT-4o, GPT-4.1, GPT-5, GPT-5 Mini, o4-mini (with thinking modes)");
  drawBullet("Anthropic: Claude 3.5 Sonnet, Claude Sonnet 4, Claude Opus 4");
  drawBullet("Google: Gemini 2.5 Pro/Flash, Gemini 3 Pro/Flash, Gemini 3.1 Pro");
  drawBullet("xAI: Grok 3, Grok 4");
  drawBullet("Perplexity: Sonar (web search with citations)");
  drawBullet("OpenRouter: DeepSeek, MiniMax, Qwen, Llama, Kimi (cost-efficient options)");
  spacer(8);

  drawHeading("Services & APIs", 2);
  drawBullet("ElevenLabs: Text-to-speech and speech-to-text for voice interactions");
  drawBullet("Google Drive: File storage, sharing, organized folder management");
  drawBullet("Firecrawl: Web page extraction and scraping for research");
  drawBullet("Jina AI: Web page reading and content extraction");
  drawBullet("AgentMail: Corporate email sending and receiving");
  drawBullet("WhatsApp Web (Baileys): Messaging and approval workflows");
  drawBullet("Discord: Bot messaging and channel integration");
  drawBullet("ip-api.com: Server-side IP geolocation");
  drawBullet("Open-Meteo: Weather data for daily briefings");

  // ===================== SECTION 18: DEPLOYMENT =====================
  currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  yPos = PAGE_HEIGHT - MARGIN;
  drawHeading("18. Deployment & Operations", 1);
  spacer(6);

  drawHeading("Architecture", 2);
  drawBullet("Single-port deployment (5000) serving both Express API and Vite frontend");
  drawBullet("Replit-hosted with automatic SSL/TLS and health checks");
  drawBullet("PostgreSQL database with persistent storage");
  drawBullet(`GitHub repository: ${process.env.GITHUB_REPO || "your-org/your-repo"}`);
  spacer(10);

  drawHeading("Startup Sequence", 2);
  drawBullet("1. Database schema initialization and seeding (seed.ts)");
  drawBullet("2. Stripe schema and webhook setup");
  drawBullet("3. Google Drive token refresh");
  drawBullet("4. Auth session loading from database");
  drawBullet("5. WhatsApp auto-connect (production only)");
  drawBullet("6. Heartbeat engine start (60-second intervals)");
  drawBullet("7. Health monitor start (300-second intervals)");
  drawBullet("8. Express server begins accepting requests");
  spacer(10);

  drawHeading("Monitoring", 2);
  drawBullet("Health monitor: 6 automated service checks with email alerts");
  drawBullet("Heartbeat logs: Complete execution history with error tracking");
  drawBullet("Event bus logs: All business event processing tracked");
  drawBullet("Usage tracking: Per-tenant AI call and token monitoring");
  drawBullet("Deployment logs: Available via production log viewer");

  // ===================== FOOTER ON ALL PAGES =====================
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    page.drawText(`VisionClaw Agent — Platform Documentation | Page ${i + 1} of ${pages.length}`, {
      x: MARGIN,
      y: 25,
      size: 7,
      font: helvetica,
      color: rgb(0.5, 0.5, 0.5),
    });
    if (i > 0) {
      page.drawRectangle({
        x: 0,
        y: PAGE_HEIGHT - 8,
        width: PAGE_WIDTH,
        height: 8,
        color: rgb(0.08, 0.18, 0.42),
      });
    }
  }

  const pdfBytes = await doc.save();

  if (!fs.existsSync(path.dirname(OUTPUT_PATH))) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  }
  fs.writeFileSync(OUTPUT_PATH, pdfBytes);
  console.log(`PDF generated: ${OUTPUT_PATH} (${pdfBytes.length} bytes, ${pages.length} pages)`);
}

generateDocumentation().catch(console.error);
