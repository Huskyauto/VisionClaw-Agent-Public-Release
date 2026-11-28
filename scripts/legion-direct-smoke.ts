/**
 * Explicit DEVELOPMENT-ONLY bounded operator smoke, not app activation.
 * No arbitrary prompts, URLs, tenant ids, production flags or hosted fallback.
 * Usage: nix-build nix/legion-tailscale.nix --out-link generated-artifacts/legion-tailscale
 *        npx tsx scripts/legion-direct-smoke.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import http from "node:http";
import { Pool } from "pg";
import { sanitizeSpawnEnv } from "../server/safety/spawn-env-guard";
import { claimNodeIdentity } from "../server/legion/node-store";
import { LEGION_TAG, legionRequest } from "../server/legion/proxy-client";
import { startTailnetNode } from "../server/legion/local-api";
import { LEGION_MODEL, LEGION_REASONING_MODEL, guardLocalMessages } from "../server/legion/model-policy";

const bin = join(process.cwd(), "generated-artifacts/legion-tailscale/bin");
const scope = { tenantId: 1, environment: "development" as const };
const childEnv = sanitizeSpawnEnv({
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpdir(),
  SSL_CERT_FILE: process.env.SSL_CERT_FILE, NIX_SSL_CERT_FILE: process.env.NIX_SSL_CERT_FILE,
});
let phase = "preflight";
const networkOnly = process.argv.length === 3 && process.argv[2] === "--network-only";
let daemon: ChildProcess | undefined;
let interrupted = false;
const diagnostics = new Set<string>();
function classifyDiagnostic(value: string) {
  const patterns: [string, RegExp][] = [
    ["auth_key_rejected", /invalid.*(?:auth|key)|(?:auth|key).*(?:invalid|expired|revoked|not found)/i],
    ["tag_rejected", /(?:tag).*(?:not permitted|invalid|not allowed|unauthorized)/i],
    ["network_timeout", /timeout|deadline exceeded/i],
    ["dns_failure", /no such host|dns.*(?:fail|error)/i],
    ["tls_failure", /tls.*(?:fail|error)|certificate.*(?:invalid|expired|unknown)/i],
    ["connection_refused", /connection refused|network is unreachable/i],
    ["permission_denied", /permission denied|access denied/i],
    ["device_approval_required", /machine.*(?:not authorized|approval)|needsmachineauth/i],
  ];
  for (const [code, pattern] of patterns) if (pattern.test(value)) diagnostics.add(code);
}
function stop() { interrupted = true; daemon?.kill("SIGTERM"); }
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
const deadline = setTimeout(stop, 210_000);

function cli(socket: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(bin, "tailscale"), [`--socket=${socket}`, ...args], {
      env: childEnv, stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), 50_000);
    child.stdout.on("data", chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) child.kill("SIGKILL");
      else chunks.push(Buffer.from(chunk));
    });
    // Never print provider/CLI errors which might echo join material.
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new Error("Legion CLI could not start")); });
    child.on("close", code => {
      clearTimeout(timer);
      // status --json exits 1 for NeedsLogin but still returns the useful state.
      if ((code !== 0 && !(code === 1 && args[0] === "status")) || interrupted) reject(new Error("Legion CLI refused or timed out"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end();
  });
}

/** Fixed diagnostic TCP handshakes, not a general fetch/URL exception.
 * Failure alone cannot distinguish an ACL drop from an offline listener. */
async function checkForbiddenDestinations() {
  const targets = ["100.73.84.100:22", "100.73.84.100:443",
    "100.73.84.100:11435", "100.64.0.1:11434"];
  const results = await Promise.all(targets.map(target => new Promise<{ target: string; connected: boolean }>(resolve => {
    const request = http.request({ host: "127.0.0.1", port: 10551,
      method: "CONNECT", path: target, headers: { Host: target } });
    const timer = setTimeout(() => { request.destroy(); resolve({ target, connected: false }); }, 8000);
    request.on("connect", (response, socket) => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ target, connected: response.statusCode === 200 });
    });
    request.on("response", response => {
      clearTimeout(timer); response.resume();
      resolve({ target, connected: false });
    });
    request.on("error", () => { clearTimeout(timer); resolve({ target, connected: false }); });
    request.end();
  })));
  console.log(JSON.stringify({ event: "legion_negative_tcp", results,
    evidenceLimit: "Failed dials alone do not distinguish ACL denial from unavailable listeners" }));
  if (results.some(result => result.connected)) throw new Error("Forbidden tailnet destination reachable");
}

