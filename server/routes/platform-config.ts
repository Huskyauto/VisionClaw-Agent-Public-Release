// R74.13t — Stage 21 of routes.ts decomposition.
// 7 routes for Platform Configuration: agent settings + provider keys + model
// catalog. /api/settings (GET, PUT), /api/models (GET), /api/provider-keys
// (GET, PUT/:provider, DELETE/:provider, POST /test). Gating preserved verbatim
// from monolith: PUT /api/settings + all /api/provider-keys writes (PUT, DELETE,
// /test POST) call `requirePlatformAdmin` because settings + provider keys are
// global state. **GET /api/settings has NO admin gate** — any process caller
// reads agent name + personality + default model + thinking flag (sensitive
// fields like discordBotToken and accessPin are masked in the response handler
// at L36-L48). This was the original routes.ts behavior (HEAD~4 L4628 — also
// no admin gate); architect's R74.13t MEDIUM-5 finding flagged this for
// awareness, not regression. **GET /api/models** is tenant-scoped (returns the
// model list available to the requester's tenant; admin tenants get the full
// catalog including platform-only models). The
// /test handler runs a real connectivity probe against each provider (OpenAI
// chat, Anthropic chat, Gemini chat, OpenRouter chat, Stoooq, Groq chat,
// Google Drive token-refresh + folder list — full multi-provider switch kept
// verbatim). The local `requireAdmin` wrapper used in routes.ts was inlined
// to direct `requirePlatformAdmin` calls (semantically identical).
// Extracted verbatim from server/routes.ts L4528-L4789.
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { maskApiKey, PROVIDER_CONFIG, clearClientCache, getAvailableModelsForTenant, getClientForModel } from "../providers";
import { setAccessPin, clearAllSessions } from "../auth";
import { startDiscordBot, stopDiscordBot } from "../discord";
import { insertSettingsSchema } from "@shared/schema";
import { logSilentCatch } from "../lib/silent-catch";

type PlatformConfigHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
  ADMIN_TENANT_ID: number;
};

