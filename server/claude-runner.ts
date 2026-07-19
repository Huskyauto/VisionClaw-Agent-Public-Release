import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { query } from "@anthropic-ai/claude-agent-sdk";

import { logSilentCatch } from "./lib/silent-catch";
const BRIDGE_PORT = 7779;
const DEFAULT_MAX_TURNS = 10;
const REQUEST_TIMEOUT_MS = 120_000;
const CONSECUTIVE_FAILURE_THRESHOLD = 5;
const HEALTH_RECOVERY_MS = 300_000;
const SYSTEM_PROMPT_MAX_CHARS = 20_000;

let bridgeRunning = false;
let bridgeHealthy = false;
let bridgeServer: ReturnType<typeof createServer> | null = null;
let totalRequests = 0;
let totalErrors = 0;
let consecutiveFailures = 0;
let lastHealthDegradedAt = 0;

// Live in-flight SDK queries. The AbortController cancels the underlying
// `claude` CLI subprocess the SDK manages (SIGTERM under the hood).
const liveQueries = new Map<string, { abort: AbortController; abortReason?: string; timeout?: ReturnType<typeof setTimeout> }>();

const ENV_ALLOWLIST = new Set([
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL",
  "NODE_PATH", "NODE_ENV", "NPM_CONFIG_PREFIX",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME",
  // CLAUDE_CODE_OAUTH_TOKEN = Bob's Claude Max subscription token (minted via
  // `claude setup-token`). When present the CLI bills his flat-rate plan instead
  // of per-token API. ANTHROPIC_API_KEY is the metered fallback.
  "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN",
]);

// The Agent SDK's `env` option REPLACES the subprocess environment entirely
// (it is not merged with process.env), which is exactly the isolation the old
// spawn path wanted — so the same allowlist doubles as the full child env.
export function buildSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  const home = env.HOME || "/home/runner";
  if (!env.XDG_CONFIG_HOME) env.XDG_CONFIG_HOME = `${home}/.config`;
  if (!env.XDG_DATA_HOME) env.XDG_DATA_HOME = `${home}/.local/share`;
  if (!env.XDG_CACHE_HOME) env.XDG_CACHE_HOME = `${home}/.cache`;
  if (!env.XDG_STATE_HOME) env.XDG_STATE_HOME = `${home}/.local/state`;
  // Prefer the Claude subscription token over the metered API key. If both are
  // present the CLI would otherwise use ANTHROPIC_API_KEY (per-token billing),
  // defeating the point of the Max plan — so drop the API key from the child
  // env when the OAuth subscription token is available.
  if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    delete env.ANTHROPIC_API_KEY;
  }
  return env;
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content == null) return "";
  return String(content);
}

const PROMPT_HISTORY_MAX = 24;
const PROMPT_MAX_CHARS = 48_000;

