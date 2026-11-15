# Meta primary routing

Owner-approved temporary primary provider using existing Meta API credits.
No production publication is authorized by this configuration request.

## Owner-approved model split

- Simple / `fast`: `muse-spark-1.3-contributor`, $0.10/M input, $0.20/M output.
  Requires exact `META_CONTRIBUTOR_APPROVED=1`. Bob explicitly approved Meta
  reading/training on his submitted content after the privacy consequence was explained.
- General / `balanced`: standard `muse-spark-1.3`, $1.25/M input, $4.25/M output.
- High-end / `powerful` and `reasoning`: `muse-wonder-1.0`, $4/M input, $20/M output,
  default high reasoning. Wonder Full is not advertised by this account's API;
  do not relabel Wonder as Full.

## Design and scope

- **Cost:** model-specific rates above; caching is not deducted from conservative
  reservation/ledger estimates. Contributor is limited to the owner-approved simple tier.
  Maximum 32,768 output tokens (including reasoning). Reserve a conservative
  request maximum before dispatch in the owner-approved shared $30 UTC-day paid-AI
  budget; missing usage or uncertain failure retains its reservation.
  At 1,000 simple calls/day × 2K input + 1K output, estimated token cost is $0.40/day;
  equivalent standard Spark is $6.75/day and Wonder $28/day (close to the
  daily ceiling before other paid usage). This is not an account-balance integration; $145 is
  the owner's reported balance, not a verified or automatically renewed allowance.
- **State:** existing Postgres spend reservations and cost ledger; no local state,
  schema change, secret storage in files, or new background job.
- **Failure:** no SDK retry; ambiguous dispatch is not automatically repeated.
  Verified empty completions with `finish_reason=length` are local output-budget
  failures, not provider outages. Their usage still settles and the same client
  cannot replay them. Short conversation titles select the fast tier and allow
  1,024 Meta output tokens including reasoning; other providers retain 30.
  Existing provider routes remain available when Meta is disabled/unhealthy.
- **Identity:** unique server-owned reservation per actual paid attempt.
- **Tenants:** owner only, matching explicit tenant and trusted async context.
  Jury seats, explicit provider/model selections and free-only requests retain
  their policy. Media generation, speech and embeddings keep specialized routes.
- **Control:** `META_PRIMARY_ENABLED=1` is exact opt-in; `0` restores prior defaults.
  `META_ENABLED=0` is the full provider stop. `META_CONTRIBUTOR_APPROVED=0`
  restores standard mode for simple work and blocks cached Contributor clients.
  Secrets use `META_API_KEY`. Route logs and served model IDs identify the exact model.
- **Authority:** only the owner controls flags; no change to tool permissions,
  tenant gates, approvals, safety prompts or independent evaluator seats.
- **Evidence:** offline owner-boundary/request/budget tests plus bounded real
  completion, native tool round trip and stream checks. These establish transport
  compatibility, not a general quality advantage over existing models.

Official references: https://dev.meta.ai/docs/api-reference ,
https://dev.meta.ai/docs/pricing-rate-limits , https://dev.meta.ai/docs/reasoning .
Model list and standard model access verified through Node HTTP on 2026-11-09.
