# VisionClaw Glasses Integration

Connect Meta Ray-Ban smart glasses to the VisionClaw Agent platform so you can
talk to your AI corporation hands-free, with the agent seeing what you see.

## Architecture

```
Meta Ray-Ban Glasses (camera + mic + speaker)
        │
        │ 1 fps JPEG frames + bidirectional PCM audio
        ▼
Android phone running VisionClaw-Glasses (forked from Intent-Lab/VisionClaw)
        │
        ├─── audio + frames ──► Gemini Live API (Google's WebSocket)
        │                       returns audio + tool_calls
        │
        └─── tool_calls (HTTPS) ──► VisionClaw Agent /v1/glasses/execute
                                    returns tool results
```

The phone app is a thin client. **Gemini Live owns the conversation** (the
audio loop and tool-call decisions); **VisionClaw Agent owns the actions**
(the 217 tools, memory, personas, and integrations). The two never talk
directly — the Android app brokers between them.

---

## Server Side (already done)

Three endpoints are mounted under `/v1/glasses/*`:

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /v1/glasses/health` | none | Service probe (mirrors OpenClaw `/health`) |
| `GET /v1/glasses/tools` | `Bearer <api-key>` (chat scope) | OpenAI/Gemini-format tool catalog. Hand verbatim to Gemini Live as the `tools` array. |
| `POST /v1/glasses/execute` | `Bearer <api-key>` (chat scope) | Body `{ name, arguments }`. Runs one tool, returns `{ ok, tool, durationMs, result }`. |

### Tool allowlist

The default allowlist exposes **29 voice-safe tools** to glasses keys:
search_memory, create_memory, recall_context, query_triples, store_triple,
web_search, web_fetch, deep_research, research_digest, jina_read, send_email,
schedule_email, send_whatsapp, send_telegram, send_sms, send_signal,
send_discord, google_calendar, google_docs, google_drive, google_sheets,
stock_price, crypto_price, market_news, create_pdf, create_document,
system_status, agent_status, scan_file.

Destructive / sensitive tools (`exec`, `write_file`, `delegate_task`,
`orchestrate`, Stripe writes, etc.) are blocked unless the key has the
`admin` scope, which unlocks the full 213-tool catalog. Don't put admin
keys on a phone.

### Mint a glasses key (one-time)

```sql
-- Generate the raw key on your machine first:
--   RAW=vc_glasses_$(openssl rand -hex 24)
--   echo "$RAW"          # ← put this in the Android app
--   HASH=$(node -e "console.log(require('crypto').createHash('sha256').update('$RAW').digest('hex'))")

INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix, scopes, is_revoked, created_at)
VALUES (1, 'meta-glasses-pixel', '<HASH>', '<first 12 chars of RAW>', ARRAY['chat'], false, NOW());
```

Store the raw key in the Android app's `Secrets.kt` — never commit it.

---

## Client Side (needs your hardware + Meta DAT SDK access)

### Prerequisites

1. **Meta Ray-Ban smart glasses** (any model with camera + mic). The
   *Display* model has a heads-up screen via a separate, newer SDK — that
   is *not* what this integration uses. Audio-only Ray-Bans work fine.
2. **Android phone** (Pixel, Samsung, etc.) running Android 10+.
3. **Developer Mode** enabled in the Meta AI app: open Meta AI →
   Settings → App Info → tap "App version" five times → back out → toggle
   "Developer Mode" on.
4. **Meta Wearables DAT SDK access.** This is the gatekeeper — Meta has
   to approve your developer account for the SDK before anything else
   matters. Apply at https://github.com/facebook/meta-wearables-dat-android
   and expect a few business days. **Start this first.**
5. **Gemini API key** — get one free at https://aistudio.google.com/apikey.

### Fork and configure

```bash
git clone https://github.com/Intent-Lab/VisionClaw VisionClaw-Glasses
cd VisionClaw-Glasses/samples/CameraAccessAndroid
```

Open in Android Studio. Add your GitHub PAT (with `read:packages` scope)
to `local.properties`:

```properties
github_token=<YOUR_GH_PAT>
```

Then create `app/src/main/java/com/meta/wearable/dat/externalsampleapps/cameraaccess/Secrets.kt`:

```kotlin
object Secrets {
  // Required
  const val geminiApiKey = "<YOUR GEMINI API KEY>"

