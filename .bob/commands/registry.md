---
description: Refresh the skills registry — regenerate SHA-256 manifest from disk, then validate. Run after editing any file under .agents/skills/.
timeoutMs: 60000
---

set -euo pipefail
echo "[registry] manifest"
npx tsx scripts/skills-registry.ts manifest
echo "[registry] validate"
npx tsx scripts/skills-registry.ts validate
echo "[registry] OK — re-run audit if a new skill was added: npx tsx scripts/skills-registry.ts audit"
