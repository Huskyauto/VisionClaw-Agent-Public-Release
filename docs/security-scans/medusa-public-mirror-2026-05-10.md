# MEDUSA Security Scan — Public Mirror — 2026-05-10

**Tool:** [MEDUSA v2026.5.4](https://github.com/Pantheon-Security/medusa) (AGPL-3.0)
**Target:** `Huskyauto/VisionClaw-Agent-Public-Release` (scanned via local `public-mirror/`)
**Scan scope:** AI-attack-surface files only — `SKILL.md`, `AGENTS.md`, `.mcp.json` (3 files, 443 LOC)
**Scanners run:** 10 of 78 (gitleaks not installed)
**Rules applied:** 9,600+

## Result: ALL FINDINGS ARE FALSE POSITIVES

MEDUSA flagged 15 issues (1 CRITICAL, 7 HIGH, 7 MEDIUM) with security_score 41 / risk_level CRITICAL. After line-by-line triage of every flag, **all 15 are false positives** firing on our public API documentation.

| Severity | Count | Pattern | Triage |
|----------|-------|---------|--------|
| CRITICAL | 1 | "Reverse Shell Injection" line 133 | FP — JSON example: `"toolsUsed": ["web_search", "create_spreadsheet"]` |
| HIGH | 7 | "HTTP header-based exfiltration" | FP — every hit is `curl -H "Authorization: Bearer $VISIONCLAW_API_KEY"` (documented public API auth) |
| MEDIUM | 7 | "prompt-injection-code-generation-trigger-keywords" | FP — keywords like "discovery", "list", "poll" in API endpoint descriptions |

All findings cluster in `public-mirror/claude-skill/visionclaw/SKILL.md`. The other 2 files (`public-mirror/AGENTS.md`, `public-mirror/.mcp.json`) returned zero findings.

## What this scan did NOT cover

- **Private skills** (`.agents/skills/*/SKILL.md`, `.local/skills/*/SKILL.md`) — sandbox repeatedly OOM-killed batched scans (exit 137). Lower priority since not externally published. Recommended: run on personal box if ever needed.
- **External skill repos** (`midudev/autoskills`, `geekforbrains/harbour`, `jo-inc/camofox-browser`, `charlie947/social-media-skills`) — not cloned locally. Recommended: scan upstream before any future skill imports.
- **Repository-level checks** (gitleaks for secrets in git history) — linter not installed.

## Recommendation

**No action required.** Public mirror is clean. MEDUSA's `AIContextScanner` has high FP rate against legitimate API documentation that uses common security-adjacent vocabulary (Bearer tokens, curl, JSON examples). Consider re-running on demand rather than as part of weekly maintenance.

## Why MEDUSA was not vendored into VisionClaw

AGPL-3.0 license. Running it externally as a one-off scanner is fine; vendoring would force VisionClaw itself to AGPL.
