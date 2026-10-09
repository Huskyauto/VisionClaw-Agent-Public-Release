# Phone-first browser workspace

## Using it
Open **Browser Workbench**, the sidebar folder beside Income Opportunities.
**Overview** (`/browser-workbench`) explains capabilities and use.
**Browser controls** (`/browser-workspace`) opens the signed-in remote workspace.
**Workbench files** (`/browser-workbench/files`) creates nested folders and saves
browser-related files. The separate My Vault page remains unchanged.
Choose the agent whose Camofox session you want to supervise. Normally leave
**Session suffix** blank; use the same suffix as an existing agent workflow only
when it explicitly created one. Tabs from other agents are intentionally isolated.

Screenshots refresh every eight seconds while the page is visible. They are not
live video. Unavailable-service polling backs off to one minute. Tap **Take control** before opening a page, navigating, typing,
scrolling, clicking a labeled page control, or closing a tab. Click and close
actions have confirmation dialogs; text uses the phone's normal keyboard.

Human control pauses all Camofox actions for this account, including snapshots.
It survives phone disconnection, reload and server restart. Busy takeover is
rejected until the current remote operation finishes; it does not cancel a click
already in flight. Refresh and retry takeover rather than assuming it succeeded.

**Return to agent** verifies the remote browser before restoring access. The agent
must then take a fresh snapshot of each tab it intends to change. If the original
chat or job has ended, ask the agent to continue; handback is not a job restart.
If a selected tab expires, Human control remains active. Explicit handback clears
its target only after a transport-derived 404 and a fresh, valid empty list for
the same account, persona and suffix. Authentication errors, connection failures,
malformed lists and remaining tabs do not authorize this recovery. Select and
refresh a current tab if others remain.

## Safety and limits
- Browser files are manually uploaded or explicitly added from the user's own
  Vault; remote downloads are not automatically imported. Rename changes the
  workbench label. Move changes organization; Remove removes only the workbench
  reference and preserves Vault bytes. Empty folders can be deleted.
- Private uploads commit bytes and folder metadata atomically, without shared
  Google credentials or public filesystem copies. Limits: 8 MB per upload,
  100 folders, 500 references and 100 MB for workbench-created bytes plus linked
  files. Removing a reference does not release retained upload bytes; permanently
  deleting the underlying file in My Vault does. No automatic upload retries.
- Library rows, file lookups and byte quota checks are authenticated-tenant
  scoped. Revision fencing and UUID/digest receipts prevent duplicate concurrent
  saves/replays. Corrupt organizational state fails closed.
- Only authenticated human sessions can use the workspace; `vc_` API keys are rejected.
- Tenant identity comes from authentication, never action arguments.
- Persona and suffix retain the driver's existing remote-session boundaries.
- PostgreSQL advisory locks serialize takeover and remote actions across instances.
- Each mutation uses a UUID and current revision, committed before remote effects.
- Existing-tab mutations recheck the exact target's fresh snapshot digest.
- Uncertain outcomes are not automatically repeated. Refresh, inspect the actual
  page and deliberately decide whether another action is needed.
- Queued requests retain their original sign-in generation and cannot borrow a
  later account's credentials. Page-control approvals bind the selected target
  and digest; changed controls require selecting again.
- Images, page text and typed values are not stored in the activity ledger.
- There are no human API selectors, scripts, shell commands or model calls.
- This governs Camofox, not CDP/Browserless or the phone's operating system.
- Ordinary signed-in bearer sessions receive the existing 120/minute account
  budget rather than the 30/minute guest budget. Identity lookups have a separate
  bounded 120/minute IP admission guard; shared-IP callers may reach that guard.
  Rate attribution does not stamp identity or replace route authentication.
- A failed workspace refresh retains an account-bound, explicitly labeled last
  confirmed control state. Unknown state never enables controls. Handback still
  requires a new deliberate request and real server/remote verification.
- Busy read-lock conflicts use a typed marker and at most six authenticated GETs,
  with 5.75 seconds total backoff delays, plus request time. Cancellation or a
  sign-in change stops retries. No mutation, authentication failure, rate-limit
  response or remote-service failure is retried by this mechanism.
- Successful new tabs bind the target before their first view; selection waits
  for tab discovery. Verified-empty handback does not fetch the obsolete view.

## Setup, verification and rollback
Keep `CAMOFOX_ACCESS_KEY` in Secrets, never plaintext environment variables. Its
value must match the existing Camofox service's Bearer access key. Do not disable
authentication to work around rejection. A configured URL/key is not proof that
the service accepts it. An unavailable service shows an honest error while
preserving durable human control.
The existing browser runs in Railway's `production` environment; an API token
bound to another environment can expose its service name without its deployment.
Match the configured public domain before touching a service. The owner can copy
the existing service key directly into Replit's secure Secrets form; never paste
it into chat or rotate the running server's key as a troubleshooting shortcut.
Both raw PNG and JSON screenshot responses are supported. Raw image consumption
is bounded to 6 MB; screenshot base64 is bounded to 8 MB. Raster decoding rejects
corruption, document formats and images exceeding 16 million pixels.

Apply only `migrations/mobile-browser-workspace.sql` to development. Production
publication must separately apply/verify the declared ORM table and its tenant
foreign key through Replit's managed Publish schema-diff step, not custom
production DDL or startup migrations. Publication has not occurred. A read-only
production schema check confirmed the control table is absent; include its
additive table/FK in publication. Browser Workbench also requires the declared
`browser_workbench_libraries` table/FK, added only in development by
`migrations/browser-workbench-library.sql`. No file-storage schema change or
existing-library backfill is required.

