// Completion-judge fraud probe (fable-method borrow, live-LLM half).
//
// Runs the REAL independent completion judge against the seeded-fraud fixtures
// in data/eval/fraud-fixtures.json and reports which planted frauds it caught.
// The CI test (tests/agentic/completion-fraud-fixtures.test.ts) covers the
// deterministic layer network-free; THIS script is the on-demand proof that the
// LLM judge itself refuses lying reports (fabricated links, scope swaps).
//
// Usage:  npx tsx scripts/completion-judge-fraud-probe.ts
// Env:    FRAUD_PROBE_TENANT (default 1) — tenant billed for judge calls.
// Exit:   0 = all fraud cases refused AND honest control passed
//         2 = one or more FRAUD cases got a clean "done" (judge fooled)
//         3 = honest control was wrongly refused (judge too paranoid)
//         4 = fixture/load error
//
// Cost: one cheap judge LLM call per case (~5 cases). Not wired into CI.

import fs from "node:fs";
import path from "node:path";
import { evaluateCompletion } from "../server/agentic/completion-evaluator";

async function main() {
  const tenantId = Number(process.env.FRAUD_PROBE_TENANT || 1);
  const fixturePath = path.join(process.cwd(), "data", "eval", "fraud-fixtures.json");
  let cases: any[];
  try {
    cases = JSON.parse(fs.readFileSync(fixturePath, "utf8")).cases;
    if (!Array.isArray(cases) || !cases.length) throw new Error("no cases");
  } catch (e: any) {
    console.error(`[fraud-probe] cannot load fixtures: ${e?.message || e}`);
    process.exit(4);
  }

  let fooled = 0;
  let paranoid = 0;
  for (const c of cases) {
    // Degraded-judge cases are deterministic-layer territory (CI test); skip live.
    if (c.judgeDegraded) continue;
    const verdict = await evaluateCompletion(c.contract, c.evidence, { tenantId });
    const isFraud = (c.plantedFrauds || []).length > 0;
    const clean = verdict.verdict === "done" && !verdict.evaluatorDegraded;
    const caught = !clean;
    if (verdict.evaluatorDegraded) {
      console.log(`~ ${c.id}: judge DEGRADED (no LLM verdict) — inconclusive`);
      continue;
    }
    if (isFraud && !caught) {
      fooled++;
      console.error(`✗ ${c.id}: JUDGE FOOLED — lying report passed as "${verdict.verdict}" (${verdict.reason})`);
      console.error(`  planted frauds missed: ${(c.plantedFrauds || []).join(" | ")}`);
    } else if (!isFraud && caught) {
      paranoid++;
      console.error(`✗ ${c.id}: FALSE POSITIVE — honest run refused as "${verdict.verdict}" (${verdict.reason})`);
    } else {
      console.log(`✓ ${c.id}: ${isFraud ? `fraud caught (verdict=${verdict.verdict})` : "honest control passed"} — ${verdict.reason.slice(0, 160)}`);
      if (isFraud && verdict.unmetCriteria?.length) {
        console.log(`  judge cited: ${verdict.unmetCriteria.join(" | ").slice(0, 300)}`);
      }
    }
  }

  if (fooled) { console.error(`[fraud-probe] FAIL: judge fooled on ${fooled} case(s)`); process.exit(2); }
  if (paranoid) { console.error(`[fraud-probe] FAIL: judge false-positived on ${paranoid} honest case(s)`); process.exit(3); }
  console.log(`[fraud-probe] PASS: all fraud cases refused, honest control passed`);
  process.exit(0);
}

main().catch(e => { console.error(`[fraud-probe] fatal: ${e?.message || e}`); process.exit(4); });
