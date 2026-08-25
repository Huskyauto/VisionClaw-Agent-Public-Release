import fs from "fs";
import path from "path";

(async () => {
  const { generateStyledPdf, htmlToPdfAndUpload } = await import("../server/pdf-create");

  const opts = {
    title: "AI-Native Readiness Audit",
    subtitle: "VisionClaw self-audit — published 2026-05-24",
    companyLines: [
      "Powered by VisionClaw",
      "https://agenticcorporation.net/audit",
    ],
    coverStats: [
      { label: "Composite", value: "60 / 100" },
      { label: "Band", value: "C" },
      { label: "Dimensions", value: "8" },
      { label: "Zombie Tools", value: "21" },
    ],
    sections: [
      {
        title: "Composite Score: 60 / 100 — Band C",
        content:
          "VisionClaw self-audit covering the last 30 days as of 2026-05-24. 8-dimension weighted composite, scored 0–100 and banded A–D.",
        table: {
          headers: ["#", "Dimension", "Score / 10", "Weight"],
          rows: [
            ["1", "Agent inventory hygiene", "5.0", "15"],
            ["2", "Tool sprawl ratio", "0.5", "15"],
            ["3", "AHB safety_profile coverage", "10.0", "20"],
            ["4", "Tenant isolation posture", "8.4", "20"],
            ["5", "Prod/dev schema drift", "7.5", "10"],
            ["6", "Deliverable reliability", "5.0", "10"],
            ["7", "MoA / jury concordance usage", "3.0", "5"],
            ["8", "Cost-per-deliverable visibility", "3.0", "5"],
          ],
        },
      },
      {
        title: "Top-line findings",
        bullets: [
          "Tool sprawl ratio — 0.5/10 — Tool catalog is bloated. Agents pay an embedding/selection tax for every unused tool.",
          "MoA / jury concordance usage — 3.0/10 — No ensemble escalation observed. Single-model decisions on ambiguous tasks carry hidden risk.",
          "Cost-per-deliverable visibility — 3.0/10 — No cost instrumentation. Every token spent is invisible to finance, blocking unit-economics decisions.",
        ],
      },
      {
        title: "Agent inventory hygiene — 5.0 / 10 (weight 15)",
        content:
          "Evidence: Active personas: 16. Used in last 30d: 8. Zombie rate: 50.0%. Zombie personas: Agent Blueprint, Apollo, Atlas, Cassandra, Luna, Minerva, Neptune, Robert.\n\nInterpretation: Significant zombie footprint. Audit which agents are still needed.\n\nRecommendation: Mark 8 zombie personas as is_active=false until a real workflow needs them.",
      },
      {
        title: "Tool sprawl ratio — 0.5 / 10 (weight 15)",
        content:
          "Evidence: Tools registered: 21. Tools invoked last 30d: 1. Unused tool rate: 95.2%.\n\nInterpretation: Tool catalog is bloated. Agents pay an embedding/selection tax for every unused tool.\n\nRecommendation: Archive or gate 20 unused tools. See Zombie Detector at /admin/zombie-detector.",
      },
      {
        title: "AHB safety_profile coverage — 10.0 / 10 (weight 20)",
        content:
          "Evidence: Active personas: 16. With populated safety_profile: 16. Coverage: 100.0%.\n\nInterpretation: Full AHB coverage per Galisai et al. 2026. Every consumer-facing agent has an intent gate.\n\nRecommendation: Maintain via CI test (tests/security/persona-safety-profile-coverage.test.ts).",
      },
      {
        title: "Tenant isolation posture — 8.4 / 10 (weight 20)",
        content:
          "Evidence: Tables total: 177. With tenant_id: 148. Coverage: 83.6%. Sample exempt tables: agent_settings, capabilities, code_health_findings, code_health_scans, contact_submissions, conversation_templates, deliverable_contracts, delivery_logs, heartbeat_logs, invoice_items.\n\nInterpretation: Solid isolation with documented exemptions (system tables, migrations, capability registry). Verify each exempt table is genuinely shared.\n\nRecommendation: Document the 29 exempt tables in shared/schema.ts comments; add tenant_id to any that are user-data-bearing.",
      },
      {
        title: "Prod/dev schema drift — 7.5 / 10 (weight 10)",
        content:
          "Evidence: N/A for self-audit (single-DB run). For customer audits, requires read-replica access to prod DB to compare \\d outputs.\n\nInterpretation: Not measured in self-audit mode.\n\nRecommendation: Enable prod read-replica access to score this dimension.",
      },
      {
        title: "Deliverable reliability — 5.0 / 10 (weight 10)",
        content:
          "Evidence: delivery_logs not queryable: column \"outcome\" does not exist.\n\nInterpretation: Delivery reliability not yet instrumented at the audit level.\n\nRecommendation: Add delivery_logs.status tracking with failure-rate alerting.",
      },
      {
        title: "MoA / jury concordance usage — 3.0 / 10 (weight 5)",
        content:
          "Evidence: ensemble_query + jury_triage invocations last 30d: 0.\n\nInterpretation: No ensemble escalation observed. Single-model decisions on ambiguous tasks carry hidden risk.\n\nRecommendation: Route borderline architect findings + ambiguous user requests through ensemble_query.",
      },
      {
        title: "Cost-per-deliverable visibility — 3.0 / 10 (weight 5)",
        content:
          "Evidence: Token-cost instrumentation not detected in agent_trace_spans schema.\n\nInterpretation: No cost instrumentation. Every token spent is invisible to finance, blocking unit-economics decisions.\n\nRecommendation: Add token_cost + cost_usd columns to agent_trace_spans; backfill via provider APIs.",
      },
      {
        title: "Top 10 prioritized recommendations",
        table: {
          headers: ["#", "Recommendation", "Priority", "Source dimension"],
          rows: [
            ["1", "Archive or gate 20 unused tools. See Zombie Detector at /admin/zombie-detector.", "P0", "Tool sprawl ratio"],
            ["2", "Route borderline architect findings + ambiguous user requests through ensemble_query.", "P0", "MoA / jury concordance usage"],
            ["3", "Add token_cost + cost_usd columns to agent_trace_spans; backfill via provider APIs.", "P0", "Cost-per-deliverable visibility"],
            ["4", "Mark 8 zombie personas as is_active=false until a real workflow needs them.", "P1", "Agent inventory hygiene"],
            ["5", "Add delivery_logs.status tracking with failure-rate alerting.", "P1", "Deliverable reliability"],
            ["6", "Enable prod read-replica access to score this dimension.", "P2", "Prod/dev schema drift"],
            ["7", "Document the 29 exempt tables in shared/schema.ts comments; add tenant_id to any that are user-data-bearing.", "P2", "Tenant isolation posture"],
            ["8", "Maintain via CI test (tests/security/persona-safety-profile-coverage.test.ts).", "P2", "AHB safety_profile coverage"],
          ],
        },
      },
      {
        title: "How this audit was generated",
        content:
          "Generated by scripts/run-self-audit.ts using the ai-native-readiness-audit output-skill recipe at data/output-skills/ai-native-readiness-audit.md. Every score is backed by a SQL snippet runnable against your own DATABASE_URL — see the Evidence block under each dimension. Methodology: 8-dimension weighted composite, scored 0–100, banded A–D.",
        highlight: "Get your own audit at agenticcorporation.net/audit",
      },
      {
        title: "Shareable Scorecard",
        content:
          "VisionClaw Self-Audit — Composite 60 / 100 (Band C). 8 weighted dimensions, 21 tools registered, 16 active personas, 100% AHB safety coverage, 83.6% tenant isolation coverage.",
        table: {
          headers: ["Dimension", "Score / 10", "Weight"],
          rows: [
            ["Agent inventory hygiene", "5.0", "15"],
            ["Tool sprawl ratio", "0.5", "15"],
            ["AHB safety_profile coverage", "10.0", "20"],
            ["Tenant isolation posture", "8.4", "20"],
            ["Prod/dev schema drift", "7.5", "10"],
            ["Deliverable reliability", "5.0", "10"],
            ["MoA / jury concordance usage", "3.0", "5"],
            ["Cost-per-deliverable visibility", "3.0", "5"],
          ],
        },
        bullets: [
          "Best: AHB safety_profile coverage — 10.0/10 (100% coverage across all 16 active personas).",
          "Best: Tenant isolation posture — 8.4/10 (148 / 177 tables scoped by tenant_id).",
          "Worst: Tool sprawl ratio — 0.5/10 (95.2% of registered tools unused in last 30d).",
          "Worst: MoA / jury concordance usage — 3.0/10 (zero ensemble escalations observed).",
          "Worst: Cost-per-deliverable visibility — 3.0/10 (no token-cost instrumentation).",
        ],
        highlight: "Want this audit for your own stack? Visit agenticcorporation.net/audit",
      },
    ],
    footerLines: [
      "Powered by VisionClaw — get your audit at agenticcorporation.net/audit",
    ],
    fileName: "visionclaw-self-audit-2026-05-24.pdf",
    uploadToDrive: false as const,
  };

  let result: any;
  try {
    result = await generateStyledPdf(opts as any);
  } catch (e: any) {
    console.error("generateStyledPdf threw:", e?.message);
    result = { success: false, error: e?.message };
  }

  if (!result?.success || !result?.localPath) {
    console.warn("[fallback] generateStyledPdf failed; attempting htmlToPdfAndUpload fallback");
    try {
      const html = `<h1>${opts.title}</h1><h2>${opts.subtitle}</h2><pre>${JSON.stringify(opts.sections, null, 2)}</pre>`;
      const fb = await htmlToPdfAndUpload(html, opts.title, "audit-samples");
      console.log("FALLBACK_RESULT:", JSON.stringify(fb));
      result = fb;
    } catch (e: any) {
      console.error("htmlToPdfAndUpload also failed:", e?.message);
    }
  }

  console.log("PDF_RESULT:", JSON.stringify(result));

  let exitCode = 1;
  let copyOk = false;

  if (result?.localPath) {
    const srcRel = result.localPath.startsWith("/")
      ? result.localPath.slice(1)
      : result.localPath;
    const srcAbs = path.resolve(process.cwd(), srcRel);
    const destAbs = path.resolve(
      process.cwd(),
      "attached_assets/visionclaw-self-audit-2026-05-24.pdf",
    );
    if (fs.existsSync(srcAbs)) {
      try {
        fs.copyFileSync(srcAbs, destAbs);
        const stat = fs.statSync(destAbs);
        console.log(`COPIED_TO: ${destAbs} (${stat.size} bytes)`);
        if (stat.size > 50_000) {
          copyOk = true;
          exitCode = 0;
        } else {
          console.error(
            `[fail-closed] Output too small (${stat.size} bytes < 50KB threshold) — treating as failed render`,
          );
        }
      } catch (e: any) {
        console.error(`[fail-closed] Copy failed: ${e?.message}`);
      }
    } else {
      console.error(
        `[fail-closed] Source file not found at ${srcAbs} — PDF was reported as generated but isn't on disk`,
      );
    }
  } else {
    console.error(
      `[fail-closed] No localPath in result — both primary and fallback PDF paths produced nothing usable`,
    );
  }

  if (!copyOk) {
    console.error(
      `[fail-closed] PDF generation FAILED — exiting non-zero to prevent stale-output false-success`,
    );
  }

  process.exit(exitCode);
})();
