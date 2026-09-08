/**
 * Structured failure contract.
 *
 * Forge re-review (Project #44) flagged that on a terminal failure the user gets
 * an operator-centric narrative error rather than a consistent, product-grade
 * answer to the only four questions that matter at the last mile:
 *   1. What completed?
 *   2. What failed (and why)?
 *   3. What artifact exists RIGHT NOW?
 *   4. What exact next step is required (and from whom)?
 *
 * This module is the single, deterministic renderer for that block. It is a pure
 * function — no LLM, no IO — so it can be wired into ANY terminal-failure path
 * (approval rejection, circuit-break, budget halt, expiry) and produce the same
 * shape every time. It NEVER bypasses a safety gate: it only changes how a failure
 * that already happened is reported, never whether it is allowed to happen. The
 * structured `meta` is stored alongside the human-readable `text` so a UI can
 * render it richly later.
 */

export type FailureReason =
  | "approval_rejected"
  | "approval_expired"
  | "consecutive_failure_cap"
  | "budget_halt"
  | "tool_error"
  | "timeout"
  | "unknown";

export interface FailureArtifact {
  /** Human label, e.g. "Draft script (3 of 5 scenes)". */
  label: string;
  /** Optional durable link to the artifact if one exists. */
  url?: string;
}

export interface FailureContractInput {
  /** Machine-readable reason this run terminated. */
  reason: FailureReason;
  /** Short headline, e.g. 'Strategic review could not be completed'. */
  headline?: string;
  /** Things that genuinely finished before the failure. */
  completed?: string[];
  /** What failed and the honest why. `why` should be human-readable, not a stack trace. */
  failed: { what: string; why: string };
  /** Artifacts that exist on disk / in Drive / in the project RIGHT NOW. */
  artifacts?: FailureArtifact[];
  /** The single exact next step required to move forward. */
  nextStep: string;
  /** Who must take the next step. Defaults to inferring from reason. */
  nextStepOwner?: "user" | "agent" | "owner";
}

export interface FailureContract {
  /** Markdown block ready to show the user. */
  text: string;
  /** Structured payload for storage / future rich UI. */
  meta: {
    kind: "failure_contract";
    reason: FailureReason;
    headline: string;
    completed: string[];
    failed: { what: string; why: string };
    artifacts: FailureArtifact[];
    nextStep: string;
    nextStepOwner: "user" | "agent" | "owner";
  };
}

const DEFAULT_HEADLINE: Record<FailureReason, string> = {
  approval_rejected: "Stopped — a required approval was declined",
  approval_expired: "Stopped — a required approval expired before a decision",
  consecutive_failure_cap: "Stopped — a step failed repeatedly and needs a fresh approach",
  budget_halt: "Stopped — this run hit its safety budget ceiling",
  tool_error: "Stopped — a tool step failed",
  timeout: "Stopped — a step ran out of time",
  unknown: "Stopped — the run could not be completed",
};

const DEFAULT_OWNER: Record<FailureReason, "user" | "agent" | "owner"> = {
  approval_rejected: "user",
  approval_expired: "user",
  consecutive_failure_cap: "agent",
  budget_halt: "owner",
  tool_error: "agent",
  timeout: "agent",
  unknown: "agent",
};

// Neutralize the markdown metacharacters that enable INLINE injection in a
// bare-text position: links/images (`[` `]` `!`), emphasis/strike (`*` `_` `~`),
// code spans (`` ` ``), tables (`|`), and the escape char itself (`\`). Block
// constructs (headings/lists/quotes) need the metachar at column 0; every
// untrusted field here is embedded mid-line (after `- ` or inside `**…**`), so
// position already defuses those. We deliberately do NOT escape prose
// punctuation (`.` `,` `-` `(` `)`) — over-escaping shows literal backslashes in
// non-strict renderers, and escaping `[`/`]` alone already defeats link syntax.
function mdEscape(s: string): string {
  return s.replace(/([\\`*_\[\]~|!])/g, "\\$1");
}

function clampLine(s: string, max = 500, mdSafe = true): string {
  // Collapse whitespace AND neutralize raw HTML angle brackets. Some inputs
  // (approval `note`/`question`, tool error messages) are caller/user-supplied
  // and flow into a markdown block that a UI may render. Escaping `<`/`>` closes
  // the raw-HTML/<script> vector; mdEscape (default on) closes inline markdown
  // injection. URLs pass mdSafe=false so we don't mangle them. Defense-in-depth
  // — does not assume the renderer is the only sanitizer.
  let oneLine = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  if (mdSafe) oneLine = mdEscape(oneLine);
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Render a consistent terminal-failure block. Pure + deterministic.
 */
export function renderFailureContract(input: FailureContractInput): FailureContract {
  const reason = input.reason ?? "unknown";
  const headline = clampLine(input.headline || DEFAULT_HEADLINE[reason] || DEFAULT_HEADLINE.unknown, 200);
  const completed = (input.completed ?? []).map((c) => clampLine(c, 300)).filter(Boolean);
  const failed = {
    what: clampLine(input.failed?.what || "the run", 300),
    why: clampLine(input.failed?.why || "no reason was recorded", 500),
  };
  const artifacts = (input.artifacts ?? [])
    .filter((a) => a && a.label)
    .map((a) => ({ label: clampLine(a.label, 200), ...(a.url ? { url: clampLine(a.url, 1000, false) } : {}) }));
  const nextStep = clampLine(input.nextStep || "Review the failure above and decide how to proceed.", 500);
  const nextStepOwner = input.nextStepOwner || DEFAULT_OWNER[reason] || "agent";

  const ownerLabel =
    nextStepOwner === "user" ? "You" : nextStepOwner === "owner" ? "Owner" : "I";

  const lines: string[] = [];
  lines.push(`**${headline}**`);
  lines.push("");

  lines.push("**✅ What completed**");
  if (completed.length) {
    for (const c of completed) lines.push(`- ${c}`);
  } else {
    lines.push("- Nothing was completed before this stopped.");
  }
  lines.push("");

  lines.push("**❌ What failed**");
  lines.push(`- ${failed.what} — ${failed.why}`);
  lines.push("");

  lines.push("**📎 What exists right now**");
  if (artifacts.length) {
    for (const a of artifacts) {
      lines.push(a.url ? `- ${a.label}: ${a.url}` : `- ${a.label}`);
    }
  } else {
    lines.push("- No saved artifact was produced for this request.");
  }
  lines.push("");

  lines.push("**👉 Next step**");
  lines.push(`- ${ownerLabel}: ${nextStep}`);

  return {
    text: lines.join("\n"),
    meta: {
      kind: "failure_contract",
      reason,
      headline,
      completed,
      failed,
      artifacts,
      nextStep,
      nextStepOwner,
    },
  };
}
