import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db";
import { ownerTenantId } from "./agentic/autonomous-budget";
import { sanitizeSpawnEnv } from "./safety/spawn-env-guard";
import { COPILOT_TIMEOUT_MS, validateCopilotRequest, enforceCopilotQuota } from "./copilot-chat-policy";

export interface CopilotReply { success?: boolean; text?: string; model?: string; truncated?: boolean; requestId?: string; error?: string }

/** Atomic shared quota: workspace CLI and VisionClaw use the same owner ledger. */
export async function claimCopilotRequest(tenantId: number, id: string, ownerMessageId?: number): Promise<void> {
  if (tenantId !== ownerTenantId()) throw new Error("Copilot is owner-only");
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SET LOCAL statement_timeout = '5000ms'");
    await connection.query("SELECT pg_advisory_xact_lock(774002, $1)", [tenantId]);
    const rows = await connection.query(`
      SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS used,
        count(*) FILTER (WHERE status = 'running')::int AS active
      FROM copilot_request_claims WHERE tenant_id = $1`, [tenantId]);
    enforceCopilotQuota(rows.rows[0] ?? {});
    await connection.query(`INSERT INTO copilot_request_claims(id,tenant_id,status,lease_until,owner_message_id)
      VALUES ($1,$2,'running',now()+interval '150 seconds',$3)`, [id, tenantId, ownerMessageId ?? null]);
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    if ((error as any)?.code === "23505" && (error as any)?.constraint === "idx_copilot_owner_message") {
      throw new Error("Copilot owner request already attempted; no automatic retry");
    }
    throw error;
  } finally { connection.release(); }
}

/** No ambient provider fallback. Every attempt, including uncertainty, consumes quota. */
export async function runCopilotChat(input: { tenantId?: unknown; prompt?: unknown; model?: unknown; ownerMessageId?: unknown }): Promise<CopilotReply> {
  let request: { prompt: string; model: string };
  try { request = validateCopilotRequest(input, ownerTenantId()); }
  catch (error) { return { error: (error as Error).message }; }
  if (input.ownerMessageId !== undefined && (!Number.isSafeInteger(input.ownerMessageId) || (input.ownerMessageId as number) <= 0)) {
    return { error: "Invalid Copilot owner request identity" };
  }
  if (process.env.COPILOT_CHAT_DISABLED === "1") return { error: "Copilot chat is disabled" };
  if (!process.env.COPILOT_GITHUB_TOKEN) return { error: "Copilot credential is not configured" };
  const tenantId = input.tenantId as number;
  const requestId = randomUUID();
  const workerPath = process.env.NODE_ENV === "production"
    ? resolve(typeof __dirname === "string" ? __dirname : resolve("dist"), "copilot-chat-worker.mjs")
    : fileURLToPath(new URL("./copilot-chat-worker.mjs", import.meta.url));
  try { await access(workerPath); }
  catch { return { error: "Copilot runtime worker is not packaged" }; }
  try { await claimCopilotRequest(tenantId, requestId, input.ownerMessageId as number | undefined); }
  catch (error) {
    const text = (error as Error).message;
    return { error: /^Copilot daily|^Another Copilot|^Copilot owner request/.test(text) ? text : "Copilot quota could not be verified; request refused" };
  }
  let root: string | undefined;
  let groupStopped = true;
  let result: CopilotReply = { error: "Copilot request failed; no automatic retry" };
  try {
    root = await mkdtemp(join(tmpdir(), "copilot-chat-"));
    const env = sanitizeSpawnEnv({
      PATH: process.env.PATH, HOME: root, TMPDIR: root, SSL_CERT_FILE: process.env.SSL_CERT_FILE,
      COPILOT_GITHUB_TOKEN: process.env.COPILOT_GITHUB_TOKEN,
    });
    const child = fork(workerPath, [], { cwd: root, env, detached: true, execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"] });
    groupStopped = !child.pid;
    const terminate = () => {
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") console.warn("[copilot] process termination failed"); }
      }
    };
    result = await new Promise<CopilotReply>((accept) => {
      let response: CopilotReply | undefined;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        response = { error: "Copilot timed out; quota retained and no automatic retry" };
        terminate();
      }, COPILOT_TIMEOUT_MS);
      child.once("message", (message: any) => {
        if (timedOut) return;
        if (message?.success === true && typeof message.text === "string" && message.text.trim() && message.text.length <= 16000 &&
            message.model === request.model && typeof message.truncated === "boolean") {
          response = { success: true, text: message.text, model: request.model, truncated: message.truncated };
        } else response = { error: "Copilot returned no usable answer; no automatic retry" };
      });
      child.once("error", () => { clearTimeout(timer); terminate(); accept({ error: "Copilot worker could not start" }); });
      child.once("close", async () => {
        clearTimeout(timer); terminate();
        for (let attempt = 0; attempt < 30; attempt++) {
          try {
            if (!child.pid) { groupStopped = true; break; }
            process.kill(-child.pid, 0);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") { groupStopped = true; break; }
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        accept(groupStopped ? response ?? { error: "Copilot stopped without an answer; no automatic retry" }
          : { error: "Copilot termination could not be verified; further requests blocked pending operator verification" });
      });
      child.send(request);
    });
  } catch { result = { error: "Copilot request failed; no automatic retry" }; }
  finally {
    if (root) await rm(root, { recursive: true, force: true });
    try {
      if (!groupStopped) throw new Error("Unverified worker termination");
      await pool.query("UPDATE copilot_request_claims SET status=$1, finished_at=now() WHERE id=$2 AND tenant_id=$3",
        [result.success ? "complete" : "failed", requestId, tenantId]);
    } catch { console.warn("[copilot] request settlement unavailable; quota remains reserved"); }
  }
  return { ...result, requestId };
}
