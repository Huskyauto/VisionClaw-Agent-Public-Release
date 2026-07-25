import type { Express, Request, Response } from "express";
import { generateImage, type ImageQuality } from "./client";
import type { ImagePurpose } from "../../image-quality-decider";
import { getTenantFromRequest } from "../../auth";

export function registerImageRoutes(app: Express): void {
  // R74.11 — Single policy engine: this endpoint now goes through generateImage(),
  // which means the cost-aware decider runs here too.
  // R74.12 SECURITY — defense-in-depth auth gate inside the handler so this route
  // is safe to mount even before/without global auth middleware. Without this,
  // any future call to registerImageRoutes(app) would expose paid AI compute to
  // unauthenticated callers (image-gen → Gemini/gpt-image-2 cost burn).
  app.post("/api/generate-image", async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { prompt, purpose, quality } = req.body as {
        prompt?: string;
        purpose?: ImagePurpose;
        quality?: ImageQuality;
      };

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const dataUrl = await generateImage(prompt, {
        purpose,
        quality,
        callerLabel: `api/generate-image:tenant=${tenantId}`,
      });

      // dataUrl is "data:image/png;base64,XXXX" — split into MIME + base64 body
      // to match the legacy { b64_json, mimeType } response shape.
      const mimeMatch = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
      if (!mimeMatch) {
        return res.status(500).json({ error: "Unexpected image data shape" });
      }
      res.json({
        b64_json: mimeMatch[2],
        mimeType: mimeMatch[1],
      });
    } catch (error: any) {
      console.error("[api/generate-image] Error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to generate image" });
    }
  });
}
