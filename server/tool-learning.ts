import { getClientForModel } from "./providers";
import { db } from "./db";
import { customTools } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { executeCode } from "./code-sandbox";
import type { ToolDefinition } from "./tools";

import { logSilentCatch } from "./lib/silent-catch";
// R64.A — tenant-scope custom tools end-to-end. Custom tools execute arbitrary
// JS in our sandbox; cross-tenant visibility/exec was a tenant-escape vector.
// Every public function now requires an explicit tenantId and filters reads,
// writes, and deletes by `tenant_id = $tenantId`. The schema's UNIQUE(name)
// constraint is preserved by namespacing tool names per tenant on insert.
function tenantToolName(rawName: string, tenantId: number): string {
  const clean = (rawName || "").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 50);
  if (tenantId === 1) return clean; // admin tenant keeps unprefixed names
  return `t${tenantId}__${clean}`.slice(0, 60);
}

async function getToolGenClient(): Promise<{ client: any; model: string }> {
  try {
    const { client } = await getClientForModel("gpt-4.1");
    return { client, model: "gpt-4.1" };
  } catch {
    try {
      const { client } = await getClientForModel("claude-sonnet-4-20250514");
      return { client, model: "claude-sonnet-4-20250514" };
    } catch {
      const { client } = await getClientForModel("gpt-5.4");
      return { client, model: "gpt-5.4" };
    }
  }
}

const TOOL_GENERATION_PROMPT = `You are a tool designer for an AI agent system. Given a description of what a tool should do, generate:
1. A unique snake_case name (prefix with "custom_")
2. A clear description
3. Parameter definitions as a JSON array of {name, type, description, required}
4. A JavaScript implementation that uses console.log for output and __result__ for return values

The implementation runs in a sandboxed environment with:
- console.log/info/warn/error for output
- Math, Date, JSON, parseInt, parseFloat, String, Number, Array, Object, Map, Set, RegExp
- No network access, no filesystem, no imports

Rules:
- Implementation must be self-contained JavaScript (no require/import)
- Use __result__ = value to set a return value
- Use console.log() for intermediate output
- Keep implementations under 2000 characters
- Name must start with "custom_"

Respond with ONLY valid JSON:
{
  "name": "custom_tool_name",
  "description": "What this tool does",
  "parameters": [{"name": "input", "type": "string", "description": "The input", "required": true}],
  "implementation": "const input = args.input;\\nconsole.log('Processing:', input);\\n__result__ = { result: input.toUpperCase() };"
}`;

export interface CustomToolDef {
  id: number;
  name: string;
  description: string;
  parameters: Array<{ name: string; type: string; description: string; required: boolean }>;
  implementation: string;
  isActive: boolean;
  usageCount: number;
}

const TEST_CASE_PROMPT = `You are generating test cases for a custom tool. Given the tool's description and parameters, generate exactly 3 test cases.

Tool name: {{name}}
Description: {{description}}
Parameters: {{parameters}}

Each test case should have realistic input args and an expected behavior description.

Respond with ONLY valid JSON:
{
  "testCases": [
    {"args": {"input": "hello"}, "expectedBehavior": "Should return HELLO or similar uppercase"},
    {"args": {"input": "world"}, "expectedBehavior": "Should return WORLD or similar uppercase"},
    {"args": {"input": ""}, "expectedBehavior": "Should handle empty input gracefully"}
  ]
}`;

const MAX_FIX_ATTEMPTS = 2;

