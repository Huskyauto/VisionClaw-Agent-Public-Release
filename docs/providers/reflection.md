# Reflection Beam: owner source work

Bob approved routine owner project work under Reflection's observed **standard
retention**, but **no customer data**. The currently free offer is owner-reported;
neither rate-limit headers nor successful API calls prove permanent free billing.

## Where it is used

- Internal CLI: source review and test suggestions against a closed source list.
- Existing Agent Knowledge Refresh: when enabled, changed `tdd`, `zoom-out` and
  `module-girth-guard` runbooks use Reflection instead of the previous compiler.
  Reflection selects numbered source ranges; the server extracts the actual
  quotations. DB concepts/history and customer data are never sent to Reflection.
- No generic provider client, chat model menu, customer route, jury/failover
  entry, new tool or model-default change. Existing owner exec authorization
  remains mandatory; this is not a shell-access grant for autonomous agents.

```sh
npx tsx scripts/reflection-owner-work.ts --task=draft-tests --source=server/lib/standard-compute.ts
npx tsx scripts/reflection-owner-work.ts --task=review-source --source=server/lib/knowledge-compile.ts
npx tsx scripts/reflection-owner-work.ts --task=compile-runbook --source=.agents/skills/module-girth-guard/SKILL.md
```

These commands do real inference only when the flags below permit it. There is
no `--dry-run`, arbitrary prompt, customer-file input or automatic code apply.
CLI output is advisory JSON, not a downloadable customer deliverable.

## Configuration, limits and stop

- Secret: `REFLECTION_API_KEY`. Never print it, store it in plaintext config,
  include it in CLI arguments or replace another provider's key/base URL.
- `REFLECTION_OWNER_WORK_ENABLED=1`: exact opt-in. Set `0` to stop new requests.
- `REFLECTION_FREE_APPROVED_UNTIL`: future UTC ISO timestamp. Initial approval is
  72 hours; no automatic renewal. Reconfirm the actual free offer before renewal.
- Fixed model `Beam-1.0-501B-A23B` at `https://api.reflection.ai/openai/v1`.
- `low` reasoning, 12,000 input-source characters, 400 lines, 2,048 total output
  tokens; SDK retries zero; 60-second inference wall clock and bounded accounting.
- Regular, canonical allowlisted files only; symlinks, traversal, raw prompts,
  customer uploads/records, credential-like literals and email values fail closed.
- One in-flight call per process; existing refresh batch/sequential limits remain.
  This is not a distributed account-wide rate limiter. Provider quota errors stop
  the request; nothing falls back to a paid key.
- Retention preflight before source egress and actual response-header checks accept
  only owner-approved `standard` or `zero`. Unknown/contributor modes stop.
  A provider policy change between preflight and inference cannot be prevented
  client-side; account-side retention settings remain the authority.
- Known nonzero/malformed advertised model pricing stops. The current model
  metadata has no price, so the expiring owner approval is necessary.
  **A silent price change cannot be reliably detected by this API.** Set an
  account-side zero spending cap where available; do not fund auto top-ups.
- Token usage is recorded under `llm.reflection-owner-work`, including received
  rejected responses. `costUsd=0` represents the approved temporary offer, not
  independent invoice verification. `usageRecorded` explicitly reports persistence.
  Uncertain transport/timeout consumption may lack usage; do not retry it.

## Quality evidence and limits

Synthetic streaming passed. A real test-suggestion call returned sensible,
source-grounded test cases; review found redundant/weak suggestions, so **do not
use this model as a final code-review approver**. An initial verbatim compile
failed grounding and was rejected. Numbered-line compilation then passed with
server-extracted source text. No model is mistake-free; schema/quote checks do
not establish semantic correctness, completeness or security approval.

Original deterministic indexing stays authoritative; compiled rows are advisory
and carry the source label. Enabled-but-expired/failed Reflection compilation is
degraded, not a reason to send the source through a new paid fallback.

Reverify:
`npx tsx --test tests/unit/reflection-owner-work.test.ts tests/lib/knowledge-compile.test.ts`

Official docs: https://developers.reflection.ai/quickstart ,
https://developers.reflection.ai/openai-compatibility ,
https://developers.reflection.ai/rate-limits ,
https://developers.reflection.ai/api-reference/overview#data-retention .
