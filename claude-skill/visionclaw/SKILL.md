# VisionClaw Skill (for Claude Code, Cursor, Gemini CLI, Codex)

> Hire an AI corporation, not another chatbot.
>
> VisionClaw is a hosted multi-tenant agentic platform — 16 specialized agents, 226+ tools, 62+ skills, 37+ AI models. This skill teaches your coding agent how to delegate research, document production, and operations work to it from inside your IDE.

**Hosted at:** https://agenticcorporation.net
**Discovery:** `GET /api/v1` (returns the live contract)
**Source / fork it:** https://github.com/Huskyauto/VisionClaw-Agent-Public-Release
**License:** Apache 2.0 · v1.0 shipped Apr 21, 2026

---

## When to invoke this skill

Use `/visionclaw` whenever the user wants:

- **Research at scale** — "Research competitor pricing for 5 SaaS tools and build me a comparison spreadsheet."
- **Document production** — pitch decks, styled PDFs, financial models, legal contracts, marketing campaigns.
- **Long-running ops** — overnight research with a delivery summary, scheduled reports, monitoring with alerts.
- **Multi-step deliverables** — anything that would normally need 3+ different specialists (research → analysis → write-up → format → deliver).
- **Wellness coaching ([Your Product])** — wellness-coaching support, wellness accountability, mood tracking conversations.

If the user wants to **write code** in their own repo, stay with the IDE agent. Hand off to VisionClaw only when the work is **agentic operations** (multi-agent, multi-tool, deliverable-oriented).

---

## Authentication

The user needs a VisionClaw account at https://agenticcorporation.net. After login they generate an API key from **Settings → Security → Public API Keys** and provide it to you as the env var `VISIONCLAW_API_KEY`. Keys begin with `vc_` and are shown exactly once.

If `VISIONCLAW_API_KEY` is missing, ask the user to set it before proceeding. Never invent a key.

**Scopes** (selected at key creation):
- `chat` — required to dispatch tasks and send messages
- `read` — required to list agents and poll conversation status
- `tools` — direct tool invocation (browser, research)
- `admin` — full access including key management

For the patterns below, a `chat + read` key is sufficient.

---

## Core operations (REST)

All endpoints except discovery require `Authorization: Bearer $VISIONCLAW_API_KEY` and return JSON. Base URL: `https://agenticcorporation.net`.

### 1. Discovery — confirm the API is live and learn the surface

```bash
# Discovery is PUBLIC — no key needed. Use it to verify reachability.
curl https://agenticcorporation.net/api/v1
```

Returns the live contract document with every endpoint, scope rules, version, and rate limits. Always hit this first if the user reports something doesn't work.

### 2. List available agents

```bash
curl -H "Authorization: Bearer $VISIONCLAW_API_KEY" \
  https://agenticcorporation.net/api/v1/agents
```

Returns `{ agents: [{ id, name, role, emoji, catchphrase, routingHint }, ...], count }`. The 16 personas:

| Agent | When to route here |
|-------|---------------------|
| Felix | CEO/COO — multi-step decomposition, plan-of-record, executive synthesis |
| Minerva | Strategic planner — decision-theory analysis, plan drafting for Felix approval |
| Forge | Engineering — code review, infra, security analysis |
| Neptune | Deep research — overnight autonomous research, multimedia deep dives |
| Radar | Intelligence — market/competitor analysis, OSINT, trend tracking |
| Cassandra | CFO — budgets, forecasting, P&L modeling, financial analysis |
| Luna | Legal — contract review, compliance, regulatory risk |
| Atlas | Metrics — analytics, dashboards, KPI tracking |
| Apollo | Sales — outreach, lead qualification, pipeline ops |
| Scribe | Long-form writing — SEO content, documentation, blog posts |
| Proof | QA — proofreading, fact-checking, accuracy scoring |
| Teagan | Marketing — social calendars, brand voice, ad copy |
| Agent Blueprint | Capability expansion — new skill creation, tool learning |
| Chief of Staff | Operations director — system health, daily routing |
| Robert | [Your Product] wellness-coaching coach (CBT/DBT/ACT/IPT framing) |
| VisionClaw | Default conversational agent for general tasks |

### 3. Dispatch a task

```bash
curl -X POST https://agenticcorporation.net/api/v1/agents/dispatch \
  -H "Authorization: Bearer $VISIONCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Research competitor pricing for Notion, Linear, and Asana. Build a comparison.",
    "agent": "Radar",
    "async": true
  }'
```

