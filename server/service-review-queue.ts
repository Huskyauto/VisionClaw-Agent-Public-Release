import fs from "fs";
import path from "path";
import crypto from "crypto";

const QUEUE_FILE = path.join(process.cwd(), "uploads", ".service-review-queue.json");

export type ReviewStatus = "pending" | "approved" | "rejected" | "shipped" | "failed";

export interface QaResult {
  passed: boolean;
  issues: string[];
  pageCount?: number;
  fileSizeBytes?: number;
  totalChars?: number;
  perSection?: { heading: string; chars: number; flagged: boolean }[];
}

export interface ReviewItem {
  id: string;
  sessionId: string;
  sku: string;
  productName: string;
  customerEmail: string;
  customerName: string;
  intake: Record<string, string | undefined>;
  filePath: string;
  fileName: string;
  qa: QaResult;
  status: ReviewStatus;
  reviewToken: string;
  createdAt: string;
  reviewedAt?: string;
  rejectedReason?: string;
  deliveryId?: number;
  deliveryLinkVerified?: boolean;
  modelUsed?: string;
  pages?: number;
}

/**
 * Per-SKU autonomy policy. Bob's plan: prove the pipeline with N clean
 * manual ships, then flip auto-ship on for that specific SKU. If the
 * pipeline ever produces a broken delivery (link verification failed),
 * auto-ship snaps back off automatically and the SKU has to re-earn it.
 */
export interface AutoShipPolicy {
  sku: string;
  enabled: boolean;
  /** How many clean manual ships are required before auto-ship can be enabled. */
  threshold: number;
  /** Last operator action timestamps for audit. */
  enabledAt?: string;
  disabledAt?: string;
  /** If we auto-disabled because of a bad ship, this carries the reason. */
  lastAutoDisableReason?: string;
  /**
   * After an auto-disable, broken/clean ship counts that gate re-enable
   * are computed only against items created on/after this timestamp. This
   * lets a SKU "earn back" auto-ship once Bob has investigated, instead
   * of being permanently locked out by one historical broken ship.
   */
  policyResetAt?: string;
}

interface QueueFile {
  version: 1;
  items: ReviewItem[];
  policy?: Record<string, AutoShipPolicy>;
}

const DEFAULT_THRESHOLD = 10;

// ───────────────────────────────────────────────────────────────────────
// In-process serialization. The queue file uses atomic temp+rename so a
// single write is safe, but read-modify-write across two webhook events
// can still lose updates ("read A → read B → write A → write B" loses A's
// changes). This mutex serializes every RMW so that Stripe webhook
// retries / two simultaneous customer purchases for the same SKU cannot
// step on each other. All persistence helpers below acquire it.
// ───────────────────────────────────────────────────────────────────────
let __queueLock: Promise<void> = Promise.resolve();
async function withQueueLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const prev = __queueLock;
  let release!: () => void;
  __queueLock = new Promise<void>((r) => { release = r; });
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

function ensureDir() {
  const dir = path.dirname(QUEUE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readQueue(): QueueFile {
  ensureDir();
  if (!fs.existsSync(QUEUE_FILE)) return { version: 1, items: [], policy: {} };
  try {
    const raw = fs.readFileSync(QUEUE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) {
      return { version: 1, items: [], policy: {} };
    }
    if (!parsed.policy || typeof parsed.policy !== "object") parsed.policy = {};
    return parsed;
  } catch (err: any) {
    console.error(`[service-review] Failed to read queue: ${err.message}`);
    return { version: 1, items: [], policy: {} };
  }
}

function writeQueueAtomic(q: QueueFile) {
  ensureDir();
  const tmp = `${QUEUE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(q, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, QUEUE_FILE);
}

export function listReviewItems(filter?: { status?: ReviewStatus }): ReviewItem[] {
  const q = readQueue();
  const items = q.items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (filter?.status) return items.filter(i => i.status === filter.status);
  return items;
}

export function getReviewItem(id: string): ReviewItem | null {
  return readQueue().items.find(i => i.id === id) || null;
}

export function getReviewItemByToken(token: string): ReviewItem | null {
  if (!token) return null;
  return readQueue().items.find(i => i.reviewToken === token) || null;
}

/** Look up an existing review item by Stripe checkout session id. Used to
 * dedupe webhook replays — Stripe is at-least-once and will resend the
 * same `checkout.session.completed` event after transient 5xx or network
 * errors. We must NOT enqueue/regenerate the same paid order twice.
 */
export function findReviewItemBySessionId(sessionId: string): ReviewItem | null {
  if (!sessionId) return null;
  return readQueue().items.find(i => i.sessionId === sessionId) || null;
}

export async function addReviewItem(input: Omit<ReviewItem, "id" | "reviewToken" | "createdAt" | "status"> & { status?: ReviewStatus }): Promise<ReviewItem> {
  return withQueueLock(() => {
    const q = readQueue();
    // Idempotency: if this Stripe session is already enqueued, return the
    // existing item instead of creating a duplicate. Webhook replays
    // (Stripe retries on 5xx) and double-clicks both flow through here.
    const existing = q.items.find(i => i.sessionId === input.sessionId);
    if (existing) {
      console.log(`[service-review] addReviewItem dedup hit for session ${input.sessionId} → returning existing ${existing.id}`);
      return existing;
    }
    const item: ReviewItem = {
      ...input,
      id: `srv_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      reviewToken: crypto.randomBytes(24).toString("hex"),
      status: input.status || "pending",
      createdAt: new Date().toISOString(),
    };
    q.items.push(item);
    // Cap history at 500 items so the file doesn't grow unbounded.
    if (q.items.length > 500) q.items = q.items.slice(-500);
    writeQueueAtomic(q);
    return item;
  });
}

