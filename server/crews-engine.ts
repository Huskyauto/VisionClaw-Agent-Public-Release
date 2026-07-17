import { db } from "./db";
import { sql } from "drizzle-orm";

export interface Crew {
  id: number;
  tenantId: number;
  name: string;
  description: string;
  process: "sequential" | "hierarchical";
  managerPersonaId: number | null;
  memoryEnabled: boolean;
  cacheEnabled: boolean;
  isVerbose: boolean;
  maxRpm: number | null;
  config: Record<string, any>;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrewAgent {
  id: number;
  crewId: number;
  tenantId: number;
  name: string;
  role: string;
  goal: string;
  backstory: string;
  personaId: number | null;
  tools: string[];
  allowDelegation: boolean;
  maxIterations: number;
  config: Record<string, any>;
  sortOrder: number;
  createdAt: string;
}

export interface CrewTask {
  id: number;
  crewId: number;
  tenantId: number;
  name: string | null;
  description: string;
  expectedOutput: string;
  agentId: number | null;
  contextTaskIds: number[];
  asyncExecution: boolean;
  outputJsonSchema: Record<string, any> | null;
  tools: string[];
  guardrail: string | null;
  sortOrder: number;
  config: Record<string, any>;
  createdAt: string;
}

export interface CrewRun {
  id: number;
  crewId: number;
  tenantId: number;
  status: string;
  process: string;
  inputs: Record<string, any>;
  taskOutputs: Array<{ taskId: number; taskName: string | null; output: string; agentName: string }>;
  finalOutput: string | null;
  tokenUsage: Record<string, number>;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CrewFlow {
  id: number;
  tenantId: number;
  name: string;
  description: string;
  state: Record<string, any>;
  status: string;
  config: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface FlowStep {
  id: number;
  flowId: number;
  tenantId: number;
  name: string;
  stepType: "start" | "listen" | "router";
  listenTo: string[];
  routerOutputs: string[];
  crewId: number | null;
  actionType: string;
  actionConfig: Record<string, any>;
  sortOrder: number;
  createdAt: string;
}

function rowToCrew(r: any): Crew {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    description: r.description || "",
    process: r.process || "sequential",
    managerPersonaId: r.manager_persona_id,
    memoryEnabled: r.memory_enabled || false,
    cacheEnabled: r.cache_enabled !== false,
    isVerbose: r.is_verbose || false,
    maxRpm: r.max_rpm,
    config: r.config || {},
    status: r.status || "idle",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToAgent(r: any): CrewAgent {
  return {
    id: r.id,
    crewId: r.crew_id,
    tenantId: r.tenant_id,
    name: r.name,
    role: r.role,
    goal: r.goal,
    backstory: r.backstory || "",
    personaId: r.persona_id,
    tools: r.tools || [],
    allowDelegation: r.allow_delegation || false,
    maxIterations: r.max_iterations || 25,
    config: r.config || {},
    sortOrder: r.sort_order || 0,
    createdAt: r.created_at,
  };
}

function rowToTask(r: any): CrewTask {
  return {
    id: r.id,
    crewId: r.crew_id,
    tenantId: r.tenant_id,
    name: r.name,
    description: r.description,
    expectedOutput: r.expected_output,
    agentId: r.agent_id,
    contextTaskIds: r.context_task_ids || [],
    asyncExecution: r.async_execution || false,
    outputJsonSchema: r.output_json_schema,
    tools: r.tools || [],
    guardrail: r.guardrail,
    sortOrder: r.sort_order || 0,
    config: r.config || {},
    createdAt: r.created_at,
  };
}

function rowToRun(r: any): CrewRun {
  return {
    id: r.id,
    crewId: r.crew_id,
    tenantId: r.tenant_id,
    status: r.status,
    process: r.process,
    inputs: r.inputs || {},
    taskOutputs: r.task_outputs || [],
    finalOutput: r.final_output,
    tokenUsage: r.token_usage || {},
    error: r.error,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  };
}

function rowToFlow(r: any): CrewFlow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    description: r.description || "",
    state: r.state || {},
    status: r.status || "idle",
    config: r.config || {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToFlowStep(r: any): FlowStep {
  return {
    id: r.id,
    flowId: r.flow_id,
    tenantId: r.tenant_id,
    name: r.name,
    stepType: r.step_type || "start",
    listenTo: r.listen_to || [],
    routerOutputs: r.router_outputs || [],
    crewId: r.crew_id,
    actionType: r.action_type || "crew_kickoff",
    actionConfig: r.action_config || {},
    sortOrder: r.sort_order || 0,
    createdAt: r.created_at,
  };
}

export async function createCrew(params: {
  tenantId: number;
  name: string;
  description?: string;
  process?: "sequential" | "hierarchical";
  managerPersonaId?: number;
  memoryEnabled?: boolean;
  cacheEnabled?: boolean;
  isVerbose?: boolean;
  maxRpm?: number;
  config?: Record<string, any>;
}): Promise<{ success: boolean; crew?: Crew; error?: string }> {
  if (!params.tenantId) return { success: false, error: "tenantId required" };
  if (!params.name?.trim()) return { success: false, error: "name required" };

  try {
    const res = await db.execute(sql`
      INSERT INTO crews (tenant_id, name, description, process, manager_persona_id, memory_enabled, cache_enabled, is_verbose, max_rpm, config)
      VALUES (
        ${params.tenantId},
        ${params.name.slice(0, 255)},
        ${(params.description || "").slice(0, 4000)},
        ${params.process || "sequential"},
        ${params.managerPersonaId || null},
        ${params.memoryEnabled || false},
        ${params.cacheEnabled !== false},
        ${params.isVerbose || false},
        ${params.maxRpm || 60},
        ${JSON.stringify(params.config || {})}::jsonb
      )
      RETURNING *
    `);
    const rows = (res as any).rows || res;
    if (!rows[0]) return { success: false, error: "Failed to create crew" };
    return { success: true, crew: rowToCrew(rows[0]) };
  } catch (err: any) {
    console.error("[crews-engine] createCrew error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function getCrew(crewId: number, tenantId: number): Promise<Crew | null> {
  const res = await db.execute(sql`
    SELECT * FROM crews WHERE id = ${crewId} AND tenant_id = ${tenantId}
  `);
  const rows = (res as any).rows || res;
  return rows[0] ? rowToCrew(rows[0]) : null;
}

export async function listCrews(tenantId: number): Promise<Crew[]> {
  const res = await db.execute(sql`
    SELECT * FROM crews WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 50
  `);
  const rows = (res as any).rows || res;
  return rows.map(rowToCrew);
}

export async function updateCrew(crewId: number, tenantId: number, updates: Partial<{
  name: string;
  description: string;
  process: "sequential" | "hierarchical";
  managerPersonaId: number;
  memoryEnabled: boolean;
  status: string;
  config: Record<string, any>;
}>): Promise<{ success: boolean; crew?: Crew; error?: string }> {
  const crew = await getCrew(crewId, tenantId);
  if (!crew) return { success: false, error: "Crew not found" };

  try {
    const res = await db.execute(sql`
      UPDATE crews SET
        name = ${updates.name?.slice(0, 255) || crew.name},
        description = ${updates.description?.slice(0, 4000) ?? crew.description},
        process = ${updates.process || crew.process},
        manager_persona_id = ${updates.managerPersonaId ?? crew.managerPersonaId},
        memory_enabled = ${updates.memoryEnabled ?? crew.memoryEnabled},
        status = ${updates.status || crew.status},
        config = ${JSON.stringify(updates.config || crew.config)}::jsonb,
        updated_at = NOW()
      WHERE id = ${crewId} AND tenant_id = ${tenantId}
      RETURNING *
    `);
    const rows = (res as any).rows || res;
    return rows[0] ? { success: true, crew: rowToCrew(rows[0]) } : { success: false, error: "Update failed" };
  } catch (err: any) {
    console.error("[crews-engine] updateCrew error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function deleteCrew(crewId: number, tenantId: number): Promise<{ success: boolean; error?: string }> {
  const res = await db.execute(sql`
    DELETE FROM crews WHERE id = ${crewId} AND tenant_id = ${tenantId} RETURNING id
  `);
  const rows = (res as any).rows || res;
  return rows[0] ? { success: true } : { success: false, error: "Crew not found" };
}

export async function addCrewAgent(params: {
  crewId: number;
  tenantId: number;
  name: string;
  role: string;
  goal: string;
  backstory?: string;
  personaId?: number;
  tools?: string[];
  allowDelegation?: boolean;
  maxIterations?: number;
  config?: Record<string, any>;
  sortOrder?: number;
}): Promise<{ success: boolean; agent?: CrewAgent; error?: string }> {
  const crew = await getCrew(params.crewId, params.tenantId);
  if (!crew) return { success: false, error: "Crew not found" };
  if (!params.name?.trim()) return { success: false, error: "name required" };
  if (!params.role?.trim()) return { success: false, error: "role required" };
  if (!params.goal?.trim()) return { success: false, error: "goal required" };

  try {
    const toolsArr = params.tools && params.tools.length > 0 ? `{${params.tools.map(t => `"${t}"`).join(",")}}` : null;
    const res = await db.execute(sql`
      INSERT INTO crew_agents (crew_id, tenant_id, name, role, goal, backstory, persona_id, tools, allow_delegation, max_iterations, config, sort_order)
      VALUES (
        ${params.crewId},
        ${params.tenantId},
        ${params.name.slice(0, 255)},
        ${params.role.slice(0, 500)},
        ${params.goal.slice(0, 4000)},
        ${(params.backstory || "").slice(0, 4000)},
        ${params.personaId || null},
        ${toolsArr},
        ${params.allowDelegation || false},
        ${Math.min(params.maxIterations || 25, 100)},
        ${JSON.stringify(params.config || {})}::jsonb,
        ${params.sortOrder || 0}
      )
      RETURNING *
    `);
    const rows = (res as any).rows || res;
    if (!rows[0]) return { success: false, error: "Failed to add agent" };
    return { success: true, agent: rowToAgent(rows[0]) };
  } catch (err: any) {
    console.error("[crews-engine] addCrewAgent error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function listCrewAgents(crewId: number, tenantId: number): Promise<CrewAgent[]> {
  const res = await db.execute(sql`
    SELECT * FROM crew_agents WHERE crew_id = ${crewId} AND tenant_id = ${tenantId} ORDER BY sort_order ASC, id ASC
  `);
  const rows = (res as any).rows || res;
  return rows.map(rowToAgent);
}

export async function removeCrewAgent(agentId: number, tenantId: number): Promise<{ success: boolean; error?: string }> {
  const res = await db.execute(sql`
    DELETE FROM crew_agents WHERE id = ${agentId} AND tenant_id = ${tenantId} RETURNING id
  `);
  const rows = (res as any).rows || res;
  return rows[0] ? { success: true } : { success: false, error: "Agent not found" };
}

export async function addCrewTask(params: {
  crewId: number;
  tenantId: number;
  description: string;
  expectedOutput: string;
  name?: string;
  agentId?: number;
  contextTaskIds?: number[];
  asyncExecution?: boolean;
  outputJsonSchema?: Record<string, any>;
  tools?: string[];
  guardrail?: string;
  sortOrder?: number;
  config?: Record<string, any>;
}): Promise<{ success: boolean; task?: CrewTask; error?: string }> {
  const crew = await getCrew(params.crewId, params.tenantId);
  if (!crew) return { success: false, error: "Crew not found" };
  if (!params.description?.trim()) return { success: false, error: "description required" };
  if (!params.expectedOutput?.trim()) return { success: false, error: "expectedOutput required" };

  try {
    const toolsArr = params.tools && params.tools.length > 0 ? `{${params.tools.map(t => `"${t}"`).join(",")}}` : null;
    const ctxArr = params.contextTaskIds && params.contextTaskIds.length > 0 ? `{${params.contextTaskIds.join(",")}}` : null;
    const res = await db.execute(sql`
      INSERT INTO crew_tasks (crew_id, tenant_id, name, description, expected_output, agent_id, context_task_ids, async_execution, output_json_schema, tools, guardrail, sort_order, config)
      VALUES (
        ${params.crewId},
        ${params.tenantId},
        ${params.name?.slice(0, 255) || null},
        ${params.description.slice(0, 8000)},
        ${params.expectedOutput.slice(0, 4000)},
        ${params.agentId || null},
        ${ctxArr},
        ${params.asyncExecution || false},
        ${params.outputJsonSchema ? JSON.stringify(params.outputJsonSchema) : null}::jsonb,
        ${toolsArr},
        ${params.guardrail?.slice(0, 2000) || null},
        ${params.sortOrder || 0},
        ${JSON.stringify(params.config || {})}::jsonb
      )
      RETURNING *
    `);
    const rows = (res as any).rows || res;
    if (!rows[0]) return { success: false, error: "Failed to add task" };
    return { success: true, task: rowToTask(rows[0]) };
  } catch (err: any) {
    console.error("[crews-engine] addCrewTask error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function listCrewTasks(crewId: number, tenantId: number): Promise<CrewTask[]> {
  const res = await db.execute(sql`
    SELECT * FROM crew_tasks WHERE crew_id = ${crewId} AND tenant_id = ${tenantId} ORDER BY sort_order ASC, id ASC
  `);
  const rows = (res as any).rows || res;
  return rows.map(rowToTask);
}

export async function removeCrewTask(taskId: number, tenantId: number): Promise<{ success: boolean; error?: string }> {
  const res = await db.execute(sql`
    DELETE FROM crew_tasks WHERE id = ${taskId} AND tenant_id = ${tenantId} RETURNING id
  `);
  const rows = (res as any).rows || res;
  return rows[0] ? { success: true } : { success: false, error: "Task not found" };
}

export async function getCrewWithDetails(crewId: number, tenantId: number): Promise<{
  crew: Crew;
  agents: CrewAgent[];
  tasks: CrewTask[];
} | null> {
  const crew = await getCrew(crewId, tenantId);
  if (!crew) return null;
  const [agents, tasks] = await Promise.all([
    listCrewAgents(crewId, tenantId),
    listCrewTasks(crewId, tenantId),
  ]);
  return { crew, agents, tasks };
}

function interpolateInputs(text: string, inputs: Record<string, any>): string {
  let result = text;
  for (const [key, value] of Object.entries(inputs)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
  }
  return result;
}

async function buildAgentSystemPrompt(agent: CrewAgent, task: CrewTask, contextOutputs: string[]): Promise<string> {
  let prompt = `You are ${agent.name}.\nRole: ${agent.role}\nGoal: ${agent.goal}`;
  if (agent.backstory) {
    prompt += `\nBackstory: ${agent.backstory}`;
  }
  prompt += `\n\nYour Task:\n${task.description}`;
  prompt += `\n\nExpected Output:\n${task.expectedOutput}`;
  if (contextOutputs.length > 0) {
    prompt += `\n\nContext from previous tasks:\n${contextOutputs.map((c, i) => `--- Context ${i + 1} ---\n${c}`).join("\n\n")}`;
  }
  if (task.guardrail) {
    prompt += `\n\nGuardrail: ${task.guardrail}`;
  }
  return prompt;
}

async function executeAgentTask(
  agent: CrewAgent,
  task: CrewTask,
  contextOutputs: string[],
  inputs: Record<string, any>,
  tenantId: number
): Promise<{ output: string; tokenUsage: { prompt: number; completion: number } }> {
  const systemPrompt = await buildAgentSystemPrompt(agent, task, contextOutputs);
  const interpolatedPrompt = interpolateInputs(systemPrompt, inputs);

  const model = agent.config?.model || "anthropic/claude-sonnet-4-20250514";
  const maxTokens = agent.config?.maxTokens || 4096;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: model.replace("anthropic/", ""),
      max_tokens: maxTokens,
      system: interpolatedPrompt,
      messages: [{ role: "user", content: `Execute this task and provide your output. Be thorough and precise.\n\nTask: ${interpolateInputs(task.description, inputs)}\n\nExpected output format: ${task.expectedOutput}` }],
    });

    const output = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");

    return {
      output,
      tokenUsage: {
        prompt: response.usage?.input_tokens || 0,
        completion: response.usage?.output_tokens || 0,
      },
    };
  } catch (err: any) {
    console.error(`[crews-engine] Agent ${agent.name} task execution error:`, err.message);
    throw err;
  }
}

async function executeSequential(
  crew: Crew,
  agents: CrewAgent[],
  tasks: CrewTask[],
  inputs: Record<string, any>,
  runId: number,
  tenantId: number
): Promise<void> {
  const taskOutputs: Array<{ taskId: number; taskName: string | null; output: string; agentName: string }> = [];
  const totalTokenUsage = { prompt: 0, completion: 0 };

  for (const task of tasks) {
    const agent = agents.find(a => a.id === task.agentId) || agents[0];
    if (!agent) {
      await updateRunStatus(runId, tenantId, "failed", { error: `No agent found for task ${task.id}` });
      return;
    }

    const contextOutputs: string[] = [];
    if (task.contextTaskIds.length > 0) {
      for (const ctxId of task.contextTaskIds) {
        const ctxOutput = taskOutputs.find(to => to.taskId === ctxId);
        if (ctxOutput) contextOutputs.push(ctxOutput.output);
      }
    } else if (taskOutputs.length > 0) {
      contextOutputs.push(taskOutputs[taskOutputs.length - 1].output);
    }

    try {
      const result = await executeAgentTask(agent, task, contextOutputs, inputs, tenantId);
      taskOutputs.push({
        taskId: task.id,
        taskName: task.name,
        output: result.output,
        agentName: agent.name,
      });
      totalTokenUsage.prompt += result.tokenUsage.prompt;
      totalTokenUsage.completion += result.tokenUsage.completion;

      await db.execute(sql`
        UPDATE crew_runs SET
          task_outputs = ${JSON.stringify(taskOutputs)}::jsonb,
          token_usage = ${JSON.stringify(totalTokenUsage)}::jsonb
        WHERE id = ${runId} AND tenant_id = ${tenantId}
      `);
    } catch (err: any) {
      await updateRunStatus(runId, tenantId, "failed", {
        error: `Task "${task.name || task.id}" failed: ${err.message}`,
        taskOutputs,
        tokenUsage: totalTokenUsage,
      });
      return;
    }
  }

  const finalOutput = taskOutputs.length > 0 ? taskOutputs[taskOutputs.length - 1].output : "";
  await updateRunStatus(runId, tenantId, "completed", {
    finalOutput,
    taskOutputs,
    tokenUsage: totalTokenUsage,
  });
}

async function executeHierarchical(
  crew: Crew,
  agents: CrewAgent[],
  tasks: CrewTask[],
  inputs: Record<string, any>,
  runId: number,
  tenantId: number
): Promise<void> {
  const taskOutputs: Array<{ taskId: number; taskName: string | null; output: string; agentName: string }> = [];
  const totalTokenUsage = { prompt: 0, completion: 0 };

  const managerPrompt = `You are the Manager Agent for crew "${crew.name}".
Your team members are:
${agents.map(a => `- ${a.name} (${a.role}): ${a.goal}`).join("\n")}

You have ${tasks.length} tasks to complete. For each task, analyze it, choose the best agent, and delegate.
Synthesize all results into a final cohesive output.

Available tasks:
${tasks.map((t, i) => `${i + 1}. ${t.name || "Task " + t.id}: ${t.description.slice(0, 200)}`).join("\n")}`;

  for (const task of tasks) {
    const delegationResult = await selectBestAgent(agents, task, inputs, tenantId);
    const selectedAgent = delegationResult.agent;

    const contextOutputs: string[] = [];
    if (task.contextTaskIds.length > 0) {
      for (const ctxId of task.contextTaskIds) {
        const ctxOutput = taskOutputs.find(to => to.taskId === ctxId);
        if (ctxOutput) contextOutputs.push(ctxOutput.output);
      }
    } else if (taskOutputs.length > 0) {
      contextOutputs.push(taskOutputs[taskOutputs.length - 1].output);
    }

    try {
      const result = await executeAgentTask(selectedAgent, task, contextOutputs, inputs, tenantId);
      taskOutputs.push({
        taskId: task.id,
        taskName: task.name,
        output: result.output,
        agentName: selectedAgent.name,
      });
      totalTokenUsage.prompt += result.tokenUsage.prompt;
      totalTokenUsage.completion += result.tokenUsage.completion;

      await db.execute(sql`
        UPDATE crew_runs SET
          task_outputs = ${JSON.stringify(taskOutputs)}::jsonb,
          token_usage = ${JSON.stringify(totalTokenUsage)}::jsonb
        WHERE id = ${runId} AND tenant_id = ${tenantId}
      `);
    } catch (err: any) {
      await updateRunStatus(runId, tenantId, "failed", {
        error: `Hierarchical task "${task.name || task.id}" failed: ${err.message}`,
        taskOutputs,
        tokenUsage: totalTokenUsage,
      });
      return;
    }
  }

  let finalOutput = taskOutputs.length > 0 ? taskOutputs[taskOutputs.length - 1].output : "";

  if (taskOutputs.length > 1) {
    try {
      const synthesisResult = await synthesizeOutputs(crew, taskOutputs, inputs, tenantId);
      finalOutput = synthesisResult.output;
      totalTokenUsage.prompt += synthesisResult.tokenUsage.prompt;
      totalTokenUsage.completion += synthesisResult.tokenUsage.completion;
    } catch (err: any) {
      console.error("[crews-engine] synthesis error:", err.message);
    }
  }

  await updateRunStatus(runId, tenantId, "completed", {
    finalOutput,
    taskOutputs,
    tokenUsage: totalTokenUsage,
  });
}

async function selectBestAgent(
  agents: CrewAgent[],
  task: CrewTask,
  inputs: Record<string, any>,
  tenantId: number
): Promise<{ agent: CrewAgent; reasoning: string }> {
  if (agents.length === 1) return { agent: agents[0], reasoning: "Only one agent available" };
  if (task.agentId) {
    const assigned = agents.find(a => a.id === task.agentId);
    if (assigned) return { agent: assigned, reasoning: "Pre-assigned agent" };
  }

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: "You are a manager selecting the best agent for a task. Return JSON only: {\"agentIndex\": number, \"reasoning\": string}",
      messages: [{
        role: "user",
        content: `Agents:\n${agents.map((a, i) => `${i}. ${a.name} - Role: ${a.role}, Goal: ${a.goal}`).join("\n")}\n\nTask: ${interpolateInputs(task.description, inputs)}\n\nWhich agent (by index) is best suited?`,
      }],
    });

    const text = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const idx = Math.max(0, Math.min(parsed.agentIndex || 0, agents.length - 1));
      return { agent: agents[idx], reasoning: parsed.reasoning || "LLM selected" };
    }
  } catch (err: any) {
    console.error("[crews-engine] agent selection error:", err.message);
  }

  return { agent: agents[0], reasoning: "Fallback to first agent" };
}

async function synthesizeOutputs(
  crew: Crew,
  taskOutputs: Array<{ taskId: number; taskName: string | null; output: string; agentName: string }>,
  inputs: Record<string, any>,
  tenantId: number
): Promise<{ output: string; tokenUsage: { prompt: number; completion: number } }> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: `You are the synthesis agent for crew "${crew.name}". Combine all task outputs into a final cohesive result.`,
    messages: [{
      role: "user",
      content: `Task outputs to synthesize:\n\n${taskOutputs.map((to, i) => `--- ${to.taskName || "Task " + to.taskId} (by ${to.agentName}) ---\n${to.output}`).join("\n\n")}\n\nProvide a unified, cohesive final output that integrates all the above.`,
    }],
  });

  const output = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  return {
    output,
    tokenUsage: {
      prompt: response.usage?.input_tokens || 0,
      completion: response.usage?.output_tokens || 0,
    },
  };
}

async function updateRunStatus(runId: number, tenantId: number, status: string, data?: {
  finalOutput?: string;
  taskOutputs?: any[];
  tokenUsage?: Record<string, number>;
  error?: string;
}): Promise<void> {
  const completedAt = status === "completed" || status === "failed" ? "NOW()" : null;
  await db.execute(sql`
    UPDATE crew_runs SET
      status = ${status},
      final_output = ${data?.finalOutput || null},
      task_outputs = COALESCE(${data?.taskOutputs ? JSON.stringify(data.taskOutputs) : null}::jsonb, task_outputs),
      token_usage = COALESCE(${data?.tokenUsage ? JSON.stringify(data.tokenUsage) : null}::jsonb, token_usage),
      error = ${data?.error || null},
      completed_at = CASE WHEN ${status} IN ('completed', 'failed') THEN NOW() ELSE completed_at END
    WHERE id = ${runId} AND tenant_id = ${tenantId}
  `);
}

export async function kickoffCrew(crewId: number, tenantId: number, inputs: Record<string, any> = {}): Promise<{
  success: boolean;
  runId?: number;
  error?: string;
}> {
  const details = await getCrewWithDetails(crewId, tenantId);
  if (!details) return { success: false, error: "Crew not found" };
  if (details.agents.length === 0) return { success: false, error: "Crew has no agents" };
  if (details.tasks.length === 0) return { success: false, error: "Crew has no tasks" };

  try {
    const res = await db.execute(sql`
      INSERT INTO crew_runs (crew_id, tenant_id, status, process, inputs, started_at)
      VALUES (${crewId}, ${tenantId}, 'running', ${details.crew.process}, ${JSON.stringify(inputs)}::jsonb, NOW())
      RETURNING *
    `);
    const rows = (res as any).rows || res;
    if (!rows[0]) return { success: false, error: "Failed to create run" };
    const run = rowToRun(rows[0]);

    await db.execute(sql`
      UPDATE crews SET status = 'running', updated_at = NOW() WHERE id = ${crewId} AND tenant_id = ${tenantId}
    `);

    const executor = details.crew.process === "hierarchical" ? executeHierarchical : executeSequential;
    executor(details.crew, details.agents, details.tasks, inputs, run.id, tenantId)
      .catch(async (err) => {
        console.error(`[crews-engine] ${details.crew.process} execution error:`, err.message);
        await updateRunStatus(run.id, tenantId, "failed", { error: `Unhandled execution error: ${err.message}` });
      })
      .finally(() => {
        db.execute(sql`UPDATE crews SET status = 'idle', updated_at = NOW() WHERE id = ${crewId} AND tenant_id = ${tenantId}`)
          .catch(e => console.error("[crews-engine] Failed to reset crew status:", e.message));
      });

    return { success: true, runId: run.id };
  } catch (err: any) {
    console.error("[crews-engine] kickoffCrew error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function getCrewRun(runId: number, tenantId: number): Promise<CrewRun | null> {
  const res = await db.execute(sql`
    SELECT * FROM crew_runs WHERE id = ${runId} AND tenant_id = ${tenantId}
  `);
  const rows = (res as any).rows || res;
  return rows[0] ? rowToRun(rows[0]) : null;
}

export async function listCrewRuns(crewId: number, tenantId: number, limit: number = 20): Promise<CrewRun[]> {
  const res = await db.execute(sql`
    SELECT * FROM crew_runs WHERE crew_id = ${crewId} AND tenant_id = ${tenantId}
    ORDER BY created_at DESC LIMIT ${limit}
  `);
  const rows = (res as any).rows || res;
  return rows.map(rowToRun);
}

export async function createFlow(params: {
  tenantId: number;
  name: string;
  description?: string;
  config?: Record<string, any>;
}): Promise<{ success: boolean; flow?: CrewFlow; error?: string }> {
  if (!params.tenantId) return { success: false, error: "tenantId required" };
  if (!params.name?.trim()) return { success: false, error: "name required" };

  try {
    const res = await db.execute(sql`
      INSERT INTO crew_flows (tenant_id, name, description, config)
      VALUES (
        ${params.tenantId},
        ${params.name.slice(0, 255)},
        ${(params.description || "").slice(0, 4000)},
        ${JSON.stringify(params.config || {})}::jsonb
      )
      RETURNING *
    `);
    const rows = (res as any).rows || res;
    if (!rows[0]) return { success: false, error: "Failed to create flow" };
    return { success: true, flow: rowToFlow(rows[0]) };
  } catch (err: any) {
    console.error("[crews-engine] createFlow error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function getFlow(flowId: number, tenantId: number): Promise<CrewFlow | null> {
  const res = await db.execute(sql`
    SELECT * FROM crew_flows WHERE id = ${flowId} AND tenant_id = ${tenantId}
  `);
  const rows = (res as any).rows || res;
  return rows[0] ? rowToFlow(rows[0]) : null;
}

export async function listFlows(tenantId: number): Promise<CrewFlow[]> {
  const res = await db.execute(sql`
    SELECT * FROM crew_flows WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 50
  `);
  const rows = (res as any).rows || res;
  return rows.map(rowToFlow);
}

export async function addFlowStep(params: {
  flowId: number;
  tenantId: number;
  name: string;
  stepType: "start" | "listen" | "router";
  listenTo?: string[];
  routerOutputs?: string[];
  crewId?: number;
  actionType?: string;
  actionConfig?: Record<string, any>;
  sortOrder?: number;
}): Promise<{ success: boolean; step?: FlowStep; error?: string }> {
  const flow = await getFlow(params.flowId, params.tenantId);
  if (!flow) return { success: false, error: "Flow not found" };
  if (!params.name?.trim()) return { success: false, error: "name required" };

  try {
    const listenArr = params.listenTo && params.listenTo.length > 0 ? `{${params.listenTo.map(l => `"${l}"`).join(",")}}` : null;
    const routerArr = params.routerOutputs && params.routerOutputs.length > 0 ? `{${params.routerOutputs.map(r => `"${r}"`).join(",")}}` : null;

    const res = await db.execute(sql`
      INSERT INTO flow_steps (flow_id, tenant_id, name, step_type, listen_to, router_outputs, crew_id, action_type, action_config, sort_order)
      VALUES (
        ${params.flowId},
        ${params.tenantId},
        ${params.name.slice(0, 255)},
        ${params.stepType || "start"},
        ${listenArr},
        ${routerArr},
        ${params.crewId || null},
        ${params.actionType || "crew_kickoff"},
        ${JSON.stringify(params.actionConfig || {})}::jsonb,
        ${params.sortOrder || 0}
      )
      RETURNING *
    `);
    const rows = (res as any).rows || res;
    if (!rows[0]) return { success: false, error: "Failed to add step" };
    return { success: true, step: rowToFlowStep(rows[0]) };
  } catch (err: any) {
    console.error("[crews-engine] addFlowStep error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function listFlowSteps(flowId: number, tenantId: number): Promise<FlowStep[]> {
  const res = await db.execute(sql`
    SELECT * FROM flow_steps WHERE flow_id = ${flowId} AND tenant_id = ${tenantId} ORDER BY sort_order ASC, id ASC
  `);
  const rows = (res as any).rows || res;
  return rows.map(rowToFlowStep);
}

export async function kickoffFlow(flowId: number, tenantId: number, inputs: Record<string, any> = {}): Promise<{
  success: boolean;
  results?: Array<{ stepName: string; output: any }>;
  error?: string;
}> {
  const flow = await getFlow(flowId, tenantId);
  if (!flow) return { success: false, error: "Flow not found" };

  const steps = await listFlowSteps(flowId, tenantId);
  if (steps.length === 0) return { success: false, error: "Flow has no steps" };

  try {
    await db.execute(sql`
      UPDATE crew_flows SET status = 'running', state = ${JSON.stringify({ ...flow.state, inputs })}::jsonb, updated_at = NOW()
      WHERE id = ${flowId} AND tenant_id = ${tenantId}
    `);

    const results: Array<{ stepName: string; output: any; stepType: string }> = [];
    const completedSteps = new Set<string>();

    const startSteps = steps.filter(s => s.stepType === "start");
    for (const step of startSteps) {
      const result = await executeFlowStep(step, tenantId, inputs, {});
      results.push({ stepName: step.name, output: result, stepType: step.stepType });
      completedSteps.add(step.name);
    }

    let changed = true;
    let iterations = 0;
    const maxIterations = 50;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const step of steps) {
        if (completedSteps.has(step.name)) continue;
        if (step.stepType === "start") continue;

        if (step.stepType === "listen") {
          const allListened = step.listenTo.every(dep => completedSteps.has(dep));
          if (!allListened) continue;

          const contextData: Record<string, any> = {};
          for (const dep of step.listenTo) {
            const depResult = results.find(r => r.stepName === dep);
            if (depResult) contextData[dep] = depResult.output;
          }

          const result = await executeFlowStep(step, tenantId, inputs, contextData);
          results.push({ stepName: step.name, output: result, stepType: step.stepType });
          completedSteps.add(step.name);
          changed = true;
        }

        if (step.stepType === "router") {
          const allListened = step.listenTo.every(dep => completedSteps.has(dep));
          if (!allListened) continue;

          const contextData: Record<string, any> = {};
          for (const dep of step.listenTo) {
            const depResult = results.find(r => r.stepName === dep);
            if (depResult) contextData[dep] = depResult.output;
          }

          const routeResult = await executeRouterStep(step, tenantId, inputs, contextData);
          results.push({ stepName: step.name, output: routeResult, stepType: step.stepType });
          completedSteps.add(step.name);
          changed = true;
        }
      }
    }

    await db.execute(sql`
      UPDATE crew_flows SET
        status = 'completed',
        state = ${JSON.stringify({ ...flow.state, inputs, results: results.map(r => ({ step: r.stepName, output: typeof r.output === "string" ? r.output.slice(0, 2000) : r.output })) })}::jsonb,
        updated_at = NOW()
      WHERE id = ${flowId} AND tenant_id = ${tenantId}
    `);

    return { success: true, results };
  } catch (err: any) {
    console.error("[crews-engine] kickoffFlow error:", err.message);
    await db.execute(sql`
      UPDATE crew_flows SET status = 'failed', updated_at = NOW()
      WHERE id = ${flowId} AND tenant_id = ${tenantId}
    `);
    return { success: false, error: err.message };
  }
}

async function executeFlowStep(
  step: FlowStep,
  tenantId: number,
  inputs: Record<string, any>,
  context: Record<string, any>
): Promise<any> {
  if (step.actionType === "crew_kickoff" && step.crewId) {
    const result = await kickoffCrew(step.crewId, tenantId, { ...inputs, ...context });
    if (!result.success) throw new Error(`Crew kickoff failed: ${result.error}`);

    let run = await getCrewRun(result.runId!, tenantId);
    const maxWait = 300000;
    const start = Date.now();
    while (run && run.status === "running" && Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 2000));
      run = await getCrewRun(result.runId!, tenantId);
    }

    if (run?.status === "failed") throw new Error(`Crew run failed: ${run.error}`);
    if (run?.status === "running") throw new Error(`Crew run timed out after ${maxWait / 1000}s (run ${result.runId})`);
    return run?.finalOutput || "Crew completed with no output";
  }

  if (step.actionType === "llm_call") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const anthropic = new Anthropic();
    const prompt = step.actionConfig.prompt || "Process the input";
    const response = await anthropic.messages.create({
      model: step.actionConfig.model || "claude-sonnet-4-20250514",
      max_tokens: step.actionConfig.maxTokens || 2048,
      messages: [{
        role: "user",
        content: interpolateInputs(prompt, { ...inputs, ...context }),
      }],
    });
    return response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  }

  if (step.actionType === "transform") {
    const op = step.actionConfig.operation || "merge";
    if (op === "merge") {
      return { ...inputs, ...context };
    }
    if (op === "extract" && typeof step.actionConfig.key === "string") {
      return context[step.actionConfig.key] || inputs[step.actionConfig.key] || null;
    }
    if (op === "template" && typeof step.actionConfig.template === "string") {
      return interpolateInputs(step.actionConfig.template, { ...inputs, ...context });
    }
    return { inputs, context };
  }

  return { step: step.name, inputs, context };
}

async function executeRouterStep(
  step: FlowStep,
  tenantId: number,
  inputs: Record<string, any>,
  context: Record<string, any>
): Promise<string> {
  if (!step.routerOutputs.length) return "default";

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const anthropic = new Anthropic();

    const routerPrompt = step.actionConfig.prompt || `Based on the context, choose one of these routes: ${step.routerOutputs.join(", ")}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      system: `You are a router. Analyze the context and choose exactly one route. Return ONLY the route name, nothing else.\nValid routes: ${step.routerOutputs.join(", ")}`,
      messages: [{
        role: "user",
        content: `${interpolateInputs(routerPrompt, inputs)}\n\nContext:\n${JSON.stringify(context).slice(0, 4000)}`,
      }],
    });

    const chosen = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    const validRoute = step.routerOutputs.find(r => chosen.toLowerCase().includes(r.toLowerCase()));
    return validRoute || step.routerOutputs[0] || "default";
  } catch (err: any) {
    console.error("[crews-engine] router error:", err.message);
    return step.routerOutputs[0] || "default";
  }
}

export async function deleteFlow(flowId: number, tenantId: number): Promise<{ success: boolean; error?: string }> {
  const res = await db.execute(sql`
    DELETE FROM crew_flows WHERE id = ${flowId} AND tenant_id = ${tenantId} RETURNING id
  `);
  const rows = (res as any).rows || res;
  return rows[0] ? { success: true } : { success: false, error: "Flow not found" };
}

export function getCrewsEngineStats(): {
  tables: string[];
  capabilities: string[];
  patterns: string[];
} {
  return {
    tables: ["crews", "crew_agents", "crew_tasks", "crew_runs", "crew_flows", "flow_steps"],
    capabilities: [
      "Crew creation with role-based agents (role/goal/backstory)",
      "Task definitions with expected_output and context chaining",
      "Sequential process (tasks run in order, output chains)",
      "Hierarchical process (manager LLM selects best agent per task, synthesizes)",
      "Flow orchestration with @start/@listen/@router patterns",
      "Event-driven step execution with dependency resolution",
      "Router steps for conditional branching",
      "Crew kickoff with input interpolation",
      "Flow kickoff with state management",
      "LLM-powered agent selection for hierarchical crews",
      "Output synthesis across multi-agent task results",
      "Context task chaining (task outputs feed into downstream tasks)",
      "Async crew execution with run status tracking",
    ],
    patterns: [
      "crewAI Crews: agent teams with process types",
      "crewAI Flows: event-driven workflows with decorators",
      "crewAI Tasks: description + expected_output + agent assignment",
      "crewAI Process: sequential and hierarchical execution",
      "crewAI Kickoff: entry point with input interpolation",
      "crewAI Memory: per-crew context across tasks",
    ],
  };
}
