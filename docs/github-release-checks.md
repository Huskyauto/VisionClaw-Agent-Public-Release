# GitHub-hosted release checks

Purpose: run release regressions, TypeScript, preflights and builds on private
GitHub-hosted Linux runners rather than this 4 GB development VM. This is an
owner engineering command, not an application endpoint or autonomous approval.

## Authority and holds

The owner approved **test-only branch uploads** and made GitHub the permanent
default for portable pre-publishing verification. The existing
normal push hold remains in place. Never update `main`, open a PR, publish,
change Railway settings or refresh the public mirror as part of these commands.
Railway's source configuration was checked read-only: `VisionClaw-Agent` follows
`main`. Recheck deployment triggers if that configuration changes.

Only private `Huskyauto/VisionClaw-Agent` branches named
`release-checks/<64-character-source-digest>` are created. No ref is updated or
force-pushed. Existing candidate branches are not resubmitted automatically.
The already-registered `security-checks.yml` supports candidate-ref dispatch;
normal security checks retain their existing triggers and behavior.

## Run

### Permanent default

```sh
# Starts the exact candidate once, or authenticates an existing completed run.
npm run release:check
# Once GitHub finishes: reauthenticate its evidence, then inspect the LOCAL DB.
npm run publish:preflight
```

GitHub runs targeted regression shards, full TypeScript, publish-tooling
TypeScript, portable-install validation, both source preflights and the production
build. Relevant changes also require the existing disposable-database integration
lanes. Up to twelve existing check jobs run at once rather than waiting in
three four-job waves. Release runners pin browser-supported Ubuntu 24.04.

The default pre-publish command does **not** repeat those expensive checks
locally. It first rejects a nonportable lockfile with a short credential-free
local check, then requires fresh authenticated evidence for the exact current source,
including the portable-install and publish-tooling lanes, then performs the
bounded live development-database catalog inspection locally. Production/runtime
startup checks, environment parity, the Publish schema diff and the owner's final
Publish approval remain separate requirements. Before the live catalog runs,
the command also verifies the retained audit baseline, complete finding
accounting and exact-current-source independent acceptance. Missing or stale
acceptance cannot produce READY.

Selected tests retain their actual environment requirements: browser regressions
use a fixed installed Chromium cache despite the isolated temporary HOME, and
database-dependent regressions run in a separate conditional lane against
loopback-only disposable `visionclaw_test`. No development or production database
credentials are sent to GitHub, and moving a test to its proper lane does not
remove it from the required plan.

Submission returns exit code 2 while work is pending, without a polling loop or
automatic rerun. A source change requires its own candidate. Missing, stale,
failed, incomplete or setup-only evidence blocks pre-publishing; no heavy local
fallback happens silently. A mismatch against an older GitHub baseline or
unclassified changes blocks **before any source write** and needs scope review,
not a bypass or an unauthorized main update.

For a deliberate exception only, the former local commands remain available:

```sh
npm run release:check:local-fallback -- --base <explicit-reviewed-commit>
npm run publish:preflight:local-fallback
```

The regular `npm run check` and `npm run build` are still explicit development/
platform build tools, not steps to repeat after the equivalent current-candidate
GitHub checks pass. The publishing platform must still perform its actual build;
this setup does not substitute unverified GitHub binaries into a deployment.

An older private `main` does not require updating main to run current-app checks.
The ordinary flow compares complete, bounded Git trees, reviews/classifies the
entire delta and uploads the exact release inputs to an isolated branch. It is
not limited by the REST compare endpoint's 300-file response cap.

For testing the release infrastructure alone, the optional **code-only setup
proof** uploads an explicit release-tooling file list
(plus its existing helper dependencies and package lock), not unrelated pending
application changes, videos or customer artifacts:

```sh
npm run release:remote -- setup --allow-test-branch-upload
npm run release:remote -- setup-status --state <printed-setup-state-path>
```

This runs the new tooling tests, both TypeScript checks, portable-install validation,
both preflights and a production
build on GitHub. It proves the setup on that isolated branch; it does **not**
clear the complete local application or create an importable release report.
Use the full flow below only after the comparison base and full change scope
have been reviewed. Unclassified older changes block rather than disappear.

