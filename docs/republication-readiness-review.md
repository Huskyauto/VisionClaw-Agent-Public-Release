# Republication readiness review — November 6, 2026

## Decision and scope

The reviewed corrective change set is ready for a controlled republication.
Independent review found no remaining confirmed P1/P2 release blocker in these
surfaces, subject to the final production build and publish preflight. Both
subsequently passed. Publication itself has not been performed.

This is not whole-platform security certification. The asynchronous tenant audit
has incomplete, source-changing coverage; neither its raw severe counts nor the
zero-finding dependency audit constitute complete tenant-security evidence.
Do not suppress the audit, waive its findings, or report its unfinished coverage
as green.

## Confirmed corrections

| Boundary | Correction | Evidence |
|---|---|---|
| Insight application/recovery | Require a positive explicit tenant for application, deduplication and routing recovery. Only the private system heartbeat enumerates the global tenant registry, invoking each tenant separately. | Invalid-scope/no-write regression; real Postgres two-tenant isolation test. |
| Predictive research | Join programs to experiments by both identity and tenant. | Source review and publishing typecheck. |
| Channel reads/writes | Match joined channels to message tenants; verify thread ownership by tenant/channel and event ownership by tenant before writing. Refuse foreign-tenant subscription conflicts. | Public-function branch/guard/SQL regression tests. |
| Research evidence | Validate tenant and project ownership before storing research content. | Foreign-project/no-insert regression. |
| Outreach | Bind competitor and sequence joins, enrollment lookups, reply updates and correlated enrollment counts to tenant. | Source review and existing provenance/query regressions. |
| Adaptive memory | Reject missing/invalid tenant before saving a lesson. | Invalid-scope/no-write and valid-scope regression. |
| Conversation forks | Supply the tenant required by message storage when copying messages. | Populated-copy and foreign-source-denial regression. |
| Agent runs | Validate tenant and parent-run ownership before creating a child. | Foreign-parent/no-insert and invalid-tenant regressions. |
| Wakes/task forces | Check optional conversation/project references against the acting tenant before insertion. | Foreign-reference/no-insert regressions. |
| Captured project assets | Prove both conversation and derived-project ownership before content parsing or filesystem/DB writes; scope backfill message reads. | Foreign-project/no-parsing regression and source review. |
| Global provider health | Require platform administrator before monitoring imports or probes. Independently gate frontend requests, manual refresh and cached privileged rendering by current owner role. | Both-route denial-before-import and frontend role/cache-visibility regressions. |

The old implicit global insight API was called by trusted system maintenance,
not a demonstrated untrusted external path. Its removal closes an ambiguous
library contract; it is not evidence of a confirmed externally exploited
critical vulnerability. The fork defect was a functional failure, while the
provider-health boundary and optional-reference guards were access-policy or
defense-in-depth gaps.

## Reviewed false-positive and intentional-global families

| Scanner claim | Verified contract and disposition |
|---|---|
| Add tenant predicates to persona reads/IDs | `shared/schema.ts` defines `personas` as a global roster with no tenant column. This applies to activity personality caches, desks, evaluation, decision engines, task-force rosters and API persona selection. Do not invent a tenant column. |
| Add tenant predicate to heartbeat logs | `heartbeat_logs` is global and has no tenant column; agent-manager queries correlate logs through globally unique, tenant-filtered heartbeat-task IDs. |
| Add tenant columns to project child inserts | `project_files`, `project_notes` and `project_conversations` are parent-owned tables without tenant columns. Check ownership through `projects`; automatic capture now additionally verifies its derived project. |
| Add tenant column to outreach sequence steps | Steps are parent-owned through a sequence and have no tenant column. Preserve tenant checks on sequences/enrollments instead. |
| Block global A/B, approval-expiry, wake, resume or department-budget sweeps | These are internal system maintenance. Reviewed callers are heartbeat/background workers; each result's tenant scopes subsequent mutations/events. They are not tenant-request list endpoints. |
| Tenant-filter the aggregate AI spend sum | The cap and its serialization lock are deliberately platform-wide. Adding a tenant filter would weaken the aggregate budget ceiling. |
| Add caller tenant to credential/session discovery | Key hashes and session tokens establish tenant identity before it is known. Exact-token lookup/revocation and global expiry/startup cleanup are intentional auth control-plane operations. |
| Tenant-filter provider-key storage | Provider keys are global. The actual gap was monitor access policy, now platform-admin gated. |
| Treat every internal ledger/reference parameter as an external bypass | Reviewed cost-ledger, step-reward and repo-surgeon callers derive tenant/incident identity from guarded execution, claimed plans or tenant-stamped incident creation. Keep these caller contracts under review; the helper signature alone is not proof of an exposed attack path. |

