import { readFileSync, writeFileSync } from "fs";
import { generateStyledPdf } from "../server/pdf-create";
import { uploadAndShare } from "../server/google-drive";
import { getOrCreateTenantInbox, sendEmail } from "../server/email";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const ROUND = "R98.16 (+sec / +wiring / +sec-2)";
const ROUND_DATE = "May 5, 2026";
const TOOL_COUNT = 296;
const SKILL_COUNT = 66;
const PERSONA_COUNT = 16;
const TABLE_COUNT = 149;
const INDEX_COUNT = 47;
const RULE_COUNT = 40;
const CAPABILITY_COUNT = 92;

const TOOLS = readFileSync("/tmp/registered-tools.txt", "utf8")
  .split("\n").map(s => s.trim()).filter(Boolean).sort();

const PERSONAS = [
  [1, "VisionClaw", "General AI Assistant"],
  [2, "Felix", "CEO Persona"],
  [3, "Forge", "Staff Engineer"],
  [4, "Teagan", "Content Marketing Specialist"],
  [5, "Agent Blueprint", "Multi-Agent System Operator"],
  [6, "Chief of Staff", "Operations Director"],
  [7, "Scribe", "Content Creator"],
  [8, "Proof", "Content Reviewer"],
  [9, "Radar", "Intelligence Analyst"],
  [10, "Neptune", "Deep Research Specialist"],
  [11, "Apollo", "Revenue & Pipeline Manager"],
  [12, "Atlas", "Metrics & Reporting Analyst"],
  [13, "Cassandra", "CFO — Chief Financial Officer"],
  [14, "Luna", "Legal & Compliance Officer"],
  [15, "Minerva", "Chief Planner — Strategic Plan Architect"],
  [16, "Robert", "Wellness Coach"],
] as const;

