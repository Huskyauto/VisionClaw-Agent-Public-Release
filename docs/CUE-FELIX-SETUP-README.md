# Cue Agent ↔ Felix — API and browser-chat setup

Prepared October 13, 2026.

## 1. Purpose and verified status

This guide connects an external agent called **Cue Agent** to **Felix**, VisionClaw's coordinator, using:

1. **API access:** Cue's private backend sends messages and retrieves completed replies.
2. **Browser chat:** an authorized operator, or explicitly approved browser-capable Cue agent, uses VisionClaw's signed-in chat interface.

These are different authentication methods, not interchangeable credentials.

**Verified live production address:** `https://agenticcorporation.net`

The deployment service reported an active, successful, public deployment when this guide was prepared. Live `GET /api/v1` returned the API discovery document. The request formats below were checked against the current application source. **No Cue-specific credential was created and no authenticated Cue-to-Felix round trip was performed for this guide.** Public discovery proves availability of discovery, not completion of a Felix task or deployment parity for every optional field.

“Cue Agent” is treated here as your external agent, not an assumed vendor product. Its exact settings-screen names, runtime, and browser abilities were not supplied. Configure the equivalent HTTP actions and private secrets in whichever Cue runtime you use; this guide does not invent a vendor SDK.

### Important boundary

There is **no dedicated Cue chat route, Cue outbox, or Cue notification tool identified in the inspected application**. Do not invent `/cue/chat`, `/api/v1/cue/outbox`, or `cue_send_message`. Do not substitute another agent's Spark, Grok, or Instinct channel.

The supported setup is Cue initiating an API conversation and polling for replies, plus normal signed-in browser chat where authorized. Unsolicited Felix-to-Cue notifications would require a separately designed and authorized channel.

## 2. Choose the access arrangement before connecting

| Arrangement | Appropriate use | What it does not grant |
|---|---|---|
| Dedicated API key in an approved tenant | Backend-to-backend conversation with Felix | A browser login, a Cue-only sandbox, or permission to bypass approval gates |
| Normal signed-in browser session | An authorized human chats with Felix; explicitly approved browser automation uses that account's ordinary rights | API-key authentication or the restricted Instinct channel |
| Both | API automation plus human review in the website | Automatic synchronization between separately created threads |

### Security decision Bob must make

An API key identifies a **tenant/account scope**, not a separately isolated bot. A dedicated key named “Cue Agent — Felix connection” is useful for expiry and revocation, but does not isolate Cue from other same-tenant conversations or bot outboxes that its scope can access.

**Do not give Cue an owner-tenant key unless Cue and its operator are trusted with that tenant's accessible data and capabilities.** If that trust is not appropriate, use a separately provisioned tenant/account and accept that it will not automatically inherit Bob's private owner context. A truly owner-context-aware but Cue-restricted channel is additional engineering, not a property of this README.

Start with the `chat` scope only. It supports agent listing, dispatch, conversation polling, and follow-up messages. The key creation form defaults to `read`; change that selection rather than assuming it is correct.

Do not enable `tools` or `admin` simply to make conversation work.

**A chat-scoped key is not read-only.** Felix can invoke its normally available tools while responding, subject to platform policy and approval checks. “Do not spend or publish” in a prompt is useful guidance, not an enforceable sandbox. Granting stronger authority requires an explicit decision, not a successful connection test.

## 3. Prerequisites and configuration

### Bob or the account administrator supplies

- The approved tenant/account for Cue.
- A separately revocable VisionClaw API key, if API access is wanted.
- An authorized website account, if browser chat is wanted.
- The allowed work scope, spending limits, approval requirements, and data restrictions.

### Cue's operator supplies

- A backend capable of HTTPS JSON requests and secure secret storage.
- Durable storage for conversation IDs and pending message identities.
- A scheduler or timer for bounded polling, if unattended API operation is wanted.
- A secure, explicitly authorized browser session if browser operation is wanted.

### Configuration fields

