/**
 * Tools-layer-split S13 — workspace-domain tool definitions.
 *
 * Selection: the 6 durable per-task workspace-artifact tools (R98.27.7,
 * Anthropic long-running-agent pattern) — `workspace_init`,
 * `workspace_update_status`, `workspace_log_artifact`, `workspace_read`,
 * `workspace_finalize`, `workspace_list`. They share the single external
 * dependency `./lib/task-workspace` and no module-scope helpers, making them
 * the smallest safe cohesive batch. Adjacent workspace-adjacent tools stay
 * legacy per smallest-safe-batch: `google_workspace` / `calendar_sync` are
 * network-touching Google integrations (S9 pattern — network arms stay legacy),
 * and `project` is a separate scattered arm (deferred at S11).
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes — inventory diff must stay byte-clean).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const workspaceInitDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "workspace_init",
    description: "R98.27.7 — Open a durable per-task workspace on disk for a multi-step or long-running job (Anthropic long-running-agent pattern). Creates `data/task-workspaces/<tenant>/<job_id>/{task_plan,current_status,next_steps,open_questions}.md` plus a `tool_results/` artifact directory. Use at the START of any job that (a) will span multiple tool calls and may be resumed in a later session, (b) Felix is delivering a multi-asset deliverable across chunks, or (c) you want to leave a paper trail for the next loop to pick up. Re-calling on an existing job_id refreshes task_plan.md only — status / next_steps / open_questions are preserved. Returns {jobId, dir, created}.",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Stable identifier for the job (lowercase, [a-z0-9._-], ≤80 chars). Reuse the same id across resumes. E.g. 'bwb-wellness-program-225-day12' or 'invoice-acme-q1-revise'." },
        goal: { type: "string", description: "Plain-language goal in one paragraph. What the customer asked for / what 'done' looks like." },
        plan: { type: "array", items: { type: "string" }, description: "Optional ordered list of plan steps. Will appear under '## Plan' in task_plan.md." },
        context: { type: "string", description: "Optional starting context, constraints, or links the next loop will need." },
      },
      required: ["job_id", "goal"],
    },
  },
};

export const workspaceUpdateStatusDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "workspace_update_status",
    description: "R98.27.7 — Append a status line and/or rewrite next_steps / open_questions for an open workspace. Use after EVERY meaningful tool call so the next loop (or resumed session) sees ground truth instead of guessing. status='blocked' or 'needs_review' is a soft signal to a human; doesn't refuse anything. Returns {jobId, updated:[files]}.",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Same id passed to workspace_init." },
        status: { type: "string", enum: ["in_progress", "blocked", "needs_review", "complete", "failed"], description: "Current job status. Status changes are appended (history preserved); not destructive." },
        progress_note: { type: "string", description: "One-line note for the status log. E.g. 'Scene 3 rendered, scene 4 voiceover queued'." },
        next_steps: { type: "array", items: { type: "string" }, description: "Replace next_steps.md with this ordered list. Omit to leave next_steps unchanged." },
        open_questions: { type: "array", items: { type: "string" }, description: "Replace open_questions.md with this list (empty array clears it). Omit to leave unchanged." },
      },
      required: ["job_id"],
    },
  },
};

export const workspaceLogArtifactDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "workspace_log_artifact",
    description: "R98.27.7 — Drop a small text artifact (tool result, diagnostic log, intermediate plan, transcript) into the workspace's tool_results/ folder. NOT for binary deliverables — those still go through deliverDigitalProduct / deliver_product. This is for the breadcrumb trail. Hard caps: 256 KiB per artifact (truncated with marker), 200 files per workspace (then errors — call workspace_finalize and start fresh).",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Same id passed to workspace_init." },
        name: { type: "string", description: "Short artifact name (becomes part of the filename). E.g. 'scene-3-script' or 'browserless-error-trace'." },
        content: { type: "string", description: "Artifact body (text/markdown/json-stringified). Truncated at 256 KiB." },
      },
      required: ["job_id", "name", "content"],
    },
  },
};

export const workspaceReadDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "workspace_read",
    description: "R98.27.7 — Read back everything currently persisted for a workspace: task_plan, current_status, next_steps, open_questions, and the list of tool_results/ artifacts (paths + sizes, not contents). CALL THIS at the start of any session that may be resuming a prior job — checks if a workspace exists for the id BEFORE re-planning from scratch. Returns {exists, jobId, task_plan?, current_status?, next_steps?, open_questions?, artifacts:[{path,bytes}]}.",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job id to look up." },
      },
      required: ["job_id"],
    },
  },
};

export const workspaceFinalizeDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "workspace_finalize",
    description: "R98.27.7 — Close out a workspace with a final summary + optional handoff note for any successor session. Writes final_summary.md and stamps current_status.md with FINALIZED. Doesn't delete the directory — the breadcrumb survives for replay/audit. Use when the job is complete, abandoned, or being explicitly handed off.",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job id to finalize." },
        outcome: { type: "string", enum: ["complete", "failed", "abandoned"], description: "How the job ended." },
        summary: { type: "string", description: "Plain-language summary of what was actually accomplished, what was delivered, what wasn't." },
        next_session_handoff: { type: "string", description: "Optional. If a follow-up session will pick this up, leave a note here." },
      },
      required: ["job_id", "outcome", "summary"],
    },
  },
};

export const workspaceListDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "workspace_list",
    description: "R98.27.7 — List workspaces for the current tenant so a persona can DISCOVER resumable jobs without remembering job_ids. Returns the most-recently-modified workspaces first with {jobId, finalized, last_modified, artifact_count, status_tail}. By default skips finalized workspaces (set include_finalized=true to also see closed jobs for audit/replay). CALL THIS when the user says 'continue where we left off', 'pick up that X job', or any time you suspect a prior session left an open workspace.",
    parameters: {
      type: "object",
      properties: {
        include_finalized: { type: "boolean", description: "If true, also return workspaces that have been finalized. Default false (only open / in-flight)." },
        limit: { type: "number", description: "Max rows to return. Default 50, capped 500." },
      },
      required: [],
    },
  },
};

/** All workspace-domain definitions, for the facade's TOOL_DEFINITIONS splice. */
export const workspaceDomainDefinitions: ToolDefinition[] = [
  workspaceInitDefinition,
  workspaceUpdateStatusDefinition,
  workspaceLogArtifactDefinition,
  workspaceReadDefinition,
  workspaceFinalizeDefinition,
  workspaceListDefinition,
];
