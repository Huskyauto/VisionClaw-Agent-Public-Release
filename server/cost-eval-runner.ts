import { COST_LEDGER_RECORDED, getClientForModel } from "./providers";
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
  ttftMs?: number;
  streamDurationMs?: number;
  outputTokensPerSecond?: number;
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
  ttftMsAvg?: number;
  streamDurationMsAvg?: number;
  outputTokensPerSecondAvg?: number;
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

export function getFrozenCostEvalQueries(): string[] {
  return [...FROZEN_EVAL_QUERIES];
}

const JUDGE_SYSTEM = `You are an output-quality judge. Given a USER QUERY and an AGENT RESPONSE, score the response 0-10 on three axes equally weighted: (a) directly answers the question, (b) factually correct / no hallucination, (c) appropriately concise (no padding, no refusal). Return ONLY a single integer 0-10. No explanation, no punctuation.`;

type CostEvalClientFactory = (model: string) => Promise<{ client: any; actualModelId: string }>;

async function judgeResponse(
  query: string,
  response: string,
  judgeModel: string,
  getClient: CostEvalClientFactory,
  requireLedgerPersistence: boolean,
): Promise<{ score: number; error?: string }> {
  if (!response || response.trim().length < 5) {
    return { score: 0, error: "candidate response was empty or too short" };
  }
  try {
    const { client, actualModelId } = await getClient(judgeModel);
    const result = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: `USER QUERY:\n${query}\n\nAGENT RESPONSE:\n${response.slice(0, 2000)}\n\nScore (0-10):` },
      ],
      max_tokens: 8,
      temperature: 0,
    });
    if (requireLedgerPersistence && result?.[COST_LEDGER_RECORDED] !== true) {
      throw new Error("judge usage record was not persisted");
    }
    const txt = String(result?.choices?.[0]?.message?.content ?? "").trim();
    const m = txt.match(/^(?:10|[0-9])$/);
    if (!m) return { score: 0, error: "judge returned no parseable score" };
    const score = Math.max(0, Math.min(10, parseInt(m[0], 10)));
    return { score };
  } catch (e) {
    console.warn(`[cost-eval] judge call failed: ${(e as Error).message}`);
    return { score: 0, error: (e as Error).message };
  }
}

