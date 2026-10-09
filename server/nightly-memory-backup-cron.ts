/**
 * Nightly Memory Backup Cron
 *
 * In-process scheduler that runs `scripts/nightly-memory-backup.ts` once per
 * day. Cheap insurance for the memory_entries table — if anything corrupts a
 * row, we restore from yesterday's JSON dump in Drive.
 *
 * Mirrors the shape of weekly-maintenance-cron.ts: in-process setTimeout +
 * setInterval, 90s first-run delay on boot so we don't hammer on every
 * restart, parses the script's stdout JSON line for log/email.
 *
 * Only emails the owner when a backup FAILS (no daily-success-spam).
 */

import { execFile } from "node:child_process";
import { logSilentCatch } from "./lib/silent-catch";
import { promisify } from "node:util";
import { sendEmail, getPrimaryInboxId, isEmailConfigured } from "./email";
import { resolveOwnerEmail } from "./lib/owner-email";

const execFileAsync = promisify(execFile);

const OWNER_EMAIL = resolveOwnerEmail();
const SCRIPT_PATH = "scripts/nightly-memory-backup.ts";
const RUN_TIMEOUT_MS = 2 * 60 * 1000;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 90 * 1000;

interface BackupSummary {
  generatedAt: string;
  rowCount: number;
  bytes: number;
  driveFileId?: string;
  driveViewUrl?: string;
  prunedCount: number;
  status: "ok" | "db_failed" | "upload_failed" | "pruned_failed";
  error?: string;
}

let lastRunAt: Date | null = null;
let lastRunStatus: BackupSummary["status"] | "ERROR" | null = null;
let runInFlight = false;

function parseSummaryFromStdout(stdout: string): BackupSummary | null {
  if (!stdout) return null;
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{") && line.endsWith("}")) {
      try { return JSON.parse(line) as BackupSummary; } catch (_silentErr) { logSilentCatch("server/nightly-memory-backup-cron.ts", _silentErr); }
    }
  }
  return null;
}

async function sendFailureEmail(summary: BackupSummary | null, raw: { stdout?: string; stderr?: string; exitCode?: number; thrownMessage?: string }): Promise<void> {
  try {
    if (!isEmailConfigured() || !OWNER_EMAIL) return;
    const inboxId = await getPrimaryInboxId();
    if (!inboxId) return;
    const status = summary?.status || "ERROR";
    const subject = `[VisionClaw] Memory backup FAILED — ${status}`;
    const html = `
      <p><strong>Status:</strong> ${status}</p>
      <p><strong>Error:</strong> ${summary?.error || raw.thrownMessage || "(none)"}</p>
      <p><strong>Exit code:</strong> ${raw.exitCode ?? "(n/a)"}</p>
      <p><strong>Rows attempted:</strong> ${summary?.rowCount ?? "(unknown)"}</p>
      <p><strong>Run at:</strong> ${summary?.generatedAt || new Date().toISOString()}</p>
      <p>The nightly memory_entries backup did not complete. Inspect server logs for [memory-backup] entries.</p>
      ${raw.stderr ? `<pre style="background:#f4f4f4;padding:8px;font-size:11px">${raw.stderr.slice(0, 2000).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" } as any)[c])}</pre>` : ""}
    `;
    await sendEmail({ inboxId, to: OWNER_EMAIL, subject, html });
    console.log(`[memory-backup] failure alert emailed to ${OWNER_EMAIL}`);
  } catch (e: any) {
    console.error("[memory-backup] failure email send failed:", e?.message || e);
  }
}

async function runOnce(): Promise<void> {
  if (runInFlight) {
    console.log("[memory-backup] skip — previous run still in flight");
    return;
  }
  runInFlight = true;
  const startedAt = new Date();
  try {
    console.log("[memory-backup] starting nightly run…");
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let thrownMessage: string | undefined;
    try {
      const r = await execFileAsync(
        "npx",
        ["tsx", SCRIPT_PATH],
        { timeout: RUN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      );
      stdout = r.stdout || "";
      stderr = r.stderr || "";
    } catch (execErr: any) {
      // execFile rejects on non-zero exit (codes 2/3/4 from our contract) AND on
      // signal/timeout. Capture stdout/stderr from the error object so we can
      // still parse the script's JSON summary and fire the failure email.
      stdout = execErr?.stdout || "";
      stderr = execErr?.stderr || "";
      exitCode = typeof execErr?.code === "number" ? execErr.code : 1;
      thrownMessage = execErr?.message || String(execErr);
    }
    if (stderr) console.warn(`[memory-backup] stderr: ${stderr.slice(0, 500)}`);

    const summary = parseSummaryFromStdout(stdout);
    lastRunAt = startedAt;

    if (!summary) {
      console.error("[memory-backup] could not parse script output (exitCode=" + exitCode + "):", stdout.slice(-500));
      lastRunStatus = "ERROR";
      // Couldn't parse — definitely a failure. Alert with whatever raw info we have.
      await sendFailureEmail(null, { stdout, stderr, exitCode, thrownMessage });
      return;
    }

    lastRunStatus = summary.status;
    console.log(
      `[memory-backup] ${summary.status} — ${summary.rowCount} rows, ${(summary.bytes / 1024).toFixed(1)} KB, ` +
      `pruned ${summary.prunedCount}${summary.driveViewUrl ? `, url=${summary.driveViewUrl}` : ""}` +
      (exitCode !== 0 ? ` (exit=${exitCode})` : ""),
    );

    // Email on any non-ok status — backup-critical failures (db_failed / upload_failed)
    // AND retention failures (pruned_failed). Retention failures are worth knowing
    // because they silently break the 30-day window over time.
    if (summary.status !== "ok") {
      await sendFailureEmail(summary, { stdout, stderr, exitCode, thrownMessage });
    }
  } catch (e: any) {
    console.error("[memory-backup] run wrapper failed:", e?.message || e);
    lastRunStatus = "ERROR";
    await sendFailureEmail(null, { thrownMessage: e?.message || String(e) });
  } finally {
    runInFlight = false;
  }
}

export function startNightlyMemoryBackupScheduler(): void {
  console.log(
    `[memory-backup] scheduler armed — first run in ${Math.round(FIRST_RUN_DELAY_MS / 1000)}s, then every 24h`,
  );
  setTimeout(() => {
    runOnce().catch((e) => console.error("[memory-backup] initial run threw:", e?.message || e));
    setInterval(() => {
      runOnce().catch((e) => console.error("[memory-backup] interval run threw:", e?.message || e));
    }, DAILY_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
}

export function getNightlyMemoryBackupStatus() {
  return { lastRunAt, lastRunStatus, runInFlight };
}
