# Cross-app review and release synchronization — November 27, 2026

## Scope and authority

The owner requested a broad review of the application and sensitive areas,
current dashboard/landing/sidebar content, updated private/public READMEs and
eligible GitHub pushes. This does not authorize publishing Replit production,
changing Railway settings, weakening release gates or exporting private data.
Private main still triggers an existing Railway staging build/schema-repair
step. The owner explicitly approved the push and that side effect after
inspection; review/check gates remain mandatory. No Railway settings change
or permanent unattended-push activation is authorized.

Three independent, read-only reviews divided auth/tenant/safety/tool/MCP,
network/files/credentials/jobs/providers/autonomy, and
payments/artifact delivery/client identity/release operations. Each inventoried
its area and traced representative sensitive call chains. The main engineer
integrated findings and source corrections. This is substantial cross-app
coverage, **not a line-by-line proof of every file or a live penetration test**.
No production database, real credentials, customer records or payment events
were needed for the review.

## Findings and disposition

| Severity | Finding | Disposition |
|---|---|---|
| HIGH | Structured extraction checked DNS separately, automatically followed redirects, and checked final destinations only after contact. A redirect/rebinding could reach private services. | Corrected in source: the shared HTTPS fetch boundary validates before contact, pins checked addresses, rejects redirects, and bounds timeout/body size. |
| MEDIUM | Snapshot-policy plumbing errors fell through to dispatch even when undo requirements could not be established. Earlier approval checks still applied; this was not an approval bypass. | Corrected in source: policy-unavailable attempts refuse dispatch. Verified non-irreversible tools still proceed normally. |
| Residual review work | Three medium/conditional-medium observations and one low-severity observation remain open. | Detailed attack conditions, source locations and remediation notes are retained in owner-private review records rather than published before remediation. Some overlap existing work; conditional observations are not established exploits. |

Overlapping observations from separate reviewers are deduplicated, not counted
as independent exploits. Earlier retained audit findings/dispositions remain
historical evidence, not a new clearance of every current callsite. This public
summary deliberately excludes details of unremediated sensitive findings;
their omission is not a claim that no findings remain.

## Representative controls inspected

- Authenticated tenant context and owner/admin checks; tool-authority and
  destructive-policy enforcement; persona-limited MCP/tool discovery.
- Raw-body Stripe signature verification, livemode/payment-state checks,
  durable event claims and tenant-bound billing/artifact lookups.
- Frontend query cancellation/cache clearing across identity changes and
  server authorization for protected admin data.
- File-root containment, canonical upload/download classification, signed
  ownership checks, private namespaces and bounded public fetch transports.
- Atomic job claims, tenant/attempt/lease fencing, reclaim/backoff and
  persisted uncertain-send outcomes instead of blind duplicate delivery.
- Lenovo/Spark owner-only background scope, fixed model/guardrail contracts,
  no arbitrary tool execution, direct-first fallback and uncertain-generation
  recovery; autonomous repository repair still respects hard-surface gates.
- Public-source sanitization, append-only mirror history, push authentication,
  source-candidate identity and release-receipt boundaries.

## Verification evidence

Initial independent batches passed:

- I/O/jobs: 26 passed, 20 opt-in database cases skipped.
- Auth/safety: 26 passed.
- Payments/client/release: 15 auth/artifact, 3 mocked push-auth and 17
  isolated publish-snapshot checks passed.

Some tests overlap between reviewers; these are execution counts, not a
deduplicated coverage percentage. Synthetic provider/worker/credential fixtures
are not production connections or proof of a successful exploit.

The new actual-extraction regression first failed because production requested
`redirect: "follow"`. The new snapshot-block regression first failed because a
synthetic policy-import exception returned the continued-dispatch result.
Additional focused checks cover private/metadata/IPv6 destinations, HTTP
refusal, no redirect follow-up request, a pinned dispatcher and the ordinary
non-irreversible path. Final release evidence must be bound to the exact source;
an older successful receipt cannot clear these edits.

## Release surfaces and measured facts

The shared release/SEO metadata, dashboard/Updates cards, Business and Technical
landing evidence, operator background-work description, sidebar and both README
sources now describe R138+sec. Daily AI Insights is research exchange, not
automatic adoption. Owner Lenovo work is screened background processing,
not interactive answers; overnight runbook processing is enabled while broader
routine compaction and optional connection-alert mail remain separately gated.

November 27 development census: **428 registered / 386 public tools, 18 active
personas, 68 platform skills, 150 active capabilities, 202 declared / 283 live
tables, 41 governance rules, 905 platform indexes (628 non-PK), 102 curated
models and 6 providers**. Source: [release facts](release-facts.json).
These are development measurements, not production telemetry.

## Limits

The wider tenant audit remains degraded/incomplete. This review does not prove
managed production RLS parity, every query/route/browser interaction, real
payment/webhook/provider behavior, live backup permissions, whole-platform
metered budget enforcement or general model quality. The verified production
Spark arithmetic completion is one real relay result; automatic switching under
an actual outage remains unproven. Source publication and application
deployment are separate outcomes.
