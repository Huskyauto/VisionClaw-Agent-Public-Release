# October 31 source update and risk-based application review

Release: **R137.1+sec**. This document describes source changes and development
evidence, not confirmation that the website has been republished.

## New and updated surfaces

| Surface | Current behavior |
|---|---|
| Website business and technical views | Current source summary, measured development inventory and honest feature limitations |
| Dashboard | Latest release is first in the shared update feed; prior releases retained |
| Sidebar | Shared release badge and owner-only AI Stack Decision Review link under Income Opportunities |
| Updates page | Detailed October 31 entry; historical entries retained |
| SEO, install description | Updated source summary; no claim that install metadata migrates old PWA domains |
| Private/public README | Current feature summary and generated tool/persona reference links |

### AI Stack Decision Review

Eight complete documents cover the offer, illustrative comparison report, intake,
evidence method, manual fulfillment/support, unit economics, launch drafts and
reusable templates. The owner preparation workspace supports reading, Markdown
exports, copy and print. Mobile navigation wraps vertically; tables become labeled
records; long links and text wrap instead of forcing sideways reading.

The $350 price remains an unvalidated pilot hypothesis. No customer database,
checkout, automated campaign, purchase authority or autonomous fulfillment was
added. The illustrative report must not be represented as an actual customer result.

### Other recent work

- Company-report package continuation, content review and recovery work retains
  source evidence and pending outcomes. Full live end-to-end proof remains pending.
- Chat-disconnect and quota-resilience changes preserve work and distinguish
  recoverable or uncertain outcomes from successful completion.
- Gmail reconnect navigation permits the intended Google form redirect without
  broadening the global policy. Real consent/reauthorization is separate.
- Tenant-audit continuity retains partial work across bounded source-bound slices.
  The current broader audit is explicitly degraded/incomplete.
- Current model inventory and generated tool/persona catalogs are refreshed from
  source; the [facts file](release-facts.json) records development measurements.

## Independent review coverage

The initial independent review inspected application entry/route ordering,
session/API-key/API-v1 authorization, tool policy/dispatch, upload authorization,
billing/webhooks, SSRF helpers/web tools, provider/retry references, the agent
executor, frontend role/cache transitions and publishing scripts.

This was **risk-based**, not a line-by-line audit of every file. Large domain
handlers, every tenant SQL query, every payment variant, all background repair
paths and complete production behavior were not exhaustively reviewed. Existing
degraded audit reports are unresolved evidence, not a clean bill of health.

## Confirmed findings corrected

| Severity | Boundary | Correction | Offline evidence |
|---|---|---|---|
| HIGH | API-key tenant revocation | Check authoritative tenant activity before stamping request identity; fail closed on lookup errors | Active→disabled and DB-failure regression |
| HIGH | Cached and uncached identity mappings | Recheck cached tenant activity and subject binding; reject disabled existing/owner/email mappings | Cached and uncached disabled-tenant regression |
| HIGH follow-up | Admin-only routes under the public prefix | Keep stats and architecture outside the public-auth bypass so existing admin handlers receive authoritative authentication | Exact, query and trailing-slash public-path classification regression |
| HIGH | App-side web fetch DNS rebinding | Validate and pin the initial request and each redirect hop; close per-hop agents gracefully and cancel redirect bodies | Captured pinned socket lookup addresses and blocked initial private URL |

Regression commands:

```sh
npx tsx --test tests/security/tenant-auth-revocation.test.ts tests/security/tool-fetch-dns-pinning.test.ts
```

All five tests were observed failing on their original vulnerable behavior, then
passing after the changes. Tests isolate queries, DNS and HTTP; no real tenant
credentials or external provider requests are used.

## Known limitations, not closed by this release

- The larger tenant-isolation audit remains degraded and needs independent
  finding-by-finding triage. A finished chunk count does not imply clearance.
- Existing Stripe webhook tenant association concerns remain in the audit.
- Known memory-stats/admin-fallback, remote-browser SSRF and aggregate spend-limit
  limitations were not silently marked fixed.
- Mobile layout evidence renders the actual page offline at five viewport widths;
  it is not authenticated installed-PWA or print-preview proof.
- Source availability, named model configuration and generated docs are not
  served-model evidence, production migration parity or successful customer delivery.

## Release verification

- Full TypeScript check passed with a bounded 2304 MB heap.
- 22 focused tests passed: package/route wiring, release facts, SSRF classification
  and fetch behavior, plus five new security regressions.
- Stale-string preflight: 25 rules clean. Count verification: 43 metric mentions
  agree with generated release facts.
- Full production build completed with exit code 0. Existing bundler
  `import.meta`/CommonJS and large-chunk warnings remain; not represented as fixed.
- Independent follow-up review confirmed the public-prefix correction by source
  inspection; the initial three boundary findings and related follow-up are closed.
- Mobile public landing screenshot rendered successfully after restart. This
  does not establish authenticated dashboard/PWA or customer-flow behavior.

Public publication uses the existing fail-closed sanitizer; private runtime state,
credentials, customer assets and other excluded material must never be copied
unfiltered to the public repository.
