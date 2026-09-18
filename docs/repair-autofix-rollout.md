# Self-Repair Auto-Fix Rollout — `REPAIR_AUTOFIX_ENABLED`

This note tracks the supervised rollout of autonomous code-fixing in the self-repair
loop. Auto-fix is **opt-in, default OFF** — mirroring the `JURY_AUTOAPPLY` precedent
("default OFF protects forks / public-mirror users").

## What the flag does

- **Gate:** `repoSurgeonAutofixEnabled()` in `server/agentic/repair-incident.ts`
  (`process.env.REPAIR_AUTOFIX_ENABLED === "1"`).
- **OFF (current):** a `repo_surgeon`-routed `code_defect` incident is recorded on the
  ledger with `action_outcome='autofix_disabled'` and left for a human. It is **never**
  silently dropped. The non-destructive routings (retry / felix_revise / surface /
  escalate_owner) dispatch regardless.
- **ON:** the same incident runs the guarded code-fix executor (repo-surgeon): diagnose
  → minimal diff → verify (typecheck → targeted tests → optional golden-path replay →
  re-run the failed tool) → land on green or roll back on red. Guard/safety/schema/auth/
  payment surfaces still pause for owner HITL and never auto-apply.

## Flip-on criteria (the "proven itself" bar)

Do **not** flip the flag until **all** of these hold:

1. The feature is deployed to production (the `repair_incidents` table exists in prod).
2. A stretch of **real** failures has accrued `action_outcome='autofix_disabled'`
   ledger rows — review via `GET /api/admin/repair-incidents?status=needs_review`.
3. For each reviewed row, the proposed remedy (what repo-surgeon WOULD have done) is
   confirmed sound — correct root cause, minimal diff, no guard/safety weakening.
