# Reflection Beam availability watch

Owner request (October 8, 2026): periodically check whether Beam becomes available
on an existing provider and add it to the offering.

## Implemented scope

- Reuses the enabled `model_catalog_sync` heartbeat, daily at 04:30 UTC
  (11:30 p.m. Central during daylight saving; 10:30 p.m. during standard time).
  No additional timer, workflow, subscription, API key or inference call.
- Watches the full OpenRouter catalog for Beam-family IDs under the publisher
  namespaces `reflection`, `reflection-ai`, or `reflectionai`. Unrelated
  Reflection 70B models and third-party Beam names do not match.
- Requires explicit finite nonnegative input/output prices and a positive
  integer context length, plus exact `text->text` modality. An
  input-paid/output-free model is not marked free. Per-request fees must be
  omitted or explicit zero; nonzero or malformed fees defer adoption.
- Persists through the existing atomic registry overlay, then activates Beam
  in the running model registry. Repeated catalogs do not duplicate entries.
  A dry run changes neither disk nor the live registry.
- Validated token rates are persisted with the adopted entry and consumed by
  the cost ledger immediately and after restart. Overlay Beam entries without
  valid rates cannot load; the generic ranking adopter cannot bypass this
  family's admission. No unverified cache discount is applied.
- Uses the existing owner email notification on adoption. Provider acceptance
  is not proof of inbox delivery. New entries retain ordinary provider access,
  billing and model-selection controls.
- Selecting a paid Beam entry does not override the existing metered-use
  policy; that policy can substitute a free model when metered use is disabled.
  Registration does not prove that a selected request actually served Beam.
- Does not change default models, standing jury membership, flat-rate
  entitlements or model-quality policy. No automatic paid inference test.

OpenRouter listing is availability metadata, not proof of working inference,
quality, licensing completion or a free subscription entitlement. This watch
does not inspect Reflection's private waitlist, Profundo or Openference.
Those flat-rate services need independent entitlement/routing verification
before adoption; a model appearing in their discovery catalog alone is
insufficient. The production watcher includes this rule only after publishing.

## Design gate

1. Cost/scale: zero additional catalog fetches or LLM calls; one matching pass
   within the existing bounded daily catalog request.
2. State: existing registry overlay is a reconstructible catalog cache, not
   customer state. If a publish clears it, the next successful catalog sync
   re-discovers eligible listings. Runtime activation follows successful write.
3. Failure: invalid catalog metadata or a corrupt/unwritable overlay cannot
   activate Beam. Existing sync error handling remains unchanged.
4. Idempotency: normalized model ID, checked against registry and overlay.
5. Tenant/limits: existing platform-owned heartbeat supplies trusted admin
   scope. No new tenant query, route, credential borrowing or spend exception.
6. Stop/observation: disable the existing Model Catalog Sync task; adoption
   and invalid-metadata deferrals log through the catalog subsystem. Removing
   an adopted entry also requires removing its overlay entry and restarting.
7. Authority: owner authorizes this narrow family; catalog data cannot select
   a new publisher pattern, modify safety policy, or promote jury membership.
8. Evidence: synthetic tests cover exact names, malformed prices/context,
   cost classification, deduplication, dry-run isolation, persistence and
   immediate activation, request-fee refusal and text-modality admission.
   Independent review found the fee/modality gaps; both were corrected and
   covered by regression tests. The live catalog currently has no Beam entry;
   future provider inference remains unverified.

## Operational guidance

Do not tell users Beam is already installed, recommend it as a quality winner,
or assume local hosting is feasible. Agents use the ordinary model listing and
selection surfaces after adoption; no new tool or persona permission is needed.
No persona prompt changes: this is an internal refresh-loop rule.
