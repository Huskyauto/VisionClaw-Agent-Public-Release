/**
 * Regression pin for the "premium PDF tool not exposed" incident (2026-08-03).
 *
 * Root cause: create_styled_report was registered ONLY under the "docs"
 * category while report/deliverable phrasings route the per-turn tool surface
 * to the "pdf" category — so delivery sessions mounted only the low-level
 * create_pdf and the premium styled-report tool was never callable.
 *
 * Invariants pinned here (pure, no DB, no network — server/tool-registry.ts
 * and static text scans only; NEVER import server/tools.ts or the router,
 * which pull in pg pools / embedding calls):
 *   1. create_styled_report is registered in BOTH "pdf" and "docs" categories.
 *   2. It stays flagged as product output.
 *   3. No server source references the nonexistent legacy name
 *      "create_styled_pdf" (stale-name drift is what confused personas).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { getToolMeta } from "../../server/tool-registry";

test("create_styled_report is surfaced via the pdf category (and docs)", () => {
  const meta = getToolMeta("create_styled_report");
  assert.ok(meta, "create_styled_report must be registered");
  assert.ok(
    meta!.categories.includes("pdf"),
    "create_styled_report must be in the 'pdf' category or report/deliverable routing never mounts it"
  );
  assert.ok(meta!.categories.includes("docs"), "keep 'docs' for document-y phrasings");
  assert.equal(meta!.isProductOutput, true);
});

test("no server source references the legacy name create_styled_pdf", () => {
  const roots = ["server", "shared"];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name) && fs.readFileSync(p, "utf8").includes("create_styled_pdf")) {
        offenders.push(p);
      }
    }
  };
  for (const r of roots) walk(path.join(process.cwd(), r));
  assert.deepEqual(offenders, [], `stale create_styled_pdf references: ${offenders.join(", ")}`);
});
