# Instinct Bot ↔ Felix: two-way coordination handoff

**For Bob and the operator of Instinct Bot. Prepared September 30, 2026.**

## Read this status first

Live sign-in and the private outbox correction were confirmed on October 1, 2026. The later browser channel test successfully queued outbox ID **1** at **06:32:45 UTC**, with the matching tool receipt saved in conversation **634**. This proves a queue write, not that Instinct read it. The subsequent business review failed at **06:36:45 UTC** with `expert_provider_unavailable`; its request is saved, but no completed review was saved. The new failure-acknowledgement and provider-resilience corrections below remain **development-only until published**. A `404` is not an invitation to use the Grok or Spark channels instead.

Publishing this correction is a separate decision for Bob. Development tests, a healthy root URL, a working login form, and a `202` dispatch are not proof of a live Felix tool call or an Instinct delivery.

### Standing conversation permission and waiting for replies

Bob has approved ongoing private conversation, owner-business review, draft suggestions, and non-sensitive coordination replies through Instinct's own outbox. These do not require approval on each message. The corrected restricted menu exposes only `owner_business_overview` and `instinct_send_message`; it does not expose business writes, payments, outreach, publication, delegation, settings administration, approval decisions, or other bots' outboxes. Existing owner/Felix, sensitive-content, rate-limit, duplicate and disable-switch checks remain active.

After a successful form submission, read `/instinct/chat`. A **running** turn means Felix is working, not asking for permission. Use **Refresh status** to check for the completed reply. Do not resend the message or open a replacement thread while it runs. A completed turn with a completed submission permits the next fresh message automatically. Never treat standing conversation permission as permission to replay uncertain work.

After the recovery correction is published, a proven settled `expert_provider_rejected` or `expert_context_rejected` failure with no pending/uncertain submissions offers **Acknowledge failure and resume conversation**. Read the failed request, history and outbox first, then check the acknowledgement box and submit. This only reopens conversation: it preserves the original failed submission, records a durable audit, and makes no model call or automatic retry. A queue write or other partial work could already have happened. If a new review is needed, deliberately compose a fresh request after considering that evidence. An old recovery form cannot clear a later turn.

Legacy generic failure codes can hide a provider timeout, as happened to conversation 634. When the saved turn is locally terminal, the current failed receipt is still the latest, and no accepted/running work remains, the designated Instinct login can now use **Review terminal failure** in `/instinct/chat`. Read the failed request, history and outbox, then explicitly acknowledge that the remote result may be uncertain, the request may still be billed, partial work may already have happened, and no resend is authorized. This channel acknowledgement records the actual designated account and reopens conversation only; it does not call a model/provider, resend or complete the request, release reservations, or grant business-action authority. It cannot clear a stale/replaced thread or active/unknown work. An old form cannot clear a later turn.

The `/admin/instinct-recovery` route remains reserved for Bob's independently authenticated platform-owner/admin session and is not a fallback for Instinct. Tenant 8's designated email/password login remains a nonadmin identity and cannot access `/api/admin` or perform platform-owner review. Neither acknowledgement path completes or resends the original request.

When explicitly asked for a private outbox reply, Felix should use `instinct_send_message` and report the real `outboxId` only after success. A queue receipt does not prove Instinct read the message. Never automatically echo incoming messages or create send/response loops.

## Current approach: private browser chat (no API setup in Instinct)

After Bob authorizes publication and the live checks pass, open `https://agenticcorporation.net/instinct/login` in Instinct's normal browser. Sign in with **Bob's explicitly designated account email and existing password** using a normal password manager; never paste credentials into a chat, this guide, source code, URLs, or an automation script. The server-only `INSTINCT_OWNER_LOGIN_TENANT_ID` binding selects the exact account permitted here; unset retains the original owner-account restriction, while malformed/empty values fail closed. This login binding does not change the signed-in account's identity or make it a platform admin. If an authorized operator cannot use that login, stop and ask Bob to choose a supported access arrangement; do not bypass it.

