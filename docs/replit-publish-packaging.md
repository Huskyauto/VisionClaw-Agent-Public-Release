# Replit publish-only packaging

The native publish on November 18, 2026 compiled successfully but failed because
the **total image layers exceeded 8 GiB**. A local build, schema comparison or
workspace estimate cannot prove that the final provider image fits.

## Publishing entry point

The Replit publishing build command is:

```sh
env VISIONCLAW_PUBLISH_SNAPSHOT=1 NODE_ENV=production npm run build:publish
```

This is for Replit's **isolated build snapshot**, not the working project.
Do not run the publishing command as a working-project cleanup command.

1. `--check` requires publisher opt-in and a valid managed project ID.
   It reuses `PRIMARY_REPL_ID` in the existing `scripts/run-primary-only.sh`:
   cleanup is refused when running in that original project. A publishing copy
   is allowed to have a different project ID. A live editor, a serving
   production runtime, missing/invalid configuration or symlinked configuration
   also vetoes cleanup. There is no generated binding file or preparation step.
2. The ordinary build runs with `--release-check`: it neither exports development
   database rows nor retains a previous development-data snapshot.
3. Only after successful compilation does `--apply` remove the fixed,
   development-only exclusions from the disposable publish snapshot. It also
   removes uploaded source assets except the five fixed runtime exceptions
   already documented in `.replitignore`.

The cleanup keeps all of `node_modules`, installed tools, source, runtime
bundles, customer uploads, ordinary project assets and retained data indexes.
It explicitly checks the compiled server, verifier/TypeScript files, Copilot
worker, Legion binaries, a runtime dependency and the five fixed assets before
and after pruning. Symlinked ancestors are refused before any deletion.

The omitted copies are generated artifacts, saved-version metadata, mirror
staging, named development-session/testing folders, workspace-only company
deliverable exports, package-download/Nix caches, retrospective delivery staging
and private alert logs. Their exact allowlist is in
`scripts/prepare-publish-snapshot.cjs`. The working-project originals, Drive
files, production database and queued work are not deleted.

## Size and context failures stop publishing

The retained workspace has a **6 GiB admission budget**, leaving at least 2 GiB
for platform layers relative to the 8 GiB provider limit. The size check counts
apparent file bytes without following symlinks. This is not a measurement of
Nix/base layers and does not guarantee the final image fits.

The first retry stopped because the guard mistook inherited development
settings for workspace identity. The next retry rejected a source-valid
record through a project-ID equality requirement. The requirement was backwards:
the publishing copy must not be forced to retain the original workspace ID.
The corrected guard refuses the known original project, using the existing
primary-project setting. Boot/mount/inode machinery and the custom binding file
have been removed. Original-project refusal survives ordinary restarts and file
restoration without preparing new state.
This protection and the documented isolated-build contract are not cryptographic
proof of the publisher's entire filesystem or final image.

## Verification without touching original files

```sh
node --test tests/deployment/publish-snapshot.test.cjs
node scripts/prepare-publish-snapshot.cjs --estimate
```

`--estimate` is read-only and may run in the working project. Tests run the real
npm entry point in temporary project copies, with a simulated absent editor,
inherited editor variables and a different build project ID. They test
original/copy preservation, malformed/missing original-project configuration,
runtime retention, symlink safety, I/O failures and oversize rejection.

The actual original project must refuse cleanup even with no editor signal.
A successful native publish remains the final image-size verification;
no automatic retry is performed.

## November 18 republish preparation

The existing VM target, publish-snapshot build command and production start
command remain unchanged. The six existing laptop flags are staged in the
production environment for the next owner-requested publish; owner-only access
is retained. Development and production database schemas currently match, with
no pending destructive or other schema statements, and the database portability
preflight passed.

All 17 publish-snapshot tests passed. A read-only size estimate projected
6,012,617,928 retained bytes (about 5.60 GiB), below the 6 GiB workspace budget;
the approximately 38.1 GiB working project was not cleaned or reduced.
This estimate is not the final provider image and does not establish that all
native layers will fit under 8 GiB. GitHub pushes remain on hold. The subsequently
supplied Surface package v1.3 reports startup/watchdog GPU alignment completed
on the node; a fully unattended cold reboot of that updated chain remains
unverified. Fresh post-development-restart catalog and known-answer checks
passed with both Spark's reference and the application's normal request shape.
This does not certify production identity persistence or production laptop use.

The complete production release-check build also passed with a bounded
1.5 GiB Node heap. It staged the compiled server, client, private-network binary,
verifier and scheduled-worker bundles; no development-data snapshot was retained.
The existing CommonJS/import-meta bundler warnings remain warnings, not a claim
of full-program type-check clearance or production-runtime verification.
The development homepage rendered after preparation. No native publish,
production restart, schema change or GitHub push was initiated.
