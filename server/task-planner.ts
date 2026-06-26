import { replitOpenai } from "./providers";
import { executeTool } from "./tools";
import { ADMIN_TENANT_ID } from "./auth";
import { getAllRegisteredTools } from "./tool-registry";
import {
  PLANNER_BLOCKED_TOOLS,
  findUnsupportedToolSteps,
  buildRefineFeedback,
  shouldAcceptRefinement,
} from "./lib/skill-aware-decomposition";

export interface PlanStep {
  id: number;
  action: string;
  description: string;
  tool?: string;
  toolArgs?: Record<string, any>;
  dependsOn: number[];
  status: "pending" | "running" | "done" | "failed" | "skipped";
  result?: any;
  error?: string;
}

export interface ExecutionPlan {
  goal: string;
  steps: PlanStep[];
  status: "planning" | "executing" | "completed" | "failed";
  summary?: string;
  replans?: number;
  // Authenticated persona that launched the plan (threaded from the tool call's
  // stamped _personaId). Used to authoritatively re-stamp _personaId on every
  // step so owner-only RCE tools (run_command/slash_command) work for legit
  // engineering personas (Felix/Forge) AND cannot be spoofed by LLM step args.
  invokerPersonaId?: number;
  // Authenticated tenant that launched the plan (threaded from the tool call's
  // stamped _tenantId). When set to a non-admin tenant, every step is forced to
  // that tenant so owner-only tenant===1 gates fail closed. Undefined (internal /
  // autonomous callers) or admin ⇒ steps default to ADMIN_TENANT_ID as before.
  invokerTenantId?: number;
}

async function decompose(goal: string, context?: string): Promise<PlanStep[]> {
  const systemPrompt = `You are a task planner for an AI agent system. Given a goal, break it into concrete ordered steps.

Available tools the agent can use:
- web_search: Search the web for information
- web_fetch: Fetch content from a URL
- create_memory: Store a fact in long-term memory
- search_memory: Search stored memories
- create_knowledge: Add to knowledge base
- search_knowledge: Search knowledge base
- write_daily_note: Log events/decisions
- send_email: Send email
- check_inbox: Check email inbox
- delegate_task: Delegate to another agent
- generate_chart: Create data visualization
- llm_task: Run a focused sub-LLM task (analysis, summarization, classification)
- analyze_pdf: Extract text from PDF
- browser: Control a remote browser
- execute_code: Run JavaScript code safely

Rules:
- Each step should be atomic and have a clear action
- Use "tool" and "toolArgs" when a step should call a specific tool
- Steps without a tool will be handled by the LLM generating text
- dependsOn lists step IDs that must complete first (0-indexed)
- Keep it practical: 3-8 steps for most goals, max 12
- Don't add unnecessary steps

Respond with ONLY a valid JSON array of steps:
[{"id":0,"action":"verb phrase","description":"details","tool":"tool_name","toolArgs":{},"dependsOn":[]},...]`;

  const userMsg = context
    ? `Goal: ${goal}\n\nContext: ${context}`
    : `Goal: ${goal}`;

  const resp = await replitOpenai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMsg },
    ],
    max_completion_tokens: 1500,
    temperature: 0.2,
  });

  const text = resp.choices?.[0]?.message?.content?.trim() || "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.map((step: any, idx: number) => ({
      id: idx,
      action: step.action || `Step ${idx + 1}`,
      description: step.description || "",
      tool: step.tool || undefined,
      toolArgs: step.toolArgs || undefined,
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
      status: "pending" as const,
    }));
  } catch {
    return [];
  }
}

const SKILL_AWARE_PROMPT = `You are revising a task plan so that EVERY step uses a tool the agent can actually run. Some steps in the previous plan referenced tools that are unavailable or blocked.

Tools you may assign (or use "none" for an LLM reasoning/text step):
- web_search, web_fetch, create_memory, search_memory, create_knowledge, search_knowledge, write_daily_note, send_email, check_inbox, delegate_task, generate_chart, llm_task, analyze_pdf, browser, execute_code

Rules:
- Re-plan the WHOLE goal as an ordered JSON array of steps.
- For any step whose tool was unavailable/blocked: substitute an available tool above, OR set "tool" to "none" (the agent completes it with reasoning/text).
- Keep steps that were already valid.
- Each step atomic; dependsOn lists prerequisite step IDs (0-indexed); 3-8 steps typical, max 12.

Respond with ONLY a valid JSON array:
[{"id":0,"action":"verb phrase","description":"details","tool":"tool_name","toolArgs":{},"dependsOn":[]},...]`;

