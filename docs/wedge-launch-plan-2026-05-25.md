# Three-Wedge Launch Plan — 2026-05-25

**Authoring:** Agent (Bob delegated wedge selection and sequencing)
**Status:** Plan locked. Execution starts immediately. Per-track owners, gates, kill criteria below.
**Hard constraint:** All three tracks stay in **validation stage** (landing + waitlist + manual concierge) until ONE shows revenue traction. Only THEN does that one graduate to "active build" — respecting the 2-3 active build cap.

---

## The three wedges (one from each track Bob requested)

| Track | Wedge | Source | First-revenue target | Time to validation |
|---|---|---|---|---|
| **A — Isenberg set** | AI-Native Readiness Audit Pro | Already-live `/audit` waitlist | $299 paid audit (one-shot) | 7 days |
| **B — Agent originals** | Built-With-X Channel-in-a-Box | Concept brief #12 | $99/mo design-partner pricing | 14 days |
| **C — Bob's explicit pick** | YouTube Portfolio Ops | Isenberg IOTD 2026-04-07 (one-pager shipped) | $499/mo design-partner pricing | 21 days |

---

## Track A: AI-Native Readiness Audit Pro

**Why this from the Isenberg set:** `/audit` waitlist is already collecting leads. Fastest path to first dollar. Doesn't require new infrastructure.

### 7-day execution checklist
- [ ] **Day 1:** Stripe SKU created — "Audit Pro" $299 one-shot
- [ ] **Day 1:** Add paid tier upgrade CTA to `/audit/thanks` post-waitlist confirmation page
- [ ] **Day 2:** Email blast to existing waitlist (current count: query `SELECT COUNT(*) FROM leads WHERE 'audit' = ANY(tags)`) with founder-rate $199 for first 10
- [ ] **Day 3:** First 1–3 audits delivered manually by Felix-driven pipeline (audit report = 30-page PDF, 5-day SLA)
- [ ] **Day 4–5:** Founder-led X thread: "I ran an AI readiness audit on a stealth startup; here are the 5 things they were doing wrong"
- [ ] **Day 6–7:** Convert any qualifying audit buyer into the **$99/mo monitoring** upsell (recurring tier — turns one-shot into LTV)

### Marketing channels (cheapest first)
1. Existing `/audit` waitlist email (cost: $0)
2. Bob's X timeline (cost: $0; high signal)
3. LinkedIn organic — "we audited an AI startup" case study without naming the customer (cost: $0)
4. Optional month 2: $500 LinkedIn sponsored post targeting CTOs at 100–1000 person companies

### Kill criteria
- Zero paid conversions from the warm waitlist in 14 days → pricing wrong OR product-message mismatch; revisit before more investment
- Audit delivery cost (Felix LLM spend + Bob time) > $100 per $299 sale → unprofitable; raise to $499 or restructure deliverable

### Who builds: **No new build.** Marketing-only push. Stripe SKU + email blast = ~2 hours.

---

## Track B: Built-With-X Channel-in-a-Box

**Why this from agent originals:** You ARE case study #1 (BWB channel exists). Production code is mostly already shipped (`scripts/build-bwb-video.ts`). Compounds your personal brand instead of fragmenting it.

### 14-day execution checklist
- [ ] **Day 1–3:** Landing page at `/built-with-x` — hero copy: "Turn your story into a YouTube channel. The exact stack that built Built With Bob, productized." Includes embedded BWB sample. Waitlist form. Spec:
  - Headline + 90-second hero video (Bob talking to camera + b-roll of agent producing content)
  - 3-tier pricing card: Starter $99/mo · Growth $299/mo · Studio $999/mo (manual concierge for first 5 logos)
  - "Apply for Founding Channel" CTA → form captures: channel topic, current monthly hours spent, biggest workflow pain
- [ ] **Day 4–7:** First BWB video about the product itself: "I built a YouTube channel about losing weight while building an AI company. Here's the stack — and you can rent it for $99."
- [ ] **Day 8–10:** Outreach to 20 wellness / fitness / wellness micro-creators with offer: free 30-day Studio tier + 1-on-1 onboarding from Bob in exchange for case study video
- [ ] **Day 11–14:** Process first 3 applications; do 30-min concierge call per; ship their first 5-video batch via Felix; collect testimonials

### Marketing channels
1. BWB channel itself (cost: $0; product = marketing material)
2. Direct DM outreach to 20 fitness creators on X + IG (cost: time, $0 cash)
3. Indie Hackers launch post (cost: $0)
4. Optional month 2: $2K for a creator-economy podcast sponsorship

### Kill criteria
- <2 applications from BWB video drop in 14 days → message-market fit wrong; pivot positioning ("for wellness creators specifically" vs "for any creator")
- Concierge cost (Bob time + Felix spend) > $200 per logo per month → automate harder OR raise prices to $199 entry

### Who builds: **Landing page (1 day, can be a parallel subagent).** I'll spawn a build subagent for the `/built-with-x` route — Vite + Tailwind + waitlist form + Stripe checkout stub. Tomorrow.