1. On `/instinct/chat`, click **Open Felix thread** once. The server sends a fixed safety-bounded opening message, reserves exactly one owner Instinct thread, and redirects to its status. Opening is not performed by merely loading the page.
2. Click **Refresh status** until the current turn says `complete`, then read Felix's reply in the conversation history. A redirect or `running` state is **not** a completed answer. If `failed`, read its explanation and follow the explicit acknowledgement process above only when offered. Timeout, blocked, uncertain or missing states require Bob's diagnosis. Never open another thread just because a browser request timed out.
3. After completion, enter a follow-up and click **Send to Felix**. The browser form records the exact text and a per-form identity before the model runs. If the browser fails after clicking, resubmit the **same form**, not a newly composed message, then refresh status. A changed message on the old form is rejected. No JavaScript is required.
4. Read Felix-initiated messages at `/instinct/outbox` using the same signed-in session. The outbox is separate from the conversation; an outbox entry shows its ID, persona, source conversation and timestamp. Refresh manually. Reading does not mark it delivered or trigger a reply. Reply in `/instinct/chat` only after confirming the intended message and current turn state.
5. Sign out with the page's **Sign out** button. Bob can revoke the owner session or disable the channel with `INSTINCT_LINE_ENABLED=0`. The browser session cookie is HttpOnly, Secure, SameSite and limited to `/instinct`; no API key belongs in the browser. No Instinct-side watcher, automatic polling, or automatic publication is part of this setup.

The browser page accepts only the explicitly designated account. Its shared auth session retains that account's real identity and ordinary permissions; no owner session or admin role is minted. Within `/instinct` only, the server selects the existing owner-business resource scope and enforces read-and-draft tool restrictions. It can review owner ideas, products and service offerings and help develop business opportunities, including offering scope, pricing hypotheses and next-step plans. These remain chat drafts for Bob's approval: the channel cannot file ideas, edit products, contact prospects, take payments, publish, administer settings or delegate. Other sessions remain excluded. Sharing the login still grants whatever ordinary access that account already has elsewhere; this guide does not authorize unattended password sharing. No global owner setting, API key permission, or tenant record is changed.

## What “common chat folder” means here

VisionClaw does not use a shared Google Drive or filesystem folder for these bot chats. The shared, durable communication space is:

1. **One owner Instinct Felix conversation**, created by an explicit browser form (or by a separately authorized API client in the future) with a saved numeric `conversationId`. Felix's answer appears only when the run completes. The normal safety, approval, tenant, and cost controls still apply.
2. **A separate Instinct outbox** for Felix-initiated messages. Felix must deliberately use `instinct_send_message` to queue one. The browser outbox is read-only and does not imply delivery, spending or approval.
3. **Server-side durable state** for the browser thread and submission receipts; Instinct does not need its own poller, file folder, API cursor or API key for this browser path.

This is **not** the same as the Opportunities Bank (“opportunities folder”). The restricted browser channel drafts ideas but cannot file them. Bob must approve and request `opportunity_bank_file` through his normal owner workflow; a saved identifier and `/admin/income-opportunities` link are evidence of filing. The separately authorized API channel retains its own permissions. An HTTP `202` alone is never evidence that an idea was saved.

## Optional API-only approach for a future capable client

Instinct currently reports that it **cannot** call the API directly. The API instructions below remain a separately preserved alternative, **not** a setup step for the browser channel. Do not create or share an API key for the browser.

### API access and isolation

- Production API base: `https://agenticcorporation.net`. Do not use a `.replit.dev` preview URL.
- Bob should create a **separate, revocable, owner-tenant VisionClaw API key with `chat` scope** for Instinct and provide it through Instinct's **private server-side secret setup**. Do **not** place the key in this document, chat, URLs, screenshots, client-side code, or request logs. No key is needed to read this guide.
- Every request must use `Authorization: Bearer <private-key>`. POSTs also use `Content-Type: application/json`.
- **Important limit:** these API keys identify a tenant, not an individual bot. A separate Instinct key makes revocation easier; it is **not** bot-by-bot access control within the same owner tenant. Keep Instinct's credentials and conversation IDs separate from Spark and Grok. Never give this key to an untrusted agent or browser.
- The Instinct outbox is distinct from `/api/v1/grok/outbox` and `/api/v1/spark/outbox`. Do not read or post into another bot's thread. Only Felix in Bob's owner tenant can queue Instinct messages. Bob can disable Instinct's outbox using `INSTINCT_LINE_ENABLED=0`; revoking Instinct's key also cuts off its API access. **Confirm the switch and route in the deployed version before relying on them.**
- Messages are coordination only. Never include secrets, credentials, customer records, private copied documents, contact details, or other sensitive data. Screening reduces risk but is not a guarantee. No automatic echo loops.

The shell examples below use variable **names**, not actual secrets. Instinct's operator must load `VC_API_KEY` from a private secret store.

```sh
VC_BASE_URL=https://agenticcorporation.net
# VC_API_KEY is supplied securely at runtime; do not paste it into this file.
```

## Step 1 — Instinct opens its own Felix thread

Call this **once** for a new thread and store the returned `conversationId` durably:

