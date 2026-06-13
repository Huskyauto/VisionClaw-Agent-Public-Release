/**
 * repo-surgeon-llm.ts — Repo Surgeon Task #52
 *
 * The diagnosis + minimal-diff PROPOSER. Given a code-defect incident, it reads
 * the implicated source, asks a frontier model to find the root cause AND an
 * existing house pattern to mirror, and returns a structured `FixProposal` (the
 * minimal find/replace diff + its rationale). Split out from repo-surgeon.ts so
 * the executor's guard/verify/land loop stays pure-testable (the executor takes
 * `propose` as an injectable dependency; this is the default wiring).
 *
 * Tiered escalation mirrors runtime self-heal: attempt 1 uses a strong-but-fast
 * model, attempt 2 brings in the smartest brain with the prior failure fed back
 * (replit.md 2-failed-corrections: fresh, sharper context — not a blind re-roll).
 *
 * SECURITY: the model output is UNTRUSTED. It is consumed ONLY as structured
 * find/replace edits the executor applies + verifies; it is never eval'd, never
 * turned into a shell string, and every guard/sensitive check runs on the
 * resulting diff before anything lands.
 */

import { runLlmTask } from "../llm-task";
import { ADMIN_TENANT_ID } from "../tenant-constants";
import { logSilentCatch } from "../lib/silent-catch";
import * as fs from "node:fs";
import { isSafeRepoPath } from "./repo-surgeon";
import type { FixProposal, RepoSurgeonIncident } from "./repo-surgeon";

const FIX_PROPOSAL_SCHEMA = {
  type: "object",
  required: ["diagnosis", "rootCause", "precedent", "edits", "cannotFix"],
  properties: {
    diagnosis: { type: "string", description: "Root-cause analysis: WHY the failure happened, in the real source." },
    rootCause: { type: "string", description: "The single file + location that is the root cause." },
    precedent: {
      type: "string",
      description: "An existing pattern/precedent in this codebase the fix mirrors (file + how). Do NOT invent a one-off.",
    },
    cannotFix: {
      type: "boolean",
      description: "TRUE if you cannot produce a safe minimal fix (insufficient context, the only fix would weaken a guard/test/safety surface, or it needs human judgment). When true, leave edits empty.",
    },
    confidence: { type: "number", description: "0..1 confidence the diff is correct and minimal." },
    edits: {
      type: "array",
      description: "The minimal diff as exact find/replace edits. `find` MUST be copied verbatim from the file and occur exactly once.",
      items: {
        type: "object",
        required: ["path", "find", "replace"],
        properties: {
          path: { type: "string", description: "Repo-relative file path." },
          find: { type: "string", description: "Exact existing text to replace (unique in the file)." },
          replace: { type: "string", description: "Replacement text." },
        },
      },
    },
    newFiles: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "content"],
        properties: { path: { type: "string" }, content: { type: "string" } },
      },
    },
    targetedTests: {
      type: "array",
      description: "Existing test files (tests/**/<area>.test.ts) that exercise the fixed area.",
      items: { type: "string" },
    },
  },
};

const MAX_FILE_BYTES = 24000;

function readImplicatedSources(files: string[]): string {
  const chunks: string[] = [];
  for (const f of files.slice(0, 6)) {
    try {
      // SECURITY: candidateFiles/recentChanges originate from untrusted incident
      // input (stack traces, git output). Confine every read to the repo root —
      // an absolute or ../-escaping path must NOT be slurped into the LLM prompt
      // (arbitrary file read / secret exfiltration). Mirrors the executor's guard.
      if (!isSafeRepoPath(f)) continue;
      if (!fs.existsSync(f)) continue;
      const body = fs.readFileSync(f, "utf8").slice(0, MAX_FILE_BYTES);
      chunks.push(`\n──── FILE: ${f} ────\n${body}`);
    } catch (e) {
      logSilentCatch("server/agentic/repo-surgeon-llm.ts", e);
    }
  }
  return chunks.join("\n");
}

function buildPrompt(incident: RepoSurgeonIncident, sources: string, priorFailure: string | null): string {
  return `You are the Repo Surgeon — a senior engineer fixing a genuine code defect in the VisionClaw codebase. Produce the SMALLEST correct fix that mirrors an EXISTING house pattern. Do not invent a one-off, do not refactor beyond the defect.

ABSOLUTE RULES (your proposal is rejected and escalated if you break them):
- NEVER weaken, disable, skip, or delete a guard, test, or safety profile to make a check pass. No \`.skip\`, no \`@ts-nocheck\`, no \`eslint-disable\`, no deleting assertions, no dropping a tenant_id filter.
- If the ONLY way to "fix" this is to touch a test/guard/safety surface, or you lack the context to fix it safely, set cannotFix=true and explain in diagnosis.
- Each edit's \`find\` must be copied VERBATIM from the file shown below and must be unique in that file.

INCIDENT
- Stage: ${incident.stage || "(unknown)"}
- Error: ${(incident.error || "(none)").slice(0, 2000)}
- Stack: ${(incident.errorStack || "(none)").slice(0, 1500)}
- Implicated files: ${(incident.candidateFiles || []).join(", ") || "(none)"}
- Recently changed (72h): ${(incident.recentChanges || []).slice(0, 30).join(", ") || "(none)"}
${priorFailure ? `\nPRIOR ATTEMPT FAILED — learn from this, change your approach:\n${priorFailure.slice(0, 2500)}\n` : ""}
SOURCE (truncated):
${sources || "(no source could be read — set cannotFix=true unless the error text alone is enough)"}

Output ONLY a JSON object matching the FixProposal schema. Be concrete: real paths, real verbatim \`find\` text, real \`replace\` text. No placeholders.`;
}

/**
 * Default proposer wired into the executor. Returns a structured FixProposal, or
 * null when the model produced nothing usable (the executor treats that as
 * "no fix proposed" → escalate).
 */
export async function proposeFix(
  incident: RepoSurgeonIncident,
  priorFailure: string | null,
  attempt: number,
): Promise<FixProposal | null> {
  const files = [...new Set([...(incident.candidateFiles || []), ...(incident.recentChanges || [])])];
  const sources = readImplicatedSources(files);

  // Tiered escalation: attempt 1 → fast strong model; attempt 2 → smartest brain.
  const tier2 = attempt >= 2;
  const model = tier2 ? "gemini-3.5-flash" : "gpt-5.5";

  const res = await runLlmTask({
    prompt: buildPrompt(incident, sources, priorFailure),
    schema: FIX_PROPOSAL_SCHEMA,
    model,
    temperature: 0.1,
    thinking: "high",
    timeoutMs: tier2 ? 240000 : 90000,
    maxTokens: tier2 ? 16384 : 8192,
    // Platform-level self-repair — bill to admin (R64.C precedent).
    tenantId: ADMIN_TENANT_ID,
  });

  if (!res.success || !res.json) return null;
  const j = res.json as any;
  return {
    diagnosis: String(j.diagnosis || ""),
    rootCause: String(j.rootCause || ""),
    precedent: String(j.precedent || ""),
    edits: Array.isArray(j.edits) ? j.edits : [],
    newFiles: Array.isArray(j.newFiles) ? j.newFiles : undefined,
    targetedTests: Array.isArray(j.targetedTests) ? j.targetedTests : undefined,
    cannotFix: j.cannotFix === true,
    confidence: typeof j.confidence === "number" ? j.confidence : undefined,
  };
}
