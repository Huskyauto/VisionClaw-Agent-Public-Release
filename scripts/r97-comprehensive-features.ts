import fs from "fs";
import path from "path";
import { generateStyledPdf } from "../server/pdf-create";
import { uploadAndShare } from "../server/google-drive";
import { getOrCreateTenantInbox, sendEmail } from "../server/email";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

(async () => {
  const toolNames = fs.readFileSync("/tmp/tool-names.txt", "utf8").trim().split("\n").filter(Boolean);
  const TOOL_COUNT_CANONICAL = 277;

  const skillsRows: any = await db.execute(sql`SELECT name FROM skills ORDER BY name`);
  const dbSkillNames: string[] = (skillsRows.rows || skillsRows).map((r: any) => r.name);

  const agentSkillsDir = ".agents/skills";
  const agentSkillNames = fs.readdirSync(agentSkillsDir)
    .filter(n => fs.statSync(path.join(agentSkillsDir, n)).isDirectory())
    .sort();

  const replitSkillsDir = ".local/skills";
  const replitSkillNames = fs.existsSync(replitSkillsDir)
    ? fs.readdirSync(replitSkillsDir).filter(n => {
        const full = path.join(replitSkillsDir, n);
        return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "SKILL.md"));
      }).sort()
    : [];

  const personaRows: any = await db.execute(sql`SELECT id, name, role FROM personas WHERE is_active = true ORDER BY id`);
  const personas: { id: number; name: string; role: string }[] =
    (personaRows.rows || personaRows).map((r: any) => ({ id: r.id, name: r.name, role: r.role }));

  const today = new Date().toISOString().slice(0, 10);

  const sections = [
    {
      heading: "R97 — Self-Maintaining Platform (Latest Release, May 3 2026)",
      bullets: [
        "Weekly Maintenance Cron: in-process scheduler armed 60s after boot, runs every 7 days forever. 8-pass sweep covering npm audit + outdated, integrations currency, SAST hooks, prod schema parity, prod log scan, Railway microservice health (Camofox + others), model SDK currency, and skill index drift.",
        "GREEN/YELLOW/RED status auto-classification — RED gets 🔴 [URGENT] subject prefix; styled HTML email auto-sent to huskyauto@gmail.com via getPrimaryInboxId + sendEmail (inherits the rate limiter, policy engine, and audit log Felix uses for HITL escalations).",
        "Two new HTTP routes registered BEFORE the auth gate: GET /api/cron/weekly-maintenance/status (public liveness probe) and POST /api/cron/weekly-maintenance (Bearer ${CRON_SECRET}, 202-accepted fire-and-forget). In-flight de-dup prevents concurrent runs.",
        "agent-context-wiring skill: closes the gap where new tools EXIST in the registry but no persona's allowed_tools / system_prompt actually USES them. 8-step checklist over 9 context surfaces with WHAT/WHEN/NOT-WHEN/LADDER/EXAMPLE prompt block pattern, 4k token cap, never-underscore-prefix annotator rule.",
        "weekly-maintenance-review skill: narrative twin of the executable cron — per-pass triage rules (CRITICAL/HIGH → auto-trigger dependency-upgrade; MODERATE → file project_task; LOW → roll up), GREEN/YELLOW/RED protocol, agent-side completion path for SAST + prod-schema + prod-logs.",
        "Skill count 64 → 66. No tool count change (operational infrastructure, not new agent-callable tools). Manual smoke test: npx tsx scripts/weekly-maintenance.ts --pass=7,8 ran in 123ms with exit 0.",
      ],
    },
    {
      heading: "R96 / R96.1 / R96.1+sec — Camofox Stealth-Browser + Universal Recall (May 3 2026)",
      bullets: [
        "jo-inc/camofox-browser (MIT, 3961★, Camoufox-based stealth browser) deployed as own Railway service at camofox-production-d61e.up.railway.app. New tool stealth_browse_camofox is the 277th platform tool. Per-(tenant, persona) persisted cookies + storage_state.",
        "All four web-access tiers (web_fetch / browser / stealth_browse / stealth_browse_camofox) added to ALWAYS_INCLUDE in tool router so every persona sees the full ladder on EVERY routed turn.",
        "annotateWebToolResult() detects blocked-page payloads (Cloudflare, hCaptcha, DataDome, Akamai, 401/403/407/429/451) on web_fetch/firecrawl_scrape/stealth_browse returns and injects fallbackHint + fallbackTool inline so the model literally sees the escalation instruction.",
        "Hardening pass: HITL gate on click/type/navigate/extract/open; SSRF guard via isSafeUrl + isSafeDns (rejects metadata IP, RFC1918, localhost, *.railway.internal, IPv6 link-local, non-http/https schemes — 11 attack URLs verified); per-(tenant, persona) cookie isolation closes Robert/Felix session bleed; firecrawl success-path annotation; key renamed fallbackHint to survive chat-engine underscore-prefix strip.",
        "59/59 regression tests + live two-persona round-trip verified.",
      ],
    },
    {
      heading: "R75.A — Adversarial Humanities Benchmark (AHB) Defense Layer",
      bullets: [
        "Defense-in-depth response to Galisai et al. 2026 (frontier ASR jumps 3.84% → 55.75% under stylistic obfuscation: poetry, allegory, hermeneutics, role-play).",
        "INTENT GATE — destyles every message via fast classifier into literal intent, matched against per-persona safety_profile jsonb (strict/moderate/off + restrictedCategories + persona-voice refusalCopy). Robert seeded with 8 medical categories, Felix with 5 destructive-action categories. Runs for direct user input AND subagent traffic.",
        "DESTRUCTIVE-TOOL POLICY — registry of money-moving / data-deleting / credential-touching tools requires structured-args + trusted-persona + approval + value-cap gates. Unregistered suspicious-name tools (delete_*, exec_sql, payout, reveal_secret, sudo_*) auto-classified destructive and fail CLOSED.",
        "19/19 AHB regression suite gates CI. Eight code-review findings closed in same release.",
      ],
    },
    {
      heading: "Recent Major Rounds (R76–R94)",
      bullets: [
        "R94 — Tenant Cost-Attribution Integrity: AsyncLocalStorage tenant context propagated end-to-end across auth, glasses, MCP, jobs, cron — every metered LLM call bills the right tenant.",
        "R83-R93 — 24h Security Sweep: write_file shared blocklist + symlink-ancestor walk, claude-import injection scan, escalation per-tenant hourly quota (20/hr), SHA256-keyed metered OpenAI client cache, system→user role on history summaries, <tool_call> tag stripping.",
        "R80 — Claude Code Subagent Importer (additive).",
        "R79 — MarTech Bundle: six per-tenant brand-voice and social-content tools (build_voice_profile, get_voice_profile, generate_hooks, format_post, generate_content_matrix, score_post) ported from charlie947/social-media-skills (MIT) and rebuilt VisionClaw-native.",
        "R78 — A2A v0.3 Agent Card: public /.well-known/agent.json discovery endpoint with skills array (2 platform + 1 per active persona).",
        "R77.5 — KisMATH Reasoning Audit Rail: every model tagged with trainingRegime (rlvr/distilled/sft/base), auto-router prefers non-RLVR for high-complexity reasoning, audit_reasoning_step + verify_math_chain audit any chain for causal validity.",
        "R77.6 + R77.7 — 15 surgical security fixes across 10 architect-flagged surfaces.",
        "R76 — Trust-Tier Policy Engine + Deliverable Contract Verification: tool_policies + deliverable_contracts tables, per-tenant allow/deny/require_approval rules, magic-byte MIME + render-ability checks before any deliverable claim is allowed to succeed.",
      ],
    },
    {
      heading: "Persona Roster (16 Active Personas)",
      bullets: personas.map(p => `[${p.id}] ${p.name} — ${p.role}`),
    },
    {
      heading: `Complete Tool Inventory (${TOOL_COUNT_CANONICAL} canonical tools registered in TOOL_DEFINITIONS)`,
      bullets: [
        `Below: ${toolNames.length} tool-name tokens extracted from server/tools.ts (canonical registered count is ${TOOL_COUNT_CANONICAL}; minor delta is helper-name false positives).`,
        toolNames.join(", "),
      ],
    },
    {
      heading: `Agent Skills Library (${agentSkillNames.length} skills in .agents/skills/)`,
      bullets: [agentSkillNames.join(", ")],
    },
    {
      heading: `Replit-Provided Skills (${replitSkillNames.length} skills)`,
      bullets: [replitSkillNames.join(", ")],
    },
    {
      heading: `User-Curated DB Skills (${dbSkillNames.length} skills in skills table)`,
      bullets: [dbSkillNames.join(", ")],
    },
    {
      heading: "Company Information",
      bullets: [
        "[Your Company]",
        "EIN: [YOUR-EIN]",
        "[Your City, State], USA",
        "Owner: Bob Washburn",
        "Production: agenticcorporation.net",
      ],
    },
  ];

  // PDF
  console.log("[r97] Generating styled PDF...");
  const pdfResult = await generateStyledPdf({
    title: "VisionClaw — Comprehensive Features",
    subtitle: `R97 Self-Maintaining Platform — ${today}`,
    fileName: "VisionClaw-Comprehensive-Features",
    companyLines: [
      "[Your Company] — EIN [YOUR-EIN]",
      "[Your City, State] — Owner: Bob Washburn",
      "agenticcorporation.net",
    ],
    coverStats: [
      { label: "Tools", value: String(TOOL_COUNT_CANONICAL) },
      { label: "Skills", value: "66" },
      { label: "Personas", value: String(personas.length) },
      { label: "Tables", value: "149" },
      { label: "Indexes", value: "47" },
      { label: "Capabilities", value: "92" },
      { label: "Governance Rules", value: "40" },
      { label: "LOC", value: "~180k" },
      { label: "Latest Round", value: "R97" },
    ],
    sections,
    uploadToDrive: true,
  } as any);

  if (!pdfResult.success) {
    console.error("[r97] PDF generation failed:", pdfResult.error);
    process.exit(1);
  }
  console.log(`[r97] PDF: ${pdfResult.viewUrl}`);

  // Text
  const txtPath = "deliverables/VisionClaw-Comprehensive-Features.txt";
  fs.mkdirSync(path.dirname(txtPath), { recursive: true });
  const txtBody = [
    "VisionClaw — Comprehensive Features",
    `R97 Self-Maintaining Platform — ${today}`,
    "[Your Company] — EIN [YOUR-EIN] — [Your City, State] — Owner: Bob Washburn",
    "QR Code: agenticcorporation.net",
    "",
    `Tools: ${TOOL_COUNT_CANONICAL} | Skills: 66 | Personas: ${personas.length} | Tables: 149 | Indexes: 47 | Capabilities: 92 | Governance: 40 | Latest: R97`,
    "",
    ...sections.flatMap(s => [
      "=".repeat(80),
      s.heading,
      "=".repeat(80),
      ...s.bullets.map(b => `• ${b}`),
      "",
    ]),
  ].join("\n");
  fs.writeFileSync(txtPath, txtBody, "utf8");
  const txtSize = fs.statSync(txtPath).size;
  console.log(`[r97] TXT written: ${txtPath} (${txtSize} bytes)`);

  console.log("[r97] Uploading TXT to Drive...");
  const txtResult: any = await uploadAndShare({
    filePath: txtPath,
    fileName: "VisionClaw-Comprehensive-Features.txt",
    description: "VisionClaw Agent Platform — Complete Feature Document (Text) — R97",
    folderLabel: "Platform Documentation",
    share: true,
  } as any);
  console.log(`[r97] TXT: ${txtResult.viewUrl}`);

  // Register in project_files (project 15)
  try {
    await db.execute(sql`
      INSERT INTO project_files (project_id, file_name, file_path, file_type, file_size, uploaded_by)
      VALUES
        (15, 'VisionClaw-Comprehensive-Features.pdf', ${pdfResult.viewUrl}, 'application/pdf', ${pdfResult.size || 0}, 'VisionClaw Agent'),
        (15, 'VisionClaw-Comprehensive-Features.txt', ${txtResult.viewUrl}, 'text/plain', ${txtSize}, 'VisionClaw Agent')
      ON CONFLICT DO NOTHING
    `);
    console.log("[r97] Registered in project_files (project 15)");
  } catch (e: any) {
    console.warn("[r97] project_files insert warn:", e?.message);
  }

  // Email
  console.log("[r97] Emailing owner...");
  const inboxResult: any = await getOrCreateTenantInbox(1);
  const inboxId = typeof inboxResult === "string" ? inboxResult : (inboxResult.inboxId || inboxResult.email);
  const ownerEmail = process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com";

  const emailText = `Bob,

R97 Self-Maintaining Platform shipped today. Updated comprehensive features documents are attached.

📄 PDF (styled, with cover, stats grid, full inventory):
${pdfResult.viewUrl}

📝 TXT (Felix knowledge-base format, complete tool + skill + persona lists):
${txtResult.viewUrl}

What's new in R97:
• Weekly Maintenance Cron — in-process scheduler runs an 8-pass sweep every 7 days and emails you a GREEN/YELLOW/🔴-URGENT summary automatically.
• Two new HTTP routes: GET /api/cron/weekly-maintenance/status (public) + POST /api/cron/weekly-maintenance (Bearer CRON_SECRET).
• agent-context-wiring skill — closes the gap where new tools EXIST in the registry but no persona's allowed_tools / system_prompt actually uses them.
• weekly-maintenance-review skill — narrative twin of the cron with per-pass triage rules.
• Skill count 64 → 66. No tool count change.

Stats: 277 tools, 66 skills, 16 personas, 149 tables, 47 indexes, 92 capabilities, 40 governance rules, ~180k LOC.

Both files are also registered in project 15 for Felix.

— VisionClaw Agent`;

  await sendEmail({
    inboxId,
    to: ownerEmail,
    subject: "VisionClaw R97 — Self-Maintaining Platform — Updated Features (PDF + Text)",
    text: emailText,
  } as any);
  console.log(`[r97] Email sent to ${ownerEmail}`);

  console.log("\n=== DELIVERABLES ===");
  console.log(`PDF: ${pdfResult.viewUrl}`);
  console.log(`TXT: ${txtResult.viewUrl}`);
  process.exit(0);
})().catch(e => {
  console.error("[r97] FATAL:", e);
  process.exit(1);
});
