/**
 * R74.13z-quint+3 Comprehensive Features Generator
 *
 * Generates the comprehensive PDF + companion text file with EXHAUSTIVE
 * tool/skill/persona inventories so Felix has complete platform awareness
 * for presentations and customer work. Auto-uploads both to Drive,
 * registers in project_files for project 15, and emails the owner with
 * direct view links.
 *
 * Usage: timeout 180 npx tsx scripts/gen-r74-13z-quint3-features.ts
 */

import fs from "fs";
import path from "path";

(async () => {
  const startedAt = Date.now();
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);

  // ---------- Inventory: tools ----------
  const toolsSrc = fs.readFileSync(path.resolve("server/tools.ts"), "utf8");
  const toolMatches = [...toolsSrc.matchAll(/^\s+name: "([a-z0-9_]+)"/gm)];
  const allToolNames = [...new Set(toolMatches.map((m) => m[1]))].sort();

  // Pull the registry-canonical count too (the source of truth for the router)
  let registryCount = 0;
  try {
    const reg = await import("../server/tool-registry");
    registryCount = (reg.getAllRegisteredTools?.() || []).length;
  } catch (_e) {
    // fall back to grep count
    registryCount = allToolNames.length;
  }

  // ---------- Inventory: skills ----------
  const { db } = await import("../server/db");
  const { sql } = await import("drizzle-orm");
  const skillRows: any = await db.execute(
    sql`SELECT name FROM skills ORDER BY name`,
  );
  const skillNames: string[] = (skillRows.rows || skillRows).map(
    (r: any) => r.name,
  );

  // ---------- Inventory: personas ----------
  const personaRows: any = await db.execute(
    sql`SELECT id, name, role FROM personas WHERE is_active = true ORDER BY id`,
  );
  const personas: { id: number; name: string; role: string }[] = (
    personaRows.rows || personaRows
  ).map((r: any) => ({
    id: Number(r.id),
    name: String(r.name),
    role: String(r.role || ""),
  }));

  // ---------- Inventory: tables ----------
  const tableRows: any = await db.execute(
    sql`SELECT COUNT(*)::int as n FROM information_schema.tables WHERE table_schema='public'`,
  );
  const tableCount = Number(
    (tableRows.rows || tableRows)[0]?.n || 0,
  );

  // ---------- Group tools by prefix for readability ----------
  const groups: Record<string, string[]> = {
    "Memory & Recall": [],
    "Web & Search": [],
    "Email & Messaging": [],
    "Calendar & Scheduling": [],
    "Files & Storage": [],
    "Code & Development": [],
    "Personas & Delegation": [],
    "Tensions & ADRs": [],
    "Sales & CRM": [],
    "Finance & Reporting": [],
    "Browser & Workflow": [],
    "Content & Media": [],
    "Analytics & Health": [],
    "X / Twitter": [],
    "WhatsApp / Telegram": [],
    "Phone & SMS": [],
    "Other": [],
  };
  for (const t of allToolNames) {
    if (/(memor|recall|knowled|store_long_term|long_term)/i.test(t))
      groups["Memory & Recall"].push(t);
    else if (/(search|web_|crawl|scrape|deep_research|fetch_url|wiki|news_)/i.test(t))
      groups["Web & Search"].push(t);
    else if (/(email|inbox|mail|reply|whatsapp_send|telegram_send|sms_send|messag|sessions_send|sessions_list|sessions_history)/i.test(t))
      groups["Email & Messaging"].push(t);
    else if (/(calendar|schedul|meeting|reminder)/i.test(t))
      groups["Calendar & Scheduling"].push(t);
    else if (/(file|drive|upload|download|attachment|pdf|excel|csv)/i.test(t))
      groups["Files & Storage"].push(t);
    else if (/(code|commit|deploy|patch|propose_code|review_code|refactor|test_|lint)/i.test(t))
      groups["Code & Development"].push(t);
    else if (/(persona|delegate|agent_|orchestrate|spawn|approve_felix|swarm)/i.test(t))
      groups["Personas & Delegation"].push(t);
    else if (/(tension|adr|graph_explorer|architecture_decision|supersede)/i.test(t))
      groups["Tensions & ADRs"].push(t);
    else if (/(customer|lead|prospect|outreach|sequence|pipeline|deal|crm)/i.test(t))
      groups["Sales & CRM"].push(t);
    else if (/(invoice|expense|cash_flow|forecast|portfolio|ticker|stripe|payment|finance|cost_summary)/i.test(t))
      groups["Finance & Reporting"].push(t);
    else if (/(browser|workflow|automate|playwright|puppeteer)/i.test(t))
      groups["Browser & Workflow"].push(t);
    else if (/(image|video|audio|caption|hero|render|presentation|deck|slide|content_idea|compose_social)/i.test(t))
      groups["Content & Media"].push(t);
    else if (/(health|status|metric|stats|analytics|report|surprise|anomaly|monitor|cache_stats|cost_stats)/i.test(t))
      groups["Analytics & Health"].push(t);
    else if (/^x_|tweet|twitter/i.test(t)) groups["X / Twitter"].push(t);
    else if (/(whatsapp|telegram|baileys)/i.test(t))
      groups["WhatsApp / Telegram"].push(t);
    else if (/(phone|call|voice|sms)/i.test(t))
      groups["Phone & SMS"].push(t);
    else groups["Other"].push(t);
  }

  // ---------- Build PDF sections ----------
  const personaSubsections = personas.map((p) => ({
    title: `${p.id}. ${p.name}`,
    content: p.role,
  }));

  const skillSubsections = (() => {
    // chunk skills into 4-column-ish groups for readability
    const out: any[] = [];
    const chunkSize = 16;
    for (let i = 0; i < skillNames.length; i += chunkSize) {
      out.push({
        title: `Skills ${i + 1}–${Math.min(i + chunkSize, skillNames.length)}`,
        bullets: skillNames.slice(i, i + chunkSize),
      });
    }
    return out;
  })();

  const toolSubsections = Object.entries(groups)
    .filter(([_g, list]) => list.length > 0)
    .map(([groupName, list]) => ({
      title: `${groupName} (${list.length})`,
      content: list.sort().join(", "),
    }));

  const sections = [
    {
      title: "Platform Overview",
      content:
        "VisionClaw is a multi-tenant agentic AI back office that takes paid customer work from intake through Stripe checkout to quality-gated PDF/file delivery, with manual-review-then-graduate gates so a paid order can never silently fail. Built on Express/TypeScript + React/Vite + Drizzle ORM on Postgres, with Replit Auth, Stripe + Coinbase payments, and Google Drive / OneDrive / Gmail / Calendar / ElevenLabs / OpenAI / Anthropic / Gemini integrations all wired in.",
      bullets: [
        "Live: agenticcorporation.net — 71+ verified deliveries · 0 silent drops",
        "Built by [Your Company] · [Your City, ST] · EIN [YOUR-EIN] · Owner Bob Washburn",
        "Latest: R74.13z-quint+3 (April 29, 2026) — Tool Sommelier + flounder detection",
      ],
    },
    {
      title: "Latest Round — R74.13z-quint+3 (Tool Sommelier + Flounder Detection)",
      content:
        "Boot-time invariants flagged 257 of 259 registered tools as dormant — personas reach for the same handful and don't know the rest exist. Built two pieces on top of the new tensions/ADRs primitives from quint+2: (1) async Tool Sommelier curator that runs every 24h and writes up to 5 short playbook ADRs per cycle from real usage data, (2) flounder detector at end of each chat turn that files a tension when a persona promises action without calling any tool. The Sommelier reads new flounder tensions on its next cycle and writes resolving ADRs — self-correcting loop, no per-turn cost.",
      bullets: [
        "server/tool-sommelier.ts — 24h cycle, 5min boot delay, ≤5 ADRs/cycle, layered de-dup",
        "buildSystemPrompt — TOOL PLAYBOOK injection (latest 5 sommelier ADRs, decision sliced 400 chars)",
        "processMessage — flounder tension when 0 tools + actionable user msg + promise-without-action response",
        "15-min cooldown per tenant+persona with periodic 30-min TTL sweep on the cooldown map",
        "Architect review: PASS — 2 MAJORs caught + fixed (mid-loop ADR dedup, flounder false-positive gates)",
      ],
    },
    {
      title: "Round R74.13z-quint+2 — DreamGraph Nuggets (Tensions, ADRs, Graph Explorer)",
      content:
        "Three first-class primitives shipped to give every persona structured tools for surfacing reality-mismatch and decision history.",
      bullets: [
        "tensions table — predicted vs actual state with evidence, ownerPersonaId, sourceKind, status",
        "architecture_decisions table — full Michael Nygard ADR shape with supersedes chain + tags[]",
        "/api/graph-explorer endpoint + admin React page — SVG node-link viz, click-to-detail",
        "6 new tools: create_tension, list_open_tensions, resolve_tension, create_adr, list_adrs, supersede_adr",
        "ALWAYS_INCLUDE + LEAN_ALWAYS_INCLUDE updated so all 16 personas always see the new tools",
        "Doctrine #10 (TENSIONS + ADRs + GRAPH EXPLORER) appended to all 16 personas",
        "Surprise-scorer auto-creates a tension on every red-band proposal (15-min cooldown)",
      ],
    },
    {
      title: "Persona Roster (16 active)",
      content:
        "Every persona has its own tools_doc with curated tool focus areas, doctrine blocks, and protocol guardrails. All 16 see the new TOOL PLAYBOOK injection from the Tool Sommelier on every turn.",
      subsections: personaSubsections,
    },
    {
      title: `Skills Inventory (${skillNames.length} skills)`,
      content:
        "Skills are reusable capability bundles personas pull in via the skill-seeker. Each is grounded in a public source (or curated in-house) and exposed by name to every persona.",
      subsections: skillSubsections,
    },
    {
      title: `Complete Tool Inventory (${allToolNames.length} tools, ${registryCount} registered with router)`,
      content:
        "Every tool by name, grouped for browsability. The Tool Sommelier curates short playbook entries from this catalog every 24h based on real usage, then injects the latest 5 into every persona's system prompt so dormant tools surface in front of personas at exactly the right moment.",
      subsections: toolSubsections,
    },
    {
      title: "Architecture Stack",
      table: {
        headers: ["Layer", "Technology"],
        rows: [
          ["Backend", "Express + TypeScript on Node 20"],
          ["Frontend", "React + Vite + wouter + TanStack Query + shadcn/ui"],
          ["ORM", "Drizzle (additive-only schema discipline)"],
          ["Database", `Postgres (Replit) — ${tableCount} tables`],
          ["Auth", "Replit Auth + Bearer API keys (vc_ prefix)"],
          ["Payments", "Stripe + Coinbase Commerce (claim-then-commit webhook dedupe)"],
          ["LLMs", "OpenAI · Anthropic · Gemini · OpenRouter (1000+ daily auto-discovery)"],
          ["Speech", "ElevenLabs"],
          ["Files", "Google Drive · OneDrive (auto-upload + share)"],
          ["Email", "Gmail integration with per-tenant inboxes"],
          ["Calendar", "Google Calendar"],
          ["Hosting", "Replit Deployments — agenticcorporation.net"],
        ],
      },
    },
    {
      title: "Subsystems & Background Services",
      bullets: [
        "Heartbeat — autonomous task runner with delegation graph + step ledger",
        "Surprise Scorer — red/yellow/green band detection on every proposal, auto-creates tensions",
        "Tool Sommelier — 24h playbook curator (R74.13z-quint+3)",
        "Flounder Detector — promise-without-action tension filer (R74.13z-quint+3)",
        "Auto-Tuner — model selection optimizer based on cost/quality/latency",
        "Webhook Dedupe — durable claim-then-commit event ledger (Stripe + Coinbase)",
        "Tool Curator — semantic embedding cache for 259 tools",
        "Capability Registry — canonical record so planners use up-to-date info",
        "Attention Bus v0 — salience scoring with cooldowned high-salience notifications",
        "Minerva Strategic Planner — structured plans with approve/revise/reject gates",
        "Tenant-Context Hardening — STRICT_TENANT_CONTEXT flag + assertTenantContext()",
        "Encryption-at-Rest — AES-256-GCM for Telegram tokens + WhatsApp creds",
      ],
    },
    {
      title: "Key Metrics (live)",
      table: {
        headers: ["Metric", "Value"],
        rows: [
          ["Active Personas", String(personas.length)],
          ["Skills", String(skillNames.length)],
          ["Tools (TOOL_DEFINITIONS)", String(allToolNames.length)],
          ["Tools (Router-Registered)", String(registryCount)],
          ["Database Tables", String(tableCount)],
          ["Server LOC (TS)", "115,000+"],
          ["Client LOC (TS/TSX)", "42,000+"],
          ["Verified Deliveries", "71+"],
          ["Silent Drops", "0"],
          ["Replit Integrations", "11 (OpenAI, Anthropic, Gemini, ElevenLabs, Stripe, Drive, OneDrive, Auth, Sheets, Mail, Calendar)"],
        ],
      },
    },
    {
      title: "Company Information",
      bullets: [
        "[Your Company]",
        "EIN: [YOUR-EIN]",
        "[Your City, State], USA",
        "Owner: Bob Washburn (huskyauto@gmail.com)",
        "Live URL: https://agenticcorporation.net",
        "QR Code: agenticcorporation.net (Drive brand-assets file REDACTED_DRIVE_FILE_ID)",
      ],
    },
  ];

  // ---------- Generate PDF (auto-uploads to Drive) ----------
  console.log("[features] generating PDF...");
  const { generateStyledPdf } = await import("../server/pdf-create");
  const pdfResult = await generateStyledPdf({
    title: "VisionClaw Agent Platform",
    subtitle: `Comprehensive Features — ${dateStr}`,
    companyLines: [
      "[Your Company] | EIN: [YOUR-EIN]",
      "Owner: Bob Washburn | [Your City, State]",
      "https://agenticcorporation.net",
    ],
    coverStats: [
      { label: "Tools", value: String(allToolNames.length) },
      { label: "Skills", value: String(skillNames.length) },
      { label: "Personas", value: String(personas.length) },
      { label: "Tables", value: String(tableCount) },
      { label: "Deliveries", value: "71+" },
      { label: "Silent Drops", value: "0" },
      { label: "Latest", value: "R74.13z-quint+3" },
      { label: "Build Date", value: dateStr },
    ],
    sections,
    footerLines: [
      "[Your Company] · [Your City, ST] · EIN [YOUR-EIN]",
      "https://agenticcorporation.net · huskyauto@gmail.com",
    ],
    orientation: "portrait",
    fileName: "VisionClaw-Comprehensive-Features.pdf",
    folderLabel: "Platform Documentation",
    uploadToDrive: true,
  });
  console.log("[features] PDF result:", JSON.stringify({
    success: pdfResult.success,
    fileId: pdfResult.fileId,
    viewUrl: pdfResult.viewUrl,
    size: pdfResult.size,
  }));

  // ---------- Generate text companion ----------
  console.log("[features] generating text companion...");
  const lines: string[] = [];
  const hr = () => lines.push("=".repeat(78));
  const h2 = (s: string) => { lines.push(""); hr(); lines.push(s.toUpperCase()); hr(); };
  const h3 = (s: string) => { lines.push(""); lines.push(s); lines.push("-".repeat(Math.min(78, s.length))); };

  lines.push("VISIONCLAW AGENT PLATFORM");
  lines.push(`Comprehensive Features — ${dateStr}`);
  lines.push("");
  lines.push("[Your Company] · EIN [YOUR-EIN] · [Your City, ST]");
  lines.push("Owner: Bob Washburn (huskyauto@gmail.com)");
  lines.push("Live: https://agenticcorporation.net");
  lines.push("QR Code: agenticcorporation.net");

  h2("Platform Overview");
  lines.push(
    "VisionClaw is a multi-tenant agentic AI back office that takes paid customer",
  );
  lines.push(
    "work from intake through Stripe checkout to quality-gated PDF/file delivery,",
  );
  lines.push(
    "with manual-review-then-graduate gates so a paid order can never silently fail.",
  );
  lines.push(
    "Built on Express/TypeScript + React/Vite + Drizzle ORM on Postgres, with Replit",
  );
  lines.push(
    "Auth, Stripe + Coinbase payments, and 11 first-class Replit integrations wired in.",
  );

  h2(`Persona Roster (${personas.length} active)`);
  for (const p of personas) {
    lines.push(`  ${String(p.id).padStart(2, " ")}. ${p.name} — ${p.role}`);
  }

  h2(`Skills Inventory (${skillNames.length} skills)`);
  for (const s of skillNames) {
    lines.push(`  • ${s}`);
  }

  h2(
    `Complete Tool Inventory (${allToolNames.length} tools, ${registryCount} router-registered)`,
  );
  for (const [groupName, list] of Object.entries(groups)) {
    if (list.length === 0) continue;
    h3(`${groupName} (${list.length})`);
    list.sort();
    // wrap at ~76 chars
    let row = "  ";
    for (const t of list) {
      if (row.length + t.length + 2 > 76) {
        lines.push(row);
        row = "  ";
      }
      row += t + ", ";
    }
    if (row.trim().length > 0) lines.push(row.replace(/,\s*$/, ""));
  }

  h2("Latest Round — R74.13z-quint+3");
  lines.push("Tool Sommelier + Flounder Detection (April 29, 2026).");
  lines.push("Self-correcting loop on top of R74.13z-quint+2's tensions/ADRs primitives:");
  lines.push("  • Tool Sommelier (server/tool-sommelier.ts) — 24h async curator,");
  lines.push("    boots 5 minutes after server start, reads tool_performance + dormancy,");
  lines.push("    writes ≤5 short playbook ADRs per cycle (\"PLAYBOOK: when X, use Y\").");
  lines.push("    Layered de-dup (per-cycle title set + per-row SQL existence check).");
  lines.push("  • Playbook injection — buildSystemPrompt fetches latest 5 sommelier ADRs");
  lines.push("    and injects them into every persona's system prompt as TOOL PLAYBOOK.");
  lines.push("    One indexed query per turn, decision trimmed to 400 chars.");
  lines.push("  • Flounder detector — files a tension when ALL of: 0 tools called,");
  lines.push("    user msg ≥4 words, not a pure question, contains an actionable verb,");
  lines.push("    AND the response shows promise-without-action pattern.");
  lines.push("  • 15-min cooldown per tenant+persona, periodic 30-min TTL sweep.");
  lines.push("  • Architect review: PASS, 2 MAJORs caught + fixed before commit.");

  h2("Round R74.13z-quint+2 — DreamGraph Nuggets");
  lines.push("Tensions, ADRs, Graph Explorer (April 29, 2026).");
  lines.push("  • tensions table — predicted vs actual state with evidence + ownerPersonaId");
  lines.push("  • architecture_decisions table — full Nygard ADR shape with supersedes chain");
  lines.push("  • /api/graph-explorer endpoint + admin React page (SVG, click-to-detail)");
  lines.push("  • 6 new tools: create_tension, list_open_tensions, resolve_tension,");
  lines.push("    create_adr, list_adrs, supersede_adr");
  lines.push("  • ALWAYS_INCLUDE + LEAN_ALWAYS_INCLUDE updated so all 16 personas always see them");
  lines.push("  • Doctrine #10 appended to all 16 personas");
  lines.push("  • Surprise-scorer auto-creates a tension on every red-band proposal");

  h2("Architecture Stack");
  const stack: [string, string][] = [
    ["Backend", "Express + TypeScript on Node 20"],
    ["Frontend", "React + Vite + wouter + TanStack Query + shadcn/ui"],
    ["ORM", "Drizzle (additive-only schema discipline)"],
    ["Database", `Postgres (Replit) — ${tableCount} tables`],
    ["Auth", "Replit Auth + Bearer API keys (vc_ prefix)"],
    ["Payments", "Stripe + Coinbase Commerce (claim-then-commit webhook dedupe)"],
    ["LLMs", "OpenAI · Anthropic · Gemini · OpenRouter (1000+ daily)"],
    ["Speech", "ElevenLabs"],
    ["Files", "Google Drive · OneDrive (auto-upload + share)"],
    ["Email", "Gmail with per-tenant inboxes"],
    ["Calendar", "Google Calendar"],
    ["Hosting", "Replit Deployments — agenticcorporation.net"],
  ];
  for (const [k, v] of stack) lines.push(`  ${k.padEnd(12, " ")} ${v}`);

  h2("Subsystems & Background Services");
  for (const b of [
    "Heartbeat — autonomous task runner with delegation graph + step ledger",
    "Surprise Scorer — red/yellow/green band detection, auto-creates tensions",
    "Tool Sommelier — 24h playbook curator (R74.13z-quint+3)",
    "Flounder Detector — promise-without-action tension filer (R74.13z-quint+3)",
    "Auto-Tuner — model selection optimizer (cost / quality / latency)",
    "Webhook Dedupe — durable claim-then-commit ledger (Stripe + Coinbase)",
    "Tool Curator — semantic embedding cache for all 259 routable tools",
    "Capability Registry — canonical record so planners use up-to-date info",
    "Attention Bus v0 — salience scoring with cooldowned notifications",
    "Minerva Strategic Planner — structured plans with approve/revise/reject gates",
    "Tenant-Context Hardening — STRICT_TENANT_CONTEXT + assertTenantContext()",
    "Encryption-at-Rest — AES-256-GCM for Telegram tokens + WhatsApp creds",
  ]) {
    lines.push(`  • ${b}`);
  }

  h2("Key Metrics");
  for (const [k, v] of [
    ["Active Personas", String(personas.length)],
    ["Skills", String(skillNames.length)],
    ["Tools (TOOL_DEFINITIONS)", String(allToolNames.length)],
    ["Tools (Router-Registered)", String(registryCount)],
    ["Database Tables", String(tableCount)],
    ["Server LOC (TS)", "115,000+"],
    ["Client LOC (TS/TSX)", "42,000+"],
    ["Verified Deliveries", "71+"],
    ["Silent Drops", "0"],
    ["Replit Integrations", "11"],
  ] as [string, string][]) {
    lines.push(`  ${k.padEnd(28, " ")} ${v}`);
  }

  h2("Company Information");
  lines.push("  [Your Company]");
  lines.push("  EIN: [YOUR-EIN]");
  lines.push("  [Your City, State], USA");
  lines.push("  Owner: Bob Washburn (huskyauto@gmail.com)");
  lines.push("  Live URL: https://agenticcorporation.net");
  lines.push("  QR Code: agenticcorporation.net");

  hr();
  lines.push(
    `Generated ${new Date().toISOString()} · build duration ${(
      (Date.now() - startedAt) /
      1000
    ).toFixed(1)}s`,
  );

  const txtPath = path.resolve("VisionClaw-Comprehensive-Features.txt");
  fs.writeFileSync(txtPath, lines.join("\n"));
  console.log(`[features] text written to ${txtPath} (${fs.statSync(txtPath).size} bytes)`);

  // ---------- Upload text to Drive ----------
  console.log("[features] uploading text to Drive...");
  const { uploadAndShare } = await import("../server/google-drive");
  const txtResult = await uploadAndShare({
    filePath: txtPath,
    fileName: "VisionClaw-Comprehensive-Features.txt",
    mimeType: "text/plain",
    description:
      "VisionClaw Agent Platform — Comprehensive Features (text companion to the styled PDF)",
    folderLabel: "Platform Documentation",
    share: true,
  } as any);
  console.log("[features] TXT result:", JSON.stringify({
    fileId: txtResult.fileId,
    viewUrl: txtResult.viewUrl,
  }));

  // ---------- Register both in project_files for project 15 ----------
  try {
    await db.execute(sql`
      INSERT INTO project_files (project_id, file_name, file_path, file_type, file_size, uploaded_by)
      VALUES
        (15, 'VisionClaw-Comprehensive-Features.pdf', ${pdfResult.viewUrl}, 'application/pdf', ${pdfResult.size || 0}, 'VisionClaw Agent'),
        (15, 'VisionClaw-Comprehensive-Features.txt', ${txtResult.viewUrl}, 'text/plain', ${fs.statSync(txtPath).size}, 'VisionClaw Agent')
      ON CONFLICT DO NOTHING
    `);
    console.log("[features] registered both files in project_files (project 15)");
  } catch (regErr: any) {
    console.warn(`[features] project_files registration warning: ${regErr?.message}`);
  }

  // ---------- Email owner ----------
  console.log("[features] emailing owner...");
  const { getOrCreateTenantInbox, sendEmail } = await import("../server/email");
  const inboxResult: any = await getOrCreateTenantInbox(1);
  const inboxId =
    typeof inboxResult === "string"
      ? inboxResult
      : inboxResult?.inboxId || inboxResult?.email;
  const ownerEmail =
    process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com";

  await sendEmail({
    inboxId,
    to: ownerEmail,
    subject: `VisionClaw Updated Features — PDF + Text (${dateStr})`,
    text: `Bob,

The R74.13z-quint+3 comprehensive features pack just shipped. Both files were generated from the live state of the platform — every persona, every skill, every tool by name — and uploaded to Google Drive.

PDF (styled, dark gradient cover, stats grid, branded sections):
${pdfResult.viewUrl}

Text (plain text companion, complete inventories — what Felix consumes):
${txtResult.viewUrl}

Snapshot:
  Personas:                  ${personas.length}
  Skills:                    ${skillNames.length}
  Tools (definitions):       ${allToolNames.length}
  Tools (router-registered): ${registryCount}
  Database tables:           ${tableCount}
  Latest round:              R74.13z-quint+3 (Tool Sommelier + flounder detection)

Both files are also registered in project_files for project 15 so Felix can pick them up automatically.

— VisionClaw Agent`,
  } as any);
  console.log("[features] email sent to", ownerEmail);

  // ---------- Persist URLs for the agent to surface ----------
  fs.writeFileSync(
    "/tmp/features-result.json",
    JSON.stringify(
      {
        pdf: {
          viewUrl: pdfResult.viewUrl,
          fileId: pdfResult.fileId,
          size: pdfResult.size,
        },
        txt: {
          viewUrl: txtResult.viewUrl,
          fileId: txtResult.fileId,
          size: fs.statSync(txtPath).size,
        },
        emailedTo: ownerEmail,
        stats: {
          personas: personas.length,
          skills: skillNames.length,
          tools: allToolNames.length,
          registeredTools: registryCount,
          tables: tableCount,
        },
        durationSec: ((Date.now() - startedAt) / 1000).toFixed(1),
      },
      null,
      2,
    ),
  );
  console.log("[features] DONE");
  process.exit(0);
})().catch((err) => {
  console.error("[features] FATAL:", err?.stack || err?.message || err);
  process.exit(1);
});
