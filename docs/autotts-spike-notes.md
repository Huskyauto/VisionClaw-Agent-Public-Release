# AutoTTS offline-discovery spike — notes & go/no-go

**Paper:** "LLMs Improving LLMs: Agentic Discovery for Test-Time Scaling" (Zheng et al. 2026, arXiv:2605.08083v2).
**Spike:** `scripts/autotts-kappa-discovery.ts` · **Report output:** `data/autotts-spike/report-<date>.md`

## Why we ran it

The paper argues compute-allocation policies (when to branch / probe / prune / stop / escalate)
should be **discovered in a cheap offline replay environment**, not hand-tuned by intuition. Most
of VisionClaw's orchestration knobs (parallelism degree, chunk size, κ-escalation threshold,
ensemble proposer count) are hand-set. We picked the single cleanest, lowest-risk knob to test the
methodology end-to-end: the `ensemble_query` κ-concordance escalate-to-HITL threshold
(`CONCORDANCE_ESCALATE_THRESHOLD = 0.5` in `server/moa.ts`).

The recommendation that preceded this spike was explicit: **spike the proxy-reward function first** —
if we can't build a faithful reward signal, the whole approach stalls there, and that's an
afternoon's finding rather than a sprint's.

## How it maps to the paper's three pillars

1. **Offline replay environment** — the jury-decisions corpus (`data/jury-decisions/queue.json`):
   every triaged issue carries κ (embedding concordance) AND the frontier-model vote breakdown.
   Escalation decisions are replayed against stored data with **zero new LLM calls**.
2. **Beta parameterization** — a single scalar β∈[0,1] maps monotonically into the observed κ range;
   larger β ⇒ escalate more (more HITL "budget"). 1-D sweep, the paper's anti-overfitting move.
3. **Execution-trace feedback** — the full per-β trace (recall / precision / escalation-rate) is the
   deliverable, and is OPTIONALLY fed to `executeMoA` (`AUTOTTS_EXPLORER=1`) as an "explorer" round
   that proposes a refined map. Off by default so the core run is $0 and deterministic.

**Proxy reward (non-circular):** an escalation is "valuable" when the jury models did NOT vote
unanimously (real dissent). κ (continuous embedding cosine of proposer *answers*) is the feature;
vote-unanimity (discrete agreement over *verdicts*) is the independent label.

## What it found (first run, 159 real decisions)

- **The hand-set 0.5 threshold is effectively DEAD.** κ never drops below ~0.667 in the corpus, so
  κ-based escalation has *never fired*. The knob was tuned to a value the live distribution never
  reaches — precisely the "unexplored allocation space" the paper targets.
- **κ carries weak-but-real signal:** AUC(−κ → dissent) ≈ 0.68; mean κ is lower for non-unanimous
  (~0.81) than unanimous (~0.85) decisions.
- Under a 35% HITL-load ceiling, the discovered threshold (~0.83) catches ~61% of dissent. There is
  **no** threshold that gives both high recall AND low HITL load — κ alone is a noisy single feature.

## Go/no-go

- ✅ **Methodology validated.** The offline-replay + β-parameterization + proxy-reward loop runs on
  real data, $0, deterministically, and produced an actionable finding a human eyeballing 0.5 missed.
- ⚠️ **Do NOT auto-wire a discovered threshold into the hot path yet.** 23 dissent positives is thin,
  and κ alone is a weak separator. Next moves, in order:
  1. Keep accumulating jury + `moa_responses` traces; re-run periodically.
  2. The real lever is a **second feature** (proposer_count, answer-length variance), not just a
     re-tuned single-feature threshold.
  3. When confident, **shadow-evaluate** (log would-escalate alongside the live 0.5 path) before
     ever touching `CONCORDANCE_ESCALATE_THRESHOLD`. Never hard-swap a hot-path safety knob off one replay.

## Generalization — making the method reusable (round 2)

The paper's real contribution is a *repeatable* discovery method, not a one-off threshold. A κ spike
that's never reused captures ~10% of the value. So the core was factored out:

- **`scripts/lib/autotts-discovery.ts`** — the reusable engine (replay → AUC → β-sweep → Pareto →
  reward → readiness), parameterized by a `KnobSpec` (feature, label, fire direction, current default,
  γ, caps). Any future allocation knob is now a thin caller, not a new script.
- **`scripts/autotts-kappa-discovery.ts`** — refactored to a thin caller over that core; byte-identical
  output (rows=159, AUC=0.683, discovered β=0.62 / threshold 0.834).
- **`scripts/autotts-knob-readiness.ts`** — a registry/gate that probes every candidate knob's corpus
  and reports which are discoverable **today** vs. blocked, and why. Report → `data/autotts-spike/readiness-<date>.md`.

### Readiness findings (the paper's hard precondition, made measurable)

Discovery needs a replay corpus with BOTH (a) variation in the knob's feature and (b) an independent
outcome label. Probing our traces:

| Knob | Paper allocation decision | Status |
|---|---|---|
| κ escalate-to-HITL threshold | stopping / verification trigger | 🟢 DISCOVERABLE (23 pos / 159 rows) |
| ensemble proposer (sample/branch) count | sample/branch budget | 🔴 BLOCKED — `proposer_count` is **constant at 3** (no variation to learn over) |
| plan_replay reuse similarity cutoff | compute reuse (skip the planner) | 🔴 BLOCKED — cache empty + no per-replay success label |

This is the key generalizable lesson: the paper's headline knob (sample/branch budget) is **not
discoverable from our traces** because we never vary it — you can't learn how many proposers to
allocate from data where it's always 3. Making proposer-count discoverable would require *logging
runs at varied proposer counts with an outcome*, i.e. an A/B or shadow sweep — a data-collection task,
not a tuning task.

### Features intentionally NOT built (and why)

- **Iterative LLM explorer loop (propose→evaluate→refine to convergence).** For a 1-D β knob the
  exhaustive grid IS the global optimum, so an LLM explorer adds cost without signal. The paper's
  explorer earns its keep in high-dimensional policy spaces we don't have here. Kept only as the
  optional single `AUTOTTS_EXPLORER=1` round for qualitative second-feature suggestions.
- **Joint multi-knob budget allocation.** Needs trace corpora that vary each knob with outcomes — see
  the readiness table; we don't have them yet. Revisit once a knob flips 🔴→🟢.

## Running it

```bash
npx tsx scripts/autotts-kappa-discovery.ts          # deterministic core, $0
AUTOTTS_EXPLORER=1 npx tsx scripts/autotts-kappa-discovery.ts   # + executeMoA explorer round
npx tsx scripts/autotts-knob-readiness.ts           # which knobs are discoverable today, $0
```

Env knobs: `AUTOTTS_GAMMA` (cost weight, def 0.5), `AUTOTTS_MAX_ESCAL` (HITL ceiling, def 0.35),
`AUTOTTS_MIN_POS` (def 10), `AUTOTTS_MIN_AUC` (def 0.55), `AUTOTTS_OUT` (report path).
Exit codes: `0` sufficient signal · `2` insufficient signal (stall, gather more data) · `3` runtime error.
The readiness script exits `0` always (status report) except `3` on its own runtime error.
