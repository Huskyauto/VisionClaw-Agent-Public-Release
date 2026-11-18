import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

import { requestWithModelToolRoster } from "../../server/lib/model-tool-authorization";
import { trustedExecFlags } from "../../server/safety/trusted-exec-stamp";
import { parseToolCallsFromContent } from "../../server/tool-call-fallback-parser";
import { resolveToolPersonaId } from "../../server/tools/invocation-authority";

function loadGuardedExecutor(dispatches: Array<{ toolName: string; args: Record<string, unknown> }>) {
  const source = fs.readFileSync("server/guarded-tool-executor.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, any> };

  const loadModule = (specifier: string): any => {
    if (specifier === "./tools/invocation-authority") return { resolveToolPersonaId };
    if (specifier === "./tools") {
      return {
        executeToolWithTimeout: async (toolName: string, args: Record<string, unknown>) => {
          dispatches.push({ toolName, args });
          return { ok: true };
        },
      };
    }
    if (specifier === "./tool-rate-limiter") {
      return {
        checkToolRateLimitPaced: async () => ({ allowed: true }),
        recordToolUsage: () => undefined,
        rateLimitAlternatesHint: () => "",
      };
    }
    if (specifier === "./tool-router") return { getPersonaBlockedTools: () => new Set() };
    if (specifier === "./lib/business-pilot-invocation") {
      return { authorizePilotInvocation: () => { throw new Error("Business pilots are outside this roster fixture"); } };
    }
    if (specifier === "./lib/silent-catch") return { logSilentCatch: () => undefined };
    if (specifier === "./safety/trusted-exec-stamp") return { trustedExecFlags, shouldSkipApprovalGate: () => true };
    if (specifier === "./safety/destructive-tool-policy") {
      return { enforceToolPolicy: async () => ({ action: "allow" }) };
    }
    if (specifier === "./tool-mutation") {
      return {
        classifyToolRisk: () => ({ isMutating: false, requiresConfirmation: false, riskLevel: "low" }),
        requestToolConfirmation: async () => ({ confirmationId: "test", promise: Promise.resolve(true) }),
        recordMutation: () => undefined,
      };
    }
    if (specifier === "./skill-evolution") return { trackToolExecution: async () => undefined };
    if (specifier === "./agentic/cost-ledger") return { recordCost: async () => undefined };
    if (specifier === "./lib/model-tool-authorization") {
      const helperSource = fs.readFileSync("server/lib/model-tool-authorization.ts", "utf8");
      const helperCompiled = ts.transpileModule(helperSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const helperModule = { exports: {} as Record<string, any> };
      vm.runInNewContext(helperCompiled, {
        module: helperModule,
        exports: helperModule.exports,
        require: loadModule,
      });
      return helperModule.exports;
    }
    throw new Error(`Unexpected guarded executor dependency: ${specifier}`);
  };

  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: loadModule,
    process: { env: {} },
    console: { warn() {}, error() {}, log() {} },
    Date,
    setTimeout,
  });
  return module.exports.executeGuardedTool as (
    toolName: string,
    args: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ) => Promise<any>;
}

test("guarded model execution rejects a tool outside the round's server-owned roster", async () => {
  const dispatches: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const executeGuardedTool = loadGuardedExecutor(dispatches);
  const result = await executeGuardedTool("foreign_tool", {}, {
    tenantId: 42,
    conversationId: 700,
    invokedVia: "chat_engine",
    skipApprovalGate: true,
    allowedToolNames: ["round_tool"],
  });

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "model_tool_not_authorized");
  assert.equal(dispatches.length, 0);
});

test("an empty model roster rejects tool calls on terminal and tool-disabled rounds", async () => {
  const dispatches: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const executeGuardedTool = loadGuardedExecutor(dispatches);
  const result = await executeGuardedTool("round_tool", {}, {
    tenantId: 42,
    conversationId: 700,
    invokedVia: "main_chat",
    skipApprovalGate: true,
    allowedToolNames: [],
  });

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "model_tool_not_authorized");
  assert.equal(dispatches.length, 0);
});

