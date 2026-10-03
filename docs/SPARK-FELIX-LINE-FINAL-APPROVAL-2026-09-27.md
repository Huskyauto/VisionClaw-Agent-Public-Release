# Felix → Spark outbox: final pre-republish review

**Prepared:** 2026-09-27  
**Revision:** 2 — answers Spark's three follow-up questions and includes the menu-capacity correction. The earlier Drive copy is superseded.
**For:** Spark and Bob  
**Status:** Development fix and follow-up checks complete; **not republished**; live production acceptance **pending**.

## Decision requested

Spark approved the original proposed fix, then asked three follow-up questions. Please review the additional one-slot menu correction and startup preflight below before Bob republishes the original VisionClaw application. This packet describes **all changes made after the 2026-09-27 published baseline** for the failed Felix → Spark outbox item, plus the two-minute polling clarification. Approval of this packet is **not** a claim that the fix has passed production acceptance.

## The failure and the fix

Spark's acceptance run showed that the API conversation worked, but Felix could not call `spark_send_message`; subsequent `GET /api/v1/spark/outbox?since=0` returned an empty outbox. The tool definition and handler already existed. The missing part was runtime **tool selection**: the routed, capped menu passed to Felix's model did not retain this tool.

The fix:

1. In the normal owner-tenant Felix (persona ID **2**) routing path, include `spark_send_message` as a mandatory tool so keyword selection and the menu cap cannot omit it. Other personas and tenants do not get it in their routed chat menus. The existing handler still enforces its own tenant/persona checks; menu filtering is not treated as authorization.
2. Pass the resolved persona ID and tenant ID into the router from both chat paths. Also filter the private tool out of other personas' and tenants' lean/subagent tool menus.
3. For a Spark tool call from either the main chat engine or the streaming route, stamp the **server-known conversation ID** before dispatch. Model-supplied underscore-prefixed context is removed first; the handler receives the trusted ID through tool context. Without this change, an eventual outbox row could have had a null `conversationId` even if the menu issue were fixed.
4. Spark's menu-capacity question exposed that the original pin could displace a normal Felix tool at the 40-tool cap. Give only owner-tenant Felix **one additional routed-menu slot** (effective cap 41) for the mandatory Spark tool; other personas and tenants stay at their existing caps. A boot-time preflight now checks Felix's real routed menu contains both Spark and `cash_flow_summary` and records the result in startup logs.

No changes were made to outbox schema, polling endpoint behavior, authentication, rate limits, retention, message validation, or idempotency.

## Exact files edited

The comparison point is the commit that published the app before Spark reported the failed item (`47c24b124`). The first two implementation commits were `ff5a0d5cb` and `22cfcc357`; the cap/preflight changes came afterward. This review packet is a document, not part of the runtime.

| File | Change |
|---|---|
| `server/tool-router.ts` | Added `filterSparkLineTools`: retain the tool only when `personaId === 2` and tenant matches `ownerTenantId()`. Added `personaId` to router options and pinned `spark_send_message` in the mandatory context tool list for that identity. Added an effective cap of **requested cap + 1** only for that Felix/owner pair so the pin does not consume a former normal-menu slot. |
| `server/chat-engine.ts` | Pass persona ID to `routeTools`; apply private-tool menu filter before normal, lean, and subagent menu choices; stamp the current conversation ID for `spark_send_message` before tool dispatch. |
| `server/routes.ts` | Pass persona ID into the streaming router and stamp the current conversation ID for a streaming `spark_send_message` call. On startup, use the actual tool definitions and capped router for a synthetic Felix/owner reporting request; log a **pass only if Spark and `cash_flow_summary` are both present**, or a clear failure without blocking server startup. This makes the production menu check observable before a live dispatch; it does not invoke a model or send a message. |
| `tests/tools/tool-routing-context.test.ts` | Added a capped-menu test proving owner-tenant Felix retains the tool while another persona and another tenant do not; added a check that only owner-tenant Felix gets the extra slot. |
| `tests/tools/tool-cap.test.ts` | Added a pure cap regression asserting an existing reporting tool remains present when a protected Spark tool uses the extra slot. |
| `tests/tools/spark-send-message.test.ts` | Added a source-wiring regression check for trusted conversation-ID stamping in both dispatch paths. This is a **source check**, not a model-driven API test. Existing handler tests remained in place. |
| `scripts/verify-spark-line-development.ts` | Changed the development database smoke from calling the outbox service directly to calling the **registered Spark tool handler**. It verifies exact queued text, persona ID 2, and the newly created conversation ID; the script still cleans up its test data. This is not a production model call. |
| `docs/SPARK-FELIX-LINE-README.md` | Replaced the five-minute watcher example and latency note with the **two-minute** interval Bob and Spark found workable. Explicitly says Spark, not VisionClaw, sets this interval. Added postpublish checks for the routed-menu startup receipt and the existing Felix prompt row. |
| `server/seed-persona-prompts.ts` | Updated Felix's Spark Line guidance from a five-minute to a two-minute poll. |
| `.agents/memory/persona-tool-exposure.md` | Added an internal engineering lesson: registered/handler-tested does not mean present in a capped chat menu; check trusted conversation context too. No runtime effect. |
| `.agents/memory/MEMORY.md` | Linked the new internal lesson and removed seven low-priority, unrelated research-note index pointers while leaving the underlying notes intact. No runtime effect. |

**Development database-only change:** Updated the existing Felix persona's `operating_loop` by replacing **one** occurrence of “Spark's five-minute poll” with “Spark's two-minute poll.” Verified the live development row has the new wording and no old wording. This was a narrowly scoped prompt-text update, not a schema change or a production database write. **The production row is not automatically refreshed by republishing**; see Q1 and the postpublish checklist below.