**Body:**
- `task` (required) — the natural-language task description
- `agent` (optional) — agent name (case-insensitive, e.g. "Felix", "Neptune"). If omitted, the active default persona is used.
- `personaId` (optional) — numeric persona id, overrides `agent`
- `async` (optional, default `true`) — if `true`, returns `202` immediately with a `statusUrl` for polling. If `false`, blocks up to `timeoutMs` and returns the reply inline.
- `title` (optional) — conversation title (auto-generated from task if omitted)
- `model` (optional) — override the default model (e.g. `"claude-opus-4"`)
- `timeoutMs` (optional, sync mode only) — 5000–180000, default 60000

**Async response (HTTP 202):**
```json
{
  "conversationId": 1234,
  "agentName": "Radar",
  "personaId": 9,
  "statusUrl": "/api/v1/conversations/1234",
  "createdAt": "2026-04-21T18:30:00Z",
  "status": "queued"
}
```

**Sync response (HTTP 200) — when complete inside `timeoutMs`:**
```json
{
  "conversationId": 1234,
  "agentName": "Radar",
  "personaId": 9,
  "status": "complete",
  "reply": "Here is the competitor pricing analysis...",
  "model": "claude-sonnet-4.5",
  "toolsUsed": ["web_search", "create_spreadsheet"],
  "citations": [...]
}
```

**Sync response (HTTP 202) — when timeout hit before completion:** falls back to the async shape with `status: "still_running"` and a poll hint.

### 4. Poll a conversation for the latest reply

```bash
curl -H "Authorization: Bearer $VISIONCLAW_API_KEY" \
  https://agenticcorporation.net/api/v1/conversations/1234
```

Returns:
```json
{
  "conversationId": 1234,
  "status": "complete",
  "title": "API: Research competitor pricing...",
  "personaId": 9,
  "model": "claude-sonnet-4.5",
  "lastUserMessage": { "id": 9001, "content": "...", "createdAt": "..." },
  "lastAssistantMessage": { "id": 9002, "content": "...", "createdAt": "..." },
  "messageCount": 2
}
```

**Status values:**
- `pending` — user message saved, no assistant reply yet (poll again in 2s)
- `running` — assistant message exists but is still being written (poll again in 2s)
- `complete` — reply finalized, ready to consume

**Polling cadence:** 2-second intervals are safe. Don't poll faster than that.

---

## Idiomatic prompt patterns

**Cold start — single dispatch + poll:**
> Using `/visionclaw`, research the top 5 wellness wellness apps on the market, score them on 6 dimensions, and deliver a styled PDF comparison.

**Warm hand-off from local context:**
> Take the README and `package.json` of this repo and use `/visionclaw` to draft a 12-slide investor pitch deck.

**Long-running with checkpoints:**
> Use `/visionclaw` to dispatch to Neptune for an overnight deep-research session on quantum-resistant cryptography. Set `async: true`, then poll every 30 seconds and notify me when it's done.

**Wellness ([Your Product]):**
> Using `/visionclaw`, dispatch this to Robert: I just got laid off and I keep wanting to order pizza. Help me work through this trigger.

**Sync small tasks:**
> Use `/visionclaw` with `async: false` and `timeoutMs: 30000` to ask Forge to security-review this snippet: [paste]

---

## Producing video deliverables (R63.5)

VisionClaw can render short-form video (MP4, 720p/1080p, with narration + AI imagery + Ken Burns motion + Drive upload + email delivery) from a one-shot API call. Designed for [Your Product]'s wellness wellness content pipeline (YouTube Shorts, Instagram Reels, TikTok), but works for any topic.

### List available templates

```bash
curl -H "Authorization: Bearer $VISIONCLAW_API_KEY" \
  https://agenticcorporation.net/api/v1/video/templates
```

Returns 4 wellness / wellness templates:
- `coaching_tip_60s` — 60-second daily coaching tip from Robert (4 scenes)
- `motivational_reel_30s` — 30-second motivational boost (3 scenes)
- `weekly_summary` — 75-second weekly check-in (5 scenes)
- `recipe_demo_45s` — 45-second wellness-friendly recipe walkthrough (4 scenes)

Each template advertises its `fillVariables` (e.g. `{topic, hook, why, action, closing}` for coaching tips).

### Get a cost estimate (recommended)

Call with `dryRun: true` first to see scene count, duration, and `$` estimate without rendering:

```bash
curl -X POST https://agenticcorporation.net/api/v1/agents/produce-video \
  -H "Authorization: Bearer $VISIONCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "coaching_tip_60s",
    "variables": {
      "topic": "Hydration on your wellness journey",
      "hook": "You feel hungry but it might be thirst.",
      "why": "Your hunger and thirst signals can get crossed. Water before food helps you read them clearly.",
      "action": "Drink one full glass of water before every meal today.",
      "closing": "Small habits, big shifts. You got this."
    },
    "dryRun": true
  }'
```

