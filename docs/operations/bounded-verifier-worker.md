# Bounded verifier worker

This is a separate Node worker, not a second copy of the web application.
Production activation is not established by building this bundle.

## Requirements
- Matching full application checkout, dependencies and compiler standard libraries.
- A Linux host with readable, finite, complete cgroup memory accounting.
- At least 3 GiB aggregate headroom and parent RSS below 1,200 MiB at admission.
- Separately provisioned access to the intended existing Postgres database.
- No public HTTP endpoint, LLM credentials or payment/email integration required.
- One worker process; existing advisory locking also serializes compiler work.

## Build / start
Build the application normally with `npm run build`. The output includes
`dist/proposal-verifier-worker.cjs`, the existing child bundle and compiler libs.
Retain the full source/config/dependency checkout used for compilation.

On the independently verified host, start:

```sh
NODE_ENV=production PROPOSAL_VERIFIER_EXTERNAL_WORKER=1 node dist/proposal-verifier-worker.cjs
```

Provision database credentials through the host's secret manager. Do not paste
them into this document, commit them, or copy production secrets into a fork.

The worker claims one job at a time, only from
`research_proposal_verification` and `source_repair_verification`. Its reclaim
sweep has the same kind filter. It does not import/start general job handlers.
Strict source mode defers on a nonmatching OLD_CODE snippet instead of invoking
an LLM rebase. This snippet check is not proof of whole-release parity; verify
the checkout and dependencies independently before activation.

## Switch-over / rollback
Do not enable the flag in the web host until worker memory, source parity,
database scope and a fenced smoke result are verified. Setting the same exact
flag to `1` on the web deployment excludes those verification kinds from its
claims and reclamation. Other values retain existing local routing.

For rollback, stop the external worker and disable the web flag. Existing
leases expire for scoped recovery; capacity deferrals preserve attempts.
The restored web path still refuses compilation where accounting is missing.

SIGTERM stops new claims and allows the current bounded child to finish.
Allow up to the child timeout plus queue-completion margin for graceful shutdown;
an orchestrator kill leaves the fenced lease for recovery, not a success.

## Deployment status
No worker host has been published or provisioned as part of this implementation.
Do not claim production verification is unblocked until a real host passes the
above checks. A readable development cgroup is local evidence only.