test("a malformed supplied roster fails closed rather than becoming an unrestricted internal call", async () => {
  const dispatches: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const executeGuardedTool = loadGuardedExecutor(dispatches);
  const result = await executeGuardedTool("round_tool", {}, {
    tenantId: 42,
    conversationId: 700,
    invokedVia: "chat_engine",
    skipApprovalGate: true,
    allowedToolNames: null,
  });

  assert.equal(result.reason, "model_tool_not_authorized");
  assert.equal(dispatches.length, 0);
});

test("an authorized model tool dispatches with canonical conversation scope, not forged args", async () => {
  const dispatches: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const executeGuardedTool = loadGuardedExecutor(dispatches);
  const args = {
    conversationId: 123456,
    _conversationId: 123456,
    _tenantId: 999,
    _invokedVia: "system",
    _selfHeal: true,
  };
  const result = await executeGuardedTool("round_tool", args, {
    tenantId: 42,
    conversationId: 700,
    invokedVia: "chat_engine",
    skipApprovalGate: true,
    allowedToolNames: ["round_tool"],
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].args.conversationId, 700);
  assert.equal(dispatches[0].args._conversationId, 700);
  assert.equal(dispatches[0].args._tenantId, 42);
  assert.equal(dispatches[0].args._invokedVia, "chat_engine");
  assert.equal(dispatches[0].args._selfHeal, false);
  assert.equal(args.conversationId, 123456);
  assert.equal(args._conversationId, 123456);
});

test("Felix and Forge identity survives guarded dispatch from trusted context only", async () => {
  for (const personaId of [2, 3]) {
    const dispatches: Array<{ toolName: string; args: Record<string, unknown> }> = [];
    const executeGuardedTool = loadGuardedExecutor(dispatches);
    const args = { _personaId: 999, command: "echo diagnostic" };
    await executeGuardedTool("run_command", args, {
      tenantId: 1, personaId, conversationId: 700,
      invokedVia: "main_chat", skipApprovalGate: true, allowedToolNames: ["run_command"],
    });
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].args._personaId, personaId);
    assert.equal(dispatches[0].args._tenantId, 1);
    assert.equal(args._personaId, 999, "caller arguments must remain unchanged");
  }
});

test("forged owner and engineer identities cannot survive guarded dispatch", async () => {
  for (const ctx of [
    { tenantId: 1, personaId: 7 },
    { tenantId: 42, personaId: 3 },
    { tenantId: 1 },
    { tenantId: 1, personaId: NaN },
    { tenantId: 1, personaId: "3" },
  ]) {
    const dispatches: Array<{ toolName: string; args: Record<string, unknown> }> = [];
    const executeGuardedTool = loadGuardedExecutor(dispatches);
    const result = await executeGuardedTool("run_command", { _personaId: 2, _tenantId: 1 }, {
      ...ctx, invokedVia: "main_chat", skipApprovalGate: true, allowedToolNames: ["run_command"],
    });
    if (ctx.personaId !== undefined && (!Number.isSafeInteger(ctx.personaId) || Number(ctx.personaId) <= 0)) {
      assert.equal(dispatches.length, 0, "malformed trusted persona identity must fail closed");
      assert.match(result.error, /persona|identity/i);
      continue;
    }
    assert.equal(dispatches.length, 1);
    const stamped = dispatches[0].args;
    assert.equal(stamped._tenantId, ctx.tenantId);
    assert.equal(stamped._personaId,
      typeof ctx.personaId === "number" && Number.isSafeInteger(ctx.personaId) && ctx.personaId > 0
        ? ctx.personaId : undefined);
    assert.equal(stamped._tenantId === 1 && [2, 3].includes(stamped._personaId as number), false,
      "the unchanged owner/Felix/Forge shell gate must deny these identities");
  }
});