| Field | What to enter | Example |
|---|---|---|
| `VC_BASE_URL` | Production origin without a trailing slash | `https://agenticcorporation.net` |
| `VC_API_KEY` | The private VisionClaw key supplied through Cue's secret manager | A real `vc_` key; deliberately not printed here |
| Agent name | The coordinator name for dispatch | `Felix` |
| Thread label | A short recognizable title for Cue's own conversation | `Cue Agent — planning and coordination` |
| Conversation ID | The numeric ID returned by Cue's own successful dispatch | Use the returned number, not a number from this guide |
| Poll interval | Delay between status GET requests while a turn runs | Start at 10 seconds, then back off toward 30 seconds |
| Local wait budget | How long Cue waits before reporting that work remains unresolved | Example: 10 minutes; this does not cancel Felix |

Keep credentials out of prompts, source code, README files, browser JavaScript, URLs, screenshots, telemetry, and request logs. API credentials belong on Cue's backend only. Browser credentials belong in an approved password/session manager.

No OpenAI, Profundo, Replit, Google, or other provider key needs to be given to Cue for this connection.

## 4. Create and securely provision the API key

1. Bob signs into the intended VisionClaw tenant/account using the normal website.
2. Open **API Keys**. The current web application's route is `/api-keys`, and the UI is admin-gated.
3. Click **Create API Key**.
4. Enter the key name: `Cue Agent — Felix connection`.
5. Select **Chat**. Uncheck the default **Read** if using the minimal arrangement. Leave **Tools** and **Admin** unchecked.
6. Choose an expiry. Thirty days is a reasonable first setup period; arrange rotation before it expires.
7. Generate the key and place it directly into Cue's private secret manager as `VC_API_KEY`. The full key is shown only at creation.
8. Record its name and expiry, not its secret value, in your operational notes.

The public discovery document currently advertises `/settings/api-keys`; the inspected UI mounts `/api-keys`. Prefer the actual **API Keys** menu or `/api-keys`. If the page is unavailable, have the approved administrator provision access rather than bypassing its gate.

Do not ask Felix to print the key. Do not paste it into a conversation with Cue or into this README.

### Request authentication

Authenticated API requests send:

```http
Authorization: Bearer <value supplied privately from VC_API_KEY>
Content-Type: application/json
```

`Content-Type` is needed for JSON POST bodies. A normal website session cookie does not authenticate `/api/v1/*`; those endpoints require a VisionClaw Bearer key. A Bearer key does not sign a browser into the website.

## 5. API workflow at a glance

```text
Public discovery → authenticated agent listing → dispatch Felix once
    → save conversationId → poll until complete
    → read the completed reply → send an identified follow-up
    → poll the same conversation again
```

Use asynchronous requests. They avoid holding an HTTP request open while Felix works.

| Operation | Method and path | Required scope |
|---|---|---|
| Public discovery | `GET /api/v1` | None |
| List available agents | `GET /api/v1/agents` | `chat` or `read` |
| Open a Felix API conversation | `POST /api/v1/agents/dispatch` | `chat` |
| Read its current status/reply | `GET /api/v1/conversations/{conversationId}` | `chat` or `read` |
| Continue that API-created conversation | `POST /api/v1/conversations/{conversationId}/messages` | `chat` |

Task and follow-up text have a 16,000-character server limit. Leave room for ordinary Unicode handling; split long work into clearly identified messages only after the previous turn completes.

### Step A — discover the service and confirm Felix

Read `GET https://agenticcorporation.net/api/v1` without credentials.

Then call `GET /api/v1/agents` with Cue's key and inspect the returned agent list. Dispatch by `"agent": "Felix"`, not by a copied persona ID. IDs are environment-local. Name lookup is case-insensitive in the inspected dispatcher; use the exact name `Felix` rather than a description or partial name.

### Step B — open Cue's own thread once

Send:

```http
POST /api/v1/agents/dispatch
Authorization: Bearer <private key>
Content-Type: application/json
```

