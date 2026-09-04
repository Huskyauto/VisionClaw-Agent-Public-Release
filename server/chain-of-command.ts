import type { Persona } from "@shared/schema";

/**
 * Chain-of-command governance for inter-persona delegation.
 *
 * Extracted from heartbeat.ts so the rules can be unit-tested in isolation
 * without booting heartbeat's module-level timers/side effects. heartbeat.ts
 * and delegateTaskFromChat() both import from here — this is the single source
 * of truth for who may delegate to whom.
 */
export const CHAIN_OF_COMMAND: Record<string, string[]> = {
  "Chief of Staff": ["Scribe", "Proof", "Forge", "Radar", "Neptune", "Apollo", "Atlas"],
  "Radar": ["Neptune"],
  "Scribe": ["Proof"],
};

export const CEO_PERSONAS = ["Felix", "VisionClaw"];

export function validateChainOfCommand(
  fromPersona: Persona | null,
  targetName: string,
  allPersonas: Persona[],
  source: "chat" | "heartbeat" = "heartbeat"
): { allowed: boolean; reason?: string } {
  if (!fromPersona) return { allowed: true };

  const fromName = fromPersona.name;

  if (source === "chat") {
    if (fromName === "Felix" || fromPersona.id === 2) {
      return { allowed: true };
    }
  }

  if (CEO_PERSONAS.some(n => n.toLowerCase() === fromName.toLowerCase())) {
    return { allowed: true };
  }

  // The "no direct-to-CEO" rule governs AUTONOMOUS (heartbeat) delegation, where
  // an unsupervised agent must not escalate straight to the CEO and bypass the
  // Chief-of-Staff triage layer. In CHAT the human operator is directing the
  // work and outranks every persona, so a chat-initiated hand-off to a CEO
  // persona (e.g. asking a worker to run a Felix-owned deliverable like the
  // weekly recap) is legitimate and must NOT hard-fail. Destructive-tool,
  // tenant-isolation, and intent gates still apply independently.
  if (source !== "chat" && CEO_PERSONAS.some(n => n.toLowerCase() === targetName.toLowerCase())) {
    if (fromName !== "Chief of Staff") {
      return { allowed: false, reason: `Agents cannot go direct to CEO. ${fromName} must route through Chief of Staff.` };
    }
  }

  if (targetName.toLowerCase() === "neptune" && fromName !== "Radar" && fromName !== "Chief of Staff" && fromName !== "Felix") {
    return { allowed: false, reason: `Neptune only activates on Radar escalation, Chief of Staff, or Felix request. ${fromName} cannot delegate directly to Neptune.` };
  }

  const allowedTargets = CHAIN_OF_COMMAND[fromName];
  if (allowedTargets && !allowedTargets.includes(targetName)) {
    return { allowed: false, reason: `${fromName} can only delegate to: ${allowedTargets.join(", ")}. Cannot delegate to ${targetName}.` };
  }

  return { allowed: true };
}