function extractPromptFromMessages(messages: Array<{ role: string; content: unknown }>): string {
  const conversational = messages
    .filter((m) => m.role !== "system")
    .slice(-PROMPT_HISTORY_MAX)
    .map((m) => {
      const text = flattenContent(m.content).trim();
      if (!text) return "";
      const label = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : m.role === "tool" ? "Tool" : m.role;
      return `${label}:\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n");

  if (conversational.length <= PROMPT_MAX_CHARS) return conversational;
  return `[Earlier conversation truncated]\n\n${conversational.slice(-PROMPT_MAX_CHARS)}`;
}

function extractSystemPrompt(messages: Array<{ role: string; content: unknown }>): string | undefined {
  const systemMsgs = messages.filter((m) => m.role === "system");
  if (systemMsgs.length === 0) return undefined;
  return systemMsgs.map((m) => flattenContent(m.content)).filter(Boolean).join("\n\n");
}

export function mapModelId(model: string): string {
  // The Claude Code CLI (verified against v2.1.169) accepts the platform's BARE Claude
  // version ids directly — claude-opus-4-8 / 4-7 / 4-6 / 4-5, claude-sonnet-4-6 / 4-5,
  // claude-haiku-4-5, claude-opus-4-20250514 — plus the family aliases opus/sonnet/haiku.
  // It returns 404 "model may not exist" on several dated-suffix ids. The previous table
  // remapped WORKING bare ids onto those 404 ids (e.g. claude-haiku-4-5 →
  // claude-haiku-4-5-20250115, claude-sonnet-4-6 → claude-sonnet-4-20250514), so EVERY
  // Claude bridge call failed once the CLI was actually installed. Now we remap ONLY the
  // known-bad ids onto a verified-working equivalent and pass everything else through.
  const remap: Record<string, string> = {
    "claude-sonnet-4-20250514": "claude-sonnet-4-5",
    "claude-opus-4-5-20250115": "claude-opus-4-5",
    "claude-haiku-4-5-20250115": "claude-haiku-4-5",
    "claude-sonnet-4": "claude-sonnet-4-5",
  };
  return remap[model] || model;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  if (!bridgeHealthy && Date.now() - lastHealthDegradedAt > HEALTH_RECOVERY_MS) {
    bridgeHealthy = true;
    console.log("[claude-runner] Bridge health recovered after successful request");
  }
}

function recordFailure(): void {
  totalErrors++;
  consecutiveFailures++;
  if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD && bridgeHealthy) {
    bridgeHealthy = false;
    lastHealthDegradedAt = Date.now();
    console.warn(`[claude-runner] Bridge marked unhealthy after ${consecutiveFailures} consecutive failures — falling back to API`);
  }
}

// Pure builder for the Agent SDK query options this bridge controls. Kept pure
// (no env / abortController / cwd — the caller layers those on) so the unit
// tests can pin the contract: model remap applied, `tools: []` (the bridge is
// TEXT-ONLY — an empty array disables every built-in agent tool: Bash, Edit,
// WebSearch, ...), bounded turns, and system prompt capped + omitted-when-absent.
export function buildQueryOptions(model: string, systemPrompt: string | undefined): {
  model: string;
  maxTurns: number;
  tools: never[];
  systemPrompt?: string;
} {
  const opts: { model: string; maxTurns: number; tools: never[]; systemPrompt?: string } = {
    model: mapModelId(model),
    maxTurns: DEFAULT_MAX_TURNS,
    tools: [],
  };
  if (systemPrompt) {
    opts.systemPrompt = systemPrompt.slice(0, SYSTEM_PROMPT_MAX_CHARS);
  }
  return opts;
}

function startQuery(prompt: string, model: string, systemPrompt: string | undefined, requestId: string) {
  const abort = new AbortController();
  const timeout = setTimeout(() => {
    const live = liveQueries.get(requestId);
    if (live) {
      console.warn(`[claude-runner] Request ${requestId} timed out after ${REQUEST_TIMEOUT_MS}ms, aborting`);
      live.abortReason = "timeout";
      live.abort.abort();
    }
  }, REQUEST_TIMEOUT_MS);
  liveQueries.set(requestId, { abort, timeout });

  return query({
    prompt,
    options: {
      ...buildQueryOptions(model, systemPrompt),
      env: buildSafeEnv(),
      cwd: process.cwd(),
      abortController: abort,
    },
  });
}

function cleanupQuery(requestId: string): void {
  const live = liveQueries.get(requestId);
  if (live?.timeout) clearTimeout(live.timeout);
  liveQueries.delete(requestId);
}

function abortOnClientDisconnect(res: ServerResponse, requestId: string): void {
  res.on("close", () => {
    const live = liveQueries.get(requestId);
    if (live) {
      live.abortReason = "client_disconnect";
      live.abort.abort();
      cleanupQuery(requestId);
    }
  });
}

function extractAssistantText(message: any): string {
  const blocks = Array.isArray(message?.message?.content) ? message.message.content : [];
  return blocks
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("");
}

async function handleNonStreamingResponse(
  prompt: string,
  model: string,
  systemPrompt: string | undefined,
  res: ServerResponse,
  requestId: string
): Promise<void> {
  abortOnClientDisconnect(res, requestId);

  let assistantText = "";
  let resultMsg: any = null;

  try {
    const q = startQuery(prompt, model, systemPrompt, requestId);
    for await (const msg of q as AsyncIterable<any>) {
      if (msg.type === "assistant") {
        assistantText += extractAssistantText(msg);
      } else if (msg.type === "result") {
        resultMsg = msg;
      }
    }
  } catch (err: any) {
    const live = liveQueries.get(requestId);
    const reason = live?.abortReason;
    cleanupQuery(requestId);
    recordFailure();
    if (!res.headersSent && !res.writableEnded) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: reason === "timeout" ? "Claude query timed out" : `Claude query error: ${err?.message || String(err)}`, type: "server_error" } }));
    }
    return;
  }

  cleanupQuery(requestId);

  // Prefer the CLI's own final result string (same field the old `--output-format
  // json` path read); fall back to concatenated assistant text blocks.
  let resultText = "";
  if (resultMsg && resultMsg.subtype === "success" && typeof resultMsg.result === "string" && resultMsg.result) {
    resultText = resultMsg.result;
  } else {
    resultText = assistantText;
  }

  if (!resultText || resultMsg?.is_error) {
    recordFailure();
    if (!res.headersSent && !res.writableEnded) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: resultMsg?.is_error ? `Claude query failed (${resultMsg.subtype || "error"})` : "Claude query returned empty response", type: "server_error" } }));
    }
    return;
  }

  recordSuccess();

  const usage = resultMsg?.usage || {};
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;

  const completion = {
    id: `chatcmpl-${requestId}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: `claude-runner/${model}`,
    choices: [{
      index: 0,
      message: { role: "assistant", content: resultText },
      finish_reason: "stop",
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };

  if (!res.headersSent && !res.writableEnded) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(completion));
  }
}

async function handleStreamingResponse(
  prompt: string,
  model: string,
  systemPrompt: string | undefined,
  res: ServerResponse,
  requestId: string
): Promise<void> {
  abortOnClientDisconnect(res, requestId);

  let headersSent = false;
  let sawText = false;
  let sawErrorResult = false;

  const sendHeaders = () => {
    if (headersSent) return;
    headersSent = true;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Request-Id": requestId,
    });
  };

  try {
    const q = startQuery(prompt, model, systemPrompt, requestId);
    for await (const msg of q as AsyncIterable<any>) {
      if (msg.type === "result" && msg.is_error) {
        // Do NOT forward an error result as a finish_reason:"stop" chunk — that
        // would make a failed run look like a successful completion to clients.
        sawErrorResult = true;
        continue;
      }
      try {
        const emitted = processNdjsonEvent(msg, res, sendHeaders, requestId);
        if (emitted && msg.type === "assistant") sawText = true;
      } catch (_silentErr) { logSilentCatch("server/claude-runner.ts", _silentErr); }
    }
  } catch (err: any) {
    const live = liveQueries.get(requestId);
    const reason = live?.abortReason;
    cleanupQuery(requestId);
    recordFailure();
    if (!headersSent && !res.headersSent && !res.writableEnded) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: reason === "timeout" ? "Claude query timed out" : `Claude query error: ${err?.message || String(err)}`, type: "server_error" } }));
      return;
    }
    // Mid-stream failure: close the SSE stream cleanly so the client sees EOF.
    if (!res.writableEnded) {
      res.write(`data: [DONE]\n\n`);
      res.end();
    }
    return;
  }

  cleanupQuery(requestId);

  // Success requires assistant text AND a non-error terminal result.
  if (sawErrorResult || !sawText) {
    recordFailure();
    const message = sawErrorResult ? "Claude query failed" : "Claude query produced no output";
    if (!headersSent && !res.headersSent && !res.writableEnded) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message, type: "server_error" } }));
    } else if (!res.writableEnded) {
      // Headers already sent mid-stream: surface an explicit SSE error event
      // (OpenAI stream-error contract) instead of a success-looking [DONE].
      res.write(`data: ${JSON.stringify({ error: { message, type: "server_error" } })}\n\n`);
      res.end();
    }
    return;
  }

  recordSuccess();
  sendHeaders();
  if (!res.writableEnded) {
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
}

// Converts one Agent SDK message into an OpenAI chat.completion.chunk SSE write.
// The SDK's message shapes are the SAME wire shapes the CLI's stream-json mode
// emitted (the SDK drives the same subprocess): assistant turns arrive as
// {type:"assistant", message:{content:[{type:"text"|"thinking",...}]}} and the
// terminal event as {type:"result", usage:{input_tokens,output_tokens}}.
export function processNdjsonEvent(
  event: any,
  res: ServerResponse,
  sendHeaders: () => void,
  requestId: string
): boolean {
  if (event.type === "assistant") {
    // Concatenate only the text blocks; thinking-only events yield "" and are skipped.
    const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
    let text = blocks
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("");
    if (!text && typeof event.text === "string") text = event.text; // defensive fallback
    if (!text) return false;
    sendHeaders();
    const chunk = {
      id: `chatcmpl-${requestId}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "claude-runner",
      choices: [{
        index: 0,
        delta: { content: text },
        finish_reason: null,
      }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    return true;
  } else if (event.type === "result") {
    sendHeaders();
    // Token counts live under event.usage (input_tokens / output_tokens), not the
    // top-level num_input_tokens fields the original code read.
    const usage = event.usage || {};
    const inTok = usage.input_tokens ?? usage.prompt_tokens ?? event.num_input_tokens ?? 0;
    const outTok = usage.output_tokens ?? usage.completion_tokens ?? event.num_output_tokens ?? 0;
    const chunk = {
      id: `chatcmpl-${requestId}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "claude-runner",
      choices: [{
        index: 0,
        delta: {},
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: inTok,
        completion_tokens: outTok,
        total_tokens: inTok + outTok,
      },
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    return true;
  }
  return false;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: bridgeHealthy ? "ok" : "degraded",
      requests: totalRequests,
      errors: totalErrors,
      consecutiveFailures,
      live: liveQueries.size,
    }));
    return;
  }

  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      object: "list",
      data: [
        { id: "claude-opus-4-8", object: "model", owned_by: "claude-runner" },
        { id: "claude-opus-4-7", object: "model", owned_by: "claude-runner" },
        { id: "claude-opus-4-6", object: "model", owned_by: "claude-runner" },
        { id: "claude-sonnet-4-6", object: "model", owned_by: "claude-runner" },
        { id: "claude-opus-4-20250514", object: "model", owned_by: "claude-runner" },
        { id: "claude-sonnet-4-20250514", object: "model", owned_by: "claude-runner" },
      ],
    }));
    return;
  }

  if (req.method !== "POST" || !req.url?.startsWith("/v1/chat/completions")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Not found", type: "invalid_request_error" } }));
    return;
  }

  totalRequests++;

  const body = await new Promise<string>((resolveBody, rejectBody) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => resolveBody(data));
    req.on("error", (err) => rejectBody(err));
    req.on("aborted", () => rejectBody(new Error("Request aborted")));
  }).catch(() => "");

  if (!body) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Empty or aborted request", type: "invalid_request_error" } }));
    return;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Invalid JSON", type: "invalid_request_error" } }));
    return;
  }

  const messages = parsed.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "No messages provided", type: "invalid_request_error" } }));
    return;
  }

  const model = parsed.model ?? "claude-opus-4-6";
  const stream = parsed.stream === true;
  const prompt = extractPromptFromMessages(messages);
  const systemPrompt = extractSystemPrompt(messages);

  if (!prompt) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "No user message found", type: "invalid_request_error" } }));
    return;
  }

  const requestId = `cr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    if (stream) {
      await handleStreamingResponse(prompt, model, systemPrompt, res, requestId);
    } else {
      await handleNonStreamingResponse(prompt, model, systemPrompt, res, requestId);
    }
  } catch (err: any) {
    cleanupQuery(requestId);
    recordFailure();
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: err.message || "Claude query failed", type: "server_error" } }));
    }
  }
}

