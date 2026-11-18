# Tenant-audit continuation — November 16, 2026

## Verdict and evidence boundary

This is a **scoped source-current triage and repair**, not an authoritative
completed whole-repository audit and not a finding that 464 data leaks occurred.
The supplied plan is retained in `.local/tasks/task-258.md`; the November 16
targeted fixes and production/RLS limits in `replit.md` remain applicable.
No production code, database, flags, grants or Drive permissions were changed.
No new dump/backup system, claims-log feature or dependency upgrade was built.

Original evidence remains byte-for-byte unchanged:

- `data/tenant-isolation-audit/degraded-latest.json`
- SHA-256: `8331680124a64468bdb069e55a565b765c24d067a37c755c520f2ed064d712c5`
- Generated `2026-11-16T03:12:10.672Z`; original source evidence identity:
  `e30ba18d03697419f7b973d35184d3f5e746c202ca43e2a72451c6095b4e773b`.
- Raw findings: 518 = 17 CRITICAL + **464 HIGH** + 34 MEDIUM + 3 LOW.
- The 464 HIGH records refer to 438 distinct file/line pairs. Distinct sites
  are not necessarily distinct vulnerabilities.
- Existing HIGH dispositions: **353 kept, 104 allowlist false positives,
  7 precision false positives**. These are saved historical dispositions,
  **not newly verified conclusions**. “464 remaining confirmed HIGH leaks”
  misstates both their evidentiary status and the snapshot's own accounting.
- Saved first-pass coverage is 868/868 files, 353/353 chunks, zero failed or
  pending chunks; nevertheless `degraded: true`. Do not describe this snapshot
  as a first-pass coverage failure. It does not establish current-source
  completion, completed precision review, or security clearance.

No findings, severity, suppressions, deferrals, completed report, checkpoints
or native dispositions were rewritten. Source/parser/prompt changes invalidate
reuse according to the existing source-bound audit contract; no live model audit
was run to manufacture a green result.

## Confirmed findings and bounded repairs

### 1. Existing Drive backups have public-writer access

**Confirmed remote confidentiality/integrity exposure**, not just an omitted SQL
predicate. Read-only Drive metadata/permission inspection found inherited
`anyone:writer` access on both a current `visionclaw-backup-…json` full-system
copy and `__admin-memory-backup-…json` all-tenant memory copies. No backup
contents were opened, downloaded or placed in this report.

The name search also matched unrelated items. The inspected first page contained
460 items with successful permission responses, of which 458 had an active
`anyone:writer` grant. **Those are search-result counts, not counts of exposed
backup files.** A continuation token remained; neither exhaustive inventory nor
historical access/alteration is established. Permission API results establish
effective exposure, not evidence that an unauthorized person used it.

The application entry points are intentionally privileged:

- `server/routes.ts`: local `requireAdmin` is an alias of
  `requirePlatformAdmin`. `/api/backup/cloud`, `/api/backup/full`,
  `/api/backup/status` and `/api/export` invoke that gate.
- `server/routes/memory.ts`: `/api/memory/backup` separately invokes
  `requirePlatformAdmin`. The per-tenant backup-to-drive endpoint is different.
- `server/auth.ts`: platform admin requires both owner tenant and admin
  authorization. A tenant number alone is not the platform-admin gate.
- `server/heartbeat.ts` invokes the full/memory backups as internal scheduled
  work. `scripts/nightly-memory-backup.ts` is the separate existing all-tenant
  nightly memory exporter.
- `storage.getAllDataForExport` deliberately exports across tenants; provider
  keys are redacted and memory/knowledge use safe column projections. This is
  still confidential content (conversations, messages and facts), not a
  “sanitized therefore public” export. It is not a full database dump or proof
  of complete disaster-recovery coverage.

The defect was in storage confidentiality: `share:false` prevents adding a
new grant but does not remove or verify inherited grants. Legacy
`server/backup.ts` selected folders by name without proving the parent/access
set. Nightly uploads could inherit the configured workspace root's access.

**Local repair:**

- Existing legacy and nightly upload paths now prove the complete paginated
  effective permission set is owner-only. Public, domain, group, additional
  reader/editor, malformed, unreadable and non-owner inherited grants deny.
- Backup folder discovery is constrained to the specified parent, or direct
  My Drive root. Ambiguous/incomplete lookup denies. Created folders explicitly
  ignore domain default visibility. No existing grant is silently changed.
