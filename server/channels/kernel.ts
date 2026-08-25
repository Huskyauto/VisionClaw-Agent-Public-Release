// R74.13z-quint+6 (OpenClaw nugget #5) — Channel Kernel Scaffold
//
// Background
// ----------
// VisionClaw currently has four inbound surfaces:
//   1. WhatsApp (Baileys, server/whatsapp.ts)
//   2. Twilio SMS (server/routes/whatsapp.ts has the legacy webhook bits)
//   3. Email (server/email-* paths)
//   4. MCP tool calls (server/mcp/*)
//
// Each one re-implements its own pre-loop policy: dedup, tenant resolution,
// persona selection, conversation lookup-or-create, then handing off to
// chat-engine.processMessage. Bugs introduced in WhatsApp's policy never
// propagated to Email and vice versa, which means we kept finding the same
// class of bug four times.
//
// OpenClaw (commit 3295689) consolidates all of this into one "channel
// kernel" — a thin seam every adapter calls. The adapter still owns its
// transport-specific quirks (Baileys session state, Twilio signing,
// IMAP polling) but the moment a normalized inbound turn is ready, the
// kernel takes over.
//
// This file is the **scaffold**. WhatsApp is the pilot adapter to migrate
// (see TODO at the bottom of `dispatchInbound`). SMS/Email/MCP migrations
// are deferred — the migration recipe is documented in the "Migration
// Path" block below so the next pass is mechanical.
//
// Design
// ------
// The kernel owns five pre/post-loop responsibilities:
//   (a) idempotency: short-circuit if we have already processed this
//       externalMessageId in the current process. (Adapters with their
//       own session-bound dedup, like WhatsApp's `pendingProcessing` Set,
//       still get the safety net.)
//   (b) tenant resolution: for now the adapter passes the tenantId in.
//       When SMS migrates we expect the kernel to grow a phone→tenant
//       lookup; that lookup belongs HERE not in three places.
//   (c) persona selection delegation: today the adapter resolves a persona
//       inside `getOrCreateConversation`. The kernel takes a
//       `resolveConversation` callback — when SMS/Email migrate, persona
//       selection consolidates into a single helper the kernel calls.
//   (d) running the agent loop via chat-engine.processMessage.
//   (e) returning a structured `KernelTurnResult` so the adapter can
//       decide how to deliver the response (WhatsApp wraps it in a
//       sendWhatsAppMessage with selfChat replyTo munging; SMS would
//       call Twilio.send; Email would call SES; MCP returns inline).
//
// The kernel does NOT own:
//   - Transport quirks (Baileys session state, Twilio signature check,
//     IMAP polling, MCP request framing). These stay in adapters.
//   - Outbound delivery. The kernel returns the response *text*; the
//     adapter calls its own send function and reports the providerAccepted
//     flag back via the new WhatsAppSendResult shape (T002).
//
// Migration Path (for future passes)
// ----------------------------------
// To migrate adapter X (SMS/Email/MCP):
//   1. Build a `normalizeInbound(rawWebhookOrPoll): InboundTurn` helper
//      in the adapter file that extracts channel, fromIdentifier, text,
//      externalMessageId, etc.
//   2. Replace the adapter's inline policy block (dedup, conversation
//      lookup, processMessage call) with a single
//      `await dispatchInbound(turn, { resolveConversation })` call.
//   3. The adapter still owns the outbound send and the channel-specific
//      reply-routing logic (selfChat, BCC, threading, MCP framing).
//   4. Add an entry to KNOWN_CHANNELS below.

import { processMessage } from "../chat-engine";
import { logSilentCatch } from "../lib/silent-catch";

export type ChannelName = "whatsapp" | "twilio_sms" | "email" | "mcp";

const KNOWN_CHANNELS: Set<ChannelName> = new Set(["whatsapp", "twilio_sms", "email", "mcp"]);

export interface InboundTurn {
  channel: ChannelName;
  tenantId: number;
  fromIdentifier: string; // JID for WA, E.164 for SMS, address for email, client-id for MCP
  text: string;
  mediaRefs?: string[];
  externalMessageId: string;
  raw?: unknown;
  receivedAt: Date;
}

export type DedupReason = null | "duplicate-external-id" | "concurrent-processing" | "empty-text";

export interface KernelTurnResult {
  ok: boolean;
  channel: ChannelName;
  externalMessageId: string;
  conversationId?: number;
  responseText?: string | null;
  dedupedAs: DedupReason;
  error?: string;
  durationMs: number;
}

