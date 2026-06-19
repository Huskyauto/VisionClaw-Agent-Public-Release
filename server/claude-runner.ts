import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";

import { logSilentCatch } from "./lib/silent-catch";
const BRIDGE_PORT = 7779;
const DEFAULT_MAX_TURNS = 10;
const KILL_ESCALATION_MS = 2000;
const REQUEST_TIMEOUT_MS = 120_000;
const CONSECUTIVE_FAILURE_THRESHOLD = 5;
const HEALTH_RECOVERY_MS = 300_000;

let bridgeRunning = false;
let bridgeHealthy = false;
let bridgeServer: ReturnType<typeof createServer> | null = null;
let totalRequests = 0;
let totalErrors = 0;
let consecutiveFailures = 0;
let lastHealthDegradedAt = 0;

const liveProcesses = new Map<string, { proc: ChildProcess; abortReason?: string; timeout?: ReturnType<typeof setTimeout> }>();

const ENV_ALLOWLIST = new Set([
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL",
  "NODE_PATH", "NODE_ENV", "NPM_CONFIG_PREFIX",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME",
  // CLAUDE_CODE_OAUTH_TOKEN = Bob's Claude Max subscription token (minted via
  // `claude setup-token`). When present the CLI bills his flat-rate plan instead
  // of per-token API. ANTHROPIC_API_KEY is the metered fallback.
  "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN",
]);

function buildSafeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
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

export function buildCliArgs(prompt: string, model: string, systemPrompt: string | undefined, outputFormat: "stream-json" | "json"): string[] {
  const args: string[] = [
    "claude",
    "-p", prompt,
    "--output-format", outputFormat,
    "--model", mapModelId(model),
    "--max-turns", String(DEFAULT_MAX_TURNS),
  ];

  // --verbose is REQUIRED by the CLI for stream-json print mode, but it CORRUPTS plain
  // `json` output into a stream-json event ARRAY — JSON.parse then yields an array, not
  // the single {result} object, and handleNonStreamingResponse returns the raw array as
  // the assistant content. Only add it on the streaming path.
  if (outputFormat === "stream-json") {
    args.push("--verbose");
  }

  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt.slice(0, 20000));
  }

  return args;
}

function spawnCli(args: string[], requestId: string): ChildProcess {
  const proc = spawn("npx", args, {
    env: buildSafeEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
  });

  const timeout = setTimeout(() => {
    const live = liveProcesses.get(requestId);
    if (live) {
      console.warn(`[claude-runner] Request ${requestId} timed out after ${REQUEST_TIMEOUT_MS}ms, killing`);
      live.abortReason = "timeout";
      live.proc.kill("SIGTERM");
      setTimeout(() => {
        try { live.proc.kill("SIGKILL"); } catch (_silentErr) { logSilentCatch("server/claude-runner.ts", _silentErr); }
      }, KILL_ESCALATION_MS);
    }
  }, REQUEST_TIMEOUT_MS);

  liveProcesses.set(requestId, { proc, timeout });
  return proc;
}

function cleanupProcess(requestId: string): void {
  const live = liveProcesses.get(requestId);
  if (live?.timeout) clearTimeout(live.timeout);
  liveProcesses.delete(requestId);
}

async function handleNonStreamingResponse(
  prompt: string,
  model: string,
  systemPrompt: string | undefined,
  res: ServerResponse,
  requestId: string
): Promise<void> {
  return new Promise((resolvePromise) => {
    const args = buildCliArgs(prompt, model, systemPrompt, "json");
    const proc = spawnCli(args, requestId);

    let stdoutBuf = "";
    let stderrBuf = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.on("close", (code) => {
      cleanupProcess(requestId);

      if (code !== 0 && code !== null) {
        recordFailure();
        console.warn(`[claude-runner] Non-stream process exited ${code}: ${stderrBuf.slice(0, 200)}`);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: `Claude CLI exited with code ${code}: ${stderrBuf.slice(0, 100)}`, type: "server_error" } }));
        }
        resolvePromise();
        return;
      }

      let resultText = "";
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        const parsed = JSON.parse(stdoutBuf.trim());
        if (parsed.result) {
          resultText = parsed.result;
        } else if (typeof parsed === "string") {
          resultText = parsed;
        } else {
          resultText = stdoutBuf.trim();
        }
        // The CLI result object carries token counts under .usage (input_tokens /
        // output_tokens), NOT the top-level num_input_tokens fields. Read usage first,
        // fall back to the legacy names for forward/backward compat.
        const usage = parsed.usage || {};
        inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? parsed.num_input_tokens ?? 0;
        outputTokens = usage.output_tokens ?? usage.completion_tokens ?? parsed.num_output_tokens ?? 0;
      } catch {
        resultText = stdoutBuf.trim();
      }

      if (!resultText) {
        recordFailure();
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Claude CLI returned empty response", type: "server_error" } }));
        resolvePromise();
        return;
      }

      recordSuccess();

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

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(completion));
      resolvePromise();
    });

    proc.on("error", (err) => {
      cleanupProcess(requestId);
      recordFailure();
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: `Claude CLI error: ${err.message}`, type: "server_error" } }));
      }
      resolvePromise();
    });

    res.on("close", () => {
      const live = liveProcesses.get(requestId);
      if (live) {
        live.abortReason = "client_disconnect";
        live.proc.kill("SIGTERM");
        setTimeout(() => {
          try { live.proc.kill("SIGKILL"); } catch (_silentErr) { logSilentCatch("server/claude-runner.ts", _silentErr); }
        }, KILL_ESCALATION_MS);
        cleanupProcess(requestId);
      }
    });
  });
}

