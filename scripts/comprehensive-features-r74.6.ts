import fs from "fs";
import path from "path";
import { generateStyledPdf } from "../server/pdf-create";
import { uploadAndShare } from "../server/google-drive";
import { getOrCreateTenantInbox, sendEmail } from "../server/email";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

(async () => {
  const registrySrc = fs.readFileSync(path.join(process.cwd(), "server/tool-registry.ts"), "utf8");
  const re = /registerTool\("([a-z_0-9]+)",\s*\{\s*categories:\s*\[([^\]]+)\]/g;
  const toolMap: Record<string, Set<string>> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(registrySrc))) {
    const name = m[1];
    const cats = m[2].split(",").map((s) => s.trim().replace(/["]/g, ""));
    const primary = cats[0] || "misc";
    (toolMap[primary] = toolMap[primary] || new Set()).add(name);
  }
  const allTools = new Set<string>();
  for (const c of Object.keys(toolMap)) for (const t of toolMap[c]) allTools.add(t);
  const TOOL_COUNT = allTools.size;

  const personasRes = await db.execute(sql`SELECT id, name, role FROM personas ORDER BY id`);
  const personas: Array<{ id: number; name: string; role: string }> = (personasRes as any).rows || [];

  const skillsRes = await db.execute(sql`SELECT name, description FROM skills ORDER BY name`);
  const skills: Array<{ name: string; description: string }> = (skillsRes as any).rows || [];

  const tablesRes = await db.execute(
    sql`SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_schema='public'`,
  );
  const TABLE_COUNT = (tablesRes as any).rows?.[0]?.c ?? 132;

  const TODAY = new Date().toISOString().slice(0, 10);
  const PROD_URL = "https://agenticcorporation.net";

  const CATEGORY_LABELS: Record<string, string> = {
    agentic: "Agentic Cost & Self-Heal",
    ai: "AI Reasoning & Orchestration",
    charts: "Charts & Dashboards",
    code: "Code Execution",
    competitorIntel: "Competitor Intelligence",
    contracts: "Contracts",
    conversations: "Conversations",
    crews: "Crews / Flows / Minds",
    crm: "Customer Relationship",
    delivery: "Customer Delivery",
    design: "Design (Figma)",
    diff: "Diffs",
    docs: "Documents & Reports",
    email: "Email",
    evidence: "Research Evidence",
    expenses: "Expenses",
    experiments: "Experiments / Self-Improvement",
    files: "Files & Drive",
    finance: "Finance & Markets",
    ideation: "Ideation",
    invoicing: "Invoicing",
    knowledge: "Knowledge Graph & Triples",
    kpi: "KPIs",
    leadEnrichment: "Lead Enrichment",
    legal: "Legal & SEO Schema",
    marketing: "Marketing & Social (X, Stock, Calendar)",
    media: "Media (Audio, Video, MPEG, YouTube)",
    memory: "Memory (Daily, Long-Term, Graph)",
    messaging: "Messaging & Scheduling",
    notes: "Notes & Scratchpad",
    outreachSequencing: "Outreach Sequencing",
    pdf: "PDF",
    personas: "Personas",
    planning: "Planning (Minerva)",
    presentations: "Presentations & Slides",
    reasoning: "Cross-Critique & Ensemble",
    reporting: "Business Reporting",
    research: "Research (Readability, Templates)",
    scraping: "Scraping (Firecrawl, Scraped Pages)",
    sessions: "Sessions / Subagents / Channels",
    skillEvolution: "Skill Evolution",
    system: "System & Diagnostics",
    tools: "Tool Registry & Custom Tools",
    userModeling: "User Modeling",
    web: "Web (Browser, Research, Vision)",
    wellness: "Wellness ([Your Product])",
    whatsapp: "WhatsApp",
    workspace: "Google Workspace & Calendar",
  };

  const categories = Object.keys(toolMap).sort();

  // ======================== TEXT FILE ========================
  let txt = "";
  txt += "VISIONCLAW AGENT — COMPREHENSIVE FEATURES & PLATFORM OVERVIEW\n";
  txt += "================================================================\n";
  txt += `Generated: ${TODAY}\n`;
  txt += `Release: Round 74.6 — Public website end-to-end refresh + R74.6.1 tool-count correction\n`;
  txt += `Production: ${PROD_URL}\n`;
  txt += `QR Code: ${PROD_URL}\n`;
  txt += "----------------------------------------------------------------\n";
  txt += "Built by: [Your Company] · [Your City, State] · EIN [YOUR-EIN]\n";
  txt += "Owner: Bob Washburn · huskyauto@gmail.com\n";
  txt += "License: Proprietary\n\n";

  txt += "PLATFORM STATS (live, this release pass)\n";
  txt += "----------------------------------------------------------------\n";
  txt += `Tools (registry-audited at boot)         ${TOOL_COUNT}\n`;
  txt += `Skills (admin-curated capability prompts) ${skills.length}\n`;
  txt += `Personas (specialist agent roles)        ${personas.length}\n`;
  txt += `Tables (Postgres + pgvector)             ${TABLE_COUNT}\n`;
  txt += `AI Models curated in MODEL_REGISTRY      36\n`;
  txt += `AI Models discoverable daily (OpenRouter) 1000+\n`;
  txt += `Governance Rules                         40\n`;
  txt += `TypeScript files (server+client+shared)  382 (~163k LOC)\n`;
  txt += `Voice-safe tools via Glasses Gateway     20 of 243\n`;
  txt += `Verified deliveries · silent drops       71+ · 0\n\n`;

  txt += "================================================================\n";
  txt += `R74.6 RELEASE PASS — WHAT CHANGED THIS SESSION (${TODAY})\n`;
  txt += "================================================================\n";
  txt += `R74.6 Public website end-to-end refresh\n`;
  txt += `  - Surveyed all 11 public marketing pages (landing, home, about, pricing,\n`;
  txt += `    architecture, compare, updates, contact, terms, privacy, refund).\n`;
  txt += `  - Updated model showcase to "36 curated in MODEL_REGISTRY + 1000+\n`;
  txt += `    daily auto-discovery via OpenRouter" (was "45+ / 350+ daily" — both\n`;
  txt += `    undercount).\n`;
  txt += `  - Added Subscription-First Routing (BYOS) + Claude Runner bridge\n`;
  txt += `    mention to landing model card and about-page Model Flexibility card.\n`;
  txt += `  - Added 4 new round entries to public updates.tsx (R74.5, R74.4, R74.3,\n`;
  txt += `    R74.2) and matching milestones to about.tsx timeline.\n`;
  txt += `  - Robert's role on about.tsx cleaned up to "Late-Night Companion &\n`;
  txt += `    Wellness Coach" (VisionClaw branding rule for public pages).\n\n`;
  txt += `R74.6.1 Tool-count correction (same session)\n`;
  txt += `  - Initial pass overstated tool count as "384" via flawed grep that\n`;
  txt += `    double-counted dispatch cases + OpenAI function-schema entries +\n`;
  txt += `    aliases. Bob caught it on gut-check.\n`;
  txt += `  - Re-derived from source-of-truth registry: 243 distinct tool names\n`;
  txt += `    via dedup of registerTool() calls in server/tool-registry.ts.\n`;
  txt += `  - Math cross-checks against R56 ledger (216 -> 222 in R56, +21 across\n`;
  txt += `    R57-R74 = 243 today).\n`;
  txt += `  - Reverted "384" -> "243" everywhere across 12 targeted edits.\n`;
  txt += `  - Lesson codified in replit.md: marketing numeric stats must derive\n`;
  txt += `    from what the system actually uses, never from grep patterns that\n`;
  txt += `    double-count.\n\n`;
  txt += `R74.5 Tenant-isolation hardening (Apr 24, 2026)\n`;
  txt += `  - 14 fail-open patches across sessions_list/history/send,\n`;
  txt += `    manage_skills admin gating, workflow fast-path sanitization,\n`;
  txt += `    writeDailyNote tenant-required, /api/upload-base64 byte-level type\n`;
  txt += `    validation, presenter token log redaction, public-chat tool dispatch\n`;
  txt += `    fail-closed.\n\n`;
  txt += `R74.4 Persona augmentation pass (Apr 24, 2026)\n`;
  txt += `  - Forge: Incident Response Commander (SEV1-4 protocol + 48hr blameless\n`;
  txt += `    post-mortem).\n`;
  txt += `  - Teagan: AEO/GEO citation playbook (ChatGPT/Claude/Gemini/Perplexity\n`;
  txt += `    audit-fix-recheck cycle).\n`;
  txt += `  - Atlas: YouTube/Shorts/TikTok/Reels analytics (CTR + retention curve\n`;
  txt += `    + 30s-hook test).\n`;
  txt += `  - Robert: purposeful-warmth principle (lightness serves emotional\n`;
  txt += `    purpose, never replaces empathy).\n\n`;
  txt += `R74.3 Whole-app 3-pass architect review (Apr 24, 2026)\n`;
  txt += `  - 5 HIGH + 6 MEDIUM hardening bundle: Minerva CAS plan-edit lock,\n`;
  txt += `    KB-injection sanitizer wrapper, R74.A/B/C closures verified,\n`;
  txt += `    /api/cache/stats + /api/drive-health admin gates landed.\n\n`;
  txt += `R74.2 Transient 5xx auto-retry (Apr 24, 2026)\n`;
  txt += `  - fetchWithTransientRetry wraps every outbound API call so cold-start\n`;
  txt += `    hiccups recover transparently instead of surfacing as hard errors.\n\n`;
  txt += `R74 Cross-tenant email + Stripe Connect + pre-auth endpoint hot-fix\n`;
  txt += `(Apr 24, 2026)\n`;
  txt += `  - R74.A (CRITICAL): cross-tenant email contamination patched fail-closed\n`;
  txt += `    in server/email.ts inbound + outbound paths.\n`;
  txt += `  - R74.B (HIGH): Stripe Connect ?? 1 fallback removed, 401 if tenant\n`;
  txt += `    unresolved.\n`;
  txt += `  - R74.C (HIGH): /api/cache/stats + /api/drive-health admin-gated;\n`;
  txt += `    /api/setup/status reduced to boolean for unauthenticated probes.\n`;
  txt += `  - R74.D: model-catalog log text fixed.\n\n`;

  txt += "================================================================\n";
  txt += `COMPLETE PERSONA ROSTER (${personas.length} specialist agents)\n`;
  txt += "================================================================\n";
  for (const p of personas) {
    txt += `  ${String(p.id).padStart(2, " ")}. ${p.name} — ${p.role}\n`;
  }
  txt += "\n";

  txt += "================================================================\n";
  txt += `COMPLETE TOOL INVENTORY — ALL ${TOOL_COUNT} TOOLS BY CATEGORY\n`;
  txt += "================================================================\n";
  for (const c of categories) {
    const tools = [...toolMap[c]].sort();
    const label = CATEGORY_LABELS[c] || c;
    txt += `\n${label} (${tools.length})\n`;
    txt += "-".repeat(label.length + 6) + "\n";
    for (const t of tools) txt += `  - ${t}\n`;
  }
  txt += "\n";

  txt += "================================================================\n";
  txt += `COMPLETE SKILLS INVENTORY — ALL ${skills.length} ADMIN-CURATED SKILLS\n`;
  txt += "================================================================\n";
  for (const s of skills) {
    txt += `  - ${s.name}\n`;
    if (s.description) {
      const desc = String(s.description).replace(/\s+/g, " ").trim().slice(0, 220);
      txt += `      ${desc}\n`;
    }
  }
  txt += "\n";

  txt += "================================================================\n";
  txt += "AI MODEL CATALOG — 36 CURATED + 1000+ DAILY DISCOVERY\n";
  txt += "================================================================\n";
  txt += `MODEL_REGISTRY (curated, in server/providers.ts): 36 models\n`;
  txt += `  Providers: OpenAI (incl. gpt-image-2), Anthropic (Claude family),\n`;
  txt += `  Google Gemini (incl. 2.5 Flash Image), xAI (Grok), DeepSeek,\n`;
  txt += `  OpenRouter routes.\n\n`;
  txt += `Daily auto-discovery via OpenRouter probe: 1000+ models surfaced and\n`;
  txt += `cached for ad-hoc routing.\n\n`;
  txt += `Subscription-First Routing (BYOS):\n`;
  txt += `  - Bring your own ChatGPT Plus / Claude / Gemini subscription;\n`;
  txt += `    inference runs on subscription quota for $0/token primary path.\n\n`;
  txt += `Claude Runner bridge:\n`;
  txt += `  - Claude desktop app routed as a tool, lets the platform offload\n`;
  txt += `    long Claude conversations to a flat-fee subscription.\n\n`;
  txt += `Three-tier image cascade (R64.D):\n`;
  txt += `  - Gemini 2.5 Flash Image (~7s default)\n`;
  txt += `  - OpenAI gpt-image-2 (~16s premium)\n`;
  txt += `  - DALL-E 3 fallback\n\n`;

  txt += "================================================================\n";
  txt += "ARCHITECTURE & SUBSYSTEMS\n";
  txt += "================================================================\n";
  txt += `Tenant isolation (R74.5): every tool dispatch fails closed if tenant\n`;
  txt += `unresolved; sessions, knowledge, memory, uploads, daily notes, presenter\n`;
  txt += `tokens all tenant-required.\n\n`;
  txt += `Guarded tool executor (R23.2/R23.3): single executor wraps every tool\n`;
  txt += `call with rate limit + persona block + cost ledger.\n\n`;
  txt += `R59 Tool Curator: closes the gap between ${TOOL_COUNT} registered tools and\n`;
  txt += `the ~10 personas actually use, via 4 layered signals (usage hints,\n`;
  txt += `semantic embeddings, per-tenant tool_performance re-rank, soft\n`;
  txt += `deprecation), all fail-open.\n\n`;
  txt += `Glasses Gateway (R20/R20.1): three public endpoints for the forked\n`;
  txt += `Android client streaming Meta Ray-Ban audio + Gemini Live; bearer auth\n`;
  txt += `via api_keys table; voice-safe allowlist of 20 tools.\n\n`;
  txt += `Customer-delivery pipeline: Stripe webhook (signature verified, replay\n`;
  txt += `safe, race-fixed) -> service generation w/ automated QA -> manual review\n`;
  txt += `queue (default-on, auto-ship graduates per-SKU after N consecutive\n`;
  txt += `clean ships) -> customer email + capability URL.\n\n`;
  txt += `Memory architecture: pgvector embeddings + structured entries + cross-\n`;
  txt += `persona links + daily notes + scratchpad + knowledge triples.\n\n`;
  txt += `Self-healing (R63): insights auto-apply for 8 low-risk operational\n`;
  txt += `categories with audit trail; HIGH-priority items auto-route to Minerva,\n`;
  txt += `draft a strategic plan, land in Felix's approval queue.\n\n`;
  txt += `Durable agent job queue (R60.B): single agent_jobs work queue with crash\n`;
  txt += `recovery, exponential backoff, dead-letter handling, lease fencing.\n\n`;
  txt += `Wellness layer (R56, [Your Product]): Robert persona + detectUserFatigue,\n`;
  txt += `generateMicroSabbaticalIntervention, trackInterventionEffectiveness,\n`;
  txt += `stress_intervention, detectEmotionalState (10 shame-spiral patterns),\n`;
  txt += `grounding interventions.\n\n`;

  txt += "================================================================\n";
  txt += "COMPANY & CONTACT\n";
  txt += "================================================================\n";
  txt += `Company: [Your Company]\n`;
  txt += `EIN: [YOUR-EIN]\n`;
  txt += `Location: [Your City, State], USA\n`;
  txt += `Owner: Bob Washburn\n`;
  txt += `Email: huskyauto@gmail.com\n`;
  txt += `Production: ${PROD_URL}\n`;
  txt += `QR Code: ${PROD_URL}\n`;
  txt += `License: Proprietary\n`;

  fs.writeFileSync("VisionClaw-Comprehensive-Features.txt", txt, "utf8");
  console.log(`[txt] wrote VisionClaw-Comprehensive-Features.txt — ${txt.length} bytes`);

  // ======================== PDF ========================
  const sections: any[] = [];
  sections.push({
    title: "Release Pass — Round 74.6 (Apr 24, 2026)",
    content:
      "Public website end-to-end refresh across all 11 marketing pages: model showcase corrected to 36 curated AI models in MODEL_REGISTRY + 1000+ discovered daily via OpenRouter, Subscription-First Routing (BYOS) and Claude Runner bridge surfaced to landing + about pages, R74.5/R74.4/R74.3/R74.2 entries appended to public updates timeline.",
    highlight:
      "R74.6.1 correction: initial pass overstated the tool count as 384 via a flawed grep. Real number, verified by deduplicating registerTool() calls, is " +
      TOOL_COUNT +
      " distinct tools. Lesson codified — marketing numeric stats derive from what the system actually uses, not from grep patterns that double-count.",
  });

  sections.push({
    title: "Recent rounds",
    bullets: [
      "R74.5 (Apr 24, 2026) — Tenant-isolation hardening: 14 fail-open patches across sessions, skills admin gate, workflow sanitization, daily notes, base64 upload validation, presenter token log redaction, public-chat tool dispatch fail-closed.",
      "R74.4 (Apr 24, 2026) — Persona augmentation: Forge IR Commander (SEV1-4 + post-mortem), Teagan AEO/GEO citation playbook, Atlas YouTube/Shorts/TikTok/Reels analytics, Robert purposeful-warmth principle.",
      "R74.3 (Apr 24, 2026) — Whole-app 3-pass architect review: 5 HIGH + 6 MEDIUM hardening bundle (Minerva CAS, KB-injection sanitizer, R74.A/B/C closures, /api/cache/stats + /api/drive-health admin gates).",
      "R74.2 (Apr 24, 2026) — Transient 5xx auto-retry wraps every outbound API call so cold-start hiccups recover transparently.",
      "R74 (Apr 24, 2026) — Cross-tenant email fail-closed (R74.A CRITICAL), Stripe Connect tenant guard (R74.B HIGH), pre-auth endpoint admin gates (R74.C HIGH).",
      "R73 (Apr 23, 2026) — Universal Model Catalog: OpenRouter daily probe surfaces 1000+ models on top of the 36-curated registry; orchestrator-ledger pg_advisory_lock double-spend prevention.",
      "R64 (Apr 23, 2026) — Three-tier image cascade (Gemini 2.5 Flash Image -> gpt-image-2 -> DALL-E 3); R59 Tool Curator semantic + perf re-rank.",
      "R63 (Apr 21, 2026) — Proactive self-healing engine; HIGH-priority insights auto-route to Minerva and Felix approval queue.",
      "R56 (Apr 19, 2026) — Robert (persona id 16) [Your Product] wellness layer: detectUserFatigue, micro-sabbatical, stress intervention, shame-spiral detection.",
    ],
  });

  sections.push({
    title: `Persona roster (${personas.length} specialist agents)`,
    table: {
      headers: ["ID", "Name", "Role"],
      rows: personas.map((p) => [String(p.id), p.name, p.role]),
    },
  });

  const toolSubsections: any[] = categories.map((c) => {
    const tools = [...toolMap[c]].sort();
    return {
      title: `${CATEGORY_LABELS[c] || c} (${tools.length})`,
      content: tools.join(", "),
    };
  });
  sections.push({
    title: `Complete tool inventory — all ${TOOL_COUNT} tools by category`,
    content:
      "Every tool registered via registerTool() in server/tool-registry.ts, audited at boot. Voice-safe subset (20 tools) is exposed via the Glasses Gateway allowlist for hands-free Meta Ray-Ban + Gemini Live operation.",
    subsections: toolSubsections,
  });

  sections.push({
    title: `Complete skills inventory — all ${skills.length} admin-curated skills`,
    content:
      "Skills are reusable expertise modules surfaced to every persona. Each skill is a structured capability prompt with description, instructions, and optional resources.",
    bullets: skills.map((s) => s.name),
  });

  sections.push({
    title: "AI model catalog",
    content:
      "36 models curated in server/providers.ts MODEL_REGISTRY plus 1000+ models discovered daily via the OpenRouter probe. Subscription-First Routing (BYOS) lets users bring their own ChatGPT Plus / Claude / Gemini subscription so primary inference runs at $0/token. Claude Runner bridge offloads long Claude conversations to a flat-fee subscription.",
    bullets: [
      "OpenAI: GPT-4o, o1, o3, gpt-image-2 (premium image, ~16s)",
      "Anthropic: Claude Sonnet 4.5, Claude Opus 4, Claude Haiku 4",
      "Google: Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash Image (default image, ~7s)",
      "xAI: Grok-4, Grok-4 Fast",
      "DeepSeek: DeepSeek-V3, DeepSeek-Coder",
      "OpenRouter: 1000+ models discovered daily, lifetime-scope dedupe (R73)",
      "Image cascade fallback: DALL-E 3",
      "Tier-routed with provider failover, semantic + perf re-rank by R59 Tool Curator",
    ],
  });

  sections.push({
    title: "Architecture & subsystems",
    bullets: [
      "Tenant isolation (R74.5): every tool dispatch fails closed if tenant unresolved.",
      "Guarded tool executor (R23.2/R23.3): rate limit + persona block + cost ledger in one wrapper.",
      "R59 Tool Curator: 4 layered signals (usage hints, semantic embeddings, per-tenant performance, soft deprecation).",
      "Glasses Gateway (R20): voice-safe allowlist of 20 tools, bearer auth via api_keys table.",
      "Customer-delivery pipeline: Stripe webhook -> service generation w/ QA -> manual review queue -> customer capability URL.",
      "Memory: pgvector embeddings + structured entries + cross-persona links + daily notes + scratchpad + knowledge triples.",
      "Self-healing (R63): low-risk insights auto-apply; HIGH-priority routes to Minerva -> Felix queue.",
      "Durable agent job queue (R60.B): crash recovery, exponential backoff, dead-letter, lease fencing.",
      "Wellness layer (R56, [Your Product]): fatigue detection, micro-sabbatical, stress intervention, shame-spiral detection.",
    ],
  });

  sections.push({
    title: "Company & contact",
    bullets: [
      "[Your Company] · [Your City, State] · EIN [YOUR-EIN]",
      "Owner: Bob Washburn · huskyauto@gmail.com",
      "Production: " + PROD_URL,
      "QR Code: scan to reach " + PROD_URL,
      "License: Proprietary",
    ],
  });

  const pdfResult = await generateStyledPdf({
    title: "VisionClaw Agent — Comprehensive Features",
    subtitle: `Round 74.6 release pass · ${TODAY}`,
    companyLines: [
      "[Your Company] · [Your City, State] · EIN [YOUR-EIN]",
      "Owner: Bob Washburn · huskyauto@gmail.com",
      "Production: " + PROD_URL,
    ],
    coverStats: [
      { label: "Tools", value: String(TOOL_COUNT) },
      { label: "Skills", value: String(skills.length) },
      { label: "Personas", value: String(personas.length) },
      { label: "Tables", value: String(TABLE_COUNT) },
      { label: "Models curated", value: "36" },
      { label: "Models daily", value: "1000+" },
      { label: "Gov rules", value: "40" },
      { label: "TS files", value: "382" },
      { label: "LOC", value: "~163k" },
    ],
    sections,
    footerLines: [
      `VisionClaw Agent · Round 74.6 · Generated ${TODAY}`,
      "[Your Company] · Bob Washburn · " + PROD_URL,
    ],
    fileName: "VisionClaw-Comprehensive-Features.pdf",
    folderLabel: "Platform Documentation",
    uploadToDrive: true,
  });

  console.log(`[pdf] generated — fileId=${pdfResult.fileId}`);
  console.log(`[pdf] viewUrl=${pdfResult.viewUrl}`);
  console.log(`[pdf] localPath=${pdfResult.localPath}`);

  // ======================== Upload TXT ========================
  const txtResult: any = await uploadAndShare({
    filePath: "VisionClaw-Comprehensive-Features.txt",
    fileName: "VisionClaw-Comprehensive-Features.txt",
    description: "VisionClaw Agent Platform - Complete Feature Document (Text) - R74.6",
    folderLabel: "Platform Documentation",
    share: true,
  });
  console.log(`[txt-upload] fileId=${txtResult.fileId}`);
  console.log(`[txt-upload] viewUrl=${txtResult.viewUrl}`);

  // ======================== Register in project DB ========================
  try {
    await db.execute(sql`
      INSERT INTO project_files (project_id, file_name, file_path, file_type, file_size, uploaded_by)
      VALUES
        (15, 'VisionClaw-Comprehensive-Features.pdf', ${pdfResult.viewUrl}, 'application/pdf', ${pdfResult.size || 0}, 'VisionClaw Agent'),
        (15, 'VisionClaw-Comprehensive-Features.txt', ${txtResult.viewUrl}, 'text/plain', ${txt.length}, 'VisionClaw Agent')
      ON CONFLICT DO NOTHING
    `);
    console.log("[db] registered both files in project 15");
  } catch (e: any) {
    console.warn("[db] register failed (non-fatal):", e.message);
  }

  // ======================== Email ========================
  const inboxResult: any = await getOrCreateTenantInbox(1);
  const inboxId = typeof inboxResult === "string" ? inboxResult : inboxResult.inboxId || inboxResult.email;
  await sendEmail({
    inboxId,
    to: process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com",
    subject: "VisionClaw Updated Features — Round 74.6 (PDF + Text)",
    text:
      `Bob,\n\n` +
      `Round 74.6 release pass complete. Comprehensive features document regenerated with corrected tool count (243, not 384).\n\n` +
      `PDF (styled, dark gradient cover, stats grid, full inventory):\n` +
      `${pdfResult.viewUrl}\n\n` +
      `Text (plain, exhaustive, Felix-readable):\n` +
      `${txtResult.viewUrl}\n\n` +
      `What's in this release:\n` +
      `  - R74.6 public website end-to-end refresh\n` +
      `  - R74.6.1 tool-count correction (384 -> 243, source-of-truth verified)\n` +
      `  - R74.5 tenant-isolation hardening (14 fail-open patches)\n` +
      `  - R74.4 persona augmentation (Forge/Teagan/Atlas/Robert)\n` +
      `  - R74.3 3-pass architect review hardening bundle\n` +
      `  - R74.2 transient 5xx auto-retry\n` +
      `  - R74 cross-tenant email + Stripe Connect + pre-auth endpoint hot-fix\n\n` +
      `Live stats:\n` +
      `  Tools     ${TOOL_COUNT}\n` +
      `  Skills    ${skills.length}\n` +
      `  Personas  ${personas.length}\n` +
      `  Tables    ${TABLE_COUNT}\n` +
      `  Models    36 curated + 1000+ daily via OpenRouter\n` +
      `  Code      382 TS files, ~163k LOC\n\n` +
      `— VisionClaw Agent`,
  });
  console.log(`[email] sent to ${process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com"}`);

  console.log("\n========================================");
  console.log("PDF_VIEW_URL=" + pdfResult.viewUrl);
  console.log("TXT_VIEW_URL=" + txtResult.viewUrl);
  console.log("========================================\n");

  process.exit(0);
})().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
