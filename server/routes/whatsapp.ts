import type { Express, Request, Response } from "express";
import * as whatsapp from "../whatsapp";

type WhatsAppHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
  ADMIN_TENANT_ID: number;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerWhatsAppRoutes(app: Express, helpers: WhatsAppHelpers) {
  const { getTenantFromRequest, ADMIN_TENANT_ID, requirePlatformAdmin } = helpers;

  app.get("/api/whatsapp/status", async (req, res) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      res.json(whatsapp.getWhatsAppStatus());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/whatsapp/connect", async (req, res) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const result = await whatsapp.connectWhatsApp();
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/whatsapp/disconnect", async (req, res) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      await whatsapp.disconnectWhatsApp();
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/whatsapp/qr", async (req, res) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const dataUrl = await whatsapp.getQRCodeDataURL();
      if (!dataUrl) return res.status(404).json({ error: "No QR code available. Start connection first." });
      res.json({ qr: dataUrl });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/whatsapp/send", async (req, res) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const { to, message } = req.body;
      if (!to || !message) return res.status(400).json({ error: "to and message are required" });
      await whatsapp.sendWhatsAppMessage(to, message);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/whatsapp/settings", async (req, res) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const { autoReply, allowedContacts } = req.body;
      if (typeof autoReply === "boolean") whatsapp.setAutoReply(autoReply);
      if (allowedContacts !== undefined) whatsapp.setAllowedContacts(allowedContacts);
      res.json(whatsapp.getWhatsAppStatus());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/whatsapp/approval-phone", async (req, res) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const { getApprovalPhone } = await import("../whatsapp-approval");
      const phone = getApprovalPhone();
      res.json({ phone: phone ? phone.replace("@s.whatsapp.net", "") : null });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/whatsapp/approval-phone", async (req, res) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const { phone } = req.body;
      const { setApprovalPhone } = await import("../whatsapp-approval");
      await setApprovalPhone(phone || null);
      res.json({ success: true, phone: phone || null });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/whatsapp/test-approval", async (req, res) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const { getApprovalPhone, sendApprovalRequest, registerShortId } = await import("../whatsapp-approval");
      if (!getApprovalPhone()) return res.status(400).json({ error: "No approval phone configured" });
      const testId = `confirm_${Date.now()}_test01`;
      registerShortId(testId);
      const sent = await sendApprovalRequest(testId, "test_action", { note: "This is a test approval request" }, "Test approval — no action will be taken");
      res.json({ success: sent, message: sent ? "Test approval sent to WhatsApp" : "WhatsApp not connected" });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── WhatsApp Per-Tenant Routes ─────────────────────────
  app.get("/api/whatsapp/my/status", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      if (tenantId === ADMIN_TENANT_ID) {
        res.json(whatsapp.getWhatsAppStatus());
      } else {
        res.json(whatsapp.getWhatsAppStatus(tenantId));
      }
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/whatsapp/my/connect", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const tid = tenantId === ADMIN_TENANT_ID ? undefined : tenantId;
      const result = await whatsapp.connectWhatsApp(tid);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/whatsapp/my/disconnect", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const tid = tenantId === ADMIN_TENANT_ID ? undefined : tenantId;
      await whatsapp.disconnectWhatsApp(tid);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/whatsapp/my/qr", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const tid = tenantId === ADMIN_TENANT_ID ? undefined : tenantId;
      const dataUrl = await whatsapp.getQRCodeDataURL(tid);
      if (!dataUrl) return res.status(404).json({ error: "No QR code available. Start connection first." });
      res.json({ qr: dataUrl });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/whatsapp/my/approval-phone", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getApprovalPhone } = await import("../whatsapp-approval");
      const tid = tenantId === ADMIN_TENANT_ID ? undefined : tenantId;
      const phone = getApprovalPhone(tid);
      res.json({ phone: phone ? phone.replace("@s.whatsapp.net", "") : null });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/whatsapp/my/approval-phone", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { phone } = req.body;
      const { setApprovalPhone } = await import("../whatsapp-approval");
      const tid = tenantId === ADMIN_TENANT_ID ? undefined : tenantId;
      await setApprovalPhone(phone || null, tid);
      res.json({ success: true, phone: phone || null });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/whatsapp/my/test-approval", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getApprovalPhone, sendApprovalRequest, registerShortId } = await import("../whatsapp-approval");
      const tid = tenantId === ADMIN_TENANT_ID ? undefined : tenantId;
      if (!getApprovalPhone(tid)) return res.status(400).json({ error: "No approval phone configured" });
      const testId = `confirm_${Date.now()}_test01`;
      registerShortId(testId, tid);
      const sent = await sendApprovalRequest(testId, "test_action", { note: "This is a test approval request" }, "Test approval \u2014 no action will be taken", tid);
      res.json({ success: sent, message: sent ? "Test approval sent to WhatsApp" : "WhatsApp not connected" });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
