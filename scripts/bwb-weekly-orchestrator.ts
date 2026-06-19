/**
 * Built With Bob — FULLY AUTONOMOUS weekly recap orchestrator.
 *
 * One agent-runnable entrypoint (no TTY, env-configured, meaningful exit codes):
 *
 *   1. Hand off to scripts/build-bwb-weekly.ts — which AUTO-DISCOVERS this
 *      week's short-form dailies from the connected @built-with-bob channel by
 *      upload date (excluding the ~5-min weekly long-form so there's no feedback
 *      loop), transcribes them, synthesizes one ~5-min weekly story in Bob's
 *      Fish voice clone (opens on his on-file photo), generates a thumbnail, and
 *      delivers the MP4 to Bob via the canonical delivery pipeline. That builder
 *      writes a machine-readable result sidecar per produced video.
 *
 *   2. Pick up the produced result sidecar.
 *
 *   3. LAUNCH POSTURE = APPROVAL-FIRST (default): create a durable approval row
 *      and email Bob a one-tap approve/deny link. The single autonomy switch is
 *      BWB_WEEKLY_AUTOPUBLISH=1 → publish immediately to YouTube (public) +
 *      native Facebook video, no human in the loop.
 *
 * Exit codes: 0 success · 2 nothing produced · 3 build failed · 4 publish/notify failed.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { sanitizeSpawnEnv } from "../server/safety/spawn-env-guard";
import { failBwbJob } from "../server/lib/bwb-job-progress";
import { claimAutonomousBudget } from "../server/agentic/autonomous-budget";
import { acquireProductionPriority } from "./lib/production-priority";

const SCRIPTS_DIR = "data/youtube/scripts";
const OWNER_EMAIL = process.env.BWB_OWNER_EMAIL || process.env.OWNER_EMAIL || "huskyauto@gmail.com";
const TENANT_ID = Number(process.env.ADMIN_TENANT_ID) || 1;
const APPROVAL_TTL_HOURS = Number(process.env.BWB_APPROVAL_TTL_HOURS) || 48;

function logErr(msg: string) {
  console.error(`[bwb-weekly-orchestrator] ${msg}`);
}

function findNewestResultSince(startMs: number): string | null {
  if (!fs.existsSync(SCRIPTS_DIR)) return null;
  const candidates = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".result.json"))
    .map((f) => {
      const full = path.join(SCRIPTS_DIR, f);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .filter((c) => c.mtime >= startMs - 1000)
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.full || null;
}

/** Newest recap result sidecar mtime (ms), or null if none exist yet. */
function newestResultMtime(): number | null {
  if (!fs.existsSync(SCRIPTS_DIR)) return null;
  const times = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".result.json"))
    .map((f) => fs.statSync(path.join(SCRIPTS_DIR, f)).mtimeMs);
  return times.length ? Math.max(...times) : null;
}

/**
 * Schedule guard — the orchestrator is fired by BOTH the restart-safe weekly
 * cron (server/bwb-weekly-cron.ts) AND the "BWB Weekly Render" autostart
 * workflow, which re-runs the orchestrator on EVERY workspace boot.
 *
 * AUTONOMOUS AUTO-RENDER IS OFF BY DEFAULT (Bob's request 2026-06-17): only a
 * MANUAL run that Bob initiates renders. The bwb_weekly_build tool sets
 * BWB_WEEKLY_FORCE=1, which bypasses this guard; any non-forced invocation
 * (boot-fire or cron) is a clean no-op exit. That is what "cancel the auto-
 * generate, keep only the manual recap I initiate on Sat night / Sun morning"
 * means in code — Bob picks the moment, nothing renders on its own.
 *
 * To RE-ENABLE the autonomous weekend schedule, set BWB_WEEKLY_AUTONOMOUS=1.
 * When enabled, two fail-safe gates keep it to one recap per weekend:
 *   1. weekend window — only render on the allowed weekday(s) in BWB_WEEKLY_TZ
 *      (default Sat/Sun, America/Chicago)
 *   2. min-gap idempotency — skip if a recap was already produced within the
 *      last BWB_WEEKLY_MIN_GAP_DAYS (default 2) days.
 * Returns a non-null reason string when the run should be skipped.
 */
