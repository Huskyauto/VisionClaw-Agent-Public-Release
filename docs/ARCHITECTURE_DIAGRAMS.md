# VisionClaw Architecture Diagrams

Visual companion to `README.md`, `docs/SECURITY_ARCHITECTURE.md`, and
`docs/architecture-notes.md`. These Mermaid diagrams render natively on GitHub.
They document the **core runtime flows** so a new contributor can build a mental
model before reading 200k lines of TypeScript.

> Source of truth is always the code. If a diagram drifts from
> `server/chat-engine.ts`, `server/moa.ts`, `server/safety/`, or
> `server/delivery-pipeline.ts`, the code wins — fix the diagram.

---

## 1. Request lifecycle (HTTP → tenant-scoped data)

Every authenticated API request is wrapped in a tenant context before it ever
touches storage. Public surfaces (landing pages, health checks) take an explicit
no-context bypass.

```mermaid
flowchart TD
    A[Client / React SPA] -->|"x-csrf-token + session cookie"| B[Express]
    B --> C[Helmet security headers]
    C --> D[CSRF middleware<br/>/api global, skip-list]
    D --> E{Authenticated<br/>tenant?}
    E -->|"yes"| F[AsyncLocalStorage<br/>tenant context]
    E -->|"public route"| G[no-context bypass]
    F --> H[Route handler<br/>server/routes/*.ts]
    G --> H
    H --> I[Storage layer<br/>WHERE tenant_id = ?]
    I --> J[(PostgreSQL + pgvector)]
    J -->|"RLS second line of defense"| I
    H --> K[Global error middleware<br/>server/index.ts]
```

---

## 2. AHB safety layer (intent gate + destructive-tool policy)

The Adversarial-Hardening-Baseline layer is non-negotiable. The two gates fail
in **opposite** directions on purpose: the intent gate fails OPEN (never blocks
legitimate work, but logs loud), while the destructive-tool policy fails CLOSED
(an unregistered destructive tool is refused, not allowed).

```mermaid
flowchart TD
    A[Persona wants to call a tool] --> B{Intent gate<br/>safety_profile.intentGate}
    B -->|"clear"| D[Tool dispatch]
    B -->|"flagged"| C[Refusal copy<br/>+ decline-events telemetry]
    B -.->|"gate error"| D
    D --> E{In TOOL_POLICIES?<br/>destructive-tool-policy.ts}
    E -->|"safe / registered + allowed"| F[Execute tool]
    E -->|"destructive + not registered"| G[BLOCK fail-closed]
    E -.->|"policy lookup error"| G
    F --> H[Result → persona]
    C --> I[Reputation channels<br/>restraint + action]
    G --> I

    classDef open fill:#1f6f43,color:#fff;
    classDef closed fill:#7a1f1f,color:#fff;
    class B open;
    class E closed;
```

- **Fail-OPEN (green):** intent gate — logged loudly, never silently swallows.
- **Fail-CLOSED (red):** destructive-tool policy — default for an unregistered
  destructive tool is refusal.

---

## 3. Felix autonomous loop (the "AI Corporation" heartbeat)

Felix (the CEO persona) drives autonomous corporate ops. Work originates from
the heartbeat / scheduled tasks, is planned, delegated to specialist personas,
and gated by HITL before anything irreversible ships.

```mermaid
flowchart TD
    A[Heartbeat / scheduled_tasks] --> B[Felix CEO plan]
    B --> C{Classify request<br/>cheap small-model}
    C --> D[Specialist personas<br/>16-persona team]
    D --> E[Tool calls<br/>research / media / finance / comms]
    E --> F{HITL gate?<br/>money · mass-comms · deletes}
    F -->|"needs approval"| G[Owner approval queue]
    F -->|"auto-safe"| H[Deliver]
    G -->|"approved"| H
    H --> I[deliver_product<br/>delivery-pipeline.ts]
    H --> J[Telemetry → ecosystem-health<br/>/admin/ecosystem-health]
```

---

## 4. MoA jury, κ concordance & Fusion second-opinion escalation

`ensemble_query` is the default for any "thinking" prompt. Multiple proposer
models answer; concordance (κ = mean pairwise embedding cosine) decides whether
the answer is trustworthy or should escalate. Low confidence auto-fires a Fusion
cross-check **before** burning a human.

```mermaid
flowchart TD
    A[ensemble_query] --> B[N proposer models]
    B --> C[Aggregator synthesizes]
    C --> D[κ = mean pairwise<br/>embedding cosine]
    D --> E{κ ≥ 0.5 and<br/>multi-proposer?}
    E -->|"yes — concordant"| F[Return answer]
    E -->|"no — shouldEscalate"| G[second_opinion<br/>OpenRouter Fusion]
    G --> H{Resolved?<br/>fail-open, budget-capped}
    H -->|"yes"| F
    H -->|"still low confidence"| I[ESCALATE → owner-notification / HITL]

    classDef budget fill:#5a3d00,color:#fff;
    class G budget;
```

