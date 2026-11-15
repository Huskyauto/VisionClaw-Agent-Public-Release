# Source-aligned workspace verification

## Approved scope
Implement the source-aligned verification correction **without publishing**. Do not reset the working checkout, mutate production jobs, call paid models, or weaken HMAC, tenant/lease fencing, source identity, receipts, held-out evaluation, SSRF pinning or memory admission.

## Design and acceptance
- A worker advertises its sealed source context before any claim. A missing/mismatched context returns `source_required` without queue mutation.
- An explicitly provisioned, separate baseline contains exact captured source and a private lockfile-installed dependency tree. No fallback to the busy checkout or its node_modules. The child loader resolves inside staging.
- Source/dependency drift fails closed. Repeated inconclusive execution and expired leases have a three-run per-context budget. Paused jobs remain unverified and retained, not failed proposals.
- Existing queue statuses remain compatible: use pending plus a durable pause marker and a finite far-future next-run date. A new source context permits reconsideration; an unchanged context needs explicit operator inspection/reset. A finite date preserves existing JavaScript Date/JSON readers.
- Offline fixtures exercise admission, staging, dependency drift, retries, idempotency and fencing. Typecheck/build and development health are separate from production acceptance.

## Eight design answers
1. Cost: zero model calls. At most three inconclusive executions per job/context, one serialized child; memory and wall-clock gates unchanged.
2. State: durable pause/accounting in existing PostgreSQL job payload. Baselines are reproducible, private local build caches, never authoritative job state; missing cache pauses admission.
3. Failure: source/dependency/evaluator/lease gates fail closed; transport ambiguity retains the exact idempotent request/outcome. Never convert absence of evidence into a pass.
4. Identity: existing request UUID, signed snapshot digest, nonce and fenced lease; retry budget bound to compiler context.
5. Tenant/limits: existing tenant-bound proposal and settlement queries retained. Source preflight is platform-wide, returns only hashes, and runs before claims.
6. Stop/observe: existing exact `PROPOSAL_VERIFIER_WORKSPACE_ENABLED=1`; absent baseline pauses worker. Safe state logs distinguish source, baseline and execution deferrals.
7. Authority: owner provisions baseline and approves publication; worker verifies only. No new apply, model, merge, publish or evaluator-edit permission.
8. Delta: deterministic source/retry correction only; no expanded scale, autonomy, concurrency or tool authority.

## Evidence boundaries
The historical production context has not been reproduced from an immutable export. A hash match is required, not inferred from a revision name. Lockfile installation plus dependency sealing proves the provisioned compiler inputs, not the bit-for-bit state of an older production node_modules. Local fixtures do not diagnose the historical truncated HTTPS settlement requests. Do not claim the live backlog is draining before publication, exact-source provisioning and fenced production completions are observed.

## Provisioning and activation
The isolated installer explicitly matches this repository's
`legacy-peer-deps=true` resolution policy without loading `.npmrc` or any user
registry credentials. Lifecycle scripts remain disabled. Installation errors
expose only a fixed-shape npm error code, never raw stderr. Dependency sealing
uses a fixed 64-KiB streaming buffer, 512-MiB/file, 8-GiB/tree and 200,000-entry
ceilings: installed Claude/Copilot native binaries exceed the old 128-MiB file
ceiling. These are bounded disk-read limits, not heap allocations. A private
baseline must still seal every installed byte and reject outside symlinks.

1. A release-check/deployment build writes a **private** `dist/workspace-verifier-source.json.gz` containing only the compiler allowlist. Its hash is checked against source after compiler bundling. Production claims and settlements use this immutable build input, not a later runtime checkout. The artifact is not under the public static directory, and no download endpoint is added.
2. Retain/transfer that exact build artifact through an owner-authorized private infrastructure channel. Never send a source artifact through public uploads/Drive sharing. A development artifact is not proof of the current deployment.
3. After obtaining the deployed context hash and matching artifact, run:
   ```
   npx tsx scripts/provision-verifier-baseline.ts <private-artifact-or-exact-source-directory> <expected-context-sha256> <new-private-directory>
   ```
   The destination's parent must exist. Use an ignored private build-cache location such as `generated-artifacts/verifier-baselines/<hash>`. The command refuses overwrite, copies only bounded compiler inputs, installs the exact lockfile with lifecycle scripts disabled and a secret-free environment, requires compiler/loader assets, then seals actual dependency bytes. Existing source/dependencies are not modified.
4. Explicitly provision `PROPOSAL_VERIFIER_BASELINE_ROOT` for the workspace worker to that separate directory using the normal non-secret configuration flow. Keep the existing exact opt-in and signed HTTPS origin/key provisioning. No flag is changed by this repair. Missing/invalid cache means no claims. Cache loss requires reprovisioning, not job loss.
5. Restart the workspace worker. `source_required` means the baseline differs from the service; no lease is claimed. `waiting_for_baseline`/`baseline_unavailable` means no valid private baseline. Local transport fixtures do not clear HTTPS/proxy failures.
6. Recovery pauses use existing `pending` status, `next_run_at='9999-01-01T00:00:00Z'` and a payload recovery marker. A changed service context can reconsider them. For an unchanged context, inspect the recorded error and actual compiler/transport failure first; only an explicit operator-authorized, tenant/job-scoped reset of the recovery marker and next-run time may re-admit it. Do not blanket-reset attempts or max_attempts. There is no automatic reset endpoint.

No persona-facing tool, tool parameter, schema or permission is added. The new baseline setting is operator-only; existing memory, heavy-work serialization, receipt and approval gates remain.

## Local acceptance evidence
- Fifty focused verifier/source/recovery/process/queue regressions passed (including the final added matching-claim fixture); 85 safety/dispatch seam tests passed.
- Full TypeScript check and release-check production build passed; the build retained existing CSS/import.meta/chunk warnings.
- The real build artifact roundtripped 1,922 captured files and matched the inspected build source hash; this is local build provenance, not the historical production context.
- Wiring and stale-string gates passed with existing warn-only table/sprawl findings. No new persona-facing surface required synchronization.
- Provisioning process-boundary coverage used an offline npm executable fixture. A real full private lockfile installation and production HTTPS/proxy settlement remain unverified.
- Final local artifact context: `42ad2462de71d4d5ff25c03d3812366a806cedd65b360b7dbfa0e1c621fa6744`. After the development application and workspace worker were restarted, the application reported healthy and the worker logged `waiting_for_baseline`, making no new claims without explicit baseline provisioning. The landing preview rendered; its unauthenticated/network console warnings are not production verifier acceptance.
