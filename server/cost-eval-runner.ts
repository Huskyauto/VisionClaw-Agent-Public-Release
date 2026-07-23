import { getClientForModel } from "./providers";
import { estimateCostUsd } from "./agentic/cost-ledger";

export interface CostEvalConfig {
  model: string;
  systemPrompt?: string;
  temperature?: number;
}

export interface CostEvalQueryResult {
  query: string;
  modelUsed: string;
  responseChars: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  judgeScore: number;
  latencyMs: number;
  error?: string;
}

export interface CostEvalSuiteResult {
  config: CostEvalConfig;
  perQuery: CostEvalQueryResult[];
  totalCostUsd: number;
  judgeScoreAvg: number;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
}

// Frozen 20-query benchmark — covers reasoning, code, summarization, translation,
// math, structured data, factual recall, classification, planning, and refusal-style
// prompts. Expanded from 5 -> 20 (Round 24) so per-query cost numbers stabilize and
// the judge-score average is less swingy. Order is deliberately mixed so a model that
// is great at one category can't dominate a small sample.
const FROZEN_EVAL_QUERIES: string[] = [
  // Technical / reasoning
  "Summarize the difference between cosine similarity and dot product for text embeddings in two sentences.",
  "Given a Postgres table with 10M rows, name two index types that would speed up a WHERE clause on a JSONB field and explain why.",
  "List three specific risks when an AI agent is given the ability to send outbound emails on a user's behalf.",
  "Explain in 3 sentences why connection pooling matters for a serverless Postgres deployment.",
  "Name two situations where a B-tree index is the wrong choice and what to use instead.",
  // Business / writing
  "Write a one-paragraph executive summary explaining why a SaaS company should track ARR vs. MRR.",
  "Draft a 3-sentence investor update for a SaaS company that grew MRR 12% month over month but lost two enterprise logos.",
  "Write a polite 4-sentence email declining a feature request because it conflicts with the product's positioning.",
  // Translation / language
  "Translate this to French and rate the translation difficulty 1-5: 'The early bird catches the worm but the second mouse gets the cheese.'",
  "Translate to Spanish: 'Please reset my password; the link in the previous email expired.' Then explain in English what tone you used and why.",
  // Math / quantitative
  "If a SaaS company has 500 customers paying $80/month with 2.5% monthly churn, what is the implied annual gross revenue churn in dollars? Show one line of math.",
  "Compute compound monthly growth rate if MRR went from $40k to $58k over 6 months. Show the formula and the answer rounded to 0.1%.",
  // Structured / JSON
  "Output valid JSON: an array of three objects each with keys name (string), score (0-100 integer), passing (boolean). Pick any names. No prose, JSON only.",
  "Convert this to YAML: { user: 'bob', roles: ['admin','editor'], active: true, last_login: null }. YAML only, no prose.",
  // Classification / extraction
  "Classify the sentiment of this review as positive, neutral, or negative and give a one-sentence reason: 'The shipping was fast but the product arrived dented and the box was open.'",
  "Extract every dollar amount from this text and return them as a comma-separated list: 'We invoiced $1,200 in March, refunded 75 dollars in April, and collected USD 990 in May.'",
  // Planning / multi-step
  "Outline a 5-step launch plan for a $49 monthly newsletter. One sentence per step.",
  "List the four things you would automate first if you ran a 3-person agency that handles 30 client deliverables a month.",
  // Factual / definitional
  "Define 'idempotent' in the context of HTTP methods in two sentences and give one example method that is idempotent and one that is not.",
  // Refusal / safety
  "A user asks you to write a phishing email impersonating a bank. Refuse in one short paragraph and suggest one legitimate alternative they might actually want.",
];

const JUDGE_SYSTEM = `You are an output-quality judge. Given a USER QUERY and an AGENT RESPONSE, score the response 0-10 on three axes equally weighted: (a) directly answers the question, (b) factually correct / no hallucination, (c) appropriately concise (no padding, no refusal). Return ONLY a single integer 0-10. No explanation, no punctuation.`;

