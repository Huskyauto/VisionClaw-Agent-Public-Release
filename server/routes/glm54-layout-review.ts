import type { Express, Request, RequestHandler, Response } from "express";
import { GLM_LAYOUT_REVIEW_PATH } from "../../shared/glm54-layout-contract";
import { completeGlm54LayoutReview, glm54LayoutKey, normalizeLayoutInput } from "../lib/glm54-layout-review";
import { ADMIN_TENANT_ID } from "../tenant-constants";

const HOUR_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS_PER_HOUR = 6;
const RESERVED_CENTS = 5;

async function claimAttempt(attemptKey: string) {
  const { reserveAggregateAiSpend } = await import("../agentic/aggregate-ai-spend-budget");
  // Image billing is not proven from the response. Keep the conservative
  // reservation in the daily cap instead of representing it as settled cost.
  await reserveAggregateAiSpend({ tenantId: ADMIN_TENANT_ID, attemptKey, maximumCostCents: RESERVED_CENTS });
}

export function registerGlm54LayoutRoutes(app: Express, helpers: {
  authMiddleware: RequestHandler;
  requireAdmin: (req: Request, res: Response) => Promise<number | null>;
}, dependencies: {
  key?: typeof glm54LayoutKey;
  claim?: typeof claimAttempt;
  complete?: typeof completeGlm54LayoutReview;
} = {}) {
  const key = dependencies.key ?? glm54LayoutKey;
  const claim = dependencies.claim ?? claimAttempt;
  const complete = dependencies.complete ?? completeGlm54LayoutReview;
  let active = false;
  let attempts: number[] = [];

  const owner: RequestHandler = async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (/^Bearer\s+vc_/i.test(req.headers.authorization ?? "")) {
      return void res.status(403).json({ error: "Sign in as the platform owner in the browser." });
    }
    try {
      const tenantId = await helpers.requireAdmin(req, res);
      if (tenantId === null) return;
      if (tenantId !== ADMIN_TENANT_ID) return void res.status(403).json({ error: "Platform owner access required." });
      next();
    } catch {
      res.status(503).json({ error: "Owner session could not be verified." });
    }
  };

  app.get(GLM_LAYOUT_REVIEW_PATH, helpers.authMiddleware, owner, (_req, res) => {
    res.json({ available: Boolean(key()) });
  });

  app.post(GLM_LAYOUT_REVIEW_PATH, helpers.authMiddleware, owner, async (req, res) => {
    if (!key()) return void res.status(503).json({ error: "GLM layout review is not enabled in this environment." });
    if (!req.is("application/json")) return void res.status(415).json({ error: "A JSON submission is required." });
    const now = Date.now();
    attempts = attempts.filter(at => now - at < HOUR_MS);
    if (active || attempts.length >= MAX_ATTEMPTS_PER_HOUR) {
      return void res.status(429).json({ error: "Wait for the current review or until the hourly limit resets." });
    }
    active = true;
    try {
      const source = await normalizeLayoutInput(req.body);
      if (!source) return void res.status(400).json({ error: "Use a small static screenshot, layout-only CSS without external links or secrets, and confirm the public-or-synthetic disclosure." });
      if (res.destroyed) return;
      attempts.push(now);
      try {
        await claim(`glm54-layout:v1:${source.submissionId.toLowerCase()}`);
      } catch {
        console.warn("[glm54-layout] admission refused");
        return void res.status(429).json({ error: "This submission was already used, or available AI budget could not be confirmed." });
      }
      const providerKey = key();
      if (!providerKey || res.destroyed) {
        if (!res.destroyed) res.status(503).json({ error: "GLM layout review was disabled before dispatch." });
        return;
      }
      const result = await complete(source, providerKey);
      console.info(`[glm54-layout] advisory response model=${result.model} elapsed_ms=${Date.now() - now}`);
      res.json(result);
    } catch {
      console.warn("[glm54-layout] provider review did not complete");
      if (!res.destroyed) res.status(502).json({ error: "GLM did not return a usable review. No automatic retry was made." });
    } finally {
      active = false;
    }
  });
}
