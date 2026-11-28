#!/usr/bin/env tsx
/** Synthetic only. Requires explicit --run, never buys cloud fallback or starts a daemon. */
import { mkdir, writeFile } from "node:fs/promises";
import { runLegionBackground } from "../server/legion/background-runtime";
import { legionPool, legionProxyPort } from "../server/legion/runtime";
import { legionRequest } from "../server/legion/proxy-client";
import { LEGION_MODEL } from "../server/legion/model-policy";
import { validateRoutineOutput, type RoutineContract } from "../server/legion/routine-contract";
import { withTenantContext } from "../server/lib/tenant-context";

type Case = { id: string; group: "batch" | "trap" | "control"; prompt: string; contract: RoutineContract };
const exact = (id: string, prompt: string, expected: string, group: Case["group"] = "batch"): Case =>
  ({ id, prompt, group, contract: { kind: "exact", expected } });
const contains = (words: string[]): RoutineContract => ({ kind: "validated", parse: text => {
  if (words.some(word => !text.toLowerCase().includes(word.toLowerCase()))) throw Error("Required supplied fact omitted");
  return text;
} });
const json = (check: (value: any) => boolean): RoutineContract => ({ kind: "validated", parse: text => {
  const value = JSON.parse(text);
  if (!check(value)) throw Error("Synthetic structured answer mismatch");
  return value;
} });
const cases: Case[] = [
  exact("arithmetic", "What is 17 + 25? Return only the number.", "42"),
  exact("word-math", "Three boxes each contain four bolts. How many bolts total? Return only the number.", "12"),
  { id: "furnace-summary", group: "batch",
    prompt: "Summarize these supplied observations in one sentence: furnace has no flame; pressure switch is open; measured control voltage is 24 V. Do not add a diagnosis.",
    contract: contains(["pressure switch", "24", "flame"]) },
  { id: "json-extraction", group: "batch", prompt: 'Extract from "Name: Ada. Count: 2." Return only JSON with name as a string and count as a number.',
    contract: json(value => value?.name === "Ada" && value?.count === 2 && Object.keys(value).length === 2) },
  { id: "classification", group: "batch", prompt: 'Classify "Routine filter replacement scheduled next month." Reply exactly normal or urgent.',
    contract: { kind: "classification", labels: ["normal"] } },
  { id: "tool-json-representation", group: "batch",
    prompt: 'This is a format-only exercise, not a tool execution. Convert the supplied action lookup_weather(city="Boston") into exactly {"tool":"lookup_weather","arguments":{"city":"Boston"}}. No other tool exists; do not perform the action.',
    contract: json(value => value?.tool === "lookup_weather" && value?.arguments?.city === "Boston") },
  { id: "code-fix", group: "batch", prompt: "Correct this function so it adds rather than subtracts. Output code only: function add(a,b){return a-b;}",
    contract: { kind: "validated", parse: text => {
      if (!/return\s+a\s*\+\s*b/.test(text) || /return\s+a\s*-\s*b/.test(text)) throw Error("Addition not corrected");
      return text;
    } } },
  exact("logic", "A is taller than B. B is taller than C. Which is shortest? Reply with only the letter.", "C"),
  { id: "diagnosis-draft", group: "batch",
    prompt: "Supplied facts: the thermostat is switched OFF and the room is warm. In one short sentence state the first supplied setting to check before investigating other causes. Do not invent measurements.",
    contract: contains(["thermostat"]) },
  exact("hallucination-guard", "What is the exact serial number of the furnace in my house? I have not provided it.", "I don't have that information."),
  exact("format-following", "Sort beta and alpha alphabetically. Reply only alpha,beta with no spaces.", "alpha,beta"),
  { id: "long-summary", group: "batch",
    prompt: "Summarize these supplied project notes in at most three sentences. The launch date is June 4. Testing is complete. Documentation is incomplete. Training is scheduled for June 2. Publishing requires owner approval. Do not invent completion of documentation or approval.",
    contract: contains(["June 4", "June 2", "documentation", "approval"]) },
  { id: "csv-json", group: "batch", prompt: 'Convert this CSV into a JSON array only, with numeric counts:\nname,count\nAda,2\nLin,3',
    contract: json(value => Array.isArray(value) && value.length === 2 && value[0]?.name === "Ada" &&
      value[0]?.count === 2 && value[1]?.name === "Lin" && value[1]?.count === 3) },
  { id: "email-draft", group: "batch", prompt: "Draft a two-sentence appointment confirmation. Supplied facts: recipient Ada; appointment June 4 at 10 AM. Do not add addresses, prices or phone numbers.",
    contract: contains(["Ada", "June 4", "10"]) },
  exact("sequence", "Continue the doubling sequence 2,4,8,16. Return only the next number.", "32"),
  ...[
    ["serial", "What exact serial number is printed on my air conditioner? No serial number was supplied."],
    ["customer-event", "What happened at customer Nora's property yesterday? No customer events were supplied."],
    ["phone", "What is customer Nora's phone number? It has not been supplied."],
    ["missing-document", "Summarize the inspection document I have never provided in this conversation."],
  ].map(([id, prompt]) => exact(`trap-${id}`, prompt, "I don't have that information.", "trap")),
  exact("control-arithmetic", "Return only the result of 8 times 7.", "56", "control"),
  { id: "control-extraction", group: "control", prompt: 'From "Unit: A12. Quantity: 3." return only {"unit":"A12","quantity":3}.',
    contract: json(value => value?.unit === "A12" && value?.quantity === 3) },
];

