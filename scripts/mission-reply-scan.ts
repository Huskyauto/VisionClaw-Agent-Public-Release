// ─────────────────────────────────────────────────────────────────────────────
// Revenue Missions S3 — reply evidence scanner (operator-runnable backstop).
//
// The scan core now lives in server/lib/mission-reply-intake.ts and runs
// AUTOMATICALLY every 15 minutes via the mission_reply_intake heartbeat task
// (prod-only). This script remains the manual reconciliation sweep:
//  - runnable on demand (MISSION_ID=<n> to scan one mission);
//  - lenient sender matching (requireSender=false): messages whose sender
//    can't be extracted are still recorded as evidence (the automated pass
//    skips them for a human to adjudicate here). An unmatched sender still
//    NEVER pauses/advances any enrollment.
//
// READ-ONLY against Gmail; writes mission_evidence (+rollups) and pauses
// replied prospects' enrollments. Exit codes: 0 ok (incl. zero new replies),
// 1 unexpected failure, 2 Gmail/auth failure.
// ─────────────────────────────────────────────────────────────────────────────
import { scanMissionReplies } from "../server/lib/mission-reply-intake";
import { ownerTenantId } from "../server/agentic/autonomous-budget";

async function main() {
  const tenantId = ownerTenantId();
  const missionFilter = process.env.MISSION_ID ? Number(process.env.MISSION_ID) : null;

  const s = await scanMissionReplies(tenantId, { missionId: missionFilter, requireSender: false });
  for (const err of s.errors) console.error(`[reply-scan] ${err}`);
  console.log(
    `[reply-scan] done — ${s.newEvidence} new evidence row(s), ${s.pausedEnrollments} enrollment(s) paused/stopped, ` +
    `${s.skipped} skipped across ${s.scannedExperiments} live experiment(s)`,
  );
  if (s.gmailUnavailable) process.exit(2);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[reply-scan] fatal:", e?.message ?? e);
    process.exit(1);
  });