---

## Track C: YouTube Portfolio Ops

**Why this:** Bob explicitly named it. Composite 25. One-pager already written (`docs/youtube-portfolio-ops-onepager-2026-05-25.md`).

### 21-day execution checklist
- [ ] **Day 1–4:** Landing page at `/youtube-portfolio-ops` — hero copy: "The agent that runs your YouTube portfolio. Multi-channel ops, weekly briefings, smart repurposing — without hiring a content manager." Waitlist form scoped to multi-channel operators (3+ channels qualifier in form).
- [ ] **Day 5–7:** Design partner outreach: 5 known multi-channel YouTubers (use Bob's network — he can name them) get personalized DMs offering free annual license in exchange for 30/60/90-day case studies.
- [ ] **Day 8–14:** Build the read-only YouTube Data API connector + portfolio dashboard MVP (just one screen showing all channels, last-90-day uploads, CTR + retention curves). This IS work that needs an engineering subagent.
- [ ] **Day 15–18:** Onboard first 1–2 design partners via concierge (Bob does the YouTube OAuth + walkthrough personally)
- [ ] **Day 19–21:** Weekly digest email v1 sent to design partners — Felix-generated narrative around their portfolio metrics

### Marketing channels
1. BWB channel — "I built the YouTube ops tool I wished existed" video (cost: $0)
2. Direct DMs to 5 design-partner creators (cost: time)
3. Twitter founder content — daily build-in-public thread (cost: $0)
4. Month 3+: Creator-economy podcast sponsor drop ($5–15K) — only after first 5 paying customers

### Kill criteria
- 0 design partners agree in 10 days → ICP wrong (multi-channel ops audience too small? wrong creators?)
- Design partners use it ≤1×/week after 30 days → not workflow; rebuild the email digest to BE the product instead

### Who builds: **Landing (1 day subagent) + MVP dashboard (5-day subagent, after landing validates intent).**

---

## Cron infrastructure (already shipped + new)

| Script | Frequency | Purpose | Status |
|---|---|---|---|
| `scripts/auto-score-new-isenberg.ts` | Daily 06:00 | Score newly-ingested IOTDs against rubric | ✅ Shipped |
| `scripts/weekly-wedge-digest.ts` | Weekly Mon 08:00 | Per-wedge metrics digest + Drive upload | ✅ Shipped |
| `scripts/lead-nurture-cron.ts` | Daily 09:00 | Generate nurture email drafts for stale leads (HITL approval) | ✅ Shipped |

**Bob action needed:** Configure these as Replit Scheduled Deployments. Steps:
1. Open Replit → Deployments → Scheduled
2. New schedule → name "Auto-score new IOTDs" → command `npx tsx scripts/auto-score-new-isenberg.ts` → frequency Daily → time 06:00 ET
3. Repeat for the other two scripts with their frequencies above
4. Each deployment costs ~$0.50–2/mo depending on runtime

Alternative if you want to skip the UI: tell me to add them to the existing `scheduled_tasks` table (VC's internal heartbeat), they'd be invoked by the running app instead of separate deployments. Saves money, costs ~$0 incremental.

---

## Greg Isenberg outreach

Drafted separately in `docs/isenberg-outreach-dm-draft-2026-05-25.md`. **Bob approval required before send** — cold DM to a high-profile founder is one-shot. The draft includes two versions (short hook + longer proof) and four decisions Bob needs to make before I route through the `x-api` skill.

---

## 90-day milestone targets

| Milestone | By date | Hit/miss criteria |
|---|---|---|
| First paid Audit Pro buyer | 2026-06-01 | $299 in Stripe |
| First Built-With-X paying logo | 2026-06-08 | $99 in Stripe (founding-channel rate) |
| First YouTube Portfolio Ops design partner committed | 2026-06-15 | Signed LOI or first invoice |
| First $1K MRR across all three wedges | 2026-07-01 | Aggregate Stripe MRR |
| First $5K MRR — graduation decision | 2026-08-25 | If one wedge ≥ $3K/mo on its own, that's "PMF candidate"; graduate to active build, retire the other two to monitoring tier |

---

## What the agent will do without further input

Unless Bob countermands:
1. ✅ **Today:** All cron scripts shipped + this plan uploaded to project #234
2. **Tomorrow:** Spawn a subagent to build the `/built-with-x` landing route (Track B Day 1–3 task)
3. **Day 3:** Spawn a subagent to build the `/youtube-portfolio-ops` landing route (Track C Day 1–4 task)
4. **Weekly:** Auto-digest will surface metrics every Monday
5. **Daily:** Auto-score + lead nurture will run automatically once Bob configures the scheduled deployments

What the agent will NOT do without Bob:
- Send the Isenberg DM (drafted, gated on Bob)
- Auto-send any lead nurture email (drafted, gated on Bob review)
- Process Stripe payments without Bob configuring the SKU IDs in env
- Launch any paid ads (zero ad spend until first paying customer per wedge)
