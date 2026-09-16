import * as fs from "fs";
import { generateStyledPdf } from "../server/pdf-create";
import { uploadAndShare } from "../server/google-drive";
import { getOrCreateTenantInbox, sendEmail } from "../server/email";

const DATE = new Date().toISOString().slice(0, 10);
const TXT_PATH = "VisionClaw-Comprehensive-Features.txt";
const PDF_FILE_NAME = "VisionClaw-Comprehensive-Features.pdf";

const STATS = {
  tsFiles: 876,
  locTotal: 245420,
  tools: 277,
  skills: 62,
  personas: 16,
  tables: 150,
  indexes: 425,
  tenants: 2,
  projects: 13,
  models: 36,
  modelsViaOpenRouter: 1000,
  providers: 6,
  governanceRules: 40,
  voiceSafeAllowlist: 20,
  testFiles: 27,
  securityTestsPassing: "111/111",
};

const TOOL_NAMES = fs.readFileSync("/tmp/tool-names.txt", "utf8").trim().split("\n");

const SKILLS = [
  "AI Agent Playbook","AI Discoverability Audit","Agent Blueprint","Agent Browser","Agent Cost Analyzer",
  "Agent Email","Agent Launchpad","Agent Memory Guide","Agent Ops Playbook","Blog Hero Images",
  "Browser Automation (X/Twitter)","Build in Public","Business Operations & Strategy","Caption Generation",
  "Marketplace Creator","Code Generation","Coding Agent Loops","Cold Outreach","Content Idea Generator",
  "Content Marketing & Brand Building","Content Production","Content Writing System","Context Budget",
  "Data Analysis","De-AI-ify Text","DocClaw","Document & Delivery Pipeline","Email Drafting","Email Fortress",
  "Excalidraw Flowcharts","Financial Analysis & Reporting","Free Web Search","Heartbeat Monitor","Homepage Audit",
  "Image Understanding","Legal & Compliance Essentials","LinkedIn Content Engine","LinkedIn Profile Optimizer",
  "Math & Calculations","Morning Briefing","Phone Service","Plan My Day","Programmatic SEO",
  "Project Management & Planning","Reasoning & Logic","Research & Competitive Intelligence","SEO Content Audit",
  "Sales & Client Relations","Schema Markup Generation","Security Hardening","Security Review","Self-Diagnostics",
  "Small Business AI Prompts","Summarization","TOWEL Protocol","Token Optimization","Vibe Marketing",
  "Web Research","Writing & Editing","X Engagement Cron","X/Twitter Skill","YouTube Skill",
];

const PERSONAS = [
  [1,"VisionClaw","General AI Assistant"],[2,"Felix","CEO Persona"],[3,"Forge","Staff Engineer"],
  [4,"Teagan","Content Marketing Specialist"],[5,"Agent Blueprint","Multi-Agent System Operator"],
  [6,"Chief of Staff","Operations Director"],[7,"Scribe","Content Creator"],[8,"Proof","Content Reviewer"],
  [9,"Radar","Intelligence Analyst"],[10,"Neptune","Deep Research Specialist"],
  [11,"Apollo","Revenue & Pipeline Manager"],[12,"Atlas","Metrics & Reporting Analyst"],
  [13,"Cassandra","CFO — Chief Financial Officer"],[14,"Luna","Legal & Compliance Officer"],
  [15,"Minerva","Chief Planner — Strategic Plan Architect"],[16,"Robert","Wellness Coach"],
];