// Proactive skill-aware re-decomposition (SkillWeaver SAD, arXiv:2606.18051).
// Validate the freshly-decomposed plan against the REAL tool registry before
// executing. If any step references a tool that is blocked or not registered,
// re-decompose ONCE with explicit feedback — turning a reactive execution
// failure (+ replanFromFailure round-trip) into a cheap pre-flight fix. Bounded
// to a single iteration, fails open (any error → original plan untouched), and
// only accepts the revision if it STRICTLY reduces the tool-mismatch count.
async function skillAwareRefine(
  goal: string,
  steps: PlanStep[],
  context?: string,
): Promise<{ steps: PlanStep[]; refined: boolean }> {
  try {
    const availableTools = new Set(
      getAllRegisteredTools().filter(t => !PLANNER_BLOCKED_TOOLS.has(t)),
    );
    const issues = findUnsupportedToolSteps(steps, availableTools);
    if (issues.length === 0) return { steps, refined: false };

    console.log(
      `[task-planner] Skill-aware decomposition: ${issues.length} step(s) reference unusable tools (${issues
        .map(i => `${i.tool}:${i.reason}`)
        .join(", ")}) — re-decomposing once`,
    );

    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: SKILL_AWARE_PROMPT },
        {
          role: "user",
          content: `Goal: ${goal}${context ? `\n\nContext: ${context}` : ""}\n\nProblems with the previous plan:\n${buildRefineFeedback(issues)}\n\nPrevious plan:\n${JSON.stringify(
            steps.map(s => ({ id: s.id, action: s.action, description: s.description, tool: s.tool, dependsOn: s.dependsOn })),
          )}`,
        },
      ],
      max_completion_tokens: 1500,
      temperature: 0.2,
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { steps, refined: false };

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) return { steps, refined: false };

    const refinedSteps: PlanStep[] = parsed.map((step: any, idx: number) => ({
      id: idx,
      action: step.action || `Step ${idx + 1}`,
      description: step.description || "",
      tool: step.tool || undefined,
      toolArgs: step.toolArgs || undefined,
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
      status: "pending" as const,
    }));

    const decision = shouldAcceptRefinement(issues.length, refinedSteps, availableTools);
    if (decision.accept) {
      console.log(`[task-planner] Skill-aware re-decomposition reduced tool mismatches ${issues.length} → ${decision.remaining}`);
      return { steps: refinedSteps, refined: true };
    }
    console.log(
      `[task-planner] Skill-aware re-decomposition rejected (mismatches ${issues.length} → ${decision.remaining}${
        decision.structural.length ? `; structural issues: ${decision.structural.join("; ")}` : ""
      }); keeping original`,
    );
    return { steps, refined: false };
  } catch (err: any) {
    console.log(`[task-planner] Skill-aware refine failed (fail-open): ${err?.message || err}`);
    return { steps, refined: false };
  }
}

const MAX_REPLANS = 2;

const REPLAN_PROMPT = `You are an adaptive task re-planner. A multi-step plan had failures. Your job is to create replacement steps that work around the failures.

Rules:
- Only create replacement steps for the work that couldn't be done
- Use different tools or approaches than what failed
- Keep steps practical and atomic (1-4 replacement steps)
- Each step should have a clear action
- dependsOn should reference IDs of completed steps that have useful results (use the IDs provided)
- Do NOT reference failed step IDs in dependsOn

Respond with ONLY a valid JSON array of replacement steps:
[{"action":"verb phrase","description":"details","tool":"tool_name","toolArgs":{},"dependsOn":[]}]`;

