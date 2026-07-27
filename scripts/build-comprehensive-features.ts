import { readFileSync, writeFileSync } from "node:fs";

const tools = readFileSync("/tmp/toolnames.txt", "utf-8").trim().split("\n").filter(Boolean);
const personas: Array<[string, string, string]> = [
  ["VisionClaw", "General AI Assistant", "1"],
  ["Felix", "CEO Persona", "2"],
  ["Forge", "Staff Engineer", "3"],
  ["Teagan", "Content Marketing Specialist", "4"],
  ["Agent Blueprint", "Multi-Agent System Operator", "5"],
  ["Chief of Staff", "Operations Director", "6"],
  ["Scribe", "Content Creator", "7"],
  ["Proof", "Content Reviewer", "8"],
  ["Radar", "Intelligence Analyst", "9"],
  ["Neptune", "Deep Research Specialist", "10"],
  ["Apollo", "Revenue & Pipeline Manager", "11"],
  ["Atlas", "Metrics & Reporting Analyst", "12"],
  ["Cassandra", "CFO — Chief Financial Officer", "13"],
  ["Luna", "Legal & Compliance Officer", "14"],
  ["Minerva", "Chief Planner — Strategic Plan Architect", "15"],
  ["Robert", "Wellness Coach", "16"],
];
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

const today = "May 4, 2026";
const txt = `=================================================================
VISIONCLAW AGENT PLATFORM — COMPREHENSIVE FEATURES
=================================================================
Generated: ${today}
Release: R98.11+sec2 (Slash Commands + Skill Supply-Chain + Whole-App Architect Hardening)

Company:    [Your Company]
EIN:        [YOUR-EIN]
Owner:      Bob Washburn
Location:   [Your City, State], USA
Live URL:   https://agenticcorporation.net
QR Code:    agenticcorporation.net  (scan to visit)
Repo:       https://github.com/Huskyauto/VisionClaw-Agent (private)
            https://github.com/Huskyauto/VisionClaw-Agent-Public-Release (sanitized public mirror)

=================================================================
PLATFORM STATS — LIVE COUNTS
=================================================================
Tools (agent-callable):           ${tools.length}
Skills (loadable):                ${skills.length}
Personas (specialist agents):     ${personas.length}
Active capabilities:              92
Production indexes:               47
Process Governor rules:           40
Nightly research programs:        5
Verified paid deliveries:         71+ (0 silent drops)

=================================================================
WHAT'S NEW IN R98.11+sec2 (May 4, 2026)
=================================================================
Six R-rounds shipped same day, capped by a thorough whole-app
architect review that closed 3 HIGH-severity findings in +sec2.

R98.9 — SUPPLY-CHAIN DISCIPLINE
  - AGENTS.md vc-supply-chain block — codifies npm dep-management
    rules every CLI agent reads on entry: never edit package.json
    by hand, exact pins for new adds, lockfile committed, no
    blind npm update / audit fix --force, >=1-day release-age
    gate, lockfile-only fixes preferred for transitive CVEs.
  - .agents/skills/_registry.json — SHA-256 manifest with
    per-file hash + per-skill bundleHash for all 21 skills.
  - scripts/skills-registry.ts — manifest / validate / audit
    subcommands. Wired into weekly-maintenance Pass 8 RED on
    drift. LLM auditor uses Claude Haiku with versioned prompt
    targeting prompt-injection / supply-chain / safety risks.

R98.10 — SLASH COMMANDS + AGENT_FOLDER_MAP INSTALL
  - New slash_command tool with list / describe / run actions
    reads .bob/commands/*.md (Claude-Code-style YAML frontmatter
    + bash body). First three commands: /check, /registry,
    /commit-all.
  - scripts/skills-registry.ts install reads each skill's
    agentFolderMap and mirrors the skill body into the folders
    other agents read (.cursor/rules/, .github/copilot-
    instructions/, etc.) via tmp+rename atomicity.

R98.11 — EXIT-77 + GATE_COMMAND
  - delegate_task learns optional gate_command precondition.
    Agent provides a shell snippet (e.g., git diff --quiet ||
    exit 0). Exit 77 = clean skip (no LLM call, no spend).
    Exit 0 = proceed. Any other exit = abort with stderr.
  - Persona-id allowlist [Felix(2), Forge(3)] enforced inline.

R98.10+sec / R98.11+sec — ARCHITECT HIGH FIXES (same day)
  - Persona gate hardened to fail-closed on missing _personaId.
  - .bob/commands/*.md body sanitization for prompt-injection
    markers before exec.
  - Symlink-rejection on cmdPath.

R98.11+sec2 — WHOLE-APP REVIEW, 3 HIGHs CLOSED
  1. Secret-exfil via inherited env. Both shell-exec sites
     (slash_command body + delegate_task gate_command) cloned
     process.env wholesale. A hostile body could 'env' /
     'printenv' and capture OPENAI / ANTHROPIC / GEMINI /
     STRIPE / GOOGLE / DATABASE keys via captured stdout.
     Now strict env allowlist (PATH, HOME, PWD, locale, REPL_*,
     NODE_*, TMP_*) — every other var dropped. Belt-and-
     suspenders: cap() redacts any literal occurrence of
     process.env values matching secret-name pattern or
     vendor prefix, sorted longest-first to prevent substring
     leaks.
  2. slash_command not classified as RCE-class. Added to
     HIGH_RISK_TOOLS and TOOL_POLICIES (risk:'destructive',
     trustedPersonasOnly:true). Caught a quiet drift fixing
     it: TRUSTED_PERSONA_NAMES was {Felix, VisionClaw, system}
     — Forge wasn't trusted by the destructive-policy layer.
     Added Forge.
  3. Skills-registry install symlink containment bypass.
     lstat rejects symlink/non-regular sources; realpath of
     dstSubdir must stay under realpath of destRoot; refuses
     to overwrite pre-existing dst symlinks. Same fix shape
     applied to .bob/commands loader.

DEFERRED (recorded as known gaps in replit.md)
  - execSync blocks event loop up to 600s/180s — refactor to
    async spawn deferred to a dedicated round.
  - Owner-override entries in _registry.json have no expiry
    SLA — deferred to next supply-chain round.

=================================================================
COMPLETE TOOL INVENTORY — ALL ${tools.length} AGENT-CALLABLE TOOLS
=================================================================
${tools.map((t, i) => `${String(i + 1).padStart(3, " ")}. ${t}`).join("\n")}

=================================================================
COMPLETE SKILLS INVENTORY — ALL ${skills.length} LOADABLE SKILLS
=================================================================
${skills.map((s, i) => `${String(i + 1).padStart(2, " ")}. ${s}`).join("\n")}

=================================================================
COMPLETE PERSONA ROSTER — ALL ${personas.length} SPECIALIST AGENTS
=================================================================
${personas.map(([n, r, id]) => `  Persona #${id.padStart(2, " ")}  ${n.padEnd(20, " ")} - ${r}`).join("\n")}

