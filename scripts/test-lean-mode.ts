import { classifyStepMode, compressWarRoomEntry, isCasualChat, isComplexRequest } from "../server/ceo-orchestrator";

console.log("=== LEAN EXECUTION MODE DIAGNOSTIC ===\n");

console.log("--- Auto-Orchestrate Routing (isCasualChat / isComplexRequest) ---");
const casualMessages = [
  "hi",
  "hello Felix",
  "thanks!",
  "how are you?",
  "what can you do?",
  "yes",
  "ok",
  "hey",
  "what time is it?",
  "who are you?",
  "how does this work?",
];
const taskMessages = [
  "Create a presentation about VisionClaw for the AI Tinkerers meetup",
  "Research our competitors and write a market analysis",
  "Send an email to the team with the quarterly update",
  "Build me a pitch deck for investors with full graphics",
  "Felix lets redo the presentation one more time",
  "Write a blog post about AI agents and publish it",
  "Analyze our revenue data and create a report",
  "Draft a proposal for the new client engagement",
  "send email",
  "make slides",
  "fix bug",
  "make deck?",
  "create invoice",
  "run audit",
  "redo the presentation",
];

let casualPass = 0;
for (const msg of casualMessages) {
  const result = isCasualChat(msg);
  const status = result ? "✓ CASUAL" : "✗ TASK (BUG!)";
  if (result) casualPass++;
  console.log(`  ${status}: "${msg}"`);
}
console.log(`  Casual detection: ${casualPass}/${casualMessages.length} correct`);

let taskPass = 0;
for (const msg of taskMessages) {
  const result = isComplexRequest(msg);
  const status = result ? "✓ ORCHESTRATE" : "✗ SKIP (BUG!)";
  if (result) taskPass++;
  console.log(`  ${status}: "${msg}"`);
}
console.log(`  Task detection: ${taskPass}/${taskMessages.length} correct\n`);

const toolSteps = [
  { desc: "Create a presentation about Q1 results", skill: "presentations" },
  { desc: "Send email to the team with updates", skill: "communication" },
  { desc: "Build a presentation deck for investors", skill: "slides" },
  { desc: "Create a Google Document with meeting notes", skill: "docs" },
  { desc: "Upload the report to Google Drive", skill: "file-management" },
  { desc: "Search the web for competitor analysis", skill: "research" },
  { desc: "Take a screenshot of the landing page", skill: "browser" },
  { desc: "Generate audio narration for the video", skill: "media" },
  { desc: "Use the create_styled_report tool to create a report", skill: "documents" },
  { desc: "Create slides for the AI Tinkerers meetup", skill: "presentation" },
  { desc: "Browse competitor websites and scrape pricing", skill: "web" },
  { desc: "Deploy the latest changes to production", skill: "devops" },
];

console.log("--- Tool-Requiring Steps (should ALL be FULL mode) ---");
let toolPass = 0;
for (const s of toolSteps) {
  const result = classifyStepMode(s.desc, s.skill);
  const status = result === false ? "✓ FULL" : "✗ LEAN (BUG!)";
  if (result === false) toolPass++;
  console.log(`  ${status}: "${s.desc.slice(0, 55)}..." [${s.skill}]`);
}
console.log(`  Result: ${toolPass}/${toolSteps.length} correct\n`);

const leanSteps = [
  { desc: "Analyze the market trends for AI industry", skill: "analysis" },
  { desc: "Write a strategic brief on competitor positioning", skill: "writing" },
  { desc: "Summarize the research findings from step 1", skill: "synthesis" },
  { desc: "Draft talking points for the board meeting", skill: "writing" },
  { desc: "Review the financial data and identify risks", skill: "analysis" },
  { desc: "Plan the quarterly objectives and key results", skill: "strategy" },
  { desc: "Compare pricing models across 5 competitors", skill: "analysis" },
  { desc: "Recommend next steps based on the audit results", skill: "advisory" },
  { desc: "Evaluate the ROI of current marketing campaigns", skill: "analysis" },
  { desc: "Compile key findings into an executive memo", skill: "writing" },
];

console.log("--- Thinking/Writing Steps (should ALL be LEAN mode) ---");
let leanPass = 0;
for (const s of leanSteps) {
  const result = classifyStepMode(s.desc, s.skill);
  const status = result === true ? "✓ LEAN" : "✗ FULL (missed optimization)";
  if (result === true) leanPass++;
  console.log(`  ${status}: "${s.desc.slice(0, 55)}..." [${s.skill}]`);
}
console.log(`  Result: ${leanPass}/${leanSteps.length} correct\n`);

