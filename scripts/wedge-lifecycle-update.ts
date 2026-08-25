/**
 * Wedge lifecycle updater — weekly (Mon), heartbeat maintenance_script key "wedge-lifecycle".
 *
 * Problem (Bob 2026-08-08): wedge project cards were seeded once (status active +
 * stage:validation, ~2026-07-22) and NOTHING ever updated them — the cards froze
 * at day one and misrepresent reality.
 *
 * For EVERY project tagged 'wedge' (discovered dynamically — no hardcoded track
 * list), this script:
 *   1. Reads real signals: waitlist signups (leads, 7d + 21d), content shipped
 *      (project_files, 7d + 21d), PAID orders in the same 7d/21d windows
 *      (archive_rescue_orders post-payment statuses for the archive-rescue
 *      wedge; extend per-wedge as order tables appear).
 *   2. Advances/demotes the stage:* tag:
 *        - paid order (7d) OR ≥5 signups/7d           → stage:traction
 *        - zero signals for 21d AND card ≥21d old     → stage:stalled
 *          (applies to traction too — traction decays when activity ceases)
 *        - stalled wedge with any fresh signal         → stage:validation (recovered)
 *        - otherwise                                   → unchanged
 *      Tag surgery is canonical: ALL stage:* tags are removed and exactly one
 *      is written back (heals malformed/multi-stage/tagless cards).
 *   3. Appends a dated one-line progress note to current_state (keeps last 12
 *      lines) and bumps updated_at, so the Projects UI card shows life.
 *
 * Fail-safe: if ANY signal query for a wedge errors, that wedge is SKIPPED
 * entirely (no stage change, no note) — a DB outage must never mass-stall the
 * portfolio on false zeros.
 *
 * Idempotent per date — re-running the same day replaces that day's note and
 * makes no duplicate transitions. $0, no LLM. Status field is left 'active'
 * (stage:stalled carries the dormancy signal; archiving stays a human call).
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const TENANT_ID = Number(process.env.WEDGE_TENANT_ID || 1);

// Post-payment statuses for archive_rescue_orders (webhook flips
// checkout_initiated → 'paid'; fulfillment continues beyond). Pre-payment /
// demo / failed states must NOT count as revenue signal.
const PAID_ORDER_STATUSES = ["paid", "in_progress", "completed", "delivered", "shipped"];

type WedgeRow = {
  id: number;
  name: string;
  tags: string[];
  current_state: string | null;
  created_at: string;
};

/** Returns the count, or null on query failure (caller must skip the wedge). */
async function count(q: any): Promise<number | null> {
  try {
    const r: any = await db.execute(q);
    return Number((r.rows || r)[0]?.n || 0);
  } catch (e: any) {
    console.warn(`[wedge-lifecycle] signal query failed: ${e?.message}`);
    return null;
  }
}

