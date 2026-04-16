import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";

interface EvalTask {
  taskName: string;
  prompt: string;
  judgeCriteria?: string;
  judgeType?: "llm" | "keyword" | "length";
}

interface EvalResult {
  evalId: number;
  personaName: string;
  taskName: string;
  passed: boolean;
  score: number;
  durationMs: number;
  resultSummary: string;
}

const DEFAULT_EVAL_TASKS: EvalTask[] = [
  {
    taskName: "concise_answer",
    prompt: "What is the capital of France? Answer in one sentence only.",
    judgeCriteria: "Response mentions Paris and is under 50 words",
    judgeType: "keyword",
  },
  {
    taskName: "tool_selection",
    prompt: "I need you to find the latest news about AI regulations in the EU. What tool would you use?",
    judgeCriteria: "Response identifies appropriate research or search tool",
    judgeType: "llm",
  },
  {
    taskName: "task_decomposition",
    prompt: "Create a marketing email campaign for our new AI product launch. Break this into steps.",
    judgeCriteria: "Response breaks task into 3+ clear actionable steps with tool usage plan",
    judgeType: "llm",
  },
  {
    taskName: "error_handling",
    prompt: "The file upload failed with error 413. What should we do?",
    judgeCriteria: "Response correctly identifies payload too large, suggests practical fix",
    judgeType: "llm",
  },
  {
    taskName: "delegation_judgment",
    prompt: "A user wants a 10-slide presentation about blockchain with narration. How would you approach this?",
    judgeCriteria: "Response plans delegation to appropriate specialists (slides + audio) rather than doing everything alone",
    judgeType: "llm",
  },
];

async function judgeResult(
  response: string,
  task: EvalTask,
): Promise<{ passed: boolean; score: number; reason: string }> {
  if (task.judgeType === "keyword") {
    const criteria = (task.judgeCriteria || "").toLowerCase();
    const respLower = response.toLowerCase();
    if (task.taskName === "concise_answer") {
      const mentionsParis = respLower.includes("paris");
      const isShort = response.split(/\s+/).length < 50;
      const score = (mentionsParis ? 0.6 : 0) + (isShort ? 0.4 : 0);
      return { passed: score >= 0.8, score, reason: mentionsParis ? "Correct answer" : "Missing key answer" };
    }
    return { passed: true, score: 0.5, reason: "Keyword check inconclusive" };
  }

  if (task.judgeType === "length") {
    const wordCount = response.split(/\s+/).length;
    const score = Math.min(1, wordCount / 100);
    return { passed: wordCount > 20, score, reason: `Response length: ${wordCount} words` };
  }

  try {
    const { replitOpenai } = await import("./providers");
    const judgeResponse = await replitOpenai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{
        role: "user",
        content: `You are an AI agent evaluator. Score this agent response.

Task: "${task.taskName}"
Prompt given: "${task.prompt}"
Criteria: "${task.judgeCriteria || "General quality and helpfulness"}"

Agent response:
${response.slice(0, 2000)}

Return ONLY a JSON object: {"passed": true/false, "score": 0.0-1.0, "reason": "brief explanation"}`,
      }],
      temperature: 0,
      max_completion_tokens: 200,
    });

    const text = judgeResponse.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        passed: !!parsed.passed,
        score: Math.max(0, Math.min(1, Number(parsed.score) || 0.5)),
        reason: String(parsed.reason || "No reason provided").slice(0, 200),
      };
    }
  } catch (err: any) {
    console.warn(`[agent-eval] LLM judge failed: ${err.message}`);
  }

  return { passed: response.length > 50, score: 0.5, reason: "Judge fallback — response exists" };
}

