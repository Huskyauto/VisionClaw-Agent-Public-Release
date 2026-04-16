import fs from "fs";
import path from "path";

export interface SupervisorState {
  toolFailures: Map<string, { count: number; errors: string[]; firstAt: number }>;
  toolSuccesses: Map<string, number>;
  blockedTools: Set<string>;
  roundsUsed: number;
  maxRounds: number;
  warnings: string[];
  hallucinations: string[];
}

export function createSupervisor(maxRounds: number): SupervisorState {
  return {
    toolFailures: new Map(),
    toolSuccesses: new Map(),
    blockedTools: new Set(),
    roundsUsed: 0,
    maxRounds,
    warnings: [],
    hallucinations: [],
  };
}

const CIRCUIT_BREAKER_THRESHOLD = 3;

export function recordToolResult(
  supervisor: SupervisorState,
  toolName: string,
  args: Record<string, any>,
  result: any,
): { blocked: boolean; injectedMessage?: string } {
  const hasError = result && typeof result === "object" && result.error;
  const errorKey = `${toolName}:${JSON.stringify(args).slice(0, 80)}`;
  const toolKey = toolName;

  if (hasError) {
    const existing = supervisor.toolFailures.get(errorKey) || { count: 0, errors: [], firstAt: Date.now() };
    existing.count++;
    existing.errors.push(String(result.error).slice(0, 200));
    supervisor.toolFailures.set(errorKey, existing);

    const toolWideFailures = Array.from(supervisor.toolFailures.entries())
      .filter(([k]) => k.startsWith(toolName + ":"))
      .reduce((sum, [, v]) => sum + v.count, 0);

    if (existing.count >= CIRCUIT_BREAKER_THRESHOLD) {
      supervisor.blockedTools.add(errorKey);
      const lastErrors = existing.errors.slice(-2).join("; ");
      return {
        blocked: true,
        injectedMessage: `CIRCUIT BREAKER: Tool "${toolName}" has failed ${existing.count} times with the SAME arguments and error. DO NOT call it again with these arguments.\n\nLast errors: ${lastErrors}\n\nYou MUST either:\n1. Try a COMPLETELY DIFFERENT tool or approach\n2. Tell the user honestly what went wrong and what you tried\n\nDo NOT retry the same thing. Do NOT claim success without a real tool result.`,
      };
    }

    if (toolWideFailures >= 3) {
      return {
        blocked: false,
        injectedMessage: `WARNING: Tool "${toolName}" has failed ${toolWideFailures} times total this conversation. Consider abandoning this approach and trying something completely different. If you cannot complete the task, tell the user what is blocking you.`,
      };
    }
  } else {
    supervisor.toolSuccesses.set(toolKey, (supervisor.toolSuccesses.get(toolKey) || 0) + 1);
  }

  return { blocked: false };
}

export function checkExecutionBudget(
  supervisor: SupervisorState,
  currentRound: number,
  totalToolCalls: number,
): string | null {
  supervisor.roundsUsed = currentRound;
  const maxRounds = supervisor.maxRounds;
  const remaining = maxRounds - currentRound;

  if (remaining === 2) {
    return `EXECUTION BUDGET WARNING: You have only ${remaining} tool rounds remaining. PRIORITIZE completing the task NOW. If you cannot finish, tell the user what you accomplished and what remains. Do NOT waste rounds on failed retries.`;
  }

  if (remaining === 1) {
    return `FINAL ROUND: This is your LAST tool round. Use it wisely — either complete the task or tell the user the current status. Do NOT attempt risky operations.`;
  }

  if (totalToolCalls >= 8 && remaining <= 3) {
    return `HIGH TOOL USAGE: You've made ${totalToolCalls} tool calls with only ${remaining} rounds left. Focus on delivering results to the user.`;
  }

  return null;
}

export function validateToolOutput(
  toolName: string,
  result: any,
): { valid: boolean; issues: string[]; correctedResult?: any } {
  const issues: string[] = [];

  if (!result || typeof result !== "object") {
    return { valid: true, issues: [] };
  }

  if (result.drive_url && typeof result.drive_url === "string") {
    if (!result.drive_url.startsWith("https://drive.google.com/")) {
      issues.push(`Invalid Drive URL: "${result.drive_url}" is not a real Google Drive link`);
    }
    if (result.drive_url.includes("1abc123") || result.drive_url.includes("example") || result.drive_url.includes("placeholder")) {
      issues.push(`Fabricated Drive URL detected: "${result.drive_url}" appears to be a placeholder`);
    }
  }

  if (result.file_path && typeof result.file_path === "string") {
    const resolvedPath = path.isAbsolute(result.file_path) ? result.file_path : path.resolve(process.cwd(), result.file_path);
    if (!fs.existsSync(resolvedPath)) {
      issues.push(`File claimed to exist but not found: "${result.file_path}"`);
    }
  }

  if (result.viewUrl && typeof result.viewUrl === "string") {
    if (!result.viewUrl.startsWith("https://")) {
      issues.push(`Invalid viewUrl: "${result.viewUrl}" is not a valid HTTPS URL`);
    }
  }

  if (result.success === true && result.error) {
    issues.push(`Contradictory result: success=true but error="${result.error}"`);
  }

  if (issues.length > 0) {
    return {
      valid: false,
      issues,
      correctedResult: {
        ...result,
        _validation_issues: issues,
        _supervisor_note: "WARNING: This result has validation issues. The claimed outputs may not be real. Verify before presenting to user.",
      },
    };
  }

  return { valid: true, issues: [] };
}

