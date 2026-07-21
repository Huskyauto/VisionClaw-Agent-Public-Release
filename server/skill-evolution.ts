import { db } from "./db";
import { sql } from "drizzle-orm";
import { getClientForModel } from "./providers";

async function quickLLM(tenantId: number, systemPrompt: string, userPrompt: string, maxTokens = 300, temperature = 0.3): Promise<string> {
  // Use the RETURNED actualModelId: the $0 policy may swap the client to the free
  // modelfarm lane, and sending the original id to that endpoint 400s.
  const { client, actualModelId } = await getClientForModel("openai/gpt-4.1-mini", tenantId, {});
  const resp = await client.chat.completions.create({
    model: actualModelId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: maxTokens,
    temperature,
  });
  return resp.choices?.[0]?.message?.content?.trim() || "";
}

const EVOLUTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_CALLS_FOR_ANALYSIS = 10;
const FAILURE_RATE_THRESHOLD = 0.3;
const MAX_OPTIMIZATIONS_PER_RUN = 5;

const tenantEvolutionState = new Map<number, { lastRun: number; running: boolean }>();

function getEvolutionState(tenantId: number) {
  let state = tenantEvolutionState.get(tenantId);
  if (!state) {
    state = { lastRun: 0, running: false };
    tenantEvolutionState.set(tenantId, state);
  }
  return state;
}

export async function trackToolExecution(
  tenantId: number,
  toolName: string,
  success: boolean,
  durationMs: number,
  failureReason?: string
): Promise<void> {
  try {
    if (success) {
      await db.execute(sql`
        INSERT INTO tool_performance (tenant_id, tool_name, success_count, total_duration_ms, last_success_at)
        VALUES (${tenantId}, ${toolName}, 1, ${durationMs}, NOW())
        ON CONFLICT (tenant_id, tool_name) DO UPDATE SET
          success_count = tool_performance.success_count + 1,
          total_duration_ms = tool_performance.total_duration_ms + ${durationMs},
          last_success_at = NOW(),
          updated_at = NOW()
      `);
    } else {
      await db.execute(sql`
        INSERT INTO tool_performance (tenant_id, tool_name, fail_count, total_duration_ms, last_failure_reason, last_failure_at)
        VALUES (${tenantId}, ${toolName}, 1, ${durationMs}, ${failureReason || null}, NOW())
        ON CONFLICT (tenant_id, tool_name) DO UPDATE SET
          fail_count = tool_performance.fail_count + 1,
          total_duration_ms = tool_performance.total_duration_ms + ${durationMs},
          last_failure_reason = ${failureReason || null},
          last_failure_at = NOW(),
          updated_at = NOW()
      `);
    }
  } catch (err: any) {
    console.warn(`[skill-evo] Track failed for ${toolName}:`, err.message);
  }
}

export async function getToolPerformanceReport(tenantId: number): Promise<string> {
  try {
    const result = await db.execute(sql`
      SELECT tool_name, success_count, fail_count,
        total_duration_ms,
        CASE WHEN (success_count + fail_count) > 0
          THEN ROUND(fail_count::numeric / (success_count + fail_count), 3)
          ELSE 0 END as failure_rate,
        last_failure_reason, last_failure_at, last_success_at
      FROM tool_performance
      WHERE tenant_id = ${tenantId} AND (success_count + fail_count) >= 3
      ORDER BY failure_rate DESC, (success_count + fail_count) DESC
      LIMIT 30
    `);
    const rows = (result as any).rows || [];
    if (rows.length === 0) return "No tool performance data yet.";

    const lines: string[] = ["[Tool Performance Report]"];
    for (const r of rows) {
      const total = r.success_count + r.fail_count;
      const avgMs = total > 0 ? Math.round(r.total_duration_ms / total) : 0;
      const rate = (parseFloat(r.failure_rate) * 100).toFixed(1);
      const status = parseFloat(r.failure_rate) > 0.3 ? "⚠️" : "✓";
      lines.push(`${status} ${r.tool_name}: ${r.success_count}/${total} success (${rate}% fail, avg ${avgMs}ms)${r.last_failure_reason ? ` — last error: ${r.last_failure_reason.slice(0, 80)}` : ""}`);
    }
    return lines.join("\n");
  } catch {
    return "Unable to retrieve tool performance data.";
  }
}

async function getUnderperformingTools(tenantId: number): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT tool_name, success_count, fail_count, last_failure_reason,
      total_duration_ms,
      CASE WHEN (success_count + fail_count) > 0
        THEN fail_count::numeric / (success_count + fail_count)
        ELSE 0 END as failure_rate
    FROM tool_performance
    WHERE tenant_id = ${tenantId}
      AND (success_count + fail_count) >= ${MIN_CALLS_FOR_ANALYSIS}
      AND fail_count::numeric / GREATEST(success_count + fail_count, 1) >= ${FAILURE_RATE_THRESHOLD}
    ORDER BY failure_rate DESC
    LIMIT ${MAX_OPTIMIZATIONS_PER_RUN}
  `);
  return (result as any).rows || [];
}

async function getExistingOptimizations(tenantId: number, toolName: string): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT * FROM tool_optimizations
    WHERE tenant_id = ${tenantId} AND tool_name = ${toolName}
    ORDER BY created_at DESC LIMIT 3
  `);
  return (result as any).rows || [];
}

