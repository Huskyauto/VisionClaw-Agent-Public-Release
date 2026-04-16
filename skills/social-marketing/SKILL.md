---
name: social-marketing
description: Autonomous social media marketing for VisionClaw Health. Draft, schedule, post, and track content across X/Twitter, LinkedIn, and other platforms. Includes experiment tracking, A/B testing, and performance analytics.
version: 1.0.0
author: VisionClaw
tags: [marketing, social-media, twitter, x, linkedin, automation, growth, content]
license: MIT
---

# Social Marketing Skill — VisionClaw Health

Autonomous marketing engine for creating, scheduling, posting, and tracking social media content across platforms.

## Brand Identity

### VisionClaw Health
- **Tagline**: "AI-Powered Health Intelligence"
- **Voice**: Professional but approachable. Data-driven. Confident without being pushy.
- **Tone**: Helpful expert sharing genuine insights, not a salesperson.
- **Audience**: Health-conscious professionals, AI enthusiasts, wellness seekers, small business owners exploring AI tools.

### Content Pillars
1. **AI + Health insights** — How AI transforms personal health management
2. **Build in public** — Share development progress, milestones, wins
3. **User success stories** — Real results from real users (with permission)
4. **Industry commentary** — Hot takes on AI, health tech, and digital wellness
5. **Educational content** — Tips, how-tos, and explainers about the platform

### Voice Rules
- Speak with authority but stay humble
- Use data and specifics when possible ("reduced response time by 40%", not "much faster")
- No corporate buzzword salad — write like a real person
- Short punchy lines for X/Twitter, longer form for LinkedIn
- Always use "VisionClaw Health" (full name) on first mention, "VisionClaw" after
- Include relevant hashtags but don't overdo it (2-3 max per post)
- Never post sensitive data, API keys, or user information

## Platform Strategies

