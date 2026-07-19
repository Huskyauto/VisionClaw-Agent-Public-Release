# R71 — Route Orphan Triage (April 23, 2026)

128 server routes have no client/src caller after improving the detector to also scan server/ and scripts/ and allowlisting external entry points.

## Categories

### admin (8)

- `/api/admin/replay-research-proposals`
- `/api/admin-drive-upload`
- `/api/admin/concurrency`
- `/api/admin/tool-curator-status`
- `/api/admin/dormant-tools/preview`
- `/api/admin/dormant-tools/apply`
- `/api/admin/dormant-tools/clear`
- `/api/admin/silent-failures`

### memory (14)

- `/api/consolidation/status`
- `/api/consolidation/trigger`
- `/api/sentiment/recent`
- `/api/memory/categories`
- `/api/memory/graph`
- `/api/memory/categorize-existing`
- `/api/memory/stats`
- `/api/memory/backfill-embeddings`
- `/api/memory/health`
- `/api/memory/deduplicate`
- `/api/memory/backup`
- `/api/backup/full`
- `/api/backup/status`
- `/api/memory/compaction-archives`

### experimental_features (98)

- `/api/cache/stats`
- `/api/voice/conversations/:id/messages`
- `/api/voice/voices`
- `/api/vibevoice/info`
- `/api/vibevoice/transcribe`
- `/api/deliveries`
- `/api/deliveries/stats`
- `/api/deliveries/:id`
- `/api/deliveries/:id/retry`
- `/api/marketplace/export/:id`
- `/api/runs`
- `/api/runs/active`
- `/api/runs/:runId`
- `/api/runs/:runId/world`
- `/api/runs/:runId/cancel`
- `/api/runs/:runId/stream`
- `/api/runs/stream/all`
- `/api/conversations/trash`
- `/api/subscribe/activate`
- `/api/orchestration/active`
- `/api/tool-confirm/:id`
- `/api/doc-collections/get`
- `/api/auth/health/check`
- `/api/pace/snapshot`
- `/api/subagents`
- `/api/subagents/:id`
- `/api/subagents/:id/kill`
- `/api/subagents/kill-all`
- `/api/subagents/spawn`
- `/api/agents/autonomous`
- `/api/agents/autonomous/:runId`
- `/api/agents/status`
- `/api/sculptor/sessions`
- `/api/sculptor/parallel`
- `/api/sculptor/compare/:group`
- `/api/sculptor/review/:id`
- `/api/sculptor/replay/:id`
- `/api/minds`
- `/api/minds/:id`
- `/api/minds/:id/tickets`
- `/api/minds/tickets/:id/delegate`
- `/api/minds/tickets/:id/verify`
- `/api/minds/tickets/:id/status`
- `/api/minds/:id/events`
- `/api/minds/:id/idle`
- `/api/minds/:id/memory`
- `/api/lobster/run`
- `/api/lobster/resume`
- `/api/exec/status`
- `/api/personas/sync`
- `/api/personas/sync/status`
- `/api/situation-room`
- `/api/situation-room/briefing`
- `/api/experiments`
- `/api/experiments/run`
- `/api/email/inboxes`
- `/api/sessions`
- `/api/sessions/:sessionKey/history`
- `/api/sessions/send`
- `/api/tool-audit`
- `/api/research/digest`
- `/api/insights/run/:engine`
- `/api/channels/unread`
- `/api/channels/messages`
- `/api/plans`
- `/api/plans/:id`
- `/api/capabilities/sync`
- `/api/plans/:id/decide`
- `/api/autonomy/rules`
- `/api/autonomy/rules/:id`
- `/api/autonomy/rules/seed`
- `/api/autonomy/log`
- `/api/autonomy/stats`
- `/api/outcomes`
- `/api/outcomes/stats`
- `/api/outcomes/patterns`
- `/api/outcomes/pending`
- `/api/outcomes/:id/feedback`
- `/api/watchlist`
- `/api/watchlist/:id`
- `/api/watchlist/alerts`
- `/api/watchlist/alerts/:id/acknowledge`
- `/api/watchlist/scan`
- `/api/governor/actions`
- `/api/governor/scan/governance`
- `/api/governor/scan/models`
- `/api/governor/model-updates`
- `/api/governor/model-updates/:id`
- `/api/crews`
- `/api/crews/:id`
- `/api/crews/:id/agents`
- `/api/crews/:id/tasks`
- `/api/crews/:id/kickoff`
- `/api/crews/:id/runs`
- `/api/flows`
- `/api/flows/:id/steps`
- `/api/flows/:id/kickoff`
- `/api/flows/:id`

### provider_keys (5)

- `/api/tenants/me/profile`
- `/api/brand-logo`
- `/api/tenant/provider-keys`
- `/api/tenant/provider-keys/:provider`
- `/api/tenant/provider-status`

### internal_ops (0)


### unclear (3)

- `/api/crew-agents/:id`
- `/api/crew-tasks/:id`
- `/api/crew-runs/:id`

## Recommended actions

- **admin** (8): mostly curl-driven admin tools — keep, but add explicit allowlist comment in routes.ts so future audits skip them.
- **memory** (14): seed/maintenance routes hit by setup scripts and rarely from UI — keep, audit at next major cleanup.
- **provider_keys** (5): used by settings UI under different paths — likely real false-positives from URL templating, low priority.
- **experimental_features** (98): ~80 routes for features built but not (yet?) wired into the UI (sculptor, minds, lobster, crews, flows, runs, watchlist, governor, outcomes, autonomy, plans). Bob to decide per-cluster: ship UI, archive backend, or leave dormant.
- **unclear** (3): need manual look.