// In-process idempotency map: externalMessageId -> first-seen timestamp.
// 30 minute TTL. A lightweight safety net for adapters that don't have
// their own dedup. WhatsApp's `pendingProcessing` Set still runs, so for
// WA this map is "second line of defense" not the primary check.
const SEEN_TTL_MS = 30 * 60 * 1000;
const SEEN_MAX_ENTRIES = 5000;
const seenMessages = new Map<string, number>();

function pruneSeen(now: number): void {
  if (seenMessages.size < SEEN_MAX_ENTRIES) return;
  // Drop entries older than TTL first; if still over cap, drop oldest.
  for (const [k, t] of seenMessages.entries()) {
    if (now - t > SEEN_TTL_MS) seenMessages.delete(k);
  }
  if (seenMessages.size >= SEEN_MAX_ENTRIES) {
    const overflow = seenMessages.size - Math.floor(SEEN_MAX_ENTRIES * 0.9);
    let i = 0;
    for (const k of seenMessages.keys()) {
      if (i++ >= overflow) break;
      seenMessages.delete(k);
    }
  }
}

function makeSeenKey(turn: InboundTurn): string {
  // R74.13z-quint+6 (architect-flagged) — Include fromIdentifier in the
  // key. Some providers' externalMessageIds are scoped per sender/thread
  // rather than globally unique (e.g., per-account counters, certain MCP
  // clients reusing request ids across sessions). Without fromIdentifier
  // in the key, two distinct messages from different senders that happen
  // to share an externalMessageId would false-dedup.
  return `${turn.channel}:${turn.tenantId}:${turn.fromIdentifier}:${turn.externalMessageId}`;
}

export interface DispatchOptions {
  // Adapter-supplied conversation resolver. Owns persona selection and
  // any channel-specific identifier mapping (WA's selfChat -> "self-chat",
  // SMS's E.164 -> conversation, etc.). Returns the conversationId to
  // pass to processMessage.
  resolveConversation: (turn: InboundTurn) => Promise<number>;
  // Optional channel-specific source tag for chat-engine. Defaults to
  // turn.channel ("whatsapp", "twilio_sms", etc.).
  source?: string;
}

export async function dispatchInbound(turn: InboundTurn, opts: DispatchOptions): Promise<KernelTurnResult> {
  const startedAt = Date.now();
  const baseResult = (overrides: Partial<KernelTurnResult>): KernelTurnResult => ({
    ok: false,
    channel: turn.channel,
    externalMessageId: turn.externalMessageId,
    dedupedAs: null,
    durationMs: Date.now() - startedAt,
    ...overrides,
  });

  if (!KNOWN_CHANNELS.has(turn.channel)) {
    return baseResult({ error: `Unknown channel: ${turn.channel}` });
  }
  if (!turn.text || turn.text.trim().length === 0) {
    return baseResult({ dedupedAs: "empty-text", ok: true });
  }

  // (a) idempotency
  const now = Date.now();
  pruneSeen(now);
  const seenKey = makeSeenKey(turn);
  const firstSeen = seenMessages.get(seenKey);
  if (firstSeen !== undefined && now - firstSeen < SEEN_TTL_MS) {
    return baseResult({ ok: true, dedupedAs: "duplicate-external-id" });
  }
  seenMessages.set(seenKey, now);

  // (b) tenant resolution: trust the adapter for now. TODO when SMS
  // migrates, add a phone→tenant lookup here.

  try {
    // (c) persona/conversation selection — delegated to adapter callback.
    const conversationId = await opts.resolveConversation(turn);

    // (d) run the agent loop.
    const engineResult = await processMessage(conversationId, turn.text, {
      source: opts.source ?? turn.channel,
    });

    // (e) structured result for the adapter to deliver.
    return baseResult({
      ok: true,
      conversationId,
      responseText: engineResult.response ?? null,
    });
  } catch (err: any) {
    // Drop the seen entry on hard failure so a retry can re-process.
    try { seenMessages.delete(seenKey); } catch (_e) { logSilentCatch("server/channels/kernel.ts", _e); }
    return baseResult({ error: err?.message ?? String(err) });
  }
}

// Test/diagnostic helpers (not for production hot paths).
export function _channelKernelStats() {
  return {
    seenEntries: seenMessages.size,
    knownChannels: Array.from(KNOWN_CHANNELS),
  };
}
export function _resetChannelKernelForTests() {
  seenMessages.clear();
}
