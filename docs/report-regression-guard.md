# Offline customer-report regression guard

Approved outcome: protect customer reports before making further low-cost,
customer-facing improvements. No advertising, new subscriptions, model calls,
outreach, application publication or GitHub pushes are authorized by this work.

## Design boundaries

1. Cost: three fictional businesses × one retained-format response × one
   production acceptance pass = zero inference/API charges. Tests are bounded
   and sequential; no server, database or customer data is required.
2. State: source-controlled synthetic fixtures only. Results go to stdout;
   no runtime state, customer records or production filesystem writes.
3. Failure: invalid accepted content, changed facts/numbers/citations/headings,
   or mutated inputs fail the check. Advisory wording changes require review,
   not a claim that the new wording is necessarily wrong.
4. Identity: compare each stable fixture ID and report kind with its independently
   supplied expected response; never regenerate the expected response through
   the implementation under test.
5. Scope: local engineering check only, with bounded fixtures. No new tenant
   route, table, tool, credential or permission.
6. Stop: omit the engineering command to disable it locally; CI failure is
   visible. This is not a new production delivery gate or autonomous loop.
7. Authority: developers may propose changes; the owner/reviewer decides whether
   changed business advice is intended. A passing guard cannot approve its own
   fixture changes, deployment, customer communication or paid action.
8. Capability: no added autonomy or model access. Mutation tests prove detection
   of changed outputs; fixture coverage is not broad model-quality or production
   verification.

## Acceptance

- Exercise real compilation acceptance and written/narrated projection paths.
- Cover retail, professional services and catering, across the three report kinds.
- Detect changed figures, removed/reordered sections, lost sources and unknowns.
- Flag changed recommendations separately from deterministic regressions.
- Never mutate the retained response or evidence.
- Include a deliberate mutation check so a vacuous comparator cannot pass.
- Provide one documented command and include it in ordinary CI.

Implementation and observed verification results are recorded below when ready.

## Run

```sh
npm run check:reports
```

This runs the offline production-path replays and deliberate mutation tests.
The same command is part of CI, and the test file is included in the existing
suite. It checks three industries across both legacy and reference-format
synthesis responses. The fixed expected headings and titles do not come from
the production values being tested.

The isolated test process denies fetch and Node TCP connections before its first
dynamic production import. A negative test proves both denials. This blocks
ordinary provider/database network transports; it is not an operating-system
sandbox or certification of every possible transitive side effect.

Figures, source quotations, citations, headings, source identities and disclosed
unknowns are protected. Whitespace is normalized. Changed advisory prose or
narration is classified as requiring review rather than a proven factual
regression; the golden-fixture test still fails until that change is reviewed.
Updating a fixture is a source change requiring review, not automatic acceptance.

The fixtures are hand-authored synthetic provider-shaped responses, deliberately
large enough to exercise the real complete-report limits. They are not retained
customer data, independently evaluated prose, or a model-performance benchmark.
The guard does not rerun a provider, generate audio, render PDFs, send emails,
upload files or grant permission to publish.

## Next-action writing improvement

New compilation requests now ask for one labeled first-action brief inside the
first section's first recommendation. It names a proposed workflow, responsible
role, human decision boundary, reversible first step and measurement. Unknown
ownership or economics must remain unknown. The initial pilot should favor
existing tools and no paid advertising; growth advice should identify realistic
permissioned relationships, referrals or suitable directories without inventing
leads or permission to contact them.

This is guidance for new author/synthesis requests in both response contracts,
not a new factual certificate or a hard paid-output rejection/retry rule.
Historical responses, section schemas and existing approval/spend controls are
unchanged. Prompt checks do not establish that a live model or paying customer
has accepted the new brief; that remains unverified.

## Verification boundary

The initial local guard passed all six checks, including deliberate changes to
numeric advice, missing evidence/sections, reversed recommendations and a
production-title mutation. A seventh check covers first-action guidance across
all report kinds, author/synthesis seats and both response contracts.
Related compilation-format, report-stability and evidence-writing checks were
also run. No paid model call, advertising purchase, outreach or publish occurred.
The production template bundled successfully. Whole-app semantic TypeScript,
remote CI execution and a newly generated live customer report are not claimed.

Independent review found no scoped blocker. Its isolation observation led to
the pre-import fetch/TCP denial above; the public-mirror observation led to an
explicit exported-test marker check in CI. The full PDF/written-layout boundary
remains outside this guard.
