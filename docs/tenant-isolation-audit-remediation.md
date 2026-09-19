# Tenant-isolation audit remediation

## Current bounded slice

This record covers the two confirmed gaps selected for the first remediation
slice: agent-run mutations and auto-memorize. It does not suppress or
reclassify unrelated audit findings.

### Fixed: agent-run mutation APIs

**Evidence:** Reads already scoped `agent_runs` by both run ID and tenant ID,
while the state-changing helpers accepted only a run ID. A caller that held a
run ID from another tenant could therefore target that row.

**Disposition:** Fixed. Every mutation helper now requires a trusted tenant ID
and binds it with the run ID in its database predicate. The post-completion
read used for episode distillation is bound by the same pair. Verified callers
carry tenant identity from their executor parameters or from a
database-joined, tenant-scoped approval row.

**Regression coverage:** The tenant-boundary test requires the tenant argument
on every mutation helper and verifies the paired run/tenant predicate is
present for all writes and the follow-up read.

### Fixed: auto-memorize cross-tenant content sweep

**Evidence:** The worker previously selected message content from every tenant,
then partitioned it in process. Its shared watermark also ignored tenant ID and
created new watermark rows for tenant 1.

**Disposition:** Fixed. Normal callers use a tenant-bound entry point. The
manual tool refuses missing or invalid dispatcher-provided tenant context and
can only process that tenant. The heartbeat owns the private platform-worker
sweep: it discovers tenant IDs without selecting content, then performs one
tenant-scoped message query and synthesis at a time.
Watermarks are now per tenant and advance only after that tenant's complete,
durable synthesis. Message pages are bounded to fit the synthesis transcript;
sparse pages remain eligible for a later run instead of being silently skipped.
A forced memory-queue flush must succeed before a watermark advances.

**Auditability:** There is no exported cross-tenant auto-memorize API. The
interactive tool calls only the tenant-bound entry point, and the heartbeat
contains the private worker sweep. The shared in-process mutex prevents a
concurrent manual request from overlapping a platform sweep.

**Regression coverage:** The tenant-boundary test rejects the old global
content-read shape, requires tenant predicates before message content is
returned, requires tenant-scoped watermarks, and verifies the interactive tool
does not invoke the platform-worker function.

### Fixed: approval-resume audit consistency

**Disposition:** An approval claim now appends its audit step in the same
tenant-scoped update. A process interruption after the claim leaves a durable
marker that is terminally recovered, rather than silently stranding a running
agent task.

## Explicitly open

- The tenant-isolation audit continues to fail closed for unresolved findings.
  No blanket suppression or success-code change was added.
- Embedding backfill paths remain outside this bounded slice and require a
  separate caller-and-authorization review before changes are made.
- The remaining current audit findings require individual evidence-backed
  dispositions; a partial audit run is not evidence that they are resolved.
- The current mutex is process-local. A database-backed tenant claim/lease is
  deferred follow-up hardening for multi-process deployments; the current
  cursor and durable-flush ordering still prevent tenant crossover and skipped
  prompt tails.

## Validation

- Focused tenant-boundary regressions and existing tenant-scope checks pass.
- Type checking, the production build, and the full 232-suite regression run pass.
- Agent wiring audit is clean (one pre-existing warn-only orphan table).
- Two final independent architect/silent-failure reviews found no remaining
  CRITICAL, HIGH, or MEDIUM issue in this bounded slice.