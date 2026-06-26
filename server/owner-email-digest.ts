// Owner Email Digest — single choke-point gate that batches every email
// addressed to the owner (Bob) into ONE daily digest instead of letting
// every script, cron, alert and self-healer page him independently.
//
// Triggered when Bob said "I've gotten over 300 emails so that's just too
// much once a day give me your report that's it shut everything else down".
//
// Behavior:
//   - sendEmail() in server/email.ts calls maybeQueueOwnerEmail() FIRST.
//   - If the recipient set is owner-only and OWNER_EMAIL_MODE !== "immediate",
//     the message is appended to data/owner-email-digest.json and the send
//     is suppressed (returns a sentinel result that callers treat as success).
//   - If any non-owner recipient is in to/cc/bcc (real customer email), the
//     send is allowed to proceed unchanged — customer transactional emails
//     are NEVER batched.
//   - Each call also checks "is it digest-flush time?" — if 24h have passed
//     since the last digest send AND the current UTC hour >= OWNER_DIGEST_HOUR_UTC,
//     we flush the queue as one summary email and reset the timer.
//
// Env knobs (all optional):
//   OWNER_EMAIL_MODE       digest|immediate|silent   (default: digest)
//                            digest    = batch into 1/day
//                            immediate = pre-rate-limit behavior
//                            silent    = drop on the floor (no email at all)
//   OWNER_DIGEST_HOUR_UTC  0-23  (default: 13 = 8am US Central)
//   OWNER_DIGEST_RECIPIENTS  CSV — extra addresses to treat as "owner"
//
// The detection is env-driven (OWNER_EMAIL, OWNER_ALERT_EMAIL, OWNER_EMAILS,
// SITE_OWNER_EMAIL, SITE_CONTACT_EMAIL) via resolveOwnerEmails(). A fork with
// none of these set treats no address as "owner", so no owner email is sent.

import fs from "fs";
import path from "path";
import { resolveOwnerEmail, resolveOwnerEmails } from "./lib/owner-email";

const QUEUE_FILE = path.join(process.cwd(), "data", "owner-email-digest.json");
const STATE_FILE = path.join(process.cwd(), "data", "owner-email-digest-state.json");
const MODE = (process.env.OWNER_EMAIL_MODE || "digest").toLowerCase();
const FLUSH_HOUR_UTC = Math.max(0, Math.min(23, parseInt(process.env.OWNER_DIGEST_HOUR_UTC || "13", 10)));
const FLUSH_INTERVAL_MS = 24 * 60 * 60 * 1000;

type QueuedEmail = {
  ts: string;
  subject: string;
  to: string;
  cc?: string;
  source?: string;
  preview: string;
};

type DigestState = {
  lastFlushAt: number;
  lastFlushDate: string; // UTC YYYY-MM-DD — anchors cadence to calendar day, not first-queue time
  queuedSinceLastFlush: number;
};

// In-process flush mutex. Prevents the opportunistic flush triggered by
// every sendEmail call from racing the scheduled flush triggered by
// startOwnerDigestScheduler(). Simple boolean is sufficient: Node single-
// threaded event loop guarantees the check+set is atomic at this granularity.
let flushInFlight = false;

