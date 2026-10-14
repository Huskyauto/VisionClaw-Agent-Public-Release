# Platform source update — October 14, 2026

## R136.2: current features and their limits

This document reconciles the implemented source, public-facing navigation and
private/public repository documentation. It is not a production deployment
receipt, a full-system security certification or authorization to activate
every optional integration.

Platform totals remain the **October 8 development evidence snapshot** in
[`release-facts.json`](release-facts.json): 427 total registered tools,
386 public documented tools, 68 total skills, 144 active capabilities,
18 personas, 194 declared / 275 live development tables, 885 platform indexes,
86 curated models and 41 governance rules. This update adds no registered tool,
persona, permission or database schema.

## Feature and access matrix

| Feature | What the source supports | Access and evidence limits | Where to find it |
| --- | --- | --- | --- |
| Treasury paper pilot | Historical stock and crypto replay; Bitcoin/Ethereum/Solana choices; frozen trend, reversion, breakout and RSI presets; fees/slippage and benchmark evidence | Owner-only; simulations, not live orders, broker connectivity or certified returns | Treasury |
| AgentID sign-in | OIDC validation, state/nonce/PKCE, session rotation, reserved agent identities and expiry enforcement | Credentials and exact opt-in required; non-admin trial scope; full live authenticated lifecycle remains unverified | Configured sign-in page; API Keys & Agent Access |
| Robert | Personal/emotional-life specialist, journaling and practical next actions | Tenant-private context; shared seeds contain no private owner history | Agent selector and agent board |
| Model-route evidence | Separate requested, resolved and provider-reported model fields | Preferences do not guarantee the served model; historical rows are not fabricated | Chat model selection, API metadata and settings |
| CheaperInference fallback | Owner-only opt-in paid fallback with durable reserve-before-spend accounting | Shared $20 UTC-day cap for this lane and supported image operations; not an application-wide budget or free lane | Model selection and configured provider settings |
| Conversation reliability | Stream-progress deadlines, correction-aware compaction and separately budgeted recent context | No new automatic paid retry; actual reliability gains need operational evidence | Existing chat, not a separate app |
| Approval recovery | Renewable fenced leases preserve uncertain work and pending approvals | No blind replay of consequential side effects | Existing approval/operator workflows |
| Prepared-history comparison | Bounded advisory comparisons of prepared conversation history | Not provider cache-hit telemetry or billing proof | Existing diagnostics |
| Tenant/file and owner controls | Scoped storage/Drive access, owner-only voice settings with render masking, task-owned watchdog and approval evidence | Existing role checks remain; no blanket security certification | Owner tools and diagnostics |
| Workspace code verification | Signed minimal snapshots, captured-source staging and fenced result receipts | Implementation is not successful production completion or verified capacity; no admission bypass | Code Proposals & Verifier; Ecosystem & Model Diagnostics |
| Copilot chat | Explicit trusted owner question through a bounded isolated SDK process | Chat only; no repository/shell/customer-context access; account entitlements apply | Explicit owner Felix/Forge conversation |
| Multi-model jury recovery | Retains successful seats and evidence, then recovers failed seats through authorized lanes | Identity and budget policies remain; no anonymous route presented as a verified independent model | Existing owner jury workflow |
| Haiku 5.5 drafting | Fixed-medium-effort drafting for eligible existing content-repurposing work | Not automatic posting/scheduling or global routing migration | Content Writing and its existing agent tools |
| Muse advisory context | Configured owner outbox/poll coordination | Partial integration; queued is not received; correlated cross-conversation reply ingestion and subscription usage are unproven | Configured owner advisory workflow |
| Cue/Felix guidance | Setup documentation | Not a new active Cue route, outbox or verified return channel | Deployment/setup guidance, where retained in the repository |
| Research adoption | Evidence retention and bounded comparisons before adoption | REA runtime, HERMES and permanent worktree swarms are not installed | Research documentation; no invented tool menu entries |
| Portable source builds | Public npm tarballs, Node 22.22+, classified test inventory and sanitized append-only public history | CI/source synchronization does not establish feature deployment or external service configuration | Repository setup and CI documentation |

## Source and folder guide

The private repository contains the full project source. The public repository
is rebuilt through the existing sanitizer, so protected files can be omitted,
stubbed or redacted; it is not a byte-for-byte copy of the private repository.

- `client/src/pages/`: business/technical landing views and actual feature pages.
- `client/src/components/`: sidebar, navigation, recent-update cards, SEO and
  shared source-release summaries.
- `client/src/data/updates.json`: changelog data shared by updates and dashboard.
- `server/`: authentication, chat, tenant-bound operations and repair services.
- `server/lib/`: bounded source staging, verification contracts and supporting
  implementation. Source availability is not service activation.
- `server/tools/domains/`: migrated tool definitions/handlers; curated public
  tool discovery remains narrower than the complete registered-tool count.
- `shared/` and `shared/models/`: common contracts and declared schema modules.
- `scripts/`: portable-build, documentation, source-mirror and preflight checks.
- `tests/`: source-bound regression checks and explicitly classified public
  test inventory.
- `docs/`: setup, release facts, feature/status references and export-safe
  documentation. Private reports are not automatically public.
- `.agents/`: private project instructions and retained research where allowed;
  the public sanitizer determines what can be exported.

GitHub synchronization backs up source, not databases, credentials, uploads,
ignored runtime state or configured external accounts. Forks must provision
their own secrets, identity provider, database and optional integrations.

## Navigation changes

Both landing views now have a **Latest Updates** menu anchor. The sidebar exposes
the existing website and latest-feature overview, identifies the owner's
Treasury paper pilot, and clarifies Content Writing, API Keys & Agent Access,
Code Proposals & Verifier, Ecosystem & Model Diagnostics and provider settings.
These are existing routes; owner/admin conditions and feature flags remain.

Prior release notes remain historical. Pending research and unverified
production capabilities are labeled rather than promoted into fake links or
unconditional marketing promises.