export async function createCustomTool(description: string, tenantId: number): Promise<{ tool?: CustomToolDef; error?: string; validation?: any }> {
  if (!tenantId || !Number.isInteger(tenantId) || tenantId < 1) {
    return { error: "tenantId required" };
  }
  try {
    const { client, model } = await getToolGenClient();
    console.log(`[tool-learning] Using model ${model} for tool generation`);
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: TOOL_GENERATION_PROMPT },
        { role: "user", content: `Create a tool that: ${description}` },
      ],
      max_completion_tokens: 2000,
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: "Could not parse tool generation response" };
    }

    let parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.name?.startsWith("custom_")) {
      parsed.name = "custom_" + (parsed.name || "unnamed");
    }

    parsed.name = tenantToolName(parsed.name, tenantId);

    if (!parsed.implementation || parsed.implementation.length > 5000) {
      return { error: "Invalid or too-long implementation" };
    }

    const basicTest = executeCode(`const args = {};\n${parsed.implementation}`);
    if (!basicTest.success && !basicTest.error?.includes("Cannot read")) {
      return { error: `Tool validation failed: ${basicTest.error}` };
    }

    const existing = await db.select().from(customTools).where(eq(customTools.name, parsed.name));
    if (existing.length > 0) {
      return { error: `Tool "${parsed.name}" already exists. Choose a different name or delete the existing one first.` };
    }

    const [inserted] = await db.insert(customTools).values({
      name: parsed.name,
      description: parsed.description || description,
      parameters: parsed.parameters || [],
      implementation: parsed.implementation,
      createdBy: "agent",
      isActive: true,
      tenantId,
    }).returning();

    console.log(`[tool-learning] Created custom tool: ${parsed.name}`);

    const validation = await tryAndRevert(inserted);

    if (validation.status === "reverted") {
      return {
        error: `Tool "${parsed.name}" was created but failed validation tests and was reverted. Failures: ${validation.failures.join("; ")}`,
        validation,
      };
    }

    const [finalTool] = await db.select().from(customTools).where(eq(customTools.id, inserted.id));
    const toolData = finalTool || inserted;

    import("./persona-sync").then(m => m.syncPersonaDocs()).catch(e => console.error("[persona-sync] Auto-sync after tool creation failed:", e.message));

    return {
      tool: {
        id: toolData.id,
        name: toolData.name,
        description: toolData.description,
        parameters: toolData.parameters as any,
        implementation: toolData.implementation,
        isActive: toolData.isActive,
        usageCount: toolData.usageCount,
      },
      validation,
    };
  } catch (err: any) {
    return { error: `Tool creation failed: ${err.message}` };
  }
}

