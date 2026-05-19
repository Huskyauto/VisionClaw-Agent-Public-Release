// R74.13u — Stage 27 of routes.ts decomposition.
// 9 routes for the daily briefing surface, briefing widgets (user-configurable
// briefing items), AI-powered briefing generator, the corporation report PDF,
// and the activity pulse stream.
//
// Routes & gating preserved verbatim from monolith:
//   • GET /api/briefing                   — requirePlatformAdmin
//     (surfaces global heartbeat_logs + personas; non-admin tenants would
//      otherwise see cross-tenant operational telemetry — R66 follow-up)
//   • GET /api/briefing/widgets           — tenant
//   • POST /api/briefing/widgets          — tenant
//   • PATCH /api/briefing/widgets/:id     — tenant
//   • DELETE /api/briefing/widgets/:id    — tenant
//   • POST /api/briefing/generate         — tenant
//   • GET /api/briefing/latest            — tenant
//   • POST /api/reports/corporation       — tenant
//   • GET /api/activity/pulse             — requirePlatformAdmin
//     (R66 follow-up: surfaces global activeTaskTracker + heartbeat_logs)
//
// Heavy raw-SQL surface — uses db.execute(sql`…`) for briefing_widgets +
// briefing_reports + heartbeat / personas / conversations / memory_entries
// reads. No drizzle table objects from @shared/schema needed (raw SQL only).
//
// Extracted verbatim from server/routes.ts L5201-L5697.
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logSilentCatch } from "../lib/silent-catch";
import { activeTaskTracker, isHeartbeatRunning } from "../heartbeat";

