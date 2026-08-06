// Extracted from shared/schema.ts (Task 102 girth split, 2026-07-31) — the
// self-repair / repo-surgeon model cluster: self_heal_attempts,
// repair_incidents (Task #51), repo_surgeon_attempts (Task #52), and
// pipeline_stage_artifacts (Task #53 resume/reconstitution). Self-contained
// (no cross-table references); schema.ts re-exports via `export *`.
import { pgTable, serial, text, timestamp, integer, boolean, jsonb, real, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const selfHealAttempts = pgTable("self_heal_attempts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  runId: integer("run_id"),
  triggerSource: text("trigger_source").notNull(),
  originalGoal: text("original_goal").notNull(),
  failureContext: jsonb("failure_context").notNull().default(sql`'{}'::jsonb`),
  diagnosis: text("diagnosis"),
  fixType: text("fix_type"),
  fixPayload: jsonb("fix_payload").notNull().default(sql`'{}'::jsonb`),
  fixSnippet: text("fix_snippet"),
  reversible: boolean("reversible").default(true).notNull(),
  outcome: text("outcome").notNull().default("diagnosing"),
  outcomeDetail: jsonb("outcome_detail").notNull().default(sql`'{}'::jsonb`),
  promotedToPlatform: boolean("promoted_to_platform").default(false).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
});

// Repo Surgeon — unified incident record + judgment classifier (Task #51).
// One row per meaningful failure from any of the three self-repair sources
// (runtime self-heal, CI self-heal, Felix deliverable pipeline). The classifier
// labels each incident and records the routing decision so misclassifications
// are observable for tuning over time.
// HARD INVARIANT: a safety-guard-firing-correctly OR a test/guard/safety-profile
// touching incident is NEVER routed to an automated code fix — it surfaces or
// escalates. `safetyBlockedAutofix=true` records when the invariant fired.
export const repairIncidents = pgTable("repair_incidents", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  // "runtime_self_heal" | "ci_self_heal" | "felix_deliverable"
  source: text("source").notNull(),
  // Short stable signature for dedup/tuning (CI rule id, error class, etc).
  signature: text("signature").notNull().default(""),
  title: text("title").notNull().default(""),
  // Structured failure context: failing command/stage, full error/logs, recent
  // code changes, candidate files, tool name/args, etc.
  detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
  // "transient_infra" | "deliverable_quality" | "safety_guard" | "code_defect" (never "unknown")
  classification: text("classification").notNull(),
  classificationConfidence: real("classification_confidence").notNull().default(0),
  classificationReason: text("classification_reason").notNull().default(""),
  // "rule" | "heuristic" | "jury" | "fallback"
  classifiedBy: text("classified_by").notNull().default("heuristic"),
  // "retry" | "felix_revise" | "repo_surgeon" | "surface" | "escalate_owner"
  routedTo: text("routed_to").notNull().default("surface"),
  // True when the safety invariant forced the incident away from auto-fix.
  safetyBlockedAutofix: boolean("safety_blocked_autofix").notNull().default(false),
  juryVerdict: text("jury_verdict"),
  juryDetail: jsonb("jury_detail").notNull().default(sql`'{}'::jsonb`),
  escalated: boolean("escalated").notNull().default(false),
  // ── Task #54: closed-loop remedy dispatch + verification outcome ──────────
  // `routed_to` is the DECISION; `action_taken` is what the loop actually DID.
  // "repo_surgeon" (the one ACTIVE remedy) | "escalate_owner" | "none" (the
  // retry / felix_revise / surface routings are owned by the caller's own
  // existing loop and recorded as a no-op dispatch here). Null until dispatched.
  actionTaken: text("action_taken"),
  // Outcome of the dispatched remedy. For repo_surgeon: the RepoSurgeonOutcome
  // ("landed" | "rolled_back" | "blocked_guard_invariant" | "awaiting_hitl" |
  //  "stopped_attempt_limit" | "diagnosis_failed" | "no_fix_proposed" | ...).
  // Else "recorded" | "escalated" | "autofix_disabled" | "dispatch_error".
  actionOutcome: text("action_outcome"),
  // Verification report, touched files, attempts, escalation/guard reasons — the
  // auditable proof of WHAT was changed and HOW it was verified.
  actionDetail: jsonb("action_detail").notNull().default(sql`'{}'::jsonb`),
  // True once a fix verified all-green and was left in the tree (loop closed).
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
  dispatchedAt: timestamp("dispatched_at"),
  // Human ground-truth label for tuning the classifier (nullable until reviewed).
  humanLabel: text("human_label"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  classifiedAt: timestamp("classified_at"),
}, (t) => ({
  tenantCreatedIdx: index("idx_repair_incidents_tenant_created").on(t.tenantId, t.createdAt),
  classificationIdx: index("idx_repair_incidents_classification").on(t.classification, t.createdAt),
  sourceIdx: index("idx_repair_incidents_source").on(t.source, t.createdAt),
}));
export type RepairIncident = typeof repairIncidents.$inferSelect;
export const insertRepairIncidentSchema = createInsertSchema(repairIncidents).omit({ id: true, createdAt: true });
export type InsertRepairIncident = z.infer<typeof insertRepairIncidentSchema>;


