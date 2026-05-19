/**
 * Comprehensive Features Doc — PDF + text + Drive upload + project_files registration + owner email.
 *
 * Runs end-to-end the agent-callable portion of the post-edit-pipeline (steps 4-7).
 * Steps 1 (code review) and 2 (replit.md update) stay agent-driven. Step 3 (private
 * GitHub push) is handled by the Auto Git Push workflow on a 90s quiet timer.
 *
 * Usage:
 *   npx tsx scripts/build-features-doc.ts
 *
 * Env (all optional):
 *   OWNER_ALERT_EMAIL    — recipient (default: huskyauto@gmail.com)
 *   FEATURES_DOC_DATE    — date stamp in filename (default: today's YYYY-MM-DD UTC)
 *   FEATURES_SKIP_EMAIL  — set to "1" to skip the email step (Drive upload still happens)
 *
 * Exit codes: 0 success, 1 PDF gen failed, 2 Drive upload failed, 3 email failed, 4 misc.
 *
 * Counts pulled live: tools from TOOL_DEFINITIONS, skills from skills table, personas from
 * personas table. Stat headline numbers come from replit.md / README — keep replit.md current.
 */
import * as fs from "node:fs";
import { sql } from "drizzle-orm";
import { generateStyledPdf } from "../server/pdf-create";
import { uploadAndShare } from "../server/google-drive";
import { getOrCreateTenantInbox, sendEmail } from "../server/email";
import { TOOL_DEFINITIONS } from "../server/tools";
import { db } from "../server/db";

const HEADLINE_STATS = {
  tools: "359 (+ 4 MCP memory tools, external surface)",
  skills: "24 (.agents/) + 62 (db) + 25 (output-skills/)",
  personas: "16",
  capabilities: "110",
  tables: "176",
  indexes: "507",
  governance: "43",
  models: "36 + 1000+",
  loc: "~185k",
  release: "R117.1+sec",
};

