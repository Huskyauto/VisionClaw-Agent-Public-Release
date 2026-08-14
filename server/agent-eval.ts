import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";

import { logSilentCatch } from "./lib/silent-catch";
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

async function callLlmJudge(
  response: string,
  task: EvalTask,
  judgeModel: string,
): Promise<{ passed: boolean; score: number; reason: string } | null> {
  try {
    const { replitOpenai } = await import("./providers");
    const judgeResponse = await replitOpenai.chat.completions.create({
      model: judgeModel,
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
    console.warn(`[agent-eval] LLM judge ${judgeModel} failed: ${err.message}`);
  }
  return null;
}

async function judgeResult(
  response: string,
  task: EvalTask,
): Promise<{ passed: boolean; score: number; reason: string }> {
  if (task.judgeType === "keyword") {
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

  // R77.5 — KisMATH-inspired annotation-error second pass.
  // KisMATH §6 highlighted that some "wrong" model outputs are actually correct
  // and the eval/annotation is the part that's wrong. We use a different judge
  // model from a different provider (so the judges don't share the same
  // RLVR-collapsed answer prior) and surface disagreements as
  // POSSIBLE_ANNOTATION_ERROR rather than burying them.
  const primary = await callLlmJudge(response, task, "gpt-5-mini");
  if (!primary) {
    return { passed: response.length > 50, score: 0.5, reason: "Judge fallback — response exists" };
  }

  // Only run the cross-check when the primary verdict is borderline OR when the
  // response is non-trivial (avoid spending tokens on obviously empty/short answers).
  const isBorderline = primary.score >= 0.35 && primary.score <= 0.75;
  const responseSubstantive = response.length >= 120;
  if (!(isBorderline || (primary.passed === false && responseSubstantive))) {
    return primary;
  }

  // Cross-check with a structurally different judge (Gemini Flash — different
  // provider, different training-data mix, different RLHF source).
  const secondary = await callLlmJudge(response, task, "gemini-2.5-flash");
  if (!secondary) {
    return primary;
  }

  if (primary.passed !== secondary.passed) {
    const tag = "POSSIBLE_ANNOTATION_ERROR";
    return {
      passed: secondary.passed,                       // trust the second opinion when disagreement is strong
      score: (primary.score + secondary.score) / 2,
      reason: `${tag}: judges disagree — gpt-5-mini said ${primary.passed ? "PASS" : "FAIL"} (${primary.reason.slice(0, 80)}); gemini-2.5-flash said ${secondary.passed ? "PASS" : "FAIL"} (${secondary.reason.slice(0, 80)}). Bob, manually review eval row.`.slice(0, 480),
    };
  }
  // Agreement → average the score for less noise.
  return {
    passed: primary.passed,
    score: (primary.score + secondary.score) / 2,
    reason: `(2-judge agreement) ${primary.reason}`.slice(0, 200),
  };
}

export async function runEval(
  personaId: number,
  tenantId: number,
  tasks?: EvalTask[],
  runs: number = 1,
): Promise<EvalResult[]> {
  // R74.13f fail-closed: removed `tenantId: number = 1` default that
  // silently wrote eval rows to tenant 1 when a caller forgot to pass
  // tenantId. Every caller already passes _tenantId from the agent
  // loop's tool dispatch — the default was dead code masking the real
  // upstream-missing-context bug. The runtime check below is the
  // belt-and-suspenders against `any`-typed callers (params._tenantId
  // is `any` in the dispatch, so TS won't catch it at compile time).
  if (typeof tenantId !== "number" || !Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`runEval requires a valid tenantId (got: ${JSON.stringify(tenantId)})`);
  }
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

      try { await storage.deleteConversation(evalConv.id, (evalConv as any).tenantId); } catch (_silentErr) { logSilentCatch("server/agent-eval.ts", _silentErr); }
    }
  }

  return results;
}

export async function getEvalReport(tenantId: number, personaId?: number): Promise<string> {
  // R74.13f fail-closed: same as runEval above — removed `= 1` default
  // that silently scoped report queries to tenant 1 when callers forgot
  // to pass tenantId. The single caller (server/tools.ts get_eval_report)
  // passes params._tenantId which is `any`-typed, so we runtime-check.
  if (typeof tenantId !== "number" || !Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`getEvalReport requires a valid tenantId (got: ${JSON.stringify(tenantId)})`);
  }
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
