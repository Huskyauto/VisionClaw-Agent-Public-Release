import { getClientForModel, MODEL_REGISTRY } from "./providers";
import type OpenAI from "openai";

export interface ThoughtBranch {
  id: number;
  approach: string;
  reasoning: string;
  conclusion: string;
  score: number;
  strengths: string[];
  weaknesses: string[];
}

export interface ToTResult {
  question: string;
  branches: ThoughtBranch[];
  selectedBranch: number;
  finalAnswer: string;
  confidenceGain: number;
  synthesized: boolean;
  timingMs: number;
}

const SINGLE_BRANCH_PROMPT = `You are a deliberative reasoning engine. Analyze a complex question using a SPECIFIC reasoning strategy.

Strategy to follow: {STRATEGY}

Provide:
1. A clear label for this specific reasoning angle
2. Step-by-step reasoning following ONLY this strategy (5-8 sentences of thorough analysis)
3. The conclusion reached via this path
4. Self-assessed strengths and weaknesses of this particular approach

Output ONLY valid JSON:
{
  "approach": "Name of reasoning strategy",
  "reasoning": "Detailed step-by-step reasoning (5-8 sentences)",
  "conclusion": "The answer/recommendation this path reaches",
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1"]
}`;

const STRATEGIES = [
  "First-Principles Analysis — Break the problem down to its most fundamental truths and reason upward from axioms.",
  "Analogical Reasoning — Find parallel situations or domains and transfer insights from known solutions.",
  "Adversarial/Devil's Advocate — Assume the most obvious answer is WRONG and argue against it to stress-test conclusions.",
  "Systems Thinking — Consider the problem as part of a larger interconnected system with feedback loops and emergent behavior.",
  "Temporal/Sequential Analysis — Consider how this situation evolves over time and reason about cause-and-effect chains.",
];

const EVALUATE_PROMPT = `You are a meta-reasoning evaluator. You are given a question and multiple reasoning branches that each arrived at potentially different conclusions. Your job is to:

1. Score each branch on a 1-10 scale based on: logical soundness (weight: 30%), completeness (25%), accuracy (25%), and practical value (20%)
2. Determine if branches CONVERGE (similar conclusions via different paths = high confidence) or DIVERGE (conflicting conclusions = needs synthesis)
3. If converging: select the best branch. If diverging: synthesize the strongest elements into a unified answer
4. Estimate how much better the multi-path approach was vs a single-path approach

Output ONLY valid JSON:
{
  "scores": [{"id": 1, "score": 8, "rationale": "brief reason"}],
  "convergenceLevel": "high|medium|low",
  "selectedBranch": <id of best branch>,
  "synthesized": <true if final answer combines multiple branches, false if using single best>,
  "finalAnswer": "The definitive answer — either the best branch's conclusion or a synthesis of the strongest elements",
  "confidenceGain": <0.0-1.0 how much better the multi-path approach was>
}`;