function scheduleSkipReason(): string | null {
  // Manual run Bob initiates (bwb_weekly_build sets this) — always proceeds.
  if (process.env.BWB_WEEKLY_FORCE === "1") return null;
  // Autonomous auto-render is disabled by default — only manual runs proceed.
  // Re-enable the scheduled weekend render with BWB_WEEKLY_AUTONOMOUS=1.
  if (process.env.BWB_WEEKLY_AUTONOMOUS !== "1") {
    return "autonomous weekly auto-render is OFF (manual-only) — only a run Bob initiates renders; set BWB_WEEKLY_AUTONOMOUS=1 to re-enable the weekend schedule";
  }
  const tz = process.env.BWB_WEEKLY_TZ || "America/Chicago";
  const allowed = (process.env.BWB_WEEKLY_DAYS || "Sat,Sun")
    .split(",")
    .map((d) => d.trim().slice(0, 3).toLowerCase())
    .filter(Boolean);
  let weekday: string;
  try {
    weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz })
      .format(new Date())
      .toLowerCase();
  } catch (e) {
    // Misconfigured BWB_WEEKLY_TZ (RangeError) — fail OPEN (proceed with the run)
    // rather than crash the weekly recap on an operator typo. Logged loud.
    console.error(
      `[bwb-weekly-orchestrator] schedule guard: invalid BWB_WEEKLY_TZ="${tz}" (${(e as any)?.message || e}) — failing OPEN, proceeding with this run.`,
    );
    return null;
  }
  if (!allowed.includes(weekday)) {
    return `today is ${weekday} (${tz}); the weekly recap only runs on ${allowed.join("/")} — set BWB_WEEKLY_FORCE=1 to override`;
  }
  const minGapDays = Number(process.env.BWB_WEEKLY_MIN_GAP_DAYS) || 2;
  const last = newestResultMtime();
  if (last !== null && Date.now() - last < minGapDays * 86_400_000) {
    const ageH = ((Date.now() - last) / 3_600_000).toFixed(1);
    return `a recap was already produced ${ageH}h ago (< ${minGapDays}d min-gap) — set BWB_WEEKLY_FORCE=1 to override`;
  }
  return null;
}