async function replanFromFailure(
  plan: ExecutionPlan,
  failedSteps: PlanStep[],
  affectedPending: PlanStep[],
): Promise<PlanStep[]> {
  try {
    const completedSteps = plan.steps
      .filter(s => s.status === "done")
      .map(s => ({ id: s.id, action: s.action, result: JSON.stringify(s.result).slice(0, 300) }));

    const failedContext = failedSteps.map(s => ({
      id: s.id,
      action: s.action,
      tool: s.tool,
      error: s.error,
    }));

    const pendingWork = affectedPending.map(s => ({
      action: s.action,
      description: s.description,
      tool: s.tool,
    }));

    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: REPLAN_PROMPT },
        {
          role: "user",
          content: `Goal: ${plan.goal}\n\nCompleted steps (available as context):\n${JSON.stringify(completedSteps)}\n\nFailed steps:\n${JSON.stringify(failedContext)}\n\nWork that was blocked and needs alternative approach:\n${JSON.stringify(pendingWork)}`,
        },
      ],
      max_completion_tokens: 800,
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.map((step: any, idx: number) => ({
      id: idx,
      action: step.action || `Re-plan step ${idx + 1}`,
      description: step.description || "",
      tool: step.tool || undefined,
      toolArgs: step.toolArgs || undefined,
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
      status: "pending" as const,
    }));
  } catch (err: any) {
    console.log(`[task-planner] Re-plan failed: ${err.message}`);
    return [];
  }
}

function canRun(step: PlanStep, steps: PlanStep[]): boolean {
  if (step.status !== "pending") return false;
  return step.dependsOn.every(depId => {
    const dep = steps.find(s => s.id === depId);
    return dep && (dep.status === "done" || dep.status === "skipped");
  });
}