**For an exact source patch** in this workspace, compare the published baseline to the current working tree: `git diff --no-color 47c24b124 -- server/tool-router.ts server/chat-engine.ts server/routes.ts tests/tools/tool-routing-context.test.ts tests/tools/tool-cap.test.ts tests/tools/spark-send-message.test.ts scripts/verify-spark-line-development.ts docs/SPARK-FELIX-LINE-README.md server/seed-persona-prompts.ts .agents/memory/MEMORY.md .agents/memory/persona-tool-exposure.md`.

## What was verified

- **24/24 focused tests passed**, covering routing, Spark handler behavior, and tool-cap behavior after the fix and follow-up correction.
- `npm run check`, `npm run build`, and `git diff --check` passed. The build reported three existing CommonJS/`import.meta` warnings; it completed successfully.
- The development DB smoke invoked the registered handler and found the exact test text in the outbox with `personaId: 2` and a non-null, matching `conversationId`.
- The development workflow restarted after the router and preflight changes; it served on port 5000, passed the tool-registry audit, and logged a Felix owner-tenant routed menu with 41 tools and Spark present. A separate full-definition development probe compared two representative requests to the 40-tool baseline. The startup check now additionally requires `cash_flow_summary`.
- An independent review found no new high-impact security or correctness issue in the follow-up code diff. Its finding that the first startup check did not inspect cash-flow visibility led to the additional check above. These checks do **not** replace a published, authenticated, model-driven acceptance run.

**Do not count these as independently reverified by this change:** Spark reported that outbox polling, the API thread and full reply, follow-up, duplicate idempotency key, bogus-key `401`s, and the published tables passed in its earlier run. This work did not change those paths, but they must be checked again after republishing.

## Answers to Spark's follow-up questions

1. **Does the two-minute wording reach an existing production Felix row? No, not by republishing alone.** Startup seeding adds missing personas but does not rewrite an existing `operating_loop`; the source prompt and development row were changed, **not the production row**. Once Bob authorizes republishing, inspect Felix's production wording and perform a targeted persona-ID-2 admin sync or an exact old-phrase replacement if still needed, then read it back. The scoped sync can refresh other Felix docs too, so review its effect first; do **not** run a full persona reseed. Spark's actual polling cadence is independently controlled by Spark.
2. **Does the pin displace another tool? It did before this follow-up correction.** With 421 real definitions and a 40-tool menu, a Spark-request probe displaced optional `knowledge_navigate`; an ordinary business-health probe displaced `cash_flow_summary`. The latter was not an acceptable tradeoff for Felix. After giving only owner-tenant Felix a 41st slot, the same two probes retained **all 40** prior selected tools and added only `spark_send_message`; none were displaced in these representative routes. Mandatory tools remain protected; other personas and tenants retain the old cap. Tool ranking depends on the request, so these measurements are not a claim that every possible prompt has been exhaustively tested.
3. **Can we check the published menu before model-driven acceptance? Yes, after republishing.** The server now runs a synthetic Felix/owner request through the actual capped router against its actual tool definitions at startup. It logs `Felix Spark routed-menu preflight passed` only when both `spark_send_message` and `cash_flow_summary` are selected; otherwise it logs `FAILED`. Development boot passed; **the published build has not run this check yet**. Inspect its production startup log before Spark's acceptance turn. This proves routed-menu availability for that request, **not** that a model chose the tool, sent a message, or wrote an outbox row.

## Important limits for approval

- **Production still runs the previously published build.** This work has not republished the app or proved that Felix calls the tool in a live published conversation.
- The published Felix prompt still needs a scoped wording sync/readback after republish; the development-only row edit cannot update production.
- The existing owner-tenant `introspect_tools` catalog can reveal tool names to other owner personas by owner policy; this fix restricts **routed chat menus**, while the existing Spark handler remains the execution boundary. No catalog-policy change is included.
- Explicit caller-supplied lean `toolFilter` menus are not automatically expanded to add Spark; the mandatory pin covers the normal Felix API conversation route tested by Spark.
- Two-minute polling is a **Spark watcher setting**, not a VisionClaw server timer. No one here changed Spark's scheduler. Cursor-based polling can run at that interval without an outbox-server change; it does not guarantee a response within two minutes.

## Acceptance after Bob authorizes republish

1. Republish the **original** VisionClaw app, not a backup fork.
2. Inspect the **published** startup log for `Felix Spark routed-menu preflight passed (...; Spark and cash-flow available)`. A registry-audit pass alone is not enough; a missing or failed preflight blocks this menu check.
3. Inspect the production Felix persona row. If it still says five-minute polling, update **only Felix** through a reviewed persona-ID-2 admin sync or exact old-phrase replacement and read back the two-minute wording. Do not treat this prompt change as a change to Spark's watcher timer.
4. Use an authenticated API dispatch to ask Felix, in a new conversation, to queue a **multi-sentence, non-sensitive** message that mentions `/docs/q3-review.md`. Capture the exact requested text and returned conversation ID.
5. Poll `GET /api/v1/spark/outbox?since=0` using Spark's existing authorized channel. Require one new row with the message **verbatim**, `personaId: 2`, a non-null `conversationId` matching that API conversation, and a new `latestId`.
6. Recheck Spark's previously passing items: polling/cursor, full final reply, follow-up in the same thread, duplicate `Idempotency-Key` making only one turn, and unauthorized `401`s on polling and follow-up.
7. If any check fails, report the exact failed step rather than treating this review as acceptance. Keep customer data, credentials, and private documents out of test messages and shared logs.

**Approval boundary:** Spark approved the original proposal; the 41st-slot correction and log-only preflight are new and included here for review. Functional production sign-off must wait for steps 1–6 to pass after Bob explicitly authorizes republishing.