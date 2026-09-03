/**
 * Delivery Funnel — SSRN 6859839 (MIT 2026, "the AI dividend meets an awkward
 * reality").
 *
 * The study found autonomous AI coding agents raised commits ~180% but releases
 * only ~30%, and app-marketplace listings rose while total usage did not. The
 * lesson: production throughput is not the bottleneck — the weak links are
 * shipping (review / integrate / test / package) and ADOPTION (does the thing
 * that got built actually get used). Raw output volume is a vanity metric.
 *
 * VisionClaw's structural analog: the platform is very good at PRODUCING
 * deliverables (videos, PDFs, landing pages). This module makes the
 * produce -> ship -> adopt funnel MEASURABLE so the same illusion ("more made =
 * more value") becomes a number on /admin/ecosystem-health instead of a vibe:
 *   - produced = delivery_logs rows created            (the "commits" analog)
 *   - shipped  = delivery_logs.status = 'completed'     (the "releases" analog)
 *   - adopted  = a shipped deliverable that was actually fetched/downloaded by
 *                its recipient                          (the "usage" analog)
 *
 * Honesty note (the whole point of the paper): the adoption signal counts
 * confirmed fetches of self-hosted /uploads/delivery-N-* files only. Instant-play
 * video views (/watch, /v) use random tokens NOT linked to a delivery row, so
 * they are not yet counted — `adopted` is therefore a FLOOR, never an inflated
 * number. Manufacturing a fake adoption metric would be the exact "AI slop" the
 * paper warns against.
 *
 * Design invariants (mirrors server/orchestration-efficiency.ts):
 *  - recordDeliveryEngagement is fire-and-forget telemetry: every write is
 *    time-capped and wrapped so it can never block, slow, or throw into the
 *    file-serving hot path.
 *  - summarizeDeliveryFunnel is read-only and tenant-scoped.
 */

import { db } from "./db";
import { logSilentCatch } from "./lib/silent-catch";
import { sql } from "drizzle-orm";

const WRITE_TIMEOUT_MS = 6000;

/** Resolve to null instead of hanging the hot path if the DB write stalls. */
function raceDb<T>(p: Promise<T>, ms = WRITE_TIMEOUT_MS): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export type DeliveryEngagementType = "fetch" | "download";

export interface DeliveryEngagementRecord {
  tenantId: number;
  deliveryId?: number | null;
  eventType?: DeliveryEngagementType;
  fileName?: string | null;
}

/**
 * Fire-and-forget adoption-signal write. Call WITHOUT awaiting on the hot path.
 * Never throws, never blocks beyond WRITE_TIMEOUT_MS.
 */
export async function recordDeliveryEngagement(rec: DeliveryEngagementRecord): Promise<void> {
  try {
    if (!rec || !Number.isInteger(rec.tenantId) || rec.tenantId <= 0) return;
    const deliveryId =
      Number.isInteger(rec.deliveryId as number) && (rec.deliveryId as number) > 0
        ? (rec.deliveryId as number)
        : null;
    const eventType: DeliveryEngagementType = rec.eventType === "download" ? "download" : "fetch";
    const fileName = (rec.fileName || "").slice(0, 512) || null;
    await raceDb(
      db.execute(sql`
        INSERT INTO delivery_engagement (tenant_id, delivery_id, event_type, file_name)
        VALUES (${rec.tenantId}, ${deliveryId}, ${eventType}, ${fileName})
      `),
    );
  } catch (_silentErr) {
    logSilentCatch("server/delivery-funnel.ts", _silentErr);
  }
}

export interface DeliveryFetchSignal {
  method: string;
  baseName: string;
  range?: string;
  statusCode: number;
}

export interface DeliveryFetchDecision {
  record: boolean;
  deliveryId: number | null;
}

/**
 * Pure decision: should a COMPLETED /uploads request count as an adoption
 * signal? Honesty rule (SSRN 6859839 — "no fabricated adoption"): only a
 * SUCCESSFUL (200/206) INITIAL GET (no Range header, or a range starting at
 * byte 0) of a `delivery-N-*` file counts. A 404/403/304, a mid-stream 206
 * chunk, a non-GET, or a non-delivery filename must NOT record — otherwise a
 * tenant requesting `/uploads/delivery-<id>-anything` could inflate adoption
 * even when the file never actually served. Unit-testable so this rule can't
 * silently regress.
 */
export function parseDeliveryFetch(sig: DeliveryFetchSignal): DeliveryFetchDecision {
  const no: DeliveryFetchDecision = { record: false, deliveryId: null };
  if (!sig || sig.method !== "GET") return no;
  if (sig.statusCode !== 200 && sig.statusCode !== 206) return no;
  const m = /^delivery-(\d+)-/.exec(sig.baseName || "");
  if (!m) return no;
  const range = (sig.range || "").trim();
  const isInitialFetch = !range || /^bytes=0-/.test(range);
  if (!isInitialFetch) return no;
  const id = Number(m[1]);
  return { record: true, deliveryId: Number.isFinite(id) ? id : null };
}

