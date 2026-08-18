# Idea Browser Concept Doc — AI-Native Readiness Audit

**Origin:** Bob 2026-05-24 ("run this through Greg Isenberg's Idea Browser project concepts"). Built as the framework-scored companion to `docs/monetization-plays-and-wedge.md` (which is the GTM motion). This doc scores the wedge against the structured fields an Idea Browser entry actually contains.

**Status:** R125+12 strategic artifact. Living document — update after every monetization cycle.

---

## One-line pitch

> Most AI stacks rot in silence. We're the audit that tells you which agents are dead, which tools nobody calls, and which safety gates are theatre — with the SQL you need to fix it.

---

## Opportunity scoring (Idea Browser style, 0–10 each)

| Field | Score | Notes |
|---|---:|---|
| Problem severity | 7 | Real pain, mostly unmeasured. Buyers know the symptom (AI feels expensive + unmonitored) but lack the diagnostic. We supply the thermometer. |
| Audience size + reach | 4 | ~3000 US Series A–C companies with declared AI eng teams. SAM probably $1.5M ARR at $497–$1997 ASP × 1500 willing buyers. Not a unicorn TAM. |
| Monetization clarity | 9 | $497 self-serve / $1997 DFY priced today. No mystery. |
| Distribution leverage | 6 | Own the BWB YouTube channel + Bob's network. Greg Isenberg cold DM is a one-shot but high-EV. No paid acquisition needed. |
| Founder-market fit | 10 | Solo founder built a 361-tool platform alone and self-audited honestly at 60/100. Strongest card we hold. Currently underused in marketing copy. |
| Why-now / timing | 8 | Post-Galisai AHB paper (2026), agent-sprawl mainstreaming, board ROI pressure. Window is open ~12–18 months before observability vendors absorb it. |
| Competitive moat | 6 | No direct competitor we've identified in this exact shape. Adjacent vendors (Galileo, Arize, LangSmith, Humanloop) all focus on runtime instrumentation; we do static, point-in-time audit. Defensible for ~12–18mo before observability vendors plausibly absorb the static-audit shape. |
| Build cost vs. revenue | 10 | Already built. Marginal cost per delivered audit ≈ $5 in tokens. Gross margin ~99%. |
| Network / viral loops | 3 | Spec'd in monetization brief §10, partially built (R125+12 ships the PDF + viral footer). Without the PDF this score was 0. |
| Pre-launch validation | 0 | Never did a smoke test. No "would you pay $497" survey. No waitlist. Highest-risk gap. |

**Weighted composite (Greg-style weights: founder-fit + distribution + monetization clarity weighted 2x):**

**≈ 63 / 100 — Band B−. Promising, with two specific gaps (pre-launch validation, network loops) that, if closed, would push it into Band A territory (78–82).**

---

## Niche definition

**Who specifically buys this:**

- **Title:** CTO, Head of AI, VP Engineering, Chief Data Officer
- **Company stage:** Series A through C ($5M–$50M ARR)
- **Team size:** 20–200 engineers
- **AI footprint signal:** has shipped 3+ LLM-powered features in production, has at least one dedicated AI engineer hire in the last 12 months
- **Trigger events (any one of):**
  1. Just hired an AI lead and the lead is asking "wait, what do we have?"
  2. Just had an AI incident (jailbreak, cost spike, hallucination customer complaint) and the board wants a report
  3. Board / investor asked for ROI on cumulative AI spend
  4. Engineering team itself is asking "how do we even measure if our agents are working"
  5. Just read the Galisai et al. AHB paper or a derivative HN/Twitter post about agent rot