async function handleStreamingResponse(
  prompt: string,
  model: string,
  systemPrompt: string | undefined,
  res: ServerResponse,
  requestId: string
): Promise<void> {
  return new Promise((resolvePromise) => {
    const args = buildCliArgs(prompt, model, systemPrompt, "stream-json");
    const proc = spawnCli(args, requestId);

    let stderrBuf = "";
    let headersSent = false;
    let gotContent = false;

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

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

    let lineBuffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const emitted = processNdjsonEvent(event, res, sendHeaders, requestId);
          if (emitted) gotContent = true;
        } catch (_silentErr) { logSilentCatch("server/claude-runner.ts", _silentErr); }
      }
    });

    proc.on("close", (code) => {
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer);
          const emitted = processNdjsonEvent(event, res, sendHeaders, requestId);
          if (emitted) gotContent = true;
        } catch (_silentErr) { logSilentCatch("server/claude-runner.ts", _silentErr); }
      }

      cleanupProcess(requestId);

      if (code !== 0 && code !== null && !headersSent) {
        recordFailure();
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: `Claude CLI exited with code ${code}: ${stderrBuf.slice(0, 100)}`, type: "server_error" } }));
        resolvePromise();
        return;
      }

      if (!gotContent && !headersSent) {
        recordFailure();
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Claude CLI produced no output", type: "server_error" } }));
        resolvePromise();
        return;
      }

      if (gotContent) recordSuccess();
      else recordFailure();

      sendHeaders();
      res.write(`data: [DONE]\n\n`);
      res.end();
      resolvePromise();
    });

    proc.on("error", (err) => {
      cleanupProcess(requestId);
      recordFailure();
      if (!headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: `Claude CLI error: ${err.message}`, type: "server_error" } }));
      }
      resolvePromise();
    });

    res.on("close", () => {
      const live = liveProcesses.get(requestId);
      if (live) {
        live.abortReason = "client_disconnect";
        live.proc.kill("SIGTERM");
        setTimeout(() => {
          try { live.proc.kill("SIGKILL"); } catch (_silentErr) { logSilentCatch("server/claude-runner.ts", _silentErr); }
        }, KILL_ESCALATION_MS);
        cleanupProcess(requestId);
      }
    });
  });
}

export function processNdjsonEvent(
  event: any,
  res: ServerResponse,
  sendHeaders: () => void,
  requestId: string
): boolean {
  if (event.type === "assistant") {
    // The CLI emits the assistant turn as a full message whose content is an array of
    // blocks: {type:"thinking",...} and {type:"text", text:"..."}. (There is no
    // event.subtype==="text" / top-level event.text — the original code matched a schema
    // the CLI never produces, so streaming emitted zero text.) Concatenate only the text
    // blocks; thinking-only events yield "" and are skipped.
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
      live: liveProcesses.size,
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
    recordFailure();
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: err.message || "Claude CLI failed", type: "server_error" } }));
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
        console.log(`[claude-runner] Bridge listening on 127.0.0.1:${BRIDGE_PORT}`);
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
  return { running: bridgeRunning, healthy: bridgeHealthy, requests: totalRequests, errors: totalErrors, consecutiveFailures, liveProcesses: liveProcesses.size };
}

export async function stopClaudeRunnerBridge(): Promise<void> {
  for (const [id, live] of liveProcesses) {
    if (live.timeout) clearTimeout(live.timeout);
    live.proc.kill("SIGTERM");
    liveProcesses.delete(id);
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
