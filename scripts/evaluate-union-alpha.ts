#!/usr/bin/env -S npx tsx
/**
 * Privacy-bounded Union Alpha preview evaluation.
 *
 * This runner accepts no prompt or file arguments, reads no conversations,
 * repositories, or tenant data, and writes no history. It sends exactly the
 * three bundled synthetic fixtures through a pinned OpenRouter lane.
 *
 * Usage:
 *   UNION_ALPHA_SYNTHETIC_EVAL_ENABLED=1 npm run eval:union-alpha
 *   UNION_ALPHA_SYNTHETIC_EVAL_ENABLED=1 npm run eval:union-alpha -- --json
 */

import { runUnionAlphaSyntheticFixture } from "../server/providers";
import {
  UNION_ALPHA_SYNTHETIC_FIXTURES,
  scoreUnionAlphaFixture,
} from "../server/lib/union-alpha-eval-core";

const MODEL_ID = "stealth/union-alpha";
const allowedArgs = new Set(["--json"]);
const unknownArgs = process.argv.slice(2).filter((arg) => !allowedArgs.has(arg));
if (unknownArgs.length > 0) {
  console.error(`[union-alpha-eval] arbitrary inputs are refused: ${unknownArgs.join(", ")}`);
  process.exit(1);
}
if (process.env.UNION_ALPHA_SYNTHETIC_EVAL_ENABLED !== "1") {
  console.error("[union-alpha-eval] set UNION_ALPHA_SYNTHETIC_EVAL_ENABLED=1 for this owner-run synthetic evaluation");
  process.exit(1);
}

const results = [];
for (const fixture of UNION_ALPHA_SYNTHETIC_FIXTURES) {
  const output = await runUnionAlphaSyntheticFixture(fixture.id);
  results.push({
    id: fixture.id,
    kind: fixture.kind,
    ...scoreUnionAlphaFixture(fixture, output),
  });
}

const passed = results.filter((result) => result.passed).length;
const summary = {
  model: MODEL_ID,
  syntheticOnly: true,
  passed,
  total: results.length,
  verdict: passed === results.length ? "PASS" : "FAIL",
  results,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(summary));
} else {
  console.log(`[union-alpha-eval] ${summary.verdict}: ${passed}/${results.length} synthetic fixtures passed`);
  for (const result of results) {
    console.log(`- ${result.id}: ${result.passed ? "PASS" : "FAIL"} (${result.checksPassed}/${result.checksTotal})`);
  }
}
process.exitCode = summary.verdict === "PASS" ? 0 : 2;