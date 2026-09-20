// ─────────────────────────────────────────────────────────────────────────────
// Self-Directed Initiative loop — the "intention engine".
//
// WHY THIS EXISTS: every other autonomy loop in the platform is either
//   (a) SCHEDULED  — fixed crons (backups, health audits, model-catalog sync),
//   (b) REACTIVE   — repair/CI self-heal firing on a detected failure, or
//   (c) NARROW DISCOVERY — ingesting a specific external feed (IdeaBrowser,
//       model catalog) and acting inside that one lane.
// None of them lets the platform look at its OWN internal telemetry and decide,
// unprompted, what would be worth doing. That self-originated goal formation is
// the part of "genuine agency" that was missing. This loop closes it.
//
// SAFETY POSTURE (genuine agency, HITL on commitment):
//   • Budget is CLAIMED before any LLM spend (fail-CLOSED via the shared
//     autonomous-budget advisory-lock claim — no claim, no call).
//   • The loop only PROPOSES + PERSISTS + SURFACES. It never auto-executes a
//     material change. Initiatives are surfaced to the owner for approval,
//     mirroring the platform's "owner-notify for material decisions" stance.
//   • Telemetry reads are bounded, read-only, and tenant-scoped; each one
//     fails SOFT to a safe default so a missing table never kills the cycle.
//   • Proposals are de-duplicated by a normalized signature so the loop doesn't
//     re-surface the same idea every run.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getClientForModel } from "../providers";
import { claimAutonomousBudget } from "./autonomous-budget";
import { logSilentCatch } from "../lib/silent-catch";

export interface SelfInitiativeResult {
  ok: boolean;
  reason: string;
  proposed: number;
  inserted: number;
  skippedDuplicate: number;
  failedInserts: number;
  model: string;
  summary: string;
  titles: string[];
}

/** A single bounded, read-only, tenant-scoped telemetry probe. Fails SOFT. */
async function probe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logSilentCatch("server/agentic/self-initiative.ts", err);
    return fallback;
  }
}

function rows(r: any): any[] {
  return (r?.rows || r || []) as any[];
}

/**
 * Gather a compact snapshot of the platform's OWN internal state. Every query
 * is bounded + tenant-scoped + fails soft. This is the raw material the
 * intention engine reasons over — the equivalent of a person noticing "hey, the
 * lead pipeline is dry and three incidents are still open" without being told.
 */
