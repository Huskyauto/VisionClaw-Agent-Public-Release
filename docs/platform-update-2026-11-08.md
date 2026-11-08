# November reliability review and surface reconciliation

Source release: **R137.3**. Review date: **November 8, 2026**.

## What changed

- Both landing views, Latest Updates, dashboard release history, sidebar release
  badges, shared SEO, static HTML, PWA metadata and private/public README sources
  describe current features and the same measured development inventory.
- Retained features include webhook conversation continuity, read-only saved-run
  confirmation, bounded harness trials, full selected daily-upload coverage, PDF
  input ownership and payment-evidence safeguards.
- Recent reliability corrections cover tenant-scoped insights, channel writes,
  research references, agent-run ownership, Settings model selection, Memory
  navigation and platform-admin provider diagnostics.
- Owner-only Engineering Q&A provides 19 source-linked comparisons, searchable
  categories/verdicts and private notes. Notes grant no execution authority.
- The catalog has 428 registered tools, 386 publicly documented tools, 18 active
  personas, 68 platform skills, 146 capabilities, 197 declared / 278 live
  development tables, 889 platform indexes and 93 curated models.
  [Generated measurements](release-facts.json) are development evidence, not
  production telemetry or proof of provider availability.
- Wake scheduling now records its durable event and completed schedule in one
  atomic statement, preserving the existing event-bus dispatch hooks. A crash
  before commit leaves no partial handoff; committed events remain recoverable
  by the existing pending-event worker. Ambiguous legacy firing claims require
  review and are not automatically replayed. This does not guarantee exactly-once
  downstream messages or completed business outcomes.
- Unsupported absolute uptime and universal deliverable-quality promises were
  replaced with scoped descriptions. Private backup guidance now distinguishes
  standing owner authorization from temporary review holds.

## Verification and review boundaries

The review combines recent-change inspection, cross-cutting architecture and
sensitive-boundary review, deterministic regressions, build/type checks,
navigation/source checks and visual landing-page inspection. It is not a
line-by-line proof of every source file or a live test of every paid integration.
Verification receipts and dispositions are retained separately in the private
review record; only checks actually completed are reported as passed.

The initial focused security/tool-routing batch passed 152 tests with provider
credentials excluded from the test environment. Static metadata tests reproduced
stale declared/live table and index counts before correction. All 74 literal
sidebar links resolve to implemented application routes. Role-dependent access
remains separate from route existence.

The final focused surface/recent-change batch passed 85 tests, including five
new wake-handoff regressions. PostgreSQL EXPLAIN accepted both wake statements
without executing writes. Five separate plan-dedup database tests could not run
under the deliberately disconnected offline database configuration; that is an
explicit coverage limit, not five confirmed application defects or passing tests.

Main/publish typechecks, publishing database preflight and the production build
passed locally. The build retains existing bundler warnings. Both landing views
rendered the updated source release and counts; the development server restarted
successfully. Skill-manifest hashes now validate for all 61 on-disk skills, but
52 pending/missing semantic reviews remain unapproved. These on-disk operational
skills are not the same metric as the 68 platform/seeded skills in release facts.

## Production observations

A read-only investigation covered November 7–8, 2026, 21:06–21:06 UTC. The public
VM had an active successful build. The top-30 endpoint sample contained 4,623
requests, 11 client errors and one server error; several routes had elevated
latency. These are sampled observations, not aggregate uptime or a determined
latency root cause. Resource-metrics retrieval failed, so resource health is
unknown. Older aborted-request errors preceded the latest successful build.

The audit scheduler repeatedly reports incomplete coverage. That is an explicit
unresolved signal, not evidence of a new exploit or permission to suppress the
audit. The wider tenant audit remains degraded/incomplete. Tool-sprawl and
unmodeled-table warnings also remain advisory gaps, not newly introduced tools.

## Publication boundaries

Repository synchronization is not website publication. The private repository
retains tracked source; the public repository receives the existing sanitized
export, excluding private operational records and credentials. Neither Git
repository backs up database contents, secrets or ignored uploads. No payment,
customer message or application republish is authorized by this source review.
