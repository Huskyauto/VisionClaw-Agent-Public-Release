import { replitOpenai } from "./providers";
import { TOOL_DEFINITIONS, getAllToolDefinitions } from "./tools";

import { logSilentCatch } from "./lib/silent-catch";
export interface ReflectionResult {
  shouldRefine: boolean;
  scores: {
    accuracy: number;
    completeness: number;
    relevance: number;
    tone: number;
    overall: number;
  };
  critique: string;
  refinedResponse?: string;
}

const REFLECTION_PROMPT = `You are a quality evaluator for an AI assistant's response. Evaluate the response on these criteria, scoring each from 1-10:

1. **Accuracy** — Is the information correct? Are claims supported?
2. **Completeness** — Does it fully address the user's question? Missing anything important?
3. **Relevance** — Does it stay on topic? Is everything included actually relevant?
4. **Tone** — Is it appropriate, professional, and matching the conversation context?

Respond in this exact JSON format:
{
  "accuracy": <1-10>,
  "completeness": <1-10>,
  "relevance": <1-10>,
  "tone": <1-10>,
  "overall": <1-10>,
  "critique": "<brief 1-2 sentence critique explaining any issues>",
  "shouldRefine": <true if overall < 7 or any individual score < 5>
}`;

const REFINEMENT_PROMPT = `You are refining an AI assistant's response based on quality feedback. 

The original response had these issues:
{{critique}}

Scores: accuracy={{accuracy}}, completeness={{completeness}}, relevance={{relevance}}, tone={{tone}}

Rewrite the response to address the identified issues. Keep what was good, fix what was lacking. Return ONLY the improved response text, nothing else.`;

export async function reflectOnResponse(
  userMessage: string,
  assistantResponse: string,
  personaName?: string,
): Promise<ReflectionResult> {
  if (assistantResponse.length < 20) {
    return {
      shouldRefine: false,
      scores: { accuracy: 8, completeness: 8, relevance: 8, tone: 8, overall: 8 },
      critique: "Response too short for meaningful reflection.",
    };
  }

  try {
    const truncatedUser = userMessage.slice(0, 500);
    const truncatedResponse = assistantResponse.slice(0, 2000);

    const evalResp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: REFLECTION_PROMPT },
        {
          role: "user",
          content: `User's message: "${truncatedUser}"\n\nAssistant's response: "${truncatedResponse}"\n\n${personaName ? `Persona: ${personaName}` : ""}`,
        },
      ],
      max_completion_tokens: 300,
    });

    const evalText = evalResp.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = evalText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        shouldRefine: false,
        scores: { accuracy: 7, completeness: 7, relevance: 7, tone: 7, overall: 7 },
        critique: "Could not parse reflection evaluation.",
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const scores = {
      accuracy: Math.min(10, Math.max(1, parsed.accuracy || 7)),
      completeness: Math.min(10, Math.max(1, parsed.completeness || 7)),
      relevance: Math.min(10, Math.max(1, parsed.relevance || 7)),
      tone: Math.min(10, Math.max(1, parsed.tone || 7)),
      overall: Math.min(10, Math.max(1, parsed.overall || 7)),
    };

    const shouldRefine = parsed.shouldRefine === true || scores.overall < 7 || Object.values(scores).some(s => s < 5);

    return {
      shouldRefine,
      scores,
      critique: parsed.critique || "No specific issues found.",
    };
  } catch (err: any) {
    console.log(`[self-reflection] Evaluation error: ${err.message}`);
    return {
      shouldRefine: false,
      scores: { accuracy: 7, completeness: 7, relevance: 7, tone: 7, overall: 7 },
      critique: "Reflection skipped due to error.",
    };
  }
}

