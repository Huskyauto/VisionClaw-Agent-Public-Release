import * as baileysModule from "@whiskeysockets/baileys";
import { logSilentCatch } from "./lib/silent-catch";
const baileys = (baileysModule as any).default || baileysModule;
const makeWASocket = baileys.default || baileys.makeWASocket || baileys;
const {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  isJidGroup,
  jidNormalizedUser,
  proto,
} = baileys;
type WASocket = any;
import * as QRCode from "qrcode";
import { Boom } from "@hapi/boom";
import { storage } from "./storage";
import { ADMIN_TENANT_ID } from "./tenant-constants";
import path from "path";
import fs from "fs";
import { useDbAuthState, clearDbAuthState, hasStoredSession, getStoredTenantIds } from "./whatsapp-auth-store";

interface TenantWAState {
  socket: WASocket | null;
  currentQR: string | null;
  connectionState: "disconnected" | "connecting" | "qr" | "connected";
  connectedPhone: string | null;
  connectedLid: string | null;
  lastError: string | null;
  autoReplyEnabled: boolean;
  allowedJids: Set<string> | null;
  waConversations: Map<string, number>;
  pendingProcessing: Set<string>;
  sentByUs: Set<string>;
  reconnectAttempts: number;
  // R74.13z-quint+6 (OpenClaw nugget #3) — Rolling-window restart timestamps.
  // Bounded by RESTART_WINDOW_MS, never reset on connection.open. Pairs with
  // reconnectAttempts (consecutive) to catch flapping patterns that briefly
  // reach "connected" between failures and would otherwise reset the
  // consecutive counter forever.
  restartTimestamps: number[];
  reconnectDisabled: boolean;
  tenantId: number | undefined;
  approvalPhone: string | null;
}

// R74.13z-quint+6 (OpenClaw nugget #1) — WhatsApp send result. Distinguishes
// "we called sock.sendMessage" from "Baileys actually got an ack from the
// provider" (proxied by the presence of a returned key.id). Callers that need
// to know whether a reply was actually accepted can check providerAccepted.
export type WhatsAppSendResult = {
  ok: boolean;
  providerAccepted: boolean;
  messageIds: string[];
  rawError?: string;
};

// R74.13z-quint+6 (OpenClaw nugget #3) — Reconnect flapping caps. The existing
// `reconnectAttempts > 5` only catches *consecutive* failures; a connection
// that briefly succeeds between failures resets that counter forever. We
// additionally cap total restarts in a 30-minute window.
const WA_RESTART_WINDOW_MS = 30 * 60_000;
const WA_MAX_RESTARTS_IN_WINDOW = 5;
const WA_MAX_CONSECUTIVE_RESTARTS = 5;

const ADMIN_TENANT: undefined = undefined;
const tenantStates = new Map<string, TenantWAState>();

// R74.13z-quint+5 — Track JIDs we've already warned about (admin-tenant
// fallback in production while other tenant-bound sessions are connected).
// Bounded to 1000 unique JIDs per process to avoid unbounded growth on a
// platform that talks to many distinct numbers.
const _warnedAdminFallback = new Set<string>();

function stateKey(tenantId?: number): string {
  return tenantId != null ? `t${tenantId}` : "admin";
}

function getOrCreateState(tenantId?: number): TenantWAState {
  const key = stateKey(tenantId);
  let state = tenantStates.get(key);
  if (!state) {
    state = {
      socket: null,
      currentQR: null,
      connectionState: "disconnected",
      connectedPhone: null,
      connectedLid: null,
      lastError: null,
      autoReplyEnabled: true,
      allowedJids: null,
      waConversations: new Map(),
      pendingProcessing: new Set(),
      sentByUs: new Set(),
      reconnectAttempts: 0,
      restartTimestamps: [],
      reconnectDisabled: false,
      tenantId,
      approvalPhone: null,
    };
    tenantStates.set(key, state);
  }
  return state;
}

function logPrefix(tenantId?: number): string {
  return tenantId != null ? `[whatsapp:t${tenantId}]` : "[whatsapp]";
}