export async function runCostEvalSuite(
  config: CostEvalConfig,
  opts: {
    judgeModel?: string;
    queries?: string[];
    requireLedgerPersistence?: boolean;
    measureStreaming?: boolean;
    deps?: { getClientForModel?: CostEvalClientFactory; now?: () => number };
  } = {},
): Promise<CostEvalSuiteResult> {
  // Explicit benchmark fixture: the default Mini judge is retained as the
  // fixed baseline for cost/model comparisons; callers may supply another
  // judge model for provider-diverse evaluation.
  const judgeModel = opts.judgeModel || "gpt-5-mini";
  const queries = opts.queries || FROZEN_EVAL_QUERIES;
  const getClient = opts.deps?.getClientForModel ?? getClientForModel;
  const requireLedgerPersistence = opts.requireLedgerPersistence === true;
  const measureStreaming = opts.measureStreaming === true;
  const now = opts.deps?.now ?? Date.now;
  const t0 = now();
  const perQuery: CostEvalQueryResult[] = [];

  for (const query of queries) {
    const qStart = now();
    let modelUsed = config.model;
    let responseChars = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;
    let ttftMs: number | undefined;
    let streamDurationMs: number | undefined;
    let outputTokensPerSecond: number | undefined;
    try {
      const { client, actualModelId } = await getClient(config.model);
      const result = await client.chat.completions.create({
        model: actualModelId,
        messages: [
          ...(config.systemPrompt ? [{ role: "system" as const, content: config.systemPrompt }] : []),
          { role: "user" as const, content: query },
        ],
        max_tokens: 600,
        temperature: config.temperature ?? 0.3,
        ...(measureStreaming ? { stream: true, stream_options: { include_usage: true } } : {}),
      });
      modelUsed = actualModelId || config.model;
      let text = "";
      let reportedTokensIn: number | undefined;
      let reportedTokensOut: number | undefined;
      if (measureStreaming) {
        if (!result || typeof result[Symbol.asyncIterator] !== "function") {
          throw new Error("candidate stream was malformed");
        }
        let firstContentAt: number | undefined;
        for await (const chunk of result as AsyncIterable<any>) {
          const content = chunk?.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content.length > 0) {
            if (firstContentAt === undefined) firstContentAt = now();
            text += content;
          }
          if (chunk?.usage) {
            reportedTokensIn = chunk.usage.prompt_tokens;
            reportedTokensOut = chunk.usage.completion_tokens;
          }
        }
        const streamEndedAt = now();
        if (firstContentAt === undefined) throw new Error("candidate response was empty or too short");
        ttftMs = Math.max(0, firstContentAt - qStart);
        streamDurationMs = Math.max(ttftMs, streamEndedAt - qStart);
        if (requireLedgerPersistence && result?.[COST_LEDGER_RECORDED] !== true) {
          throw new Error("candidate usage record was not persisted");
        }
      } else {
        if (requireLedgerPersistence && result?.[COST_LEDGER_RECORDED] !== true) {
          throw new Error("candidate usage record was not persisted");
        }
        text = String(result?.choices?.[0]?.message?.content || "");
        reportedTokensIn = result?.usage?.prompt_tokens;
        reportedTokensOut = result?.usage?.completion_tokens;
      }
      responseChars = text.length;
      if (
        requireLedgerPersistence
        && (typeof reportedTokensIn !== "number" || !Number.isFinite(reportedTokensIn) || reportedTokensIn < 0
          || typeof reportedTokensOut !== "number" || !Number.isFinite(reportedTokensOut) || reportedTokensOut < 0)
      ) {
        throw new Error("candidate usage was missing or invalid");
      }
      tokensIn = reportedTokensIn ?? Math.ceil((query.length + (config.systemPrompt?.length || 0)) / 4);
      tokensOut = reportedTokensOut ?? Math.ceil(text.length / 4);
      if (measureStreaming && streamDurationMs !== undefined && ttftMs !== undefined) {
        const decodeMs = Math.max(1, streamDurationMs - ttftMs);
        outputTokensPerSecond = Math.round((tokensOut / decodeMs) * 1000 * 100) / 100;
      }
      costUsd = estimateCostUsd(modelUsed, tokensIn, tokensOut);
      const judge = await judgeResponse(query, text, judgeModel, getClient, requireLedgerPersistence);
      if (judge.error) throw new Error(`judge failed: ${judge.error}`);
      perQuery.push({
        query, modelUsed,
        responseChars, tokensIn, tokensOut, costUsd,
        judgeScore: judge.score, latencyMs: now() - qStart,
        ttftMs, streamDurationMs, outputTokensPerSecond,
      });
    } catch (e) {
      perQuery.push({
        query, modelUsed,
        responseChars, tokensIn, tokensOut, costUsd,
        judgeScore: 0, latencyMs: now() - qStart,
        ttftMs, streamDurationMs, outputTokensPerSecond,
        error: (e as Error).message,
      });
    }
  }

  const successes = perQuery.filter(r => !r.error);
  const totalCostUsd = perQuery.reduce((a, r) => a + r.costUsd, 0);
  const judgeScoreAvg = successes.length
    ? successes.reduce((a, r) => a + r.judgeScore, 0) / successes.length
    : 0;
  const measured = successes.filter((r) => Number.isFinite(r.ttftMs) && Number.isFinite(r.outputTokensPerSecond));

  return {
    config,
    perQuery,
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    judgeScoreAvg: Math.round(judgeScoreAvg * 100) / 100,
    successCount: successes.length,
    failureCount: perQuery.length - successes.length,
    totalLatencyMs: now() - t0,
    ttftMsAvg: measured.length
      ? Math.round((measured.reduce((sum, r) => sum + r.ttftMs!, 0) / measured.length) * 100) / 100
      : undefined,
    streamDurationMsAvg: measured.length
      ? Math.round((measured.reduce((sum, r) => sum + r.streamDurationMs!, 0) / measured.length) * 100) / 100
      : undefined,
    outputTokensPerSecondAvg: measured.length
      ? Math.round((measured.reduce((sum, r) => sum + r.outputTokensPerSecond!, 0) / measured.length) * 100) / 100
      : undefined,
  };
}

export function summarizeCostEvalForResearch(r: CostEvalSuiteResult): { result: string; metricValue: number; metric: string } {
  const costPerQuery = r.successCount > 0 ? r.totalCostUsd / r.successCount : r.totalCostUsd;
  const lines = [
    `Model: ${r.config.model}${r.config.systemPrompt ? ` (custom system prompt, ${r.config.systemPrompt.length} chars)` : ""}`,
    `Queries: ${r.perQuery.length} (${r.successCount} ok, ${r.failureCount} failed)`,
    `Total cost: $${r.totalCostUsd.toFixed(6)} (~$${costPerQuery.toFixed(6)}/query)`,
    `Quality (judge avg): ${r.judgeScoreAvg.toFixed(2)}/10`,
    ...(Number.isFinite(r.ttftMsAvg) ? [`TTFT avg: ${r.ttftMsAvg}ms`] : []),
    ...(Number.isFinite(r.streamDurationMsAvg) ? [`Stream duration avg: ${r.streamDurationMsAvg}ms`] : []),
    ...(Number.isFinite(r.outputTokensPerSecondAvg)
      ? [`Output throughput avg: ${r.outputTokensPerSecondAvg} tokens/s`]
      : []),
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