The bounded public-site smoke uses a synthetic tenant and cleans up only its own
session and database row on successful cleanup:
`npx tsx scripts/smoke-mobile-browser-workspace.ts`.
It must pass before claiming live remote controls were verified.
The smoke types synthetic text into Selenium's public fixture without submitting
the form. It tests the driver/coordinator, not browser-workspace HTTP middleware
or phone UI interaction. If remote cleanup fails, it retains its synthetic tenant
for recovery, reports failure and always shuts down its database pool.
Focused coordinator tests: `npx tsx --test tests/lib/browser-workspace.test.ts`.
Screenshot contract tests: `npx tsx --test tests/lib/camofox-screenshot.test.ts`.

Rollback removes the UI route and Camofox coordinator guard together before
dropping the additive table. Do not drop a live control table under a running guard.

## Development evidence, 2026-10-04
Twelve focused coordinator/request-identity tests and TypeScript checks passed.
The signed-in 390×844 browser check confirmed no horizontal overflow, 44–48px
controls, real takeover and preservation across reload. Its handback attempt was
rate-limited and did not restore agent access. Error fallback now preserves the
last verified state or explicitly shows unknown status, rather than assuming
agent mode. Independent review findings on queued account transitions, stale
control selections and closed-last-tab handback were fixed with targeted checks.
After the owner confirmed the existing production service key in Secrets,
authenticated API access passed. The live smoke exposed binary PNG versus JSON
incompatibility; the driver now accepts bounded binary images and validates actual
raster decoding, not just the file signature. Twenty-two focused tests passed,
including RED→GREEN binary PNG and truncated-image regressions. Final TypeScript
and production build passed. Live isolated open/snapshot/screenshot, public-form
click/type with typed-text presence verification, scroll acknowledgement, human
takeover blocking agent access, handback and fresh agent read passed. Its remote
session and synthetic tenant were cleaned up. These are driver/coordinator checks;
visible scroll displacement and a new signed-in phone HTTP/UI journey were not
verified by that smoke. No running Railway key was changed and no publication occurred.

### Earlier phone retest and publication blocker
The subsequent signed-in 390×844 test confirmed the real workspace HTTP 200
response uses account-limit 120. An intercepted GET-only refresh 429 retained
the labeled last-confirmed Human panel and Return control button. No disabled
view request occurred when the tab list was empty.

Real handback returned 502 and correctly preserved Human mode. The one replacement
tab open claimed revision 4 and produced a target; a direct driver read saw the
tab while a real HTTP 200 workspace refresh for the same persona/suffix returned
an empty list. Later direct reads were empty too. This is unresolved browser
session/tab-discovery evidence, not proof of a credential outage or of working
handback. Do not bypass verification, relax authentication, assume a replica/TTL
root cause, or advertise the phone journey as passed.

Thirty-one focused tests pass; TypeScript, production build and scoped review
pass. Bounded public development load checks had no server failures; five real
authenticated reads returned 200/account-limit 120, with canonical session
lookup samples of 1–8 ms (not a tail-latency benchmark). The retained synthetic
remote session was confirmed closed before its exact development tenant and
auth sessions were deleted. No Railway configuration or production app database was
changed. Republication remains on hold.

### Read-only Railway findings
The production deployment was located by matching its configured public domain,
not just its service name. Its deployed manifest specifies one replica in
`us-west2`, sleeping disabled, a `/health` check with a 120-second timeout, and
ON_FAILURE restart policy with ten retries. Reviewed recent logs contained a
`session expired` event at 2026-10-04 23:19 UTC (18:19 America/Chicago), with
structured attributes matching the synthetic phone fixture. No crash/OOM event
was identified in that bounded log window; this is not proof of historical absence.

The exact deployed public source defaults to a ten-minute session idle timeout
and five-minute tab inactivity timeout. Live environment-variable overrides were
not inspected, so those defaults are not asserted as the effective settings.
Session expiry is confirmed, but the earlier HTTP/driver listing mismatch and
successful phone handback remain unresolved. No Railway settings, restarts or
publication were performed during this inspection.

### Recovery closure, 2026-10-04 (America/Chicago)
The latest signed-in 390×844 native journey passed normal login, real HTTP 200
tab discovery/view, screenshot rendering, type/scroll acknowledgments and active
handback (HTTP 200 Agent), followed by Human retake. Exact typed-value visibility
and scroll displacement were not independently measured in that phone pass; the
prior isolated driver smoke verified typed-text presence.

A focused tail check then confirmed the new bound tab through workspace/view
HTTP 200, closed only the synthetic remote session, and refreshed to a real 200
empty list with Human mode preserved and the expired-tab explanation visible.
Explicit Return returned HTTP 200 Agent with target null. No obsolete view GET
followed during the observed 5.75-second window. An earlier apparently stalled
open was subsequently confirmed complete by its durable outcome and matching
remote tab; it was not repeated. A busy lock rejected the synthetic-close helper
before remote action; one permitted wait/retry completed it.

Forty-three focused tests, TypeScript, production build and independent scoped
reviews passed. Twelve bounded public development GETs at concurrency three
returned 200 with no server failures (p50 24 ms, p95 102 ms); this is not a
production or sustained-load benchmark. The earlier listing mismatch was not
reproduced by the fresh scoped API/driver comparison; its precise historical
cause is not claimed. No service timeout, access key, authentication policy,
Railway setting, production data or ended-job lifecycle was changed. Development
acceptance is complete; publication and its production schema step remain separate.
The real agent wrapper rejected a post-handback effect until a fresh snapshot.
Remote cleanup was confirmed before deleting the exact synthetic tenant and auth
sessions; the temporary fixture script and credentials file were removed.