export function validateAgentResponse(
  responseText: string,
  executedTools: { name: string; output: any }[],
  contextMessages?: { role: string; content: any }[],
): { issues: string[]; injectedWarning?: string } {
  const issues: string[] = [];

  const contextText = contextMessages
    ? contextMessages.map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content || "")).join(" ")
    : "";

  const driveUrlPattern = /https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/g;
  const claimedUrls = [...responseText.matchAll(driveUrlPattern)];

  for (const match of claimedUrls) {
    const fileId = match[1];
    const toolHasUrl = executedTools.some(t => {
      const output = JSON.stringify(t.output || {});
      return output.includes(fileId);
    });

    const inContext = contextText.includes(fileId);

    if (!toolHasUrl && !inContext && !fileId.includes("example") && fileId.length > 10) {
      issues.push(`Agent claimed Drive URL with fileId "${fileId}" but no tool returned this ID`);
    }
  }

  const successClaims = [
    /video.*(?:created|produced|generated|ready|complete)/i,
    /uploaded.*(?:to|on).*drive/i,
    /email.*sent/i,
    /file.*(?:saved|created|generated)/i,
  ];

  for (const pattern of successClaims) {
    if (pattern.test(responseText)) {
      const relevantTool = executedTools.find(t => {
        const output = t.output;
        return output && typeof output === "object" && output.success === true;
      });
      if (!relevantTool && executedTools.length > 0) {
        const lastTool = executedTools[executedTools.length - 1];
        if (lastTool.output?.error) {
          issues.push(`Agent claims success ("${responseText.match(pattern)?.[0]}") but last tool "${lastTool.name}" returned error: "${lastTool.output.error}"`);
        }
      }
    }
  }

  if (issues.length > 0) {
    return {
      issues,
      injectedWarning: `HALLUCINATION DETECTED: ${issues.join(". ")}. Do NOT present fabricated results to the user. Only report what tools actually returned.`,
    };
  }

  return { issues: [] };
}

export function getFailbackSuggestion(
  toolName: string,
  error: string,
): string | null {
  const lowerErr = error.toLowerCase();

  const FALLBACK_MAP: Record<string, { condition: (err: string) => boolean; suggestion: string }[]> = {
    "create_slideshow_video": [
      {
        condition: (err) => err.includes("pdf conversion") || err.includes("no slides") || err.includes("corrupt"),
        suggestion: "The PDF is corrupt or empty. Use produce_video instead — it can auto-generate slides from the script text without needing a PDF. Call: produce_video({ script: '...', title: '...' })",
      },
      {
        condition: (err) => err.includes("ffmpeg") || err.includes("not available"),
        suggestion: "FFmpeg is not available. Report this to the user — video assembly requires FFmpeg to be installed on the server.",
      },
    ],
    "generate_audio": [
      {
        condition: (err) => err.includes("elevenlabs") || err.includes("voice") || err.includes("401"),
        suggestion: "ElevenLabs failed. Try with OpenAI TTS instead: generate_audio({ text: '...', provider: 'openai' })",
      },
    ],
    "delegate_task": [
      {
        condition: (err) => err.includes("not found"),
        suggestion: "The target agent was not found. Check the agent name spelling. Valid agents: Felix, Forge, Teagan, Blueprint, Chief of Staff, Scribe, Proof, Radar, Neptune, Apollo, Atlas, Cassandra, Luna.",
      },
      {
        condition: (err) => err.includes("chain-of-command") || err.includes("chain of command"),
        suggestion: "Chain-of-command violation. Only VisionClaw/Felix can delegate to most agents. Do the work yourself instead.",
      },
      {
        condition: (err) => err.includes("initialization") || err.includes("cannot access"),
        suggestion: "Delegation hit a transient initialization error. Do NOT retry delegation — instead, execute this task yourself using your tools: system_status, recall_context, search_memory, project, check_api_keys, list_models, etc.",
      },
      {
        condition: () => true,
        suggestion: "Delegation failed. Do the work yourself directly using your available tools (system_status, recall_context, search_memory, project, check_api_keys, list_models, etc.) instead of trying to delegate again.",
      },
    ],
    "send_email": [
      {
        condition: (err) => err.includes("smtp") || err.includes("transport") || err.includes("not configured"),
        suggestion: "Email is not configured. Give the user the result directly in chat instead of trying to email it.",
      },
    ],
    "web_fetch": [
      {
        condition: (err) => err.includes("timeout") || err.includes("blocked"),
        suggestion: "Direct web fetch failed. Try using the browser tool with stealth mode, or try a different URL.",
      },
    ],
  };

  const fallbacks = FALLBACK_MAP[toolName];
  if (!fallbacks) return null;

  for (const fb of fallbacks) {
    if (fb.condition(lowerErr)) {
      return fb.suggestion;
    }
  }

  return null;
}

export function generateSupervisorSummary(supervisor: SupervisorState): string {
  const totalFailures = Array.from(supervisor.toolFailures.values()).reduce((sum, v) => sum + v.count, 0);
  const totalSuccesses = Array.from(supervisor.toolSuccesses.values()).reduce((sum, v) => sum + v, 0);
  const blockedCount = supervisor.blockedTools.size;

  let summary = `[Supervisor] Rounds: ${supervisor.roundsUsed}/${supervisor.maxRounds}, Tools: ${totalSuccesses} succeeded, ${totalFailures} failed, ${blockedCount} blocked`;

  if (supervisor.hallucinations.length > 0) {
    summary += `, ${supervisor.hallucinations.length} hallucination(s) caught`;
  }

  return summary;
}
