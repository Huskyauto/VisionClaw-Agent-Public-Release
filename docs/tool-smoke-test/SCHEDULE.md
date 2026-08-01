# Tool Smoke-Test & Documentation Program

A durable, **staged** program that documents + classifies + wiring-verifies every
registered agent tool, one small batch at the **end of each work session**, building
full tool documentation over a few weeks. No big-bang run, no LLM spend, no live
invocation of risky tools.

## What it is

- **394 tools** (live `tool-registry` count) → **20 stages of 20**.
- **107 live-safe** · **287 doc-only** (as of last `manifest.json` generation).
- Each tool gets: description + params (from `TOOL_DEFINITIONS`), category/speed/network
  meta (from `tool-registry`), risk + gate classification (from `destructive-tool-policy`),
  and an auto-computed **wiring verdict**.

## Safety rules (non-negotiable)

- **`doc-only` tools are NEVER auto-invoked.** A tool is `doc-only` if it is anything other
  than `risk=safe` AND non-network AND fast/normal speed AND carries no approval / trusted-persona /
  value-cap / irreversible gate. That captures every destructive, sensitive, money-moving,
  mass-comms, network, or slow/expensive tool.
- **`live-safe` tools** (read-only stats, status, cache views, etc.) MAY be invoked with minimal
  args as an *opt-in* deepening step — but live invocation is **deferred by default**; the first
  documentation sweep only verifies wiring + docs.
- The harness itself does **no** tool invocation, **no** LLM calls, **no** tenant access, and
  never imports `server/tools.ts` at runtime (it parses that file statically — importing it loads
  the whole app graph and never resolves; same reason the wiring audit avoids it).

## Source of truth

- Tool names + meta: `server/tool-registry.ts` (`getAllRegisteredTools`, `getToolMeta`).
- Risk/gates: `server/safety/destructive-tool-policy.ts` (`TOOL_POLICIES`, `getToolRiskClass`).
- Descriptions/params: `server/tools.ts` `TOOL_DEFINITIONS` (parsed statically via the TS compiler API).
- Pure classifier (unit-tested): `server/lib/tool-smoke-core.ts`.
- Driver: `scripts/tool-smoke-test.ts`.

## How to run

```bash
npx tsx scripts/tool-smoke-test.ts             # (re)generate manifest.json + progress.json
npx tsx scripts/tool-smoke-test.ts --status    # progress + the next stage to work
npx tsx scripts/tool-smoke-test.ts --stage N   # emit stages/stage-NN.md worklist (auto-filled verdicts)
npx tsx scripts/tool-smoke-test.ts --complete N # sign off stage N
# stage files are not clobbered once created; pass --force to regenerate one
```

## End-of-session routine (the habit)

At the **end** of a work session, advance **one** stage:

1. `npx tsx scripts/tool-smoke-test.ts --status` → note the NEXT stage number `N`.
2. `npx tsx scripts/tool-smoke-test.ts --stage N` → generates `stages/stage-NN.md`.
3. Review the 20 tools: confirm each classification looks right, read the description,
   fix any `[ ] needs attention` (e.g. a missing static doc). Optionally live-invoke a
   couple of `live-safe` tools and record the result inline.
4. `npx tsx scripts/tool-smoke-test.ts --complete N`.
5. Let the **Auto Git Push** workflow commit (git from bash is sandbox-blocked).

Keep it to one stage per session — the point is steady, low-cost progress, not a marathon.

## Progress

- Authoritative pointer: `docs/tool-smoke-test/progress.json` (`completedTools` — a name-based list, durable across registry churn; a stage counts complete only once ALL its tool names are signed off).
- Human view: `npx tsx scripts/tool-smoke-test.ts --status`.
- **Stage 1: ✅ signed off.** Next: stage 2.
