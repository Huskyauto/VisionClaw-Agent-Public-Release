# One-Pager: YouTube Portfolio Ops

**Date:** 2026-05-25
**Source idea:** Isenberg IOTD 2026-04-07
**Tier / composite:** S / 25
**Recommended slot:** Pick #1 candidate for Q3 wedge SaaS shipment alongside ongoing VisionClaw factory + [Your Product] content cadence

---

## Problem

YouTube creators with 3+ channels (a side-channel, a brand channel, a niche experiment) hit a wall around year two. The work isn't *creating* — it's running the **portfolio**: which channel ate which idea, which uploads need re-thumbnails based on 7-day CTR, which Short should be cut from which long-form, which channel's analytics dashboard needs a weekly review, which sponsor pitch belongs in which voice. Today this is done by a $4–8K/mo content manager human, or by the creator burning their Sunday on a spreadsheet, or (most commonly) badly and inconsistently. Multi-channel YouTubers describe it as "running a tiny media holding company without an ops layer."

## Buyer & price hypothesis

- **Primary buyer:** Multi-channel YouTube operators with $20K+/mo aggregate revenue (3+ channels, ≥10K subs each). ICP today: wellness creators, finance edutainment, tech product reviewers, niche faceless channels.
- **Secondary buyer:** Solo creator-LLCs hiring their first content manager and shopping for the tool the eventual hire will use.
- **Pricing:** **$199 / $499 / $999 per month** (1 channel / up to 5 channels / unlimited + agent orchestration), with a free 14-day import-and-show-me trial. Annual discount 2 months free. ARR target Y1: 200 paid logos × avg $400 = **$960K**.

## MVP scope (≤6 weeks of solo build using current VisionClaw stack)

1. **Channel intake + read-only YouTube Data API auth** (1 week). Per-channel: last 90 days uploads, CTRs, retention curves, comments, revenue.
2. **Portfolio dashboard** (1 week). Single screen across all channels: outliers (top + bottom 10% CTR), comment-storm alerts, retention cliffs, revenue trendlines. Powered by ensemble jury for "what changed this week" narrative.
3. **Repurposing queue** (1 week). Long-form → Shorts candidates auto-detected via Felix vision/audio analysis of high-retention moments. One-click "send to BWB-shorts pipeline" or any equivalent script template.
4. **Sponsor-fit scorer + cross-channel router** (1 week). Sponsor brief in → which channel + which upload slot → suggested integration script in that channel's voice. Powered by persona voice profiles (one per channel).
5. **Weekly digest delivery** (3 days). Mon 6am email + audio briefing in *creator's* voice (Felix audio + voice clone): "Channel A had 3 outliers, Channel B's retention dropped on health content, here's what I'd ship this week."
6. **Onboarding wizard + Stripe billing** (1 week).

Build cost estimate: **S** (small) on VisionClaw's existing stack because Felix pipeline, persona voice profiles, ensemble jury, and Drive delivery are already shipped.

## Revenue hypothesis

| Stage | Logos | ARR | Notes |
|---|---|---|---|
| Month 1 (launch) | 5 | $24K | BWB audience + Bob's personal network (creator friends) |
| Month 3 | 25 | $120K | YouTube-themed Twitter + 2 partnered creator videos |
| Month 6 | 75 | $360K | SEO programmatic + 1 viral case study (BWB itself) |
| Month 12 | 200 | $960K | Founder-led content + outbound to top 1K multi-channel ops |

**Margin:** ~75% (LLM inference ~$15/mo per logo on $400 ARPU; Drive storage marginal).

## Kill criteria