export interface DeliveryFunnelSummary {
  /** deliverables created in the window (the "commits" analog). */
  produced: number;
  /** deliverables that reached status='completed' (the "releases" analog). */
  shipped: number;
  /** shipped deliverables with >=1 confirmed recipient fetch (the "usage" analog). */
  adopted: number;
  /** shipped / produced — how much of what we START actually ships. */
  shipRatio: number;
  /** adopted / shipped — how much of what we SHIP actually gets used. */
  adoptRatio: number;
  windowDays: number;
  shipThreshold: number;
  adoptThreshold: number;
  breached: boolean;
  /**
   * True when the funnel query FAILED and these numbers are a fallback, not a
   * real measurement. Without this, a broken instrumentation path returns
   * all-zeros that look like a healthy "nothing produced yet" state — masking
   * the outage. SSRN 6859839's whole point is honest signal: a zero we can't
   * trust must announce itself, never pose as data.
   */
  degraded: boolean;
}

const WINDOW_DAYS = 90;
const SHIP_THRESHOLD = 0.7; // <70% of produced deliverables shipping = a weak shipping link
const ADOPT_THRESHOLD = 0.5; // <50% of shipped deliverables ever fetched = a weak adoption link
const MIN_SAMPLE = 10;

/**
 * Pure ratio/breach computation — unit-testable without a DB. Clamps so the
 * funnel can never be incoherent (adopted <= shipped <= produced).
 */
export function computeFunnelMetrics(
  produced: number,
  shipped: number,
  adopted: number,
): { shipRatio: number; adoptRatio: number; breached: boolean } {
  const p = Math.max(0, Math.floor(produced || 0));
  const s = Math.max(0, Math.min(Math.floor(shipped || 0), p));
  const a = Math.max(0, Math.min(Math.floor(adopted || 0), s));
  const shipRatio = p > 0 ? s / p : 0;
  const adoptRatio = s > 0 ? a / s : 0;
  const breached =
    p >= MIN_SAMPLE &&
    (shipRatio < SHIP_THRESHOLD || (s >= MIN_SAMPLE && adoptRatio < ADOPT_THRESHOLD));
  return {
    shipRatio: Math.round(shipRatio * 100) / 100,
    adoptRatio: Math.round(adoptRatio * 100) / 100,
    breached,
  };
}

const EMPTY: DeliveryFunnelSummary = {
  produced: 0,
  shipped: 0,
  adopted: 0,
  shipRatio: 0,
  adoptRatio: 0,
  windowDays: WINDOW_DAYS,
  shipThreshold: SHIP_THRESHOLD,
  adoptThreshold: ADOPT_THRESHOLD,
  breached: false,
  degraded: false,
};

/** Read-only dashboard summary of the produce -> ship -> adopt funnel. */
export async function summarizeDeliveryFunnel(tenantId: number): Promise<DeliveryFunnelSummary> {
  if (!tenantId || !Number.isInteger(tenantId) || tenantId <= 0) return { ...EMPTY };
  try {
    const res = await db.execute(sql`
      WITH produced AS (
        SELECT id, status
        FROM delivery_logs
        WHERE tenant_id = ${tenantId}
          AND created_at >= NOW() - make_interval(days => ${WINDOW_DAYS})
      ),
      shipped AS (
        SELECT id FROM produced WHERE status = 'completed'
      ),
      adopted AS (
        SELECT DISTINCT e.delivery_id
        FROM delivery_engagement e
        JOIN shipped s ON s.id = e.delivery_id
        WHERE e.tenant_id = ${tenantId}
      )
      SELECT
        (SELECT COUNT(*) FROM produced)::int AS produced,
        (SELECT COUNT(*) FROM shipped)::int  AS shipped,
        (SELECT COUNT(*) FROM adopted)::int  AS adopted
    `);
    const row = (((res as any).rows || res) as any[])[0] || {};
    const produced = Number(row.produced) || 0;
    const shipped = Number(row.shipped) || 0;
    const adopted = Number(row.adopted) || 0;
    const metrics = computeFunnelMetrics(produced, shipped, adopted);
    return {
      produced,
      shipped,
      adopted,
      shipRatio: metrics.shipRatio,
      adoptRatio: metrics.adoptRatio,
      windowDays: WINDOW_DAYS,
      shipThreshold: SHIP_THRESHOLD,
      adoptThreshold: ADOPT_THRESHOLD,
      breached: metrics.breached,
      degraded: false,
    };
  } catch (_silentErr) {
    logSilentCatch("server/delivery-funnel.ts", _silentErr);
    // Honest fallback: announce that these zeros are NOT a measurement.
    return { ...EMPTY, degraded: true };
  }
}
