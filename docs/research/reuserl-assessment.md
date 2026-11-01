# ReuseRL: engineering assessment

## Verdict

Retain as a promising reference for success-aware skill discovery and balanced evaluation. Do not install the training framework, add an autonomous loop, or change promotion authority on this evidence.

Reviewed source: *Skill Reuse as Compression in Agentic RL*, arXiv:2605.31509v2, September 1, 2026.

- Paper: https://arxiv.org/html/2605.31509v2
- Author-linked implementation: https://github.com/ARC-ASU/ReuseRL
- Supplied summary: `attached_assets/Pasted-Teaching-AI-Agents-to-Think-Smarter-Not-Harder-When-we-_1793139402323.txt`

## What the source establishes

OBSERVED IN SOURCE: ReuseRL trains model weights with GRPO, extracts a dictionary of abstract action subsequences from successful trajectories, and applies a segmentation-cost penalty to successful trajectories. Dictionary selection accounts for both dictionary storage cost and encoded trajectory cost. This is not merely shortening prompts or retrieving saved plans.

Theorem 3 bounds expected normalized description length on future successful trajectories under a fixed policy and the same successful-trajectory distribution, with a prior fixed before observing the sample and i.i.d. successful samples. Section 3.5 expressly disclaims proving policy generalization after iterative RL updates. The article's “guaranteed reliability” on completely new situations is unsupported.

Reported Table 1 results:

| Benchmark | Vanilla GRPO | Pure length penalty | ReuseRL with buffer |
|---|---:|---:|---:|
| ALFWorld OOD, SC@7 | 79.85 | 91.79 | 93.28 |
| TextWorld-Cooking, Pass@1 | 74.97 | 64.03 | 81.73 |
| Countdown-Stepwise, Pass@1 | 68.46 | 77.02 | 80.37 |

These are paper-reported benchmark results, not independent reproduction or VisionClaw gains. ALFWorld uses seven sampled rollouts with majority voting; the other columns use Pass@1. The metrics are not interchangeable. The cooking result without the success buffer is 83.50, above 81.73 with it. Section 6.2 attributes the buffer downside to common easy patterns suppressing rarer hard patterns.

## Cross-case comparison with the existing system

This is a source-level engineering comparison, not an executed model evaluation.

| Case | Existing native behavior or relevant boundary | Transferable lesson | Limit |
|---|---|---|---|
| Repeated tool sequences | `server/lib/skill-pattern-detector.ts` groups tenant-scoped tool names across distinct traces; its scanned fields do not include terminal task success | Distinguish successful reusable sequences from repeated unsuccessful routines before treating frequency as quality | No measured proposal-quality uplift |
| Similar task replay | `server/plan-replay.ts` performs tenant-scoped embedding lookup with a similarity threshold | Reusable patterns still need task compatibility; similar wording is insufficient evidence of fit | This paper does not evaluate our replay system |
| Skill optimization | `server/lib/skill-optimizer-promotion.ts` already checks evaluator evidence, safety, authorization and post-promotion verification | Any compression metric should initially be advisory, not replace independent outcome evidence | More compressible does not mean safer or more correct |
| Irreversible external actions | Sending, billing and delivery can require additional checks and recovery | Do not optimize away authorization, duplicate checks, verification or recovery merely to reduce steps | Toy benchmark success does not establish production side-effect safety |
| Rare difficult workflows | The paper's own success-buffer ablation regresses on difficult cooking cases | Keep hard/failure cases represented rather than letting common easy workflows dominate evaluation | No native rare-workflow performance measurement made |

## Falsifiable candidate

HYPOTHESIS: Filtering/ranking existing passive skill proposals using independently verified terminal outcomes improves useful reusable-proposal precision over the current frequency-only discovery baseline, without suppressing rare useful patterns.

TEST: Use a bounded, tenant-scoped, redacted corpus with authoritative task outcomes. Separate pattern-development traces from held-out traces by task family. Compare current discovery with the proposed success-aware approach under the same proposal budget. Include repeated failures, parameter-changed tasks, rare difficult cases, aborted/unknown outcomes, and repeated successful sequences that must not be automated.

Measure verified held-out completion, harmful/inapplicable suggestions, hard-case coverage, tool calls, latency and full evaluation cost. Safety failures remain separate from averages. Missing terminal evidence means unknown, not success. Keep the first trial offline/report-only; never replay side effects.

DISPROOF/STOP: No quality improvement, worse rare-case coverage, any tenant/safety regression, or evaluation overhead exceeding savings. Frequency and compressibility alone cannot establish a pass.

VALIDATION STATUS: Untested adaptation. No matched held-out outcome corpus was assembled and no performance experiment was run in this review. The source/code comparison identifies a plausible test target, not sufficient evidence to implement it.

## Recommendation

Borrow the research question, not the full RL stack. Prefer a bounded extension of the existing detector only if independent outcome evidence supports it. Revisit when representative terminal outcomes can be linked to traces reliably. No runtime behavior, model weights, gates, dependencies, jobs, commits, pushes or publication were changed for this assessment.
