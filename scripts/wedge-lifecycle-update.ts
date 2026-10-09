/**
 * Wedge lifecycle updater — weekly (Mon), heartbeat maintenance_script key "wedge-lifecycle".
 *
 * Problem (Bob 2026-08-08): wedge project cards were seeded once (status active +
 * stage:validation, ~2026-07-22) and NOTHING ever updated them — the cards froze
 * at day one and misrepresent reality.
 *
 * For EVERY project tagged 'wedge' (discovered dynamically — no hardcoded track
 * list), this script:
 *   1. Reads real signals: waitlist signups (leads, 7d + 21d), inbox activity,
 *      content shipped (project_files, 7d + 21d), PAID orders in those windows
 *      (archive_rescue_orders post-payment statuses for the archive-rescue
 *      wedge; extend per-wedge as order tables appear).
 *   2. Advances/demotes the stage:* tag:
 *        - ≥3 paid orders/21d OR ≥15 signups/7d       → stage:scale
 *        - paid order/7d OR ≥5 signups/7d             → stage:traction
 *        - zero signals for 21d                        → stage:stalled/status:on_hold
 *        - zero signals for 42d                        → stage:parked/status:archived
 *        - dormant wedge with any fresh signal         → stage:validation/status:active
 *        - otherwise                                   → unchanged
 *      Tag surgery is canonical: ALL stage:* tags are removed and exactly one
 *      is written back (heals malformed/multi-stage/tagless cards).
 *   3. Appends an idempotent dated project note, mirrors the last 12 lines into
 *      current_state, and bumps updated_at, so the Projects UI card shows life.
 *
 * Fail-safe: if ANY signal query for a wedge errors, that wedge is SKIPPED
 * entirely (no stage change, no note) — a DB outage must never mass-stall the
 * portfolio on false zeros.
 *
 * Idempotent per date — re-running the same day updates that day's note and
 * makes no duplicate transitions. $0, no LLM.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { ADMIN_TENANT_ID } from "../server/tenant-utils";
import { decideWedgeLifecycle } from "./lib/wedge-lifecycle-policy";

const TENANT_ID = ADMIN_TENANT_ID;

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
    const rows = r.rows || r;
    const raw = Array.isArray(rows) && rows.length === 1 ? rows[0]?.n : undefined;
    const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      console.warn("[wedge-lifecycle] signal query returned an invalid count");
      return null;
    }
    return value;
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
    const content7d = await count(sql`SELECT COUNT(*)::int AS n FROM project_files pf JOIN projects p ON p.id=pf.project_id WHERE pf.project_id=${w.id} AND p.tenant_id=${TENANT_ID} AND pf.created_at > NOW() - INTERVAL '7 days'`);
    const content21d = await count(sql`SELECT COUNT(*)::int AS n FROM project_files pf JOIN projects p ON p.id=pf.project_id WHERE pf.project_id=${w.id} AND p.tenant_id=${TENANT_ID} AND pf.created_at > NOW() - INTERVAL '21 days'`);
    const inboxNeedle = (slug || w.name.replace(/^Wedge:\s*/, "")).replace(/-/g, " ");
    const inbox7d = await count(sql`SELECT COUNT(*)::int AS n FROM inbox_messages WHERE tenant_id=${TENANT_ID} AND direction='inbound' AND received_at > NOW() - INTERVAL '7 days' AND (subject ILIKE '%' || ${inboxNeedle}::text || '%' OR body_text ILIKE '%' || ${inboxNeedle}::text || '%')`);
    const inbox21d = await count(sql`SELECT COUNT(*)::int AS n FROM inbox_messages WHERE tenant_id=${TENANT_ID} AND direction='inbound' AND received_at > NOW() - INTERVAL '21 days' AND (subject ILIKE '%' || ${inboxNeedle}::text || '%' OR body_text ILIKE '%' || ${inboxNeedle}::text || '%')`);
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

    if ([signups7d, signups21d, content7d, content21d, orders7d, orders21d, inbox7d, inbox21d].some((v) => v === null)) {
      console.warn(`[wedge-lifecycle] ${w.name}: signal query failed — SKIPPING (no stage change on unknown data)`);
      skipped++;
      continue;
    }

    const ageDays = (Date.now() - new Date(w.created_at).getTime()) / 86400000;
    const decision = decideWedgeLifecycle(stage, ageDays, {
      signups7d: signups7d!, signups21d: signups21d!,
      content7d: content7d!, content21d: content21d!,
      orders7d: orders7d!, orders21d: orders21d!,
      inbox7d: inbox7d!, inbox21d: inbox21d!,
    });
    const nextStage = decision.stage;

    // --- dated progress note (idempotent: replace today's line) ---
    const note = `${today} · stage:${nextStage} · status:${decision.status} · signups 7d=${signups7d}/21d=${signups21d} · inbox 7d=${inbox7d}/21d=${inbox21d} · content 7d=${content7d} · paid orders 7d=${orders7d}/21d=${orders21d}${nextStage !== stage ? ` · ${stage}→${nextStage} (${decision.reason})` : ""}`;
    const prior = (w.current_state || "")
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith(today));
    const nextState = [...prior.slice(-11), note].join("\n");

    // Canonical tag surgery: strip ALL stage:* tags, write back exactly one.
    // Also normalizes malformed cards (multiple or zero stage tags).
    const nonStageTags = tags.filter((t) => !t.startsWith("stage:"));
    const nextTags = [...nonStageTags, `stage:${nextStage}`];
    const tagLiteral = `{${nextTags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",")}}`;

    const projectStillExists = await db.transaction(async (tx) => {
      // Serialize same-project runs for the duration of this transaction. The
      // heartbeat claim already prevents normal overlap; this also makes manual
      // reruns preserve the one-note-per-project/day contract without a schema
      // migration on the legacy project_notes table.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${w.id})`);
      const updated: any = await tx.execute(sql`
        UPDATE projects
        SET tags = ${tagLiteral}::text[], status = ${decision.status},
            current_state = ${nextState}, updated_at = NOW()
        WHERE id=${w.id} AND tenant_id=${TENANT_ID}
        RETURNING id
      `);
      if (!(updated.rows || updated)[0]?.id) return false;
      const existing: any = await tx.execute(sql`
        SELECT pn.id FROM project_notes pn
        JOIN projects p ON p.id=pn.project_id
        WHERE pn.project_id=${w.id} AND p.tenant_id=${TENANT_ID}
          AND pn.author='wedge-lifecycle' AND pn.note LIKE ${today + " ·%"}
        LIMIT 1
      `);
      const existingId = (existing.rows || existing)[0]?.id;
      if (existingId) {
        await tx.execute(sql`UPDATE project_notes SET note=${note}, created_at=NOW() WHERE id=${existingId} AND project_id=${w.id}`);
      } else {
        await tx.execute(sql`INSERT INTO project_notes (project_id, note, author) VALUES (${w.id}, ${note}, 'wedge-lifecycle')`);
      }
      return true;
    });
    if (!projectStillExists) {
      console.warn(`[wedge-lifecycle] ${w.name}: project disappeared before update — SKIPPING note`);
      skipped++;
      continue;
    }
    if (nextStage !== stage) {
      console.log(`[wedge-lifecycle] ${w.name}: ${stage} → ${nextStage} (${decision.reason}); status=${decision.status}`);
    } else {
      console.log(`[wedge-lifecycle] ${w.name}: ${stage} unchanged — ${note}`);
    }
  }

  console.log(`[wedge-lifecycle] done (${skipped} skipped on signal-read failure)`);
  process.exit(skipped > 0 ? 1 : 0);
})().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
