# Gemini Carbon high-end API

## Scope and design
Owner-requested high-end direct Google `gemini-4-carbon` option. Dedicated
`GEMINI_HIGH_END_API_KEY` Secret, never a replacement for existing Google,
Vertex or report credentials. Explicit verified owner selection and metered
access only; no automatic default, jury insertion, customer route or publication.

### Design gate
1. Cost: zero automatic retries; reserve the conservative $4/$20 per million
   token maximum before dispatch against the existing shared $30 UTC-day cap.
   Count thinking in output usage. Account at $2/$10 through November 30, 2026,
   then $4/$20, with 95% implicit-cache discount on cached input.
2. State: existing PostgreSQL reservation and cost ledger; no new schema.
3. Failure: access, usage, accounting and uncertain dispatch fail closed.
   Retain uncertain holds; do not silently substitute another paid/free model.
4. Identity: a server-issued reservation UUID per admitted request; request-local
   transport blocks automatic replay after uncertainty.
5. Tenant/limits: platform-owner only, trusted owner context rechecked at dispatch.
   Bounded request, output, stream buffer and deadline. No broader tool authority.
6. Stop: `GEMINI_CARBON_DISABLED=1` blocks admission and dispatch; missing/invalid
   dedicated credential blocks this lane without changing other Google routes.
7. Authority: Bob selects/approves, server gates and budgets execute; model cannot
   change limits, approve tools, publish or authorize itself.
8. Delta: optional high-end model only. Verify positive/negative access, no retry,
   reserve-before-send, exact model, accounting, rate rollover and selection.

## Verified references and limits
- Official model: https://aistudio.google.com/docs/models/gemini-4-carbon
- Migration: https://aistudio.google.com/docs/whats-new-gemini-4-carbon
- Pricing: https://ai.google.dev/gemini-api/docs/pricing
- Authenticated read-only model metadata returned HTTP 200,
  `models/gemini-4-carbon`, 1,048,576 input and 32,768 output tokens. Use the
  narrower verified output limit, not the documentation's 65K/long-decode path.
- Paid-tier inputs are not used to improve Google's products according to the
  pricing page; no claim of zero retention is made.

## Acceptance
Selectable powerful-tier owner model; shared budget and mandatory ledger;
SDK retry disabled; normal defaults unchanged; persona doctrine updated.
Read-only metadata does not prove successful generation. Local implementation,
live generation, publication and production adoption are separate evidence.

## Local verification
The Developer API's OpenAI compatibility endpoint uses the documented SDK
Bearer authentication, not the Vertex express-mode key-header workaround.
Both native metadata and Bearer compatibility metadata authenticated. The first
generation test used the wrong transport authentication and returned 400.
After correction, the initial bounded guarded generation test returned HTTP 429
with no response body. That established rate/quota rejection at that time, not
which limit or billing setting caused it. No automatic retry was performed.

On November 12, 2026, a fresh owner-requested single retest succeeded through the
configured guarded route. The provider reported `gemini-4-carbon` and returned
exactly `CARBON-OK`, using 38 input and 7 output tokens in about 7.1 seconds.
The persisted ledger recorded $0.000146, and the aggregate reservation settled
from a 6-cent hold to a 1-cent rounded budget debit. The rounded budget debit is
not the actual provider usage cost. This clears the earlier basic-generation
blocker for this test; live tool use, live streaming and sustained quota remain
unverified. No publication or production verification occurred.

Known usage is recorded before any over-reservation refusal. In that exceptional
case, the original held row is increased under the same global budget lock to
cover observed spend; it is not released or treated as approval for more work.