(async () => {
  try {
    const today = process.env.FEATURES_DOC_DATE || new Date().toISOString().slice(0, 10);

    const toolNames = (TOOL_DEFINITIONS as any[])
      .map((t) => t.function?.name || t.name)
      .filter(Boolean)
      .sort();
    const skillsRes: any = await db.execute(sql`SELECT name FROM skills ORDER BY name`);
    const skillNames: string[] = ((skillsRes.rows || skillsRes) as any[]).map((r: any) => r.name);
    const personaRes: any = await db.execute(
      sql`SELECT id, name, role FROM personas WHERE is_active=true ORDER BY id`,
    );
    const personas: any[] = (personaRes.rows || personaRes) as any[];

    const stats = [
      { label: "Tools", value: HEADLINE_STATS.tools },
      { label: "Skills", value: HEADLINE_STATS.skills },
      { label: "Personas", value: HEADLINE_STATS.personas },
      { label: "Capabilities", value: HEADLINE_STATS.capabilities },
      { label: "Tables", value: HEADLINE_STATS.tables },
      { label: "Indexes", value: HEADLINE_STATS.indexes },
      { label: "Governance Rules", value: HEADLINE_STATS.governance },
      { label: "Models (curated)", value: HEADLINE_STATS.models },
      { label: "LOC", value: HEADLINE_STATS.loc },
    ];

    const toolGroups: Record<string, string[]> = {};
    for (const t of toolNames) {
      const k = t[0].toUpperCase();
      (toolGroups[k] = toolGroups[k] || []).push(t);
    }
    const toolBullets = Object.keys(toolGroups)
      .sort()
      .map((k) => `${k}: ${toolGroups[k].join(", ")}`);

    const sections: any[] = [
      {
        title: "Latest Releases",
        content:
          "Release narrative — see replit.md for the full R-round history with architect findings, FALSE POSITIVE log, and known gaps.",
        bullets: [
          "R116 (2026-05-18) — rohitg00/agentmemory Tier-A nugget bundle (5 nuggets in one round). N2 — per-category Ebbinghaus decay: added memory_entries.last_reinforced_at + memory_categories.half_life_days; ranker now decays facts at per-category rates (architecture decisions 90d, transient bugs 3d) on the same path. N6 — active contradiction resolver: NEW server/lib/contradiction-resolver.ts scores candidates 0.45×authority + 0.30×recency (20d e-fold) + 0.25×log-normalized support × confidence; hooked into MoA κ-low escalation as fail-OPEN belt-and-suspenders. N7 — heuristic quality_score gate: NEW server/lib/quality-score.ts grades every queue-routed memory write 0..1 on length+token+terminator+repetition+printable+source-class+confidence-cap; folded multiplicatively into ranker so malformed-but-confident facts get down-ranked. N9 — MCP memory scope: 4 new MCP tools (memory_smart_search / memory_save / memory_supersede / memory_list_recent) + 2 new scopes (memory:read / memory:write), all fail-CLOSED on missing scope. N14 — typed edge taxonomy: memory_links.confidence + source_count + DB CHECK constraint enforcing link_type ∈ {uses, depends_on, contradicts, caused, fixed, supersedes, related} + coerceLinkType fallback guard. Schema deltas via psql ALTER: tables 174→176, indexes 454→507, MCP scopes 3→5, MCP tools 8→12 (external surface; internal TOOL_DEFINITIONS unchanged at 357). Architect round 1 caught a memory_supersede orphan bug (UPDATE flipped old row even when enqueueMemoryFact rejected) → fixed same round, 5-test pin added. Architect round 2 (cross-app sweep) found 2 MEDIUMs + 1 LOW, all closed same round: (M1) memoryEntrySafeCols projection in server/storage.ts omitted lastReinforcedAt + qualityScore so ranker fell back to defaults on chat retrieval — fixed by adding both cols. (M2) MoA resolver pre-pass inert at MoA call site (homogeneous proposers) but real value at memory-contradiction sites — documented inline, leave wired (fail-OPEN). (L1) getLinkedMemories not tenant-parameterized — fixed by making tenantId: number | null REQUIRED. Wiring verified clean: 4 MCP tools live at POST /mcp (external surface, NOT in internal 357 TOOL_DEFINITIONS); internal personas continue via recall_memory → vectorSearchMemory and transparently benefit from R116 ranker enhancements; verify-agent-wiring CLEAN (0 dead / 0 drift / 0 trusted-leaks). 26/26 R116 tests PASS. tsc CLEAN, preflight CLEAN.",
          "R98.26.6 — Post-edit code-review hardening pass: 2 HIGH + 4 MEDIUM + 1 LOW closed (pass-2 architect ran clean). HIGH: Slack workspace allowlist (SLACK_ALLOWED_TEAM_ID / _ENTERPRISE_ID / _APP_ID, fails CLOSED when configured, fails OPEN with one-time warning when unset, called after signature verify and before rate-limit/ack/dispatch on both /api/slack/commands and /api/slack/events). HIGH: gpt-5.1 stripped from 5 live LLM callsites in server/tools.ts (run_supervisor writer/analyst/critic/router + commit_decision) — same Unknown-model class as the R98.26.1 hotfix. MEDIUM: 3 frontend gpt-5.1 defaults swept in settings.tsx + chat.tsx. MEDIUM: sanitizeLlmError extended with xapp- (Slack app token), whsec_ (Stripe webhook secret), and SDK shapes err.response.data.message + err.error.details; length cap applied LAST so secrets are redacted before truncation. MEDIUM: the tenant-namespace prefix mirror-leak-verifier exemption tightened from broad regex to strict numeric a strict numeric tenant-ID format with optional persona segment.",
          "R98.26.5 — Public-mirror CI all-green sweep: 4 of 5 hard gates were RED (TypeScript / Build / Docker smoke / Security & Tenant-Isolation Tests). Fixed wellness→wellness file-rename gap in stage-2 sed scrub, noImplicitAny on new inline arrow callback, missing lookupProduct/listSkus/getPublicCatalog stubs, seed-catalog-files.ts exit-2 on empty CATALOG, two stub SKUs the mirror tests assert exist, and a self-trip on a proprietary literal inside an explanatory comment. CI run 25490224844: all 5 jobs green.",
          "R98.26.4 — Cleanup batch: stale gpt-5.1 schema defaults swept across conversations + agent_settings; in-process per-channel Slack rate limiter (6/min, 60/hour) on both /commands and /events; mpim group DM accepted; runLlmTask/runLlmTextTask error sanitizer (sanitizeLlmError) strips URLs, API keys (sk-, sk-ant-, GitHub PAT, Slack xox*, Google AIza, AWS AKIA, Stripe sk_/rk_, Bearer), IPv4+port, IPv6, absolute filesystem paths (Linux/macOS/Windows), length-caps to 500.",
          "R98.26.3 — DM (Chat-tab) support: message event handler with channel_type === 'im' filter (excludes bot-authored messages and message subtypes to prevent reply loops). DMs route to Felix by default or to a named persona if the first word matches the known set. Channel @mention and Chat-tab DM both reply within ~10s in prod.",
          "R98.26.2 — Deployment migration: original Autoscale was killing setImmediate background dispatch after res.send() — Slack ack returned 200 but the LLM call was terminated mid-flight. Migrated to Reserved VM (gce). Initial Reserved VM crash-looped because ~50s of synchronous seeding ran before port 5000 opened → Replit health check killed the container. Fix in server/index.ts: in production only, bind port 5000 immediately after setupAuth, then continue async seeding; late listenWithRetry guarded with if (!httpServer.listening). Custom domain agenticcorporation.net re-attached after the deployment-type swap.",
          "R98.26.1 — Hotfix: first prod @mention surfaced empty [slack] dispatch error {} — log shipper serialized Error to {}. Replaced with explicit e?.message / e?.code / e?.stack[0..5] unwrap. Real cause: conversations.model schema default gpt-5.1 is NOT in MODEL_REGISTRY. Fix: pin Slack-created conversations to a registered model.",
          "R98.26 — Hyperagent parity sweep: three visible-gap closures vs hyperagent.com. (1) Slack invocation surface: POST /api/slack/commands (slash command), POST /api/slack/events (URL verification + app_mention + message.im DM + mpim group DM), GET /api/slack/health; HMAC-SHA256 v0 signature verify with 5-min window and timingSafeEqual; persona resolution: first token matches known set → routes there, else default Felix; replies truncated to 3500 chars, threaded for channel mentions, un-threaded for DMs. (2) Per-agent cost dashboard at /admin/persona-cost: 7/30/90d aggregates over agent_activity grouped by persona_id (activity counts, conversation counts, success rate, total wall-clock minutes, est. cost — powerful $0.030/min, balanced $0.010/min, fast $0.005/min); admin-gated, tenant-scoped, 60s refetch. (3) Agents gallery enrichment on landing: invocation-channels strip (Chat · Slack · Email · MCP · Scheduled/cron · REST API).",
          "R98.20 — CI concurrency group on .github/workflows/ci.yml; cancel-in-progress collapses one-per-job email noise to one transient per supersession.",
          "R98.19+sec — Whole-app code review sweep, six bugs closed including five silent-bypass HIGH security primitives caused by a recurring require()-under-ESM bug class (provider-error redaction, gate_command stdout fence, wrapAsData fence builder, presenter constant-time HMAC compare, Claude-importer prompt-injection scanner).",
          "R98.19 — Memory v2: confidence-scored facts (0.0-1.0 + source enum), 30s debounced write queue, synthesis-time substring + Jaccard ≥0.8 dedup, 8K-token cap on recall context. All 16 personas re-seeded.",
          "R98.18+sec — Self-healing maintenance sweep: drizzle-orm 0.39 → 0.45 (closed SQL-injection HIGH GHSA-gpj5-g38j-94v9), xlsx removed entirely (HIGH Prototype Pollution + ReDoS, no upstream fix) with the runtime call site migrated to exceljs + RFC 4180 CSV escaping, health-monitor ALERT_THRESHOLD 2 → 3.",
          "R98.17 — Cairo Cross-Pollination: 4-tier risk-class taxonomy on TOOL_POLICIES, hard kill switch (file-backed atomic JSON, <2s halt), MC-1 chat-vs-background slot reservation.",
          "R98.16 + +sec + +wiring + +sec-2 — IJFW Cross-Pollination: run_command (#296) with large-output sandbox, wave-table parallelism on plan_deliverable, translateLlmError 13-family error UX, DeepSeek as fourth architect lineage, sanitizeUntrusted defang, atomicWriteFileSync at 6 critical sites, six whole-app architect findings closed.",
          "R98.14 — Felix Deliverable Reliability Plan COMPLETE: durable resumable long-video jobs, nightly Golden Path Replay with freeze-on-drift, learn_from_reference (SSRF-jailed YouTube/web URL → 3-8 concrete copyable patterns), quality-instinct cards (8 formats × 8-11 checkable rules each).",
          "R98.13 — plan_deliverable prompt→pipeline router for 10 formats + grade_deliverable vision/audio quality grader (0-100 with bounded auto-revise).",
          "R98.12 — verify_delivery_proof refuse-to-declare-done gate + build_html_app single-file utilities + record/recall_strategic_wins positive-exemplar memory.",
        ],
      },
      {
        title: "Platform Architecture (current state)",
        bullets: [
          "16-persona AI corporation with LLM-powered CEO (Felix) + CTO (Forge) + 14 specialists.",
          "AsyncLocalStorage tenant context end-to-end through every authenticated path for accurate per-tenant cost attribution.",
          "Multi-layered Adversarial Humanities Benchmark (AHB) defense: per-persona safety_profile, destructive-tool policy (fail-closed), 158 security tests across 16 files in 6 categories.",
          "Memory v2 (R98.19): confidence-scored facts + debounced queue + Jaccard dedup + 8K token cap on recall.",
          "Aggressive parallel orchestration: up to 8 parallel agents; chunk-and-parallel pattern splits long jobs into ≤5-min units to fit Replit Temporal StartToClose timeout.",
          "Deterministic deliverable pipelines: 10 formats with vision/audio quality grading, bounded auto-revise, refuse-to-declare-done gates.",
          "Instant-play media delivery: purpose-built /uploads/delivery-N-filename streaming routes — bypasses Google Drive 5-30 min video transcoding delay.",
          "Self-maintaining platform (R97): weekly auto-maintenance cron (npm audit + outdated + SAST + transitive-CVE + prod schema parity + Railway health + model SDK currency).",
          "Camofox stealth-browser microservice (R96) for hard-blocked sites with universal-recall escalation ladder.",
        ],
      },
      {
        title: `Complete Tool Inventory (${toolNames.length} tools)`,
        content:
          "Every tool registered in the live TOOL_DEFINITIONS table, alphabetized. Felix uses this list as his canonical capability map.",
        bullets: toolBullets,
      },
      {
        title: `Complete Skills Inventory (${skillNames.length} skills in DB)`,
        content:
          "Every skill currently registered in the skills table (62 entries). A separate count of 23 lives on disk under .agents/skills/ — these are agent operating runbooks, not user-runnable AI skills. Both numbers are canonical; surfaces should mention both as 23 (.agents) + 62 (DB).",
        bullets: skillNames.length
          ? skillNames
          : ["_skills table currently empty — see .agents/skills/ on disk for the 23 agent operating runbooks_"],
      },
      {
        title: `Persona Roster (${personas.length} active)`,
        table: {
          headers: ["ID", "Name", "Role"],
          rows: personas.map((p) => [String(p.id), String(p.name || ""), String(p.role || "")]),
        },
      },
      {
        title: "Operations & Reliability",
        bullets: [
          "Auto Git Push workflow: 90s quiet timer + secret-scanner; private repo Huskyauto/VisionClaw-Agent.",
          "Public Mirror Push workflow: sanitizes (strips EIN, address, phone, internal SKUs, Drive file IDs, secret patterns) + force-pushes to Huskyauto/VisionClaw-Agent-Public-Release + syncs GitHub About sidebar via PATCH API.",
          "Agentic CI Self-Healer: polls GitHub Actions every 120s, auto-fixes red CI runs.",
          "Golden Path Replay: nightly canonical-prompt regression suite with freeze-on-drift + email-on-regression; soft cost cap $1/run.",
          "Load Test Layer 1: tiers 10 / 50 / 100 / 250 concurrent against agenticcorporation.net.",
          "Weekly Maintenance: 7-day cadence; npm + SAST + CVE + prod-DB parity + Railway health + model SDK currency → triaged email to owner.",
          "Health Monitor: 5-min interval, alert threshold 3 (R98.18+sec), 30-min cooldown + off-hours skip.",
        ],
      },
      {
        title: "Security & Governance",
        bullets: [
          "40 governance rules covering tool risk classes (LOW/MEDIUM/HIGH/CRITICAL), HITL approval flows, tenant-isolation invariants, SSRF jail (CGNAT 100.64.0.0/10, multicast, IPv6, ::ffff: IPv4-mapped, .internal/.cluster.local/.svc TLDs), outbound redaction.",
          "Hard kill switch: file-backed atomic JSON at data/system-state.json, 5s in-memory cache, atomic write + fsync; <2s halt of all background work.",
          "MC-1 Gate: chat reserves 3 slots; background tasks blocked when chat saturated AND background ≥75% utilized.",
          "HMAC-SHA256 hashed auth secrets; AES-256-GCM encryption at rest for sensitive credentials.",
          "Constant-time HMAC compare on /api/presenter (R98.19+sec restored).",
          "Prompt-injection scanner on every persona/mind/imported-Claude-agent body. R98.19+sec tightened importer scanner from false-fail-closed to true fail-closed quarantine.",
          "Per-tenant hourly escalation quota (20/hr) prevents one noisy tenant from draining platform escalation budget.",
        ],
      },
      {
        title: "Company",
        bullets: [
          "[Your Company]",
          "EIN: [YOUR-EIN]",
          "[Your City, State]",
          "Owner: Bob Washburn",
          "Email: huskyauto@gmail.com",
          "Production URL: https://agenticcorporation.net",
          "QR Code asset (Drive file ID): REDACTED_DRIVE_FILE_ID",
        ],
      },
    ];

    const pdfRes = await generateStyledPdf({
      title: "VisionClaw Agent Platform",
      subtitle: `Comprehensive Features — ${today}`,
      companyLines: [
        "[Your Company] | EIN: [YOUR-EIN]",
        "Owner: Bob Washburn | [Your City, ST]",
        "https://agenticcorporation.net | huskyauto@gmail.com",
      ],
      coverStats: stats,
      sections,
      footerLines: ["VisionClaw — Autonomous AI operations, built for real work."],
      orientation: "portrait",
      fileName: `VisionClaw-Comprehensive-Features-${today}.pdf`,
      folderLabel: "Platform Documentation",
      uploadToDrive: true,
    });
    if (!pdfRes.success || !pdfRes.viewUrl) {
      console.error("PDF_FAILED:", JSON.stringify(pdfRes));
      process.exit(1);
    }
    console.log(
      "PDF_RESULT:",
      JSON.stringify({ ok: true, viewUrl: pdfRes.viewUrl, fileId: pdfRes.fileId, size: pdfRes.size }),
    );

    // Build companion text file
    const txtLines: string[] = [];
    txtLines.push("================================================================");
    txtLines.push(`VISIONCLAW AGENT PLATFORM — COMPREHENSIVE FEATURES — ${today}`);
    txtLines.push("================================================================");
    txtLines.push("");
    txtLines.push("[Your Company] | EIN: [YOUR-EIN] | [Your City, ST]");
    txtLines.push("Owner: Bob Washburn | huskyauto@gmail.com");
    txtLines.push("Production: https://agenticcorporation.net");
    txtLines.push("QR Code: https://agenticcorporation.net  (Drive asset REDACTED_DRIVE_FILE_ID)");
    txtLines.push("");
    txtLines.push("-- LIVE STATS ---------------------------------------------------");
    for (const s of stats) txtLines.push(`  ${s.label.padEnd(22)} ${s.value}`);
    txtLines.push("");
    for (const sec of sections) {
      txtLines.push("");
      txtLines.push(`## ${sec.title}`);
      txtLines.push("-".repeat(64));
      if (sec.content) {
        txtLines.push(sec.content);
        txtLines.push("");
      }
      if (sec.bullets) for (const b of sec.bullets) txtLines.push(`  • ${b}`);
      if (sec.table) {
        txtLines.push("  " + sec.table.headers.join(" | "));
        txtLines.push("  " + sec.table.headers.map((h: string) => "-".repeat(h.length)).join("-+-"));
        for (const r of sec.table.rows) txtLines.push("  " + r.join(" | "));
      }
    }
    txtLines.push("");
    txtLines.push("================================================================");
    txtLines.push("END OF DOCUMENT");
    txtLines.push("================================================================");

    const snapshotDir = `/home/runner/workspace/docs/snapshots`;
    fs.mkdirSync(snapshotDir, { recursive: true });
    const txtPath = `${snapshotDir}/VisionClaw-Comprehensive-Features-${today}.txt`;
    fs.writeFileSync(txtPath, txtLines.join("\n"));

    let txtRes: any;
    try {
      txtRes = await uploadAndShare({
        filePath: txtPath,
        fileName: `VisionClaw-Comprehensive-Features-${today}.txt`,
        description: "VisionClaw Agent Platform — Complete Feature Document (Text)",
        folderLabel: "Platform Documentation",
        share: true,
      } as any);
    } catch (e: any) {
      console.error("TXT_UPLOAD_FAILED:", e?.message || e);
      process.exit(2);
    }
    console.log("TXT_RESULT:", JSON.stringify({ viewUrl: txtRes.viewUrl, fileId: txtRes.fileId }));

    // Register both in project_files for Felix (project 15). project_files schema
    // has file_url, NOT file_path; no tenant_id column.
    try {
      await db.execute(sql`
        INSERT INTO project_files (project_id, file_name, file_url, file_type, file_size, uploaded_by)
        VALUES
          (15, ${`VisionClaw-Comprehensive-Features-${today}.pdf`}, ${pdfRes.viewUrl}, 'application/pdf', ${pdfRes.size || 0}, 'VisionClaw Agent'),
          (15, ${`VisionClaw-Comprehensive-Features-${today}.txt`}, ${txtRes.viewUrl}, 'text/plain', ${fs.statSync(txtPath).size}, 'VisionClaw Agent')
        ON CONFLICT DO NOTHING
      `);
      console.log("REGISTERED: project_files project_id=15");
    } catch (e: any) {
      console.warn("REGISTER_WARN:", e?.message);
    }

    if (process.env.FEATURES_SKIP_EMAIL === "1") {
      console.log("EMAIL_SKIPPED (FEATURES_SKIP_EMAIL=1)");
    } else {
      try {
        const inboxResult: any = await getOrCreateTenantInbox(1);
        const inboxId =
          typeof inboxResult === "string"
            ? inboxResult
            : inboxResult.inboxId || inboxResult.email;
        const ownerEmail = process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com";
        const emailBody = [
          `Hi Bob,`,
          ``,
          `The updated VisionClaw Comprehensive Features document is ready in two formats. Both are live in Google Drive — open either link in any browser or device.`,
          ``,
          `📄 PDF (styled, dark gradient cover, stats grid, branded sections):`,
          `   ${pdfRes.viewUrl}`,
          ``,
          `📝 Text (Felix's machine-readable knowledge base — same exhaustive content):`,
          `   ${txtRes.viewUrl}`,
          ``,
          `Both files include latest releases, live stats (${HEADLINE_STATS.tools} tools, ${HEADLINE_STATS.skills} skills, ${HEADLINE_STATS.personas} personas, ${HEADLINE_STATS.capabilities} active capabilities, ${HEADLINE_STATS.tables} tables, ${HEADLINE_STATS.indexes} indexes, ${HEADLINE_STATS.governance} governance rules), the complete tool inventory (all ${toolNames.length} live tools by name), the persona roster, and ops/security sections.`,
          ``,
          `GitHub:`,
          `  • Private: https://github.com/Huskyauto/VisionClaw-Agent`,
          `  • Public:  https://github.com/Huskyauto/VisionClaw-Agent-Public-Release`,
          ``,
          `— VisionClaw`,
        ].join("\n");

        await sendEmail({
          inboxId,
          to: ownerEmail,
          subject: `VisionClaw Updated Features — PDF + Text (${today})`,
          text: emailBody,
        } as any);
        console.log("EMAIL_SENT:", ownerEmail);
      } catch (e: any) {
        console.error("EMAIL_FAILED:", e?.message || e);
        process.exit(3);
      }
    }

    console.log("");
    console.log("==== FINAL LINKS ====");
    console.log("PDF:  " + pdfRes.viewUrl);
    console.log("TXT:  " + txtRes.viewUrl);
    process.exit(0);
  } catch (e: any) {
    console.error("PIPELINE_ERROR:", e?.stack || e?.message || e);
    process.exit(4);
  }
})();