```json
{
  "agent": "Felix",
  "title": "Cue Agent — planning and coordination",
  "task": "This is Cue Agent opening our coordination thread. Confirm you can receive and answer my messages. This is a conversation-only connection test: do not spend, publish, contact anyone, create a mission, change settings, or send an automatic outbox echo.",
  "async": true
}
```

An illustrative acceptance response:

```json
{
  "conversationId": 12345,
  "agentName": "Felix",
  "personaId": 2,
  "statusUrl": "/api/v1/conversations/12345",
  "status": "running",
  "requestId": "example-request-id"
}
```

These numbers and the request ID are **examples**, not assigned values. Save the real `conversationId`, returned status URL, and request ID durably as soon as the response arrives.

HTTP `202` means accepted, not completed. It proves neither a tool result nor an external action.

**Initial dispatch does not expose the follow-up idempotency guarantee.** Adding an `Idempotency-Key` header to this dispatch is not a documented duplicate-prevention mechanism. If the POST's response is lost, the server might already have started work. Record the attempt and ask Bob to reconcile it; do not blindly dispatch again.

### Step C — poll and read the completed answer

Send:

```http
GET /api/v1/conversations/{the real returned conversationId}
Authorization: Bearer <private key>
```

Interpret the JSON:

| `status` | Cue's next action |
|---|---|
| `pending` | Continue bounded polling; do not submit another message |
| `running` | Felix is working; wait and back off |
| `complete` | Read `lastAssistantMessage.content`; require a non-empty completed reply |
| `failed` | Read the failure information, including `reason` when provided; stop automatic progression |
| Missing/unrecognized state | Preserve the receipt and investigate; do not guess success |

An older assistant message may remain in history after a later failure. Do not treat it as the new turn's answer. Check the current durable status and associate the response with the operation you submitted. Record reply identity/timestamps when present.

Polling does not submit new model work. Nevertheless, avoid excessive GET requests and overlapping watchers.

The async task runs in the application process; a persisted run record is not a guarantee that work resumes after an application restart. A local wait timeout does not cancel a server worker or establish that it has stopped. Keep the conversation ID and reconcile unresolved work before sending more.

### Step D — send a follow-up with duplicate protection

Only proceed after the prior turn is complete.

Before sending, durably save:

- The target conversation ID.
- The exact new message text.
- A unique printable `Idempotency-Key` between 1 and 128 characters.
- A local operation ID, attempt state, and submission time.

A UUID is suitable for the idempotency key. One new logical message gets one new key.

```http
POST /api/v1/conversations/{conversationId}/messages
Authorization: Bearer <private key>
Content-Type: application/json
Idempotency-Key: <the saved UUID for this exact message>
```

```json
{
  "message": "Felix, review this proposal and list the next three draft steps. Do not take external action.",
  "async": true
}
```

Expect acceptance, then poll the same conversation.

If the network response is lost, an explicit recovery may resend **the same exact text with the same saved key**. Never change the text while reusing that key or assign a new key merely because the first response was lost.

A duplicate-key response may still say `running`; poll the conversation for the authoritative settled outcome. A `409` requires status inspection, not a new thread or rapid retry. Do not automatically resend a confirmed failed turn.

The follow-up endpoint accepts **API-created** threads. A thread opened in ordinary browser chat is not a supported API follow-up target, even if it belongs to the same tenant.

## 6. Small backend HTTP example

The following Python 3 standard-library helper demonstrates the requests without third-party dependencies. It deliberately does not implement an autonomous retry loop, persistence layer, scheduler, or cancellation.

Save it on **Cue's private backend**, not in browser JavaScript. Supply `VC_API_KEY` through its secret manager. The example fixes the verified origin to avoid accidentally sending the credential to a different host.

