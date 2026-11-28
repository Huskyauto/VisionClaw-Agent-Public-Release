# Spark Lenovo fallback — verification and review

## Package revision 1.3 — credential compatibility

This revision fixes the outbound worker's local rejection of Spark's opaque
credential surrogate. A bounded visible-ASCII check replaces the underlying-key
prefix assumption; injected bytes are preserved exactly. No server authentication,
scope, application-origin, redirect, model, recovery, polling or approval gate
was relaxed.

- The new opaque-credential regression failed against the old prefix check,
  then passed with the repair.
- The focused Node run passed all 7 checks across
  `tests/providers/spark-relay-worker.test.ts` and
  `tests/providers/spark-relay-api.test.ts`. This includes all 26 packaged Python
  tests and the real local Python-worker → Express → Ollama fixture.
- Six added Python tests cover opaque injection and persistence isolation,
  unsafe/header-injection inputs, destination restrictions, 401/403 rejection,
  HTTP 200 HTML schema rejection, and real loopback HTTP header serialization.
- Verification ran with a credential-scrubbed environment and synthetic inputs.
  No live provider, production database, publication or remote worker was used.
- Independent source review found no blocking security findings. The archive
  review passed structure, manifest/source parity and all 26 extracted-package
  Python tests. Two low-severity wording notes were corrected: the protocol
  now explicitly permits runtime-resolved surrogates, and this section identifies
  upload receipts as external to the ZIP. The parent rechecks archive integrity
  after those documentation-only changes; no test behavior changed.
- Upload receipts are retained separately from the ZIP. The addressed delivery
  note is placed alongside it in the shared folder; neither is a required
  package member or installation dependency.

Spark's actual surrogate substitution remains unverified by this package.
Spark reported an installed revision 1.2 worker and HTTP 200 HTML from the
production schema path. This revision is not publication or live failover
acceptance. Keep the minute schedule disabled until separately approved rollout,
authenticated protocol JSON and activation authorization.

The remaining sections record original implementation verification, not a
claim that the whole original test matrix was rerun for this package revision.

## Delivered build scope

Dedicated owner API, isolated durable queue, direct-first long-runbook routing,
restart-safe outbound Python worker, operator status/fixed probe/reconciliation,
and an installable owner handoff. No new chat tool, persona grant, paid provider,
table/column/index, node identity, normal GitHub push or publication.
The existing job-status CHECK requires a backward-compatible extension; see
the final startup finding below.

## Verification

- 87 focused Node tests passed, with no failures or skips.
- The Node pass includes 20 isolated Python recovery/HTTP tests and an additional
  supplied-worker → actual Express API → local Ollama HTTP fixture.
- 20 opt-in PostgreSQL cases passed using a dedicated connection and a temporary
  `agent_jobs` table that shadows, and never modifies, the application table.
- Scoped TypeScript diagnostics passed for 29 changed application/tooling/UI files.
  This is not a claim of a full-project release check.
- Server and operator-panel bundles passed in memory. No publication was performed.
- No live provider inference was repeated for this build.

## Independent review dispositions

The initial independent review returned five findings. Fixes were checked with
focused fixtures and the scoped compiler; no second independent sign-off is claimed.

1. **Start/cancel race:** cancellation now shares the transaction lock. Start
   requires exactly one returned row from its conditional reservation update.
   Controlled cancellation and zero-row authorization fixtures passed.
2. **Chat-scoped authentication:** the real central auth policy now permits only
   anchored poll/start/result writes for chat keys. Read-only keys and lookalikes
   remain refused. Actual policy and supplied-worker HTTP fixtures passed.
3. **Physical admission across environments:** same-database reservations now
   exclude Lenovo inference globally, while job access remains environment
   scoped. Separate development/production databases cannot share those locks.
   Relay starts are production-only; arming the new flag also refuses development
   Lenovo generation. **Live activation remains blocked until both environments
   are armed, development is restarted, and its refusal is verified.** Do not
   enable production alone or run unmanaged Lenovo clients concurrently.
4. **Revocation during accounting:** final acceptance rechecks relay authorization
   after asynchronous accounting. The suspended-accounting revocation case passed.
5. **Duplicate accounting:** usage is recorded at result ingress, not again when
   a parent consumes a retained completion. The ledger uses a relay-job-specific
   idempotency key. Identical saved-result redelivery can repair accounting;
   it never regenerates content. Unconfirmed accounting returns a retryable
   result-delivery error and remains visibly unconfirmed.

Recovery metadata now includes response hash and possible-running state, matching
the worker’s recovery contract. The redundant direct catch/rethrow was removed.

## Final startup finding: existing database CHECK

The initial temporary fixture omitted a legacy CHECK installed by the original
job-table SQL, which was also missing from the Drizzle model. The real startup
check correctly refused native work before inference because the new reservation
status was rejected. The model now declares that CHECK explicitly with all six
legacy states plus the nine relay states. A narrow, idempotent development-only
migration atomically replaces and validates it with bounded lock/statement times.
Fixtures now start with the actual legacy CHECK and run that same migration.
No table, column, index, tenant policy or existing record was changed. No
production DDL is run by the migration command. Publish must show this CHECK
change in its schema review and production must verify it before relay activation.
The follow-up review of this newly discovered migration surface found a
literal-normalization issue in readiness checking. It now preserves quoted SQL
values; altered-literal repair and failed-validation rollback fixtures passed.
The real development constraint check reports ready and validated.

## Remaining operational acceptance

The completion review additionally caught a recovered-claim delivery failure
that could allow another poll to overwrite the saved result. Recovery now ends
the invocation independently of delivery success, for both claimed and starting
checkpoints. The accounting-503 fixture preserves the exact completion, refuses
another available job, and redelivers after restart without another inference.

The broad validation initially exposed an outdated route census and two existing
source guard failures. The census includes the eight added endpoints; file tools
now use the dependency-free canonical owner-identity leaf through the established
facade; optional video-root checks explicitly skip missing roots and report
unexpected errors. These changes do not expand tool authority or change owner identity.

Spark installation/schedule acknowledgment, the installed package hash, authorized
publication, both-environment flag checks, a production authenticated poll, and a
real relay probe are still required. Existing direct production receipts are not
evidence that this new relay is installed or active. Status is worker-reported
transport evidence, not independent physical hardware attestation.