async function killPortHolder(port: number): Promise<boolean> {
  try {
    // R125+13.19+sec1 — sanitize env to strip loader-hijack vectors.
    const { execSync } = await import("node:child_process");
    const { sanitizeSpawnEnv } = await import("./safety/spawn-env-guard");
    const pids = execSync(`lsof -ti :${port} 2>/dev/null || true`, { timeout: 5000, env: sanitizeSpawnEnv(process.env) }).toString().trim();
    if (!pids) return false;
    for (const pid of pids.split("\n").filter(Boolean)) {
      const pidNum = parseInt(pid, 10);
      if (isNaN(pidNum) || pidNum === process.pid) continue;
      try {
        process.kill(pidNum, "SIGTERM");
        console.log(`[claude-runner] Killed stale process ${pidNum} on port ${port}`);
      } catch (_silentErr) { logSilentCatch("server/claude-runner.ts", _silentErr); }
    }
    return true;
  } catch {
    return false;
  }
}

function attemptListen(maxRetries: number = 3): Promise<boolean> {
  let attempt = 0;

  function tryBind(): Promise<boolean> {
    return new Promise((resolve) => {
      attempt++;
      bridgeServer = createServer((req, res) => {
        handleRequest(req, res).catch((err) => {
          console.error("[claude-runner] Unhandled request error:", err.message);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Internal bridge error", type: "server_error" } }));
          }
        });
      });

      bridgeServer.listen(BRIDGE_PORT, "127.0.0.1", () => {
        bridgeRunning = true;
        bridgeHealthy = true;
        console.log(`[claude-runner] Bridge listening on 127.0.0.1:${BRIDGE_PORT} (Agent SDK backend)`);
        resolve(true);
      });

      bridgeServer.on("error", async (err: any) => {
        if (err.code === "EADDRINUSE" && attempt < maxRetries) {
          console.warn(`[claude-runner] Port ${BRIDGE_PORT} in use (attempt ${attempt}/${maxRetries}), killing stale process...`);
          bridgeServer?.close();
          bridgeServer = null;
          const killed = await killPortHolder(BRIDGE_PORT);
          if (killed) {
            const waitMs = 500 * attempt;
            console.log(`[claude-runner] Waiting ${waitMs}ms for port to free...`);
            await new Promise(r => setTimeout(r, waitMs));
          } else {
            await new Promise(r => setTimeout(r, 1000));
          }
          resolve(tryBind());
        } else {
          if (err.code === "EADDRINUSE") {
            console.error(`[claude-runner] Port ${BRIDGE_PORT} still in use after ${maxRetries} attempts, bridge disabled`);
          } else {
            console.error("[claude-runner] Bridge server error:", err.message);
          }
          bridgeRunning = false;
          bridgeHealthy = false;
          resolve(false);
        }
      });
    });
  }

  return tryBind();
}

