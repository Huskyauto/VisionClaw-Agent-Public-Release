import { replitOpenai } from "./providers";
import { db } from "./db";
import { experiments } from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { reflectOnResponse } from "./self-reflection";
import { storage } from "./storage";
import fs from "fs";
import path from "path";

import { logSilentCatch } from "./lib/silent-catch";
const MAX_EXPERIMENTS_PER_RUN = 3;

export type EvolutionStrategy = "balanced" | "innovate" | "harden" | "repair-only";

const STRATEGY_CONFIG: Record<EvolutionStrategy, { repair: number; optimize: number; innovate: number; label: string; description: string }> = {
  balanced:      { repair: 0.20, optimize: 0.30, innovate: 0.50, label: "Balanced", description: "Normal operation. Steady growth with stability." },
  innovate:      { repair: 0.05, optimize: 0.15, innovate: 0.80, label: "Innovation Focus", description: "System is stable. Maximize new features and capabilities." },
  harden:        { repair: 0.40, optimize: 0.40, innovate: 0.20, label: "Hardening", description: "After a big change. Focus on stability and robustness." },
  "repair-only": { repair: 0.80, optimize: 0.20, innovate: 0.00, label: "Repair Only", description: "Emergency. Fix everything before doing anything else." },
};

export interface EvolutionSignal {
  type: string;
  source: string;
  detail: string;
  severity: "low" | "medium" | "high";
  timestamp: string;
}

interface ExperimentConfig {
  category: "prompt_optimization" | "response_quality" | "tool_usage" | "persona_tuning";
  personaId?: number;
  strategy?: EvolutionStrategy;
  _manualStrategyOverride?: boolean;
  tenantId?: number;
}

interface ExperimentResult {
  id: number;
  hypothesis: string;
  approach: string;
  status: "kept" | "reverted" | "inconclusive";
  baselineScore: number;
  experimentScore: number;
  improvement: number;
}

const HYPOTHESIS_PROMPT = `You are a research scientist designing experiments to improve an AI assistant's performance. Given the context below, generate exactly {{count}} experiment hypotheses.

Each hypothesis should:
- Target a specific, measurable improvement (response quality, accuracy, tone, etc.)
- Include a concrete approach that can be tested via prompt engineering
- Be testable with a single prompt modification

Context:
- Recent reflection scores (1-10 scale): {{recentScores}}
- Lowest scoring dimension: {{weakestDimension}}
- Current system prompt excerpt: {{promptExcerpt}}
- Evolution strategy: {{strategy}} — {{strategyDescription}}
- Strategy allocation: {{strategyAllocation}}
- Extracted signals from runtime: {{signals}}
- Stagnation info: {{stagnation}}

IMPORTANT: Align your hypotheses with the current evolution strategy allocation. If the strategy is repair-heavy, focus on fixing errors. If innovation-heavy, try novel approaches. Avoid repeating experiments that have already been tried (see stagnation info).

Respond with ONLY valid JSON:
{
  "experiments": [
    {
      "hypothesis": "Adding explicit reasoning steps will improve accuracy scores",
      "approach": "Prepend 'Think step by step before answering.' to the system prompt",
      "testPrompt": "A representative user question to test this hypothesis",
      "metric": "accuracy",
      "category": "prompt_optimization"
    }
  ]
}`;

const EVALUATE_PROMPT = `You are evaluating two AI responses to the same question. Which response is better?

User question: "{{userQuestion}}"

Response A (baseline):
{{responseA}}

Response B (experiment):
{{responseB}}

Score each on accuracy, completeness, relevance, and tone (1-10). Then declare a winner.

Respond with ONLY valid JSON:
{
  "scoreA": {"accuracy": 8, "completeness": 7, "relevance": 8, "tone": 8, "overall": 7.75},
  "scoreB": {"accuracy": 9, "completeness": 8, "relevance": 9, "tone": 8, "overall": 8.5},
  "winner": "B",
  "reason": "Response B provided more detailed and accurate information"
}`;

function sanitizeLogLine(line: string): string {
  return line
    .replace(/[A-Za-z0-9_\-]{20,}(?:key|token|secret|password|apikey)/gi, "[REDACTED_CREDENTIAL]")
    .replace(/(?:sk-|pk-|rk-|whsec_|xai-|AIza)[A-Za-z0-9_\-]{10,}/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9_\-\.]{10,}/gi, "Bearer [REDACTED]")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]")
    .replace(/"(?:api_key|token|secret|password|authorization)"\s*:\s*"[^"]+"/gi, '"[REDACTED_FIELD]"')
    .trim()
    .slice(0, 200);
}

