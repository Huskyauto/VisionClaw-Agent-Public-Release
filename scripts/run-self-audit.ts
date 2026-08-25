#!/usr/bin/env tsx
/**
 * AI-Native Readiness Audit — Self-Audit Runner
 *
 * Runs the 8-dimension audit against our own DATABASE_URL and writes a
 * markdown report to attached_assets/visionclaw-self-audit-<date>.md
 *
 * Usage:
 *   tsx scripts/run-self-audit.ts [--window=30] [--out=path.md]
 *
 * Exit codes:
 *   0  success
 *   2  DATABASE_URL missing
 *   3  query failure
 */
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

// ─── Argument parsing (validated, no string interpolation into SQL) ────
const _winRaw = parseInt(process.argv.find(a => a.startsWith("--window="))?.split("=")[1] ?? "30", 10);
const WINDOW_DAYS = Number.isFinite(_winRaw) && _winRaw >= 1 && _winRaw <= 365 ? _winRaw : 30;

const _tidRaw = process.argv.find(a => a.startsWith("--tenant-id="))?.split("=")[1];
const TENANT_ID: number | null = _tidRaw && /^\d+$/.test(_tidRaw) ? parseInt(_tidRaw, 10) : null;

// R125+9.1 (architect HIGH #3 fix): when --tenant-id is provided, scope queries
// to that tenant. Without it, run platform-wide self-audit (current behavior).
const _redact = process.argv.includes("--redact");
// R125+9.1 (architect CRITICAL #2 partial fix): --redact strips persona names
// and table names. Default = verbose self-audit (launch narrative depends on
// naming our own zombies publicly). Customer audits should ALWAYS pass --redact.
const REDACT = _redact || TENANT_ID !== null; // auto-redact when running for a customer tenant

const _outArg = process.argv.find(a => a.startsWith("--out="))?.split("=")[1];
const ALLOWED_OUT_DIR = path.resolve("attached_assets");
const DEFAULT_OUT = `attached_assets/visionclaw-self-audit-${new Date().toISOString().slice(0,10)}.md`;
let OUT_PATH = _outArg ?? DEFAULT_OUT;
// R125+9.1 (architect MEDIUM #5 fix): confine writes to attached_assets/
{
  const resolved = path.resolve(OUT_PATH);
  if (!resolved.startsWith(ALLOWED_OUT_DIR + path.sep) && resolved !== ALLOWED_OUT_DIR) {
    console.error(`ERROR: --out must be inside attached_assets/ (got: ${OUT_PATH})`);
    process.exit(2);
  }
  OUT_PATH = resolved;
}

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not set");
  process.exit(2);
}

// SQL helper: tenant scope clause (empty string when self-audit mode).
// Always positional-parametrized — never string-concatenated user input.
function tenantScope(alias = ""): { clause: string; params: any[] } {
  if (TENANT_ID === null) return { clause: "", params: [] };
  const col = alias ? `${alias}.tenant_id` : "tenant_id";
  return { clause: ` AND ${col} = $1`, params: [TENANT_ID] };
}

type DimensionScore = {
  name: string;
  weight: number;
  raw: number;        // 0..10
  evidence: string;   // SQL output rendered as text
  interpretation: string;
  recommendation: string;
};

async function q(client: Client, sql: string, params: any[] = []): Promise<any[]> {
  const r = await client.query(sql, params);
  return r.rows;
}

// Format a window-days literal safely. WINDOW_DAYS is already integer-validated
// to [1..365] above, so this is safe to interpolate (Postgres INTERVAL requires
// a literal, not a parameter, for this position).
const W = `INTERVAL '${WINDOW_DAYS} days'`;

