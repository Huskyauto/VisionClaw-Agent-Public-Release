# VisionClaw → Fable 5 Consultation Packet

**Purpose:** You (Fable 5) previously audited the VisionClaw *public mirror* and returned 7 findings. The maintainer has since implemented some and deferred others. This packet gives you full context so your next answers are grounded. There are **four prompts** at the end — you can answer any or all.

> **CRITICAL CAVEAT — read first.** You only have access to the **sanitized public mirror**, not the private production tree. The mirror can carry stale counts, redactions, and build artifacts. External reviews of the mirror have historically manufactured false positives (mirror artifacts) *and* hidden real wins (already-fixed code that looks unfixed in the mirror). So: **mark every claim with a confidence level, state your assumptions explicitly, and flag anything you cannot verify from a sanitized mirror.** The maintainer will re-verify each of your points against the real private tree before acting.

---

## 1. Project snapshot

**VisionClaw** is a multi-tenant agentic-AI SaaS: a 16-persona AI team performing corporate functions (CEO-style planning, media generation, invoicing/CRM/contracts/leads/finance, autoresearch, an autonomous heartbeat, HITL approvals, self-improvement loops).

- **Stack:** React 18 + Vite + shadcn/ui + Tailwind + Wouter + TanStack Query v5 (frontend); Express.js + TypeScript + Helmet (backend); PostgreSQL + pgvector; Drizzle ORM; Zod validation. Hosted on Replit; auth via Replit Auth (OIDC).
- **Scale (approximate, from the private tree):** ~394 tools, ~212 live DB tables, ~129 capabilities, 16 personas, ~623 indexes, ~41 governance rules.
- **Highest-value asset:** tenant data isolation — enforced by app-level `WHERE tenant_id = ...` clauses (no FK), every INSERT must pass `tenantId` explicitly.
- **Trust model:** the LLM is a *semi-trusted actor*. User text, tool outputs, and retrieved content are all untrusted inputs; model output (especially tool calls) is untrusted until policy-checked.

**4-layer safety stack (the core defense):**
1. **External-content security** — wraps untrusted inbound content (email, `web_fetch`, `web_search`) before prompt assembly.
2. **Crisis / safety guard.**
3. **Intent gate (AHB)** — per-persona `strict`/`moderate` level via a `safety_profile`; **fails OPEN** (logged loud); has a CI regression suite.
4. **Destructive-tool policy** — **fails CLOSED**: a destructive tool requires trusted persona + structured args + verified approval + numeric value cap, else it's blocked.

Autonomous personas (e.g. "Felix") hold destructive tool access; consumer-facing personas take untrusted public input.

---

## 2. Your original audit — the 7 findings

1. **VM code sandbox is regex-gated, not truly isolated.** `server/code-sandbox.ts` blocks dangerous constructs with a regex blocklist (`/\.constructor/`, `/eval\(/`, etc.). A regex can't stop computed access like `x["const"+"ructor"]`. This sandbox executes LLM-generated tool code (via `tool-learning.ts`), so it's a real RCE-surface concern.
2. **PIN_PEPPER weakened silently.** Admin-PIN hashing fell back to a *public* static salt when `PIN_PEPPER` was unset, emitting only a `console.warn` — a security control that can be silently not-in-effect in production.
3. **Silent-failure baseline binds only external PRs.** The mirror's silent-failure CI baseline is computed in a way that governs contributor PRs but not the owner's own direct commits.
4. **Metric drift, including inside the "source of truth" doc.** `docs/CURRENT_PLATFORM_TOTALS.md` claimed `scripts/refresh-totals.ts` "has been removed" (it exists), and declared-table counts had drifted.
5. **`tools.ts` is ~20,900 lines.** A single monolithic file defines and registers ~394 tools — a maintainability and review-surface risk.
6. **`exec` deny-list framing.** The way the shell-exec deny-list is described/marketed understates or misframes the control.
7. **README / distribution polish.** The public README is long; no demo GIF; no `v1.0.0` release tag — hurts first-impression and adoption on the open-source mirror.

*(Plus a smaller note: extend the prompt-injection scanner with "new instructions:" framing and markdown-image exfiltration patterns.)*

---

## 3. What the maintainer did with your findings

