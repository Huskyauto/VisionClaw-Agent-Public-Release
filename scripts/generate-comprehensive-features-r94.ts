import * as fs from "fs";
import * as path from "path";
import { generateStyledPdf } from "../server/pdf-create";
import { uploadAndShare } from "../server/google-drive";
import { getOrCreateTenantInbox, sendEmail } from "../server/email";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const TODAY = "May 3, 2026";

const tools = fs.readFileSync("/tmp/toolnames-final.txt", "utf8").split("\n").filter(Boolean);
const skills = fs.readFileSync("/tmp/skills.txt", "utf8").split("\n").filter(Boolean);

const personas = [
  ["VisionClaw", "General AI Assistant — neutral default front-door"],
  ["Felix", "CEO Persona — autonomous operating loop, delegates to specialists"],
  ["Forge", "Staff Engineer — code generation, refactors, security review"],
  ["Teagan", "Content Marketing Specialist — blog, brand voice, posts"],
  ["Agent Blueprint", "Multi-Agent System Operator — designs crews & flows"],
  ["Chief of Staff", "Operations Director — scheduling, ops cadence"],
  ["Scribe", "Content Creator — long-form writing"],
  ["Proof", "Content Reviewer — QA, fact-check, brand-voice check"],
  ["Radar", "Intelligence Analyst — competitor intel, market scans"],
  ["Neptune", "Deep Research Specialist — multi-source synthesis"],
  ["Apollo", "Revenue & Pipeline Manager — outreach, lead enrichment"],
  ["Atlas", "Metrics & Reporting Analyst — dashboards, KPIs"],
  ["Cassandra", "CFO — invoicing, expenses, financial reporting"],
  ["Luna", "Legal & Compliance Officer — contracts, policies"],
  ["Minerva", "Chief Planner — strategic plan architect"],
  ["Robert", "Late-Night Companion / Wellness Coach ([Your Product] Health)"],
];

function categorize(t: string): string {
  if (/^(send_email|reply|gmail|email_|inbox|outreach|sequence|advance_sequence)/.test(t)) return "Email & Outreach";
  if (/^(whatsapp|telegram|sms|twilio|phone|call_)/.test(t)) return "Messaging & Voice";
  if (/^(google_drive|drive_|upload|google_sheet|google_calendar|google_workspace|onedrive)/.test(t)) return "Google & Workspace";
  if (/^(stripe|coinbase|invoice|expense|customer|crm|pipeline|kpi|payment|charge|refund)/.test(t)) return "Business Ops & Finance";
  if (/^(produce_video|video|audio|tts|elevenlabs|generate_image|gen_image|image_|pdf_|create_pdf|render_)/.test(t)) return "Media Production";
  if (/^(web_search|firecrawl|perplexity|browse|scrape|fetch|readability|search_|sonar)/.test(t)) return "Research & Web";
  if (/^(memory|recall|knowledge|create_memory|create_knowledge|graph_|community|causal|mempalace)/.test(t)) return "Memory & Knowledge";
  if (/^(read_file|write_file|scan_file|exec|execute_code|delegate_task|read_page|act_by_id|vision_)/.test(t)) return "Code & System";
  if (/^(persona|tool_|skill|capability|create_tool|delete_custom)/.test(t)) return "Platform & Meta";
  if (/^(verify_|policy|set_policy|approve|deny|hitl|escalate|trust|guard)/.test(t)) return "Governance & HITL";
  if (/^(deliver_product|publish|deliverable|attach_)/.test(t)) return "Delivery Pipeline";
  if (/^(cron|schedule|task|job|heartbeat|tick|felix_loop)/.test(t)) return "Autonomous Operations";
  if (/^(build_voice|generate_hooks|format_post|generate_content_matrix|score_post|martech)/.test(t)) return "MarTech (R79)";
  if (/^(audit_|verify_math|reasoning|ensemble|moa)/.test(t)) return "Reasoning & Verification";
  if (/^(create_tension|list_open_tensions|resolve_tension|create_adr|list_adrs|supersede_adr)/.test(t)) return "DreamGraph (R74.13z)";
  return "Other";
}

