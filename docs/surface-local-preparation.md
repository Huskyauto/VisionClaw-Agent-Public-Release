# Surface local inference — preparation contract

**Current parallel-work contract:** `docs/parallel-local-maintenance.md`.
The preparation/recovery chronology below predates Bob's approval of Surface-first
single-reference jobs running concurrently with Lenovo's multi-concept jobs.

## Superseding owner-approved recovery behavior

The original preparation record below is historical. Bob subsequently saved
the Tailscale rule and approved response-based failover plus normal hosted
recovery. Current implementation and activation contract:
`docs/local-response-failover.md`.

The current order for the three screened internal runbooks is Lenovo first,
enabled Surface second after health/transport/timeout/validation failure, then
the existing hosted fast-tier route when explicitly enabled. All providers use
the same source/schema checks. Cancellation, revocation and admission contention
do not cause hosted spend. This supersedes the outage-only/no-hosted language
in the original preparation record, not its owner/source/authority boundaries.

Live connection evidence: Surface catalog and fictional streaming generation
passed (4.5 seconds); the coordinated Lenovo outage reached Surface (22 seconds)
but rejected too many source references. Lenovo recovery and a real Qwen3 8b
generation subsequently passed (7 seconds). No failure was relabeled successful.

## Outcome and current boundary

Prepare Bob's second laptop alongside Lenovo without contacting it before the
Tailscale policy is saved. Surface starts disabled. No publication, public
tunnel, laptop administration, new credentials, database migration, hosted-model
selection change, standing grant or embedding change is authorized here.

The first consumer remains the existing three screened engineering-runbook
jobs. This is not general Felix chat routing or all background-work offloading.
Status labels remain deterministic and never need a model.
Lenovo is always the primary node. Surface is only an enabled backup when
Lenovo's pre-generation health check fails. Each new dispatch checks Lenovo
again, so work returns to it automatically when it is back online.

## Design gate

1. **Cost/scale:** existing maximum three sources × three real attempts = nine
   jobs/night. One active local generation across processes remains the ceiling.
   A dispatch checks each enabled node once, generates on at most one, and never
   spends hosted tokens. A Surface generation failure is not automatically
   replayed on Lenovo after an uncertain outcome.
2. **State:** reuse the encrypted owner/environment-bound Tailscale identity,
   existing job queue and cost ledger. No additional daemon or durable local
   files. Health is checked per dispatch; no stale health cache.
3. **Failure:** Lenovo is checked first; only its failed health check permits
   checking the enabled Surface backup. Once generation starts, interruptions,
   malformed output or failed validation fail explicitly. Existing queue policy
   owns bounded later retries. Both nodes away means pending, never paid rescue.
4. **Identity:** existing source hash/environment/night job keys, leases and
   cross-process admission lock remain unchanged. No extra scheduler.
5. **Tenant/limits:** owner tenant only, existing allowlisted sources only;
   12,000 input characters, 90-second generation wall clock, 12,000 output
   characters, bounded response bytes and server-side schema/source validation.
   Local outputs receive no tools or authority.
6. **Stop/observe:** exact `SURFACE_LOCAL_ENABLED=1`, additionally requiring the
   existing Legion background flag and original workspace. Default is disabled.
   Zero-dollar ledger records identify the actual provider/model; logs contain
   provider, latency and local fallback, never source or generated text.
7. **Authority:** owner enables/stops; fixed server routing selects; model only
   proposes source positions; deterministic validation checks; existing queue
   and ledger retain evidence. No adaptive policy editing or approval powers.
8. **Delta/evidence:** add one fixed private endpoint and Foundry transport.
   Offline fixtures must prove disabled behavior, fallback, owner checks,
   output limits, cancellation and unchanged Lenovo request shape. Actual
   Surface model compatibility, live ACLs and production persistence remain
   unverified until separately exercised.

## Activation after work

In https://login.tailscale.com/admin/acls append (do not replace the policy)
this entry to `grants`, retaining Lenovo and all unrelated rules:

```json
{
  "src": ["tag:visionclaw"],
  "dst": ["100.94.89.78"],
  "ip": ["tcp:5273"]
}
```

Append to `tests`:

```json
{
  "src": "tag:visionclaw",
  "accept": ["100.94.89.78:5273"],
  "deny": ["100.94.89.78:22", "100.94.89.78:443", "100.94.89.78:11434"]
}
```

Current Tailscale grants use `src`, `dst`, `ip`; unlike legacy ACLs they do not
need the attachment's `action` property. Do not add wildcard access.
Source: https://tailscale.com/kb/1324/grants .

Leave Surface disabled until the policy save is confirmed and an explicit
synthetic preflight passes. No Surface network probes are authorized before
that confirmation. Production rollout is a separate owner-approved step.

