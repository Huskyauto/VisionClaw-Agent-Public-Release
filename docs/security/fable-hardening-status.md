# Fable hardening: staged evidence, not platform clearance

## Scope
Source: attached “VisionClaw Agent review: safer, stronger, more agentic”.
Bob authorized addressing all findings in stages. Contract:
`data/feature-contracts/fable-platform-hardening/`.
Development implementation only; no publication or production role changes.

## Implemented boundary changes
- MCP discards all external underscore keys and the tenant alias, then stamps
  the authenticated tenant, external channel and model-invocation marker.
  The actual MCP SDK call handler is tested through an in-memory transport and
  real dispatcher, not just a standalone sanitization function.
  Scope correction: this is the legacy `server/mcp-server.ts` surface named in
  Fable's report. Development startup confirms it is disabled by the existing
  opt-in flag. The supported `/mcp` endpoint is a different, scope-restricted
  implementation, not this generic dispatcher. Do not describe this as a proven
  exploit of the active production MCP endpoint; its flag/config is unverified.
- execute_code and tool-learning callers await a disposable Node child.
  `/usr/bin/prlimit` is REQUIRED: no fallback to host execution if unavailable.
  Limits: two children per instance; 512 MiB address space per child, including
  external buffers; 64 MiB old heap; 6 CPU seconds; 6.5-second parent wall
  deadline; 128 KiB transfer; 50,000-character input; core dumps disabled.
  Child environment is empty, execution uses no TS loader or runtime disk files.
  JIT is disabled to keep address-space reservations within the 4 GB VM.
  The prior VM restrictions remain, with afterEvaluate microtask draining and
  user-error serialization inside timed code.
- Autonomous command execution uses fixed read-only binaries/argument rules,
  source-root path checks and async execFile. Shell syntax, expansion,
  interpreters, recursive options, config/private-state paths, path-bearing
  flags and uniq output files are rejected. Mutable settings cannot widen
  that compiled capability or implicitly grant full-shell mode.
- Owner-interactive execution retains its intentional shell capability and
  catastrophic/destructive floors. Omitting model flags or claiming self-heal
  no longer grants exec/lobster tool authority. Internal direct command services
  remain restricted rather than inheriting owner privileges.
- Autonomy enforcement exceptions now block rather than permit execution.
  Missing-persona consequential calls now fail closed. Internal services pass
  separate tenant-bound purposes rather than relying on omitted model flags.
- The public tool functions are now policy-enforcing facades, not exports of the
  raw implementation. Host authority is a separate, snapshotted parameter;
  model underscore keys are removed before legacy compatibility stamping.
  Dispatcher identity comes only from sealed invocation ALS, and private legacy
  access also requires that authority. Timeout accounting and retries retain it.
  Planners, MCP, background services, video, owner shortcuts and speculation were
  migrated. Guarded voice/repair services explicitly identify their existing
  authenticated service purpose; legacy HOST persona names resolve uniquely
  against the persona registry, not model fields or a default administrator ID.
- Updated and synchronized shared operational guidance for all active personas.

## Verification boundaries
Red/green tests observed the old synchronous execution and omitted-model-flag
authorization failure before implementation. New tests exercise promise loops,
async loops, a hostile thrown getter, heap and external-buffer exhaustion,
capacity admission, parent responsiveness and child recovery. Existing benign
results, log capture, reconstruction and constructor-chain defenses remain tested.
Compiled/minified standalone bundle smoke confirms the self-contained runtime
does not rely on development loader bindings.

Final local checks: 88/88 focused regressions passed; expanded application plus
changed-test TypeScript passed; full production build passed (four existing
CJS/import-meta warnings); stale-string and agent-wiring checks passed, with
the existing warn-only orphan-table inventory. The app was restarted once after
the code batch, logged an initially healthy six-check status, rendered its
landing page and returned `ok` from `/healthz`.

