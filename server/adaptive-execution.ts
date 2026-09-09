import { replitOpenai } from "./providers";
import { storage } from "./storage";

export interface DiagnosticStrategy {
  diagnosis: string;
  alternativeApproach: string;
  adjustedArgs: Record<string, any>;
  confidence: number;
}

export interface AdaptiveResult {
  success: boolean;
  result: any;
  attempts: number;
  strategies: string[];
  lessonLearned?: string;
}

const ERROR_PATTERNS: Record<string, { diagnosis: string; strategies: string[] }> = {
  "Authentication required": {
    diagnosis: "The resource requires authentication. The local URL won't work for customers.",
    strategies: ["Upload to Google Drive instead", "Use uploadAndShare to get a public link", "Generate a shareable URL"],
  },
  "timeout": {
    diagnosis: "The operation took too long. Could be network, large file, or slow target.",
    strategies: ["Increase timeout", "Try a simpler version first", "Break into smaller steps", "Try a different URL or approach"],
  },
  "ENOTFOUND": {
    diagnosis: "DNS resolution failed. The domain doesn't exist or is unreachable.",
    strategies: ["Check URL spelling", "Try with www prefix", "Try alternative domain"],
  },
  "Access Denied": {
    diagnosis: "The target blocked the request. May need stealth mode or different approach.",
    strategies: ["Enable stealth mode", "Change user agent", "Add delays between actions", "Try a different entry point"],
  },
  "not found": {
    diagnosis: "The resource doesn't exist at that location.",
    strategies: ["Check the path/URL", "Search for the correct resource", "Try a broader search"],
  },
  "rate limit": {
    diagnosis: "Too many requests. Need to slow down.",
    strategies: ["Wait and retry after delay", "Reduce request frequency", "Use cached results if available"],
  },
  "No page": {
    diagnosis: "Browser has no active page. Need to navigate first.",
    strategies: ["Navigate to the URL first", "Create a new browser session", "Check if browser is connected"],
  },
  "tenant context": {
    diagnosis: "Missing tenant/user context for the operation.",
    strategies: ["Ensure _tenantId is set", "Check authentication state", "Re-initialize the session"],
  },
};

function matchErrorPattern(error: string): { diagnosis: string; strategies: string[] } | null {
  const lowerErr = error.toLowerCase();
  for (const [pattern, info] of Object.entries(ERROR_PATTERNS)) {
    if (lowerErr.includes(pattern.toLowerCase())) {
      return info;
    }
  }
  return null;
}

export function buildAdaptiveHint(toolName: string, error: string, attempt: number, pastLessons: string[]): string {
  const pattern = matchErrorPattern(error);

  let hint = `ADAPTIVE SELF-HEAL (attempt ${attempt}): Tool "${toolName}" failed with: "${error}"\n\n`;

  if (pattern) {
    hint += `DIAGNOSIS: ${pattern.diagnosis}\n`;
    hint += `SUGGESTED STRATEGIES:\n`;
    pattern.strategies.forEach((s, i) => {
      hint += `${i + 1}. ${s}\n`;
    });
  } else {
    hint += `No known pattern match. Analyze the error carefully:\n`;
    hint += `1. What exactly went wrong? Read the error message.\n`;
    hint += `2. What assumption did you make that might be wrong?\n`;
    hint += `3. Is there a completely different tool or approach that could work?\n`;
    hint += `4. Would breaking this into smaller steps help?\n`;
  }

  if (pastLessons.length > 0) {
    hint += `\nLESSONS FROM PAST EXPERIENCE:\n`;
    pastLessons.forEach(l => {
      hint += `- ${l}\n`;
    });
  }

  hint += `\nRULES:\n`;
  hint += `- Do NOT repeat the exact same call that failed.\n`;
  hint += `- Change at least one parameter or try a different approach entirely.\n`;
  hint += `- If you've tried 2+ times, step back and reconsider your whole strategy.\n`;
  hint += `- If delivering a file/image to a customer, ALWAYS use Google Drive (uploadAndShare). Local URLs don't work.\n`;

  if (attempt >= 3) {
    hint += `\nYou've failed ${attempt} times. If you can't make this work, tell the user what went wrong and what you tried. Don't keep failing silently.\n`;
  }

  return hint;
}

export async function generateDiagnostic(toolName: string, args: Record<string, any>, error: string): Promise<DiagnosticStrategy | null> {
  try {
    const resp = await replitOpenai.chat.completions.create({
      model: "gemini-2.5-flash",
      max_completion_tokens: 300,
      messages: [
        {
          role: "system",
          content: `You are a diagnostic engine for an AI tool system. A tool call failed. Analyze why and suggest a fix.

Respond in JSON:
{
  "diagnosis": "Why it failed (1 sentence)",
  "alternativeApproach": "What to try instead (1 sentence)",
  "adjustedArgs": { modified arguments object },
  "confidence": 0.0-1.0
}`,
        },
        {
          role: "user",
          content: `Tool: ${toolName}\nArguments: ${JSON.stringify(args)}\nError: ${error}`,
        },
      ],
    });

    const content = resp.choices[0]?.message?.content?.trim();
    if (!content) return null;
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function saveLessonLearned(
  toolName: string,
  error: string,
  solution: string,
  tenantId?: number,
  personaId?: number,
): Promise<void> {
  try {
    const lesson = `[Tool Lesson] "${toolName}" failed with "${error.slice(0, 100)}". Solution: ${solution.slice(0, 200)}`;
    await storage.createMemoryEntry({
      content: lesson,
      type: "lesson",
      personaId: personaId || null,
      tenantId: tenantId!,
      source: "adaptive-execution",
      importance: 7,
    } as any);
    console.log(`[adaptive] Lesson saved: ${lesson.slice(0, 120)}`);
  } catch (err: any) {
    console.warn(`[adaptive] Failed to save lesson: ${err.message}`);
  }
}

export async function getRelevantLessons(toolName: string, tenantId?: number): Promise<string[]> {
  try {
    const entries = await storage.getMemoryEntries(undefined, 50, 0, tenantId || 0);
    return entries.data
      .filter((e: any) =>
        e.type === "lesson" &&
        e.source === "adaptive-execution" &&
        e.content.includes(`"${toolName}"`)
      )
      .map((e: any) => e.content.replace("[Tool Lesson] ", ""))
      .slice(0, 5);
  } catch {
    return [];
  }
}

export function shouldEscalateToHuman(toolName: string, attempts: number, error: string): {
  escalate: boolean;
  reason?: string;
} {
  if (attempts >= 4) {
    return { escalate: true, reason: `Tool "${toolName}" failed ${attempts} times. Last error: ${error}` };
  }

  const criticalErrors = ["api key", "billing", "quota exceeded", "permission denied", "forbidden"];
  const lowerErr = error.toLowerCase();
  for (const ce of criticalErrors) {
    if (lowerErr.includes(ce)) {
      return { escalate: true, reason: `Tool "${toolName}" hit a critical error that likely needs human action: ${error}` };
    }
  }

  return { escalate: false };
}
