import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "./db";
import {
  conversations, instinctOutbox, instinctWebSubmissions, instinctWebThreads, messages, personas,
} from "@shared/schema";
import {
  createInstinctCsrfToken, getSession, loginOwnerPasswordForInstinct, revokeSession,
  verifyInstinctCsrfToken,
} from "./auth";
import { ownerTenantId } from "./agentic/autonomous-budget";
import { withTenantContext } from "./lib/tenant-context";
import { instinctLoginTenantId } from "./lib/instinct-login-binding";
import { dispatchApiV1Task, launchApiV1FollowUp } from "./api-v1-dispatch";
import {
  claimApiV1FollowUp, getApiV1TurnStatus, isApiV1Conversation,
} from "./spark-line";
import {
  acknowledgeInstinctFailureFromDesignatedLogin, instinctFailureExplanation,
  isDesignatedReviewableInstinctFailure, isRecoverableInstinctFailure, resumeInstinctFailedTurn,
} from "./lib/instinct-recovery";

export const INSTINCT_OPENING_TEXT =
  "This is Instinct Bot opening our private coordination thread. Please confirm receipt; do not spend, publish, contact anyone, or send an automatic outbox echo.";
const COOKIE = "instinct_session";
const LOGIN_CSRF_COOKIE = "instinct_login_csrf";
const MAX_MESSAGE = 16_000;
const PAGE_SIZE = 50;
const WAITING_TEXT = "Felix is working on your message. No additional permission is needed for ordinary conversation. Refresh status to read the reply when this turn completes; do not resend the message.";
const enabled = () => process.env.INSTINCT_LINE_ENABLED !== "0";
const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export const escapeInstinctHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export interface WebThread {
  tenantId: number; state: string; conversationId: number | null; statusUrl: string | null;
  previousConversationId?: number | null;
  createdAt: Date; updatedAt: Date;
}
export interface WebSubmission {
  id?: number; tenantId: number; conversationId: number | null; tokenHash: string;
  clientKey: string; message: string; state: string; requestId: string;
}
export interface InstinctWebPorts {
  getSession(token: string): Promise<{ tenantId: number; isAdmin: boolean } | null>;
  login(req: Request, email: string, password: string, loginTenantId: number): Promise<{ token?: string; error?: string }>;
  revoke(token: string): Promise<void>;
  getThread(tenantId: number): Promise<WebThread | undefined>;
  reserveOpening(tenantId: number, submission: WebSubmission): Promise<boolean>;
  reserveReplacement(tenantId: number, expectedConversationId: number, submission: WebSubmission): Promise<boolean>;
  findSubmission(tenantId: number, tokenHash: string): Promise<WebSubmission | undefined>;
  createSubmission(submission: WebSubmission): Promise<boolean>;
  bindOpening(tenantId: number, requestId: string, conversationId: number, statusUrl: string): Promise<void>;
  blockOpening(tenantId: number): Promise<void>;
  updateSubmission(tenantId: number, requestId: string, state: string, conversationId?: number): Promise<void>;
  hasUncertainSubmission(tenantId: number, conversationId: number): Promise<boolean>;
  getStatus(tenantId: number, conversationId: number): Promise<any>;
  resumeFailedTurn(tenantId: number, conversationId: number, failedAt: string, principalTenantId: number):
    Promise<"resumed" | "duplicate" | "blocked">;
  reviewUncertainFailedTurn(tenantId: number, conversationId: number, failedAt: string, principalTenantId: number):
    Promise<"resumed" | "duplicate" | "blocked">;
  history(tenantId: number, conversationId: number, before?: number): Promise<any[]>;
  isApiThread(tenantId: number, conversationId: number): Promise<boolean>;
  outbox(tenantId: number, before?: number): Promise<any[]>;
  dispatch(tenantId: number, task: string, agent: string, async: true,
    beforeLaunch: (d: { conversationId: number; statusUrl: string }) => Promise<void>):
    Promise<{ conversationId: number; statusUrl: string; turn: Promise<unknown> }>;
  claimFollowUp(tenantId: number, conversationId: number, clientKey: string, message: string, requestId: string):
    Promise<{ outcome: "claimed" | "duplicate" | "busy" | "mismatch"; requestId: string }>;
  launchFollowUp(tenantId: number, conversationId: number, message: string, settled: (state: "complete" | "failed") => Promise<void>): void;
}

