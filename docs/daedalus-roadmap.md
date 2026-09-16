# Daedalus Roadmap — Path to Agent-Owned Platform Engineering

> **Naming note (R125+8.8):** This document originally named the persona "Atlas." The R125+8.7 Zombie Detector revealed that `personas.id=12` already exists as "Atlas — Metrics & Reporting Analyst" (heavily documented in `docs/personas.md`, `docs/FEATURES.md`, `docs/VisionClaw_Agency_Expansion_Specification.md`, and the cross-persona routing tables). To avoid disrupting that doc graph, the platform-engineer persona was renamed to **Daedalus** — the Greek craftsman who built the labyrinth and whose son fell when he ignored the limits. The Icarus parable maps directly onto the AHB safety exclusions hard-coded into this persona's allowlist.


**Origin:** Bob 2026-05-24, after the R125+8 Outlook + Greg-Isenberg-letter review session.

**Bob's stated goal (verbatim, paraphrased):**
> "Eventually I want Felix and the Agents to handle everything Replit Agent handles for me — because that's the only way things become an agentic setup, when they have the knowledge and the power to do this type of work on their own."

**Constraint Bob added in the same breath:** "You're right about the safety we got to watch that s***."

So: maximum autonomy, no relaxation of safety. This doc is the design that threads that needle.

## Current capability boundary (R125+8)

**What Felix + the 16-persona team CAN do today:**
- Run customer-facing deliverable pipelines (video, PDF, audio, slides, ads, social, audits)
- Query any DB table they're authorized for (tenant-isolated)
- Call any of the 371 tools they're allowlisted for
- Use MNEMA memory, jury_triage, ensemble_query
- Self-emit skills via the capability-registry (with review queue)

**What only main-agent (Replit Agent) can do today:**
- Edit any file in the VisionClaw repo
- Run shell commands (`psql`, `npm`, `git`, `tsx`)
- Restart workflows
- Trigger deploys + verify them
- Read arbitrary files for orientation before editing
- Get architect code-review on a diff before committing

That capability gap is exactly 5 missing primitives. Closing them = Bob's stated goal.

## The 5 missing capabilities

### Cap-1: `platform_edit_file` tool (MAX risk class)
- Lets a platform-engineer persona write to the VisionClaw repo
- Every diff goes through `jury_triage` (3-frontier-model vote) BEFORE write
- Mandatory `npm run check` + targeted test gate AFTER write
- Auto-rollback on fail (Replit checkpoint-based)
- File allowlist per persona (Daedalus can touch `server/routes/`, `client/src/pages/`, `data/output-skills/_registry.json`; CANNOT touch `server/safety/`, `shared/schema.ts`, `package.json`, `vite.config.ts`, `.replit`)
- Branch-only writes; merge to main requires Bob's manual approval click
- Owner-notification email per commit with architect diff summary

### Cap-2: `platform_shell` tool (MAX risk class)
- Scoped shell allowlist: `psql SELECT ...`, `npm run check`, `npm run test`, `tsx scripts/<allowlisted>`, `git status`, `git diff`, `git log`
- Denylist: anything destructive without explicit jury approval (`rm`, `git push --force`, `psql ALTER|DROP|DELETE|UPDATE` without Bob)
- 60s timeout per command, captured stdout/stderr returned as wrapExternalContent-fenced blob
- Per-invocation logged to `agent_shell_audit` table (new) with persona, command, exit code, output hash

### Cap-3: **Daedalus persona** — the platform engineer
- Distinct from Felix. Felix = customer deliverables. Daedalus = VisionClaw self-modification.
- `safety_profile`:
  - `intentGate: "strict"`
  - `restrictedCategories: ["customer_work", "billing", "personal", "anything_not_explicit_platform_engineering"]`
  - `refusalCopy`: "I'm Daedalus — I build and modify VisionClaw itself. For customer deliverables, ask Felix."
