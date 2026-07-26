// R76 — One-shot persona doctrine update.
// Appends "Doctrine #12 — Trust Tiers + Deliverable Contracts" to every active
// persona's tools_doc. Idempotent: skips personas where the marker already exists.
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const DOCTRINE = `

DOCTRINE #12 — Trust Tiers + Deliverable Contracts (R76):
Routine ops can be pre-approved by tool_policies (per-tenant rules covering tool name, sub-action, recipient pattern, and amount cap). When a policy matches "allow", your tool call bypasses HITL automatically — you do not need to wait, ask, or notify the owner. When a policy matches "deny", your tool call is blocked at the gate; do not retry the same call with cosmetic changes. When no policy matches and the tool is risky, HITL fires with email + SSE escalation to the owner; wait for approval. Use the set_policy tool to inspect or adjust policies (owner only).
Before claiming a customer-facing deliverable is COMPLETE — HTML page, PDF, slide deck, video, audio, image, CSV, or JSON file — you MUST call verify_deliverable with the correct deliverable_type and either file_path or file_url. Verification checks file extension, MIME, magic bytes, and render-ability. If verification returns passed=false, fix the artifact (re-render, re-export, switch tool) and re-verify. Do NOT claim success until verify_deliverable returns passed=true. Reporting a delivered artifact without a successful verification record counts as a hallucination.`;

async function main() {
  const personas = await db.execute(sql`
    SELECT id, name FROM personas WHERE is_active = true ORDER BY id
  `);
  const rows = (personas as any).rows as Array<{ id: number; name: string }>;
  console.log(`Found ${rows.length} active personas.`);

  let updated = 0;
  let skipped = 0;
  for (const p of rows) {
    const check = await db.execute(sql`
      SELECT (tools_doc LIKE '%DOCTRINE #12%') AS has_doctrine FROM personas WHERE id = ${p.id}
    `);
    if (((check as any).rows?.[0] as any)?.has_doctrine) {
      console.log(`  [skip] persona #${p.id} ${p.name} — already has doctrine #12`);
      skipped++;
      continue;
    }
    await db.execute(sql`
      UPDATE personas
      SET tools_doc = tools_doc || ${DOCTRINE}
      WHERE id = ${p.id}
    `);
    console.log(`  [done] persona #${p.id} ${p.name} — appended doctrine #12`);
    updated++;
  }
  console.log(`\nSummary: ${updated} updated, ${skipped} skipped, ${rows.length} total.`);
  process.exit(0);
}

main().catch(e => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});
