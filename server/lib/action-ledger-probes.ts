import { logSilentCatch } from "./silent-catch";
/**
 * Action Ledger S3 — provider verify probes (feature contract:
 * data/feature-contracts/action-ledger/ — spec.md + plan.md § S3).
 *
 * A verify probe answers ONE question about an `unknown` attempt: "did the
 * provider actually commit this side effect?" — by looking for provider-side
 * evidence keyed on the attempt's deterministic idempotency key.
 *
 * NON-NEGOTIABLE stance (contract risk note): probes fail toward `unknown` /
 * escalate, NEVER toward retry. A probe may return:
 *   - `committed` when it found positive provider-side proof of the commit;
 *   - `failed` ONLY with `proven: true` — i.e. the provider affirmatively
 *     recorded a failure. Absence of evidence is NOT failure.
 *   - `unknown` in every other case (no match, API error, bounded scan
 *     exhausted). The reconciler then routes the row to the owner digest.
 *
 * The Stripe probe uses the Events API: Stripe stamps the originating
 * request's idempotency key onto every event (`event.request.idempotency_key`),
 * so a bounded scan of the relevant event types since the attempt started is
 * positive proof of commit when it matches — and proof of nothing when it
 * doesn't (hence `unknown`, never `failed`).
 *
 * The Stripe client is pulled via call-time dynamic import so this module is
 * test-safe (no credentials / network touched unless a probe actually runs).
 */

export interface ProbeRow {
  toolName: string;
  idempotencyKey: string;
  startedAt: Date | string;
  tenantId: number;
}

export type VerifyProbeResult =
  | { outcome: "committed"; receipt?: unknown }
  | { outcome: "failed"; proven: true; receipt?: unknown }
  | { outcome: "unknown"; note?: string };

export type VerifyProbe = (row: ProbeRow) => Promise<VerifyProbeResult>;

/** Stripe money-movement tools → the event types that prove a commit. */
export const STRIPE_TOOL_EVENT_TYPES: Record<string, string[]> = {
  stripe_create_payout: ["payout.created"],
  stripe_create_transfer: ["transfer.created"],
  stripe_refund: ["refund.created", "charge.refunded"],
};

/**
 * Pure matcher: find the first event whose originating request carried the
 * attempt's idempotency key. Exported for unit tests.
 */
export function matchStripeEventByIdempotencyKey(
  events: Array<{ id?: string; type?: string; request?: { idempotency_key?: string | null } | null; data?: any }>,
  idempotencyKey: string,
): { id?: string; type?: string; data?: any } | undefined {
  if (!idempotencyKey) return undefined;
  return events.find(e => e?.request?.idempotency_key === idempotencyKey);
}

const MAX_EVENT_PAGES = 3;
const EVENTS_PER_PAGE = 100;
/** Look back a little before started_at — clock skew margin. */
const LOOKBACK_MARGIN_SECONDS = 600;

function toEpochSeconds(startedAt: Date | string): number {
  const ms = startedAt instanceof Date ? startedAt.getTime() : Date.parse(String(startedAt));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000) - 86400;
}

/** Events-API probe for Stripe money-movement attempts. */
export const stripeVerifyProbe: VerifyProbe = async (row) => {
  const types = STRIPE_TOOL_EVENT_TYPES[row.toolName];
  if (!types) return { outcome: "unknown", note: `no stripe event mapping for ${row.toolName}` };
  try {
    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();
    const createdGte = toEpochSeconds(row.startedAt) - LOOKBACK_MARGIN_SECONDS;
    let startingAfter: string | undefined;
    for (let page = 0; page < MAX_EVENT_PAGES; page++) {
      const batch: any = await stripe.events.list({
        types,
        created: { gte: createdGte },
        limit: EVENTS_PER_PAGE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      } as any);
      const events: any[] = batch?.data ?? [];
      const hit = matchStripeEventByIdempotencyKey(events, row.idempotencyKey);
      if (hit) {
        return {
          outcome: "committed",
          receipt: {
            source: "stripe_events_probe",
            eventId: hit.id,
            eventType: hit.type,
            objectId: hit.data?.object?.id,
          },
        };
      }
      if (!batch?.has_more || events.length === 0) break;
      startingAfter = events[events.length - 1]?.id;
      if (!startingAfter) break;
    }
    // Bounded scan found nothing — that proves NOTHING about failure.
    return { outcome: "unknown", note: "no matching stripe event in bounded scan" };
  } catch (e: any) {
    // Probe plumbing failure ⇒ unknown (fail toward escalation, never retry).
    return { outcome: "unknown", note: `stripe probe error: ${e?.message || e}` };
  }
};

// ---------------------------------------------------------------------------
// S4 — sent-mail verify probe (plan § S4).
//
// send_email is `sensitive`-risk (opt-in obligation); the S4 middleware set
// (LEDGER_OPT_IN_TOOL_NAMES) ledgers it, and sendEmailInternal stamps the
// attempt's idempotency key onto the outbound message as the
// `X-VC-Ledger-Key` header (AgentMail SendMessageRequest.headers). This probe
// scans the provider's message list for that header — positive provider-side
// proof of commit, exactly the Stripe events pattern. Same stance: absence of
// evidence is NOT failure ⇒ `unknown`, never `failed`.
// ---------------------------------------------------------------------------

