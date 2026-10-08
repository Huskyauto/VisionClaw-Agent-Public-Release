# Felix Line — handoff for Spark

**Status (September 27, 2026):** Live in the **original published VisionClaw app**. Production startup verified Felix's routed menu contains Spark and cash-flow, and Bob saved the two-minute Spark Line guidance in Felix's production Daily Routine. **Spark's authenticated, model-driven round trip is still pending**; deployment and startup checks are not acceptance of an actual outbox delivery.

## What changed

## Income opportunities handoff (Spark → Felix)

Spark is an external participant, not a VisionClaw persona with a filing tool.
In Spark's **own Daily Routine/system instructions**, add this standing rule:

> When Bob asks to save an income idea in the "opportunities folder," send the
> idea to Felix in a new or already authorized Felix API conversation. Include a
> distinct name, buyer, problem, proposed first offer, price hypothesis if known,
> and the smallest buyer-demand test. Ask Felix to use
> `opportunity_bank_file`, and wait for its saved identifier and
> `/admin/income-opportunities` location before saying it was filed. Spark does
> not create a project, workspace, Drive folder, revenue mission, or menu entry
> as a substitute. Filing is an unvalidated Idea, not permission to publish,
> contact buyers, spend money, or start an experiment.

Felix's canonical tools addendum contains the receiving rule. The in-repository
instructions **cannot update Spark's external Daily Routine**; copying this
block into Spark is required. A one-off outbox message expires and is not a
substitute for that persistent instruction. Felix and Spark should never claim
that an API dispatch status of `202` proves the idea was saved; the Felix tool
receipt and a read of the Opportunity Bank are the confirmation.

Felix can place bounded, non-sensitive free-text updates and questions in a durable outbox. Spark reads that outbox using the **existing private VisionClaw API key** Bob gave it, then can send a follow-up into a **new conversation created through the API**. There is no webhook, separate Spark account, new key, or connection to Muse's personal-app allowance. The API URL is network-reachable, but outbox and message routes reject callers without an authorized key; do not put the key in this README, logs, query strings, or browser code.

The published fix also pins `spark_send_message` in the **owner-tenant Felix** routed chat menu. Only that persona/tenant pair gets a 41st slot, preserving the former 40 selected tools, including `cash_flow_summary`; other personas and tenants retain their normal cap and do not receive Spark in their routed menus. Both chat paths carry the server-resolved persona/tenant, and Spark dispatch uses the server-known conversation ID rather than trusting a model-supplied value. Tool exposure is not authorization: the handler still enforces its own checks.

The existing conversation (including the earlier line thread numbered 599) can still be read but **cannot accept new follow-ups** through this endpoint. Follow-ups require a durable API-run marker written only when a dispatch is made through the new API implementation; neither an older API dispatch nor a UI conversation has that marker. Start a new Felix dispatch after republishing and retain its `conversationId`.

## Authentication and base URL

- Use the **same published VisionClaw base URL** and private `vc_` API key Spark already uses. Do not substitute a development `.replit.dev` URL for the published app.
- Send `Authorization: Bearer <private-key>` and `Content-Type: application/json` for POSTs.
- The key must have the `chat` scope. A `read`-only key cannot poll the Felix outbox or post follow-ups.
- The key identifies a tenant, not an individual thread. Keep it only in Spark's server-side secret storage. Do not forward it to other agents or clients.

The examples below use `$VC_BASE_URL` and `$VC_API_KEY` as **local environment variable names**, not actual values.

## 1. Start a new Felix conversation

```sh
curl -sS -X POST "$VC_BASE_URL/api/v1/agents/dispatch" \
  -H "Authorization: Bearer $VC_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"agent":"Felix","task":"We are opening the new Spark Line. Confirm you can continue this thread; do not spend, publish, or contact anyone.","async":true}'
```

Expect HTTP `202` with a numeric `conversationId`, `status: "running"`, and `statusUrl: "/api/v1/conversations/{id}"`. **Persist that ID.** Dispatch starts processing in the app process immediately; `202` is not a promise that a separate durable worker picked it up.

Poll for the reply:

```sh
curl -sS "$VC_BASE_URL/api/v1/conversations/$CONVERSATION_ID" \
  -H "Authorization: Bearer $VC_API_KEY"
```

The response includes `status` (`pending`, `running`, `complete`, or `failed`), `lastUserMessage`, `lastAssistantMessage`, and `requestId`. For these newly marked API conversations, `status` comes from durable run state; do not assume an old thread's heuristic status has the same meaning.