// R74.13z-quint+6 (OpenClaw nugget #3) — Returns { allow, reason } based on
// the rolling-window flapping cap AND the consecutive-restart cap. Push the
// new timestamp first, trim window, then evaluate. Mutates state.
function evaluateRestartAttempt(s: TenantWAState): { allow: true } | { allow: false; reason: string } {
  if (s.reconnectDisabled) {
    return { allow: false, reason: "reconnect previously disabled this session" };
  }
  s.reconnectAttempts += 1;
  const now = Date.now();
  while (s.restartTimestamps.length > 0 && now - (s.restartTimestamps[0] ?? 0) > WA_RESTART_WINDOW_MS) {
    s.restartTimestamps.shift();
  }
  s.restartTimestamps.push(now);
  // R74.13z-quint+6 (architect-flagged) — Both caps mean "allow up to N
  // restarts, block the (N+1)th". Previously rolling used `>=` (would block
  // the 5th attempt) while consecutive used `>` (allowed 5, blocked 6th) —
  // semantic mismatch that surprised on the boundary case.
  const tooManyConsecutive = s.reconnectAttempts > WA_MAX_CONSECUTIVE_RESTARTS;
  const tooManyInWindow = s.restartTimestamps.length > WA_MAX_RESTARTS_IN_WINDOW;
  if (tooManyConsecutive || tooManyInWindow) {
    s.reconnectDisabled = true;
    const detail = tooManyConsecutive
      ? `${WA_MAX_CONSECUTIVE_RESTARTS} consecutive failed restarts`
      : `${WA_MAX_RESTARTS_IN_WINDOW} restarts within ${Math.round(WA_RESTART_WINDOW_MS / 60_000)} minutes`;
    return { allow: false, reason: detail };
  }
  return { allow: true };
}

export function getWhatsAppStatus(tenantId?: number) {
  const s = getOrCreateState(tenantId);
  return {
    state: s.connectionState,
    phone: s.connectedPhone,
    qr: s.currentQR,
    autoReply: s.autoReplyEnabled,
    error: s.lastError,
    allowedContacts: s.allowedJids ? Array.from(s.allowedJids) : null,
  };
}

export function getConnectedJid(tenantId?: number): string | null {
  return getOrCreateState(tenantId).connectedPhone;
}

export function getConnectedLid(tenantId?: number): string | null {
  return getOrCreateState(tenantId).connectedLid;
}

function isSelfJid(jid: string | null | undefined, s: TenantWAState): boolean {
  if (!jid) return false;
  if (s.connectedPhone && (jid === s.connectedPhone || jid.replace(/\D/g, "") === s.connectedPhone.replace(/\D/g, ""))) return true;
  if (s.connectedLid) {
    const lidBase = s.connectedLid.replace(/@.*/, "").replace(/:\d+$/, "");
    const jidBase = jid.replace(/@.*/, "").replace(/:\d+$/, "");
    if (lidBase === jidBase) return true;
  }
  if (jid.endsWith("@lid") && s.connectedPhone) return true;
  return false;
}

export async function autoConnectWhatsApp(): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.log("[whatsapp] Skipping auto-connect in development (prevents conflict with production)");
    return;
  }
  try {
    const hasAdmin = await hasStoredSession();
    if (hasAdmin) {
      console.log("[whatsapp] Found stored admin session, auto-connecting...");
      await connectWhatsApp();
    }

    const tenantIds = await getStoredTenantIds();
    for (const tid of tenantIds) {
      try {
        const hasSession = await hasStoredSession(tid);
        if (hasSession) {
          console.log(`[whatsapp:t${tid}] Found stored tenant session, auto-connecting...`);
          await connectWhatsApp(tid);
        }
      } catch (err: any) {
        console.error(`[whatsapp:t${tid}] Auto-connect failed:`, err.message);
      }
    }
  } catch (err: any) {
    console.error("[whatsapp] Auto-connect failed:", err.message);
  }
}

export function setAutoReply(enabled: boolean, tenantId?: number) {
  getOrCreateState(tenantId).autoReplyEnabled = enabled;
}

export function setAllowedContacts(jids: string[] | null, tenantId?: number) {
  getOrCreateState(tenantId).allowedJids = jids ? new Set(jids) : null;
}

