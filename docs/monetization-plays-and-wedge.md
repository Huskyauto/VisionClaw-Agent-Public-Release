# Monetization Plays & Wedge — R125+8.9 Strategic Brief

**Origin:** Bob 2026-05-24, after Project #2 (Zombie Detector) shipped. Standing instruction: *"figure out how to make money with this and run through that idea browser with Greg Isenberg's and figure out how to market it."*

**Purpose:** Pick the wedge, lay out the 30-day go-to-market motion, propose persona #17 if needed.

---

## 1. The honest diagnosis

VisionClaw is a 361-tool, 16-persona, 177-table, AHB-safety-hardened agentic platform with zero paying customers and one operator. The risk is not the platform — it's that we keep shipping infrastructure (Skills Catalog, Zombie Detector) and never put a price on anything.

Greg Isenberg's idea-browser thesis in one line: **find a tight niche with an acute weekly pain, productize the workflow, distribute through a community you own, charge before you scale.**

Applied to us: we don't sell "AI agents." We sell **one specific outcome** to **one specific person** through **one channel we already operate**.

---

## 2. The five candidate plays

| # | Play | Niche | Offer | Price | Distribution | Build cost | Time-to-$1K MRR |
|---|------|-------|-------|-------|--------------|------------|------------------|
| A | **AI-Native Readiness Audit** (Project #3, productized) | Series A-C companies with sprawling half-built AI agents | One-time scan + 20-page report + 90-min readout | $497 self-serve / $1,997 with implementation hours | LinkedIn outreach + Twitter teardown threads + Greg's own newsletter swap | ~3 days (Felix already does deliverables) | **2–4 weeks** if cold outreach works |
| B | **Built With Bob Pro** community | Solo founders watching the BWB YouTube channel | Skool/Discord + weekly Inside-VisionClaw playbook + monthly office hours | $39/mo | The BWB channel itself (already publishing) | ~5 days (Skool setup + first 4 playbooks) | **6–10 weeks** (depends on YouTube velocity) |
| C | **Marketing Operator-in-a-Box** | Indie creators / newsletter operators | Hosted `marketing-week-autopilot` on their voice profile — weekly newsletter + 5 social posts + thumbnail + ad creative | $99/mo self-serve / $299/mo done-for-you | BWB channel + cold DMs to newsletter operators in the 1K–10K subs band | ~2 weeks (wrap existing skill in a tenant UI) | **8–12 weeks** |
| D | **AHB Safety Layer as a Service** | Indie devs / Series A startups building agentic products who need post-Galisai safety without rolling their own | npm SDK + hosted intent-gate API + MoA jury endpoint | $499/mo seat OR open-core + paid hosted | Paper-style technical write-up + Hacker News + Twitter | ~4 weeks (extract from platform, harden public API) | **12–20 weeks** — B2B sales cycle |
| E | **VisionClaw for Health Coaches** ([Your Product] vertical) | Independent wellness / fitness coaches charging $200–500/client/mo | White-labeled coach app with weekly check-ins, content engine, invoicing | $199/mo per coach | [Your Product] is the live case study + coach Facebook groups | ~3 weeks (multi-tenant white-label of existing AIB stack) | **8–12 weeks** |

---

## 3. The pick: **A. AI-Native Readiness Audit**

**Why this and not the others:**

1. **It's already Project #3 in the sprint.** We were going to build it anyway. Putting a price on it costs zero extra build time.
2. **The audit IS the marketing.** Every report is a shareable artifact with the customer's logo on it. Greg Isenberg's playbook: ship the wedge that generates its own distribution.
3. **It uses our hardest-to-copy asset.** The Zombie Detector we just shipped is literally one of the audit's findings. We have the only platform that can introspect another company's agent stack credibly because we ran the same audit on ourselves and shipped the receipts.
4. **It's $497.** Two sales = $994. Ten sales in 30 days = $4,970. That's a real wedge, not vaporware MRR.
5. **It opens the door to play C, D, and E.** Every audit reveals a content-gap (→ C), a safety-gap (→ D), or a vertical pattern (→ E). The audit is the qualification call we get paid to do.

**Why not the others first:**
- **B (BWB Community)** — needs YouTube velocity we don't have yet (3 videos shipped). Park as Q4.
- **C (Marketing Operator)** — strong play but requires a self-serve UI we haven't built. Park as Q4.
- **D (Safety SaaS)** — biggest TAM, longest cycle, B2B. Wrong shape for a solo founder needing cash now.
- **E (Coach vertical)** — strong, but [Your Product] needs more proof-of-results first (Bob's own journey is still in progress).

---

## 4. The 30-day GTM motion

**Week 1 — Build the asset**
- Ship Project #3: `ai_native_readiness_audit` Felix deliverable contract + output-skill scaffold
- Audit covers: agent inventory, tool sprawl ratio, AHB safety_profile coverage, zombie-rate, tenant-isolation posture, prod/dev schema drift, MoA-jury usage, cost-per-deliverable
- Deliverable: 20-page PDF + 3-page exec summary + scored radar chart + 10 prioritized recommendations
- Pricing page on the VisionClaw landing: $497 (self-serve, 7-day turnaround) / $1,997 (with 4 implementation hours, 14-day turnaround)

**Week 2 — Run the first audit on ourselves**
- Use VisionClaw to audit VisionClaw. Score: probably a B+ (we have AHB but 8 zombie personas, 21 zombie tools).
- Publish the report **publicly** as `/audits/visionclaw-self-audit-2026-05.pdf`
- Tweet thread: "I audited my own AI platform. Here's what I found." Includes the radar chart, the zombie counts, the recommendations.
- This IS the launch. The self-audit is the proof.

**Week 3 — First 5 cold targets**
- Pick 5 publicly-AI-forward Series A/B companies from the Greg Isenberg newsletter's mentions (founders he tags who are building agentic stuff)
- Offer: "I'll run our AI-Native Readiness Audit on your stack for free in exchange for a testimonial and permission to publish the (anonymized) results." Standard product-launch wedge.
- Goal: 2 of 5 say yes. We need 2 case studies, not 5.

**Week 4 — Open the gates + paid launch**
- Convert the 2 case studies into landing-page proof
- Email the BWB list (small but exists) + Bob's network + post to Indie Hackers + r/AIEngineering + Hacker News (Show HN: I built a tool that tells you which of your AI agents are dead)
- Greg Isenberg cold email: "Subscribed since [date]. Built the thing you described in [newsletter date]. Self-audit attached. Want me to run it on yours?" Greg responds to genuine builds.

**Target Day 30:** 3 paying audits ($1,491) + 2 case studies + 50 leads in the funnel.

---

## 5. Marketing angle (the positioning sentence)

> **"Most AI stacks rot in silence. We're the audit that tells you which agents are dead, which tools nobody calls, and which safety gates are theatre — with the actual SQL you need to fix it."**

This works because:
- It names a real pain (agent rot / safety theatre)
- It promises a specific deliverable (the audit)
- It implies our credibility (we shipped the SQL)
- It's the opposite of every "AI consulting" pitch — we're not selling strategy, we're selling a scan + a fix list

---

## 6. Should we add Hermes (persona #17)?

Bob's signal: *"if we need 17 let's grab it."*

**Recommendation: YES, but not this turn.** Wait until after the audit ships and we have one paying customer, then add Hermes to own the growth/GTM loop going forward.

**Hermes — Growth & GTM Strategist (proposed)**
- **Role:** Wedge identification, offer construction, distribution architecture, positioning, pricing experiments
- **Distinct from:** Teagan (executes social), Apollo (PR/comms), Scribe (newsletter content), Ad-Creative (creative variants)
- **Hermes is the META layer:** *what's our wedge this month, what's our offer, what channel are we owning, what's the price test we're running*
- **Soul fragment:** *"Greek god of merchants, messengers, travelers. Patron of commerce and boundary-crossing. The one who carries the message between worlds — which is what GTM is: carrying the product from where it was built to where it gets paid for."*
- **AHB safety_profile:** `intentGate: moderate`, `restrictedCategories: ["misleading_marketing_claims", "spam_distribution", "credential_exposure"]`, `refusalCopy: "I'll help with growth strategy, positioning, and distribution — but I won't draft claims I can't substantiate or scripts that look like spam. Give me the truth and I'll find the angle."`
- **Build cost:** ~1 day for full wiring (DB row + seed.ts + safety_profile + identity/soul/role/operating_loop + sidebar entry + AHB regression test row)

**Why wait until after the first audit ships:** Hermes built before we have a paying customer is just another scaffolding. Hermes built after we have one customer = a persona with real ground truth to optimize against. That's the difference between an org chart and a team.

---

## 7. What we're explicitly NOT doing

- Not building a public marketplace ("here are my 361 tools, browse them") — nobody buys tool catalogs
- Not pitching "VisionClaw the platform" — too abstract, no buyer
- Not chasing enterprise sales — wrong shape for solo
- Not adding personas just to add them — Hermes only ships when there's a concrete loop for him to run
- Not spinning up a third product — [Your Product] stays its own thing; VisionClaw monetizes through the audit wedge first

---

## 9. Zero-budget distribution — the honest answer

**Bob's question (2026-05-24):** *"How do I market something like this? Do I have to pay an influencer? I really don't want to — I don't have the money."*

**Direct answer: No. Don't pay an influencer.** Wrong audience match. Audit buyers are Series A/B technical decision-makers; they don't buy from TikTok/IG influencer endorsements. They buy from technical authority + peer signal. A $3K sponsorship would drive maybe 1–2 sales of a $497 product. The math is bad.

**The 10 free channels for a technical B2B audit, ranked by ROI for solo founders:**

| Rank | Channel | Why it works | Effort | Time-to-first-lead |
|---|---|---|---|---|
| 1 | **Public self-audit + Twitter teardown thread** | The deliverable IS the marketing. "I audited my own AI platform, here's what I found" with screenshots is irresistible to the exact buyer | 4 hours | 24–72 hours |
| 2 | **Show HN: "I built a tool that tells you which of your AI agents are dead"** | Hacker News drives founder-grade traffic; one good launch = 5K–50K eyeballs free | 2 hours | Same day if it hits front page |
| 3 | **Greg Isenberg cold email + LinkedIn DM** | He literally writes about this pattern. Subject line: "Built the thing you described in [date] newsletter — here's the self-audit." Attach the PDF. He responds to genuine builds. Even a quote-tweet = 200K+ impressions | 1 hour | 3–10 days |
| 4 | **Indie Hackers launch post + r/SaaS + r/AIEngineering + r/MachineLearning** | Free, technical audiences, async, compounds | 3 hours | 1–7 days |
| 5 | **LinkedIn cold outreach (50 targeted CTOs/Heads-of-AI)** | Slow but works. Hook: "Saw you're hiring AI engineers — would you want a free audit of your current agent stack? No catch, building case studies." 5/50 reply → 2 close | 5 hours over 2 weeks | 7–14 days |
| 6 | **BWB YouTube — one pivot video** | We have the channel. One 10-min video "I audited my own AI company. Here's what I found." It plays on Bob's existing wellness-journey narrative (audit-yourself-honestly is the same emotional arc). Builds the channel AND the audit funnel simultaneously | 8 hours (script + record + edit via our own pipeline) | 14–30 days |
| 7 | **Newsletter cross-promo / swap** with 5 other indie-AI newsletter operators | Each swap = ~50–200 free eyeballs of perfect-fit audience. Cost = 1 outbound DM each | 3 hours | 7–21 days |
| 8 | **Podcast guest pitches** (Indie Hackers Pod, Lenny's, Software Engineering Daily, AI Engineer pod) | Slow, compounds. Pitch: "Solo founder built a 361-tool AI platform alone — here's what we found auditing it" | 4 hours pitching, 2 hours per pod | 30–90 days |
| 9 | **Personal Twitter/LinkedIn build-in-public** | "Day N of trying to make my AI agent platform pay for its own token bill. Today: shipped the audit. First customer found via [channel]." Authenticity sells. Greg Isenberg made his whole career on this | Ongoing 15 min/day | 30+ days compounding |
| 10 | **SEO long-tail content** | "How to audit your AI agent stack", "Signs your AI agents are zombies", "AHB safety profile checklist". Slow but durable. One ranking page = $/month forever | 4 hours per article, ~6 articles | 90–180 days |

**My recommendation: execute channels 1, 2, 3 in Week 2. Add 4 + 6 in Week 3. Layer 5 + 7 in Week 4. Ignore 8–10 until after first $1K MRR.**

That's a real GTM motion with $0 spend. The only cost is your time, and the BWB channel + the self-audit PDF do most of the work themselves.

---

## 10. The viral loop — make the deliverable carry itself

Every audit PDF MUST have:
- **Cover page:** customer logo + "AI-Native Readiness Audit by VisionClaw" + date
- **Footer on every page:** "Powered by VisionClaw — get your own audit at [url]"
- **Final page:** "How this audit was generated" — 1-paragraph technical credibility note + QR code to the public self-audit PDF
- **Optional shareable scorecard** (1-pager radar chart, no sensitive data) — explicit "feel free to share this" copy

**Why this matters:** every customer who runs the audit will show it to their board, their engineering team, their investors. That's 5–20 secondary eyeballs per sale, all in the exact buyer profile. CAC after the first 3 audits trends toward zero.

This is the actual Greg Isenberg playbook: **build distribution into the product itself.**

---

## 11. Pre-sprint scoping — what the audit actually measures

So Week 1's build is execution, not design. The audit scores a target stack across 8 dimensions, each 0–10:

| Dimension | What we measure | Data source |
|---|---|---|
| **Agent inventory hygiene** | declared agents vs actively-used (zombie rate) | Reuse Zombie Detector logic on target's DB |
| **Tool sprawl ratio** | tools declared vs tools invoked last 30d | Same |
| **AHB safety_profile coverage** | % of consumer-facing agents with populated `intentGate` + `restrictedCategories[]` | Schema introspection + sample queries |
| **Tenant isolation posture** | % of tables enforcing tenant_id, sample WHERE-clause audit | Schema scan + 20 random queries |
| **Prod/dev schema drift** | tables/columns in dev not in prod, missing indexes | psql `\d` comparison |
| **Deliverable reliability** | grade-then-revise pattern presence, retry logic, quality gates | Code scan for retry/grade patterns |
| **MoA / jury concordance usage** | does the stack escalate ambiguous decisions? | Logs analysis |
| **Cost-per-deliverable** | token spend / unit deliverable, identify hot-spot agents | Logs + token accounting |

Output: weighted composite 0–100 score + per-dimension radar + 10 prioritized recommendations + 3 SQL snippets they can run themselves to verify our findings (credibility move).

**Self-audit projection:** VisionClaw probably scores B+ (~82/100) — strong on AHB, tenant isolation, schema drift; weak on agent hygiene (39% zombie rate), cost-per-deliverable visibility (no per-deliverable token accounting yet). Publishing our own B+ score with the "here's what we're fixing" roadmap is more credible than claiming A+.

---

## 12. Decision required from Bob

**Approved 2026-05-24:** Build the audit, self-audit first.

Next session sequence:
1. **R125+9** — Build & ship `ai_native_readiness_audit` Felix deliverable + output-skill scaffold (covers §11 scoring rubric)
2. **R125+10** — Run the self-audit, publish PDF to `/audits/visionclaw-self-2026-05.pdf`, draft the Twitter teardown thread + Show HN post + Greg Isenberg cold email (all 3 in Bob's voice, ready to fire)
3. **R125+11** — Pricing page on landing + first 5 cold LinkedIn DMs drafted
4. **R125+12+** — Hermes wiring after first paying customer (data-driven, not speculative)

_(model: anthropic/claude-sonnet-4.5)_
