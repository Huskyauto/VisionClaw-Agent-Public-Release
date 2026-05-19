# VisionClaw Agent — Launch Posts

Ready-to-post copy for promoting the public release. Copy, paste, post.

---

## X/Twitter (Main Announcement)

```
VisionClaw Agent is now open-source.

14 AI agents. 195+ tools. 37+ AI models. Self-hosted.

Not a chatbot — a full AI operations team that produces real deliverables: research reports, legal docs, financial models, slide decks, spreadsheets, and PDFs.

Fork it. Deploy it. Own it.

github.com/Huskyauto/VisionClaw-Agent-Public-Release
```

## X/Twitter (Thread — Post 1 of 4)

```
I just open-sourced VisionClaw Agent — a full AI operations platform I've been building for months.

14 specialized AI agents, 195+ tools, 37+ AI models, 113 database tables.

Here's what makes it different from every other AI project on GitHub 🧵
```

## X/Twitter (Thread — Post 2 of 4)

```
Most AI repos give you a chatbot.

VisionClaw Agent gives you an entire AI workforce:
- Felix (CEO) orchestrates tasks
- Luna reviews contracts for legal risk
- Cassandra builds financial forecasts
- Radar runs competitive intelligence
- Neptune does overnight autonomous research

They coordinate automatically.
```

## X/Twitter (Thread — Post 3 of 4)

```
The output isn't just chat messages.

It produces real files:
- Executive-quality PDFs with branded headers
- Excel spreadsheets with formulas
- Google Slides presentations
- Research reports deposited into your Drive

Every decision is traceable. Every action is governed.
```

## X/Twitter (Thread — Post 4 of 4)

```
It runs with just 1 API key and a Postgres database. Everything else — payments, email, voice, Google Drive — appears automatically when you add the key.

MIT licensed. Fork-ready.

github.com/Huskyauto/VisionClaw-Agent-Public-Release

Star it if you think AI should be more than a chatbot.
```

---

## Reddit — r/SideProject

**Title:** I built an open-source AI agent platform with 14 agents and 195 tools — here's what I learned

**Body:**
```
I've been building VisionClaw Agent for the past few months and just open-sourced it. It's a multi-tenant AI platform where 14 specialized agents work together to produce real deliverables — not just chat responses.

What it does:
- 14 AI agents (CEO, Engineer, Legal, Finance, Research, Content, etc.) that coordinate automatically
- 195+ built-in tools for document generation, web research, email, payments, and more
- Supports 37+ AI models across OpenAI, Anthropic, Google, xAI, and OpenRouter
- Produces actual files: PDFs, Excel, Google Slides, research reports
- Multi-tenant architecture for agency deployments
- Everything degrades gracefully — features you don't configure just disappear

Tech stack: TypeScript, React, Express, PostgreSQL with pgvector, Drizzle ORM

The hardest part was getting the agents to coordinate properly. The auto-orchestration engine decomposes complex requests into task graphs with dependency tracking, so agents can work in parallel when possible.

Runs with just one LLM key and a Postgres database. MIT licensed.

GitHub: https://github.com/Huskyauto/VisionClaw-Agent-Public-Release

Happy to answer any questions about the architecture or how the multi-agent orchestration works.
```

---

## Reddit — r/selfhosted

**Title:** VisionClaw Agent — self-hosted AI platform with 14 agents, Docker support, graceful degradation

**Body:**
```
Just released VisionClaw Agent as open-source (MIT). It's a self-hosted AI agent platform that runs with docker-compose.

What makes it self-hosted friendly:
- Single docker-compose.yml with PostgreSQL + pgvector included
- Only requires 1 LLM API key + Postgres to run
- Everything else (email, payments, voice, Drive) is optional and appears when configured
- Setup wizard at /setup shows you exactly what's configured
- Full tenant isolation if you want to run it for multiple users/clients
- Automated daily backups to Google Drive

14 AI agents handle different domains (engineering, legal, finance, research, content) and coordinate automatically. Output is real files — PDFs, spreadsheets, presentations — not just chat.

GitHub: https://github.com/Huskyauto/VisionClaw-Agent-Public-Release

docker-compose up -d and you're running. Happy to answer questions.
```

---

## Reddit — r/LocalLLaMA

**Title:** Open-sourced my AI agent platform — 14 agents, 37+ model support, works with any provider

**Body:**
```
VisionClaw Agent is a multi-agent AI platform I've been building that supports 37+ models across 6 providers (OpenAI, Anthropic, Google Gemini, xAI Grok, OpenRouter, Perplexity). Just open-sourced it.

What might interest this community:
- Model failover — if one provider goes down, it automatically routes to another
- Cost-aware routing — picks the right model for the task complexity
- Subscription-first routing — connect your ChatGPT Plus or Gemini Advanced subscription via OAuth to use for inference at $0 API cost
- Works with OpenRouter, so you can point it at local models too
- Thinking mode with decision traces for complex reasoning

The platform has 14 specialized agents that coordinate on tasks. They produce actual deliverables (PDFs, spreadsheets, research reports), not just text.

129k lines of TypeScript. MIT licensed. Docker support included.

GitHub: https://github.com/Huskyauto/VisionClaw-Agent-Public-Release
```

---

## Hacker News — Show HN

**Title:** Show HN: VisionClaw Agent – Open-source multi-tenant AI platform (14 agents, 195 tools)

**Body:**
```
I've been building VisionClaw Agent for the past few months and just released it as open-source (MIT).

It's a multi-tenant AI agent platform where 14 specialized agents (CEO, Engineer, Legal, Finance, Research, Content, etc.) coordinate to produce real deliverables — PDFs, spreadsheets, presentations, research reports.

Key design decisions:
- Graceful degradation: features you don't configure just disappear instead of breaking
- Atomic task claiming with FOR UPDATE SKIP LOCKED for safe multi-instance deployment
- Trust engine that scores tool calls for safety — high-risk actions require human approval
- Three-tier memory system (Hot/Warm/Cold) with zero-loss compaction

Tech: TypeScript, React, Express, PostgreSQL with pgvector. Runs with just 1 LLM key and Postgres.

https://github.com/Huskyauto/VisionClaw-Agent-Public-Release
```

---

## LinkedIn

```
I just open-sourced VisionClaw Agent — an AI platform I've been building that takes a fundamentally different approach to AI tooling.

Instead of a chatbot, it's a full AI operations team:

14 specialized agents (CEO, Engineer, Legal, Finance, Research, Content, and more) that coordinate automatically to produce real business deliverables — research reports, legal documents, financial models, slide decks, and branded PDFs.

Built for agencies, operators, and founders who want an AI team they own and host themselves.

The stack: 129k lines of TypeScript, 195+ tools, 37+ AI models, PostgreSQL, multi-tenant isolation, and graceful degradation (features you don't configure simply disappear).

MIT licensed. Fork-ready. Runs with just one API key and a database.

Check it out: https://github.com/Huskyauto/VisionClaw-Agent-Public-Release

#OpenSource #AI #AIAgents #TypeScript #SelfHosted
```
