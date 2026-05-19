// R74.13z-quat smoke test: verifies the context-overflow escalator returns
// the correct fallback chain order, skips already-tried models, never returns
// the same model that just failed, and returns null when the chain is exhausted.
//
// Pure function — no LLM calls, no DB, no network. Runs in <100ms.
import {
  getNextBigContextEscalation,
  isBigContextFallback,
  BIG_CONTEXT_FALLBACK_CHAIN,
} from "../server/context-overflow-escalator";

let failures = 0;
function expect(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`[ctx-esc] PASS — ${label}`);
  } else {
    failures++;
    console.error(`[ctx-esc] FAIL — ${label}${detail ? `\n         ${detail}` : ""}`);
  }
}

console.log(`[ctx-esc] chain length = ${BIG_CONTEXT_FALLBACK_CHAIN.length}`);
console.log(`[ctx-esc] chain order  = ${BIG_CONTEXT_FALLBACK_CHAIN.map(e => `${e.modelId}(${e.contextWindow / 1000000}M)`).join(" → ")}`);

// Test 1: from an arbitrary failing model with empty triedSet → top of chain
const tried1 = new Set<string>();
const r1 = getNextBigContextEscalation("gpt-5.4", tried1);
expect("first escalation from gpt-5.4 is Gemini 3.1 Pro (Bob's primary)", r1?.modelId === "gemini-3.1-pro-preview", `got=${r1?.modelId}`);
expect("first escalation reports 1M context window", r1?.contextWindow === 1_000_000, `got=${r1?.contextWindow}`);

// Test 2: after Gemini 3.1 Pro tried → Claude Opus 4.7 next
const tried2 = new Set<string>(["gemini-3.1-pro-preview"]);
const r2 = getNextBigContextEscalation("gemini-3.1-pro-preview", tried2);
expect("second escalation skips Gemini and returns Claude Opus 4.7", r2?.modelId === "claude-opus-4-7", `got=${r2?.modelId}`);

// Test 3: after Gemini + Claude tried → Nemotron 1M
const tried3 = new Set<string>(["gemini-3.1-pro-preview", "claude-opus-4-7"]);
const r3 = getNextBigContextEscalation("claude-opus-4-7", tried3);
expect("third escalation returns Nemotron 3 Super (1M cheap)", r3?.modelId === "nvidia/nemotron-3-super-120b-a12b", `got=${r3?.modelId}`);

// Test 4: after Gemini + Claude + Nemotron tried → Grok 4.1 Fast (2M)
const tried4 = new Set<string>(["gemini-3.1-pro-preview", "claude-opus-4-7", "nvidia/nemotron-3-super-120b-a12b"]);
const r4 = getNextBigContextEscalation("nvidia/nemotron-3-super-120b-a12b", tried4);
expect("fourth escalation returns Grok 4.20 Multi-Agent (2M last resort)", r4?.modelId === "x-ai/grok-4.20-multi-agent", `got=${r4?.modelId}`);
expect("fourth escalation reports 2M context window", r4?.contextWindow === 2_000_000, `got=${r4?.contextWindow}`);

// Test 5: all 4 tried → null (chain exhausted, fall through to truncation)
const tried5 = new Set<string>(["gemini-3.1-pro-preview", "claude-opus-4-7", "nvidia/nemotron-3-super-120b-a12b", "x-ai/grok-4.20-multi-agent"]);
const r5 = getNextBigContextEscalation("x-ai/grok-4.20-multi-agent", tried5);
expect("chain exhausted returns null (truncation falls through)", r5 === null, `got=${JSON.stringify(r5)}`);

// Test 6: never returns the same model that just failed even if not in triedSet
const tried6 = new Set<string>();
const r6 = getNextBigContextEscalation("gemini-3.1-pro-preview", tried6);
expect("same-model-as-current is skipped → returns Claude Opus 4.7", r6?.modelId === "claude-opus-4-7", `got=${r6?.modelId}`);

// Test 7: isBigContextFallback recognizes chain members and rejects others
expect("isBigContextFallback(gemini-3.1-pro-preview) === true", isBigContextFallback("gemini-3.1-pro-preview") === true);
expect("isBigContextFallback(claude-opus-4-7) === true", isBigContextFallback("claude-opus-4-7") === true);
expect("isBigContextFallback(gpt-5.4) === false", isBigContextFallback("gpt-5.4") === false);
expect("isBigContextFallback(gemini-2.5-flash) === false (not in escalation chain)", isBigContextFallback("gemini-2.5-flash") === false);

if (failures === 0) {
  console.log(`\n[ctx-esc] ALL TESTS PASSED — context-overflow escalator chain verified.`);
  process.exit(0);
} else {
  console.error(`\n[ctx-esc] ${failures} test(s) FAILED.`);
  process.exit(1);
}