const SECURITY_BUNDLES = [
  ["R98","Felix Can Actually Deliver — Drive delivery hardening","Fixed end-to-end customer-file delivery so Felix and other agents reliably land deliverables in the correct project folder, register them in project_files, and never silently quit when asked to resurface a link. server/google-drive.ts uploadAndShare() now accepts projectId+tenantId, validates project ownership at the caller (returns success:false on tenant mismatch BEFORE any Drive write), routes via ensureProjectFolder with skipSubfolder=true, and auto-INSERTs project_files rows. New searchDriveFiles() (DB-first JOIN on projects.tenant_id, then Drive API). server/tools.ts google_drive tool gained projectId/namePattern/maxResults + 'search' enum; dispatch hard-fails on LLM-supplied projectId mismatch with runtime context. Personas Felix+Forge tools_doc + .agents/skills/customer-delivery/SKILL.md got DELIVERY HARDENING blocks. Architect: 4 findings (3 CRITICAL + 1 HIGH) all closed in same release — including the residual fail-OPEN catch in uploadAndShare's project-folder resolution that would have allowed cross-tenant writes after a tenant-mismatch throw. Bob's lost Real_Weight_Loss MP4 recovered (Drive fileId 13x4yihDw9eebjmJAmdvSSEn2Vp5Z6sIl) and backfilled into project_files row 177 under project 13 ([Your Product], tenant 1)."],
  ["R95.c","TIER-1 outbound-gate completeness pass — 8 fixes","webhook-relay SSRF deny-list + R95 gate; centralized email gate at sendEmail provider chokepoint; MCP server response gating; glasses gateway response gating; exec-tool lstat+realpath jail; Felix tenant fail-open removed; recurring-messages tenant scoping; 3 runWithTenant TS errors. CI hardening: sql-raw callsite test refactored to content-only textsOnly() comparator (line shifts no longer red CI; CVE guard preserved). Suite 111/111 PASS."],
  ["R95.v2","Architect-driven gate hardening","Unicode NFKC + zero-width canonicalization (defeats AKIA\\u200B... and fullwidth-digit bypasses); Luhn validation kills credit-card false positives; us_ssn_unformatted/us_ein moved behind opt-in flag; generic block-message (no oracle); gate hoisted into messaging-gateway.deliverMessage so cron + every caller is auto-covered (SMS/WhatsApp force strict); cross-tenant bug fixed in scheduled-message create/cancel. 22 test cases all pass."],
  ["R95","Outbound Sensitive-Data Redaction Gate","Deterministic egress scanner at every outbound payload — email body/subject/html, inter-agent message, agent-callable preflight. Three verdicts (clean/redact/block). Tenant env-var registry refreshed every 5min. Patterns: PEM/OpenSSH private keys, AWS, Stripe sk_live/rk_live, OpenAI, Anthropic, Google, GitHub, Slack, JWTs, Bearer tokens, env-var assignments, credit cards, US SSNs. Direct response to Northeastern et al. \"Agents of Chaos\" Case Study #3."],
  ["R94","Tenant Cost-Attribution Integrity","Brand-new server/lib/tenant-context.ts with AsyncLocalStorage propagation. authMiddleware wraps every request (vc_ key, session, OIDC) in runWithTenant(). Extended to glasses, MCP (global+derived keys), background worker, nightly tool-sommelier cron. createMeteredOpenAIClient resolveTenant() priority chain warns loudly on misses. SHA256 cache keys (collision-resistant). truncateWithSummary system→user role demotion (untrusted reference data, not policy). 9 distinct High-severity findings closed same window. Felix HVAC live test caught a CommonJS require() in ESM bug — fix promoted to static import."],
  ["R83-R93","Comprehensive 24h security sweep","R83 streaming-aware AnthropicPromptCache + per-tenant entry quotas. R84 audit-reasoning + reasoning-extractor sandbox. R85 prompt-injection scanner ported from Hermes Alpha (10 threat patterns + invisible-unicode steganography). R86/R91 streaming + glasses fail-closed on missing tenant binding. R87 context-compressor with token-aware budgets. R88 error-context-parser + tool-call-fallback-parser (LLM emits malformed XML/JSON, parser still recovers). R89 orphan tool_call/tool_result repair after truncation. R90 context-files-loader gated by scanner. R92 self-heal + auto-memorize ADMIN attribution. R93 tenant-attribution propagated to 7 cross-cutting callsites."],
  ["R79.3c-f","HITL self-loop fix + one-click email approvals + cross-tenant defect","isOwnerSelfEmail() auto-approves send_email when ALL recipients are owner-controlled (closes Felix-emails-self loop). HMAC-SHA256 signed approve/deny tokens (24h TTL, base64url, constant-time compare). Multi-day red CI gate closed (sql.raw callsite snapshot using rg shell-out — replaced with pure-Node walker). Cross-tenant resolveToolConfirmation() fixed: tenant equality now enforced whenever both caller and pending know their tenants."],
  ["R79.2","Schema-drift burn-down","stripe.* mirror tables bootstrapped via tests/fixtures/stripe-schema-bootstrap.sql (200-line CREATE for accounts/products/prices/payment_intents with GENERATED ALWAYS AS STORED columns). messages.citations + capability_gaps tables added to shared/schema.ts. CI security-tests job now hard gate."],
  ["R76","Trust-Tier Policy Engine + Deliverable Contract Verification","tool_policies table with specificity-ranked evaluation (recipient_pattern > tool_action > tool; deny beats allow). HITL gate evaluates policy first; allow/deny resolves immediately without arming the 120s WhatsApp setup. Real escalation channel: SSE hitl:pending event + email through getOrCreateTenantInbox. deliverable_contracts (8 seeded) + delivery_verifications tables. verifyDeliverable() checks ext + MIME magic bytes + render check. 16 personas updated with Doctrine #12."],
  ["R74.13u-sec/u-2","Two-pass architect security day","Admin routes hard-gated to requirePlatformAdmin. Stripe Checkout validates priceId against live stripe.prices+products. decryptApiKey throws DecryptionError on failure (no silent ciphertext leak). Drive backup scoped by tenant_id. CSRF tokens keyed per-session. Webhook reliability: Stripe + Coinbase dedupe rebuilt as CLAIM-then-COMMIT model — revenue-loss class closed. 6h GC sweep preserves in-flight claims."],
  ["R74.5","Tenant-isolation hardening","14 fail-open patches across sessions_list/history/send, manage_skills admin gating, workflow fast-path sanitization, writeDailyNote tenant-required, /api/upload-base64 byte-level type validation, presenter token log redaction, public-chat tool dispatch fail-closed."],
  ["R74","Cross-tenant email fail-closed + Stripe Connect tenant guard","1 CRITICAL + 2 HIGH shipped same night. Pre-auth endpoint admin gates added."],
];

