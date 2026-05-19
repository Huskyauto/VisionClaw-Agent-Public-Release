import { getOrCreateTenantInbox, sendEmail } from "./email";
import { logSilentCatch } from "./lib/silent-catch";
import { buildHitlLinks } from "./hitl-tokens";

interface EscalateInput {
  tenantId: number;
  confirmationId: string;
  toolName: string;
  action?: string;
  args: Record<string, unknown>;
  conversationId?: number;
}

// R82 — Bob complained about email flood (8+ HITL emails in seconds for a
// single agentic burst). Switch from per-confirmation emails to a per-tenant
// digest: queue pending escalations and flush ONE email per tenant per
// BATCH_WINDOW_MS, listing every pending item with its own approve/deny links.
// SSE events still fire immediately (those are free).
const BATCH_WINDOW_MS = 30_000;
const MAX_BATCH_SIZE = 25; // safety: if a runaway agent queues 100s, cap the digest

// R94 SECURITY — hard per-tenant outbound-email quota to prevent runaway
// agentic loops from spamming the operator's inbox. Counts digests *sent*
// (not items queued — batching already collapses many items into one email).
const ESCALATION_QUOTA_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ESCALATION_QUOTA_MAX = 20; // max digests per tenant per hour
const escalationSendLog = new Map<number, number[]>(); // tenantId -> [unix-ms timestamps]

function checkEscalationQuota(tenantId: number): boolean {
  const now = Date.now();
  const arr = (escalationSendLog.get(tenantId) ?? []).filter(t => now - t < ESCALATION_QUOTA_WINDOW_MS);
  if (arr.length >= ESCALATION_QUOTA_MAX) {
    escalationSendLog.set(tenantId, arr);
    console.warn(`[escalation] tenant ${tenantId} EXCEEDED quota (${arr.length}/${ESCALATION_QUOTA_MAX} digests in ${ESCALATION_QUOTA_WINDOW_MS / 60000}min) — suppressing send`);
    return false;
  }
  arr.push(now);
  escalationSendLog.set(tenantId, arr);
  return true;
}

interface QueuedItem {
  input: EscalateInput;
  approveUrl: string;
  denyUrl: string;
  queuedAt: number;
}

const pendingByTenant = new Map<number, QueuedItem[]>();
const flushTimers = new Map<number, ReturnType<typeof setTimeout>>();
const queuedConfirmationIds = new Set<string>();

const sseSubscribers = new Set<(event: { type: string; payload: any }) => void>();

export function subscribeEscalation(fn: (event: { type: string; payload: any }) => void): () => void {
  sseSubscribers.add(fn);
  return () => sseSubscribers.delete(fn);
}

function emit(event: { type: string; payload: any }) {
  for (const fn of sseSubscribers) {
    try { fn(event); } catch (_silentErr) { logSilentCatch("server/escalation-channels.ts", _silentErr); }
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (k.startsWith("_")) continue;
    let s: string;
    if (typeof v === "string") s = v.length > 80 ? v.slice(0, 80) + "..." : v;
    else if (typeof v === "number" || typeof v === "boolean") s = String(v);
    else if (Array.isArray(v)) s = `[array ${v.length}]`;
    else if (v && typeof v === "object") s = `[object]`;
    else continue;
    parts.push(`${k}=${s}`);
    if (parts.length >= 6) break;
  }
  return parts.join("\n  ");
}

function htmlEscape(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderArgsRowsHtml(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([k]) => !k.startsWith("_"))
    .slice(0, 8)
    .map(([k, v]) => {
      let s: string;
      if (typeof v === "string") s = v.length > 200 ? v.slice(0, 200) + "..." : v;
      else if (typeof v === "number" || typeof v === "boolean") s = String(v);
      else if (Array.isArray(v)) s = `[array len=${v.length}]`;
      else if (v && typeof v === "object") s = `[object]`;
      else s = String(v);
      return `<tr><td style="padding:3px 12px 3px 0;color:#666;vertical-align:top;font-family:monospace;font-size:11px;">${htmlEscape(k)}</td><td style="padding:3px 0;font-family:monospace;font-size:11px;">${htmlEscape(s)}</td></tr>`;
    })
    .join("");
}