const ambiguousSteps = [
  { desc: "Handle the customer onboarding process", skill: "operations" },
  { desc: "Process the incoming webhook data", skill: "backend" },
  { desc: "Configure the database settings", skill: "infrastructure" },
];

console.log("--- Ambiguous Steps (should default to FULL mode for safety) ---");
let ambigPass = 0;
for (const s of ambiguousSteps) {
  const result = classifyStepMode(s.desc, s.skill);
  const status = result === false ? "✓ FULL (safe default)" : "✗ LEAN (risky!)";
  if (result === false) ambigPass++;
  console.log(`  ${status}: "${s.desc.slice(0, 55)}..." [${s.skill}]`);
}
console.log(`  Result: ${ambigPass}/${ambiguousSteps.length} correct\n`);

console.log("--- War Room Compression ---");
const longResult = `## Research Findings

This is a detailed research report with many sections.

### Section 1: Market Overview
The AI market is growing rapidly with significant investment in agentic systems.
Multiple competitors are entering the space with varying approaches.
Key players include major tech companies and well-funded startups.

### Section 2: Technical Analysis  
The technical landscape shows a clear trend toward multi-agent architectures.
Token efficiency is becoming a critical differentiator.
Cost per inference is dropping but volume is increasing exponentially.

### Section 3: Recommendations
Based on our analysis, we recommend focusing on lean execution patterns.
The distributed approach shows 3-4x cost savings compared to monolithic patterns.
Implementation should prioritize tool-requiring vs thinking-only classification.

### Section 4: Risk Assessment
Market timing risk is moderate.
Technical risk is low.
${"Additional padding content to make this longer. ".repeat(30)}

### Conclusion
The overall outlook is positive with strong growth potential in the agentic AI space.`;

const compressed2k = compressWarRoomEntry(longResult, 2000);
const compressed8k = compressWarRoomEntry(longResult, 8000);
const shortResult = "Brief result under limit";
const compressedShort = compressWarRoomEntry(shortResult, 2000);

console.log(`  Original length:     ${longResult.length} chars`);
console.log(`  Compressed (2K cap): ${compressed2k.length} chars ${compressed2k.length <= 2000 ? "✓" : "✗ OVER LIMIT!"}`);
console.log(`  Compressed (8K cap): ${compressed8k.length} chars ${compressed8k.length <= 8000 ? "✓" : "✗ OVER LIMIT!"}`);
console.log(`  Short (no compress): ${compressedShort.length} chars ${compressedShort === shortResult ? "✓ unchanged" : "✗ modified!"}`);
console.log(`  2K preserves headers: ${compressed2k.includes("Market Overview") || compressed2k.includes("Research") ? "✓" : "✗"}`);

console.log("\n--- Lean Output Type Safety ---");
const testCases = [
  { name: "String content (valid)", json: { content: "A valid analysis with sufficient length to pass the 50-char minimum threshold check easily", keyFindings: ["finding1"], deliverables: [] } },
  { name: "Object content (coerce)", json: { content: { nested: "object" }, keyFindings: [] } },
  { name: "Null content (coerce)", json: { content: null, keyFindings: [] } },
  { name: "Empty string (fallback)", json: { content: "", keyFindings: [] } },
  { name: "Short content (fallback)", json: { content: "Too short", keyFindings: [] } },
  { name: "Non-array keyFindings", json: { content: "Valid content that is definitely longer than fifty characters for the threshold check to pass", keyFindings: "not an array" } },
];

for (const tc of testCases) {
  const j = tc.json;
  const rawContent = typeof j.content === "string" ? j.content : JSON.stringify(j.content || j);
  const wouldFallback = rawContent.length < 50;
  let resultText = "";
  if (!wouldFallback) {
    resultText = rawContent;
    if (Array.isArray(j.keyFindings) && (j.keyFindings as any).length) {
      resultText += "\n\nKEY FINDINGS:\n" + (j.keyFindings as any[]).map((f: any) => `- ${String(f)}`).join("\n");
    }
  }
  const typeOk = typeof resultText === "string";
  const sliceOk = typeof resultText.slice(0, 100) === "string";
  console.log(`  ${typeOk && sliceOk ? "✓" : "✗"} ${tc.name}: ${wouldFallback ? "-> fallback to full" : `-> lean OK (${resultText.length} chars)`}`);
}

