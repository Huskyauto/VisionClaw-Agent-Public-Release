import { getWhatsAppStatus, sendWhatsAppMessage, getConnectedJid } from "./whatsapp";
import { resolveToolConfirmation, getPendingConfirmations } from "./tool-mutation";
import { db } from "./db";
import { sql } from "drizzle-orm";

const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

const tenantApprovalPhones = new Map<string, string | null>();

function phoneKey(tenantId?: number): string {
  return tenantId != null ? `t${tenantId}` : "admin";
}

function getTargetJid(tenantId?: number): string | null {
  const approvalPhoneJid = tenantApprovalPhones.get(phoneKey(tenantId)) ?? null;
  if (!approvalPhoneJid) return null;
  const connectedJid = getConnectedJid(tenantId);
  if (!connectedJid) return approvalPhoneJid;
  const approvalDigits = approvalPhoneJid.replace(/\D/g, "");
  const connectedDigits = connectedJid.replace(/\D/g, "");
  if (connectedDigits === approvalDigits ||
      connectedDigits.endsWith(approvalDigits) ||
      approvalDigits.endsWith(connectedDigits)) {
    return connectedJid;
  }
  return approvalPhoneJid;
}

export async function loadApprovalPhone(tenantId?: number): Promise<void> {
  try {
    if (tenantId != null) {
      await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_approval_phone text DEFAULT NULL`).catch(() => {});
      const result = await db.execute(sql`SELECT whatsapp_approval_phone FROM tenants WHERE id = ${tenantId}`);
      const rows = (result as any).rows || result;
      if (rows?.[0]?.whatsapp_approval_phone) {
        const phone = rows[0].whatsapp_approval_phone.replace(/\D/g, "");
        tenantApprovalPhones.set(phoneKey(tenantId), `${phone}@s.whatsapp.net`);
        console.log(`[wa-approval:t${tenantId}] Loaded approval phone: +${phone}`);
      }
    } else {
      await db.execute(sql`ALTER TABLE agent_settings ADD COLUMN IF NOT EXISTS whatsapp_approval_phone text DEFAULT NULL`).catch(() => {});
      const result = await db.execute(sql`SELECT whatsapp_approval_phone FROM agent_settings LIMIT 1`);
      const rows = (result as any).rows || result;
      if (rows?.[0]?.whatsapp_approval_phone) {
        const phone = rows[0].whatsapp_approval_phone.replace(/\D/g, "");
        tenantApprovalPhones.set(phoneKey(), `${phone}@s.whatsapp.net`);
        console.log(`[wa-approval] Loaded admin approval phone: +${phone}`);
      }
    }
  } catch {
  }
}

export async function loadAllApprovalPhones(): Promise<void> {
  await loadApprovalPhone();
  try {
    await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_approval_phone text DEFAULT NULL`).catch(() => {});
    const result = await db.execute(sql`SELECT id, whatsapp_approval_phone FROM tenants WHERE whatsapp_approval_phone IS NOT NULL`);
    const rows = (result as any).rows || result;
    for (const row of rows || []) {
      if (row.whatsapp_approval_phone) {
        const phone = row.whatsapp_approval_phone.replace(/\D/g, "");
        tenantApprovalPhones.set(phoneKey(row.id), `${phone}@s.whatsapp.net`);
        console.log(`[wa-approval:t${row.id}] Loaded tenant approval phone: +${phone}`);
      }
    }
  } catch {}
}

export async function setApprovalPhone(phone: string | null, tenantId?: number): Promise<void> {
  if (phone && typeof phone !== "string") throw new Error("Phone must be a string");
  const key = phoneKey(tenantId);
  if (phone) {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length < 10 || cleaned.length > 15) throw new Error("Phone number must be 10-15 digits");
    tenantApprovalPhones.set(key, `${cleaned}@s.whatsapp.net`);
    if (tenantId != null) {
      await db.execute(sql`UPDATE tenants SET whatsapp_approval_phone = ${cleaned} WHERE id = ${tenantId}`);
      console.log(`[wa-approval:t${tenantId}] Set approval phone: +${cleaned}`);
    } else {
      await db.execute(sql`UPDATE agent_settings SET whatsapp_approval_phone = ${cleaned}`);
      console.log(`[wa-approval] Set admin approval phone: +${cleaned}`);
    }
  } else {
    tenantApprovalPhones.set(key, null);
    if (tenantId != null) {
      await db.execute(sql`UPDATE tenants SET whatsapp_approval_phone = NULL WHERE id = ${tenantId}`);
      console.log(`[wa-approval:t${tenantId}] Cleared approval phone`);
    } else {
      await db.execute(sql`UPDATE agent_settings SET whatsapp_approval_phone = NULL`);
      console.log(`[wa-approval] Cleared admin approval phone`);
    }
  }
}

