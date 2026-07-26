import { AgentMailClient } from "agentmail";
import { db } from "./db";
import { tenants } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY;
const PRIMARY_INBOX = process.env.AGENTMAIL_INBOX || "your-inbox@agentmail.to";
const PRIMARY_USERNAME = process.env.AGENTMAIL_USERNAME || "agent";

let client: AgentMailClient | null = null;
let primaryInboxId: string | null = null;

function getClient(): AgentMailClient {
  if (!client) {
    if (!AGENTMAIL_API_KEY) {
      throw new Error("AGENTMAIL_API_KEY not configured");
    }
    client = new AgentMailClient({ apiKey: AGENTMAIL_API_KEY });
  }
  return client;
}

export function isEmailConfigured(): boolean {
  return !!AGENTMAIL_API_KEY;
}

export async function listInboxes() {
  const c = getClient();
  const result = await c.inboxes.list();
  return result.inboxes || [];
}

export async function getPrimaryInboxId(): Promise<string> {
  if (primaryInboxId) return primaryInboxId;

  const c = getClient();
  const inboxes = await listInboxes();
  const existing = inboxes.find((i: any) =>
    i.email === PRIMARY_INBOX || i.inboxId === PRIMARY_INBOX ||
    i.inbox_id === PRIMARY_INBOX || (i as any).username === PRIMARY_USERNAME
  );

  if (existing) {
    primaryInboxId = (existing as any).inboxId || (existing as any).inbox_id;
    return primaryInboxId!;
  }

  try {
    const inbox = await c.inboxes.create({
      username: PRIMARY_USERNAME,
      displayName: `${process.env.SITE_PLATFORM_NAME || "VisionClaw"} AI`,
      clientId: `${PRIMARY_USERNAME}-primary-inbox`,
    });
    primaryInboxId = (inbox as any).inboxId || (inbox as any).inbox_id;
    return primaryInboxId!;
  } catch (err: any) {
    if (err.message?.includes("AlreadyExists") || err.status === 403) {
      const retryInboxes = await listInboxes();
      const found = retryInboxes.find((i: any) =>
        i.email === PRIMARY_INBOX || (i as any).username === PRIMARY_USERNAME
      );
      if (found) {
        primaryInboxId = (found as any).inboxId || (found as any).inbox_id;
        return primaryInboxId!;
      }
    }
    throw err;
  }
}

export function getTenantVirtualEmail(tenantId: number): string {
  if (tenantId === 1) return PRIMARY_INBOX;
  return `${PRIMARY_USERNAME}+t${tenantId}@agentmail.to`;
}

function extractTenantIdFromAddress(address: string): number | null {
  const usernameEscaped = PRIMARY_USERNAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = address.match(new RegExp(`${usernameEscaped}\\+t(\\d+)@`, 'i'));
  if (match) return parseInt(match[1], 10);
  if (PRIMARY_INBOX && address.includes(PRIMARY_INBOX)) return 1;
  return null;
}

export async function getOrCreateTenantInbox(tenantId: number): Promise<{ inboxId: string; email: string }> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw new Error("Tenant not found");

  if (tenant.agentmailEmail) {
    const inboxId = await getPrimaryInboxId();
    return { inboxId, email: tenant.agentmailEmail };
  }

  const inboxId = await getPrimaryInboxId();
  const virtualEmail = getTenantVirtualEmail(tenantId);

  await db.update(tenants).set({
    agentmailInboxId: inboxId,
    agentmailEmail: virtualEmail,
  }).where(eq(tenants.id, tenantId));

  console.log(`[email] Assigned virtual inbox to tenant ${tenantId}: ${virtualEmail}`);
  return { inboxId, email: virtualEmail };
}

export async function provisionAllTenantInboxes(): Promise<void> {
  if (!isEmailConfigured()) return;
  try {
    const inboxId = await getPrimaryInboxId();
    const allTenants = await db.select().from(tenants);
    let provisioned = 0;

    for (const t of allTenants) {
      if (t.agentmailEmail) continue;
      const virtualEmail = getTenantVirtualEmail(t.id);
      await db.update(tenants).set({
        agentmailInboxId: inboxId,
        agentmailEmail: virtualEmail,
      }).where(eq(tenants.id, t.id));
      console.log(`[email] Assigned virtual inbox to tenant ${t.id} (${t.name}): ${virtualEmail}`);
      provisioned++;
    }

    if (provisioned > 0) {
      console.log(`[email] Provisioned ${provisioned} tenant virtual inboxes`);
    } else {
      console.log(`[email] All tenants already have virtual inboxes`);
    }
  } catch (err: any) {
    console.warn(`[email] provisionAllTenantInboxes error: ${err.message}`);
  }
}