export async function connectWhatsApp(tenantId?: number): Promise<{ qr?: string; status: string }> {
  const s = getOrCreateState(tenantId);
  const prefix = logPrefix(tenantId);

  if (s.connectionState === "connected" && s.socket) {
    return { status: "already_connected" };
  }

  if (s.connectionState === "connecting" || s.connectionState === "qr") {
    if (s.currentQR) return { qr: s.currentQR, status: "awaiting_scan" };
    return { status: "connecting" };
  }

  try {
    if (s.socket) {
      try { s.socket.end(undefined); } catch (_silentErr) { logSilentCatch("server/whatsapp.ts", _silentErr); }
      s.socket = null;
    }
    // R74.13z-quint+6 (OpenClaw nugget #3) — A manual call to connectWhatsApp
    // (e.g., user clicked "Connect WhatsApp" after we tripped the flapping
    // cap) is a clear signal to clear the cap and try fresh. The auto-
    // reconnect setTimeout path is gated by `if (s.reconnectDisabled) return`
    // BEFORE this function runs, so this reset only fires on intentional
    // (re)connects.
    if (s.reconnectDisabled) {
      console.log(`${prefix} Manual reconnect: clearing reconnect cap (was disabled)`);
      s.reconnectDisabled = false;
      s.reconnectAttempts = 0;
      s.restartTimestamps = [];
    }
    s.connectionState = "connecting";
    s.lastError = null;
    s.currentQR = null;

    const { state, saveCreds } = await useDbAuthState(tenantId);
    const { version } = await fetchLatestBaileysVersion();

    s.socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, undefined as any),
      },
      printQRInTerminal: false,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    s.socket.ev.on("creds.update", saveCreds);

    s.socket.ev.on("connection.update", (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        s.currentQR = qr;
        s.connectionState = "qr";
        console.log(`${prefix} QR code ready for scanning`);
      }

      if (connection === "open") {
        s.connectionState = "connected";
        s.currentQR = null;
        // R74.13z-quint+6 — Resetting reconnectAttempts on success is correct
        // for the consecutive-cap path. The flapping cap (restartTimestamps)
        // is intentionally NOT reset here so that a connection that briefly
        // succeeds between failures still trips the rolling-window guard.
        s.reconnectAttempts = 0;
        s.connectedPhone = s.socket?.user?.id ? jidNormalizedUser(s.socket.user.id) : null;
        s.connectedLid = s.socket?.user?.lid || null;
        console.log(`${prefix} Connected as ${s.connectedPhone} (lid: ${s.connectedLid})`);
      }

      if (connection === "close") {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;

        console.log(`${prefix} Connection closed (reason: ${reason}), reconnect: ${shouldReconnect}`);

        s.socket = null;

        if (reason === DisconnectReason.loggedOut) {
          s.connectionState = "disconnected";
          s.connectedPhone = null;
          clearDbAuthState(tenantId).catch(() => {});
          s.lastError = "Logged out from WhatsApp. Please reconnect and scan QR again.";
        } else if (reason === 440) {
          s.connectionState = "disconnected";
          s.connectedPhone = null;
          const decision = evaluateRestartAttempt(s);
          if (!decision.allow) {
            s.lastError = `Connection replaced repeatedly (${decision.reason}). Click Connect WhatsApp to reconnect.`;
            console.warn(`${prefix} Conflict (440): reconnect disabled — ${decision.reason}. To re-enable, call connectWhatsApp(${tenantId ?? ""}).`);
          } else {
            const delay = Math.min(10000 * s.reconnectAttempts, 30000);
            console.log(`${prefix} Conflict (440) — reconnecting in ${delay / 1000}s (attempt ${s.reconnectAttempts}/${WA_MAX_CONSECUTIVE_RESTARTS}, ${s.restartTimestamps.length}/${WA_MAX_RESTARTS_IN_WINDOW} in window)`);
            setTimeout(() => {
              if (s.connectionState === "connected") return;
              if (s.reconnectDisabled) return;
              connectWhatsApp(tenantId).catch((e) => {
                console.error(`${prefix} Reconnect after conflict failed:`, e.message);
              });
            }, delay);
          }
        } else if (shouldReconnect) {
          s.connectionState = "disconnected";
          const decision = evaluateRestartAttempt(s);
          if (!decision.allow) {
            s.lastError = `Reconnect disabled (${decision.reason}). Click Connect WhatsApp to reconnect.`;
            console.warn(`${prefix} Reconnect disabled — ${decision.reason}. To re-enable, call connectWhatsApp(${tenantId ?? ""}).`);
          } else {
            const delay = Math.min(5000 * Math.pow(2, s.reconnectAttempts - 1), 60000);
            console.log(`${prefix} Will reconnect in ${delay / 1000}s (attempt ${s.reconnectAttempts}/${WA_MAX_CONSECUTIVE_RESTARTS}, ${s.restartTimestamps.length}/${WA_MAX_RESTARTS_IN_WINDOW} in window)`);
            setTimeout(() => {
              if (s.connectionState === "connected") return;
              if (s.reconnectDisabled) return;
              console.log(`${prefix} Attempting reconnect...`);
              connectWhatsApp(tenantId).catch((e) => {
                console.error(`${prefix} Reconnect failed:`, e.message);
              });
            }, delay);
          }
        }
      }
    });

    s.socket.ev.on("messages.upsert", async ({ messages, type }: any) => {
      for (const msg of messages) {
        const jid = msg.key.remoteJid;
        const fromMe = msg.key.fromMe;
        const hasMsg = !!msg.message;
        const selfChat = isSelfJid(jid, s);

        if (type === "notify" || (selfChat && fromMe && hasMsg)) {
          console.log(`${prefix} Incoming: type=${type} jid=${jid} fromMe=${fromMe} isSelf=${selfChat} msgId=${msg.key.id}`);
          await handleIncomingMessage(msg, s);
        }
      }
    });

    return s.currentQR ? { qr: s.currentQR, status: "awaiting_scan" } : { status: "connecting" };
  } catch (err: any) {
    s.connectionState = "disconnected";
    s.lastError = err.message;
    console.error(`${prefix} Connection error:`, err.message);
    throw err;
  }
}