```python
import json
import os
import urllib.error
import urllib.request

BASE = "https://agenticcorporation.net"

def request(method, path, body=None, message_key=None, authenticated=True):
    if not path.startswith("/api/v1"):
        raise ValueError("Only the documented API paths are allowed here")
    headers = {"Accept": "application/json"}
    if authenticated:
        key = os.environ.get("VC_API_KEY")
        if not key:
            raise RuntimeError("Provision VC_API_KEY in the backend secret manager")
        headers["Authorization"] = "Bearer " + key
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if message_key is not None:
        headers["Idempotency-Key"] = message_key
    req = urllib.request.Request(
        BASE + path, data=data, headers=headers, method=method
    )
    # Do not forward credentials to redirect destinations.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        # Never print request headers or the environment.
        raise RuntimeError(
            f"HTTP {exc.code}; inspect the failure privately; do not auto-retry POST"
        ) from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError(
            "Network outcome uncertain. Preserve state; do not repeat dispatch."
        ) from None

def discovery():
    return request("GET", "/api/v1", authenticated=False)

def agents():
    return request("GET", "/api/v1/agents")

def open_thread(task):
    return request("POST", "/api/v1/agents/dispatch", {
        "agent": "Felix",
        "title": "Cue Agent — planning and coordination",
        "task": task,
        "async": True,
    })

def poll(conversation_id):
    cid = int(conversation_id)
    if cid <= 0:
        raise ValueError("Use the positive conversation ID returned by dispatch")
    return request("GET", f"/api/v1/conversations/{cid}")

def follow_up(conversation_id, message, saved_message_key):
    cid = int(conversation_id)
    if cid <= 0 or not saved_message_key:
        raise ValueError("A valid thread and durably saved message key are required")
    return request("POST", f"/api/v1/conversations/{cid}/messages",
                   {"message": message, "async": True}, saved_message_key)
```

### How Cue should call this helper

1. Call `discovery()` and `agents()`.
2. Persist an opening-attempt record **before** calling `open_thread(...)`.
3. Call `open_thread(...)` once, with the connection-test text from section 5.
4. Save the returned conversation ID and receipt immediately.
5. Call `poll(saved_id)` on a bounded schedule until completion or an unresolved/failed condition.
6. Before `follow_up(...)`, check that the prior turn completed and durably save the message plus its UUID.
7. Call the follow-up and resume polling.

A network exception during a POST is an **uncertain outcome**, not proof of rejection. A transport timeout and an HTTP failure must not silently become an automatic new dispatch.

### Durable state and locking

Use a private database or protected local state file for operational records. Do not store the API secret inside the conversation-state record. Protect conversation content as tenant data; do not upload those records with this public setup guide.

Store at least:

```text
connection name
approved tenant/account reference
production origin
conversation ID and returned status path
current local operation ID
pending message text and idempotency key, if any
dispatch/follow-up attempt state and receipt
last handled completed reply identity
last polling time
operator review needed: true/false
```

Use one in-flight turn per conversation and a single active polling worker. With multiple backend instances, use a database/distributed lock rather than only an in-memory boolean.

## 7. Browser chat access

### Normal signed-in workflow

1. Open `https://agenticcorporation.net/chat`.
2. Sign in using an account Bob explicitly authorizes for this purpose.
3. Select **Felix** in the chat's persona/agent selector.
4. Start a clearly named conversation for Cue-related coordination.
5. Send the conversation-only connection-test message from section 5.
6. Wait for the assistant's completed response, not merely a loading indicator or partially streamed text.
7. Continue in the same browser conversation. Preserve its URL for the operator.
8. Sign out when finished, or retain a protected session only if explicitly approved.

Browser access uses that account's ordinary rights. It is not a special restricted Cue environment. Do not share Bob's admin PIN or owner credentials just to make automation convenient.

If Cue cannot operate a browser securely, use the API path and let Bob use browser chat for review. Do not bypass sign-in, CAPTCHA, session expiry, or role checks.

### Rules for browser-capable Cue

