# Threat Model

> Project-level security reference for VisionClaw. Describes assets, trust boundaries, the
> STRIDE threat surface, and — the centerpiece — a cross-map of our **existing** defense-in-depth
> controls to **MITRE ATLAS**, **NIST AI RMF 1.0**, and the **OWASP LLM Top 10 (2025)**.
> Another agent should read this before making a security decision or relaxing any guard.
> Control architecture detail lives in `.agents/skills/security-hardening/SKILL.md`; this file
> is the standards-mapped, auditable view of what those controls cover and where the gaps are.

## Project Overview

VisionClaw is a multi-tenant agentic-AI platform: a 16-persona AI team performing corporate
functions (CEO planning, media generation, invoicing/CRM/contracts, autoresearch, autonomous
heartbeat ops). Stack: React 18 + Vite frontend; Express.js + TypeScript + Helmet backend;
PostgreSQL + pgvector; Drizzle ORM; Zod validation. Consumer-facing personas (e.g. health
coaches) take untrusted public input; autonomous personas (Felix) hold destructive tool access.
Hosted on Replit; auth via Replit Auth (OIDC).

Because the product **is** an LLM agent system with tool-calling, our threat surface is the union
of (a) classic web AppSec and (b) AI/ML-specific adversarial threats (prompt injection,
jailbreaks, tool abuse, training/memory poisoning). The cross-map below covers both.

## Assets

- **Tenant data isolation** — the highest-value asset. 211 tables enforce `tenant_id` via
  app-level WHERE clauses. A cross-tenant read/write is the worst-case breach.
- **User credentials & sessions** — Replit Auth OIDC tokens, session cookies (`SESSION_SECRET`),
  `HITL_TOKEN_SECRET`, `ADMIN_PIN`. Compromise allows impersonation / privilege escalation.
- **Application secrets** — `DATABASE_URL`, provider API keys (OpenAI/Anthropic/Gemini/ElevenLabs/
  Stripe), `GITHUB_PERSONAL_ACCESS_TOKEN_2`, OAuth refresh tokens. Many move money or mutate prod.
- **Tool-call authority** — the ability to invoke destructive tools (money movement, mass email,
  data deletion, prod mutation, credential exposure). This is an *agentic* asset: the LLM is an
  untrusted actor that can be socially engineered into emitting dangerous calls.
- **Memory & knowledge stores** — `mnema_facts`, `knowledge_library`, vector embeddings.
  Poisoning these corrupts future agent decisions (persistent, cross-session).
- **PII in untrusted ingest** — inbound email, web fetch, OCR, social DMs, uploads.
- **Business data** — invoices, CRM, contracts, leads, finance per tenant.

## Trust Boundaries

- **Browser ↔ API** — every client request is untrusted. CSRF middleware on `/api`, Zod
  validation via `validate()` middleware, Helmet headers.
- **API ↔ PostgreSQL** — parameterized `${value}::type` only; `sql.raw()` with user input is
  banned. Tenant scope enforced in the WHERE clause (no FK, app-level).
- **API ↔ external services** — outbound provider calls; SSRF jail with connect-time IP pinning
  (`server/lib/ssrf-jail.ts`, `server/lib/fetch-with-timeout.ts`).
- **Public ↔ authenticated ↔ admin** — public wedge landings + lead capture are unauthenticated;
  most surfaces require session; admin/owner surfaces gated on admin-tenant ∧ owner-channel.
- **Human ↔ LLM (the agentic boundary)** — the model is a *semi-trusted actor*. User text, tool
  outputs, and retrieved content are all untrusted inputs to the model; model output (esp. tool
  calls) is untrusted until policy-checked. This is the boundary the 4-layer stack defends.
- **Internal ↔ production** — autonomous loops (heartbeat, self-heal, jury) run with elevated
  authority; fail-closed budget claims + prod-only guards bound them.

## Scan Anchors

- **Production entry points:** `server/chat-engine.ts` (`processMessage`), `server/routes/**`,
  `server/guarded-tool-executor.ts` (`executeGuardedTool`).
