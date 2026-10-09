# Grok Bot ↔ Felix: VisionClaw handoff

**For Grok Bot and Bob. Updated 2026-09-29.**

## Availability and purpose

The published VisionClaw address is **https://agenticcorporation.net**. Use this production address, not a `.replit.dev` preview or the dashboard page URL.

Grok Bot can already send a task to Felix, read Felix's reply, and continue the same API-created conversation. The separate **Felix → Grok Bot outbox** described below has been implemented and checked in the development app, but **is not live until Bob publishes this update and the production schema is applied**. Until then, a request to `/api/v1/grok/outbox` may return 404; that is not a reason to use Spark's outbox instead. Do not announce the full two-way channel as operational until the production acceptance check at the end passes.

This is a coordination channel, not permission to contact customers, spend, publish, approve work, or start an autonomous message loop. Felix must deliberately invoke `grok_send_message` to queue an unsolicited message; the API does not automatically send Felix's every reply into the outbox.

## Credentials and boundaries

- Use the **VisionClaw `vc_` API access key Bob already gave Grok Bot**, stored in Grok Bot's private server-side secret store. Never send the key in chat, a URL, a document, a screenshot, or client-side JavaScript.
- The key must have **`chat` scope** and belong to Bob's owner tenant for the Felix → Grok Bot handoff. A read-only key cannot dispatch, follow up, or poll this outbox. API keys identify a **tenant**, not a bot or a single conversation: a separate Grok key is good for revocation, but it is not a per-bot access-control boundary. Other owner-tenant chat keys may be able to call the Grok endpoint too.
- Send `Authorization: Bearer <private-key>` on **every** API request and `Content-Type: application/json` for POSTs.
- Grok Bot's outbox is `/api/v1/grok/outbox`. **Never poll `/api/v1/spark/outbox` for Grok Bot**; it contains Spark's messages. Never reuse Spark's conversation ID.
- Bob can revoke Grok Bot's key in VisionClaw's API-key settings. The Grok outbox can be disabled with `GROK_LINE_ENABLED=0` without disabling the ordinary conversation API.

The shell examples use variable names only; they contain **no actual key**. Set `VC_BASE_URL=https://agenticcorporation.net` and set `VC_API_KEY` from Grok Bot's private secret store.

## 1. Grok Bot starts a private Felix thread

```sh
curl -sS -X POST "$VC_BASE_URL/api/v1/agents/dispatch" \
  -H "Authorization: Bearer $VC_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"agent":"Felix","task":"This is Grok Bot opening our coordination thread. Please confirm you received this. Do not spend, publish, contact anyone, or echo this request to an outbox.","async":true}'
```

Expect HTTP **202** with a numeric `conversationId` and a `statusUrl`. **Persist that conversation ID** in Grok Bot's durable state. A 202 acknowledges dispatch; it does **not** prove Felix answered or used any tool. If the call fails, log the HTTP status and a redacted error; do not guess a conversation ID.

Poll for the answer:

```sh
curl -sS "$VC_BASE_URL/api/v1/conversations/$CONVERSATION_ID" \
  -H "Authorization: Bearer $VC_API_KEY"
```

Wait for `status: "complete"`, then read `lastAssistantMessage.content`. `status: "failed"` includes `reason`; do not treat an older `lastAssistantMessage` as the new response. If a run times out, **do not automatically start another turn in that thread**: an old worker may still be running. Report the failed run to Bob.

## 2. Grok Bot follows up in its own thread

After the previous turn has finished, use a new, persistent, unique `Idempotency-Key` for each **new** message:

```sh
curl -sS -X POST "$VC_BASE_URL/api/v1/conversations/$CONVERSATION_ID/messages" \
  -H "Authorization: Bearer $VC_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $UNIQUE_MESSAGE_ID" \
  --data '{"message":"Felix, here is my follow-up question.","async":true}'
```

Poll the same conversation as in step 1 for Felix's answer. Preserve the **same key and exact message** on a network retry; never recycle a key for different text. Messages are limited to **16,000 characters**. A 409 means another turn is running, the thread timed out, or the key was reused incorrectly; inspect status and stop. A 404 means the thread is missing, belongs to another tenant, or was not created through this API; start a new API conversation instead of reusing a dashboard or Spark thread.

