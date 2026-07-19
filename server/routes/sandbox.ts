// Simulation Sandbox (S5) — admin-only routes backing /admin/sandbox.
// Contract: data/feature-contracts/simulation-sandbox/spec.md
//
// Authz: admin tenant ∧ admin request (same explicit check pattern as
// server/routes/admin.ts). Tenant is re-derived from the session on every
// request and passed explicitly into every query (tenant_id NOT NULL, no
// defaults). Launch validation via Zod (sandboxLaunchSchema) — the route can
// never RAISE the spec's $5 per-run cap, mirroring the sandbox_run tool.
//
// Long runs: POST waits a bounded window (fast failures — bad args, refused
// budget claim — surface synchronously as 4xx/5xx); still-running replays
// detach and the UI polls GET /runs (the replay engine persists its own
// completion/failure into sandbox_runs).
import { type Express, type Request, type Response } from "express";
import { pool } from "../db";
import { validate, sandboxLaunchSchema } from "../validation";

type SandboxHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  isAdminRequest: (req: Request) => boolean;
  ADMIN_TENANT_ID: number;
};

/** Bounded synchronous wait before the launch route detaches. */
const SYNC_WAIT_MS = 5_000;

export function registerSandboxRoutes(app: Express, helpers: SandboxHelpers) {
  const { authMiddleware, getTenantFromRequest, isAdminRequest, ADMIN_TENANT_ID } = helpers;

  const requireSandboxAdmin = (req: Request, res: Response): number | null => {
    const tenantId = getTenantFromRequest(req);
    if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) {
      res.status(403).json({ error: "Admin access required" });
      return null;
    }
    return tenantId;
  };

  // List recent runs (newest first) for the /admin/sandbox table.
  app.get("/api/admin/sandbox/runs", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = requireSandboxAdmin(req, res);
      if (tenantId === null) return;
      const result = await pool.query(
        `SELECT id, corpus, status, overrides, sample_size, report, error, started_at, completed_at
         FROM sandbox_runs WHERE tenant_id = $1 ORDER BY id DESC LIMIT 30`,
        [tenantId],
      );
      res.json({ runs: result.rows });
    } catch (err: any) {
      console.error("[sandbox routes] list failed:", err);
      res.status(500).json({ error: err?.message || "failed to list sandbox runs" });
    }
  });

  // Run detail + per-item results (worst severity first, critical flips on top).
  app.get("/api/admin/sandbox/runs/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = requireSandboxAdmin(req, res);
      if (tenantId === null) return;
      const runId = Number(req.params.id);
      if (!Number.isInteger(runId) || runId <= 0) {
        return res.status(400).json({ error: "invalid run id" });
      }
      const runRes = await pool.query(
        `SELECT id, corpus, status, overrides, sample_size, report, error, started_at, completed_at
         FROM sandbox_runs WHERE id = $1 AND tenant_id = $2`,
        [runId, tenantId],
      );
      const run = runRes.rows[0];
      if (!run) return res.status(404).json({ error: `no sandbox run ${runId} for this tenant` });
      const resultsRes = await pool.query(
        `SELECT id, item_ref, baseline, simulated, flip, severity, created_at
         FROM sandbox_results WHERE run_id = $1 AND tenant_id = $2
         ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, id ASC
         LIMIT 200`,
        [runId, tenantId],
      );
      res.json({ run, results: resultsRes.rows });
    } catch (err: any) {
      console.error("[sandbox routes] detail failed:", err);
      res.status(500).json({ error: err?.message || "failed to load sandbox run" });
    }
  });

  // Launch a replay run. Body validated by sandboxLaunchSchema; overrides are
  // an ephemeral per-run bundle. Fast setup failures (invalid corpus combo,
  // refused budget claim) surface synchronously; long runs detach.
  app.post(
    "/api/admin/sandbox/runs",
    authMiddleware,
    validate(sandboxLaunchSchema),
    async (req: Request, res: Response) => {
      try {
        const tenantId = requireSandboxAdmin(req, res);
        if (tenantId === null) return;
        const body = req.body as {
          corpus: "safety" | "conversation" | "orchestration";
          sampleSize: number;
          intentGateMode?: "off" | "moderate" | "strict";
          restrictedCategories?: string[];
          model?: string;
          perRunCapUsd?: number;
        };

        const replay = await import("../lib/sandbox/replay");
        let runPromise: Promise<{ runId: number; report: unknown }>;
        if (body.corpus === "safety") {
          if (!body.intentGateMode) {
            return res.status(400).json({ error: "safety corpus requires intentGateMode ('off' | 'moderate' | 'strict')" });
          }
          runPromise = replay.runSafetyReplay({
            tenantId,
            sampleSize: body.sampleSize,
            overrides: {
              intentGateMode: body.intentGateMode,
              restrictedCategories: body.restrictedCategories ?? [],
            },
          });
        } else {
          const model = (body.model || "").trim();
          if (!model) {
            return res.status(400).json({ error: `${body.corpus} corpus requires a non-empty model id` });
          }
          // Clamp to (0, 5] — the route can never RAISE the spec's $5 default.
          const perRunCapUsd =
            typeof body.perRunCapUsd === "number" && body.perRunCapUsd > 0
              ? Math.min(body.perRunCapUsd, 5)
              : 5;
          runPromise = replay.runModelSwapReplay({
            tenantId,
            corpus: body.corpus,
            sampleSize: body.sampleSize,
            overrides: { model },
            perRunCapUsd,
          });
        }

        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<"pending">((resolve) => {
          timer = setTimeout(() => resolve("pending"), SYNC_WAIT_MS);
        });
        try {
          const settled = await Promise.race([runPromise, timeout]);
          if (settled !== "pending") {
            return res.json({ status: "complete", runId: settled.runId, report: settled.report });
          }
        } finally {
          if (timer) clearTimeout(timer);
        }
        // Detached: the engine persists completion/failure to sandbox_runs
        // before rethrowing — swallow the eventual rejection here.
        runPromise.catch((err: any) => {
          console.error(`[sandbox routes] background ${body.corpus} replay failed: ${err?.message || err}`);
        });
        return res.status(202).json({
          status: "running",
          corpus: body.corpus,
          sampleSize: body.sampleSize,
          note: "Run continues in the background; poll the runs list for the verdict.",
        });
      } catch (err: any) {
        console.error("[sandbox routes] launch failed:", err);
        res.status(500).json({ error: err?.message || "failed to launch sandbox run" });
      }
    },
  );
}
