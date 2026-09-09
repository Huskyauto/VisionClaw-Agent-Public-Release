// Comprehensive Features Generator — R74.13z-quat (Apr 29, 2026)
// Generates BOTH the styled PDF (auto-uploaded to Drive) AND the text companion,
// uploads the text to Drive, registers both in project_files for Felix access,
// and prints both Drive URLs for the chat reply + email.
//
// Pure executable: `npx tsx scripts/gen-r74-13z-quat-features.ts`

import * as fs from "node:fs";
import { execSync } from "node:child_process";

(async () => {
  // ─── Live data pulls ─────────────────────────────────────────────────────
  const tools = fs.readFileSync("/tmp/tool_names.txt", "utf-8")
    .split("\n").map(s => s.trim()).filter(Boolean).sort();
  const skillsRaw = fs.readFileSync("/tmp/skills_clean.txt", "utf-8");
  const skills = skillsRaw.split("\n").map(s => s.trim()).filter(Boolean).sort();
  const personas = [
    { id: 1,  name: "VisionClaw",      role: "General AI Assistant" },
    { id: 2,  name: "Felix",           role: "CEO Persona" },
    { id: 3,  name: "Forge",           role: "Staff Engineer" },
    { id: 4,  name: "Teagan",          role: "Content Marketing Specialist" },
    { id: 5,  name: "Agent Blueprint", role: "Multi-Agent System Operator" },
    { id: 6,  name: "Chief of Staff",  role: "Operations Director" },
    { id: 7,  name: "Scribe",          role: "Content Creator" },
    { id: 8,  name: "Proof",           role: "Content Reviewer" },
    { id: 9,  name: "Radar",           role: "Intelligence Analyst" },
    { id: 10, name: "Neptune",         role: "Deep Research Specialist" },
    { id: 11, name: "Apollo",          role: "Revenue & Pipeline Manager" },
    { id: 12, name: "Atlas",           role: "Metrics & Reporting Analyst" },
    { id: 13, name: "Cassandra",       role: "CFO — Chief Financial Officer" },
    { id: 14, name: "Luna",            role: "Legal & Compliance Officer" },
    { id: 15, name: "Minerva",         role: "Chief Planner — Strategic Plan Architect" },
    { id: 16, name: "Robert",          role: "Wellness Coach" },
  ];

  const STATS = {
    tools: tools.length,
    skills: skills.length,
    personas: personas.length,
    files: 473,
    lines: "179K",
    tables: 138,
    indexes: "322+",
    knowledge: 2029,
    bigCtxModels: 4,
  };

  // ─── 1. Generate styled PDF ───────────────────────────────────────────────
  console.log(`[gen] STATS: ${JSON.stringify(STATS)}`);
  console.log(`[gen] starting PDF generation...`);

  const { generateStyledPdf } = await import("../server/pdf-create");

  const groupTools = (list: string[]) => {
    const buckets: Record<string, string[]> = {
      "Communication & Email": [],
      "Research & Knowledge": [],
      "Browser & Web": [],
      "Documents & Media": [],
      "Code & Engineering": [],
      "CRM & Sales": [],
      "Finance & Billing": [],
      "Felix Loop & Governance": [],
      "Agent & Delegation": [],
      "Other & System": [],
    };
    for (const t of list) {
      if (/email|mail|inbox|notif|message|whatsapp|telegram|discord|slack|sms|hermes|tweet|x_/.test(t)) buckets["Communication & Email"].push(t);
      else if (/research|knowledge|memorize|knowledge|skill|recursive_synthesize|deep_research|sonar|web_search|web_fetch|extract_brand/.test(t)) buckets["Research & Knowledge"].push(t);
      else if (/browser|scrape|crawl|firecrawl|screenshot|puppeteer|workflow/.test(t)) buckets["Browser & Web"].push(t);
      else if (/pdf|doc|word|excel|sheet|slide|video|audio|image|figma|render|presentation|gen_/.test(t)) buckets["Documents & Media"].push(t);
      else if (/code|tsc|lint|tool_registry|registerTool|deploy|build_|test|github|git_|run_/.test(t)) buckets["Code & Engineering"].push(t);
      else if (/customer|lead|contact|crm|pipeline|sequence|outreach|company|sales|opportunity|deal/.test(t)) buckets["CRM & Sales"].push(t);
      else if (/invoice|expense|cash|finance|stripe|payment|billing|subscription|coinbase|kpi|portfolio/.test(t)) buckets["Finance & Billing"].push(t);
      else if (/felix|proposal|approve|reject|loop_/.test(t)) buckets["Felix Loop & Governance"].push(t);
      else if (/agent|delegate|persona|orchestrate|ensemble|cross_critique|debate|tree_of_thought|crew|flow/.test(t)) buckets["Agent & Delegation"].push(t);
      else buckets["Other & System"].push(t);
    }
    return buckets;
  };
  const toolBuckets = groupTools(tools);

  const skillSubsections = [
    {
      title: `All ${skills.length} Active Skills (alphabetical)`,
      content: skills.join(", "),
    },
  ];

  const personaSubsections = personas.map(p => ({
    title: `Persona ${p.id}: ${p.name}`,
    content: p.role,
  }));

  const toolSubsections = Object.entries(toolBuckets)
    .filter(([_, v]) => v.length > 0)
    .map(([cat, list]) => ({
      title: `${cat} (${list.length})`,
      content: list.join(", "),
    }));

  const result = await generateStyledPdf({
    title: "VisionClaw Agent Platform",
    subtitle: "Comprehensive Features — R74.13z-quat — April 29, 2026",
    companyLines: [
      "[Your Company] | EIN: [YOUR-EIN]",
      "Owner: Bob Washburn | [Your City, State]",
      "https://agenticcorporation.net",
    ],
    coverStats: [
      { label: "Tools", value: String(STATS.tools) },
      { label: "Skills", value: String(STATS.skills) },
      { label: "Personas", value: String(STATS.personas) },
      { label: "DB Tables", value: String(STATS.tables) },
      { label: "Files", value: String(STATS.files) },
      { label: "Lines", value: STATS.lines },
      { label: "Knowledge Items", value: String(STATS.knowledge) },
      { label: "Big-Ctx Models", value: `${STATS.bigCtxModels} (1M+)` },
      { label: "Auto-Push", value: "30s" },
    ],
    sections: [
      {
        title: "What Shipped This Round (R74.13z-quat — Apr 29, 2026)",
        content: "Two compounding upgrades addressing the same root cause: agents stalling on jobs they had the capacity to finish.",
        subsections: [
          {
            title: "1. Operating Doctrine — 8 points pushed to all 16 personas",
            bullets: [
              "DRIVE TO COMPLETION — half-done plus a status update is failure",
              "USE THE TOOLS YOU HAVE — scan inventory before bailing",
              "WHEN STUCK, CHANGE STRATEGY — never repeat the same approach",
              "THREE-STRIKE RULE BEFORE REPORTING FAILURE",
              "DON'T HAND BACK PROBLEMS YOU CAN SOLVE — explicit self-check",
              "RECOGNIZE LEVERAGE — cheap-tier first, premium when warranted",
              "FINISH-LINE SELF-REVIEW — did the user actually receive the deliverable",
              "TRUST THE 1M-CONTEXT AUTO-ESCALATION (see #2)",
            ],
          },
          {
            title: "2. Context-Overflow Auto-Escalation — Gemini 3.1 Pro 1M context",
            bullets: [
              "Old behavior: overflow → emergency-truncate every tool/assistant message to 800 chars → retry on same model (LOSSY, killed long-context jobs)",
              "New behavior: overflow → escalate to next 1M+ ctx model in chain → retry with full conversation intact",
              "Escalation chain: Gemini 3.1 Pro (1M, free) → Claude Opus 4.7 (1M, free) → Nemotron 3 Super (1M, cheap) → Grok 4.1 Fast (2M, cheap)",
              "Truncation is now the LAST resort — only fires after every 1M+ model also overflows (essentially never)",
              "Tools auto-re-enabled when escalating to a tool-capable provider after a non-tool failover",
              "Verified: 11/11 smoke test assertions pass; architect review PASS, no critical/high findings",
            ],
          },
        ],
      },
      {
        title: `Complete Tool Inventory (${tools.length} registered tools)`,
        content: "Every persona has access to this entire surface, gated by per-persona blocked-tools and per-tenant rate limits. Categorized below for readability — categorization is presentational only, the underlying registry is flat.",
        subsections: toolSubsections,
      },
      {
        title: `Complete Skills Inventory (${skills.length} active skills)`,
        content: "Skills are reusable agent playbooks loaded on-demand. Both Replit-provided and platform-custom skills are included.",
        subsections: skillSubsections,
      },
      {
        title: `Persona Roster — All ${personas.length} Active Personas`,
        content: "Each persona shares the same Operating Doctrine, tool surface, and platform contract. Specialization comes from soul/identity/operating_loop fields.",
        subsections: personaSubsections,
      },
      {
        title: "Recent Hardening Passes (Apr 28-29, 2026)",
        content: "Five rounds of architect-led code review + surgical fixes shipped over the last 48 hours.",
        subsections: [
          {
            title: "R74.13z (RLM Recovery)",
            bullets: [
              "Algorithm 1 from Zhang/Kraska/Khattab Recursive Language Models paper (arXiv:2512.24601v2) implemented as last-ditch chat recovery",
              "Sandboxed Node vm REPL with delete-after-bridge pattern — no host primordial leakage",
              "Defaults to gpt-5.4 root + gpt-5-mini sub (modelfarm, $0)",
              "Verified end-to-end: 25K-char log → correct answer in 2 rounds, 8 sub-calls, $0",
            ],
          },
          {
            title: "R74.13z-bis (Recursive Synthesize Tool)",
            bullets: [
              "RLM exposed as a first-class tool any persona can call explicitly",
              "Model allowlist on overrides — only $0 modelfarm models accepted",
              "Hard input cap (2MB content / 8KB task) before per-call work caps engage",
              "9 assertions pass in 27.8s, $0",
            ],
          },
          {
            title: "R74.13z-tris (Whole-App Code Review)",
            bullets: [
              "Felix monthly $5 cap made atomic via db.transaction + pg_advisory_xact_lock",
              "AbortController wired into RLM recovery — client disconnects no longer leak sub-call capacity",
              "executeTool dispatcher rate-limit gate added — bypass paths now throttled",
              "Stripe webhook livemode parity check — test events cannot trigger production plan activations",
              "11 assertions pass in 18.6s, $0",
            ],
          },
          {
            title: "R74.13z-quat (This Round)",
            bullets: [
              "Operating Doctrine added to top of platform tools contract — first thing every persona reads",
              "Context-overflow auto-escalation to 1M+ ctx models before lossy truncation",
              "11 assertions pass in <1s, $0",
              "Architect PASS — no critical/high; one Low fixed inline",
            ],
          },
        ],
      },
      {
        title: "Multi-Channel Messaging & Delivery",
        bullets: [
          "Hermes gateway: WhatsApp Web (Baileys), Discord, Telegram, Email (AgentMail), SMS",
          "Customer delivery pipeline: enforced viewUrl on every digital deliverable",
          "Self-hosted media link layer for mobile-friendly previews (Google Drive preview broken on mobile workaround)",
          "Email noise filter (Attention Bus) — irrelevant/duplicate emails filtered before reaching Bob",
        ],
      },
      {
        title: "Payments, Billing & Storefront",
        bullets: [
          "Stripe Live (acct_1RSqoVKSnTglWdaV / [Your Company]) + Stripe Sandbox for development",
          "Coinbase crypto integration with secrets encrypted at rest",
          "Public storefront at /store with 5 SKUs, SKU-based Stripe Checkout, rate-limited",
          "Webhook security: signature verification + livemode parity + claim-then-commit dedupe",
          "BYOK tier system + pay-per-task credit pack pricing",
        ],
      },
      {
        title: "Database & Persistence",
        table: {
          headers: ["Metric", "Value"],
          rows: [
            ["Tables", String(STATS.tables)],
            ["Indexes", STATS.indexes],
            ["Active Skills", String(STATS.skills)],
            ["Knowledge Entries (agent_knowledge)", String(STATS.knowledge)],
            ["Active Personas", String(STATS.personas)],
            ["Registered Tools", String(STATS.tools)],
            ["Source Files (TS/TSX)", String(STATS.files)],
            ["Total Lines of Code", STATS.lines],
            ["Big-Context Fallback Models", `${STATS.bigCtxModels} (Gemini 3.1 Pro, Claude Opus 4.7, Nemotron 3 Super, Grok 4.1 Fast)`],
          ],
        },
      },
      {
        title: "Production Information",
        bullets: [
          "Production: https://agenticcorporation.net",
          "Company: [Your Company]",
          "EIN: [YOUR-EIN]",
          "Owner: Bob Washburn",
          "Location: [Your City, State]",
          "QR Code: https://agenticcorporation.net (scan to visit)",
          "Auto Git Push interval: 30 seconds",
          "GitHub primary: Huskyauto/VisionClaw-Agent",
          "GitHub public mirror: Huskyauto/VisionClaw-Agent-Public-Release",
        ],
      },
    ],
    footerLines: [
      "VisionClaw Agent Platform — Generated Apr 29, 2026 (R74.13z-quat)",
      "[Your Company] | EIN: [YOUR-EIN] | https://agenticcorporation.net",
    ],
    fileName: "VisionClaw-Comprehensive-Features.pdf",
    folderLabel: "Platform Documentation",
    uploadToDrive: true,
  });

  console.log(`[gen] PDF_RESULT: ${JSON.stringify({ success: result.success, viewUrl: result.viewUrl, fileId: result.fileId, size: result.size })}`);

  // ─── 2. Generate text companion ───────────────────────────────────────────
  const txtLines: string[] = [];
  const sep = "═".repeat(78);
  txtLines.push(sep);
  txtLines.push("VISIONCLAW AGENT PLATFORM — COMPREHENSIVE FEATURES");
  txtLines.push("R74.13z-quat — April 29, 2026");
  txtLines.push(sep);
  txtLines.push("");
  txtLines.push("[Your Company] | EIN: [YOUR-EIN]");
  txtLines.push("Owner: Bob Washburn | [Your City, State]");
  txtLines.push("Production: https://agenticcorporation.net");
  txtLines.push("QR Code: https://agenticcorporation.net (scan to visit)");
  txtLines.push("");
  txtLines.push("─── PLATFORM STATS ─────────────────────────────────────────────────");
  for (const [k, v] of Object.entries(STATS)) txtLines.push(`  ${k.padEnd(15)} : ${v}`);
  txtLines.push("");
  txtLines.push("─── WHAT SHIPPED THIS ROUND (R74.13z-quat) ─────────────────────────");
  txtLines.push("");
  txtLines.push("1. OPERATING DOCTRINE — 8 points pushed to all 16 personas");
  txtLines.push("   (1) Drive to completion — half-done + status update = failure");
  txtLines.push("   (2) Use the tools you have — scan inventory before bailing");
  txtLines.push("   (3) When stuck, change strategy — never repeat same approach");
  txtLines.push("   (4) Three-strike rule before reporting failure");
  txtLines.push("   (5) Don't hand back problems you can solve");
  txtLines.push("   (6) Recognize leverage — cheap-tier first, premium when warranted");
  txtLines.push("   (7) Finish-line self-review — did user receive the deliverable");
  txtLines.push("   (8) Trust the 1M-context auto-escalation");
  txtLines.push("");
  txtLines.push("2. CONTEXT-OVERFLOW AUTO-ESCALATION — Gemini 3.1 Pro 1M context");
  txtLines.push("   Chain (in order):");
  txtLines.push("     - Gemini 3.1 Pro          (1M, free)  — Bob's primary pick");
  txtLines.push("     - Claude Opus 4.7         (1M, free)  — Anthropic flagship");
  txtLines.push("     - Nemotron 3 Super        (1M, cheap) — NVIDIA OpenRouter");
  txtLines.push("     - Grok 4.1 Fast           (2M, cheap) — last resort");
  txtLines.push("   Truncation only fires after EVERY model in chain overflows (essentially never).");
  txtLines.push("");

  txtLines.push(`─── COMPLETE TOOL INVENTORY (${tools.length} REGISTERED) ─────────────────────`);
  for (const [cat, list] of Object.entries(toolBuckets)) {
    if (list.length === 0) continue;
    txtLines.push("");
    txtLines.push(`  [${cat}] (${list.length})`);
    for (const t of list) txtLines.push(`    - ${t}`);
  }
  txtLines.push("");
  txtLines.push(`─── COMPLETE SKILLS INVENTORY (${skills.length} ACTIVE) ────────────────────`);
  txtLines.push("");
  for (const s of skills) txtLines.push(`  - ${s}`);
  txtLines.push("");
  txtLines.push(`─── PERSONA ROSTER (${personas.length} ACTIVE) ────────────────────────────`);
  txtLines.push("");
  for (const p of personas) txtLines.push(`  ${String(p.id).padStart(2)}. ${p.name.padEnd(20)} — ${p.role}`);
  txtLines.push("");
  txtLines.push("─── RECENT HARDENING PASSES (Apr 28-29, 2026) ──────────────────────");
  txtLines.push("");
  txtLines.push("  R74.13z       — Recursive Language Model recovery hook");
  txtLines.push("  R74.13z-bis   — recursive_synthesize as a first-class tool");
  txtLines.push("  R74.13z-tris  — Whole-app multi-area code review + 4 HIGH fixes");
  txtLines.push("  R74.13z-quat  — Operating Doctrine + 1M-ctx auto-escalation (THIS)");
  txtLines.push("");
  txtLines.push("─── PRODUCTION INFO ────────────────────────────────────────────────");
  txtLines.push("");
  txtLines.push("  Live URL          : https://agenticcorporation.net");
  txtLines.push("  Company           : [Your Company]");
  txtLines.push("  EIN               : [YOUR-EIN]");
  txtLines.push("  Owner             : Bob Washburn");
  txtLines.push("  Location          : [Your City, State]");
  txtLines.push("  Auto-push interval: 30 seconds");
  txtLines.push("  GitHub primary    : Huskyauto/VisionClaw-Agent");
  txtLines.push("  GitHub mirror     : Huskyauto/VisionClaw-Agent-Public-Release");
  txtLines.push("");
  txtLines.push(sep);
  txtLines.push("END OF DOCUMENT — VisionClaw Agent Platform — R74.13z-quat");
  txtLines.push(sep);

  const txtPath = "VisionClaw-Comprehensive-Features.txt";
  fs.writeFileSync(txtPath, txtLines.join("\n"));
  console.log(`[gen] TXT_WRITTEN: ${txtPath} (${fs.statSync(txtPath).size} bytes)`);

  // ─── 3. Upload text to Drive ──────────────────────────────────────────────
  const { uploadAndShare } = await import("../server/google-drive");
  const txtResult = await uploadAndShare({
    filePath: txtPath,
    fileName: "VisionClaw-Comprehensive-Features.txt",
    description: "VisionClaw Agent Platform — Complete Feature Document (Text) — R74.13z-quat",
    folderLabel: "Platform Documentation",
    share: true,
  });
  console.log(`[gen] TXT_RESULT: ${JSON.stringify({ viewUrl: txtResult.viewUrl, fileId: txtResult.fileId })}`);

  // ─── 4. Register both in project_files (project 15 = Felix presentation) ──
  const { db } = await import("../server/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    INSERT INTO project_files (project_id, file_name, file_path, file_type, file_size, uploaded_by, tenant_id)
    VALUES (15, 'VisionClaw-Comprehensive-Features.pdf', ${result.viewUrl}, 'application/pdf', ${result.size || 0}, 'VisionClaw Agent', 1)
    ON CONFLICT DO NOTHING
  `).catch((e: any) => console.warn(`[gen] project_files PDF insert warning: ${e?.message?.slice(0, 120)}`));
  await db.execute(sql`
    INSERT INTO project_files (project_id, file_name, file_path, file_type, file_size, uploaded_by, tenant_id)
    VALUES (15, 'VisionClaw-Comprehensive-Features.txt', ${txtResult.viewUrl}, 'text/plain', ${fs.statSync(txtPath).size}, 'VisionClaw Agent', 1)
    ON CONFLICT DO NOTHING
  `).catch((e: any) => console.warn(`[gen] project_files TXT insert warning: ${e?.message?.slice(0, 120)}`));

  // ─── 5. Email Bob with both Drive links ───────────────────────────────────
  const { getOrCreateTenantInbox, sendEmail } = await import("../server/email");
  const inboxResult: any = await getOrCreateTenantInbox(1);
  const inboxId = typeof inboxResult === "string" ? inboxResult : (inboxResult.inboxId || inboxResult.email);

  const emailBody = [
    `Bob,`,
    ``,
    `R74.13z-quat is shipped + documented. Both deliverables are below — direct Google Drive links for view + download.`,
    ``,
    `PDF (styled, ${result.size ? Math.round(result.size / 1024) + ' KB' : 'sized'}):`,
    `${result.viewUrl}`,
    ``,
    `TEXT (Felix's knowledge-base copy):`,
    `${txtResult.viewUrl}`,
    ``,
    `What's in this round:`,
    `  1. Operating Doctrine — 8 points pushed to all 16 personas`,
    `  2. Context-overflow auto-escalation to Gemini 3.1 Pro (1M ctx)`,
    `     Chain: Gemini 3.1 Pro (1M, free) → Claude Opus 4.7 (1M, free) → Nemotron 3 Super (1M, cheap) → Grok 4.1 Fast (2M, cheap)`,
    `     Truncation only fires if every 1M+ model also overflows (essentially never).`,
    ``,
    `Stats: ${STATS.tools} tools, ${STATS.skills} skills, ${STATS.personas} personas, ${STATS.tables} tables, ${STATS.files} source files, ${STATS.lines} lines.`,
    ``,
    `Architect review: PASS — no critical/high findings.`,
    `Smoke test: 11/11 assertions pass, $0.`,
    ``,
    `— VisionClaw Agent`,
  ].join("\n");

  await sendEmail({
    inboxId,
    to: process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com",
    subject: "VisionClaw R74.13z-quat — Comprehensive Features (PDF + Text) — Direct Drive Links",
    text: emailBody,
  });
  console.log(`[gen] EMAIL_SENT to ${process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com"}`);

  console.log(``);
  console.log(`═══════════════════════════════════════════════════════════════════`);
  console.log(`PIPELINE COMPLETE`);
  console.log(`PDF: ${result.viewUrl}`);
  console.log(`TXT: ${txtResult.viewUrl}`);
  console.log(`═══════════════════════════════════════════════════════════════════`);

  process.exit(0);
})().catch(err => {
  console.error(`[gen] FATAL: ${err?.message}\n${err?.stack}`);
  process.exit(1);
});
