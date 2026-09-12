import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MODEL_REGISTRY } from "../../server/model-registry";

test("retired Hy3 is not offered as a selectable model", () => {
  assert.equal(
    MODEL_REGISTRY.some((model) => model.id === "tencent/hy3:free"),
    false,
    "the removed OpenRouter endpoint must not remain selectable",
  );
});

test("current public model totals match the selectable registry", () => {
  const expected = MODEL_REGISTRY.length;
  const root = resolve(import.meta.dirname, "..", "..");
  const releaseFacts = JSON.parse(
    readFileSync(resolve(root, "docs/release-facts.json"), "utf8"),
  ) as { metrics: { coreRegistryModels: number } };
  const updates = JSON.parse(
    readFileSync(resolve(root, "client/src/data/updates.json"), "utf8"),
  ) as Array<{ version: string; highlights: Array<{ text: string }> }>;
  const currentUpdate = updates.find(
    (update) => update.version === "Round 125+155.11",
  );
  const replit = readFileSync(resolve(root, "replit.md"), "utf8");
  const currentRelease = replit.match(
    /## R125\+155\.11[\s\S]*?(?=\n## R125\+155\.10)/,
  )?.[0];
  const landing = readFileSync(
    resolve(root, "client/src/pages/landing.tsx"),
    "utf8",
  );
  const seo = readFileSync(
    resolve(root, "client/src/components/seo-head.tsx"),
    "utf8",
  );

  assert.equal(releaseFacts.metrics.coreRegistryModels, expected);
  assert.ok(currentUpdate, "current changelog entry must exist");
  assert.match(
    currentUpdate.highlights.map((item) => item.text).join("\n"),
    new RegExp(`from ${expected + 1} to ${expected} curated`, "i"),
  );
  assert.match(currentRelease ?? "", new RegExp(`from ${expected + 1} to ${expected} models`, "i"));
  assert.match(
    replit,
    new RegExp(`Current platform total:[^\\n]*${expected} curated models`, "i"),
  );
  assert.match(
    landing,
    new RegExp(`Platform Online[^\\n]*${expected} Curated Models`),
  );
  assert.match(
    seo,
    new RegExp(`R125\\+155\\.11:[^\\n]*${expected} curated AI models`, "i"),
  );
});