Response: `{ ok, dryRun: true, estimate: { scenes, estimatedSeconds, estimatedCostUsd, resolution, voiceProvider, voice } }`

### Render for real

Drop `"dryRun": true` (or set false). Returns the Drive shareable URL:

```json
{
  "ok": true,
  "title": "Hydration on your wellness journey",
  "driveUrl": "https://drive.google.com/file/d/.../view",
  "durationSeconds": 18,
  "sizeBytes": 4823219,
  "scenesProcessed": 4,
  "estimatedCostUsd": 0.184,
  "steps": ["Phase 1 complete...", "Uploaded to Google Drive...", ...]
}
```

**Surface the `driveUrl` verbatim to the user — never paraphrase it.**

### Custom scenes (no template)

For one-off video that doesn't fit a template:

```json
{
  "title": "My custom video",
  "customScenes": [
    { "title": "Opening", "narration": "...", "imagePrompt": "..." },
    { "title": "Closing", "narration": "...", "imagePrompt": "..." }
  ]
}
```

### Hard caps (enforced server-side)

| Limit | Value |
|-------|-------|
| Max scenes per video | 8 |
| Max narration chars per scene | 600 (~30s at 150 wpm) |
| Max image-prompt chars | 500 |
| Max resolution | 1080p (4K blocked on public API) |
| Allowed voice providers | `openai` (default, cheap) or `elevenlabs` (premium) |
| Allowed voices | `onyx` is the [Your Product]/Robert default; any provider-valid voice id works |

### Cost ballpark

| Stack | Per scene | 4-scene video | 8-scene video |
|-------|-----------|---------------|---------------|
| OpenAI TTS + Gemini imagery (default, cheapest) | ~$0.05 | ~$0.20 | ~$0.40 |
| ElevenLabs TTS + Gemini imagery | ~$0.07 | ~$0.28 | ~$0.56 |
| OpenAI TTS + DALL-E imagery (fallback) | ~$0.09 | ~$0.36 | ~$0.72 |

Always call with `dryRun: true` first to see the exact estimate. Bills hit your hosted account, not Claude's API costs.

### Email delivery

Add `"emailTo": "you@example.com"` to have the rendered video link emailed automatically alongside the JSON response.

---

## Continuing a conversation

To send a follow-up to an in-flight conversation, use the existing conversations API (also vc_-key authenticated):

```bash
curl -X POST https://agenticcorporation.net/api/conversations/1234/messages \
  -H "Authorization: Bearer $VISIONCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "Refine that with focus on enterprise pricing tiers."}'
```

Then poll `/api/v1/conversations/1234` for the new reply.

---

## What NOT to do

- ❌ Don't invent endpoints. The 6 documented above (`/api/v1`, `/api/v1/agents`, `/api/v1/agents/dispatch`, `/api/v1/conversations/:id`, `/api/v1/video/templates`, `/api/v1/agents/produce-video`) are the entire stable v1 surface. Hit `GET /api/v1` to see what's actually live.
- ❌ Don't render video without `dryRun: true` first if you're cost-sensitive — every render bills real $.
- ❌ Don't paste user secrets into task bodies. The platform has its own credential vault.
- ❌ Don't poll faster than once per 2 seconds.
- ❌ Don't paraphrase Drive/file URLs in agent replies — surface them verbatim.
- ❌ Don't use a `read`-only key to call `/dispatch`. You'll get 403. Create a key with `chat` scope.
- ❌ Don't assume `async: false` will return inline. If the task takes longer than `timeoutMs`, you still get a `statusUrl` and need to poll. Always handle both shapes.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `401 Authentication required` | Missing or wrong `Authorization: Bearer vc_...` header |
| `401 Invalid or revoked API key` | Key was revoked in Settings, or typo in the key |
| `403 API key lacks required scope for POST /api/v1/agents/dispatch` | Key missing `chat` scope — recreate or use a different key |
| `404 No agent named "X" found` | Typo in `agent` field — call `GET /api/v1/agents` to see exact names |
| `429` | Rate limited — back off and retry with exponential backoff |
| `dispatch` returns 202 but conversation never completes | Backend is processing — keep polling. If still pending after 5 minutes, the task may have errored; check `/api/v1/conversations/:id` for an assistant message containing the error. |

---

*Skill version 1.1 · Apr 2026 · maintained by [Your Company] · feedback to huskyauto@gmail.com*

**Changelog**
- v1.1 (R63.5) — added `/api/v1/video/templates` and `/api/v1/agents/produce-video` for [Your Product] wellness video pipeline (YouTube Shorts, Reels, TikTok). 4 templates, hard caps, dry-run cost estimator.
- v1.0 (R63.4) — initial public release: dispatch + polling.
