# Production Safety Profile

VisionClaw is an **autonomous** platform: it can write code, move money, send
communications, and modify its own source. Every one of those high-blast-radius
capabilities is **disabled by default** and must be turned on deliberately.

This page is the matrix of what to leave off — and what each flag actually
grants — before you point a real deployment at real users and real money.

> **Default posture is safe.** A fresh `.env` from `.env.example` boots with
> every autonomous lever in its conservative position. You opt *into* power,
> never out of danger.

---

## Safety matrix

| Capability | Flag (in `.env`) | Default | What turning it ON grants | Recommended for first prod deploy |
|---|---|---|---|---|
| **Self-repair auto-fix** | `REPAIR_AUTOFIX_ENABLED` | `0` (off) | The CI self-healer may apply generated fixes automatically. With it off, repairs are proposed and queued for human review. | Leave **off** until you trust the loop. |
| **Source self-write** | `GITHUB_TOKEN` | *(unset)* | The running platform can push to its own source repository. With it unset, all git-write paths no-op cleanly. | Leave **unset**. |
| **Strict tenant context** | `STRICT_TENANT_CONTEXT` | `false` (permissive) | Any request that can't resolve a tenant **throws** instead of falling back to the admin tenant. | Turn **on** for multi-tenant prod (fail-closed is safer). |
| **WhatsApp / Baileys bridge** | `WHATSAPP_ENABLED` | `0` (off) | Connects an unofficial WhatsApp transport. Carries a Terms-of-Service risk — read the notes in `.env.example` first. | Leave **off** unless you accept the ToS risk. |
| **Metered provider fallback** | provider API keys | *(your choice)* | Each key you add lets the router spend real money with that provider. | Add only the providers you intend to pay for. |

> Flag names and defaults are read live from [`.env.example`](../.env.example),
> which is the canonical list. If a flag here disagrees with `.env.example`,
> trust `.env.example` and please open an issue.

## The two failure directions

The platform deliberately fails in **opposite** directions depending on what's
at stake:

- **Safety controls fail CLOSED.** The destructive-tool policy, tenant scoping
  in strict mode, and the danger-command rails refuse to act when uncertain.
- **Quality/availability controls fail OPEN (loudly logged).** The intent gate
  and advisory guards degrade to "allow + log" rather than taking the whole
  request down, so a telemetry hiccup never becomes an outage.

This is intentional: a wrong *refusal* is recoverable; a wrong *destructive
action* may not be.

## Human-in-the-loop (HITL)

Even with autonomy enabled, mutating actions that move money, delete data, or
send mass communications route through an owner approval step. Auto-ship for any
new product/service SKU is **off by default** and only graduates after a run of
clean manual ships (see [`docs/EVIDENCE.md`](EVIDENCE.md) → Known Limitations).

## Pre-deploy checklist

- [ ] `SESSION_SECRET` set to a strong random value (not the example).
- [ ] `POSTGRES_PASSWORD` set to a strong value; database not exposed publicly.
- [ ] `REPAIR_AUTOFIX_ENABLED=0` unless you have reviewed the self-heal loop.
- [ ] `GITHUB_TOKEN` unset unless source self-write is intended.
- [ ] `STRICT_TENANT_CONTEXT=true` if serving more than one tenant.
- [ ] Only the provider keys you intend to pay for are present.
- [ ] You have read [`docs/EVIDENCE.md`](EVIDENCE.md) → **Known Limitations**
      (single-replica mutex caveat, etc.).
