# Evidence-first report writing

## Scope

Borrow PaperOrchestra's structured writing preparation inside the existing company
report author/synthesis and business-report compiler paths. Do not install its
framework, introduce agents, generate new research results, or auto-publish papers.

Module map: `company-compilation-content` builds and validates company report
messages; `business-report-review` builds the older compiler request;
`business-report-evidence` validates quotations; `company-evidence-reference`
inserts exact catalog excerpts. Their existing workers own spend, checkpoints,
tenant identity, approvals and delivery.

## Design gate

1. Cost: zero extra calls, searches, retries or workers. Deterministic preparation
   adds a bounded prompt payload, so existing whole-request admission still applies.
2. State: preparation is derived from the retained evidence in each request.
   No new persistence, database table or local-disk production state.
3. Failure: invalid source identity fails closed before interpreting citations.
   Advisory planning never certifies relevance, accuracy or completeness.
4. Identity: preserve original source IDs, bytes, provenance, capture times and
   existing receipt/catalog identities. Duplicate grouping does not merge evidence.
5. Tenants: pure per-request computation; no shared cache, queries or new routes.
6. Control: no new autonomous behavior or toggle. Existing report stop controls
   and request limits still apply; preparation is visible in compiler packets.
7. Authority: models propose text; existing validators check evidence, existing
   review handles corrections, and existing owner approval controls delivery.
8. Delta: no model/tool/agent/concurrency/permission increase. Test preparation,
   ambiguous citations, altered results, immutable inputs and real message wiring.

## Acceptance

- Authors and synthesizers receive an evidence-needs plan before drafting.
- Source register groups only exact same-kind, same-URL, same-text captures;
  all original source IDs remain available. Different captures are never equated.
- Duplicate/empty source identities cannot silently resolve to the last row.
- Fact quotations and measured values retain exact source binding.
- Models cannot use review scores as evidence, force citation quotas, turn
  illustrative graphics into measurements, or invent missing results.
- Failed candidates leave retained prior output unchanged and remain rejected;
  no silent fallback that claims required corrections were completed.
- No claim of improved model quality without a matched live comparison.

## Verification and limits

Verified locally November 14, 2026 (Chicago):

- 81 credential-isolated regressions passed across writing preparation,
  company compilation/format/correction/reference budgets, evidence projections
  and business-report review. No skips, cancellations or TODOs.
- After correcting the legacy compiler to derive preparation from complete
  retained evidence rather than its optional-text wire projection, all 19
  business-report review regressions passed again.
- Full application TypeScript and stale-string checks passed.
- All 18 development personas received the doctrine; wiring audit found no dead
  tools, persona drift, trusted-tool leaks, orphan skills or schema gaps. Existing
  tool-sprawl and undeclared-table warnings remain.
- Development application restarted and the public landing rendered. Startup
  still reports unrelated research-program canary/configuration warnings; this
  change does not clear those or the separate degraded tenant audit.
- Scoped parent review covered the changed pure helpers, compiler call sites,
  catalog/quotation boundaries, unchanged spend/retry/approval paths and tests.
  No independent reviewer agent or paid generation was run.

Plans are advisory preparation, not semantic claim verification. Numeric
rejection tests exercise the existing exact-quotation validator; chart guidance
does not constitute a new chart-data validator. Existing retained-output behavior
was verified, not replaced by a model-score acceptance rule. New source-identity
errors are deliberately not eligible model-correction reasons: a writer cannot
repair ambiguous input evidence by purchasing another attempt.

No new paid report, customer delivery, publication or production verification
was performed. Existing model calls receive additional bounded prompt context;
token cost and resulting prose quality have not been measured in a matched trial.
