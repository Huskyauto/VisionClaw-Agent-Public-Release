import { createHash } from "node:crypto";

export type CheckStatus = "passed" | "failed" | "unverified";
export interface ConfirmationCheck { id: string; label: string; status: CheckStatus; evidence: string }
export interface RunConfirmation {
  version: 1;
  status: "confirmed" | "failed" | "unverified";
  scope: string;
  subjectDigest: string;
  receiptDigest: string;
  checks: ConfirmationCheck[];
  limitations: string[];
}
export const confirmationDigest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** A scoped evidence summary, NOT an authorization token or authenticity proof. */
export function createRunConfirmation(input: {
  scope: string;
  subjectDigest: string;
  currentDigest?: string;
  requirements: { id: string; label: string }[];
  observations: { id: string; status: CheckStatus; evidence: string }[];
}): RunConfirmation {
  if (input.requirements.length > 128 || input.observations.length > 256) throw new Error("Confirmation input exceeds bounds");
  const ids = input.requirements.map(r => r.id);
  const invalid = !ids.length || new Set(ids).size !== ids.length ||
    ids.some(id => !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(id)) ||
    input.observations.some(o => !ids.includes(o.id)) ||
    new Set(input.observations.map(o => o.id)).size !== input.observations.length;
  const checks: ConfirmationCheck[] = input.requirements.map(r => {
    const rows = input.observations.filter(o => o.id === r.id);
    const o = rows[0];
    const usable = rows.length === 1 && typeof o?.evidence === "string" && o.evidence.trim().length > 0 &&
      ["passed", "failed", "unverified"].includes(o.status);
    return {
      id: r.id, label: r.label.slice(0, 240),
      status: usable ? o.status : "unverified",
      evidence: usable ? o.evidence.slice(0, 2000) : "Missing, duplicate or malformed check evidence.",
    };
  });
  const sourceStable = /^[a-f0-9]{64}$/.test(input.subjectDigest) && input.currentDigest === input.subjectDigest;
  checks.push({
    id: "_source", label: "Evidence is bound to the checked source",
    status: sourceStable ? "passed" : "unverified",
    evidence: sourceStable ? "Before and after SHA-256 identities match." : "Source identity is missing or changed; rerun checks.",
  });
  if (invalid) checks.push({
    id: "_coverage", label: "Acceptance check coverage", status: "unverified",
    evidence: "Empty, duplicate, unexpected or invalid check identities.",
  });
  const status = checks.some(c => c.status === "failed") ? "failed"
    : checks.every(c => c.status === "passed") ? "confirmed" : "unverified";
  const body = {
    version: 1 as const, status: status as RunConfirmation["status"],
    scope: input.scope.slice(0, 500), subjectDigest: input.subjectDigest.slice(0, 64), checks,
    limitations: [
      "Confirmed means only the named acceptance checks passed on the recorded source.",
      "Not whole-project certification, proof of external delivery, or permission to publish.",
      "A digest binds the recorded bytes; it is not a signature or proof that an author is trustworthy.",
    ],
  };
  return { ...body, receiptDigest: confirmationDigest(body) };
}

export function confirmationMarkdown(report: RunConfirmation): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
  return [
    "# Run confirmation", "", `Status: **${report.status.toUpperCase()}**`, "",
    report.scope, "", "| Acceptance check | Result | Evidence |", "|---|---|---|",
    ...report.checks.map(c => `| ${cell(c.label)} | ${c.status} | ${cell(c.evidence)} |`),
    "", `Source SHA-256: ${report.subjectDigest}`, `Receipt SHA-256: ${report.receiptDigest}`,
    "", "## Limits", ...report.limitations.map(l => `- ${l}`), "",
  ].join("\n");
}