- `allowed_tools`: `platform_edit_file`, `platform_shell`, `architect`, `runTest`, `jury_triage`, `ensemble_query`, `recall_capabilities`, `lookup_output_skill`, `web_fetch`, `web_search`, `firecrawl_*`, `outlook_*` (admin-only), `git_diff` (read-only)
- Goes through `new-persona-onboarding` skill (Bob's existing runbook)
- Voice profile + AHB regression test added in same PR

### Cap-4: Architect-in-runtime
- Wire `.local/skills/code_review` as a callable tool from inside the persona runtime
- Daedalus MUST call `architect()` on any diff before commit
- Architect findings tagged CRITICAL/HIGH auto-block commit; MEDIUM go to owner-notification; LOW recorded to `architect_findings` table
- Uses existing `architect-finding-triage` skill

### Cap-5: Deploy-and-verify loop
- Daedalus calls `suggest_deploy` only after green typecheck + green tests + green architect
- Auto-runs `production-verification` skill 60s post-deploy
- On failure: auto-rollback to prior checkpoint, owner-notification with full log
- On success: append to R-round log via `replit-md-maintenance` skill

## The two surfaces Daedalus MUST NEVER OWN

Even with all 5 capabilities, these remain Bob-only:

1. **Schema migrations on production** (`server/lib/migrations/`, `shared/schema.ts` primary-key changes). Bob's `schema-migration` skill says "prefer direct `psql ALTER`." Highest-blast-radius surface. Daedalus can PROPOSE migrations as draft PRs but the `psql` execution stays with Bob.

2. **AHB safety_profile relaxation** (`server/safety/destructive-tool-policy.ts`, `server/safety/intent-gate.ts`, `tests/security/ahb-regression.test.ts`). Hard-coded denylist in Daedalus's `platform_edit_file` allowlist. Bob's `security-hardening` skill: "Required reading before relaxing or removing any safety check." The recursive-self-improvement footgun lives here.

## Sequencing (5 R-rounds estimated)

| Round | What ships | Pre-req | Estimated session(s) |
|---|---|---|---|
| **R125+9** | `platform_edit_file` tool (sandbox + jury + rollback) | None | 2 |
| **R125+10** | `platform_shell` tool + `agent_shell_audit` table | R125+9 | 1 |
| **R125+11** | Daedalus persona + AHB regression test | R125+9, +10 | 1 |
| **R125+12** | Architect-in-runtime wiring | R125+11 | 1 |
| **R125+13** | Deploy-and-verify loop + production-verification skill autocall | R125+12 | 1 |

**Validation gate:** Daedalus must independently re-produce **all three R125+8.5 sprint projects** (Skills Catalog, Zombie Detector, AI-Native Audit) in a sandbox env from scratch, with zero main-agent edits, before shipping to main. If Daedalus can do it, Bob's vision is real.

## Anti-atrophy mechanics (Bob's R123-era preference)

> "If Bob notices himself rubber-stamping agent diffs without reading them — that's the atrophy alarm."

Mitigations baked into the design:
- Owner-notification email per Daedalus commit with architect diff summary (intentional friction)
- Weekly maintenance report: "Daedalus: 23 commits, 2 architect-flagged, 1 rolled back" (visibility)
- **Daily diff-review SLA**: Bob reads ≥1 Daedalus diff per business day. Calendared, not optional.
- Daedalus commits to a branch, never to main directly. Merge-to-main requires explicit Bob click.
- Quarterly: Bob hand-writes one platform-engineering change himself (skill retention drill).

## What Bob's role becomes (post-R125+13)

- **Stops:** writing routes, pages, schema scaffolds, deliverable contracts
- **Continues:** schema migrations on prod, AHB policy edits, strategic direction, picking which agent-proposed PRs ship
- **New:** reviewing Daedalus's daily diffs, approving merge-to-main, picking which capabilities Daedalus builds next

Bob's day shifts from "I built three features" to "I approved twelve agent-proposed features and rejected three." That's the Karpathy speedups-≠-just-faster preference applied to Bob himself.

## Why we're NOT building Daedalus first

The three R125+8.5 sprint projects (Skills Catalog, Zombie Agent Detector, AI-Native Readiness Audit) are the **specs Daedalus needs to be designed against**. Without real work to compare to, we'd design Daedalus in the abstract and over-engineer him. Greg Isenberg's Mar 10 thesis applies: "map the workflow end-to-end before you build."

So: ship the 3 projects with main-agent during R125+8.5. Each one becomes a documented "Daedalus workflow template" in `docs/daedalus-workflow-templates/`. Then R125+9 starts Daedalus-the-persona, with real test cases.

## Status

- 2026-05-24 — Doc created during R125+8.5 sprint planning. Bob approved roadmap.
- _R125+8.5 in progress: scaffolding Skills Catalog (this commit), Zombie Detector + AI-Native Audit next._
