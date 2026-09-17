/**
 * R125+8 — Microsoft Outlook (read-only) via Replit Connectors proxy.
 *
 * Auth: `@replit/connectors-sdk` injects the OAuth token + handles refresh.
 * Scopes available on this connection (per Replit): Mail.Read, Mail.ReadBasic,
 * Mail.ReadWrite, Mail.Send, Calendars.Read*, Files.Read*, MailboxSettings.*,
 * User.Read. THIS LIB DELIBERATELY USES ONLY Mail.Read / Mail.ReadBasic —
 * Bob's R125+8 design call was "start read-only." Anything destructive
 * (send/delete/forward) is intentionally NOT exposed here.
 *
 * Tenant scope: the lib itself is pure (no tenant check). The tool-handler in
 * server/tools.ts gates on `_tenantId === ADMIN_TENANT_ID` and refuses for any
 * non-admin caller — this is Bob's personal mailbox; no multi-tenant exposure.
 *
 * Wrapping: every textual field from a remote message MUST be passed through
 * `wrapExternalContent` before re-injection into a prompt. Email bodies are a
 * canonical prompt-injection surface (anyone can email you). The lib here only
 * fetches + normalizes; wrapping is the handler's job.
 */

import { ReplitConnectors } from "@replit/connectors-sdk";
import { logSilentCatch } from "./silent-catch";

const connectors = new ReplitConnectors();

export interface OutlookMessageSummary {
  id: string;
  subject: string;
  from: { name?: string; address?: string };
  receivedDateTime: string;
  bodyPreview: string;
  isRead: boolean;
  hasAttachments: boolean;
  webLink?: string;
}

export interface OutlookMessageFull extends OutlookMessageSummary {
  to: Array<{ name?: string; address?: string }>;
  cc: Array<{ name?: string; address?: string }>;
  bodyContentType: "text" | "html";
  body: string;
  conversationId?: string;
  internetMessageId?: string;
}

function normRecipient(r: any): { name?: string; address?: string } {
  const ea = r?.emailAddress || {};
  return { name: ea.name || undefined, address: ea.address || undefined };
}

function summarize(m: any): OutlookMessageSummary {
  return {
    id: String(m.id || ""),
    subject: String(m.subject || ""),
    from: normRecipient(m.from),
    receivedDateTime: String(m.receivedDateTime || ""),
    bodyPreview: String(m.bodyPreview || ""),
    isRead: !!m.isRead,
    hasAttachments: !!m.hasAttachments,
    webLink: m.webLink || undefined,
  };
}

async function graphGet(path: string): Promise<any> {
  const resp = await connectors.proxy("outlook", path, { method: "GET" });
  if (!resp.ok) {
    let detail = "";
    try { detail = await resp.text(); } catch (_silentErr) { logSilentCatch("server/lib/outlook.ts", _silentErr); }
    throw new Error(`Outlook Graph ${resp.status}: ${detail.slice(0, 300)}`);
  }
  return resp.json();
}

/**
 * List inbox messages, newest first. Optional sender / date / unread filters.
 * Graph $filter uses OData; we build it server-side from typed params.
 */
export async function listInboxMessages(opts: {
  top?: number;
  fromAddress?: string;
  unreadOnly?: boolean;
  sinceISO?: string;
  untilISO?: string;
} = {}): Promise<{ count: number; messages: OutlookMessageSummary[] }> {
  const top = Math.min(Math.max(opts.top ?? 25, 1), 100);
  const filters: string[] = [];
  if (opts.fromAddress) {
    const addr = opts.fromAddress.replace(/'/g, "''").toLowerCase();
    filters.push(`from/emailAddress/address eq '${addr}'`);
  }
  if (opts.unreadOnly) filters.push(`isRead eq false`);
  if (opts.sinceISO) filters.push(`receivedDateTime ge ${opts.sinceISO}`);
  if (opts.untilISO) filters.push(`receivedDateTime le ${opts.untilISO}`);
  const q = new URLSearchParams();
  q.set("$top", String(top));
  q.set("$orderby", "receivedDateTime desc");
  q.set("$select", "id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments,webLink");
  if (filters.length > 0) q.set("$filter", filters.join(" and "));
  const data = await graphGet(`/v1.0/me/mailFolders/inbox/messages?${q.toString()}`);
  const messages = Array.isArray(data.value) ? data.value.map(summarize) : [];
  return { count: messages.length, messages };
}

/**
 * Full-text search across mail (Graph $search). Searches subject + body + from.
 * Note: $search uses KQL and cannot be combined with $orderby on receivedDateTime.
 */
export async function searchMessages(query: string, top = 25): Promise<{ count: number; messages: OutlookMessageSummary[] }> {
  const t = Math.min(Math.max(top, 1), 100);
  const q = new URLSearchParams();
  q.set("$top", String(t));
  q.set("$select", "id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments,webLink");
  q.set("$search", `"${query.replace(/"/g, "")}"`);
  const data = await graphGet(`/v1.0/me/messages?${q.toString()}`);
  const messages = Array.isArray(data.value) ? data.value.map(summarize) : [];
  return { count: messages.length, messages };
}

/**
 * Read a single message in full (body included). The body is the part that
 * MUST be wrapped via wrapExternalContent before the LLM sees it.
 */
export async function readMessage(messageId: string): Promise<OutlookMessageFull> {
  const id = String(messageId).trim();
  if (!id || !/^[A-Za-z0-9_=\-]+$/.test(id)) throw new Error("invalid messageId");
  const q = new URLSearchParams();
  q.set("$select", "id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,body,conversationId,internetMessageId,webLink");
  const m = await graphGet(`/v1.0/me/messages/${encodeURIComponent(id)}?${q.toString()}`);
  return {
    ...summarize(m),
    to: Array.isArray(m.toRecipients) ? m.toRecipients.map(normRecipient) : [],
    cc: Array.isArray(m.ccRecipients) ? m.ccRecipients.map(normRecipient) : [],
    bodyContentType: m.body?.contentType === "html" ? "html" : "text",
    body: String(m.body?.content || ""),
    conversationId: m.conversationId || undefined,
    internetMessageId: m.internetMessageId || undefined,
  };
}
