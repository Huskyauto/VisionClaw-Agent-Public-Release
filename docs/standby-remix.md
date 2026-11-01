# Private dormant remix: preparation and activation

This project guards **every configured shell workflow and the automatic development run**: only the original Replit project runs those commands. In a remix, they exit without starting an app, launching agents, or spending audit tokens. A separate guard prevents automatic commits in a remix and refuses pushes from a remix to the original private GitHub repository. These guards do **not** cover direct manual commands or the production deployment command. They are a safety net, **not** a replacement for stopping workflows and keeping the remix unpublished.

## Create the snapshot

1. From the original project's cover page, choose **Remix this App**, give the copy a dated name, and select **Private**. Replit starts a remix automatically; the copied startup commands should say `[standby]` and exit. An expected “port not opened” preview error does **not** mean the original app failed.
2. If you want a usable snapshot of customer data, choose **Copy data from original App** when offered. This is a point-in-time copy containing sensitive data, not an ongoing backup. If you omit it, the new database is not a recovery copy. The remix is a separate project; do not point it at the production database.
3. In the new project, stop **Project**, **Start application**, **Tenant Isolation Audit Nightly**, and any other running workflows. Leave every scheduled or automated workflow off. **Do not publish** the remix or route any public domain, webhook, or customer traffic to it.
4. In the remix's environment settings, remove or set `ENABLE_SELF_PUSH=0` before adding a GitHub credential. Never use the original repository as `SELF_PUSH_REPO`; leave pushes off unless a separate private backup repository is explicitly chosen. The copied `.replit` file includes non-secret environment settings for the original domain, owner, GitHub repo, and repair-handoff endpoint: do not treat these as valid fork routing.

## Configure while dormant

### Current preparation record — October 28, 2026

- `docs/standby-secret-inventory.json` records the 56 configured secret **names** observed in the original project. It contains no secret values and is not a credential backup. Include the newly replaced Stripe live secret when configuring the remix.
- The original remains running. No remix has been created, started, published, connected to production data, or populated with credentials by this preparation.
- Three existing behavioral checks passed: a foreign project cannot execute the guarded startup command, push to the original repository, or run the automatic commit/push path. The fourth configuration check is stale: it pins old audit slice settings rather than just the startup guard. It failed on the current audit arguments; do not report the entire test suite as passing.
- Current configured shell commands were separately inspected for the primary-only wrapper. The production command remains unguarded: **never publish the standby**.

Replit does **not** copy Secrets, integrations, or a published deployment into a remix. A copied database may hold credentials encrypted under the original `SESSION_SECRET`; only the exact original secret can decrypt them. Add it to the *remix's Replit Secrets*, using the owner's saved secure copy, **never** to a file, chat, or a non-secret environment variable. Add other required provider credentials through Secrets and reattach any available OAuth integrations in the remix. Keep the application and jobs stopped during this work.

Use the inventory to reconcile names inside the new project. Secret values cannot be extracted through the supported secret-management tools; they must be supplied from the owner's secure records or the provider's credential controls. Do not generate a new `SESSION_SECRET` when restoring encrypted database records. Preserve original signing keys for existing signed records, but independently review whether a replacement should retain each authority before activation. Replit-managed AI credentials and OAuth connections may require reattachment; a copied environment variable is not a working connection.

### Data, files, and configuration checklist

- **Database:** select the platform's database-copy option when available. Confirm which source database it copies; a workspace snapshot is not proof of current production data. Verify an independent destination database and expected data read-only. Never use the main application's database connection as the backup's database.
- **Local files:** inspect `data/` and `uploads/` in the remix, including private runtime state and generated customer assets. Directory existence alone is not completeness proof. Do not export their contents into public documents or a public repository.
- **App Storage:** the app uses Replit App Storage. Inventory the source bucket and required objects, then arrange a separate private recovery copy and permissions. Do not assume a remix copied bucket contents or grants access.
- **External services:** review Railway services, mail providers, Google and Microsoft connections, Stripe, media providers, and AgentID. External service state and provider-hosted assets are not included in a source-code remix.
- **Routing and environment:** inspect development and production overrides separately. Keep outbound jobs dormant; copied enabled flags, original callbacks, public domain, webhook URLs, repair endpoints, and GitHub targets are not replacement-ready settings.
- **Recovery freshness:** a dated fork is a point-in-time snapshot, not continuous replication. Record the source database/file snapshot time in the private backup workspace after verification.
- **Secure credential backup:** retain credentials in an owner-controlled password manager or another approved secure credential store. Never create a plaintext secrets archive, `.env` export, Drive document, or committed credential file.

“API-ready” in a dormant copy means required credential names and connections are present and the copied code/configuration is intact. It does **not** mean live calls, token refresh, Stripe orders, email delivery, or webhook handling have been tested. Avoid testing by sending messages, charging cards, or activating scheduled jobs. The original's URL, OAuth callbacks, Stripe webhooks, Google/Drive paths, and repair-handoff target must be independently reviewed before any disaster activation.

Without starting the app, verify:

- The remix is **Private**, has **no published deployment**, and no workflows are running.
- The database snapshot exists if selected, with expected table/row presence checked read-only. Source files and any externally stored assets needed for recovery are present; local artifacts and third-party storage are **not** assumed to have been copied.
- The required secret **names** exist (never print values), and integrations show attached status in the remix. Confirm the saved original `SESSION_SECRET` is available if copying encrypted rows.
- `npx tsx --test tests/scripts/standby-fork-guard.test.ts` passes. In the new workspace, the automatic start command should print `[standby]` rather than open a port.

## Only if an actual recovery is authorized

Stop the original app and its schedulers first. Review data freshness, ownership and tenant boundaries, storage assets, production environment differences, credentials and OAuth redirects, outbound email, Stripe/webhook idempotency, Git push target, and DNS before allowing a single replacement to run. Re-enable the remix deliberately; changing only one startup command is not enough to make a production recovery safe. Never run original and replacement with the same credentials and background jobs at the same time.