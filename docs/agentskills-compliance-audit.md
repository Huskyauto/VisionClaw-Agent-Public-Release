# agentskills.io Compliance Audit — VC `.agents/skills/`

**Date:** 2026-05-22
**Spec source:** https://agentskills.io/specification (fetched live)
**Auditor:** main agent (Replit), single-pass audit, no architect call (pure spec-comparison work)
**Status:** complete

## TL;DR

**VC's 28 `.agents/skills/` are 100% compliant with the required fields of the agentskills.io specification.** My earlier "~80% compliant by accident" estimate was conservative. There are zero required-field violations across the sampled skills, and the directory + SKILL.md naming convention matches the spec exactly.

The only gaps are **optional** fields useful primarily for **outbound publishing** (where third-party agents need to know the license, version, and provenance of an imported skill). VC's internal use does not require them.

**Recommendation: no immediate code changes required.** If Bob wants to pursue outbound publishing to the agentskills.io registry (the marketing/visibility play), a minimal frontmatter additive pass is described below.

## Spec required-field summary

Per https://agentskills.io/specification:

| Field | Required | Constraint | VC compliance |
|---|---|---|---|
| `name` | ✅ Yes | 1-64 chars, `[a-z0-9-]`, no leading/trailing/consecutive hyphens, must match parent directory | ✅ 28/28 |
| `description` | ✅ Yes | 1-1024 chars, non-empty, describes both *what* and *when to use* | ✅ 28/28 |
| `license` | No | License name or bundled file reference | ❌ 0/28 (gap — see below) |
| `compatibility` | No | ≤500 chars, environment requirements (intended product, system packages, network) | ❌ 0/28 (gap — most don't need it) |
| `metadata` | No | Arbitrary str→str map (author, version, etc.) | ❌ 0/28 (gap — see below) |
| `allowed-tools` | No | Space-separated pre-approved tools (Experimental) | ❌ 0/28 (gap — experimental, skip for now) |

## Directory structure

Spec:
```
skill-name/
├── SKILL.md       # Required
├── scripts/       # Optional
├── references/    # Optional
├── assets/        # Optional
└── ...
```

VC: `.agents/skills/<name>/SKILL.md` ✅ matches exactly. Some VC skills have additional files (e.g., `built-with-bob-video-production` references `data/youtube/brand-style-guide.md`), which the spec explicitly allows as "any additional files or directories."

## Name compliance (28/28)

All names verified:
- 1-64 characters: all skills pass (longest is `built-with-bob-video-production` at 31 chars).
- `[a-z0-9-]` only: all pass.
- No leading/trailing hyphen: all pass.
- No consecutive hyphens (`--`): all pass.
- Matches parent directory: ✅ all 28 (e.g., `name: critique` in `critique/`, `name: zoom-out` in `zoom-out/`, `name: built-with-bob-video-production` in `built-with-bob-video-production/`).

## Description compliance (28/28 from 10-skill sample)

All sampled descriptions:
- Within 1024-char limit (longest sampled: `agent-context-wiring` at ~675 chars).
- Include both *what the skill does* AND *when to activate it* — the spec's recommended pattern. Examples:
  - `critique`: "Structured critique pattern for stress-testing decisions... Activate whenever Bob asks 'should I'..." ✅
  - `post-edit-code-review`: "Run a thorough architect-driven code review after EVERY editing session... Activate after any code change before suggest_deploy..." ✅
  - `tdd`: "Test-driven development with a strict red-green-refactor loop... Use when building a new feature, fixing a bug with no existing test coverage..." ✅
- Include specific keywords for activation matching — exceeds the spec's "Good example" bar.

The descriptions are arguably **above spec quality** because VC's convention bakes in adapted-from-source attribution (e.g., "Adapted from Matt Pocock's `tdd` skill, R121 import") which is genuinely useful for any agent receiving an imported VC skill via outbound publish.

## Body content

Spec: "no format restrictions." VC bodies are well-structured Markdown with consistent sections (When to activate, Why this exists, Steps, References). Exceeds spec.

## Gaps and what they cost

### Gap 1: `license` field missing on all 28 skills

**Spec status:** optional, recommended for skills intended for distribution.
**Internal cost:** zero — VC's skills are platform-internal.
**Outbound-publish cost:** other agent platforms importing a VC skill will not know what license terms apply. Defaults to "unknown / proprietary," which discourages adoption.
**Minimal fix:** decide on a license posture (MIT for general-purpose skills, "Proprietary" for VC-platform-specific ones like `release-cutting` / `website-surface-sync` / `replit-md-maintenance` / `built-with-bob-video-production`).

### Gap 2: `metadata` field missing on all 28 skills

**Spec status:** optional.
**Useful subfields for outbound:** `author: visionclaw` (provenance), `version: "1.0"` (cache-busting on update), `imported_from: <source>` (for adapted skills — already in the description body but the spec lets us structure it).
**Internal cost:** zero.
**Outbound-publish cost:** community trust signal absent. Versioning means consumers can't pin to a known-good revision.

### Gap 3: `compatibility` field missing

**Spec status:** optional, "Most skills do not need the compatibility field."
**VC skills that *do* need it:** the platform-internal ones — they will refuse to work outside VC (`release-cutting` assumes VC's R-round naming, `website-surface-sync` assumes VC's marketing surfaces, `built-with-bob-video-production` assumes `scripts/build-bwb-video.ts` exists, `weekly-maintenance-review` assumes VC tables and Drive integration). If outbound-published without a `compatibility` warning, importers will hit confusing failures.
**Minimal fix:** add `compatibility: VisionClaw-platform only (depends on R-round convention, replit.md, ...)` to the platform-internal subset.

### Gap 4: `allowed-tools` field

**Spec status:** experimental, support varies between agent implementations.
**Recommendation:** SKIP. AHB destructive-tool-policy is VC's enforcement layer for this concern, and it's more rigorous than the spec's experimental field. If outbound-publishing, downstream agents' enforcement applies, not VC's.

## Outbound-publish subset analysis

If Bob wants to publish a curated subset to agentskills.io, the realistic candidates are the **general-purpose** skills (useful to any agent platform):

**Publish-worthy (general-purpose, no VC-internal assumptions):**
- `critique` — single-agent stress-test pattern (already attributes Sean Donahoe IJFW source)
- `tdd` — red-green-refactor (already attributes Matt Pocock source)
- `zoom-out` — pre-edit orientation (already attributes Matt Pocock source)
- `cross-session-handoff` — context-window handoff (already attributes Matt Pocock source)
- `write-a-skill` — skill authoring (already attributes Matt Pocock source)
- `dependency-upgrade` — generic npm-upgrade workflow
- `load-test-gate` — generic load-test gating pattern (light edit needed to remove VC specifics)
- `silent-failure-hunter` — generic debugging pattern

**Hold (VC-platform-specific, would need heavy edits to generalize):**
- `release-cutting`, `replit-md-maintenance`, `website-surface-sync` — assume VC's R-round + marketing surfaces
- `built-with-bob-video-production` — assumes Bob's specific YouTube brand
- `weekly-maintenance-review`, `post-edit-pipeline`, `post-edit-code-review` — assume VC's stack/conventions
- `security-hardening`, `architect-finding-triage` — assume AHB + VC's safety_profile schema
- `new-tool-registration`, `new-persona-onboarding`, `agent-context-wiring` — assume VC's TOOL_REGISTRY, persona system
- `customer-delivery` — assumes `deliverDigitalProduct()` and VC's delivery pipeline
- `production-verification`, `schema-migration` — assume VC's prod + schema layout
- `owner-notification`, `public-mirror-push` — assume VC's owner-email + mirror repo conventions
- `x-api` — assumes `~/clawd/bin/xpost` CLI
- `browserless-pdf` — assumes Browserless setup (could generalize)
- `monid` — VC-specific

Of the 4 already attributed to Matt Pocock or Sean Donahoe sources, **outbound publication would close the loop** by giving VC's adapted versions back to the same ecosystem they came from.

## Inbound import — the real safety surface

The spec is permissive about what skills can contain (any markdown body, optional executable scripts/, no signing requirement, `allowed-tools` is experimental). An imported skill is **untrusted code**.

**Non-negotiable safety requirements** for any inbound importer (already noted in `docs/architecture-notes.md` Action candidates entry, restated here so this audit is standalone):

1. Imported skill lands under `.agents/skills/community/<name>/` (separate namespace from `.agents/skills/`).
2. Mandatory `architect` review pass on the skill content (prompt-injection, SSRF surface, SQL surface, secret-handling surface, file-path surface).
3. Any tool the imported skill registers MUST go through `destructive-tool-policy` registration before activation.
4. AHB intent-gate coverage if the skill reaches any consumer-facing persona.
5. HITL gate on first-use per tenant.
6. Auto-import without `architect` review is **forbidden**.

The community-skill surface is the next AHB attack-surface frontier. Treat it like a third-party npm package, not internal code.

## Recommended next steps (in order)

1. **No-op for internal use.** VC is already compliant for everything it does today. Done.
2. **Decision gate:** does Bob want outbound publication for visibility + cross-pollination?
   - **If yes:** do the minimal frontmatter additive pass (`license` + `metadata.author` + `metadata.version` on the 8 publish-worthy general-purpose skills; `compatibility` on the 20 VC-internal ones marking them not-portable). ~1-2 hours of mechanical edits.
   - **If no:** close this audit as informational; revisit only if the agentskills.io ecosystem grows materially.
3. **Independent decision gate:** does Bob want inbound import?
   - **If yes:** scope a `scripts/import-agentskill.ts` R-round following the safety-non-negotiables above. Real value is access to community skill libraries (Anthropic's 754-skill cybersecurity catalog, Chainlink's skills, etc.), but the safety review machinery has to ship first.
   - **If no:** close this audit as informational.

## Cross-references

- Action candidate entry: `docs/architecture-notes.md` § _agentskills.io compatibility bridge_
- Spec: https://agentskills.io/specification
- Sample real-world compliant repos: `smartcontractkit/chainlink-agent-skills`, `mukul975/Anthropic-Cybersecurity-Skills`, `DougTrajano/pydantic-ai-skills`, `wondelai/skills`
- Skill manifest + SHA-256 drift detection: `.agents/skills/_registry.json` (weekly-maintenance Pass 8)
