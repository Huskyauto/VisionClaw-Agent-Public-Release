# Owner Alert Logs

## What changes
The daily email stays brief. Before summarizing owner-only mail, the system saves
the complete original body and explicit diagnostic snapshots to PostgreSQL.
The owner can open **Admin → Alert Logs**, inspect all text, and download JSON.
This is read-only evidence, not a promise that a reported issue is confirmed or
resolved. There is no automatic repair, acknowledgement or deletion action.

## Private folder and republishing
`data/private-alert-logs/archive/<id>.json` is a private local copy. PostgreSQL is
authoritative and survives managed app republishing. A detail/download read
recreates a missing local copy, so no dependency on old deployment disk remains.
No files go into public uploads or Git. Owner authorization is checked on every
list, detail and download route. Client rendering also requires the current role.

If the DB cannot save, a private pending spool is retained where possible, the
email/digest warns that durable details are NOT confirmed, and bounded rotating
retries continue. Transient read/DB errors retain evidence; demonstrably invalid
records go to private quarantine and do not block later retries. A local-only
spool is not safe against republishing until recovery succeeds.

## Content and limitations
No 200/280-character truncation applies to archived detail. Known credential
formats are redacted before DB or local storage, including OAuth credentials,
Basic/Bearer headers, cookies, JWTs and credential URLs. Redaction is defense in
depth, not a license to expose confidential reports.

Tenant-isolation audit notifications attach full immutable Markdown and JSON
snapshots from the exact run. Other notifications retain their complete original
email; if a producer supplies only a path or external URL, it must additionally
provide `alertReports` to preserve that underlying report. Paths/URLs are not
arbitrarily fetched. Historical email previews cannot recreate lost details.

Limits: 8 MiB per compact record, 512 MiB or 10,000 DB records, 64 pending files.
No auto-purge; capacity failures remain explicit for owner review/export.

## Migration and rollback
Development migration: `migrations/0114_owner_alert_logs.sql` creates the isolated
table and tenant/date index. It does not mutate existing rows. For the managed
production database, Publish must apply schema parity before the new runtime.
No production DDL, publishing or historical alert backfill is performed here.
Rollback code can leave the archive table intact; never drop captured evidence
as a routine rollback. Existing owner digest cadence and customer delivery remain
unchanged.
