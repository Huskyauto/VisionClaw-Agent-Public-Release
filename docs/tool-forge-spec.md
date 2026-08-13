# Tool Forge — closed-loop capability self-extension (handoff spec)

> Status: **DESIGN / handoff artifact.** Not yet built. This is the reviewable spec that must be
> signed off before any code lands (per replit.md "ask before major architectural changes").
> Origin: Claude "Fable 5" recommendation (2026-07-13), re-grounded against the real VisionClaw tree.

## The one open loop

Everything else on the agentic spectrum is already native: proactivity (heartbeat), self-initiative
(intention engine), self-critique (`critique` skill, CoVe, completion-verification), multi-agent
delegation (subagent desks), governance (4-layer AHB stack, jury, HITL). The **one** loop still open:
**the platform's capability surface is fixed at deploy time.** Every one of the ~396 tools is
human-authored. An agent that hits a wall today files a failure and stops. Tool Forge closes that
loop — when an agent fails because *no tool exists*, the platform detects the gap, drafts the tool,
proves it safe in the sandbox, and ships it under governance at the lowest permission tier.

### Not a duplicate of skill auto-emission

The closest existing cousin is **skill auto-emission with a review queue** (Hyperagent). Key
difference: skill auto-emission emits **skills** (markdown runbooks the agent reads). Tool Forge
emits **executable runtime tools** (`defineTool` specs + handlers registered into the dispatcher).
Different artifact, different risk profile, different gauntlet. Reuse the review-queue *pattern*, not
the code path.

## What already exists (reuse, don't rebuild)

| Capability | Native home |
|---|---|
| Code proposal artifacts + review queue | `server/routes/code-proposals.ts` |
| Hardened execution sandbox + escape probes | `server/code-sandbox.ts`, `tests/security/sandbox-escape.test.ts`, `tests/security/recursive-llm-sandbox-escape.test.ts` |
| Destructive-tool policy (fail-closed) | `server/safety/destructive-tool-policy.ts`, `TOOL_POLICIES` |
| Central guarded execution | `server/guarded-tool-executor.ts` (`executeGuardedTool`) |
| Tool resolution / selection | `server/chat-engine.ts` (tool-selection pass) |
| Maker/checker + jury + HITL | jury_triage, `server/routes/*` HITL routes |
| Tiered permissions | tiered-permission model |
| Intent gate / audit | `server/safety/intent-gate.ts`, `security_intent_checks`, `security_tool_blocks` |
| Capability registry | `capabilities` table |

**Genuinely new work:** (a) the `tool_miss` gap-detection event + frequency counter; (b) a dedicated
**forge persona** (separation of duties — NOT Felix); (c) runtime self-registration of a proven tool
at the lowest tier; (d) the canary→promotion state machine.

## Data model (2 tables; follows replit.md tenant rules)

Both tables: `tenant_id` `.notNull()` with **NO default**; every INSERT passes `tenantId` explicitly;
all reads app-level WHERE-scoped. Prefer `psql ALTER TABLE` over drizzle-kit push for the migration.

### `tool_gaps` — the demand signal
- `id` serial PK
- `tenant_id` int notNull
- `signature` text notNull — stable hash of (normalized intent + required inputs + expected outputs).
  The dedup key that turns 3 similar misses into 1 candidate.
- `intent` text notNull — the natural-language capability the agent wanted
- `required_inputs` jsonb / `expected_outputs` jsonb
- `blocked_task` text — the task this miss blocked (for the demo narrative + priority)
- `miss_count` int notNull default 0 — incremented on each matching miss
- `first_seen` / `last_seen` timestamptz
- `status` text notNull — `open | candidate | forging | resolved | dismissed`
- unique index on `(tenant_id, signature)`

### `forge_proposals` — the supply pipeline
Recommended: **fold into existing `code_proposals`** via a `kind` column (`'forge'`) rather than a new
table, so it inherits the review queue, diff view, and HITL wiring for free. If a standalone table is
cleaner: `id`, `tenant_id`, `gap_id` FK-by-convention, `tool_spec` jsonb, `impl_source` text,
`test_source` text, `state` (see state machine), `gauntlet_results` jsonb, `canary_stats` jsonb,
`created_by_persona`, timestamps.

## State machine

```
detected ──(miss_count >= FORGE_THRESHOLD within window)──> candidate
candidate ──(forge persona drafts spec+impl+tests)────────> proposed
proposed  ──(sandbox gauntlet: all green)─────────────────> proven
proposed  ──(any gauntlet fail)───────────────────────────> parked (annotated, gap reopened)
proven    ──(HITL approve, one tap)───────────────────────> canary   (requesting tenant ONLY)
canary    ──(N clean invocations, 0 governor flags)───────> promoted (HITL tap → general registry)
canary    ──(error / anomaly / governor flag)─────────────> retired  (auto; proposal reopened + telemetry)
```