- `second_opinion` runs under a dedicated owner-only daily Fusion cap
  (atomic reserve-then-settle) and **never throws** — it fails open and is
  latency-bounded by a hard timeout.

---

## 5. Delivery pipeline (instant-play, Drive-lag-proof)

All human-facing file deliveries — for customers **and** the owner — go through
`deliverDigitalProduct()`. Direct `uploadToDrive()` calls are forbidden because
Drive's mobile app fakes "still processing" indefinitely on valid MP4s.

```mermaid
flowchart TD
    A[Agent produces file] --> B[deliver_product tool]
    B --> C[deliverDigitalProduct<br/>delivery-pipeline.ts]
    C --> D[Upload to Google Drive]
    C --> E["Self-hosted streaming route<br/>/uploads/delivery-N-filename<br/>Content-Type + Accept-Ranges: bytes"]
    D --> F[Drive viewUrl]
    E --> G[Instant-play URL]
    F --> H[Chat + companion email]
    G --> H
```

---

## 6. Tenant isolation — defense in depth (app layer + RLS phases)

Tenant isolation has two independent lines of defense. The app layer is the
first; Postgres Row-Level Security is the second, so a future code edit that
drops a `WHERE` clause still cannot leak cross-tenant rows. RLS is being rolled
out in staged phases (see `docs/rls-rollout-plan.md`).

```mermaid
flowchart LR
    subgraph L1["Line 1 — application"]
        A[AsyncLocalStorage<br/>tenant context] --> B[Every storage query<br/>WHERE tenant_id = ?]
    end
    subgraph L2["Line 2 — database (RLS)"]
        C[withTenantTx<br/>SET LOCAL app.current_tenant] --> D[RLS policy<br/>per row check]
    end
    B --> C
    D --> E[(PostgreSQL)]

    subgraph Phases["RLS rollout"]
        P1["Phase 1 — AUDIT<br/>14 tables, fail-open w/o context"]
        P2["Phase 2 — STRICT opt-in<br/>STRICT_RLS=1, per-request txn"]
        P3["Phase 3 — FORCE per table<br/>superuser bypass removed"]
        P4["Phase 4 — expand to all<br/>tenant-scoped tables"]
        P1 --> P2 --> P3 --> P4
    end
```

---

## 7. Memory V2 / MNEMA — write path & retrieval

Every durable memory write passes the PII/secret redaction guard, gets a
confidence score, and can be superseded (never hard-deleted) when a newer fact
contradicts it. Retrieval is tenant-scoped, confidence-weighted, and re-ranked
with decorrelated kin scoring (k=5).

```mermaid
flowchart TD
    subgraph Write path
        A[Conversation / tool output /<br/>untrusted ingest] --> B[PII & secret redaction guard<br/>pii-redaction-guard.ts]
        B --> C[Whitespace-normalized dedup]
        C --> D{Contradicts an<br/>existing fact?}
        D -->|yes| E[Supersede: old row status=superseded<br/>+ succeeded_by_id link]
        D -->|no| F[Insert with confidence score]
        E --> F
        F --> G[(memory_entries / agent_knowledge<br/>+ pgvector embeddings)]
    end
    subgraph Retrieval
        H[Incoming turn] --> I{Triviality gate<br/>fail-open}
        I -->|substantive| J[Tenant-scoped vector search]
        J --> K[Confidence weighting +<br/>decorrelated kin scoring k=5]
        K --> L[U-shaped reorder after budget<br/>truncation - best at edges]
        L --> M[Prompt assembly]
        I -->|trivial ack| M
    end
    G -.-> J
```

## 8. Chunk-and-parallel orchestration (long jobs)

Any job approaching the ~10–15 min subagent wall is split into ≤5-minute
chunks, fanned out to parallel workers (up to 8), then stitched. Completion is
judged by a **separate** verifier model against a goal contract — never by
worker self-assessment.

```mermaid
flowchart TD
    A[Long job: video, PDF,<br/>batch generation] --> B{Estimated<br/>duration?}
    B -->|"< 5 min"| C[Single worker]
    B -->|longer| D[Split into N chunks<br/>~5 min each]
    D --> E1[Worker 1]
    D --> E2[Worker 2]
    D --> E3[Worker N<br/>up to 8 parallel]
    E1 --> F[Stitch worker<br/>compiles results]
    E2 --> F
    E3 --> F
    C --> G[Completion verification<br/>separate model vs goal contract]
    F --> G
    G -->|pass| H[Delivery pipeline]
    G -->|fail| I[Bounded auto-revise<br/>then escalate to owner]
```

## Maintenance

These diagrams are documentation, not generated artifacts. When a core flow
changes, update the matching diagram in the same PR. For the request/route map,
the authoritative list of mounted routers lives in `server/routes/`.
