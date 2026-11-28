import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import { Pool } from "pg";
import { sanitizeSpawnEnv } from "../safety/spawn-env-guard";
import { claimNodeIdentity } from "./node-store";
import { startTailnetNode } from "./local-api";
import { LEGION_TAG } from "./proxy-client";

export function legionBackgroundConfiguration(env: NodeJS.ProcessEnv = process.env) {
  if (env.LEGION_BACKGROUND_ENABLED !== "1")
    return { enabled: false, reason: "background_flag_disabled" } as const;
  // Published runtimes need not carry the editor's workspace ID. Replit owns
  // this domain list; the generated hostname belongs only to the original
  // deployment. Never trust request Host, a copied custom domain, or a flag alone.
  const primary = env.REPLIT_DEPLOYMENT === "1"
    ? env.REPLIT_DOMAINS?.split(",").some(domain => domain.trim() === "vison-claw-agent.replit.app") === true
    : env.REPL_ID === "45b6d1c0-f690-443b-a4f3-d57f5cba126d";
  if (!primary)
    return { enabled: false, reason: "not_primary_project" } as const;
  return { enabled: true, reason: "enabled" } as const;
}
export function legionBackgroundEnabled() {
  return legionBackgroundConfiguration().enabled;
}
export const legionProduction = () => process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production";
export const legionProxyPort = () => legionProduction() ? 10552 : 10551;
// Separate bounded pool: no app pool monopolization or runtime schema repair.
let pool: Pool | undefined;
export function legionPool() {
  // Two held inference connections plus supervisor/checkpoint and operator
  // headroom. A busy pair must never starve the private identity supervisor.
  return pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 4,
    connectionTimeoutMillis: 4000, statement_timeout: 5000, query_timeout: 6000,
    allowExitOnIdle: true });
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let stopping = false;
let supervising: Promise<void> | undefined;
let daemon: ChildProcess | undefined;
let ready = false;
let shutdown = new AbortController();
export const legionShutdownSignal = () => shutdown.signal;
export const legionRuntimeReady = () => ready && !stopping && legionBackgroundEnabled();

interface Status { BackendState?: string; Version?: string; Self?: { Tags?: string[] } }
function status(socketPath: string): Promise<Status> {
  return new Promise((resolve, reject) => {
    const request = http.get({ socketPath, path: "/localapi/v0/status",
      headers: { Host: "local-tailscaled.sock" } }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 256_000) request.destroy();
        else chunks.push(Buffer.from(chunk));
      });
      response.on("error", () => reject(new Error("Legion status interrupted")));
      response.on("end", () => {
        try {
          if (response.statusCode !== 200) throw new Error();
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch { reject(new Error("Legion status unavailable")); }
      });
    });
    const timer = setTimeout(() => request.destroy(), 2500);
    request.once("close", () => clearTimeout(timer));
    request.once("error", () => reject(new Error("Legion status unavailable")));
  });
}
function verify(value: Status) {
  if (value.BackendState !== "Running" || value.Self?.Tags?.length !== 1 ||
      value.Self.Tags[0] !== LEGION_TAG || !/^1\.104\.7(?:-|$)/.test(value.Version || "")) {
    throw new Error("Legion daemon identity/version is not approved");
  }
}

