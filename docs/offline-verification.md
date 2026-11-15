# Reusable offline verification

## Scope and design

Apply the useful pstack principle to existing infrastructure: deterministic,
bounded checks with observable results, not more model calls or agent swarms.

1. **Cost:** zero model/API calls are intended. One serial test worker, a
   three-minute wall-clock bound and an 8-MiB log cap reuse the release runner.
2. **State:** private local logs/reports are disposable development evidence,
   not production state. Losing them requires rerunning the check.
3. **Failure:** test failure, deadline, output overflow or missing tests cannot
   pass. Reports identify fixture-only coverage; they never authorize delivery.
4. **Retries:** explicit manual reruns only, each with its own evidence directory.
5. **Isolation:** allowlisted environment, synthetic constructor credentials,
   loopback port-1 database target and fresh HOME/config directories. No tenant,
   schema, permission or production setting changes.
6. **Stop/observe:** interrupt the command; the existing runner kills its process
   group. Exit code, bounded log and JSON report describe the result.
7. **Authority:** checks cannot publish, approve, repair or alter their evaluator.
   Existing owner and release-review boundaries remain unchanged.
8. **Delta:** no additional models, agents, concurrency or autonomous execution.
   Validate credential stripping in a real child and real BWB wrapper tests.

This is **credential isolation, not a network/filesystem sandbox**. Tests still
read the checkout and may access public networks or local files. Never use it to
run untrusted code or assume that fake credentials replace mocking transports.

## Commands

- `npm run verify:bwb` — fixed, reviewed weekly-video regression selection,
  including real ffprobe and the real wrapper with mocked paid/delivery services.
  It reuses `scripts/project-confirmation.ts --profile bwb`, rather than a
  second runner. Extra arguments are rejected. Missing fixtures/binaries are
  failures, not skipped verification.
- `npm run release:check -- --base <commit SHA>` — existing full targeted release
  process. Weekly-video implementation paths now select the weekly checks;
  generic media-verification paths select their own checks. Regression steps
  use the same credential-isolated environment; build/preflight steps retain
  their existing requirements. The separately named payment lifecycle
  integration retains its existing development-database contract and is not
  relabeled offline.

Logs, manifest and JSON/Markdown confirmations are retained under
`generated-artifacts/run-confirmations/`; the command prints the location.
They survive scratch-HOME cleanup, bind declared source hashes before and after
the run and record test selection, time, process outcome and coverage limits.
Missing or changed declared inputs cannot confirm. Declared-source identity is
not a complete dependency graph or whole-repository clearance, and does not
establish live provider health or production success. Historical reports are
not automatically proof of the current checkout. The earlier standalone
development trial reports under `.local/offline-verification/` are superseded
by this existing source-bound confirmation format.
The standalone weekly check also requires a complete Node TAP summary: zero
failures, skips, cancellations or TODOs and a positive passing test count.
Exit zero without that evidence is not a pass. “Confirmed” applies only to the
offline scope printed in the report, never to publication or live delivery.

## Review

Scoped self-review covered environment inheritance, fixed argv/profile
admission, loader overrides, source-change detection, missing/partial test
evidence, private output paths and cleanup. No new server routes, storage reads,
provider transports or persona-facing capabilities were added. Auth, tenant,
spend, tool-policy, publication and production database controls are unchanged.
This is not an independent whole-platform security review.

## Verification — November 14, 2026

- Final `npm run verify:bwb`: **280 passed**, zero failures/skips; the native
  confirmation recorded matching before/after declared-source identities.
- **123 additional checks passed**, zero failures/skips, covering release scope,
  confirmation admission, actual child environment isolation, unknown arguments,
  incomplete TAP evidence, fixed-profile drift, runner deadlines/output limits,
  existing tenant-boundary regressions and generic delivery/finalization.
- Application plus touched tooling/test TypeScript passed with a 3-GiB heap.
- Stale-string preflight passed. The development application restarted, logged
  a healthy initial check and rendered its public landing page. Existing
  missing-optional-state/filter warnings and anonymous resource errors remain;
  this was not an authenticated browser journey or live video render.
- No dependency install, metered verification call, production setting change
  or publication was initiated. Normal application startup/background services
  remain separate from the credential-isolated fixture command.

## Operational use

Run this before a paid weekly run when weekly code changes. Read the result and
log rather than asking another model to reconstruct commands or interpret a
launch as success. Investigate failures; do not weaken checks or silently fall
back to inherited owner credentials. A failing fixture does not prove a provider
outage. Real delivery and inbox receipt still require separately authorized
live evidence.
