import { replitOpenai } from "./providers";

export interface CritiqueResult {
  score: number;
  accuracy: number;
  completeness: number;
  relevance: number;
  clarity: number;
  issues: string[];
  refinedResponse?: string;
  wasRefined: boolean;
}

const CRITIQUE_THRESHOLD = 6.0;

const CRITIQUE_SYSTEM_PROMPT = `You are a Critique Agent — a quality control specialist that evaluates AI responses before delivery.

Score the response on 4 dimensions (1-10 each):
1. ACCURACY — Are claims factually correct? No hallucinations?
2. COMPLETENESS — Does the response fully address the user's question?
3. RELEVANCE — Is everything in the response relevant to what was asked?
4. CLARITY — Is the response well-organized, clear, and easy to understand?

Output ONLY valid JSON:
{
  "accuracy": <1-10>,
  "completeness": <1-10>,
  "relevance": <1-10>,
  "clarity": <1-10>,
  "issues": ["list of specific problems found, empty if none"],
  "needs_refinement": true/false
}`;

const REFINE_SYSTEM_PROMPT = `You are a Response Refinement Agent. You receive an original AI response along with critique feedback identifying specific issues. Your job is to produce an improved version that fixes the identified issues while preserving the response's strengths and original intent.

Rules:
- Fix ONLY the identified issues
- Preserve the original tone, style, and structure where possible
- Do not add unnecessary content
- Do not remove good content
- Output ONLY the refined response text`;

export async function critiqueResponse(
  userMessage: string,
  assistantResponse: string,
  personaRole?: string
): Promise<CritiqueResult> {
  if (assistantResponse.length < 50) {
    return {
      score: 10,
      accuracy: 10,
      completeness: 10,
      relevance: 10,
      clarity: 10,
      issues: [],
      wasRefined: false,
    };
  }

  try {
    const critiqueResp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: CRITIQUE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `User asked: "${userMessage.slice(0, 500)}"\n\nAssistant (${personaRole || "general"}) responded:\n"${assistantResponse.slice(0, 2000)}"\n\nEvaluate this response:`,
        },
      ],
      max_completion_tokens: 300,
      response_format: { type: "json_object" },
    });

    const content = critiqueResp.choices[0]?.message?.content;
    if (!content) {
      return defaultPassResult();
    }

    const parsed = JSON.parse(content);
    const accuracy = clamp(safeNum(parsed.accuracy, 8), 1, 10);
    const completeness = clamp(safeNum(parsed.completeness, 8), 1, 10);
    const relevance = clamp(safeNum(parsed.relevance, 8), 1, 10);
    const clarity = clamp(safeNum(parsed.clarity, 8), 1, 10);
    const score = (accuracy + completeness + relevance + clarity) / 4;
    const issues: string[] = Array.isArray(parsed.issues) ? parsed.issues : [];

    console.log(`[critique] Score: ${score.toFixed(1)}/10 (A:${accuracy} C:${completeness} R:${relevance} CL:${clarity}) Issues: ${issues.length}`);

    if (score < CRITIQUE_THRESHOLD && parsed.needs_refinement && issues.length > 0) {
      try {
        const refined = await refineResponse(userMessage, assistantResponse, issues);
        if (refined && refined.length > 20) {
          console.log(`[critique] Response refined (${assistantResponse.length} → ${refined.length} chars)`);
          return {
            score,
            accuracy,
            completeness,
            relevance,
            clarity,
            issues,
            refinedResponse: refined,
            wasRefined: true,
          };
        }
      } catch (err) {
        console.log(`[critique] Refinement failed: ${(err as Error).message}`);
      }
    }

    return {
      score,
      accuracy,
      completeness,
      relevance,
      clarity,
      issues,
      wasRefined: false,
    };
  } catch (err) {
    console.log(`[critique] Critique failed: ${(err as Error).message}`);
    return defaultPassResult();
  }
}

async function refineResponse(
  userMessage: string,
  originalResponse: string,
  issues: string[]
): Promise<string | null> {
  const refineResp = await replitOpenai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: REFINE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Original user question: "${userMessage.slice(0, 300)}"\n\nOriginal response:\n${originalResponse.slice(0, 2000)}\n\nIssues identified:\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}\n\nProduce the refined response:`,
      },
    ],
    max_completion_tokens: 2000,
  });

  return refineResp.choices[0]?.message?.content?.trim() || null;
}

export async function critiqueToolForAgent(
  content: string,
  context: string
): Promise<{ score: number; feedback: string; suggestions: string[] }> {
  try {
    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `You are a quality reviewer. Evaluate the provided content in the given context. Output JSON: { "score": <1-10>, "feedback": "summary", "suggestions": ["improvement 1", "improvement 2"] }`,
        },
        {
          role: "user",
          content: `Context: ${context.slice(0, 300)}\n\nContent to review:\n${content.slice(0, 2000)}`,
        },
      ],
      max_completion_tokens: 300,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}");
    return {
      score: clamp(safeNum(parsed.score, 7), 1, 10),
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "No specific feedback",
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((s: any) => typeof s === "string") : [],
    };
  } catch {
    return { score: 7, feedback: "Critique unavailable", suggestions: [] };
  }
}

function safeNum(val: any, fallback: number): number {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function defaultPassResult(): CritiqueResult {
  return {
    score: 8,
    accuracy: 8,
    completeness: 8,
    relevance: 8,
    clarity: 8,
    issues: [],
    wasRefined: false,
  };
}
