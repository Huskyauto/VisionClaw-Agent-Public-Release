# Legion direct route — development evidence and limits

This document records the original unpublished network/bootstrap slice.
The later narrow background integration is described in
`docs/legion-background-work.md`; it is not general Felix/provider routing.
The operator smoke is restricted to the original development workspace. It does
not run at app startup, change model routing, issue grants, send messages, use
hosted fallback, or operate on production.

## Identity and binary

- Build the isolated static binary with
  `nix-build nix/legion-tailscale.nix --out-link generated-artifacts/legion-tailscale`.
  The fixed upstream 1.104.7 archive is SHA-256 checked by Nix. The environment's
  older package is not silently used. Generated binaries stay out of Git/deploy.
- Run `npx tsx scripts/legion-direct-smoke.ts` explicitly. No caller prompt,
  endpoint, environment, tenant or credential arguments are accepted.
- `TAILSCALE_AUTH_KEY` and `SESSION_SECRET` are required Secrets. The join key
  travels in memory over a private Unix socket, never command arguments, child
  environment, a key file, or logs. Startup follows upstream's two-stage
  `/start` then first-login `/login-interactive` contract; both return 204.
- Daemon-local plaintext state exists only in a private temporary directory.
  Its durable copy is authenticated-encrypted in `legion_node_states`, bound
  to tenant 1 and the exact development/production environment. The store has
  no generic file/download/tool API.
- A durable, non-expiring holder fences each identity. Normal observed daemon
  shutdown checkpoints identity before releasing the holder. Corrupt state,
  ownership loss or uncertain shutdown does not silently create another node.
  Unclean crashes require operator recovery after independently proving the old
  daemon is dead. This deliberately favors isolation over automatic takeover.
- The policy displays `tag:VisionClaw`; Tailscale parses tags as lowercase.
  LocalAPI requests canonical `tag:visionclaw`. DNS and route adoption are off,
  inbound shields are on, and the outbound proxy listens on loopback only.

## Scope of the smoke

The test verifies the running tag, then checkpoints identity before contacting
the fixed Lenovo address. It requests version/inventory and one fixed synthetic
`qwen3:8b` completion. If successful, it stops the daemon, restores encrypted
state into a different temporary directory, and compares the node IDs.

The client accepts only four fixed Ollama API paths at
`100.73.84.100:11434`; redirects, arbitrary URLs, oversized bodies, ambient
proxies and unbounded deadlines are not supported. General fetch/SSRF code
is unchanged. This transport is not yet exposed as an authorized provider.

No success is inferred from a saved Secret, successful local API response,
or passing unit tests. `NeedsLogin` is not a connected node. Daemon diagnostics
are projected to fixed error categories without retaining log values or login
URLs. A failure is not a reason to replay tools or switch to a different design.

## Live evidence, November 16, 2026

The successful development run reached `Running` with exactly the canonical
service tag, retrieved Ollama 0.40.16 and all three expected models, and returned
`LOCAL MODEL OK` from `qwen3:8b` with fingerprint `fp_ollama` in 7,169 ms.
Usage was 17 prompt/194 completion tokens; no hosted fallback occurred and
local inference charge is zero. Separate reasoning was not printed.
The second cycle restored encrypted state into a new directory, retained the
same node ID, and passed version/model checks. Both daemons were stopped cleanly.
This is a development daemon restart, not a production republish test.

A subsequent network-only run reused the same node and healthy Lenovo endpoint
without generating another completion. TCP CONNECT probes to Lenovo ports
22, 443, 11435 and `100.64.0.1:11434` all failed. This is consistent with
the owner-confirmed policy tests; failed dials alone cannot distinguish an
ACL denial from an unavailable destination/listener or prove exhaustive isolation.
The daemon stopped and the encrypted row's holder was released afterward.

Spark's subsequently supplied `How Spark Connects to the Legion` note was
read in full. Its already-authenticated-node/request distinction agrees with
the working route. Its `NeedsLogin` diagnosis describes the earlier failed
state, not the later successful run. No Spark identity/proxy was borrowed.
The raw-CLI-key example is not copied: the implementation keeps the key out
of argv. Ordinary filesystem persistence alone is also insufficient here.

## Development schema and rollback

One new owner-only control-plane table was added to `shared/schema.ts` and
created additively in development. Its composite primary key starts with the
tenant FK; owner/environment/ciphertext constraints fail closed. No backfill
or customer-data rewrite is needed. Production schema is unchanged; only the
owner-operated Publish schema review may propagate this table.

Rollback is to stop the smoke and leave the inert encrypted table/identity
retained. Never delete identity merely to clear an error, and never release an
uncertain holder based on elapsed time. Removing the table later requires a
separately approved destructive cleanup with loss of node identity understood.

## Not yet accepted

Exhaustive ACL proof, production identity continuity, general provider/task routing,
isolated embeddings, standing authorization controls/audit, and the Spark–Felix
line repair remain separate uncompleted parts of the supplied build brief.
Supervised development startup, a tested binary-staging helper and selected
runbook inference now exist; see the later background-work scope above.

## Verification scope

Three credential-isolated regression tests passed, covering encryption/scope,
permanent ownership fencing and the exact startup API contract/canonical tag.
Full application TypeScript and the additional strict script/module TypeScript
check passed. Stale-string and agent-wiring gates passed with existing warn-only
persona-sprawl/orphan-table findings. The development app was restarted once and
the public landing rendered; owner-only anonymous API denials remained visible.
Existing unrelated startup canary warnings were not cleared by this work.
No persona-facing tool, parameter, permission or discovery surface was shipped,
so no persona prompt synchronization or production rollout was performed.
