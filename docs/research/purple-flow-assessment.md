# PurpleFlow: useful workflow-design reference, not a replacement

## Scope and verdict

Source: https://github.com/leetheguy/purple_flow

Reviewed source revision: bd33b0e21c148df723e3e49cec9833248f9ac1a6.
Repository metadata at inspection: MIT, zero stars and forks, created September
25, 2026; last pushed October 28, 2026. Popularity is not a correctness measure.

Retain as an engineering reference. Do not install or migrate VisionClaw.
No application code, runtime configuration, credentials, or services changed.

## Observed source

- README: an Elixir/OTP workflow engine using TOML definitions, separate code
  files, webhook/cron/manual triggers, and a read-only workflow canvas.
- `lib/purple_flow/run.ex`: per-step concurrency, queues, delay, optional
  queue limits, overflow routing, streamed items and batch flushing. These are
  implemented concepts, not merely roadmap promises. This review does not prove
  strict memory bounds under every fan-out/batch/mailbox pattern.
- `lib/purple_flow/workflows.ex`: validates reloads, retains the last working
  definition on invalid edits and exposes problems plus a stale-version marker.
- `lib/purple_flow/credentials/oauth.ex`: on-demand access-token renewal with a
  margin, serialized refresh, retained refresh tokens and reconnect errors.
- `lib/purple_flow/runner/server.ex`: code evaluation shares one BEAM VM, with
  process cleanup; deployment-container isolation is not per-customer isolation.
- `specs/999_todo.md`: interrupted-run resumption and durable waits remain open;
  retries and all-branch joins are planned; multi-tenant hosting is an idea.
- README security section acknowledges cross-script visibility within the runner.
  The roadmap also lists per-credential host locks as unfinished.

## Source-backed cross-case fit comparison

Hypothesis: replacing the native engine would improve operational efficiency
without losing recovery, policy or customer boundaries. The source comparison
does not establish this claim and exposes incompatible requirements.

| Case | Native baseline inspected | External evidence / disposition |
|---|---|---|
| Agent calls an integration | Existing tool router and persona/tool policy surfaces | Lazy skill loading and uniform workflow inputs are useful ergonomics, not a reason to replace authorization with generic HTTP. |
| Large background fan-out | Priority-aware native concurrency pool and orchestrator slot reservation | Per-stage queue/overflow visibility is a worthwhile reference; no measured native bottleneck or performance gain established. |
| Individual branch failure | Existing orchestration step error/timeout handling | Explicit failed/overflow routes are clean; independent branches may continue, but missing mandatory outputs must still block acceptance. |
| Restart during long work | Existing durable job/checkpoint architecture | External resumption and durable waits remain open; unsuitable as a replacement for paid fulfillment. |
| Two customers share execution | Native tenant and guarded-tool boundaries | Shared code VM and future multi-tenancy do not establish equivalent isolation. |
| Invalid workflow edit | Existing governed proposal/verification boundaries | Last-known-good activation with visible stale status is a useful design reference, not evidence to bypass approvals or keep revoked permissions. |
| Google access token expires | Existing Gmail-direct cache/single-flight refresh | Same basic renewal pattern, not a solution to provider revocation or redirect mismatch. |

These are static comparison cases, not executed A/B tests, blind held-out
evaluation, or a security audit. No external scripts were run, no dependencies
installed and no live provider actions initiated. A meaningful runtime comparison
would require a candidate and matched workload; it was not justified here.

## Benchmark limitations

The author's `docs/n8n_case_study.md` supplies scripts and disclosed configuration,
which is more useful than an unsupported headline. However, PurpleFlow ran many
sleeping code items inside one workflow, whereas n8n ran HTTP-triggered child
executions. Storage differed (Postgres versus SQLite); most tests ran once.
The 512 MB cap applied to the PurpleFlow runner, with its application uncapped
and separately measured. This is not a whole-stack 512 MB result.

The claimed 200x memory efficiency is not a matched real-agent benchmark and
cannot predict VisionClaw RAM, LLM costs, throughput or production reliability.

## Revisit condition

If measured stage queues accumulate or operators cannot diagnose stalled jobs,
trial per-stage queued/running/failed/overflow telemetry in existing machinery.
Compare matched success, tail latency, peak whole-process RAM and mandatory-step
completion under overload, branch failure and restart. Preserve tenant, approval,
spend and recovery boundaries. Stop if it adds a second scheduler or weakens them.