function safeNum(val: any, fallback: number): number {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

async function getToTClient(tenantId?: number): Promise<{ client: OpenAI; modelId: string }> {
  const fastModels = ["gpt-4.1", "claude-sonnet-4-20250514", "gpt-5.4"];

  for (const mid of fastModels) {
    try {
      const result = await getClientForModel(mid, tenantId);
      return { client: result.client, modelId: result.actualModelId };
    } catch {
      continue;
    }
  }

  const { replitOpenai } = await import("./providers");
  return { client: replitOpenai, modelId: "gpt-5-mini" };
}

async function generateSingleBranch(
  client: OpenAI,
  modelId: string,
  question: string,
  strategy: string,
  branchId: number,
  context?: string
): Promise<ThoughtBranch | null> {
  const prompt = SINGLE_BRANCH_PROMPT.replace("{STRATEGY}", strategy);
  const userContent = context
    ? `Question: "${question}"\n\nAdditional context: ${context.slice(0, 500)}`
    : `Question: "${question}"`;

  try {
    const resp = await client.chat.completions.create({
      model: modelId,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userContent },
      ],
      max_completion_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const raw = resp.choices[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return {
      id: branchId,
      approach: typeof parsed.approach === "string" ? parsed.approach : `Approach ${branchId}`,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning provided",
      conclusion: typeof parsed.conclusion === "string" ? parsed.conclusion : "No conclusion",
      score: 0,
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.filter((s: any) => typeof s === "string") : [],
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.filter((w: any) => typeof w === "string") : [],
    };
  } catch (err) {
    console.log(`[tot] Branch ${branchId} ("${strategy.slice(0, 30)}...") failed: ${(err as Error).message?.slice(0, 80)}`);
    return null;
  }
}

export async function treeOfThought(
  question: string,
  branchCount: number = 3,
  context?: string,
  tenantId?: number
): Promise<ToTResult> {
  const count = Math.max(2, Math.min(5, branchCount));
  const startMs = Date.now();

  console.log(`[tot] Starting Tree-of-Thought with ${count} parallel branches: "${question.slice(0, 80)}..."`);

  const { client, modelId } = await getToTClient(tenantId);

  const selectedStrategies = STRATEGIES.slice(0, count);

  const branchPromises = selectedStrategies.map((strategy, idx) =>
    generateSingleBranch(client, modelId, question, strategy, idx + 1, context)
  );
  const branchResults = await Promise.allSettled(branchPromises);

  const branches: ThoughtBranch[] = branchResults
    .map(r => r.status === "fulfilled" ? r.value : null)
    .filter((b): b is ThoughtBranch => b !== null);

  if (branches.length === 0) {
    return {
      question,
      branches: [{
        id: 1,
        approach: "Direct reasoning",
        reasoning: "Single-path analysis",
        conclusion: "Unable to generate multiple reasoning paths",
        score: 5,
        strengths: [],
        weaknesses: ["Only single path available"],
      }],
      selectedBranch: 1,
      finalAnswer: "Tree-of-Thought reasoning was unable to generate multiple branches. Please try rephrasing the question.",
      confidenceGain: 0,
      synthesized: false,
      timingMs: Date.now() - startMs,
    };
  }

  console.log(`[tot] Generated ${branches.length}/${count} branches in ${Date.now() - startMs}ms. Evaluating...`);

  const branchSummary = branches.map(b =>
    `Branch ${b.id} — "${b.approach}":\nReasoning: ${b.reasoning}\nConclusion: ${b.conclusion}\nStrengths: ${b.strengths.join(", ")}\nWeaknesses: ${b.weaknesses.join(", ")}`
  ).join("\n\n");

  let evalClient = client;
  let evalModel = modelId;

  if (branches.length >= 3) {
    try {
      const balancedModels = ["deepseek/deepseek-v3.2", "z-ai/glm-5.1", "xiaomi/mimo-v2-flash"];
      for (const mid of balancedModels) {
        try {
          const r = await getClientForModel(mid, tenantId);
          evalClient = r.client;
          evalModel = r.actualModelId;
          break;
        } catch { continue; }
      }
    } catch {}
  }

  try {
    const evalResp = await evalClient.chat.completions.create({
      model: evalModel,
      messages: [
        { role: "system", content: EVALUATE_PROMPT },
        {
          role: "user",
          content: `Question: "${question}"\n\nReasoning Branches:\n${branchSummary}`,
        },
      ],
      max_completion_tokens: 1200,
      response_format: { type: "json_object" },
    });

    const evalContent = evalResp.choices[0]?.message?.content;
    if (evalContent) {
      const evalParsed = JSON.parse(evalContent);

      if (Array.isArray(evalParsed.scores)) {
        for (const s of evalParsed.scores) {
          const branch = branches.find(b => b.id === safeNum(s.id, -1));
          if (branch) {
            branch.score = Math.max(1, Math.min(10, safeNum(s.score, 5)));
          }
        }
      }

      const selectedId = safeNum(evalParsed.selectedBranch, branches[0].id);
      const finalAnswer = typeof evalParsed.finalAnswer === "string" ? evalParsed.finalAnswer : branches[0].conclusion;
      const confidenceGain = Math.max(0, Math.min(1, safeNum(evalParsed.confidenceGain, 0.3)));
      const synthesized = evalParsed.synthesized === true;
      const convergence = evalParsed.convergenceLevel || "medium";

      const elapsedMs = Date.now() - startMs;
      console.log(`[tot] Evaluation complete in ${elapsedMs}ms. Selected branch ${selectedId}. Convergence: ${convergence}. Synthesized: ${synthesized}. Confidence gain: ${confidenceGain.toFixed(2)}`);

      return {
        question,
        branches,
        selectedBranch: selectedId,
        finalAnswer,
        confidenceGain,
        synthesized,
        timingMs: elapsedMs,
      };
    }
  } catch (err) {
    console.log(`[tot] Evaluation failed: ${(err as Error).message}`);
  }

  const bestBranch = branches.reduce((best, b) => b.score > best.score ? b : best, branches[0]);
  return {
    question,
    branches,
    selectedBranch: bestBranch.id,
    finalAnswer: bestBranch.conclusion,
    confidenceGain: 0.1,
    synthesized: false,
    timingMs: Date.now() - startMs,
  };
}