const productionPorts: InstinctWebPorts = {
  getSession,
  login: loginOwnerPasswordForInstinct,
  revoke: revokeSession,
  async getThread(tenantId) {
    const rows = await db.select().from(instinctWebThreads).where(eq(instinctWebThreads.tenantId, tenantId)).limit(1);
    return rows[0] as WebThread | undefined;
  },
  async reserveOpening(tenantId, submission) {
    return db.transaction(async tx => {
      const rows = await tx.insert(instinctWebThreads).values({
        tenantId, state: "reserved", conversationId: null, statusUrl: null,
      }).onConflictDoNothing().returning({ tenantId: instinctWebThreads.tenantId });
      if (rows.length !== 1) return false;
      await tx.insert(instinctWebSubmissions).values(submission);
      return true;
    });
  },
  async reserveReplacement(tenantId, expectedConversationId, submission) {
    return db.transaction(async tx => {
      const rows = await tx.update(instinctWebThreads).set({
        previousConversationId: expectedConversationId, conversationId: null, statusUrl: null,
        state: "reserved", updatedAt: new Date(),
      }).where(and(eq(instinctWebThreads.tenantId, tenantId),
        eq(instinctWebThreads.state, "ready"), eq(instinctWebThreads.conversationId, expectedConversationId)))
        .returning({ tenantId: instinctWebThreads.tenantId });
      if (rows.length !== 1) return false;
      await tx.insert(instinctWebSubmissions).values(submission);
      return true;
    });
  },
  async findSubmission(tenantId, tokenHash) {
    const rows = await db.select().from(instinctWebSubmissions)
      .where(and(eq(instinctWebSubmissions.tenantId, tenantId), eq(instinctWebSubmissions.tokenHash, tokenHash))).limit(1);
    return rows[0] as WebSubmission | undefined;
  },
  async createSubmission(submission) {
    const rows = await db.insert(instinctWebSubmissions).values(submission)
      .onConflictDoNothing().returning({ id: instinctWebSubmissions.id });
    return rows.length === 1;
  },
  async bindOpening(tenantId, requestId, conversationId, statusUrl) {
    await db.transaction(async tx => {
      await tx.update(instinctWebThreads).set({
        state: "ready", conversationId, statusUrl, updatedAt: new Date(),
      }).where(eq(instinctWebThreads.tenantId, tenantId));
      await tx.update(instinctWebSubmissions).set({
        conversationId, state: "running", updatedAt: new Date(),
      }).where(and(eq(instinctWebSubmissions.tenantId, tenantId), eq(instinctWebSubmissions.requestId, requestId)));
    });
  },
  async blockOpening(tenantId) {
    await db.update(instinctWebThreads).set({ state: "blocked", updatedAt: new Date() })
      .where(and(eq(instinctWebThreads.tenantId, tenantId), eq(instinctWebThreads.state, "reserved")));
  },
  async updateSubmission(tenantId, requestId, state, conversationId) {
    await db.update(instinctWebSubmissions).set({
      state, updatedAt: new Date(), ...(conversationId ? { conversationId } : {}),
    }).where(and(eq(instinctWebSubmissions.tenantId, tenantId), eq(instinctWebSubmissions.requestId, requestId)));
  },
  async hasUncertainSubmission(tenantId, conversationId) {
    const rows = await db.select({ id: instinctWebSubmissions.id }).from(instinctWebSubmissions)
      .where(and(eq(instinctWebSubmissions.tenantId, tenantId),
        eq(instinctWebSubmissions.conversationId, conversationId),
        inArray(instinctWebSubmissions.state, ["accepted", "running"]))).limit(1);
    return rows.length > 0;
  },
  getStatus: getApiV1TurnStatus,
  resumeFailedTurn: resumeInstinctFailedTurn,
  reviewUncertainFailedTurn: (tenantId, conversationId, failedAt, principalTenantId) =>
    acknowledgeInstinctFailureFromDesignatedLogin(tenantId, principalTenantId, conversationId, failedAt),
  async history(tenantId, conversationId, before) {
    const rows = await db.select({
      id: messages.id, role: messages.role, content: messages.content, createdAt: messages.createdAt,
    }).from(messages).where(and(eq(messages.tenantId, tenantId), eq(messages.conversationId, conversationId),
      before ? lt(messages.id, before) : undefined)).orderBy(desc(messages.id)).limit(PAGE_SIZE);
    return rows.reverse();
  },
  isApiThread: isApiV1Conversation,
  async outbox(tenantId, before) {
    return db.select({
      id: instinctOutbox.id, message: instinctOutbox.message, personaId: instinctOutbox.personaId,
      personaName: personas.name, conversationId: instinctOutbox.conversationId, createdAt: instinctOutbox.createdAt,
    }).from(instinctOutbox).innerJoin(personas, eq(instinctOutbox.personaId, personas.id))
      .where(and(eq(instinctOutbox.tenantId, tenantId), before ? lt(instinctOutbox.id, before) : undefined))
      .orderBy(desc(instinctOutbox.id)).limit(PAGE_SIZE);
  },
  async dispatch(tenantId, task, agent, async, beforeLaunch) {
    if (!async) throw new Error("Instinct opening dispatch must be asynchronous");
    const result = await dispatchApiV1Task(tenantId, { task, agent, async, title: "Instinct private coordination thread" }, {
      instinctReadDraft: true,
      beforeLaunch: async d => beforeLaunch({ conversationId: d.conversationId, statusUrl: d.statusUrl }),
    });
    return result;
  },
  claimFollowUp: (tenantId, conversationId, clientKey, message, requestId) =>
    claimApiV1FollowUp(tenantId, conversationId, clientKey, message, requestId, true),
  launchFollowUp: (tenantId, conversationId, message, settled) =>
    launchApiV1FollowUp(tenantId, conversationId, message, { onSettled: settled, instinctReadDraft: true }),
};