async function flushTenantDigest(tenantId: number): Promise<void> {
  flushTimers.delete(tenantId);
  const items = pendingByTenant.get(tenantId) ?? [];
  pendingByTenant.delete(tenantId);
  for (const it of items) queuedConfirmationIds.delete(it.input.confirmationId);
  if (items.length === 0) return;
  // R94 SECURITY — enforce per-tenant hourly digest quota. SSE events still
  // fired in real time; only the email send is suppressed when over quota.
  if (!checkEscalationQuota(tenantId)) {
    console.warn(`[escalation] tenant ${tenantId} digest of ${items.length} item(s) suppressed (quota exceeded)`);
    return;
  }

  try {
    const to = process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com";
    const inbox = await getOrCreateTenantInbox(tenantId);
    const inboxId = (inbox as any).inboxId || (inbox as any).email || inbox;

    const subject = items.length === 1
      ? `[VisionClaw HITL] ${items[0].input.toolName}${items[0].input.action ? ":" + items[0].input.action : ""} needs approval`
      : `[VisionClaw HITL] ${items.length} agent actions need approval (tenant ${tenantId})`;

    // Plain-text body
    const textBlocks: string[] = [
      items.length === 1
        ? "An agent action requires your approval."
        : `${items.length} agent actions require your approval (batched over the last ${Math.round(BATCH_WINDOW_MS / 1000)}s).`,
      "",
      `Tenant: ${tenantId}`,
      "",
    ];
    items.forEach((it, idx) => {
      textBlocks.push(`──── ${idx + 1}/${items.length} ────`);
      textBlocks.push(`Tool:          ${it.input.toolName}${it.input.action ? ":" + it.input.action : ""}`);
      if (it.input.conversationId) textBlocks.push(`Conversation:  ${it.input.conversationId}`);
      textBlocks.push(`Confirmation:  ${it.input.confirmationId}`);
      textBlocks.push("Args:");
      textBlocks.push("  " + summarizeArgs(it.input.args));
      textBlocks.push(`APPROVE: ${it.approveUrl}`);
      textBlocks.push(`DENY:    ${it.denyUrl}`);
      textBlocks.push("");
    });
    textBlocks.push("If you do not respond within the approval window, requests auto-deny.");
    textBlocks.push("You can also reply via the WhatsApp number you configured, or open the workspace.");
    textBlocks.push("");
    textBlocks.push("— VisionClaw Escalation");
    const text = textBlocks.join("\n");

    // HTML body
    const itemCardsHtml = items.map((it, idx) => `
      <div style="border:1px solid #e5e5e5;border-radius:8px;padding:16px;margin:0 0 16px 0;">
        <div style="font-size:11px;color:#999;margin:0 0 8px 0;">${idx + 1} of ${items.length}</div>
        <div style="font-family:monospace;font-size:14px;font-weight:600;margin:0 0 12px 0;">${htmlEscape(it.input.toolName)}${it.input.action ? ":" + htmlEscape(it.input.action) : ""}</div>
        <table style="border-collapse:collapse;margin:0 0 12px 0;width:100%;">
          ${it.input.conversationId ? `<tr><td style="padding:3px 12px 3px 0;color:#666;font-family:monospace;font-size:11px;">conversation</td><td style="padding:3px 0;font-family:monospace;font-size:11px;">${it.input.conversationId}</td></tr>` : ""}
          <tr><td style="padding:3px 12px 3px 0;color:#666;font-family:monospace;font-size:11px;">confirmation</td><td style="padding:3px 0;font-family:monospace;font-size:10px;color:#888;">${it.input.confirmationId}</td></tr>
          ${renderArgsRowsHtml(it.input.args)}
        </table>
        <div>
          <a href="${it.approveUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:8px 18px;border-radius:6px;font-weight:600;font-size:13px;margin-right:6px;">Approve</a>
          <a href="${it.denyUrl}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:8px 18px;border-radius:6px;font-weight:600;font-size:13px;">Deny</a>
        </div>
      </div>
    `).join("");

    const heading = items.length === 1
      ? "Agent action needs approval"
      : `${items.length} agent actions need approval`;
    const subheading = items.length === 1
      ? "Click one of the buttons below or reply via WhatsApp. The request auto-denies on timeout."
      : `Batched over the last ${Math.round(BATCH_WINDOW_MS / 1000)}s. Approve or deny each individually below — or reply via WhatsApp.`;

    const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#222;">
  <h2 style="margin:0 0 8px 0;">${heading}</h2>
  <p style="color:#555;margin:0 0 20px 0;">${subheading}</p>
  <div style="font-size:12px;color:#999;margin:0 0 16px 0;">Tenant: ${tenantId}</div>
  ${itemCardsHtml}
  <p style="font-size:12px;color:#999;margin:24px 0 0 0;">— VisionClaw Escalation</p>
</body></html>`;

    await sendEmail({ inboxId, to, subject, text, html });
    console.log(`[escalation] digest sent to ${to}: ${items.length} item(s) for tenant ${tenantId}`);
  } catch (e) {
    console.warn(`[escalation] digest send failed for tenant ${tenantId}: ${(e as Error).message}`);
  }
}

function scheduleFlush(tenantId: number) {
  if (flushTimers.has(tenantId)) return; // timer already armed
  const t = setTimeout(() => {
    flushTenantDigest(tenantId).catch((e) => {
      console.warn(`[escalation] flush error: ${(e as Error).message}`);
    });
  }, BATCH_WINDOW_MS);
  // Don't keep the process alive just for a pending digest.
  if (typeof (t as any).unref === "function") (t as any).unref();
  flushTimers.set(tenantId, t);
}

export async function escalateHITL(input: EscalateInput): Promise<void> {
  // SSE notification fires immediately — no batching for in-app/UI events.
  emit({
    type: "hitl:pending",
    payload: {
      tenantId: input.tenantId,
      confirmationId: input.confirmationId,
      toolName: input.toolName,
      action: input.action,
      conversationId: input.conversationId,
      summary: summarizeArgs(input.args),
      createdAt: Date.now(),
    },
  });

  // Email path: queue into the per-tenant digest.
  if (queuedConfirmationIds.has(input.confirmationId)) return; // already queued, no double-add
  queuedConfirmationIds.add(input.confirmationId);

  let queue = pendingByTenant.get(input.tenantId);
  if (!queue) {
    queue = [];
    pendingByTenant.set(input.tenantId, queue);
  }

  // Build approve/deny links once at queue time so the digest can render them.
  const { approveUrl, denyUrl } = buildHitlLinks(input.confirmationId, input.tenantId);
  queue.push({ input, approveUrl, denyUrl, queuedAt: Date.now() });

  // Safety cap: if a runaway agent floods us with 100 escalations, flush early
  // so the digest doesn't grow unbounded in memory.
  if (queue.length >= MAX_BATCH_SIZE) {
    const existing = flushTimers.get(input.tenantId);
    if (existing) { clearTimeout(existing); flushTimers.delete(input.tenantId); }
    flushTenantDigest(input.tenantId).catch((e) => {
      console.warn(`[escalation] early-flush error: ${(e as Error).message}`);
    });
    return;
  }

  scheduleFlush(input.tenantId);
}

// Test-only hook so unit tests can force a flush without waiting 30s.
export async function _flushAllForTests(): Promise<void> {
  for (const t of Array.from(flushTimers.values())) clearTimeout(t);
  flushTimers.clear();
  const tenantIds = Array.from(pendingByTenant.keys());
  for (const tid of tenantIds) await flushTenantDigest(tid);
}