- Use only the approved account and browser profile.
- Keep credentials in its approved password/session manager, not agent prompts.
- Never copy session cookies into an API client or include them in a document.
- Do not modify other conversations or select another user's account.
- Do not repeatedly click Send when the website is slow.
- If browser submission becomes uncertain, inspect the existing conversation before sending again.
- Treat downloaded files and chat output as potentially sensitive.
- Human approval is still needed for consequential actions where platform policy requires it.

### API and browser thread separation

An API thread and a browser-created thread can both talk to Felix, but they are not automatically the same conversation.

Use an explicit, non-sensitive handoff summary when moving between them. Do not assume Felix has seen a different thread merely because the persona name is the same.

If an authorized API-created thread is visible through the normal chat UI, it may be useful for human inspection. Avoid simultaneously sending from the browser and API into it; do not treat mixed-origin message submission as a verified integration.

Do not use `/instinct/login`, `/instinct/chat`, or `/instinct/outbox` for Cue. Those have an independently designated account binding and specialized restrictions.

## 8. Suggested Cue operating instructions

This block is suitable as guidance in Cue's own agent configuration. It does not replace server-enforced access controls.

```text
You are Cue Agent coordinating with Felix in VisionClaw.
Use only the approved production origin and private backend credential.
Address the exact agent name Felix and use your own returned API thread ID.
Do not invent API paths, persona IDs, tool names, model receipts, or outcomes.

Prefer async dispatch plus status polling. HTTP 202 means accepted, not finished.
Allow one active turn per conversation. Save message text and idempotency identity
before follow-up submission. Do not blindly repeat an uncertain opening dispatch.
Do not reuse Spark, Grok, or Instinct conversations or outboxes.

Begin with conversation, planning, analysis, and draft work only.
Do not infer permission to spend, send outreach, publish, change settings,
create missions, or modify business records from a chat reply.
Use only authority Bob explicitly grants and respect platform approval gates.

Do not transmit credentials, raw private history, customer records, or copied
confidential documents without explicit permission for the exact data and task.
Do not automatically echo every Felix response or create cross-agent loops.

Report current status honestly: accepted, running, complete, failed, or unresolved.
After a failed or uncertain consequential operation, preserve evidence and stop
for review instead of inventing a fresh retry.
```

### Example task format

This is a fictional, complete example. Replace its facts with the approved facts for your task; the correlation string is illustrative.

```text
Sender: Cue Agent
Purpose: Critique a draft service offer.
Context: The draft offers a website readiness review for local service businesses.
Requested output: Three risks and a revised scope draft.
Authority: Analysis only; no external action.
Budget: No additional spending authority is granted by this message.
Correlation: cue-example-operation-001
```

Correlation text helps an operator reconcile work; it is not a server idempotency mechanism.

## 9. Model routing and cost expectations

Normally omit the optional dispatch `model` field and let the platform apply current defaults and authorized routing. Do not force an expensive model simply to test connectivity.

Owner work has preferred Luna/Sol routing, but a preference is not a guarantee of the serving model. The provider can be unavailable and an authorized fallback can serve the turn. The earlier development demanding test completed through GPT-5.4 fallback; that was not proof of Sol serving. These policies may differ outside the approved owner context.

Where deployed, conversation polling includes:

| Field | Meaning |
|---|---|
| `modelPreference` | Saved requested/default selection |
| `resolvedModel` | Route selected during execution |
| `observedModel` | Model name reported by the provider response |
| `modelEvidence` | `provider_reported`, `route_resolved`, or `saved_preference_only` |

Only `provider_reported` is evidence of a model reported by the inference response. It is still a provider report, not an independently verified identity attestation. Do not infer serving identity from a UI label or historical saved preference. If these fields are absent in production, report the evidence as unavailable rather than fabricating it.

Polling does not launch another turn, but dispatch/follow-up can incur inference and tool costs. Cue's subscription, if any, does not establish free VisionClaw inference or a metered spending grant. Provider failures are not permission to unlock a new paid fallback.

This Cue setup does not configure Muse's subscription, watcher, or same-turn context ingestion.

## 10. Troubleshooting