function secureHeaders(res: Response) {
  // no-referrer makes Chromium's native form POSTs send Origin:null, which
  // originAllowed must reject. strict-origin preserves the same-origin header
  // while never sending URL paths/query strings in Referer (or HTTPS→HTTP).
  res.set({
    "Cache-Control": "no-store, private", "Pragma": "no-cache", "Referrer-Policy": "strict-origin",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
}
function page(res: Response, title: string, body: string, status = 200) {
  secureHeaders(res);
  res.status(status).type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeInstinctHtml(title)}</title><style>
    :root{font-family:system-ui,sans-serif;color:#17243c;background:#f5f7fb}
    body{margin:0;padding:clamp(1rem,4vw,3rem)}main{max-width:760px;margin:auto;background:white;padding:clamp(1.25rem,4vw,2.5rem);border:1px solid #dfe5ef;border-radius:12px;box-shadow:0 8px 28px #17243c0c}
    h1{font-size:1.6rem;margin:0 0 1.5rem}h2{font-size:1.05rem}p{line-height:1.55}form{margin:1.25rem 0}label{display:block;font-weight:600;margin:.75rem 0 .35rem}
    input:not([type=hidden]):not([type=checkbox]),textarea{display:block;box-sizing:border-box;width:100%;max-width:34rem;padding:.7rem;border:1px solid #aab7cc;border-radius:6px;font:inherit}
    textarea{min-height:7rem;max-width:100%}button{font:inherit;font-weight:600;background:#214ec2;color:white;border:0;border-radius:6px;padding:.7rem 1rem;margin-top:.8rem;cursor:pointer}
    button:hover,button:focus-visible{background:#173b98}a{color:#214ec2}article{border-top:1px solid #e0e5ed;padding:1rem 0}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}time{color:#55647b;font-size:.9rem}
  </style><body><main><h1>${escapeInstinctHtml(title)}</h1>${body}</main></body></html>`);
}
function cookieValue(req: Request, name: string) {
  const prefix = `${name}=`;
  for (const part of (req.headers.cookie || "").split(";")) {
    const item = part.trim();
    if (item.startsWith(prefix)) return item.slice(prefix.length);
  }
  return "";
}
function cookieSession(req: Request) {
  const token = cookieValue(req, COOKIE);
  return /^[a-f0-9]{64}$/.test(token) ? token : "";
}
function setCookie(res: Response, name: string, value: string, maxAge: number) {
  res.append("Set-Cookie", `${name}=${value}; Path=/instinct; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}
function clearCookie(res: Response, name: string) { setCookie(res, name, "", 0); }
function originAllowed(req: Request) {
  const origin = req.get("origin");
  // Some form-capable clients omit Origin. The signed CSRF token below still
  // requires the matching HttpOnly cookie (or session) on every POST. An
  // explicitly supplied, foreign or opaque Origin is never accepted.
  if (origin === undefined || origin === "") return true;
  // TLS terminates at Replit's ingress; Express may observe an HTTP socket
  // even when the real browser sent an HTTPS Origin. Never trust a caller's
  // X-Forwarded-Proto header to make the origin comparison.
  try {
    const actual = new URL(origin).origin;
    const host = req.get("host");
    if (!host) return false;
    if (actual === new URL(`https://${host}`).origin) return true;
    const hostname = new URL(`http://${host}`).hostname;
    return (hostname === "localhost" || hostname === "127.0.0.1") &&
      actual === new URL(`http://${host}`).origin;
  }
  catch { return false; }
}
// Explicit operator binding for THIS web channel only. Authentication remains
// a normal session for this account; owner-business reads/drafts use a separate
// server-owned resource scope. Never change the session or global owner id.
function invalidLoginBinding(res: Response) {
  return page(res, "Channel unavailable", "<p>The private channel's login-account configuration is invalid. Owner configuration is required.</p>", 503);
}
async function requireOwner(req: Request, res: Response, ports: InstinctWebPorts) {
  secureHeaders(res);
  const accountId = instinctLoginTenantId();
  if (accountId === null) {
    invalidLoginBinding(res);
    return null;
  }
  const token = cookieSession(req);
  const session = token ? await ports.getSession(token) : null;
  if (!session) {
    res.redirect(303, "/instinct/login");
    return null;
  }
  const tenantId = ownerTenantId();
  if (session.tenantId !== accountId) {
    page(res, "Forbidden", "<p>This private channel is restricted to the configured owner.</p>", 403);
    return null;
  }
  return { token, tenantId, principalTenantId: session.tenantId };
}
function loginCsrf(nonce: string) { return createInstinctCsrfToken(`login:${nonce}`); }
function formCsrf(sessionToken: string) { return createInstinctCsrfToken(`session:${sessionToken}`); }
function recoveryContext(token: string, conversationId: number, failedAt: string) {
  return `instinct-recovery:${token}:${conversationId}:${failedAt}`;
}
function parseBefore(req: Request, res: Response): number | undefined | null {
  const raw = req.query.before;
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    page(res, "Invalid page cursor", "<p>The page cursor must be a positive integer.</p>", 400);
    return null;
  }
  return Number(raw);
}
function validMessage(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= MAX_MESSAGE;
}
function logoutForm(token: string) {
  return `<form method="post" action="/instinct/logout"><input type="hidden" name="csrf" value="${formCsrf(token)}"><button type="submit">Sign out</button></form>`;
}
function loginForm(nonce: string, error = "", email = "") {
  return `<p>Use the VisionClaw account approved for this private channel. No API key is needed.</p>${error ? `<p role="alert">${escapeInstinctHtml(error)}</p>` : ""}<form method="post" action="/instinct/login"><input type="hidden" name="csrf" value="${loginCsrf(nonce)}"><label for="instinct-email">Email</label><input id="instinct-email" name="email" type="email" autocomplete="username" value="${escapeInstinctHtml(email)}" required><label for="instinct-password">Password</label><input id="instinct-password" name="password" type="password" autocomplete="current-password" required><button type="submit">Sign in</button></form>`;
}
async function renderChat(req: Request, res: Response, tenantId: number, token: string,
  ports: InstinctWebPorts, flash = "", input = "") {
  const before = parseBefore(req, res);
  if (before === null) return;
  if (!enabled()) return page(res, "Instinct chat disabled", "<p>Instinct web channel is disabled.</p><p><a href=\"/instinct/outbox\">Outbox</a></p>");
  const thread = await ports.getThread(tenantId);
  if (!thread) {
    const body = `<p>No thread has been opened.</p><form method="post" action="/instinct/chat"><input type="hidden" name="csrf" value="${formCsrf(token)}"><input type="hidden" name="action" value="open"><input type="hidden" name="submission" value="${crypto.randomBytes(32).toString("base64url")}"><p>Opening message: <q>${escapeInstinctHtml(INSTINCT_OPENING_TEXT)}</q></p><button type="submit">Open Felix thread</button></form>${logoutForm(token)}`;
    return page(res, "Felix · Instinct", `${flash}${body}`);
  }
  if (thread.state !== "ready" || !thread.conversationId) {
    return page(res, "Instinct thread blocked",
      `${flash}<p>Opening state: ${escapeInstinctHtml(thread.state)}. No automatic retry will occur; owner review is required.</p>${logoutForm(token)}`, 409);
  }
  if (!(await ports.isApiThread(tenantId, thread.conversationId))) {
    return page(res, "Instinct thread missing",
      `${flash}<p>Saved conversation ${thread.conversationId} is no longer a valid API-v1 thread. Previous conversation ${thread.previousConversationId ?? thread.conversationId} is retained for diagnosis.</p><form method="post" action="/instinct/chat"><input type="hidden" name="csrf" value="${formCsrf(token)}"><input type="hidden" name="action" value="replace"><input type="hidden" name="submission" value="${crypto.randomBytes(32).toString("base64url")}"><button type="submit">Explicitly open a replacement Felix thread</button></form>${logoutForm(token)}`, 503);
  }
  const [status, history, uncertainSubmission] = await Promise.all([
    ports.getStatus(tenantId, thread.conversationId),
    ports.history(tenantId, thread.conversationId, before),
    ports.hasUncertainSubmission(tenantId, thread.conversationId),
  ]);
  const state = status?.status || "unknown";
  const canSend = !uncertainSubmission && (state === "idle" || state === "complete");
  const failedAt = status?.failedAt ? new Date(status.failedAt).toISOString() : "";
  const recoveryArea = state === "failed"
    ? `<p role="alert">${escapeInstinctHtml(instinctFailureExplanation(status?.reason))}</p>${
      !uncertainSubmission && failedAt && isRecoverableInstinctFailure(status?.reason)
        ? `<p>No completed answer was saved. Earlier reads or private outbox writes may have happened; check the history and <a href="/instinct/outbox">outbox</a> first. Acknowledging this failure preserves the original request and only reopens conversation. It does not resend the request, complete it, or grant business-action permission.</p><form method="post" action="/instinct/chat"><input type="hidden" name="action" value="resume"><input type="hidden" name="csrf" value="${formCsrf(token)}"><input type="hidden" name="conversationId" value="${thread.conversationId}"><input type="hidden" name="failedAt" value="${escapeInstinctHtml(failedAt)}"><input type="hidden" name="recovery" value="${createInstinctCsrfToken(recoveryContext(token, thread.conversationId, failedAt))}"><label><input type="checkbox" name="acknowledge" value="yes" required> I reviewed the history and outbox. I understand the failed request will not be replayed.</label><button type="submit">Acknowledge failure and resume conversation</button></form>`
        : !uncertainSubmission && failedAt && isDesignatedReviewableInstinctFailure(status?.reason)
          ? `<p>This is a locally failed request, but its legacy/provider result may be uncertain. Review the saved request, history, and <a href="/instinct/outbox">outbox</a> before continuing. The remote request may still be billed, and partial work (including reads or private outbox writes) may already have happened. This acknowledgement only reopens conversation: it does not resend or complete the original request, release reservations, or grant business-action permission.</p><form method="post" action="/instinct/chat"><input type="hidden" name="action" value="review_uncertain"><input type="hidden" name="csrf" value="${formCsrf(token)}"><input type="hidden" name="conversationId" value="${thread.conversationId}"><input type="hidden" name="failedAt" value="${escapeInstinctHtml(failedAt)}"><input type="hidden" name="recovery" value="${createInstinctCsrfToken(recoveryContext(token, thread.conversationId, failedAt))}"><label><input type="checkbox" name="acknowledgeRemoteUncertainty" value="yes" required> I reviewed the current failed request, history, and outbox. I understand the remote result may be uncertain, the request may still be billed, and partial work may already have happened. I explicitly authorize reopening conversation only; I do not authorize a resend.</label><button type="submit">Review terminal failure</button></form>`
          : "<p>This failure cannot be acknowledged through the private channel. Ask Bob to diagnose it; do not resend the request or open a replacement thread.</p>"}`
    : state === "idle" && status?.reason && status?.failedAt
      ? "<p>The previous failure was acknowledged. Its original request remains failed and was not resent. You may send a fresh message below.</p>"
      : "";
  const blockedNotice = state === "running"
    ? WAITING_TEXT
    : `Sending is blocked${uncertainSubmission ? " because an earlier submission is uncertain; ask Bob to diagnose it" : ` while this turn is ${escapeInstinctHtml(state)}`}.`;
  const historyHtml = history.map(row => `<article><h2>${escapeInstinctHtml(row.role === "assistant" ? "Felix" : row.role)}</h2><time>${escapeInstinctHtml(row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt)}</time><pre style="white-space:pre-wrap">${escapeInstinctHtml(row.content)}</pre></article>`).join("");
  const older = history.length === PAGE_SIZE ? `<p><a href="/instinct/chat?before=${history[0].id}">Older messages</a></p>` : "";
  const sendArea = canSend
    ? `<form method="post" action="/instinct/chat"><input type="hidden" name="csrf" value="${formCsrf(token)}"><input type="hidden" name="action" value="send"><input type="hidden" name="submission" value="${crypto.randomBytes(32).toString("base64url")}"><label for="instinct-message">Message</label><textarea id="instinct-message" name="message" maxlength="${MAX_MESSAGE}" required>${escapeInstinctHtml(input)}</textarea><button type="submit">Send to Felix</button></form>`
    : `<p>${blockedNotice}</p><label for="instinct-message">Message</label><textarea id="instinct-message" disabled>${escapeInstinctHtml(input)}</textarea>`;
  const statusHtml = `<p>Conversation ID: <strong>${thread.conversationId}</strong></p>${thread.previousConversationId ? `<p>Previous conversation: ${thread.previousConversationId} (retained for diagnosis)</p>` : ""}<p>Turn status: <strong>${escapeInstinctHtml(state)}</strong>${status?.reason ? ` — ${escapeInstinctHtml(status.reason)}` : ""}</p><p>Thread updated: ${escapeInstinctHtml(thread.updatedAt instanceof Date ? thread.updatedAt.toISOString() : thread.updatedAt)}${status?.updatedAt ? `; turn updated: ${escapeInstinctHtml(status.updatedAt instanceof Date ? status.updatedAt.toISOString() : status.updatedAt)}` : ""}${status?.failedAt ? `; failed: ${escapeInstinctHtml(status.failedAt instanceof Date ? status.failedAt.toISOString() : status.failedAt)}` : ""}</p><p>API status URL (server status reference): ${escapeInstinctHtml(thread.statusUrl || "")}</p><p><a href="/instinct/chat">Refresh status</a> · <a href="/instinct/outbox">Instinct outbox</a></p>`;
  return page(res, "Felix · Instinct", `${flash}${statusHtml}${historyHtml || "<p>No messages yet.</p>"}${older}${recoveryArea}${sendArea}${logoutForm(token)}`);
}

export function registerInstinctWebChannel(app: Express, injected?: Partial<InstinctWebPorts>) {
  const ports: InstinctWebPorts = { ...productionPorts, ...injected };
  app.get("/instinct/login", async (req, res) => {
    secureHeaders(res);
    const accountId = instinctLoginTenantId();
    if (accountId === null) return invalidLoginBinding(res);
    const token = cookieSession(req);
    const session = token ? await ports.getSession(token) : null;
    if (session && session.tenantId !== accountId)
      return page(res, "Forbidden", "<p>This private channel is restricted to the configured owner.</p>", 403);
    if (session) return res.redirect(303, "/instinct/chat");
    let nonce = cookieValue(req, LOGIN_CSRF_COOKIE);
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(nonce)) {
      nonce = crypto.randomBytes(32).toString("base64url");
      setCookie(res, LOGIN_CSRF_COOKIE, nonce, 1800);
    }
    return page(res, "Sign in · Instinct", loginForm(nonce));
  });
  app.post("/instinct/login", async (req, res) => {
    secureHeaders(res);
    const nonce = cookieValue(req, LOGIN_CSRF_COOKIE);
    if (!originAllowed(req) || !nonce || !verifyInstinctCsrfToken(req.body?.csrf, `login:${nonce}`))
      return page(res, "Request rejected", "<p>Invalid same-origin sign-in form. Reload the login page and try again.</p>", 403);
    if (typeof req.body?.email !== "string" || typeof req.body?.password !== "string" || req.body.password.length > 1024)
      return page(res, "Sign-in failed", loginForm(nonce, "Invalid email or password.", String(req.body?.email || "")), 400);
    const accountId = instinctLoginTenantId();
    if (accountId === null) return invalidLoginBinding(res);
    const result = await ports.login(req, req.body.email, req.body.password, accountId);
    if (!result.token) {
      const locked = result.error === "locked";
      return page(res, locked ? "Sign-in temporarily locked" : "Sign-in failed",
        loginForm(nonce, locked ? "Too many attempts. Try again later." : "Invalid email or password.", req.body.email),
        locked ? 429 : 403);
    }
    setCookie(res, COOKIE, result.token, 604800);
    clearCookie(res, LOGIN_CSRF_COOKIE);
    return res.redirect(303, "/instinct/chat");
  });
  app.get("/instinct/chat", async (req, res) => {
    const auth = await requireOwner(req, res, ports);
    if (auth) await renderChat(req, res, auth.tenantId, auth.token, ports);
  });
  app.post("/instinct/chat", async (req, res) => {
    const auth = await requireOwner(req, res, ports);
    if (!auth) return;
    if (!originAllowed(req) || !verifyInstinctCsrfToken(req.body?.csrf, `session:${auth.token}`))
      return page(res, "Request rejected", "<p>Invalid same-origin form. Reload the page and try again.</p>", 403);
    if (!enabled()) return page(res, "Instinct chat disabled", "<p>Instinct web channel is disabled.</p>", 503);
    const action = req.body?.action;
    if (action === "resume") {
      const rawId = req.body?.conversationId;
      const failedAt = req.body?.failedAt;
      if (typeof rawId !== "string" || !/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) ||
          typeof failedAt !== "string" || !Number.isFinite(Date.parse(failedAt)) ||
          new Date(failedAt).toISOString() !== failedAt || req.body?.acknowledge !== "yes")
        return page(res, "Invalid recovery form", "<p>Review the history and outbox, then acknowledge the exact failed turn.</p>", 400);
      const conversationId = Number(rawId);
      if (!verifyInstinctCsrfToken(req.body?.recovery, recoveryContext(auth.token, conversationId, failedAt)))
        return page(res, "Request rejected", "<p>This recovery form is invalid. Refresh the conversation.</p>", 403);
      let outcome: "resumed" | "duplicate" | "blocked";
      try {
        outcome = await ports.resumeFailedTurn(auth.tenantId, conversationId, failedAt, auth.principalTenantId);
      } catch (error) {
        console.error("[instinct-web] failure acknowledgement could not be confirmed",
          conversationId, error instanceof Error ? error.name : "unknown-error");
        return page(res, "Recovery could not be confirmed",
          "<p>Could not confirm recovery. No model work was launched and no request was resent. <a href=\"/instinct/chat\">Refresh status</a> to verify the saved state; do not resend the original request automatically.</p>", 503);
      }
      if (outcome === "blocked")
        return page(res, "Recovery unavailable", "<p>The saved turn changed or remains uncertain. Nothing was reset or resent. Refresh status or ask Bob to diagnose it.</p>", 409);
      return res.redirect(303, "/instinct/chat");
    }
    if (action === "review_uncertain") {
      const rawId = req.body?.conversationId;
      const failedAt = req.body?.failedAt;
      if (typeof rawId !== "string" || !/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) ||
          typeof failedAt !== "string" || !Number.isFinite(Date.parse(failedAt)) ||
          new Date(failedAt).toISOString() !== failedAt || req.body?.acknowledgeRemoteUncertainty !== "yes")
        return page(res, "Invalid review form",
          "<p>Explicitly review the current failed request, possible provider billing, and partial work before acknowledging uncertainty.</p>", 400);
      const conversationId = Number(rawId);
      if (!verifyInstinctCsrfToken(req.body?.recovery, recoveryContext(auth.token, conversationId, failedAt)))
        return page(res, "Request rejected", "<p>This review form is invalid. Refresh the conversation.</p>", 403);
      let outcome: "resumed" | "duplicate" | "blocked";
      try {
        outcome = await ports.reviewUncertainFailedTurn(
          auth.tenantId, conversationId, failedAt, auth.principalTenantId);
      } catch (error) {
        console.error("[instinct-web] terminal failure review could not be confirmed",
          conversationId, error instanceof Error ? error.name : "unknown-error");
        return page(res, "Review could not be confirmed",
          "<p>Could not confirm review. No model work was launched, no request was resent, and no reservation was released. <a href=\"/instinct/chat\">Refresh status</a> to verify saved state.</p>", 503);
      }
      if (outcome === "blocked")
        return page(res, "Review unavailable",
          "<p>The saved turn changed or still has active/uncertain work. Nothing was reset or resent. Refresh status or ask Bob to diagnose it.</p>", 409);
      return res.redirect(303, "/instinct/chat");
    }
    const submission = req.body?.submission;
    if (typeof submission !== "string" || !/^[A-Za-z0-9_-]{40,50}$/.test(submission))
      return page(res, "Invalid form", "<p>Invalid submission token. Reload the page.</p>", 400);
    const tokenHash = sha256(submission);
    if (action === "open" || action === "replace") {
      const priorThread = await ports.getThread(auth.tenantId);
      const prior = await ports.findSubmission(auth.tenantId, tokenHash);
      if (prior && prior.message === INSTINCT_OPENING_TEXT)
        return res.redirect(303, `/instinct/chat?receipt=${encodeURIComponent(prior.requestId)}`);
      if (action === "open" && priorThread)
        return page(res, "Thread already reserved", "<p>A thread already exists or its opening is uncertain. It will not be dispatched again.</p>", 409);
      if (action === "replace" && (!priorThread || priorThread.state !== "ready" ||
          !priorThread.conversationId || await ports.isApiThread(auth.tenantId, priorThread.conversationId))) {
        return page(res, "Replacement not available", "<p>A replacement is permitted only after the saved API-v1 thread is confirmed missing.</p>", 409);
      }
      const requestId = `web_${crypto.randomBytes(18).toString("hex")}`;
      const clientKey = `webkey_${crypto.randomBytes(24).toString("base64url")}`;
      const newSubmission: WebSubmission = {
        tenantId: auth.tenantId, conversationId: null, tokenHash, clientKey,
        message: INSTINCT_OPENING_TEXT, state: "accepted", requestId,
      };
      const inserted = action === "replace"
        ? await ports.reserveReplacement(auth.tenantId, priorThread!.conversationId!, newSubmission)
        : await ports.reserveOpening(auth.tenantId, newSubmission);
      if (!inserted) {
        return page(res, "Thread opening blocked", "<p>Another session reserved thread creation. Refresh to inspect the durable state.</p>", 409);
      }
      try {
        const dispatch = await withTenantContext({ tenantId: auth.tenantId, source: "session" },
          () => ports.dispatch(auth.tenantId, INSTINCT_OPENING_TEXT, "Felix", true, ({ conversationId, statusUrl }) =>
            ports.bindOpening(auth.tenantId, requestId, conversationId, statusUrl)));
        void dispatch.turn.then(
          () => ports.updateSubmission(auth.tenantId, requestId, "complete", dispatch.conversationId),
          () => ports.updateSubmission(auth.tenantId, requestId, "failed", dispatch.conversationId),
        ).catch(() => {});
      } catch (err: any) {
        await ports.blockOpening(auth.tenantId).catch(() => {});
        await ports.updateSubmission(auth.tenantId, requestId, "blocked").catch(() => {});
        console.error("[instinct-web] opening dispatch uncertain", requestId, err?.code || "dispatch-error");
        return page(res, "Thread opening blocked", "<p>Dispatch could not be confirmed. It will not be retried automatically; ask Bob to diagnose the saved state.</p>", 503);
      }
      return res.redirect(303, `/instinct/chat?receipt=${encodeURIComponent(requestId)}`);
    }
    if (action !== "send") return page(res, "Invalid form", "<p>Unknown action.</p>", 400);
    const message = req.body?.message;
    if (!validMessage(message)) return renderChat(req, res, auth.tenantId, auth.token, ports,
      "<p role=\"alert\">Message must be non-empty and no longer than 16,000 characters.</p>", typeof message === "string" ? message : "");
    const thread = await ports.getThread(auth.tenantId);
    if (!thread || thread.state !== "ready" || !thread.conversationId)
      return page(res, "Thread unavailable", "<p>The saved Instinct thread is missing or blocked. No turn was started.</p>", 409);
    const prior = await ports.findSubmission(auth.tenantId, tokenHash);
    if (prior) {
      if (prior.message !== message) return page(res, "Submission conflict", "<p>This form token belongs to different text.</p>", 409);
      return res.redirect(303, `/instinct/chat?receipt=${encodeURIComponent(prior.requestId)}`);
    }
    if (await ports.hasUncertainSubmission(auth.tenantId, thread.conversationId)) {
      const status = await ports.getStatus(auth.tenantId, thread.conversationId);
      if (status?.status === "running")
        return page(res, "Felix is working", `<p>${WAITING_TEXT}</p><p>No new turn was started. <a href="/instinct/chat">Refresh status</a></p>`, 409);
      return page(res, "Submission status uncertain", "<p>An earlier submission is pending or uncertain. No new turn was started; ask Bob to diagnose the saved state.</p>", 409);
    }
    if (!(await ports.isApiThread(auth.tenantId, thread.conversationId)))
      return page(res, "Thread unavailable", "<p>The saved API-v1 thread is invalid. No turn was started.</p>", 503);
    const requestId = `web_${crypto.randomBytes(18).toString("hex")}`;
    const clientKey = `webkey_${crypto.randomBytes(24).toString("base64url")}`;
    const inserted = await ports.createSubmission({
      tenantId: auth.tenantId, conversationId: thread.conversationId, tokenHash,
      clientKey, message, state: "accepted", requestId,
    });
    if (!inserted) {
      const replay = await ports.findSubmission(auth.tenantId, tokenHash);
      if (replay?.message === message) return res.redirect(303, `/instinct/chat?receipt=${encodeURIComponent(replay.requestId)}`);
      return page(res, "Submission conflict", "<p>This form token has already been used.</p>", 409);
    }
    const claim = await ports.claimFollowUp(auth.tenantId, thread.conversationId, clientKey, message, requestId);
    if (claim.outcome !== "claimed") {
      await ports.updateSubmission(auth.tenantId, requestId, "blocked");
      return page(res, "Turn unavailable", "<p>An active, failed, or uncertain turn prevents another send. Refresh status or ask Bob to diagnose it.</p>", 409);
    }
    await ports.updateSubmission(auth.tenantId, requestId, "running", thread.conversationId);
    const conversationId = thread.conversationId;
    withTenantContext({ tenantId: auth.tenantId, source: "session" }, () =>
      ports.launchFollowUp(auth.tenantId, conversationId, message,
        state => ports.updateSubmission(auth.tenantId, requestId, state, conversationId)));
    return res.redirect(303, `/instinct/chat?receipt=${encodeURIComponent(requestId)}`);
  });
  app.get("/instinct/outbox", async (req, res) => {
    const auth = await requireOwner(req, res, ports);
    if (!auth) return;
    const before = parseBefore(req, res);
    if (before === null) return;
    if (!enabled()) return page(res, "Instinct outbox disabled", "<p>Instinct web channel is disabled.</p>", 503);
    const rows = await ports.outbox(auth.tenantId, before);
    const activeThread = await ports.getThread(auth.tenantId);
    const items = rows.map(row => `<article><h2>Outbox message ${row.id}</h2><p>Agent: ${escapeInstinctHtml(row.personaName)} (persona ${escapeInstinctHtml(row.personaId)})</p><time>${escapeInstinctHtml(row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt)}</time><p>Conversation ID: ${row.conversationId == null ? "none" : escapeInstinctHtml(row.conversationId)}${row.conversationId === activeThread?.conversationId ? " (active Instinct thread)" : ""}</p><pre style="white-space:pre-wrap">${escapeInstinctHtml(row.message)}</pre></article>`).join("");
    const older = rows.length === PAGE_SIZE ? `<p><a href="/instinct/outbox?before=${rows.at(-1)!.id}">Older messages</a></p>` : "";
    return page(res, "Instinct outbox", `${items || "<p>No messages.</p>"}${older}<p><a href="/instinct/chat">Chat</a></p>${logoutForm(auth.token)}`);
  });
  app.post("/instinct/logout", async (req, res) => {
    const auth = await requireOwner(req, res, ports);
    if (!auth) return;
    if (!originAllowed(req) || !verifyInstinctCsrfToken(req.body?.csrf, `session:${auth.token}`))
      return page(res, "Request rejected", "<p>Invalid same-origin form.</p>", 403);
    await ports.revoke(auth.token);
    clearCookie(res, COOKIE);
    return res.redirect(303, "/instinct/login");
  });
}