async function gatherTelemetry(tenantId: number): Promise<Record<string, any>> {
  const since7d = sql`now() - interval '7 days'`;
  const since30d = sql`now() - interval '30 days'`;

  const [
    openIncidents,
    incidentClasses,
    declineRecent,
    leadsOpen,
    leadsRecent,
    heartbeatErrors,
    evalDrift,
    recentInitiatives,
  ] = await Promise.all([
    probe(async () => {
      const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM repair_incidents WHERE tenant_id = ${tenantId} AND resolved = false`);
      return rows(r)[0]?.n ?? 0;
    }, 0),
    probe(async () => {
      const r = await db.execute(sql`
        SELECT classification, COUNT(*)::int AS n FROM repair_incidents
        WHERE tenant_id = ${tenantId} AND created_at >= ${since30d}
        GROUP BY classification ORDER BY n DESC LIMIT 6`);
      return rows(r).map((x) => `${x.classification}:${x.n}`);
    }, [] as string[]),
    probe(async () => {
      const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM decline_events WHERE tenant_id = ${tenantId} AND created_at >= ${since30d}`);
      return rows(r)[0]?.n ?? 0;
    }, 0),
    probe(async () => {
      const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM audit_leads WHERE tenant_id = ${tenantId}`);
      return rows(r)[0]?.n ?? 0;
    }, 0),
    probe(async () => {
      const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM audit_leads WHERE tenant_id = ${tenantId} AND created_at >= ${since7d}`);
      return rows(r)[0]?.n ?? 0;
    }, 0),
    probe(async () => {
      const r = await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM heartbeat_logs
        WHERE status = 'error' AND created_at >= ${since7d}
          AND task_id IN (SELECT id FROM heartbeat_tasks WHERE tenant_id = ${tenantId})`);
      return rows(r)[0]?.n ?? 0;
    }, 0),
    probe(async () => {
      const r = await db.execute(sql`
        SELECT answer_model, suite_score, degraded, regressed FROM eval_runs
        WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 1`);
      const row = rows(r)[0];
      return row ? { suiteScore: row.suite_score, degraded: row.degraded, regressed: row.regressed } : null;
    }, null as any),
    probe(async () => {
      const r = await db.execute(sql`
        SELECT title FROM self_initiatives
        WHERE tenant_id = ${tenantId} AND status IN ('surfaced','approved','acting')
        ORDER BY created_at DESC LIMIT 15`);
      return rows(r).map((x) => x.title);
    }, [] as string[]),
  ]);

  return {
    openIncidents,
    incidentClassesLast30d: incidentClasses,
    declineEventsLast30d: declineRecent,
    auditLeadsTotal: leadsOpen,
    auditLeadsLast7d: leadsRecent,
    heartbeatErrorsLast7d: heartbeatErrors,
    latestOfflineEval: evalDrift,
    alreadyOpenInitiatives: recentInitiatives,
  };
}

/** Normalized dedup key: lowercase significant words, deduped + sorted. */
export function initiativeSignature(title: string): string {
  const stop = new Set(["the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "add", "build", "create", "improve", "make", "our", "platform"]);
  return Array.from(
    new Set(
      (title || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stop.has(w)),
    ),
  )
    .sort()
    .slice(0, 8)
    .join("-")
    .slice(0, 120);
}

/** Defensive JSON extraction — tolerates code fences and surrounding prose. */
export function parseInitiatives(raw: string): any[] {
  if (!raw) return [];
  let txt = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  // Prefer the first top-level array; fall back to an object with .initiatives.
  const arrStart = txt.indexOf("[");
  const objStart = txt.indexOf("{");
  try {
    if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
      const arrEnd = txt.lastIndexOf("]");
      if (arrEnd > arrStart) return JSON.parse(txt.slice(arrStart, arrEnd + 1));
    }
    const objEnd = txt.lastIndexOf("}");
    if (objStart >= 0 && objEnd > objStart) {
      const obj = JSON.parse(txt.slice(objStart, objEnd + 1));
      if (Array.isArray(obj)) return obj;
      if (Array.isArray(obj?.initiatives)) return obj.initiatives;
    }
  } catch (err) {
    logSilentCatch("server/agentic/self-initiative.ts", err);
  }
  return [];
}

const VALID_CATEGORIES = new Set(["revenue", "reliability", "quality", "growth", "cost", "safety", "capability", "general"]);
const VALID_RISK = new Set(["low", "medium", "high"]);

// SAFE SLIVER (R125+67) — categories whose work is internal and carries no
// money/customer/mass-comms blast radius. Anything touching revenue, cost,
// growth (marketing/outreach), safety, or general is DELIBERATELY excluded:
// those are the surfaces where autonomous action would be dangerous, so they
// are never marked auto-eligible.
const AUTO_ELIGIBLE_CATEGORIES = new Set(["reliability", "quality", "capability"]);
const AUTO_ELIGIBLE_MIN_CONFIDENCE = 0.8;

/**
 * Classify whether an initiative COULD be a candidate for autonomous execution.
 * This is ADVISORY ONLY — it surfaces a recommendation in the owner digest and
 * persists nothing executable. Nothing in this module auto-executes; commitment
 * stays HITL. The bar is intentionally conservative: low risk AND high
 * confidence AND a non-money/customer/mass-comms category.
 */
function classifyAutoEligibility(
  it: { risk: string; confidence: number; category: string },
): { autoEligible: boolean; reason: string } {
  if (it.risk !== "low") return { autoEligible: false, reason: `risk=${it.risk} (need low)` };
  if (it.confidence < AUTO_ELIGIBLE_MIN_CONFIDENCE) return { autoEligible: false, reason: `confidence=${it.confidence.toFixed(2)} (need >=${AUTO_ELIGIBLE_MIN_CONFIDENCE})` };
  if (!AUTO_ELIGIBLE_CATEGORIES.has(it.category)) return { autoEligible: false, reason: `category=${it.category} (money/customer/mass-comms risk)` };
  return { autoEligible: true, reason: "low-risk + high-confidence + internal category" };
}

/**
 * Run one self-directed initiative cycle. Introspect → reason → persist →
 * surface. Returns a structured summary for the heartbeat log.
 */
export async function runSelfInitiativeCycle(opts: {
  tenantId: number;
  model?: string;
}): Promise<SelfInitiativeResult> {
  const tenantId = opts.tenantId;
  const model = opts.model || "gpt-5-mini";
  const base: SelfInitiativeResult = {
    ok: false, reason: "", proposed: 0, inserted: 0, skippedDuplicate: 0, failedInserts: 0, model, summary: "", titles: [],
  };

  // 1) Reserve budget BEFORE any LLM spend (fails CLOSED if unprovable).
  const claim = await claimAutonomousBudget({
    tenantId,
    estimatedUsd: 0.05,
    label: "self-initiative",
  });
  if (!claim.ok) {
    return { ...base, reason: `budget-blocked:${claim.reason}`, summary: `Skipped — ${claim.reason}` };
  }

  // 2) Introspect the platform's own state.
  const telemetry = await gatherTelemetry(tenantId);

  // 3) Reason: propose up to 3 self-authored initiatives grounded in telemetry.
  const system = [
    "You are the intention engine of VisionClaw, a self-managing multi-persona AI corporation.",
    "You are given a snapshot of the platform's OWN internal telemetry. Your job is the part of agency that nobody asks for: decide what the platform should PROACTIVELY pursue to make itself more valuable, reliable, or capable — goals it set for itself, not tasks handed to it.",
    "Propose AT MOST 3 initiatives, ONLY ones genuinely supported by the telemetry. Fewer (even zero) is correct when the signals are quiet — do NOT invent work. Never repeat anything already in alreadyOpenInitiatives.",
    "Each initiative must be concrete and actionable by an engineering/ops team, not a vague aspiration.",
    "Respond with ONLY a JSON array. Each element: {\"title\": string (<=90 chars), \"rationale\": string (1-3 sentences, cite the specific telemetry signal), \"category\": one of [revenue,reliability,quality,growth,cost,safety,capability], \"confidence\": number 0..1, \"risk\": one of [low,medium,high], \"estimatedValue\": short string}.",
    "If nothing is worth proposing, respond with exactly [].",
  ].join("\n");

  let content = "";
  try {
    const { client, actualModelId } = await getClientForModel(model, tenantId);
    const resp = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Platform telemetry snapshot (tenant ${tenantId}):\n${JSON.stringify(telemetry, null, 2)}` },
      ],
      // max_completion_tokens (NOT max_tokens) + no custom temperature — some
      // reasoning models reject those params; this shape is the safe one.
      max_completion_tokens: 1800,
    });
    content = resp.choices?.[0]?.message?.content?.trim() || "";
  } catch (err: any) {
    logSilentCatch("server/agentic/self-initiative.ts", err);
    return { ...base, reason: `llm-error`, summary: `LLM call failed: ${(err?.message || err).toString().slice(0, 200)}` };
  }

  const parsed = parseInitiatives(content);
  if (parsed.length === 0) {
    return { ...base, ok: true, reason: "no-initiatives", summary: "Introspected platform state; nothing worth proposing this cycle." };
  }

  // 4) Validate, dedup, and persist.
  const existing = await probe(async () => {
    const r = await db.execute(sql`
      SELECT signature FROM self_initiatives
      WHERE tenant_id = ${tenantId} AND status IN ('surfaced','approved','acting')`);
    return new Set(rows(r).map((x) => x.signature));
  }, new Set<string>());

  const insertedTitles: string[] = [];
  const insertedDetails: { title: string; autoEligible: boolean; reason: string }[] = [];
  let skippedDuplicate = 0;
  let failedInserts = 0;
  const seenThisRun = new Set<string>();

  for (const it of parsed.slice(0, 3)) {
    const title = String(it?.title || "").trim().slice(0, 90);
    if (!title) continue;
    const sig = initiativeSignature(title);
    if (existing.has(sig) || seenThisRun.has(sig)) {
      skippedDuplicate++;
      continue;
    }
    seenThisRun.add(sig);

    const category = VALID_CATEGORIES.has(String(it?.category)) ? String(it.category) : "general";
    const risk = VALID_RISK.has(String(it?.risk)) ? String(it.risk) : "medium";
    let confidence = Number(it?.confidence);
    confidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5;
    const rationale = String(it?.rationale || "").slice(0, 1200);
    const estimatedValue = String(it?.estimatedValue || "").slice(0, 300);

    // Persistence is EXPLICIT — failures are loud + counted, never silently
    // swallowed (so the heartbeat log shows a degraded cycle). The partial
    // unique index on (tenant_id, signature) WHERE status IN open-states is the
    // concurrency backstop for the app-level dedup above: a row lost to a
    // concurrent writer is ON CONFLICT DO NOTHING → counted as a duplicate.
    try {
      const ins = await db.execute(sql`
        INSERT INTO self_initiatives
          (tenant_id, title, rationale, category, evidence, confidence, risk, estimated_value, status, source_model, signature)
        VALUES
          (${tenantId}, ${title}, ${rationale}, ${category}, ${JSON.stringify(telemetry)}::jsonb,
           ${confidence}, ${risk}, ${estimatedValue}, 'surfaced', ${model}, ${sig})
        ON CONFLICT (tenant_id, signature) WHERE status IN ('surfaced','approved','acting') DO NOTHING
        RETURNING id`);
      if (rows(ins).length > 0) {
        insertedTitles.push(title);
        const elig = classifyAutoEligibility({ risk, confidence, category });
        insertedDetails.push({ title, autoEligible: elig.autoEligible, reason: elig.reason });
      } else skippedDuplicate++;
    } catch (err: any) {
      failedInserts++;
      console.error(`[self-initiative] INSERT failed for "${title}" (tenant ${tenantId}): ${(err?.message || err).toString().slice(0, 200)}`);
    }
  }

  // 5) Surface NEW initiatives to the owner (HITL on commitment) via the daily
  // digest channel — batched into ONE notification so it never pages Bob
  // one-at-a-time. Best-effort; a surfacing failure must not undo persistence.
  if (insertedTitles.length > 0) {
    await probe(async () => {
      const autoEligibleCount = insertedDetails.filter((d) => d.autoEligible).length;
      const title = `🧭 ${insertedTitles.length} self-directed initiative${insertedTitles.length > 1 ? "s" : ""} proposed`;
      const message = insertedDetails
        .map((d, i) => `${i + 1}. ${d.title}${d.autoEligible ? "  ⚡ auto-eligible (still needs your approval)" : ""}`)
        .join("\n")
        .slice(0, 2000);
      const metadata = JSON.stringify({
        source: "self-initiative-engine",
        count: insertedTitles.length,
        // ADVISORY ONLY — auto-eligibility is a recommendation surfaced for review.
        // Nothing here auto-executes; commitment stays HITL (/api/admin/self-initiatives).
        autoEligibleCount,
        autoEligible: insertedDetails.filter((d) => d.autoEligible).map((d) => d.title),
        model,
        reviewPath: "/api/admin/self-initiatives",
      });
      await db.execute(sql`
        INSERT INTO notifications (tenant_id, type, title, message, category, metadata)
        VALUES (${tenantId}, 'digest', ${title}, ${message}, 'owner_digest', ${metadata}::jsonb)`);
    }, undefined);
  }

  const failSuffix = failedInserts > 0 ? ` [${failedInserts} INSERT failed]` : "";
  const summary = insertedTitles.length > 0
    ? `Proposed ${parsed.length}, persisted ${insertedTitles.length} (skipped ${skippedDuplicate} dup): ${insertedTitles.join("; ")}${failSuffix}`
    : `Proposed ${parsed.length} but none persisted (skipped ${skippedDuplicate} dup).${failSuffix}`;

  return {
    ok: true,
    reason: failedInserts > 0 ? "ran-degraded" : "ran",
    proposed: parsed.length,
    inserted: insertedTitles.length,
    skippedDuplicate,
    failedInserts,
    model,
    summary,
    titles: insertedTitles,
  };
}
