/**
 * Weekly Maintenance Cron
 *
 * Durable UTC-window scheduler + direct HTTP trigger for the
 * `weekly-maintenance.ts` script, which emails the owner a triaged summary.
 *
 * Mechanism:
 *   - startWeeklyMaintenanceScheduler() — enqueues the current UTC week after
 *     a 60s boot delay and performs periodic due-window checks.
 *   - runScheduledMaintenance() — compatibility entry point using the same durable queue.
 *
 * Auth (HTTP path): Bearer ${CRON_SECRET} header required.
 *
 * Email destination: the configured owner address (OWNER_EMAIL / OWNER_ALERT_EMAIL
 * / OWNER_EMAILS / SITE_OWNER_EMAIL), via the same sendEmail helper the rest of
 * the platform uses. No owner configured ⇒ summary is logged, not emailed.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { reportDiagnostic } from "./lib/safe-diagnostic";
import { sendEmail, getPrimaryInboxId, isEmailConfigured } from "./email";
export { isAcceptedMailResult } from "./lib/email-receipt";
import { isAcceptedMailResult } from "./lib/email-receipt";
import { resolveOwnerEmail } from "./lib/owner-email";
import { tryAcquireHeavyWorkLane } from "./lib/heavy-work-lane";
import { enqueueUniqueJob } from "./job-queue";

const execFileAsync = promisify(execFile);

const OWNER_EMAIL = resolveOwnerEmail();
const SCRIPT_PATH = "scripts/weekly-maintenance.ts";
// The job worker's lease is 5m; leave a minute for parsing, email, and fenced completion.
const RUN_TIMEOUT_MS = 4 * 60 * 1000;
const EMAIL_SEND_TIMEOUT_MS = 2 * 60 * 1000;
const SCHEDULE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000; // 1 minute after boot
const SCHEDULED_TENANT_ID = 1;
const SCHEDULED_JOB_KIND = "weekly_maintenance";

let lastRunAt: Date | null = null;
let lastRunStatus: "GREEN" | "YELLOW" | "RED" | "ERROR" | null = null;
let lastRunSummary: string | null = null;
let runInFlight = false;
let schedulerBootTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function getWeeklyMaintenanceDedupeKey(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Weekly maintenance window requires a valid date");
  }
  const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const isoDay = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - isoDay);
  const isoYear = utcDate.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const isoWeek = Math.ceil(((utcDate.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `weekly-maintenance:${isoYear}-W${String(isoWeek).padStart(2, "0")}`;
}

export async function enqueueScheduledWeeklyMaintenance(now: Date = new Date()): Promise<number> {
  const dedupeKey = getWeeklyMaintenanceDedupeKey(now);
  const window = dedupeKey.slice("weekly-maintenance:".length);
  const jobId = await enqueueUniqueJob(
    SCHEDULED_JOB_KIND,
    dedupeKey,
    { tenantId: SCHEDULED_TENANT_ID, window },
    { tenantId: SCHEDULED_TENANT_ID, maxAttempts: 100 },
  );
  console.log(`[weekly-maintenance] UTC due window ${window} queued/reused job #${jobId}`);
  return jobId;
}

interface MaintenanceSummary {
  generatedAt: string;
  weekOf: string;
  overallStatus: "GREEN" | "YELLOW" | "RED";
  passes: Array<{
    name: string;
    status: string;
    findings: Array<{ severity: string; message: string; detail?: unknown }>;
    error?: string;
    durationMs: number;
  }>;
  actionsTaken: string[];
  actionsQueued: string[];
  ownerActionRequired: string[];
}

export type MaintenanceEmailOutcome = "accepted" | "rejected" | "not_accepted" | "ambiguous" | "not_configured";
type EmailAttemptPermission = "send" | "accepted" | "not_accepted" | "ambiguous";

export function classifyWeeklyEmailFailure(error: unknown): "rejected" | "ambiguous" {
  const status = (error as any)?.status;
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408
    ? "rejected"
    : "ambiguous";
}

/** A parseable but incomplete report cannot be described as a weekly review. */
export function isCompleteMaintenanceSummary(value: unknown): value is MaintenanceSummary {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  if (!["GREEN", "YELLOW", "RED"].includes(String(s.overallStatus))
      || typeof s.generatedAt !== "string" || typeof s.weekOf !== "string"
      || !Array.isArray(s.passes) || !Array.isArray(s.actionsTaken)
      || !Array.isArray(s.actionsQueued) || !Array.isArray(s.ownerActionRequired)) return false;
  const seen = new Set<number>();
  for (const pass of s.passes) {
    if (!pass || typeof pass !== "object" || typeof pass.name !== "string"
        || !["GREEN", "YELLOW", "RED"].includes(pass.status)
        || !Array.isArray(pass.findings)
        || pass.findings.some((finding: any) => !finding || typeof finding.message !== "string")) return false;
    const n = Number(pass.name.match(/^Pass (\d+):/)?.[1]);
    if (!Number.isInteger(n) || seen.has(n)) return false;
    if (n === 25 && pass.findings.length === 0) return false;
    seen.add(n);
  }
  return Array.from({ length: 25 }, (_, n) => n + 1).every((n) => seen.has(n));
}

