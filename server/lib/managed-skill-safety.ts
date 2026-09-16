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

export interface ManagedSkillSafetyScan {
  safe: boolean;
  findings: Array<{
    pattern: string;
    severity: "block" | "warn";
    match: string;
  }>;
  patterns: string[];
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

export function scanManagedSkillPromptSafety(candidate: ManagedSkillPromptCandidate): ManagedSkillSafetyScan {
  const combined = [
    `Name: ${String(candidate.name ?? "")}`,
    `Description: ${String(candidate.description ?? "")}`,
    `Instructions:\n${String(candidate.promptContent ?? "")}`,
  ].join("\n");

  const injectionScan = scanContextContent(combined, "managed-skill");
  const capabilityScan = scanSkillContentSafety(combined);
  const findings = [
    ...injectionScan.findings.map(finding => ({
      pattern: finding.pattern,
      severity: "block" as const,
      match: finding.match,
    })),
    ...capabilityScan.findings.map(finding => ({
      pattern: finding.pattern,
      severity: finding.severity,
      match: finding.match,
    })),
  ];
  const patterns = [...new Set(findings.map(finding => finding.pattern))];
  return {
    safe: !findings.some(finding => finding.severity === "block"),
    findings,
    patterns,
  };
}

export function assertManagedSkillPromptSafe(candidate: ManagedSkillPromptCandidate): void {
  const result = scanManagedSkillPromptSafety(candidate);
  if (!result.safe) {
    throw new ManagedSkillSecurityError(result.patterns);
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