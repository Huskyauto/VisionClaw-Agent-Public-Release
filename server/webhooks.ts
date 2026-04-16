import type { Request, Response, Express } from "express";
import crypto from "crypto";
import { storage } from "./storage";
import { buildSystemPrompt, stripThinkTags, windowMessages } from "./chat-engine";
import { getClientForModel } from "./providers";
import { isValidSession } from "./auth";

interface WebhookConfig {
  enabled: boolean;
  token: string;
}

let webhookConfig: WebhookConfig = { enabled: false, token: "" };

const WEBHOOK_LOG: Array<{
  id: string;
  type: "wake" | "agent";
  timestamp: number;
  source: string;
  status: "accepted" | "completed" | "failed";
  detail?: string;
}> = [];
const MAX_LOG_ENTRIES = 100;

function logWebhook(entry: Omit<typeof WEBHOOK_LOG[0], "id" | "timestamp">) {
  WEBHOOK_LOG.unshift({ ...entry, id: crypto.randomUUID(), timestamp: Date.now() });
  if (WEBHOOK_LOG.length > MAX_LOG_ENTRIES) WEBHOOK_LOG.length = MAX_LOG_ENTRIES;
}

function authenticateWebhook(req: Request): boolean {
  if (!webhookConfig.enabled || !webhookConfig.token) return false;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7) === webhookConfig.token;
  }

  const customToken = req.headers["x-visionclaw-token"] as string;
  if (customToken) {
    return customToken === webhookConfig.token;
  }

  return false;
}

const failedAttempts = new Map<string, { count: number; lastAttempt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = failedAttempts.get(ip);
  if (!record) return true;
  if (now - record.lastAttempt > 60_000) {
    failedAttempts.delete(ip);
    return true;
  }
  return record.count < 5;
}

function recordFailedAttempt(ip: string) {
  const now = Date.now();
  const record = failedAttempts.get(ip) || { count: 0, lastAttempt: now };
  record.count++;
  record.lastAttempt = now;
  failedAttempts.set(ip, record);
}

export function configureWebhooks(config: Partial<WebhookConfig>) {
  webhookConfig = { ...webhookConfig, ...config };
}

export function getWebhookStatus() {
  return {
    enabled: webhookConfig.enabled,
    hasToken: !!webhookConfig.token,
    recentLogs: WEBHOOK_LOG.slice(0, 20),
  };
}

export function registerWebhookRoutes(app: Express) {
  app.post("/api/hooks/wake", async (req: Request, res: Response) => {
    const ip = req.ip || "unknown";
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: "Too many failed attempts", retryAfter: 60 });
    }

    if (!authenticateWebhook(req)) {
      recordFailedAttempt(ip);
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { text, mode } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text field required (string)" });
    }

    const wakeMode = mode === "next-heartbeat" ? "next-heartbeat" : "now";

    try {
      const settings = await storage.getSettings();
      const persona = await storage.getActivePersona();

      const conversations = await storage.getConversations(1, 0);
      let targetConv = conversations.data[0];
      if (!targetConv) {
        targetConv = await storage.createConversation({
          title: "Webhook Wake",
          model: settings?.defaultModel || "gemini-2.5-flash",
          thinking: settings?.thinkingEnabled ?? false,
          personaId: persona?.id || null,
        });
      }

      await storage.createMessage({
        conversationId: targetConv.id,
        role: "system",
        content: `[WEBHOOK WAKE EVENT] ${text}`,
      });

      logWebhook({ type: "wake", source: ip, status: "accepted", detail: text.slice(0, 200) });
      res.json({ ok: true, mode: wakeMode, conversationId: targetConv.id });
    } catch (err: any) {
      logWebhook({ type: "wake", source: ip, status: "failed", detail: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hooks/agent", async (req: Request, res: Response) => {
    const ip = req.ip || "unknown";
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: "Too many failed attempts", retryAfter: 60 });
    }

    if (!authenticateWebhook(req)) {
      recordFailedAttempt(ip);
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { message, name, model, sessionKey, timeoutSeconds } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message field required (string)" });
    }

    const hookName = typeof name === "string" ? name : "Webhook";
    const hookModel = typeof model === "string" ? model : undefined;

    logWebhook({ type: "agent", source: ip, status: "accepted", detail: `${hookName}: ${message.slice(0, 200)}` });
    res.json({ ok: true, status: "accepted", hookName });

    setImmediate(async () => {
      try {
        const settings = await storage.getSettings();
        const persona = await storage.getActivePersona();

        const conv = await storage.createConversation({
          title: `[Hook] ${hookName}`,
          model: hookModel || settings?.defaultModel || "gemini-2.5-flash",
          thinking: settings?.thinkingEnabled ?? false,
          personaId: persona?.id || null,
        });

        await storage.createMessage({
          conversationId: conv.id,
          role: "user",
          content: `[${hookName} Hook] ${message}`,
        });

        const allMessages = await storage.getMessages(conv.id);
        const [memResult, enabledSkills, knResult] = await Promise.all([
          storage.getMemoryEntries(persona?.id),
          storage.getEnabledSkillsWithPrompts(),
          storage.getKnowledge(persona?.id),
        ]);

        const { prompt: systemPrompt } = await buildSystemPrompt(
          persona, memResult.data, settings, enabledSkills, knResult.data, false, "off", message
        );

        const chatMessages = windowMessages(
          allMessages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: stripThinkTags(m.content),
          }))
        );

        const { client, actualModelId } = await getClientForModel(hookModel || conv.model);
        const completion = await client.chat.completions.create({
          model: actualModelId,
          messages: [{ role: "system", content: systemPrompt }, ...chatMessages],
          max_completion_tokens: 16384,
        });

        const aiResponse = completion.choices[0]?.message?.content || "(no response)";
        await storage.createMessage({ conversationId: conv.id, role: "assistant", content: aiResponse });

        const mainConvs = await storage.getConversations(1, 0);
        const mainConv = mainConvs.data[0];
        if (mainConv) {
          await storage.createMessage({
            conversationId: mainConv.id,
            role: "system",
            content: `[Hook Summary: ${hookName}] ${aiResponse.slice(0, 500)}`,
          });
        }

        logWebhook({ type: "agent", source: ip, status: "completed", detail: `${hookName} → ${aiResponse.slice(0, 100)}` });
      } catch (err: any) {
        console.error(`[webhook] Agent hook error:`, err.message);
        logWebhook({ type: "agent", source: ip, status: "failed", detail: err.message });
      }
    });
  });

  app.get("/api/hooks/status", async (req: Request, res: Response) => {
    const token = req.headers.authorization?.replace("Bearer ", "") ||
                  (req.headers["x-visionclaw-token"] as string);
    const session = req.headers["x-session-token"] as string;

    const authed = (webhookConfig.enabled && token === webhookConfig.token) ||
                   (session && await isValidSession(session));

    if (!authed) return res.status(401).json({ error: "Unauthorized" });
    res.json(getWebhookStatus());
  });
}
