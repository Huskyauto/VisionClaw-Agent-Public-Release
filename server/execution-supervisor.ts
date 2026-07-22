import fs from "fs";
import path from "path";
import { verifyDeliverable } from "./deliverable-verifier";

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

// R76 — Map natural-language deliverable claims to contract type for verification.
const DELIVERABLE_CLAIM_PATTERNS: Array<{ type: string; patterns: RegExp[] }> = [
  { type: "html_page", patterns: [/\bhtml\s+(?:page|landing|file|document|mockup)\b/i, /\blanding\s+page\b/i] },
  { type: "pdf_document", patterns: [/\bpdf\s+(?:document|report|file|generated|created)\b/i, /\bgenerated\s+(?:a|the)?\s*pdf\b/i] },
  { type: "slide_deck", patterns: [/\b(?:slide\s*deck|presentation|pptx)\b/i] },
  { type: "video", patterns: [/\bvideo\s+(?:created|produced|generated|ready)\b/i] },
  { type: "audio", patterns: [/\baudio\s+(?:file|generated|produced)\b/i, /\bvoice(?:over)?\s+generated\b/i] },
  { type: "image", patterns: [/\bimage\s+(?:generated|created)\b/i] },
  { type: "csv_data", patterns: [/\bcsv\s+(?:file|export|generated)\b/i] },
  { type: "json_data", patterns: [/\bjson\s+(?:file|document|exported)\b/i] },
];

function detectDeliverableClaims(responseText: string): string[] {
  const claimed = new Set<string>();
  for (const { type, patterns } of DELIVERABLE_CLAIM_PATTERNS) {
    if (patterns.some((p) => p.test(responseText))) claimed.add(type);
  }
  return [...claimed];
}

function findFileFromTools(executedTools: { name: string; output: any }[]): { path?: string; url?: string } | null {
  for (let i = executedTools.length - 1; i >= 0; i--) {
    const out = executedTools[i].output;
    if (!out || typeof out !== "object") continue;
    const path = (out as any).path || (out as any).filePath || (out as any).file_path || (out as any).localPath;
    const url = (out as any).viewUrl || (out as any).fileUrl || (out as any).downloadUrl || (out as any).url;
    if (path || url) return { path, url };
  }
  return null;
}

export async function validateAgentResponse(
  responseText: string,
  executedTools: { name: string; output: any }[],
  contextMessages?: { role: string; content: any }[],
  opts?: { tenantId?: number; personaId?: number; conversationId?: number; verifyContracts?: boolean },
): Promise<{ issues: string[]; injectedWarning?: string; contractFailures?: Array<{ type: string; failures: string[] }> }> {
  const issues: string[] = [];
  const contractFailures: Array<{ type: string; failures: string[] }> = [];

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

  // R77.5 (KisMATH §5.4 — discourse connectives are load-bearing for hard problems).
  // The paper showed that masking causal connective tokens ("therefore", "because", "so", "if … then")
  // collapses chain-of-thought accuracy on harder MATH/GSM splits. We don't get to mask attention,
  // but we CAN refuse to accept a multi-step reasoning answer that has none of those connectives —
  // that pattern empirically tracks "I pattern-matched, I didn't actually reason."
  // Only fires on responses that LOOK like multi-step reasoning (>= 4 numbered/bulleted steps and
  // >= 600 chars), so simple "yes/no" or short tool-result reports are unaffected.
  try {
    const stepLineRe = /^\s*(?:\d+[.)]\s|[-*•]\s|step\s*\d+[:.]\s)/gim;
    const stepMatches = responseText.match(stepLineRe) || [];
    const looksLikeReasoning = stepMatches.length >= 4 && responseText.length >= 600;
    if (looksLikeReasoning) {
      const discourseRe = /\b(therefore|because|since|however|hence|thus|implies?|suppose|assume|consequently|whence|consider|note that|so that|so we|so it|we have|it follows|by (?:induction|assumption|definition|hypothesis|the formula|substitution)|let\s+\w+\s*=|if\s+\w[\w\s]*\s+then)\b/gi;
      const markerCount = (responseText.match(discourseRe) || []).length;
      const requiredMarkers = Math.max(1, Math.ceil(stepMatches.length / 4));
      if (markerCount < requiredMarkers) {
        issues.push(`REASONING_GLUE_MISSING: response has ${stepMatches.length} reasoning steps but only ${markerCount} discourse connective(s) — KisMATH §5.4 shows this pattern correlates with pattern-matched (non-causal) reasoning. Add at least ${requiredMarkers - markerCount} more "therefore/because/since/thus/if…then" connectives so each conclusion is justified by its premise.`);
      }
    }
  } catch (e) {
    console.warn(`[supervisor] discourse-marker check error: ${(e as Error).message}`);
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

  if (opts?.verifyContracts && opts.tenantId) {
    const claimed = detectDeliverableClaims(responseText);
    const file = findFileFromTools(executedTools);
    if (claimed.length && file) {
      // R76 review fix (HIGH #5) — was fire-and-forget, so deliverable failures
      // never made it back to the supervisor and the persona could keep
      // claiming success. Now we await the full verification (with a 10s
      // safety timeout per claim) and surface failures into `issues` so
      // chat-engine triggers the correction loop.
      for (const type of claimed) {
        try {
          const verifyP = verifyDeliverable({
            tenantId: opts.tenantId,
            personaId: opts.personaId,
            conversationId: opts.conversationId,
            deliverableType: type,
            filePath: file.path,
            fileUrl: file.url,
          });
          // Architect re-review: set passed=false on timeout so the
          // blockingSkip branch below treats timed-out verifications as
          // unverified rather than letting the persona claim success.
          const timeoutP = new Promise<{ status: "skipped"; passed: boolean; failures: string[]; contractId: null; verificationId: null }>((resolve) =>
            setTimeout(() => resolve({ status: "skipped", passed: false, failures: ["verification timed out after 10s"], contractId: null, verificationId: null }), 10_000),
          );
          const result = (await Promise.race([verifyP, timeoutP])) as Awaited<ReturnType<typeof verifyDeliverable>>;
          // R76 review fix (HIGH re-review #2) — also block on `skipped` when
          // the verifier marked passed=false. That happens when a URL-only
          // deliverable could not be content-verified (no fetch allowlist),
          // which means we cannot honestly back the persona's success claim.
          // Benign skips (unknown deliverable_type → passed=true) are still
          // allowed through.
          const blockingSkip = result.status === "skipped" && (result as any).passed === false;
          if (result.status === "failed" || blockingSkip) {
            const label = blockingSkip ? "DELIVERABLE_VERIFICATION_UNVERIFIED" : "DELIVERABLE_VERIFICATION_FAILED";
            const failureText = (result.failures || []).join("; ") || "verification failed";
            issues.push(`${label}: ${type}: ${failureText}`);
            contractFailures.push({ type, failures: result.failures || [failureText] });
          }
        } catch (e) {
          console.warn(`[supervisor] contract verification error for ${type}: ${(e as Error).message}`);
        }
      }
    }
  }

  if (issues.length > 0) {
    return {
      issues,
      contractFailures: contractFailures.length ? contractFailures : undefined,
      injectedWarning: `HALLUCINATION DETECTED: ${issues.join(". ")}. Do NOT present fabricated results to the user. Only report what tools actually returned.`,
    };
  }

  return { issues: [], contractFailures: contractFailures.length ? contractFailures : undefined };
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