## Operator continuation

After Bob explicitly confirms the policy save:

1. Keep the existing development app/supervised Tailscale connection running.
   Do not start a second daemon or borrow Spark's identity.
2. Run exactly:
   `npx tsx scripts/surface-local-preflight.ts --surface-policy-confirmed`.
   With no flag or any unknown flag it exits before network/DB access.
   It refuses production, acquires the existing inference lock, checks the
   fixed catalog, makes one fictional streaming generation with the same
   Foundry parameter shape, records zero inference charge and reports fixed
   negative-port observations. It never enables the provider itself.
3. If that succeeds, enable `SURFACE_LOCAL_ENABLED=1` in development only using
   the normal environment controls and restart the app. Lenovo must still win
   while healthy. Coordinate a Lenovo-offline trial with Bob before checking a
   screened runbook through `compileLegionRunbook` on Surface; never stop either
   laptop's services from the app. Inspect validated output and `surface-local`
   ledger/log attribution. The explicit synthetic preflight is a diagnostic,
   not permission to send normal work to Surface while Lenovo is healthy.
4. Check return to Lenovo after recovery and disabled-Surface behavior; retain
   the flag only if the complete backup trial passed. Schema/output incompatibility means
   leave Surface disabled and preserve the failed evidence, not relax validation.
5. Production identity/schema/flags, publication and republish continuity require
   a separate explicit owner-approved rollout. Do not equate development daemon
   restoration with production persistence acceptance.

This private lane intentionally retains its existing **no hosted fallback**
contract. Its order is Lenovo → enabled Surface backup → pending/offline.
Bob's correction supersedes the attachment's Surface-first priority.
No arbitrary summaries, customer material,
14b escalation or expert/customer outputs have been moved to either laptop.

## Verification recorded November 17

- Owner priority correction: 26 focused checks now pass with Lenovo always
  primary, no Surface contact while Lenovo is healthy, Surface-only outage
  fallback, and automatic return to Lenovo on the next healthy call. Both
  dispatch and the nightly capacity gate use the same selection function.
  Application TypeScript, stale-string and wiring checks passed after this
  correction. Restart reported the supervised development node ready; landing
  HTTP 200 and Lenovo's private version endpoint succeeded. Surface stays
  disabled and unprobed; live backup activation remains deferred.
- Initial preparation passed 24 offline/mock-backed focused tests: both laptops' request selection,
  unchanged Lenovo parameters, owner/task boundaries, exact model acceptance,
  source-grounded queue results, actual-provider accounting, disabled/away/
  revoked behavior, unloaded-model rejection, no uncertain replay,
  malformed/truncated/tool output rejection, UTF-8 SSE framing, output bounds,
  keepalive deadlines, cancellation, fixed proxy destination and no redirects.
- Full application TypeScript and the stale-string check passed. The wiring
  audit passed with its pre-existing advisory persona/table warnings. This is
  not a whole-platform security clearance or production build.
- Running the preflight **without** the confirmation flag refused as expected;
  no Surface network call, generation, activation or production change occurred.
  Development and production environment inspection both found the new flag unset.
- Development app restart and landing capture passed; landing HTTP 200 and
  anonymous protected API HTTP 403 retained the owner-only boundary.
- Readiness checks found the old development identity still held since
  November 16, before this work, with no tailscaled process. The app was stopped,
  absence of the daemon and listening proxy independently confirmed, and only
  that observed owner's development holder was cleared conditionally, retaining
  the encrypted identity bytes. The restarted supervisor reported ready; the
  fixed Lenovo endpoint returned Ollama `0.40.16`. No replacement identity,
  new key, inference generation or general crash-takeover rule was introduced.

### Attachment acceptance status

1. Surface live catalog: **pending policy save**.
2. Synthetic real-token generation: **pending**.
3. Production-shape generation: offline shape proven; live run **pending**.
4. Negative network checks: fixed preflight prepared; Surface live checks
   **pending**. Dial failures cannot certify policy isolation by themselves.
5. Routing: offline selection/fallback/revocation proven; two-live-node trial
   and grounded Surface compilation **pending**.
6. Persistence: existing development Lenovo identity restored; Surface and
   production/republish acceptance **pending**, not authorized by preparation.
7. Kill switch: default-off/exact opt-in implemented; offline disabled routing
   proven; live enable/disable sequence **pending**.

Scoped self-review covered the touched transport/parser, queue/cost wiring and
preflight; the private-network exception has no URL input and is unreachable
from general fetch tools. Existing tenant/source/admission/approval boundaries
and hosted providers are unchanged. No unsolicited reviewer/browser agent,
full release package, public-mirror refresh or publication was run.
