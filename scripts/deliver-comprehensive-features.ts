import { readFileSync } from "node:fs";

(async () => {
  const { generateStyledPdf } = await import("../server/pdf-create");
  const { uploadAndShare } = await import("../server/google-drive");

  const tools = readFileSync("/tmp/toolnames.txt", "utf-8").trim().split("\n").filter(Boolean);
  const skills = `AI Agent Playbook
AI Discoverability Audit
Agent Blueprint
Agent Browser
Agent Cost Analyzer
Agent Email
Agent Launchpad
Agent Memory Guide
Agent Ops Playbook
Blog Hero Images
Browser Automation (X/Twitter)
Build in Public
Business Operations & Strategy
Caption Generation
Marketplace Creator
Code Generation
Coding Agent Loops
Cold Outreach
Content Idea Generator
Content Marketing & Brand Building
Content Production
Content Writing System
Context Budget
Data Analysis
De-AI-ify Text
DocClaw
Document & Delivery Pipeline
Email Drafting
Email Fortress
Excalidraw Flowcharts
Financial Analysis & Reporting
Free Web Search
Heartbeat Monitor
Homepage Audit
Image Understanding
Legal & Compliance Essentials
LinkedIn Content Engine
LinkedIn Profile Optimizer
Math & Calculations
Morning Briefing
Phone Service
Plan My Day
Programmatic SEO
Project Management & Planning
Reasoning & Logic
Research & Competitive Intelligence
SEO Content Audit
Sales & Client Relations
Schema Markup Generation
Security Hardening
Security Review
Self-Diagnostics
Small Business AI Prompts
Summarization
TOWEL Protocol
Token Optimization
Vibe Marketing
Web Research
Writing & Editing
X Engagement Cron
X/Twitter Skill
YouTube Skill`.split("\n");
  const personas: Array<[string, string]> = [
    ["1 — VisionClaw", "General AI Assistant"],
    ["2 — Felix", "CEO Persona"],
    ["3 — Forge", "Staff Engineer"],
    ["4 — Teagan", "Content Marketing Specialist"],
    ["5 — Agent Blueprint", "Multi-Agent System Operator"],
    ["6 — Chief of Staff", "Operations Director"],
    ["7 — Scribe", "Content Creator"],
    ["8 — Proof", "Content Reviewer"],
    ["9 — Radar", "Intelligence Analyst"],
    ["10 — Neptune", "Deep Research Specialist"],
    ["11 — Apollo", "Revenue & Pipeline Manager"],
    ["12 — Atlas", "Metrics & Reporting Analyst"],
    ["13 — Cassandra", "CFO — Chief Financial Officer"],
    ["14 — Luna", "Legal & Compliance Officer"],
    ["15 — Minerva", "Chief Planner — Strategic Plan Architect"],
    ["16 — Robert", "Wellness Coach"],
  ];

  // Group tools alphabetically into 4-column-friendly chunks for the PDF
  const toolChunks: string[][] = [];
  const chunkSize = Math.ceil(tools.length / 4);
  for (let i = 0; i < tools.length; i += chunkSize) toolChunks.push(tools.slice(i, i + chunkSize));

  const pdfPromise = generateStyledPdf({
    title: "VisionClaw Agent Platform",
    subtitle: "Comprehensive Features — May 4, 2026 — R98.11+sec2",
    companyLines: [
      "[Your Company] | EIN: [YOUR-EIN]",
      "Owner: Bob Washburn | [Your City, ST]",
      "https://agenticcorporation.net",
    ],
    coverStats: [
      { label: "Tools", value: String(tools.length) },
      { label: "Skills", value: String(skills.length) },
      { label: "Personas", value: String(personas.length) },
      { label: "Capabilities", value: "92" },
      { label: "Indexes", value: "47" },
      { label: "Gov. Rules", value: "40" },
      { label: "Deliveries", value: "71+" },
      { label: "Silent Drops", value: "0" },
      { label: "Release", value: "R98.11+sec2" },
    ],
    sections: [
      {
        title: "What's New in R98.11+sec2 (May 4, 2026)",
        content:
          "Six R-rounds shipped same day, capped by a thorough whole-app architect review that closed 3 HIGH-severity findings in the +sec2 patch.",
        subsections: [
          {
            title: "R98.9 — Supply-Chain Discipline",
            bullets: [
              "AGENTS.md vc-supply-chain block — every CLI agent reads on entry: never edit package.json by hand, exact pins for new adds, lockfile committed, no blind npm update / audit fix --force, ≥1-day release-age gate against compromised-publisher attacks.",
              ".agents/skills/_registry.json — SHA-256 manifest with per-file hash + per-skill bundleHash for all 21 skills.",
              "scripts/skills-registry.ts — manifest / validate / audit subcommands. Wired into weekly-maintenance Pass 8 RED on drift. LLM auditor uses Claude Haiku with versioned prompt targeting prompt-injection / supply-chain / safety risks.",
            ],
          },
          {
            title: "R98.10 — Slash Commands + AGENT_FOLDER_MAP Install",
            bullets: [
              "New slash_command tool (list / describe / run actions) reads .bob/commands/*.md (Claude-Code-style YAML frontmatter + bash body). First three commands: /check, /registry, /commit-all.",
              "scripts/skills-registry.ts install reads each skill's agentFolderMap and mirrors the skill body into the folders other agents read (.cursor/rules/, .github/copilot-instructions/, etc.) via tmp+rename atomicity.",
            ],
          },
          {
            title: "R98.11 — Exit-77 + gate_command",
            bullets: [
              "delegate_task learns optional gate_command precondition: a shell snippet runs first; exit 77 = clean skip (no LLM call, no spend), exit 0 = proceed, any other exit = abort with stderr surfaced.",
              "Persona-id allowlist [Felix(2), Forge(3)] enforced inline at the gate.",
            ],
          },
          {
            title: "R98.10+sec / R98.11+sec — Architect HIGH Fixes (same day)",
            bullets: [
              "Persona gate hardened to fail-closed on missing _personaId.",
              ".bob/commands/*.md body sanitization for prompt-injection markers before exec.",
              "Symlink-rejection on cmdPath.",
            ],
          },
          {
            title: "R98.11+sec2 — Whole-App Review, 3 HIGHs Closed",
            bullets: [
              "Secret-exfil via inherited env: both shell-exec sites cloned process.env wholesale; a hostile body could 'env'/'printenv' and capture OPENAI/ANTHROPIC/GEMINI/STRIPE/GOOGLE/DATABASE keys via captured stdout. Now strict env allowlist (PATH, HOME, PWD, locale, REPL_*, NODE_*, TMP_*) — every other var dropped before exec. Belt-and-suspenders: cap() redacts any literal occurrence of process.env values matching a secret-name pattern or vendor prefix, sorted longest-first to prevent substring leaks.",
              "slash_command not classified as RCE-class: added to HIGH_RISK_TOOLS and TOOL_POLICIES (risk:'destructive', trustedPersonasOnly:true). Caught a quiet drift fixing it: TRUSTED_PERSONA_NAMES was {Felix, VisionClaw, system} — Forge wasn't trusted by the destructive-policy layer despite the in-tool [2,3] allowlist. Added Forge.",
              "Skills-registry install symlink containment bypass: lstat rejects symlink/non-regular sources; realpath of dstSubdir must stay under realpath of destRoot; refuses to overwrite pre-existing dst symlinks. Same fix shape applied to .bob/commands loader.",
            ],
          },
          {
            title: "Deferred (Recorded as Known Gaps in replit.md)",
            bullets: [
              "MEDIUM #5: execSync blocks event loop up to 600s/180s — refactor to async spawn deferred to a dedicated round.",
              "MEDIUM #6: owner-override entries in _registry.json have no expiry SLA — deferred to next supply-chain round.",
            ],
          },
        ],
      },
      {
        title: "Platform Stats — Live Counts",
        table: {
          headers: ["Metric", "Value"],
          rows: [
            ["Tools (agent-callable)", String(tools.length)],
            ["Skills (loadable)", String(skills.length)],
            ["Personas (specialist agents)", String(personas.length)],
            ["Active capabilities", "92"],
            ["Production indexes", "47"],
            ["Process Governor rules", "40"],
            ["Nightly research programs", "5"],
            ["Verified paid deliveries", "71+"],
            ["Silent drops", "0"],
            ["Current release", "R98.11+sec2"],
          ],
        },
      },
      {
        title: `Complete Persona Roster (All ${personas.length})`,
        table: {
          headers: ["Persona", "Role"],
          rows: personas.map(([n, r]) => [n, r]),
        },
      },
      {
        title: `Complete Tool Inventory (All ${tools.length})`,
        content: "Every agent-callable tool registered in server/tools.ts as of this release. Listed alphabetically across four columns for compact reference.",
        subsections: toolChunks.map((chunk, i) => ({
          title: `Tools ${i * chunkSize + 1}–${Math.min((i + 1) * chunkSize, tools.length)}`,
          bullets: chunk,
        })),
      },
      {
        title: `Complete Skills Inventory (All ${skills.length})`,
        bullets: skills,
      },
      {
        title: "Architectural Subsystems",
        subsections: [
          {
            title: "Agentic Infrastructure",
            bullets: [
              `${tools.length} agent-callable tools across reasoning, memory, web, media, payments, telephony, file I/O, persona ops`,
              `${personas.length} personas with per-persona tool policies + autonomy rules`,
              "Tool Registry: single source of truth for tool metadata",
              "Tool Curator with vector embeddings for semantic tool match",
              "Internal Channels + Event Bus for inter-agent messaging",
              "Persistent Agent Desks",
              "40-rule Process Governor enforcing operational discipline",
              "47 production indexes for query performance",
              "Outcome Tracking + Watchlist Monitoring",
              "5 nightly research programs feeding code-proposal pipeline",
            ],
          },
          {
            title: "Safety & Security Layers",
            bullets: [
              "Strict env allowlist + secret redaction at every shell-exec site (R98.11+sec2)",
              "Outbound Sensitive-Data Redaction Gate (R95) — egress-layer enforcement at every send_email / sessions_send / tool response chokepoint. Pattern-based, deterministic, no LLM.",
              "Prompt-injection scanner (R85) — 10 threat patterns + invisible-unicode steganography",
              "Tenant isolation via AsyncLocalStorage tenant-context (R98.7) — propagates across every authenticated path",
              "Symlink jail on every file loader: scan_file, read_file, write_file, exec working dir, slash_command loader, skills-registry install",
              "Destructive-tool policy layer with TRUSTED_PERSONA_NAMES + HITL approval for high-risk tools",
              "SSRF deny-list on outbound webhook relay + redirect:'error' on imported subagent fetches",
              "Crisis Safety Guard + AHB stylistic-jailbreak defense",
              "SHA-256 skill manifest + LLM auditor (R98.9) — supply-chain integrity",
            ],
          },
          {
            title: "Multi-Tenant Architecture",
            bullets: [
              "Per-tenant API keys (vc_*) with timing-safe comparison",
              "Per-tenant rate limiters (fail-closed on saturation)",
              "Per-tenant cost tracking + escalation quotas",
              "Per-tenant brand-voice profiles + voice-safe tool allowlist",
              "Per-tenant inbox provisioning + email signing",
              "tenant_id required on every storage write — silent default to tenant 1 explicitly removed",
            ],
          },
          {
            title: "MPEG Production Engine",
            bullets: [
              "Lean parallel video production using FFmpeg 6.1.1",
              "Browserless integration for HTML-to-PDF rendering",
              "Built With Bob YouTube channel pipeline",
            ],
          },
          {
            title: "Stripe + Delivery",
            bullets: [
              "Stripe Sync mirror tables (accounts, products, prices, payment_intents) with FK + trigger fixtures for CI parity",
              "71+ verified deliveries with manual-review-then-graduate pipeline; 0 silent drops across all paid orders",
            ],
          },
          {
            title: "Active Integrations",
            bullets: [
              "OpenAI, Anthropic, Gemini (LLMs)",
              "ElevenLabs (voice synthesis)",
              "Stripe (payments)",
              "Google Drive, Sheets, Mail, Calendar; OneDrive",
              "Replit OIDC (login)",
              "Browserless (PDF + screenshots)",
              "Twilio (SMS / WhatsApp)",
              "Linear, GitHub, Notion, HubSpot, Slack via integrations layer",
              "X/Twitter v2 API; Figma MCP server",
            ],
          },
        ],
      },
      {
        title: "Company Information",
        highlight: "[Your Company] · EIN [YOUR-EIN] · Owner: Bob Washburn · [Your City, State] · Live at https://agenticcorporation.net (scan QR code at agenticcorporation.net to visit).",
      },
    ],
    footerLines: [
      "VisionClaw Agent Platform — R98.11+sec2 — May 4, 2026",
      "[Your Company] | EIN [YOUR-EIN] | https://agenticcorporation.net",
    ],
    fileName: "VisionClaw-Comprehensive-Features.pdf",
    folderLabel: "Platform Documentation",
    uploadToDrive: true,
  });

  const txtPromise = uploadAndShare({
    filePath: "VisionClaw-Comprehensive-Features.txt",
    fileName: "VisionClaw-Comprehensive-Features.txt",
    description: "VisionClaw Agent Platform - Complete Feature Document (Text) - R98.11+sec2",
    folderLabel: "Platform Documentation",
    share: true,
  });

  const [pdfRes, txtRes] = await Promise.all([pdfPromise, txtPromise]);
  console.log("PDF_RESULT:", JSON.stringify({ success: (pdfRes as any).success, viewUrl: (pdfRes as any).viewUrl, fileId: (pdfRes as any).fileId, size: (pdfRes as any).size }));
  console.log("TXT_RESULT:", JSON.stringify({ viewUrl: (txtRes as any).viewUrl, fileId: (txtRes as any).fileId }));
  process.exit(0);
})().catch((e) => {
  console.error("DELIVER_ERROR:", e?.message || e);
  console.error(e?.stack);
  process.exit(1);
});
