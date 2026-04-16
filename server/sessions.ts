import { storage } from "./storage";
import { processMessage } from "./chat-engine";

export interface SessionEntry {
  key: string;
  kind: "main" | "group" | "cron" | "hook" | "node" | "other";
  channel: "webchat" | "discord" | "internal" | "unknown";
  displayName: string;
  updatedAt: number;
  sessionId: string;
  model: string;
  personaName: string | null;
  personaId: number | null;
  messageCount: number;
  messages?: { role: string; content: string; createdAt: string }[];
}

export interface SessionHistoryMessage {
  role: string;
  content: string;
  createdAt: string;
  provenance?: { kind: string };
}

const INTER_SESSION_MARKER = "<!-- provenance:inter_session -->";
const MAX_PING_PONG_TURNS = 5;
const REPLY_SKIP = "REPLY_SKIP";
const TOOL_METADATA_RE = /<!-- tools:[\s\S]*?-->/g;

export async function sessionsList(params: {
  kinds?: string[];
  limit?: number;
  activeMinutes?: number;
  messageLimit?: number;
}): Promise<SessionEntry[]> {
  const limit = Math.min(params.limit || 50, 200);
  const messageLimit = params.messageLimit || 0;

  const result = await storage.getConversations(200, 0);
  let conversations = result.data;

  if (params.kinds && params.kinds.length > 0) {
    conversations = conversations.filter((c) => {
      const kind = resolveKind(c);
      return params.kinds!.includes(kind);
    });
  }

  if (params.activeMinutes && params.activeMinutes > 0) {
    const cutoff = Date.now() - params.activeMinutes * 60 * 1000;
    conversations = conversations.filter(
      (c) => new Date(c.updatedAt).getTime() > cutoff
    );
  }

  conversations = conversations.slice(0, limit);

  const entries: SessionEntry[] = [];

  for (const conv of conversations) {
    const persona = conv.personaId
      ? await storage.getPersona(conv.personaId)
      : null;

    const entry: SessionEntry = {
      key: resolveKey(conv),
      kind: resolveKind(conv),
      channel: resolveChannel(conv),
      displayName: conv.title || "Untitled",
      updatedAt: new Date(conv.updatedAt).getTime(),
      sessionId: String(conv.id),
      model: conv.model,
      personaName: persona?.name || null,
      personaId: conv.personaId || null,
      messageCount: 0,
    };

    if (messageLimit > 0) {
      const msgs = await storage.getMessages(conv.id);
      entry.messageCount = msgs.length;
      const lastN = msgs.slice(-messageLimit);
      entry.messages = lastN.map((m) => ({
        role: m.role,
        content: m.content.slice(0, 500),
        createdAt: String(m.createdAt),
      }));
    }

    entries.push(entry);
  }

  return entries;
}

export async function sessionsHistory(params: {
  sessionKey: string;
  limit?: number;
  includeTools?: boolean;
}): Promise<SessionHistoryMessage[]> {
  const convId = await resolveConversationId(params.sessionKey);
  if (!convId) return [];

  const conv = await storage.getConversation(convId);
  if (!conv) return [];

  const allMessages = await storage.getMessages(convId);
  const limit = Math.min(params.limit || 100, 500);

  let filtered = allMessages;
  if (!params.includeTools) {
    filtered = filtered.filter((m) => m.role !== "tool");
  }

  const recent = filtered.slice(-limit);

  return recent.map((m) => {
    let content = m.content;
    if (!params.includeTools) {
      content = content.replace(TOOL_METADATA_RE, "").trim();
    }

    const entry: SessionHistoryMessage = {
      role: m.role,
      content,
      createdAt: String(m.createdAt),
    };
    if (m.content.includes(INTER_SESSION_MARKER)) {
      entry.provenance = { kind: "inter_session" };
    }
    return entry;
  });
}