**NOT for:**
- Pre-seed / seed companies (no stack to audit)
- Enterprise (wrong sales motion; pay $200K not $1997)
- AI-vendor companies themselves (they sell the thing, they don't need us)
- "AI-curious" non-technical buyers (we sound like Greek to them)

---

## Problem statement (3 acute, weekly, named pains)

1. **"We have N agents in prod and nobody can tell me which are actually being used."** Frequency: weekly question in standups. Symptom: every retro mentions "we should clean up the tools but never do."
2. **"Are we exposed to a Galisai-paper-style jailbreak? I genuinely don't know."** Frequency: monthly anxiety, weekly headline. Symptom: ad-hoc safety reviews that produce slides and no findings.
3. **"How much are we spending on tokens per actual customer outcome?"** Frequency: weekly finance question. Symptom: "we'll get to it after the next launch" forever.

---

## Solution / Product

- **Deliverable:** scored composite 0–100 across 8 dimensions, per-dim radar chart, 10 prioritized fixes, 3 SQL snippets the buyer can run themselves to verify findings (credibility move).
- **Two tiers shipped:**
  - **$497 Self-Serve** — buyer runs the script, gets the report. 7-day async.
  - **$1,997 DFY** — Bob runs it end-to-end with 4 implementation hours. 14-day.
- **Coming Q3 (R125+12 spec):**
  - **$99/mo Audit Monitoring** — quarterly re-audit + zombie-agent alerts + new-tool drift notifications. Closes the monetization-ladder gap (rung 3).
- **Enterprise tier** — Custom, mailto fallback only. Don't chase.

---

## Distribution

Per `docs/monetization-plays-and-wedge.md` §9, ranked top 5 free channels for technical B2B audit at $0 budget:

1. Public self-audit PDF + Twitter teardown thread — **the deliverable is the marketing**
2. Show HN: "I built a tool that tells you which of your AI agents are dead"
3. Greg Isenberg cold DM + LinkedIn — "built the thing you described, here's the receipt"
4. Indie Hackers + r/SaaS + r/AIEngineering launch posts
5. LinkedIn cold outreach (50 targeted CTOs, hook = free audit for testimonial)

**Channel #1 was the entire viral-loop strategy and was IMPOSSIBLE without the branded PDF** — that gap is closing this round (R125+12).

---

## Monetization ladder

| Rung | Offer | Price | Status |
|---|---|---|---|
| 0 | Public self-audit PDF | Free | Live R125+12 |
| 1 | Self-Serve audit | $497 | Page live, awaiting Stripe products |
| 2 | DFY audit | $1,997 | Page live, awaiting Stripe products |
| 3 | Monitoring subscription | $99/mo | **Q3 waitlist live R125+12; infra deferred** |
| 4 | Implementation retainer | $5K–$15K/mo | Not specced. Future expansion. |
| 5 | Enterprise audit + advisory | $50K+ | Mailto fallback only. Don't actively pursue. |

**The ladder existed only through rung 2 before R125+12.** Each sale was a one-shot. With rung 3 the LTV math finally works: capture 30% of audit buyers into monitoring → $30 ARPU/mo on top of the one-shot.

---

## Competition

| Vendor | What they do | Where they win | Where we win |
|---|---|---|---|
| Galileo | Runtime LLM observability | Instrumented quality scoring | Zero-instrumentation, point-in-time |
| Arize Phoenix | OpenAI-native eval / tracing | Open source + ML team adoption | Read the structure not the traces |
| LangSmith | LangChain-native tracing | Locked-in audience | Framework-agnostic |
| Humanloop | Prompt management + eval | Workflow tooling | Audit not workflow |
| Big-4 consultancies | "AI Transformation" decks | Boardroom credibility, enterprise budget | 100x cheaper, technical not slideware |

**Positioning sentence (now live in `/audit` page R125+12):** *"They tell you what happened. We tell you what's broken. They run ongoing subscription. We're $497 and one-time."*

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Buyer refuses DB access on infosec grounds | HIGH | $497 tier is buyer-runs-script-themselves (no credential exposure). DFY tier ships a sandboxed read-only deck instead of asking for prod creds. |
| Buyer says "we'll build it ourselves" | MED | The buyer who would build it themselves is exactly the buyer who won't, by definition (otherwise they'd already have). 60/100 self-score proves we couldn't even build it for OURSELVES until R125+9. |
| Observability vendors copy us as a free addon | HIGH (12-month risk) | Window is 12–18mo. By then we either have rung 3 (monitoring SaaS, defensible) or we pivoted. Both fine outcomes. |
| Audit findings embarrass paying customer → bad word-of-mouth | MED | Findings framed as "here's the fix." Buyer keeps confidentiality. Optional shareable scorecard is anonymized. |
| Galisai paper retracted or proved overhyped | LOW | We have 7 other dimensions. AHB is one input, not the whole product. |
| No buyer responds to outreach | EXISTENTIAL | Per §11 below: validate FIRST (10 cold "would you pay" DMs) before building more. This is the gap. |

