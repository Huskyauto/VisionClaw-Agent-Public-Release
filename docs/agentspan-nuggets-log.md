# Agentspan Nuggets — Future-Work Log

Source: research dive into [agentspan-ai/agentspan](https://github.com/agentspan-ai/agentspan) on Apr 25, 2026.
License: MIT (free to adapt).
Architecture: distributed durable agent runtime built on Conductor (Netflix).

This log captures patterns discovered in agentspan that we did NOT integrate
in R74.13, ranked by ROI for VisionClaw / [Your Product]. We picked the two safest
primitives (composable termination + 4-mode guardrails) for R74.13. The rest
sit here for future rounds — pick the next one when scale or complexity demands
it, not before. Hard rule: don't bog down the system.

## Shipped in R74.13

✅ **Composable termination conditions** — `server/agent-primitives/termination.ts`
   Pure module, no hot-path wiring. Lets future loops declare stop rules with `.and()` / `.or()`.

✅ **4-mode guardrail abstraction** — `server/agent-primitives/guardrail.ts`
   Pure module, no hot-path wiring. Includes `fromCritique()` adapter so existing critique-agent fits.

## Backlog — ranked by ROI

### #3 — Trigger-based handoff (medium-high ROI, ~1-2 days)
Agentspan's `OnToolResult(tool_name="check_order", target="refund")` and
`OnTextMention(text="escalate", target="supervisor")` replace manual persona-switching
logic with declarative rules.

**For VisionClaw:** today, persona switching happens via `delegate_task` and
ad-hoc routing in chat-engine. A `HandoffRule` interface (siblings to Termination
and Guardrail) would let each persona declare "if my reply contains 'X' OR I called
tool 'Y', hand off to persona 'Z'". File ref in agentspan: `sdk/python/src/agentspan/agents/handoff.py`.

**Risk:** low. Pure declarative. Wire into ceo-orchestrator first as an opt-in.

### #4 — Durable HITL pause (medium ROI, medium effort, ~3-5 days)
Agentspan's `@tool(approval_required=True)` pauses the workflow durably — process
can die, human approves 3 days later from any machine, work resumes from exact point.
Demonstrated in `09_human_in_the_loop.py` and `78_approval_workflow.py`.

**For VisionClaw:** `agentic/approvals.ts` does in-process approval today. The
days-long durable version would need: (a) persistent pause state in DB (we have
`agentic_plans` with status=paused), (b) wake hook that re-hydrates context on
approval, (c) timeout + auto-cancel policy. Most of (a)+(b) already exists in
the stuck-plan sweep + resume-worker; we'd just need to add an approval-specific
state machine on top.

**Risk:** medium. Touches DB state, but reuses existing infra.

### #5 — Compile-step for prompt assembly (HUGE cost ROI, 1-2 weeks)
Agentspan compiles agent definitions into static workflow JSON at registration
time, not interpreted per-call. VisionClaw's `buildSystemPrompt()` runs every
chat turn assembling memory + skills + persona + KB + tool docs from scratch
(~30K char system prompt).

**For VisionClaw:** cache by `(persona_id, tenant_id, context_hash)` where
context_hash captures the inputs (active KB version, persona version, tool
roster). Could cut 30-50% of system-prompt token spend. This was also the #1
finding from the cost-review architect on Apr 25, 2026.

**Risk:** medium-high. Touches the chat hot path. Must guarantee cache invalidation
fires on every persona/KB/skill change. Recommend prototyping in shadow mode
first (compute hit rate without serving from cache).

### #6 — Tool-level circuit breaker (low effort, medium ROI, ~1 day)
Agentspan's `_dispatch.py` has per-tool error counts → auto-disable after N
failures with cooldown. VisionClaw's `tool-learning.ts` has the data but doesn't
auto-quarantine. Adding a 5-failures-in-60s → 5-min-quarantine policy would
prevent runaway error loops.

**Risk:** low. Pure additive policy on top of existing telemetry.

### #7 — AGENTS.md / SKILL.md split (low effort, low-medium ROI)
Agentspan ships two separate docs: README.md (humans) + AGENTS.md (AI coding
agents working on the codebase) + SKILL.md (AI agents USING the SDK). VisionClaw's
replit.md is mega (2000+ lines, hot version log + architecture + user prefs +
known issues all mixed).

**For VisionClaw:** split replit.md into:
  - `replit.md` — operator notes + recent version log (last 5 versions)
  - `AGENTS.md` — "if you're an AI agent modifying this codebase, read this"
    (architecture, conventions, hard rules like the psql/db:push policy)
  - `docs/version-history.md` — archived version log entries

**Risk:** zero. Pure docs reorg. Slight risk that future agents read the wrong file
and miss critical rules — mitigate by cross-linking.

### #8 — `/examples/` directory pattern (low effort, ongoing ROI)
Agentspan has 180+ runnable examples (`01_basic_agent.py` through `97_*.py`),
one per pattern. Each is self-contained, runnable, documented in 30-60 lines.

**For VisionClaw:** create `server/examples/` with one runnable per pattern:
persona invocation, delegate_task, KB search, voice transcription, agentic plan,
guardrail chain, termination chain. Each example doubles as integration test
AND onboarding doc.

**Risk:** zero. Pure additive.

### #9 — Universal credentials with scoped exec tokens (medium ROI, medium effort)
Agentspan stores creds encrypted (AES-256-GCM) on the server, declared per-tool
(`credentials=["GITHUB_TOKEN"]`), and workers receive scoped tokens that EXPIRE
WITH THE EXECUTION. No env var passed to subprocess; no secret persisted in worker
process memory longer than needed.

**For VisionClaw:** today we use Replit Secrets + `process.env.X` directly. The
scoped-execution-token pattern would be useful for delegated subagents that should
only have access to specific creds (e.g. a research subagent gets only the
search-API key, not the full env). Useful security hardening when we move toward
multi-tenant SaaS.

**Risk:** medium. Touches secret loading paths. Defer until SaaS migration.

### #10 — Multi-sandbox code executor (medium ROI, medium-high effort)
Agentspan ships 4 code-execution sandboxes: Local, Docker, Jupyter, Serverless.
VisionClaw's `internal_code_runner` is single-mode.

**For VisionClaw:** route by trust level — internal scripts use Local (fast),
user-uploaded code uses Docker (isolated), data-science notebooks use Jupyter,
edge functions use Serverless. Big surface-area reduction for "user pasted
malicious code".

**Risk:** medium-high. Adds new infrastructure. Defer until we have user-supplied
code execution as a real product feature.

## Don't steal (deliberately rejected)

❌ **Conductor as runtime engine** — Java workflow server, separate process,
Kubernetes deployment. Too heavy for VisionClaw today. The DURABILITY ideas
are worth borrowing piecemeal (see #4); the engine is overkill until we have
multi-machine scale.

❌ **Pipeline `a >> b >> c` operator overload** — cute Python sugar, doesn't
translate cleanly to TS/Express. We have `delegate_task` chains and the
agentic plan executor; that's enough.

❌ **Go CLI tooling** — VisionClaw has Replit-native CLI patterns (npm scripts,
shell helpers). Adding Go would just create a maintenance burden.

❌ **180+ examples format with PyPI naming** — adopt the pattern (#8) but not
the numeric prefix convention; use kebab-case like the rest of our codebase.

## How to use this log

When picking the next round of architecture work:
1. Read this file top to bottom.
2. Pick the highest-ROI item that fits the current sprint's risk budget.
3. Move it from "Backlog" to "Shipped" with the version number.
4. Update the Risk note based on what you learned.
5. If a new agentspan release lands with new patterns, append below.

---

## Reference: Abstract Chain-of-Thought (IBM Research, arXiv 2604.22709v2, Apr 2026)

**Filed:** 2026-05-03 — parked as reference, no action.

**Paper:** Ramji, Naseem, Astudillo. "Thinking Without Words: Efficient Latent
Reasoning with Abstract Chain-of-Thought." Replaces verbal CoT with a short
sequence of reserved abstract tokens; 11.6× fewer reasoning tokens at
comparable accuracy on MATH-500, AlpacaEval, HotpotQA. Two-stage recipe:
(1) policy-iteration warm-up alternating bottlenecked SFT + self-distillation,
(2) GRPO RL with constrained decoding to the abstract vocabulary. Emergent
power-law over the abstract token vocabulary.

**PDF on file:** `attached_assets/2604.22709v2_1777799747568.pdf`

**Why it doesn't apply to VisionClaw today:** Requires post-training on a
base model we control (we consume frontier APIs — gpt-5.4, claude-sonnet-4,
gemini-2.5, xAI). Requires tokenizer surgery to add reserved tokens. None
of this is reachable via the OpenAI/Anthropic/Gemini APIs.

**Two thin nuggets noted (no code change):**
1. Empirical confirmation that aggressive prompt compression preserves
   reasoning quality — supports pushing `lean-context` thresholds harder.
   Felix HVAC test already shows ~7× compression working (4088 chars vs
   ~30K full); paper suggests 11× is achievable on the model-internal side.
2. The teacher-demonstrates → student-internalizes loop is structurally
   identical to our `auto-skill` extraction (observe successful tool chains
   → synthesize compact skill recipes). Confirms the architectural shape;
   could justify earlier promotion of skill candidates from the candidate
   pool to the active registry.

**Becomes relevant if:** we ever ship a small in-house task-specific model
(e.g., a tiny tenant-policy classifier, a routing head). Until then,
ignore.