Registry count changes **only** through an auditable artifact (census-gate philosophy — mirror the
route-census / tool-smoke-test conservation stance).

## Wiring points

1. **Gap detection** — in `chat-engine.ts` where tool resolution already happens: on a no-match,
   emit a structured `tool_miss` event → upsert `tool_gaps` by `(tenant_id, signature)`, increment
   `miss_count`. This is the ONLY hot-path touch; keep it fire-and-forget + fail-open (a telemetry
   write must never block or fail a chat turn — see the "awaited auto-hook latency bound" lesson).
2. **Candidate promotion** — a scheduled sweep (heartbeat task) flips `open → candidate` when
   `miss_count >= FORGE_THRESHOLD` in the window. Off the hot path.
3. **Forge persona** — new persona with a tight system prompt, its own `safety_profile`, its own
   `allowed_tools` allowlist (AHB requirement). Drafts `defineTool` spec + impl + **generated tests**.
   Files through `code_proposals` (`kind:'forge'`).
4. **Sandbox gauntlet** (proof before power) — run impl in `code-sandbox.ts` against: the generated
   tests; the escape probes from `sandbox-escape.test.ts`; a tenant-isolation check (tool must carry
   `tenantId` scoping — greppable, enforceable); intent-gate check. Fail any ⇒ `parked`.
5. **Governed birth** — maker (forge persona) / checker (4-layer stack + Bob via HITL, one-tap
   approve/reject with diff + test results + blast-radius). Born at the **lowest tier** regardless of
   function: rate-limited, single-tenant, read-only external calls, no credentials beyond a scoped
   allowlist. If it mutates prod / moves money / deletes / mass-comms / exposes creds ⇒ it MUST enter
   `TOOL_POLICIES` before it can register (unregistered-destructive fails closed).
6. **Canary + promotion** — live for the requesting tenant only, instrumented; N clean invocations
   ⇒ eligible for general-registry promotion (another HITL tap). Errors/anomalies ⇒ auto-retire.

## Safety invariants (non-negotiable)

- Separation of duties: the forge persona is NOT an executor persona (never Felix).
- Every forged tool is born at the lowest permission tier; escalation is a separate governed step.
- Destructive-class forged tools cannot register without a `TOOL_POLICIES` entry (fail closed).
- Gap-detection write is fail-open + off the awaited hot path.
- Promotion/registry mutation only via an auditable artifact + HITL tap; no hot patches.
- Reuse the AHB new-tool checklist (registry, policy, ALWAYS_INCLUDE/allowlist, persona docs, tests,
  count bump) — a forged tool is still a tool and must pass `verify-agent-wiring`.

## Metrics (surface on `/admin/ecosystem-health`)

Gaps open / candidates / forged-this-week / canary-live / promoted / retired; forge land-rate
(promoted ÷ proposed); mean misses-to-forge; top unmet-capability signatures (product signal).

## Phased rollout (each phase independently shippable + reviewable)

- **Phase 1 (low risk, SHIPPED 2026-07-14):** demand signal + the ecosystem-health "Unmet
  Capabilities" card. Pure observability — no code generation yet. Immediately useful (shows what
  tools tenants actually need) and proves the demand signal before building the risky half.
  **Build note:** folded into the EXISTING `capability_gaps` table + `detectGap()` in
  `server/skill-seeker.ts` (already fired with source `tool_miss` from the unknown-tool branch in
  `server/tools.ts`) instead of a duplicate `tool_gaps` table. Added `miss_count` + `last_seen_at`
  columns; `detectGap()` now atomically increments them on repeat misses; the card
  (`unmetCapabilities` probe in `server/lib/ecosystem-health.ts`) ranks open gaps by `miss_count`,
  tenant-scoped, degraded-safe, and breaches when any open gap hits ≥ 3 misses.
- **Phase 2:** forge persona + drafting → `code_proposals` (`kind:'forge'`) + sandbox gauntlet →
  `proven`. Human still registers manually. No self-registration yet.
- **Phase 3:** HITL one-tap → canary-per-tenant → promotion state machine + auto-retire.

Phase 1 is the safe first slice to build once this design is approved.

## Open questions for sign-off

1. Fold `forge_proposals` into `code_proposals` (recommended) or standalone table?
2. `FORGE_THRESHOLD` + window (start conservative: 3 misses / 7 days)?
3. Canary promotion bar `N` (start high: e.g. 20 clean invocations, 0 flags)?
4. Which external-call classes are allowed at the lowest tier (read-only allowlist scope)?
5. Is Phase 1 (observability only) worth shipping now as a standalone value-add + demo primer?