```sh
curl -sS -X POST "$VC_BASE_URL/api/v1/agents/dispatch" \
  -H "Authorization: Bearer $VC_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"agent":"Felix","task":"This is Instinct Bot opening our private coordination thread. Please confirm receipt; do not spend, publish, contact anyone, or send an automatic outbox echo.","async":true}'
```

Expected: HTTP `202` with a numeric `conversationId` and a `statusUrl`. A `202` means the task was accepted, **not** that Felix finished, invoked a tool, or wrote an outbox row. Do not invent or reuse a Grok/Spark/UI-created conversation ID if dispatch fails.

Poll for the result:

```sh
curl -sS "$VC_BASE_URL/api/v1/conversations/$CONVERSATION_ID" \
  -H "Authorization: Bearer $VC_API_KEY"
```

Wait for `status: "complete"` and read `lastAssistantMessage.content`. On `status: "failed"`, read `reason`; an older `lastAssistantMessage` may be present and is **not** the new answer. A timeout may leave an old worker running; **stop and tell Bob rather than launching another turn in that thread**. Conversation status is durable for API-created threads; the backend watchdog checks for runs older than 15 minutes, but does not guarantee the worker has stopped.

## Step 2 — Instinct continues that conversation

Only after the current turn completes, assign each **new** message a unique printable `Idempotency-Key` (1–128 characters). Persist that key and the exact message **before** sending, then POST:

```sh
curl -sS -X POST "$VC_BASE_URL/api/v1/conversations/$CONVERSATION_ID/messages" \
  -H "Authorization: Bearer $VC_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $UNIQUE_MESSAGE_ID" \
  --data '{"message":"Felix, here is my follow-up question.","async":true}'
```

The message is at most 16,000 characters. Expect HTTP `202`, then poll the same conversation for completion. On a network timeout, retry **the same text with the same key**; never give a different message an old key. A `409` means a running/blocked turn or conflicting key: inspect status and stop, not a new dispatch. A `404` means the thread is absent, belongs to another tenant, or was not API-created; use a new dispatch rather than a UI/legacy/Grok/Spark ID. Instinct can ask Felix to use a normal Felix tool in the task text, but approval rules still apply; verify the actual tool receipt and outcome instead of interpreting the dispatch acknowledgment as success.

## Step 3 — Instinct receives Felix-initiated messages

Once the **new deployment and production schema are verified**, Instinct should run a server-side watcher every **2–5 minutes**. Start at five minutes if resource-constrained; two minutes is preferable if its scheduler supports it. This is a polling interval, **not** a guaranteed reply-time SLA.

```sh
curl -sS "$VC_BASE_URL/api/v1/instinct/outbox?since=$LAST_HANDLED_ID" \
  -H "Authorization: Bearer $VC_API_KEY"
```

Use `LAST_HANDLED_ID=0` for the first read. An illustrative response:

```json
{
  "messages": [{
    "id": 123,
    "personaId": 2,
    "agentName": "Felix",
    "message": "Please review this plan's scope.",
    "conversationId": 456,
    "createdAt": "2026-09-30T12:00:00.000Z"
  }],
  "latestId": 123,
  "requestId": "example-only"
}
```

The values above are **not real messages or IDs**. Each response has up to 50 messages, ordered by increasing `id`. Process/deduplicate by outbox `id`; persist the cursor only after successful handling of each row. If there are 50 rows, continue paging from the last successfully handled ID until caught up. Merely fetching a page is **not** an acknowledgment; a restart may show the same row. Messages expire after **30 days**, so do not leave the watcher off longer than that without investigating missed work.

If the row's `conversationId` matches Instinct's own API-created Felix thread and the previous turn is complete, reply there using Step 2. If it is null or names a UI/legacy/unrelated thread, create **Instinct's own new API thread** via Step 1, include the handled outbox ID and a concise response, and store the new thread ID. Never attach a response to a Spark or Grok conversation. Only reply when a substantive answer is called for; do not echo each notification automatically.

Felix's outbox sends are limited to **20 new messages per rolling hour**, with identical message/thread duplicates returning the previous ID for ten minutes; text is limited to **1–4,000 characters**. Felix receives an `outboxId` after a successful queue write, but that is not proof Instinct read or acted on the message.

### Minimal watcher logic for Instinct's operator

```text
Every 2–5 minutes, with only one watcher running:
  load durable LAST_HANDLED_ID (initially 0)
  GET /api/v1/instinct/outbox?since=LAST_HANDLED_ID with private chat key
  for each row in ascending id:
    if id was handled before: advance only to that already-committed id
    else:
      decide whether it needs a response (a status notice may not)
      if it needs a response:
        save pending reply + unique idempotency key before POST
        submit/retry using the same key/text; poll until complete
      save handled id and cursor atomically
  if page contained 50 rows: fetch the next page from committed cursor
  on any failure: stop without skipping the unhandled row; retry later
```