export function extractSignalsFromLogs(): EvolutionSignal[] {
  const signals: EvolutionSignal[] = [];
  const now = new Date().toISOString();
  const logDir = "/tmp/logs";

  try {
    if (!fs.existsSync(logDir)) return signals;

    const logFiles = fs.readdirSync(logDir)
      .filter(f => f.endsWith(".log"))
      .map(f => ({ name: f, path: path.join(logDir, f), mtime: fs.statSync(path.join(logDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3);

    const ERROR_PATTERNS = [
      { pattern: /\[tools\].*error|tool.*failed|Tool ".*" timed out/i, type: "tool_failure", severity: "high" as const },
      { pattern: /\[heartbeat\].*error|heartbeat.*failed/i, type: "heartbeat_error", severity: "medium" as const },
      { pattern: /api.*key.*invalid|401|403.*forbidden|authentication.*fail/i, type: "auth_failure", severity: "high" as const },
      { pattern: /timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i, type: "connectivity_issue", severity: "medium" as const },
      { pattern: /out of memory|heap|allocation fail/i, type: "resource_exhaustion", severity: "high" as const },
      { pattern: /\[self-improvement\].*error|experiment.*error/i, type: "self_improvement_error", severity: "medium" as const },
      { pattern: /rate.?limit|429|too many requests/i, type: "rate_limit_hit", severity: "low" as const },
      { pattern: /\[chat\].*error|streaming.*error|provider.*error/i, type: "chat_error", severity: "medium" as const },
    ];

    for (const file of logFiles) {
      try {
        const content = fs.readFileSync(file.path, "utf-8");
        const lines = content.split("\n").slice(-500);

        for (const line of lines) {
          for (const { pattern, type, severity } of ERROR_PATTERNS) {
            if (pattern.test(line)) {
              const existing = signals.find(s => s.type === type);
              if (!existing) {
                signals.push({
                  type,
                  source: file.name,
                  detail: sanitizeLogLine(line),
                  severity,
                  timestamp: now,
                });
              }
              break;
            }
          }
        }
      } catch (_silentErr) { logSilentCatch("server/self-improvement.ts", _silentErr); }
    }
  } catch (_silentErr) { logSilentCatch("server/self-improvement.ts", _silentErr); }

  return signals;
}

export async function detectStagnation(category: string, tenantId?: number): Promise<{ isStagnant: boolean; consecutiveFailures: number; repeatedHypotheses: string[]; recommendation: string }> {
  try {
    const conditions = [eq(experiments.category, category)];
    if (typeof tenantId === "number" && tenantId > 0) conditions.push(eq(experiments.tenantId, tenantId));

    const recent = await db.select().from(experiments)
      .where(conditions.length > 1 ? sql`${sql.join(conditions, sql` AND `)}` : conditions[0])
      .orderBy(desc(experiments.createdAt))
      .limit(15);

    let consecutiveFailures = 0;
    for (const exp of recent) {
      if (exp.status === "reverted" || exp.status === "error") {
        consecutiveFailures++;
      } else {
        break;
      }
    }

    const hypothesisCounts: Record<string, number> = {};
    for (const exp of recent) {
      const key = exp.hypothesis?.toLowerCase().trim().slice(0, 80) || "";
      if (key) hypothesisCounts[key] = (hypothesisCounts[key] || 0) + 1;
    }
    const repeatedHypotheses = Object.entries(hypothesisCounts)
      .filter(([_, count]) => count >= 2)
      .map(([hyp]) => hyp);

    const isStagnant = consecutiveFailures >= 4 || repeatedHypotheses.length >= 3;

    let recommendation = "System is evolving normally.";
    if (consecutiveFailures >= 6) {
      recommendation = "Critical stagnation: 6+ consecutive failures. Switch to a different category or pause self-improvement.";
    } else if (consecutiveFailures >= 4) {
      recommendation = "Stagnation detected: 4+ consecutive failures. Try switching strategy to 'innovate' for fresh approaches.";
    } else if (repeatedHypotheses.length >= 3) {
      recommendation = "Hypothesis repetition detected. The system is recycling ideas. Force innovation or switch categories.";
    }

    return { isStagnant, consecutiveFailures, repeatedHypotheses, recommendation };
  } catch {
    return { isStagnant: false, consecutiveFailures: 0, repeatedHypotheses: [], recommendation: "Unable to check stagnation." };
  }
}

export function autoSelectStrategy(signals: EvolutionSignal[], stagnation: { isStagnant: boolean; consecutiveFailures: number }): EvolutionStrategy {
  const highSeverityCount = signals.filter(s => s.severity === "high").length;
  const hasErrors = signals.length > 0;

  if (highSeverityCount >= 3) return "repair-only";
  if (stagnation.consecutiveFailures >= 4) return "innovate";
  if (highSeverityCount >= 1) return "harden";
  if (!hasErrors && !stagnation.isStagnant) return "balanced";
  return "balanced";
}

export function getEvolutionStatus(): { strategies: typeof STRATEGY_CONFIG; currentDefault: string } {
  return { strategies: STRATEGY_CONFIG, currentDefault: "balanced" };
}

export async function runSelfImprovementCycle(config: ExperimentConfig & { _signals?: EvolutionSignal[]; _stagnation?: Awaited<ReturnType<typeof detectStagnation>> }): Promise<ExperimentResult[]> {
  const results: ExperimentResult[] = [];
  const tenantId = config.tenantId;
  if (!tenantId) throw new Error("tenantId is required for self-improvement cycle");

  try {
    const signals = config._signals ?? extractSignalsFromLogs();
    const stagnation = config._stagnation ?? await detectStagnation(config.category, tenantId);
    const strategy = config.strategy || autoSelectStrategy(signals, stagnation);
    const strategyConfig = STRATEGY_CONFIG[strategy];

    console.log(`[self-improvement] Strategy: ${strategyConfig.label} | Signals: ${signals.length} | Stagnation: ${stagnation.isStagnant ? "YES" : "no"} (${stagnation.consecutiveFailures} consecutive failures)`);

    if (stagnation.isStagnant && stagnation.consecutiveFailures >= 6 && !config._manualStrategyOverride) {
      console.log(`[self-improvement] Critical stagnation — skipping cycle. ${stagnation.recommendation}`);
      return results;
    }

    const recentExperiments = await db.select().from(experiments)
      .where(and(eq(experiments.category, config.category), eq(experiments.tenantId, tenantId)))
      .orderBy(desc(experiments.createdAt))
      .limit(10);

    const recentScores = recentExperiments
      .filter(e => e.resultValue)
      .map(e => {
        try { return JSON.parse(e.resultValue!); } catch { return null; }
      })
      .filter(Boolean);

    const avgScores = computeAverageScores(recentScores);
    const weakest = findWeakestDimension(avgScores);

    const persona = config.personaId ? await storage.getPersona(config.personaId) : null;
    const promptExcerpt = persona?.soul?.slice(0, 300) || "Default VisionClaw assistant";

    const hypotheses = await generateHypotheses(
      Math.min(MAX_EXPERIMENTS_PER_RUN, 3),
      avgScores,
      weakest,
      promptExcerpt,
      strategy,
      signals,
      stagnation,
    );

    for (const hyp of hypotheses) {
      const result = await runExperiment(hyp, persona, config);
      results.push(result);
    }

    console.log(`[self-improvement] Completed ${results.length} experiments (${strategyConfig.label}): ${results.filter(r => r.status === "kept").length} kept, ${results.filter(r => r.status === "reverted").length} reverted`);
  } catch (err: any) {
    console.error(`[self-improvement] Cycle error: ${err.message}`);
  }

  return results;
}

async function generateHypotheses(
  count: number,
  recentScores: Record<string, number>,
  weakestDimension: string,
  promptExcerpt: string,
  strategy: EvolutionStrategy = "balanced",
  signals: EvolutionSignal[] = [],
  stagnation: { isStagnant: boolean; consecutiveFailures: number; repeatedHypotheses: string[] } = { isStagnant: false, consecutiveFailures: 0, repeatedHypotheses: [] },
): Promise<Array<{ hypothesis: string; approach: string; testPrompt: string; metric: string; category: string }>> {
  try {
    const strategyConfig = STRATEGY_CONFIG[strategy];
    const signalSummary = signals.length > 0
      ? signals.map(s => `[${s.severity}] ${s.type}: ${s.detail.slice(0, 100)}`).join("; ")
      : "No runtime signals detected — system appears healthy.";
    const stagnationSummary = stagnation.isStagnant
      ? `STAGNANT: ${stagnation.consecutiveFailures} consecutive failures. Previously tried: ${stagnation.repeatedHypotheses.slice(0, 3).join(", ")}. DO NOT repeat these.`
      : `Healthy: ${stagnation.consecutiveFailures} recent failures.`;

    const prompt = HYPOTHESIS_PROMPT
      .replace("{{count}}", String(count))
      .replace("{{recentScores}}", JSON.stringify(recentScores))
      .replace("{{weakestDimension}}", weakestDimension)
      .replace("{{promptExcerpt}}", promptExcerpt)
      .replace("{{strategy}}", strategyConfig.label)
      .replace("{{strategyDescription}}", strategyConfig.description)
      .replace("{{strategyAllocation}}", `Repair: ${strategyConfig.repair * 100}%, Optimize: ${strategyConfig.optimize * 100}%, Innovate: ${strategyConfig.innovate * 100}%`)
      .replace("{{signals}}", signalSummary)
      .replace("{{stagnation}}", stagnationSummary);

    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: "Generate experiment hypotheses for improving the AI assistant." },
      ],
      max_completion_tokens: 16384,
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    return (parsed.experiments || []).slice(0, count);
  } catch (err: any) {
    console.error(`[self-improvement] Hypothesis generation error: ${err.message}`);
    return [];
  }
}

async function runExperiment(
  hyp: { hypothesis: string; approach: string; testPrompt: string; metric: string; category: string },
  persona: any,
  config: ExperimentConfig,
): Promise<ExperimentResult> {
  const [experiment] = await db.insert(experiments).values({
    hypothesis: hyp.hypothesis,
    approach: hyp.approach,
    category: config.category,
    metric: hyp.metric,
    status: "running",
    personaId: config.personaId ?? null,
    tenantId: config.tenantId!,
    metadata: { testPrompt: hyp.testPrompt },
  }).returning();

  try {
    const baselineResponse = await generateResponse(hyp.testPrompt, null, persona);
    const baselineReflection = await reflectOnResponse(hyp.testPrompt, baselineResponse, persona?.name);
    const baselineScore = baselineReflection.scores.overall;

    const experimentResponse = await generateResponse(hyp.testPrompt, hyp.approach, persona);
    const experimentReflection = await reflectOnResponse(hyp.testPrompt, experimentResponse, persona?.name);
    const experimentScore = experimentReflection.scores.overall;

    let finalStatus: "kept" | "reverted" | "inconclusive";
    const improvement = experimentScore - baselineScore;

    if (improvement >= 0.5) {
      finalStatus = "kept";
    } else if (improvement <= -0.5) {
      finalStatus = "reverted";
    } else {
      const comparison = await compareResponses(hyp.testPrompt, baselineResponse, experimentResponse);
      finalStatus = comparison === "B" ? "kept" : comparison === "A" ? "reverted" : "inconclusive";
    }

    if (finalStatus === "kept" && persona) {
      const currentSoul = persona.soul || "";
      const SELF_IMPROVEMENT_MARKER = "<!-- SELF-IMPROVEMENT-BLOCK -->";
      const existingBlock = currentSoul.indexOf(SELF_IMPROVEMENT_MARKER);
      let baseSoul = currentSoul;
      let existingImprovements: string[] = [];

      if (existingBlock !== -1) {
        baseSoul = currentSoul.slice(0, existingBlock).trimEnd();
        const blockContent = currentSoul.slice(existingBlock + SELF_IMPROVEMENT_MARKER.length);
        existingImprovements = blockContent.split("\n").filter((l: string) => l.startsWith("- ")).slice(-4);
      }

      existingImprovements.push(`- ${hyp.approach}`);
      if (existingImprovements.length > 5) existingImprovements = existingImprovements.slice(-5);

      const newSoul = `${baseSoul}\n\n${SELF_IMPROVEMENT_MARKER}\n${existingImprovements.join("\n")}`;
      if (newSoul.length < 10000) {
        await storage.updatePersona(persona.id, { soul: newSoul });
        console.log(`[self-improvement] Applied improvement to ${persona.name}: ${hyp.hypothesis}`);
      }
    }

    await db.update(experiments)
      .set({
        status: finalStatus,
        baselineValue: JSON.stringify(baselineReflection.scores),
        resultValue: JSON.stringify(experimentReflection.scores),
        outcome: `Improvement: ${improvement > 0 ? "+" : ""}${improvement.toFixed(2)} (${baselineScore} → ${experimentScore}). ${finalStatus === "kept" ? "Change applied." : finalStatus === "reverted" ? "Change discarded." : "No clear winner."}`,
      })
      .where(eq(experiments.id, experiment.id));

    return {
      id: experiment.id,
      hypothesis: hyp.hypothesis,
      approach: hyp.approach,
      status: finalStatus,
      baselineScore,
      experimentScore,
      improvement,
    };
  } catch (err: any) {
    await db.update(experiments)
      .set({ status: "error", outcome: err.message })
      .where(eq(experiments.id, experiment.id));

    return {
      id: experiment.id,
      hypothesis: hyp.hypothesis,
      approach: hyp.approach,
      status: "reverted" as const,
      baselineScore: 0,
      experimentScore: 0,
      improvement: 0,
    };
  }
}

async function generateResponse(userMessage: string, modification: string | null, persona: any): Promise<string> {
  const systemParts: string[] = [];

  if (persona?.soul) systemParts.push(persona.soul);
  if (modification) systemParts.push(`\n\nIMPORTANT INSTRUCTION: ${modification}`);
  if (systemParts.length === 0) systemParts.push("You are a helpful AI assistant.");

  const resp = await replitOpenai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: systemParts.join("\n") },
      { role: "user", content: userMessage },
    ],
    max_completion_tokens: 1000,
  });

  return resp.choices?.[0]?.message?.content?.trim() || "(no response)";
}

