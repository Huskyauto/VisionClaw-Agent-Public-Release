import fs from "fs";
import path from "path";

export type HookEventType =
  | "command:new"
  | "command:reset"
  | "command:stop"
  | "session:compact:before"
  | "session:compact:after"
  | "agent:bootstrap"
  | "gateway:startup"
  | "message:received"
  | "message:sent"
  | "message:preprocessed";

export interface HookEvent {
  type: string;
  action: string;
  sessionKey: string;
  timestamp: Date;
  messages: string[];
  context: Record<string, any>;
}

export interface HookHandler {
  name: string;
  description: string;
  events: string[];
  enabled: boolean;
  handler: (event: HookEvent) => Promise<void>;
}

const registeredHooks: HookHandler[] = [];
const hookLog: Array<{
  hookName: string;
  event: string;
  timestamp: number;
  status: "ok" | "error";
  detail?: string;
}> = [];
const MAX_HOOK_LOG = 200;

function logHookExecution(entry: Omit<typeof hookLog[0], "timestamp">) {
  hookLog.unshift({ ...entry, timestamp: Date.now() });
  if (hookLog.length > MAX_HOOK_LOG) hookLog.length = MAX_HOOK_LOG;
}

export function registerHook(hook: HookHandler) {
  const existing = registeredHooks.findIndex(h => h.name === hook.name);
  if (existing >= 0) {
    registeredHooks[existing] = hook;
  } else {
    registeredHooks.push(hook);
  }
  console.log(`[hooks] Registered: ${hook.name} (${hook.events.join(", ")})`);
}

export function enableHook(name: string): boolean {
  const hook = registeredHooks.find(h => h.name === name);
  if (!hook) return false;
  hook.enabled = true;
  return true;
}

export function disableHook(name: string): boolean {
  const hook = registeredHooks.find(h => h.name === name);
  if (!hook) return false;
  hook.enabled = false;
  return true;
}

export function listHooks(): Array<{ name: string; description: string; events: string[]; enabled: boolean }> {
  return registeredHooks.map(h => ({
    name: h.name,
    description: h.description,
    events: h.events,
    enabled: h.enabled,
  }));
}

export function getHookLog(limit = 50) {
  return hookLog.slice(0, limit);
}

export async function emitHookEvent(event: HookEvent): Promise<string[]> {
  const messages: string[] = [];
  const eventKey = `${event.type}:${event.action}`;

  for (const hook of registeredHooks) {
    if (!hook.enabled) continue;

    const matches = hook.events.some(e =>
      e === eventKey || e === event.type || e === "*"
    );

    if (!matches) continue;

    try {
      await hook.handler(event);
      messages.push(...event.messages);
      event.messages = [];
      logHookExecution({ hookName: hook.name, event: eventKey, status: "ok" });
    } catch (err: any) {
      console.error(`[hooks] ${hook.name} failed for ${eventKey}:`, err.message);
      logHookExecution({ hookName: hook.name, event: eventKey, status: "error", detail: err.message });
    }
  }

  return messages;
}