  // VisionClaw Agent gateway
  const val openClawHost = "https://agenticcorporation.net"
  const val openClawPort = 443                         // standard HTTPS
  const val openClawGatewayToken = "<YOUR vc_glasses_… KEY>"
}
```

Two things change vs. the original VisionClaw README:

- Host is the **public** VisionClaw Agent URL (no Mac-on-LAN required).
- Port is **443** (HTTPS), not 18789.

The Android app's existing `OpenClawBridge.kt` will hit
`https://agenticcorporation.net/v1/glasses/execute` (or `/v1/chat/completions`
in the upstream code — see "Path mapping" below).

### Path mapping

The upstream VisionClaw Android app expects OpenClaw's
`/v1/chat/completions` endpoint. If your forked app uses that path,
either:

1. **Easy:** edit `OpenClawBridge.kt` to call `/v1/glasses/execute` with
   the simpler `{name, arguments}` body. ~10 lines of change.
2. **Drop-in:** ask us to add an OpenAI-compatible
   `/v1/chat/completions` shim (it would internally translate to the
   same executor). ~half a day of additional work, useful if you also
   want to point other OpenAI-compatible clients (LibreChat, OpenWebUI,
   Bolt, etc.) at us.

For v1 we recommend Option 1 — it's smaller, faster, and there's no
Gemini-format-→-OpenAI-format translation layer for the client to deal
with since Gemini Live already speaks OpenAI tool-call shape natively.

---

## Try it

### From a desktop (sanity check)

```bash
KEY="vc_glasses_…"
curl https://agenticcorporation.net/v1/glasses/health
curl -H "Authorization: Bearer $KEY" https://agenticcorporation.net/v1/glasses/tools | jq '.count'
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"name":"web_search","arguments":{"query":"weather in [Your City] Illinois"}}' \
     https://agenticcorporation.net/v1/glasses/execute
```

### From the glasses

1. Sideload the built APK to your phone (Android Studio Run, or `adb install`).
2. Pair your Ray-Bans through the Meta AI app (one-time).
3. In the VisionClaw-Glasses app, tap **"Start Streaming"**.
4. Tap the **AI button** (sparkle icon).
5. Talk:
   - *"What am I looking at?"* → Gemini describes the scene.
   - *"Send Bob an email reminding him about the warehouse meeting tomorrow at 10am."* → Gemini calls `send_email`.
   - *"Remember that I parked in row D7."* → Gemini calls `create_memory`.
   - *"What's the price of Tesla right now?"* → `stock_price`.
   - *"Add a calendar event for the dentist next Tuesday at 3pm."* → `google_calendar`.

### Costs

- Gemini Live API charges per minute of audio + per image. Roughly $0.50–$3/hr of active conversation.
- Our gateway is free (you already pay for the platform's hosting + LLM costs separately).
- Set a per-tenant cost cap via the existing cost-tracker before heavy use.

---

## Operational notes

- **Latency budget.** Glasses → phone → Gemini → phone → tool call → phone → Gemini → glasses. Each tool call adds 0.5–3 seconds on top of the conversational round-trip. Memory / web search are fast (<1s). Document creation, deep research, video production are slow — Gemini will say "working on it…" while we run.
- **Tenant isolation.** A glasses key is bound to one tenant. Tools that touch persisted data (memory, knowledge, files, calendar) automatically scope to that tenant.
- **Revoking a key.** `UPDATE api_keys SET is_revoked=true WHERE name='meta-glasses-pixel';` — the Android app will start getting 401s within seconds.
- **Adding tools to the allowlist.** Edit `GLASSES_DEFAULT_ALLOW` in `server/glasses-gateway.ts`. Per-tenant overrides via custom scopes can come later if there's demand.
- **Logging.** Each call logs `[glasses-gateway] tenant=N tool=X ok=true dur=Yms`. PII in tool arguments (e.g., recipient emails, message text) is **not** scrubbed from logs by default — assume glasses traffic is observable to ops.
