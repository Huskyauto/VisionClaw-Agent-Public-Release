# Last-72-hour review — October 19, 2026

Status: source review and corrective work complete; GitHub finalization is
separate from production publication. No production publication was authorized.

## Frozen review basis

The requested outcome is a thorough review of the preceding 72 hours across the
app, current business/technical landing pages, sidebar/dashboard updates, and
pushes to both private and sanitized public GitHub repositories.

Baseline: c827969c256cc07a83b0d8bc786c43fe25e8cd3a.
Initial reviewed head: 2bfe67ce5. Initial range: 283 changed files, including
148 production/frontend/script files, plus tests, skills, contracts and
automation-owned generated audit state. Current-session surface edits are also
in scope. Generated audit artifacts are evidence to classify, not proof that a
current complete tenant-isolation audit passed.

Review axes: touched code and transitive callers; authentication and sessions;
tenant/file boundaries; guarded tools and approvals; payments/model spending;
SQL/imports; SSRF and hostile source content; delivery authority, durable retries
and deadlines; jobs/queues; specification and user-visible feature claims.

New website summary: R137+sec, October 19. Regenerated release-facts.json is the dated
development census. Previous release history stays intact. Pilot availability
is independently supported by the earlier focused live production test, not
inferred from source. No fresh production write test or paid provider probe is
necessary for this review.

Working-tree audit checkpoint/report files belong to the running tenant audit;
do not stage live checkpoints or fabricate full-coverage evidence. Preserve all
secrets/runtime state and private/public separation. Both GitHub pushes are
authorized by this request; website publication is not.

## Review coverage and limits

An independent source review, followed by main-agent correction and deterministic
checks, covered these changed feature paths and their transitive boundaries:

- Outcome aggregates, cost summaries, briefing evidence, guarded tool output,
  immutable delivery identity and customer PDF/text backchecks.
- Paid-stream pinning, provider quarantine/discounts, compiler reservations and
  retained responses, report jury ballots and job fences.
- Company package research, jailed retrieval/browser handoff, shared evidence,
  child reviews, PDF/audio finalization and durable worker checkpoints.
- Import persona/tenant remapping, embedding backfill, queue ownership,
  workload joins and bounded crew arrays.
- Private alert archival, pilot schemas/access, Built With Bob packaging in
  both renderers, modified operational skills and shared contracts.
- Business/technical landing views, sidebar owner gates, dashboard/changelog,
  HTML/React SEO, both READMEs, roadmap and mirror propagation.

This was path- and contract-level review, not line-by-line proof of every file.
Residual scope includes incidental styling, older unchanged behavior and live
production/provider/database journeys. Generated tenant-audit snapshots are
not independent certification. A separate nightly audit remained degraded at
808/811 files with one failed chunk; this review does not clear its findings or
establish current whole-repository tenant-isolation coverage.

## Findings and dispositions

### HIGH — private company package PDFs escaped dedicated owner access

Confirmed: storing a package in the owner tenant did not make it owner-only.
An otherwise restricted owner-tenant file API key could reach the generic file
list/download surface. This was a source-confirmed authorization gap, not
evidence of an unauthorized download or a cross-customer leak.

Closed in source: centralized reserved filename prefixes exclude company PDFs
and pilot archives from generic tenant list/read/delete predicates, agent file
reads and database recovery, and uploads before DB/static fallback. The package
producer shares the prefix constant. Dedicated owner package downloads retain
their separate authorization.

Verification: regression tests failed before the fix and passed afterward.
A development-only HTTP check minted disposable read-only keys for the owner
tenant and a different tenant. Both could not list/download full or teaser
packages, encoded upload names remained blocked, ordinary own files downloaded
with exact bytes, and cross-tenant ordinary reads failed. All disposable file,
key and tenant records were removed. Delete/recovery consumers are additionally
pinned by source/query-contract tests. No production records were changed.

Owner security notification was accepted by Gmail; provider acceptance is not
claimed as Inbox receipt. Production needs a separately authorized publish.

### MEDIUM — incomplete or stale public claims

Corrected optional-audio wording: these full report finalizers require audio.
Corrected private README falsely-current counts, current roadmap/fork/contributor
facts and static SEO; historical release records were not globally rewritten.
Company packaging is identified as owner-only. Per-heading MP3 preparation is
not advertised as a live feature; live finalizers create whole-report audio.

### MEDIUM — nominal offline verifier test could select a live provider

The broad suite exposed an invalid-tenant CoVe test reaching provider selection.
A bogus tenant is not a provider mock: the provider layer may bill the owner.
Invalid tenant scopes now return the fail-safe warning before model selection.
The regression requires unchanged output, no selected model and no questions.

### Supporting contract and operability corrections

- Treasury definitions are composed in the facade without cross-domain imports;
  registered tool identity/order is preserved.
- Previously empty fallback catches now use categorized, bounded-site telemetry.
  Expected malformed public sources/cleanup remain quiet and never become
  evidence; unexpected failures expose fixed, non-sensitive diagnostics.
- The route census was recomputed with its exact test regex against its prior
  source: 803→813 counted registrations, with the import route moved unchanged.
  Its inline count and ceiling ratcheted down from171 to170, not upward.
- The modified private audit SOP's reviewed integrity bytes/hash were refreshed.
- Local-only schema conversion was explicitly classified as non-processor;
  unknown production dependencies still fail the legal-processor gate.
- The outbound quality telemetry test recognizes the tenant-scoped degraded
  branch without removing its incident/signature assertions.
- Fourteen development persona tool documents were brought to the canonical
  composition, updating only tools_doc. Identity, soul, operating loops and
  customer records were not reseeded or overwritten.

## Verification receipts

The broad non-browser run completed:250 suites passed,7 failed. Each of those
seven failure groups was then corrected and passed its focused verification.
Focused release/privacy checks passed17/17. The final consolidated run passed
102/102 checks across17 targeted files, including all seven repaired groups and
the changed report/research/journey/deadline paths. Final TypeScript checking
and the production build both completed successfully. The full257-suite run
was not repeated after these focused repairs; its250 unrelated passing groups
are not presented as a second fresh full run.

The application restarted and served successfully; the public landing preview
rendered the current counts and R137+sec feature cards. An unauthenticated
session request and external-font warning are not described as new backend
failures. No new sign-in/payment UI journey was changed.

A bounded Layer1 diagnostic explicitly targeted the development domain, never
the production-default URL:17 public requests at concurrency1 and3, zero
observed errors. The high tier sampled no homepage requests, and the harness
does not measure authenticated chat, queue saturation or isolated DB latency.
This is a smoke diagnostic, not capacity certification or a full load-gate pass.
Its report was queued for the owner digest, not proven delivered to an Inbox.

## Repository finalization

Only explicitly selected, reviewed source/docs/tests are committed. Live
degraded audit reports/checkpoints remain unstaged. The private push uses normal
append-only history and verifies the remote tip. The public mirror must pass its
sanitizer and normal append-only push, followed by independent remote-content
verification. A one-shot runner is used; continuous Auto Git Push retains its
previous hold after this authorized operation.

GitHub synchronization is not website publication, production schema parity,
provider inference proof, capacity certification or proof of report delivery.
