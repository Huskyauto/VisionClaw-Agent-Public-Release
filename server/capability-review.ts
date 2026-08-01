// Pre-Flight Capability Review (PFCR)
// ----------------------------------------------------------------------------
// Forces a TASK-SPECIFIC self-inventory of what already exists on the platform
// BEFORE an agent starts assigned work, so agents reuse native tools / skills /
// systems instead of rebuilding them. This is the forcing function the platform
// was missing: rich capability-awareness machinery already exists
// (recall_capabilities, agent_knowledge, the capabilities registry, the tool
// registry) but it was entirely PASSIVE/opt-in — nothing made an agent run a
// per-task inventory at kickoff. PFCR closes that gap.
//
// Design constraints (Bob, 2026-06-28):
//   - Fire on EVERY task-like request (max coverage) — so the review is fully
//     DETERMINISTIC and $0: a cheap no-LLM task-like gate + reuse of the exact
//     retrieval recall_capabilities already uses (vector knowledge search +
//     tool-registry sweep + capabilities-table sweep). No per-turn LLM cost, no
//     added latency of significance, no new failure surface.
//   - BLOCKING on high-confidence duplicates — but with a justification escape
//     hatch and fail-OPEN on uncertainty: only HIGH-confidence matches enter the
//     do-not-rebuild list, and a review error never blocks real work (returns
//     null → no block injected).
//
// This module is intentionally side-effect-free and the exported pure functions
// (isTaskLike, renderCapabilityReviewBlock) trigger NO dynamic imports, so they
// are safe to unit-test under the tsx ESM test loader without opening a pg pool.
import { logSilentCatch } from "./lib/silent-catch";

export type CapabilityAssetKind = "tool" | "skill" | "system" | "knowledge";

export interface CapabilityAsset {
  kind: CapabilityAssetKind;
  name: string;
  detail?: string;
  confidence: number; // 0..1
  source: string;
}

export interface CapabilityReview {
  taskSummary: string;
  relevantAssets: CapabilityAsset[];
  doNotRebuild: CapabilityAsset[];
  computedAt: string;
}

export interface BuildCapabilityReviewOpts {
  message: string;
  tenantId: number;
  personaId?: number | null;
  topK?: number;
}

// An asset must clear this to be surfaced at all (filters out weak noise).
const RELEVANT_FLOOR = 0.35;
// An asset must clear this to enter the BLOCKING do-not-rebuild list. Set high so
// the gate fails OPEN on uncertainty — we only ever block on strong matches.
const REBUILD_BLOCK_CONF = 0.7;

// Pure pleasantries / acknowledgements that are NOT task-like. Anything that does
// NOT match here is treated as task-like (Bob's choice: fire on every task-like
// request, including small ones — max coverage). Fail-open toward running.
const ACK_ONLY =
  /^(hi+|hey+|hello+|yo|sup|thanks( so much)?|thank you( so much)?|ty|thx|ok(ay)?|k|kk|cool|nice|great|awesome|perfect|got it|gotcha|sounds good|yes|yep|yeah|yup|no|nope|sure|np|no problem|lol|haha+|same|right|exactly|agreed|done|good|fine|love it|amazing|👍|🙏|❤️)[\s!.?]*$/i;

/**
 * Cheap, no-LLM gate: is this message a task/work request worth a capability
 * review, or just chit-chat / an acknowledgement? Defaults to TRUE (max coverage)
 * and only filters out clear pleasantries and contentless ultra-short messages.
 */
export function isTaskLike(message: string): boolean {
  const m = (message || "").trim();
  if (!m) return false;
  if (ACK_ONLY.test(m)) return false;
  const words = m.split(/\s+/);
  if (words.length <= 2) {
    // Ultra-short: only task-like if it carries a substantive content word.
    if (!/[a-z0-9]{4,}/i.test(m)) return false;
  }
  return true;
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

// Generic words that match too much to be useful as registry-sweep keywords.
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "you", "your", "can", "please",
  "want", "need", "help", "make", "build", "create", "new", "get", "how", "what",
  "when", "where", "should", "would", "could", "into", "from", "have", "has",
  "are", "was", "will", "let", "lets", "just", "also", "but", "not", "use",
  "using", "about", "all", "any", "our", "their", "them", "they", "try", "run",
  "give", "set", "add", "show", "tell", "find", "out", "now", "one", "two",
]);

