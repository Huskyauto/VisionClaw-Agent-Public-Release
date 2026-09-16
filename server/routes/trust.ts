import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

interface Counts {
  agentRuns30d: number;
  deliverables30d: number;
  declineEvents30d: number;
  declineEventsTotal: number;
  governanceRules: number;
  activePersonas: number;
  registeredTools: number;
  liveTables: number;
  productionIndexes: number;
  safetyProfileCoverage: { total: number; configured: number; ratio: number };
  juryDecisionsLogged: number;
}

async function safeCount(query: any): Promise<number> {
  try {
    const r: any = await db.execute(query);
    const rows = (r.rows || r) as any[];
    return rows[0] ? Number(rows[0].count ?? rows[0].n ?? 0) : 0;
  } catch {
    return 0;
  }
}

async function safetyProfileCoverage(): Promise<Counts["safetyProfileCoverage"]> {
  try {
    const r: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE is_active = true) AS total,
        COUNT(*) FILTER (
          WHERE is_active = true
            AND safety_profile IS NOT NULL
            AND safety_profile->>'intentGate' IS NOT NULL
            AND jsonb_array_length(COALESCE(safety_profile->'restrictedCategories', '[]'::jsonb)) > 0
        ) AS configured
      FROM personas
      WHERE tenant_id = 1
    `);
    const row: any = ((r.rows || r) as any[])[0] || {};
    const total = Number(row.total ?? 0);
    const configured = Number(row.configured ?? 0);
    return { total, configured, ratio: total > 0 ? configured / total : 0 };
  } catch {
    return { total: 0, configured: 0, ratio: 0 };
  }
}

async function juryDecisionsLogged(): Promise<number> {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const dir = path.join(process.cwd(), "data", "jury-decisions");
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    return files.filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

const TRUST_CACHE_TTL_MS = 60_000;
let trustCache: { ts: number; payload: any } | null = null;

export function registerTrustRoutes(app: Express) {
  app.get("/api/public/trust", async (_req: Request, res: Response) => {
    try {
      if (trustCache && Date.now() - trustCache.ts < TRUST_CACHE_TTL_MS) {
        res.setHeader("X-Cache", "HIT");
        return res.json(trustCache.payload);
      }
      const [
        agentRuns30d,
        deliverables30d,
        declineEvents30d,
        declineEventsTotal,
        governanceRules,
        activePersonas,
        registeredTools,
        liveTables,
        productionIndexes,
        safetyCoverage,
        juryLogged,
      ] = await Promise.all([
        // R125+13.6-fix (architect M5): scope tenant-owned operational
        // counters to the storefront tenant (tenant 1 = platform owner).
        // Previously these were unscoped aggregates leaking cross-tenant
        // activity volume on a public endpoint. Platform-wide tables
        // (personas, tools, governance, schema metadata) remain unscoped
        // since they describe the product itself, not customer data.
        safeCount(sql`SELECT COUNT(*)::int AS count FROM agent_jobs WHERE tenant_id = 1 AND status = 'succeeded' AND completed_at > NOW() - INTERVAL '30 days'`),
        safeCount(sql`SELECT COUNT(*)::int AS count FROM file_storage WHERE tenant_id = 1 AND created_at > NOW() - INTERVAL '30 days' AND size > 1024`),
        safeCount(sql`SELECT COUNT(*)::int AS count FROM decline_events WHERE tenant_id = 1 AND created_at > NOW() - INTERVAL '30 days'`),
        safeCount(sql`SELECT COUNT(*)::int AS count FROM decline_events WHERE tenant_id = 1`),
        safeCount(sql`SELECT COUNT(*)::int AS count FROM governance_rules WHERE tenant_id = 1`),
        safeCount(sql`SELECT COUNT(*)::int AS count FROM personas WHERE tenant_id = 1 AND is_active = true`),
        safeCount(sql`SELECT COUNT(DISTINCT tool_name)::int AS count FROM tool_performance WHERE tenant_id = 1`),
        safeCount(sql`SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`),
        safeCount(sql`SELECT COUNT(*)::int AS count FROM pg_indexes WHERE schemaname = 'public' AND indexname NOT LIKE '%_pkey'`),
        safetyProfileCoverage(),
        juryDecisionsLogged(),
      ]);

      const counts: Counts = {
        agentRuns30d,
        deliverables30d,
        declineEvents30d,
        declineEventsTotal,
        governanceRules,
        activePersonas,
        registeredTools,
        liveTables,
        productionIndexes,
        safetyProfileCoverage: safetyCoverage,
        juryDecisionsLogged: juryLogged,
      };

      const payload = {
        generatedAt: new Date().toISOString(),
        counts,
        invariants: [
          { id: "tenant_isolation", label: "Per-tenant data isolation enforced at every read/write", status: "active" },
          { id: "ahb_intent_gate", label: "Adversarial-prompt intent gate on consumer-facing personas", status: "active" },
          { id: "destructive_tool_policy", label: "Destructive-tool policy fails closed (HITL on money, mass-comms, delete)", status: "active" },
          { id: "csrf", label: "CSRF token required on all state-changing requests", status: "active" },
          { id: "secret_scan", label: "48-pattern pre-delivery secret scan blocks credential leaks", status: "active" },
          { id: "ssrf_jail", label: "User-supplied URLs DNS-rebinding-jailed before fetch", status: "active" },
          { id: "prompt_injection_defuse", label: "External content (web fetch, scholarly abstracts, file uploads) wrapped before reaching the LLM", status: "active" },
          { id: "audit_log", label: "Every agent run leaves a tool-by-tool audit trail", status: "active" },
        ],
      };
      trustCache = { ts: Date.now(), payload };
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "trust query failed" });
    }
  });
}
