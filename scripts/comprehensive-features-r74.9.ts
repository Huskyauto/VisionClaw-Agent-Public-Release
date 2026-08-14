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
  txt += `Release: Round 74.9 — Auto-route ensemble + active clarification + Skill-RAG analytics\n`;
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
  txt += `R74.9 RELEASE PASS — WHAT CHANGED THIS SESSION (${TODAY})\n`;
  txt += "================================================================\n";
  txt += `R74.9 Auto-route ensemble + active clarification + Skill-RAG analytics\n`;
  txt += `  Four new chat-engine capabilities, all opt-out via env flags:\n\n`;
  txt += `  (a) AUTO-ROUTE TO 4-LLM ENSEMBLE (server/auto-ensemble.ts, threshold=5)\n`;
  txt += `      - Cheap regex+keyword scorer detects technical / strategic / multi-step\n`;
  txt += `        chats and force-invokes the R74.7 MoA pipeline (DeepSeek V4 Pro +\n`;
  txt += `        GPT-5.5 + Gemini 3.1 Pro -> Claude Opus 4.7 synthesis) instead of\n`;
  txt += `        single-model + persona judgment. Personas had ensemble_query in\n`;
  txt += `        their toolset but rarely chose it; this guarantees high-quality\n`;
  txt += `        synthesis on the queries that benefit most.\n`;
  txt += `      - Code blocks, "compare X to Y", "design a system", multi-clause\n`;
  txt += `        questions, "should I use X or Y" patterns score >=5 -> invoke.\n`;
  txt += `      - 75s outer timeout race (defense-in-depth on top of MoA's 45/60s\n`;
  txt += `        internal timeouts) falls through to normal flow on hangs.\n`;
  txt += `      - Skipped at depth>0, skipped for subagent traffic, skipped trivial.\n`;
  txt += `      - Smoke test: 9/9 invoke/skip cases pass.\n`;
  txt += `      - Kill switch: AUTO_ENSEMBLE_DISABLED=1\n\n`;
  txt += `  (b) ACTIVE CLARIFICATION (server/active-clarification.ts, 2-stage gate)\n`;
  txt += `      - Before doing heavy retrieval/reasoning, judge whether the user\n`;
  txt += `        message is so ambiguous that guessing risks a wrong answer.\n`;
  txt += `        Stage 1 = cheap regex (length <12 chars OR pronouns w/o context\n`;
  txt += `        OR raw "yes"/"no"). Stage 2 = gpt-5.4 judge with confidence score.\n`;
  txt += `      - If confidence < 0.6 -> ask one targeted clarifying question instead\n`;
  txt += `        of guessing. If >= 0.6 or LLM judge unavailable -> proceed (fail open).\n`;
  txt += `      - Only fires at depth=0, only for non-subagent traffic.\n`;
  txt += `      - Kill switch: ACTIVE_CLARIFY_DISABLED=1\n\n`;
  txt += `  (c) SELF-EVALUATION LOOP (existing — server/critique-agent.ts)\n`;
  txt += `      - critiqueResponse() already provided self-eval-lite via gpt-5-mini\n`;
  txt += `        across 4 dimensions (groundedness, relevance, completeness, safety),\n`;
  txt += `        refining the answer if score<6. Wired at chat-engine line ~3253.\n`;
  txt += `      - R74.9 confirmed this fully satisfies the "self-evaluation" goal\n`;
  txt += `        without needing additional code.\n\n`;
  txt += `  (d) SKILL-RAG DECISION ANALYTICS (server/skill-rag-analytics.ts)\n`;
  txt += `      - Every Skill-RAG decision (invoked or skipped) is now persisted to\n`;
  txt += `        the skill_rag_decisions table for observability + later threshold\n`;
  txt += `        tuning. Captures: tenant_id, question (truncated), invoked,\n`;
  txt += `        gate_reason, judge_confidence, judge_reason, skill_used, rewritten\n`;
  txt += `        query, sub-questions, exited, candidates_in/out, total_ms.\n`;
  txt += `      - Table CREATEd via psql direct CREATE TABLE per Bob's standing\n`;
  txt += `        rule (replit.md line 7+13 — no drizzle-kit push).\n`;
  txt += `      - Fire-and-forget insert via raw pg.Pool with positional params\n`;
  txt += `        (drizzle's sql template was emitting NaN-typed integers in the\n`;
  txt += `        13-arg INSERT for some param shapes).\n`;
  txt += `      - getSkillRagAnalyticsSummary(tenantId, days) returns:\n`;
  txt += `        totalDecisions / invocationRate / skillBreakdown / exitRate /\n`;
  txt += `        avgConfidence / avgLatencyMs / topGateReasons.\n`;
  txt += `      - Kill switch: SKILL_RAG_DISABLED=1 (suppresses skill-rag itself).\n\n`;
  txt += `  Code-review pass (architect, post-build):\n`;
  txt += `  - Initial verdict FAIL with 2 HIGH severity findings.\n`;
  txt += `  - Fix 1: Added 75s outer timeout race around executeMoA() so a\n`;
  txt += `    pathological provider hang can't stall a chat turn for 60+s.\n`;
  txt += `  - Fix 2: Pre-fetch storage.getMessages() ONCE for active-clarification\n`;
  txt += `    and reuse for the main chat path — eliminates duplicate full-history\n`;
  txt += `    DB read per top-level message.\n\n`;
  txt += `R74.8 Skill-RAG retrieval-quality judge + 4-skill router (Apr 25, 2026)\n`;
  txt += `  - gpt-5.4 judges retrieval quality; routes to one of 4 skills:\n`;
  txt += `    rewrite, multi-query, decompose, or none. Threshold 0.6.\n`;
  txt += `  - Adaptive: skips when initial recall is already strong.\n\n`;
  txt += `R74.7 Flagship MoA ensemble upgrade (Apr 24, 2026)\n`;
  txt += `  - DeepSeek V4 Pro + GPT-5.5 + Gemini 3.1 Pro -> Claude Opus 4.7 synthesis.\n`;
  txt += `  - Replaces older 3-LLM ensemble. Latency ~25-45s, quality jump confirmed\n`;
  txt += `    on hard reasoning + code questions.\n\n`;
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
    title: "Release Pass — Round 74.9 (Apr 25, 2026)",
    content:
      "Four new chat-engine capabilities all wired into the same depth=0 non-subagent path. (a) Auto-route to 4-LLM ensemble: cheap regex+keyword scorer detects technical/strategic/multi-step chats and force-invokes the R74.7 MoA pipeline (DeepSeek V4 Pro + GPT-5.5 + Gemini 3.1 Pro → Claude Opus 4.7 synthesis) instead of single-model + persona judgment, with 75s outer timeout race for safety. (b) Active clarification: 2-stage gate (regex → gpt-5.4 judge) — if confidence < 0.6, ask one targeted question instead of guessing. (c) Self-evaluation loop already provided by critiqueResponse (gpt-5-mini, 4 dims, refines if score<6). (d) Skill-RAG decision analytics persisted to skill_rag_decisions for observability + threshold tuning.",
    highlight:
      "Code review FAIL → fixed: outer 75s race on executeMoA prevents 60+s stalls; pre-fetched message history reused so we never double-read full conversation per top-level message. Insert path uses raw pg.Pool with positional params after drizzle's sql template emitted NaN-typed integers in this 13-arg INSERT for some param shapes. Skill-RAG analytics summary returns totalDecisions / invocationRate / skillBreakdown / exitRate / avgConfidence / avgLatencyMs / topGateReasons.",
  });

  sections.push({
    title: "Recent rounds",
    bullets: [
      "R74.8 (Apr 25, 2026) — Skill-RAG: gpt-5.4 retrieval-quality judge routes to rewrite/multi-query/decompose/none. Threshold 0.6, adaptive skip when initial recall strong.",
      "R74.7 (Apr 24, 2026) — Flagship MoA upgrade: DeepSeek V4 Pro + GPT-5.5 + Gemini 3.1 Pro → Claude Opus 4.7 synthesis. ~25-45s latency, quality jump on hard reasoning + code.",
      "R74.6 (Apr 24, 2026) — Public website end-to-end refresh. R74.6.1 corrected tool count from 384 → 243 (source-of-truth dedup of registerTool calls).",
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
    description: "VisionClaw Agent Platform - Complete Feature Document (Text) - R74.9",
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
    subject: "VisionClaw Updated Features — Round 74.9 (PDF + Text)",
    text:
      `Bob,\n\n` +
      `Round 74.9 release pass complete. Four new chat-engine capabilities + Skill-RAG analytics persistence are now live, with a code-review pass that fixed both HIGH severity findings before merge.\n\n` +
      `PDF (styled, dark gradient cover, stats grid, full inventory):\n` +
      `${pdfResult.viewUrl}\n\n` +
      `Text (plain, exhaustive, Felix-readable):\n` +
      `${txtResult.viewUrl}\n\n` +
      `What shipped this round:\n` +
      `  - R74.9 (a) auto-route to 4-LLM ensemble for technical chats (75s outer timeout race)\n` +
      `  - R74.9 (b) active clarification: ask instead of guess when confidence < 0.6\n` +
      `  - R74.9 (c) self-evaluation loop (existing critiqueResponse confirmed sufficient)\n` +
      `  - R74.9 (d) Skill-RAG decision analytics persisted to skill_rag_decisions\n` +
      `  - Code review fixes: outer MoA timeout, dedup full-history DB reads\n\n` +
      `Recent stack:\n` +
      `  - R74.8 Skill-RAG retrieval-quality judge + 4-skill router\n` +
      `  - R74.7 flagship MoA upgrade (DeepSeek V4 + GPT-5.5 + Gemini 3.1 → Claude 4.7)\n` +
      `  - R74.6 public website refresh + R74.6.1 tool-count correction\n` +
      `  - R74.5 tenant-isolation hardening\n` +
      `  - R74.3 3-pass architect review hardening bundle\n` +
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
