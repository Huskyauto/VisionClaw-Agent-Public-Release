// R74.13v — Stage 32 of routes.ts decomposition.
// 1 PUBLIC webhook route — /api/webhooks/agentmail (POST).
//
// SECURITY: this is a fail-CLOSED HMAC-SHA256 signed webhook. In production,
// AGENTMAIL_WEBHOOK_SECRET MUST be set or the webhook returns 503 (cannot
// prove origin → would otherwise be a PoisonedRAG attack vector since
// inbound mail flows into knowledge ingestion). In dev/test, unsigned
// payloads are accepted with a warning so fixtures keep working.
//
// Behavior preserved verbatim from monolith — no logic changes.

import type { Express, Request, Response } from "express";

export function registerAgentMailWebhookRoutes(app: Express) {
  app.post("/api/webhooks/agentmail", async (req: Request, res: Response) => {
    try {
      const webhookSecret = process.env.AGENTMAIL_WEBHOOK_SECRET;
      // SECURITY: fail CLOSED in production. Without AGENTMAIL_WEBHOOK_SECRET we
      // cannot prove the payload came from AgentMail, and inbound mail flows
      // straight into knowledge ingestion (PoisonedRAG attack surface). The
      // weak to-address filter further down is trivially spoofable. Refuse
      // unsigned payloads in prod; dev/test may still post unsigned for fixtures.
      if (!webhookSecret) {
        if (process.env.NODE_ENV === "production") {
          console.error("[webhook] AgentMail: AGENTMAIL_WEBHOOK_SECRET not set in production — refusing unsigned webhook");
          return res.status(503).json({ error: "Webhook secret not configured" });
        }
        console.warn("[webhook] AgentMail: AGENTMAIL_WEBHOOK_SECRET not set — accepting unsigned payload (dev only)");
      } else {
        const sig = req.headers["x-agentmail-signature"] || req.headers["x-webhook-signature"] || "";
        if (!sig) {
          console.warn("[webhook] AgentMail: missing signature header");
          return res.status(401).json({ error: "Missing signature" });
        }
        const crypto = await import("crypto");
        const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        const expected = crypto.createHmac("sha256", webhookSecret).update(body).digest("hex");
        const sigStr = typeof sig === "string" ? sig : Array.isArray(sig) ? sig[0] : "";
        const sigBuf = Buffer.from(sigStr);
        const expBuf = Buffer.from(expected);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
          console.warn("[webhook] AgentMail: invalid signature");
          return res.status(401).json({ error: "Invalid signature" });
        }
      }

      const payload = req.body?.data || req.body?.message || req.body;
      if (!payload) return res.status(400).json({ error: "No payload" });
      if (!payload.to && !payload.from && !payload.subject) {
        return res.status(400).json({ error: "Invalid email payload" });
      }
      const toAddr = typeof payload.to === "string" ? payload.to : payload.to?.[0]?.address || payload.to?.[0] || "";
      if (!toAddr.includes("visionclaw") && !toAddr.includes("agentmail")) {
        return res.status(403).json({ error: "Rejected" });
      }
      const { storeIncomingEmail } = await import("../email");
      const result = await storeIncomingEmail(payload);
      res.json({ ok: true, stored: result.isNew, id: result.id });
    } catch (e: any) {
      console.error("[webhook] AgentMail error:", e.message);
      res.status(500).json({ error: "Internal webhook error" });
    }
  });
}
