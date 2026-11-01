# Mammouth API

Mammouth is an optional, owner-only credit-metered API, not a free or unlimited
subscription transport. Verified API key and live catalog on October 25, 2026.

## Select and use

In the owner chat model picker select **GLM 5.3 Flash (Mammouth)** or
**Mistral Large 4 (Mammouth)**. The authenticated chat route supplies verified
owner selection; background agents cannot enable this by naming a model.

Internal owner-authorized callers use `getClientForModel` with the namespaced
registry ID and `{explicitOwnerSelection: true, platformAdminVerified: true}`.
These flags must come from verified owner ingress, never model-generated data.
Send the returned `actualModelId` to `client.chat.completions.create`.
Only guarded chat completions are exposed; raw SDK APIs are deliberately absent.
Tools remain subject to the platform's normal authorization and approval checks.

The optional lane pin is `mammouth`; it accepts only the two namespaced IDs.
It never maps another model's request onto a Mammouth substitute.

## Configuration and limits

- Credential: `MAMMOUTH_API_KEY` in Secrets. Never print it or the full `/key/info`
  response: that response contains a key field.
- Endpoint: `https://api.mammouth.ai/v1`, server-owned and fixed.
- Kill switch: `MAMMOUTH_ENABLED=0`, rechecked immediately before dispatch.
- Credit usage: the published plans currently include $2/$4/$10 monthly API
  credits for Starter/Standard/Expert. Additional API credits are purchased
  separately. A $10 subscription does not mean $10 of included API usage.
- Upper-bound prices per million input/output tokens: GLM $0.15/$0.50;
  Mistral $1.36/$4.18. Ledger and predictor use those conservative rates.
- Text and native tools only; no remote media, embeddings, image generation or
  provider-selected aliases in this integration.
- Output cap 8192 total tokens; each request reserves a proven upper bound
  <=$0.25 under the existing aggregate daily AI spend authority before inference.
- No automatic retries, paid fallbacks or stream-recovery re-purchases.
  Unknown/failed completion or missing usage retains the budget hold.
- The live GLM Flash endpoint requires reasoning; `none` is rejected locally.
  Keep enough total output budget for its reasoning and final answer.

## When not to use

Not an automatic tier default, a standing jury replacement, a customer-shared
credential or a way to bypass a caller's free-only flag. If unavailable, report
that lane's failure; do not silently switch accounts or buy credits.

## References

- https://info.mammouth.ai/docs/api-quick-start/
- https://mammouth.ai/app/account/settings/api
- `docs/research/mammouth-provider-design.md`