- **Month 1:** <3 paying logos despite warm BWB launch. (Signal: nobody actually pays for portfolio ops, they just complain about it on Twitter.)
- **Month 3:** Churn >8%/mo before month 3. (Signal: the dashboard is a "look once" tool, not workflow.)
- **Month 6:** CAC payback >14 months. (Signal: SEO/content motion doesn't compound; we'd need a paid-ads motion we don't have.)
- **Any month:** YouTube revokes Data API access for our use case. (Mitigation: paid YouTube partner tier; cost re-models the unit economics.)

## Why VisionClaw wins this category vs. TubeBuddy / VidIQ / 1of10

| Competitor | Strength | Our unfair advantage |
|---|---|---|
| **TubeBuddy** | Single-channel SEO tools, 5M+ users | Built single-channel — multi-channel is a bolted-on second screen. We architect for it day one. |
| **VidIQ** | Analytics + AI keyword suggestions | Their "AI" is text-only. We have **Felix video analysis** (retention-curve-by-shot) + **voice-cloned digests**. Different category. |
| **1of10** | Outlier detection across channels | Best-in-class at outliers, weak at the actual ops layer (repurposing, sponsor routing, weekly briefing). We do the whole loop. |
| **Spotter / Jellysmack** | $$$ content portfolio acquirers | They buy your channel and run it. We give you the agency-in-a-box for $400/mo. Self-serve buyer ≠ M&A buyer. |

The category isn't crowded at the *portfolio operator* level — it's saturated at the *single-channel optimizer* level. Different ICP.

## How we ship it to market

1. **Founder-led launch via BWB itself (week 1).** Bob's own multi-channel ops (BWB main + Shorts + future spin-offs) is the in-product case study. "I built the tool I needed to run my own portfolio" → built-in-public Twitter thread + YouTube long-form on the BWB channel ("How I run 3 channels in 4 hours/week"). Cost: $0, leverages BWB stack we already own.
2. **Partnered creator drop (week 2–4).** Recruit 5 creators with 3+ channels who'd be obvious case-study fits. Free annual license in exchange for filmed onboarding + 30/60/90-day check-ins. Their audience = ICP. Cost: 5 × $4,800 in license value = $24K notional, $0 cash.
3. **SEO programmatic (month 2+).** Generated comparison pages: "TubeBuddy vs YouTube Portfolio Ops," "How to run 3 YouTube channels," "Best AI tool for multi-channel YouTubers." 200 pages from a template. Estimated $1K of compute + Bob's editorial review.
4. **Sponsor of one big creator-economy podcast (month 3).** Colin & Samir, Creator Science, Modern Wisdom (creator angle). $5–15K per drop, single-attribution coupon code.
5. **Conference pop-up (month 6).** VidSummit / Creator Economy Live booth. Demo the agent live: "Drop your 3 channels in, get your weekly briefing in 90 seconds." $15K.

Year-1 marketing budget target: **$50–80K** (the BWB-driven founder content is the multiplier — without it the budget is 3x).

## Strategic bonus

Beyond direct revenue, YouTube Portfolio Ops **dogfoods every BWB pipeline upgrade**. Every Felix vision improvement, every voice-clone refinement, every ensemble jury tweak that ships into BWB also ships into the product. Customer support sessions become product roadmap. The BWB channel itself becomes the product's biggest case study, and the product becomes BWB's R&D budget. This is the same flywheel HEY had with Basecamp — eat your own dogfood AND film it. Compounds the VisionClaw thesis ("the factory that ships its own products is the factory worth selling to others").

## Open questions (need answers before week 1 of build)

1. Does YouTube Data API quota economically support 200 logos at $400 ARPU? (Quick: estimate 100 API calls/channel/day × 5 channels × 200 logos = 100K/day; default quota 10K → need quota increase.)
2. Are we positioning this as "VisionClaw product" or as a standalone spin-out brand (e.g. "Pipeline" or "Channelroom")? Standalone has better creator trust; bundled keeps brand consolidation. **My vote: standalone brand, VisionClaw under the hood.**
3. Do we ship the Built-With-Bob walkthrough as the launch video? **My vote: yes, two videos — one short ("how I cut my YouTube ops time 80%"), one long-form build documentary on the BWB main channel.**
