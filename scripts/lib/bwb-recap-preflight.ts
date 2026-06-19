/**
 * Built With Bob — WEEKLY RECAP preflight.
 *
 * The executable form of the failure-mode catalog in
 * `.agents/skills/bwb-weekly-recap/pipeline-reference.md`. It checks every
 * precondition that has ever stalled or broken the weekly recap BEFORE a build
 * starts, so the run happens right the FIRST time instead of dying minutes (or
 * hours) in. Two gate sites share this one source of truth:
 *
 *   1. the `bwb_weekly_build` tool (Felix's chat path) — runs this BEFORE it
 *      creates the /jobs row + spawns, so a doomed run never starts and never
 *      leaves a zombie progress card; a blocking failure is returned to Felix
 *      verbatim with the exact one-line fix.
 *   2. `scripts/bwb-weekly-orchestrator.ts` (the scheduled-cron path) — runs it
 *      at startup and fails the job loudly if a blocking precondition is unmet.
 *
 * Also runnable standalone: `npx tsx scripts/bwb-recap-preflight.ts` (exit 0 =
 * ready, 1 = blocked, 2 = crash).
 *
 * Design rule: a check is `block` ONLY when it is the documented cause of a real
 * dead/stuck run (weight-facts coin-flip, prod PAT-less render, wrong/empty
 * voice, missing ffmpeg/yt-dlp). Everything else is `warn` — surfaced, never
 * fatal — so the preflight tightens the floor without becoming a new way to be
 * "unbroken in theory, blocked in practice".
 */
import { spawnSync } from "node:child_process";
import { sanitizeSpawnEnv } from "../../server/safety/spawn-env-guard";
import { isProductionRuntime } from "../../server/lib/runtime-env";
import { FISH_VOICE_BOB_DIRECT } from "../../server/lib/fish-voice-ids";

// NOTE: do NOT import from ./drive-discover here — it pulls googleapis, and this
// lib is dynamically imported into the server bundle (server/tools.ts). The
// drive-folder check only needs to know whether an id is resolvable, and
// discoverWeeklyDriveClips supplies its own built-in default folder id, so an
// absent BWB_DRIVE_FOLDER_ID still resolves at discovery time.

export type PreflightSeverity = "block" | "warn";

export interface PreflightCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: PreflightSeverity;
  detail: string;
  fix?: string;
}

export interface PreflightInput {
  currentWeight?: number;
  totalLost?: number;
  startWeight?: number;
  /** "github" (default farm) | "local" */
  renderBackend?: string;
  haveGithubPat?: boolean;
  /** effective Fish voice id the render will use */
  voiceId?: string;
  /** set when a deliberate non-Bob guest voice is authorized (BWB_VOICE_OVERRIDE_OK=1) */
  voiceOverrideOk?: boolean;
  source?: "drive" | "youtube";
  /** true when explicit URLS/WEEKLY were supplied (the URL transcript path) */
  haveUrls?: boolean;
  driveFolderId?: string;
  ownerEmail?: string;
  weekStart?: string;
  weekEnd?: string;
  /** intentional weightless run (BWB_ALLOW_WEIGHTLESS=1) */
  allowWeightless?: boolean;
  isProd?: boolean;
  /** skip the ffmpeg/yt-dlp binary probes (e.g. when the render runs off-box) */
  skipBinaryChecks?: boolean;
}

export interface PreflightReport {
  /** true when there are NO blocking failures */
  ok: boolean;
  checks: PreflightCheck[];
  blocking: PreflightCheck[];
  warnings: PreflightCheck[];
  summary: string;
}

const HEX32 = /^[0-9a-f]{32}$/i;

