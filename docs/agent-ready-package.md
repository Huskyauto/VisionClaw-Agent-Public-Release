# Agent-ready website package

## Approved scope

Bob selected the agent-ready website package on November 16, 2026. Add an
owner-operated builder beside Website Audit, using confirmed public business
facts. Generate llms.txt, website-only Poppy 1.0 discovery, business JSON-LD,
safe HTML embedding, installation/rollback instructions and validation metadata.
Offer a ZIP download and explicit read-only live checks before and after
installation. Existing quick audits remain the broader website assessment.

No installation, public account, purchasing, hosted fallback, outreach, payment,
customer delivery, ranking guarantee or certification is introduced.
This is an operator export, not a paid fulfillment or storage receipt.
Package files are not saved on the server; download them before leaving.

The existing comprehensive `generate_audit_fix_kit` workflow remains unchanged.
It is a separate site-researched/model-assisted DFY fulfillment path with
meta/crawler remediation and guarded delivery. This smaller public-facts companion
adds website-only Poppy and exact-package live checks without invoking that paid
generation/fulfillment path or presenting itself as its replacement.

## Design gate

1. Cost: generation is deterministic, zero model/API calls. A live check fetches
   at most three public resources, 256 KiB each, with 7-second request timeouts,
   no redirects. Existing SSRF/DNS socket pinning remains authoritative.
2. State: no new database or filesystem state. Files/ZIP exist in memory.
   Owner keeps exported bytes; refresh loses unsaved form/results.
3. Failure: invalid/unconfirmed input fails closed. Live fetch failure,
   truncated data or unsuitable redirects are unknown, never a successful check.
   ZIP failure reports an error; no send/install is attempted.
4. Identity: SHA-256 of version and normalized semantic inputs; retries are
   deterministic exports with no charge or delivery side effects.
5. Scope/limits: require the existing authenticated canonical owner/admin.
   Enforce input bounds, strict fields, no credentials/query/private hosts,
   same-origin public page links. Six live checks/minute/owner per process;
   restarting can reset this protective limiter, not an accounting quota.
6. Stop/observation: feature-local runtime switch `AGENT_READY_PACKAGE_ENABLED=0`
   denies endpoints; UI displays that response. Generation and live observations
   return explicit check results. No scheduled/autonomous work.
7. Authority: owner confirms public facts and authorizes separate installation;
   server validates output shapes; a web developer installs with business consent.
   This feature cannot deploy, approve itself or change policy.
8. Delta: Quick Audit identifies issues; the existing DFY kit already generates
   broader model-assisted remediation. This companion adds no-model website-only
   Poppy files and compares live public bytes with that exact public-facts package.
   No model/tool/concurrency/approval scope increase. Test escaping, URL restrictions,
   output identity, owner denial and mismatched/failed/truncated live observations.

## Acceptance

- Confirmed valid facts produce a bounded deterministic package and ZIP.
- Poppy advertises only signed-out website browsing: no auth, APIs or transactions.
- Generated script cannot close its JSON-LD element through supplied text.
- No robots.txt replacement or invented service hours/address/capabilities.
- Live checks bind results to package ID and timestamp, never claim installation.
- UI supports editing, preview, ZIP download, before/after checks and visible errors.
  Editing invalidates older previews/results; downloads bind exact preview input.
- No app publication or customer-site action without separate authorization.

## Sources

- https://personalagentprotocol.org/docs/1.0/spec (sections 3, 3.1)
- https://personalagentprotocol.org/kit/company (website-only adoption)
- https://llmstxt.org/
- https://schema.org/Organization

## Verification

Development verification on November 16, 2026:

- Ten focused package, owner-route and private-ingress checks passed, including
  confirmation, malicious URLs, cross-site links, script escaping, fixed ZIP
  entries, customer/anonymous denial, session CSRF, feature disablement, rate
  limiting and failed/truncated/mismatched observations.
- Full application TypeScript check passed using a 3 GiB heap cap.
- The application restarted successfully in owner-only mode. Real authenticated
  development requests returned HTTP 200 for preview JSON and a nonempty ZIP.
- Felix-only prompt synchronization and the agent-wiring audit passed (existing
  advisory sprawl/orphan-table warnings remain); stale-string preflight passed.
- Scoped self-review covered input/output escaping, authentication/CSRF
  composition, network limits and existing SSRF/socket pinning, fixed ZIP paths,
  no storage/payment/delivery hooks, and agreement with the approved scope.
- One signed-in browser pass verified retained typing focus, multiline services
  and links, required confirmation, all six previews, a real 3,702-byte ZIP Blob
  with six entries, and before/after live checks against the unmodified
  example.com site. Both returned three honest failures, not false installation
  passes. Both evidence JSON exports were populated and bound to the same package.
- Editing a service cleared all stale results and confirmation. The 390-pixel
  phone form had no horizontal overflow; expanded results at that width were not
  separately browser-tested. Native browser download events were not available
  to the harness; the app's real download Blobs and ZIP directory were inspected.
- The temporary development session was revoked through the existing logout
  route, protected access was denied afterward, and its private fixture removed.
- No customer installation, production publication, pilot demand or revenue is
  established.
