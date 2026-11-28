# Backup destination repair

Bob approved repair without changing sharing permissions.

## Cause and bounded repair

On November 18, 2026, the daily run at 21:04 Central failed before export:
`Confidential backup folder lookup is ambiguous or incomplete`.
Read-only production investigation identified the same error in memory snapshots.
Drive inspection confirmed two root folders named `VisionClaw Backups`.

The folder containing March-only backups was renamed
`VisionClaw Backups — March 2026 archive`. The folder containing November backups
retains `VisionClaw Backups`. A subsequent Drive listing returned exactly one
match, with no continuation token and `incompleteSearch=false`.
No files were moved/deleted and no sharing permissions were changed.

Drive also returned one user permission with effective role `owner`, with both
an inherited `writer` detail and a direct `owner` detail for that same principal.
The validator incorrectly treated the lesser inherited role as another grantee.
It now permits recognized lesser inherited roles only alongside explicit direct
ownership within that same owner permission. Every separate permission must
still be an owner; public/group/domain/non-owner access, unknown roles and
unreadable permission responses remain rejected.

## Verification and limits

The exact observed mixed-owner permission fixture failed before the code fix
and passed afterward. The focused confidentiality suite also exercises actual
extracted folder resolution/upload functions, rejects duplicates/pagination,
refuses unsafe destinations before export, and checks the resulting file.
Tests use synthetic data and do not perform a real backup or retention cleanup.
All 14 focused confidentiality, memory-delivery and packaged-runner regressions
passed. Strict TypeScript checking passed for the changed validator; the
production server bundle compiled with existing CommonJS/import-meta warnings.
The 25-rule stale-string gate passed. Agent wiring was clean with existing
warn-only persona-sprawl/orphan-table observations; no persona-facing interface
changed. Scoped self-review covered the same-principal boundary, complete
permission pagination, ambiguity refusal, pre-export ordering and unchanged
upload/retention behavior. This is not an independent architect review.

Read-only Drive inspection also confirmed one `Memory Snapshots` child under
the retained root, with the same direct-owner/inherited-writer permission shape.

Latest full backup observed in Drive:
`visionclaw-backup-2026-11-16T03-01-13.json`, created November 15 at 21:01 Central,
419.82 MiB. Presence is not a restoration test.

The Drive name repair is live. The validator is a workspace source repair and
requires owner-initiated publication. No successful new production backup,
restore test, permission change, schema change or GitHub push is claimed.
The existing retention/export/scheduling behavior is unchanged.