export async function refineResponse(
  userMessage: string,
  originalResponse: string,
  reflection: ReflectionResult,
  model: string,
): Promise<string> {
  try {
    const prompt = REFINEMENT_PROMPT
      .replace("{{critique}}", reflection.critique)
      .replace("{{accuracy}}", String(reflection.scores.accuracy))
      .replace("{{completeness}}", String(reflection.scores.completeness))
      .replace("{{relevance}}", String(reflection.scores.relevance))
      .replace("{{tone}}", String(reflection.scores.tone));

    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Original user question: "${userMessage.slice(0, 500)}"\n\nOriginal response to refine:\n${originalResponse.slice(0, 3000)}` },
      ],
      max_completion_tokens: 16384,
    });

    return resp.choices?.[0]?.message?.content?.trim() || originalResponse;
  } catch (err: any) {
    console.log(`[self-reflection] Refinement error: ${err.message}`);
    return originalResponse;
  }
}


let _cachedAllTools: any[] | null = null;
let _cacheTime = 0;
async function getAllTools(): Promise<any[]> {
  if (_cachedAllTools && Date.now() - _cacheTime < 60_000) return _cachedAllTools;
  try {
    _cachedAllTools = await getAllToolDefinitions();
  } catch {
    _cachedAllTools = TOOL_DEFINITIONS;
  }
  _cacheTime = Date.now();
  return _cachedAllTools;
}

function getAllToolsSync(): any[] {
  return _cachedAllTools || TOOL_DEFINITIONS;
}

export function introspectTool(toolName: string): any {
  const defs = getAllToolsSync();
  const def = defs.find(
    (t: any) => (t.function?.name || t.name) === toolName
  );
  if (!def) return null;
  const fn = (def as any).function || def;
  return {
    name: fn.name,
    description: fn.description,
    parameters: fn.parameters,
  };
}

export async function searchTools(query: string): Promise<any[]> {
  const defs = await getAllTools();
  const q = query.toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 2);

  return defs
    .map((t: any) => {
      const fn = t.function || t;
      const name = (fn.name || "").toLowerCase();
      const desc = (fn.description || "").toLowerCase();
      const params = JSON.stringify(fn.parameters || {}).toLowerCase();
      let score = 0;
      for (const w of words) {
        if (name.includes(w)) score += 3;
        if (desc.includes(w)) score += 2;
        if (params.includes(w)) score += 1;
      }
      return { name: fn.name, description: fn.description?.slice(0, 200), score };
    })
    .filter(t => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ name, description, score }) => ({ name, description, relevance: score }));
}

export async function listToolSummaries(): Promise<{ name: string; description: string }[]> {
  const defs = await getAllTools();
  return defs.map((t: any) => {
    const fn = t.function || t;
    return {
      name: fn.name,
      description: (fn.description || "").split("\n")[0].slice(0, 120),
    };
  });
}

export interface DiagnosisInput {
  toolName: string;
  paramsUsed: Record<string, any>;
  resultReceived: any;
  expectedOutcome: string;
}

export function diagnoseToolResult(input: DiagnosisInput): {
  diagnosis: string;
  missingParams: string[];
  unusedParams: string[];
  suggestions: string[];
} {
  const toolDef = introspectTool(input.toolName);
  if (!toolDef) {
    return {
      diagnosis: `Tool "${input.toolName}" not found in registry. Check tool name spelling.`,
      missingParams: [],
      unusedParams: [],
      suggestions: [`Use introspect_tools with action "search" to find the correct tool name.`],
    };
  }

  const props = toolDef.parameters?.properties || {};
  const required = toolDef.parameters?.required || [];
  const availableParams = Object.keys(props);
  const usedParams = Object.keys(input.paramsUsed || {}).filter(k => !k.startsWith("_"));

  const missingRequired = required.filter(
    (p: string) => !(p in (input.paramsUsed || {})) && p !== "_tenantId"
  );
  const unusedAvailable = availableParams.filter(
    (p: string) => !(p in (input.paramsUsed || {})) && !p.startsWith("_")
  );

  const suggestions: string[] = [];
  const diagParts: string[] = [];

  if (missingRequired.length > 0) {
    diagParts.push(
      `Missing required parameters: ${missingRequired.join(", ")}.`
    );
    for (const p of missingRequired) {
      const desc = props[p]?.description || "";
      suggestions.push(`Add required parameter "${p}": ${desc}`);
    }
  }

  const expected = input.expectedOutcome.toLowerCase();
  for (const [name, schema] of Object.entries(props) as [string, any][]) {
    if (usedParams.includes(name)) continue;
    const desc = (schema.description || "").toLowerCase();
    const nameL = name.toLowerCase();
    const words = expected.split(/\s+/).filter(w => w.length > 3);
    for (const w of words) {
      if (desc.includes(w) || nameL.includes(w)) {
        suggestions.push(
          `Parameter "${name}" may address your expected outcome: ${schema.description?.slice(0, 150) || ""}`
        );
        break;
      }
    }
  }

  const result = input.resultReceived;
  const resultStr = typeof result === "string" ? result : JSON.stringify(result || {});
  if (resultStr.includes("error") || resultStr.includes("Error")) {
    const errorMatch = resultStr.match(/"error"\s*:\s*"([^"]+)"/);
    if (errorMatch) {
      diagParts.push(`Tool returned error: "${errorMatch[1]}"`);
    } else {
      diagParts.push("Tool result contains error indicators.");
    }
  }

  if (resultStr.includes("imageWarning") || resultStr.includes("imagesFailed")) {
    diagParts.push("Image insertion had failures.");
    suggestions.push("Verify all image URLs are publicly accessible HTTPS URLs hosted on Google Drive.");
  }

  if (diagParts.length === 0 && suggestions.length === 0) {
    diagParts.push(
      `Tool "${input.toolName}" executed without obvious errors. ` +
      `${unusedAvailable.length} additional parameters available.`
    );
    if (unusedAvailable.length > 0 && unusedAvailable.length <= 10) {
      suggestions.push(
        `Unused parameters that might help: ${unusedAvailable.join(", ")}. ` +
        `Inspect tool for full descriptions.`
      );
    }
  }

  return {
    diagnosis: diagParts.join(" ") || "No issues detected.",
    missingParams: missingRequired,
    unusedParams: unusedAvailable,
    suggestions,
  };
}

export interface ActionableLesson {
  trigger: string;
  action: string;
  parameter?: string;
  toolName: string;
  confidence: number;
}

export function formatLessonAsFact(lesson: ActionableLesson): string {
  let fact = `WHEN ${lesson.trigger} THEN ${lesson.action}`;
  if (lesson.parameter) {
    fact += ` (use parameter: ${lesson.parameter})`;
  }
  fact += ` [tool: ${lesson.toolName}, confidence: ${lesson.confidence}]`;
  return fact;
}

export function parseLessonFromDiagnosis(
  toolName: string,
  diagnosis: ReturnType<typeof diagnoseToolResult>,
  expectedOutcome: string
): ActionableLesson | null {
  if (diagnosis.suggestions.length === 0) return null;

  const paramMatch = diagnosis.suggestions[0]?.match(/Parameter "(\w+)"/);
  const param = paramMatch ? paramMatch[1] : undefined;

  return {
    trigger: `using ${toolName} and expecting: ${expectedOutcome.slice(0, 80)}`,
    action: diagnosis.suggestions[0]?.slice(0, 150) || "review available parameters",
    parameter: param,
    toolName,
    confidence: 0.8,
  };
}

export async function storeLesson(
  lesson: ActionableLesson,
  tenantId: number,
  personaId?: number
): Promise<void> {
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const fact = formatLessonAsFact(lesson);

    const existing = await db.execute(sql`
      SELECT id FROM memory_entries
      WHERE tenant_id = ${tenantId}
        AND source = 'self_reflection'
        AND category = 'actionable_lesson'
        AND fact LIKE ${"%" + lesson.toolName + "%"}
        AND fact LIKE ${"%" + (lesson.parameter || lesson.action.slice(0, 30)) + "%"}
      LIMIT 1
    `);

    if ((existing as any).rows?.length > 0) {
      await db.execute(sql`
        UPDATE memory_entries
        SET fact = ${fact}, last_accessed = NOW(), access_count = access_count + 1
        WHERE id = ${(existing as any).rows[0].id}
      `);
      console.log(`[self-reflection] Updated lesson for ${lesson.toolName}`);
    } else {
      await db.execute(sql`
        INSERT INTO memory_entries (tenant_id, persona_id, fact, category, source, created_at)
        VALUES (${tenantId}, ${personaId || 2}, ${fact}, 'actionable_lesson', 'self_reflection', NOW())
      `);
      console.log(`[self-reflection] Stored lesson: ${fact.slice(0, 80)}...`);
    }
  } catch (err: any) {
    console.error(`[self-reflection] Failed to store lesson: ${err.message}`);
  }
}

export async function recallLessons(
  toolName: string,
  tenantId: number,
  limit = 5
): Promise<string[]> {
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      SELECT fact FROM memory_entries
      WHERE tenant_id = ${tenantId}
        AND source = 'self_reflection'
        AND category = 'actionable_lesson'
        AND fact LIKE ${"%" + toolName + "%"}
      ORDER BY last_accessed DESC, created_at DESC
      LIMIT ${limit}
    `);
    return ((result as any).rows || []).map((r: any) => r.fact);
  } catch {
    return [];
  }
}

