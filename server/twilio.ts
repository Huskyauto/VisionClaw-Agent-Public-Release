// Twilio adapter — SMS + WhatsApp.
// Inbound webhooks: POST /api/hooks/twilio/sms and /api/hooks/twilio/whatsapp
// Outbound: sendTwilioMessage(to, text, "sms" | "whatsapp")
//
// Required env vars (set via Replit Secrets, never hard-coded):
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_PHONE_NUMBER          (E.164, e.g. +12245551234) — for SMS
//   TWILIO_WHATSAPP_NUMBER       (E.164, e.g. +14155238886) — for WhatsApp Business
//
// Inbound messages are routed into the same processMessage() chat engine as
// Telegram, so personas/tools work identically across channels.

import type { Express, Request, Response } from "express";

interface TwilioConfig { accountSid: string; authToken: string; smsFrom?: string; waFrom?: string; }

function getConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return {
    accountSid,
    authToken,
    smsFrom: process.env.TWILIO_PHONE_NUMBER,
    waFrom:  process.env.TWILIO_WHATSAPP_NUMBER,
  };
}

export function isTwilioConfigured(kind: "sms" | "whatsapp"): boolean {
  const c = getConfig();
  if (!c) return false;
  return kind === "sms" ? !!c.smsFrom : !!c.waFrom;
}

export async function getTwilioStatus(kind: "sms" | "whatsapp"): Promise<{ configured: boolean; status: string }> {
  const c = getConfig();
  if (!c) return { configured: false, status: "TWILIO_ACCOUNT_SID/AUTH_TOKEN not set" };
  const from = kind === "sms" ? c.smsFrom : c.waFrom;
  if (!from) return { configured: false, status: `TWILIO_${kind === "sms" ? "PHONE_NUMBER" : "WHATSAPP_NUMBER"} not set` };
  return { configured: true, status: `from ${from}` };
}