### X/Twitter
- **Post length**: 280 chars max, aim for 200-240 for engagement
- **Cadence**: 1-3 posts per day, spaced 4+ hours apart
- **Best times**: 8-10am, 12-1pm, 5-7pm (user's timezone)
- **Thread strategy**: Use threads for technical deep-dives and announcements
- **Engagement**: Reply to mentions within 2 hours, quote-tweet relevant industry news
- **Hashtags**: #AIHealth #VisionClaw #HealthTech #AIAgent

### LinkedIn
- **Post length**: 500-1500 chars for feed posts
- **Cadence**: 3-5 posts per week
- **Content mix**: 40% insights, 30% build-in-public, 20% educational, 10% promotional
- **Format**: Use line breaks for readability, emoji sparingly, end with a question or CTA

### TikTok/Instagram Reels
- **Format**: Short-form video scripts (15-60 seconds)
- **Hook**: First 3 seconds must grab attention
- **Content**: Screen recordings, before/after demos, quick tips

## Tools (Registered in Agent Toolset)

### draft_social_post
Generate a platform-optimized social media post using AI with VisionClaw Health brand voice.

**Parameters**:
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| platform | string (x, linkedin, tiktok, instagram) | yes | Target platform |
| topic | string | yes | What the post is about |
| style | string | no | announcement, insight, question, thread, hot-take, build-in-public, educational, user-success |
| include_cta | boolean | no | Include a call-to-action (default true) |
| include_hashtags | boolean | no | Include hashtags (default true) |

### manage_content_calendar
Add, list, remove, or clear scheduled posts in the content calendar.

**Parameters**:
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| action | string (add, list, remove, clear_past) | yes | Calendar action |
| platform | string | no | Platform filter (x, linkedin, tiktok, instagram, all) |
| content | string | no | Post content (for add) |
| scheduled_date | string | no | ISO datetime (for add) |
| post_id | string | no | Post ID (for remove) |
| style | string | no | Content style tag |
| campaign | string | no | Campaign name to group posts |

### marketing_analytics
Log post results, view analytics, find top performers, or get optimization recommendations.

**Parameters**:
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| action | string (log_result, view_analytics, top_performers, recommendations) | yes | Analytics action |
| platform | string | no | Platform filter |
| post_content | string | no | The post content (for log_result) |
| metrics | object | no | {views, likes, replies, reposts, clicks, bookmarks} |
| date_range | string | no | today, week, month, all |
| campaign | string | no | Campaign filter |

### marketing_experiment
Create A/B experiments, log variant results, determine winners, and list experiments.

**Parameters**:
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| action | string (create, log_result, get_winner, list) | yes | Experiment action |
| experiment_name | string | no | Name of the experiment |
| hypothesis | string | no | What you expect to happen |
| variant_a | string | no | First variant content/approach |
| variant_b | string | no | Second variant content/approach |
| variant_a_metrics | object | no | Metrics for variant A |
| variant_b_metrics | object | no | Metrics for variant B |
| learning | string | no | Key takeaway |
| next_action | string | no | What to do based on results |

## Posting to X/Twitter (Future)

Direct posting requires X/Twitter API credentials. When ready:
- Set `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` in environment
- Or use a posting service like Postiz, Typefully, or Buffer
- Until connected, all drafts are generated for manual copy-paste posting

## Campaign Framework

### Launch Campaign Template
```
Phase 1: Pre-launch (1 week before)
  - Teaser posts ("Something big is coming...")
  - Behind-the-scenes build posts
  - Countdown (3 days, 1 day, hours)

Phase 2: Launch Day
  - Announcement thread (X) + long post (LinkedIn)
  - Demo video/screenshot posts
  - Respond to every comment within 1 hour

Phase 3: Post-launch (1-2 weeks)
  - User testimonial posts
  - Feature highlight series
  - "Did you know?" tips
  - Performance recap post
```

### Experiment Log Format
Track all experiments in memory or project notes:
```
## YYYY-MM-DD — [Experiment Name]
**Platform**: X / LinkedIn / TikTok
**Hypothesis**: [What you expected to happen]
**Content**: [The actual post or summary]
**Result**: [Metrics — views, likes, clicks, replies]
**Learning**: [What this taught us]
**Action**: [Double down / iterate / kill]
**Score**: [1-10 based on performance vs effort]
```

### A/B Testing
For any major post, create 2 variants:
- **Variant A**: Standard approach
- **Variant B**: Alternative hook/angle/CTA
- Post both at similar times, measure after 24-48 hours
- Winner framework becomes the new baseline

## Content Templates

### Announcement
```
[Exciting emoji] [What's new in one line]

[2-3 sentences explaining the value]

[CTA — try it, learn more, etc.]

#AIHealth #VisionClaw
```

### Build-in-Public
```
[Time reference] update on VisionClaw Health:

[Bullet points of what shipped/changed]

[Honest reflection — what worked, what didn't]

[What's next]
```

### Hot Take
```
[Controversial or surprising statement]

[Why most people get this wrong]

[Your perspective backed by experience]

[Open question for engagement]
```

### User Success
```
[Quote or paraphrase from user]

[Context — what they were trying to do]

[How VisionClaw helped]

[Subtle CTA]
```

## Heartbeat Integration

This skill can be integrated with VisionClaw's heartbeat system for autonomous posting:

```
Task: social-marketing-daily
Schedule: 0 9 * * * (9am daily)
Actions:
  1. Check scheduled posts queue
  2. Post any due content
  3. Check mentions/replies and draft responses
  4. Log daily analytics snapshot
  5. Generate 1-2 draft posts for review
```

## Rate Limits & Safety

- **Never post more than 5x per day per platform**
- **Always check for duplicate content before posting**
- **Never auto-post without owner approval** (drafts only for autonomous mode)
- **Space posts at least 2 hours apart**
- **Never share**: API keys, user data, financial details, health records
- **Always include**: Proper attribution for quotes/data, disclosure for AI-generated content where required

## API Integration Notes

### X/Twitter API v2
- Endpoint: `https://api.twitter.com/2/tweets`
- Auth: OAuth 1.0a (user context) for posting
- Rate limit: 1500 tweets per month (free tier), 100 per 15 min window
- Media upload: `https://upload.twitter.com/1.1/media/upload.json`

### Buffer/Postiz (Alternative)
- Use as a scheduling layer if direct API isn't available
- POST to their API with content + scheduled time
- Supports multi-platform posting from single API call

### Typefully (Alternative)
- Great for X threads specifically
- API supports draft creation and scheduling