export function getApprovalPhone(tenantId?: number): string | null {
  return tenantApprovalPhones.get(phoneKey(tenantId)) ?? null;
}

export function getApprovalTimeoutMs(tenantId?: number): number {
  const approvalPhoneJid = tenantApprovalPhones.get(phoneKey(tenantId)) ?? null;
  if (approvalPhoneJid && isWhatsAppReady(tenantId)) {
    return APPROVAL_TIMEOUT_MS;
  }
  return 120_000;
}

function isWhatsAppReady(tenantId?: number): boolean {
  const status = getWhatsAppStatus(tenantId);
  return status.state === "connected";
}

function formatShortId(confirmationId: string): string {
  const parts = confirmationId.split("_");
  return parts.length >= 3 ? parts[2].toUpperCase() : confirmationId.slice(-6).toUpperCase();
}

export async function sendApprovalRequest(
  confirmationId: string,
  toolName: string,
  args: Record<string, unknown>,
  description: string,
  tenantId?: number,
): Promise<boolean> {
  const targetJid = getTargetJid(tenantId);
  if (!targetJid || !isWhatsAppReady(tenantId)) return false;

  const shortId = formatShortId(confirmationId);

  const SENSITIVE_KEYS = new Set(["token", "password", "secret", "key", "apiKey", "api_key", "authorization", "credential", "pin"]);
  const argSummary = Object.entries(args)
    .filter(([k]) => !SENSITIVE_KEYS.has(k.toLowerCase()))
    .slice(0, 5)
    .map(([k, v]) => {
      if (typeof v === "string" && v.length > 80) return `  ${k}: ${v.slice(0, 80)}...`;
      if (typeof v === "string") return `  ${k}: ${v}`;
      return `  ${k}: [${typeof v}]`;
    })
    .join("\n");

  const connectedJid = getConnectedJid(tenantId);
  const isSelf = targetJid === connectedJid;

  const RISK_CONTEXT: Record<string, { emoji: string; impact: string }> = {
    send_email: { emoji: "\u{1F4E7}", impact: "Sends external email \u2014 cannot be unsent" },
    delegate_task: { emoji: "\u{1F916}", impact: "Spawns autonomous agent task \u2014 uses AI credits" },
    sessions_send: { emoji: "\u{1F4AC}", impact: "Messages another agent session" },
    whatsapp: { emoji: "\u{1F4F1}", impact: "Sends WhatsApp message to external contact" },
    exec: { emoji: "\u2699\uFE0F", impact: "Executes system command \u2014 could modify server" },
    shell_exec: { emoji: "\u2699\uFE0F", impact: "Executes shell command \u2014 could modify server" },
    draft_social_post: { emoji: "\u{1F4E3}", impact: "Creates social media content for publishing" },
    marketing_experiment: { emoji: "\u{1F9EA}", impact: "Runs marketing A/B test \u2014 may contact customers" },
    deliver_product: { emoji: "\u{1F4E6}", impact: "Delivers digital product to customer" },
    google_drive: { emoji: "\u{1F4C1}", impact: "Modifies Google Drive files" },
  };

  const risk = RISK_CONTEXT[toolName];
  const riskLine = risk ? `${risk.emoji} *Risk:* ${risk.impact}\n` : "";

  const message =
    `*\u{1F510} ${(await import("./site-config")).siteConfig.platformName} Approval Required*\n\n` +
    `*Tool:* ${toolName}\n` +
    `*Action:* ${description}\n` +
    riskLine +
    (argSummary ? `*Details:*\n${argSummary}\n\n` : "\n") +
    `Reply *YES ${shortId}* to approve\n` +
    `Reply *NO ${shortId}* to reject\n\n` +
    `_Expires in 10 minutes_`;

  try {
    await sendWhatsAppMessage(targetJid, message, tenantId);
    console.log(`[wa-approval${tenantId != null ? `:t${tenantId}` : ""}] Sent approval request ${shortId} for ${toolName} to ${isSelf ? "self" : targetJid}`);
    return true;
  } catch (err: any) {
    console.error(`[wa-approval${tenantId != null ? `:t${tenantId}` : ""}] Failed to send approval:`, err.message);
    return false;
  }
}

async function sendApprovalResult(shortId: string, approved: boolean, toolName: string, tenantId?: number): Promise<void> {
  const targetJid = getTargetJid(tenantId);
  if (!targetJid || !isWhatsAppReady(tenantId)) return;

  const emoji = approved ? "\u2705" : "\u274C";
  const action = approved ? "approved and executing" : "rejected";
  const message = `${emoji} Task ${shortId} (${toolName}) ${action}.`;

  try {
    await sendWhatsAppMessage(targetJid, message, tenantId);
  } catch {}
}

