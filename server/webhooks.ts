import type { Request, Response, Express } from "express";
import crypto from "crypto";
import { storage } from "./storage";
import { buildSystemPrompt, stripThinkTags, windowMessages } from "./chat-engine";
import { getClientForModel } from "./providers";
import { isValidSession, getSessionSync, ADMIN_TENANT_ID } from "./auth";

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
// Bound the map so an attacker rotating source IPs can't grow it forever.
// Round 16 fix: previously this only pruned entries when an existing IP
// re-hit the endpoint, leaving every unique attacker IP in memory.
const MAX_FAILED_TRACKED_IPS = 5_000;

function pruneFailedAttempts() {
  const now = Date.now();
  for (const [ip, rec] of failedAttempts) {
    if (now - rec.lastAttempt > 60_000) failedAttempts.delete(ip);
  }
  if (failedAttempts.size > MAX_FAILED_TRACKED_IPS) {
    // Hard cap: drop the oldest half. Worst case an attacker resets their
    // own counter; legitimate users are unaffected because the prune
    // already removed expired entries above.
    const entries = [...failedAttempts.entries()].sort((a, b) => a[1].lastAttempt - b[1].lastAttempt);
    const dropCount = Math.floor(entries.length / 2);
    for (let i = 0; i < dropCount; i++) failedAttempts.delete(entries[i][0]);
  }
}
// Periodic sweep — cheap because the map is bounded.
setInterval(pruneFailedAttempts, 60_000).unref();

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
  // Defensive: if the map got large between sweeps (burst attack), prune now.
  if (failedAttempts.size > MAX_FAILED_TRACKED_IPS) pruneFailedAttempts();
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

      // R74.12 — Single-tenant platform: webhooks are owned by Bob (admin tenant).
      // SaaS migration would route by signed payload claim → channel_subscriptions.
      // For now, ADMIN_TENANT_ID is greppable single source of truth (was: literal 1).
      // R74.12 hot-fix #2 — getConversations(limit, offset, tenantId): the previous
      // call was `getConversations(1, 0)` with NO tenant scope, meaning "newest conv
      // across ALL tenants" — real cross-tenant leak path. Now scoped to admin.
      const conversations = await storage.getConversations(1, 0, ADMIN_TENANT_ID);
      let targetConv = conversations.data[0];
      if (!targetConv) {
        targetConv = await storage.createConversation({
          tenantId: ADMIN_TENANT_ID,
          title: "Webhook Wake",
          model: settings?.defaultModel || "gemini-2.5-flash",
          thinking: settings?.thinkingEnabled ?? false,
          personaId: persona?.id || null,
        });
      }

      await storage.createMessage({
        tenantId: ADMIN_TENANT_ID,
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

        // R74.12 — Single-tenant platform: webhook agent runs in admin context.
        const conv = await storage.createConversation({
          tenantId: ADMIN_TENANT_ID,
          title: `[Hook] ${hookName}`,
          model: hookModel || settings?.defaultModel || "gemini-2.5-flash",
          thinking: settings?.thinkingEnabled ?? false,
          personaId: persona?.id || null,
        });

        await storage.createMessage({
          tenantId: ADMIN_TENANT_ID,
          conversationId: conv.id,
          role: "user",
          content: `[${hookName} Hook] ${message}`,
        });

        const allMessages = await storage.getMessages(conv.id, ADMIN_TENANT_ID);
        const [memResult, enabledSkills, knResult] = await Promise.all([
          storage.getMemoryEntries(persona?.id, 100, 0, ADMIN_TENANT_ID),
          storage.getEnabledSkillsWithPrompts(),
          storage.getKnowledge(persona?.id, 100, 0, ADMIN_TENANT_ID),
        ]);

        const { prompt: systemPrompt } = await buildSystemPrompt(
          persona, memResult.data, settings, enabledSkills, knResult.data, false, "off", message, ADMIN_TENANT_ID
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
          messages: [{ role: "system" as const, content: systemPrompt }, ...chatMessages] as any,
          max_completion_tokens: 16384,
        });

        const aiResponse = completion.choices[0]?.message?.content || "(no response)";
        await storage.createMessage({ tenantId: ADMIN_TENANT_ID, conversationId: conv.id, role: "assistant", content: aiResponse });

        // R74.12 hot-fix #2 — was unscoped (cross-tenant leak); now scoped to admin.
        const mainConvs = await storage.getConversations(1, 0, ADMIN_TENANT_ID);
        const mainConv = mainConvs.data[0];
        if (mainConv) {
          await storage.createMessage({
            tenantId: ADMIN_TENANT_ID,
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

    // Two valid auth modes:
    //   (1) external caller with the configured global webhook token, OR
    //   (2) an ADMIN session — not just any signed-in user. Hook status
    //       reveals process-global config and should not leak to non-admin
    //       tenants on a multi-tenant deployment.
    const sessionData = session ? getSessionSync(session) : null;
    const authed = (webhookConfig.enabled && token && token === webhookConfig.token) ||
                   (sessionData?.isAdmin === true);

    if (!authed) return res.status(401).json({ error: "Unauthorized" });
    res.json(getWebhookStatus());
  });
}
