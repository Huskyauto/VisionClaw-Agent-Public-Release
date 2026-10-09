# Whole-app and October 4–8 source review

Date: October 8, 2026. Source revision: **R135.9+sec**.
Environment: development. **No app publication authorized or performed.**

## Scope and limits

The review covered app-wide architectural/security boundaries and recent source
changes, with independent inspection of authentication, tenant/file ownership,
model transport, spending, tools, recovery and delivery. Recent work includes
owner jury recovery/topic scope, Standard Compute fallback, restricted Copilot
chat, Haiku 5.5 content repurposing, Muse Spark 1.3, Reflection Beam discovery,
research evidence, browser/workspace changes and the TypeScript domain-boundary
preflight. Public/business copy and actual implementation were compared.

This was a **bounded whole-app review**, not line-by-line inspection of every
source file, an exhaustive adversarial penetration test, or production
certification. Automated static and tenant-audit coverage remains incomplete.
Unknown results are not counted as clean.

## Confirmed fixes and corrected findings

| Finding | Evidence and outcome |
| --- | --- |
| Signed-in customers could export owner-managed global skill prompts | The actual registered export handler lacked the platform-admin gate. Red tests observed non-owner export, then the gate was added. Owner/customer/anonymous handler regressions pass. |
| Initial anonymous-export allegation | Corrected: global API authentication already blocks anonymous requests. Skills are global owner-managed objects, not rows carrying a tenant ID. The remaining issue was authenticated non-admin access. |
| Initial HIGH Drive read/delete/share allegation | Withdrawn after examining the existing `requireTenantDriveFileAccess` guard above those branches. Existing negative ownership/ancestry tests pass. No unnecessary Drive rewrite was made. |
| Newly adopted paid Beam could estimate at $0 | Validated token rates now persist atomically with registry entries. Ledger estimates read those rates immediately and after restart. Missing/invalid Beam rates cannot load; generic ranking adoption cannot bypass the watcher. Unknown cache discounts are not invented. Temporary-directory subprocess tests verify persistence, restart, deduplication and nonzero cost without changing the real model overlay. |
| Dependency advisories | Compatible patch/minor upgrades applied to affected libraries. The scanner's critical proxy-address finding is resolved. No broad major-version replacement was attempted. |
| Missing Copilot processor classification/disclosure | The fail-closed legal gate caught the missing SDK classification. Privacy disclosures now explicitly describe restricted Copilot and optional Standard Compute, Profundo and Openference connections; local-only transitive libraries are separately classified. The legal gate passes. |
| Persona tool-document drift in development DB | The broad suite caught stale canonical tool documentation. Corrected via the existing canonical sync, not a blanket persona reseed; verification is recorded below. |

## Automated scan results

### Dependencies

Before patching: **85 findings — 1 critical, 38 high, 37 moderate, 9 low**.

After compatible patches: **36 findings — 0 critical, 13 high, 18 moderate,
5 low**. These are scanner findings, not a count of demonstrated exploitable
application paths. Remaining affected package families:

- `brace-expansion` (nested versions), `braces`
- `esbuild`, `postcss-selector-parser`, `sprintf-js`
- `undici` (nested version)
- Python `starlette`

Unresolved items remain open; this report does not create a blanket deferral.
Some require transitive dependency/major-version or helper-runtime review rather
than forcing incompatible versions into the Node app. Fresh advisory and
deployment-reachability checks are required before declaring them closed.

### Static/privacy/tenant coverage

- Platform SAST returned **incomplete coverage**. Its empty result list is
  **not** evidence of zero issues.
- The privacy scan chiefly raised logging/data-handling observations.
  These are retained for review, not blanket-dismissed or independently
  certified fixed.
- Repository-wide silent-failure scan examined **1,181 source files** and
  reported **42 high / 290 medium** heuristic findings. Those are unresolved
  audit candidates, not all proven vulnerabilities or session regressions.
- The prior tenant-isolation audit is degraded/stale after source changes.
  No fresh complete tenant-audit certification is claimed.

## Validation evidence

- Broad non-browser suite completed: **251 Node suites attempted; 249 passed,
  2 failed initially**. Failures were canonical persona documentation drift and
  the missing Copilot processor classification. Both received targeted
  correction/confirmation; the whole broad suite was not redundantly rerun.
- Final confirmation: legal/processor suite **10/10 passed**; canonical persona
  drift suite **4/4 passed** after the documented sync. A live anonymous export
  request returned **HTTP 401**.
- Focused recent-change tests: Beam catalog/pricing/restart, marketplace export,
  Drive ownership, legal classification, Copilot quota/isolation, Haiku pricing,
  Muse Spark version accounting, Standard Compute transport and jury recovery,
  plus parser-based domain boundaries.
- TypeScript check passed.
- Production build passed with existing CommonJS `import.meta` warnings;
  warnings are not represented as a warning-free build. Copilot's production
  worker path selects the bundled sibling worker rather than its development
  `import.meta` branch.
- Canonical release-fact drift gate passed across its expected documentation
  surfaces. Stale-string preflight passed.
- The first public-mirror attempt was safely blocked by stale release-contract
  expectations for October 3. The fixture and static HTML metadata were updated
  to the current source snapshot; the release-contract suite then passed **5/5**.
- Development app restart, public landing screenshots and final targeted
  confirmations are part of the release completion check.
- Both public landing views rendered with updated source facts and feature
  cards. Startup health checks reported healthy, with pre-existing warnings
  including optional drawtext degradation, unavailable Claude subscription
  bridge, and knowledge-store size; these were not presented as fully ready.
- Bounded development-only public-surface sample: **100 requests, concurrency
  10, p50 58 ms / p95 118 ms / p99 229 ms, zero network/5xx failures**.
  Responses included 67 HTTP 200, 27 expected protected-health HTTP 401 and
  6 rate-limited HTTP 429. This does not measure authenticated chat/model
  latency or certify production load capacity. No inference or owner mail ran.
- Browser end-to-end suite was intentionally not run; no sign-in/payment journey
  was redesigned. Mission tests are existing regression tests, not a launched
  revenue mission.

## Surface/documentation updates

Business and technical landing views share current October 4–8 feature cards.
Dashboard release cards include the current date and newest-release indicator.
Sidebar release/security badges share the current release constant. Visible
metrics and shared SEO use measured development facts; stale zero-vulnerability
claims were removed. Both READMEs, current totals, roadmap, contribution and fork
guidance are synchronized. Historical changelog records remain historical.

Measured development snapshot: **426 registered tools, 386 public documented
tools, 142 capabilities, 68 skills, 18 personas, 193 declared / 274 live tables,
881 platform indexes (613 non-PK), 85 curated models, 41 governance rules**.

Owner connections remain restricted/opt-in. Beam is not listed yet. Catalog
presence is not inference/quality proof. Subscription account quotas are finite.
Neither code availability nor an application `$0` label proves free provider use.

## Outstanding readiness boundaries

The proposed aggregate $20 metered-AI daily authority is not enforced
application-wide. Production verifier memory authority/completion, production
schema parity, fresh complete tenant audit, and post-publish replay remain
unverified. These were not silently marked resolved.

Private GitHub backs up tracked source, not Secrets, databases, uploads or ignored
workspace configuration. The sanitized public mirror is a source release, not a
configured copy of the owner's hosted accounts. App publication requires separate
explicit owner authorization.
