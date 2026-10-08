import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectStagnation } from "../../server/self-improvement";

test("detectStagnation rejects omitted or invalid tenant scope before querying", async () => {
  for (const tenantId of [undefined, 0, -1, 1.5, NaN]) {
    await assert.rejects(
      detectStagnation("prompt_optimization", tenantId as any),
      /positive tenantId is required/,
    );
  }
});

test("detectStagnation scopes its experiments query to the required tenant", () => {
  const source = readFileSync(
    new URL("../../server/self-improvement.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function detectStagnation");
  const end = source.indexOf("\nexport function autoSelectStrategy", start);
  const functionSource = source.slice(start, end);

  assert.match(
    functionSource,
    /\.where\(and\(eq\(experiments\.category, category\), eq\(experiments\.tenantId, tenantId\)\)\)/,
  );
});