- **Highest-risk code areas:** `server/safety/**` (intent-gate, destructive-tool-policy,
  plan-step-authz, spawn-env-guard, danger-rails, held-out-eval-gate, transactional-snapshot),
  `server/tools.ts` (tool definitions + executors), `server/external-content-security.ts`,
  `server/safety-guard.ts`, `shared/schema.ts` (tenant_id invariant).
- **Public/unauthenticated:** `/api/public/**` (gallery, trust, skills, leads/audit,
  archive-rescue), webhooks (Twilio, cron).
- **Dev-only (ignore unless proven reachable in prod):** `.local/**`, `scripts/*stress-test*`,
  mockup sandbox, `tests/**`.
- **Audit tables:** `security_intent_checks`, `security_tool_blocks`.

## Threat Categories (STRIDE)

### Spoofing
Replit Auth validates session on protected routes. Webhooks (Twilio, cron) must verify
signatures / `CRON_SECRET`. The agentic risk: a workflow step or tool arg spoofing an approval
signal (`_approvedByGate`) or identity (`_tenantId`/`_personaId`/`_conversationId`) to
self-authorize. **Guarantee:** autonomous step executors strip all caller-supplied trust signals
and source approval only from trusted `ctx`; the central guarded-tool executor never reads
caller-authored approval fields (hardened R125+69–71).

### Tampering
Client-supplied values (price, quantity, recipient counts, tenant) are never trusted; server
recomputes and re-derives tenant from session. Destructive-tool `maxValue` caps numeric args.
Memory/knowledge writes from untrusted ingest must pass the 3-gate pattern. **Guarantee:** all
state-mutating values are server-derived or policy-capped; no client-supplied authority survives.

### Repudiation
Every intent-gate decision (allow + block) → `security_intent_checks`; every destructive-tool
block → `security_tool_blocks`; decline-events telemetry; restraint+action reputation channels.
**Guarantee:** sensitive agent actions (tool blocks, jailbreak attempts, money/comms) are
audit-logged with actor, tenant, timestamp, redacted args.

### Information Disclosure
Cross-tenant leakage is the top risk: enforced by mandatory `tenant_id` WHERE clauses. Secrets
never in logs/responses/client code; PII redaction at untrusted-ingest storage boundary (gate 1).
SSRF jail prevents server-side fetch of internal endpoints. **Guarantee:** every data query is
tenant-scoped; secrets and PII never cross the API or log boundary in cleartext.

### Denial of Service
Rate limiting on public endpoints; bounded autonomous loops (atomic daily budget claim before
spend; ~25k/day reflexive ceiling; per-probe timeouts on health tools); fail-open hard timeouts
on awaited LLM calls in hot paths; chunk-and-parallel caps long jobs at ≤5 min. **Guarantee:**
no unauthenticated or autonomous path can exhaust compute/credits without a bounding gate.

### Elevation of Privilege
The dominant agentic EoP vector: convincing the LLM (via jailbreak) to invoke a destructive tool,
or a non-admin plan escalating to admin-tenant. Defended by the destructive-tool policy
(fail-closed) + plan-step-authz (persona/tenant derivation) + owner-driven shell gate
(admin-tenant ∧ owner-channel). Classic EoP (SQLi, command injection, path traversal, insecure
deser) covered by parameterized SQL, spawn-env-guard, ssrf-jail, Zod. **Guarantee:** destructive
authority requires a trusted persona + structured args + verified approval + value cap, and
fails closed if any cannot be proven.

---

## AI/ML Threat Framework Cross-Map

This is the auditable view: each VisionClaw control mapped to the recognized AI-security
standards. Use it to answer "are we covered against X?" and to show evaluators a
standards-aligned posture. `✓` = control live; `◑` = partial / documented gap; `—` = N/A.

### MITRE ATLAS (AI/ML adversarial tactics)

