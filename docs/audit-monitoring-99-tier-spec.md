# Audit Monitoring — $99/mo Tier Spec (R125+12)

**Status:** Waitlist live on `/audit` page (R125+12). Infrastructure deferred to Q3 — we don't build until we have ≥5 waitlist sign-ups OR ≥3 paid audit customers asking for it. Whichever comes first.

**Purpose:** Close monetization-ladder rung 3 (per `docs/idea-browser-wedge-concept.md`). Convert one-shot $497–$1997 audits into recurring $99/mo revenue. Target: 30% of audit buyers convert to monitoring → $30 ARPU/mo blended.

---

## The offer

**For:** Customers who bought a $497 or $1,997 audit and want to keep the score current.

**Promise:** "We re-audit your stack every 90 days, alert you when agents go dormant, and notify you when new tools/personas appear without a safety review."

**Price:** $99/mo (single-seat, single-stack), billed monthly, cancel anytime.

**Not for:** First-time buyers (must have completed a $497+ audit first — keeps the funnel ordered).

---

## What the customer actually gets

1. **Quarterly re-audit** — Same 8-dimension scoring rubric, delivered as a delta-report ("score moved from 62 → 71, here's why").
2. **Zombie alerts** — Email/Slack ping when a previously-active tool's invocation count drops to zero for 14+ consecutive days.
3. **New-tool drift notifications** — When a new tool, persona, or agent is registered without an AHB `safety_profile`, customer gets a heads-up.
4. **Score trendline dashboard** — Composite score + 8 dimension scores plotted over time. Single chart, hostable as a static link in their own internal docs.
5. **Quarterly 30-min readout (DFY tier add-on, +$199/mo)** — Bob (or future Hermes) on a call walks through the delta. Optional upsell.

---

## What the customer does NOT get

- No real-time alerts (those are observability vendor territory)
- No prompt monitoring (Galileo/Arize/Humanloop do that)
- No incident response (we're a periodic-audit subscription, not a SOC)
- No remediation hours (that's $1,997 DFY; this is monitoring only)

Clear scope = clear margin.

---

## How it works (technical sketch — deferred build)

```
Customer onboarding (one-time, post-audit)
  → Customer creates a read-only DB user OR uploads a sanitized schema dump
  → We store connection string in our secrets vault, tagged to their tenant
  → First baseline audit recorded as the "anchor" score

Quarterly tick (cron, every 90 days per customer)
  → Run scripts/run-self-audit.ts against their tenant
  → Diff against last audit
  → Generate delta-report PDF via existing pipeline (R125+12 viral-loop assets reused)
  → Email PDF + "Score moved from X → Y" subject line
  → Update score trendline

Continuous (weekly cron)
  → Query their tool_call_log: tools with 0 invocations in last 14d → zombie alert
  → Query their personas table: any new persona without safety_profile? → drift alert
  → Query their tools table: any new tool without TOOL_POLICIES entry if destructive? → drift alert

Cancellation
  → Customer cancels in Stripe → we revoke our DB user → archive their data 90 days then purge
```

**Build cost estimate:** ~3 days when triggered.
- 0.5 day: Stripe product + recurring price + webhook handler
- 1 day: cron + per-tenant audit runner (mostly wraps existing self-audit script)
- 0.5 day: delta-report PDF (extends existing R125+12 PDF generator)
- 0.5 day: dashboard view (one shadcn chart, no fancy)
- 0.5 day: customer-facing onboarding page (DB credential form + connection test)

---

## Risks specific to this tier

| Risk | Severity | Mitigation |
|---|---|---|
| Customer refuses to share read-only DB creds for 90 days continuously | HIGH | Offer "self-run mode": customer runs our open-sourced script themselves, uploads JSON result. Stays in their infra. |
| Multi-tenant secrets vault becomes a juicy target | HIGH | Encrypt at rest, rotate every 30d, scope IAM strictly, alert on any unauthorized access. Standard SOC2 stuff. |
| Customer's schema changes break our audit script | MED | Tag every dimension with a version. Failing dimensions return null + flag in report, not crash. |
| 90 days is too slow → they cancel before second audit | MED | First quarterly audit happens 30 days after subscribe (not 90), so they see value early. Bills monthly. |
| Margin compression as we add SOC2 / security hygiene | LOW | $99 × 100 customers = $9.9K MRR easily absorbs SOC2 spend. Not a launch concern. |

---

## Pricing experiments to run (after first 10 sign-ups)

- **$99/mo vs. $149/mo single-tier:** A/B on the waitlist landing.
- **Annual prepay discount:** $1,068/yr ($89/mo equivalent) — measure if it kills cash flow or accelerates it.
- **Volume tier for agencies:** $399/mo for 5 stacks under one dashboard. Latent demand from consultancies who run audits on client stacks.

---

## Success metrics (gating future build)

**Build the infra when ANY ONE of:**
- ≥5 unprompted waitlist signups from the `/audit` page
- ≥3 paid audit customers explicitly ask for "ongoing monitoring"
- Bob personally has bandwidth to manually do quarterly re-audits for the first 3 customers (manual proof-of-concept before automation)

**Kill this tier if:**
- 90 days after waitlist launches with <2 signups AND no paid customer asks for it
- Conversion from $497 → $99/mo lands below 10% in the first 5 conversions

---

## Status board

| Item | State |
|---|---|
| Tier card on `/audit` | ✅ Live (R125+12) |
| "Coming Q3" badge | ✅ Live |
| Waitlist mailto link | ✅ Live (huskyauto@gmail.com) |
| Stripe recurring price | ❌ Build when triggered |
| Cron + per-tenant audit runner | ❌ Build when triggered |
| Delta-report PDF | ❌ Build when triggered (reuses R125+12 generator) |
| Customer onboarding page | ❌ Build when triggered |
| SOC2 hygiene checklist | ❌ Build when triggered |

---

_(model: anthropic/claude-sonnet-4.5)_
