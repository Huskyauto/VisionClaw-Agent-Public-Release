// R74.13t — Stage 18 of routes.ts decomposition.
// 7 routes for the R68 Step Ledger (Intent → Proposal → Execution → Result):
// /api/runs (POST create), /api/runs/active (GET list), /api/runs/:runId (GET),
// /api/runs/:runId/world (GET), /api/runs/:runId/cancel (POST),
// /api/runs/:runId/stream (GET SSE per-run), /api/runs/stream/all (GET SSE
// firehose). Extracted verbatim from server/routes.ts L2936-L3038.
// Helpers contract: { authMiddleware, getTenantFromRequest } — minimal 2-field.
// `ledgerEvents` and the ledger CRUD helpers (`getRun`, `getActiveRuns`,
// `getWorld`, `cancelRun`, `getLedger`, `createRun`) are dynamically imported
// from ../step-ledger inside each route — preserves the monolith style and
// keeps the EventEmitter off the cold-start path.
import type { Express, Request, Response } from "express";
import { logSilentCatch } from "../lib/silent-catch";

type RunsHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
};

export function registerRunsRoutes(app: Express, helpers: RunsHelpers) {
  const { authMiddleware, getTenantFromRequest } = helpers;

  // ─── R68 Step Ledger (Intent → Proposal → Execution → Result) ──────
  app.post("/api/runs", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const task = String(req.body?.task || "").trim();
    if (!task) return res.status(400).json({ error: "task is required" });
    const personaId = typeof req.body?.personaId === "number" ? req.body.personaId : undefined;
    const { startRun, recordIntent } = await import("../step-ledger");
    const handle = startRun({ tenantId, personaId, task });
    await recordIntent(handle.runId, { task, source: "api" });
    res.json(handle);
  });

  app.get("/api/runs/active", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const { getActiveRuns } = await import("../step-ledger");
    res.json({ runs: getActiveRuns(tenantId) });
  });

  app.get("/api/runs/:runId", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const runId = String(req.params.runId);
    const { getRun, getLedger } = await import("../step-ledger");
    const handle = getRun(runId);
    // R68.2 — tenant guard: never expose another tenant's in-memory run handle.
    if (handle && handle.tenantId !== tenantId) return res.status(404).json({ error: "Run not found" });
    const entries = await getLedger(runId, tenantId);
    if (!handle && entries.length === 0) return res.status(404).json({ error: "Run not found" });
    res.json({ handle: handle || null, entries });
  });

  app.get("/api/runs/:runId/world", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const runId = String(req.params.runId);
    const seq = req.query.seq ? parseInt(req.query.seq as string) : Number.MAX_SAFE_INTEGER;
    const { getWorldAt } = await import("../step-ledger");
    const world = await getWorldAt(runId, tenantId, seq);
    if (world.entries.length === 0) return res.status(404).json({ error: "Run not found or empty" });
    res.json(world);
  });

  app.post("/api/runs/:runId/cancel", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const runId = String(req.params.runId);
    const { getRun, endRun } = await import("../step-ledger");
    const handle = getRun(runId);
    if (!handle || handle.tenantId !== tenantId) return res.status(404).json({ error: "Run not found" });
    endRun(runId, { status: "cancelled" });
    res.json({ ok: true });
  });

  app.get("/api/runs/:runId/stream", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const runId = String(req.params.runId);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const { ledgerEvents, getRun, getLedger } = await import("../step-ledger");
    try {
      const handle = getRun(runId);
      if (handle && handle.tenantId === tenantId) res.write(`event: snapshot\ndata: ${JSON.stringify(handle)}\n\n`);
      const past = await getLedger(runId, tenantId);
      for (const e of past) res.write(`data: ${JSON.stringify(e)}\n\n`);
    } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    const onEntry = (entry: any) => {
      if (entry.tenantId !== tenantId) return;
      try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    };
    ledgerEvents.on(`run:${runId}`, onEntry);
    const heartbeat = setInterval(() => { try { res.write(`: heartbeat\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); } }, 15000);
    req.on("close", () => {
      ledgerEvents.off(`run:${runId}`, onEntry);
      clearInterval(heartbeat);
    });
  });

  app.get("/api/runs/stream/all", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const { ledgerEvents } = await import("../step-ledger");
    const onEntry = (entry: any) => {
      if (entry.tenantId !== tenantId) return;
      try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    };
    ledgerEvents.on("entry", onEntry);
    const heartbeat = setInterval(() => { try { res.write(`: heartbeat\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); } }, 15000);
    req.on("close", () => {
      ledgerEvents.off("entry", onEntry);
      clearInterval(heartbeat);
    });
  });
}