async function runCycle(pool: Pool, cycle: number) {
  phase = `identity-claim-${cycle}`;
  const identity = await claimNodeIdentity(pool, scope, process.env.SESSION_SECRET || "");
  const dir = await mkdtemp(join(tmpdir(), "visionclaw-legion-"));
  const stateFile = join(dir, "tailscaled.state");
  const socket = join(dir, "tailscaled.sock");
  let started = false;
  let stopped = false;
  let checkpointTimer: ReturnType<typeof setInterval> | undefined;
  let saving = Promise.resolve();
  let checkpointFailed = false;
  let exit: Promise<unknown> | undefined;
  const checkpoint = async () => {
    const info = await stat(stateFile);
    if (!info.isFile() || info.size < 2 || info.size > 1024 * 1024) throw new Error("Invalid daemon state file");
    await identity.save(await readFile(stateFile, "utf8"));
  };
  try {
    if (identity.state !== null) await writeFile(stateFile, identity.state, { mode: 0o600, flag: "wx" });
    phase = `daemon-start-${cycle}`;
    daemon = spawn(join(bin, "tailscaled"), [
      "--tun=userspace-networking", `--state=${stateFile}`, `--socket=${socket}`,
      "--outbound-http-proxy-listen=127.0.0.1:10551", "--port=0", "--no-logs-no-support",
    ], { env: childEnv, stdio: ["ignore", "ignore", "pipe"] });
    // Classify in memory; never retain or print daemon log values/login URLs.
    daemon.stderr?.on("data", chunk => classifyDiagnostic(chunk.toString("utf8")));
    exit = once(daemon, "exit");
    // Attach error handling before doing other work.
    void exit.catch(() => { checkpointFailed = true; });
    started = true;
    for (let i = 0; i < 40; i++) {
      if (interrupted || daemon.exitCode !== null || checkpointFailed) throw new Error("Legion daemon did not become ready");
      if (await stat(socket).then(() => true, () => false)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const version = (await cli(socket, ["version"])).trim().split("\n")[0];
    if (version !== "1.104.7") throw new Error("Unexpected Tailscale binary version");
    phase = `tailnet-join-${cycle}`;
    phase = `tailnet-status-${cycle}`;
    let status = JSON.parse(await cli(socket, ["status", "--json"]));
    if (status.BackendState !== "Running") {
      if (!process.env.TAILSCALE_AUTH_KEY) throw new Error("Join credential unavailable");
      phase = `tailnet-authenticate-${cycle}`;
      await startTailnetNode(socket, process.env.TAILSCALE_AUTH_KEY, "development",
        status.BackendState === "NeedsLogin" || status.HaveNodeKey === false);
      for (let i = 0; i < 40; i++) {
        if (interrupted) throw new Error("Tailnet join interrupted");
        status = JSON.parse(await cli(socket, ["status", "--json"]));
        if (status.BackendState === "Running") break;
        if (status.BackendState === "NeedsMachineAuth") throw new Error("Tailnet device approval required");
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    phase = `tailnet-tag-check-${cycle}`;
    if (Array.isArray(status.Health)) for (const health of status.Health) {
      if (typeof health === "string") classifyDiagnostic(health);
    }
    console.log(JSON.stringify({ event: "legion_tailnet_status", cycle,
      backendState: status.BackendState, tags: status.Self?.Tags ?? [],
      diagnostics: status.BackendState === "Running" ? [] : [...diagnostics],
      deviceApprovalRequired: status.BackendState === "NeedsMachineAuth" }));
    if (status.BackendState !== "Running" || status.Self?.Tags?.length !== 1 ||
        status.Self.Tags[0] !== LEGION_TAG) throw new Error("Legion node is not running under the exclusive service tag");
    // Save identity BEFORE any request to the Lenovo.
    await checkpoint();
    checkpointTimer = setInterval(() => {
      saving = saving.then(checkpoint).catch(() => {
        checkpointFailed = true; daemon?.kill("SIGTERM");
      });
    }, 2000);
    phase = `legion-health-${cycle}`;
    const versionReply = await legionRequest(10551, "/api/version");
    const inventory = await legionRequest(10551, "/api/tags");
    const names = inventory.models?.map((m: { name: string }) => m.name);
    if (![LEGION_MODEL, LEGION_REASONING_MODEL].every(name => names?.includes(name))) {
      throw new Error("Legion model inventory mismatch");
    }
    console.log(JSON.stringify({ event: "legion_health", cycle, tailscale: version,
      nodeId: status.Self.ID, tags: status.Self.Tags, ollama: versionReply.version, models: names,
      restored: identity.state !== null }));
    if (cycle === 1) {
      phase = "forbidden-destination-checks";
      await checkForbiddenDestinations();
    }
    if (cycle === 1 && !networkOnly) {
      phase = "synthetic-completion";
      const start = performance.now();
      const reply = await legionRequest(10551, "/v1/chat/completions", {
        model: LEGION_MODEL, messages: guardLocalMessages([{ role: "user", content: "Reply with exactly: LOCAL MODEL OK" }]),
        temperature: 0, max_tokens: 1024, stream: false,
      }, 120_000);
      if (reply.model !== LEGION_MODEL || reply.choices?.[0]?.message?.content?.trim() !== "LOCAL MODEL OK") {
        throw new Error("Local synthetic completion failed exact model/content check");
      }
      console.log(JSON.stringify({ event: "legion_completion", provider: "legion-local",
        model: reply.model, fingerprint: reply.system_fingerprint, content: "LOCAL MODEL OK",
        latencyMs: Math.round(performance.now() - start), usage: reply.usage, inferenceCostUsd: 0,
        hostedFallback: false }));
    }
    if (interrupted || checkpointFailed) throw new Error("Legion smoke interrupted or checkpoint failed");
    return status.Self.ID as string;
  } finally {
    if (checkpointTimer) clearInterval(checkpointTimer);
    await saving;
    if (daemon && started) {
      if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGTERM");
      const killTimer = setTimeout(() => daemon?.kill("SIGKILL"), 5000);
      try { await exit; stopped = true; } finally { clearTimeout(killTimer); }
    }
    // A failed save retains the permanent fence. Never infer completion or
    // release ownership before observed daemon exit + durable final identity.
    try {
      if (!started || stopped) {
        if (started) await checkpoint();
        await identity.releaseAfterStop();
      }
    } finally {
      if (!started || stopped) await rm(dir, { recursive: true, force: true });
      daemon = undefined;
    }
  }
}

async function main() {
  if (process.env.REPL_ID !== "45b6d1c0-f690-443b-a4f3-d57f5cba126d" ||
      process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production") {
    throw new Error("Smoke is original-workspace development only");
  }
  if (process.argv.length > 2 && !networkOnly) throw new Error("Unsupported smoke arguments");
  if (!process.env.SESSION_SECRET || !process.env.TAILSCALE_AUTH_KEY) throw new Error("Required Secrets unavailable");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1,
    connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 });
  try {
    const first = await runCycle(pool, 1);
    if (networkOnly) return;
    const second = await runCycle(pool, 2);
    if (first !== second) throw new Error("Daemon identity changed after restore");
    console.log(JSON.stringify({ event: "legion_restart", sameNode: true, productionVerified: false }));
  } finally { await pool.end(); }
}

main().catch(() => {
  console.error(JSON.stringify({ event: "legion_smoke_failed", phase,
    message: "Bounded development probe failed; no hosted fallback or production activation" }));
  process.exitCode = 1;
}).finally(() => {
  clearTimeout(deadline);
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
});
