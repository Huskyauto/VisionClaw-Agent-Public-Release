# Microsandbox Design (deferred — design doc only)

## Context

Gemini-3.5-Flash-Extended (2026-05-20 review) recommended replacing
regex-based destructive-command blocklists with virtualized execution
sandboxes (WASM, isolated containers, microVMs).

## Current state — Gemini's mistaken premise

VisionClaw does **NOT** rely on regex deny-lists for destructive commands.
The actual guardrails are:

1. **`TOOL_POLICIES` registry** (`server/safety/destructive-tool-policy.ts`)
   classifies every tool as `safe`, `mutating`, or `destructive` and gates the
   destructive ones behind explicit HITL approval.

2. **AHB intent gate** runs upstream and refuses to dispatch tool calls whose
   surrounding chat context fails the intent classifier.

3. **`trustedPersonasOnly` flag** restricts the most dangerous tools (e.g.
   `execute_sql`, `run_shell`, `delete_*`) to a small set of personas with
   stricter prompts.

4. **The Replit container** itself provides one layer of OS-level isolation —
   the agent runs in a Linux container with no host filesystem access.

So Gemini's "cat-and-mouse regex bypass" attack surface doesn't exist in
practice. The TOOL_POLICIES check happens **before dispatch**, not via string
matching of the rendered SQL or bash text.

## Where a second sandbox layer would still help

* **`execute_sql` against the LIVE prod DB:** currently runs in the same pool
  as the app. A bad query (full table scan, accidental UPDATE without WHERE)
  affects the live instance. A sandbox running `execute_sql` against a
  read-replica or shadow DB would isolate this.

* **`run_shell` / agent-authored scripts:** could be containerized via
  Firecracker or an isolated Docker exec for each invocation. Currently inherits
  the Replit container's permissions.

* **WASM for unsafe-input parsing** (Markdown, PDF, OCR pipelines): potential
  CVE surface that doesn't need full OS privileges.

## Why this is deferred to a future R-round

* **Effort:** integrating Firecracker or a WASM runtime is a multi-week
  project that touches every tool-dispatch path. R120 budget is already large
  with RLS + index audit + Docker compose dev.

* **Marginal value:** the existing TOOL_POLICIES + HITL + trustedPersonasOnly
  + AHB gates cover ~85% of the threat model Gemini described. The remaining
  15% (live `execute_sql` against prod, ad-hoc `run_shell`) is real but rare.

* **Compatibility:** any sandbox layer needs a "punch-through" mode for the
  legitimate cases where tools must affect prod state (sending real emails,
  charging Stripe, writing to Drive). Designing that punch-through right is
  most of the work.

## Recommended approach (when prioritized)

1. **Phase A — Read-replica for `execute_sql`:** spin up a logical replica
   (Neon read endpoint or PG `pg_basebackup` replica) and route `execute_sql`
   reads there. ~1 week.

2. **Phase B — Per-invocation Docker exec for `run_shell` and other
   process-spawning tools:** wrap each invocation in `docker run --rm
   --network=none --read-only --cpus=0.5 --memory=512m`. ~1 week.

3. **Phase C — WASM (wasmtime / wasmer) for parsing-stage tools:** route the
   Markdown / PDF / image parsing through a Wasm runtime so an attacker payload
   in a customer-uploaded file can't compromise the agent container. ~2 weeks.

4. **Phase D — Firecracker microVM for the highest-risk autonomous code
   (Forge running self-authored scripts):** each script gets a fresh microVM
   that vanishes after execution. ~3 weeks + ops burden.

Total estimate: 7 engineer-weeks for full coverage. Realistic R-round
breakdown: R12x = Phase A, R12y = Phase B, R12z = Phase C, R13x = Phase D.
