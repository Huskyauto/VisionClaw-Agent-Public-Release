# Security Architecture

This document describes the security posture of VisionClaw Agent in detail.
For vulnerability reporting, see [SECURITY.md](../SECURITY.md). For the high-
level platform overview, see [README.md](../README.md).

---

## Threat model

VisionClaw is a multi-tenant AI platform that holds:

- **AI provider credentials** (OpenAI, Anthropic, xAI, Google, OpenRouter,
  ElevenLabs, Firecrawl, Browserless, Perplexity, etc.).
- **Payment integrations** (Stripe, Stripe Connect, Coinbase Commerce, CDP).
- **Email accounts** (AgentMail per-tenant inboxes, Gmail OAuth).
- **OAuth tokens** (Google Drive, Google Workspace, OneDrive, YouTube, X).
- **Customer files and conversations** scoped to each tenant.
- **Long-running autonomous agents** that schedule themselves, execute tools,
  call paid APIs, send emails, post to social channels, and propose code edits.

The primary risks are:

1. **Cross-tenant data exposure.** Tenant A reading Tenant B's conversations,
   files, memory, or invoices.
2. **Cost runaway.** A tenant or attacker triggering unbounded paid LLM calls.
3. **Prompt injection escalation.** Untrusted text (web pages, KB articles,
   tool outputs) tricking an agent into exfiltrating data or calling
   dangerous tools.
4. **Credential exfiltration.** Pre-auth endpoints leaking the env-var
   matrix or per-tenant API keys.
5. **Unauthorized file access.** Direct URL access to another tenant's
   uploads or generated deliverables.

---

## Tenant isolation model

- **Every multi-tenant table has a `tenant_id` column** with NOT NULL plus a
  composite index. The 132-table schema is enforced via Drizzle migrations.
- **Storage layer guards every read/write.** All `IStorage` methods that
  touch tenant data accept `tenantId` as a required parameter, not a fallback.
- **Vector search requires explicit tenantId** (R54.D). `vectorSearchMemory`
  and `vectorSearchKnowledge` will throw if `tenantId` is undefined — no
  silent cross-tenant matches.
- **Email storage fails closed** (R74.A). If the inbound or outbound email
  path cannot resolve a tenant, the message is dropped with a high-priority
  error log. It is **never** silently filed under tenant 1.
- **Stripe Connect routes fail closed** (R74.B). All five Connect routes
  return explicit 401 if tenant cannot be resolved — no `?? 1` fallback.
- **MCP sessions are bound to tenant at handshake** (R64.C). Every SSE
  session is tagged with the tenant the API key was issued for; subsequent
  tool calls inherit that binding.

## Credential storage model

- **Per-tenant secrets are encrypted at rest** in the `tenant_secrets` table
  using AES-256-GCM with a key derived from `SESSION_SECRET`.
- **Vault entries use envelope encryption** with rotation support — the
  data-encryption key is itself encrypted with the master.
- **Provider credentials are never logged.** All log lines that touch a
  Stripe key, OAuth token, or LLM API key route through a redaction filter.
- **`/api/setup/status` redacts the env-var matrix** (R74.C) unless the
  request is from a fresh-deploy unauthenticated wizard or an authenticated
  admin — public probes get only `{ needsSetup: bool }`.

## Tool permission levels

Every tool has a declared sensitivity level enforced by the
guarded tool executor (`server/tool-router.ts`):

- **Read-only / idempotent** — safe to auto-execute, e.g. `web_search`,
  `list_invoices`, `search_memory`. Subset of these (~20) are allowlisted
  for the Glasses Gateway voice path.
- **Side-effectful, low-risk** — auto-executes with telemetry, e.g.
  `create_pdf`, `generate_chart`, `write_daily_note`.
- **Side-effectful, high-risk** — requires Trust Engine score above
  threshold or human approval, e.g. `send_email`, `publish_social_post`,
  `update_invoice_status`, `delete_custom_tool`.
- **Privileged / admin-only** — requires `isAdminRequest(req)`, e.g.
  `agent_security_scan`, `commit_decision`, `manage_skills`.

## Human approval rules

The Trust Engine evaluates each high-risk tool call at execution time and
can **gate** it on human approval. The current rules are:

- Outbound email to an unrecognized recipient → approval required.
- Stripe payouts and refunds → approval required.
- Social posts to public channels → approval required.
- Code proposal apply (R25 self-improving codebase) → approval required;
  only verified proposals reach the Apply button at all.
- Tenant-creating actions → approval required.

Approval queue is at `/admin/approvals`. Pending items also appear in the
chief-of-staff daily digest email.

## Payment webhook verification

- **Stripe webhooks verify signature** against the configured webhook
  secret using `stripe.webhooks.constructEvent`. Any signature failure
  returns 400 immediately and is logged to `silent-failures`.
- **Replay protection** via the `processed_webhook_events` table — the
  Stripe event ID is the unique key; duplicate deliveries are no-ops.
- **Race-fixed checkout flow** — the order row is INSERTed with status
  `pending` at checkout-session-create time, then UPDATEd to `paid` on
  webhook receipt. The webhook never creates the order itself.