async function executeStep(step: PlanStep, plan: ExecutionPlan): Promise<void> {
  step.status = "running";

  if (step.tool && step.tool !== "none") {
    if (PLANNER_BLOCKED_TOOLS.has(step.tool)) {
      step.error = `Tool "${step.tool}" is not allowed inside task planner`;
      step.status = "failed";
      return;
    }
    try {
      const args = step.toolArgs || {};

      const prevResults = plan.steps
        .filter(s => step.dependsOn.includes(s.id) && s.result)
        .map(s => ({ step: s.action, result: JSON.stringify(s.result).slice(0, 500) }));

      if (prevResults.length > 0 && args._injectContext !== false) {
        for (const [key, val] of Object.entries(args)) {
          if (typeof val === "string" && val.includes("{{prev}}")) {
            args[key] = val.replace("{{prev}}", prevResults.map(r => r.result).join("\n"));
          }
        }
      }

      // R74.13c / R125+61 — tenant context for tool steps. _tenantId is an
      // AUTHORIZATION signal, never trust it from LLM-authored step args: a step
      // setting `_tenantId: 1` would otherwise satisfy owner-only tenant===1 gates
      // (approve_felix_proposal, execute_felix_proposal, felix_loop_run_now, …)
      // even for a non-owner caller. When a REAL non-admin invoker launched this
      // plan, strip any model-supplied value and force the invoker's own tenant so
      // those owner-only tools fail closed. Internal/autonomous callers (no
      // invokerTenantId) and admin callers keep the prior behavior: default
      // ADMIN_TENANT_ID so tenant-scoped tools (update_memory, search_memory, …)
      // still get a real tenant context instead of the old =1 inheritance footgun.
      if (typeof plan.invokerTenantId === "number" && plan.invokerTenantId !== ADMIN_TENANT_ID) {
        delete (args as Record<string, any>)._tenantId;
        args._tenantId = plan.invokerTenantId;
      } else if (args._tenantId === undefined) {
        args._tenantId = ADMIN_TENANT_ID;
      }

      // Persona context is an AUTHORIZATION signal, never trust it from LLM-authored
      // step args. The planner force-sets ADMIN tenant above, so a spoofed
      // `_personaId: 2` in step.toolArgs would otherwise pass the owner-only RCE gate
      // on run_command/slash_command. Strip any model-supplied value, then stamp the
      // authenticated persona that launched the plan. Legit engineering personas
      // (Felix=2/Forge=3) thus retain their tools; everyone else still fails closed.
      delete (args as Record<string, any>)._personaId;
      if (typeof plan.invokerPersonaId === "number") {
        args._personaId = plan.invokerPersonaId;
      }

      // SECURITY (R125+65 — architect Cluster A HIGH): the raw executeTool()
      // dispatcher does NOT run the AHB destructive-tool policy (trusted-persona /
      // structured-args / approval / value-cap gates). That gate lives in
      // executeGuardedTool — which we deliberately AVOID here because its HITL
      // confirmation await would deadlock an autonomous plan. So enforce the
      // structural policy gate directly, fail-CLOSED. Persona resolution mirrors
      // the tenant model: internal/autonomous (no invokerTenantId) and the
      // admin/owner tenant run as the trusted "system" persona; any real non-admin
      // invoker gets no trusted name → trusted-only + approval-required tools fail
      // closed, closing the plan-step policy bypass.
      let policyBlockReason: string | null = null;
      try {
        const { enforceToolPolicy } = await import("./safety/destructive-tool-policy");
        const policyPersonaName =
          plan.invokerTenantId === undefined || plan.invokerTenantId === ADMIN_TENANT_ID
            ? "system"
            : undefined;
        const pol = await enforceToolPolicy(step.tool, args, {
          tenantId: typeof args._tenantId === "number" ? args._tenantId : ADMIN_TENANT_ID,
          personaId: typeof plan.invokerPersonaId === "number" ? plan.invokerPersonaId : null,
          personaName: policyPersonaName,
          invokedVia: "planner",
          hasApproval: (args as any)?._approvedByGate === true,
        });
        if (pol.action === "block") policyBlockReason = `Blocked by destructive-tool policy: ${pol.reason}`;
      } catch (_polErr: any) {
        policyBlockReason = `Destructive-tool policy check failed for '${step.tool}'. Refusing to execute.`;
      }

      if (policyBlockReason) {
        step.error = policyBlockReason;
        step.status = "failed";
        step.result = { error: policyBlockReason };
      } else {
        const result = await executeTool(step.tool, args);
        if (result && typeof result === "object" && result.error) {
          step.error = result.error;
          step.status = "failed";
          step.result = result;
        } else {
          step.result = result;
          step.status = "done";
        }
      }
    } catch (err: any) {
      step.error = err.message || "Tool execution failed";
      step.status = "failed";
    }
  } else {
    try {
      const prevContext = plan.steps
        .filter(s => step.dependsOn.includes(s.id) && s.result)
        .map(s => `[${s.action}]: ${JSON.stringify(s.result).slice(0, 800)}`)
        .join("\n");

      const resp = await replitOpenai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: `You are completing a step in a multi-step plan. Goal: ${plan.goal}\nStep: ${step.action}\nDescription: ${step.description}` },
          ...(prevContext ? [{ role: "user" as const, content: `Previous step results:\n${prevContext}\n\nNow complete this step: ${step.description}` }] : [{ role: "user" as const, content: step.description }]),
        ],
        max_completion_tokens: 1000,
        temperature: 0.3,
      });
      step.result = resp.choices?.[0]?.message?.content?.trim() || "";
      step.status = "done";
    } catch (err: any) {
      step.error = err.message;
      step.status = "failed";
    }
  }
}