Scoped self-review covered the actual ingress/dispatch seam, child admission,
deadlines and hostile result/error handling, empty child environment, config
non-escalation, arguments/options with secondary file-write semantics, owner
gate behavior, fail-closed exceptions, callers awaiting the new async API and
bundled-runtime closure integrity. `uniq`'s optional output path was specifically
excluded. No independent reviewer agent was invoked.

| Requested area | Current evidence | Status |
|---|---|---|
| Sandbox process/resource containment | Real adverse probes, prior escape tests, minified bundle smoke | locally verified |
| Legacy MCP trust fields | Real SDK handler and dispatcher fixture | locally verified; legacy disabled in dev |
| Shell restrictions and errors | Positive async/source reads, negative command/owner/flag cases | locally verified; not OS isolation |
| Tool-context/autonomy identity | Separate authority, private implementation, sealed dispatcher, explicit service capabilities, unique legacy host-persona resolution | locally verified |
| Database-enforced isolation | Read-only coverage and actual dev pool role assessment | assessment only |
| Run lifecycle, external provenance, outcome/complexity work | Contract retained; not implemented in this batch | pending |

This is process/resource containment, NOT an OS identity/filesystem/network
sandbox after a hypothetical Node VM escape. Path validation is not a proof of
race-free OS filesystem isolation. Explicit owner shells intentionally retain
owner OS privileges. Production must verify prlimit availability and limits;
missing support returns an unavailable execution result, never in-process code.

## Database assessment (read-only)
On 2026-11-13 UTC, public tenant-bearing regular tables numbered 253 in both
development and the production replica; 14 had PostgreSQL RLS enabled. This is
catalog coverage, not proof those policies enforce every application's access.
The actual development application pool role was superuser/BYPASSRLS, with the
existing RLS enforcement configuration false. The production application's
connection role/configuration is UNVERIFIED: a database inspection connection
or replica role must not be passed off as the live application identity.

Do not globally switch roles or enforcement until tenant-context coverage and
privileged maintenance separation are proven. No SQL writes or role/flag changes
were made in this assessment.

## Remaining scope
1. Database non-bypass role and transaction coverage, with actual wrong-tenant
   denial proof and safe publication/production verification.
2. Production verification of the locally migrated execution boundaries;
   local fixtures do not prove a production rollout or OS privilege isolation.
3. Shared lifecycle/completion evidence over existing resume/checkpoint engines.
4. External-content provenance at consequential action boundaries, not blanket
   approval for harmless bookkeeping after every webpage.
5. Bounded outcome/cost evaluation; classify durable maps vs disposable caches,
   intentional logged degradation vs misleading defaults, and evidence-backed
   shadow promotion/retirement.

These remain authorized work in the existing contract, not optional follow-up
tasks or findings already fixed. Do not mark the whole review complete.

## Continued verification and rollout prerequisite
108 focused regressions passed after the authority migration. Application
TypeScript and production build passed; the four pre-existing import-meta/CJS
warnings remain. Persona synchronization and wiring audit passed, retaining the
29 existing warn-only orphan-table observations. The restarted development app
logged healthy startup, served its landing page, and returned `ok` from `/healthz`.
Scoped self-review included opaque receipt preservation, immutable authority
snapshots, pre-dispatch versus uncertain post-dispatch errors, legitimate owner
shell execution, explicit internal service authority, legacy-name ambiguity,
and scope propagation through timeout/retry paths. No paid evaluation was run.

The inspected managed production replica has no `visionclaw_rls` role.
Official Replit documentation confirms Publish copies RLS policies but does not
create their dependent custom roles, grants or functions:
https://docs.replit.com/features/data-and-storage/publish-database-changes
The available production SQL tool is read-only. No workaround, startup DDL,
production migration script, global role flip or publication was attempted.
Provisioning needs supported production database administration. Even after
that prerequisite, default-role/query migration, wrong-tenant proof, shared run
lifecycle, external provenance and outcome/complexity work are still unfinished.
