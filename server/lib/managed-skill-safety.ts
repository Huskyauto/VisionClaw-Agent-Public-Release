import { scanSkillContentSafety } from "./skill-code-safety";
import { scanContextContent } from "../prompt-injection-scanner";

export interface ManagedSkillPromptCandidate {
  name: string;
  description: string;
  promptContent: string;
}

export interface ManagedSkillRecordCandidate {
  name: string;
  description: string;
  promptContent?: string | null;
  enabled?: boolean;
}

export class ManagedSkillSecurityError extends Error {
  readonly patterns: string[];

  constructor(patterns: string[]) {
    super(`Managed skill content rejected by security scan (${patterns.join(", ") || "unsafe-content"})`);
    this.name = "ManagedSkillSecurityError";
    this.patterns = patterns;
  }
}

export function isManagedSkillSecurityError(error: unknown): error is ManagedSkillSecurityError {
  return error instanceof ManagedSkillSecurityError;
}

export function assertManagedSkillPromptSafe(candidate: ManagedSkillPromptCandidate): void {
  const combined = [
    `Name: ${String(candidate.name ?? "")}`,
    `Description: ${String(candidate.description ?? "")}`,
    `Instructions:\n${String(candidate.promptContent ?? "")}`,
  ].join("\n");

  const injectionScan = scanContextContent(combined, "managed-skill");
  const capabilityScan = scanSkillContentSafety(combined);
  const patterns = [
    ...injectionScan.findings.map(finding => finding.pattern),
    ...capabilityScan.findings
      .filter(finding => finding.severity === "block")
      .map(finding => finding.pattern),
  ];

  if (patterns.length > 0) {
    throw new ManagedSkillSecurityError([...new Set(patterns)]);
  }
}

export function assertManagedSkillRecordSafe(candidate: ManagedSkillRecordCandidate): void {
  if (candidate.enabled === false || candidate.promptContent == null) return;
  assertManagedSkillPromptSafe({
    name: candidate.name,
    description: candidate.description,
    promptContent: candidate.promptContent,
  });
}