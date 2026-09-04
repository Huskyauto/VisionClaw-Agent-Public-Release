const MAX_QUESTIONS = 8;

const INTAKE_OFFER_INSTRUCTION = `## INTAKE INTERVIEW PROTOCOL
This is the FIRST message in a new conversation. Before diving into execution, you must offer the user a structured intake interview to clarify their request.

YOUR FIRST RESPONSE must:
1. Briefly acknowledge what the user wants to do (1-2 sentences max)
2. Ask: "Would you like me to walk through a few quick questions first to make sure I understand exactly what you need? Or would you prefer I jump right in?"

If the user says YES to the questionnaire (any affirmative like "yes", "sure", "go ahead", "let's do the questions", etc.):
- Begin asking clarifying questions ONE AT A TIME
- Each question should build on the user's previous answers
- Focus on: objective, target audience, constraints, timeline, success metrics, preferred approach, budget/resources, risk tolerance
- Ask no more than 8 questions total
- After each answer, acknowledge it briefly and ask the next question
- When you have enough info (or after all questions), present a structured PROJECT BRIEF summarizing everything, then ask for approval before starting work

If the user says NO (any negative like "no", "just start", "jump in", "skip it", etc.):
- Proceed immediately with the request as given — no questionnaire
- Treat the original message as the full brief and start working

IMPORTANT: Do NOT ask all questions at once. Ask ONE question, wait for the answer, then ask the next.`;

const INTAKE_INTERVIEWING_INSTRUCTION = `## INTAKE INTERVIEW — IN PROGRESS
You are in the middle of a structured intake interview. The user has opted in to the questionnaire.

Rules:
- You have asked {{questionsAsked}} question(s) so far out of a maximum of 8
- Review the conversation history to see what has already been answered
- Ask the NEXT logical clarifying question ONE AT A TIME
- Build on what the user has told you so far
- Good question topics: objective clarity, target audience, constraints, timeline, success criteria, preferred approach, budget/resources, risk tolerance, competitive context, technical requirements
- Keep each question concise and specific
- Briefly acknowledge the user's last answer before asking the next question
- If you have enough information to build a complete brief (even before 8 questions), you may present the PROJECT BRIEF early
- When presenting the brief, format it clearly with sections and ask: "Does this look right? Should I adjust anything before I start?"

After the user approves the brief, proceed with execution.`;

const DECLINED_PATTERN = /^(no|nah|nope|skip|just start|jump in|go ahead and start|don'?t need|straight to|dive in|get started|start work|no thanks|no need)/i;
const ACCEPTED_PATTERN = /^(yes|yeah|sure|ok|okay|yep|yup|go ahead|let'?s do|sounds good|please|absolutely|why not|do it|go for it|let'?s go)/i;

export function getIntakeInstruction(allMessages: any[], currentUserContent: string): string | null {
  const priorMessages = allMessages;
  const priorUserMessages = priorMessages.filter(m => m.role === "user");
  const priorAssistantMessages = priorMessages.filter(m => m.role === "assistant");

  if (priorUserMessages.length === 0 && priorAssistantMessages.length === 0) {
    return INTAKE_OFFER_INSTRUCTION;
  }

  if (priorUserMessages.length === 1 && priorAssistantMessages.length === 1) {
    const firstAssistant = priorAssistantMessages[0]?.content?.toLowerCase() || "";
    const hasIntakeOffer = firstAssistant.includes("walk through") ||
      firstAssistant.includes("few quick questions") ||
      firstAssistant.includes("jump right in") ||
      firstAssistant.includes("questionnaire");
    if (!hasIntakeOffer) return null;

    const reply = currentUserContent.toLowerCase().trim();
    if (DECLINED_PATTERN.test(reply)) return null;
    if (ACCEPTED_PATTERN.test(reply)) {
      return INTAKE_INTERVIEWING_INSTRUCTION.replace("{{questionsAsked}}", "0");
    }
    return null;
  }

  if (priorUserMessages.length < 2 || priorAssistantMessages.length < 1) return null;

  const firstAssistant = priorAssistantMessages[0]?.content?.toLowerCase() || "";
  const hasIntakeOffer = firstAssistant.includes("walk through") ||
    firstAssistant.includes("few quick questions") ||
    firstAssistant.includes("jump right in") ||
    firstAssistant.includes("questionnaire");
  if (!hasIntakeOffer) return null;

  const secondUser = priorUserMessages[1]?.content?.toLowerCase().trim() || "";
  if (!ACCEPTED_PATTERN.test(secondUser)) return null;

  const lastAssistant = priorAssistantMessages[priorAssistantMessages.length - 1]?.content || "";
  const lastAssistantLower = lastAssistant.toLowerCase();
  if (lastAssistantLower.includes("project brief") ||
      lastAssistantLower.includes("does this look right") ||
      lastAssistantLower.includes("should i adjust") ||
      lastAssistantLower.includes("ready to start") ||
      lastAssistantLower.includes("here's the brief")) {
    return null;
  }

  const questionsAsked = Math.min(priorAssistantMessages.length - 1, MAX_QUESTIONS);
  if (questionsAsked >= MAX_QUESTIONS) return null;

  return INTAKE_INTERVIEWING_INSTRUCTION.replace("{{questionsAsked}}", String(questionsAsked));
}
