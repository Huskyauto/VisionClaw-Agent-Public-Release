# Cross-application review and repository refresh — November 17, 2026

## Request and evidence boundary

The owner requested a thorough code review across the entire app, including
dashboards and website landing pages, followed by both GitHub repository and
README updates. Source maintenance does not authorize app publication or changes
to production configuration.

This was a risk-based application review, not line-by-line certification of the
whole repository. The static inventory covered **1,634 TypeScript/JavaScript
application modules** in `client/src`, `server` and `shared`, including **115 page
components plus one page-data module**. The final route inventory finds 168 JSX
registrations and 114 unique literal paths; authentication branches repeat
paths. Child/fallback components are not necessarily standalone pages.
The complete page inventory and its coverage labels are retained in
[the machine-readable index](app-review-pages-2026-11-17.json).

One independent read-only reviewer received the inventory, all page filenames
with bounded opening ranges and selected deeper backend/shared-UI sources.
Inspection concentrated on authentication, account activity, CSRF/owner gates,
query-cache identity, routing/navigation, legacy MCP, billing/webhooks, async
maintenance and public-page behavior. This does **not** establish that every
page body, backend module, integration or dashboard action was manually examined.
The parent verified findings against actual callers and repaired the confirmed
paths. No second independent review of those repairs is claimed.

## Findings and disposition

All substantive findings below predated this review.

| Severity | Finding | Disposition |
|---|---|---|
| Conditional HIGH | The optional legacy MCP key cache treated a remembered tenant identity as continuing authorization; fresh lookup included inactive accounts. | Recheck the current active-account predicate on fresh and cached lookups, evict disabled identities, and return unavailable on authorization-store failure. The compatibility owner key passes the same live check. Legacy MCP stays default-off; modern connected-agent access was not retired. |
| MEDIUM | Failed remote logout prevented local identity and private-cache cleanup. | Local cleanup runs even when remote revocation fails, with a generic warning rather than a false revocation claim. Replit logout redirect follows local cleanup. Existing identity-generation guards remain. |
| MEDIUM | AuthGate's public Skills route shadowed the authenticated workspace Skills route. | Remove that public-route interception only from the signed-in branch. Anonymous catalog discovery remains. |
| MEDIUM usability | Public signup/sales/contact presentation conflicted with the intentional private-owner policy. | Both landing modes identify owner sign-in and display private-installation guidance. Anonymous private-mode visitors see explicit store/contact notices instead of inaccessible forms. No API exemption, account access or checkout permission was added. |
| Operational limit | Contact submission storage could succeed without confirmed email notification; there is no reviewed owner outbox journey. | Success copy now confirms storage only, not email delivery or response timing. Email notification reliability and owner visibility remain unverified, not silently declared fixed. The stored submission is not converted into a retryable failure that could duplicate it. |
| LOW accessibility | The document viewport disabled user scaling. | Removed the zoom restriction without changing page layouts. |
| Documentation | Current README tables/diagrams, initial SEO/PWA metadata and current totals had stale measurements. | Regenerated development facts and reconciled README sources, roadmap, fork setup, shared release summaries and initial metadata. Historical release entries retain their original dates and evidence. |

The HIGH rating is conditional on enabling legacy MCP in an accessible
multi-tenant deployment. This review did not establish production flag values or
an active production exploit. Tightening that route does not certify the modern
MCP surface or every existing SSE session lifecycle.

The private access policy itself is intentional, not an authentication bug.
The reviewer suggestion to enable customer mode was not adopted: the owner's
private-installation decision remains in force.

## Regression approach

`tests/security/app-review-followthrough.test.ts` runs actual source closures
through isolated compiler/VM seams rather than importing the complete live
provider stack. It covers:

- remote logout failure and local identity/cache/storage cleanup;
- real AuthGate JSX route selection for authenticated and anonymous Skills;
- active, disabled and unavailable authorization states, with and without a
  remembered legacy key, including exact-tenant query predicates;
- public contact/store rendering under private and multi-tenant modes;
- compatibility-owner authentication success, disabled-account refusal and
  authorization-outage refusal.

Primary logout, tenant-cache, Skills and private-form failures were reproduced
before their corresponding repairs. The fixtures are not a browser, real
PostgreSQL transaction, real OAuth revocation or payment journey. The new
regressions are included in the canonical test runner.