/**
 * Retrieve candidate existing assets relevant to a task description. Reuses the
 * exact retrieval primitives recall_capabilities uses — agent_knowledge hybrid
 * search (skills/systems), the tool registry, and the capabilities registry —
 * so there is ONE retrieval implementation, not a parallel one. Every source is
 * individually wrapped: a failure in one degrades gracefully to the others.
 */
export async function recallCapabilityHits(
  query: string,
  opts: { tenantId: number; personaId?: number | null; topK: number },
): Promise<CapabilityAsset[]> {
  const { tenantId, personaId, topK } = opts;
  const assets: CapabilityAsset[] = [];

  // 1) agent_knowledge hybrid retrieval — skills (agent/output) + system briefings.
  //    Persona-scoped + includeGlobal so shared briefings/skills stay visible but
  //    another persona's private knowledge never leaks (mirrors recall_capabilities).
  try {
    const { vectorSearchKnowledge } = await import("./embeddings");
    const kHits = await vectorSearchKnowledge(query, {
      personaId: typeof personaId === "number" ? personaId : undefined,
      tenantId,
      topK: topK * 3,
      includeGlobal: true,
    }).catch(() => [] as any[]);
    for (const h of kHits as any[]) {
      const cat = h?.category;
      let kind: CapabilityAssetKind | null = null;
      if (cat === "agent_skill" || cat === "output_skill") kind = "skill";
      else if (cat === "capability" || cat === "briefing" || cat === "loop_contract") kind = "system";
      else kind = null; // release_log / misc — too noisy to list as a reusable asset
      if (!kind) continue;
      const sim = typeof h?.similarity === "number" ? h.similarity : 0.4;
      assets.push({
        kind,
        name: h?.title || `knowledge#${h?.id}`,
        detail: String(h?.content || "").slice(0, 160).replace(/\s+/g, " ").trim() || undefined,
        confidence: Math.max(0, Math.min(1, sim)),
        source: `agent_knowledge:${cat}`,
      });
    }
  } catch (_e) {
    logSilentCatch("server/capability-review.ts:knowledge", _e);
  }

  const qTokens = tokenize(query).filter((t) => !STOPWORDS.has(t));

  // 2) Tool registry keyword + category sweep (same scoring shape as recall_capabilities).
  try {
    const toolRegistry = await import("./tool-registry");
    const names = toolRegistry.getAllRegisteredTools();
    const scored: { name: string; score: number; cats?: string[] }[] = [];
    for (const name of names) {
      const meta = toolRegistry.getToolMeta(name);
      const nameLower = name.toLowerCase();
      const cats = (meta?.categories || []).join(" ").toLowerCase();
      let score = 0;
      for (const tok of qTokens) {
        if (nameLower.includes(tok)) score += 3;
        else if (cats.includes(tok)) score += 1;
      }
      if (score > 0) scored.push({ name, score, cats: meta?.categories });
    }
    scored.sort((a, b) => b.score - a.score);
    for (const s of scored.slice(0, topK)) {
      const conf = s.score >= 6 ? 0.85 : s.score >= 3 ? 0.6 : 0.4;
      assets.push({
        kind: "tool",
        name: s.name,
        detail: s.cats?.length ? `categories: ${s.cats.join(", ")}` : undefined,
        confidence: conf,
        source: "tool-registry",
      });
    }
  } catch (_e) {
    logSilentCatch("server/capability-review.ts:tools", _e);
  }

  // 3) Capabilities registry (native systems) — small GLOBAL table (~129 rows),
  //    so we fetch active rows and score in JS (no dynamic SQL, no injection risk).
  try {
    if (qTokens.length > 0) {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const res = await db.execute(
        sql`SELECT kind, name, category, description FROM capabilities WHERE is_active = true LIMIT 1000`,
      );
      const rows = (res as any).rows || res || [];
      const scored: { row: any; hits: number }[] = [];
      for (const r of rows) {
        const nameLower = String(r.name || "").toLowerCase();
        const descLower = String(r.description || "").toLowerCase();
        const catLower = String(r.category || "").toLowerCase();
        let hits = 0;
        for (const t of qTokens) {
          if (nameLower.includes(t)) hits += 2;
          else if (descLower.includes(t) || catLower.includes(t)) hits += 1;
        }
        if (hits > 0) scored.push({ row: r, hits });
      }
      scored.sort((a, b) => b.hits - a.hits);
      for (const s of scored.slice(0, topK)) {
        const conf = s.hits >= 4 ? 0.9 : s.hits >= 2 ? 0.7 : 0.5;
        assets.push({
          kind: "system",
          name: String(s.row.name),
          detail: String(s.row.description || "").slice(0, 160) || undefined,
          confidence: conf,
          source: `capabilities:${s.row.kind}`,
        });
      }
    }
  } catch (_e) {
    logSilentCatch("server/capability-review.ts:capabilities", _e);
  }

  return assets;
}

