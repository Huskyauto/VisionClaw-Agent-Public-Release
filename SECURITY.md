# Security Policy

## Supported Versions

VisionClaw Agent is solo-maintained. Security fixes are applied to the `main`
branch of both repositories:

- Private development: `Huskyauto/VisionClaw-Agent`
- Public mirror: `Huskyauto/VisionClaw-Agent-Public-Release`

Older tagged releases are not separately patched — please track `main`.

## Compliance & ToS risks (you must read before forking commercially)

### WhatsApp / Baileys — unsanctioned WhatsApp Web automation

VisionClaw's WhatsApp integration uses `@whiskeysockets/baileys`, a
reverse-engineered WhatsApp Web client. Meta's Terms of Service explicitly
prohibit unofficial clients, and accounts can be banned without notice.

If you are deploying VisionClaw to serve agencies, operators, or paying
customers, **do not enable the Baileys-backed WhatsApp channel on a number
that you (or your customer) cannot afford to lose**. Meta has been
increasing enforcement; ban waves can hit any time.

Safer alternatives:
- Use a throwaway dedicated number for testing only.
- For commercial use, switch to the official WhatsApp Business Cloud API
  (Meta-sanctioned, paid per-conversation pricing).
- Disable the integration entirely by leaving `WHATSAPP_ENABLED=0` /
  unset in your environment.

The platform itself does not enable Baileys by default; the dependency is
present so the channel works when explicitly turned on.

## Self-modification capability

VisionClaw's runtime can `git push` to its own source repository when a
GitHub token is set in the environment. The actual env vars consumed by
`server/index.ts` are `GITHUB_PERSONAL_ACCESS_TOKEN_2` (preferred) with
`GITHUB_TOKEN` as fallback, plus `GITHUB_REPO` for the private push and
`PUBLIC_GITHUB_REPO` for the public mirror push. This is by design — the
agents perform their own maintenance commits (replit.md updates,
comprehensive features doc regeneration, public mirror snapshots). It is
also an attack surface that forkers should understand:

- The runtime has write access to its own source code.
- An agent with shell access that is successfully prompt-injected can,
  in principle, modify source files and force-push.
- The push scripts (`/tmp/push-gh.sh`, `/tmp/push-public.sh`) scan for
  plaintext secret strings before pushing, but the scanner only catches
  credentials — it does NOT validate that arbitrary source-code edits
  are intended.

**For self-hosters who do not want this capability:** leave
`GITHUB_PERSONAL_ACCESS_TOKEN_2`, `GITHUB_TOKEN`, `GITHUB_REPO`, and
`PUBLIC_GITHUB_REPO` all unset. The push scripts then no-op cleanly:

```bash
if [ -z "$GITHUB_TOKEN_VAL" ]; then echo "No GITHUB_TOKEN"; exit 0; fi
```

Recommended deployment posture for new forkers: deploy without
`GITHUB_TOKEN` first; only add it if you specifically want automated
source-code maintenance commits.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security-sensitive bugs.**

Email: **huskyauto@gmail.com** (Bob Washburn / [Your Company])
Subject prefix: `[SECURITY]`

Please include:
- A clear description of the issue and the affected component
  (e.g., a tool, a route, a tenant-isolation boundary).
- Steps to reproduce.
- Whether the issue is already public anywhere.
- Your preferred attribution if a fix is shipped.

## What to expect

- Acknowledgement within 72 hours.
- A first assessment within 7 days describing severity and intended fix path.
- A coordinated disclosure timeline if the issue is non-trivial — typically
  30 days from the first acknowledgement to a public fix and CHANGELOG entry.

## Out of scope

- Findings that require physical access to a self-hosted deployment.
- Self-XSS without an authentication or tenant boundary impact.
- Missing security headers on static marketing pages with no authenticated content.
- Rate-limit bypasses on endpoints that are already covered by upstream provider
  rate limits and have no per-tenant cost/data impact.

## Hardening notes for self-hosters

- Keep `SESSION_SECRET` long and unique per deployment.
- Configure `OWNER_ALERT_EMAIL` so high-severity runtime events reach you.
- Treat the `agent_security_scan` and Trust Engine outputs as advisory — review
  flagged items regularly via `/code-health`.
- Lock down outbound network at the host level if you don't intend to use the
  Glasses Gateway, MCP, or external LLM providers.
- Rotate `GOOGLE_*`, `STRIPE_*`, and any LLM provider keys at least quarterly.
- Run the public mirror, not the private development repo, in production unless
  you intend to actively contribute upstream.

Thank you for helping keep VisionClaw secure.