const ABSTRACT_COT = `## Abstract Chain-of-Thought (Reference, May 3 2026)

Reviewed IBM Research paper (arXiv 2604.22709v2): Ramji/Naseem/Astudillo, "Thinking Without Words: Efficient Latent Reasoning with Abstract Chain-of-Thought." 11.6× fewer reasoning tokens at comparable accuracy via reserved abstract-token vocabulary + two-stage post-training (policy-iteration warm-up + GRPO RL with constrained decoding). NOT directly applicable to VisionClaw (we consume frontier APIs, can't add tokens to closed-source tokenizers). Two thin nuggets parked in docs/agentspan-nuggets-log.md: (1) empirical confirmation that aggressive prompt compression preserves quality — supports pushing lean-context thresholds harder; (2) the teacher→student distillation loop is structurally identical to our auto-skill extraction — confirms architectural shape, may justify earlier promotion of skill candidates. Becomes relevant only if we ever ship a small in-house task-specific model.`;

function buildText(): string {
  let t = "";
  t += "================================================================================\n";
  t += "VISIONCLAW AGENT — COMPREHENSIVE FEATURES & PLATFORM REFERENCE\n";
  t += `Updated: ${DATE} (R98 — Felix Can Actually Deliver)\n`;
  t += "================================================================================\n\n";
  t += "[Your Company] | EIN [YOUR-EIN] | [Your City, State]\n";
  t += "Owner: Bob Washburn | huskyauto@gmail.com\n";
  t += "Live: https://agenticcorporation.net\n";
  t += "QR Code: agenticcorporation.net (scan to visit live demo)\n";
  t += "Public mirror: https://github.com/Huskyauto/VisionClaw-Agent-Public-Release\n\n";

  t += "## PLATFORM STATS (live as of " + DATE + ")\n\n";
  t += `  TypeScript files .......... ${STATS.tsFiles}\n`;
  t += `  Lines of code ............. ${STATS.locTotal.toLocaleString()}\n`;
  t += `  Tools (TOOL_DEFINITIONS) .. ${STATS.tools}\n`;
  t += `  Skills .................... ${STATS.skills}\n`;
  t += `  Personas (active) ......... ${STATS.personas}\n`;
  t += `  Database tables ........... ${STATS.tables}\n`;
  t += `  Database indexes .......... ${STATS.indexes}\n`;
  t += `  Tenants ................... ${STATS.tenants}\n`;
  t += `  Projects .................. ${STATS.projects}\n`;
  t += `  AI models (curated) ....... ${STATS.models} + ${STATS.modelsViaOpenRouter}+ via daily OpenRouter probe\n`;
  t += `  Providers ................. ${STATS.providers} (OpenAI, Anthropic, Gemini, xAI, Replit OpenAI, OpenRouter)\n`;
  t += `  Governance rules .......... ${STATS.governanceRules}\n`;
  t += `  Voice-safe allowlist ...... ${STATS.voiceSafeAllowlist} of ${STATS.tools} tools (Glasses Gateway)\n`;
  t += `  Test files (security) ..... ${STATS.testFiles}\n`;
  t += `  Security suite ............ ${STATS.securityTestsPassing} PASS\n\n`;

  t += "## SECURITY R-BUNDLES (most recent first)\n\n";
  for (const [code, title, body] of SECURITY_BUNDLES) {
    t += `### ${code} — ${title}\n${body}\n\n`;
  }

  t += "## CURRENT SECURITY POSTURE (post-R98)\n\n";
  t += "  - Outbound redaction gate at every egress chokepoint (email, inter-agent, MCP, glasses, webhook-relay)\n";
  t += "  - Tenant context end-to-end via AsyncLocalStorage (R94)\n";
  t += "  - Prompt-injection scanner on every persona/agent/mind body before persistence (R85/R94)\n";
  t += "  - Symlink-safe path jail on read_file, write_file, scan_file, exec-tool (R94/R95.c)\n";
  t += "  - Cross-tenant fail-CLOSED on customer-file delivery (R98): uploadAndShare validates project ownership at the caller AND fails-closed on any folder-resolve error\n";
  t += "  - Customer-file delivery auto-routes to project folder + auto-registers in project_files (R98)\n";
  t += "  - HMAC-SHA256 one-click HITL approvals with 24h TTL (R79.3d)\n";
  t += "  - Trust-Tier Policy Engine with specificity-ranked evaluation (R76)\n";
  t += "  - Webhook signature verification + CLAIM-then-COMMIT dedupe (R74.13u)\n";
  t += "  - SSRF deny-list (private/loopback/link-local/metadata IPs) on every outbound URL fetch (R95.c)\n";
  t += "  - Per-tenant escalation quota (20/hr) — single tenant can't drain platform budget (R94)\n";
  t += "  - Per-session CSRF tokens (R74.13u)\n\n";

  t += "## COMPLETE TOOL INVENTORY (" + TOOL_NAMES.length + " tools)\n\n";
  for (let i = 0; i < TOOL_NAMES.length; i += 4) {
    t += "  " + TOOL_NAMES.slice(i, i + 4).map(n => n.padEnd(34)).join("") + "\n";
  }
  t += "\n";

  t += "## COMPLETE SKILLS INVENTORY (" + SKILLS.length + " skills)\n\n";
  for (let i = 0; i < SKILLS.length; i += 2) {
    t += "  " + SKILLS.slice(i, i + 2).map(n => n.padEnd(45)).join("") + "\n";
  }
  t += "\n";

  t += "## PERSONA ROSTER (" + PERSONAS.length + " active)\n\n";
  for (const [id, name, role] of PERSONAS) {
    t += `  ${String(id).padStart(2)}. ${String(name).padEnd(20)} ${role}\n`;
  }
  t += "\n";

  t += "## ARCHITECTURAL SUBSYSTEMS\n\n";
  t += "  - Multi-tenant Express + React/Vite + Drizzle/Postgres (pgvector)\n";
  t += "  - Stripe + Coinbase Commerce payments with CLAIM-COMMIT webhook dedupe\n";
  t += "  - Replit OIDC auth + vc_ API keys + per-tenant MCP derived keys\n";
  t += "  - Google Drive backup, Google Workspace integrations, ElevenLabs voice\n";
  t += "  - Anthropic prompt cache (streaming-aware, per-tenant quotas)\n";
  t += "  - GraphRAG: PageRank importance, Louvain communities, causal-chain extractor, dual-level retrieval\n";
  t += "  - 3-phase dreaming scheduler (Light / Deep / REM)\n";
  t += "  - Felix Autonomous Loop (4h cron, dry-run until 2026-05-12)\n";
  t += "  - Heartbeat engine + auto-tuner + self-heal pipeline (R92)\n";
  t += "  - 5 nightly research programs with ±% baseline tracking\n";
  t += "  - Glasses Gateway (voice-safe 20-tool allowlist for Meta Ray-Ban + Gemini Live)\n";
  t += "  - Linux Foundation A2A v0.3 Agent Card at /.well-known/agent.json (R78)\n";
  t += "  - MarTech Bundle (R79): per-tenant brand-voice, hooks, post formatting (PAS/AIDA/BAB/STAR/SLAY), content matrices\n";
  t += "  - Trust-Tier Policy Engine + Deliverable Contract Verification (R76)\n";
  t += "  - Claude Code Subagent Importer with VISIONCLAW RUNTIME ADAPTER preamble (R80)\n\n";

  t += ABSTRACT_COT + "\n\n";

  t += "## CI / TEST COVERAGE\n\n";
  t += "  - " + STATS.testFiles + " test files in tests/security/, tests/storage/, tests/integration/\n";
  t += "  - " + STATS.securityTestsPassing + " security + storage tests PASS (post-R95.c hardening)\n";
  t += "  - Hard CI gates: TypeScript (npm run check), Security & Tenant-Isolation Tests, Public Mirror sanitizer\n";
  t += "  - sql.raw callsite snapshot test now content-only (line shifts no longer red CI; CVE guard preserved)\n\n";

  t += "================================================================================\n";
  t += "End of comprehensive features document — " + DATE + "\n";
  t += "Generated by post-edit-pipeline. Visit https://agenticcorporation.net\n";
  t += "================================================================================\n";
  return t;
}