// Repo Surgeon Task #52 — one row per AUTOMATED FIX ATTEMPT on a code-defect
// incident. The executor enforces its hard "two failed attempts then stop +
// escalate" invariant by counting the failed/rolled-back rows for an incident
// here, so the cap survives across separate executor invocations (not just the
// in-process loop). Kept distinct from `repair_incidents` so the classifier
// (#51) and the executor (#52) never conflate their concerns.
export const repoSurgeonAttempts = pgTable("repo_surgeon_attempts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  // FK-by-convention to repair_incidents.id (no DB FK — house pattern). May be
  // null for a directly-invoked fix that has no persisted incident row yet.
  incidentId: integer("incident_id"),
  // 1-based attempt number within this incident's fix lifecycle.
  attemptNumber: integer("attempt_number").notNull().default(1),
  diagnosis: text("diagnosis").notNull().default(""),
  rootCause: text("root_cause").notNull().default(""),
  // Files the proposed diff would touch (used for the guard/sensitive checks).
  touchedFiles: text("touched_files").array().notNull().default(sql`'{}'::text[]`),
  // "landed" | "rolled_back" | "blocked_guard_invariant" | "awaiting_hitl"
  //   | "diagnosis_failed" | "no_fix_proposed" | "stopped_attempt_limit"
  outcome: text("outcome").notNull().default("rolled_back"),
  // Verification report, escalation reason, guard-block reasons, etc.
  outcomeDetail: jsonb("outcome_detail").notNull().default(sql`'{}'::jsonb`),
  // True when this attempt routed to owner sign-off (sensitive surface) or
  // escalated (guard invariant / attempt-limit / verification failure).
  escalated: boolean("escalated").notNull().default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => ({
  tenantIncidentIdx: index("idx_repo_surgeon_attempts_tenant_incident").on(t.tenantId, t.incidentId),
  outcomeIdx: index("idx_repo_surgeon_attempts_outcome").on(t.outcome, t.createdAt),
}));
export type RepoSurgeonAttempt = typeof repoSurgeonAttempts.$inferSelect;
export const insertRepoSurgeonAttemptSchema = createInsertSchema(repoSurgeonAttempts).omit({ id: true, createdAt: true });
export type InsertRepoSurgeonAttempt = z.infer<typeof insertRepoSurgeonAttemptSchema>;

// Resume & reconstitution (Task #53) — one durable checkpoint row per
// (job, stage, unit) of a long multi-stage pipeline (discovery → transcription
// → planning → per-scene image bake → render → stitch → deliver). When a job
// fails partway and is retried, the pipeline loads this manifest, REUSES every
// completed stage/unit's persisted artifact, REPAIRS only the first
// incomplete/failed unit, and continues forward — instead of throwing away good
// work and re-running the whole script. Upsert-keyed by
// (tenant_id, job_key, stage, unit_key) so resume is idempotent (latest-wins).
// unit_key='' is the stage-level checkpoint; a non-empty unit_key (e.g.
// "scene-7") makes a stage per-unit repairable (re-bake one failed scene, reuse
// the other seventeen).
export const pipelineStageArtifacts = pgTable("pipeline_stage_artifacts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  // Stable, deterministic across retries of the SAME logical job (e.g.
  // "bwb-weekly-2026-06-01") so a re-run lands on the same manifest.
  jobKey: text("job_key").notNull(),
  stage: text("stage").notNull(),
  unitKey: text("unit_key").notNull().default(""),
  // "completed" | "failed"
  status: text("status").notNull().default("completed"),
  // Reusable payload for this stage/unit (file path, ids, counts, metadata).
  // MUST be JSON-serializable — never the raw bytes of a media artifact.
  artifact: jsonb("artifact").notNull().default(sql`'{}'::jsonb`),
  // When the artifact is a file on disk, store its path so resume can VERIFY it
  // still exists before reusing — a deleted file ⇒ redo, never reuse a ghost.
  artifactPath: text("artifact_path"),
  error: text("error"),
  // Incremented on every upsert so we can see how many times a unit was retried.
  attempts: integer("attempts").notNull().default(1),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  // Upsert target — matches the ON CONFLICT column list exactly (R125+17 lesson:
  // an ON CONFLICT with no matching unique constraint silently fails to merge).
  jobUnitUniq: uniqueIndex("idx_pipeline_stage_artifacts_job_unit").on(t.tenantId, t.jobKey, t.stage, t.unitKey),
  jobIdx: index("idx_pipeline_stage_artifacts_job").on(t.tenantId, t.jobKey),
}));
export type PipelineStageArtifact = typeof pipelineStageArtifacts.$inferSelect;
export const insertPipelineStageArtifactSchema = createInsertSchema(pipelineStageArtifacts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPipelineStageArtifact = z.infer<typeof insertPipelineStageArtifactSchema>;
