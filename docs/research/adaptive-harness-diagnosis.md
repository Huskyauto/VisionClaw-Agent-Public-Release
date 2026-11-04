# Adaptive failure priorities in the existing harness job

## What runs automatically

The existing nightly skill-optimization job already invokes per-model harness
adaptation. Its proposal preparation now derives advisory priorities from the
timestamps of its TRAIN-side error traces. There is no new scheduler, tool,
table, provider or model call.

For each normalized error cluster, the existing lookback interval is divided
into three equal windows (recent, middle and older). Observed labels are:

- **Newly observed:** at least two recent errors, none in earlier windows.
- **Recurring:** at least two recent errors and earlier observations.
- **Returned:** at least two recent and two older errors, none in the middle.
- **Not observed recently:** only earlier observations. This never means fixed.
- **Insufficient evidence:** only one recent error.

Repeated recent clusters rank ahead of older-only clusters. Counts are trace
occurrences in a capped, randomly split sample, not independent tasks, measured
failure rates or proof of root cause. "Newly observed" and "returned" describe
this sample only. There is no persistent full RuHarness criterion lifecycle.
Success-versus-failure discrimination and causal completion gains are not
established by these labels.

Declined actions are not labeled diagnostic defects; the bounded original
decline evidence remains available with an explicit caution that refusal may be
correct. The proposal prompt treats trace prose as untrusted evidence and
forbids removing checks/refusals.

## Evidence and authority boundaries

The deterministic existing train/held-out split occurs BEFORE diagnosis.
Held-out traces do not contribute to priority labels or proposal guidance.
The existing addendum validator, hypothetical held-out prevention judge,
jury quorum, owner tenant restriction and activation transaction are unchanged.
The hypothetical judge remains an opinion, not executed outcome verification.
No new approval authority or permissions are granted. Confirmation receipts
and mandatory safety/customer/payment checks cannot be edited by this feature.

The manifest's proposal-contract hash binds the diagnostic policy and the hash
of the actual proposal digest. Raw traces are not copied into the manifest.
Per-model results and the existing nightly log expose mode, fallback reason and
counts by diagnostic state.

## Cost, fallback and rollback

No additional model calls, database queries or tasks are replayed. The existing
4,000-trace mining limit and five-model cap remain. At most eight error
criteria and two other-status clusters enter a digest capped at 2,800 characters.
This can increase input tokens relative to the original compact count digest;
zero extra calls does not mean zero incremental token cost.

Missing, future, out-of-window or invalid timestamps revert to the original
count-based digest. An unexpected preparation failure also falls back and
reports its reason. Existing adaptive activation guards still fail closed.

`HARNESS_ADAPTIVE_DIAGNOSIS=0` selects the original count-based training digest
on the next job invocation. Unset/other values enable advisory ranking.
No environment setting was changed during implementation.

## Verification and evidence limits

39 offline tests passed across the new diagnostic tests, existing harness
validator/injection/split tests and manifest-core tests. Full TypeScript passed.
The new public preparation helper is the same boundary called by the nightly
path; tests cover stale-versus-recent priority, return after a quiet window,
sparse evidence, refusals, timestamp fallback, disable, output bounds,
determinism and held-out exclusion.

The stale-cluster fixture shows an intended ranking difference from the actual
original `digestFailures` baseline. It is synthetic mechanism evidence, not a
native task-completion improvement or reproduction of the paper's gains.
No live nightly optimization was triggered: it can spend and activate addenda.
No publication or production activation is implied by workspace verification.

Source and assessment: [RuHarness assessment](ruharness-assessment.md).