4. No `safety_blocked_autofix=true` rows that should have auto-fixed (i.e. the safety
   routing isn't over-blocking legitimate code defects).

A reasonable bar: **≥ ~10 reviewed real `autofix_disabled` incidents** across a
multi-day window with the proposed remedy judged correct each time, no false-positive
classifications routing non-code-defects to `repo_surgeon`.

## Observation log

### 2026-06-01 — observation period NOT YET POSSIBLE (flag left OFF)

- Dev DB: `repair_incidents` exists but has **0 rows** (and is missing the ledger
  `action_*` columns — schema not migrated in this environment).
- Prod DB: `repair_incidents` table **does not exist yet** — the self-repair dispatch
  loop, repo-surgeon executor, and resume layer all shipped today (R125+19/20/21).
- `REPAIR_AUTOFIX_ENABLED` is unset (OFF) in all environments.
- **Conclusion:** there are **zero real `autofix_disabled` ledger entries to review**,
  so the loop has not yet auto-accumulated an observation record.

### 2026-06-01 — owner override: flag flipped ON

- The owner reviewed the "no observation data yet" finding above and explicitly chose
  to enable auto-fix now anyway ("Flip it ON now anyway — I accept the risk… just make
  it work in a safe manner").
- `REPAIR_AUTOFIX_ENABLED=1` set in the **shared** environment (applies to dev and
  production). Dev app restarted to pick it up; production picks it up on next deploy.
- "Safe manner" is preserved by repo-surgeon's built-in invariants (unchanged): every
  proposed fix is verified (typecheck → targeted tests → optional golden-path replay →
  re-run the failed tool) and **rolled back on any red**; guard/safety/test/schema/auth/
  payment surfaces **never auto-apply** and pause for owner HITL; a durable 2-failed-
  attempts stop then escalates to the owner. The flag only enables the executor — it
  does not relax any of those guards.
- Because the prod `repair_incidents` table is not deployed yet and the dev ledger is
  empty, no incident will actually run the executor until real `code_defect` incidents
  start flowing; until then the flag is a no-op in practice.

### 2026-06-01 — production-readiness verification (Task #62)

Verified the loop is ready to go live the moment the latest code is published:

- **Dev DB:** `repair_incidents` now HAS the full `action_*` remedy-dispatch ledger
  (`action_taken`, `action_outcome`, `action_detail`, `resolved`, `resolved_at`,
  `dispatched_at`) plus all 3 indexes. The earlier "dev missing the ledger columns"
  note above is **stale** — `ensureRepairIncidentsTable()` adds them idempotently via
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS` on first use.
- **Prod DB (read-only replica):** `repair_incidents` **still does not exist** —
  confirms the self-repair feature has not yet been published to production.
- **Path to green is a single Publish — no manual prod migration.** Production schema
  is owned by Replit's Publish flow (the agent must never DDL prod directly). After a
  Publish, the table self-creates in prod on first use via the same
  `ensureRepairIncidentsTable()` ensure-on-first-use guarantee — so publishing the
  code is sufficient; there is nothing to hand-migrate.
- `REPAIR_AUTOFIX_ENABLED=1` is already set in the **shared** env, so the deployed
  prod runtime picks it up on the next deploy.
- **Post-deploy check:** `scripts/verify-repair-loop-prod.ts` confirms all three
  "done" criteria in one GET against the deployed review endpoint (which returns
  `autofixEnabled` + incident `stats`): the endpoint works, the prod runtime sees
  `REPAIR_AUTOFIX_ENABLED=1`, and the ledger is queryable (the loop can record
  incidents). Reachability path validated against dev (HTTP 401 ⇒ route wired +
  auth-protected); the full flag/stats assertion needs an admin bearer token.

**Remaining action (owner — agent cannot do this):** click **Publish/Deploy** to ship
the self-repair code to production, then run:

```bash
REPAIR_VERIFY_BASE_URL=https://<your-prod-domain> \
REPAIR_VERIFY_ADMIN_TOKEN=<admin-session-bearer> \
npx tsx scripts/verify-repair-loop-prod.ts
```

### 2026-06-01 — full-schema parity check (Task #64)

The post-deploy verification now confirms the **whole self-repair schema set** is live
in prod, not just the incident ledger. The self-repair loop spans three tables, each
self-creating via its own idempotent ensure-on-first-use helper:

| Table | Feature | Ensure helper |
|---|---|---|
| `repair_incidents` | decision ledger (#54) | `ensureRepairIncidentsTable()` |
| `repo_surgeon_attempts` | code-fix executor (#52) | `ensureRepoSurgeonAttemptsTable()` |
| `pipeline_stage_artifacts` | resume/reconstitution (#53) | `ensurePipelineStageArtifactsTable()` |

- **Endpoint:** `GET /api/admin/repair-incidents` now ensures all three tables and
  returns a `schema` health block — `{repair_incidents, repo_surgeon_attempts,
  pipeline_stage_artifacts}` booleans from a read-only `to_regclass(...)` confirm. A
  single authenticated admin GET therefore **both brings the full system live**
  (idempotent ensure) and **proves it** (read-only confirm). The extra ensures are
  best-effort (`Promise.allSettled` + nested try) so a probe failure never breaks the
  incident view — `to_regclass` then honestly reports any table it could not bring up.
- **Verifier:** `scripts/verify-repair-loop-prod.ts` adds criterion 4 — it fails with
  new exit code **7 (SCHEMA INCOMPLETE)** if any of the three tables is missing/unconfirmed
  in prod (or if the deploy predates the `schema` block). The unauthenticated reachability
  probe is unchanged (the schema block is admin-only, behind the bearer token).
- **No manual prod migration.** As with `repair_incidents`, the two executor/resume
  tables self-create on first use; a single Publish + one authenticated verifier run
  confirms the entire self-repair schema set is parity-checked in production. The agent
  never DDLs prod directly — production schema is owned by Replit's Publish flow.

## How to flip ON (when criteria are met)

Set the env var in the target environment(s):

- **Dev / this Repl:** add `REPAIR_AUTOFIX_ENABLED=1` to the env (via the Secrets/env
  pane). The agent cannot write Secrets programmatically — request it explicitly.
- **Production:** set `REPAIR_AUTOFIX_ENABLED=1` in the deployment's env vars, then
  redeploy so the running process picks it up.

No code change is required — the gate reads the env var at dispatch time.

## Rollback note (owner)

**To turn auto-fix back OFF at any time:** set `REPAIR_AUTOFIX_ENABLED=0` (or remove
the variable) in the affected environment(s) and restart / redeploy. The gate fails
safe: with the flag absent or `!= "1"`, repo-surgeon never runs and code defects revert
to record-only (`action_outcome='autofix_disabled'`) for human review. No data
migration or code revert is needed — it is a pure config toggle.
