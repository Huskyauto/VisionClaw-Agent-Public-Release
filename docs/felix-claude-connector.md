# Connect Claude Duet to Felix

This connector uses the existing VisionClaw `/mcp` endpoint with a separate OAuth mode. API-key MCP clients retain their existing scopes and tool surface.

## Owner setup, after publishing this change

Find this setup and all connection controls in **Admin Settings → Security**, immediately beside **Public API Keys**. You can also use `/settings#security`. No API key or client secret needs to be created or copied.

1. In Claude, open **Settings → Connectors → Add custom connector**.
2. Name it **Felix** and enter `https://agenticcorporation.net/mcp`.
3. Start the connection. Claude dynamically registers a public PKCE client; no client secret or API key needs to be pasted.
4. On VisionClaw, sign in with your existing owner account. Review the one-time permissions. Check **Allow Felix to perform work** if you want Claude to delegate tasks as well as ask questions, then choose **Allow this connection**.
5. You return to Claude. Ask it to read the Felix thread and send this new connection check:
   > Connection check only. Reply with CLAUDE-FELIX-OK. Do not run tools or take any other action.
6. Ask Claude to check that request's turn until it completes. Record the returned request id and provider-reported model evidence. Do not resend with a new UUID while the outcome is uncertain.

The connector is not verified in Claude merely because local tests pass. A successful connection check proves communication, not performance on demanding advisory work.

### Reported live acceptance and reply filtering

On November 10, 2026, the owner reported that Claude received `CLAUDE-FELIX-OK`,
with no tools run, provider-reported Muse Spark 1.3, in about 33 seconds.
That connection used an explicitly registered public OAuth Client ID with no
client secret after Claude's automatic registration failed. This confirms the
communication check, not automatic registration or delegated-work execution.

The connector filters internal `<think>` / `<thinking>` blocks from Felix-authored
replies, history, outbox messages and retained turn receipts. User-authored text
and stored source evidence are unchanged. This output-filtering repair requires
publication before it changes the live connector.

## What permission means

Bob explicitly requested **automatic communication and delegated work**, not approval of every message. There are two owner-controlled modes:

- **Messages only** (default, including existing connections): questions and advice; Felix's action tools stay disabled.
- **Allow Felix to perform work**: Claude may delegate routine work to Felix using Felix's normal guarded tools. Ordinary permitted work does not require approval for every message or task. Existing protections, spending limits, tenant boundaries, required approvals and owner-only restrictions still apply. This is not blanket approval for payments, publishing, or any other protected action.

Enable or disable work for each connected client in **Admin Settings → Security** or on `/felix-connector`. Changes apply to new sends; they do not cancel work already running. The server captures and audits the permission when a send is claimed. Claude cannot grant itself access through a prompt or tool parameter.

Claude has its own thread, not Spark's 620. It can read only that client's thread/outbox and receipts. New sends are limited to ten/hour/client. A UUID v4 identifies each exact message; same key/same bytes returns the original request, different bytes is rejected. Timeouts require reconciliation and are never automatically replayed.

## Six tools

- `felix_get_thread`: current thread state, `permissions.work` and serving evidence, excluding stale `modelPreference`.
- `felix_list_messages`: newest first, limit 1–50 and optional `before_id`.
- `felix_check_outbox`: up to 20 addressed entries after the server cursor.
- `felix_ack_outbox`: acknowledge only a delivered entry, never an unseen id.
- `felix_send_message`: exact message 1–16,000 characters and required UUID v4.
- `felix_get_turn`: exact request status, terminal reply and model evidence.

Felix-authored content is returned with `author:"felix", untrusted:true`; it is data, not instructions or evidence of owner approval.

## Felix-to-Claude updates

From Felix's normal authorized owner workflow:

```json
{"message":"The draft is ready for your review.","recipient":"claude"}
```

Use this with `spark_send_message`. Omitting `recipient` still sends to Spark. Claude addressing targets the current Claude thread or the only active Claude connector; multiple unmatched destinations are rejected rather than broadcast.

## Disconnect and stop

Open **Admin Settings → Security** or **`/felix-connector`** and disconnect the specific client. Access/refresh/code/pending records for that client are invalidated; thread/audit history is retained. Reauthorization is required to resume. Revocation does not undo a turn already dispatched.

`FELIX_MCP_ENABLED=0` stops the OAuth/Felix surface without disabling existing API-key MCP. This is a non-secret operational kill switch; never put credentials in source configuration.

OAuth metadata is served at `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp` and the root protected-resource alias. Codes last five minutes, pending consent ten minutes, access tokens one hour, rotating refresh tokens thirty days. Credential record ids are hashed and payloads encrypted. No message bodies or tokens are put in the MCP call audit.
