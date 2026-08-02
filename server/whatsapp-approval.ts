import { getWhatsAppStatus, sendWhatsAppMessage, getConnectedJid, getConnectedLid } from "./whatsapp";
import { resolveToolConfirmation, getPendingConfirmations } from "./tool-mutation";
import { db } from "./db";
import { sql } from "drizzle-orm";

import { logSilentCatch } from "./lib/silent-catch";
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

// R74.13z-quint+6 (OpenClaw nugget #2) — Bounded approval card. WhatsApp's
// hard message cap is 4096 chars; we leave headroom for the YES/NO footer +
// risk line + multi-byte emojis. Without these caps, a runaway proposal with
// 50 metadata lines or a 5000-char string value silently blows past the cap
// and the entire card fails to send.
//
// Apply two patterns from openclaw/openclaw (commit 3295689):
//   1. Hard per-line char cap with "..." truncation
//   2. Hard line-count cap with "...+N more" tail when exceeded
const WA_APPROVAL_LINE_MAX = 200;        // chars per metadata line value
const WA_APPROVAL_DETAIL_LINES_MAX = 9;  // metadata lines before "+N more" tail
const WA_APPROVAL_DESCRIPTION_MAX = 800; // total chars for the description line
const WA_APPROVAL_TOTAL_MAX = 3500;      // hard ceiling on the whole message

function truncateLine(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

// R74.13z-quint+6 (architect-flagged twice) — Sensitive field name matcher.
// Two evolutions in this round:
//   Round 1: switched from exact-set-match to substring regex (caught
//            'apiKey', 'accessToken', 'openai_api_key', etc. that the
//            old Set missed).
//   Round 2: added redactNested() so a nested object like
//            { headers: { Authorization: "Bearer ABC" } } also gets
//            scrubbed before JSON.stringify reaches the WA card.
// Narrowed the bare 'key' alternative to specific high-risk variants
// (apikey, api_key, secretkey, accesskey, privatekey) to avoid false-
// positive redaction of legitimate identifier fields like 'objectKey',
// 'primaryKey', 'storageKey', 'idempotencyKey' which carry no secret.
const SENSITIVE_FIELD_RX = /(token|password|passwd|secret|api[_-]?key|apikey|secret[_-]?key|access[_-]?key|private[_-]?key|public[_-]?key|authorization|credential|access[_-]?token|refresh[_-]?token|client[_-]?secret|webhook[_-]?secret|bearer|signature|cookie|otp|\bpin\b|cert|\bsalt\b|\bnonce\b)/i;

function isSensitiveField(name: string): boolean {
  return SENSITIVE_FIELD_RX.test(name);
}

const REDACTED = "[redacted]";
const REDACT_MAX_DEPTH = 6;

// R74.13z-quint+6 (architect-flagged) — Recursively walk objects/arrays and
// replace sensitive-keyed values with "[redacted]" BEFORE serialization.
// Cycle-safe via WeakSet. Truncates beyond REDACT_MAX_DEPTH to keep us out
// of pathological deep payloads.
function redactNested(value: unknown, depth: number = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (depth > REDACT_MAX_DEPTH) return "[…depth-cap]";
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean" || t === "bigint") return value;
  if (t === "function" || t === "symbol") return `[${t}]`;
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    return value.map(item => redactNested(item, depth + 1, seen));
  }
  if (t === "object") {
    if (seen.has(value as object)) return "[circular]";
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveField(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactNested(v, depth + 1, seen);
      }
    }
    return out;
  }
  return value;
}

