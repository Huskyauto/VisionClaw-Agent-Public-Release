# Flagship benchmark — claude-opus-4-8 vs claude-opus-4-7

**Date:** 2026-05-29 · **Harness:** these numbers were produced by the original one-off `run-benchmark-opus.ts` (gpt-5.4 judge), since consolidated into the reusable `scripts/flagship-regression-gate.ts` (gpt-4.1 judge) · **Judge:** gpt-5.4 (blind A/B, order randomized per prompt) · **Frozen prompts:** 6 (reasoning, coding, strategy, instruction-following, factual-trap, writing)

## Why
Opus 4.8 was promoted to platform flagship (MoA `DEFAULT_AGGREGATOR`, top of `tierModels.powerful`/`.reasoning`, CEO orchestrator default) on a **liveness check only** — no head-to-head quality/latency/cost data vs the prior flagship `claude-opus-4-7`. This benchmark confirms (or refutes) the promotion.

## Method
6 frozen prompts run through both models (real billable calls, no temperature param — deprecated on these models). A neutral judge (gpt-5.4) scores both answers 0–10 blind, with A/B order randomized per prompt to kill position bias. Cost computed from real token usage × `server/resource-predictor.ts` pricing (both models: $5/M in, $25/M out — **price parity**).

**A single 6-prompt run is judge-noisy** — run 1 alone said REVERT. Ran **3 rounds** to separate signal from noise.

## Results (3 rounds)

| Round | 4.8 quality | 4.7 quality | H2H (4.8–4.7–tie) | 4.8 latency | 4.7 latency | Verdict |
|-------|------------|------------|-------------------|-------------|-------------|---------|
| 1 | 8.63 | 9.25 | 2–4–0 | 5.47s | 6.05s | REVERT |
| 2 | 9.50 | 8.67 | 5–1–0 | 6.20s | 5.90s | KEEP |
| 3 | 9.33 | 8.67 | 5–1–0 | 5.62s | 6.41s | KEEP |
| **Agg** | **9.15** | **8.86** | **12–6–0** | **5.76s** | **6.12s** | **KEEP** |

- **Quality:** 4.8 = 9.15 vs 4.7 = 8.86 → **+0.29 pts to 4.8**
- **Head-to-head:** 4.8 wins **12 of 18** prompts
- **Latency:** 4.8 ~5.76s vs 4.7 ~6.12s → 4.8 **marginally faster**
- **Cost:** ~$0.0094 vs ~$0.0085 per query → **parity** (identical per-token pricing; 4.8 emits slightly more output tokens)

## Verdict: KEEP — flagship promotion confirmed
Opus 4.8 matches or beats 4.7 on quality, is slightly faster, at cost parity. **No revert.** Routing/aggregator order unchanged:
- `server/moa.ts` `DEFAULT_AGGREGATOR = "claude-opus-4-8"` ✓
- `server/providers.ts` `tierModels.powerful`/`.reasoning` lead with `claude-opus-4-8` ✓

## Reproduce
```bash
# Re-run via the consolidated gate (defaults: challenger=moa.DEFAULT_AGGREGATOR, baseline=claude-opus-4-7, 3 rounds)
npx tsx scripts/flagship-regression-gate.ts   # writes stress-test-output/flagship-regression-gate.json
```

**Lesson:** never decide a flagship swap on one 6-prompt run — the judge variance flipped the verdict between rounds. Aggregate ≥3 rounds.
