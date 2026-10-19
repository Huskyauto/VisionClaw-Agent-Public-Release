import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { pilotKindSchema } from "../../shared/business-pilots";
import { appendPilotRun, deletePilotRun, PilotError } from "../lib/business-pilot-state";
import { withPilotStore } from "../lib/business-pilot-store";

type Helpers = {
  authMiddleware: RequestHandler; mutateLimiter: RequestHandler;
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};
export function registerBusinessPilotRoutes(app: Express, helpers: Helpers, store = withPilotStore) {
  const guard: RequestHandler = (req, res, next) => {
    if (!helpers.requirePlatformAdmin(req, res)) return;
    if (!helpers.getTenantFromRequest(req)) { res.status(403).json({ error: "Tenant required" }); return; }
    res.setHeader("Cache-Control", "no-store");
    next();
  };
  const handle = (action: "list" | "create" | "delete"): RequestHandler => async (req, res) => {
    try {
      const kind = pilotKindSchema.parse(req.params.kind);
      const tenantId = helpers.getTenantFromRequest(req)!;
      if (action === "list") {
        const runs = await store(tenantId, kind, runs => ({ value: runs }));
        res.json({ runs });
      } else if (action === "create") {
        if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 64_000) throw new PilotError("Input is too large", 413);
        const run = await store(tenantId, kind, runs => {
          const saved = appendPilotRun(runs, kind, req.body);
          return { runs: saved.runs, value: saved.run };
        });
        res.status(201).json(run);
      } else {
        const id = z.string().uuid().parse(req.params.id);
        await store(tenantId, kind, runs => ({ runs: deletePilotRun(runs, id), value: true }));
        res.json({ ok: true });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(422).json({ error: error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 3000) });
      } else if (error instanceof PilotError) res.status(error.status).json({ error: error.message });
      else {
        console.error("[business-pilots] request failed", error instanceof Error ? error.message : "unknown");
        res.status(500).json({ error: "The pilot operation could not be completed. Your data was not reset; retry the same operation." });
      }
    }
  };
  const path = "/api/admin/business-pilots/:kind";
  app.get(path, helpers.authMiddleware, guard, handle("list"));
  app.post(path, helpers.authMiddleware, guard, helpers.mutateLimiter, handle("create"));
  app.delete(`${path}/:id`, helpers.authMiddleware, guard, helpers.mutateLimiter, handle("delete"));
}