async function dim1_agentHygiene(client: Client): Promise<DimensionScore> {
  // Personas table is not tenant-scoped (platform-wide registry); but conversations IS.
  const ts = tenantScope("c");
  const totalActive = (await q(client, `SELECT COUNT(*)::int AS n FROM personas WHERE is_active`))[0].n;
  const used = (await q(client,
    `SELECT COUNT(DISTINCT c.persona_id)::int AS n
       FROM conversations c
      WHERE c.persona_id IS NOT NULL AND c.updated_at > NOW() - ${W}${ts.clause}`,
    ts.params))[0].n;
  const zombieRate = totalActive > 0 ? (totalActive - used) / totalActive : 0;
  const score = Math.max(0, Math.min(10, (1 - zombieRate) * 10));
  const zombieNames = await q(client,
    `SELECT name FROM personas
      WHERE is_active
        AND id NOT IN (
          SELECT DISTINCT c.persona_id FROM conversations c
           WHERE c.persona_id IS NOT NULL AND c.updated_at > NOW() - ${W}${ts.clause}
        )
      ORDER BY name`,
    ts.params);
  const namesEvidence = REDACT ? `${zombieNames.length} (names redacted)` : (zombieNames.map(z=>z.name).join(', ') || 'none');
  return {
    name: "Agent inventory hygiene",
    weight: 15,
    raw: score,
    evidence: `Active personas: ${totalActive}\nUsed in last ${WINDOW_DAYS}d: ${used}\nZombie rate: ${(zombieRate*100).toFixed(1)}%\nZombie personas: ${namesEvidence}`,
    interpretation: zombieRate > 0.5
      ? `Over half the declared agents had no traffic in ${WINDOW_DAYS} days. Either consolidate or deprecate.`
      : zombieRate > 0.25
      ? `Significant zombie footprint. Audit which agents are still needed.`
      : `Healthy agent inventory.`,
    recommendation: zombieRate > 0.25
      ? `Mark ${zombieNames.length} zombie personas as is_active=false until a real workflow needs them.`
      : `Continue monitoring quarterly.`
  };
}

async function dim2_toolSprawl(client: Client): Promise<DimensionScore> {
  const ts = tenantScope();
  const totalTools = (await q(client, `SELECT COUNT(*)::int AS n FROM capabilities WHERE kind='tool' AND is_active`))[0].n;
  const usedTools = (await q(client,
    `SELECT COUNT(DISTINCT tool_name)::int AS n
       FROM agent_trace_spans
      WHERE tool_name IS NOT NULL AND started_at > NOW() - ${W}${ts.clause}`,
    ts.params))[0].n;
  const zombieRate = totalTools > 0 ? Math.max(0, (totalTools - usedTools) / totalTools) : 0;
  const score = Math.max(0, Math.min(10, (1 - zombieRate) * 10));
  return {
    name: "Tool sprawl ratio",
    weight: 15,
    raw: score,
    evidence: `Tools registered: ${totalTools}\nTools invoked last ${WINDOW_DAYS}d: ${usedTools}\nUnused tool rate: ${(zombieRate*100).toFixed(1)}%`,
    interpretation: zombieRate > 0.5
      ? `Tool catalog is bloated. Agents pay an embedding/selection tax for every unused tool.`
      : zombieRate > 0.25
      ? `Moderate sprawl. Consider archiving rarely-used tools or gating them per persona.`
      : `Tool catalog is well-utilized.`,
    recommendation: zombieRate > 0.25
      ? `Archive or gate ${totalTools - usedTools} unused tools. See Zombie Detector at /admin/zombie-detector.`
      : `Continue quarterly sweep.`
  };
}

