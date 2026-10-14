# CheaperInference — owner paid fallback and catalog

## Approved policy

Bob approved his agents only, with **$20 total per UTC day**, not per agent.
Healthy free/subscription lanes remain first; CheaperInference Luna is the
preferred automatic paid fallback. Other paid providers keep their existing
authorization. Explicit provider pins, explicit free-only requests and special
owner-selected premium lanes remain binding.

Enable with exact `CHEAPER_INFERENCE_AUTOMATIC_ENABLED=1`; default is off.
Set it to `0` to stop automatic selection. `CHEAPER_INFERENCE_ENABLED=0`
disables the entire transport. `CHEAPER_INFERENCE_API_KEY` stays in Secrets.
No customer can borrow this wallet. A conflicting active tenant context denies
admission even if a caller passes tenant ID 1.

The endpoint is `https://api.cheaperinference.com/v1`. The fallback app ID
is `cheaperinference/gpt-5.6-luna`, upstream `gpt-5.6-luna`. The unprefixed
Profundo Luna identity remains separate.

## Spend and failure contract

Before every request, reserve its conservative maximum atomically in the
existing `aggregate_ai_spend_reservations` authority. Its shared $20 UTC-day
ceiling also counts any other reservation users of that authority; there is
no second budget or duplicate ledger charge. Each attempt has a server-generated
identity. Concurrent processes serialize admission with the existing DB lock.
Normal completed usage settles once. Missing usage, interrupted streams,
timeouts, crashes and settlement failures retain the original hold for its day.
Database/admission failures deny before inference.

Chat payloads are bounded to 192 KiB, 256 messages, one completion and 8,192
output tokens. Unknown audio modalities and premium service tiers are denied.
SDK retries are zero, timeout is 60 seconds, and caller HTTP/body/header
overrides cannot bypass guards. Streaming usage cannot be disabled.
Provider usage.cost takes precedence; otherwise catalog-derived conservative
token estimates are marked by their nature, not claimed as an invoice.
Accounting remains separate from authorization. The ordinary cost ledger must
not become a second permission gate.

Automatic text calls request `min_discount_percent:40`. This enforces a
discount against the model maker's list rates, **not every competing service**.
Unavailable qualifying supply can return 503; discounts across the catalog
vary and must not be advertised as a universal 40%.

## Catalog and agent usage

Authenticated catalog on 2026-10-11: **97 entries**, comprising 91 text,
5 image and 1 video. Of these, **90 are Chat Completions compatible** and
**63 chat models declare vision**. One text model is Responses-only.
The owner model picker adds only chat-compatible entries, with disambiguated
`cheaperinference/<id>` names and declared vision capabilities. Catalog metadata
is validated, single-flight fetched, held for 15 minutes in memory, and safely
refetched after process loss. A failed refresh does not authorize paid dispatch.
Listing a model is not proof that its inference, tools or structured output work.

The existing `generate_social_image` tool accepts optional `image_model`:

- `cheaperinference/nano-banana`
- `cheaperinference/grok-imagine`

These are owner-only fixed-unit **square** generators, sharing the same cap.
Example: prompt "A plain blue square", image_model
"cheaperinference/nano-banana". Omit references and do not retry an ambiguous
paid attempt. Authenticated `/api/generate-image` also accepts model/size;
tenant scope comes from authentication, never request body tenantId.
Image model selection is explicit; there is no new automatic paid image
shortcut. Existing economy/landscape/premium/reference-image behavior remains unchanged.

Token-priced image models, image edits, video and Responses/Pro are cataloged
but not dispatched through this integration without a proven output-price
bound and matching endpoint contract. Never send them to chat, or infer that
vision support means image generation.

## Eight-question design gate

1. Cost/scale: shared hard admission ceiling, per-request maximum, zero SDK
   retries. Retry attempts require fresh reservations; ambiguous ones stay held.
2. State: existing Postgres reservation and ledger tables. Catalog/health maps
   are disposable caches; no new local persistent state or schema.
3. Failure: authorization, billing metadata, admission and scope fail closed.
   Catalog picker refresh is fail-soft; ledger failure is observable, not free.
4. Idempotency: unique attempt keys, one settlement, no retry on network
   ambiguity by this transport or the image tool's outer retry helper.
5. Tenant/limits: exact owner scope plus conflicting-context rejection,
   shared daily cap, byte/output/message/image bounds.
6. Kill switch: independent automatic/full transport flags and key revocation.
7. Authority: owner configuration authorizes; agents cannot mint grants or
   alter reservations through provider parameters.
8. Delta evidence: focused routing/guard/stream/budget tests and synthetic
   endpoint probes; no whole-repository or universal model-quality claim.

Official references: https://platform.cheaperinference.com/docs and
https://platform.cheaperinference.com/models/gpt-5.6-luna.
Publication, Git push, standby activation and release emails remain held.