Broader selected regressions cover prior subscription/memory/media integrity,
owner identity and access, preauth admin hydration, CSRF cache headers, MCP
ingress, webhook authentication, agent-ready exports, local-provider admission
and routing, landing visibility, release facts and source-surface consistency.
Review test processes omit real workspace credentials and restrict sockets to
their own registered test listeners, including their Unix sockets. Dummy SDK
constructor values are not usable credentials.

## Verification

- **114/114 selected offline regressions passed**, with external egress blocked
  and no owner provider/database credentials inherited.
- **Production bundle completed** with `scripts/build.ts --release-check`.
  Existing bundler warnings, including CJS `import.meta` warnings, remain;
  bundle completion is not production-runtime acceptance.
- **Full TypeScript check not verified:** the single whole-project run exhausted
  its 2,300 MB heap cap. No successful whole-project typecheck is claimed.
  Source transpilation, selected regression execution and the production bundle
  passed independently. The compiler was not repeatedly retried or given the
  whole VM's memory.
- **Dependency audit:** zero reported production-dependency advisories. This is
  not a completed SAST, privacy/dataflow or exploitability assessment.
- **Domain boundaries:** 269 files across 92 domains, zero forbidden cross-domain
  imports.
- **Agent wiring:** no tool/skill drift or schema gaps under this check; its 29
  existing orphan-table warnings remain warnings, not a completed table audit.
- **Documentation counts:** 43 metric mentions across 12 checked documents
  agree with current development release facts.
- **Release publication contract:** 13/13 release-source/parser checks passed
  after reproducing and correcting a mismatch between the current marker and
  first release heading. The public publisher correctly refused that mismatch;
  no sanitizer or publication guard was relaxed.
- **Runtime:** development app restarted and served on port 5000.
  Anonymous business and technical landing screenshots showed owner-only
  guidance, current facts and owner sign-in actions without a rendering crash.
  Auth status confirmed owner-only mode. Browser logs included expected
  private-route 403s for setup/auth probes and public recipes, plus unexplained
  `ERR_FAILED` resources; a clean browser console is not claimed.
- **Observed existing development limits:** startup reported unavailable Claude
  Runner subscription credentials, a degraded drawtext filter and a subsequent
  memory-backup upload failure. These were not established as production
  failures or traced to these edits. Existing automated owner notification
  queued a backup-failure alert; inbox receipt was not verified.

## Source and publication requirements

| Requirement | Implementation/evidence | Boundary |
|---|---|---|
| Include backend and all dashboard/page families | Complete static module/page index, selected independent inspection, shared-boundary and focused regressions | Not deep manual/visual inspection of every page or module |
| Include both landing modes | Private-mode CTA/source updates and shared current facts; bounded anonymous visual verification | Not a signed-in tour of every dashboard |
| Update both READMEs | `README.md` and public-source `README.md`, current facts, operating limitations and repository map | Public source is sanitized, not a private-data backup |
| Include file/folder additions, modifications and deletions | Private Auto Git Push and full policy-controlled public snapshot | Ignored runtime state, credentials, private records and proprietary export exclusions remain excluded |
| Verify both GitHub updates | Final remote receipts are reported separately after synchronization | Local build success or a fresh timestamp alone is not proof of current README bytes or CI |
| Preserve production boundaries | No publish, production setting, database migration or live purchase | Source fixes still require a separate app publication to affect deployed behavior |

## Remaining limits

- The existing tenant audit remains degraded/incomplete; staged RLS work is not
  cleared by this review.
- No complete browser pass over 115 page components, external service acceptance
  suite or full-repository SAST was performed.
- Remote logout failure means server-side session revocation remains uncertain;
  local cleanup cannot delete a server-managed HttpOnly/OIDC cookie by itself.
- Contact delivery/outbox operations, full company-package delivery and
  production verifier completion retain their previous evidence limits.
  Durable notification/outbox verification is required before reopening
  anonymous contact intake; correcting receipt wording does not deliver mail.
- Surface 7B task quality remains variable. Native parallel inference and
  validated recovery do not establish reliable all-night throughput or savings.
- No new tool, persona permission, model promotion or schema was introduced.
  Agent-context changes are not required for these repairs; no model knowledge
  or authorization grant is inferred from a documentation update.
- Public mirror verification checks export policy, not correctness of all
  exported code. GitHub synchronization and CI acceptance are distinct.