const shortIdMap = new Map<string, { fullId: string; tenantId?: number }>();

export function registerShortId(confirmationId: string, tenantId?: number): void {
  const shortId = formatShortId(confirmationId);
  shortIdMap.set(shortId, { fullId: confirmationId, tenantId });

  setTimeout(() => {
    shortIdMap.delete(shortId);
  }, APPROVAL_TIMEOUT_MS + 60_000);
}

function isApprovalSender(fromJid: string, tenantId?: number): boolean {
  const approvalPhoneJid = tenantApprovalPhones.get(phoneKey(tenantId)) ?? null;
  if (!approvalPhoneJid) return false;
  const fromDigits = fromJid.replace(/\D/g, "");
  const approvalDigits = approvalPhoneJid.replace(/\D/g, "");
  const connectedJid = getConnectedJid(tenantId);
  const connectedDigits = connectedJid ? connectedJid.replace(/\D/g, "") : "";

  if (fromJid.endsWith("@lid") && connectedJid) return true;

  return fromDigits === approvalDigits ||
    fromDigits === connectedDigits ||
    fromDigits.endsWith(approvalDigits) ||
    approvalDigits.endsWith(fromDigits) ||
    (connectedDigits && (fromDigits.endsWith(connectedDigits) || connectedDigits.endsWith(fromDigits)));
}

export function handleWhatsAppApprovalCommand(text: string, fromJid: string, tenantId?: number): boolean {
  const trimmed = text.trim().toUpperCase();
  const match = trimmed.match(/^(YES|NO|APPROVE|DENY|REJECT)\s+([A-Z0-9]+)$/);
  if (!match) return false;

  const [, command, shortId] = match;
  const approved = command === "YES" || command === "APPROVE";

  const entry = shortIdMap.get(shortId);
  if (entry) {
    if (!isApprovalSender(fromJid, entry.tenantId)) return false;

    const resolved = resolveToolConfirmation(entry.fullId, approved);
    if (resolved) {
      sendApprovalResult(shortId, approved, "tool", entry.tenantId);
      shortIdMap.delete(shortId);
      console.log(`[wa-approval] ${approved ? "APPROVED" : "DENIED"} task ${shortId} via WhatsApp (tenant: ${entry.tenantId ?? "admin"})`);
      return true;
    }
  }

  const checkTenantId = tenantId;
  const approvalPhoneJid = tenantApprovalPhones.get(phoneKey(checkTenantId)) ?? null;
  if (!approvalPhoneJid) {
    for (const [key, phone] of tenantApprovalPhones) {
      if (!phone) continue;
      const tid = key === "admin" ? undefined : parseInt(key.replace("t", ""));
      if (isApprovalSender(fromJid, tid)) {
        const pending = getPendingConfirmations();
        const found = pending.find((p) => formatShortId(p.id) === shortId);
        if (found) {
          const resolved = resolveToolConfirmation(found.id, approved);
          if (resolved) {
            sendApprovalResult(shortId, approved, found.toolName, tid);
            console.log(`[wa-approval] ${approved ? "APPROVED" : "DENIED"} task ${shortId} (${found.toolName}) via WhatsApp (tenant: ${tid ?? "admin"})`);
            return true;
          }
        }
      }
    }
    return false;
  }

  if (!isApprovalSender(fromJid, checkTenantId)) return false;

  const pending = getPendingConfirmations();
  const found = pending.find((p) => formatShortId(p.id) === shortId);
  if (found) {
    const resolved = resolveToolConfirmation(found.id, approved);
    if (resolved) {
      sendApprovalResult(shortId, approved, found.toolName, checkTenantId);
      shortIdMap.delete(shortId);
      console.log(`[wa-approval] ${approved ? "APPROVED" : "DENIED"} task ${shortId} (${found.toolName}) via WhatsApp`);
      return true;
    }
  }

  const replyJid = getTargetJid(checkTenantId);
  if (replyJid) sendWhatsAppMessage(replyJid, `Task ${shortId} not found or already expired.`, checkTenantId).catch(() => {});
  return true;
}

export async function notifyApprovalTimeout(confirmationId: string, toolName: string, tenantId?: number): Promise<void> {
  const targetJid = getTargetJid(tenantId);
  if (!targetJid || !isWhatsAppReady(tenantId)) return;

  const shortId = formatShortId(confirmationId);
  try {
    await sendWhatsAppMessage(
      targetJid,
      `\u23F0 Task ${shortId} (${toolName}) expired \u2014 auto-denied after 10 minutes.`,
      tenantId,
    );
  } catch {}
  shortIdMap.delete(shortId);
}