| ATLAS tactic / technique | VisionClaw control | File | State |
|---|---|---|---|
| Reconnaissance / Model access | No public model weights; BYO-keys, self-hosted | — | ✓ |
| **AML.T0051 LLM Prompt Injection** (direct) | Intent gate (AHB) — stylistic-jailbreak destyler + fallback regex | `server/safety/intent-gate.ts` | ✓ |
| **AML.T0051 Prompt Injection** (indirect, via content) | External-content security — wraps inbound email / `web_fetch` / `web_search` content before prompt assembly (no webhook callsite yet) | `server/external-content-security.ts` | ✓ |
| **AML.T0054 LLM Jailbreak** | Intent gate `strict`/`moderate` per persona `safety_profile`; AHB regression suite in CI | `server/safety/intent-gate.ts`, `tests/security/ahb-regression.test.ts` | ✓ |
| **AML.T0053 LLM Plugin Compromise** (tool abuse) | Destructive-tool policy (fail-closed: trusted persona + structured args + approval + value cap); unregistered suspicious-name tools fail closed by inference (not defaulted `safe`) | `server/safety/destructive-tool-policy.ts` | ✓ |
| **AML.T0048 External Harm / unsafe action** | Plan-step authz + owner-driven shell gate + transactional no-regression snapshot for irreversible tools | `server/safety/plan-step-authz.ts`, `server/safety/transactional-snapshot.ts` | ✓ |
| **AML.T0024 Exfiltration / secret leak in output** | Egress sanitizer (`sanitizeAgentOutput`) scrubs credentials/secrets before assistant message persistence | `server/chat-engine.ts` | ✓ |
| **AML.T0070 RAG poisoning** / memory poisoning | Memory V2 confidence scoring + supersession; central pre-INSERT redaction guard on every durable-store write (`memory_entries`, `agent_knowledge`, `conversation_facts` + the step-ledger direct insert) | `server/storage-helpers/pii-redaction-guard.ts` | ✓ (secrets+SSN+CC always redacted; email/phone classify-only by default) |
| **AML.T0020 Poison Training Data** | We don't train/fine-tune; no weight updates | — | — |
| **AML.T0024 Exfiltration via ML inference** | Tenant-scoped retrieval; secrets vaulted behind opaque handles (gate 2) | — | ◑ |
| Supply chain (ML) — **AML.T0010** | Dependency audit + lockfile pinning (technical); MCP description audit script run before install / in weekly sweep (procedural, not a hard install-time gate) | `scripts/audit-mcp-descriptions.ts` | ◑ |
| **AML.T0029 Denial of ML Service** | Bounded loops + rate limits + hot-path timeouts (see STRIDE DoS) | various | ✓ |

### NIST AI RMF 1.0 (GOVERN / MAP / MEASURE / MANAGE)

| Function · subcategory | VisionClaw control | State |
|---|---|---|
| **GOVERN 1** — policies & accountability | `security-hardening` runbook; hard rules (never `safe`-class a destructive tool; never disable intent gate in prod) | ✓ |
| **GOVERN 4** — safety culture / fail-safe defaults | Intent gate fails OPEN (logged loud); destructive-tool policy fails CLOSED — documented, deliberate | ✓ |
| **MAP 1** — context & risk framing | This threat model; per-persona `safety_profile` (intentGate level + restrictedCategories + refusalCopy) | ✓ |
| **MAP 5** — impact characterization | `maxValue` caps + `requiresApproval` for money/mass-comms/deletion tools | ✓ |
| **MEASURE 2.6** — safety / adversarial robustness | AHB regression suite (≥5 attack + 3 benign fixtures per consumer persona) in CI | ✓ |
| **MEASURE 2.7** — security & resilience | Tenant-isolation audit nightly; SAST/dependency/HoundDog scans; held-out eval gate against verifier-gaming | ✓ |
| **MEASURE 3** — monitoring & tracking | `security_intent_checks` + `security_tool_blocks` audit tables; ASR queries | ✓ |
| **MEASURE 4** — feedback / drift | MoA jury concordance (κ) routing; decline-events telemetry; Orchestration Efficiency card | ✓ |
| **MANAGE 1** — risk response / triage | Jury-decides-and-ships (2-of-3 vote) → auto-apply / queue / escalate-owner; incident triage runbook | ✓ |
| **MANAGE 2.4** — fail-safe / shutdown | Killswitch + daily $ ceilings on owner-override paid lanes; budget claim CAS | ✓ |
| **MANAGE 4** — post-incident | Jailbreak triage → add regression fixture; owner-notification on critical findings | ✓ |

### OWASP LLM Top 10 (2025)

