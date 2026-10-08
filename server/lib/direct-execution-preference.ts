// Suggestions Off is an execution preference, not permission to bypass tool
// approvals or to invent missing facts. Keep this directive server-owned.
export function renderDirectExecutionPreference(enabled: boolean): string {
  if (!enabled) return "";
  return `DIRECT EXECUTION PREFERENCE (the user turned Suggestions Off):
Act on the user's original request now. If the objective and target are clear, choose a sensible approach and use the available authorized tools; do not ask whether to ask questions, whether to start, or which process the user prefers. Do not replace work with a promise to work later. Ask one specific question only when an essential missing detail would change the result or make execution impossible. Required approval, consent, safety and tool-policy gates still apply. Never claim to have run checks or completed actions you have not performed.`;
}

export function shouldUseDirectExecutionPreference(
  preferred: boolean,
  intakeInstruction: string | null,
): boolean {
  // An explicit "yes, let's do the questionnaire" takes precedence over the
  // composer default for that turn. An unrequested first-turn offer does not.
  return preferred && !intakeInstruction?.startsWith("## INTAKE INTERVIEW — IN PROGRESS");
}

export function isOptionalStartQuestion(userRequest: string, candidate: string, toolsUsed: number): boolean {
  if (toolsUsed > 0 || !candidate.includes("?") || candidate.length > 900) return false;
  if (/^\s*(?:what is|what does|how does|explain|define)\b/i.test(userRequest)) return false;
  if (!/\b(?:run|review|check|audit|inspect|investigate|analy[sz]e|create|build|fix|write|draft|prepare|make|research|find|generate|implement|take a look|(?:give|provide|deliver|send)(?: me)? (?:a |the )?(?:full |complete |comprehensive )?(?:report|analysis|summary))\b/i.test(userRequest)) return false;
  if (/\b(?:approval|approve|confirm|authorization|authorize|consent|permission|payment|charge|missing access|need access)\b/i.test(candidate)) return false;
  const offersOptionalInterview = /\b(?:ask|walk through|answer|go through)\b.{0,85}\bquestions?\b|\b(?:questions? first|jump right in)\b/i.test(candidate);
  const consequentialRequest = /\b(?:delet(?:e|ion)|remove|wipe|drop|reset|send|publish|deploy|charge|pay|refund|transfer|purchase|buy|cancel)\b/i.test(userRequest);
  // "Should I run it now?" may be an approval for the consequential part of
  // a mixed task. Only the explicit offer of *optional intake* is retried.
  if (consequentialRequest && !offersOptionalInterview) return false;
  if (consequentialRequest && /\b(?:delet(?:e|ion)|remove|wipe|drop|reset|send|publish|deploy|charge|pay|refund|transfer|purchase|buy|cancel)\b/i.test(candidate)) return false;
  return /\b(?:would you (?:like|prefer)|do you want me to|should i)\b[\s\S]{0,180}\b(?:ask|questions?|jump right in|get started|start|begin|proceed|dive in|run)\b/i.test(candidate);
}