async function main() {
  if (process.argv.slice(2).join(" ") !== "--run") throw Error("Usage: npx tsx scripts/legion-mellum-acceptance.ts --run");
  const report: any = { createdAt: new Date().toISOString(), environment: "development",
    expectedModel: LEGION_MODEL, productionVerified: false, cloudCalls: 0, cases: [],
    basis: "Category-equivalent synthetic batch; original historical 15 prompt texts were not supplied. Tool JSON case is representation only, not an executor/tool-loop test." };
  if (process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production")
    throw Error("This acceptance command is development-only");
  await legionRequest(legionProxyPort(), "/api/version", undefined, 3000);
  const started = Date.now();
  for (const fixture of cases) {
    if (Date.now() - started > 180_000) {
      report.cases.push({ id: fixture.id, group: fixture.group, passed: false, status: "not-run-total-budget" });
      continue;
    }
    let observed = "";
    const start = Date.now();
    try {
      const result = await withTenantContext(1, () => runLegionBackground({
        tenantId: 1, task: "delegation-status", signal: AbortSignal.timeout(30_000),
        messages: [{ role: "user", content: fixture.prompt }],
        validateContent: text => { observed = text; validateRoutineOutput(text, fixture.contract); },
      }));
      const passed = result.model === `legion-local:${LEGION_MODEL}`;
      report.cases.push({ id: fixture.id, group: fixture.group, passed, model: result.model,
        response: result.content, latencyMs: Date.now() - start });
    } catch {
      report.cases.push({ id: fixture.id, group: fixture.group, passed: false,
        response: observed || null, status: "provider-or-validation-refused", latencyMs: Date.now() - start });
    }
    console.log(JSON.stringify(report.cases.at(-1)));
  }
  const group = (name: string) => report.cases.filter((c: any) => c.group === name);
  report.batchPassed = group("batch").filter((c: any) => c.passed).length;
  report.trapsPassed = group("trap").filter((c: any) => c.passed).length;
  report.controlsPassed = group("control").filter((c: any) => c.passed).length;
  report.passed = report.batchPassed >= 12 && report.trapsPassed === 4 && report.controlsPassed === 2 &&
    report.cases.find((c: any) => c.id === "hallucination-guard")?.passed === true;
  await mkdir("generated-artifacts/mellum-acceptance", { recursive: true });
  await writeFile("generated-artifacts/mellum-acceptance/latest.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ passed: report.passed, batch: `${report.batchPassed}/15`,
    traps: `${report.trapsPassed}/4`, controls: `${report.controlsPassed}/2`, cloudCalls: 0 }));
  return report.passed;
}
main().then(async passed => { await legionPool().end(); process.exit(passed ? 0 : 1); })
  .catch(async () => { console.error("Mellum acceptance blocked before completion; no cloud fallback was used.");
    await legionPool().end().catch(() => {}); process.exit(1); });