export function registerPlatformConfigRoutes(app: Express, helpers: PlatformConfigHelpers) {
  const { getTenantFromRequest, requirePlatformAdmin, ADMIN_TENANT_ID } = helpers;


  app.get("/api/settings", async (req, res) => {
    const s = await storage.getSettings();
    // R77.7: `personality` is the platform's system prompt and `defaultModel`
    // reveals routing internals — gate both behind auth. agentName + flags
    // remain public so the unauth widget can still render the title.
    const isAuthed = !!getTenantFromRequest(req);
    if (!s) {
      const { siteConfig: _sc } = await import("../site-config");
      return res.json({
        agentName: _sc.platformName,
        personality: isAuthed ? `You are ${_sc.platformName}, a helpful personal AI assistant.` : null,
        defaultModel: isAuthed ? "gemini-2.5-flash" : null,
        thinkingEnabled: false,
        discordBotToken: null,
        accessPin: null,
      });
    }
    const safeResponse: Record<string, any> = {
      id: s.id,
      agentName: s.agentName,
      personality: isAuthed ? s.personality : null,
      defaultModel: isAuthed ? s.defaultModel : null,
      thinkingEnabled: s.thinkingEnabled,
      discordBotToken: s.discordBotToken ? s.discordBotToken.slice(0, 8) + "..." : null,
      accessPin: s.accessPin ? "***configured***" : null,
      telegramBotToken: s.telegramBotToken ? "***configured***" : null,
      whatsappApprovalPhone: s.whatsappApprovalPhone ? "***configured***" : null,
    };
    res.json(safeResponse);
  });

  app.put("/api/settings", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const parsed = insertSettingsSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const existingSettings = await storage.getSettings();
    const { siteConfig: _sc2 } = await import("../site-config");
    const defaults = {
      agentName: _sc2.platformName,
      personality: `You are ${_sc2.platformName}, a helpful personal AI assistant.`,
      defaultModel: "gemini-2.5-flash",
      thinkingEnabled: false,
    };

    const updateData: any = {
      agentName: parsed.data.agentName ?? existingSettings?.agentName ?? defaults.agentName,
      personality: parsed.data.personality ?? existingSettings?.personality ?? defaults.personality,
      defaultModel: parsed.data.defaultModel ?? existingSettings?.defaultModel ?? defaults.defaultModel,
      thinkingEnabled: parsed.data.thinkingEnabled ?? existingSettings?.thinkingEnabled ?? defaults.thinkingEnabled,
    };

    if (parsed.data.discordBotToken !== undefined) {
      updateData.discordBotToken = parsed.data.discordBotToken || null;
      const oldToken = existingSettings?.discordBotToken;
      const newToken = parsed.data.discordBotToken;
      if (newToken && newToken !== oldToken) {
        startDiscordBot(newToken).catch((err: any) => {
          console.error("[discord] Failed to start bot:", err.message);
        });
      } else if (!newToken && oldToken) {
        stopDiscordBot().catch(() => {});
      }
    }

    if (parsed.data.accessPin !== undefined) {
      if (parsed.data.accessPin) {
        updateData.accessPin = await setAccessPin(parsed.data.accessPin);
      } else {
        updateData.accessPin = null;
      }
      await clearAllSessions();
    }

    const s = await storage.upsertSettings(updateData);
    const response = { ...s };
    if (response.discordBotToken) {
      response.discordBotToken = response.discordBotToken.slice(0, 8) + "...";
    }
    if (response.accessPin) {
      response.accessPin = "***configured***";
    }
    res.json(response);
  });

  // ─── Provider Keys & Models ──────────────────────────────
  app.get("/api/models", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const isAdmin = tenantId === ADMIN_TENANT_ID;
    const available = await getAvailableModelsForTenant(tenantId, isAdmin);
    res.json({ models: available, providers: PROVIDER_CONFIG });
  });

  app.get("/api/provider-keys", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const keys = await storage.getProviderKeys();
    const masked = keys.map((k) => ({
      ...k,
      apiKey: k.apiKey.slice(0, 8) + "..." + k.apiKey.slice(-4),
    }));
    res.json(masked);
  });

  app.put("/api/provider-keys/:provider", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const { provider } = req.params;
    const validProviders = Object.keys(PROVIDER_CONFIG).filter((p) => p !== "replit");
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ error: "Invalid provider" });
    }
    const existing = await storage.getProviderKey(provider);
    const rawKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : "";
    const sanitizedKey = rawKey
      .replace(/\u2014/g, "-")  // em-dash → hyphen
      .replace(/\u2013/g, "-")  // en-dash → hyphen
      .replace(/\u2018|\u2019/g, "'")  // curly single quotes
      .replace(/\u201C|\u201D/g, '"')  // curly double quotes
      .replace(/[^\x20-\x7E]/g, "");   // strip any remaining non-ASCII
    const apiKey = sanitizedKey || existing?.apiKey;
    if (!apiKey) return res.status(400).json({ error: "API key required" });
    const enabled = typeof req.body.enabled === "boolean" ? req.body.enabled : true;
    clearClientCache();
    const key = await storage.upsertProviderKey({ provider, apiKey, enabled, baseUrl: null });
    res.json({ ...key, apiKey: key.apiKey.slice(0, 8) + "..." + key.apiKey.slice(-4) });
  });

  app.delete("/api/provider-keys/:provider", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    clearClientCache();
    await storage.deleteProviderKey((req.params.provider as string));
    res.json({ ok: true });
  });

  app.post("/api/provider-keys/test", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    clearClientCache();
    const keys = await storage.getProviderKeys();
    const results: Record<string, { connected: boolean; provider: string; detail: string; latencyMs?: number }> = {};

    results["replit"] = { connected: true, provider: "Replit AI (Built-in)", detail: "Always available - no API key needed" };

    const { TEST_MODEL_IDS } = await import("../providers");
    const testModels = TEST_MODEL_IDS;

    for (const key of keys) {
      if (!key.enabled) {
        results[key.provider] = { connected: false, provider: PROVIDER_CONFIG[key.provider]?.name || key.provider, detail: "Key disabled" };
        continue;
      }

      if (key.provider === "google_drive_token") {
        const start = Date.now();
        try {
          const { forceTokenRefresh, getDriveFolderInfo } = await import("../google-drive");
          await forceTokenRefresh();
          const info = await getDriveFolderInfo();
          const latencyMs = Date.now() - start;
          if (info.success) {
            results[key.provider] = { connected: true, provider: "Google Drive", detail: `OK - ${info.fileCount} files in backup folder`, latencyMs };
          } else {
            results[key.provider] = { connected: false, provider: "Google Drive", detail: info.error || "Failed to connect", latencyMs };
          }
        } catch (err: any) {
          results[key.provider] = { connected: false, provider: "Google Drive", detail: err.message?.slice(0, 200) || "Unknown error", latencyMs: Date.now() - start };
        }
        continue;
      }

      const modelId = testModels[key.provider];
      if (!modelId) {
        results[key.provider] = { connected: false, provider: PROVIDER_CONFIG[key.provider]?.name || key.provider, detail: "Unknown provider" };
        continue;
      }

      const start = Date.now();
      try {
        if (key.provider === "xai") {
          const apiKey = key.apiKey;
          const resp = await fetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "Reply with only the word: connected" }], max_tokens: 16 }),
          });
          const latencyMs = Date.now() - start;
          if (!resp.ok) {
            const errBody = await resp.text().catch(() => "");
            throw new Error(`${resp.status} ${errBody.slice(0, 150)}`);
          }
          const data = await resp.json() as any;
          const reply = data.choices?.[0]?.message?.content?.trim() || "";
          results[key.provider] = { connected: true, provider: PROVIDER_CONFIG[key.provider]?.name || key.provider, detail: `OK - replied "${reply}" (${modelId})`, latencyMs };
        } else {
          const { client, actualModelId } = await getClientForModel(modelId);
          const response = await client.chat.completions.create({
            model: actualModelId,
            // Perplexity's sonar models reject max_tokens < 16; keep the probe at
            // the documented floor so a healthy key never reports a false failure.
            max_tokens: 16,
            messages: [{ role: "user", content: "Reply with only the word: connected" }],
          });
          const latencyMs = Date.now() - start;
          const reply = response.choices?.[0]?.message?.content?.trim() || "";
          results[key.provider] = {
            connected: true,
            provider: PROVIDER_CONFIG[key.provider]?.name || key.provider,
            detail: `OK - replied "${reply}" (${actualModelId})`,
            latencyMs,
          };
        }
      } catch (err: any) {
        const isClaudeRunnerError = key.provider === "anthropic" && (
          err.message?.includes("Claude CLI") ||
          err.message?.includes("claude-runner") ||
          err.message?.includes("127.0.0.1:7779") ||
          err.status === 502 ||
          err.message?.includes("ECONNREFUSED")
        );
        if (isClaudeRunnerError) {
          console.warn(`[test-keys] Anthropic via Runner failed (${err.message?.slice(0, 80)}), retrying direct API...`);
          try {
            const directClient = new (await import("openai")).default({
              apiKey: key.apiKey,
              baseURL: "https://api.anthropic.com/v1/",
            });
            const resp2 = await directClient.chat.completions.create({
              model: modelId,
              max_tokens: 16,
              messages: [{ role: "user", content: "Reply with only the word: connected" }],
            });
            const latencyMs = Date.now() - start;
            const reply = resp2.choices?.[0]?.message?.content?.trim() || "";
            results[key.provider] = {
              connected: true,
              provider: PROVIDER_CONFIG[key.provider]?.name || key.provider,
              detail: `OK - replied "${reply}" (direct API, Runner unavailable)`,
              latencyMs,
            };
            continue;
          } catch (err2: any) {
            console.error(`[test-keys] Anthropic direct API also failed: ${err2.message?.slice(0, 150)}`);
          }
        }
        const latencyMs = Date.now() - start;
        console.error(`[test-keys] ${key.provider} failed: ${err.message?.slice(0, 150)}`);
        results[key.provider] = {
          connected: false,
          provider: PROVIDER_CONFIG[key.provider]?.name || key.provider,
          detail: err.message?.slice(0, 200) || "Unknown error",
          latencyMs,
        };
      }
    }

    if (!results["google_drive_token"]) {
      const start = Date.now();
      try {
        const { forceTokenRefresh, getDriveFolderInfo } = await import("../google-drive");
        await forceTokenRefresh();
        const info = await getDriveFolderInfo();
        const latencyMs = Date.now() - start;
        if (info.success) {
          results["google_drive_token"] = { connected: true, provider: "Google Drive", detail: `OK - ${info.fileCount} files in backup folder`, latencyMs };
        } else {
          results["google_drive_token"] = { connected: false, provider: "Google Drive", detail: info.error || "Failed to connect", latencyMs };
        }
      } catch (err: any) {
        results["google_drive_token"] = { connected: false, provider: "Google Drive", detail: err.message?.slice(0, 200) || "Token unavailable", latencyMs: Date.now() - start };
      }
    }

    res.json(results);
  });

}
