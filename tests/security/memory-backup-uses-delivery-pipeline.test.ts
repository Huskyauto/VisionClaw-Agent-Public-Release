/**
 * Regression for R123 post-edit-code-review HIGH finding (2026-05-21):
 *
 * The replit.md File Delivery HARD RULE: all human-facing file deliveries
 * (customers AND Bob himself) MUST flow through deliverDigitalProduct() so
 * the R110 +sec pre-delivery secret-scan gate runs and the customer gets the
 * standardized instant-play / self-hosted streaming URLs.
 *
 * `POST /api/memory/backup-to-drive` previously called `uploadAndShare()`
 * directly, bypassing both. This test pins the fix in source so a future
 * "let's just call uploadAndShare here, it's simpler" refactor regresses CI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("R123 post-fix — memory backup route does NOT call uploadAndShare/uploadToDrive directly", async () => {
  const src = await fs.readFile("server/routes/memory.ts", "utf8");
  // The backup route must not import uploadAndShare or uploadToDrive at all
  // — both bypass the secret-scan gate. delivery-pipeline.ts is the ONE
  // place that's allowed to import them.
  // Strip line comments so a "// uploadAndShare bypassed..." note in the
  // fix rationale doesn't false-positive this guard.
  const stripped = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(
    stripped,
    /\buploadAndShare\s*\(/,
    "server/routes/memory.ts must not call uploadAndShare() directly — route through deliverDigitalProduct() instead",
  );
  assert.doesNotMatch(
    stripped,
    /\buploadToDrive\s*\(/,
    "server/routes/memory.ts must not call uploadToDrive() directly — route through deliverDigitalProduct() instead",
  );
});

test("R123 post-fix — memory backup route uses deliverDigitalProduct", async () => {
  const src = await fs.readFile("server/routes/memory.ts", "utf8");
  assert.match(
    src,
    /deliverDigitalProduct\(/,
    "server/routes/memory.ts must use deliverDigitalProduct() for file delivery",
  );
});