export async function planAndExecute(
  goal: string,
  context?: string,
  onProgress?: (plan: ExecutionPlan) => void,
  invokerPersonaId?: number,
  invokerTenantId?: number,
): Promise<ExecutionPlan> {
  const plan: ExecutionPlan = {
    goal,
    steps: [],
    status: "planning",
    invokerPersonaId: typeof invokerPersonaId === "number" ? invokerPersonaId : undefined,
    invokerTenantId: typeof invokerTenantId === "number" ? invokerTenantId : undefined,
  };

  onProgress?.(plan);
  plan.steps = await decompose(goal, context);

  if (plan.steps.length === 0) {
    plan.status = "failed";
    plan.summary = "Could not decompose the goal into actionable steps.";
    onProgress?.(plan);
    return plan;
  }

  // Proactive skill-aware re-decomposition before execution (arXiv:2606.18051).
  const refined = await skillAwareRefine(goal, plan.steps, context);
  plan.steps = refined.steps;
  if (refined.refined) (plan as any).skillAwareRefined = true;

  try {
    const { estimatePlanCost } = await import("./resource-predictor");
    const estimate = estimatePlanCost(plan.steps.map(s => ({ tool: s.tool, description: s.description })));
    (plan as any).resourceEstimate = estimate;
    console.log(`[resource-predictor] Plan "${goal.slice(0, 50)}": ${estimate.estimatedToolCalls} tools, ~$${estimate.estimatedCostUsd.toFixed(4)}, ~${estimate.estimatedTimeSeconds}s, risk: ${estimate.riskLevel}`);
  } catch (err) {
    console.log(`[resource-predictor] Estimation failed: ${(err as Error).message}`);
  }

  plan.status = "executing";
  onProgress?.(plan);

  const MAX_ITERATIONS = 20;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    const runnable = plan.steps.filter(s => canRun(s, plan.steps));
    if (runnable.length === 0) break;

    await Promise.all(runnable.map(step => executeStep(step, plan)));
    onProgress?.(plan);

    const allDone = plan.steps.every(s => s.status === "done" || s.status === "failed" || s.status === "skipped");
    if (allDone) break;

    const failedSteps = plan.steps.filter(s => s.status === "failed");
    const pendingWithFailedDeps = plan.steps.filter(s =>
      s.status === "pending" &&
      s.dependsOn.some(depId => plan.steps.find(d => d.id === depId)?.status === "failed")
    );

    if (pendingWithFailedDeps.length > 0 && (plan.replans || 0) < MAX_REPLANS) {
      console.log(`[task-planner] Adaptive re-plan #${(plan.replans || 0) + 1}: ${failedSteps.length} failed steps, ${pendingWithFailedDeps.length} affected pending steps`);
      plan.replans = (plan.replans || 0) + 1;
      onProgress?.(plan);

      const revisedSteps = await replanFromFailure(plan, failedSteps, pendingWithFailedDeps);
      if (revisedSteps.length > 0) {
        const maxId = Math.max(...plan.steps.map(s => s.id));
        for (let ri = 0; ri < revisedSteps.length; ri++) {
          revisedSteps[ri].id = maxId + 1 + ri;
        }

        for (const affected of pendingWithFailedDeps) {
          affected.status = "skipped";
          affected.error = "Replaced by adaptive re-plan";
        }

        plan.steps.push(...revisedSteps);
        console.log(`[task-planner] Re-plan added ${revisedSteps.length} replacement steps`);
        onProgress?.(plan);
        continue;
      }
    }

    if (pendingWithFailedDeps.length > 0) {
      for (const s of pendingWithFailedDeps) {
        s.status = "skipped";
        s.error = "Skipped: dependency failed (re-plan exhausted)";
      }
    }
  }

  plan.steps.filter(s => s.status === "pending").forEach(s => {
    s.status = "skipped";
    s.error = "Skipped: could not resolve dependencies";
  });

  const doneCount = plan.steps.filter(s => s.status === "done").length;
  const failedCount = plan.steps.filter(s => s.status === "failed").length;
  const skippedCount = plan.steps.filter(s => s.status === "skipped").length;
  plan.status = doneCount === 0 ? "failed" : (failedCount + skippedCount > 0 ? "completed" : "completed");

  try {
    const summaryResp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: "Summarize the results of this multi-step plan execution in 2-3 sentences. Be specific about what was accomplished." },
        { role: "user", content: JSON.stringify({ goal, steps: plan.steps.map(s => ({ action: s.action, status: s.status, result: JSON.stringify(s.result).slice(0, 300), error: s.error })) }).slice(0, 3000) },
      ],
      max_completion_tokens: 200,
    });
    plan.summary = summaryResp.choices?.[0]?.message?.content?.trim() || `Completed ${doneCount}/${plan.steps.length} steps (${failedCount} failed).`;
  } catch {
    plan.summary = `Completed ${doneCount}/${plan.steps.length} steps (${failedCount} failed).`;
  }

  onProgress?.(plan);
  return plan;
}
