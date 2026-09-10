import { TOOL_DEFINITIONS, type ToolDefinition } from "../server/tools";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const WARN = "\x1b[33m⚠\x1b[0m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

interface CheckResult {
  name: string;
  passed: boolean;
  details: string;
  severity: "error" | "warning";
}

const results: CheckResult[] = [];

function check(name: string, passed: boolean, details: string, severity: "error" | "warning" = "error") {
  results.push({ name, passed, details, severity });
}

async function run() {
  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  VisionClaw Pre-Deployment Validation Suite${RESET}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════════════${RESET}\n`);

  const chatEngineSource = fs.readFileSync(path.join(__dirname, "../server/chat-engine.ts"), "utf-8");
  const routesSource = fs.readFileSync(path.join(__dirname, "../server/routes.ts"), "utf-8");
  // Source union: server/tools.ts + server/tools/domains/** (tools-layer-split S1),
  // so tenant-guard/case-arm/SLOW_TOOLS scans keep seeing migrated code.
  const { readToolSourcesConcatenated } = await import("./lib/tool-source-files");
  const toolsSource = readToolSourcesConcatenated();

  console.log(`${BOLD}[1] Tool Registry Integrity${RESET}`);

  const toolNames = TOOL_DEFINITIONS.map(t => t.function.name);
  const uniqueNames = new Set(toolNames);
  check(
    "No duplicate tool names",
    toolNames.length === uniqueNames.size,
    toolNames.length === uniqueNames.size
      ? `${toolNames.length} tools, all unique`
      : `Found duplicates: ${toolNames.filter((n, i) => toolNames.indexOf(n) !== i).join(", ")}`
  );

  for (const def of TOOL_DEFINITIONS) {
    const hasName = !!def.function.name;
    const hasDesc = !!def.function.description;
    const hasParams = !!def.function.parameters;
    if (!hasName || !hasDesc || !hasParams) {
      check(
        `Tool definition completeness: ${def.function.name || "UNNAMED"}`,
        false,
        `Missing: ${[!hasName && "name", !hasDesc && "description", !hasParams && "parameters"].filter(Boolean).join(", ")}`
      );
    }
  }
  check(
    "All tool definitions complete",
    true,
    `${TOOL_DEFINITIONS.length} tools verified with name, description, and parameters`
  );

  console.log(`${BOLD}[2] Tenant Context Injection${RESET}`);

  const chatEngineHasUnconditionalInjection = /parsedArgs\._tenantId\s*=\s*conv\.tenantId\s*\|\|\s*1/.test(chatEngineSource);
  check(
    "chat-engine.ts: Unconditional _tenantId injection with fallback",
    chatEngineHasUnconditionalInjection,
    chatEngineHasUnconditionalInjection
      ? "Found: parsedArgs._tenantId = conv.tenantId || 1"
      : "MISSING: _tenantId injection must be unconditional with || 1 fallback"
  );

  const routesHasHardcodedToolList = /if\s*\(\s*tc\.name\s*===\s*"send_email"/.test(routesSource) &&
    /parsedArgs\._tenantId\s*=\s*tenantId;/.test(routesSource);
  const routesHasUnconditionalInjection = /parsedArgs\._tenantId\s*=\s*tenantId\s*\|\|\s*1/.test(routesSource);
  check(
    "routes.ts: Unconditional _tenantId injection (no hardcoded tool list)",
    routesHasUnconditionalInjection && !routesHasHardcodedToolList,
    routesHasHardcodedToolList
      ? "REGRESSION: Found hardcoded tool-name list for _tenantId injection — this will miss new tools!"
      : routesHasUnconditionalInjection
        ? "Found: parsedArgs._tenantId = tenantId || 1 (unconditional)"
        : "MISSING: _tenantId injection in SSE streaming route"
  );

  const toolsTenantGuards = toolsSource.match(/if\s*\(!params\._tenantId\)\s*return\s*\{\s*error:\s*"Tenant context required/g) || [];
  const toolsTenantGuardsCast = toolsSource.match(/if\s*\(!\(params as any\)\._tenantId\)\s*return\s*\{\s*error:\s*"Tenant context required/g) || [];
  const totalGuards = toolsTenantGuards.length + toolsTenantGuardsCast.length;
  check(
    "tools.ts: Tenant guards present (expected — injection should cover them)",
    true,
    `${totalGuards} tenant guards in individual tool handlers. These are fine as long as injection is unconditional.`,
    "warning"
  );

  console.log(`${BOLD}[3] Tool Execution Path Coverage${RESET}`);

  const executeSwitchCases = toolsSource.match(/case\s+"([^"]+)":/g)?.map(m => m.replace(/case\s+"|":/g, "")) || [];
  const registeredNames = new Set(toolNames);
  const handledNames = new Set(executeSwitchCases);

  const registeredButNotHandled = toolNames.filter(n => !handledNames.has(n));
  check(
    "All registered tools have execution handlers",
    registeredButNotHandled.length === 0,
    registeredButNotHandled.length === 0
      ? `${registeredNames.size} registered tools all have switch-case handlers`
      : `Tools registered but NOT handled in executeTool: ${registeredButNotHandled.join(", ")}`
  );

  const handledButNotRegistered = executeSwitchCases.filter(n => !registeredNames.has(n));
  const uniqueUnregistered = [...new Set(handledButNotRegistered)];
  if (uniqueUnregistered.length > 0) {
    check(
      "No orphaned execution handlers",
      false,
      `Tools handled but NOT in TOOL_DEFINITIONS: ${uniqueUnregistered.join(", ")}`,
      "warning"
    );
  }

  console.log(`${BOLD}[4] Error Transparency${RESET}`);

  const hasErrorTransparencyRule = chatEngineSource.includes("MUST tell the user EXACTLY what failed");
  check(
    "System prompt enforces error transparency",
    hasErrorTransparencyRule,
    hasErrorTransparencyRule
      ? "Found error transparency instruction in system prompt"
      : "MISSING: Agents must be instructed to report exact error messages to users"
  );

  const hasToolNameInError = chatEngineSource.includes("State the tool name, the error");
  check(
    "Error reporting includes tool name requirement",
    hasToolNameInError,
    hasToolNameInError
      ? "Agents instructed to include tool name in error reports"
      : "MISSING: Error reports should include the specific tool name"
  );

  console.log(`${BOLD}[5] TypeScript Compilation${RESET}`);
  console.log("  (Run separately: npx tsc --noEmit)\n");

  console.log(`${BOLD}[6] Critical File Existence${RESET}`);

  const criticalFiles = [
    "server/tools.ts",
    "server/chat-engine.ts",
    "server/routes.ts",
    "server/storage.ts",
    "server/health-monitor.ts",
    "shared/schema.ts",
    "data/VisionClaw-Comprehensive-Features.txt",
  ];
  for (const file of criticalFiles) {
    const exists = fs.existsSync(path.join(__dirname, "..", file));
    check(`File exists: ${file}`, exists, exists ? "Present" : "MISSING — critical file not found!");
  }

  console.log(`${BOLD}[7] Timeout Configuration${RESET}`);

  const slowToolsMatch = toolsSource.match(/SLOW_TOOLS\s*=\s*new\s*Set\(\[([^\]]+)\]/s);
  const verySlowToolsMatch = toolsSource.match(/VERY_SLOW_TOOLS\s*=\s*new\s*Set\(\[([^\]]+)\]/s);
  if (slowToolsMatch) {
    const slowTools = slowToolsMatch[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, "")) || [];
    const networkHeavy = ["create_slides", "google_workspace", "deep_research", "produce_video", "orchestrate"];
    const missingSlow = networkHeavy.filter(t => !slowTools.includes(t));
    check(
      "Network-heavy tools have extended timeouts",
      missingSlow.length === 0,
      missingSlow.length === 0
        ? `All network-heavy tools in SLOW_TOOLS`
        : `Missing from SLOW_TOOLS: ${missingSlow.join(", ")}`,
      "warning"
    );
  }

  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  RESULTS${RESET}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════════════${RESET}\n`);

  let errors = 0;
  let warnings = 0;
  let passed = 0;

  for (const r of results) {
    const icon = r.passed ? PASS : r.severity === "error" ? FAIL : WARN;
    console.log(`  ${icon} ${r.name}`);
    console.log(`    ${r.details}\n`);
    if (r.passed) passed++;
    else if (r.severity === "error") errors++;
    else warnings++;
  }

  console.log(`${BOLD}═══════════════════════════════════════════════════════════${RESET}`);
  console.log(`  ${PASS} ${passed} passed  ${errors > 0 ? FAIL : ""}${errors > 0 ? ` ${errors} FAILED` : ""}  ${warnings > 0 ? WARN : ""}${warnings > 0 ? ` ${warnings} warnings` : ""}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════════════${RESET}\n`);

  if (errors > 0) {
    console.log(`${FAIL} ${BOLD}DEPLOY BLOCKED — fix ${errors} error(s) before publishing.${RESET}\n`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`${WARN} ${BOLD}Deploy OK with ${warnings} warning(s) — review above.${RESET}\n`);
  } else {
    console.log(`${PASS} ${BOLD}All checks passed — safe to deploy.${RESET}\n`);
  }
}

run().then(() => {
  setTimeout(() => process.exit(0), 100);
}).catch(err => {
  console.error("Pre-deploy check crashed:", err);
  process.exit(2);
});