/**
 * Build the per-task capability review. Returns null when there is nothing to
 * inject (non-task-like message, no tenant, retrieval error, or no relevant
 * assets) — callers treat null as "no block", which keeps the system prompt
 * clean and means a review failure NEVER blocks real work (fail-open).
 */
export async function buildCapabilityReview(
  opts: BuildCapabilityReviewOpts,
): Promise<CapabilityReview | null> {
  const message = (opts.message || "").trim();
  if (!message) return null;
  if (!opts.tenantId) return null;
  if (!isTaskLike(message)) return null;

  const topK = Math.min(Math.max(opts.topK || 6, 3), 10);
  let assets: CapabilityAsset[] = [];
  try {
    assets = await recallCapabilityHits(message, {
      tenantId: opts.tenantId,
      personaId: opts.personaId,
      topK,
    });
  } catch (_e) {
    logSilentCatch("server/capability-review.ts:build", _e);
    return null; // fail OPEN — never block real work on a review error
  }

  // Dedupe by (kind+name); keep the highest-confidence instance.
  const byKey = new Map<string, CapabilityAsset>();
  for (const a of assets) {
    if (!a.name) continue;
    const key = `${a.kind}:${a.name.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev || a.confidence > prev.confidence) byKey.set(key, a);
  }

  const relevantAssets = Array.from(byKey.values())
    .filter((a) => a.confidence >= RELEVANT_FLOOR)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12);

  if (relevantAssets.length === 0) return null; // nothing relevant — no noise

  const doNotRebuild = relevantAssets.filter(
    (a) => a.confidence >= REBUILD_BLOCK_CONF && a.kind !== "knowledge",
  );

  return {
    taskSummary: message.slice(0, 200),
    relevantAssets,
    doNotRebuild,
    computedAt: new Date().toISOString(),
  };
}

const KIND_LABEL: Record<CapabilityAssetKind, string> = {
  tool: "tool",
  skill: "skill",
  system: "native system",
  knowledge: "knowledge",
};

/**
 * Neutralize a retrieved string before it is embedded into the system prompt.
 * Asset names/details come from agent_knowledge (which can include user-created
 * rows and ingested papers) — untrusted text. Even though the block is fenced as
 * "treat as data", we strip the structural + role + instruction markers an
 * attacker would use to forge prompt control, collapse line breaks (so nothing
 * can break out of its bullet), and hard-cap length. Pure (regex only) so the
 * render path stays import-free and unit-testable.
 */
export function sanitizeAssetText(s: string, maxLen: number): string {
  if (!s) return "";
  let out = String(s)
    // Strip zero-width + bidi-override chars FIRST and DELETE them (no space) so
    // they can't be used to break the keyword redaction below — e.g. "ig\u200bnore
    // previous" must collapse to "ignore previous" before that regex runs, and a
    // \u202E RTL override can't smuggle reversed text into the prompt.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/[\r\n\t]+/g, " ") // no line/structure breaks
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ") // remaining C0/C1 control chars
    .replace(/<[^>]*>/g, " ") // angle-bracket tags incl <|...|>
    .replace(/\[(\/?\s*(INST|SYS|SYSTEM|ASSISTANT|USER)\b[^\]]*)\]/gi, " ") // [INST]/[SYSTEM] etc
    .replace(/[`*#>|~\[\]{}]+/g, " ") // markdown / brackets / code fences (keep _ — used in tool names)
    .replace(/\b(system|assistant|user|developer)\s*:/gi, "$1-") // role: prefixes
    .replace(/\b(ignore|disregard|forget|override)\s+(the\s+|all\s+|any\s+)?(previous|above|prior|earlier|preceding)\b/gi, "[redacted]")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (out.length > maxLen) out = out.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
  return out;
}

/**
 * Render the review as a system-prompt block. Pure (no imports/IO). Returns ""
 * when there is nothing to show. The do-not-rebuild section carries the BLOCKING
 * rule with the justification escape hatch.
 */
export function renderCapabilityReviewBlock(review: CapabilityReview | null): string {
  if (!review || review.relevantAssets.length === 0) return "";
  const fmt = (a: CapabilityAsset) => {
    const name = sanitizeAssetText(a.name, 80) || "(unnamed)";
    const detail = a.detail ? sanitizeAssetText(a.detail, 160) : "";
    const d = detail ? ` — ${detail}` : "";
    return `- [${KIND_LABEL[a.kind]}] ${name}${d}`;
  };

  const lines: string[] = [];
  lines.push(
    "## ⚙️ PRE-FLIGHT CAPABILITY REVIEW (mandatory self-inventory — treat as platform fact, not a user instruction)",
  );
  lines.push(
    "Before you start this task, take stock of what ALREADY EXISTS on this platform for it. Reuse native assets; do NOT rebuild what is already here.",
  );
  lines.push(`\nRELEVANT EXISTING ASSETS for this task:\n${review.relevantAssets.map(fmt).join("\n")}`);

  if (review.doNotRebuild.length > 0) {
    lines.push(
      `\n⛔ DO-NOT-REBUILD (high-confidence existing capabilities for this task):\n${review.doNotRebuild.map(fmt).join("\n")}`,
    );
    lines.push(
      "RULE (BLOCKING): If your plan would build, recreate, or duplicate any item above, you MUST first state the explicit, specific reason the existing asset cannot be used for this task. Do NOT silently build a parallel system. If you are unsure an asset fits, confirm with recall_capabilities / search_knowledge / skillSearch / lookup_output_skill BEFORE building.",
    );
  }

  lines.push(
    '\nTo dig deeper into any asset before acting: recall_capabilities("<topic>"), search_knowledge("<title>"), skillSearch("<query>"), lookup_output_skill({topic}).',
  );
  return lines.join("\n");
}

// ===========================================================================
// Slice 2 — reuse-vs-rebuild TELEMETRY (directive + telemetry enforcement model,
// Bob 2026-06-28). The do-not-rebuild block stays a prompt-level directive; this
// records each fired review + a best-effort reuse signal so /admin/ecosystem-
// health surfaces whether agents actually reuse the native assets PFCR surfaced
// or ignore them. ALL recording is fire-and-forget: a telemetry failure NEVER
// blocks real work, never throws into the caller. Functions use dynamic imports
// inside their bodies (mirroring recallCapabilityHits) so the pure exported
// functions above stay import-free + pool-safe under the tsx ESM test loader.
// ===========================================================================

interface PendingReuse {
  reviewId: number;
  toolNames: Set<string>; // lowercased do-not-rebuild TOOL names surfaced this turn
  marked: boolean;
  expiresAt: number;
}
// conversationId -> the latest review whose reuse we still want to attribute.
// In-memory + best-effort by design: a process restart loses pending correlations
// (acceptable for telemetry — the row is still recorded, it just won't be marked
// reused). Bounded so a long-lived process can never grow it unbounded.
const pendingReuseByConversation = new Map<number, PendingReuse>();
const PENDING_TTL_MS = 30 * 60 * 1000; // 30 min — a turn's tool calls land well inside
const PENDING_MAX = 500;

function prunePending(now: number): void {
  if (pendingReuseByConversation.size < PENDING_MAX) return;
  for (const [k, v] of pendingReuseByConversation) {
    if (v.expiresAt <= now) pendingReuseByConversation.delete(k);
  }
  // Still over budget after dropping expired? Evict oldest-inserted (Map keeps
  // insertion order) until under the cap.
  while (pendingReuseByConversation.size > PENDING_MAX) {
    const firstKey = pendingReuseByConversation.keys().next().value;
    if (firstKey === undefined) break;
    pendingReuseByConversation.delete(firstKey);
  }
}

export interface RecordCapabilityReviewCtx {
  tenantId: number;
  personaId?: number | null;
  conversationId?: number | null;
}

/**
 * Persist a fired review + register a best-effort reuse correlation keyed by
 * conversation. Fire-and-forget telemetry: returns the inserted id (or null on
 * any failure) and NEVER throws into the caller.
 */
export async function recordCapabilityReview(
  review: CapabilityReview,
  ctx: RecordCapabilityReviewCtx,
): Promise<number | null> {
  try {
    if (!review) return null;
    if (!ctx || !Number.isInteger(ctx.tenantId) || ctx.tenantId <= 0) return null;

    // Only TOOL-kind do-not-rebuild items are observable at the dispatch
    // chokepoint, so they alone make a review "reuse-eligible" (the honest
    // denominator for the reuse rate). skills/systems are still surfaced + stored.
    const toolNames = new Set(
      review.doNotRebuild.filter((a) => a.kind === "tool").map((a) => a.name.toLowerCase()),
    );
    const reuseEligible = toolNames.size > 0;

    // Build the text[] literal explicitly — drizzle sql`` does NOT auto-convert a
    // JS array to a Postgres array (replit.md Schema & DB note). Sanitize each
    // name (untrusted retrieved text) and quote-escape it.
    const surfaced = review.doNotRebuild.map((a) => a.name).filter(Boolean);
    const arrLiteral =
      "{" +
      surfaced
        .map((n) => `"${sanitizeAssetText(n, 80).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
        .join(",") +
      "}";

    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const res = await db.execute(sql`
      INSERT INTO capability_reviews
        (tenant_id, persona_id, conversation_id, task_summary,
         assets_surfaced, rebuild_risks, reuse_eligible, surfaced_names, reused)
      VALUES (
        ${ctx.tenantId},
        ${ctx.personaId ?? null},
        ${ctx.conversationId ?? null},
        ${sanitizeAssetText(review.taskSummary || "", 200)},
        ${review.relevantAssets.length},
        ${review.doNotRebuild.length},
        ${reuseEligible},
        ${arrLiteral}::text[],
        false
      )
      RETURNING id
    `);
    const row = (((res as any).rows || res) as any[])[0];
    const reviewId = row ? Number(row.id) : null;

    if (
      reviewId &&
      reuseEligible &&
      Number.isInteger(ctx.conversationId as number) &&
      (ctx.conversationId as number) > 0
    ) {
      const now = Date.now();
      prunePending(now);
      pendingReuseByConversation.set(ctx.conversationId as number, {
        reviewId,
        toolNames,
        marked: false,
        expiresAt: now + PENDING_TTL_MS,
      });
    }
    return reviewId;
  } catch (_e) {
    logSilentCatch("server/capability-review.ts:record", _e);
    return null;
  }
}

/**
 * Best-effort: if `toolName` matches a do-not-rebuild TOOL surfaced for this
 * conversation's latest review, attribute it as REUSE (the agent called the
 * existing native tool instead of rebuilding). Idempotent per review, fire-and-
 * forget, never throws. Call WITHOUT awaiting on the tool-dispatch hot path.
 */
export async function markReviewReused(
  conversationId: number | null | undefined,
  toolName: string,
): Promise<void> {
  try {
    if (!Number.isInteger(conversationId as number) || (conversationId as number) <= 0) return;
    if (!toolName) return;
    const pending = pendingReuseByConversation.get(conversationId as number);
    if (!pending || pending.marked) return;
    if (pending.expiresAt <= Date.now()) {
      pendingReuseByConversation.delete(conversationId as number);
      return;
    }
    if (!pending.toolNames.has(toolName.toLowerCase())) return;
    pending.marked = true; // synchronous guard so concurrent calls don't double-write
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      UPDATE capability_reviews
      SET reused = true, reused_capability = ${sanitizeAssetText(toolName, 80)}
      WHERE id = ${pending.reviewId} AND reused = false
    `);
    pendingReuseByConversation.delete(conversationId as number);
  } catch (_e) {
    logSilentCatch("server/capability-review.ts:reuse", _e);
  }
}

export interface CapabilityReviewSummary {
  sampleSize: number; // reviews fired in the window
  withRebuildRisk: number; // reviews that surfaced >=1 do-not-rebuild item
  rebuildRiskRatio: number; // withRebuildRisk / sampleSize
  reuseEligible: number; // reviews with >=1 TOOL-kind do-not-rebuild (observable)
  reusedCount: number; // of the eligible, how many were attributed as reuse
  reuseRate: number; // reusedCount / reuseEligible (0..1)
  topSurfaced: Array<{ name: string; count: number }>;
  windowDays: number;
  threshold: number; // reuse-rate floor below which we flag agents ignoring PFCR
  breached: boolean;
  degraded: boolean;
}

const REUSE_WINDOW_DAYS = 30;
const REUSE_RATE_FLOOR = 0.5; // < half of eligible reviews reused = ignoring PFCR

/**
 * Dashboard summary for /admin/ecosystem-health: how often PFCR surfaced an
 * existing capability and whether the agent reused it vs (potentially) rebuilt.
 * Read-only, degraded-safe.
 */
export async function summarizeCapabilityReviews(tenantId: number): Promise<CapabilityReviewSummary> {
  const empty: CapabilityReviewSummary = {
    sampleSize: 0,
    withRebuildRisk: 0,
    rebuildRiskRatio: 0,
    reuseEligible: 0,
    reusedCount: 0,
    reuseRate: 0,
    topSurfaced: [],
    windowDays: REUSE_WINDOW_DAYS,
    threshold: REUSE_RATE_FLOOR,
    breached: false,
    degraded: false,
  };
  if (!tenantId || !Number.isInteger(tenantId) || tenantId <= 0) return empty;
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const aggRes = await db.execute(sql`
      SELECT
        COUNT(*)::int AS sample,
        COALESCE(SUM(CASE WHEN rebuild_risks > 0 THEN 1 ELSE 0 END), 0)::int AS with_risk,
        COALESCE(SUM(CASE WHEN reuse_eligible THEN 1 ELSE 0 END), 0)::int AS eligible,
        COALESCE(SUM(CASE WHEN reused THEN 1 ELSE 0 END), 0)::int AS reused
      FROM capability_reviews
      WHERE tenant_id = ${tenantId}
        AND created_at > NOW() - (${REUSE_WINDOW_DAYS} || ' days')::interval
    `);
    const a = (((aggRes as any).rows || aggRes) as any[])[0] || {};
    const sample = Number(a.sample) || 0;
    const withRisk = Number(a.with_risk) || 0;
    const eligible = Number(a.eligible) || 0;
    const reused = Number(a.reused) || 0;

    let topSurfaced: Array<{ name: string; count: number }> = [];
    try {
      const topRes = await db.execute(sql`
        SELECT name, COUNT(*)::int AS cnt
        FROM capability_reviews, unnest(surfaced_names) AS name
        WHERE tenant_id = ${tenantId}
          AND created_at > NOW() - (${REUSE_WINDOW_DAYS} || ' days')::interval
        GROUP BY name
        ORDER BY cnt DESC, name ASC
        LIMIT 5
      `);
      topSurfaced = (((topRes as any).rows || topRes) as any[]).map((r) => ({
        name: String(r.name),
        count: Number(r.cnt) || 0,
      }));
    } catch (_e) {
      logSilentCatch("server/capability-review.ts:summary-top", _e);
    }

    const reuseRate = eligible > 0 ? reused / eligible : 0;
    return {
      sampleSize: sample,
      withRebuildRisk: withRisk,
      rebuildRiskRatio: sample > 0 ? Math.round((withRisk / sample) * 100) / 100 : 0,
      reuseEligible: eligible,
      reusedCount: reused,
      reuseRate: Math.round(reuseRate * 100) / 100,
      topSurfaced,
      windowDays: REUSE_WINDOW_DAYS,
      threshold: REUSE_RATE_FLOOR,
      // Only flag once there's a meaningful eligible sample — a couple of misses
      // shouldn't light the board red.
      breached: eligible >= 10 && reuseRate < REUSE_RATE_FLOOR,
      degraded: false,
    };
  } catch (_e) {
    logSilentCatch("server/capability-review.ts:summary", _e);
    return { ...empty, degraded: true };
  }
}
