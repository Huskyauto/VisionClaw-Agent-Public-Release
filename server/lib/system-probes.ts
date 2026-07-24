/**
 * Tools-layer-split (girth-gate helper slice, mechanical move — no behavior
 * change): `testApiKeys` + `checkSystemStatus` helper bodies relocated from
 * server/tools.ts. Their legacy switch arms + definitions are unchanged —
 * this is a helper move (like safe-fetch.ts), NOT a domain migration; the
 * tools stay dispatched from the legacy switch per the S4 contract note.
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { PROVIDER_CONFIG, TEST_MODEL_IDS, getClientForModel } from "../providers";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { logSilentCatch } from "./silent-catch";
import { messages as messagesTable } from "@shared/schema";

async function getHeartbeatFns() {
  const mod = await import("../heartbeat");
  return { isHeartbeatRunning: mod.isHeartbeatRunning, delegateTaskFromChat: mod.delegateTaskFromChat };
}

const testModels = TEST_MODEL_IDS;


// S5: scan_file path-jail helpers (getScanAllowedRoots/isPathInsideRoot/scanFile)
// moved → server/tools/domains/files/handlers.ts with the scan_file arm.

export async function testApiKeys() {
  const keys = await storage.getProviderKeys();
  const results: Record<string, any> = {};
  results["replit"] = { connected: true, provider: "Replit AI (Built-in)", detail: "Always available" };

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
          results[key.provider] = { connected: true, provider: "Google Drive", detail: `OK - ${info.fileCount} files in backup folder (${latencyMs}ms)`, latencyMs };
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
        const resp = await fetchWithTimeout("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
          body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "Reply with only the word: connected" }], max_tokens: 10 }),
          timeoutMs: 30000,
        });
        const latencyMs = Date.now() - start;
        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "");
          throw new Error(`${resp.status} ${errBody.slice(0, 150)}`);
        }
        const data = await resp.json() as any;
        const reply = data.choices?.[0]?.message?.content?.trim() || "";
        results[key.provider] = { connected: true, provider: PROVIDER_CONFIG[key.provider]?.name || key.provider, detail: `OK - "${reply}" (${latencyMs}ms)`, latencyMs };
      } else {
        const { client, actualModelId } = await getClientForModel(modelId);
        const response = await client.chat.completions.create({
          model: actualModelId,
          // Perplexity's sonar models reject max_tokens < 16 ("max_tokens must be
          // at least 16 for sonar"), which surfaced as a false "connection issue".
          // 16 is the documented floor and is harmless for every other provider.
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply with only the word: connected" }],
        });
        const latencyMs = Date.now() - start;
        const reply = response.choices?.[0]?.message?.content?.trim() || "";
        results[key.provider] = { connected: true, provider: PROVIDER_CONFIG[key.provider]?.name || key.provider, detail: `OK - "${reply}" (${latencyMs}ms)`, latencyMs };
      }
    } catch (err: any) {
      results[key.provider] = { connected: false, provider: PROVIDER_CONFIG[key.provider]?.name || key.provider, detail: err.message?.slice(0, 200) || "Error", latencyMs: Date.now() - start };
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
        results["google_drive_token"] = { connected: true, provider: "Google Drive", detail: `OK - ${info.fileCount} files in backup folder (${latencyMs}ms)`, latencyMs };
      } else {
        results["google_drive_token"] = { connected: false, provider: "Google Drive", detail: info.error || "Failed to connect", latencyMs };
      }
    } catch (err: any) {
      results["google_drive_token"] = { connected: false, provider: "Google Drive", detail: err.message?.slice(0, 200) || "Token unavailable", latencyMs: Date.now() - start };
    }
  }

  return results;
}

export async function checkSystemStatus() {
  // Each probe is individually bounded + fail-soft. Previously this tool fired
  // several unbounded DB queries (getConversations, getMemoryStats, a full
  // count(*) on messages) in parallel and awaited them all; under DB load a
  // single slow query made the whole tool hang until the 90s outer tool-timeout
  // and return NOTHING. A slow/timing-out subsystem IS the health signal we
  // want to report, so wrap each probe: it resolves fast and the degraded probe
  // shows up as `{ ok:false }` instead of sinking the entire status check.
  const probe = async <T>(p: Promise<T> | (() => Promise<T>), ms = 6000): Promise<{ ok: true; value: T } | { ok: false; error: string; failedAt: number }> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const work = typeof p === "function" ? (p as () => Promise<T>)() : p;
      const value = await Promise.race([
        work,
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout (${ms}ms)`)), ms); }),
      ]);
      return { ok: true, value };
    } catch (e: any) {
      // failedAt enables first-failure-wins root-cause ordering below
      // (OpenClaw borrow, R125+137.22): the EARLIEST failure is usually the
      // root cause; later failures are often downstream symptoms of it.
      return { ok: false, error: e?.name === "AbortError" ? "aborted" : (e?.message || String(e)), failedAt: Date.now() };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // Web-server self-ping. Agents asked to "test all the systems" need a
  // first-class way to confirm THIS app's own HTTP server is serving. They
  // previously improvised localhost probes via the browser tool, exec curl,
  // and execute_code — all correctly blocked (SSRF / owner-only / sandbox) —
  // then gave up with an empty deliverable. probeWebServer runs IN the server
  // process against a fixed loopback target (not an agent-driven external
  // navigation), so it is the right place to answer "is the site up?".
  const { probeWebServer } = await import("./self-health");

  const [convR, settingsR, personaR, memStatsR, heartbeatR, tasksR, logsR, msgCountR, webServerR] = await Promise.all([
    probe(storage.getConversations()),
    probe(storage.getSettings()),
    probe(storage.getActivePersona()),
    probe(storage.getMemoryStats()),
    probe(getHeartbeatFns().then(h => h.isHeartbeatRunning())),
    probe(storage.getHeartbeatTasks()),
    probe(storage.getHeartbeatLogs(5)),
    probe(db.select({ count: sql<number>`count(*)::int` }).from(messagesTable).then(r => r[0]?.count ?? null)),
    probe(probeWebServer(parseInt(process.env.PORT || "5000", 10))),
  ]);

  const settings = settingsR.ok ? settingsR.value : null;
  const persona = personaR.ok ? personaR.value : null;
  const tasks = tasksR.ok ? tasksR.value : [];
  const logs = logsR.ok ? logsR.value : [];
  // Defense-in-depth: heartbeat `output` is runtime summaries/error text that
  // could (rarely) echo an env-secret value. Mask any process.env secret before
  // it reaches the model context. Env-driven redactor = cheap + sufficient here.
  const { redactSecrets } = await import("../redactor");
  const safeLogOutput = (o: string | null | undefined) => redactSecrets(o || "").slice(0, 600);

  // Surface which subsystems were slow/unreachable so "the system check came
  // back with errors" is actionable instead of an opaque 90s timeout.
  const degraded: string[] = [];
  const failures: Array<{ subsystem: string; error: string; failedAt: number }> = [];
  const noteFail = (name: string, r: { ok: boolean; error?: string; failedAt?: number }) => {
    degraded.push(name);
    failures.push({ subsystem: name, error: (r as any).error || "unknown", failedAt: (r as any).failedAt ?? Date.now() });
  };
  if (!convR.ok) noteFail("conversations", convR);
  if (!settingsR.ok) noteFail("settings", settingsR);
  if (!personaR.ok) noteFail("persona", personaR);
  if (!memStatsR.ok) noteFail("memory", memStatsR);
  if (!heartbeatR.ok) noteFail("heartbeat", heartbeatR);
  if (!tasksR.ok) noteFail("heartbeatTasks", tasksR);
  if (!logsR.ok) noteFail("heartbeatLogs", logsR);
  if (!msgCountR.ok) noteFail("messageCount", msgCountR);
  if (!webServerR.ok) noteFail("webServer", webServerR);
  else if ((webServerR.value as any)?.reachable === false) {
    degraded.push("webServer");
    failures.push({ subsystem: "webServer", error: (webServerR.value as any)?.error || "unreachable", failedAt: Date.now() });
  }

  // First-failure-wins root cause (OpenClaw borrow, R125+137.22): the probe
  // that failed EARLIEST is surfaced as the likely root cause — a DB stall
  // fails the fastest query first, then everything downstream piles on.
  // Later failures are kept in `failures[]` but never override rootCause.
  const rootCause = failures.length > 0
    ? failures.reduce((a, b) => (b.failedAt < a.failedAt ? b : a))
    : null;

  // Egress telemetry summary (R125+137.22): what the platform talked to
  // recently + what's failing. In-memory, host-only, fail-open.
  let egress: any = null;
  try {
    const { summarizeEgress } = await import("./egress-telemetry");
    egress = summarizeEgress();
  } catch (_silentErr) { logSilentCatch("server/tools.ts", _silentErr); }

  return {
    status: degraded.length === 0 ? "ok" : "degraded",
    degraded,
    rootCause: rootCause ? { subsystem: rootCause.subsystem, error: rootCause.error } : null,
    failures: failures.map(f => ({ subsystem: f.subsystem, error: f.error })),
    egress,
    uptime: process.uptime(),
    webServer: webServerR.ok ? webServerR.value : { reachable: false, error: webServerR.error },
    totalConversations: convR.ok ? (convR.value as any).total : null,
    totalMessages: msgCountR.ok ? msgCountR.value : null,
    activePersona: persona ? { name: persona.name, role: persona.role } : null,
    memory: memStatsR.ok ? memStatsR.value : { error: memStatsR.error },
    heartbeat: {
      running: heartbeatR.ok ? heartbeatR.value : null,
      totalTasks: tasks.length,
      enabledTasks: tasks.filter((t) => t.enabled).length,
      // Include the actual error text (the `output` column) for any non-success
      // run. Without it the agent sees only `{task, status:"error"}` with no
      // "why" — which is what made a persona flail to `exec`/file-reads (all
      // correctly blocked) and then give up when asked to investigate a failed
      // task. Surfacing the error inline makes ops failures diagnosable from
      // THIS tool instead of an owner-only shell.
      recentLogs: logs.map((l) => ({
        task: l.taskName,
        status: l.status,
        ranAt: l.createdAt,
        ...(l.status !== "success" ? { error: safeLogOutput(l.output) } : {}),
      })),
      // Prominent rollup so a failed task isn't buried in the log list — the
      // agent should read this first when asked "investigate the X issue".
      recentFailures: logs
        .filter((l) => l.status !== "success")
        .map((l) => ({ task: l.taskName, ranAt: l.createdAt, error: safeLogOutput(l.output) })),
    },
    agentName: settings?.agentName || (await import("../site-config")).siteConfig.platformName,
  };
}