export async function sessionsSend(params: {
  sessionKey: string;
  message: string;
  sourceSessionKey?: string;
  sourcePersonaName?: string;
  timeoutSeconds?: number;
}): Promise<{
  status: "ok" | "error" | "timeout";
  reply?: string;
  pingPongRounds?: number;
  error?: string;
}> {
  const convId = await resolveConversationId(params.sessionKey);
  if (!convId) {
    return { status: "error", error: `Session not found: ${params.sessionKey}` };
  }

  const conv = await storage.getConversation(convId);
  if (!conv) {
    return { status: "error", error: `Conversation not found: ${params.sessionKey}` };
  }

  const sourceLabel = params.sourcePersonaName || params.sourceSessionKey || "unknown agent";
  const taggedMessage = `${INTER_SESSION_MARKER}\n[Inter-agent message from ${sourceLabel}]\n\n${params.message}`;

  const timeoutMs = (params.timeoutSeconds ?? 120) * 1000;

  try {
    const primaryResult = await withTimeout(
      processMessage(convId, taggedMessage, { source: `inter_session:${sourceLabel}` }),
      timeoutMs
    );

    if (!primaryResult) {
      return { status: "timeout", error: "Primary run timed out" };
    }

    const primaryReply = primaryResult.response;

    if (primaryReply.trim() === REPLY_SKIP) {
      return { status: "ok", reply: primaryReply, pingPongRounds: 0 };
    }

    let sourceConvId: number | null = null;
    if (params.sourceSessionKey) {
      sourceConvId = await resolveConversationId(params.sourceSessionKey);
    }

    let lastReply = primaryReply;
    let rounds = 0;

    if (sourceConvId) {
      for (let turn = 0; turn < MAX_PING_PONG_TURNS; turn++) {
        const followUpMsg = `${INTER_SESSION_MARKER}\n[Reply from ${conv.title || "target session"} (round ${turn + 1})]\n\n${lastReply}`;

        const followUpResult = await withTimeout(
          processMessage(sourceConvId, followUpMsg, { source: `inter_session_reply:${conv.title || convId}` }),
          timeoutMs
        );

        if (!followUpResult) break;
        rounds++;

        if (followUpResult.response.trim() === REPLY_SKIP) break;

        const bounceMsg = `${INTER_SESSION_MARKER}\n[Follow-up from ${sourceLabel} (round ${turn + 1})]\n\n${followUpResult.response}`;
        const bounceResult = await withTimeout(
          processMessage(convId, bounceMsg, { source: `inter_session_pingpong:${sourceLabel}` }),
          timeoutMs
        );

        if (!bounceResult) break;

        if (bounceResult.response.trim() === REPLY_SKIP) break;
        lastReply = bounceResult.response;
      }
    }

    return {
      status: "ok",
      reply: lastReply,
      pingPongRounds: rounds,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  if (ms <= 0) return promise;
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function resolveKey(conv: { id: number; personaId?: number | null; title?: string }): string {
  if (conv.personaId) {
    return `agent:${conv.personaId}:webchat:conv:${conv.id}`;
  }
  return `main:conv:${conv.id}`;
}

function resolveKind(conv: { title?: string; personaId?: number | null }): "main" | "group" | "cron" | "hook" | "node" | "other" {
  const title = (conv.title || "").toLowerCase();
  if (title.includes("[heartbeat]") || title.includes("[cron]")) return "cron";
  if (title.includes("[hook]")) return "hook";
  if (!conv.personaId) return "main";
  return "other";
}

function resolveChannel(conv: { title?: string }): "webchat" | "discord" | "internal" | "unknown" {
  const title = (conv.title || "").toLowerCase();
  if (title.includes("[heartbeat]") || title.includes("[cron]") || title.includes("[hook]")) return "internal";
  if (title.includes("[discord]")) return "discord";
  return "webchat";
}

async function resolveConversationId(sessionKey: string): Promise<number | null> {
  if (/^\d+$/.test(sessionKey)) {
    return parseInt(sessionKey, 10);
  }

  const convMatch = sessionKey.match(/conv:(\d+)/);
  if (convMatch) return parseInt(convMatch[1], 10);

  if (sessionKey === "main") {
    const result = await storage.getConversations(1, 0);
    const mainConvs = result.data.filter((c) => !c.personaId);
    if (mainConvs.length > 0) return mainConvs[0].id;
    const allConvs = result.data;
    return allConvs.length > 0 ? allConvs[0].id : null;
  }

  const cronMatch = sessionKey.match(/^cron:(\d+)$/);
  if (cronMatch) {
    const result = await storage.getConversations(200, 0);
    const cronConv = result.data.find((c) => {
      const title = (c.title || "").toLowerCase();
      return title.includes("[heartbeat]") || title.includes("[cron]");
    });
    return cronConv?.id ?? null;
  }

  const agentMatch = sessionKey.match(/^agent:(\d+)$/);
  if (agentMatch) {
    const personaId = parseInt(agentMatch[1], 10);
    const result = await storage.getConversations(200, 0);
    const agentConv = result.data.find((c) => c.personaId === personaId);
    return agentConv?.id ?? null;
  }

  return null;
}