**Completion contract:** For a marked API conversation, `status: "complete"` always includes the full, untruncated final assistant text in `lastAssistantMessage.content` (including any tool summary stored with it). There is no text truncation flag or reply-size cap at this endpoint; `messageCount` describes only the most recent 50 history rows, **not** the reply size. If no non-empty final assistant message was persisted, the run fails with `reason: "missing_reply"` instead of reporting complete. On `status: "failed"`, `reason` is always present (`"processing_error"`, `"missing_reply"`, or `"timeout"`), with `failedAt` when available; `lastAssistantMessage` on a failure could be from an earlier turn and must **not** be treated as a new reply.

The server-side watchdog scans every 30 seconds and marks a run `failed` / `reason: "timeout"` after **15 minutes since it started**. This is an age limit, not a proof that the worker stopped or a guarantee of completion by then. To avoid overlapping a possibly still-running worker, a timed-out conversation is **blocked from starting another turn** until an operator reconciles the old run; never automatically replay it. Report the failure to Bob once.

## 2. Poll Felix's outbound signals

Spark's existing watcher may poll every **two minutes**, the shortest working interval Spark and Bob agreed on. This interval is set by Spark, not VisionClaw:

```sh
curl -sS "$VC_BASE_URL/api/v1/spark/outbox?since=$LAST_OUTBOX_ID" \
  -H "Authorization: Bearer $VC_API_KEY"
```

Set `LAST_OUTBOX_ID=0` on a first read. Example response shape:

```json
{
  "messages": [
    {
      "id": 123,
      "personaId": 2,
      "agentName": "Felix",
      "message": "Please review the current plan.",
      "conversationId": 456,
      "createdAt": "2026-09-27T12:00:00.000Z"
    }
  ],
  "latestId": 123,
  "requestId": "..."
}
```

The `id` and time above are **illustrative**, not real events. Each response contains at most **50** rows, ordered by increasing `id`. Continue querying with `since=latestId` to drain further pages. Persist the last *successfully handled* ID and deduplicate by outbox `id`: this is cursor polling, not a delivery acknowledgment, and a failed/restarted watcher may see the same row again. Do not advance the cursor past a row Spark has not handled.

`conversationId` can be `null` if Felix sent from outside a conversation. A non-null ID is tenant-verified, but it may belong to a UI/legacy thread and therefore **does not by itself prove that the follow-up endpoint accepts that thread**. Use the new API-dispatch conversation ID from step 1 for reliable follow-ups.

Felix is limited to **20 new outbound messages per rolling hour** in the owner tenant. Identical text in the same conversation within ten minutes returns the prior outbox ID instead of queuing another row. Messages may contain **1–4000 characters** of Felix's own concise coordination prose, including safe project-path references such as `/docs/q3-review.md`. Obvious credentials and personal identifiers are blocked by deterministic checks and an egress scanner, but **no scanner can guarantee detection of every piece of customer data**: Felix must never include customer records, contact details, credentials, copied private documents, or task secrets. A message is coordination, **not** permission to approve spending, outreach, publishing, or mission advancement. Do not turn a received message into an automatic echo loop.

Rows remain in the outbox for **30 days**, then are purged by the server's hourly cleanup. Poll and persist your cursor within that window; `since=0` after the retention window does not recover purged history. Polling is not an acknowledgment.

## 3. Reply in the same new conversation

After the current turn is no longer running:

```sh
curl -sS -X POST "$VC_BASE_URL/api/v1/conversations/$CONVERSATION_ID/messages" \
  -H "Authorization: Bearer $VC_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $UNIQUE_MESSAGE_ID" \
  --data '{"message":"I received your status request. What do you need me to review?","async":true}'
```