export async function updateReviewItem(id: string, patch: Partial<ReviewItem>): Promise<ReviewItem | null> {
  return withQueueLock(() => {
    const q = readQueue();
    const idx = q.items.findIndex(i => i.id === id);
    if (idx < 0) return null;
    // Don't allow id/token/createdAt rewrites.
    const { id: _i, reviewToken: _t, createdAt: _c, ...safe } = patch as any;
    q.items[idx] = { ...q.items[idx], ...safe };
    writeQueueAtomic(q);
    return q.items[idx];
  });
}

// ───────────────────────────────────────────────────────────────────────
// Per-SKU graduation: clean-ship counter + auto-ship toggle
// ───────────────────────────────────────────────────────────────────────

export interface SkuStats {
  sku: string;
  /** Lifetime totals — what the admin UI shows. */
  cleanShips: number;       // shipped + qa.passed + linkVerified !== false
  brokenShips: number;      // shipped but linkVerified === false
  rejected: number;
  failed: number;
  pending: number;
  totalOrders: number;
  /** Counts since the last `policyResetAt` (or all-time if none). The
   *  eligibility gate uses these so a SKU can earn auto-ship back. */
  cleanShipsSinceReset: number;
  brokenShipsSinceReset: number;
  /** Most recent 10 outcomes for at-a-glance: 'C'=clean, 'B'=broken, 'R'=rejected, 'F'=failed, 'P'=pending. */
  recent: string;
}

export function getSkuStats(sku: string): SkuStats {
  const q = readQueue();
  const items = q.items.filter(i => i.sku === sku);
  const policy = q.policy?.[sku];
  const resetAt = policy?.policyResetAt;
  let cleanShips = 0, brokenShips = 0, rejected = 0, failed = 0, pending = 0;
  let cleanShipsSinceReset = 0, brokenShipsSinceReset = 0;
  for (const i of items) {
    const sinceReset = !resetAt || i.createdAt >= resetAt;
    if (i.status === 'shipped') {
      if (i.deliveryLinkVerified === false) {
        brokenShips++;
        if (sinceReset) brokenShipsSinceReset++;
      } else {
        cleanShips++;
        if (sinceReset) cleanShipsSinceReset++;
      }
    } else if (i.status === 'rejected') rejected++;
    else if (i.status === 'failed') failed++;
    else if (i.status === 'pending') pending++;
  }
  const recent = items
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)
    .map(i => {
      if (i.status === 'shipped') return i.deliveryLinkVerified === false ? 'B' : 'C';
      if (i.status === 'rejected') return 'R';
      if (i.status === 'failed') return 'F';
      return 'P';
    })
    .join('');
  return { sku, cleanShips, brokenShips, rejected, failed, pending, totalOrders: items.length, cleanShipsSinceReset, brokenShipsSinceReset, recent };
}

export function getAutoShipPolicy(sku: string): AutoShipPolicy {
  const q = readQueue();
  const existing = q.policy?.[sku];
  if (existing) return { ...existing, threshold: existing.threshold ?? DEFAULT_THRESHOLD, sku };
  return { sku, enabled: false, threshold: DEFAULT_THRESHOLD };
}

export function isAutoShipEligible(sku: string): { eligible: boolean; reason: string; stats: SkuStats; policy: AutoShipPolicy } {
  const policy = getAutoShipPolicy(sku);
  const stats = getSkuStats(sku);
  if (!policy.enabled) return { eligible: false, reason: 'Auto-ship is disabled for this SKU', stats, policy };
  // Gate uses since-reset counts so a SKU can earn auto-ship back after
  // Bob has investigated a broken ship and turned it back on.
  if (stats.cleanShipsSinceReset < policy.threshold) {
    return { eligible: false, reason: `Only ${stats.cleanShipsSinceReset}/${policy.threshold} clean ships since last reset`, stats, policy };
  }
  if (stats.brokenShipsSinceReset > 0) {
    return { eligible: false, reason: `${stats.brokenShipsSinceReset} broken ship(s) since last reset — manual review required`, stats, policy };
  }
  return { eligible: true, reason: 'OK', stats, policy };
}

