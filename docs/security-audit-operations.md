# Bounded security audit operations

## Source-current recovery

See `docs/tenant-audit-convergence-repair.md` for the Fable-assisted diagnosis,
repair, verification and remaining acceptance boundaries. A whole-source hash
still gates current coverage and finalization. Independently validated exact-input
unit receipts can reduce model work after a prefix reset; they are not clearance.
Producer-contract drift invalidates reuse. Schema/file/input hashes bind precision
reuse, and suppression/deferral rules are re-applied against the current source.

Controller-created `AUDIT_DEADLINE_AT` is an absolute epoch-millisecond deadline,
not an owner budget or permission override. Exit 7 is pending progress; exit 9
is a hard scheduling timeout; only provider exhaustion uses exit 8/backoff.
Local/job controllers supply deadlines without changing shared configuration.
Cached replay does not consume the fresh slice quota. Paid scan/precision
attempt markers survive prefix resets within the same campaign; unknown paid
outcomes require operator review, not automatic wraparound. Three hard deadlines
without completed-work progress stop the job after bounded backoff.
`--preflight-only` performs no audit and reports files, chunks and model units.
On the same 858-file corpus, stable anchors measured **814 → 823 units (+1.1%)**,
with 327 → 353 parent chunks. Parent chunks are not provider-call counts.

No new tool, persona, schema or permission surface was added. Do not infer a
completed production audit or publication from local regression/build results.

## November 11, 2026 focused follow-up

- Replaced eight internal npm mirror URLs with public registry URLs, preserving
  versions and integrity hashes. Actual downloads of all eight public tarballs
  matched their retained checksums. This is not a complete clean-install or
  remote-CI execution claim.
- `npm run build` and `npm run publish:preflight` now check lockfile portability
  first. Isolated regressions prove an internal URL stops each command before
  compilation or database inspection. Both GitHub check workflows cover the
  portability tests, and the bounded workflow watches package and deployment-test
  changes as well.
- Global persona definitions contain internal operating instructions. Persona
  export now refuses other customer tenants at the tool and direct-service
  boundaries before database reads. Missing or malformed IDs are rejected.
  Database and routing failures no longer manufacture empty/successful exports;
  the tool returns a generic failure without logging underlying private details.
- Focused offline checks: 157 security/regression tests passed; five portability
  tests passed. TypeScript and the release-check production build passed.
  Development persona doctrine was synchronized to all 18 active personas and
  wiring/stale-string checks passed. Application publication and production
  verification remain separate.
- RLS policies still permit absent tenant context. Do not enable global
  enforcement blindly, replay writes to create a shadow audit, or claim shared
  topic reservations guarantee single execution. Those changes require explicit
  authority/side-effect boundaries and staged verification.

## November 10, 2026 remediation evidence

This is not whole-platform security clearance. Application publication, worker
runtime verification, and a complete source-current model audit remain separate.

- Dependency rescan: zero known advisories after the XML-parser update and
  supported FastAPI/Starlette constraints, with safe h11/idna floors. The worker's
  full Python 3.12 dependency graph resolved without installation. Local stdlib
  worker tests passed (13); installed FastAPI/pytest compatibility is a separate
  GitHub job and was not claimed as locally verified.
- Focused offline Node regressions: 153 passed, zero failed, two database-dependent
  cases skipped. Full TypeScript check and production build passed; build retained
  four existing `import.meta`/CommonJS warnings.
- File deletion checks the object-storage SDK's error Result, not just thrown
  errors. A failed delete returns 503 and retains the database row/storage key.
  Missing objects are successful idempotent retries; database deletion stays
  tenant-scoped and follows storage deletion.
- Email/video logging omits sensitive input; global console redaction masks email
  addresses. Inspected memory/tenant 500 responses are generic. This is not a
  claim that every historical log or every route was scrubbed.

## Faster checks without weaker evidence

The main tenant audit remains coordinator-owned, serial, source-bound and
fail-closed. Do not launch concurrent copies of the existing controller:
they share a heavy-work lease and a contiguous-prefix checkpoint.

1. Pack small, labelled file sections into bounded 30,000-character model units.
   Preserve numbered source lines and large-file overlap. Findings must cite a
   numbered line within their own labelled file section.
2. One controller invocation has a 10-minute process deadline, covering admission,
   slices and cleanup. A stalled controller kills its detached child group before
   exiting. A provider outage returns deferred status immediately; no in-process
   multi-hour cooldown sleeping.
3. Preserve valid checkpoints, but invalidate evidence when source, prompt or
   evidence-producing configuration changes. This packing change intentionally
   invalidates earlier pending-unit receipts. Never count old-source work as
   clearance for changed code.
4. Offline measurement of the inspected 857-file/327-chunk snapshot:
   1,196 old units versus 812 packed units (384 fewer, 32.1%). This measures
   potential call reduction, not observed wall time, model quality, or completion.
5. `.github/workflows/security-checks.yml` runs three independent offline Node
   lanes and a separate Python 3.12 worker job on GitHub-hosted runners. Each job
   is capped at 10 minutes; newer same-branch runs cancel older runs.
   No production DB, customer artifacts, AI credentials, or paid model audit is
   supplied to these jobs. Their results supplement, not replace, the existing CI.

Use `npx --no-install tsx scripts/tenant-isolation-audit.ts --preflight-only`
to inspect canonical files/chunks without models, reports, email or remediation.
The ordinary controller command remains
`npx --no-install tsx scripts/run-tenant-isolation-audit-resumable.ts`.
Exit 7/8 is partial/deferred, never green. Do not automatically loop those exits
inside another long-lived process.

## Design and authority constraints

- **Cost/scale:** remove redundant calls before increasing concurrency; one paid
  audit request at a time retains existing budget admission and provider limits.
- **State:** canonical checkpoint authority remains in existing durable job state;
  local mirrors are not independent clearance.
- **Failure:** provider/budget/coverage errors remain non-green; completed work
  survives only when its source identity still matches.
- **Idempotency:** existing exact prefix, source hash and checksum contracts stay
  intact; workers do not independently overwrite canonical results.
- **Tenant/limits:** no customer data, credentials or production database enter CI.
- **Stop/observation:** controller wall deadline and GitHub job limits bound work;
  retained coverage distinguishes audited, pending and failed units.
- **Authority:** workers may propose findings; they cannot approve themselves,
  change security policy, publish the app or grant customer access.
- **Capability delta:** parallel deterministic runners and fewer model requests
  do not expand runtime agent authority. Multi-provider model parallelism requires
  fenced disjoint claims and validated exact-set merging before it is safe.