function statusColor(status: string): string {
  if (status === "GREEN") return "#4ade80";
  if (status === "YELLOW") return "#f59e0b";
  if (status === "RED") return "#ef4444";
  return "#888";
}

function severityColor(sev: string): string {
  if (sev === "CRITICAL") return "#dc2626";
  if (sev === "HIGH") return "#ef4444";
  if (sev === "MODERATE") return "#f59e0b";
  if (sev === "LOW") return "#fbbf24";
  return "#9ca3af";
}

export function buildEmailHtml(s: MaintenanceSummary): string {
  const passRows = s.passes.map((p) => {
    const severeFindings = p.findings.filter((f) =>
      ["CRITICAL", "HIGH", "MODERATE"].includes(f.severity)
      || (p.name.startsWith("Pass 25: Prior research revisit") && f.severity === "INFO")
    );
    const findingList = severeFindings.length
      ? `<ul style="margin:4px 0 0 16px;padding:0;color:#ccc;font-size:13px;">${severeFindings
          .map(
            (f) =>
              `<li><span style="color:${severityColor(f.severity)};font-weight:600;">${f.severity}</span> &mdash; ${escapeHtml(f.message)}</li>`
          )
          .join("")}</ul>`
      : `<span style="color:#666;font-size:12px;">no severe findings</span>`;
    return `<tr>
      <td style="padding:10px 8px;border-bottom:1px solid #2a2a2a;color:#fff;font-size:14px;font-weight:500;vertical-align:top;width:38%;">${escapeHtml(p.name)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #2a2a2a;vertical-align:top;width:14%;"><span style="color:${statusColor(p.status)};font-weight:600;">${p.status}</span></td>
      <td style="padding:10px 8px;border-bottom:1px solid #2a2a2a;vertical-align:top;">${findingList}${p.error ? `<div style="color:#ef4444;font-size:12px;margin-top:6px;">Error: ${escapeHtml(p.error)}</div>` : ""}</td>
    </tr>`;
  }).join("");

  const ownerActions = s.ownerActionRequired.length
    ? `<div style="margin-top:20px;padding:14px;background:#2a1515;border:1px solid #5a2d2d;border-radius:8px;">
        <p style="color:#ef4444;font-weight:600;margin:0 0 8px;font-size:14px;">⚠️ Owner action required:</p>
        <ul style="margin:0;padding-left:18px;color:#fca5a5;font-size:13px;">
          ${s.ownerActionRequired.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}
        </ul>
      </div>`
    : `<div style="margin-top:20px;padding:14px;background:#152a15;border:1px solid #2d5a2d;border-radius:8px;">
        <p style="color:#4ade80;font-weight:600;margin:0;font-size:14px;">✓ No owner action required this week.</p>
      </div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:720px;margin:0 auto;padding:30px 20px;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#fff;margin:0;font-size:22px;">Weekly Maintenance Review</h1>
    <p style="color:#888;margin:6px 0 0;font-size:13px;">Week of ${escapeHtml(s.weekOf)} &middot; VisionClaw Platform</p>
  </div>
  <div style="text-align:center;padding:18px;background:${s.overallStatus === "RED" ? "#2a1515" : s.overallStatus === "YELLOW" ? "#2a2515" : "#152a15"};border-radius:10px;margin-bottom:20px;">
    <div style="color:${statusColor(s.overallStatus)};font-size:28px;font-weight:700;letter-spacing:1px;">${s.overallStatus}</div>
    <div style="color:#aaa;font-size:12px;margin-top:4px;">overall platform status</div>
  </div>
  <div style="background:#141414;border-radius:10px;padding:6px;border:1px solid #2a2a2a;">
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th style="text-align:left;padding:10px 8px;color:#666;font-size:11px;text-transform:uppercase;border-bottom:1px solid #333;">Pass</th>
        <th style="text-align:left;padding:10px 8px;color:#666;font-size:11px;text-transform:uppercase;border-bottom:1px solid #333;">Status</th>
        <th style="text-align:left;padding:10px 8px;color:#666;font-size:11px;text-transform:uppercase;border-bottom:1px solid #333;">Findings</th>
      </tr></thead>
      <tbody>${passRows}</tbody>
    </table>
  </div>
  ${ownerActions}
  ${s.actionsTaken.length ? `<div style="margin-top:16px;padding:12px;background:#141414;border:1px solid #2a2a2a;border-radius:8px;">
    <p style="color:#aaa;font-weight:600;margin:0 0 6px;font-size:13px;">Actions taken automatically:</p>
    <ul style="margin:0;padding-left:18px;color:#ccc;font-size:13px;">${s.actionsTaken.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>
  </div>` : ""}
  ${s.actionsQueued.length ? `<div style="margin-top:12px;padding:12px;background:#141414;border:1px solid #2a2a2a;border-radius:8px;">
    <p style="color:#aaa;font-weight:600;margin:0 0 6px;font-size:13px;">Queued for agent follow-up:</p>
    <ul style="margin:0;padding-left:18px;color:#ccc;font-size:13px;">${s.actionsQueued.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>
  </div>` : ""}
  <div style="margin-top:24px;padding:14px;background:#0f1a2a;border:1px solid #1e3a5a;border-radius:8px;">
    <p style="color:#7dd3fc;font-weight:600;margin:0 0 6px;font-size:13px;">Next steps for the agent (next time you chat):</p>
    <ol style="margin:0;padding-left:18px;color:#bae6fd;font-size:12px;line-height:1.6;">
      <li>Run remaining passes 3-5 (SAST scan, prod schema parity, prod log scan) via the agent-side callbacks</li>
      <li>For any RED findings, trigger the security-hardening or owner-notification skills as appropriate</li>
      <li>For PATCH/MINOR bumps without CVEs, batch via dependency-upgrade skill</li>
      <li>Log this run in replit.md per replit-md-maintenance skill</li>
    </ol>
  </div>
  <p style="color:#555;font-size:11px;margin-top:24px;text-align:center;">
    Generated ${escapeHtml(s.generatedAt)} &middot; This summary is the script-pass portion only. The agent completes the full sweep on next chat.
  </p>
</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Email provider response timed out; acceptance is ambiguous")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function buildEmailText(s: MaintenanceSummary): string {
  const lines: string[] = [];
  // Bind the digest identity to full report evidence, without emailing raw diagnostic details.
  const evidenceId = createHash("sha256").update(JSON.stringify([
    s.overallStatus,
    s.passes.map((p) => [p.name, p.status, p.findings, p.error]),
    s.actionsTaken, s.actionsQueued, s.ownerActionRequired,
  ])).digest("hex");
  lines.push(`WEEKLY MAINTENANCE — Week of ${s.weekOf}`);
  lines.push(`Overall status: ${s.overallStatus}`);
  lines.push(`Evidence fingerprint: ${evidenceId}`);
  lines.push("");
  for (const p of s.passes) {
    lines.push(`[${p.status}] ${p.name}`);
    for (const f of p.findings) {
      lines.push(`  ${f.severity}: ${f.message}`);
    }
    if (p.error) lines.push(`  ERROR: ${p.error}`);
  }
  lines.push("");
  if (s.ownerActionRequired.length) {
    lines.push("OWNER ACTION REQUIRED:");
    for (const a of s.ownerActionRequired) lines.push(`  - ${a}`);
  } else {
    lines.push("No owner action required this week.");
  }
  if (s.actionsTaken.length) {
    lines.push("ACTIONS TAKEN:");
    for (const a of s.actionsTaken) lines.push(`  - ${a}`);
  }
  if (s.actionsQueued.length) {
    lines.push("QUEUED FOLLOW-UP:");
    for (const a of s.actionsQueued) lines.push(`  - ${a}`);
  }
  return lines.join("\n");
}

export async function runWeeklyMaintenance(options: {
  beforeEmail?: () => Promise<EmailAttemptPermission>;
  recordEmailOutcome?: (outcome: Exclude<MaintenanceEmailOutcome, "not_configured">) => Promise<void>;
  emailSendTimeoutMs?: number;
} = {}): Promise<{
  ok: boolean;
  status: "GREEN" | "YELLOW" | "RED" | "ERROR";
  summary?: MaintenanceSummary;
  emailSent: boolean;
  emailOutcome: MaintenanceEmailOutcome;
  error?: string;
  deferred?: boolean;
}> {
  if (runInFlight) {
    return { ok: false, status: "ERROR", emailSent: false, emailOutcome: "not_configured", deferred: true, error: "A weekly maintenance run is already in progress" };
  }
  runInFlight = true;
  let releaseLane: (() => Promise<void>) | null = null;
  try {
    try {
      releaseLane = await tryAcquireHeavyWorkLane("weekly maintenance");
    } catch (err: any) {
      console.warn(`[weekly-maintenance] Admission unavailable: ${err.message}`);
    }
    if (!releaseLane) {
      console.log("[weekly-maintenance] Deferred until the heavy-work lane is free");
      lastRunSummary = "Deferred: heavy-work lane busy or unavailable";
      return { ok: false, status: "ERROR", emailSent: false, emailOutcome: "not_configured", deferred: true, error: "Deferred: heavy-work lane busy or unavailable" };
    }
    console.log("[weekly-maintenance] Starting run…");
    const { stdout } = await execFileAsync(
      "npx",
      ["tsx", SCRIPT_PATH, "--json"],
      { timeout: RUN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
    ).catch((e: any) => {
      // The script intentionally exits 1 for a complete RED report; other
      // non-zero exits, including timeouts, remain failures even with stdout.
      if (e?.code === 1 && typeof e.stdout === "string") {
        try {
          const failedSummary = JSON.parse(e.stdout);
          if (isCompleteMaintenanceSummary(failedSummary) && failedSummary.overallStatus === "RED") {
            return { stdout: e.stdout };
          }
        } catch { reportDiagnostic("[weekly-maintenance] Malformed child summary remains an execution failure"); }
      }
      throw e;
    });

    let summary: MaintenanceSummary;
    try {
      summary = JSON.parse(stdout);
      if (!isCompleteMaintenanceSummary(summary)) throw new Error("Incomplete weekly maintenance summary");
    } catch (e: any) {
      console.error("[weekly-maintenance] Could not parse script output:", e.message);
      lastRunStatus = "ERROR";
      lastRunAt = new Date();
      return { ok: false, status: "ERROR", emailSent: false, emailOutcome: "not_configured", error: "Could not parse maintenance script output" };
    }

    lastRunStatus = summary.overallStatus;
    lastRunAt = new Date();
    lastRunSummary = `${summary.overallStatus} — ${summary.passes.length} passes, ${summary.ownerActionRequired.length} owner actions`;

    let emailSent = false;
    let emailOutcome: MaintenanceEmailOutcome = "not_configured";
    if (isEmailConfigured() && OWNER_EMAIL) {
      let inboxId: string | null = null;
      try {
        inboxId = await getPrimaryInboxId();
      } catch (e: any) {
        emailOutcome = "rejected";
        console.error("[weekly-maintenance] Could not prepare summary email:", e.message);
      }
      if (inboxId) {
        const subjectPrefix = summary.overallStatus === "RED" ? "🔴 [URGENT]" : summary.overallStatus === "YELLOW" ? "🟡" : "🟢";
        const emailParams = {
          inboxId,
          to: OWNER_EMAIL,
          subject: `${subjectPrefix} Weekly Maintenance — ${summary.overallStatus} — Week of ${summary.weekOf}`,
          text: buildEmailText(summary),
          html: buildEmailHtml(summary),
          ...(options.beforeEmail ? { retryAmbiguous: false } : {}),
        };
        const permission = await (options.beforeEmail?.() ?? Promise.resolve("send" as const));
        if (permission !== "send") {
          emailOutcome = permission;
          emailSent = permission === "accepted";
        } else {
          try {
            const sendPromise = sendEmail(emailParams);
            const result = options.emailSendTimeoutMs
              ? await withTimeout(sendPromise, options.emailSendTimeoutMs)
              : await sendPromise;
            if (isAcceptedMailResult(result)) {
              emailOutcome = "accepted";
              emailSent = true;
              console.log(`[weekly-maintenance] Summary accepted by mail provider (${summary.overallStatus}); inbox delivery not verified`);
            } else if ((result as any)?.queued === true || (result as any)?.silenced === true) {
              emailOutcome = "not_accepted";
              console.warn("[weekly-maintenance] Summary queued or silenced; provider acceptance not claimed");
            } else {
              emailOutcome = "ambiguous";
              console.warn("[weekly-maintenance] Summary send resolved without a provider receipt; outcome is ambiguous");
            }
          } catch (e: any) {
            emailOutcome = classifyWeeklyEmailFailure(e);
            console.error(`[weekly-maintenance] Summary send ${emailOutcome}:`, e.message);
          }
          if (options.recordEmailOutcome) await options.recordEmailOutcome(emailOutcome);
        }
      } else if (emailOutcome !== "rejected") {
        emailOutcome = "not_accepted";
        console.warn("[weekly-maintenance] No primary inbox configured — summary not emailed");
      }
    } else {
      console.warn("[weekly-maintenance] Email not configured — skipping summary email");
    }

    return { ok: true, status: summary.overallStatus, summary, emailSent, emailOutcome };
  } catch (e: any) {
    console.error("[weekly-maintenance] Run failed:", e.message);
    lastRunStatus = "ERROR";
    lastRunAt = new Date();
    return { ok: false, status: "ERROR", emailSent: false, emailOutcome: "not_configured", error: e.message };
  } finally {
    if (releaseLane) {
      try { await releaseLane(); }
      catch (err: any) { console.error(`[weekly-maintenance] Lane release failed: ${err.message}`); }
    }
    runInFlight = false;
  }
}

export async function runScheduledMaintenance(): Promise<void> {
  await enqueueScheduledWeeklyMaintenance();
}

export function startWeeklyMaintenanceScheduler(): void {
  if (schedulerBootTimer || schedulerInterval) return;
  console.log(`[weekly-maintenance] Durable scheduler armed — first due check in ${Math.round(FIRST_RUN_DELAY_MS / 1000)}s, then every ${Math.round(SCHEDULE_CHECK_INTERVAL_MS / 3600000)}h`);
  schedulerBootTimer = setTimeout(() => {
    schedulerBootTimer = null;
    enqueueScheduledWeeklyMaintenance().catch((e) => console.error("[weekly-maintenance] Boot enqueue failed:", e));
    schedulerInterval = setInterval(() => {
      enqueueScheduledWeeklyMaintenance().catch((e) => console.error("[weekly-maintenance] Due check enqueue failed:", e));
    }, SCHEDULE_CHECK_INTERVAL_MS);
    schedulerInterval.unref();
  }, FIRST_RUN_DELAY_MS);
  schedulerBootTimer.unref();
}

export function getWeeklyMaintenanceStatus() {
  return {
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastRunStatus,
    lastRunSummary,
    runInFlight,
    scheduler: "durable UTC-week queue",
    ownerEmail: OWNER_EMAIL,
  };
}