export async function setAutoShipPolicy(sku: string, patch: { enabled?: boolean; threshold?: number; lastAutoDisableReason?: string; policyResetAt?: string }): Promise<AutoShipPolicy> {
  return withQueueLock(() => {
    const q = readQueue();
    if (!q.policy) q.policy = {};
    const current = q.policy[sku] || { sku, enabled: false, threshold: DEFAULT_THRESHOLD };
    const next: AutoShipPolicy = {
      sku,
      enabled: patch.enabled != null ? !!patch.enabled : current.enabled,
      threshold: patch.threshold && patch.threshold > 0 ? Math.floor(patch.threshold) : (current.threshold || DEFAULT_THRESHOLD),
      enabledAt: patch.enabled === true ? new Date().toISOString() : current.enabledAt,
      disabledAt: patch.enabled === false ? new Date().toISOString() : current.disabledAt,
      lastAutoDisableReason: patch.lastAutoDisableReason !== undefined ? patch.lastAutoDisableReason : current.lastAutoDisableReason,
      policyResetAt: patch.policyResetAt !== undefined ? patch.policyResetAt : current.policyResetAt,
    };
    q.policy[sku] = next;
    writeQueueAtomic(q);
    return next;
  });
}

export function listAllPolicies(): AutoShipPolicy[] {
  const q = readQueue();
  return Object.values(q.policy || {});
}

/**
 * Called after an auto-shipped delivery comes back with linkVerified=false.
 * Snaps auto-ship back off for that SKU AND advances `policyResetAt` so
 * the broken ship counts against the *next* eligibility window. Bob can
 * then investigate, fix the underlying issue, and (after the threshold
 * of clean manual ships is re-earned) re-enable auto-ship for that SKU.
 */
export async function autoDisableForBrokenShip(sku: string, deliveryId?: number): Promise<AutoShipPolicy> {
  return setAutoShipPolicy(sku, {
    enabled: false,
    lastAutoDisableReason: `Auto-disabled after broken delivery${deliveryId ? ` #${deliveryId}` : ''} (link verification failed)`,
    policyResetAt: new Date().toISOString(),
  });
}

/**
 * Quality checks run against the generated PDF + section bodies.
 * The customer's $49 buys a real, proofreadable artifact — these checks
 * catch the obvious "we shipped a stub" failure modes before the file
 * ever reaches Bob's review screen.
 */
export function runQualityChecks(params: {
  filePath: string;
  pageCount?: number;
  depth: "standard" | "deep";
  sections: { heading: string; body: string }[];
}): QaResult {
  const issues: string[] = [];
  let fileSizeBytes: number | undefined;

  try {
    const abs = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.join(process.cwd(), params.filePath);
    if (!fs.existsSync(abs)) {
      issues.push(`PDF file not found at ${params.filePath}`);
    } else {
      fileSizeBytes = fs.statSync(abs).size;
      if (fileSizeBytes < 30 * 1024) {
        issues.push(`PDF is suspiciously small (${fileSizeBytes} bytes; expected >30KB)`);
      }
    }
  } catch (err: any) {
    issues.push(`Could not stat PDF: ${err.message}`);
  }

  const minPages = params.depth === "deep" ? 12 : 6;
  if (params.pageCount != null && params.pageCount < minPages) {
    issues.push(`Page count ${params.pageCount} is below expected minimum ${minPages} for ${params.depth} depth`);
  }

  let totalChars = 0;
  const perSection: { heading: string; chars: number; flagged: boolean }[] = [];
  const errorMarker = "(This section could not be generated";
  const noContentMarker = "(No content generated";
  for (const s of params.sections) {
    const chars = s.body.length;
    totalChars += chars;
    let flagged = false;
    if (s.body.startsWith(errorMarker) || s.body.startsWith(noContentMarker)) {
      issues.push(`Section "${s.heading}" failed to generate (placeholder text detected)`);
      flagged = true;
    } else if (chars < 200) {
      issues.push(`Section "${s.heading}" is suspiciously short (${chars} chars; expected >200)`);
      flagged = true;
    }
    perSection.push({ heading: s.heading, chars, flagged });
  }

  if (totalChars < 4000) {
    issues.push(`Total content length ${totalChars} chars is below 4000 — report may be too thin`);
  }

  return {
    passed: issues.length === 0,
    issues,
    pageCount: params.pageCount,
    fileSizeBytes,
    totalChars,
    perSection,
  };
}