export async function runEvolutionCycle(tenantId: number): Promise<string[]> {
  const state = getEvolutionState(tenantId);
  if (state.running) return ["Evolution cycle already running"];
  const now = Date.now();
  if (now - state.lastRun < EVOLUTION_INTERVAL_MS) {
    return ["Too soon for another evolution cycle"];
  }

  state.running = true;
  state.lastRun = now;
  const improvements: string[] = [];

  try {
    const underperforming = await getUnderperformingTools(tenantId);
    if (underperforming.length === 0) {
      improvements.push("All tools performing well — no optimization needed.");
      return improvements;
    }

    for (const tool of underperforming) {
      try {
        const existing = await getExistingOptimizations(tenantId, tool.tool_name);
        const existingHints = existing.map(e => e.optimized_hint).join("; ");

        const analysis = await quickLLM(
          tenantId,
          `You are a Tool Performance Optimizer. Analyze why an AI tool is failing and generate an improvement hint.

Return JSON:
{
  "failurePattern": "1-2 sentence description of the root cause pattern",
  "optimizedHint": "A concise usage hint (max 150 chars) that helps agents use this tool correctly. Focus on: required parameters, common mistakes, when NOT to use it.",
  "improvementScore": 0.0-1.0 (estimated improvement impact)
}

Previous optimization attempts: ${existingHints || "none"}
Do NOT repeat previous optimizations. Suggest a different angle.`,
          `Tool: ${tool.tool_name}
Success rate: ${tool.success_count}/${tool.success_count + tool.fail_count} (${((1 - parseFloat(tool.failure_rate)) * 100).toFixed(0)}%)
Last failure: ${tool.last_failure_reason || "unknown"}
Avg duration: ${Math.round(tool.total_duration_ms / (tool.success_count + tool.fail_count))}ms`,
        );

        const cleaned = analysis.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);

        await db.execute(sql`
          INSERT INTO tool_optimizations (tenant_id, tool_name, optimization_type, optimized_hint, failure_pattern, improvement_score)
          VALUES (${tenantId}, ${tool.tool_name}, 'usage_hint', ${parsed.optimizedHint}, ${parsed.failurePattern}, ${parsed.improvementScore || 0.5})
        `);

        improvements.push(`${tool.tool_name}: ${parsed.optimizedHint} (pattern: ${parsed.failurePattern})`);
        console.log(`[skill-evo] Optimization for ${tool.tool_name}: ${parsed.optimizedHint}`);
      } catch (err: any) {
        console.warn(`[skill-evo] Failed to optimize ${tool.tool_name}:`, err.message);
      }
    }

    return improvements;
  } catch (err: any) {
    console.error("[skill-evo] Evolution cycle failed:", err.message);
    return ["Evolution cycle failed: " + err.message];
  } finally {
    state.running = false;
  }
}

