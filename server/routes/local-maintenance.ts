import type { Express, Request, Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { legionBackgroundEnabled, legionBackgroundConfiguration, legionRuntimeReady } from "../legion/runtime";
import { localParallelEnabled } from "../legion/local-slots";
import { surfaceLocalEnabled } from "../legion/local-provider-runtime";
import { localHostedFallbackEnabled } from "../legion/runbook-hosted";
import { legionNightlyEnabled } from "../legion/nightly";
import { LOCAL_MAINTENANCE_SOURCES } from "../legion/simple-runbook-rule";
import { LEGION_RUNBOOK_JOB, SURFACE_RULE_JOB } from "../legion/nightly-policy";
import { SURFACE_MODEL } from "../legion/local-router";
import { LEGION_MODEL } from "../legion/model-policy";
import { localMaintenanceEnvironment, queueLocalMaintenance, resultRows } from "../legion/maintenance";
import { sparkRelayStore } from "../legion/spark-relay-runtime";
import { registerSparkRelayOwner } from "./spark-legion-relay";

type Dependencies = {
  authMiddleware: any;
  requirePlatformAdmin(req: Request, res: Response): boolean;
};
const selection = z.object({
  sourceId: z.string().min(1).max(40),
  task: z.enum(["both", "lenovo", "surface"]),
}).strict();

/** Owner only; installed after the application's authentication/CSRF middleware.
 * No source paths, free-form prompts, tenant ids or model ids accepted. */
export function registerLocalMaintenanceRoutes(app: Express, deps: Dependencies) {
  registerSparkRelayOwner(app, deps.authMiddleware, deps.requirePlatformAdmin);
  let windowStart = 0;
  let requests = 0;
  app.get("/api/admin/local-maintenance", deps.authMiddleware, async (req, res) => {
    if (!deps.requirePlatformAdmin(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    try {
      const environment = localMaintenanceEnvironment();
      const jobs = resultRows<any>(await db.execute(sql`
        SELECT id,kind,status,payload,result,error,created_at FROM agent_jobs
        WHERE tenant_id=1 AND kind IN (${LEGION_RUNBOOK_JOB},${SURFACE_RULE_JOB})
          AND payload->>'environment'=${environment} ORDER BY id DESC LIMIT 40`));
      const slots = resultRows<{ objid: number }>(await db.execute(sql`
        SELECT objid::int FROM pg_locks WHERE locktype='advisory' AND classid=872631
          AND objid IN (1,2) AND granted
          AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`));
      const busy = (id: number) => slots.some(s => Number(s.objid) === id);
      res.json({
        enabled: localParallelEnabled(), nightlyEnabled: legionNightlyEnabled(),
        legionConfiguration: legionBackgroundConfiguration(), legionTransportReady: legionRuntimeReady(),
        surfaceEnabled: surfaceLocalEnabled(), hostedFallbackEnabled: localHostedFallbackEnabled(), environment,
        sparkRelay: await sparkRelayStore.status(1),
        sources: LOCAL_MAINTENANCE_SOURCES.map(({ id, title }) => ({ id, title })),
        nodes: [
          { id: "legion-local", label: "Lenovo", model: LEGION_MODEL,
            assignment: "Multi-concept, source-backed runbook analysis", configured: legionBackgroundEnabled(), busy: busy(1) },
          { id: "surface-local", label: "Surface", model: SURFACE_MODEL,
            assignment: "One direct question and one exact source reference", configured: surfaceLocalEnabled(), busy: busy(2) },
        ],
        jobs: jobs.map(j => ({ id: j.id, kind: j.kind, status: j.status,
          priority: j.payload.priority ?? "overnight",
          sourceId: LOCAL_MAINTENANCE_SOURCES.find(s => s.path === j.payload.sourcePath)?.id ?? "screened-runbook",
          model: j.result?.model ?? null, createdAt: j.created_at, result: j.result,
          error: typeof j.error === "string" ? j.error.slice(0, 500) : null })),
      });
    } catch { res.status(503).json({ error: "Local maintenance metadata unavailable" }); }
  });
  app.post("/api/admin/local-maintenance", deps.authMiddleware, async (req, res) => {
    if (!deps.requirePlatformAdmin(req, res)) return;
    if (!localParallelEnabled()) return res.status(409).json({ error: "Parallel laptop maintenance disabled" });
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); requests = 0; }
    if (++requests > 12) return res.status(429).json({ error: "Too many requests; wait one minute" });
    const parsed = selection.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose one listed source and a laptop assignment" });
    const source = LOCAL_MAINTENANCE_SOURCES.find(s => s.id === parsed.data.sourceId);
    if (!source) return res.status(400).json({ error: "Choose a listed internal runbook" });
    try {
      const jobIds = await queueLocalMaintenance(source.path, "daytime", parsed.data.task);
      res.status(202).json({ jobIds });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/^Source changed after|^Surface maintenance disabled/.test(message)) {
        return res.status(409).json({ error: message });
      }
      res.status(503).json({ error: "Queue request failed; completion is not confirmed. Check saved jobs before retrying." });
    }
  });
}