export async function listMessages(inboxId: string, limit = 20, pageToken?: string) {
  const c = getClient();
  const params: any = { limit };
  if (pageToken) params.pageToken = pageToken;
  const result = await c.inboxes.messages.list(inboxId, params);
  return result;
}

export async function getMessage(inboxId: string, messageId: string) {
  const c = getClient();
  const msg = await c.inboxes.messages.get(inboxId, messageId);
  return msg;
}

// Internal direct-send used by the digest flusher itself. Bypasses the
// owner-digest gate (otherwise the digest email would be queued forever)
// but still goes through the bounce gate, R95 outbound redaction and
// retry logic below.
export async function sendEmailDirect(params: {
  to: string;
  subject: string;
  text?: string;
  body?: string;
  html?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
}) {
  return sendEmailInternal({ ...params, inboxId: "", _bypassOwnerDigest: true } as any);
}

export async function sendEmail(params: {
  inboxId: string;
  to: string;
  subject: string;
  text?: string;
  body?: string;
  html?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
}) {
  return sendEmailInternal(params as any);
}

async function sendEmailInternal(params: {
  inboxId: string;
  to: string;
  subject: string;
  text?: string;
  body?: string;
  html?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  _bypassOwnerDigest?: boolean;
}) {
  // R103 — Owner email digest gate. Bob asked: "300 emails in a week is
  // too much, once a day give me your report that's it shut everything
  // else down". Every script and route flows through sendEmail, so the
  // gate lives here. Customer-facing transactional sends (any non-owner
  // recipient in to/cc/bcc) pass through unchanged.
  if (!params._bypassOwnerDigest) {
    try {
      const { maybeQueueOwnerEmail, flushIfDue } = await import("./owner-email-digest");
      const gate = maybeQueueOwnerEmail({
        to: params.to, cc: params.cc, bcc: params.bcc,
        subject: params.subject, text: params.text || params.body, html: params.html,
      });
      // Opportunistic flush — if 24h have rolled over, this call will send
      // the digest now. Fire-and-forget so we don't block the hot path.
      flushIfDue().catch((e) => console.warn(`[email] digest flush error: ${e?.message}`, e?.stack || e));
      if (gate.action === "queued") {
        return { queued: true, owner_digest_pending: gate.queuedCount } as any;
      }
      if (gate.action === "silenced") {
        return { silenced: true } as any;
      }
    } catch (e: any) {
      console.warn(`[email] owner-digest gate error (failing open): ${e?.message}`);
    }
  }

  const c = getClient();
  const actualInboxId = await getPrimaryInboxId();
  const bodyText = params.text || params.body || "";
  if (!bodyText && !params.html) {
    console.warn(`[email] WARNING: sendEmail called with empty body. to=${params.to}, subject=${params.subject}`);
  }

  // R98.25 — Pre-flight blocklist for known-bouncing recipients. SES hard-bounces
  // these → 403 MessageRejectedError → tool_drift counter pollution and a noisy
  // "send_email 86% fail rate" weekly-maintenance warning that's actually one
  // dead address being retried by a stale Felix test workflow. Refuse cheaply
  // before the API call. Override list via EMAIL_BOUNCED_RECIPIENTS (CSV).
  // R98.25 +sec — Architect HIGH: original gate only checked params.to so a
  // caller could trivially bypass by stuffing the dead address into cc/bcc/
  // replyTo. Now normalizes ALL recipient channels (handles "a@b, c@d" CSV
  // strings, arrays of strings, and arrays of {email}/{address} objects, same
  // shape policy-engine.ts:normalizeRecipients accepts) and rejects on first
  // hit. replyTo is included because SES will still bounce undeliverable
  // reply-to addresses on auto-replies.
  const BOUNCED_DEFAULT = new Set(["admin@visionclaw.ai"]);
  const bouncedExtra = String(process.env.EMAIL_BOUNCED_RECIPIENTS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bouncedSet = new Set([...BOUNCED_DEFAULT, ...bouncedExtra]);
  const collectRecipients = (field: unknown): string[] => {
    if (field == null) return [];
    const out: string[] = [];
    const push = (s: unknown) => {
      if (typeof s === "string") {
        for (const piece of s.split(/[,;]/)) {
          const v = piece.trim().toLowerCase();
          if (v) out.push(v);
        }
      } else if (s && typeof s === "object") {
        const e = (s as any).email || (s as any).address;
        if (typeof e === "string") push(e);
      }
    };
    if (Array.isArray(field)) field.forEach(push); else push(field);
    return out;
  };
  const allRecipients = [
    ...collectRecipients(params.to),
    ...collectRecipients(params.cc),
    ...collectRecipients(params.bcc),
    ...collectRecipients(params.replyTo),
  ];
  const blocked = allRecipients.find((r) => bouncedSet.has(r));
  if (blocked) {
    const msg = `Email refused by R98.25 bouncing-recipient gate: "${blocked}" (in to/cc/bcc/replyTo) is on the SES hard-bounce list. Update the caller to use a deliverable address or remove from EMAIL_BOUNCED_RECIPIENTS if the address has been re-verified at the provider.`;
    console.warn(`[email] ${msg}`);
    throw new Error(msg);
  }

  // R95.c — Provider-level outbound gate. Centralizing here covers every
  // sendEmail callsite (routes.ts, tools.ts, sales/marketing flows, etc.)
  // without per-callsite wiring. Subject + text + html are all scanned;
  // if any is blocked, the entire send is refused.
  const { enforceOutbound } = await import("./lib/outbound-redaction");
  const subjectGate = enforceOutbound(params.subject || "", { surface: "email:subject" });
  if (!subjectGate.ok) throw new Error(`Email send refused by R95 (subject): ${subjectGate.error}`);
  const textGate = enforceOutbound(bodyText, { surface: "email:text" });
  if (!textGate.ok) throw new Error(`Email send refused by R95 (text): ${textGate.error}`);
  let safeHtml: string | undefined = undefined;
  if (params.html) {
    const htmlGate = enforceOutbound(params.html, { surface: "email:html" });
    if (!htmlGate.ok) throw new Error(`Email send refused by R95 (html): ${htmlGate.error}`);
    safeHtml = htmlGate.payload;
  }

  const sendParams: any = {
    to: params.to,
    subject: subjectGate.payload,
    text: textGate.payload,
  };
  if (safeHtml) sendParams.html = safeHtml;
  // Action Ledger S4 — when this send runs under a ledgered tool dispatch
  // (ALS context set only by the S2 middleware after a successful prepare
  // write; unforgeable), stamp the attempt's idempotency key as an outbound
  // header. The sent-mail verify probe (action-ledger-probes.ts) later scans
  // the provider's message list for this header — positive provider-side
  // proof of commit, mirroring Stripe's event.request.idempotency_key.
  // Absent context (digest flush, scripts, routes) sends are unchanged.
  try {
    const { getCurrentLedgerAttempt } = await import("./lib/action-ledger-context");
    const ledgerAttempt = getCurrentLedgerAttempt();
    if (ledgerAttempt?.idempotencyKey) {
      sendParams.headers = { "X-VC-Ledger-Key": ledgerAttempt.idempotencyKey };
    }
  } catch (e: any) {
    // Advisory stamp only — never block a send on ledger plumbing.
    console.warn(`[email] ledger-key header stamp skipped: ${e?.message || e}`);
  }
  if (params.cc) sendParams.cc = params.cc;
  if (params.bcc) sendParams.bcc = params.bcc;
  if (params.replyTo) sendParams.replyTo = params.replyTo;

  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await c.inboxes.messages.send(actualInboxId, sendParams);
      return result;
    } catch (err: any) {
      const isRetryable = !err.status || err.status >= 500 || err.status === 429;
      if (attempt < MAX_RETRIES && isRetryable) {
        console.warn(`[email] Send attempt ${attempt}/${MAX_RETRIES} failed (${err.message}), retrying in ${RETRY_DELAY}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY * attempt));
      } else {
        throw err;
      }
    }
  }
}

export async function replyToEmail(params: {
  inboxId: string;
  messageId: string;
  text: string;
  html?: string;
}) {
  const c = getClient();
  const actualInboxId = await getPrimaryInboxId();
  const replyParams: any = {
    text: params.text,
  };
  if (params.html) replyParams.html = params.html;

  const result = await c.inboxes.messages.reply(actualInboxId, params.messageId, replyParams);
  return result;
}

let pollInterval: ReturnType<typeof setInterval> | null = null;

export function startInboxPolling(intervalMs = 120000): void {
  if (!isEmailConfigured()) return;
  if (pollInterval) return;

  async function pollSharedInbox() {
    try {
      const inboxId = await getPrimaryInboxId();
      const result = await listMessages(inboxId, 50);
      const msgs = (result as any).messages || [];
      let stored = 0;

      for (const m of msgs) {
        const msgId = m.messageId || m.message_id || m.id;
        if (!msgId) continue;

        const existing = await db.execute(
          sql`SELECT id FROM inbox_messages WHERE message_id = ${msgId} LIMIT 1`
        );
        const alreadyStored = ((existing as any).rows || existing)?.[0];
        if (alreadyStored) continue;

        const msgFrom = typeof m.from === "string" ? m.from :
          (typeof m.from?.[0] === "object" ? (m.from[0].address || m.from[0].email || "") : (m.from?.[0] || ""));
        const usernamePattern = PRIMARY_USERNAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const direction = new RegExp(`${usernamePattern}(\\+t\\d+)?@agentmail\\.to`, 'i').test(msgFrom) ? "outbound" : "inbound";

        let fullMsg = m;
        try {
          const detail = await getMessage(inboxId, msgId);
          fullMsg = { ...m, ...detail };
        } catch (fetchErr: any) {
          console.warn(`[email-poll] Could not fetch full message ${msgId}: ${fetchErr.message}`);
        }

        const res = await storeEmail({
          ...fullMsg,
          messageId: msgId,
          inboxId,
          direction,
        });
        if (res.isNew) stored++;
      }

      if (stored > 0) {
        console.log(`[email-poll] Stored ${stored} new messages from shared inbox`);
      }
    } catch (err: any) {
      console.warn(`[email-poll] Poll cycle error: ${err.message}`);
    }
  }

  pollSharedInbox();
  pollInterval = setInterval(pollSharedInbox, intervalMs);
  console.log(`[email-poll] Shared inbox polling started (every ${intervalMs / 1000}s)`);
}

export async function backfillEmptyBodies(): Promise<void> {
  if (!isEmailConfigured()) return;
  try {
    const inboxId = await getPrimaryInboxId();
    const result = await db.execute(
      sql`SELECT id, message_id FROM inbox_messages WHERE (body_text IS NULL OR body_text = '') AND (body_html IS NULL OR body_html = '') ORDER BY id`
    );
    const rows = ((result as any).rows || result) || [];
    if (rows.length === 0) return;
    console.log(`[email-backfill] Found ${rows.length} emails with empty bodies, fetching content...`);
    let filled = 0;
    for (const row of rows) {
      try {
        const detail = await getMessage(inboxId, row.message_id);
        const bodyText = (detail as any).text || (detail as any).extractedText || (detail as any).body || "";
        const bodyHtml = (detail as any).html || "";
        if (bodyText || bodyHtml) {
          await db.execute(
            sql`UPDATE inbox_messages SET body_text = ${bodyText}, body_html = ${bodyHtml} WHERE id = ${row.id}`
          );
          filled++;
        }
      } catch (err: any) {
        if (!err.message?.includes("not found")) {
          console.warn(`[email-backfill] Failed to fetch message ${row.message_id}: ${err.message}`);
        }
      }
    }
    console.log(`[email-backfill] Filled content for ${filled}/${rows.length} emails`);
  } catch (err: any) {
    console.warn(`[email-backfill] Error: ${err.message}`);
  }
}

export function stopInboxPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log("[email-poll] Inbox polling stopped");
  }
}

export async function storeEmail(payload: any): Promise<{ id: number; isNew: boolean }> {
  const messageId = payload.messageId || payload.message_id || payload.id || "";
  const inboxId = payload.inboxId || payload.inbox_id || "";
  const from = typeof payload.from === "string" ? payload.from :
    (typeof payload.from?.[0] === "object" ? (payload.from[0].address || payload.from[0].email || JSON.stringify(payload.from[0])) : (payload.from?.[0] || ""));
  const rawToEntry = typeof payload.to === "string" ? payload.to : payload.to?.[0];
  const rawTo = typeof rawToEntry === "string" ? rawToEntry :
    (typeof rawToEntry === "object" ? (rawToEntry?.address || rawToEntry?.email || "") : "");
  const subject = payload.subject || "(No Subject)";
  const bodyText = payload.text || payload.extractedText || payload.body || "";
  const bodyHtml = payload.html || "";
  const threadId = payload.threadId || payload.thread_id || null;
  const receivedAt = payload.receivedAt || payload.received_at || payload.createdAt || payload.created_at || new Date().toISOString();
  const direction = payload.direction || "inbound";

  let tenantId: number | null = null;

  if (direction === "outbound") {
    tenantId = extractTenantIdFromAddress(from);
    if (!tenantId) {
      const fromEmail = from.match(/<([^>]+)>/)?.[1] || from;
      try {
        const rows = await db.execute(
          sql`SELECT id FROM tenants WHERE agentmail_inbox_id = ${fromEmail} OR agentmail_email = ${fromEmail} LIMIT 1`
        );
        const found = ((rows as any).rows || rows)?.[0];
        if (found) tenantId = found.id;
      } catch (err: any) {
        console.error(`[email] Tenant lookup failed for outbound from=${from}: ${err.message}`);
      }
    }
    if (!tenantId) {
      // R74 SECURITY: fail-closed instead of defaulting to admin tenant 1.
      // The previous fallback caused cross-tenant data contamination — any
      // outbound email whose `from` address didn't match a known
      // agentmail_inbox_id / agentmail_email would land in tenant 1's
      // inbox_messages, leaking into the admin's view. Now we drop the
      // message with a high-priority log instead. Code-review FAIL fix.
      console.error(`[email] SECURITY: refusing to store outbound email — tenant unresolved. from=${from} to=${rawTo} subject="${subject}" message_id=${messageId}`);
      return { id: 0, isNew: false };
    }
  } else {
    tenantId = extractTenantIdFromAddress(rawTo);
    if (!tenantId) {
      try {
        const rows = await db.execute(
          sql`SELECT id FROM tenants WHERE agentmail_email = ${rawTo} LIMIT 1`
        );
        const found = ((rows as any).rows || rows)?.[0];
        if (found) tenantId = found.id;
      } catch (err: any) {
        console.error(`[email] Tenant lookup failed for inbound to=${rawTo}: ${err.message}`);
      }
    }
    if (!tenantId) {
      // R74 SECURITY: fail-closed instead of defaulting to admin tenant 1.
      // Previous fallback caused inbound emails addressed to unknown/typo'd
      // recipients to land in admin tenant 1 — direct cross-tenant leak.
      // Now we drop the message with a high-priority log. Code-review FAIL fix.
      console.error(`[email] SECURITY: refusing to store inbound email — tenant unresolved. from=${from} to=${rawTo} subject="${subject}" message_id=${messageId}`);
      return { id: 0, isNew: false };
    }
  }

  // R104 — Inbox quarantine: inbound messages from unknown senders are
  // stored but flagged quarantined=true, preventing them from auto-feeding
  // personas as untrusted prompt-injection vectors. Owner addresses, prior
  // correspondents (we replied to them before), and explicit allowlist
  // entries are auto-approved. Operators triage via inbox_sender_approve /
  // inbox_quarantine_list tools.
  let quarantined = false;
  if (direction === "inbound") {
    try {
      const { isSenderApproved, touchLastSeen } = await import("./inbox-quarantine");
      const verdict = await isSenderApproved(tenantId, from);
      quarantined = !verdict.approved;
      if (quarantined) {
        console.warn(`[inbox-quarantine] holding inbound msg from "${from}" (reason=${verdict.reason}) tenant=${tenantId}`);
      } else {
        await touchLastSeen(tenantId, from);
      }
    } catch (e: any) {
      console.warn(`[inbox-quarantine] gate failed (fail-closed quarantining): ${e?.message || e}`);
      quarantined = true;
    }
  }

  try {
    const result = await db.execute(
      sql`INSERT INTO inbox_messages (tenant_id, message_id, inbox_id, from_address, to_address, subject, body_text, body_html, thread_id, received_at, direction, quarantined)
       VALUES (${tenantId}, ${messageId}, ${inboxId}, ${from}, ${rawTo}, ${subject}, ${bodyText}, ${bodyHtml}, ${threadId}, ${receivedAt}, ${direction}, ${quarantined})
       ON CONFLICT (message_id) DO NOTHING
       RETURNING id`
    );
    const inserted = ((result as any).rows || result)?.[0];
    if (inserted) {
      console.log(`[email] Stored ${direction}: id=${inserted.id} tenant=${tenantId} from=${from} to=${rawTo} subject="${subject}"${quarantined ? " QUARANTINED" : ""}`);
      return { id: inserted.id, isNew: true };
    }
    return { id: 0, isNew: false };
  } catch (err: any) {
    console.error(`[email] Failed to store email: ${err.message}`);
    throw err;
  }
}

export const storeIncomingEmail = storeEmail;

export { PRIMARY_INBOX };