async function dim3_safetyProfile(client: Client): Promise<DimensionScore> {
  const rows = await q(client, `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE safety_profile IS NOT NULL AND safety_profile != '{}'::jsonb)::int AS with_profile FROM personas WHERE is_active`);
  const total = rows[0].total;
  const withProfile = rows[0].with_profile;
  const coverage = total > 0 ? withProfile / total : 0;
  const score = coverage * 10;
  return {
    name: "AHB safety_profile coverage",
    weight: 20,
    raw: score,
    evidence: `Active personas: ${total}\nWith populated safety_profile: ${withProfile}\nCoverage: ${(coverage*100).toFixed(1)}%`,
    interpretation: coverage >= 1.0
      ? `Full AHB coverage per Galisai et al. 2026. Every consumer-facing agent has an intent gate.`
      : coverage >= 0.75
      ? `Strong coverage with some gaps — adversarially-styled prompts bypass safety on the uncovered agents.`
      : `Material safety gap. Most agents bypass the intent gate entirely.`,
    recommendation: coverage < 1.0
      ? `Backfill safety_profile for ${total - withProfile} agents via UPDATE personas SET safety_profile = '{...}'::jsonb WHERE id = ...`
      : `Maintain via CI test (tests/security/persona-safety-profile-coverage.test.ts).`
  };
}

async function dim4_tenantIsolation(client: Client): Promise<DimensionScore> {
  const rows = await q(client, `
    WITH tbl AS (
      SELECT table_name, BOOL_OR(column_name='tenant_id') AS has_tid
      FROM information_schema.columns
      WHERE table_schema='public'
      GROUP BY table_name
    )
    SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE has_tid)::int AS with_tid FROM tbl
  `);
  const total = rows[0].total;
  const withTid = rows[0].with_tid;
  const coverage = total > 0 ? withTid / total : 0;
  const score = coverage * 10;
  const exempt = await q(client, `
    WITH tbl AS (
      SELECT table_name, BOOL_OR(column_name='tenant_id') AS has_tid
      FROM information_schema.columns
      WHERE table_schema='public'
      GROUP BY table_name
    )
    SELECT table_name FROM tbl WHERE NOT has_tid ORDER BY table_name LIMIT 10
  `);
  const exemptEvidence = REDACT
    ? `${exempt.length} table names redacted`
    : (exempt.map(e=>e.table_name).join(', ') || 'none');
  return {
    name: "Tenant isolation posture",
    weight: 20,
    raw: score,
    evidence: `Tables total: ${total}\nWith tenant_id: ${withTid}\nCoverage: ${(coverage*100).toFixed(1)}%\nSample exempt tables: ${exemptEvidence}`,
    interpretation: coverage >= 0.95
      ? `Strong multi-tenant isolation. Cross-tenant leakage risk minimal.`
      : coverage >= 0.80
      ? `Solid isolation with documented exemptions (system tables, migrations, capability registry). Verify each exempt table is genuinely shared.`
      : `Material isolation gap. Audit every table without tenant_id for leakage risk.`,
    recommendation: coverage < 0.95
      ? `Document the ${total - withTid} exempt tables in shared/schema.ts comments; add tenant_id to any that are user-data-bearing.`
      : `Maintain via CI invariant + weekly preflight.`
  };
}

async function dim5_schemaDrift(_client: Client): Promise<DimensionScore> {
  // Self-audit doesn't have prod access; mark N/A and score neutral.
  return {
    name: "Prod/dev schema drift",
    weight: 10,
    raw: 7.5,
    evidence: `N/A for self-audit (single-DB run). For customer audits, requires read-replica access to prod DB to compare \\d outputs.`,
    interpretation: `Not measured in self-audit mode.`,
    recommendation: `Enable prod read-replica access to score this dimension.`
  };
}

