import type { Express, Request, RequestHandler, Response } from "express";
import AdmZip from "adm-zip";
import { ADMIN_TENANT_ID } from "../tenant-constants";
import { agentReadyInputSchema, buildAgentReadyPackage } from "../lib/agent-ready-package";
import { verifyAgentReadyInstallation } from "../lib/agent-ready-verification";

export function registerAgentReadyRoutes(app: Express, helpers: {
  authMiddleware: RequestHandler;
  requireAdmin: (req: Request, res: Response) => Promise<number | null>;
}, dependencies: {
  verify?: typeof verifyAgentReadyInstallation;
  enabled?: () => boolean;
  now?: () => number;
} = {}) {
  const verify = dependencies.verify ?? verifyAgentReadyInstallation;
  const now = dependencies.now ?? Date.now;
  let windowStarted = 0, exports = 0, liveChecks = 0;
  for (const action of ["preview", "download", "verify"] as const) {
    app.post(`/api/admin/audit/agent-ready/${action}`, helpers.authMiddleware,
      async (req: Request, res: Response) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        const tenantId = await helpers.requireAdmin(req, res);
        if (tenantId === null) return;
        if (tenantId !== ADMIN_TENANT_ID) return res.status(403).json({ error: "Owner access required." });
        if (!(dependencies.enabled?.() ?? process.env.AGENT_READY_PACKAGE_ENABLED !== "0"))
          return res.status(503).json({ error: "Agent-ready website packages are disabled." });
        const parsed = agentReadyInputSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: parsed.error.issues.map(issue => `${issue.path.join(".") || "Input"}: ${issue.message}`).join(" ").slice(0, 1000),
          });
        }
        const time = now();
        if (time - windowStarted >= 60_000) {
          windowStarted = time; exports = 0; liveChecks = 0;
        }
        if (action === "verify" ? ++liveChecks > 6 : ++exports > 30) {
          res.setHeader("Retry-After", "60");
          return res.status(429).json({ error: "Too many package requests. Wait a minute before trying again." });
        }
        try {
          const packet = buildAgentReadyPackage(parsed.data);
          res.setHeader("X-Agent-Ready-Package", packet.packageId);
          if (action === "verify") {
            const observation = await verify(packet);
            console.info(`[agent-ready] owner=${tenantId} action=verify checks=${observation.checks.map(check => check.status).join(",")}`);
            return res.json(observation);
          }
          if (action === "preview") return res.json(packet);
          const zip = new AdmZip();
          for (const file of packet.files) {
            zip.addFile(file.path, Buffer.from(file.content, "utf8"));
            zip.getEntry(file.path)!.header.time = new Date("2026-01-01T00:00:00Z");
          }
          const host = new URL(packet.input.website).hostname.replace(/[^a-z0-9.-]/g, "-");
          res.setHeader("Content-Type", "application/zip");
          res.setHeader("Content-Disposition", `attachment; filename="agent-ready-${host}-${packet.packageId.slice(0, 12)}.zip"`);
          return res.send(zip.toBuffer());
        } catch {
          console.error(`[agent-ready] owner=${tenantId} action=${action} failed`);
          return res.status(500).json({ error: "Could not prepare the website package or check. Nothing was installed or sent." });
        }
      });
  }
}