async function cycle() {
  const environment = legionProduction() ? "production" : "development";
  const identity = await claimNodeIdentity(legionPool(), { tenantId: 1, environment }, process.env.SESSION_SECRET || "");
  let dir: string | undefined;
  let child: ChildProcess | undefined;
  let observedStop = false;
  let closed: Promise<boolean> | undefined;
  const checkpoint = async () => {
    const path = join(dir!, "tailscaled.state");
    const info = await stat(path);
    if (!info.isFile() || info.size < 2 || info.size > 1024 * 1024) throw new Error("Legion state unavailable");
    await identity.save(await readFile(path, "utf8"));
  };
  try {
    dir = await mkdtemp(join(tmpdir(), "visionclaw-legion-app-"));
    const stateFile = join(dir, "tailscaled.state");
    const socket = join(dir, "tailscaled.sock");
    if (identity.state !== null) await writeFile(stateFile, identity.state, { mode: 0o600, flag: "wx" });
    const binary = join(process.cwd(), legionProduction() ? "dist/legion/bin/tailscaled"
      : "generated-artifacts/legion-tailscale/bin/tailscaled");
    child = spawn(binary, ["--tun=userspace-networking", `--state=${stateFile}`, `--socket=${socket}`,
      `--outbound-http-proxy-listen=127.0.0.1:${legionProxyPort()}`, "--port=0", "--no-logs-no-support"],
    { env: sanitizeSpawnEnv({ PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpdir(),
      SSL_CERT_FILE: process.env.SSL_CERT_FILE, NIX_SSL_CERT_FILE: process.env.NIX_SSL_CERT_FILE }),
      stdio: ["ignore", "ignore", "pipe"] });
    daemon = child;
    child.stderr?.resume(); // Raw daemon logs can contain login material.
    child.on("error", () => { ready = false; });
    closed = new Promise(resolve => child!.once("close", () => { observedStop = true; ready = false; resolve(true); }));
    for (let i = 0; i < 40; i++) {
      if (stopping || observedStop || !legionBackgroundEnabled()) throw new Error("Legion startup stopped");
      if (await stat(socket).then(() => true, () => false)) break;
      await delay(250);
    }
    let current = await status(socket);
    if (current.BackendState !== "Running") {
      await startTailnetNode(socket, process.env.TAILSCALE_AUTH_KEY || "", environment,
        current.BackendState === "NeedsLogin");
      for (let i = 0; i < 40; i++) {
        if (stopping || observedStop || !legionBackgroundEnabled()) throw new Error("Legion startup stopped");
        current = await status(socket);
        if (current.BackendState === "Running") break;
        if (current.BackendState === "NeedsMachineAuth") throw new Error("Legion requires operator approval");
        await delay(500);
      }
    }
    verify(current);
    await checkpoint(); // Never serve inference before identity is durable.
    ready = true;
    console.log(`[legion] supervised ${environment} node ready; fixed Ollama route only`);
    void import("./warmup").then(module => module.warmLegionModel())
      .catch(() => console.warn("[legion] optional model warmup unavailable"));
    let lastWarmup = Date.now();
    let lastCheckpoint = Date.now();
    while (!stopping && !observedStop && legionBackgroundEnabled()) {
      await delay(1000);
      if (Date.now() - lastWarmup >= 240_000) {
        lastWarmup = Date.now();
        void import("./warmup").then(module => module.warmLegionModel())
          .catch(() => console.warn("[legion] optional model warmup unavailable"));
      }
      if (Date.now() - lastCheckpoint >= 30_000) {
        verify(await status(socket));
        await checkpoint();
        lastCheckpoint = Date.now();
      }
    }
  } finally {
    ready = false;
    if (child && !observedStop) {
      child.kill("SIGTERM");
      if (!(await Promise.race([closed!, delay(5000).then(() => false)]))) {
        child.kill("SIGKILL");
        await Promise.race([closed!, delay(2000)]);
      }
    }
    try {
      if (!child || observedStop) {
        if (child?.pid) await checkpoint();
        await identity.releaseAfterStop();
      } else throw new Error("Legion stop unconfirmed; ownership retained");
    } finally {
      if (dir && (!child || observedStop)) await rm(dir, { recursive: true, force: true });
      daemon = undefined;
    }
  }
}

export function startLegionSupervisor() {
  if (supervising) return;
  const configuration = legionBackgroundConfiguration();
  if (!configuration.enabled) {
    console.info(`[legion] supervisor disabled: ${configuration.reason}`);
    return;
  }
  stopping = false;
  if (shutdown.signal.aborted) shutdown = new AbortController();
  supervising = (async () => {
    for (const backoff of [0, 5000, 30_000]) {
      if (stopping || !legionBackgroundEnabled()) return;
      // Interruptible backoff keeps app shutdown bounded.
      for (let elapsed = 0; elapsed < backoff && !stopping; elapsed += 250) await delay(250);
      if (stopping) return;
      try { await cycle(); }
      catch { console.warn("[legion] supervised node unavailable; callers retain their approved backup routing"); }
    }
    console.warn("[legion] restart limit reached; operator inspection required");
  })().finally(() => { supervising = undefined; });
}
export async function stopLegionSupervisor() {
  stopping = true;
  shutdown.abort();
  ready = false;
  daemon?.kill("SIGTERM");
  await supervising;
  await pool?.end();
  pool = undefined;
}
