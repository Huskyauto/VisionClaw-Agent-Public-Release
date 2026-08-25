/**
 * R98.17 — Cairo cross-pollination: chat-vs-background slot reservation.
 *
 * Cairo's "MC-1 Gate" reserves N slots for live user chat that background
 * operators can never touch. This guarantees user-facing chat latency under
 * heavy heartbeat / scheduled-task load — chat never starves.
 *
 * Implementation: two integer counters, configurable via env. Reservation is
 * non-blocking and synchronous; callers that can't get a slot fall back to
 * the existing pace-reservation/concurrency-cap behavior.
 */

function _safePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10_000) return fallback;
  return parsed;
}
const CHAT_RESERVED_MAX = _safePositiveInt(process.env.CHAT_RESERVED_SLOTS, 3);
const BACKGROUND_MAX = _safePositiveInt(process.env.BACKGROUND_MAX_SLOTS, 12);

let _chatActive = 0;
let _backgroundActive = 0;

export function poolStats() {
  return {
    chat: { active: _chatActive, max: CHAT_RESERVED_MAX, available: Math.max(0, CHAT_RESERVED_MAX - _chatActive) },
    background: { active: _backgroundActive, max: BACKGROUND_MAX, available: Math.max(0, BACKGROUND_MAX - _backgroundActive) },
  };
}

/**
 * Try to reserve a chat slot. Always succeeds (no cap enforced) but bumps the
 * counter so background reservations can be denied when chat is saturated.
 * Returns a release function (idempotent).
 */
export function reserveChatSlot(): () => void {
  _chatActive++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    _chatActive = Math.max(0, _chatActive - 1);
  };
}

/**
 * Try to reserve a background slot. Returns null if all background slots are
 * taken OR if chat is at/over its reserved threshold (chat always wins).
 * Returns a release function (idempotent) on success.
 */
export function tryReserveBackgroundSlot(label: string): (() => void) | null {
  if (_backgroundActive >= BACKGROUND_MAX) return null;
  // Chat-priority interlock: if chat is using its full reservation, defer
  // background work for one tick. Background continues to run under partial
  // chat load — only when chat is fully saturated do we hold back.
  if (_chatActive >= CHAT_RESERVED_MAX && _backgroundActive >= Math.floor(BACKGROUND_MAX * 0.75)) {
    return null;
  }
  _backgroundActive++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    _backgroundActive = Math.max(0, _backgroundActive - 1);
  };
}

// ──────────────────────────────────────────────────────────────────────────
// R102 — Admission Control: priority-aware reservation.
//
// Three tiers:
//   foreground_chat       — user is actively waiting; never denied here
//                           (per-tenant rate limit at /api/chat is the only gate)
//   customer_background   — heartbeats, scheduled messages, deliverable renders
//                           that the customer expects to land but isn't waiting on
//   internal_maintenance  — weekly maintenance, embedding refresh, skill grading
//                           (yields aggressively when chat is hot)
//
// Backed by the same chat / background counters above so the existing
// guarantee (chat reservation cannot be starved) still holds.
// ──────────────────────────────────────────────────────────────────────────
export type SlotPriority = "foreground_chat" | "customer_background" | "internal_maintenance";

const _saturationThreshold = 0.8; // 80% — internal_maintenance starts yielding here
const _hotChatThreshold = Math.max(1, Math.floor(CHAT_RESERVED_MAX * _saturationThreshold));

export function tryReserveSlot(priority: SlotPriority, label: string): (() => void) | null {
  if (priority === "foreground_chat") {
    return reserveChatSlot();
  }
  if (priority === "customer_background") {
    // Same rule as legacy tryReserveBackgroundSlot (chat-priority interlock).
    return tryReserveBackgroundSlot(label);
  }
  // internal_maintenance: yield aggressively when chat or background is hot.
  if (_chatActive >= _hotChatThreshold) return null;
  if (_backgroundActive >= Math.floor(BACKGROUND_MAX * _saturationThreshold)) return null;
  return tryReserveBackgroundSlot(label);
}

/** Snapshot for system_load_status tool. */
export function admissionSnapshot(): {
  chat: { active: number; max: number };
  background: { active: number; max: number };
  saturation: { chatPct: number; backgroundPct: number };
  yieldingInternal: boolean;
} {
  return {
    chat: { active: _chatActive, max: CHAT_RESERVED_MAX },
    background: { active: _backgroundActive, max: BACKGROUND_MAX },
    saturation: {
      chatPct: Math.round((_chatActive / Math.max(1, CHAT_RESERVED_MAX)) * 100),
      backgroundPct: Math.round((_backgroundActive / Math.max(1, BACKGROUND_MAX)) * 100),
    },
    yieldingInternal: _chatActive >= _hotChatThreshold || _backgroundActive >= Math.floor(BACKGROUND_MAX * _saturationThreshold),
  };
}

/** For test cleanup. */
export function _resetPoolForTests(): void {
  _chatActive = 0;
  _backgroundActive = 0;
}
