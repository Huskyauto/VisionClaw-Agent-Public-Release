# Owner-only GPT-6 Luna paid fallback

CheaperInference already exposes the exact GPT-6 Luna chat model for manual
owner selection. `CHEAPER_INFERENCE_PREFER_GPT6_LUNA=1` changes only which
CheaperInference model is preferred for the existing **fast** and **balanced**
automatic paid fallback. Included lanes, eligibility for the owner wallet,
explicit pins, free-only rules, high-end tiers, and the shared aggregate
spend cap are unchanged. This does not change Meta's separately configured
priority or grant any tool or jury authority.

The cached live catalog must show both exact Chat Completions entries. GPT-6
Luna must satisfy the existing discount floor, be cheaper on at least one
standard token rate, and be no more expensive on the other rate or on either
conservative reservation rate. Otherwise the eligible GPT-5.6 Luna remains
the automatic pick. Dispatch rechecks the policy using its catalog snapshot
and the current opt-in before sending. The gateway also receives the existing
discount floor. If an already-selected candidate becomes ineligible before
dispatch, the request is refused rather than issuing an unapproved retry.

## Development evidence

Six guarded, synthetic calls, with no retries and 256 output tokens allowed
per call, used the existing development admission and production-shaped
transport. No test executed any tool or processed customer data.

| Fixture | GPT-5.6 Luna | GPT-6 Luna |
| --- | --- | --- |
| Exact fictional ticket JSON | Pass, 3.84 s, $0.000016 | Pass, 2.24 s, $0.000011 |
| Exact test tool-call arguments | Pass, 3.00 s, $0.000014 | Pass, 2.88 s, $0.000009 |
| Bounded streamed title | Pass, 3.00 s | Pass, 2.01 s |

All six returned the exact requested model. The two buffered pairs reported
provider costs above; the streams reported usage but no exact billed amount.
This small sample is evidence for a narrow, reversible preference, not proof
of improvement on all jobs or of future savings.

One additional development request through the automatic admission path
(without the manual selection grant) passed against the exact GPT-6 Luna.
The live 34.5% catalog discount cleared this installation's configured 15%
floor, the existing reservation admitted it, and the gateway reported usage
cost. This was a fixture, not a production request or proof of fleet-wide savings.

## Rollout and rollback

The new setting defaults off. Stage it in the original production deployment,
then Republish. Confirm `/healthz` and anonymous denial of the staged GLM
owner-only route. To verify GPT-6 Luna automatic selection, look for the
CheaperInference model identity in model-routing logs and the ledger when an
eligible owner request actually needs the paid fallback. A healthy included
route shouldn't be deliberately disabled to generate this evidence.

To roll back the automatic preference, set
`CHEAPER_INFERENCE_PREFER_GPT6_LUNA=0` and restart or republish the relevant
environment. Manual owner selection remains independent. The app's
CheaperInference master disable and configured minimum discount are unchanged.