async function main() {
  const start = Date.now();
  console.log(`[bwb-weekly-orchestrator] starting (tenant=${TENANT_ID}, autopublish=${process.env.BWB_WEEKLY_AUTOPUBLISH === "1"})`);

  // Schedule guard FIRST — before claiming the production-priority lock or any
  // spend — so an off-schedule boot is a clean, zero-cost no-op (and doesn't
  // make the nightly maintenance jobs stand down for nothing). See docstring.
  const skip = scheduleSkipReason();
  if (skip) {
    console.log(`[bwb-weekly-orchestrator] schedule guard: skipping this run — ${skip}.`);
    process.exit(0);
  }

  // Production priority: claim the cross-process lock so the heavy nightly jobs
  // (skill optimizer, tenant audit, knowledge refresh, jury drainer, CI self-healer)
  // stand down while this render runs, then resume. Acquired EARLY (before preflight)
  // so it wins the boot-herd race; auto-releases on process exit; TTL + dead-pid
  // backstops guarantee a crashed render can never permanently wedge maintenance.
  acquireProductionPriority("bwb-weekly-render");

  // NOTE: the autonomous-spend claim is deliberately NOT taken here. The cheap
  // preconditions below (weight backfill, preflight) can refuse the run before any
  // spend — claiming up-front would orphan a $5 reservation on every preflight-
  // blocked run and pile false pressure against the daily cap. The claim is taken
  // just before the builder spawn, once the render (the real spend) is certain.

  // 0. Weight context (agentic, not hardcoded): the autonomous/scheduled run has
  // no human prompt, so backfill Bob's latest stated weight from the persisted
  // store (agent_settings) when the env didn't supply it. Bob updates these by
  // telling an agent his numbers; the workflow command no longer hardcodes them.
  if (!process.env.BWB_CURRENT_WEIGHT || !process.env.BWB_TOTAL_LOST) {
    try {
      const { getBwbWeight } = await import("../server/lib/bwb-weight");
      const w = await getBwbWeight();
      if (!process.env.BWB_CURRENT_WEIGHT && w.currentWeight) process.env.BWB_CURRENT_WEIGHT = String(w.currentWeight);
      if (!process.env.BWB_TOTAL_LOST && w.totalLost) process.env.BWB_TOTAL_LOST = String(w.totalLost);
      if (!process.env.BWB_START_WEIGHT && w.startWeight) process.env.BWB_START_WEIGHT = String(w.startWeight);
      console.log(`[bwb-weekly-orchestrator] weight context: current=${process.env.BWB_CURRENT_WEIGHT || "—"} lost=${process.env.BWB_TOTAL_LOST || "—"} (from persisted store)`);
    } catch (e) {
      logErr(`weight-context backfill failed (non-fatal, build may go qualitative): ${(e as any)?.message || e}`);
    }
  }

  // 0b. PREFLIGHT — catch a missing precondition (weightless coin-flip, prod
  // PAT-less render, wrong/empty voice, missing ffmpeg/yt-dlp) HERE, before the
  // builder spawns, so the scheduled run fails fast + loud with the exact fix
  // instead of burning a slot on a doomed render. Shares the same lib as the
  // bwb_weekly_build tool + the standalone CLI. Fail-OPEN on a guard crash.
  try {
    const { preflightWeeklyRecap } = await import("./lib/bwb-recap-preflight");
    const report = preflightWeeklyRecap();
    for (const c of report.checks) {
      if (!c.ok) logErr(`preflight ${c.severity}: ${c.label} — ${c.detail}${c.fix ? ` | FIX: ${c.fix}` : ""}`);
    }
    if (!report.ok) {
      const reason = `preflight blocked: ${report.blocking.map((b) => `${b.label} (${b.fix || "see log"})`).join("; ")}`;
      logErr(reason);
      await failBwbJob(reason);
      try {
        const { sendEmailDirect } = await import("../server/email");
        await sendEmailDirect({
          to: OWNER_EMAIL,
          subject: "Built With Bob weekly recap NOT started — preflight blocked",
          text: `The scheduled weekly recap was refused before render because a precondition is unmet:\n\n${report.blocking.map((b) => `• ${b.label}: ${b.detail}\n  FIX: ${b.fix || "(see log)"}`).join("\n\n")}\n\nNothing was rendered. Fix the item(s) above and the next scheduled run (or a manual bwb_weekly_build) will proceed.`,
        });
      } catch (e) {
        logErr(`preflight alert email failed (non-fatal): ${(e as any)?.message || e}`);
      }
      process.exit(3);
    }
    logErr(report.summary);
  } catch (e) {
    logErr(`preflight crashed (fail-open, proceeding): ${(e as any)?.message || e}`);
  }

  // Autonomous-spend governor: the render (transcription, narration, image
  // generation) is the most expensive autonomous loop and is now CERTAIN — the
  // cheap preconditions above have all passed. Atomic claim-before-spend reserves
  // an estimate under a per-tenant lock so a concurrent loop can't double-spend;
  // over-budget exits clean (0) so the scheduler doesn't flag a failure and the
  // next scheduled run resumes once budget frees. Fails CLOSED unless override.
  {
    const budget = await claimAutonomousBudget({ tenantId: TENANT_ID, estimatedUsd: 5, label: "bwb-weekly-orchestrator" });
    if (!budget.ok) {
      console.log(
        `[bwb-weekly-orchestrator] budget gate: ${budget.reason} (spent $${budget.spentUsd.toFixed(2)} / cap $${budget.capUsd.toFixed(2)}) — skipping this run.`,
      );
      process.exit(0);
    }
  }

  // 1. Produce: discover + synthesize + deliver via the canonical builder.
  // Capture output (instead of bare inherit) so a fail-closed build can quote the
  // reason back to Bob in the alert email — most failures here are the new
  // guards firing (clips not uploaded / wrong week / weight not supplied), which
  // Bob must SEE rather than have silently swallowed.
  const build = spawnSync("npx", ["tsx", "scripts/build-bwb-weekly.ts"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: sanitizeSpawnEnv(process.env),
  });
  if (build.stdout) process.stdout.write(build.stdout);
  if (build.stderr) process.stderr.write(build.stderr);
  if (build.status !== 0) {
    logErr(`build-bwb-weekly exited ${build.status} — no weekly recap produced this run.`);
    // The builder prints its fail-closed reason to STDERR as
    // "[build-bwb-weekly] FAIL: <reason>". The voluminous stdout (transcription +
    // planning + llm-trace logs) otherwise pushes that line out of any positional
    // tail slice, so extract it explicitly and LEAD with it in BOTH the /jobs card
    // and the alert email — otherwise Bob just sees "exited 1" + unrelated llm noise.
    const failMatch = (build.stderr || "").match(/\[build-bwb-weekly\] FAIL:\s*([\s\S]*?)(?:\n\s*\n|$)/);
    const failReason = (failMatch?.[1] || "").replace(/\s+/g, " ").trim();
    const tailOf = (s: string, n: number) =>
      (s || "").trim().split("\n").filter(Boolean).slice(-n).join("\n");
    // stderr is where crashes + stack traces land; the voluminous stdout would
    // otherwise bury it in a single combined tail (the bug that left every render
    // failure showing only "Node.js vX" with no real cause). Surface BOTH, stderr first.
    const errTail = tailOf(build.stderr || "", 22);
    const outTail = tailOf(build.stdout || "", 18);
    const tail = [
      errTail ? `── stderr (last 22) ──\n${errTail}` : "",
      outTail ? `── stdout (last 18) ──\n${outTail}` : "",
    ].filter(Boolean).join("\n\n") || "(no output captured)";
    try {
      const { sendEmailDirect } = await import("../server/email");
      await sendEmailDirect({
        to: OWNER_EMAIL,
        subject: "Built With Bob weekly recap NOT produced — build failed (fail-closed)",
        text:
          `The autonomous weekly recap build failed (exit ${build.status}) and NO video was produced or published.\n\n` +
          (failReason ? `WHY IT FAILED (fail-closed guard):\n${failReason}\n\n` : "") +
          `This is the fail-closed guard working as intended. A MISSING DAY does NOT cause this — partial weeks\n` +
          `(e.g. a day Bob couldn't walk) are built from whatever dated clips exist. The recap only stops when:\n` +
          `  • ZERO dated clips fell inside this week's Sun–Sat window — nothing at all to recap.\n` +
          `  • A clip is missing a date in its filename — name them "YYYY-MM-DD morning.mp4" / "YYYY-MM-DD evening.mp4".\n` +
          `  • Transcription failed for the clips that were found (no narration source).\n` +
          `  • No weight was supplied and the synthesizer tried to state a figure, OR it stated a number not matching the facts.\n\n` +
          `What to check / set before re-running:\n` +
          `  • Confirm this week's clips are in the Drive folder with dated filenames.\n` +
          `  • Pin an exact week: BWB_WEEK_START / BWB_WEEK_END (YYYY-MM-DD).\n` +
          `  • Supply this week's weight: BWB_CURRENT_WEIGHT / BWB_TOTAL_LOST.\n\n` +
          `Last lines of the build log:\n----------------------------------------\n${tail}\n----------------------------------------\n`,
      });
      logErr(`alerted ${OWNER_EMAIL} about the failed weekly build.`);
    } catch (e: any) {
      logErr(`failed to email owner about the build failure: ${e?.message || e}`);
    }
    // Flip the live progress row to failed (no-op if BWB_JOB_ID unset / already done).
    // Surface the REAL fail-closed reason on the card, not a positional stdout slice.
    await failBwbJob(
      failReason
        ? `Build failed — ${failReason}`
        : `build-bwb-weekly exited ${build.status} — ${tail.split("\n").slice(-3).join(" ")}`,
    );
    process.exit(3);
  }

  // 2. Pick up the produced result sidecar.
  const resultPath = findNewestResultSince(start);
  if (!resultPath) {
    logErr("Build reported success but no .result.json sidecar was found. Cannot publish/notify.");
    await failBwbJob("Build reported success but no .result.json sidecar was found.");
    process.exit(2);
  }
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  console.log(`[bwb-weekly-orchestrator] produced ${result.videoId} — "${result.title}" (deliveryUrl=${result.publicPlayLink || result.driveViewUrl || "n/a"})`);

  const ctx = {
    kind: "bwb-weekly" as const,
    tenantId: TENANT_ID,
    title: result.title as string,
    description: (result.description as string) || "",
    tags: (result.tags as string[]) || [],
    playlist: result.playlist as string,
    videoId: result.videoId as string,
    driveFileId: (result.driveFileId as string) || null,
    videoUrl: (result.publicPlayLink as string) || null,
    deliveryUrl: (result.publicPlayLink || result.driveViewUrl) as string,
    projectFileId: (result.projectFileId as number) || null,
  };

  // 2b. Publish-readiness preflight — surface dead/missing YouTube/Facebook
  // connections NOW (in logs + the approval email) instead of letting an
  // approve click silently half-fail at publish time.
  const { checkWeeklyPublishReadiness, readinessLines } = await import("../server/bwb-publish-preflight");
  const readiness = await checkWeeklyPublishReadiness(TENANT_ID);
  console.log(`[bwb-weekly-orchestrator] readiness youtube=${readiness.youtube.ready} facebook=${readiness.facebook.ready}`);
  if (!readiness.allReady) {
    logErr(`Publish preflight — not all platforms ready:\n${readinessLines(readiness)}`);
  }

  // 3a. AUTONOMY SWITCH — publish immediately.
  if (process.env.BWB_WEEKLY_AUTOPUBLISH === "1") {
    const { publishWeeklyVideo } = await import("../server/bwb-weekly-publish");
    const { sendEmailDirect } = await import("../server/email");
    const pub = await publishWeeklyVideo(ctx);
    console.log(`[bwb-weekly-orchestrator] AUTO-PUBLISH youtube=${pub.youtube.success} facebook=${pub.facebook.success}`);
    const ok = pub.youtube.success || pub.facebook.success;
    try {
      await sendEmailDirect({
        to: OWNER_EMAIL,
        subject: `Built With Bob weekly recap ${ok ? "PUBLISHED" : "PUBLISH FAILED"} — ${ctx.title}`,
        text:
          `Weekly recap "${ctx.title}" auto-published (BWB_WEEKLY_AUTOPUBLISH=1).\n\n` +
          `YouTube: ${pub.youtube.success ? pub.youtube.postUrl : "FAILED — " + (pub.youtube.error || "unknown")}\n` +
          `Facebook: ${pub.facebook.success ? pub.facebook.postUrl : "FAILED — " + (pub.facebook.error || "unknown")}\n\n` +
          `Preview/Download: ${ctx.deliveryUrl}\n` +
          (result.driveViewUrl ? `Drive: ${result.driveViewUrl}\n` : ""),
      });
    } catch (e: any) {
      logErr(`auto-publish notify email failed: ${e?.message || e}`);
    }
    if (!ok) {
      logErr("Both platforms failed to publish.");
      process.exit(4);
    }
    console.log("[bwb-weekly-orchestrator] done (auto-published).");
    process.exit(0);
  }

  // 3b. APPROVAL-FIRST — durable approval + one-tap email links.
  try {
    const { createApproval } = await import("../server/agentic/approvals");
    const { bwbCid } = await import("../server/bwb-weekly-publish");
    const { signHitlToken, resolveBaseUrl } = await import("../server/hitl-tokens");
    const { sendEmailDirect } = await import("../server/email");

    const approval = await createApproval({
      tenantId: TENANT_ID,
      requestedBy: "bwb-weekly-orchestrator",
      question: `Publish Built With Bob weekly recap "${ctx.title}" to YouTube + Facebook?`,
      context: ctx,
      ttlHours: APPROVAL_TTL_HOURS,
    });

    const cid = bwbCid(approval.id);
    const exp = Date.now() + APPROVAL_TTL_HOURS * 3600 * 1000;
    const base = resolveBaseUrl();
    const approveTok = signHitlToken({ cid, decision: "approve", tid: TENANT_ID, exp });
    const denyTok = signHitlToken({ cid, decision: "deny", tid: TENANT_ID, exp });
    const approveUrl = `${base}/api/bwb/approve?token=${encodeURIComponent(approveTok)}`;
    const denyUrl = `${base}/api/bwb/deny?token=${encodeURIComponent(denyTok)}`;

    await sendEmailDirect({
      to: OWNER_EMAIL,
      subject: `Approve this week's Built With Bob recap? — ${ctx.title}`,
      html:
        `<div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;">` +
        `<h2 style="margin:0 0 8px;">Built With Bob — Weekly Recap ready</h2>` +
        `<p style="color:#555;"><b>${ctx.title}</b><br/>Playlist: ${ctx.playlist}</p>` +
        `<p><a href="${ctx.deliveryUrl}" style="color:#2563eb;font-weight:600;">▶ Preview / Download the video</a></p>` +
        `<div style="background:${readiness.allReady ? "#f0fdf4" : "#fef2f2"};border:1px solid ${readiness.allReady ? "#bbf7d0" : "#fecaca"};border-radius:6px;padding:10px 14px;margin:12px 0;font-size:13px;color:#374151;">` +
        `<b>Channel readiness</b><br/>` +
        `YouTube: ${readiness.youtube.ready ? "✅ connected" : "⚠️ " + readiness.youtube.reason}<br/>` +
        `Facebook: ${readiness.facebook.ready ? "✅ connected" : "⚠️ " + readiness.facebook.reason}` +
        (readiness.allReady ? "" : `<br/><span style="color:#b91c1c;">Approving will only deliver to the ✅ channel(s) above until the others are connected.</span>`) +
        `</div>` +
        (result.thumbnailPath ? `<p style="color:#888;font-size:12px;">Thumbnail: ${result.thumbnailPath}</p>` : "") +
        `<p style="margin-top:24px;">Approve to publish to <b>YouTube (public)</b> + <b>Facebook (native video)</b>:</p>` +
        `<p>` +
        `<a href="${approveUrl}" style="background:#16a34a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;margin-right:12px;">Approve &amp; Publish</a>` +
        `<a href="${denyUrl}" style="background:#dc2626;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;">Deny</a>` +
        `</p>` +
        `<p style="color:#999;font-size:12px;margin-top:24px;">Link expires in ${APPROVAL_TTL_HOURS}h. A confirmation page protects against email link prefetchers.</p>` +
        `</div>`,
      text:
        `Built With Bob weekly recap ready: "${ctx.title}" (playlist ${ctx.playlist}).\n\n` +
        `Preview/Download: ${ctx.deliveryUrl}\n\n` +
        `Channel readiness:\n${readinessLines(readiness)}\n` +
        (readiness.allReady ? "" : `(Approving only delivers to the connected channel(s) above until the rest are connected.)\n`) +
        `\nApprove & publish (YouTube public + Facebook native video):\n${approveUrl}\n\nDeny:\n${denyUrl}\n\n` +
        `Link expires in ${APPROVAL_TTL_HOURS}h.`,
    });

    console.log(`[bwb-weekly-orchestrator] approval #${approval.id} created + emailed to ${OWNER_EMAIL}. Awaiting one-tap decision.`);
    process.exit(0);
  } catch (e: any) {
    logErr(`approval-first notify failed: ${e?.message || e}`);
    process.exit(4);
  }
}

main().catch((e) => {
  logErr(e?.message || String(e));
  process.exit(4);
});