Independent reviews inspected the relevant caller/helper/schema boundaries.
These dispositions apply to those exact claims, not every future finding in
the same file.

## Verification receipts

- `generated-artifacts/project-health/republication-regressions.log`:
  **51 tests passed**, including 13 new regressions observed failing before their
  fixes. Offline runs used dummy provider credentials.
- `generated-artifacts/project-health/republication-db-isolation.log`:
  real development Postgres test passed. Two temporary tenants and their
  low-priority insights existed only inside one rolled-back transaction; the
  authorized tenant changed while the other did not. No provider generation or
  committed customer fixtures.
- `generated-artifacts/project-health/republication-preflight.log`:
  typechecks and publishing preflight **passed**.
- `generated-artifacts/project-health/republication-build.log`:
  production build **passed**. Existing bundler warnings are not represented as
  zero warnings.
- Independent final review: **PASS for conditional republish of the reviewed
  change set**. Final build/preflight satisfied its remaining condition.
- No production migration, payment, customer communication, or application
  publication was performed for these checks.

## Reviewed source identities

SHA-256 values bind this review to the frozen corrective sources:

| File | SHA-256 |
|---|---|
| `server/agentic-engines.ts` | `e87af6d1425beed57d8cd0bf4868144e67de1cfc23962d6c6206f7fb6415d22a` |
| `server/heartbeat.ts` | `1b35a3ef3a65e83bc2bbb77193784e9714a0b4ed753d53d950abc3849b3450ac` |
| `server/agent-channels.ts` | `3b23aca04e79b9ea644a3ae7f45f3fd70ff29eed4c30e4f4dafd0de3e403659a` |
| `server/agentic-features.ts` | `5013e4989362250f32d6397e17506ce8c5f41b02b68422b168d8b337b0049716` |
| `server/adaptive-execution.ts` | `cf301afe51f6f83aa54b48f90aa14377c14b3b2bf589908f8cf7943e654c6b7d` |
| `server/agent-manager.ts` | `edc9ba6224590544fe5a48b91d8dade6248579be3d488139d55331b2fa0060ec` |
| `server/agentic/runs.ts` | `c3d4a9fc83a97255756b13b6f67dfacbfae353beb34aee9ea728bb280f35e108` |
| `server/agentic/wake-scheduler.ts` | `b86a5290b631f22cea24f826be4d0ea88d4288a41186f40905fafef4ebf60e64` |
| `server/agentic/task-forces.ts` | `36104f2e6f05dca48311dbf179134c8b2b6e2e91b56ac79bee12b2580db5f8f1` |
| `server/auto-asset-capture.ts` | `c4a32a1da8412d59f3e9cf99d8cd1bf62da1bc27b4ce4d0314ed6f0e269abace` |
| `server/routes/auth-extra.ts` | `a075568ecdf341c8ab5f74cb8fdc5796b163baaf538f7dfd0eff03d8c73215f3` |
| `client/src/pages/settings.tsx` | `3c2d47183e8d208aa73e2b2058daaed232d3d7bb885d6d58b59a0210bfa5983a` |
