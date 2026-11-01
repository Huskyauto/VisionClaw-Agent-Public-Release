# MiniMax M3.1 Flash — verified October 19, 2026

## Availability and pricing

- Exact available OpenRouter ID: `minimax/minimax-m3.1-flash:free`.
- OpenRouter public API catalog: 1,000,000-token context, text/image/video input,
  text output, tools and reasoning parameters. Current prompt/completion rates
  are zero. This is a promotional, rate-limited endpoint, not permanent free use.
- MiniMax's own direct API price: **$0.15/M input**, **$0.60/M output**,
  **$0.015/M cached input**. These are not a promise of future OpenRouter rates.
- The paid OpenRouter ID was not listed at verification time; do not remove
  `:free` speculatively or silently convert a free request to paid inference.

Sources:
- https://openrouter.ai/minimax/minimax-m3.1-flash:free
- https://openrouter.ai/api/v1/models
- https://platform.minimax.io/docs/pricing/overview

## System integration and evidence

The curated registry exposes the verified model through existing discovery and
selection. Its operational maximum is32,768 output tokens, below the advertised
524,288 upstream maximum. Training regime is unknown, not guessed.

A single fixed, non-sensitive live inference returned HTTP200, the exact requested
model ID, `MINIMAX_OK`, finish reason `stop`,209 input tokens and12 output tokens.
Provider-reported request and upstream costs were both0. No customer data was
sent. This establishes live account access, not broad model quality.

A second fixed request returned the requested `add_numbers` tool call with
exact arguments `{"a":17,"b":25}`, finish reason `tool_calls`, and reported cost0.
No tool was executed. Both checks used only synthetic public-safe inputs.

Verification: the new registry regression failed before registration, then
passed. The consolidated registry/catalog/release-contract run passed12/12;
TypeScript checking, count consistency and stale-copy checks passed.

No default model, automatic tier ladder, jury seat, authorization or spend gate
was changed. Existing provider policies can still reject or substitute a model;
registry discovery is not permission to bypass them. Deployment and GitHub
publication require separate owner approval.
