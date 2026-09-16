/**
 * /metrics — Prometheus text-format exposition endpoint (operator-only).
 *
 * Security posture (fail-closed):
 *   - Endpoint is DISABLED (404) unless METRICS_TOKEN is set in the environment.
 *   - Requires `Authorization: Bearer <METRICS_TOKEN>` (timing-safe compare).
 *   - Exposes AGGREGATE numbers only (per-tenant cost totals, per-tool call
 *     counts) — no message content, no PII, no tool args, no secrets.
 *
 * Mounted at the app level (NOT under /api) so it bypasses CSRF/session
 * middleware the same way /healthz does — Prometheus scrapers don't do CSRF.
 *
 * Metric families:
 *   visionclaw_cost_usd_24h{tenant}        — spend per tenant, last 24h
 *   visionclaw_tool_calls_24h{tool}        — cost-ledger rows per tool, last 24h (top 50)
 *   visionclaw_tokens_24h{direction}       — in/out token totals, last 24h
 *   visionclaw_repair_incidents_7d{classification,action} — self-heal loop outcomes
 *   visionclaw_process_uptime_seconds / _rss_bytes / _heap_used_bytes
 *   visionclaw_metrics_scrape_errors       — probe failures in THIS scrape (degraded, not 500)
 */
import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";

function tokenOk(req: Request): boolean {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return false;
  const header = req.headers.authorization || "";
  const got = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function esc(label: string): string {
  return label.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

export function registerMetricsEndpoint(app: Express): void {
  app.get("/metrics", async (req: Request, res: Response) => {
    // Fail closed: unset token OR bad token = endpoint does not exist (404, never 401 —
    // a 401 would confirm the endpoint exists to an unauthenticated prober).
    if (!process.env.METRICS_TOKEN) return res.status(404).end();
    if (!tokenOk(req)) return res.status(404).end();

    const lines: string[] = [];
    let scrapeErrors = 0;
    const { db } = await import("../db");

    const push = (name: string, help: string, type: string, samples: string[]) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      lines.push(...samples);
    };

    // 1) Cost per tenant, last 24h
    try {
      const r: any = await db.execute(sql`
        SELECT tenant_id, COALESCE(SUM(cost_usd::numeric), 0) AS cost
        FROM agent_cost_ledger
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY tenant_id ORDER BY cost DESC LIMIT 100`);
      const rows = r.rows || r;
      push(
        "visionclaw_cost_usd_24h",
        "LLM/tool spend in USD per tenant over the trailing 24h",
        "gauge",
        rows.map((x: any) => `visionclaw_cost_usd_24h{tenant="${esc(String(x.tenant_id))}"} ${Number(x.cost)}`)
      );
    } catch (e: any) { scrapeErrors++; console.error(`[metrics] probe cost_usd_24h failed: ${e?.message || e}`); }

    // 2) Tool usage counts, last 24h (top 50)
    try {
      const r: any = await db.execute(sql`
        SELECT tool_name, COUNT(*) AS calls
        FROM agent_cost_ledger
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY tool_name ORDER BY calls DESC LIMIT 50`);
      const rows = r.rows || r;
      push(
        "visionclaw_tool_calls_24h",
        "Cost-ledger entries per tool over the trailing 24h (top 50)",
        "gauge",
        rows.map((x: any) => `visionclaw_tool_calls_24h{tool="${esc(String(x.tool_name))}"} ${Number(x.calls)}`)
      );
    } catch (e: any) { scrapeErrors++; console.error(`[metrics] probe tool_calls_24h failed: ${e?.message || e}`); }

    // 3) Token totals, last 24h
    try {
      const r: any = await db.execute(sql`
        SELECT COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout
        FROM agent_cost_ledger
        WHERE created_at > NOW() - INTERVAL '24 hours'`);
      const row = (r.rows || r)[0] || { tin: 0, tout: 0 };
      push(
        "visionclaw_tokens_24h",
        "Total LLM tokens over the trailing 24h by direction",
        "gauge",
        [
          `visionclaw_tokens_24h{direction="in"} ${Number(row.tin)}`,
          `visionclaw_tokens_24h{direction="out"} ${Number(row.tout)}`,
        ]
      );
    } catch (e: any) { scrapeErrors++; console.error(`[metrics] probe tokens_24h failed: ${e?.message || e}`); }

    // 4) Self-heal loop outcomes, last 7d (loop success-rate source)
    try {
      const r: any = await db.execute(sql`
        SELECT classification, COALESCE(action_taken, 'pending') AS action, COUNT(*) AS n
        FROM repair_incidents
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY classification, COALESCE(action_taken, 'pending') LIMIT 100`);
      const rows = r.rows || r;
      push(
        "visionclaw_repair_incidents_7d",
        "Self-heal repair incidents over the trailing 7d by classification and dispatched action",
        "gauge",
        rows.map(
          (x: any) =>
            `visionclaw_repair_incidents_7d{classification="${esc(String(x.classification))}",action="${esc(String(x.action))}"} ${Number(x.n)}`
        )
      );
    } catch (e: any) { scrapeErrors++; console.error(`[metrics] probe repair_incidents_7d failed: ${e?.message || e}`); }

    // 5) Process metrics (always available)
    const mem = process.memoryUsage();
    push("visionclaw_process_uptime_seconds", "Process uptime in seconds", "counter", [
      `visionclaw_process_uptime_seconds ${Math.floor(process.uptime())}`,
    ]);
    push("visionclaw_process_rss_bytes", "Resident set size in bytes", "gauge", [
      `visionclaw_process_rss_bytes ${mem.rss}`,
    ]);
    push("visionclaw_process_heap_used_bytes", "V8 heap used in bytes", "gauge", [
      `visionclaw_process_heap_used_bytes ${mem.heapUsed}`,
    ]);
    push(
      "visionclaw_metrics_scrape_errors",
      "Number of metric probes that failed during this scrape (degraded signal, not a 500)",
      "gauge",
      [`visionclaw_metrics_scrape_errors ${scrapeErrors}`]
    );

    res.status(200).type("text/plain; version=0.0.4").send(lines.join("\n") + "\n");
  });
}