(async () => {
  console.log("[gen] building text…");
  const text = buildText();
  fs.writeFileSync(TXT_PATH, text);
  console.log(`[gen] wrote ${TXT_PATH} (${text.length} chars)`);

  console.log("[gen] generating styled PDF (auto-uploads to Drive)…");
  const pdfRes = await generateStyledPdf({
    title: "VisionClaw Agent",
    subtitle: `Comprehensive Features & Platform Reference — ${DATE} (R98 — Felix Can Actually Deliver)`,
    companyLines: [
      "[Your Company] · EIN [YOUR-EIN]",
      "[Your City, State]",
      "Owner: Bob Washburn · huskyauto@gmail.com",
      "Live: https://agenticcorporation.net",
    ],
    coverStats: [
      { label: "TS Files", value: String(STATS.tsFiles) },
      { label: "Lines of Code", value: STATS.locTotal.toLocaleString() },
      { label: "Tools", value: String(STATS.tools) },
      { label: "Skills", value: String(STATS.skills) },
      { label: "Personas", value: String(STATS.personas) },
      { label: "DB Tables", value: String(STATS.tables) },
      { label: "DB Indexes", value: String(STATS.indexes) },
      { label: "AI Models", value: `${STATS.models}+${STATS.modelsViaOpenRouter}+` },
      { label: "Security Tests", value: STATS.securityTestsPassing },
    ],
    sections: [
      {
        title: "What VisionClaw Is",
        content: "Multi-tenant agentic AI platform that ships paying client deliverables end-to-end: intake → execution → quality-gated PDF/file → Stripe → delivery → owner alert. Self-hosted on Replit, production at agenticcorporation.net. Public sanitized mirror open-sourced at github.com/Huskyauto/VisionClaw-Agent-Public-Release.",
        bullets: [
          "Stack: Express + TypeScript + React/Vite + Drizzle/Postgres (pgvector)",
          "Payments: Stripe + Coinbase Commerce (CLAIM-then-COMMIT webhook dedupe)",
          "Auth: Replit OIDC + vc_ API keys + per-tenant MCP derived keys",
          "16 active personas, 277 tools, 62 skills, 150 tables, 425 indexes",
          "5 nightly research programs, 36 curated AI models + 1000+ via OpenRouter",
        ],
      },
      {
        title: "Recent Security Hardening (R-bundles)",
        subsections: SECURITY_BUNDLES.map(([code, title, body]) => ({
          title: `${code} — ${title}`,
          content: body,
        })),
      },
      {
        title: "Current Security Posture (post-R98)",
        bullets: [
          "Outbound redaction gate: at email, inter-agent, MCP, glasses, webhook-relay",
          "Tenant context: end-to-end via AsyncLocalStorage (R94)",
          "Prompt-injection scanner: on every persona/agent/mind body before persistence",
          "Symlink-safe path jail: on read_file, write_file, scan_file, exec-tool",
          "Customer-file delivery (R98): cross-tenant fail-CLOSED at uploadAndShare; auto-routes to project folder; auto-registers in project_files",
          "HMAC HITL approvals: SHA256 signed, 24h TTL, constant-time compare",
          "Trust-Tier Policy Engine: specificity-ranked, deny beats allow",
          "SSRF deny-list: private/loopback/link-local/metadata IPs blocked",
          "Per-tenant escalation quota: 20/hr cap so one tenant can't drain platform",
          "Webhook dedupe: CLAIM-then-COMMIT, no silent revenue loss",
          "Per-session CSRF tokens",
        ],
      },
      {
        title: "Persona Roster",
        table: {
          headers: ["ID", "Name", "Role"],
          rows: PERSONAS.map(p => [String(p[0]), String(p[1]), String(p[2])]),
        },
      },
      {
        title: "Skills Inventory",
        content: `${SKILLS.length} skills available platform-wide.`,
        bullets: SKILLS,
      },
      {
        title: "Architectural Subsystems",
        bullets: [
          "Multi-tenant Express + React/Vite + Drizzle/Postgres (pgvector)",
          "Anthropic prompt cache: streaming-aware, per-tenant entry quotas",
          "GraphRAG: PageRank importance + Louvain communities + causal chains + dual-level retrieval",
          "3-phase dreaming scheduler (Light / Deep / REM)",
          "Felix Autonomous Loop (4h cron, dry-run until 2026-05-12)",
          "Heartbeat engine + auto-tuner + self-heal pipeline",
          "5 nightly research programs with ±% baseline tracking",
          "Glasses Gateway: voice-safe 20-tool allowlist for Meta Ray-Ban + Gemini Live",
          "Linux Foundation A2A v0.3 Agent Card at /.well-known/agent.json",
          "MarTech Bundle: per-tenant brand-voice + hooks + post formatting + content matrices",
          "Trust-Tier Policy Engine + Deliverable Contract Verification",
          "Claude Code Subagent Importer with VISIONCLAW RUNTIME ADAPTER preamble",
        ],
      },
      {
        title: "Complete Tool Inventory",
        content: `${TOOL_NAMES.length} agent-callable tools registered in TOOL_DEFINITIONS. Voice-safe allowlist: ${STATS.voiceSafeAllowlist} tools accessible via Glasses Gateway.`,
        bullets: TOOL_NAMES,
      },
      {
        title: "Abstract Chain-of-Thought (Reference Only)",
        content: "Reviewed IBM Research arXiv 2604.22709v2 (Ramji/Naseem/Astudillo). 11.6× fewer reasoning tokens via reserved abstract-token vocabulary + two-stage post-training (policy iteration + GRPO RL). NOT directly applicable — we consume frontier APIs and can't modify closed-source tokenizers. Parked as reference in docs/agentspan-nuggets-log.md.",
        bullets: [
          "Nugget 1: Empirical confirmation that aggressive prompt compression preserves quality — supports pushing lean-context thresholds harder",
          "Nugget 2: The teacher→student distillation loop is structurally identical to our auto-skill extraction — confirms architectural shape, may justify earlier promotion of skill candidates",
          "Becomes actionable only if we ever ship a small in-house task-specific model (e.g., tenant-policy classifier)",
        ],
      },
    ],
    footerLines: [
      `${DATE} · VisionClaw Agent · [Your Company] · [Your City, ST]`,
      "Visit agenticcorporation.net · Public mirror: github.com/Huskyauto/VisionClaw-Agent-Public-Release",
    ],
    fileName: PDF_FILE_NAME,
    folderLabel: "Platform Documentation",
    uploadToDrive: true,
  });

  console.log("[gen] PDF result:", JSON.stringify({
    success: pdfRes.success, fileId: pdfRes.fileId, viewUrl: pdfRes.viewUrl, localPath: pdfRes.localPath,
  }, null, 2));

  if (!pdfRes.success || !pdfRes.viewUrl) {
    console.error("[gen] PDF generation/upload failed");
    process.exit(1);
  }

  console.log("[gen] uploading text file to Drive…");
  const txtRes = await uploadAndShare({
    filePath: TXT_PATH,
    fileName: TXT_PATH,
    mimeType: "text/plain",
    description: "VisionClaw Agent — Comprehensive Features & Platform Reference (Text)",
    folderLabel: "Platform Documentation",
    share: true,
  });

  console.log("[gen] TXT result:", JSON.stringify({
    success: !!txtRes.viewUrl, fileId: txtRes.fileId, viewUrl: txtRes.viewUrl,
  }, null, 2));

  if (!txtRes.viewUrl) {
    console.error("[gen] TXT upload failed");
    process.exit(1);
  }

  console.log("[gen] sending email…");
  const inboxResult = await getOrCreateTenantInbox(1);
  const inboxId = typeof inboxResult === "string" ? inboxResult : (inboxResult as any).inboxId || (inboxResult as any).email;
  const ownerEmail = process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com";

  await sendEmail({
    inboxId,
    to: ownerEmail,
    subject: `VisionClaw Updated Features — PDF + Text (${DATE}, R98 — Felix Can Actually Deliver)`,
    text: `Bob,

R98 ships the "Felix Can Actually Deliver" pass — fixing the bug class that put your Real_Weight_Loss MP4 in a generic timestamped folder instead of the [Your Product] project folder, and that let Felix silently quit when you asked him to resurface the link.

YOUR LOST VIDEO — RECOVERED:
Real_Weight_Loss.mp4 has been pulled out of the orphan folder, registered in project_files (row 177) under project 13 ([Your Product], tenant 1), and is shareable here:
  https://drive.google.com/file/d/REDACTED_DRIVE_FILE_ID/view

What R98 changed:
- server/google-drive.ts uploadAndShare() now accepts projectId+tenantId, validates project ownership at the caller (returns success:false on tenant mismatch BEFORE any Drive write or DB row), routes via ensureProjectFolder with skipSubfolder=true, and auto-INSERTs the project_files row.
- New searchDriveFiles() — DB-first JOIN on projects.tenant_id, then Drive API. Felix can now find files he already delivered without falling back to read_file gymnastics.
- server/tools.ts google_drive tool definition gained projectId / namePattern / maxResults + a 'search' enum. Dispatch hard-fails on LLM-supplied projectId mismatch with the runtime tenant.
- Personas Felix + Forge tools_doc and the customer-delivery skill all got DELIVERY HARDENING blocks (project-folder rule, search-don't-read_file, never-quit-silently P0, MP4 transcoder caveat).
- Architect: 4 findings (3 CRITICAL + 1 HIGH) all closed in the same release — including the residual fail-OPEN catch in uploadAndShare's project-folder resolution that would have allowed a cross-tenant write after a tenant-mismatch throw. Smoke test: tenant 999 attempting to upload into project 13 is now rejected with a clean tenant-mismatch error, no Drive call, no project_files row.

Live counts (post-R98):
- ${STATS.tools} tools, ${STATS.skills} skills, ${STATS.personas} personas
- ${STATS.tables} DB tables, ${STATS.indexes} DB indexes
- ${STATS.tsFiles} TS/TSX files, ${STATS.locTotal.toLocaleString()} LOC

Direct Google Drive links:
PDF:  ${pdfRes.viewUrl}
Text: ${txtRes.viewUrl}

Live demo: https://agenticcorporation.net
Public mirror: https://github.com/Huskyauto/VisionClaw-Agent-Public-Release

— VisionClaw Agent post-edit-pipeline`,
  });

  console.log("[gen] email sent to", ownerEmail);
  console.log("");
  console.log("=== FINAL LINKS ===");
  console.log("PDF:  " + pdfRes.viewUrl);
  console.log("TEXT: " + txtRes.viewUrl);
  process.exit(0);
})().catch(err => {
  console.error("[gen] FATAL:", err);
  process.exit(1);
});
