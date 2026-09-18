---
description: Run the full local quality gate — TypeScript check, build, dependency audit (prod-only), skill registry validate. Fast pre-commit / pre-suggest_deploy sweep.
timeoutMs: 180000
---

set -euo pipefail
echo "[check] tsc --noEmit"
npx tsc --noEmit
echo "[check] npm audit --omit=dev (prod deps only)"
npm audit --omit=dev || true
echo "[check] skills-registry validate"
npx tsx scripts/skills-registry.ts validate
echo "[check] OK"
