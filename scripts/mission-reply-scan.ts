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
  // Strict validation (architect 2026-08-09): a malformed MISSION_ID must
  // abort, not silently widen the scan to EVERY live mission.
  let missionFilter: number | null = null;
  if (process.env.MISSION_ID !== undefined && process.env.MISSION_ID !== "") {
    const raw = process.env.MISSION_ID.trim();
    const n = Number(raw);
    if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(n) || n <= 0) {
      console.error(`[reply-scan] invalid MISSION_ID "${process.env.MISSION_ID}" — must be a positive integer. Aborting.`);
      process.exit(1);
    }
    missionFilter = n;
  }

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