async function tryAndRevert(tool: any): Promise<{ status: "kept" | "reverted" | "fixed"; passed: number; failed: number; failures: string[] }> {
  const params = (tool.parameters as any[]) || [];
  let testCases: Array<{ args: Record<string, any>; expectedBehavior: string }> = [];

  try {
    const prompt = TEST_CASE_PROMPT
      .replace("{{name}}", tool.name)
      .replace("{{description}}", tool.description)
      .replace("{{parameters}}", JSON.stringify(params));

    const { client: tcClient, model: tcModel } = await getToolGenClient();
    const resp = await tcClient.chat.completions.create({
      model: tcModel,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: "Generate test cases." },
      ],
      max_completion_tokens: 800,
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      testCases = (parsed.testCases || []).slice(0, 3);
    }
  } catch (err: any) {
    console.log(`[tool-learning] Test case generation failed: ${err.message}`);
    return { status: "kept", passed: 0, failed: 0, failures: [`Test generation failed: ${err.message} — tool accepted without validation`] };
  }

  if (testCases.length === 0) {
    console.log(`[tool-learning] No test cases generated for "${tool.name}" — marking as unvalidated`);
    return { status: "kept", passed: 0, failed: 0, failures: ["No test cases generated — tool accepted without validation"] };
  }

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  let currentImpl = tool.implementation;

  for (const tc of testCases) {
    const argsSetup = Object.entries(tc.args || {})
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => `args.${k} = ${JSON.stringify(v)};`)
      .join("\n");

    const code = `const args = {};\n${argsSetup}\n${currentImpl}`;
    const result = executeCode(code);

    if (result.success) {
      passed++;
    } else {
      failed++;
      failures.push(`Test with args ${JSON.stringify(tc.args)} failed: ${result.error}`);
    }
  }

  if (failed === 0) {
    console.log(`[tool-learning] Tool "${tool.name}" passed all ${passed} test cases`);
    await logToolExperiment(tool.name, "kept", passed, failed, failures);
    return { status: "kept", passed, failed, failures };
  }

  for (let attempt = 0; attempt < MAX_FIX_ATTEMPTS; attempt++) {
    console.log(`[tool-learning] Tool "${tool.name}" failed ${failed}/${testCases.length} tests. Auto-fix attempt ${attempt + 1}/${MAX_FIX_ATTEMPTS}`);

    try {
      const { client: fixClient, model: fixModel } = await getToolGenClient();
      const fixResp = await fixClient.chat.completions.create({
        model: fixModel,
        messages: [
          { role: "system", content: `You are fixing a broken tool implementation. The tool runs in a sandboxed JS environment with no imports/require/fetch. Fix ONLY the implementation code.\n\nRespond with ONLY the fixed JavaScript implementation code, nothing else.` },
          { role: "user", content: `Tool: ${tool.name}\nDescription: ${tool.description}\nParameters: ${JSON.stringify(params)}\n\nCurrent implementation:\n${currentImpl}\n\nFailures:\n${failures.join("\n")}\n\nFix the implementation.` },
        ],
        max_completion_tokens: 1500,
      });

      let fixedImpl = fixResp.choices?.[0]?.message?.content?.trim() || "";
      const codeMatch = fixedImpl.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
      if (codeMatch) fixedImpl = codeMatch[1].trim();

      if (!fixedImpl || fixedImpl.length > 5000) continue;

      let fixPassed = 0;
      let fixFailed = 0;
      const fixFailures: string[] = [];

      for (const tc of testCases) {
        const argsSetup = Object.entries(tc.args || {})
          .filter(([k]) => !k.startsWith("_"))
          .map(([k, v]) => `args.${k} = ${JSON.stringify(v)};`)
          .join("\n");

        const code = `const args = {};\n${argsSetup}\n${fixedImpl}`;
        const result = executeCode(code);

        if (result.success) {
          fixPassed++;
        } else {
          fixFailed++;
          fixFailures.push(`Test with args ${JSON.stringify(tc.args)} failed: ${result.error}`);
        }
      }

      if (fixFailed === 0) {
        await db.update(customTools)
          .set({ implementation: fixedImpl })
          .where(eq(customTools.id, tool.id));

        console.log(`[tool-learning] Tool "${tool.name}" auto-fixed on attempt ${attempt + 1}`);
        await logToolExperiment(tool.name, "fixed", fixPassed, 0, []);
        return { status: "fixed", passed: fixPassed, failed: 0, failures: [] };
      }

      failures.length = 0;
      failures.push(...fixFailures);
      currentImpl = fixedImpl;
    } catch (err: any) {
      console.log(`[tool-learning] Auto-fix attempt failed: ${err.message}`);
    }
  }

  await db.delete(customTools).where(eq(customTools.id, tool.id));
  console.log(`[tool-learning] Tool "${tool.name}" reverted after failing validation`);
  await logToolExperiment(tool.name, "reverted", passed, failed, failures);
  return { status: "reverted", passed, failed, failures };
}

async function logToolExperiment(toolName: string, status: string, passed: number, failed: number, failures: string[]) {
  try {
    const { experiments } = await import("@shared/schema");
    await db.insert(experiments).values({
      hypothesis: `Custom tool "${toolName}" will work correctly`,
      approach: "Try-and-revert validation: generate test cases, run them, auto-fix on failure, revert if unfixable",
      category: "tool_usage",
      metric: "test_pass_rate",
      baselineValue: null,
      resultValue: JSON.stringify({ passed, failed, total: passed + failed }),
      status,
      outcome: status === "kept" ? `All ${passed} tests passed` : status === "fixed" ? `Auto-fixed, all ${passed} tests now pass` : `Failed ${failed} tests, reverted. ${failures.join("; ")}`,
    } as any);
  } catch (err: any) {
    console.log(`[tool-learning] Could not log experiment: ${err.message}`);
  }
}

