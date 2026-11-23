# VisionClaw cross-app source review — November 19, 2026

## Scope

Reviewed the pending source range from the workspace's prior tracked private
baseline, plus authorization, payment, delivery and reliability boundaries.
The initial difference covered 121 files; the app inventory counted 1,644
JavaScript/TypeScript modules in `server`, `shared`, and `client/src`.
An independent read-only reviewer traced representative entry points and their
callers. This was risk-based coverage, not a manual review of every module,
browser route, tenant query or external provider.

| Area | Review evidence and limits |
| --- | --- |
| Auth, tenant isolation and MCP | Key ingress, access-mode and tenant-activity checks reviewed. No full OAuth lifecycle or tenant-query audit. |
| Billing, webhooks and file delivery | Representative signature, idempotency, and delivery boundaries examined; no live payments or exhaustive fulfillment journey. |
| Tools, queues and recovery | Representative guarded execution, lease and recovery boundaries inspected, not every worker. |
| Memory and local inference | Changed source capture, immutable storage, fallback precedence and local routing reviewed. No live provider acceptance or historic reclassification. |
| Backups and release scripts | Reviewed permission decisions and staged packaging boundaries. Isolated Railway evidence does not establish production parity. |
| Web UI and docs | Both public landing modes, shared discovery and release summaries, both READMEs and owner billing feature examined. No browser tour of all routes. |

## Findings and corrections

1. **High — modern MCP account activity.** Modern key verification now binds
   the key to a currently active owning tenant before exposing scoped operations.
   A failed lookup returns no verified identity. Legacy MCP's separate check
   and modern connector access policy were not weakened.
2. **Medium — working-context fallback precedence.** Live artifacts are
   immutable by turn. The richer existing extraction now has the first save
   opportunity; valid local output remains a fallback for unavailable or
   invalid hosted output. The fix does not rewrite earlier artifacts.
3. **Medium — unqualified website assurances.** Scoped access-control and
   measured-development descriptions replace categorical isolation claims.
4. **Type check — memory category selection.** Validate and normalize the
   optional parent once before the lookup; the callback no longer reads a
   possibly absent model-produced field.

The tenant audit remains incomplete. Source review does not certify production,
result in production configuration changes, or authorize a website deployment.

## Verification

- 92 selected regressions passed with workspace provider credentials excluded.
  The modern MCP test inspects the generated SQL using a fixture; the memory
  test exercises extraction ordering with an immutable-store fixture.
- Full application TypeScript, stale-string checks, source inventory counts,
  tool-domain boundaries and agent wiring passed. The wiring check reported
  existing orphan-table warnings.
- Both anonymous development landing modes rendered the current release,
  HVAC pilot, account-activity safeguard and metadata. No authenticated
  production journey or live provider/payment request was run for this review.
- The read-only development census confirmed 428 registered tools, 386 public
  documented tools, 149 active capabilities and 102 curated models. This does
  not establish available subscriptions, production traffic, or model quality.
- The first GitHub Docker smoke build found that the ignored documentation
  directory hid the workbench's Markdown import. The build context now admits
  that exact file and retains the exclusions for unrelated reports and private
  documentation. A regression checks the actual import against the allowlist.