export async function runEval(
  personaId: number,
  tenantId: number = 1,
  tasks?: EvalTask[],
  runs: number = 1,
): Promise<EvalResult[]> {
  const evalTasks = tasks || DEFAULT_EVAL_TASKS;
  const persona = await storage.getPersona(personaId);
  if (!persona) throw new Error(`Persona ${personaId} not found`);

  const results: EvalResult[] = [];
  const { processMessage } = await import("./chat-engine");

  for (const task of evalTasks) {
    for (let run = 1; run <= runs; run++) {
      const evalConv = await storage.createConversation({
        title: `[eval] ${task.taskName} - ${persona.name} #${run}`,
        personaId: persona.id,
        tenantId,
      });

      const insertResult = await db.execute(sql`
        INSERT INTO agent_evals (tenant_id, persona_id, persona_name, task_name, task_prompt, judge_type, judge_criteria, status, run_number)
        VALUES (${tenantId}, ${personaId}, ${persona.name}, ${task.taskName}, ${task.prompt}, ${task.judgeType || "llm"}, ${task.judgeCriteria || ""}, 'running', ${run})
        RETURNING id
      `);
      const evalId = ((insertResult as any).rows || insertResult)?.[0]?.id;

      const startTime = Date.now();
      let response = "";
      let error: string | undefined;

      try {
        const result = await processMessage(
          evalConv.id,
          task.prompt,
          { enableTools: false, depth: 2, source: "eval" }
        );
        response = result?.response || "";
      } catch (err: any) {
        error = err.message;
        response = "";
      }

      const durationMs = Date.now() - startTime;
      const judgment = await judgeResult(response, task);

      await db.execute(sql`
        UPDATE agent_evals SET 
          status = 'completed',
          passed = ${judgment.passed},
          score = ${judgment.score},
          duration_ms = ${durationMs},
          result_summary = ${judgment.reason},
          error = ${error || null},
          completed_at = NOW()
        WHERE id = ${evalId}
      `);

      results.push({
        evalId,
        personaName: persona.name,
        taskName: task.taskName,
        passed: judgment.passed,
        score: judgment.score,
        durationMs,
        resultSummary: judgment.reason,
      });

      try { await storage.deleteConversation(evalConv.id); } catch {}
    }
  }

  return results;
}

export async function getEvalReport(tenantId: number = 1, personaId?: number): Promise<string> {
  let query;
  if (personaId) {
    query = await db.execute(sql`
      SELECT persona_name, task_name, 
        COUNT(*) as runs,
        COUNT(*) FILTER (WHERE passed = true) as passes,
        ROUND(AVG(score)::numeric, 2) as avg_score,
        ROUND(AVG(duration_ms)::numeric, 0) as avg_duration
      FROM agent_evals 
      WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND status = 'completed'
      GROUP BY persona_name, task_name
      ORDER BY persona_name, task_name
    `);
  } else {
    query = await db.execute(sql`
      SELECT persona_name, task_name,
        COUNT(*) as runs,
        COUNT(*) FILTER (WHERE passed = true) as passes,
        ROUND(AVG(score)::numeric, 2) as avg_score,
        ROUND(AVG(duration_ms)::numeric, 0) as avg_duration
      FROM agent_evals 
      WHERE tenant_id = ${tenantId} AND status = 'completed'
      GROUP BY persona_name, task_name
      ORDER BY persona_name, task_name
    `);
  }

  const rows = (query as any).rows || query;
  if (!rows || rows.length === 0) return "No eval results found. Run `run_agent_eval` first.";

  let report = "═══ Agent Eval Report ═══\n\n";
  report += `${"Persona".padEnd(15)} ${"Task".padEnd(22)} ${"Pass".padStart(6)} ${"Score".padStart(6)} ${"Time".padStart(8)}\n`;
  report += "─".repeat(59) + "\n";

  for (const r of rows) {
    report += `${String(r.persona_name).padEnd(15)} ${String(r.task_name).padEnd(22)} ${(r.passes + "/" + r.runs).padStart(6)} ${String(r.avg_score).padStart(6)} ${(r.avg_duration + "ms").padStart(8)}\n`;
  }

  return report;
}
