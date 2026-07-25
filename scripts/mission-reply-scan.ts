// ─────────────────────────────────────────────────────────────────────────────
// Revenue Missions S3 — reply evidence scanner (operator-runnable, one-line).
// For every LIVE experiment of the owner tenant: Gmail-search the experiment's
// reply token, dedupe against existing mission_evidence.external_ref, classify
// each new reply with the deterministic keyword heuristic, and write a
// mission_evidence row (source=gmail, externalRef=<gmail message id>).
//
// READ-ONLY against Gmail; writes only mission_evidence + rollup counters.
// Env: MISSION_ID=<n> to scan one mission only. Exit codes: 0 ok (incl. zero
// new replies), 1 unexpected failure, 2 Gmail/auth failure.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { addEvidence } from "../server/lib/revenue-missions";
import { classifyReplyText } from "../server/lib/mission-experiment-run";
import { ownerTenantId } from "../server/agentic/autonomous-budget";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

async function main() {
  const tenantId = ownerTenantId();
  const missionFilter = process.env.MISSION_ID ? Number(process.env.MISSION_ID) : null;

  const exps = rows(await db.execute(sql`
    SELECT * FROM mission_experiments
    WHERE tenant_id = ${tenantId} AND status = 'live' AND reply_token IS NOT NULL
      ${missionFilter ? sql`AND mission_id = ${missionFilter}` : sql``}
    ORDER BY id
  `));
  if (exps.length === 0) {
    console.log("[reply-scan] no live experiments with reply tokens — nothing to scan");
    return;
  }

  let gmailSearch: (tenantId: number, q: string, max?: number) => Promise<any>;
  let gmailGetMessage: (tenantId: number, id: string) => Promise<any>;
  try {
    ({ gmailSearch, gmailGetMessage } = await import("../server/google-workspace"));
  } catch (e: any) {
    console.error("[reply-scan] Gmail module unavailable:", e?.message ?? e);
    process.exit(2);
  }

  let totalNew = 0;
  for (const exp of exps) {
    const token = String(exp.reply_token);
    let found: any;
    try {
      // Replies quote the token (subject or body footer); exclude our own sends.
      found = await gmailSearch(tenantId, `"${token}" in:inbox`, 50);
    } catch (e: any) {
      console.error(`[reply-scan] Gmail search failed for exp ${exp.id}:`, e?.message ?? e);
      process.exit(2);
    }
    const messages: any[] = found?.messages || found?.results || [];
    if (messages.length === 0) {
      console.log(`[reply-scan] exp ${exp.id} (${token}): no inbox matches`);
      continue;
    }

    // Dedupe GLOBALLY per (tenant, source) — a single Gmail message that
    // matches multiple experiment scans must only ever produce one row.
    // The DB partial unique index (tenant_id, source, external_ref) is the
    // authoritative backstop; addEvidence returns null on conflict.
    const seen = new Set(
      rows(await db.execute(sql`
        SELECT external_ref FROM mission_evidence
        WHERE tenant_id = ${tenantId} AND source = 'gmail' AND external_ref IS NOT NULL
      `)).map((r: any) => String(r.external_ref)),
    );

    for (const m of messages) {
      const msgId = String(m.id ?? m.messageId ?? "");
      if (!msgId || seen.has(msgId)) continue;
      let from = "";
      let snippet = "";
      try {
        const full = await gmailGetMessage(tenantId, msgId);
        from = String(full?.from ?? full?.headers?.from ?? "");
        snippet = String(full?.snippet ?? full?.body ?? "").slice(0, 500);
      } catch (e: any) {
        console.warn(`[reply-scan] gmailGetMessage ${msgId} failed:`, e?.message ?? e);
      }
      const emailMatch = from.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      const type = classifyReplyText(`${from} ${snippet}`);
      const ev = await addEvidence({
        tenantId,
        missionId: Number(exp.mission_id),
        experimentId: Number(exp.id),
        type,
        summary: `Reply to experiment ${exp.id} from ${from || "unknown"}: ${snippet.slice(0, 200)}`,
        source: "gmail",
        externalRef: msgId,
        contactEmail: emailMatch?.[0],
        raw: { from, snippet },
      });
      if (!ev) {
        console.log(`[reply-scan] exp ${exp.id}: msg ${msgId} already recorded (DB dedupe) — skipped`);
        continue;
      }
      seen.add(msgId);
      totalNew += 1;
      console.log(`[reply-scan] exp ${exp.id}: NEW ${type} from ${from || "unknown"} (msg ${msgId})`);
    }
  }
  console.log(`[reply-scan] done — ${totalNew} new evidence row(s) across ${exps.length} live experiment(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[reply-scan] fatal:", e?.message ?? e);
    process.exit(1);
  });