=================================================================
ARCHITECTURAL SUBSYSTEMS
=================================================================
* Agentic Infrastructure
  - 288 agent-callable tools across reasoning, memory, web,
    media, payments, telephony, file I/O, persona ops
  - 16 personas with per-persona tool policies + autonomy rules
  - Tool Registry: single source of truth for tool metadata
  - Tool Curator with vector embeddings for semantic tool match
  - Internal Channels + Event Bus for inter-agent messaging
  - Persistent Agent Desks
  - 40-rule Process Governor enforcing operational discipline
  - 47 production indexes for query performance
  - Outcome Tracking + Watchlist Monitoring
  - 5 nightly research programs feeding code-proposal pipeline

* Safety & Security Layers
  - Strict env allowlist + secret redaction at every shell-exec
    site (R98.11+sec2)
  - Outbound Sensitive-Data Redaction Gate (R95) — egress-layer
    enforcement at every send_email / sessions_send / tool
    response chokepoint. Pattern-based, deterministic, no LLM.
  - Prompt-injection scanner (R85) — 10 threat patterns +
    invisible-unicode steganography
  - Tenant isolation via AsyncLocalStorage tenant-context
    (R98.7) — propagates across every authenticated path
  - Symlink jail on every file loader: scan_file, read_file,
    write_file, exec working dir, slash_command loader, skills-
    registry install
  - Destructive-tool policy layer with TRUSTED_PERSONA_NAMES
    + HITL approval for high-risk tools
  - SSRF deny-list on outbound webhook relay + redirect:'error'
    on imported subagent fetches
  - Crisis Safety Guard + AHB stylistic-jailbreak defense
  - SHA-256 skill manifest + LLM auditor (R98.9) — supply-chain
    integrity for the skill collection

* Multi-Tenant Architecture
  - Per-tenant API keys (vc_*) with timing-safe comparison
  - Per-tenant rate limiters (fail-closed on saturation)
  - Per-tenant cost tracking + escalation quotas
  - Per-tenant brand-voice profiles + voice-safe tool allowlist
  - Per-tenant inbox provisioning + email signing
  - tenant_id required on every storage write — silent default
    to tenant 1 explicitly removed

* MPEG Production Engine
  - Lean parallel video production using FFmpeg 6.1.1
  - Browserless integration for HTML-to-PDF rendering
  - Built With Bob YouTube channel pipeline

* Stripe + Delivery
  - Stripe Sync mirror tables (accounts, products, prices,
    payment_intents) with FK + trigger fixtures for CI parity
  - 71+ verified deliveries with manual-review-then-graduate
    pipeline; 0 silent drops across all paid orders

* Integrations Active
  - OpenAI, Anthropic, Gemini (LLMs)
  - ElevenLabs (voice synthesis)
  - Stripe (payments)
  - Google Drive, Google Sheets, Google Mail, Google Calendar
  - OneDrive
  - Replit OIDC (login)
  - Browserless (PDF + screenshots)
  - Twilio (SMS / WhatsApp)
  - Linear, GitHub, Notion, HubSpot, Slack via integrations layer
  - X/Twitter v2 API
  - Figma MCP server

=================================================================
COMPANY INFORMATION
=================================================================
Legal entity:   [Your Company]
EIN:            [YOUR-EIN]
Owner:          Bob Washburn
Email:          huskyauto@gmail.com
Location:       [Your City, State], USA
Live platform:  https://agenticcorporation.net
QR code:        scan above URL to visit live platform

=================================================================
END OF DOCUMENT
=================================================================
`;
writeFileSync("VisionClaw-Comprehensive-Features.txt", txt);
console.log("TXT_BYTES:", txt.length);