- Legacy backups check destinations before exporting; every backup checks the
  actual destination again before transmitting bytes and verifies the resulting
  file before claiming success. Creation/upload ignores domain default visibility.
- Nightly memory upload uses the existing upload stack's internal
  `confidentialBackup` option with a separate owner-only direct-root folder,
  explicit `share:false` and owner tenant. Project destinations, public sharing
  and generated-artifact recovery are refused for this mode.
- Nightly retention no longer calls the tenant-facing deletion API without
  tenant authority. Its internal fixed DELETE requires owner-only permission
  checks and freshly matching file ID, exact name, age and backup-folder parent;
  a stale or foreign candidate fails without deletion. Generic tenant deletion
  continues to refuse admin aggregates.
- Post-upload verification failure is **uncertain completion**, retaining the
  known file ID where the existing result contract supports it, never a clean
  success or permission to repeat the upload blindly. Retention does not run on
  a failed confidential upload.
- New legacy filenames carry the admin prefix. Both central Drive authorization
  and the generic tool's list/download/delete/share marker checks also reserve
  historical full-system/memory-snapshot names. This is defense in depth, not
  a substitute for remote permission repair.

**Not contained remotely:** no existing file was deleted, moved or re-shared.
Permission repair was explicitly offered for approval; no approval was received
at this report's verification point. No publication was performed. Old deployed
upload code may continue producing exposed copies until separately contained.
Metadata checks cannot prevent an external owner from changing permissions later
and are not an atomic provider-side ACL lock.

A single urgent notice was accepted by Gmail for the owner. Provider acceptance
is not verified Inbox receipt. The task chat also reports the risk directly.

### 2. Five admin create paths trusted body authority

Original raw array indices **257–261** (zero-based), reported in
`server/routes/crews-flows.ts` at 39, 93, 115, 169 and 190:
create crew, add crew agent/task, create flow, add flow step.

Actual route execution with synthetic collaborators reproduced body `tenantId`
overriding trusted tenant 1; parent IDs could similarly override the URL parent.
All five routes already call `requirePlatformAdmin`; therefore this pass
**does not establish a customer-reachable exploit**. It establishes an admin-side
authority-binding weakness. Object construction now stamps trusted tenant and
route parent last. Offline route tests cover all five, including non-admin denial.
No broader claim about crew-engine foreign references or PATCH allowlists follows.

### 3. The audit's schema evidence reader could misclassify columns

`scripts/lib/tenant-audit-schema-index.ts` formerly scanned a 4,000-character
prefix and matched comment text. A fixture reproduced a nonexistent tenant column
being reported as present; a wide definition could hide a real later column.

It now parses actual `pgTable` column constructor arguments using the already
installed TypeScript compiler API. Malformed, empty, duplicate or unsupported
definitions fail explicitly rather than silently claiming an empty/false schema.
Fluent column methods are supported; comments/default strings/index callbacks
are not columns. Production audit bundling includes the compiler implementation,
which is otherwise a development dependency. No package was added or upgraded.

The first-pass prompt no longer asserts nonexistent universal NOT NULL/no-default
columns or the absence of all RLS. The precision prompt now explicitly refuses to
treat “no tenant column” as proof of safe foreign IDs: every relevant parent and
authenticated caller gate still requires evidence. Unknown paths remain KEEP.

## Schema/caller triage — do not convert these into table suppressions

