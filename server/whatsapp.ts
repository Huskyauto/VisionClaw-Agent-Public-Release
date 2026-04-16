import * as baileysModule from "@whiskeysockets/baileys";
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
import { processMessage } from "./chat-engine";
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
  tenantId: number | undefined;
  approvalPhone: string | null;
}

const ADMIN_TENANT: undefined = undefined;
const tenantStates = new Map<string, TenantWAState>();

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
      try { s.socket.end(undefined); } catch {}
      s.socket = null;
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
          s.reconnectAttempts++;
          if (s.reconnectAttempts > 5) {
            s.lastError = "Connection replaced repeatedly. Click Connect WhatsApp to reconnect.";
            console.log(`${prefix} Conflict (440): too many attempts, giving up.`);
          } else {
            const delay = Math.min(10000 * s.reconnectAttempts, 30000);
            console.log(`${prefix} Conflict (440) — reconnecting in ${delay / 1000}s (attempt ${s.reconnectAttempts}/5)`);
            setTimeout(() => {
              if (s.connectionState === "connected") return;
              connectWhatsApp(tenantId).catch((e) => {
                console.error(`${prefix} Reconnect after conflict failed:`, e.message);
              });
            }, delay);
          }
        } else if (shouldReconnect) {
          s.connectionState = "disconnected";
          s.reconnectAttempts++;
          const delay = Math.min(5000 * Math.pow(2, s.reconnectAttempts - 1), 60000);
          console.log(`${prefix} Will reconnect in ${delay / 1000}s (attempt ${s.reconnectAttempts})`);
          setTimeout(() => {
            if (s.connectionState === "connected") return;
            console.log(`${prefix} Attempting reconnect...`);
            connectWhatsApp(tenantId).catch((e) => {
              console.error(`${prefix} Reconnect failed:`, e.message);
            });
          }, delay);
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
  } catch {}

  if (!selfChat) {
    if (!s.autoReplyEnabled) return;
    if (s.allowedJids && !s.allowedJids.has(jid)) return;
  }

  if (s.pendingProcessing.has(msgId)) return;
  s.pendingProcessing.add(msgId);

  try {
    const label = selfChat ? "self-chat" : jid;
    console.log(`${logPrefix(s.tenantId)} Message from ${label}: ${text.slice(0, 80)}...`);

    const conversationId = await getOrCreateConversation(selfChat ? "self-chat" : jid, s);

    await s.socket?.readMessages([msg.key]);

    const result = await processMessage(conversationId, text, { source: "whatsapp" });

    if (result.response) {
      const replyTo = selfChat && s.connectedPhone ? s.connectedPhone : jid;
      await sendWhatsAppMessage(replyTo, result.response, s.tenantId);
    }
  } catch (err: any) {
    console.error(`${logPrefix(s.tenantId)} Error handling message from ${jid}:`, err.message);
    try {
      const replyTo = selfChat && s.connectedPhone ? s.connectedPhone : jid;
      await sendWhatsAppMessage(replyTo, "Sorry, I encountered an error processing that. Please try again.", s.tenantId);
    } catch {}
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
    const conv = await storage.getConversation(convId);
    if (conv) return convId;
    s.waConversations.delete(jid);
  }

  const settings = await storage.getSettings();
  const activePersona = await storage.getActivePersona();
  const selfChat = jid === "self-chat";
  const phoneNumber = selfChat ? "You" : jid.replace("@s.whatsapp.net", "");

  const tenantId = s.tenantId ?? 1;

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

export async function sendWhatsAppMessage(jid: string, text: string, tenantId?: number): Promise<boolean> {
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

  const MAX_LENGTH = 4096;
  if (text.length <= MAX_LENGTH) {
    const sent = await s.socket.sendMessage(normalizedJid, { text });
    if (sent?.key?.id) {
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
    for (const chunk of chunks) {
      const sent = await s.socket.sendMessage(normalizedJid, { text: chunk });
      if (sent?.key?.id) {
        s.sentByUs.add(sent.key.id);
        setTimeout(() => s.sentByUs.delete(sent.key.id!), 60_000);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return true;
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