/** Tools reconciled by the sent-mail probe. */
export const EMAIL_LEDGERED_TOOLS: ReadonlySet<string> = new Set(["send_email"]);

/** Outbound header carrying the ledger idempotency key (compared lowercase). */
export const EMAIL_LEDGER_HEADER = "x-vc-ledger-key";

/**
 * Pure matcher: find the first message whose headers carry the attempt's
 * idempotency key under EMAIL_LEDGER_HEADER (header names matched
 * case-insensitively — providers normalize casing). Exported for unit tests.
 */
export function matchEmailMessageByLedgerKey(
  messages: Array<{ messageId?: string; headers?: Record<string, string> | null; timestamp?: unknown; createdAt?: unknown }>,
  idempotencyKey: string,
): { messageId?: string; headers?: Record<string, string> | null } | undefined {
  if (!idempotencyKey) return undefined;
  return messages.find(m => {
    const h = m?.headers;
    if (!h || typeof h !== "object") return false;
    for (const [k, v] of Object.entries(h)) {
      if (k.toLowerCase() === EMAIL_LEDGER_HEADER && v === idempotencyKey) return true;
    }
    return false;
  });
}

const MAX_EMAIL_PAGES = 3;
const EMAILS_PER_PAGE = 50;
/** List items may omit headers — cap the per-probe detail fetches. */
const MAX_DETAIL_FETCHES = 20;

function toEpochMs(value: unknown, fallback: number): number {
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : fallback;
}

/** Sent-mail probe: bounded scan of the provider message list for the ledger-key header. */
export const emailVerifyProbe: VerifyProbe = async (row) => {
  try {
    const email = await import("../email");
    if (!email.isEmailConfigured()) {
      return { outcome: "unknown", note: "email provider not configured — cannot probe" };
    }
    const inboxId = await email.getPrimaryInboxId();
    const startedMs = toEpochMs(row.startedAt, Date.now() - 86_400_000);
    const windowStartMs = startedMs - LOOKBACK_MARGIN_SECONDS * 1000;

    let pageToken: string | undefined;
    let detailFetches = 0;
    for (let page = 0; page < MAX_EMAIL_PAGES; page++) {
      const batch: any = await email.listMessages(inboxId, EMAILS_PER_PAGE, pageToken);
      const items: any[] = batch?.messages ?? [];
      if (items.length === 0) break;

      // In-window candidates only (list is newest-first; items older than the
      // window can't be this attempt's send).
      const candidates = items.filter(m =>
        toEpochMs(m?.timestamp ?? m?.createdAt ?? m?.created_at, Date.now()) >= windowStartMs,
      );

      // Cheap pass: headers present on the list item itself.
      const listHit = matchEmailMessageByLedgerKey(candidates, row.idempotencyKey);
      if (listHit) {
        return {
          outcome: "committed",
          receipt: { source: "agentmail_sent_probe", messageId: (listHit as any).messageId ?? (listHit as any).message_id },
        };
      }

      // Bounded detail pass for candidates the list stripped headers from.
      for (const m of candidates) {
        if (m?.headers && typeof m.headers === "object") continue; // already checked above
        const msgId = m?.messageId ?? m?.message_id ?? m?.id;
        if (!msgId || detailFetches >= MAX_DETAIL_FETCHES) continue;
        detailFetches++;
        try {
          const detail: any = await email.getMessage(inboxId, msgId);
          const hit = matchEmailMessageByLedgerKey([detail ?? {}], row.idempotencyKey);
          if (hit) {
            return { outcome: "committed", receipt: { source: "agentmail_sent_probe", messageId: msgId } };
          }
        } catch (_silentErr) { logSilentCatch("server/lib/action-ledger-probes.ts", _silentErr); }
      }

      // Every remaining item is older than the window ⇒ deeper pages are too.
      if (candidates.length < items.length) break;
      pageToken = batch?.nextPageToken ?? batch?.next_page_token;
      if (!pageToken) break;
    }
    // Bounded scan found nothing — that proves NOTHING about failure. The
    // send may sit in the owner-digest queue or the provider list may lag.
    return { outcome: "unknown", note: "no matching sent message in bounded scan" };
  } catch (e: any) {
    return { outcome: "unknown", note: `email probe error: ${e?.message || e}` };
  }
};

/** Registry: tool name → verify probe. Entries: Stripe (S3), sent-mail (S4). */
export function getVerifyProbe(toolName: string): VerifyProbe | undefined {
  if (Object.hasOwn(STRIPE_TOOL_EVENT_TYPES, toolName)) return stripeVerifyProbe;
  if (EMAIL_LEDGERED_TOOLS.has(toolName)) return emailVerifyProbe;
  return undefined;
}