export async function startClaudeRunnerBridge(): Promise<boolean> {
  if (bridgeRunning) return true;

  try {
    const { execSync } = await import("node:child_process");
    const { sanitizeSpawnEnv } = await import("./safety/spawn-env-guard");
    const version = execSync("npx claude --version 2>/dev/null", { timeout: 10000, env: sanitizeSpawnEnv(process.env) }).toString().trim();
    if (!version.includes("Claude")) {
      console.log("[claude-runner] Claude CLI not found, bridge disabled");
      return false;
    }
    console.log(`[claude-runner] Found CLI: ${version}`);
  } catch {
    console.log("[claude-runner] Claude CLI not available, bridge disabled");
    return false;
  }

  return attemptListen(3);
}

export function isClaudeRunnerAvailable(): boolean {
  if (!bridgeRunning) return false;
  if (!bridgeHealthy) {
    if (Date.now() - lastHealthDegradedAt > HEALTH_RECOVERY_MS) {
      bridgeHealthy = true;
      consecutiveFailures = 0;
      console.log("[claude-runner] Health recovery timer expired, re-enabling bridge");
      return true;
    }
    return false;
  }
  return true;
}

export function getClaudeRunnerBaseUrl(): string {
  return `http://127.0.0.1:${BRIDGE_PORT}/v1`;
}

export function getClaudeRunnerStats(): { running: boolean; healthy: boolean; requests: number; errors: number; consecutiveFailures: number; liveProcesses: number } {
  return { running: bridgeRunning, healthy: bridgeHealthy, requests: totalRequests, errors: totalErrors, consecutiveFailures, liveProcesses: liveQueries.size };
}

export async function stopClaudeRunnerBridge(): Promise<void> {
  for (const [id, live] of liveQueries) {
    if (live.timeout) clearTimeout(live.timeout);
    live.abortReason = "bridge_shutdown";
    live.abort.abort();
    liveQueries.delete(id);
  }
  if (bridgeServer) {
    await new Promise<void>((resolve) => {
      bridgeServer!.close(() => resolve());
    });
    bridgeServer = null;
  }
  bridgeRunning = false;
  bridgeHealthy = false;
}
