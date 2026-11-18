# Owner-only application access — prepared, not published

## Decision

On November 16, 2026, Bob approved **Prepare owner-only access** instead of
continuing manual production RLS provisioning. This change is merged into the
workspace. Shared configuration now explicitly sets `APP_ACCESS_MODE=owner-only`
for the next publish. Production database permissions and RLS flags were not
changed, and the application has not been republished. Customer records were
not deleted or disabled.

The default is private, including unset or malformed `APP_ACCESS_MODE`.
Only the exact operator setting `APP_ACCESS_MODE=multi-tenant` opts out.
Never reopen customer access or publish without Bob's approval.

## Authority and retained access

- Canonical owner is tenant **1**, not an arbitrary `isAdmin` tenant.
- Existing owner PIN sessions remain usable. Bound Replit owner identity
  must match its existing subject; matching email cannot rebind it.
- If the owner has never bound a Replit identity, the existing configured
  trusted owner identity is required and binding uses an atomic unbound-row
  condition. No customer tenant is created by private-mode sign-in.
- Non-owner sessions, platform API keys, MCP keys and Felix OAuth access
  tokens cannot authorize app use. Existing key scopes still apply.
- Registration, customer email/password login, AgentID sign-in, anonymous
  chat and legacy shared-key MCP are unavailable in private mode.
- The private ingress gate runs before application handlers, uploads and
  connector surfaces. `/v1/glasses` is protected as well as `/api`.
- New non-owner chat and guarded-tool execution also stop at their execution
  boundaries, including traffic originating in service callbacks.

## Deliberate service exceptions

Informational/static pages, owner sign-in/bootstrap and explicit independently
authenticated service endpoints remain available. The exact allowlist lives in
`server/lib/owner-only-access.ts`, rather than an entire public-API prefix.

Existing signature/state/credential checks remain mandatory for payment
settlement, AgentMail, Slack, Twilio SMS/WhatsApp, OAuth callbacks, maintenance
callbacks, signed workspace verification, and the scoped MCP/OAuth transport.
Being on this list does **not** authorize an operation by itself. Owner
administration endpoints with their own PIN guard retain that original guard;
the private gate does not turn arbitrary PIN headers into global authority.

## Media and logout

Owner PIN sign-in issues an HttpOnly cookie only for GET/HEAD navigation to
media paths. It cannot authenticate API reads or mutations. Existing media
ownership checks still run. Signed uploads/video-job links require canonical
owner tenant 1, a valid signature and normal expiry.

The application declares SameSite=Strict. The development preview proxy was
observed returning SameSite=None with Secure instead; that is not proof of
published/custom-domain cookie attributes. API authorization never relies on
this media cookie, so the policy does not depend on cross-site cookie behavior.

Logout is registered after CSRF middleware, revokes the presented session and
clears the media cookie. The serving app rejects both credentials afterward.
Old unsigned instant-play links now require owner browser authentication.

## Verification observed in isolated staging

- Root `tsc --noEmit --incremental false` passed with a 3 GiB Node heap limit.
  The initial 2 GiB-limited attempt ran out of heap; no RAM upgrade was needed.
- Twelve targeted private-access tests passed: default/opt-out policy, path
  ambiguity, credential checks, identity mapping, closed registration, forged
  request authority, read-media cookie scope, logout and middleware placement.
- Eleven Felix connector policy/OAuth/SDK/dispatch checks passed.
- The existing targeted auth/MCP/RLS-receipt run passed 73 checks with one
  explicitly opt-in database challenge test skipped. The two later media/logout
  tests are included in the twelve private-access checks above; counts overlap.
- `RUN_OWNER_ONLY_HTTP=1 npx tsx --test tests/integration/owner-only-http.test.ts`
  passed against the development URL: existing PIN login, owner identity,
  media navigation, denied cookie-only API access, CSRF rejection, logout and
  post-logout denial. Its temporary owner session was revoked.
- Anonymous/customer/registration/chat HTTP requests were denied. Staging's
  separate payment block returned 404 before any payment activity.
- Thirty-two anonymous ingress requests at concurrency eight all returned 403;
  p50 20 ms, p95 50 ms, zero unexpected results. This bounded development probe
  is not production capacity evidence. The legacy Layer-1 script was not run:
  it defaults to production and sends an email outside this preparation scope.
- The mobile signup page visibly renders the private-workspace notice and
  owner sign-in button. `git diff --check` passed.

## Limits and reversal

Post-merge publication check: all twelve private-access unit checks and the
release-check production build passed. A development-only HTTP check verified
the existing owner PIN, owner identity/access, CSRF-protected logout and session
revocation; anonymous, customer, registration and public-chat requests returned
403. The temporary test session was revoked. The supported publishing schema
comparison reported no pending statements or destructive changes. These are
development/build checks, not post-publication verification.

This restricts application access. It does not delete records, cancel every
historical queued job, revoke external Drive permissions, refund transactions,
or prove database-wide isolation. Existing owner-signed artifact capabilities
remain transferable until their usual expiry.

The original production RLS hold remains in
[production RLS readiness](production-rls-readiness.md). Its replica evidence is
not writer/application-connection proof. If multi-tenant access is reconsidered,
resume that readiness work under new explicit approval rather than treating
private mode as an RLS fix. Existing tenant filters and safety gates remain.