function buildBoundedDetailLines(args: Record<string, unknown>): string[] {
  // Top-level filter: drop sensitive keys entirely (don't even render the
  // line). Non-sensitive keys go through nested redaction before render.
  const allEntries = Object.entries(args).filter(([k]) => !isSensitiveField(k));
  const renderedLines = allEntries.map(([k, v]) => {
    if (typeof v === "string") return `  ${k}: ${truncateLine(v, WA_APPROVAL_LINE_MAX)}`;
    if (v === null) return `  ${k}: null`;
    if (typeof v === "object") {
      try {
        const scrubbed = redactNested(v);
        const json = JSON.stringify(scrubbed);
        return `  ${k}: ${truncateLine(json, WA_APPROVAL_LINE_MAX)}`;
      } catch (_e) {
        return `  ${k}: [${typeof v}]`;
      }
    }
    return `  ${k}: ${truncateLine(String(v), WA_APPROVAL_LINE_MAX)}`;
  });
  if (renderedLines.length <= WA_APPROVAL_DETAIL_LINES_MAX) return renderedLines;
  const visible = renderedLines.slice(0, WA_APPROVAL_DETAIL_LINES_MAX - 1);
  const omitted = renderedLines.length - visible.length;
  visible.push(`  ...+${omitted} more`);
  return visible;
}

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
  } catch (err: any) {
    // R74.13c — M7 fix. Don't swallow startup config load failures.
    console.error("[wa-approval] Failed to load admin approval phone (feature will be DISABLED):", err?.message ?? err);
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
  } catch (err: any) {
    // R74.13c — M7 fix. Don't swallow startup config load failures.
    console.error("[wa-approval] Failed to load per-tenant approval phones (feature DEGRADED for affected tenants):", err?.message ?? err);
  }
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

  // R74.13z-quint+6 (OpenClaw nugget #2) — Use the bounded helper. Caps line
  // count to WA_APPROVAL_DETAIL_LINES_MAX with a "...+N more" tail and each
  // line value to WA_APPROVAL_LINE_MAX chars. Sensitive field names are
  // redacted by SENSITIVE_FIELD_RX inside the helper.
  const argSummary = buildBoundedDetailLines(args).join("\n");
  const safeDescription = truncateLine(String(description ?? ""), WA_APPROVAL_DESCRIPTION_MAX);

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

  let message =
    `*\u{1F510} ${(await import("./site-config")).siteConfig.platformName} Approval Required*\n\n` +
    `*Tool:* ${toolName}\n` +
    `*Action:* ${safeDescription}\n` +
    riskLine +
    (argSummary ? `*Details:*\n${argSummary}\n\n` : "\n") +
    `Reply *YES ${shortId}* to approve\n` +
    `Reply *NO ${shortId}* to reject\n\n` +
    `_Expires in 10 minutes_`;
  // R74.13z-quint+6 (OpenClaw nugget #2) — Hard ceiling. Per-field caps
  // should already keep us well under this, but if a future contributor adds
  // a new field without a cap, this guards the message-send call from a
  // surprise WhatsApp 4096-char hard error.
  if (message.length > WA_APPROVAL_TOTAL_MAX) {
    const overage = message.length - WA_APPROVAL_TOTAL_MAX;
    message = message.slice(0, WA_APPROVAL_TOTAL_MAX - 60) + `\n\n_(Truncated; ${overage} chars omitted)_`;
    console.warn(`[wa-approval${tenantId != null ? `:t${tenantId}` : ""}] Approval card hit WA_APPROVAL_TOTAL_MAX, truncated ${overage} chars. Investigate which field exceeded its cap.`);
  }

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
  } catch (_silentErr) { logSilentCatch("server/whatsapp-approval.ts", _silentErr); }
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
  const connectedLid = getConnectedLid(tenantId);
  const connectedDigits = connectedJid ? connectedJid.replace(/\D/g, "") : "";

  // R74.13z-quint+6 (architect-flagged) — Authorization tightening for @lid
  // senders. The previous "endsWith('@lid') && connectedJid" was a blanket
  // allow: any contact using LID identity (newer WA privacy routing) could
  // approve dangerous actions if they obtained or guessed a 4-6 char short
  // ID. Now @lid senders are accepted ONLY when their LID base matches our
  // verified connectedLid — i.e. Bob approving from a linked-device session
  // of the bot's own account. Arbitrary @lid senders fall through to the
  // digit comparison below, which won't match because @lid JIDs carry no
  // phone digits.
  if (fromJid.endsWith("@lid")) {
    if (!connectedLid) return false;
    const fromLidBase = fromJid.replace(/@.*/, "").replace(/:\d+$/, "");
    const ownLidBase = connectedLid.replace(/@.*/, "").replace(/:\d+$/, "");
    return fromLidBase === ownLidBase;
  }

  // R74.13z-quint+6 (architect-flagged round 4) — Reject phone-digit matching
  // when fromDigits is empty or trivially short. The previous code used
  // `approvalDigits.endsWith(fromDigits)` which is `true` for ANY non-empty
  // string when fromDigits === "" — making `status@broadcast`, malformed
  // JIDs, or newsletter-style identifiers (no digits in user part) pass the
  // approval gate. We require at least 7 digits (shortest realistic country
  // mobile length) to even consider digit-suffix matching.
  const MIN_PHONE_DIGITS = 7;
  if (fromDigits.length < MIN_PHONE_DIGITS) return false;

  return fromDigits === approvalDigits ||
    fromDigits === connectedDigits ||
    (approvalDigits.length >= MIN_PHONE_DIGITS && (fromDigits.endsWith(approvalDigits) || approvalDigits.endsWith(fromDigits))) ||
    (!!connectedDigits && connectedDigits.length >= MIN_PHONE_DIGITS && (fromDigits.endsWith(connectedDigits) || connectedDigits.endsWith(fromDigits)));
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
  } catch (_silentErr) { logSilentCatch("server/whatsapp-approval.ts", _silentErr); }
  shortIdMap.delete(shortId);
}