function ownerAddressSet(): Set<string> {
  const extras = String(process.env.OWNER_DIGEST_RECIPIENTS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const all = [...resolveOwnerEmails(), ...extras];
  return new Set(all.map((s) => s.toLowerCase()));
}

function normalizeAddresses(field: unknown): string[] {
  if (field == null) return [];
  const out: string[] = [];
  const push = (s: unknown) => {
    if (typeof s === "string") {
      for (const piece of s.split(/[,;]/)) {
        const v = piece.trim().toLowerCase();
        // Strip "Name <email@x>" wrapping.
        const m = v.match(/<([^>]+)>/);
        const addr = m ? m[1] : v;
        if (addr) out.push(addr);
      }
    } else if (s && typeof s === "object") {
      const e = (s as any).email || (s as any).address;
      if (typeof e === "string") push(e);
    }
  };
  if (Array.isArray(field)) field.forEach(push); else push(field);
  return out;
}

function readQueue(): QueuedEmail[] {
  try {
    const raw = fs.readFileSync(QUEUE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// R105.1 +sec — Architect MEDIUM closed: atomic write (tmp + fsync + rename)
// so a crash mid-write or two concurrent writers can't corrupt the JSON or
// silently drop queued owner alerts. Tmp file lives in the same directory so
// rename is atomic on the same filesystem. fsync flushes to disk before the
// rename. Best-effort — fail-open keeps email path running if disk hiccups.
function atomicWriteFile(target: string, data: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

function writeQueue(items: QueuedEmail[]): void {
  try {
    atomicWriteFile(QUEUE_FILE, JSON.stringify(items, null, 2));
  } catch (err: any) {
    console.warn(`[owner-digest] failed to persist queue: ${err.message}`);
  }
}

function readState(): DigestState {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      lastFlushAt: Number(parsed.lastFlushAt) || 0,
      lastFlushDate: String(parsed.lastFlushDate || ""),
      queuedSinceLastFlush: Number(parsed.queuedSinceLastFlush) || 0,
    };
  } catch {
    return { lastFlushAt: 0, lastFlushDate: "", queuedSinceLastFlush: 0 };
  }
}

function utcDateString(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function writeState(s: DigestState): void {
  try {
    atomicWriteFile(STATE_FILE, JSON.stringify(s, null, 2));
  } catch (err: any) {
    console.warn(`[owner-digest] failed to persist state: ${err.message}`);
  }
}

export function isOwnerOnlyRecipients(params: {
  to?: unknown; cc?: unknown; bcc?: unknown;
}): boolean {
  const owners = ownerAddressSet();
  const all = [
    ...normalizeAddresses(params.to),
    ...normalizeAddresses(params.cc),
    ...normalizeAddresses(params.bcc),
  ];
  if (all.length === 0) return false;
  return all.every((a) => owners.has(a));
}

function shouldFlushNow(state: DigestState): boolean {
  if (state.queuedSinceLastFlush === 0) return false;
  const now = new Date();
  const today = utcDateString(now);
  // Calendar-based cadence: at most one digest per UTC date. Sends as soon as
  // we cross OWNER_DIGEST_HOUR_UTC on a date we haven't flushed yet. This is
  // robust to first-queue drift (architect R103 finding #1) and gives Bob a
  // genuinely "once per day" cadence anchored to the configured hour.
  if (state.lastFlushDate === today) return false;
  return now.getUTCHours() >= FLUSH_HOUR_UTC;
}

export type GateResult =
  | { action: "pass-through" }
  | { action: "queued"; queuedCount: number }
  | { action: "silenced" };

// Called from sendEmail BEFORE the actual send. Returns:
//   pass-through  → caller proceeds with normal send
//   queued        → caller MUST NOT send; message is in the digest
//   silenced      → caller MUST NOT send; message is dropped entirely
export function maybeQueueOwnerEmail(params: {
  to: unknown; cc?: unknown; bcc?: unknown;
  subject?: string; text?: string; html?: string;
  source?: string;
}): GateResult {
  if (MODE === "immediate") return { action: "pass-through" };
  if (!isOwnerOnlyRecipients(params)) return { action: "pass-through" };

  if (MODE === "silent") {
    console.log(`[owner-digest] silenced (OWNER_EMAIL_MODE=silent): subject="${params.subject || ""}"`);
    return { action: "silenced" };
  }

  const queue = readQueue();
  queue.push({
    ts: new Date().toISOString(),
    subject: String(params.subject || "(no subject)").slice(0, 200),
    to: normalizeAddresses(params.to).join(", "),
    cc: normalizeAddresses(params.cc).join(", ") || undefined,
    source: params.source,
    preview: String(params.text || params.html || "").replace(/\s+/g, " ").trim().slice(0, 280),
  });
  writeQueue(queue);

  const state = readState();
  state.queuedSinceLastFlush = (state.queuedSinceLastFlush || 0) + 1;
  writeState(state);

  console.log(`[owner-digest] queued (${queue.length} pending): "${params.subject || ""}"`);
  return { action: "queued", queuedCount: queue.length };
}

// Build the digest body and (if it's flush time) send it. Safe to call as
// often as you like — it no-ops unless 24h have passed AND there are queued
// items AND we're past OWNER_DIGEST_HOUR_UTC.
export async function flushIfDue(): Promise<{ flushed: boolean; count?: number; reason?: string }> {
  // Mutex (architect R103 finding #3) — prevents the opportunistic-from-
  // sendEmail flush from racing the scheduler-tick flush on the same queue.
  if (flushInFlight) return { flushed: false, reason: "already-in-flight" };
  flushInFlight = true;
  try {
    // Silent mode short-circuit (architect re-review): "silent" is documented
    // as "no email at all" — never emit a digest even if pre-existing queue
    // exists. Drain the queue so it doesn't grow unbounded.
    if (MODE === "silent") {
      const queue = readQueue();
      if (queue.length > 0) {
        writeQueue([]);
        const state = readState();
        state.lastFlushAt = Date.now();
        state.lastFlushDate = utcDateString();
        state.queuedSinceLastFlush = 0;
        writeState(state);
        console.log(`[owner-digest] silent mode — dropped ${queue.length} queued items without sending`);
      }
      return { flushed: false, reason: "silent-mode" };
    }
    const state = readState();
    if (!shouldFlushNow(state)) return { flushed: false, reason: "not-due" };

    const queue = readQueue();
    if (queue.length === 0) {
      state.lastFlushAt = Date.now();
      state.lastFlushDate = utcDateString();
      state.queuedSinceLastFlush = 0;
      writeState(state);
      return { flushed: false, reason: "empty-queue" };
    }

    // Build digest before clearing — if send fails we'll retry next tick.
    const digest = renderDigest(queue);
    const recipient = resolveOwnerEmail();
    if (!recipient) {
      // No owner address configured (e.g. a fresh fork) — drop the queue
      // instead of sending to a hardcoded personal address.
      writeQueue([]);
      state.lastFlushAt = Date.now();
      state.lastFlushDate = utcDateString();
      state.queuedSinceLastFlush = 0;
      writeState(state);
      return { flushed: false, reason: "no-owner-email" };
    }

    try {
      const { sendEmailDirect } = await import("./email");
      await sendEmailDirect({
        to: recipient,
        subject: `[VisionClaw daily digest] ${queue.length} alerts — ${new Date().toUTCString().slice(0, 16)}`,
        text: digest,
      });
      writeQueue([]);
      state.lastFlushAt = Date.now();
      state.lastFlushDate = utcDateString();
      state.queuedSinceLastFlush = 0;
      writeState(state);
      console.log(`[owner-digest] flushed ${queue.length} queued emails to ${recipient}`);
      return { flushed: true, count: queue.length };
    } catch (err: any) {
      console.error(`[owner-digest] flush failed (will retry next tick): ${err?.message || err}`);
      return { flushed: false, reason: `send-failed: ${err?.message}` };
    }
  } finally {
    flushInFlight = false;
  }
}

// Independent scheduler — fires regardless of inbound email traffic so a
// quiet weekend can't strand queued alerts (architect R103 finding #2).
// flushIfDue() is internally idempotent (calendar-date check + mutex), so
// firing every 10 minutes is cheap and safe.
let schedulerHandle: ReturnType<typeof setInterval> | null = null;
const SCHEDULER_TICK_MS = 10 * 60 * 1000;

export function startOwnerDigestScheduler(): void {
  if (schedulerHandle) return;
  if (MODE === "immediate") {
    console.log(`[owner-digest] scheduler not started (OWNER_EMAIL_MODE=immediate)`);
    return;
  }
  schedulerHandle = setInterval(() => {
    flushIfDue().catch((e) => console.warn(`[owner-digest] scheduled flush error: ${e?.message}`));
  }, SCHEDULER_TICK_MS);
  // Don't keep the event loop alive solely on this timer.
  if (typeof (schedulerHandle as any).unref === "function") (schedulerHandle as any).unref();
  console.log(`[owner-digest] scheduler started (mode=${MODE}, flush window from ${FLUSH_HOUR_UTC}:00 UTC, tick=${SCHEDULER_TICK_MS / 60000}min)`);
}

export function stopOwnerDigestScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}

function renderDigest(items: QueuedEmail[]): string {
  // Group by source for scannability.
  const bySource = new Map<string, QueuedEmail[]>();
  for (const it of items) {
    const k = it.source || "(unsourced)";
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k)!.push(it);
  }
  const sortedSources = [...bySource.keys()].sort((a, b) => bySource.get(b)!.length - bySource.get(a)!.length);

  const out: string[] = [];
  out.push(`VisionClaw daily owner digest`);
  out.push(`============================`);
  out.push(`Window: last ~24h. Total queued: ${items.length}`);
  out.push(`Mode: OWNER_EMAIL_MODE=${MODE} (set to "immediate" to revert, "silent" to mute entirely)`);
  out.push(``);
  for (const src of sortedSources) {
    const list = bySource.get(src)!;
    out.push(`── ${src} (${list.length}) ──`);
    for (const it of list.slice(0, 50)) {
      const ts = it.ts.replace("T", " ").slice(5, 16);
      out.push(`  ${ts}  ${it.subject}`);
      if (it.preview) out.push(`              ${it.preview.slice(0, 200)}`);
    }
    if (list.length > 50) out.push(`  …and ${list.length - 50} more from this source`);
    out.push(``);
  }
  out.push(`-- end digest --`);
  return out.join("\n");
}

export function digestStatus(): { mode: string; queued: number; lastFlushAt: number; lastFlushDate: string; flushHourUtc: number; schedulerRunning: boolean } {
  const state = readState();
  const queued = readQueue().length;
  return {
    mode: MODE,
    queued,
    lastFlushAt: state.lastFlushAt,
    lastFlushDate: state.lastFlushDate,
    flushHourUtc: FLUSH_HOUR_UTC,
    schedulerRunning: schedulerHandle !== null,
  };
}