**IMPLEMENTED this session:**
- **(#2) PIN_PEPPER now fails closed** — throws on boot in production if unset, mirroring the existing `SESSION_SECRET` guard. (PIN_PEPPER is confirmed set, len 64, so the live deploy is safe.)
- **(injection note) Scanner extended** — added markdown-image + HTML-image exfiltration patterns (medium severity: annotate + raise risk score, non-blocking so legit images aren't broken) and a broader "here are your new instructions" framing pattern (high). Backed by a new regression test; validated that attacks fire and benign images/text don't false-positive.
- **(#1) Sandbox hardened + made honest** — added computed-member-access blocklist patterns and a comment clarifying that the **real** control is `codeGeneration: { strings: false, wasm: false }` on the vm context (which defeats the constructor→Function string-compilation escape), and the regex is defense-in-depth only. The vm engine was **not** swapped (moving to `isolated-vm` needs a new native dependency = deliberate ask-first decision).
- **(#4) Doc corrected** — fixed the false "refresh-totals.ts was removed" claim (it exists and has a `--check` CI-gate mode) and the declared-table drift.

**DEFERRED with reasoning (open questions for you):**
- **(#5) Split `tools.ts`** — worth doing, but too large/risky for a drive-by; wants a dedicated, incremental plan.
- **(#7) README / demo GIF / `v1.0.0` tag** — presentation polish, subjective.
- **(#3) Bind silent-failure baseline to owner commits** — a CI-process change needing care.
- **(#6) `exec` deny-list framing** — minor copy.
- **Wiring `refresh-totals.ts --check` as a hard CI gate** — currently blocked because its raw `registerTool(` grep *overcounts* the tool total (the authoritative 394 comes from a 3-source reconciliation), so the generator's tool number must be reconciled by hand before it can gate CI.

---

## 4. Prompts

### Prompt A — Stress-test the triage above (highest priority)

Critique the maintainer's triage in §3. Did they wrongly deprioritize anything that is actually security- or correctness-relevant? Is any "implemented" fix incomplete or falsely reassuring (e.g. does the PIN_PEPPER throw have a gap; is the sandbox comment overclaiming; do the new injection regexes have catastrophic-backtracking or over-block risk)? Rank your disagreements by severity, and name the **single** change you think they are most wrong to have deferred. Mark confidence per point.

### Prompt B — Decomposition plan for the 20.9k-line `tools.ts` (deferred #5)

An Express + TypeScript agentic platform has a single `tools.ts` (~20,900 lines) that defines and registers ~394 agent tools via a `registerTool(name, def, executor)` registry. Constraints: a wiring-audit script asserts every registered tool is reachable; an `ALWAYS_INCLUDE` policy and a `PLATFORM_TOOLS_CONTRACT` reference tool names; personas carry per-tool allowlists; tests import specific executors.

Design a **safe, incremental** decomposition into domain modules that never breaks the single-registry invariant or the wiring audit. Provide: (1) a module taxonomy by domain; (2) the exact extraction **order** (lowest-risk first) with mechanical steps per module; (3) how to keep imports/wiring green at every commit (barrel file? re-export shim?); (4) the specific failure modes to watch for; (5) a rollback-checkpoint strategy. Assume no big-bang PR is allowed — it must be a sequence of independently-shippable, test-green steps.

### Prompt C — Adversarial red-team of the 4-layer safety stack

Using the safety architecture described in §1, act as a red-teamer. Produce concrete, **testable** bypass hypotheses ranked by severity. For each: the attack premise, the exact step that would fail or leak, and a minimal regression test that would prove it's closed. Focus on: intent-gate fail-open abuse; cross-tenant leakage via caller-supplied trust fields (`_tenantId`/`_personaId`/`_approvedByGate`); destructive-tool argument smuggling; and indirect prompt injection via retrieved/ingested content. Flag which hypotheses you cannot verify from a sanitized mirror.

### Prompt D — Capability expansion, not just speed (optional)

This solo-founder platform already has an ensemble-query jury, chunk-and-parallel orchestration, and chain-of-verification. Instead of "how do we ship the current backlog faster," answer: what **category** of product or capability do these velocity multipliers unlock that was previously infeasible for a one-person team? Give 3 concrete, differentiated directions, each with the first proof-of-concept milestone and the main risk.

---

*When you reply, structure each answer so individual points can be lifted out and acted on independently. Prefer specificity (file/function/test names, exact steps) over general advice, but tag anything you're inferring rather than verifying.*