## File upload safety

- **MIME magic-byte sniff on every upload** (R64.C). The reported
  Content-Type is ignored; the server reads the first 64 bytes and
  rejects HTML/SVG/XML/JSON smuggling vectors before any further
  processing.
- **Extension allowlist** layered on top of MIME — `.pdf`, `.docx`,
  `.xlsx`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.txt`, `.md`, `.csv`,
  `.mp3`, `.mp4`, `.wav`.
- **Size limit** enforced at the multer layer (default 50 MB; configurable
  per tenant).
- **HMAC-signed download URLs** (R64.C). Every customer download link is
  signed with HMAC-SHA256 and expires in 30 minutes.
- **Static `/uploads` mount has cross-tenant ownership check** (R64.C).
  Even with a guessable filename, a request returns 404 if the tenant in
  the session does not match the file's owning tenant.

## Prompt injection defenses

- **Untrusted-data fences** wrap KB sections in the agent system prompt
  (R54.E), tool outputs, and chain-of-thought scratchpads (R64.B). The
  agent is instructed not to follow instructions inside the fenced regions.
- **Reserved-key prefix bypass closed** (R64.B). Tool argument
  normalization uses `Object.create(null)` so no input can override
  reserved fields like `__proto__` or `constructor`.
- **Prompt injection scanner** runs against every user input and tool
  output, flagging known patterns (role-play attempts, instruction
  overrides, exfiltration patterns).

## OAuth token handling

- **Tokens stored encrypted** in `oauth_tokens` table (AES-256-GCM).
- **Refresh cascade** for Google Drive runs every 10 minutes, with auto-
  refresh whenever <45 min remaining. A separate health check at 30-min
  cadence verifies the live token is still valid.
- **Per-tenant OAuth scoping** — a tenant connecting their own Google
  account never sees another tenant's tokens; the `tenant_id` is part
  of the lookup key.

## Admin route protection

- **`isAdminRequest(req)` helper** is the single source of truth for
  admin gating. It checks: authenticated session, role = admin, optional
  Admin PIN if `ADMIN_PIN` is configured.
- **Operational endpoints gated** (R74.C):
  - `/api/cache/stats` — admin only.
  - `/api/drive-health` — admin only (matches `/api/onedrive-health`).
  - `/api/setup/status` — env-var matrix only on fresh-deploy or admin.
- **Pre-auth endpoints minimized.** The remaining unauthenticated
  endpoints are `/api/auth/*`, `/api/setup/status` (boolean-only),
  `/api/setup/seed-fresh-deploy`, `/api/contact-form`, the Stripe webhook,
  the OAuth callbacks, and the static landing assets.

## Backup / restore security

- **Daily automated backups** to Google Drive (when configured), encrypted
  at rest by Drive itself.
- **Manual export/import** via `/admin/backup-restore` — exports are
  zipped and SHA-256 checksummed; imports verify the checksum before
  applying.
- **Backups never contain plaintext provider credentials** — the export
  excludes the `tenant_secrets` and `oauth_tokens` tables. Operators must
  re-enter API keys on a restored deployment.

## Cost runaway protection

- **Per-tenant cost ledger** (R73) in `agent_cost_ledger` with daily and
  monthly soft caps configurable per tenant.
- **`pg_advisory_lock` keyed on `(ledgerKey, tenantId)`** prevents
  double-spending under concurrent requests.
- **Streaming-aware cost wrapper** (R30/R31) ensures partial-stream
  tokens still get accounted for if a request is aborted.
- **Rate limits** at the route layer — 60/min standard, 4/min for heavy
  endpoints (deep research, video production, agent-eval).
- **OpenRouter catalog scanner has a 10-alert cap per run** (R73.C +
  R74.D) so an explosion of new models can't email-spam the owner.

## Boot-time security checks

- **Wiring invariants tripwire** (R41) runs at boot and on a 6-hour
  heartbeat across 4 categories (`schedule_binding`, `program_persona_map`,
  `code_proposal_targets`, `outcome_canary`, `dormant_tools`). Critical
  drift emits an attention-bus event.
- **47 production indexes ensured** at boot — missing index = degraded
  performance + log warning.
- **Trust Engine scores initialized** for tenant 1.

## What we explicitly do **not** do

- **No outbound CSP report endpoint.** If you want CSP reports, configure
  your reverse proxy.
- **No automatic vulnerability scanning of dependencies.** Run
  `npm audit` and `npm outdated` periodically. Dependabot is enabled on
  the public mirror but not gated on PRs.
- **No SSO out of the box.** Email/password + OAuth (Google + Replit) are
  the supported auth flows. SAML/OIDC SSO is in the backlog.
- **No HSM key management.** Provider credentials are encrypted at rest
  with a key derived from `SESSION_SECRET`. For higher assurance, run on
  a host with disk-level encryption and rotate `SESSION_SECRET` only
  during planned maintenance windows.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md). Email **huskyauto@gmail.com** with
subject prefix `[SECURITY]`. Acknowledgement within 72 hours.