export async function executeCustomTool(name: string, args: Record<string, any>, tenantId: number): Promise<any> {
  if (!tenantId || !Number.isInteger(tenantId) || tenantId < 1) {
    return { error: "tenantId required" };
  }
  // Accept either the bare name (matches admin tenant) or the already-prefixed
  // form. Always look up scoped to tenant_id to prevent cross-tenant exec via
  // name guessing.
  const lookupNames = Array.from(new Set([name, tenantToolName(name, tenantId)]));
  let tool: any = null;
  for (const n of lookupNames) {
    const [hit] = await db.select().from(customTools).where(
      and(eq(customTools.name, n), eq(customTools.tenantId, tenantId))
    );
    if (hit) { tool = hit; break; }
  }
  if (!tool) return { error: `Custom tool "${name}" not found` };
  if (!tool.isActive) return { error: `Custom tool "${name}" is disabled` };

  const argsSetup = Object.entries(args)
    .filter(([k]) => !k.startsWith("_"))
    .map(([k, v]) => `args.${k} = ${JSON.stringify(v)};`)
    .join("\n");

  const code = `const args = {};\n${argsSetup}\n${tool.implementation}`;
  const result = executeCode(code);

  await db.update(customTools)
    .set({ usageCount: tool.usageCount + 1 })
    .where(eq(customTools.id, tool.id));

  if (!result.success) {
    return { error: `Custom tool execution failed: ${result.error}`, output: result.output };
  }

  return {
    output: result.output,
    returnValue: result.returnValue,
    executionTimeMs: result.executionTimeMs,
  };
}

export async function listCustomTools(tenantId: number): Promise<CustomToolDef[]> {
  if (!tenantId || !Number.isInteger(tenantId) || tenantId < 1) return [];
  const tools = await db.select().from(customTools).where(eq(customTools.tenantId, tenantId));
  return tools.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    parameters: t.parameters as any,
    implementation: t.implementation,
    isActive: t.isActive,
    usageCount: t.usageCount,
  }));
}

export async function deleteCustomTool(name: string, tenantId: number): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || !Number.isInteger(tenantId) || tenantId < 1) {
    return { success: false, error: "tenantId required" };
  }
  const lookupNames = Array.from(new Set([name, tenantToolName(name, tenantId)]));
  let tool: any = null;
  for (const n of lookupNames) {
    const [hit] = await db.select().from(customTools).where(
      and(eq(customTools.name, n), eq(customTools.tenantId, tenantId))
    );
    if (hit) { tool = hit; break; }
  }
  if (!tool) return { success: false, error: `Custom tool "${name}" not found` };
  await db.delete(customTools).where(
    and(eq(customTools.id, tool.id), eq(customTools.tenantId, tenantId))
  );
  console.log(`[tool-learning] Deleted custom tool: ${tool.name} (tenant ${tenantId})`);
  return { success: true };
}

export async function getCustomToolDefinitions(tenantId?: number): Promise<ToolDefinition[]> {
  // Without an explicit tenant we don't expose any custom tools — they're
  // tenant-scoped JS bodies and must not leak across tenants via inspection.
  if (!tenantId || !Number.isInteger(tenantId) || tenantId < 1) return [];
  const tools = await db.select().from(customTools).where(
    and(eq(customTools.isActive, true), eq(customTools.tenantId, tenantId))
  );
  // R63.11 — register each active custom tool in the in-process registry at load
  // time, with safe defaults. Done here (the proper load phase) rather than as a
  // side-effect of auditRegistry. Idempotent: registerTool overwrites existing entries.
  try {
    const { registerTool } = await import("./tool-registry");
    for (const t of tools) {
      registerTool(t.name, { categories: ["custom"], speed: "normal", isProductOutput: false, isNetworkTool: false });
    }
  } catch (_silentErr) { logSilentCatch("server/tool-learning.ts", _silentErr); }
  return tools.map(t => {
    const params = (t.parameters as any[]) || [];
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const p of params) {
      properties[p.name] = { type: p.type || "string", description: p.description || "" };
      if (p.required) required.push(p.name);
    }

    return {
      type: "function" as const,
      function: {
        name: t.name,
        description: `[Custom Tool] ${t.description}`,
        parameters: {
          type: "object",
          properties,
          required,
        },
      },
    };
  });
}