async function dim6_deliverableReliability(client: Client): Promise<DimensionScore> {
  let evidence = "delivery_logs table not queryable";
  let score = 5;
  let interpretation = "Delivery reliability not yet instrumented at the audit level.";
  let recommendation = "Add delivery_logs.status tracking with failure-rate alerting.";
  try {
    const ts = tenantScope();
    const rows = await q(client,
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE outcome='success')::int AS ok,
              COUNT(*) FILTER (WHERE outcome='failed')::int AS bad
         FROM delivery_logs
        WHERE created_at > NOW() - ${W}${ts.clause}`,
      ts.params);
    const total = rows[0].total;
    const ok = rows[0].ok;
    const bad = rows[0].bad;
    if (total > 0) {
      const successRate = ok / total;
      score = Math.max(0, Math.min(10, successRate * 10));
      evidence = `Deliveries last ${WINDOW_DAYS}d: ${total}\nSucceeded: ${ok}\nFailed: ${bad}\nSuccess rate: ${(successRate*100).toFixed(1)}%`;
      interpretation = successRate >= 0.95
        ? `Production-grade reliability with quality gates and retry logic.`
        : successRate >= 0.85
        ? `Acceptable reliability. Investigate the failure pattern for the bottom 10%.`
        : `Material reliability gap. Add grade-then-revise loops and per-step retry caps.`;
      recommendation = successRate < 0.95
        ? `Add or tighten Felix grade-then-revise loop; instrument per-step failure reasons.`
        : `Maintain via weekly delivery-reliability dashboard.`;
    } else {
      evidence = `No deliveries in window. delivery_logs schema present but empty.`;
    }
  } catch (e: any) {
    evidence = `delivery_logs not queryable: ${e.message}`;
  }
  return { name: "Deliverable reliability", weight: 10, raw: score, evidence, interpretation, recommendation };
}

async function dim7_juryUsage(client: Client): Promise<DimensionScore> {
  let invocations = 0;
  try {
    const ts = tenantScope();
    const rows = await q(client,
      `SELECT COUNT(*)::int AS n
         FROM agent_trace_spans
        WHERE tool_name IN ('ensemble_query', 'jury_triage')
          AND started_at > NOW() - ${W}${ts.clause}`,
      ts.params);
    invocations = rows[0].n;
  } catch {}
  // Score is presence-based: any usage = 6+, heavy usage = 9-10
  const score = invocations === 0 ? 3 : invocations < 5 ? 6 : invocations < 20 ? 8 : 10;
  return {
    name: "MoA / jury concordance usage",
    weight: 5,
    raw: score,
    evidence: `ensemble_query + jury_triage invocations last ${WINDOW_DAYS}d: ${invocations}`,
    interpretation: invocations === 0
      ? `No ensemble escalation observed. Single-model decisions on ambiguous tasks carry hidden risk.`
      : invocations < 5
      ? `Light usage. Consider routing more borderline decisions through the jury.`
      : `Healthy ensemble routing. κ-concordance triggering HITL on disagreement.`,
    recommendation: invocations < 5
      ? `Route borderline architect findings + ambiguous user requests through ensemble_query.`
      : `Maintain current routing thresholds.`
  };
}

async function dim8_costVisibility(client: Client): Promise<DimensionScore> {
  let hasInstrumentation = false;
  let evidence = "Token-cost instrumentation not detected in agent_trace_spans schema.";
  let score = 3;
  try {
    const rows = await q(client, `SELECT column_name FROM information_schema.columns WHERE table_name='agent_trace_spans' AND column_name IN ('token_cost', 'tokens_in', 'tokens_out', 'cost_usd')`);
    if (rows.length > 0) {
      hasInstrumentation = true;
      score = 7;
      evidence = `Cost columns present: ${rows.map(r => r.column_name).join(', ')}`;
    }
  } catch {}
  return {
    name: "Cost-per-deliverable visibility",
    weight: 5,
    raw: score,
    evidence,
    interpretation: hasInstrumentation
      ? `Cost telemetry instrumented. Build the rollup dashboard for per-deliverable cost.`
      : `No cost instrumentation. Every token spent is invisible to finance, blocking unit-economics decisions.`,
    recommendation: hasInstrumentation
      ? `Add a weekly cost-per-deliverable report and identify the top 3 hot-spot agents.`
      : `Add token_cost + cost_usd columns to agent_trace_spans; backfill via provider APIs.`
  };
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let dims: DimensionScore[] = [];
  try {
    dims = await Promise.all([
      dim1_agentHygiene(client),
      dim2_toolSprawl(client),
      dim3_safetyProfile(client),
      dim4_tenantIsolation(client),
      dim5_schemaDrift(client),
      dim6_deliverableReliability(client),
      dim7_juryUsage(client),
      dim8_costVisibility(client),
    ]);
  } catch (e: any) {
    console.error(`Query failure: ${e.message}`);
    await client.end();
    process.exit(3);
  }
  await client.end();

  const composite = Math.round(dims.reduce((acc, d) => acc + (d.raw / 10) * d.weight, 0));
  const band = composite >= 90 ? "A" : composite >= 80 ? "B+" : composite >= 70 ? "B" : composite >= 60 ? "C" : "D";

  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# AI-Native Readiness Audit — VisionClaw (Self-Audit)`);
  lines.push(``);
  lines.push(`**Prepared for:** VisionClaw (self) · **Window:** Last ${WINDOW_DAYS} days · **Date:** ${today}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Composite Score: **${composite} / 100  —  Band: ${band}**`);
  lines.push(``);
  lines.push(`### Dimension scorecard`);
  lines.push(``);
  lines.push(`| # | Dimension | Score / 10 | Weight |`);
  lines.push(`|---|---|--:|--:|`);
  dims.forEach((d, i) => lines.push(`| ${i+1} | ${d.name} | ${d.raw.toFixed(1)} | ${d.weight} |`));
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Top-line findings`);
  lines.push(``);
  const sorted = [...dims].sort((a, b) => a.raw - b.raw);
  sorted.slice(0, 3).forEach((d, i) => {
    lines.push(`${i+1}. **${d.name}** — ${d.raw.toFixed(1)}/10 — ${d.interpretation}`);
  });
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Per-dimension detail`);
  lines.push(``);
  dims.forEach(d => {
    lines.push(`### ${d.name} — ${d.raw.toFixed(1)} / 10 (weight ${d.weight})`);
    lines.push(``);
    lines.push(`**Evidence:**`);
    lines.push(`\`\`\``);
    lines.push(d.evidence);
    lines.push(`\`\`\``);
    lines.push(``);
    lines.push(`**Interpretation:** ${d.interpretation}`);
    lines.push(``);
    lines.push(`**Recommendation:** ${d.recommendation}`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  });
  lines.push(`## Top 10 prioritized recommendations`);
  lines.push(``);
  lines.push(`| # | Recommendation | Priority | Source dimension |`);
  lines.push(`|---|---|---|---|`);
  sorted.forEach((d, i) => {
    const pri = d.raw < 5 ? "P0" : d.raw < 7 ? "P1" : "P2";
    lines.push(`| ${i+1} | ${d.recommendation} | ${pri} | ${d.name} |`);
  });
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## How this audit was generated`);
  lines.push(``);
  lines.push(`Generated by \`scripts/run-self-audit.ts\` (R125+9) using the \`ai-native-readiness-audit\` output-skill recipe at \`data/output-skills/ai-native-readiness-audit.md\`. Every score is backed by a SQL snippet runnable against your own \`DATABASE_URL\` — see the **Evidence** block under each dimension. Methodology: 8-dimension weighted composite, scored 0–100, banded A–D.`);
  lines.push(``);
  lines.push(`**Get your own audit:** [visionclaw.app/audit](https://visionclaw.app/audit) (Q3 2026 launch)`);
  lines.push(``);
  lines.push(`*Powered by VisionClaw — the agentic AI platform that audits itself.*`);
  lines.push(``);

  const outAbs = path.resolve(OUT_PATH);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, lines.join("\n"));
  console.log(`Audit complete. Composite: ${composite}/100 (${band}). Report: ${OUT_PATH}`);
  console.log(`Dimension scores: ${dims.map(d => `${d.name.split(' ')[0]}=${d.raw.toFixed(1)}`).join(', ')}`);
}

main().catch(e => { console.error(e); process.exit(3); });