function stageOf(tags: string[]): string {
  const t = tags.find((x) => x.startsWith("stage:"));
  return t ? t.slice("stage:".length) : "validation";
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const res: any = await db.execute(sql`
    SELECT id, name, tags, current_state, created_at FROM projects
    WHERE tenant_id=${TENANT_ID} AND 'wedge' = ANY(tags)
    ORDER BY id
  `);
  const wedges: WedgeRow[] = res.rows || res;
  console.log(`[wedge-lifecycle] ${today} — ${wedges.length} wedge card(s) for tenant ${TENANT_ID}`);
  if (wedges.length === 0) process.exit(0);

  let skipped = 0;
  for (const w of wedges) {
    const tags: string[] = Array.isArray(w.tags) ? w.tags : [];
    const slugTag = tags.find((t) => t.startsWith("wedge:"));
    const slug = slugTag ? slugTag.slice("wedge:".length) : null;
    const stage = stageOf(tags);

    // --- signals (null = query failure → skip wedge, never treat as zero) ---
    // Lead source of truth is audit_leads (there is NO 'leads' table — the old
    // digest queried one and its catch silently returned 0 forever). Wedge
    // attribution: UTM fields carrying the slug; the audit wedge (slug
    // audit-pro) owns the whole storefront funnel, so it counts all rows.
    const leadWhere = (days: number) =>
      slug === "audit-pro"
        ? sql`SELECT COUNT(*)::int AS n FROM audit_leads WHERE tenant_id=${TENANT_ID} AND created_at > NOW() - (${days}::int || ' days')::interval`
        : sql`SELECT COUNT(*)::int AS n FROM audit_leads WHERE tenant_id=${TENANT_ID} AND created_at > NOW() - (${days}::int || ' days')::interval AND (utm_campaign ILIKE '%' || ${slug}::text || '%' OR utm_content ILIKE '%' || ${slug}::text || '%' OR utm_source ILIKE '%' || ${slug}::text || '%' OR notes ILIKE '%' || ${slug}::text || '%')`;
    const signups7d = slug ? await count(leadWhere(7)) : 0;
    const signups21d = slug ? await count(leadWhere(21)) : 0;
    const content7d = await count(sql`SELECT COUNT(*)::int AS n FROM project_files WHERE project_id=${w.id} AND created_at > NOW() - INTERVAL '7 days'`);
    const content21d = await count(sql`SELECT COUNT(*)::int AS n FROM project_files WHERE project_id=${w.id} AND created_at > NOW() - INTERVAL '21 days'`);
    // Paid orders — per-wedge order tables; only archive-rescue has one today.
    let orders7d: number | null = 0;
    let orders21d: number | null = 0;
    if (slug === "archive-rescue") {
      // Drizzle untyped params don't support = ANY(array) (see memory:
      // drizzle-untyped-param-comparisons); statuses are constants → cast a
      // joined literal instead.
      const paidList = PAID_ORDER_STATUSES.join(",");
      orders7d = await count(sql`SELECT COUNT(*)::int AS n FROM archive_rescue_orders WHERE tenant_id=${TENANT_ID} AND status = ANY(string_to_array(${paidList}, ',')) AND created_at > NOW() - INTERVAL '7 days'`);
      orders21d = await count(sql`SELECT COUNT(*)::int AS n FROM archive_rescue_orders WHERE tenant_id=${TENANT_ID} AND status = ANY(string_to_array(${paidList}, ',')) AND created_at > NOW() - INTERVAL '21 days'`);
    }

    if ([signups7d, signups21d, content7d, content21d, orders7d, orders21d].some((v) => v === null)) {
      console.warn(`[wedge-lifecycle] ${w.name}: signal query failed — SKIPPING (no stage change on unknown data)`);
      skipped++;
      continue;
    }

    const anySignal21d = signups21d! + content21d! + orders21d! > 0;
    const ageDays = (Date.now() - new Date(w.created_at).getTime()) / 86400000;

    // --- stage transition ---
    let nextStage = stage;
    let reason = "holding";
    if (orders7d! > 0 || signups7d! >= 5) {
      nextStage = "traction";
      reason = orders7d! > 0 ? `${orders7d} paid order(s)/7d` : `${signups7d} signups/7d`;
    } else if (stage === "stalled" && anySignal21d) {
      nextStage = "validation";
      reason = "signal returned — recovered from stalled";
    } else if (stage !== "stalled" && !anySignal21d && ageDays >= 21) {
      // Applies to traction too: traction with zero signals for 21d has decayed.
      nextStage = "stalled";
      reason = "zero signals for 21d";
    }

    // --- dated progress note (idempotent: replace today's line) ---
    const note = `${today} · stage:${nextStage} · signups 7d=${signups7d}/21d=${signups21d} · content 7d=${content7d} · paid orders 7d=${orders7d}${nextStage !== stage ? ` · ${stage}→${nextStage} (${reason})` : ""}`;
    const prior = (w.current_state || "")
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith(today));
    const nextState = [...prior.slice(-11), note].join("\n");

    // Canonical tag surgery: strip ALL stage:* tags, write back exactly one.
    // Also normalizes malformed cards (multiple or zero stage tags).
    const nonStageTags = tags.filter((t) => !t.startsWith("stage:"));
    const nextTags = [...nonStageTags, `stage:${nextStage}`];
    const tagLiteral = `{${nextTags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",")}}`;

    await db.execute(sql`
      UPDATE projects
      SET tags = ${tagLiteral}::text[], current_state = ${nextState}, updated_at = NOW()
      WHERE id=${w.id} AND tenant_id=${TENANT_ID}
    `);
    if (nextStage !== stage) {
      console.log(`[wedge-lifecycle] ${w.name}: ${stage} → ${nextStage} (${reason})`);
    } else {
      console.log(`[wedge-lifecycle] ${w.name}: ${stage} unchanged — ${note}`);
    }
  }

  console.log(`[wedge-lifecycle] done (${skipped} skipped on signal-read failure)`);
  process.exit(0);
})().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
