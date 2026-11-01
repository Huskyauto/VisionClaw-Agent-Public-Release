---
title: RSIHub assessment
reviewStatus: watch
revisitWhen: A native optimizer promotion study has an independent sealed workload and a fixed evaluation contract.
---

# RSIHub — assessment before republication

## Decision

Borrow evaluation discipline, not the framework or another autonomous loop.
One small, reproduced report-integrity defect merits a native fix. The paper
does not establish a VisionClaw capability gain or justify delaying the chat
reliability release for a new evolution platform.

## Primary sources

- Paper v1: https://arxiv.org/html/2610.32253v1
- Abstract: https://arxiv.org/abs/2610.32253
- Repository: https://github.com/simple-agent-lab/RSIHub

The supplied image matches the paper title and abstract. The paper and repository
were read; RSIHub was not installed or executed.

## What the evidence supports

Sections 3–4 separate mutable recipes from evaluation, certified records and
candidate lineage. Training supplies adaptation feedback; gate cases select
candidates; sealed cases report transfer without feeding mutation.

Table 1 reports Terminal Bench 2 MiniSWE overall pass@1 from 56.2% to 69.7%
(+13.5 percentage points), versus Codex's best 69.7% to 71.9% (+2.2).
Both target agents use GPT-5.4/high; the distinction is the agent harness, not
an upgrade to a different underlying language model. Methods have different
mutable surfaces; these are framework adaptations, not exact replications.

There are 89 terminal tasks (50 train/19 gate/20 sealed) and 97 banking tasks
(50/20/27). Table 1's split columns are contributions to the full-benchmark
score, NOT accuracies within each split. For example, MiniSWE/AHE banking improves
overall 27.8% to 28.9% while the sealed contribution falls 9.3 to 5.2 points:
approximately nine versus five successful cases out of 27 sealed tasks.

Evolution results use one trial per task and at most ten generations. Repeated
execution-fidelity controls do not establish significance of single-run evolution
gains; two additional successes out of 89 tasks are not a universal improvement
guarantee. Fixed model settings and generation counts do not alone prove equal
dollar cost. Compare total costs, failed attempts and latency as well as success.

Sections 6–7 explicitly limit integrity claims to trusted infrastructure and
tested boundaries. RSIHub is not containment for hostile code. Do not give an
experimental mutator production credentials or treat rollback as undoing
external actions.

## Native comparison and bounded experiment

The existing loop-integrity policy already requires evaluator separation,
independent held-out evidence, safety gates, budget limits and revocable authority.
The skill optimizer has separate train/validation data, but its validation score
is repeatedly used to select candidates. That selection set alone is not an
untouched final test. This inspection is not an audit of every promotion path.

The existing harness report independently checks completion, process, security
and supplied-record coverage. A pure offline six-scenario probe found:

| Scenario | Before fix | Required |
| --- | --- | --- |
| Identical task lists | Comparable | Comparable |
| Identical lists reordered | Comparable | Comparable |
| Any structural security failure | Not comparable | Not comparable |
| Malformed evidence below coverage floor | Not comparable | Not comparable |
| Completely different task lists | Comparable | Not comparable |
| Candidate omits a baseline task | Comparable | Not comparable |

The native report now requires matching task-ID multisets across configurations,
including repetition counts, before declaring comparison eligibility. It retains
diagnostic scores and the existing safety/coverage gates. JSON exposes
`taskSetsMatched`; the CLI gives a mismatch reason and exits 3.
The omitted-task regression failed before the change, then passed. Tests also
cover disjoint tasks, changed repetition weights, and reordered matching repeats.

This is synthetic evidence of a deterministic reporting fix, not an independent
held-out agent-performance experiment. It adds no calls, background jobs, tools,
permissions, promotion authority, model changes or dependencies.

## Remaining limits and adoption threshold

Matching caller-supplied task IDs cannot prove matching task contents, evaluator
version, reasoning settings, retry policy, resource budget or absence of leakage.
Identically omitted tasks also require an external expected-workload manifest
to detect. Do not advertise this small guard as a complete RSIHub-style protocol.

The worthwhile future study is a native, report-only comparison with a frozen
evaluation contract, content-bound artifacts, separate train/gate/sealed cases,
and verified outcome, safety and total-cost reporting. Promote an evolution
method only after it improves that workload without safety regression; retain
negative results. No such performance experiment was run here, and no new
autonomous evolution mechanism is adopted.