async function compareResponses(question: string, responseA: string, responseB: string): Promise<"A" | "B" | "tie"> {
  try {
    const prompt = EVALUATE_PROMPT
      .replace("{{userQuestion}}", question.slice(0, 500))
      .replace("{{responseA}}", responseA.slice(0, 1500))
      .replace("{{responseB}}", responseB.slice(0, 1500));

    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: "Compare and score both responses." },
      ],
      max_completion_tokens: 500,
    });

    const text = resp.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return "tie";

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.winner === "A" ? "A" : parsed.winner === "B" ? "B" : "tie";
  } catch {
    return "tie";
  }
}

function computeAverageScores(scores: any[]): Record<string, number> {
  if (scores.length === 0) return { accuracy: 7, completeness: 7, relevance: 7, tone: 7, overall: 7 };

  const sums: Record<string, number> = { accuracy: 0, completeness: 0, relevance: 0, tone: 0, overall: 0 };
  let count = 0;

  for (const s of scores) {
    if (typeof s === "object" && s.overall) {
      for (const key of Object.keys(sums)) {
        sums[key] += s[key] || 7;
      }
      count++;
    }
  }

  if (count === 0) return { accuracy: 7, completeness: 7, relevance: 7, tone: 7, overall: 7 };

  const avg: Record<string, number> = {};
  for (const key of Object.keys(sums)) {
    avg[key] = Math.round((sums[key] / count) * 100) / 100;
  }
  return avg;
}