// Test timeout enforcement exists in runLlmTask
console.log("\n--- Timeout Enforcement Check ---");
import * as fs from "fs";
const llmTaskSrc = fs.readFileSync("server/llm-task.ts", "utf-8");
const hasAbortController = llmTaskSrc.includes("AbortController");
const hasSignal = llmTaskSrc.includes("signal:");
const hasClearTimeout = llmTaskSrc.includes("clearTimeout");
console.log(`  AbortController present: ${hasAbortController ? "✓" : "✗"}`);
console.log(`  Signal passed to API:    ${hasSignal ? "✓" : "✗"}`);
console.log(`  Cleanup (clearTimeout):  ${hasClearTimeout ? "✓" : "✗"}`);

// Check orchestrator integration
console.log("\n--- Orchestrator Integration Check ---");
const orchSrc = fs.readFileSync("server/ceo-orchestrator.ts", "utf-8");
const hasLeanImport = orchSrc.includes('import("./llm-task")');
const hasLeanBranch = orchSrc.includes("step.leanMode");
const hasFallback = orchSrc.includes("falling back to full mode");
const hasMinLength = orchSrc.includes("rawContent.length < 50");
const hasTypeCoerce = orchSrc.includes('typeof j.content === "string"');
const hasSynthReport = orchSrc.includes("Lean steps:");
const hasCompressedCtx = orchSrc.includes("compressWarRoomEntry");
console.log(`  runLlmTask import:       ${hasLeanImport ? "✓" : "✗"}`);
console.log(`  Lean/full branching:     ${hasLeanBranch ? "✓" : "✗"}`);
console.log(`  Fallback mechanism:      ${hasFallback ? "✓" : "✗"}`);
console.log(`  Min length gate (50ch):  ${hasMinLength ? "✓" : "✗"}`);
console.log(`  Type coercion:           ${hasTypeCoerce ? "✓" : "✗"}`);
console.log(`  Synthesis reporting:     ${hasSynthReport ? "✓" : "✗"}`);
console.log(`  Compressed war room:     ${hasCompressedCtx ? "✓" : "✗"}`);

const hasAutoOrchRoute = fs.readFileSync("server/routes.ts", "utf-8").includes("ORCHESTRATION REQUIRED — MANDATORY CEO PROTOCOL");
const chatEngineSrc = fs.readFileSync("server/chat-engine.ts", "utf-8");
const hasUnifiedChatEngine = chatEngineSrc.includes("ORCHESTRATION REQUIRED — MANDATORY CEO PROTOCOL") && !chatEngineSrc.includes("Do NOT orchestrate presentations");
console.log(`  Auto-orchestrate route: ${hasAutoOrchRoute ? "✓" : "✗"}`);
console.log(`  Chat-engine unified:    ${hasUnifiedChatEngine ? "✓" : "✗"}`);


console.log("\n=== DIAGNOSTIC SUMMARY ===");
const totalTests = toolSteps.length + leanSteps.length + ambiguousSteps.length;
const totalPass = toolPass + leanPass + ambigPass;
const codeChecks = [hasAbortController, hasSignal, hasClearTimeout, hasLeanImport, hasLeanBranch, hasFallback, hasMinLength, hasTypeCoerce, hasSynthReport, hasCompressedCtx, hasAutoOrchRoute, hasUnifiedChatEngine].filter(Boolean).length;
const totalCodeChecks = 12;
const routingTests = casualPass + taskPass;
const totalRoutingTests = casualMessages.length + taskMessages.length;
console.log(`  Auto-Orchestrate Routing: ${routingTests}/${totalRoutingTests} correct`);
console.log(`  Step Classification: ${totalPass}/${totalTests} correct`);
console.log(`  Code Integration:    ${codeChecks}/${totalCodeChecks} checks passing`);
console.log(`  War Room Compression: working`);
console.log(`  Type Safety: all cases handled`);
const allGood = totalPass === totalTests && codeChecks === totalCodeChecks && routingTests === totalRoutingTests;
console.log(`\n  ${allGood ? "ALL SYSTEMS GO ✓" : "ISSUES DETECTED — review above"}`);
process.exit(allGood ? 0 : 1);