`message` must be a non-empty string of at most **16,000 characters**; `async` defaults to `true`. Supply a fresh printable 1–128 character `Idempotency-Key` for **each new message** (for example, Spark's locally generated message UUID); persist it before sending. Use the *same key and same message* on a network retry. Keys are tenant/thread-scoped, retained for 30 days, and cannot be reused for different text. HTTP `202` returns `conversationId`, `status: "running"`, and `requestId`; replaying the same key returns HTTP `202` with that original `requestId` without starting another turn, even if it has since completed. Poll `GET /api/v1/conversations/{id}` for the authoritative current status. A completed synchronous request (`"async":false`) can return a `reply` inline on its first submission, but prefer async polling for the watcher.

If POST returns `409`, another API turn is running, the thread has timed out, or the key was reused with different text: inspect the status and stop; do not change a timed-out run by blindly retrying. `404` means the thread is missing, from a different tenant, or not marked as an API-created conversation; create a fresh dispatch rather than changing the thread title. `401` means missing/invalid key; `403` means insufficient scope. If the network times out, safely retry the **same message with the same key**; the server returns the original `requestId`. Requests without a key remain supported for older callers, but are not retry-safe.

## What was verified before publishing (September 27, 2026)

- **12 focused automated tests passed**: free-text bounds and sensitive-data rejection, tool tenant/persona checks, API route guards, untruncated completion formatting, failure reason formatting, and legacy-thread polling.
- **Typecheck and build passed.** The build emitted three pre-existing `import.meta`/CommonJS warnings in unrelated modules.
- **Development database seam passed** using a temporary thread cleaned up afterward: exact multi-sentence outbox text, concurrent claims of the same follow-up key (one claim and one duplicate with its original request ID), a full ~70,000-character reply, and a forced 16-minute-old run that became `failed`/`timeout` and remained blocked even when a late worker tried to complete.
- **Development HTTP authentication checks passed**: unauthenticated poll, outbox read, and follow-up POST each returned `401`. The app started cleanly after restart.
- After Spark's initial acceptance found an empty outbox, **24 focused routing/handler/cap tests passed** for the correction. A development handler smoke wrote an exact, multi-sentence message with persona ID 2 and a matching, non-null conversation ID, then cleaned up its test data. Typecheck, build, and the development startup menu check passed. These do not replace an authenticated production model call.

## Production checks completed before Spark's acceptance

- Bob published the **original project**. An initial attempt built and pushed an image but timed out waiting for VM readiness; a controlled republish succeeded (build `ba9fd2bb-d3ef-4e2a-83b1-80bc73d7a0c6`, September 27, 2026, 08:33:57 UTC). The initial failure did **not** report an 8 GiB image-limit error. Startup initially showed transient health-check and database-probe errors; later the root served HTTP `200` and production database reads succeeded. Report any renewed timeouts rather than assuming this proves long-term health.
- The **published startup log** says `[startup] Felix Spark routed-menu preflight passed (41 tools; Spark and cash-flow available)` at 08:35:47 UTC. This exercised the actual capped router with real tool definitions, a synthetic owner-tenant Felix request, and no model call or outbox write. The registry audit passed too, but the routed-menu receipt is the relevant proof.
- Production has `spark_outbox`, `api_v1_conversation_runs`, and `api_v1_followup_keys`; the run table has `failure_reason`, `failed_at`, and `completed_reply`, and the follow-up table has a unique `(tenant_id, conversation_id, client_key)` index.
- The existing Felix (persona ID 2) production Daily Routine **had no Spark guidance** after publishing. Rather than run the persona sync, which would also replace Felix's tools document, agents document, and entire operating loop, Bob appended **only the Spark Line block** in Felix's authenticated admin editor. A production readback found the old routine preserved, `Spark's two-minute poll` present, no five-minute wording, and the tools/agents document lengths unchanged. This is Felix's guidance, **not** a change to Spark's watcher timer.
- The published root returned `200`; an anonymous `GET /api/v1/spark/outbox?since=0` returned `401`. An authorized key and read-only-key `403` have **not** been exercised in this production handoff check.

## Spark's production acceptance checklist

1. With Spark's existing private key, create a **new** Felix API dispatch (step 1 above). Do not reuse conversation 599 or a UI-created thread. Ask for a **non-sensitive, multi-sentence** status update mentioning `/docs/q3-review.md`; capture the exact requested wording and returned `conversationId`.
2. Poll the conversation until complete, and check the full final reply. If the run fails or times out, report its `reason`; do not assume a stale `lastAssistantMessage` is the new reply and do not blindly start another turn after a timeout.
3. Poll the outbox from Spark's stored cursor (or `since=0` for this controlled first check). Require **one new row with the requested message verbatim**, `personaId: 2`, a non-null `conversationId` equal to the new dispatch, and a new `latestId`. A menu preflight pass alone does **not** prove Felix selected and invoked the tool.
4. Post one bounded follow-up in **that same conversation** after the prior turn finishes. Confirm its full final reply is attached to the same thread. Repeat the same follow-up POST with the same `Idempotency-Key`; require the original `requestId` and only one turn.
5. Recheck pagination/cursor handling and no duplicate processing when polling the same cursor. Confirm unauthenticated endpoints return `401` and a key lacking `chat` scope receives `403`. Never paste keys or private response contents into shared reports.
6. Spark may set its watcher to the agreed **two-minute** interval on Spark's side. If any check fails, report the precise step, HTTP status, and redacted error rather than declaring acceptance.

No part of this implementation guarantees a 60-second response. The two-minute watcher cadence, model processing time, and failures can all add delay. Bob retains the ability to revoke the key and disable Felix's sending tool.