test("model authorization snapshots the server-owned roster before asynchronous policy work", async () => {
  const dispatches: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const executeGuardedTool = loadGuardedExecutor(dispatches);
  const allowedToolNames = ["round_tool"];
  const resultPromise = executeGuardedTool("round_tool", {}, {
    tenantId: 42,
    conversationId: 700,
    invokedVia: "chat_engine",
    skipApprovalGate: true,
    allowedToolNames,
  });
  allowedToolNames.splice(0, 1, "different_tool");

  assert.deepEqual(await resultPromise, { ok: true });
  assert.equal(dispatches.length, 1);
});

test("direct internal execution without a model roster retains legacy dispatch behavior", async () => {
  const dispatches: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const executeGuardedTool = loadGuardedExecutor(dispatches);
  const result = await executeGuardedTool("internal_tool", { conversationId: 123, _conversationId: 123 }, {
    tenantId: 42,
    invokedVia: "system",
    skipApprovalGate: true,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].args.conversationId, 123);
  assert.equal(dispatches[0].args._conversationId, 123);
});

test("internal guarded calls must also source persona identity from trusted context", async () => {
  for (const personaId of [undefined, 3]) {
    const dispatches: Array<{ toolName: string; args: Record<string, unknown> }> = [];
    const executeGuardedTool = loadGuardedExecutor(dispatches);
    await executeGuardedTool("internal_tool", { _personaId: 2 }, {
      tenantId: 1, personaId, invokedVia: "system", skipApprovalGate: true,
    });
    assert.equal(dispatches[0].args._personaId, personaId,
      "internal callers pass identity in ctx; arg-only authority must not survive");
  }
});

test("native and recovered model paths enforce the same round roster at guarded dispatch", async () => {
  for (const invokedVia of ["main_chat", "chat_engine"]) {
    const dispatches: Array<{ toolName: string; args: Record<string, unknown> }> = [];
    const executeGuardedTool = loadGuardedExecutor(dispatches);
    const result = await executeGuardedTool("not_in_round", {}, {
      tenantId: 42,
      conversationId: 700,
      invokedVia,
      skipApprovalGate: true,
      allowedToolNames: ["selected_for_round"],
    });
    assert.equal(result.reason, "model_tool_not_authorized");
    assert.equal(dispatches.length, 0);
  }
});

test("timeout recovery text markup is parsed but denied when its exact recovery request omitted tools", async () => {
  const dispatches: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const executeGuardedTool = loadGuardedExecutor(dispatches);
  let allowedToolNames: string[] = [];

  const timedOutParams = {
    tools: [{ type: "function", function: { name: "prior_round_tool" } }],
  };
  await assert.rejects(
    requestWithModelToolRoster(
      timedOutParams,
      (names) => { allowedToolNames = names; },
      async () => { throw new Error("simulated completed-tool response timeout"); },
    ),
    /simulated completed-tool response timeout/,
  );
  assert.deepEqual(allowedToolNames, ["prior_round_tool"]);

  const recoveryParams = {
    messages: [{ role: "user", content: "Summarize completed work; do not call tools." }],
    stream: true,
  };
  const recoveryText = await requestWithModelToolRoster(
    recoveryParams,
    (names) => { allowedToolNames = names; },
    async () => '<tool_call>{"id":"recovery-call","name":"prior_round_tool","arguments":{}}</tool_call>',
  );
  const parsed = parseToolCallsFromContent(recoveryText);
  assert.equal(parsed.toolCalls.length, 1);

  const toolCall = parsed.toolCalls[0];
  const result = await executeGuardedTool(
    toolCall.function.name,
    JSON.parse(toolCall.function.arguments),
    {
      tenantId: 42,
      conversationId: 700,
      invokedVia: "main_chat",
      skipApprovalGate: true,
      allowedToolNames,
    },
  );

  assert.deepEqual(allowedToolNames, []);
  assert.equal(result.reason, "model_tool_not_authorized");
  assert.equal(dispatches.length, 0);
});