export async function sendTwilioMessage(to: string, text: string, kind: "sms" | "whatsapp"): Promise<{ success: boolean; channel: any; messageId?: string; error?: string }> {
  const c = getConfig();
  if (!c) return { success: false, channel: kind, error: "Twilio not configured (TWILIO_ACCOUNT_SID/AUTH_TOKEN missing)" };
  const from = kind === "sms" ? c.smsFrom : c.waFrom;
  if (!from) return { success: false, channel: kind, error: `Missing TWILIO_${kind === "sms" ? "PHONE_NUMBER" : "WHATSAPP_NUMBER"}` };

  const From = kind === "whatsapp" ? `whatsapp:${from}` : from;
  const To   = kind === "whatsapp" ? `whatsapp:${to}`   : to;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json`;
  const body = new URLSearchParams({ To, From, Body: text });

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) return { success: false, channel: kind, error: `Twilio ${resp.status}: ${data.message || resp.statusText}` };
    return { success: true, channel: kind, messageId: data.sid };
  } catch (e: any) {
    return { success: false, channel: kind, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Inbound: webhook handler. Twilio POSTs application/x-www-form-urlencoded
// with fields: From, To, Body, MessageSid, NumMedia, MediaUrl0..N, etc.
// ---------------------------------------------------------------------------

async function findOrCreateConversationForPhone(phone: string, channel: "sms" | "whatsapp"): Promise<{ conversationId: number; tenantId: number; userId?: number } | null> {
  // Look up by phone in user_devices / pairings. SECURITY: if no pairing
  // exists, return null and let the caller drop the message. We previously
  // fell back to tenant_id = 1 (the platform admin tenant), which meant
  // any unknown caller's traffic landed in the admin's conversation log —
  // a cross-tenant contamination + leak risk.
  const { db } = await import("./db");
  const { sql } = await import("drizzle-orm");

  // SECURITY: pairings live in agent_knowledge (category='messaging_pairing',
  // title='<channel>:<phone>'). That table is writable by any tenant-scoped
  // agent via the generic `create_knowledge` tool with an arbitrary
  // category/title. The lookup keys ONLY on the phone title (there is no
  // phone-ownership column), so a hostile tenant could plant a second,
  // internally-consistent pairing row for a victim's phone that points at its
  // OWN conversation. A naive "latest row wins" (ORDER BY id DESC LIMIT 1)
  // would then let the attacker's newer row hijack the victim's inbound
  // traffic into the attacker's tenant. We therefore (1) load ALL candidate
  // rows, (2) keep only those whose claimed conversation genuinely belongs to
  // the claimed tenant, and (3) FAIL CLOSED if two or more DISTINCT tenants
  // both hold an internally-consistent pairing for the same phone — an
  // ambiguous/contested phone is dropped rather than routed to a guessable
  // winner. Re-pairing within a single tenant (multiple rows, same tenant) is
  // fine: we pick that tenant's most recent row.
  const paired: any = await db.execute(sql`
    SELECT id, content::jsonb AS info
    FROM agent_knowledge
    WHERE category = 'messaging_pairing'
      AND title = ${`${channel}:${phone}`}
    ORDER BY id DESC
  `).catch(() => ({ rows: [] }));

  const verified: Array<{ conversationId: number; tenantId: number; userId?: number }> = [];
  for (const row of (paired.rows || [])) {
    const info = row?.info;
    if (!info?.conversationId || !info?.tenantId) continue;
    // Verify the conversationId in the pairing actually belongs to the claimed
    // tenantId — an internally-consistent pairing is the minimum bar.
    const convCheck: any = await db.execute(sql`
      SELECT tenant_id FROM conversations WHERE id = ${info.conversationId} LIMIT 1
    `).catch(() => ({ rows: [] }));
    const actualTenantId = convCheck.rows?.[0]?.tenant_id;
    if (actualTenantId !== info.tenantId) {
      console.warn(`[twilio] pairing trust check failed for ${channel}:${phone} — pairing claims tenant ${info.tenantId} but conversation ${info.conversationId} belongs to ${actualTenantId ?? 'nothing'}; skipping row`);
      continue;
    }
    verified.push(info);
  }

  if (verified.length === 0) return null;

  const distinctTenants = new Set(verified.map((v) => v.tenantId));
  if (distinctTenants.size > 1) {
    console.warn(`[twilio] AMBIGUOUS pairing for ${channel}:${phone} — ${distinctTenants.size} distinct tenants (${[...distinctTenants].join(', ')}) each hold a valid pairing; dropping to prevent cross-tenant hijack`);
    return null;
  }

  // Single owning tenant — return its most recent pairing (rows are id DESC).
  return verified[0];
}

// Validate Twilio's X-Twilio-Signature header per
// https://www.twilio.com/docs/usage/security#validating-requests
// Returns true if valid OR if running without auth token (dev mode).
async function verifyTwilioSignature(req: Request): Promise<boolean> {
  const c = getConfig();
  // SECURITY: if Twilio is not configured we cannot verify — REJECT the
  // request rather than pass through. Otherwise an attacker could POST to
  // the webhook URL and cause us to spawn conversations / consume LLM
  // credits before discovering we have no auth token to verify with.
  if (!c) return false;
  // R77.7: TWILIO_SKIP_SIGNATURE is a dev-only escape hatch. If accidentally
  // set in production it would let anyone POST forged SMS/WhatsApp into the
  // chat engine. Refuse to honor the flag when NODE_ENV=production.
  if (process.env.TWILIO_SKIP_SIGNATURE === "1") {
    if (process.env.NODE_ENV === "production") {
      console.error("[twilio] TWILIO_SKIP_SIGNATURE=1 ignored in production — set NODE_ENV!=production for dev override");
    } else {
      return true;
    }
  }
  const sig = String(req.header("X-Twilio-Signature") || "");
  if (!sig) return false;
  const proto = req.header("X-Forwarded-Proto") || req.protocol || "https";
  const host  = req.header("X-Forwarded-Host")  || req.get("host");
  const url   = `${proto}://${host}${req.originalUrl}`;
  const params = req.body || {};
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + String(params[k] ?? "");
  const crypto = await import("crypto");
  const expected = crypto.createHmac("sha1", c.authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  try {
    const a = Buffer.from(sig); const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

// Tiny in-memory rate limiter — protect webhook from flood.
const _rl = new Map<string, { c: number; t: number }>();
function rateLimitOk(key: string, perMin = 30): boolean {
  const now = Date.now();
  const cur = _rl.get(key);
  if (!cur || now - cur.t > 60_000) { _rl.set(key, { c: 1, t: now }); return true; }
  cur.c++; if (cur.c > perMin) return false;
  return true;
}

// Replay dedupe — Twilio retries webhooks on slow/failed responses, and a
// captured request can be replayed within the signature's validity (the
// HMAC covers the body, so an identical replay verifies). Track recently
// seen MessageSids in a TTL cache and drop duplicates (post-edit-code-review
// MEDIUM, 2026-07-08). In-memory is proportionate: a process restart only
// shrinks the window, and Twilio's own retry window is minutes, not hours.
const _seenSids = new Map<string, number>();
const SID_TTL_MS = 10 * 60_000;
function isReplayedSid(sid: string): boolean {
  const now = Date.now();
  if (_seenSids.size > 5000) {
    for (const [k, t] of _seenSids) if (now - t > SID_TTL_MS) _seenSids.delete(k);
  }
  const seen = _seenSids.get(sid);
  if (seen !== undefined && now - seen <= SID_TTL_MS) return true;
  _seenSids.set(sid, now);
  return false;
}

export function registerTwilioRoutes(app: Express) {
  const handler = (kind: "sms" | "whatsapp") => async (req: Request, res: Response) => {
    try {
      if (!(await verifyTwilioSignature(req))) {
        console.warn(`[twilio:${kind}] signature verification failed from ${req.ip}`);
        res.status(403).send("invalid signature");
        return;
      }
      const from = String(req.body?.From || "").replace(/^whatsapp:/, "");
      const text = String(req.body?.Body || "").trim();
      if (!from || !text) { res.type("text/xml").send("<Response/>"); return; }
      const messageSid = String(req.body?.MessageSid || req.body?.SmsMessageSid || "");
      if (messageSid && isReplayedSid(`${kind}:${messageSid}`)) {
        console.warn(`[twilio:${kind}] duplicate MessageSid ${messageSid} — replay/retry dropped`);
        res.type("text/xml").send("<Response/>");
        return;
      }
      if (!rateLimitOk(`${kind}:${from}`)) {
        console.warn(`[twilio:${kind}] rate limit exceeded for ${from}`);
        res.type("text/xml").send("<Response/>");
        return;
      }

      const pairing = await findOrCreateConversationForPhone(from, kind);
      if (!pairing) {
        // Unpaired number — drop silently rather than route to admin tenant.
        // To opt a number in, an authenticated user must POST a pairing record
        // to agent_knowledge with category='messaging_pairing'.
        console.warn(`[twilio:${kind}] dropping inbound from unpaired number ${from}`);
        res.type("text/xml").send("<Response/>");
        return;
      }
      const { conversationId, tenantId } = pairing;

      // Fire-and-forget — Twilio expects fast TwiML response. The reply will
      // be delivered asynchronously back to the user via sendTwilioMessage.
      (async () => {
        try {
          const { processMessage } = await import("./chat-engine");
          const result: any = await processMessage(conversationId, text, { source: kind, tenantId: tenantId } as any);
          const reply = String(result?.response || result?.message || "").trim();
          if (reply) await sendTwilioMessage(from, reply.slice(0, 1500), kind);
        } catch (e) {
          console.error(`[twilio:${kind}] inbound processing failed:`, e);
          await sendTwilioMessage(from, "Sorry — I hit an error processing that. Try again in a moment.", kind).catch(() => {});
        }
      })();

      // TwiML empty response — we'll send the reply out-of-band.
      res.type("text/xml").send("<Response/>");
    } catch (e: any) {
      console.error(`[twilio:${kind}] webhook error:`, e);
      res.status(500).send("error");
    }
  };

  app.post("/api/hooks/twilio/sms",      handler("sms"));
  app.post("/api/hooks/twilio/whatsapp", handler("whatsapp"));
  console.log("[twilio] webhook routes registered: /api/hooks/twilio/sms, /api/hooks/twilio/whatsapp");
}