| Allegation family | Current evidence | Conclusion and limit |
| --- | --- | --- |
| `personas` missing tenant column/ownership | Actual shared `personas` declaration has no tenant column. Raw HIGH text names `personas` in 41 records, some involving multiple tables. | A nonexistent persona tenant predicate is not a repair. This does not clear other tables or authorization in the same finding. Shared persona selection is different from confidential per-tenant history. |
| `skills` missing tenant column | Shared `skills` has no tenant column. Raw text names it in seven HIGH records, including mixed-table findings. | The missing `skills.tenant_id` premise is false. Shared-skill mutation still needs its own privileged gate; do not clear every skill-related operation. |
| `heartbeat_logs` missing tenant column | Actual declaration has no tenant column; pace is platform-wide by design. Raw HIGH text names it in 11 records. | A direct tenant predicate is not possible. Task-linked privacy, public aggregates and global control-plane visibility are separate questions. |
| `mcp_servers` | Raw index 152. Shared table has no tenant column; every MCP server control-plane route in `server/routes/mcp.ts` invokes `requirePlatformAdmin`. | The specified missing-tenant allegation is a source-verified global control-plane false premise, not customer disclosure. Endpoint/network safety remains separately enforced. |
| Project child tables | `project_notes`, `project_files`, `project_conversations` have parent FKs but no tenant column. Raw text mentions them in 26, 31 and 16 HIGH records respectively; groups overlap. | Missing-child-column claims are false premises; child/parent foreign IDs are **not automatically safe**. Multi-parent conversation links must verify both project and conversation. The earlier November 16 mutation-time repairs remain scoped evidence, not clearance of every insert. |
| `outreach_sequence_steps` | Four HIGH records (indices 26–29). Child table has `sequence_id`, not tenant_id; step creation derives sequence ID from the just-created tenant-stamped sequence. | Omitted tenant column alone is not a flaw. Enrollment/sequence relationship safety and reply-pausing races remain separate; no delivery was executed. |
| Platform conversation lookup | Index 189, `getConversationForPlatformAdmin` checks `isPlatformAdmin(req)` inside the lookup boundary. | Explicitly authorized cross-tenant operator access, not an ordinary customer lookup. |
| Heartbeat operator reads | Indices 268–270; both logs and status routes invoke `requirePlatformAdmin` before `ALL_TENANTS`. | Intentional operator view, not demonstrated customer data exposure. |
| Operator metrics | Indices 278–281; `/metrics` fails closed without the configured bearer token and compares it in constant time before DB imports/queries. | Separate operator credential boundary; not an anonymous endpoint just because it omits session auth. Token configuration and access history were not inspected. |
| MCP key authentication bootstrap | Index 117; key generation uses random prefix and secret; verification hashes the full presented key, rejects revoked/invalid credentials and derives tenant from the matched authenticated row. Index 118's identified issuer route supplies session-derived tenant. | Tenant discovery during authentication is not authorization from an arbitrary tenant parameter. This does not certify every key issuer or every MCP tool. |
| DFY token intake | Index 59; `crypto.randomBytes` creates the 48-hex-character token; lookup requires that exact full token format/value. | Intentional bearer capability for intake, not an ordinary session-tenant lookup. Token possession is authority; it is not evidence of a leak by itself. |
| WhatsApp namespace storage | Shared table has key/value rather than a tenant column. | Missing-column allegations 463–465 do not establish credential disclosure. Namespace construction, trusted tenant ingress and deletion callers still require complete path evidence; not cleared here. |

The above counts are textual inventory aids, **not additive verdict totals**.
No automatic classification or new suppression entries were installed.
Other unproven paths—including worker/recovery IDs, foreign provenance edges,
optional tenant parameters, delivery recipients and mixed-table joins—remain
allegations pending their own exact caller/consumer evidence. In particular,
“internal-looking” and “the ID was just read” do not alone close them.

Existing task **119** owns memory-stat leakage; existing task **120** owns the
three legacy default-admin traps. This continuation references those boundaries
and does not duplicate their implementations or create replacement tasks.

## Verification

- Offline red→green reproduction: effective backup ACLs; schema comment/width
  confusion; all five admin create authority overrides; historical backup names.
- 104 targeted regressions passed, including actual extracted route/upload
  functions, paginated ACL failure, post-upload uncertainty, legacy pre-export
  refusal, nightly plain-Node bundle, tenant Drive access, prior targeted tenant
  repairs, source-bound audit checkpoints and unchanged suppression contracts.
- Application TypeScript and an expanded check including touched scripts/tests
  passed with a 3-GiB heap cap. The expanded check caught and drove correction
  of the nightly retention API mismatch. All 26 affected checks passed again
  after that correction; the unaffected portion of the 104-check run remains
  valid.
- The auditor's plain-Node bundle compiled in memory with TypeScript bundled
  and no external compiler dependency. Stale-string checks passed.
- The configured application workflow was restarted once. Its standby guard
  deliberately exited without starting the application or schedulers in this
  task fork. Screenshot capture therefore received connection refused.
  Runtime startup/visual verification is **not established**; the guard was
  not bypassed and production log traffic is not evidence of this fork running.
- These tests use synthetic records/transports. They do not inspect customer
  backup contents, invoke paid models, start a real backup, prove remote runtime
  deployment, prove historical absence of access, or complete remaining source
  review. No browser journey changed or live sign-in test was needed.

The report deliberately retains both the live confidentiality risk and the
unresolved audit allegations. Neither the targeted fixes nor owner-only access
preparation is a reason to call the tenant audit green.