function findWeakestDimension(scores: Record<string, number>): string {
  let weakest = "overall";
  let lowest = 10;
  for (const [key, val] of Object.entries(scores)) {
    if (key !== "overall" && val < lowest) {
      lowest = val;
      weakest = key;
    }
  }
  return weakest;
}

export async function getExperimentHistory(limit = 20, category?: string, tenantId?: number): Promise<any[]> {
  const conditions = [];
  if (category) conditions.push(eq(experiments.category, category));
  if (typeof tenantId === "number" && tenantId > 0) conditions.push(eq(experiments.tenantId, tenantId));

  if (conditions.length > 0) {
    return db.select().from(experiments)
      .where(conditions.length > 1 ? sql`${sql.join(conditions, sql` AND `)}` : conditions[0])
      .orderBy(desc(experiments.createdAt)).limit(limit);
  }
  return db.select().from(experiments).orderBy(desc(experiments.createdAt)).limit(limit);
}

export async function logExperiment(data: {
  hypothesis: string;
  approach: string;
  category: string;
  metric?: string;
  baselineValue?: string;
  resultValue?: string;
  status: string;
  outcome?: string;
  personaId?: number;
  tenantId?: number;
}): Promise<any> {
  const [exp] = await db.insert(experiments).values({
    hypothesis: data.hypothesis,
    approach: data.approach,
    category: data.category,
    metric: data.metric || null,
    baselineValue: data.baselineValue || null,
    resultValue: data.resultValue || null,
    status: data.status,
    outcome: data.outcome || null,
    personaId: data.personaId ?? null,
    tenantId: data.tenantId!,
  }).returning();
  return exp;
}