export async function disconnectWhatsApp(tenantId?: number): Promise<void> {
  const s = getOrCreateState(tenantId);
  const prefix = logPrefix(tenantId);

  if (s.socket) {
    await s.socket.logout().catch(() => {});
    s.socket = null;
  }
  s.connectionState = "disconnected";
  s.connectedPhone = null;
  s.currentQR = null;
  s.waConversations.clear();

  await clearDbAuthState(tenantId).catch(() => {});
  if (tenantId == null) {
    const AUTH_DIR = path.join(process.cwd(), ".whatsapp-auth");
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
  }
  console.log(`${prefix} Disconnected and auth cleared`);
}

async function handleIncomingMessage(msg: typeof proto.IWebMessageInfo, s: TenantWAState) {
  if (!msg.message) return;

  const jid = msg.key.remoteJid;
  if (!jid) return;

  if (isJidGroup(jid)) return;

  const msgId = msg.key.id || "";
  const selfChat = isSelfJid(jid, s);

  if (msg.key.fromMe) {
    if (!selfChat) return;
    if (s.sentByUs.has(msgId)) return;
  }

  const text = extractMessageText(msg);
  if (!text || text.length < 1) return;

  try {
    const { handleWhatsAppApprovalCommand } = await import("./whatsapp-approval");
    if (handleWhatsAppApprovalCommand(text, jid, s.tenantId)) {
      console.log(`${logPrefix(s.tenantId)} Handled as approval command from ${jid}`);
      return;
    }
  } catch (err: any) {
    // R74.13c — M7 fix. Don't swallow approval-command import/eval failures.
    console.error(`${logPrefix(s.tenantId)} Approval-command handler failed for ${jid}:`, err?.message ?? err);
  }

  if (!selfChat) {
    if (!s.autoReplyEnabled) return;
    if (s.allowedJids && !s.allowedJids.has(jid)) return;
  }

  if (s.pendingProcessing.has(msgId)) return;
  s.pendingProcessing.add(msgId);

  try {
    const label = selfChat ? "self-chat" : jid;
    console.log(`${logPrefix(s.tenantId)} Message from ${label}: ${text.slice(0, 80)}...`);

    await s.socket?.readMessages([msg.key]);

    // R74.13z-quint+6 (OpenClaw nugget #5) — Route through the channel
    // kernel. The kernel owns: dedup-by-externalMessageId (second line of
    // defense behind pendingProcessing), tenant context, and the
    // chat-engine call. WhatsApp-specific behavior — selfChat replyTo
    // munging, the friendly error reply, sentByUs bookkeeping — stays
    // here in the adapter.
    const turnTenantId = s.tenantId ?? ADMIN_TENANT_ID;
    const turn: import("./channels/kernel").InboundTurn = {
      channel: "whatsapp",
      tenantId: turnTenantId,
      fromIdentifier: selfChat ? "self-chat" : jid,
      text,
      externalMessageId: msgId || `wa-noid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      raw: msg,
      receivedAt: new Date(),
    };
    const { dispatchInbound } = await import("./channels/kernel");
    const kernelResult = await dispatchInbound(turn, {
      source: "whatsapp",
      resolveConversation: async (_t) => getOrCreateConversation(selfChat ? "self-chat" : jid, s),
    });

    if (!kernelResult.ok) {
      throw new Error(kernelResult.error || "kernel dispatch failed");
    }
    if (kernelResult.dedupedAs) {
      // Quietly drop dups / empty turns — kernel already short-circuited.
      return;
    }
    if (kernelResult.responseText) {
      const replyTo = selfChat && s.connectedPhone ? s.connectedPhone : jid;
      await sendWhatsAppMessage(replyTo, kernelResult.responseText, s.tenantId);
    }
  } catch (err: any) {
    console.error(`${logPrefix(s.tenantId)} Error handling message from ${jid}:`, err.message);
    try {
      const replyTo = selfChat && s.connectedPhone ? s.connectedPhone : jid;
      await sendWhatsAppMessage(replyTo, "Sorry, I encountered an error processing that. Please try again.", s.tenantId);
    } catch (_silentErr) { logSilentCatch("server/whatsapp.ts", _silentErr); }
  } finally {
    s.pendingProcessing.delete(msgId);
  }
}

function extractMessageText(msg: typeof proto.IWebMessageInfo): string {
  const m = msg.message;
  if (!m) return "";

  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return `[Image] ${m.imageMessage.caption}`;
  if (m.videoMessage?.caption) return `[Video] ${m.videoMessage.caption}`;
  if (m.documentMessage?.caption) return `[Document: ${m.documentMessage?.fileName || "file"}] ${m.documentMessage.caption || ""}`;
  if (m.imageMessage) return "[Image received]";
  if (m.videoMessage) return "[Video received]";
  if (m.audioMessage) return "[Voice message received]";
  if (m.documentMessage) return `[Document: ${m.documentMessage?.fileName || "file"}]`;
  if (m.stickerMessage) return "[Sticker received]";
  if (m.contactMessage) return `[Contact: ${m.contactMessage.displayName || "unknown"}]`;
  if (m.locationMessage) return `[Location: ${m.locationMessage.degreesLatitude}, ${m.locationMessage.degreesLongitude}]`;

  return "";
}

async function getOrCreateConversation(jid: string, s: TenantWAState): Promise<number> {
  if (s.waConversations.has(jid)) {
    const convId = s.waConversations.get(jid)!;
    const conv = await storage.getConversation(convId, s.tenantId ?? ADMIN_TENANT_ID);
    if (conv) return convId;
    s.waConversations.delete(jid);
  }

  const settings = await storage.getSettings();
  const activePersona = await storage.getActivePersona();
  const selfChat = jid === "self-chat";
  const phoneNumber = selfChat ? "You" : jid.replace("@s.whatsapp.net", "");

  // R74.12 — Single-tenant platform: WhatsApp falls back to admin tenant when
  // session has no tenant claim. SaaS migration would require explicit tenant.
  // R74.13z-quint+5 — In production with other tenant-bound WA sessions in
  // play, an unclaimed session writing into admin tenant likely indicates a
  // misconfigured connect() call. Warn (once per JID per process) so a leak
  // into the wrong tenant gets noticed instead of failing silently.
  const tenantId = s.tenantId ?? ADMIN_TENANT_ID;
  if (s.tenantId == null && process.env.NODE_ENV === "production") {
    const otherTenantSessions = Array.from(tenantStates.values()).filter(st => st.tenantId != null && st.connectionState === "connected").length;
    if (otherTenantSessions > 0 && !_warnedAdminFallback.has(jid)) {
      // Enforce the 1000-JID cap declared at the Set's definition site.
      if (_warnedAdminFallback.size >= 1000) {
        const firstJid = _warnedAdminFallback.values().next().value;
        if (firstJid !== undefined) _warnedAdminFallback.delete(firstJid);
      }
      _warnedAdminFallback.add(jid);
      console.warn(`[whatsapp] NOTICE: incoming message from ${jid} is being assigned to admin tenant (${ADMIN_TENANT_ID}) because the WA session has no tenantId claim, but ${otherTenantSessions} tenant-bound WA session(s) are also connected. If this WA line should belong to a specific tenant, reconnect via connectWhatsApp(tenantId). (One warning per JID per process.)`);
    }
  }

  const conv = await storage.createConversation({
    title: selfChat ? `WhatsApp: ${(await import("./site-config")).siteConfig.platformName} Direct` : `WhatsApp: +${phoneNumber}`,
    model: settings?.defaultModel || "gpt-4.1",
    thinking: settings?.thinkingEnabled ?? false,
    personaId: activePersona?.id ?? null,
    tenantId,
  });

  s.waConversations.set(jid, conv.id);
  return conv.id;
}

async function waitForConnection(s: TenantWAState, timeoutMs = 30000): Promise<boolean> {
  if (s.socket && s.connectionState === "connected") return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 2000));
    if (s.socket && s.connectionState === "connected") return true;
  }
  return false;
}

// R74.13z-quint+6 (OpenClaw nugget #1) — Returns a structured result with a
// providerAccepted flag (true iff Baileys returned a key.id for every chunk we
// sent). Throws on connection failure (matching the previous contract that
// callers wrap in try/catch). Existing callers that did `await sendWhats...`
// and discarded the boolean continue to work unchanged.
export async function sendWhatsAppMessage(jid: string, text: string, tenantId?: number): Promise<WhatsAppSendResult> {
  const s = getOrCreateState(tenantId);
  const prefix = logPrefix(tenantId);

  if (!s.socket || s.connectionState !== "connected") {
    console.log(`${prefix} Socket not ready for send, waiting up to 30s for reconnect...`);
    const reconnected = await waitForConnection(s, 30000);
    if (!reconnected) {
      throw new Error("WhatsApp is not connected");
    }
  }

  const normalizedJid = jid.includes("@") ? jid : `${jid}@s.whatsapp.net`;

  const messageIds: string[] = [];
  let chunkCount = 0;

  const MAX_LENGTH = 4096;
  if (text.length <= MAX_LENGTH) {
    chunkCount = 1;
    const sent = await s.socket.sendMessage(normalizedJid, { text });
    if (sent?.key?.id) {
      messageIds.push(sent.key.id);
      s.sentByUs.add(sent.key.id);
      setTimeout(() => s.sentByUs.delete(sent.key.id!), 60_000);
    }
  } else {
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LENGTH) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH - 100);
      if (splitAt < 100) splitAt = remaining.lastIndexOf(" ", MAX_LENGTH - 100);
      if (splitAt < 100) splitAt = MAX_LENGTH - 100;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    chunkCount = chunks.length;
    for (const chunk of chunks) {
      const sent = await s.socket.sendMessage(normalizedJid, { text: chunk });
      if (sent?.key?.id) {
        messageIds.push(sent.key.id);
        s.sentByUs.add(sent.key.id);
        setTimeout(() => s.sentByUs.delete(sent.key.id!), 60_000);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // providerAccepted = true iff EVERY chunk got a key.id back from Baileys.
  // Partial-accept (some chunks got an id, some didn't) counts as not accepted
  // because the recipient saw a fragmented reply.
  const providerAccepted = chunkCount > 0 && messageIds.length === chunkCount;
  if (!providerAccepted) {
    console.warn(`${prefix} Send to ${normalizedJid} was NOT fully accepted by WhatsApp provider (${messageIds.length}/${chunkCount} chunks ack'd). Text preview: ${text.slice(0, 80).replace(/\n/g, " ")}${text.length > 80 ? "..." : ""}`);
  }
  return { ok: true, providerAccepted, messageIds };
}

export async function getQRCodeDataURL(tenantId?: number): Promise<string | null> {
  const s = getOrCreateState(tenantId);
  if (!s.currentQR) return null;
  try {
    return await QRCode.toDataURL(s.currentQR, { width: 300, margin: 2 });
  } catch {
    return null;
  }
}

export function isWhatsAppConnected(tenantId?: number): boolean {
  const s = getOrCreateState(tenantId);
  return s.connectionState === "connected";
}

export async function initWhatsAppFromSettings(): Promise<void> {
}
