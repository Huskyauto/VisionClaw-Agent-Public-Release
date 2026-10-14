import type { Express, Request, Response } from "express";
import {
  authenticateWorkspaceRequest, MAX_WORKSPACE_VERIFIER_BYTES, WORKSPACE_VERIFIER_PREFIX,
} from "../lib/workspace-verifier-contract";

export interface WorkspaceVerifierRouteDependencies {
  enabled(): boolean;
  key(): string;
  now(): number;
  claim(requestId: unknown): Promise<unknown>;
  settle(input: any): Promise<unknown>;
}

/** Outside /api auth: this dedicated service authenticates exact raw request bytes. */
export function registerWorkspaceVerifierRoutes(app: Express, deps: WorkspaceVerifierRouteDependencies = {
  enabled: () => process.env.NODE_ENV === "production" && process.env.PROPOSAL_VERIFIER_WORKSPACE_ENABLED === "1",
  key: () => process.env.REPAIR_HANDOFF_HMAC_KEY ?? "",
  now: Date.now,
  claim: async id => (await import("../lib/workspace-verifier-store")).claimWorkspaceVerification(id),
  settle: async body => (await import("../lib/workspace-verifier-store")).settleWorkspaceVerification(body),
}): void {
  let active = 0;
  for (const action of ["claim", "settle"] as const) {
    const pathname = `${WORKSPACE_VERIFIER_PREFIX}/${action}`;
    app.post(pathname, async (req: Request, res: Response) => {
      if (!deps.enabled()) { res.status(404).json({ error: "Workspace verifier disabled" }); return; }
      if (req.originalUrl !== pathname) {
        res.status(401).json({ error: "Canonical verifier path required" }); return;
      }
      const bytes = (req as any).rawBody;
      if (!Buffer.isBuffer(bytes) || bytes.length > MAX_WORKSPACE_VERIFIER_BYTES) {
        res.status(413).json({ error: "Invalid verification body" }); return;
      }
      if (!authenticateWorkspaceRequest(deps.key(), pathname, bytes.toString("utf8"),
        req.headers["x-verifier-timestamp"], req.headers["x-verifier-signature"], deps.now())) {
        res.status(401).json({ error: "Verification authentication required" }); return;
      }
      if (active >= 2) { res.status(429).json({ error: "Verification service busy" }); return; }
      active++;
      try {
        const body = JSON.parse(bytes.toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
        res.json(await (action === "claim" ? deps.claim(body.requestId) : deps.settle(body)));
      } catch {
        // Never reflect DB/paths/proposal contents to the network or logs.
        res.status(409).json({ error: "Verification unavailable or fenced; queued work is retained" });
      } finally { active--; }
    });
  }
}
