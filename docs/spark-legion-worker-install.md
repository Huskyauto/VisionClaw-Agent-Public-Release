# Spark Lenovo relay worker installation

**Activation prerequisite:** the relay is production-only. Before enabling it,
Bob must arm the application flag in BOTH environments and restart development.
When armed, development refuses direct Lenovo generation; production retains
direct-first routing. Two separate databases cannot share a PostgreSQL lock.
Do not enable production alone. See the protocol for the full acceptance checklist.

This is an installation guide for the outbound worker only. Delivery does not
mean the worker is installed, the relay is enabled, or production publication
is approved. Keep the verified direct provider as primary.

## Prerequisites

- Spark has Python 3 and durable home-directory storage.
- The owner API credential with chat/admin scope is already securely injected
  as `VC_API_KEY` by Spark's secret helper. Revision 1.3 accepts an opaque
  injected surrogate (such as Spark's `hsurr:` format) as well as a raw owner
  key. The runtime must resolve the surrogate in flight for an allowlisted
  application host; the worker does not resolve it or verify ownership locally.
  Tokens must be 1–8,192 visible ASCII characters with no whitespace or control
  characters. They are preserved exactly, without trimming or decoding.
  Server-side authentication and chat/admin scope checks remain authoritative.
  Do not copy the credential into a command, schedule definition, log,
  checkpoint, or file.
- Spark securely injects its normal `HTTPS_PROXY`. The worker uses that proxy
  for the application and derives a separate Ollama proxy by changing its port
  to `3130`.
- The application is independently configured for the exact relay protocol
  and owner-only access. This worker does not enable application flags.

## Install and schedule

From the extracted package directory, install into Spark's durable home:

    install -d -m 700 "$HOME/.local/lib/spark-legion-relay"
    install -m 700 scripts/spark-legion-worker.py "$HOME/.local/lib/spark-legion-relay/worker.py"

Configure Spark's existing secure scheduler to run this command once per minute:

    python3 "$HOME/.local/lib/spark-legion-relay/worker.py" --once

Configure the scheduler's secure environment injection for `VC_API_KEY` and
`HTTPS_PROXY`; do not put their values in the schedule text. Do not add command
arguments for task content, URLs, model selection, or alternate hosts. The
default app base is `https://agenticcorporation.net`; the only alternate
allowlisted production origin is `https://vison-claw-agent.replit.app`.

Each invocation performs at most one recovery or poll cycle and exits. A
private `~/.spark-legion-relay` directory is created with mode `0700`; its
fixed checkpoint and lock files use mode `0600`. Preserve this directory
across process restarts and VM replacements. Do not copy checkpoint contents
into tickets or logs; they may contain exact provider result bytes.

The authenticated schema is checked against protocol v1 limits:
65,536 request bytes, 65,536 response bytes, 2,048 generated tokens, and a
210,000 ms job deadline. The worker does not assume a 300-second deadline.
It posts `ready: false` after a bounded tags failure or exact-model miss so
the app receives a fresh not-ready poll rather than relying on stale health.

An HTTP 200 response containing the website HTML is not a valid schema. The
worker stops before polling on a non-JSON/invalid schema or authentication
failure. Keep the schedule disabled until publication is separately approved,
the production protocol JSON is verified, and live activation is authorized.

## Recovery and operation

The worker checks the exact Ollama model through `/api/tags` before polling,
uses only native `/api/chat`, and does not follow redirects. It persists the
`starting` state before requesting start, stores provider response bytes before
delivery, and never regenerates after an ambiguous start or from a saved result.
An uncertain checkpoint stops polling until authenticated job metadata reports
`released: true` and no generation is possibly running. Result conflicts are
reconciled against authenticated job metadata; a conflicting completion hash
is retained locally as uncertain evidence and must not be discarded. Do not
delete a checkpoint to force the worker to continue. A server validation
correction may append a system message after a user message; the worker permits
that within the six-message/16,384-character request bounds while still
requiring the exact guardrail as the first system message.

The command's short stdout result is operational status only; stderr reports
fixed error descriptions. Never enable shell tracing or add verbose HTTP/body
logging around the schedule. Remove the schedule to stop new polling while
preserving checkpoints and server-side reservations.

## Offline verification and handoff

The Python unit tests use synthetic data and an offline HTTP redirect fixture:

    python3 -m unittest discover -s tests/python -p 'test_spark_legion_worker.py'

Before any live use, verify the exact installed package hash, schedule
acknowledgment, authenticated status/poll, and exact-model health through the
owner handoff process. Live relay use remains pending separate publication
approval and owner authorization.
