/**
 * Weekly Maintenance Cron
 *
 * In-process scheduler + HTTP endpoint that runs the `weekly-maintenance.ts`
 * script, parses its JSON output, and emails the owner a triaged summary.
 *
 * Mechanism:
 *   - startWeeklyMaintenanceScheduler() — fires every 7 days from server boot
 *     (with a 60s delay on first boot so it doesn't hammer prod on every restart)
 *   - handleCronRun() — exported for the HTTP endpoint and the scheduler to share
 *
 * Auth (HTTP path): Bearer ${CRON_SECRET} header required.
 *
 * Email destination: huskyauto@gmail.com (Bob), via the same sendEmail helper
 * the rest of the platform uses.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sendEmail, getPrimaryInboxId, isEmailConfigured } from "./email";

const execFileAsync = promisify(execFile);

const OWNER_EMAIL = "huskyauto@gmail.com";
const SCRIPT_PATH = "scripts/weekly-maintenance.ts";
const RUN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max
const WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000; // 1 minute after boot

let lastRunAt: Date | null = null;
let lastRunStatus: "GREEN" | "YELLOW" | "RED" | "ERROR" | null = null;
let lastRunSummary: string | null = null;
let runInFlight = false;

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

function buildEmailHtml(s: MaintenanceSummary): string {
  const passRows = s.passes.map((p) => {
    const severeFindings = p.findings.filter((f) =>
      ["CRITICAL", "HIGH", "MODERATE"].includes(f.severity)
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

function buildEmailText(s: MaintenanceSummary): string {
  const lines: string[] = [];
  lines.push(`WEEKLY MAINTENANCE — Week of ${s.weekOf}`);
  lines.push(`Overall status: ${s.overallStatus}`);
  lines.push("");
  for (const p of s.passes) {
    lines.push(`[${p.status}] ${p.name}`);
    for (const f of p.findings) {
      if (["CRITICAL", "HIGH", "MODERATE"].includes(f.severity)) {
        lines.push(`  ${f.severity}: ${f.message}`);
      }
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
  return lines.join("\n");
}

export async function runWeeklyMaintenance(): Promise<{
  ok: boolean;
  status: "GREEN" | "YELLOW" | "RED" | "ERROR";
  summary?: MaintenanceSummary;
  emailSent: boolean;
  error?: string;
}> {
  if (runInFlight) {
    return { ok: false, status: "ERROR", emailSent: false, error: "A weekly maintenance run is already in progress" };
  }
  runInFlight = true;
  try {
    console.log("[weekly-maintenance] Starting run…");
    const { stdout } = await execFileAsync(
      "npx",
      ["tsx", SCRIPT_PATH, "--json"],
      { timeout: RUN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
    ).catch((e: any) => {
      // Script exits with code 1 when status is RED — that's a successful run, not a failure
      if (e?.stdout) return { stdout: e.stdout };
      throw e;
    });

    let summary: MaintenanceSummary;
    try {
      summary = JSON.parse(stdout);
    } catch (e: any) {
      console.error("[weekly-maintenance] Could not parse script output:", e.message);
      lastRunStatus = "ERROR";
      lastRunAt = new Date();
      return { ok: false, status: "ERROR", emailSent: false, error: "Could not parse maintenance script output" };
    }

    lastRunStatus = summary.overallStatus;
    lastRunAt = new Date();
    lastRunSummary = `${summary.overallStatus} — ${summary.passes.length} passes, ${summary.ownerActionRequired.length} owner actions`;

    let emailSent = false;
    if (isEmailConfigured()) {
      try {
        const inboxId = await getPrimaryInboxId();
        if (inboxId) {
          const subjectPrefix = summary.overallStatus === "RED" ? "🔴 [URGENT]" : summary.overallStatus === "YELLOW" ? "🟡" : "🟢";
          await sendEmail({
            inboxId: inboxId as string,
            to: OWNER_EMAIL,
            subject: `${subjectPrefix} Weekly Maintenance — ${summary.overallStatus} — Week of ${summary.weekOf}`,
            text: buildEmailText(summary),
            html: buildEmailHtml(summary),
          });
          emailSent = true;
          console.log(`[weekly-maintenance] Summary emailed to ${OWNER_EMAIL} (${summary.overallStatus})`);
        } else {
          console.warn("[weekly-maintenance] No primary inbox configured — summary not emailed");
        }
      } catch (e: any) {
        console.error("[weekly-maintenance] Failed to send summary email:", e.message);
      }
    } else {
      console.warn("[weekly-maintenance] Email not configured — skipping summary email");
    }

    return { ok: true, status: summary.overallStatus, summary, emailSent };
  } catch (e: any) {
    console.error("[weekly-maintenance] Run failed:", e.message);
    lastRunStatus = "ERROR";
    lastRunAt = new Date();
    return { ok: false, status: "ERROR", emailSent: false, error: e.message };
  } finally {
    runInFlight = false;
  }
}

export function startWeeklyMaintenanceScheduler(): void {
  console.log(`[weekly-maintenance] Scheduler armed — first run in ${Math.round(FIRST_RUN_DELAY_MS / 1000)}s, then every 7 days`);
  setTimeout(() => {
    runWeeklyMaintenance().catch((e) => console.error("[weekly-maintenance] Boot run failed:", e));
    setInterval(() => {
      runWeeklyMaintenance().catch((e) => console.error("[weekly-maintenance] Scheduled run failed:", e));
    }, WEEKLY_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
}

export function getWeeklyMaintenanceStatus() {
  return {
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastRunStatus,
    lastRunSummary,
    runInFlight,
    scheduler: "in-process setInterval (7 days)",
    ownerEmail: OWNER_EMAIL,
  };
}