```sh
# Requires the owner's explicit test-only upload approval.
npm run release:remote -- upload --allow-test-branch-upload
# Copy the printed .local/remote-release/state-<digest>.json path.
npm run release:remote -- dispatch --state <printed-state-path>
# One bounded read; no polling or automatic retries.
npm run release:remote -- status --state <printed-state-path>
# After GitHub finishes, authenticate and import its evidence.
npm run release:remote -- collect --state <printed-state-path>
```

The explicit local fallback commands above remain available. A remote failure
never silently launches them.

## Isolation, limits and recovery

- Three deterministic regression shards and fixed typecheck, publish-typecheck,
  portable-install, surface-preflight, domain-preflight and build lanes. Payment/Muse changes add their real
  integration checks against disposable pgvector Postgres, not the owner DB.
- At most four matrix jobs run concurrently; each GitHub job has a 12-minute
  deadline. Commands and log sizes are bounded. No automatic reruns.
- Child checks receive allowlisted environments and invalid constructor keys,
  not production model, payment, OAuth or database credentials. This is credential
  isolation, not an OS/network sandbox; fixture tests must mock external effects.
- The local catalog child receives only required execution/locale paths and its
  development DB URL, not unrelated provider or GitHub credentials. Failed
  catalog logs remain bounded and private under `.local/prepublish/`; successful
  temporary logs are removed. No development/production DB secret goes to GitHub.
- Source inventory is capped at 15,000 files and 256 MiB, 10 MiB per file;
  aggregate upload payload at 12 MiB and each tree body at 4 MiB. Large text
  files are stored as immutable blobs before the tree; complete tree metadata
  reads are bounded at 8 MiB. Missing unstaged
  deletions must be staged first. Executable-mode changes are refused because
  the existing content-digest contract does not encode modes.
- The full exact source inventory is hashed locally; GitHub receives only its
  delta against private `main`. Private upload/backup/token namespaces and
  high-confidence credential markers in changed payloads are refused. Unchanged
  existing blobs are not re-uploaded or rejected for old fixture markers.
  Pattern checks are heuristic,
  not a guarantee against every possible secret or personal datum.
- Failed Git Data writes can leave unreachable blobs/trees/commits. An uncertain
  ref or dispatch response is never automatically retried. Inspect saved operator
  state and GitHub before attempting recovery. `recover --state <path>` uses GET
  requests only, verifies the deterministic branch's complete source bytes/modes,
  rebuilds its plan, and preserves any dispatch intent. It never resubmits.
  Source changes invalidate receipts.
- Runtime outputs with the exact dated weekly-video job/result/thumbnail naming
  contract are not release inputs or newly uploaded. They remain untouched
  locally. Brand rules, source fixtures, arbitrary JSON, other media/assets,
  deployment configuration and migrations remain source-bound.
- Collection always reauthenticates GitHub and checks the candidate's exact
  bytes and modes. An unchanged same-run report is reused byte-for-byte so
  merely checking status cannot invalidate independent acceptance. Altered
  stored receipts/logs block rather than being silently replaced.
- For a completed run—including failed checks or expired evidence—an operator
  can explicitly request one same-source renewal with
  `npm run release:remote -- renew --state <path>`.
  It journals intent before requesting the original workflow run's next
  attempt. Prior attempts cannot clear the pending renewal, and uncertain
  requests are never retried automatically. Code changes require a new candidate.
- Logs/artifacts are retained for one day. Import them while available. Archive
  paths, membership, sizes, log hashes and receipt provenance are checked before
  local report creation; no arbitrary ZIP extraction is performed.

## What passing means

Collection verifies private repository/workflow numeric identity, candidate SHA
and source digest, dispatch branch, completed successful run and exact attempt,
same-run artifact, every required successful job, and exact receipt/test
membership. Missing, failed, skipped, duplicated or stale required checks block.

The imported `.local/release-checks/run-*/report.json` has the existing automated
release-report shape. It is **not** independent review, audit clearance or
permission to deploy. Existing audit-baseline, finding-accounting, current-source
and independent-review gates still apply unchanged.

The workflow and test harness live in the owner-controlled candidate repository.
Authenticated receipts establish run/candidate provenance, **not** an immutable
external evaluator or proof that candidate-modified tests/harness are honest.
Review every harness/workflow/test change independently before release. These
receipts must not authorize autonomous promotion or replace that review.