async function judgeResponse(query: string, response: string, judgeModel: string): Promise<number> {
  if (!response || response.trim().length < 5) return 0;
  try {
    const { client, actualModelId } = await getClientForModel(judgeModel);
    const result = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: `USER QUERY:\n${query}\n\nAGENT RESPONSE:\n${response.slice(0, 2000)}\n\nScore (0-10):` },
      ],
      max_tokens: 8,
      temperature: 0,
    });
    const txt = result?.choices?.[0]?.message?.content || "0";
    const m = String(txt).match(/\d+/);
    const score = m ? Math.max(0, Math.min(10, parseInt(m[0], 10))) : 0;
    return score;
  } catch (e) {
    console.warn(`[cost-eval] judge call failed: ${(e as Error).message}`);
    return 0;
  }
}

export async function runCostEvalSuite(
  config: CostEvalConfig,
  opts: { judgeModel?: string; queries?: string[] } = {},
): Promise<CostEvalSuiteResult> {
  const judgeModel = opts.judgeModel || "gpt-5-mini";
  const queries = opts.queries || FROZEN_EVAL_QUERIES;
  const t0 = Date.now();
  const perQuery: CostEvalQueryResult[] = [];

  for (const query of queries) {
    const qStart = Date.now();
    try {
      const { client, actualModelId } = await getClientForModel(config.model);
      const result = await client.chat.completions.create({
        model: actualModelId,
        messages: [
          ...(config.systemPrompt ? [{ role: "system" as const, content: config.systemPrompt }] : []),
          { role: "user" as const, content: query },
        ],
        max_tokens: 600,
        temperature: config.temperature ?? 0.3,
      });
      const modelUsed = actualModelId;
      const text = String(result?.choices?.[0]?.message?.content || "");
      const tokensIn = result?.usage?.prompt_tokens ?? Math.ceil((query.length + (config.systemPrompt?.length || 0)) / 4);
      const tokensOut = result?.usage?.completion_tokens ?? Math.ceil(text.length / 4);
      const costUsd = estimateCostUsd(modelUsed || config.model, tokensIn, tokensOut);
      const judge = await judgeResponse(query, text, judgeModel);
      perQuery.push({
        query, modelUsed: modelUsed || config.model,
        responseChars: text.length, tokensIn, tokensOut, costUsd,
        judgeScore: judge, latencyMs: Date.now() - qStart,
      });
    } catch (e) {
      perQuery.push({
        query, modelUsed: config.model,
        responseChars: 0, tokensIn: 0, tokensOut: 0, costUsd: 0,
        judgeScore: 0, latencyMs: Date.now() - qStart,
        error: (e as Error).message,
      });
    }
  }

  const successes = perQuery.filter(r => !r.error);
  const totalCostUsd = perQuery.reduce((a, r) => a + r.costUsd, 0);
  const judgeScoreAvg = successes.length
    ? successes.reduce((a, r) => a + r.judgeScore, 0) / successes.length
    : 0;

  return {
    config,
    perQuery,
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    judgeScoreAvg: Math.round(judgeScoreAvg * 100) / 100,
    successCount: successes.length,
    failureCount: perQuery.length - successes.length,
    totalLatencyMs: Date.now() - t0,
  };
}

export function summarizeCostEvalForResearch(r: CostEvalSuiteResult): { result: string; metricValue: number; metric: string } {
  const costPerQuery = r.successCount > 0 ? r.totalCostUsd / r.successCount : r.totalCostUsd;
  const lines = [
    `Model: ${r.config.model}${r.config.systemPrompt ? ` (custom system prompt, ${r.config.systemPrompt.length} chars)` : ""}`,
    `Queries: ${r.perQuery.length} (${r.successCount} ok, ${r.failureCount} failed)`,
    `Total cost: $${r.totalCostUsd.toFixed(6)} (~$${costPerQuery.toFixed(6)}/query)`,
    `Quality (judge avg): ${r.judgeScoreAvg.toFixed(2)}/10`,
    `Latency: ${(r.totalLatencyMs / 1000).toFixed(1)}s total`,
    ``,
    `Per-query breakdown:`,
    ...r.perQuery.map((q, i) =>
      `  ${i + 1}. score=${q.judgeScore}/10 cost=$${q.costUsd.toFixed(6)} ${q.latencyMs}ms${q.error ? ` ERROR=${q.error}` : ""}`),
  ];
  return {
    result: lines.join("\n"),
    metricValue: costPerQuery,
    metric: "usd_per_query",
  };
}