export async function getActiveOptimizations(tenantId: number): Promise<string> {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT ON (tool_name) tool_name, optimized_hint, failure_pattern, improvement_score
      FROM tool_optimizations
      WHERE tenant_id = ${tenantId}
      ORDER BY tool_name, created_at DESC
    `);
    const rows = (result as any).rows || [];
    if (rows.length === 0) return "";

    const lines: string[] = ["[Tool Optimization Hints — Learned from Execution Traces]"];
    for (const r of rows) {
      lines.push(`• ${r.tool_name}: ${r.optimized_hint}`);
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

export async function getEvolutionSummary(tenantId: number): Promise<string> {
  try {
    const toolCount = await db.execute(sql`
      SELECT COUNT(*) as count FROM tool_performance WHERE tenant_id = ${tenantId}
    `);
    const optCount = await db.execute(sql`
      SELECT COUNT(*) as count FROM tool_optimizations WHERE tenant_id = ${tenantId}
    `);
    const underperf = await getUnderperformingTools(tenantId);

    const total = parseInt(((toolCount as any).rows?.[0]?.count) || "0");
    const opts = parseInt(((optCount as any).rows?.[0]?.count) || "0");

    const state = getEvolutionState(tenantId);
    return `[Skill Evolution Summary]\nTools tracked: ${total}\nOptimizations generated: ${opts}\nCurrently underperforming: ${underperf.length}\nLast evolution run: ${state.lastRun ? new Date(state.lastRun).toISOString() : "never"}`;
  } catch {
    return "Unable to retrieve evolution summary.";
  }
}

// ============================================================================
// R56: Micro-Sabbatical Wellbeing Intervention System
// Source: research proposal #13 ("Add Micro-Sabbatical Intervention Skill for
//   Late-Night User Support") — Felix-wellness mission core.
// Felix detects late-night fatigue/craving signals and offers sensory-rich
// "receive instead of reach" interventions in place of food.
// ============================================================================

const FATIGUE_KEYWORDS = [
  "tired", "exhausted", "burned out", "burnt out", "can't sleep",
  "late night", "craving", "snack", "2am", "3am", "fatigue",
  "overwhelmed", "need a break", "stressed", "anxious", "mind racing",
];

interface MicroSabbaticalIntervention {
  id: string;
  prompt: string;
  sensoryFocus: "auditory" | "visual" | "tactile" | "thermal";
  duration: string;
  effort: "ultra-low" | "low" | "medium";
}

const MICRO_SABBATICAL_INTERVENTIONS: MicroSabbaticalIntervention[] = [
  {
    id: "quiet_house",
    prompt:
      "You're off duty. This craving isn't hunger; it's your exhausted self asking for a micro-sabbatical. Let's receive instead of reach: sit right here, close your eyes, and just listen to the quiet hum of the house for 60 seconds.",
    sensoryFocus: "auditory",
    duration: "60 seconds",
    effort: "ultra-low",
  },
  {
    id: "window_gaze",
    prompt:
      "Your mind is asking for space, not food. Give yourself a micro-sabbatical: go to a window, look at the night sky or street lights, and breathe deeply 10 times. Just receive the stillness.",
    sensoryFocus: "visual",
    duration: "2 minutes",
    effort: "low",
  },
  {
    id: "weighted_comfort",
    prompt:
      "That craving is a signal for rest, not sustenance. Let's receive comfort instead: find something with weight — a blanket, pillow, or heavy book. Place it on your lap and feel the grounding pressure. Breathe into that sensation.",
    sensoryFocus: "tactile",
    duration: "90 seconds",
    effort: "low",
  },
  {
    id: "temperature_shift",
    prompt:
      "Exhaustion speaks through cravings. Give it a micro-sabbatical: hold an ice cube for 30 seconds, then switch to a warm mug. Notice the temperature contrast without judgment. You're receiving sensation, not chasing distraction.",
    sensoryFocus: "thermal",
    duration: "2 minutes",
    effort: "medium",
  },
];

export interface FatigueDetectionResult {
  detected: boolean;
  confidence: number;
  fatigueType?: "late_night" | "general_exhaustion" | "stress_craving";
  context?: string;
  matchedKeywords?: string[];
}

export function detectUserFatigue(
  userMessage: string,
  timestamp?: Date,
): FatigueDetectionResult {
  const message = (userMessage || "").toLowerCase();
  const hour = timestamp ? timestamp.getHours() : new Date().getHours();

  const matchedKeywords: string[] = [];
  for (const keyword of FATIGUE_KEYWORDS) {
    if (message.includes(keyword)) matchedKeywords.push(keyword);
  }

  // Confidence: each match worth ~12 points, capped at 100
  const confidence = Math.min(matchedKeywords.length * 12, 100);

  if (matchedKeywords.length === 0) {
    return { detected: false, confidence: 0 };
  }

  let fatigueType: FatigueDetectionResult["fatigueType"] = "general_exhaustion";
  const isLateNight = hour >= 22 || hour <= 4;
  const hasCraving =
    message.includes("craving") || message.includes("snack") || message.includes("hungry");
  const hasStress =
    message.includes("stress") || message.includes("anxious") || message.includes("overwhelmed");

  if (hasCraving && isLateNight) fatigueType = "late_night";
  else if (hasStress) fatigueType = "stress_craving";
  else if (isLateNight) fatigueType = "late_night";

  return {
    detected: true,
    confidence,
    fatigueType,
    matchedKeywords,
    context: `Matched: ${matchedKeywords.join(", ")} | hour=${hour}`,
  };
}

export function generateMicroSabbaticalIntervention(
  fatigueResult: FatigueDetectionResult,
  previousInterventionIds: string[] = [],
): { id: string; prompt: string; sensoryFocus: string; duration: string } | null {
  if (!fatigueResult.detected || fatigueResult.confidence < 20) return null;

  let pool = MICRO_SABBATICAL_INTERVENTIONS;

  // Late-night → prefer ultra-low / low effort only
  if (fatigueResult.fatigueType === "late_night") {
    pool = pool.filter((i) => i.effort === "ultra-low" || i.effort === "low");
  }

  // Avoid repeats
  const fresh = pool.filter((i) => !previousInterventionIds.includes(i.id));
  const picks = fresh.length > 0 ? fresh : pool;

  const choice = picks[Math.floor(Math.random() * picks.length)];
  return {
    id: choice.id,
    prompt: choice.prompt,
    sensoryFocus: choice.sensoryFocus,
    duration: choice.duration,
  };
}

export async function trackInterventionEffectiveness(
  tenantId: number,
  userId: string | null,
  interventionId: string,
  fatigueType: string | null,
  accepted: boolean,
  feedback?: string,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO wellbeing_interventions
        (tenant_id, user_id, intervention_id, intervention_type, fatigue_type, accepted, feedback)
      VALUES
        (${tenantId}, ${userId}, ${interventionId}, 'micro_sabbatical',
         ${fatigueType}, ${accepted}, ${feedback || null})
    `);
  } catch (err: any) {
    console.warn(`[skill-evolution] tracking failed: ${err?.message || err}`);
  }
}
