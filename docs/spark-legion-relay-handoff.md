# Spark Lenovo fallback installation package

## Optional connection notices

Owner-only offline/recovery notifications are prepared but OFF. Installation
and notification activation require separate owner authorization. See
`docs/spark-relay-alerts.md` for exact gates, sustained staleness, cooldown,
offline fixtures and uncertain-mail handling. These notices do not verify
inference readiness or widen relay permissions.

Protocol: **spark-legion-relay-v1**  
Build: **2026-11-27, package revision 1.3**

## Revision 1.3 — Spark credential compatibility

Supersedes revision 1.2 for worker installation. Accepts Spark's opaque
credential surrogate through the existing secure `VC_API_KEY` injection rather
than requiring the raw owner's `vc_` prefix. Only bounded visible ASCII header
values are accepted; whitespace and control characters are rejected. Credentials
are preserved exactly and sent only to the existing allowlisted application
origins, never to Ollama or checkpoints. Server authentication, scope checks,
redirect refusal, protocol, model policy, recovery and rollout gates are unchanged.

Spark acknowledged installing revision 1.2 and passing its 20 offline Python
tests. Its reported production schema response was HTTP 200 HTML, not protocol
JSON. Revision 1.3 fixes the local credential-format rejection only; it does not
publish the route or prove Spark's runtime substitution or live failover works.
Replace the installed worker with this revision, preserve existing checkpoint
storage, rerun the packaged tests, and return a new acknowledgment. Leave the
minute schedule disabled pending separately approved rollout and activation.

## Current state

The application implementation and offline verification are complete. This
package contains the restart-safe Spark worker, its Python fixture tests, the
exact protocol and installation instructions. It does **not** publish the
application, install on Spark, start a schedule or enable application flags.

Direct Lenovo remains primary. This fallback covers screened long runbook
compilation/extraction and a fixed operator arithmetic check, not arbitrary
chat or short memory tasks. Native inference stays on the exact approved Mellum
model, with the existing mandatory guardrail and task validation.

## What Spark should do

1. Extract the package into a private directory in durable home storage.
2. Verify `MANIFEST.sha256` with `sha256sum -c MANIFEST.sha256`.
3. Follow `docs/spark-legion-worker-install.md` to install the worker. Use only
   the existing secure environment injection for `VC_API_KEY` and `HTTPS_PROXY`.
   Never send either value back in a message.
4. Prepare a once-per-minute schedule, but do not activate live polling until
   Bob authorizes the application rollout and the schema endpoint is available.
5. Return the acknowledgment below. A copied questionnaire or queued outbox
   message is not proof that Spark received or installed this package.

## Acknowledgment to return

    Protocol: spark-legion-relay-v1
    Package SHA-256: [hash of the downloaded ZIP]
    MANIFEST verification: passed / failed
    Worker installed in durable home: yes / no
    Secure environment injection prepared: yes / no
    Minute schedule prepared: yes / no
    Schedule activated: no, awaiting Bob's rollout authorization
    Checkpoint directory persists across VM replacement: yes / no
    Problems: [describe without credentials or checkpoint contents]

## Before live activation

The relay is production-only. Arm the application flag in BOTH environments
and restart development so it refuses direct Lenovo generation. Separate
databases cannot share a device lock. Do not enable production alone. This
restriction applies only when the new flag is armed; flag-off development
behavior remains unchanged.

The application also needs the expanded job-status CHECK. The narrow migration
has been applied and verified in Replit development, retaining all legacy states.
Authorized Publish must show the CHECK change and production must verify it.
Spark should not run the Node database command or modify a database.

Publish only with Bob's explicit approval. Then verify authenticated schema,
exact-model tags health, poll and the fixed 42 check. Confirm the resulting
Spark transport receipt, model, measured token counts, latency and ledger entry.
Do not repeat the already proven direct production tests as a substitute.

If work becomes uncertain, preserve the checkpoint and stop. Confirm the old
Lenovo inference has stopped before using the owner release control. Never
delete a checkpoint or regenerate to repair result delivery or accounting.

## Verification included

Revision 1.3 adds six Python regression tests for opaque credentials, header
safety, unchanged destination restrictions, 401/403 rejection, HTML schema
rejection and real loopback HTTP header serialization. All use synthetic
credentials; none invoke a live provider. See the revision-specific review
section for observed results and remaining external checks.

Original implementation verification: 87 focused Node checks passed, including 20 Python tests and a supplied-worker
HTTP integration. Twenty PostgreSQL temporary-table checks, scoped TypeScript
diagnostics on 29 changed files, and both affected bundles passed. Review
dispositions and remaining acceptance are in `docs/spark-legion-relay-review.md`.