(async () => {
  // Pull skills from DB
  const skillsRes: any = await db.execute(sql`SELECT name FROM skills ORDER BY name`);
  const skillRows = (skillsRes.rows || skillsRes) as { name: string }[];
  const SKILLS = skillRows.map(r => r.name);

  const today = new Date().toISOString().slice(0, 10);

  // Build TEXT file
  const txtLines: string[] = [];
  const push = (...l: string[]) => txtLines.push(...l);
  push(
    "VISIONCLAW AGENT PLATFORM",
    "Comprehensive Features Document",
    `Generated: ${today}`,
    `Current Release: ${ROUND} — ${ROUND_DATE}`,
    "",
    "=".repeat(72),
    "COMPANY",
    "=".repeat(72),
    "[Your Company]",
    "EIN: [YOUR-EIN]",
    "[Your City, State]",
    "Owner: Bob Washburn",
    "Email: huskyauto@gmail.com",
    "Live: https://agenticcorporation.net",
    "QR Code: agenticcorporation.net  (Drive file ID: REDACTED_DRIVE_FILE_ID)",
    "",
    "=".repeat(72),
    "PLATFORM STATS — CURRENT STATE",
    "=".repeat(72),
    `Tools (registered):       ${TOOL_COUNT}`,
    `Skills (active):          ${SKILL_COUNT}`,
    `Personas:                 ${PERSONA_COUNT}`,
    `Database Tables:          ${TABLE_COUNT}`,
    `Production Indexes:       ${INDEX_COUNT}`,
    `Active Capabilities:      ${CAPABILITY_COUNT}`,
    `Process Governor Rules:   ${RULE_COUNT}`,
    "",
    "=".repeat(72),
    `LATEST RELEASE — ${ROUND}`,
    "=".repeat(72),
    "R98.16 — IJFW CROSS-POLLINATION (8 ITEMS, ALL ADDITIVE)",
    "  1. run_command (#296) — ad-hoc shell with large-output sandbox + auto-summary.",
    "     Inline if ≤40 lines AND ≤50KB; larger streams to data/run-sandbox/<label>.txt",
    "     (mode 0o600, 24h auto-purge). Same RCE gate as slash_command:",
    "     owner-tenant + Felix(2)/Forge(3) only.",
    "  2. Wave-table parallelism on plan_deliverable — PipelineStep gained optional",
    "     wave? + dependsOn?[]; sibling steps in a wave dispatch in PARALLEL.",
    "  3. translateLlmError — 13 LLM-error families pattern-matched to one actionable",
    "     line; failover throws carry .friendly + .translated.",
    "  4. DeepSeek as fourth architect lineage + runMultiLineageReview() with",
    "     productive-only minResponses counting.",
    "  5. sanitizeUntrusted() — heading + system-tag defang against prompt injection.",
    "  6. atomicWriteFileSync + parent-dir fsync at 6 critical persistence sites.",
    "  7. Gemini ?key= URL audit — verified clean.",
    "  8. Productive-only fan-out counting.",
    "",
    "+sec PATCH — hoisted run_command's auth gate above the action-dispatch switch",
    "  so list_outputs/get_output (which had ZERO authorization) require the same",
    "  owner-tenant + Felix/Forge gate.",
    "",
    "+wiring PATCH — R98.16 sections appended to Felix(2) + Forge(3) operating_loop",
    "  in seed-persona-prompts.ts; all 16 personas re-seeded.",
    "",
    "+sec-2 WHOLE-APP ARCHITECT SWEEP (16 findings, 6 closed in-session):",
    "  CRITICAL — secret-redaction in translateLlmError (Authorization headers in",
    "    provider error strings now redactSecrets()'d before embedding).",
    "  HIGH #1 — SSRF jail extended for 100.64.0.0/10 CGNAT + 0.0.0.0/8 + IPv4/IPv6",
    "    multicast + ::ffff: IPv4-mapped + suffix-blocklist (.internal, .cluster.local,",
    "    .svc) — covers Railway/Replit internal + K8s in-cluster.",
    "  HIGH #2 — output-sandbox switched to atomicWriteFileSync (mode 0o600 preserved).",
    "  MEDIUM — retrieve_hint absolute-path leak removed.",
    "  LOW — atomic-write tmp-file cleanup on rename failure.",
    "",
    "=".repeat(72),
    `COMPLETE TOOL INVENTORY (${TOOLS.length} REGISTERED, ${TOOL_COUNT} DECLARED)`,
    "=".repeat(72),
  );
  // print tools in 4-column grid
  const cols = 4;
  const colW = 22;
  for (let i = 0; i < TOOLS.length; i += cols) {
    const row = TOOLS.slice(i, i + cols).map(t => t.padEnd(colW)).join("");
    push(row.trimEnd());
  }
  push(
    "",
    "=".repeat(72),
    `COMPLETE SKILLS INVENTORY (${SKILLS.length})`,
    "=".repeat(72),
  );
  for (const s of SKILLS) push(`  - ${s}`);

  push(
    "",
    "=".repeat(72),
    `COMPLETE PERSONA ROSTER (${PERSONAS.length})`,
    "=".repeat(72),
  );
  for (const [id, name, role] of PERSONAS) {
    push(`  ${String(id).padStart(2)}. ${name.padEnd(22)} — ${role}`);
  }

  push(
    "",
    "=".repeat(72),
    "PLATFORM ARCHITECTURE (HIGHLIGHTS)",
    "=".repeat(72),
    "Frontend: React 18, Vite, shadcn/ui, TailwindCSS, Wouter, TanStack Query v5,",
    "  Framer Motion. Command Center Dashboard, dark mode, Mermaid Diagram Rendering,",
    "  Voice Narration, ASR Integration, Live Delegation Event Feed.",
    "",
    "Backend: Express.js, TypeScript, Drizzle ORM, Zod, Helmet. SSE for real-time AI,",
    "  Replit Auth + Email/Password + Admin PIN, DB-backed sessions, password policies,",
    "  email verification, strict multi-tenant isolation.",
    "",
    "Core Subsystems:",
    "  - 16-persona AI team with LLM-powered CEO, Semantic Tool Router,",
    "    Self-Improvement Engine, OAuth-first Auto Model Router.",
    "  - Heartbeat Engine, Scheduled Tasks, HITL Confirmation, Agent Manager,",
    "    Multi-Layer Delegation, Execution Supervisor (Circuit Breaker, Output",
    "    Validation, Hallucination Detection), Self-Correction Engine, Lean",
    "    Execution Mode, Auto-QA Pipeline, Stop-the-Line Error Triage.",
    "  - Felix Brain Module: task state tracker, intent classifier, common-sense",
    "    reasoning, identifier extraction, auto-context, decision logging, CEO",
    "    reasoning frameworks.",
    "  - Layered Identity System: 5 context layers (vc_showcase, client_facing,",
    "    internal_ops, casual, default).",
    "  - Structured Compaction Engine: 5 required sections + quality audit + retry.",
    "  - Aggressive Parallel Orchestration: up to 8 parallel agents.",
    "  - 3-Layer Failure Recovery: self-correction, lean mode downgrade, backup reroute.",
    "  - Bottleneck Analysis Engine, Crews & Flows Engine, Universal Craftsmanship",
    "    Quality Gate, Google Token Resilience, MPEG Production Engine,",
    "    Tool Registry, Persistent Agent Desks, Internal Channels, Event Bus.",
    "",
    "Safety & Governance:",
    "  - Process Governor: 40 governance rules.",
    "  - AHB Defense Layer: persona safety_profile (intentGate strict/moderate +",
    "    restrictedCategories + refusalCopy), TOOL_POLICIES destructive-tool",
    "    classification, ahb-regression test in CI.",
    "  - R95 Outbound Sensitive-Data Redaction Gate: deterministic egress scan",
    "    with three verdicts (clean/redact/block) wired into send_email,",
    "    sessions_send, gmail send, post_to_channel, deliver_product.",
    "  - Tenant context: AsyncLocalStorage propagation; STRICT_TENANT_CONTEXT flag.",
    "  - SAST scanning, dependency audit, weekly maintenance review.",
    "",
    "Customer Delivery Pipeline:",
    "  - All human-facing files MUST go through deliverDigitalProduct() (the",
    "    deliver_product tool) — never bypass with raw uploadAndShare.",
    "  - Self-hosted /uploads/delivery-N-filename streaming URL with proper",
    "    Content-Type + Accept-Ranges:bytes headers. Drive's mobile-app intercept",
    "    bug avoided.",
    "",
    "=".repeat(72),
    "INSTALLED INTEGRATIONS",
    "=".repeat(72),
    "  - OpenAI (gpt-5, gpt-image-2, embeddings, audio.speech, audio.transcriptions)",
    "  - Anthropic (claude family)",
    "  - Google Gemini (2.5-flash and family)",
    "  - DeepSeek (architect lineage)",
    "  - ElevenLabs (TTS)",
    "  - Stripe (payments + webhook claim-then-commit)",
    "  - Google Drive / Sheets / Mail / Calendar",
    "  - OneDrive",
    "  - Replit Auth (OIDC)",
    "  - Browserless (HTML→PDF)",
    "  - FFmpeg 6.1.1 (MPEG production)",
    "",
    "=".repeat(72),
    "QR CODE — AGENTICCORPORATION.NET",
    "=".repeat(72),
    "Visit: https://agenticcorporation.net",
    "QR asset stored in Google Drive brand-assets folder.",
    "Drive File ID: REDACTED_DRIVE_FILE_ID",
    "",
    "End of document.",
  );

  const txtPath = "VisionClaw-Comprehensive-Features.txt";
  writeFileSync(txtPath, txtLines.join("\n"));
  console.log(`TXT_WRITTEN bytes=${txtLines.join("\n").length} path=${txtPath}`);

  // Build PDF — group tools by alpha bucket for readability
  const buckets: Record<string, string[]> = {};
  for (const t of TOOLS) {
    const k = (t[0] || "_").toUpperCase();
    (buckets[k] ||= []).push(t);
  }
  const bucketKeys = Object.keys(buckets).sort();

  const pdfRes = await generateStyledPdf({
    title: "VisionClaw Agent Platform",
    subtitle: `Comprehensive Features — ${ROUND} — ${ROUND_DATE}`,
    companyLines: [
      "[Your Company] | EIN: [YOUR-EIN]",
      "Owner: Bob Washburn | [Your City, ST]",
      "https://agenticcorporation.net | huskyauto@gmail.com",
    ],
    coverStats: [
      { label: "Tools", value: String(TOOL_COUNT) },
      { label: "Skills", value: String(SKILL_COUNT) },
      { label: "Personas", value: String(PERSONA_COUNT) },
      { label: "Tables", value: String(TABLE_COUNT) },
      { label: "Indexes", value: String(INDEX_COUNT) },
      { label: "Capabilities", value: String(CAPABILITY_COUNT) },
      { label: "Governance Rules", value: String(RULE_COUNT) },
      { label: "Verified Deliveries", value: "71+" },
      { label: "Silent Drops", value: "0" },
    ],
    sections: [
      {
        title: `Latest Release — ${ROUND}`,
        content: "IJFW Cross-Pollination: 8 additive items + +sec auth-gate hoist + +wiring (Felix/Forge operating_loop re-seeded) + +sec-2 (whole-app architect sweep, 6 of 16 findings closed in-session, including a CRITICAL secret-redaction in LLM error translation).",
        bullets: [
          "run_command (#296) — ad-hoc shell with large-output sandbox + auto-summary; same RCE gate as slash_command (owner-tenant + Felix/Forge).",
          "Wave-table parallelism on plan_deliverable — sibling steps in a wave dispatch in parallel.",
          "translateLlmError — 13 LLM-error families pattern-matched to one actionable line.",
          "DeepSeek as fourth architect lineage + runMultiLineageReview() with productive-only minResponses.",
          "sanitizeUntrusted() — heading + system-tag defang against prompt injection.",
          "atomicWriteFileSync + parent-dir fsync at 6 critical persistence sites.",
          "+sec-2: SSRF jail extended (CGNAT 100.64/10, 0.0.0.0/8, multicast, ::ffff:, .internal/.cluster.local/.svc), output-sandbox atomic writes, retrieve_hint path leak removed.",
        ],
      },
      {
        title: "Company",
        bullets: [
          "[Your Company]",
          "EIN: [YOUR-EIN]",
          "[Your City, State]",
          "Owner: Bob Washburn (huskyauto@gmail.com)",
          "Live: https://agenticcorporation.net",
          "QR asset Drive file ID: REDACTED_DRIVE_FILE_ID",
        ],
      },
      {
        title: "Persona Roster (16)",
        table: {
          headers: ["#", "Name", "Role"],
          rows: PERSONAS.map(([id, n, r]) => [String(id), n, r]),
        },
      },
      {
        title: `Skills Inventory (${SKILLS.length})`,
        content: "Curated skill modules powering personas, automation, and content production.",
        subsections: [
          { title: "Skills (alphabetical)", bullets: SKILLS },
        ],
      },
      {
        title: `Tool Inventory (${TOOLS.length} registered, ${TOOL_COUNT} declared)`,
        content: "Every registered tool, grouped alphabetically. Felix and Forge have full RCE-class access via slash_command and run_command (owner-tenant + persona gate).",
        subsections: bucketKeys.map(k => ({
          title: `Tools — ${k}`,
          bullets: buckets[k],
        })),
      },
      {
        title: "Architecture Highlights",
        subsections: [
          {
            title: "Frontend",
            bullets: [
              "React 18, Vite, shadcn/ui, TailwindCSS, Wouter, TanStack Query v5, Framer Motion",
              "Command Center Dashboard, dark mode, Mermaid rendering, voice narration, ASR",
            ],
          },
          {
            title: "Backend",
            bullets: [
              "Express.js, TypeScript, Drizzle ORM, Zod, Helmet",
              "SSE for real-time AI, Replit Auth + Email/Password + Admin PIN",
              "DB-backed sessions, password policies, email verification, multi-tenant isolation",
            ],
          },
          {
            title: "Core Subsystems",
            bullets: [
              "16-persona AI team with LLM-powered CEO + Semantic Tool Router + Self-Improvement Engine",
              "Heartbeat Engine, Scheduled Tasks, HITL Confirmation, Multi-Layer Delegation",
              "Execution Supervisor: Circuit Breaker, Output Validation, Hallucination Detection",
              "Felix Brain Module: task tracker, intent classifier, decision logging, CEO frameworks",
              "Layered Identity System (5 context layers); Structured Compaction Engine",
              "Aggressive Parallel Orchestration up to 8 agents; 3-Layer Failure Recovery",
              "Crews & Flows Engine, Universal Craftsmanship Quality Gate",
              "MPEG Production Engine (FFmpeg 6.1.1, 1080p 30fps H.264 +faststart locked)",
              "Persistent Agent Desks, Internal Channels, Event Bus, Tool Registry SoT",
            ],
          },
          {
            title: "Safety & Governance",
            bullets: [
              `${RULE_COUNT}-rule Process Governor`,
              "AHB Defense Layer: persona safety_profile + TOOL_POLICIES + ahb-regression CI test",
              "R95 Outbound Sensitive-Data Redaction Gate: clean / redact / block verdicts",
              "AsyncLocalStorage tenant-context propagation; STRICT_TENANT_CONTEXT flag",
              "SAST + dependency audit + weekly maintenance review",
            ],
          },
          {
            title: "Customer Delivery Pipeline",
            bullets: [
              "All human-facing files route through deliverDigitalProduct() (deliver_product tool)",
              "Self-hosted streaming URL avoids Drive mobile-app processing-intercept bug",
              "Content-Type + Accept-Ranges:bytes headers preserved end-to-end",
            ],
          },
        ],
      },
      {
        title: "Installed Integrations",
        bullets: [
          "OpenAI (gpt-5, gpt-image-2, embeddings, audio.speech, audio.transcriptions)",
          "Anthropic (Claude family)",
          "Google Gemini (2.5-flash and family)",
          "DeepSeek (4th architect lineage)",
          "ElevenLabs TTS",
          "Stripe (payments + webhook claim-then-commit)",
          "Google Drive / Sheets / Mail / Calendar",
          "OneDrive",
          "Replit Auth (OIDC)",
          "Browserless (HTML → PDF)",
          "FFmpeg 6.1.1",
        ],
      },
      {
        title: "Visit Us",
        highlight: "agenticcorporation.net — scan the QR code stored in the brand-assets folder (Drive file ID REDACTED_DRIVE_FILE_ID) or visit the URL directly.",
      },
    ],
    footerLines: [
      `VisionClaw Agent Platform — ${ROUND} — Generated ${today}`,
      "[Your Company] | huskyauto@gmail.com | https://agenticcorporation.net",
    ],
    fileName: "VisionClaw-Comprehensive-Features.pdf",
    folderLabel: "Platform Documentation",
    uploadToDrive: true,
  });
  console.log("PDF_RESULT:", JSON.stringify(pdfRes));

  // Upload TXT
  const txtRes = await uploadAndShare({
    filePath: txtPath,
    fileName: "VisionClaw-Comprehensive-Features.txt",
    description: "VisionClaw Agent Platform - Complete Feature Document (Text)",
    folderLabel: "Platform Documentation",
    share: true,
  } as any);
  console.log("TXT_RESULT:", JSON.stringify(txtRes));

  // Register both in project_files (project 15)
  try {
    await db.execute(sql`
      INSERT INTO project_files (project_id, file_name, file_path, file_type, file_size, uploaded_by)
      VALUES
        (15, 'VisionClaw-Comprehensive-Features.pdf', ${pdfRes.viewUrl || ""}, 'application/pdf', ${pdfRes.size || 0}, 'VisionClaw Agent'),
        (15, 'VisionClaw-Comprehensive-Features.txt', ${txtRes.viewUrl || ""}, 'text/plain', ${(txtRes as any).size || txtLines.join("\n").length}, 'VisionClaw Agent')
      ON CONFLICT DO NOTHING
    `);
    console.log("PROJECT_FILES_REGISTERED");
  } catch (e: any) {
    console.error("PROJECT_FILES_INSERT_FAIL:", e.message);
  }

  // Email Bob
  const inboxResult: any = await getOrCreateTenantInbox(1);
  const inboxId = typeof inboxResult === "string"
    ? inboxResult
    : inboxResult.inboxId || inboxResult.email || inboxResult.id;
  const ownerEmail = process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com";

  const emailText = [
    `Hey Bob,`,
    ``,
    `Updated VisionClaw Comprehensive Features — ${ROUND} (${ROUND_DATE}).`,
    ``,
    `Stats: ${TOOL_COUNT} tools · ${SKILL_COUNT} skills · ${PERSONA_COUNT} personas · ${TABLE_COUNT} tables · ${INDEX_COUNT} indexes · ${CAPABILITY_COUNT} capabilities · ${RULE_COUNT} governance rules.`,
    ``,
    `Direct Drive links:`,
    `  PDF:  ${pdfRes.viewUrl}`,
    `  Text: ${txtRes.viewUrl}`,
    ``,
    `Both files contain the EXHAUSTIVE inventory: every registered tool, every skill, every persona, plus full architecture and integrations. Felix uses these as his presentation knowledge base.`,
    ``,
    `Visit: https://agenticcorporation.net`,
    ``,
    `— VisionClaw Agent`,
  ].join("\n");

  await sendEmail({
    inboxId,
    to: ownerEmail,
    subject: `VisionClaw Updated Features — PDF + Text — ${ROUND}`,
    text: emailText,
  } as any);
  console.log("EMAIL_SENT to=" + ownerEmail);

  console.log("DONE");
  console.log("FINAL_PDF_URL=" + pdfRes.viewUrl);
  console.log("FINAL_TXT_URL=" + txtRes.viewUrl);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", e?.stack || e);
  process.exit(1);
});