export async function autoDiagnoseAndSuggestRetry(
  toolName: string,
  paramsUsed: Record<string, any>,
  errorResult: any,
  tenantId: number,
  personaId?: number,
): Promise<{
  diagnosis: string;
  correctedParams: Record<string, any> | null;
  alternativeTools: { name: string; description: string; relevance: number }[];
  lessonStored: boolean;
}> {
  try {
    const errorStr = typeof errorResult === "string"
      ? errorResult
      : (errorResult?.error || errorResult?.message || (errorResult != null ? JSON.stringify(errorResult).slice(0, 300) : "unknown error"));

    const diagnosis = diagnoseToolResult({
      toolName,
      paramsUsed,
      resultReceived: errorResult,
      expectedOutcome: `successful execution without error: ${errorStr}`,
    });

    let lessonStored = false;
    const lesson = parseLessonFromDiagnosis(toolName, diagnosis, errorStr);
    if (lesson) {
      await storeLesson(lesson, tenantId, personaId);
      lessonStored = true;
    }

    let correctedParams: Record<string, any> | null = null;
    if (diagnosis.missingParams.length > 0) {
      correctedParams = { ...paramsUsed };
      const toolDef = introspectTool(toolName);
      const props = toolDef?.parameters?.properties || {};
      for (const p of diagnosis.missingParams) {
        const schema = props[p];
        if (schema) {
          if (schema.default !== undefined) correctedParams[p] = schema.default;
          else if (schema.type === "boolean") correctedParams[p] = false;
          else if (schema.type === "string" && schema.enum?.length) correctedParams[p] = schema.enum[0];
        }
      }
    }

    let alternativeTools: { name: string; description: string; relevance: number }[] = [];
    if (diagnosis.suggestions.length === 0 || !correctedParams) {
      try {
        const keywords = toolName.replace(/_/g, " ");
        alternativeTools = await searchTools(keywords);
        alternativeTools = alternativeTools.filter(t => t.name !== toolName).slice(0, 5);
      } catch (_silentErr) { logSilentCatch("server/self-reflection.ts", _silentErr); }
    }

    console.log(`[self-correction] Auto-diagnosed ${toolName}: ${diagnosis.diagnosis.slice(0, 100)}${correctedParams ? " (corrected params available)" : ""}${alternativeTools.length ? ` (${alternativeTools.length} alternatives found)` : ""}`);

    return {
      diagnosis: diagnosis.diagnosis,
      correctedParams,
      alternativeTools,
      lessonStored,
    };
  } catch (err: any) {
    console.error(`[self-correction] Auto-diagnosis failed for ${toolName}: ${err.message}`);
    return {
      diagnosis: `Auto-diagnosis failed: ${err.message}`,
      correctedParams: null,
      alternativeTools: [],
      lessonStored: false,
    };
  }
}

export async function recallAllRecentLessons(
  tenantId: number,
  limit = 10
): Promise<string[]> {
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      SELECT fact FROM memory_entries
      WHERE tenant_id = ${tenantId}
        AND source = 'self_reflection'
        AND category = 'actionable_lesson'
      ORDER BY last_accessed DESC, created_at DESC
      LIMIT ${limit}
    `);
    return ((result as any).rows || []).map((r: any) => r.fact);
  } catch {
    return [];
  }
}