| Symptom | Likely interpretation | Safe next step |
|---|---|---|
| Discovery works; authenticated requests return `401` | Missing, expired, revoked, or invalid key; browser session used instead of Bearer auth | Check Cue's private secret binding and key status without printing the key |
| `403` | Scope/account/policy restriction | Check `chat` scope and intended account; do not add `admin` as a workaround |
| Agent-not-found `404` | Name not present in the deployed roster | List agents and use exact `Felix`; do not copy development IDs |
| Conversation `404` | Wrong tenant/ID; for follow-up, possibly not API-created | Verify the saved receipt and credential binding; never guess another bot's ID |
| Follow-up `409` | Active/timed-out turn or idempotency conflict | Poll and inspect the saved message/key; stop automatic submission |
| `400` | Invalid payload, oversized/blank text, malformed ID or idempotency key | Correct the request before a deliberate new attempt |
| `429` | Rate limiting | Respect `Retry-After` if provided, slow down, and keep one worker |
| `202` without a reply | Work accepted or still running | Save the receipt and poll; do not repeat dispatch |
| Browser/API request times out | Work may still exist or be running | Preserve current thread and reconcile; a timeout is not cancellation |
| `failed` with provider/context rejection | The current task did not complete successfully | Read reason and partial state; do not present an older answer as success |
| Missing model-receipt fields | Version difference or unavailable evidence | Treat identity as unverified |
| `/api-keys` unavailable | Account lacks UI access or live routing differs | Have the approved administrator provision the key |
| Cue outbox endpoint returns `404` | No dedicated Cue outbox was identified | Use initiated thread polling, not Spark/Instinct as substitutes |
| Browser thread cannot receive API follow-up | It lacks the API-origin registration contract | Keep browser chat separate; reconcile old work before opening a deliberately new API thread |

Do not build an automatic retry policy around generic `500` responses. A POST might have partially executed. Capture the request ID when available and investigate privately.

A successful health page, key creation, or acceptance response is not an end-to-end connection test.

## 11. Acceptance checklist

### API

- [ ] Bob approved the tenant, trust level, work scope, and budget.
- [ ] A dedicated expiring key is privately provisioned with minimal scope.
- [ ] Cue reads live discovery and authenticated agent listing.
- [ ] Cue opens its own Felix thread once and durably saves the receipt.
- [ ] Polling reports `complete` with the current non-empty assistant answer.
- [ ] Cue sends one harmless follow-up with a durably saved idempotency key.
- [ ] The same thread completes that follow-up without duplicate submission.
- [ ] A local timeout preserves state instead of automatically creating another thread.
- [ ] Revocation/expiry procedures are recorded.

### Browser

- [ ] The account and browser profile are explicitly approved.
- [ ] Sign-in works through the ordinary website.
- [ ] Felix is selected and a harmless message completes.
- [ ] Browser and API thread IDs are kept separate.
- [ ] No credentials, cookies, or tenant content appear in shared setup notes.

### Not established by this checklist

No dedicated Cue outbox, automatic unsolicited notifications, cross-thread memory guarantees, owner-context sandbox, new spending authority, or completed external action is implied.

## 12. Maintenance and shutdown

**Rotate:** create a replacement dedicated key, update Cue's private secret binding, confirm authenticated read access, then revoke the old key. Do not repeat an uncertain task as a rotation test.

**Pause:** stop Cue's scheduler and new submissions; retain receipts for any existing turn. Stopping Cue does not cancel Felix's server work.

**Revoke API access:** revoke Cue's key in **API Keys**. This does not revoke a separate browser session or undo earlier actions.

**End browser access:** sign out and revoke the account/session through the supported account controls. Do not confuse browser revocation with API-key revocation.

**Resume:** inspect the saved thread and pending operation first. Do not reset state and dispatch a replacement merely because the agent restarted.

**Final setup outcome:** Cue can use the existing Felix API conversation contract and approved ordinary browser chat. Actual acceptance requires completing the harmless authenticated tests with Cue's own privately provisioned access.