---

## Day-1 customer profile (the first 5)

Not named — that's gap 4 from R125+12, ICP archetype work shipping this round as `attached_assets/launch-r125-10/icp-archetypes-and-personalized-dms.md`. The five archetypes:

1. **Series B fintech with 4 AI features and 1 incident** — pain trigger 1 + 2
2. **Series C devtools company that just hired Head of AI** — pain trigger 1
3. **Series A vertical-AI SaaS where founder is technical** — pain triggers 1 + 4
4. **Series B B2B SaaS where the board just asked for AI ROI** — pain trigger 3
5. **Greg Isenberg portfolio company or community member** — warm intro via Greg

---

## Pre-launch validation gap (the biggest one)

**Greg's framework demands 5–10 "would you pay $497 for this" signals from named targets before scaling outreach.**

We currently have ZERO. The brief skipped from "build it" directly to "ship it" without smoke-testing demand.

**Fix this BEFORE more building:**
1. Identify 10 candidates from the 5 archetypes above
2. Send a 3-line DM: "I built [this]. Self-audit PDF [link]. Would you pay $497 for this on your stack?"
3. Look for: 3+ "yes" / "maybe" / "tell me more" responses
4. If 0 of 10 respond positively → pivot the positioning, not the product
5. If 3+ respond positively → proceed to scale outreach with confidence

This is a **Week 1 motion**, not a Week 4 motion. It was skipped. R125+12+ should close it before R125+13 builds anything new.

---

## Network / viral loops

Per `docs/monetization-plays-and-wedge.md` §10:

**Required in every audit PDF (shipped R125+12 for the self-audit, must replicate for paid):**
- Cover page with date + composite badge + branding
- "Powered by VisionClaw — get your audit at agenticcorporation.net/audit" footer on every page
- Final methodology page (1 paragraph credibility + URL back)
- 1-page shareable scorecard (anonymized, radar chart + composite + best/worst dims)

**Why this matters:** every customer report gets shown to 5–20 secondary eyeballs (board, eng team, investors). CAC trends to zero after first 3 sales if the viral loop is real.

---

## Founder-market fit (our strongest card, currently underused)

> "I built a 361-tool, 16-persona, 177-table AHB-safety-hardened agentic platform alone — and then I audited it myself and published the 60/100 score with the receipts. If you want someone to do that to your stack, I am literally the only person who has done it to their own."

**This sentence belongs at the top of `/audit`.** Currently buried in the founder-audit section. R125+12 fixes by adding the founder-lead block above the hero.

---

## 90-day roadmap (refresh of brief §4 against current state)

| Day range | Goal | Status |
|---|---|---|
| 1–14 | Ship audit + self-audit + PDF + page | ✅ R125+9 → R125+12 |
| 15–30 | First 5 cold outreach (pre-launch validation) | **NOT STARTED — biggest current gap** |
| 31–60 | 2 case studies live + paid launch (Show HN, Greg DM, BWB pivot video) | Drafted, not shipped |
| 61–90 | First $1K MRR, decide on Hermes #17 | Pending paying customer |

---

## Pivot triggers (when to stop and reconsider)

- **0 of 10 cold DMs convert to "tell me more"** → pivot positioning, possibly change wedge
- **2 cold DMs convert but 0 close after a 30-min call** → pricing or scope issue, not demand
- **3 closes but 0 viral spread (no inbound from referrals)** → viral loop is broken, fix PDF/footer/QR
- **3 closes + 3 inbound but burn rate > MRR after 60 days** → wrong unit economics, raise prices or kill rung 1

---

_(model: anthropic/claude-sonnet-4.5)_