function envNum(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** True if a binary is callable (tries `<bin> <versionFlag>`, then `which <bin>`). */
function hasBinary(bin: string, versionFlag: string): boolean {
  // Scrub loader-hijack env vars (LD_*/DYLD_*/NODE_OPTIONS/...) before spawning
  // — probes must never inherit raw process.env (platform child-process invariant).
  const env = sanitizeSpawnEnv(process.env);
  try {
    const r = spawnSync(bin, [versionFlag], { stdio: "ignore", timeout: 8000, env });
    if (r.status === 0) return true;
  } catch {
    /* fall through to which */
  }
  try {
    const r = spawnSync("which", [bin], { stdio: "ignore", timeout: 8000, env });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** Build a PreflightInput from process.env; explicit `over` fields win. */
function resolveInput(over: PreflightInput): PreflightInput {
  const e = process.env;
  const source: "drive" | "youtube" =
    over.source ?? (e.BWB_SOURCE === "youtube" ? "youtube" : "drive");
  return {
    currentWeight: over.currentWeight ?? envNum(e.BWB_CURRENT_WEIGHT),
    totalLost: over.totalLost ?? envNum(e.BWB_TOTAL_LOST),
    startWeight: over.startWeight ?? envNum(e.BWB_START_WEIGHT),
    renderBackend: (over.renderBackend ?? e.BWB_RENDER_BACKEND ?? "github").toLowerCase(),
    haveGithubPat:
      over.haveGithubPat ?? !!(e.GITHUB_PERSONAL_ACCESS_TOKEN_2 || e.GITHUB_TOKEN),
    voiceId: over.voiceId ?? e.BWB_VOICE ?? FISH_VOICE_BOB_DIRECT,
    voiceOverrideOk: over.voiceOverrideOk ?? e.BWB_VOICE_OVERRIDE_OK === "1",
    source,
    haveUrls: over.haveUrls ?? !!(e.URLS || e.WEEKLY),
    driveFolderId: over.driveFolderId ?? e.BWB_DRIVE_FOLDER_ID ?? "(built-in default)",
    ownerEmail: over.ownerEmail ?? e.BWB_OWNER_EMAIL ?? e.OWNER_EMAIL ?? e.OWNER_ALERT_EMAIL,
    weekStart: over.weekStart ?? e.BWB_WEEK_START,
    weekEnd: over.weekEnd ?? e.BWB_WEEK_END,
    allowWeightless: over.allowWeightless ?? e.BWB_ALLOW_WEIGHTLESS === "1",
    isProd: over.isProd ?? isProductionRuntime(),
    skipBinaryChecks: over.skipBinaryChecks ?? false,
  };
}

/**
 * Run all weekly-recap preconditions. Pass explicit fields to reflect the EXACT
 * spawn env (the tool does this); omit them to read from process.env (CLI/cron).
 */
export function preflightWeeklyRecap(over: PreflightInput = {}): PreflightReport {
  const i = resolveInput(over);
  const checks: PreflightCheck[] = [];

  // 1. WEIGHT FACTS — the #1 "going nowhere" cause. A weightless run lets the
  //    synthesis honesty guard coin-flip the no-weight path; Bob's 3-hour break.
  if (i.currentWeight === undefined) {
    if (i.allowWeightless) {
      checks.push({
        id: "weight-facts",
        label: "Weight facts",
        ok: true,
        severity: "warn",
        detail: "no current weight supplied, but BWB_ALLOW_WEIGHTLESS=1 — synthesis will OMIT all weight numbers (intentional).",
      });
    } else {
      checks.push({
        id: "weight-facts",
        label: "Weight facts",
        ok: false,
        severity: "block",
        detail: "no current weight available (not in the call, not in the persisted store) — the synthesis honesty guard would coin-flip the no-weight path and the build can stall.",
        fix: "Pass currentWeight (and ideally totalLost/startWeight) to bwb_weekly_build, OR persist Bob's latest numbers (setBwbWeight / BWB_CURRENT_WEIGHT). To run weightless ON PURPOSE, set BWB_ALLOW_WEIGHTLESS=1.",
      });
    }
  } else {
    // Present — sanity-check internal consistency when all three are known.
    let detail = `current=${i.currentWeight}${i.totalLost ? ` lost=${i.totalLost}` : ""}${i.startWeight ? ` start=${i.startWeight}` : ""}`;
    let ok = true;
    let severity: PreflightSeverity = "warn";
    let fix: string | undefined;
    if (i.startWeight !== undefined && i.totalLost !== undefined) {
      const implied = i.startWeight - i.currentWeight;
      if (Math.abs(implied - i.totalLost) > 2) {
        ok = false;
        severity = "warn";
        detail += ` — INCONSISTENT: start−current = ${implied} but totalLost = ${i.totalLost} (off by ${Math.abs(implied - i.totalLost)} lb).`;
        fix = "Re-check the numbers; a typo here ships a wrong stat in the narration. Not blocking, but fix before publish.";
      }
    }
    checks.push({ id: "weight-facts", label: "Weight facts", ok, severity, detail, fix });
  }

  // 2. RENDER BACKEND / PAT — prod with the github farm and no PAT fails LOUD in
  //    the builder; catch it here so the doomed run never spawns.
  const backend = i.renderBackend === "local" ? "local" : "github";
  if (backend === "github" && !i.haveGithubPat) {
    if (i.isProd) {
      checks.push({
        id: "render-pat",
        label: "Render backend (PAT)",
        ok: false,
        severity: "block",
        detail: "prod + BWB_RENDER_BACKEND=github but no GitHub PAT — the local builder can't render in the published box, so the build would refuse and leave a zombie /jobs card.",
        fix: "Set GITHUB_PERSONAL_ACCESS_TOKEN_2 (or GITHUB_TOKEN) in the DEPLOYMENT env, then re-run.",
      });
    } else {
      checks.push({
        id: "render-pat",
        label: "Render backend (PAT)",
        ok: true,
        severity: "warn",
        detail: "no GitHub PAT in dev — will fall back to the LOCAL builder (serial-ish on the app box). Fine for a test; set the PAT to use the parallel farm.",
      });
    }
  } else {
    checks.push({
      id: "render-pat",
      label: "Render backend",
      ok: true,
      severity: "warn",
      detail: backend === "local" ? "explicit local builder." : "github farm (parallel) with PAT present.",
    });
  }

  // 3. VOICE — must be Bob's Fish clone unless a guest segment is authorized.
  const voice = (i.voiceId || "").trim();
  if (!voice) {
    checks.push({
      id: "voice",
      label: "Fish voice",
      ok: false,
      severity: "block",
      detail: "effective voice id is empty.",
      fix: "Leave BWB_VOICE unset (defaults to FISH_VOICE_BOB_DIRECT) or set a valid 32-hex Fish voice id.",
    });
  } else if (voice !== FISH_VOICE_BOB_DIRECT && !i.voiceOverrideOk) {
    checks.push({
      id: "voice",
      label: "Fish voice",
      ok: false,
      severity: "block",
      detail: `BWB_VOICE overrides Bob's clone (${voice.slice(0, 8)}…) without authorization — the recap MUST be in Bob's own voice.`,
      fix: "Unset BWB_VOICE to use Bob's clone, OR set BWB_VOICE_OVERRIDE_OK=1 for a deliberate guest segment.",
    });
  } else if (!HEX32.test(voice)) {
    checks.push({
      id: "voice",
      label: "Fish voice",
      ok: false,
      severity: "warn",
      detail: `voice id "${voice.slice(0, 12)}…" is not a 32-hex Fish id — may not resolve.`,
      fix: "Confirm the Fish voice id is correct (32 hex chars).",
    });
  } else {
    checks.push({
      id: "voice",
      label: "Fish voice",
      ok: true,
      severity: "warn",
      detail: voice === FISH_VOICE_BOB_DIRECT ? "Bob's Fish clone (FISH_VOICE_BOB_DIRECT)." : "authorized guest voice override.",
    });
  }

  // 4. DRIVE FOLDER — only matters on the auto-discover (drive, no URLs) path.
  if (i.source === "drive" && !i.haveUrls) {
    const folder = (i.driveFolderId || "").trim();
    checks.push({
      id: "drive-folder",
      label: "Drive drop-folder",
      ok: !!folder,
      severity: folder ? "warn" : "block",
      detail: folder ? `folder id set (${folder.slice(0, 6)}…).` : "no Drive folder id — auto-discovery has nothing to read.",
      fix: folder ? undefined : "Set BWB_DRIVE_FOLDER_ID, or supply URLS/WEEKLY for the manual path.",
    });
  }

  // 5. BINARIES — discovery/transcription run on THIS box (even when the render
  //    goes to the farm). ffmpeg is needed on every path; yt-dlp only on the
  //    YouTube/URL path.
  if (!i.skipBinaryChecks) {
    const haveFfmpeg = hasBinary("ffmpeg", "-version");
    checks.push({
      id: "ffmpeg",
      label: "ffmpeg",
      ok: haveFfmpeg,
      severity: haveFfmpeg ? "warn" : "block",
      detail: haveFfmpeg ? "available." : "not found — audio extraction for transcription will fail.",
      fix: haveFfmpeg ? undefined : "Install ffmpeg in this environment (package management).",
    });
    const needYtDlp = i.source === "youtube" || i.haveUrls;
    if (needYtDlp) {
      const haveYtDlp = hasBinary("yt-dlp", "--version");
      checks.push({
        id: "yt-dlp",
        label: "yt-dlp",
        ok: haveYtDlp,
        severity: haveYtDlp ? "warn" : "block",
        detail: haveYtDlp ? "available." : "not found — the YouTube/URL transcript path can't pull audio.",
        fix: haveYtDlp ? undefined : "Install yt-dlp, or use the Drive auto-discover path (BWB_SOURCE=drive, no URLS).",
      });
    }
  }

  // 6. OWNER EMAIL (delivery target) — warn only.
  checks.push({
    id: "owner-email",
    label: "Delivery email",
    ok: !!i.ownerEmail,
    severity: "warn",
    detail: i.ownerEmail ? `delivers to ${i.ownerEmail}.` : "no OWNER_EMAIL — falls back to the built-in default.",
  });

  // 7. WEEK WINDOW — informational.
  const pinned = !!(i.weekStart && i.weekEnd);
  checks.push({
    id: "week-window",
    label: "Week window",
    ok: true,
    severity: "warn",
    detail: pinned ? `pinned ${i.weekStart} → ${i.weekEnd}.` : "no explicit week — uses the trailing discovery window.",
  });

  const blocking = checks.filter((c) => !c.ok && c.severity === "block");
  const warnings = checks.filter((c) => !c.ok && c.severity === "warn");
  const ok = blocking.length === 0;
  const summary = ok
    ? `PREFLIGHT PASS — ${checks.length} checks, 0 blocking${warnings.length ? `, ${warnings.length} warning(s)` : ""}. Safe to build.`
    : `PREFLIGHT BLOCKED — ${blocking.length} must-fix: ${blocking.map((b) => b.label).join(", ")}.`;

  return { ok, checks, blocking, warnings, summary };
}
