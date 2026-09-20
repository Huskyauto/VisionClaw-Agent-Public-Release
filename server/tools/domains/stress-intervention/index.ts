import type { ToolDefinition } from "../../types";

export async function stress_intervention(
  context?: string,
): Promise<{
  intervention: string;
  somatic_action: string;
  grounding_task: string;
  instructions: string;
  rationale: string;
}> {
  const contextPhrase = context ? `For when ${context}:` : "For when stress has you frozen:";
  const interventionScript = `${contextPhrase} "This is a hard stop. Let's turn away from the light for a moment. Right now, go find a pen and write three words — any three words — on your palm. Just to remind your hands they can do something else first."`;
  return {
    intervention: interventionScript,
    somatic_action: "Turn around — physically rotate your body away from the source of stress/craving.",
    grounding_task: "Find a pen and write three arbitrary words on your palm (occupies hands and mind).",
    instructions: "1. Read the script aloud or internally. 2. Execute the somatic action immediately. 3. Perform the grounding task without deliberation. 4. Resume original task with redirected focus.",
    rationale: "First-person, present-tense command creates immediate somatic disruption and psychological exit from trigger environment. The symbolic 'turn away' breaks inertia; the small grounding task redirects energy and completes the circuit-breaker sequence.",
  };
}

export const stressInterventionDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "stress_intervention",
    description: "Wellness: provides a directive, somatic-based intervention script for breaking inertia during stress-induced frozen states. Use when a user reports being 'stuck', 'frozen', 'staring at the fridge', 'can't move', or when an agent loop appears stalled. Returns a script + somatic action + grounding task. Pairs with Robert persona (16) and detect_fatigue.",
    parameters: {
      type: "object",
      properties: {
        context: { type: "string", description: "Optional: short description of the frozen state (e.g. 'staring into fridge', 'can't start the email', 'tool execution loop')." },
      },
      required: [],
    },
  },
};