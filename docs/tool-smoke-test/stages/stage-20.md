# Tool Smoke-Test — Stage 20 of 20

> 14 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `workspace_update_status`  —  **live-safe**
R98.27.7 — Append a status line and/or rewrite next_steps / open_questions for an open workspace. Use after EVERY meaningful tool call so the next loop (or resumed session) sees ground truth instead of guessing. status='blocked' or 'needs_review' is a soft signal to a human; does
- categories: system, memory · speed: normal · network: no
- risk: safe (LOW)
- params: job_id*:string, status:string, progress_note:string, next_steps:array, open_questions:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `write_daily_note`  —  **doc-only**
Write or append to today's daily notes. Use to log important events, decisions, lessons learned, or anything worth recording during the conversation. Memory rule: if you want to remember it, write it down NOW.
- categories: notes · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: content*:string, section:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `write_file`  —  **doc-only**
Write content to a file in the workspace AND automatically upload it to Google Drive. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories automatically. Use for creating HTML, scripts, configs, mockups, or any text file. Max 500KB. The result i
- categories: files · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: path*:string, content*:string, append:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `write_scratchpad`  —  **doc-only**
Write a key-value entry to the delegation scratchpad — shared state visible to parent and sibling agents in the same delegation chain. Use to pass intermediate results, discovered facts, or status updates between agents without polluting the conversation.
- categories: notes · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: key*:string, value*:string, chain_key:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `x_delete_tweet`  —  **doc-only**
Use ONLY when removing a tweet posted in error, with stale info, or after Bob explicitly approves takedown. Permanent and unrecoverable. Returns success/failure. Do NOT use to "edit" a tweet — X has no edit; delete + repost is the pattern, but require explicit human approval firs
- categories: marketing · speed: normal · network: yes
- risk: destructive (HIGH) · gates: risk=destructive; network tool (external/costly side-effect); requiresApproval (HITL); trustedPersonasOnly
- params: tweet_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; network tool (external/costly side-effect); requiresApproval (HITL); trustedPersonasOnly)

## `x_get_me`  —  **doc-only**
Use at session start when working on social media to confirm WHICH account is authenticated — also when reporting follower-count progress to Bob. Returns the authenticated user profile (id, name, username, bio, followers/following/tweet counts).
- categories: marketing · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `x_get_mentions`  —  **doc-only**
Use when triaging incoming social-media engagement — at the start of a session, before drafting public replies, or when Bob asks "what is X saying about us". Returns the most recent @mentions of the authenticated account with author, text, and tweet ID for follow-up via x_search/
- categories: marketing · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: count:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `x_get_timeline`  —  **doc-only**
Use when monitoring a specific X/Twitter account (competitor, partner, prospect, public figure) — before crafting outreach, during competitive intel, or when researching a person before a meeting. Returns up to N most recent tweets from the named user with full text and metrics. 
- categories: marketing · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: username*:string, count:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `x_get_tweet`  —  **doc-only**
Use when you need the full content of one specific tweet by its ID — typically after x_search returns hits, or when a user references a tweet URL/ID, or when investigating engagement. Returns the tweet text, author, created_at, and public metrics (likes, retweets, replies, quotes
- categories: marketing · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: tweet_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `x_like_tweet`  —  **doc-only**
Use when amplifying a partner/customer/community member through a low-effort signal of acknowledgement — also after their reply to one of our threads. Returns success/failure. Do NOT auto-like everything — bot-like patterns get accounts flagged.
- categories: marketing · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: tweet_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `x_post_tweet`  —  **doc-only**
Post a tweet to X/Twitter. Can also reply to a tweet or quote tweet. Uses OAuth 1.0a with the configured API keys.
- categories: marketing · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: text*:string, reply_to_id:string, quote_tweet_id:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `x_retweet`  —  **doc-only**
Use when amplifying content that aligns with our brand voice and wellness/agentic-AI mission — partner launches, customer wins, relevant news. Returns success/failure. Higher-stakes than a like; run cross_critique on borderline content before retweeting from the brand account.
- categories: marketing · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: tweet_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `x_search`  —  **doc-only**
Use BEFORE responding to public commentary about a topic, brand, or product — also for monitoring an event, hashtag, or breaking news in real time. Returns recent tweets matching the query with author, text, and metrics. Best for time-sensitive surface scans; pair with x_get_twee
- categories: marketing · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: query*:string, count:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `youtube`  —  **doc-only**
Manage YouTube channel via YouTube Data API v3. Requires YouTube OAuth to be connected. Actions: channel_info (get channel stats), list_videos (recent uploads), list_shorts_by_date (recent SHORT-FORM uploads inside a trailing date window — duration-filtered to exclude long-form),
- categories: media · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: action*:string, days:number, maxDurationSec:number, videoId:string, query:string, commentId:string, text:string, title:string, tags:array, maxResults:number, filePath:string, description:string, privacyStatus:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 20`