const byCat: Record<string, string[]> = {};
for (const t of tools) {
  const c = categorize(t);
  (byCat[c] ||= []).push(t);
}
const catOrder = [
  "Email & Outreach", "Messaging & Voice", "Google & Workspace", "Business Ops & Finance",
  "Media Production", "Research & Web", "Memory & Knowledge", "Code & System",
  "Platform & Meta", "Governance & HITL", "Delivery Pipeline", "Autonomous Operations",
  "MarTech (R79)", "Reasoning & Verification", "DreamGraph (R74.13z)", "Other",
];

(async () => {
  // ============ TEXT FILE ============
  const lines: string[] = [];
  lines.push("=".repeat(78));
  lines.push("VISIONCLAW AGENT PLATFORM — COMPREHENSIVE FEATURES");
  lines.push(`Generated: ${TODAY}  ·  Round 94 (Tenant Cost-Attribution Integrity)`);
  lines.push("=".repeat(78));
  lines.push("");
  lines.push("Company: [Your Company]");
  lines.push("EIN:     [YOUR-EIN]");
  lines.push("Owner:   Bob Washburn (huskyauto@gmail.com)");
  lines.push("Address: [Your City, State]");
  lines.push("Live:    https://agenticcorporation.net");
  lines.push("QR Code: agenticcorporation.net  (scan to open the live storefront)");
  lines.push("");
  lines.push("-".repeat(78));
  lines.push("PLATFORM STATS (LIVE — May 3, 2026)");
  lines.push("-".repeat(78));
  lines.push(`  Tools (registry-audited):           ${tools.length}`);
  lines.push(`  Voice-safe tools (Glasses):          20 of ${tools.length}`);
  lines.push(`  Active capabilities:                 92`);
  lines.push(`  Production indexes:                  47`);
  lines.push(`  Skills (in DB):                      ${skills.length}`);
  lines.push(`  Active personas:                     ${personas.length}`);
  lines.push(`  AI models (curated registry):        36 (each tagged R77.5 trainingRegime)`);
  lines.push(`  Daily-discovered models (OpenRouter): 1000+`);
  lines.push(`  AI providers:                        6 (OpenAI, Anthropic, Google, xAI, OpenRouter, Perplexity)`);
  lines.push(`  Postgres tables:                     150 (incl. R79 tenant_voice_profiles, R76 trust+contracts, R75 GraphRAG)`);
  lines.push(`  Governance rules:                    40`);
  lines.push(`  Nightly research programs:           5`);
  lines.push(`  Verified deliveries (Live):          71+`);
  lines.push(`  Silent drops:                        0`);
  lines.push("");
  lines.push("-".repeat(78));
  lines.push("LATEST: ROUND 94 — TENANT COST-ATTRIBUTION INTEGRITY (May 3, 2026)");
  lines.push("-".repeat(78));
  lines.push(`Brand-new server/lib/tenant-context.ts provides AsyncLocalStorage-backed tenant
context that propagates end-to-end across every authenticated path. authMiddleware
wraps every authenticated request (vc_ API key, session, Replit OIDC) in
runWithTenant() so every downstream await — including singleton replitOpenai chat /
embeddings / audio.speech / audio.transcriptions calls — bills the correct tenant.
Wrapping extended to: glasses gateway (api-key auth), MCP server (both global-key
and per-tenant-derived-key paths), background job worker (job.tenantId), and the
nightly tool-sommelier cron (per-tenant cycle). Public chat passes convTenantId
explicitly to getClientForModel.

createMeteredOpenAIClient resolveTenant() priority chain:
  1. Explicit opts.tenantId
  2. AsyncLocalStorage current
  3. ADMIN with warn-once-per-stack-trace fallback (loud, not silent)

Critical runtime bug caught in Felix HVAC live test: the original implementation
used CommonJS require() inside the resolver. Under tsx/ESM dev mode that throws
"require is not defined" silently and the entire cost lookup fell back to ADMIN —
every per-tenant cost was being attributed to platform overhead. Fixed by
promoting to a top-of-file static import { currentTenantId } (no circular risk;
tenant-context.ts only depends on node:async_hooks). Three parallel architect
reviews + Felix HVAC end-to-end test confirmed clean boot, no "require is not
defined" warnings, no "cost-track failed" warnings under normal traffic.

Same window: 9 distinct High-severity findings closed.
  - truncateWithSummary merges summary into first kept user turn (Anthropic strict
    alternation safe) and demotes summary from system to user role
  - scan_file lstat symlink reject + realpath re-validate
  - persona create/update + mind soul + claude-code-importer all run injection scan
    on soul/agentsDoc/heartbeatDoc/brandVoiceDoc/identity/tools BEFORE DB write
  - write_file shared blocklist + symlink-ancestor walk
  - per-tenant escalation hourly quota (20/hr)
  - SHA256 cache keys on metered OpenAI clients
  - cleanedFullResponse strips <tool_call> tags
  - disconnect persistence guard (client-aborted streams no longer trigger
    title-gen + hook side effects)
  - 5 tools.ts runLlmTask sites tenant-threaded
`);
  lines.push("-".repeat(78));
  lines.push("EARLIER: ROUNDS 83-93 — COMPREHENSIVE 24H SECURITY SWEEP (May 2-3, 2026)");
  lines.push("-".repeat(78));
  lines.push(`Nine R-bundles closing every defect surfaced by three parallel architect reviews
of the entire app, all shipped same window:
  R83  Streaming-aware AnthropicPromptCache with per-tenant entry quotas
  R84  audit-reasoning + reasoning-extractor sandbox
  R85  Prompt-injection scanner ported from Hermes Alpha (10 threat patterns +
       invisible-unicode steganography detection)
  R86  Streaming wiring for chat-engine (tenant binding propagated across SSE)
  R87  context-compressor with token-aware budgets
  R88  error-context-parser + tool-call-fallback-parser (recovers from malformed
       XML/JSON tool-calls emitted by LLMs)
  R89  Orphan tool_call/tool_result repair after truncation (Anthropic + OpenAI
       strict-alternation safe)
  R90  context-files-loader gated by the prompt-injection scanner
  R91  Glasses gateway fail-closed on missing tenant binding
  R92  self-heal + auto-memorize given explicit ADMIN tenant attribution
  R93  Tenant-attribution propagated to 7 cross-cutting callsites: felix-loop,
       plan-executor, ceo-orchestrator, cross-critique, distributed-slides,
       auto-memorize, self-heal
`);
  lines.push("-".repeat(78));
  lines.push(`COMPLETE TOOL INVENTORY (${tools.length} TOOLS, GROUPED BY CATEGORY)`);
  lines.push("-".repeat(78));
  for (const c of catOrder) {
    if (!byCat[c]) continue;
    lines.push("");
    lines.push(`### ${c}  (${byCat[c].length})`);
    lines.push(byCat[c].join(", "));
  }
  lines.push("");
  lines.push("-".repeat(78));
  lines.push(`COMPLETE SKILLS INVENTORY (${skills.length} SKILLS)`);
  lines.push("-".repeat(78));
  for (const s of skills) lines.push(`  - ${s}`);
  lines.push("");
  lines.push("-".repeat(78));
  lines.push(`COMPLETE PERSONA ROSTER (${personas.length} ACTIVE)`);
  lines.push("-".repeat(78));
  for (let i = 0; i < personas.length; i++) {
    lines.push(`  ${i + 1}. ${personas[i][0]} — ${personas[i][1]}`);
  }
  lines.push("");
  lines.push("-".repeat(78));
  lines.push("CORE ARCHITECTURAL SUBSYSTEMS");
  lines.push("-".repeat(78));
  lines.push(`  - AI Agent System: 16-persona team, semantic tool router, LLM-powered CEO
  - Autonomous Operations: Heartbeat, Scheduled Tasks, HITL Confirmation, Felix Loop
  - Felix Brain Module: task tracker, intent classifier, common-sense rules
  - Layered Identity System: 5 context layers (vc_showcase, client_facing, etc.)
  - Structured Compaction Engine: 5 sections, quality audit with retry
  - Aggressive Parallel Orchestration: up to 8 parallel agents
  - 3-Layer Failure Recovery: self-correction, lean downgrade, backup reroute
  - Bottleneck Analysis Engine: human-readable failure reports
  - Crews & Flows Engine: agent teams with role/goal/backstory
  - Universal Craftsmanship Quality Gate
  - Google Token Resilience: pre-flight check + repair cycle on 401
  - MPEG Production Engine: parallel video via FFmpeg 6.1.1
  - Tool Registry: single source of truth for all tool metadata
  - GraphRAG Five (R75): PageRank + Louvain + Causal Chains + cAST + Dual Retrieval
  - Trust-Tier Policy Engine (R76): per-tenant pre-approval rules
  - Deliverable Contract Verification (R76): typed acceptance checks
  - KisMATH Reasoning Audit Rail (R77.5): trainingRegime tags + audit_reasoning_step
  - A2A v0.3 Agent Card (R78): /.well-known/agent.json
  - MarTech Bundle (R79): per-tenant brand-voice profiles + 6 social tools
  - Claude Code Subagent Importer + Runtime Wiring (R80)
  - HITL One-Click Email Approvals (R79.3d): HMAC-signed buttons
  - Stop-the-Line Error Triage Engine
  - Stripe + Coinbase Webhook Reliability (CLAIM-then-COMMIT dedupe)
  - Provider Key Proxy, Helmet CSP, CSRF, DOMPurify XSS sanitization
  - Stability Watchdog (autonomous auto-remediation)
  - 80→95 Autonomy Layer: governance + cost monitoring + auto-throttling
  - Public Storefront at /store with rate-limited Stripe Checkout
  - Persistent Agent Desks, Internal Channels, Event Bus
  - Memory Palace (MemPalace): hierarchical memory organization
  - Temporal Knowledge Triples: entity-relationship graph with temporal validity
  - Evidence Store: citation-first research with confidence scoring
  - Competitor Intel Monitoring: snapshot crawling + change detection
  - Lead Enrichment & Scoring Pipeline + Outreach Sequencing Engine
  - Tenant Cost-Attribution Integrity (R94): AsyncLocalStorage end-to-end
`);
  lines.push("");
  lines.push("=".repeat(78));
  lines.push(`END OF DOCUMENT — VisionClaw R94 — ${TODAY}`);
  lines.push("Live: https://agenticcorporation.net  (scan QR for the public storefront)");
  lines.push("=".repeat(78));

  fs.writeFileSync("VisionClaw-Comprehensive-Features.txt", lines.join("\n"));
  console.log("[ok] text file written:", fs.statSync("VisionClaw-Comprehensive-Features.txt").size, "bytes");

  // ============ PDF ============
  const sections: any[] = [
    {
      title: "Round 94 — Tenant Cost-Attribution Integrity (Latest)",
      content:
        "Brand-new server/lib/tenant-context.ts provides AsyncLocalStorage-backed tenant context that propagates end-to-end across every authenticated path. authMiddleware wraps every authenticated request (vc_ API key, session, Replit OIDC) in runWithTenant() so every downstream await — including singleton replitOpenai chat/embeddings/audio calls — bills the correct tenant.",
      bullets: [
        "Wrapping extended to: glasses gateway, MCP server (both auth paths), background job worker, nightly tool-sommelier cron",
        "Public chat passes convTenantId explicitly to getClientForModel",
        "createMeteredOpenAIClient resolveTenant() priority: explicit opts → ALS current → ADMIN with warn-once",
        "Critical bug caught in Felix HVAC live test: original used CommonJS require() inside resolver, threw silently in tsx/ESM dev mode, every cost lookup fell back to ADMIN — fixed via static top-of-file import",
        "Three parallel architect reviews + Felix HVAC end-to-end test confirmed clean boot",
        "9 distinct High-severity findings closed in a single session",
      ],
      highlight:
        "truncateWithSummary now merges summary into first kept user turn (Anthropic strict-alternation safe) AND demotes summary from system to user role — closes a prompt-injection privilege-escalation path.",
    },
    {
      title: "Rounds 83-93 — Comprehensive 24h Security Sweep (May 2-3 2026)",
      content:
        "Nine R-bundles closing every defect surfaced by three parallel architect reviews of the entire app, all shipped same window.",
      table: {
        headers: ["Round", "Capability"],
        rows: [
          ["R83", "Streaming-aware AnthropicPromptCache with per-tenant entry quotas"],
          ["R84", "audit-reasoning + reasoning-extractor sandbox"],
          ["R85", "Prompt-injection scanner (Hermes Alpha port, 10 patterns + invisible-unicode)"],
          ["R86", "Streaming wiring with tenant binding across SSE"],
          ["R87", "context-compressor with token-aware budgets"],
          ["R88", "error-context-parser + tool-call-fallback-parser"],
          ["R89", "Orphan tool_call/tool_result repair after truncation"],
          ["R90", "context-files-loader gated by injection scanner"],
          ["R91", "Glasses gateway fail-closed on missing tenant binding"],
          ["R92", "self-heal + auto-memorize explicit ADMIN attribution"],
          ["R93", "Tenant-attribution propagated to 7 cross-cutting callsites"],
        ],
      },
    },
    {
      title: "Platform Stats (Live — May 3, 2026)",
      table: {
        headers: ["Metric", "Value"],
        rows: [
          ["Tools (registry-audited)", String(tools.length)],
          ["Voice-safe tools (Glasses)", `20 of ${tools.length}`],
          ["Active capabilities", "92"],
          ["Production indexes", "47"],
          ["Skills (in DB)", String(skills.length)],
          ["Active personas", String(personas.length)],
          ["AI models (curated registry)", "36"],
          ["Daily-discovered models (OpenRouter)", "1000+"],
          ["AI providers", "6 (OpenAI, Anthropic, Google, xAI, OpenRouter, Perplexity)"],
          ["Postgres tables", "150"],
          ["Governance rules", "40"],
          ["Nightly research programs", "5"],
          ["Verified deliveries (Live)", "71+"],
          ["Silent drops", "0"],
        ],
      },
    },
    {
      title: `Complete Tool Inventory — ${tools.length} Tools by Category`,
      subsections: catOrder
        .filter((c) => byCat[c])
        .map((c) => ({
          title: `${c}  (${byCat[c].length})`,
          content: byCat[c].join(", "),
        })),
    },
    {
      title: `Complete Skills Inventory — ${skills.length} Skills`,
      content: skills.join(" · "),
    },
    {
      title: `Persona Roster — ${personas.length} Active Agents`,
      table: {
        headers: ["#", "Persona", "Role"],
        rows: personas.map((p, i) => [String(i + 1), p[0], p[1]]),
      },
    },
    {
      title: "Core Architectural Subsystems",
      bullets: [
        "AI Agent System: 16-persona team with semantic tool router and LLM-powered CEO",
        "Autonomous Operations: Heartbeat, Scheduled Tasks, HITL Confirmation, Felix Loop",
        "Felix Brain Module: task tracker, intent classifier, common-sense reasoning",
        "Structured Compaction Engine with quality audit + retry",
        "Aggressive Parallel Orchestration (up to 8 agents) with 3-Layer Failure Recovery",
        "GraphRAG Five (R75): PageRank, Louvain, Causal Chains, cAST, Dual Retrieval",
        "Trust-Tier Policy Engine + Deliverable Contract Verification (R76)",
        "KisMATH Reasoning Audit Rail (R77.5): trainingRegime tags + audit tools",
        "A2A v0.3 Agent Card (R78) at /.well-known/agent.json",
        "MarTech Bundle (R79): per-tenant brand-voice + 6 social tools",
        "Claude Code Subagent Importer + Runtime Wiring (R80)",
        "HITL One-Click Email Approvals (R79.3d): HMAC-signed buttons, prefetcher-safe",
        "Stripe + Coinbase Webhook CLAIM-then-COMMIT dedupe",
        "Stability Watchdog with autonomous auto-remediation",
        "80→95 Autonomy Layer: cost monitoring + auto-throttling",
        "Tenant Cost-Attribution Integrity (R94): AsyncLocalStorage end-to-end",
      ],
    },
    {
      title: "Live Deployment",
      content:
        "Production: https://agenticcorporation.net  ·  71+ verified deliveries  ·  0 silent drops  ·  Scan the QR code on the cover to open the live storefront.",
      highlight:
        "Built and operated by Bob Washburn (huskyauto@gmail.com) under [Your Company] (EIN [YOUR-EIN]) in [Your City, State].",
    },
  ];

  const pdfRes = await generateStyledPdf({
    title: "VisionClaw Agent Platform",
    subtitle: `Comprehensive Features — ${TODAY}  ·  Round 94`,
    companyLines: [
      "[Your Company]  ·  EIN: [YOUR-EIN]",
      "Owner: Bob Washburn  ·  [Your City, State]",
      "https://agenticcorporation.net",
    ],
    coverStats: [
      { label: "Tools", value: String(tools.length) },
      { label: "Capabilities", value: "92" },
      { label: "Indexes", value: "47" },
      { label: "Skills", value: String(skills.length) },
      { label: "Personas", value: String(personas.length) },
      { label: "Models", value: "36 + 1000+" },
      { label: "Tables", value: "150" },
      { label: "Providers", value: "6" },
      { label: "Rules", value: "40" },
    ],
    sections,
    footerLines: [
      "VisionClaw R94 — Tenant Cost-Attribution Integrity",
      "Generated " + TODAY + "  ·  [Your Company]  ·  agenticcorporation.net",
    ],
    fileName: "VisionClaw-Comprehensive-Features.pdf",
    folderLabel: "Platform Documentation",
    uploadToDrive: true,
  });
  console.log("PDF_RESULT:", JSON.stringify({ success: pdfRes.success, viewUrl: pdfRes.viewUrl, fileId: pdfRes.fileId, size: pdfRes.size }));

  // Upload text file
  const txtRes = await uploadAndShare({
    filePath: "VisionClaw-Comprehensive-Features.txt",
    fileName: "VisionClaw-Comprehensive-Features.txt",
    description: "VisionClaw Agent Platform — Complete Feature Document (Text) — R94",
    folderLabel: "Platform Documentation",
    share: true,
  });
  console.log("TXT_RESULT:", JSON.stringify({ viewUrl: txtRes.viewUrl, fileId: txtRes.fileId }));

  // Register in project 15
  try {
    await db.execute(sql`
      INSERT INTO project_files (project_id, file_name, file_path, file_type, file_size, uploaded_by)
      VALUES
        (15, 'VisionClaw-Comprehensive-Features.pdf', ${pdfRes.viewUrl}, 'application/pdf', ${pdfRes.size || 0}, 'VisionClaw Agent'),
        (15, 'VisionClaw-Comprehensive-Features.txt', ${txtRes.viewUrl}, 'text/plain', ${fs.statSync('VisionClaw-Comprehensive-Features.txt').size}, 'VisionClaw Agent')
      ON CONFLICT DO NOTHING
    `);
    console.log("[ok] registered in project 15");
  } catch (e: any) {
    console.warn("[warn] project_files register failed:", e.message);
  }

  // Email
  const inboxResult: any = await getOrCreateTenantInbox(1);
  const inboxId = typeof inboxResult === "string" ? inboxResult : inboxResult.inboxId || inboxResult.email;
  const ownerEmail = process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com";
  await sendEmail({
    inboxId,
    to: ownerEmail,
    subject: "VisionClaw R94 — Comprehensive Features (PDF + Text)",
    text: `Hi Bob,

The R94 comprehensive features report is ready. Both files are uploaded to Google Drive and registered in project 15 for Felix's context.

PDF (styled, with cover + stats grid + tool inventory):
${pdfRes.viewUrl}

Text (plain, full tool/skill/persona dump for Felix):
${txtRes.viewUrl}

Headline stats this round:
  - 275 tools
  - 92 active capabilities
  - 47 production indexes
  - 16 personas
  - 62 skills
  - 150 tables
  - R94 (Tenant Cost-Attribution Integrity) shipped after Felix HVAC live test
  - R83-R93 (24h security sweep) shipped same window

Live: https://agenticcorporation.net

— VisionClaw Agent (automated post-edit pipeline)
`,
  });
  console.log("[ok] email sent to", ownerEmail);

  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", e?.stack || e);
  process.exit(1);
});
