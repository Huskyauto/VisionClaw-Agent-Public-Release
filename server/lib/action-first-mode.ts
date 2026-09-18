export type CommunicationMode = "standard" | "action_first";

export function detectActionFirstModeCommand(input: string): CommunicationMode | null {
  const normalized = input.trim().toLowerCase().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
  const onPatterns = [
    /^(?:please )?(?:turn on|enable|activate) (?:the )?action[- ]first mode$/,
    /^(?:please )?(?:switch to|use) (?:the )?action[- ]first mode$/,
    /^(?:please )?turn (?:the )?action[- ]first mode on$/,
    /^action[- ]first mode on$/,
  ];
  const offPatterns = [
    /^(?:please )?(?:turn off|disable|deactivate) (?:the )?action[- ]first mode$/,
    /^(?:please )?turn (?:the )?action[- ]first mode off$/,
    /^(?:please )?switch to (?:the )?(?:standard|normal) mode$/,
    /^action[- ]first mode off$/,
    /^standard mode$/,
    /^normal mode$/,
  ];
  if (onPatterns.some((pattern) => pattern.test(normalized))) return "action_first";
  if (offPatterns.some((pattern) => pattern.test(normalized))) return "standard";
  return null;
}

export function renderActionFirstModeContext(mode: CommunicationMode): string {
  if (mode !== "action_first") return "";
  return `## ACTION-FIRST COMMUNICATION MODE (explicit user preference)
- Lead with the answer, completed result, or single next action. Do not bury it in context.
- Do the work yourself when tools can complete it; do not hand technical commands back to the user.
- Use the fewest numbered steps that remain complete. Keep each visible list to about five items by grouping related detail.
- Restate the current step and make completed work visible across multi-turn tasks.
- Suppress tangents. Ask only one blocking question when the missing answer would change the work.
- State errors as cause, impact, and fix without alarmist language.
- If the user asks for an explanation, provide the complete explanation with skimmable headings.
- Safety, informed consent, factual uncertainty, required evidence, and task completeness always override brevity.
- This is a formatting preference only. Never infer, diagnose, or mention a medical condition from it.`;
}

export function preserveExplicitCommunicationMode(
  existing: Record<string, unknown>,
  synthesized: Record<string, unknown>,
): Record<string, unknown> {
  const { communicationMode: _ignoredSynthesizedMode, ...merged } = synthesized;
  if (existing.communicationMode === "action_first" || existing.communicationMode === "standard") {
    merged.communicationMode = existing.communicationMode;
  }
  return merged;
}