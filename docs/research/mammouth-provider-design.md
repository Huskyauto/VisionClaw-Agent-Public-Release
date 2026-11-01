# Mammouth provider integration

Owner request: add the existing Mammouth subscription API account to the lineup.
Authentication and the live `/v1/models` catalog were verified on 2026-10-25.
The API spends credits; subscription access is not unlimited API inference.

## Module and caller map

- `server/providers.ts`: factory called by chat, jury and background services;
  explicit owner selection is already a server-verified option.
- `server/model-registry.ts`: static metadata consumed by discovery and pickers.
- `server/routes/platform-config.ts`: authenticated `/api/models` discovery.
- `server/lib/mammouth.ts`: isolated transport policy, request bounds and admission.
- Existing aggregate AI spend authority: reserves before outbound inference.
- Settings provider links and the existing picker require no new route or schema.

## Design gate

1. Cost: two explicitly selected models only. Per-request upper bound <= $0.25,
   no automatic retries, existing durable aggregate spend reservation before
   inference. Actual token usage settles the hold; uncertain outcomes retain it.
2. State: key in Secrets, budget and cost evidence in existing PostgreSQL tables.
   No new durable local state or database schema.
3. Failure: missing key, denied scope, disabled provider, unknown model, malformed
   usage and exhausted admission fail closed. No alternate paid transport.
4. Identity: exact model and endpoint; each dispatch has a fresh budget attempt.
   Failed or ambiguous inference is not retried automatically.
5. Scope: owner tenant only, explicit selection and verified administrator;
   recheck tenant context and operator state at dispatch. No customer BYOK claim.
6. Stop/observe: `MAMMOUTH_ENABLED=0` or remove the secret. Usage ledger records
   `llm.mammouth`, never zero marginal cost; global aggregate admission still applies.
7. Authority: the owner selects; server ingress verifies role; existing budget
   service admits; runtime dispatch cannot expand its model/account permissions.
8. Delta: optional provider, unchanged default routes and jury. Offline scope,
   body override, cap, usage and budget tests; one bounded synthetic live check.

Acceptance: selectable owner models, no non-owner key use, real credit-metered
inference, ledger accounting, no secret exposure or automatic spending promotion.
