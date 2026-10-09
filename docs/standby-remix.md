# Private dormant remix: preparation and activation

This project guards **every configured shell workflow and the automatic development run**: only the original Replit project runs those commands. In a remix, they exit without starting an app, launching agents, or spending audit tokens. A separate guard prevents automatic commits in a remix and refuses pushes from a remix to the original private GitHub repository. These guards do **not** cover direct manual commands or the production deployment command. They are a safety net, **not** a replacement for stopping workflows and keeping the remix unpublished.

## Create the snapshot

1. From the original project's cover page, choose **Remix this App**, give the copy a dated name, and select **Private**. Replit starts a remix automatically; the copied startup commands should say `[standby]` and exit. An expected “port not opened” preview error does **not** mean the original app failed.
2. If you want a usable snapshot of customer data, choose **Copy data from original App** when offered. This is a point-in-time copy containing sensitive data, not an ongoing backup. If you omit it, the new database is not a recovery copy. The remix is a separate project; do not point it at the production database.
3. In the new project, stop **Project**, **Start application**, **Tenant Isolation Audit Nightly**, and any other running workflows. Leave every scheduled or automated workflow off. **Do not publish** the remix or route any public domain, webhook, or customer traffic to it.
4. In the remix's environment settings, remove or set `ENABLE_SELF_PUSH=0` before adding a GitHub credential. Never use the original repository as `SELF_PUSH_REPO`; leave pushes off unless a separate private backup repository is explicitly chosen. The copied `.replit` file includes non-secret environment settings for the original domain, owner, GitHub repo, and repair-handoff endpoint: do not treat these as valid fork routing.

## Configure while dormant

Replit does **not** copy Secrets, integrations, or a published deployment into a remix. A copied database may hold credentials encrypted under the original `SESSION_SECRET`; only the exact original secret can decrypt them. Add it to the *remix's Replit Secrets*, using the owner's saved secure copy, **never** to a file, chat, or a non-secret environment variable. Add other required provider credentials through Secrets and reattach any available OAuth integrations in the remix. Keep the application and jobs stopped during this work.

“API-ready” in a dormant copy means required credential names and connections are present and the copied code/configuration is intact. It does **not** mean live calls, token refresh, Stripe orders, email delivery, or webhook handling have been tested. Avoid testing by sending messages, charging cards, or activating scheduled jobs. The original's URL, OAuth callbacks, Stripe webhooks, Google/Drive paths, and repair-handoff target must be independently reviewed before any disaster activation.

Without starting the app, verify:

- The remix is **Private**, has **no published deployment**, and no workflows are running.
- The database snapshot exists if selected, with expected table/row presence checked read-only. Source files and any externally stored assets needed for recovery are present; local artifacts and third-party storage are **not** assumed to have been copied.
- The required secret **names** exist (never print values), and integrations show attached status in the remix. Confirm the saved original `SESSION_SECRET` is available if copying encrypted rows.
- `npx tsx --test tests/scripts/standby-fork-guard.test.ts` passes. In the new workspace, the automatic start command should print `[standby]` rather than open a port.

## Only if an actual recovery is authorized

Stop the original app and its schedulers first. Review data freshness, ownership and tenant boundaries, storage assets, production environment differences, credentials and OAuth redirects, outbound email, Stripe/webhook idempotency, Git push target, and DNS before allowing a single replacement to run. Re-enable the remix deliberately; changing only one startup command is not enough to make a production recovery safe. Never run original and replacement with the same credentials and background jobs at the same time.