## 3. Receive Felix-initiated messages (after publishing)

Felix has a distinct `grok_send_message` tool that queues **1–4,000 characters of non-sensitive coordination text** in Grok Bot's outbox. It returns an `outboxId` only when the queue write succeeds. A queued message is not proof that Grok Bot has read or acted on it.

Grok Bot runs a watcher on its own side, for example every **two minutes** (this is a Grok Bot setting, not a VisionClaw delivery guarantee):

```sh
curl -sS "$VC_BASE_URL/api/v1/grok/outbox?since=$LAST_HANDLED_ID" \
  -H "Authorization: Bearer $VC_API_KEY"
```

Start with `LAST_HANDLED_ID=0` on the first read. Response shape:

```json
{
  "messages": [
    {
      "id": 123,
      "personaId": 2,
      "agentName": "Felix",
      "message": "The draft is ready. Please review its scope.",
      "conversationId": 456,
      "createdAt": "2026-09-29T12:00:00.000Z"
    }
  ],
  "latestId": 123,
  "requestId": "example-only"
}
```

These IDs and the timestamp are **illustrative**. The server returns up to **50** messages ordered by increasing ID. Process and deduplicate each message by `id`; persist the last **successfully handled** ID, then request the next page using that cursor until no more messages remain. A response is not a delivery acknowledgment. Do not move the cursor past a message that was not handled. Outbox messages expire after **30 days**, so the watcher must poll within that period.

If `conversationId` is non-null, first check whether it is **Grok Bot's own API-created Felix conversation** and that its prior turn has completed. Only then reply using step 2. A UI-created, legacy, or unrelated conversation ID is **not** follow-up permission. If no eligible thread exists, create a new Felix API conversation with step 1, include the outbox `id` and a short response to Felix, and persist the new conversation ID. Never send a reply to Spark's thread. Do not automatically echo every received message back: reply only when there is an actual question or decision to convey.

The Grok queue is limited to **20 new messages per rolling hour**, with identical message/thread retries deduplicated within ten minutes. Felix must not include customer records, contact details, secrets, credentials, copied private documents, or unapproved actions. Automated checks cannot guarantee every sensitive detail is detected.

## Failures and recovery

| Result | What Grok Bot should do |
| --- | --- |
| `401` | Missing/invalid key. Stop and tell Bob; never print the key. |
| `403` | Key lacks the required scope. Bob must grant `chat` scope or use a different authorized key. |
| `404` on Grok outbox | Check whether Bob has published the Grok channel update; do **not** substitute Spark's outbox. |
| `503` on Grok outbox | The Grok channel is disabled; stop polling until Bob enables it. |
| `409` on follow-up | Inspect thread status and idempotency key; never start overlapping turns. |
| Network timeout on follow-up | Retry the **identical** message with the **same** `Idempotency-Key`. |
| Failed/timeout conversation | Report `reason` once; do not treat a stale reply as the result or blindly replay. |

## Production acceptance check after Bob publishes

1. Confirm the live `/api/v1/grok/outbox?since=0` answers with Grok-shaped JSON for the owner-tenant `chat` key, while unauthenticated requests return 401. Verify this call returns **no Spark rows**. A published root HTTP 200 alone is insufficient.
2. Create a **new** Grok Bot → Felix API thread. Ask Felix, in that thread, to invoke `grok_send_message` with a short, unique, non-sensitive test sentence. Poll until the conversation is complete; confirm Felix actually reports a successful `outboxId`, not just an intention to send.
3. Poll Grok Bot's outbox from its saved cursor. Require one new row with the **exact** test sentence, `personaId: 2`, the matching conversation ID, and a new outbox ID. If the row is missing, the two-way setup has **not** passed.
4. Post one follow-up to that same API thread, poll for its completed answer, and replay the follow-up with the **same** idempotency key to confirm no second turn starts. Do not run this check in Spark's thread.
5. Persist the watcher cursor only after the test row has been processed. Never paste the actual key or private message content into public logs.

**Status at handoff:** development implementation and focused checks are complete; **production publishing and the live authenticated round trip are still pending**. Until the production acceptance steps pass, Grok Bot may use steps 1–2 but must treat step 3 as unavailable.