import { TOOL_DEFINITIONS } from "../server/tools";
import { getToolMeta } from "../server/tool-registry";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";
import { generateStyledPdf } from "../server/pdf-create";

(async () => {
  try {
    process.stdout.write("STEP_1_START\n");
    const toolNames = TOOL_DEFINITIONS.map((t: any) => t.function?.name).filter(Boolean).sort() as string[];
    const skillsRes = await db.execute(sql`SELECT name FROM skills ORDER BY name`);
    const skillRows: any[] = (skillsRes as any).rows || (skillsRes as any);
    const skillNames = skillRows.map((r: any) => r.name);
    const personasRes = await db.execute(sql`SELECT id, name, role FROM personas WHERE is_active = true ORDER BY id`);
    const personaRows: any[] = (personasRes as any).rows || (personasRes as any);
    const statsRes = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') AS tables,
        (SELECT COUNT(*) FROM research_programs WHERE is_active = true) AS programs,
        (SELECT COUNT(*) FROM research_experiments) AS experiments,
        (SELECT COUNT(*) FROM code_proposals) AS proposals_total,
        (SELECT COUNT(*) FROM code_proposals WHERE status = 'ready') AS proposals_ready
    `);
    const stats: any = ((statsRes as any).rows || (statsRes as any))[0];
    process.stdout.write(`STEP_2_DATA_LOADED tools=${toolNames.length} skills=${skillNames.length} personas=${personaRows.length}\n`);

    const toolsByCategory: Record<string, string[]> = {};
    for (const name of toolNames) {
      const meta = getToolMeta(name);
      const cats = meta?.categories?.length ? meta.categories : ["uncategorized"];
      for (const c of cats) {
        if (!toolsByCategory[c]) toolsByCategory[c] = [];
        toolsByCategory[c].push(name);
      }
    }
    const categoryOrder = Object.keys(toolsByCategory).sort();

    const SNAPSHOT_DATE = new Date().toISOString().slice(0, 10);
    const COVER_STATS = [
      { label: "Tools", value: String(toolNames.length) },
      { label: "Skills", value: String(skillNames.length) },
      { label: "Personas", value: String(personaRows.length) },
      { label: "DB Tables", value: String(stats.tables) },
      { label: "Source Files", value: "~505" },
      { label: "TS/TSX LOC", value: "192,489" },
      { label: "Research Programs", value: String(stats.programs) },
      { label: "Experiments Run", value: String(stats.experiments) },
      { label: "Code Proposals (READY)", value: `${stats.proposals_ready} / ${stats.proposals_total}` },
    ];

    const subsystems: string[] = [
      "AI Agent Orchestrator — 16-persona team with LLM-powered CEO, semantic tool router, MoA proposer ensemble",
      "Auto Model Router — OAuth-first, regime-aware (rlvr/distilled/sft/base)",
      "Heartbeat Engine — active 60s + idle 5min cadence",
      "Plan Executor — periodic stuck-plan sweep every 5 min",
      "Execution Supervisor — circuit breaker, output validation, hallucination detection, REASONING_GLUE_MISSING flag",
      "Self-Correction Engine — three-layer recovery (self-correct -> lean-mode -> backup-agent reroute)",
      "Auto-QA Pipeline + Universal Craftsmanship Quality Gate",
      "Stop-the-Line Error Triage Engine — bottleneck analysis with root-cause classification",
      "Trust-Tier Policy Engine (R76) — per-tenant pre-approval rules with specificity-ranked matching",
      "Deliverable Contract Verification (R76) — typed acceptance checks (extension + MIME + render)",
      "Job Worker + Spool Drainer — DB-backed durable job queue + filesystem-spool fallback (R60)",
      "OAuth Auto-Refresh — checks every 5 min, refreshes <45 min remaining",
      "Trust Engine — per-tenant trust scoring with audit log",
      "Capability Registry — 89 active capabilities synced on boot",
      "Wiring-Invariants — boot-time DB sanity checks (47/47 production indexes)",
      "Tool Sommelier — 24h cycle writing playbook ADRs from real usage data",
      "3-Phase Dreaming Scheduler — Light + Deep every cycle; REM when >=18h since last diary",
      "Tool Curator — 272 cached embeddings for semantic tool routing",
      "Compaction Engine — structured 5-section summarization with quality audit + retry",
      "Heartbeat Watchdog — orphan-task scanning every 30s",
      "Health Monitor — 5min cadence platform health checks",
      "Auto-Tuner — 24h adaptive tuning cycle",
      "GraphRAG Five (R75) — PageRank importance, Louvain communities, causal-chain extractor, cAST chunking, dual-level retrieval",
      "Memory + Knowledge Graph — pgvector HNSW indexes, knowledge_triples, knowledge_communities, causal_chains",
      "Layered Identity System — 5 context layers",
      "Linux Foundation A2A v0.3 Agent Card (R78) — public /.well-known/agent.json discovery endpoint",
      "Glasses Gateway — voice-safe allowlist (20 of 272 tools) with 60/min + 4/min heavy rate limits",
      "MCP Server — SSE transport on /api/mcp/sse with per-tenant auth keys",
      "Felix HVAC End-to-End Pipeline — intake -> 5-architect plan -> production -> Drive -> auto-deliver email",
      "Universal Instant-Play Layer — one-click watch_url + download_url on every product tool result",
      "MarTech Bundle (R79) — voice-profile-aware hooks/posts/matrix/scoring",
      "KisMATH Reasoning Audit Rail (R77.5) — audit_reasoning_step + verify_math_chain + MoA exploration mode",
      "Public Mirror Workflow — sanitized open-source portfolio sync",
      "Auto Git Push Workflow — every checkpoint pushed to private GitHub mirror",
    ];
    const integrations = [
      "AI: OpenAI, Anthropic, Google Gemini, xAI, Perplexity, OpenRouter (DeepSeek, Kimi, Qwen, Llama, GLM, Nemotron, Gemma, MiMo), Replit OpenAI",
      "Voice/Media: ElevenLabs, Browserless.io, Google Magika, mermaid.ink",
      "Payments: Stripe, Coinbase",
      "Google Workspace: Drive, Gmail, Calendar, Sheets",
      "Microsoft: OneDrive",
      "Comms: AgentMail, WhatsApp Web (Baileys), Discord, Telegram, Twilio",
      "Auth: Replit OIDC, email+password, admin PIN",
      "Storage: Replit Object Storage, PostgreSQL with pgvector + HNSW",
      "Misc: ip-api.com (geolocation), Open-Meteo (weather), Figma (MCP)",
    ];

    const sections: any[] = [
      {
        title: "Platform Overview",
        content:
          "VisionClaw is a multi-tenant agentic AI platform — a self-hosted AI back office that ships paying-client deliverables end-to-end (intake -> execution -> quality-gated PDF/file -> Stripe -> delivery -> owner alert). It orchestrates 16 specialized AI personas across 272 tools and 61 skills, with 12 nightly autoresearch programs that propose their own code improvements via a manual-review-then-graduate pipeline.",
        highlight:
          "Stack: Express/TypeScript + React/Vite + Drizzle/Postgres+pgvector + Stripe + Replit OIDC. 192,489 LOC across ~505 project source files. 149 DB tables. 47/47 production indexes ensured on boot.",
      },
      {
        title: "Persona Roster (16 active)",
        bullets: personaRows.map((p: any) => `#${p.id} ${p.name} — ${p.role}`),
      },
      {
        title: `Skills Inventory (${skillNames.length} Felix-callable knowledge units)`,
        bullets: skillNames,
      },
      {
        title: `Tool Inventory by Category (${toolNames.length} tools total)`,
        subsections: categoryOrder.map((cat) => ({
          title: `[${cat}] (${toolsByCategory[cat].length} tools)`,
          content: toolsByCategory[cat].sort().join(", "),
        })),
      },
      { title: "Architectural Subsystems", bullets: subsystems },
      { title: "External Integrations", bullets: integrations },
      {
        title: "Recent Rounds (May 1-2 2026)",
        bullets: [
          "R79.1 — Research -> code-proposal pipeline fix. 1/9d -> 5/8min.",
          "R79 — MarTech Bundle: 6 new content tools.",
          "R78.1 — Five-architect parallel review; 6 verified hardening fixes.",
          "R78 — A2A v0.3 Agent Card public discovery endpoint.",
          "R77.7 — Four fixes from six-pronged whole-app review.",
          "R77.6 — Eleven security hardening fixes.",
          "R77.5 — KisMATH Reasoning Audit Rail.",
          "R76 — Trust-Tier Policy Engine + Deliverable Contract Verification.",
          "R75 — GraphRAG Five.",
        ],
      },
      {
        title: "Platform Snapshot",
        table: {
          headers: ["Metric", "Value"],
          rows: [
            ["Tools", String(toolNames.length)],
            ["Skills", String(skillNames.length)],
            ["Personas (active)", String(personaRows.length)],
            ["DB Tables", String(stats.tables)],
            ["Project source files", "~505"],
            ["TS/TSX LOC", "192,489"],
            ["Research programs (active)", String(stats.programs)],
            ["Total experiments run", String(stats.experiments)],
            ["Code proposals (READY/total)", `${stats.proposals_ready} / ${stats.proposals_total}`],
            ["External integrations", "11"],
          ],
        },
      },
      {
        title: "Owner & Company",
        bullets: [
          "Owner: Bob Washburn (huskyauto@gmail.com)",
          "Company: [Your Company]",
          "EIN: [YOUR-EIN]",
          "Location: [Your City, State]",
          "Live: https://agenticcorporation.net",
          "QR Code on cover page resolves to agenticcorporation.net",
        ],
      },
    ];

    process.stdout.write("STEP_3_PDF_GENERATING\n");
    const pdfResult = await generateStyledPdf({
      title: "VisionClaw Agent Platform",
      subtitle: `Comprehensive Features — ${SNAPSHOT_DATE}`,
      companyLines: [
        "[Your Company] | EIN: [YOUR-EIN]",
        "Owner: Bob Washburn | [Your City, ST]",
        "https://agenticcorporation.net",
      ],
      coverStats: COVER_STATS,
      sections,
      footerLines: ["Generated by post-edit pipeline", new Date().toISOString()],
      orientation: "portrait",
      fileName: "VisionClaw-Comprehensive-Features.pdf",
      folderLabel: "Platform Documentation",
      uploadToDrive: true,
    });
    process.stdout.write("PDF_RESULT:" + JSON.stringify(pdfResult) + "\n");
    writeFileSync("/tmp/pdf-result.json", JSON.stringify(pdfResult, null, 2));
    process.exit(0);
  } catch (e: any) {
    process.stderr.write("PDF_ERROR:" + (e?.message || String(e)) + "\n");
    process.stderr.write((e?.stack || "") + "\n");
    process.exit(1);
  }
})();