function registerBundledHooks() {
  registerHook({
    name: "command-logger",
    description: "Logs all command events to the hook log",
    events: ["command:new", "command:reset", "command:stop"],
    enabled: true,
    handler: async (event) => {
      const logDir = path.resolve(process.cwd(), "data");
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

      const logFile = path.join(logDir, "hook-commands.log");
      const line = `[${event.timestamp.toISOString()}] ${event.type}:${event.action} session=${event.sessionKey}\n`;
      fs.appendFileSync(logFile, line);
    },
  });

  registerHook({
    name: "message-logger",
    description: "Logs inbound and outbound messages for audit",
    events: ["message:received", "message:sent"],
    enabled: true,
    handler: async (event) => {
      const logDir = path.resolve(process.cwd(), "data");
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

      const logFile = path.join(logDir, "hook-messages.log");
      const direction = event.action === "received" ? "IN" : "OUT";
      const who = event.action === "received" ? event.context.from : event.context.to;
      const content = (event.context.content || "").slice(0, 200);
      const line = `[${event.timestamp.toISOString()}] ${direction} ${who || "unknown"}: ${content}\n`;
      fs.appendFileSync(logFile, line);
    },
  });

  registerHook({
    name: "session-memory",
    description: "Saves session context summary when /new is issued",
    events: ["command:new"],
    enabled: false,
    handler: async (event) => {
      const memDir = path.resolve(process.cwd(), "data", "memory");
      if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });

      const snapshot = {
        sessionKey: event.sessionKey,
        savedAt: event.timestamp.toISOString(),
        context: event.context,
      };

      const filename = `session-${Date.now()}.json`;
      fs.writeFileSync(path.join(memDir, filename), JSON.stringify(snapshot, null, 2));
      event.messages.push("Session context saved to memory.");
    },
  });

  registerHook({
    name: "skill-seeker-gap-detector",
    description: "Auto-detects capability gaps from agent responses (e.g., 'I cannot do X')",
    events: ["message:sent"],
    enabled: true,
    handler: async (event) => {
      try {
        const content = event.context?.content || "";
        if (typeof content !== "string" || content.length < 30) return;
        const { scanForGaps, detectGap } = await import("./skill-seeker");
        const gapText = scanForGaps(content);
        if (gapText) {
          const personaId = event.context?.personaId || event.context?.persona_id;
          const tenantId = event.context?.tenantId || event.context?.tenant_id;
          await detectGap(gapText, "Auto-detected from agent response", personaId, tenantId, "auto_detection");
        }
      } catch {}
    },
  });

  registerHook({
    name: "user-model-deriver",
    description: "Builds dialectic user profile from conversation patterns",
    events: ["message:sent"],
    enabled: true,
    handler: async (event) => {
      try {
        const tenantId = event.context?.tenantId || event.context?.tenant_id;
        if (!tenantId) return;
        const userMessage = event.context?.userMessage || event.context?.user_message || "";
        const agentResponse = event.context?.content || "";
        if (!userMessage || userMessage.length < 20) return;
        const { deriveObservations } = await import("./user-modeling");
        deriveObservations(tenantId, userMessage, agentResponse).catch(() => {});
      } catch {}
    },
  });

  registerHook({
    name: "knowledge-nudge-detector",
    description: "Auto-saves high-value information from user messages",
    events: ["message:received"],
    enabled: true,
    handler: async (event) => {
      try {
        const tenantId = event.context?.tenantId || event.context?.tenant_id;
        if (!tenantId) return;
        const content = event.context?.content || "";
        if (typeof content !== "string" || content.length < 40) return;
        const { processNudge } = await import("./knowledge-nudges");
        processNudge(tenantId, content, event.context?.conversationId).catch(() => {});
      } catch {}
    },
  });

  registerHook({
    name: "tool-performance-tracker",
    description: "Tracks tool execution success/failure for skill evolution",
    events: ["message:sent"],
    enabled: true,
    handler: async (event) => {
      try {
        const tenantId = event.context?.tenantId || event.context?.tenant_id;
        if (!tenantId) return;
        const toolCalls = event.context?.toolCalls || event.context?.tool_calls;
        if (!Array.isArray(toolCalls) || toolCalls.length === 0) return;
        const { trackToolExecution } = await import("./skill-evolution");
        for (const tc of toolCalls) {
          if (tc.name && typeof tc.success === "boolean") {
            trackToolExecution(tenantId, tc.name, tc.success, tc.duration || 0, tc.error).catch(() => {});
          }
        }
      } catch {}
    },
  });

  registerHook({
    name: "webhook-relay",
    description: "Relays message events to configured webhook URLs",
    events: ["message:sent"],
    enabled: false,
    handler: async (event) => {
      const webhookUrl = event.context.webhookUrl;
      if (!webhookUrl) return;

      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "message:sent",
            content: event.context.content,
            to: event.context.to,
            timestamp: event.timestamp.toISOString(),
          }),
        });
      } catch (err: any) {
        console.error(`[hooks] Webhook relay failed:`, err.message);
      }
    },
  });
}

registerBundledHooks();