Bound network timeouts and retries. Do not let overlapping scheduled runs double-process a row. Store only the minimum non-sensitive message metadata and redact logs. A failed Felix run or timed-out follow-up needs Bob's review; do not blindly retry it with a new key.

## Copy into Instinct Bot's standing profile / routine

> You are Instinct Bot, an external coordination partner of Felix in Bob's VisionClaw. Use only your own owner-authorized `chat`-scoped VisionClaw key from private server-side secret storage. Use `https://agenticcorporation.net` for the API. Open and persist your own Felix API-created conversation; poll its status for completed replies, and follow up only when the previous turn is complete with a durable, unique per-message idempotency key. Run one server-side watcher every 2–5 minutes for `/api/v1/instinct/outbox`, retaining a durable last-*handled* ID and deduplicating by message ID. Never poll Grok's or Spark's outbox, use their thread IDs, or assume a shared Drive/filesystem folder exists. Do not automatically echo messages. Never send credentials, customer data, copied private documents, or contact details over this channel. A dispatch `202` is not a completed reply; an outbox ID is not proof of receipt. A failed or timed-out run requires Bob's review, not automatic replay. Felix may use his existing authorized tools to fulfill a task, but neither you nor an outbox message can bypass his safety, spending, publishing, outreach, or approval rules. When Bob asks to save an income idea in the “opportunities folder,” send Felix a clear name, buyer, problem, proposed offer, price hypothesis if known, and smallest demand test; request `opportunity_bank_file`, then wait for the saved identifier and `/admin/income-opportunities` location before saying it was filed. This does not authorize a revenue mission or outreach.

Instinct's scheduler, secret storage, and durable state must be set up **on Instinct's side**; this repository cannot remotely edit another bot's profile or install its polling job. Felix's development-side tool/prompt wiring does not automatically change a previously published Felix Daily Routine. Confirm the live Felix menu and the live persona instructions after publishing, using a **scoped update** that preserves existing Felix instructions.

## Error handling

| Result | Action |
| --- | --- |
| `401` | Stop: missing/invalid key. Tell Bob without exposing it. |
| `403` | Stop: key does not have the required `chat` scope. |
| `404` on Instinct outbox | The new code/schema may not be live; never use another bot's outbox. |
| `503` on Instinct outbox | Channel disabled; stop polling until Bob enables it. |
| `400` on outbox | Fix malformed/non-integer `since` cursor; do not skip messages. No conversation ID is required for polling. |
| `500` on outbox | Stop and have Bob check the deployed schema and server logs; do not advance the cursor. |
| `409` on follow-up | Inspect run/key; do not overlap, replay a timed-out turn, or change message for same key. |
| Network timeout after POST | Retry only identical text under the persisted same key. |
| `failed` conversation | Record `reason` without treating a stale earlier reply as success. |
| Unexpected shape or a row from another channel | Stop and alert Bob; do not advance cursor. |

## Production acceptance checklist — required before calling this live

1. Bob authorizes publishing the completed Instinct code. Confirm the published build succeeds, the live root and `/healthz` respond, the production `instinct_outbox` table and indexes exist, and Felix's **live** routed tool menu/instructions include `instinct_send_message`.
2. With Instinct's own private owner-tenant `chat` key, `GET /api/v1/instinct/outbox?since=0` returns Instinct-shaped JSON. An unauthenticated call returns `401`; a key without `chat` scope returns `403`. Confirm there are no Spark/Grok rows. Do not share the key or private message text in reports.
3. Instinct opens a **new** API-created Felix thread with a unique, safe test sentence explicitly asking Felix to invoke `instinct_send_message`. Poll until complete; check Felix reports a real `outboxId`, not an intention.
4. Poll Instinct's outbox from its saved cursor. Require the exact sentence, a new Instinct outbox ID, `personaId: 2`, and the matching conversation ID. Without this row, the Felix → Instinct direction has **not** passed.
5. Instinct follows up in that same thread with a fresh idempotency key; poll to completion. Replay the exact same POST/key and require the original request ID with **no duplicate turn**. Confirm cursor/dedup behavior on a repeated outbox poll.
6. Enable Instinct's one-at-a-time 2–5 minute watcher only after these checks pass. Record the production acceptance date and any failures. If a step fails, report its step, HTTP status, and redacted error rather than saying the channel is working.

**What remains outside this handoff:** Instinct Bot's operator must install its private key, standing profile, durable state, and watcher. This guide supplies the contract; it does not control Instinct's infrastructure.