| Risk | VisionClaw control | State |
|---|---|---|
| **LLM01 Prompt Injection** | 4-layer stack (external-content → crisis guard → intent gate → tool policy) | ✓ |
| **LLM02 Sensitive Information Disclosure** | Tenant scoping, secret vaulting (gate 2), egress sanitizer (`sanitizeAgentOutput`) before message persistence, no secrets in logs/responses | ✓ |
| **LLM03 Supply Chain** | Dependency audit + lockfile pinning (technical); MCP description audit script (procedural, run pre-install / weekly) | ◑ |
| **LLM04 Data & Model Poisoning** | Memory confidence/supersession; central pre-INSERT PII/secret redaction guard on all durable-store writes (`pii-redaction-guard.ts`) | ✓ (secrets+SSN+CC always; email/phone classify-only) |
| **LLM05 Improper Output Handling** | Tool calls policy-checked before execution; structured-args requirement rejects free-text prose args | ✓ |
| **LLM06 Excessive Agency** | Destructive-tool policy + plan-step-authz + HITL approval + owner-driven shell gate | ✓ |
| **LLM07 System Prompt Leakage** | Personas/prompts server-side; auto-applied prompt addenda pass a fail-closed semantic safety-weakening validator | ✓ |
| **LLM08 Vector & Embedding Weaknesses** | Tenant-scoped vector retrieval; decorrelated kin scoring | ◑ |
| **LLM09 Misinformation** | MoA jury + CoVe + completion-verification by a separate model vs goal contract | ✓ |
| **LLM10 Unbounded Consumption** | Bounded loops, rate limits, hot-path timeouts, budget caps | ✓ |

---

## Gap Check (vs. external "AI Security / AppSec / Supply Chain" skill domains)

Checklist outcome from reviewing the three domains relevant to a *self-defending* agent SaaS
(the rest of that 817-skill library is SOC/red-team operator playbooks — out of scope; see the
external-repo verdict in agent memory). Items below are the honest residual gaps, not new
findings to panic over:

1. **Gate-1 PII redaction at the storage boundary (✓, central guard now live).** Closed: a
   single `redactPiiForStorage` / `redactRecordFields` guard (`server/storage-helpers/
   pii-redaction-guard.ts`) is wired into every durable-store write path —
   `storage.createMemoryEntry` / `updateMemoryEntry`, `createKnowledge` / `updateKnowledge`,
   `createConversationFact`, and the one direct `agent_knowledge` insert in `step-ledger.ts`
   (audited: those are the only write paths to these tables). It composes the existing
   48-pattern secret scanner and ALWAYS strips credential-shaped secrets, Luhn-validated credit
   cards, and US SSNs. **Honest residual scope:** email + phone are *detected/classified* but
   NOT stripped by default — they are frequently legitimate CRM/business facts, so blanket
   stripping would break memory. Untrusted public-ingest call sites can opt in via
   `redactContactInfo: true`. Remaining nuance: non-free-text columns and any *future* new
   durable store must adopt the guard (the structural choke-point only covers the 3 audited
   tables + step-ledger).
2. **Embedding/vector poisoning hardening (LLM08 / AML.T0070, ◑).** Retrieval is tenant-scoped
   and confidence-weighted, but there's no explicit anomaly check on ingested embeddings.
   Low priority (retrieval is already isolated + confidence-gated).
3. **AI-RMF documentation legibility.** This cross-map is the first standards-aligned artifact;
   keep it current when a new persona, tool class, or external input surface ships
   (same trigger as the `security-hardening` skill).
4. **Covered, no action:** prompt injection (direct+indirect), jailbreaks, tool abuse / excessive
   agency, supply chain, DoS/unbounded consumption, output handling, system-prompt leakage,
   spawn/loader hijack, SSRF, SQLi — all have live controls mapped above.

**Bottom line:** posture is strong and now standards-mapped. The central storage-boundary PII
gate (residual item #1) is now LIVE — a single guard on every durable-store write path strips
secrets/SSN/CC and classifies contact info. The one remaining real residual is the
vector-poisoning anomaly check (#2, low priority — retrieval is already tenant-scoped +
confidence-gated).
