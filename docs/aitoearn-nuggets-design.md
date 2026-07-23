# AiToEarn Nuggets — Design Notes (Triage, Not Implementation)

**Date:** 2026-05-20
**Trigger:** User asked whether `github.com/yikart/AiToEarn` (~12.9k stars, AGPL-3.0) offers anything worth borrowing for VisionClaw.
**Verdict:** Document blockers + future paths. **No code this round.**

---

## Repo summary

AiToEarn is a Chinese open-source AI content-creation + multi-platform publisher. It overlaps heavily with what VisionClaw already shipped in R113.5 → R115.4 (self-hosted multi-platform scheduler, native Facebook + YouTube + Threads + Pinterest publishers, MCP server, content repurposer).

**Stack:** Node.js (NX monorepo, pnpm), MongoDB, Redis, RustFS, Electron desktop client. Different shape from VisionClaw's Postgres + pgvector + Express + Vite.

**License:** **AGPL-3.0** (verified on the repo). Viral. Direct code-copy of any AiToEarn module into VisionClaw would force VisionClaw to relicense as AGPL-3.0 — a non-starter for a commercial product. Implication: nuggets can be used as a **reference for re-implementing from scratch against public platform docs**, but no source files can be lifted.

---

## Nugget #1 — Asian-platform publishers

**Platforms AiToEarn covers that VisionClaw does NOT:** Douyin, Kwai, WeChat Channels, WeChat Official Account, Bilibili, Xiaohongshu (Rednote).

### Why this is gated on real-world blockers, not engineering

1. **Chinese business entity + ICP filing required.** Douyin (ByteDance), WeChat (Tencent), Bilibili, and Xiaohongshu OAuth developer apps require a registered Chinese business entity with an active ICP (互联网内容提供商) filing. [Your Company] (Illinois) cannot register for any of them. AiToEarn solves this by being a Chinese-registered company running a centralized "Relay" that lends its credentials to end users (see Nugget #2 — we are not doing this).
2. **AGPL-3.0 license.** Any code lifted from AiToEarn would force VisionClaw to relicense.
3. **Engineering scope.** Even with a perfect reference implementation, each platform is a full OAuth flow + media upload pipeline + content-format adapter (Douyin wants vertical 9:16 ≤60s; Xiaohongshu wants square images + hashtags; WeChat Official Account wants HTML article format with sanitization). Realistic estimate: **~1 engineer-week per platform** at high quality, **~6 engineer-weeks total** for all six.
4. **Reachable subset.** Kwai International + TikTok are reachable from the US directly. TikTok is already on the VisionClaw scheduler roadmap. Kwai International alone is not worth the work.

### Future paths (priority-ranked)

| Path | When it makes sense | Effort | Blocker |
|---|---|---|---|
| **A. Do nothing** (current state) | If VisionClaw's market is US/EU creators and businesses | 0 | None |
| **B. Add TikTok native publisher** (already TODO) | When a customer requests TikTok | ~1 wk | TikTok dev-app approval (~weeks) |
| **C. Add Kwai International** | If a customer requests it | ~1 wk | Kwai International OAuth |
| **D. Add Xiaohongshu via web-scrape (no official API)** | If VisionClaw expands into Asian creator market | ~2 wk | Fragile, ToS-violating, rate-limit risk |
| **E. Full Asian-platform expansion via Chinese partner LLC** | If VisionClaw raises capital + commits to Asian market | ~6 wk eng + months legal | Chinese business registration, ICP, partner agreement |

Recommendation: **stay on path A** until a paying customer asks for an Asian platform. Then jump to path B/C for the reachable ones; defer D/E indefinitely.

---

## Nugget #2 — "Relay" centralized-OAuth pattern

**What it is:** AiToEarn runs its own developer OAuth apps on every platform under the `aitoearn.ai` domain. End users authorize *those* apps to post to their accounts. The end user never registers their own dev account on Douyin / TikTok / etc.

**Why this is NOT worth implementing for VisionClaw (active liability, not just "not yet")**

1. **You become liable for every post every customer makes.** Meta, X, TikTok, YouTube, LinkedIn all attribute API actions to the OAuth app, not the end user. If one customer posts something the platform doesn't like, *VisionClaw's* developer account takes the strike. Three strikes = developer-account ban = every customer loses publishing simultaneously.
2. **Anti-spam thresholds.** Platforms treat "one OAuth app posting on behalf of many accounts" as a spam-distribution pattern. Meta in particular shuts down "posting tools" dev accounts aggressively. Expected lifespan of a relay app on Meta: **weeks**, not months.
3. **Per-platform ToS landmines.** TikTok ToS explicitly prohibits "shared developer credentials." LinkedIn requires per-customer app review for posting scopes. X's API tier pricing scales by app, not by user — relay model collapses your unit economics.
4. **Existing VisionClaw posture is correct.** R113.5+ scheduler already requires each customer to bring their own credentials (their own Facebook Page token, their own YouTube refresh token, etc.). This is more setup friction for customers, but it correctly transfers platform-ToS liability to the account holder where it belongs.

**Decision: deliberately do not implement.** The "extra setup friction" of bring-your-own-credentials is a *feature*, not a bug — it's what keeps VisionClaw on the right side of every platform's ToS.

If a future product variant needs zero-config publishing (e.g. a fully managed creator service), that variant should be a **separate brand + separate legal entity** that absorbs the liability deliberately, not a feature toggle on VisionClaw core.

---

## Summary

| Nugget | Action |
|---|---|
| Asian-platform publishers | Defer to path A (do nothing); revisit per-platform only when a customer asks |
| Relay OAuth pattern | Deliberately do not implement — active liability, current posture is correct |

**No tools / tables / personas / governance / capabilities added this round.** Aggregate stats unchanged. _(model: anthropic/claude-sonnet-4.5)_