type BriefingsHelpers = {
  getTenantFromRequest: (req: Request) => number | null;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerBriefingsRoutes(app: Express, helpers: BriefingsHelpers) {
  const { getTenantFromRequest, requirePlatformAdmin } = helpers;

  app.get("/api/briefing", async (req, res) => {
    // SECURITY (R66 follow-up): briefing surfaces global heartbeat_logs and
    // personas (platform-level tables with no tenant_id), so it must be
    // restricted to platform admin. Authenticated non-admin tenants previously
    // would have received cross-tenant operational telemetry.
    if (!requirePlatformAdmin(req, res)) return;
    const tenantId = getTenantFromRequest(req)!;
    try {
      const tz = (req.query.tz as string) || "UTC";
      let userNow: Date;
      try {
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hour12: false,
        });
        const parts = formatter.formatToParts(new Date());
        const get = (t: string) => parts.find(p => p.type === t)?.value || "0";
        userNow = new Date(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00`);
      } catch {
        userNow = new Date();
      }
      const userHour = userNow.getHours();

      const now = new Date();
      // Compute "today" in the USER's timezone, not the server's UTC clock.
      // userNow already reflects local wall-clock; subtract its time-of-day to
      // get midnight, then translate that wall-clock instant back to a real UTC
      // boundary using the server-vs-user offset for filtering DB rows.
      const offsetMs = now.getTime() - userNow.getTime();
      const userMidnight = new Date(userNow.getFullYear(), userNow.getMonth(), userNow.getDate());
      const todayStart = new Date(userMidnight.getTime() + offsetMs);
      const yesterdayStart = new Date(todayStart.getTime() - 86400000);

      let weather: { temp: string; condition: string; icon: string; location: string } | null = null;
      let lat = req.query.lat as string;
      let lon = req.query.lon as string;
      let geoCity = "";

      if (!lat || !lon) {
        try {
          const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
            || req.socket.remoteAddress || "";
          const isLocal = !clientIp || clientIp === "::1" || clientIp === "127.0.0.1" || clientIp.startsWith("10.") || clientIp.startsWith("192.168.");
          if (!isLocal) {
            const geoRes = await fetch(`http://ip-api.com/json/${clientIp}?fields=status,lat,lon,city,regionName`);
            if (geoRes.ok) {
              const geoData = await geoRes.json();
              if (geoData.status === "success" && geoData.lat && geoData.lon) {
                lat = String(geoData.lat);
                lon = String(geoData.lon);
                geoCity = geoData.city ? `${geoData.city}, ${geoData.regionName || ""}`.trim() : "";
              }
            }
          }
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      }

      if (lat && lon) {
        try {
          const wRes = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=${encodeURIComponent(tz)}`
          );
          if (wRes.ok) {
            const wData = await wRes.json();
            const temp = Math.round(wData.current?.temperature_2m ?? 0);
            const code = wData.current?.weather_code ?? 0;
            const wmoMap: Record<number, { condition: string; icon: string }> = {
              0: { condition: "Clear sky", icon: "☀️" },
              1: { condition: "Mostly clear", icon: "🌤️" },
              2: { condition: "Partly cloudy", icon: "⛅" },
              3: { condition: "Overcast", icon: "☁️" },
              45: { condition: "Foggy", icon: "🌫️" },
              48: { condition: "Icy fog", icon: "🌫️" },
              51: { condition: "Light drizzle", icon: "🌦️" },
              53: { condition: "Drizzle", icon: "🌦️" },
              55: { condition: "Heavy drizzle", icon: "🌧️" },
              61: { condition: "Light rain", icon: "🌧️" },
              63: { condition: "Rain", icon: "🌧️" },
              65: { condition: "Heavy rain", icon: "🌧️" },
              71: { condition: "Light snow", icon: "🌨️" },
              73: { condition: "Snow", icon: "❄️" },
              75: { condition: "Heavy snow", icon: "❄️" },
              77: { condition: "Snow grains", icon: "🌨️" },
              80: { condition: "Rain showers", icon: "🌦️" },
              81: { condition: "Moderate showers", icon: "🌧️" },
              82: { condition: "Heavy showers", icon: "⛈️" },
              85: { condition: "Snow showers", icon: "🌨️" },
              86: { condition: "Heavy snow showers", icon: "❄️" },
              95: { condition: "Thunderstorm", icon: "⛈️" },
              96: { condition: "Thunderstorm w/ hail", icon: "⛈️" },
              99: { condition: "Severe thunderstorm", icon: "⛈️" },
            };
            const w = wmoMap[code] || { condition: "Unknown", icon: "🌡️" };
            weather = { temp: `${temp}°F`, condition: w.condition, icon: w.icon, location: geoCity };
          }
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      }

      const [logs, convResult, personas, memStats] = await Promise.all([
        storage.getHeartbeatLogs(50),
        storage.getConversations(100, 0, tenantId),
        storage.getPersonas(),
        storage.getMemoryStats?.(undefined, tenantId) ?? Promise.resolve(null),
      ]);

      const todayLogs = logs.filter(l => new Date(l.createdAt) >= todayStart);
      const yesterdayLogs = logs.filter(l => {
        const d = new Date(l.createdAt);
        return d >= yesterdayStart && d < todayStart;
      });

      const convData = Array.isArray(convResult) ? convResult : (convResult as any)?.data ?? [];
      const todayConvs = convData.filter((c: any) => new Date(c.updatedAt) >= todayStart);

      const activeAgents = personas.filter(p => p.isActive).map(p => ({
        name: p.name,
        role: p.role,
        icon: p.icon,
      }));

      // "success" and "warning" are both completed-OK outcomes; "error" is the
      // only true failure. In-flight statuses ("running", "pending", null) are
      // counted as neither, matching the client's classification on home.tsx.
      const isSuccess = (s: string | null | undefined) => s === "success" || s === "warning";
      const isFailure = (s: string | null | undefined) => s === "error" || s === "failed" || s === "timeout";
      const todaySuccess = todayLogs.filter(l => isSuccess(l.status)).length;
      const todayFailed = todayLogs.filter(l => isFailure(l.status)).length;
      const yestSuccess = yesterdayLogs.filter(l => isSuccess(l.status)).length;

      const topTasks = todayLogs.slice(0, 5).map(l => ({
        name: (l as any).taskName || "Task",
        status: l.status,
        persona: (l as any).personaName || null,
        time: new Date(l.createdAt).toISOString(),
      }));

      const greeting = userHour < 12 ? "Good morning" : userHour < 17 ? "Good afternoon" : "Good evening";

      let localDate = "";
      try {
        localDate = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }).format(new Date());
      } catch {
        localDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      }

      res.json({
        greeting,
        localDate,
        localTime: userNow.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
        timezone: tz,
        weather,
        today: {
          tasksCompleted: todaySuccess,
          tasksFailed: todayFailed,
          conversations: todayConvs.length,
          topTasks,
        },
        yesterday: {
          tasksCompleted: yestSuccess,
        },
        activeAgents,
        memoryCount: memStats?.total ?? null,
        generatedAt: now.toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Briefing Widgets (user-configurable briefing items) ──
  app.get("/api/briefing/widgets", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const result = await db.execute(
        sql`SELECT * FROM briefing_widgets WHERE tenant_id = ${tenantId} ORDER BY sort_order, id`
      );
      res.json((result as any).rows || result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/briefing/widgets", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { label, prompt, widgetType, sortOrder } = req.body;
      if (!label || !prompt) return res.status(400).json({ error: "label and prompt are required" });
      const result = await db.execute(
        sql`INSERT INTO briefing_widgets (tenant_id, label, prompt, widget_type, sort_order)
            VALUES (${tenantId}, ${label}, ${prompt}, ${widgetType || "custom"}, ${sortOrder || 0})
            RETURNING *`
      );
      res.status(201).json(((result as any).rows || result)[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/briefing/widgets/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const updates: Record<string, any> = {};
      if (req.body.label !== undefined) updates.label = req.body.label;
      if (req.body.prompt !== undefined) updates.prompt = req.body.prompt;
      if (req.body.widgetType !== undefined) updates.widget_type = req.body.widgetType;
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
      if (req.body.sortOrder !== undefined) updates.sort_order = req.body.sortOrder;
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No fields to update" });
      const setFragments: any[] = [];
      if (updates.label !== undefined) setFragments.push(sql`label = ${updates.label}`);
      if (updates.prompt !== undefined) setFragments.push(sql`prompt = ${updates.prompt}`);
      if (updates.widget_type !== undefined) setFragments.push(sql`widget_type = ${updates.widget_type}`);
      if (updates.enabled !== undefined) setFragments.push(sql`enabled = ${updates.enabled}`);
      if (updates.sort_order !== undefined) setFragments.push(sql`sort_order = ${updates.sort_order}`);
      if (!setFragments.length) return res.status(400).json({ error: "No fields to update" });
      const result = await db.execute(
        sql`UPDATE briefing_widgets SET ${sql.join(setFragments, sql`, `)} WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING *`
      );
      const rows = (result as any).rows || result;
      if (!rows.length) return res.status(404).json({ error: "Widget not found" });
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/briefing/widgets/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      await db.execute(sql`DELETE FROM briefing_widgets WHERE id = ${id} AND tenant_id = ${tenantId}`);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── AI-Powered Briefing Generator ──
  app.post("/api/briefing/generate", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      let { tz, lat, lon } = req.body;
      const start = Date.now();

      if (!lat || !lon) {
        try {
          const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
            || req.socket.remoteAddress || "";
          const isLocal = !clientIp || clientIp === "::1" || clientIp === "127.0.0.1" || clientIp.startsWith("10.") || clientIp.startsWith("192.168.");
          if (!isLocal) {
            const geoRes = await fetch(`http://ip-api.com/json/${clientIp}?fields=status,lat,lon,city`);
            if (geoRes.ok) {
              const geoData = await geoRes.json();
              if (geoData.status === "success") { lat = geoData.lat; lon = geoData.lon; }
            }
          }
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      }

      const [widgets, logsResult, convResult, personasResult] = await Promise.all([
        db.execute(sql`SELECT * FROM briefing_widgets WHERE tenant_id = ${tenantId} AND enabled = true ORDER BY sort_order`).then(r => (r as any).rows || r),
        db.execute(sql`SELECT hl.* FROM heartbeat_logs hl JOIN heartbeat_tasks ht ON hl.task_id = ht.id WHERE ht.tenant_id = ${tenantId} ORDER BY hl.created_at DESC LIMIT 30`).then(r => (r as any).rows || r),
        db.execute(sql`SELECT * FROM conversations WHERE tenant_id = ${tenantId} ORDER BY updated_at DESC LIMIT 50`).then(r => (r as any).rows || r),
        db.execute(sql`SELECT * FROM personas`).then(r => (r as any).rows || r),
      ]);
      const logs = logsResult;
      const personas = personasResult;

      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayLogs = logs.filter((l: any) => new Date(l.created_at || l.createdAt) >= todayStart);
      const convData = convResult;
      const todayConvs = convData.filter((c: any) => new Date(c.updated_at || c.updatedAt) >= todayStart);

      let weatherInfo = "";
      if (lat && lon) {
        try {
          const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=${encodeURIComponent(tz || "UTC")}`);
          if (wRes.ok) {
            const wData = await wRes.json();
            weatherInfo = `Current weather: ${Math.round(wData.current?.temperature_2m || 0)}°F, weather code ${wData.current?.weather_code || 0}.`;
          }
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      }

      let widgetPrompts = "";
      if (widgets.length > 0) {
        widgetPrompts = "\n\nThe user has requested these custom briefing sections. Research and provide current data for each:\n";
        widgets.forEach((w: any, i: number) => {
          widgetPrompts += `\n${i + 1}. **${w.label}**: ${w.prompt}`;
        });
      }

      const briefingPrompt = `You are an executive AI assistant generating a personalized daily briefing. Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.
User timezone: ${tz || "UTC"}. ${weatherInfo}

System status today:
- ${todayLogs.filter((l: any) => l.status === "success").length} tasks completed, ${todayLogs.filter((l: any) => l.status !== "success").length} failed
- ${todayConvs.length} conversations today
- ${personas.filter((p: any) => p.is_active || p.isActive).length} AI agents active
- Recent task activity: ${todayLogs.slice(0, 5).map((l: any) => `${l.task_name || l.taskName} (${l.status})`).join(", ") || "none yet"}
${widgetPrompts}

Generate a concise, professional daily briefing with these sections (use markdown):
1. **Executive Summary** — 2-3 sentence overview of the day
2. **Weather** — Include the weather if available
3. **System Status** — Tasks, agents, and any issues to note
${widgets.length > 0 ? widgets.map((w: any, i: number) => `${i + 4}. **${w.label}** — Fresh data based on the user's request`).join("\n") : ""}
${widgets.length > 0 ? `${widgets.length + 4}` : "4"}. **Priorities** — Suggest 2-3 things to focus on today

Keep it concise — this is a morning briefing, not a novel. Use bullet points. Be direct and actionable.`;

      const { executeWithFailover } = await import("../model-failover");
      const { getAvailableModels } = await import("../providers");
      const availableModels = await getAvailableModels();
      const settings = await storage.getSettings();
      let model = settings?.defaultModel || "gpt-4.1";
      if (model === "auto") {
        model = availableModels.find((m: any) => m.id === "gpt-4.1" || m.id === "gpt-5.4")?.id || "gpt-4.1";
      }

      const { result: resp, usedModel } = await executeWithFailover(
        model, availableModels,
        async (client: any, actualModelId: string) => {
          return client.chat.completions.create({
            model: actualModelId,
            messages: [
              { role: "system", content: "You are an executive briefing assistant. Be concise, data-driven, and actionable. Use markdown formatting." },
              { role: "user", content: briefingPrompt },
            ],
            max_completion_tokens: 4096,
          });
        },
        tenantId
      );

      const content = resp.choices[0]?.message?.content || "(No briefing generated)";
      const durationMs = Date.now() - start;

      await db.execute(
        sql`INSERT INTO briefing_reports (tenant_id, content, generated_by, model, duration_ms)
            VALUES (${tenantId}, ${content}, ${"ai"}, ${usedModel}, ${durationMs})`
      );

      if (widgets.length > 0) {
        await db.execute(
          sql`UPDATE briefing_widgets SET last_updated_at = NOW() WHERE tenant_id = ${tenantId} AND enabled = true`
        );
      }

      res.json({ content, model: usedModel, durationMs, generatedAt: new Date().toISOString(), created_at: new Date().toISOString() });
    } catch (err: any) {
      console.error("[briefing] Generate error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/briefing/latest", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const result = await db.execute(
        sql`SELECT * FROM briefing_reports WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 1`
      );
      const rows = (result as any).rows || result;
      res.json(rows[0] || null);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/reports/corporation", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const [personasResult, tasksResult, logsResult, conversationsResult, memoriesResult] = await Promise.all([
        db.execute(sql`SELECT id, name, role, icon, is_active FROM personas`),
        db.execute(sql`SELECT COUNT(*) as total, COUNT(CASE WHEN enabled THEN 1 END) as active FROM heartbeat_tasks WHERE tenant_id = ${tenantId}`),
        db.execute(sql`SELECT COUNT(*) as total, COUNT(CASE WHEN hl.status = 'success' THEN 1 END) as success, COUNT(CASE WHEN hl.status != 'success' THEN 1 END) as errors FROM heartbeat_logs hl JOIN heartbeat_tasks ht ON hl.task_id = ht.id WHERE ht.tenant_id = ${tenantId} AND hl.created_at > NOW() - INTERVAL '30 days'`),
        db.execute(sql`SELECT COUNT(*) as total FROM conversations WHERE tenant_id = ${tenantId}`),
        db.execute(sql`SELECT COUNT(*) as total FROM memory_entries WHERE tenant_id = ${tenantId}`),
      ]);

      const personas = ((personasResult as any).rows || personasResult) as any[];
      const taskStats = ((tasksResult as any).rows || tasksResult)[0] || { total: 0, active: 0 };
      const logStats = ((logsResult as any).rows || logsResult)[0] || { total: 0, success: 0, errors: 0 };
      const convStats = ((conversationsResult as any).rows || conversationsResult)[0] || { total: 0 };
      const memStats = ((memoriesResult as any).rows || memoriesResult)[0] || { total: 0 };

      const now = new Date();
      const reportDate = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      const successRate = Number(logStats.total) > 0 ? ((Number(logStats.success) / Number(logStats.total)) * 100).toFixed(1) : "N/A";

      const sections = [
        {
          heading: "Executive Summary",
          body: `VisionClaw Corporation Status Report — ${reportDate}\n\nThis report provides a comprehensive overview of all corporation operations, AI agent team status, and system health metrics for the current period.`
        },
        {
          heading: "AI Agent Team",
          body: personas.map((p: any) => `• ${p.name} (${p.role}) — ${p.is_active ? "ACTIVE" : "Standby"}`).join("\n") + `\n\nTotal Agents: ${personas.length}\nActive: ${personas.filter((p: any) => p.is_active).length}\nStandby: ${personas.filter((p: any) => !p.is_active).length}`
        },
        {
          heading: "Operations & Task Performance",
          body: `Scheduled Tasks: ${taskStats.total} total, ${taskStats.active} active\nTask Executions (30 days): ${logStats.total}\nSuccess Rate: ${successRate}%\nSuccessful: ${logStats.success}\nErrors: ${logStats.errors}`
        },
        {
          heading: "Communications",
          body: `Total Conversations: ${convStats.total}`
        },
        {
          heading: "Memory & Knowledge Base",
          body: `Total Memories Stored: ${memStats.total}`
        },
        {
          heading: "System Health",
          body: `Database: Connected\nHeartbeat Engine: Running\nReport Generated: ${now.toISOString()}`
        },
      ];

      const { createPdf } = await import("../pdf-create");
      const result = await createPdf({
        title: `VisionClaw Corporation Report — ${reportDate}`,
        sections,
        outputPath: `uploads/corporation-report-${now.toISOString().slice(0, 10)}.pdf`,
        folderLabel: "Corporation Reports",
        tenantId: tenantId ?? undefined,
      } as any);

      if (result.success) {
        res.json({ success: true, url: result.url, path: result.path });
      } else {
        res.status(500).json({ error: result.error || "PDF generation failed" });
      }
    } catch (err: any) {
      console.error("[corp-report]", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/activity/pulse", async (req, res) => {
    // SECURITY (R66 follow-up): pulse surfaces global heartbeat_logs, personas
    // and the platform-wide activeTaskTracker. Restrict to platform admin —
    // non-admin tenants would otherwise see operational telemetry from the
    // entire platform.
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const [recentLogs, personas] = await Promise.all([
        storage.getHeartbeatLogs(15),
        storage.getPersonas(),
      ]);
      const personaMap = new Map(personas.map(p => [p.id, p]));
      const now = Date.now();
      const fiveMinAgo = now - 5 * 60 * 1000;

      const running = Array.from(activeTaskTracker.entries()).map(([taskId, info]) => {
        const persona = info.personaId ? personaMap.get(info.personaId) : null;
        return {
          id: taskId,
          agent: persona?.name || info.personaName || "System",
          icon: persona?.icon || "🦞",
          task: info.taskName,
          status: "running" as const,
          durationMs: now - info.startedAt,
        };
      });

      const recent = recentLogs
        .filter(l => new Date(l.createdAt).getTime() > fiveMinAgo)
        .slice(0, 8)
        .map(l => {
          const persona = l.personaId ? personaMap.get(l.personaId) : null;
          return {
            id: l.id,
            agent: persona?.name || l.personaName || "System",
            icon: persona?.icon || "🦞",
            task: l.taskName,
            status: l.status === "error" ? "failed" as const : "done" as const,
            durationMs: l.durationMs || 0,
          };
        });

      res.json({
        alive: true,
        heartbeatRunning: isHeartbeatRunning(),
        activeCount: running.length,
        active: running,
        recent,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ alive: false, error: err.message, activeCount: 0, active: [], recent: [] });
    }
  });
}
