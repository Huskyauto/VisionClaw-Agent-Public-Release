# Harness benchmark reporting

This project can compare a **model × harness configuration**, not merely a base
model, using the report-only runner:

```bash
npx tsx scripts/harness-bench-report.ts path/to/runs.json
HARNESS_BENCH_MIN_COVERAGE=0.9 npx tsx scripts/harness-bench-report.ts path/to/runs.json --json
```

The runner does not call an LLM, write to the database, or alter a live
configuration. It summarizes independently collected run facts through
`server/lib/harness-bench-core.ts`.

## Input contract

Pass either a JSON array of runs or an object with `runs` and an optional
`minCoverage` field:

```json
{
  "minCoverage": 0.8,
  "runs": [
    {
      "taskId": "research-brief-01",
      "modelId": "example-model",
      "harnessId": "sha256-of-effective-harness",
      "completionScore": 1,
      "process": {
        "toolUse": 1,
        "stateConsistency": 0.9,
        "robustness": 0.8
      },
      "securityScore": 1
    }
  ]
}
```

All task, model, and harness identifiers are required. Scores are in `[0, 1]`.
`securityScore` is deliberately binary: `1` means an independent structural
security check passed; `0` means it failed.

## Score meaning

The report keeps the three important dimensions separate:

- **Completion** — oracle or independently judged success on the task.
- **Process** — an equal-weight average of trace-backed `toolUse`,
  `stateConsistency`, and `robustness`.
- **Security** — a binary structural verdict, never an LLM’s impression of
  safety. A recorded verdict still counts even when another score on that
  row is missing; an unknown verdict is not counted as a pass or failure.

The displayed combined score is:

```text
(0.6 × completion + 0.4 × process) × security
```

Therefore, any configuration containing a security failure receives a combined
score of zero and is ineligible for comparison even if its completed artifacts
look excellent. The separate component scores remain visible for diagnosis.

## Honest comparison rules

- Missing or malformed values make a run **unevaluated**; they are never
  silently discarded.
- Every configuration needs at least one fully scored run and must meet the
  coverage floor (default `80%`). Coverage is checked globally and per
  configuration.
- The submitted **and** the successfully scored task IDs and repetition counts
  must match across configurations. Two arms at 80% cannot be compared if each
  dropped a different task. JSON reports distinguish `taskSetsMatched` from
  `evaluatedTaskSetsMatched`.
- The command exits `3` for insufficient evidence, mismatched tasks, or any
  recorded structural security failure, even if completion or process evidence
  on the same row is missing. The coverage setting cannot waive such a failure.
- The report only checks supplied records, not the experiment design. Freeze
  the task set independently and give materially different scenarios or trials
  distinct task IDs. Partial coverage supports conclusions about the common
  scored subset only. Use a floor of `1` when every task must be evaluated.
- Use an independent oracle/judge for completion. The candidate model must not
  grade itself.
- Derive process and security signals from traces and policy validators where
  possible. Do not let a candidate select, edit, or inspect its own evaluator.

## Context-acquisition trials

For a context-acquisition trial, give the baseline and the candidate policy
different `harnessId` values. Run the same held-out tasks under the same
budgets, then report both configurations together. The report is evidence only:
it never promotes a routing, prompt, or model change automatically.