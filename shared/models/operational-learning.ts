// Extracted from shared/schema.ts (girth-gate slice, mechanical move — no behavior change).
// Agent evaluation, operational learning, storefront wedge, and replay telemetry tables.
import { pgTable, serial, text, timestamp, integer, boolean, jsonb, bigint, real, varchar, index, numeric, unique, uniqueIndex, vector, primaryKey, doublePrecision, date, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// R114 — AEvo Meta-Editing of Procedure Context (Zhang et al., arXiv:2605.13821).
// A meta-editor proposes minimal surgical edits to playbook procedure surfaces
// based on accumulated evidence (lookup telemetry, delivery failures, near-miss
// grades). Edits are HITL-gated: proposed -> approved/rejected -> applied ->
// (optional) rolled_back. Edit surface allowlist is type-level and hardcoded
// ('output_skill' only at launch). Hard exclusions: safety_profile, intentGate,
// restrictedCategories, destructiveToolPolicy, refusalCopy, doctrine sections,
// persona souls. Every edit is CAS-pinned by sha256 to prevent races.
export const procedureEdits = pgTable("procedure_edits", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  beforeContent: text("before_content").notNull(),
  afterContent: text("after_content").notNull(),
  diffSummary: text("diff_summary"),
  evidenceSummary: jsonb("evidence_summary").notNull().default({}),
  evidenceWindowDays: integer("evidence_window_days").notNull().default(30),
  status: text("status").notNull().default("proposed"),
  proposedByRunId: text("proposed_by_run_id"),
  proposedAt: timestamp("proposed_at").notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  appliedAt: timestamp("applied_at"),
  rolledBackAt: timestamp("rolled_back_at"),
  contentSha256Before: text("content_sha256_before").notNull(),
  contentSha256After: text("content_sha256_after").notNull(),
}, (t) => ({
  tenantStatusIdx: index("idx_procedure_edits_tenant_status").on(t.tenantId, t.status, t.proposedAt),
  tenantTargetIdx: index("idx_procedure_edits_tenant_target").on(t.tenantId, t.targetKind, t.targetId),
}));
export type ProcedureEdit = typeof procedureEdits.$inferSelect;

// R118 — per-message user feedback. Thumbs up/down (+1/-1) with optional comment,
// optional topic_hint stamped server-side by joining the most-recent
// `lookup_output_skill` agent_trace_span on the same conversation within ±10 min.
// Becomes the 4th evidence dimension for the AEvo meta-editor (alongside
// lookups / delivery failures / near-miss grades). Tenant-scoped notNull no default
// per replit.md schema invariant. Unique on (tenantId, messageId, COALESCE(userId,0))
// so a user can change their mind (UPSERT) but cannot stack multiple votes.
export const messageFeedback = pgTable("message_feedback", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  conversationId: integer("conversation_id").notNull(),
  messageId: integer("message_id").notNull(),
  userId: integer("user_id"),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  topicHint: text("topic_hint"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantTopicIdx: index("idx_message_feedback_tenant_topic").on(t.tenantId, t.topicHint),
  tenantMsgIdx: index("idx_message_feedback_tenant_msg").on(t.tenantId, t.messageId),
  tenantRatingIdx: index("idx_message_feedback_tenant_rating_created").on(t.tenantId, t.rating, t.createdAt),
  // R118+sec — codify the UPSERT key + rating CHECK that were applied via
  // psql ALTER. Drizzle uniqueIndex().on() doesn't support COALESCE expressions
  // directly, so the authoritative DDL lives in scripts/migrations/R118-message-feedback.sql
  // (idempotent). This expression-form unique index is what
  // `ON CONFLICT (tenant_id, message_id, COALESCE(user_id, 0))` in
  // server/storage.ts:367 binds against — without it the route 500s.
  // Listed here as a no-op marker so future schema reviewers see the dependency:
  ratingCheck: sql`-- enforced by check_message_feedback_rating: rating IN (-1, 1)`,
  uniqueUpsertKey: sql`-- enforced by uq_message_feedback_tenant_msg_user: UNIQUE(tenant_id, message_id, COALESCE(user_id, 0))`,
}));
export const insertMessageFeedbackSchema = createInsertSchema(messageFeedback).omit({ id: true, createdAt: true });
export type InsertMessageFeedback = z.infer<typeof insertMessageFeedbackSchema>;
export type MessageFeedback = typeof messageFeedback.$inferSelect;

export const procedureEvolutionRuns = pgTable("procedure_evolution_runs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  evidenceWindowDays: integer("evidence_window_days").notNull().default(30),
  iterations: integer("iterations").notNull().default(1),
  summary: jsonb("summary").notNull().default({}),
  errorMessage: text("error_message"),
}, (t) => ({
  tenantIdx: index("idx_procedure_evo_runs_tenant").on(t.tenantId, t.startedAt),
}));
export type ProcedureEvolutionRun = typeof procedureEvolutionRuns.$inferSelect;

// R115 — External Review Council. Every R114 procedure edit can optionally be
// routed through three independent LLM lineages (OpenAI + Anthropic + Google)
// for a structured verdict in plain English Bob can read. The Council has NO
// write access to anything except this table. tenantId NOT NULL no default per
// project convention.
//
// DB-LEVEL CONSTRAINTS (applied via psql ALTER, per project migration policy —
// drizzle does not emit CHECK constraints):
//   - council_verdicts_verdict_chk:   verdict IN ('approve','reject','needs_revision','abstain','pending','error')
//   - council_verdicts_final_chk:     final_decision IS NULL OR final_decision IN ('approved','rejected','deferred')
//   - idx_council_verdicts_track_record (partial): btree (tenant_id, agreed_with_council, final_decided_at DESC)
//                                                  WHERE final_decision IS NOT NULL
//   verify with: psql $DATABASE_URL -c "\d council_verdicts"
export const councilVerdicts = pgTable("council_verdicts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  procedureEditId: integer("procedure_edit_id").notNull(),
  verdict: text("verdict").notNull(),                     // approve|reject|needs_revision|abstain|pending|error
  consensusCount: integer("consensus_count").notNull().default(0),
  reviewerCount: integer("reviewer_count").notNull().default(0),
  plainEnglishSummary: text("plain_english_summary").notNull(),
  perModelVotes: jsonb("per_model_votes").notNull().default([]),
  kappa: doublePrecision("kappa"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  finalDecision: text("final_decision"),                  // approved|rejected|deferred
  finalDecidedAt: timestamp("final_decided_at"),
  finalDecidedBy: text("final_decided_by"),
  agreedWithCouncil: boolean("agreed_with_council"),
}, (t) => ({
  tenantEditIdx: index("idx_council_verdicts_tenant_edit").on(t.tenantId, t.procedureEditId, t.requestedAt),
  tenantVerdictIdx: index("idx_council_verdicts_tenant_verdict").on(t.tenantId, t.verdict, t.completedAt),
}));
export type CouncilVerdictRow = typeof councilVerdicts.$inferSelect;

// R115.5 — Sprint Contract / pre-flight "done condition" pin.
// Per Osmani's "Agent Harness Engineering" nugget + Anthropic's long-running-
// harness post: separating generation from evaluation outperforms self-
// evaluation, and writing down the acceptance criteria BEFORE generation
// starts catches more scope drift than any prompt change. The contract is
// pinned at job kickoff, replayed verbatim into the evaluator, and locked by
// sha256 so the grader cannot silently grade against a different criterion
// than the one the generator was working against.
//
// tenantId NOT NULL no default per project convention. No FK on (refKind, refId)
// — the contract is descriptive of any external reference (a delivery_job id,
// a subagent chunk id, a project_task id) and we deliberately keep the join
// loose so callers don't have to pre-declare their refKind.
export const sprintContracts = pgTable("sprint_contracts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  refKind: text("ref_kind").notNull(),            // 'deliverable_job' | 'subagent_chunk' | 'project_task' | etc.
  refId: text("ref_id").notNull(),                // arbitrary stable string identifier
  doneCondition: text("done_condition").notNull(),// 1–5 line plain-English acceptance criteria
  criteria: jsonb("criteria").notNull().default({}), // optional structured criteria
  status: text("status").notNull().default("open"), // 'open' | 'passed' | 'failed' | 'cancelled'
  pinnedAt: timestamp("pinned_at").notNull().defaultNow(),
  pinnedBy: text("pinned_by"),                    // persona / user / 'system'
  evaluatedAt: timestamp("evaluated_at"),
  evaluation: jsonb("evaluation"),                // {verdict, scoredBy, notes, evidence}
  contentSha256: text("content_sha256").notNull(),// sha256 of doneCondition (tamper detection)
}, (t) => ({
  tenantRefIdx: index("idx_sprint_contracts_tenant_ref").on(t.tenantId, t.refKind, t.refId),
  tenantStatusIdx: index("idx_sprint_contracts_tenant_status").on(t.tenantId, t.status, t.pinnedAt),
  // R115.5 MED-1 (architect close): partial unique index — at most one OPEN
  // contract per (tenantId, refKind, refId). Enforced at DB level via psql:
  //   CREATE UNIQUE INDEX uq_sprint_contracts_open_per_ref
  //     ON sprint_contracts (tenant_id, ref_kind, ref_id)
  //     WHERE status = 'open';
  // Drizzle 0.x cannot emit partial indexes, so the constraint is psql-only.
  // The pin path catches the 23505 unique-violation race and re-runs once.
}));
export type SprintContract = typeof sprintContracts.$inferSelect;


// R125+13.4: Audit funnel lead-capture table. Stores ALL low-friction
// touches on /audit: sample-request email opt-ins, monitoring/enterprise
// waitlist signups, AND anonymous "buy click" intent (fired before Stripe
// redirect so we still attribute attention even when checkout isn't
// completed). Tenant_id=1 (platform-owner storefront) — per-tenant
// storefronts would set this from session.metadata.tenantId.
// kinds: 'sample-request' | 'monitoring-waitlist' | 'enterprise-inquiry'
//        | 'buy-click-self-serve' | 'buy-click-done-for-you'
//        | 'newsletter' | 'other'
export const auditLeads = pgTable("audit_leads", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  email: text("email"),
  kind: text("kind").notNull(),
  tierInterest: text("tier_interest"),
  icpHint: text("icp_hint"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmTerm: text("utm_term"),
  utmContent: text("utm_content"),
  referer: text("referer"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  notes: text("notes"),
  notifiedAt: timestamp("notified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantCreatedIdx: index("idx_audit_leads_tenant_created").on(t.tenantId, t.createdAt),
  kindIdx: index("idx_audit_leads_kind").on(t.kind, t.createdAt),
}));
export type AuditLead = typeof auditLeads.$inferSelect;

// R125+13.6 — Inbox ingest classifier audit trail.
// One row per inbox_messages.id classification (1:N possible if reclassified).
// kinds: 'bwb_video_idea' | 'vca_capability_gap' | 'competitor_intel'
//        | 'idea_log' | 'noise'
// routedTo: jsonb describing what was done (e.g. {file: "data/youtube/scripts/_idea-XXX.md"}
// or {table: "capability_gaps", id: 42} or {table: "competitor_changes", id: 7}).
export const inboxClassifications = pgTable("inbox_classifications", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  inboxMessageId: integer("inbox_message_id").notNull(),
  messageIdExternal: varchar("message_id_external", { length: 255 }).notNull(),
  kind: text("kind").notNull(),
  confidence: real("confidence").notNull().default(0),
  summary: text("summary").notNull().default(""),
  routedTo: jsonb("routed_to").notNull().default({}),
  classifierModel: text("classifier_model").notNull().default(""),
  classifiedAt: timestamp("classified_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantClassifiedIdx: index("idx_inbox_classifications_tenant_classified").on(t.tenantId, t.classifiedAt),
  kindIdx: index("idx_inbox_classifications_kind").on(t.kind, t.classifiedAt),
  // R125+13.6-fix (architect M2): UNIQUE so concurrent ingest runs cannot
  // double-classify the same message via the orphan-retry LEFT JOIN race.
  // The INSERT in server/lib/inbox-ingest.ts uses ON CONFLICT DO NOTHING.
  messageIdx: uniqueIndex("idx_inbox_classifications_message_uniq").on(t.inboxMessageId),
}));
export type InboxClassification = typeof inboxClassifications.$inferSelect;

// R125+13.11 — Archive Rescue wedge (project #238). Captures both demo
// requests (free 5-page OCR sample) AND paid orders (Starter $99 / Standard
// $299 / Pro $999+$49mo). Tenant_id=1 (platform-owner storefront); will
// generalize when we add per-tenant Archive Rescue resale.
// status: 'demo_requested' | 'demo_delivered' | 'paid' | 'in_progress'
//         | 'delivered' | 'cancelled'
// tier:   'demo' | 'starter' | 'standard' | 'pro'
// orgType:'museum' | 'law-firm' | 'historical-society' | 'other'
export const archiveRescueOrders = pgTable("archive_rescue_orders", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  orgName: text("org_name").notNull(),
  orgType: text("org_type").notNull().default("other"),
  contactEmail: text("contact_email").notNull(),
  contactName: text("contact_name"),
  tier: text("tier").notNull().default("demo"),
  status: text("status").notNull().default("demo_requested"),
  pagesQuota: integer("pages_quota").notNull().default(0),
  pagesUsed: integer("pages_used").notNull().default(0),
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntent: text("stripe_payment_intent"),
  demoOcrSummary: text("demo_ocr_summary"),
  demoImagePaths: text("demo_image_paths").array(),
  notes: text("notes"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  notifiedAt: timestamp("notified_at"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  tenantCreatedIdx: index("idx_archive_rescue_tenant_created").on(t.tenantId, t.createdAt),
  statusIdx: index("idx_archive_rescue_status").on(t.status, t.createdAt),
  emailIdx: index("idx_archive_rescue_email").on(t.contactEmail),
}));
export type ArchiveRescueOrder = typeof archiveRescueOrders.$inferSelect;

// "Instant AI Readiness Audit" wedge — autonomous self-serve fulfillment.
// A visitor submits their website URL; server/audit-engine.ts fetches the site
// (SSRF-jailed, redirects re-jailed per hop) and scores AI-readiness signals
// (llms.txt, AI-crawler robots rules, structured data, metadata, social tags,
// technical hygiene). One row per completed audit run. Tenant_id=1
// (platform-owner storefront). Email is nullable — captured opportunistically
// for the lead funnel (also mirrored into audit_leads with kind='audit-run').
export const auditReports = pgTable("audit_reports", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  websiteUrl: text("website_url").notNull(),
  finalUrl: text("final_url"),
  overallScore: integer("overall_score").notNull(),
  grade: text("grade").notNull(),
  checks: jsonb("checks").notNull().default([]),
  recommendations: jsonb("recommendations").notNull().default([]),
  email: text("email"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantCreatedIdx: index("idx_audit_reports_tenant_created").on(t.tenantId, t.createdAt),
  scoreIdx: index("idx_audit_reports_score").on(t.overallScore),
}));
export type AuditReport = typeof auditReports.$inferSelect;

// "Smart Lead Enrichment" wedge (IdeaBrowser #247) — autonomous self-serve
// fulfillment. A visitor submits a work email; server/enrichment-engine.ts
// derives the company domain, fetches the public site (SSRF-jailed, redirects
// re-jailed per hop) and an LLM synthesizes a B2B lead-intelligence card
// (company summary, industry, size, buying signals, ICP-fit score, talking
// points, decision-makers, hot/warm/cold routing). One row per completed run.
// Tenant_id=1 (platform-owner storefront). The email is the lead — also
// mirrored into audit_leads with kind='enrichment-run'.
export const smartEnrichmentReports = pgTable("smart_enrichment_reports", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  inputEmail: text("input_email"),
  companyDomain: text("company_domain").notNull(),
  finalUrl: text("final_url"),
  companyName: text("company_name"),
  industry: text("industry"),
  estimatedSize: text("estimated_size"),
  icpFitScore: integer("icp_fit_score").notNull().default(0),
  routing: text("routing").notNull().default("cold"),
  signals: jsonb("signals").notNull().default([]),
  talkingPoints: jsonb("talking_points").notNull().default([]),
  decisionMakers: jsonb("decision_makers").notNull().default([]),
  summary: text("summary"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantCreatedIdx: index("idx_smart_enrichment_tenant_created").on(t.tenantId, t.createdAt),
  routingIdx: index("idx_smart_enrichment_routing").on(t.routing, t.createdAt),
  scoreIdx: index("idx_smart_enrichment_score").on(t.icpFitScore),
}));
export type SmartEnrichmentReport = typeof smartEnrichmentReports.$inferSelect;

// LOOP plan-replay cache (Vir & Vir 2026). Stores successful orchestration
// plans keyed by (tenantId, requestClass) with embedding-based lookup so a
// near-identical objective skips the expensive planner LLM call and replays
// a known-good plan.
export const planReplayCache = pgTable("plan_replay_cache", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  requestClass: text("request_class").notNull(),
  objective: text("objective").notNull(),
  objectiveEmbedding: vector("objective_embedding", { dimensions: 1536 }),
  planJson: jsonb("plan_json").notNull(),
  stepCount: integer("step_count").notNull(),
  totalDurationMs: integer("total_duration_ms"),
  hitCount: integer("hit_count").notNull().default(0),
  lastHitAt: timestamp("last_hit_at").defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantClassIdx: index("idx_plan_replay_tenant_class").on(t.tenantId, t.requestClass),
  lastHitIdx: index("idx_plan_replay_last_hit").on(t.lastHitAt),
  // NOTE: HNSW index on objective_embedding is intentionally NOT declared in
  // schema. Replit's deploy migration generator strips the required
  // `vector_cosine_ops` opclass, causing publish to fail with "data type vector
  // has no default operator class for access method hnsw". Create the index
  // manually in BOTH dev and prod via Replit's DB pane once the table grows:
  //   CREATE INDEX idx_plan_replay_embedding ON plan_replay_cache
  //     USING hnsw (objective_embedding vector_cosine_ops);
  // Cosine `<=>` lookups in server/plan-replay.ts work without it (seq scan)
  // while the table is small.
}));
export type PlanReplayCache = typeof planReplayCache.$inferSelect;

// Episode playbooks (Kimi K3 #2) — step-level case-based reasoning below the
// orchestration-plan grain. Successful agent_runs trajectories are distilled
// into reusable playbooks ("this run_type reached this goal via these steps")
// and retrieved by embedding similarity as ADVISORY context before planning.
export const episodePlaybooks = pgTable("episode_playbooks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  runType: text("run_type").notNull(),
  goal: text("goal").notNull(),
  goalEmbedding: vector("goal_embedding", { dimensions: 1536 }),
  stepsJson: jsonb("steps_json").notNull(),
  stepCount: integer("step_count").notNull(),
  totalDurationMs: integer("total_duration_ms"),
  successCount: integer("success_count").notNull().default(1),
  hitCount: integer("hit_count").notNull().default(0),
  lastHitAt: timestamp("last_hit_at"),
  sourceRunId: integer("source_run_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantTypeIdx: index("idx_episode_playbooks_tenant_type").on(t.tenantId, t.runType),
  // HNSW index intentionally NOT declared (same deploy-migration opclass issue
  // as plan_replay_cache above) — create manually when the table grows.
}));
export type EpisodePlaybook = typeof episodePlaybooks.$inferSelect;

// Falsified routes (Argus, arXiv:2608.05144) — the failure-side mirror of
// episode_playbooks. When an orchestration plan FAILS (verifier/timeout/stuck
// dependencies), the objective + failed approach is retained so the planner is
// warned "a similar goal already FAILED via this route" before re-planning it.
// ADVISORY + fail-open, same posture as playbooks: never blocks planning.
// Rollback: DROP TABLE falsified_routes;
export const falsifiedRoutes = pgTable("falsified_routes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  objective: text("objective").notNull(),
  objectiveEmbedding: vector("objective_embedding", { dimensions: 1536 }),
  routeJson: jsonb("route_json").notNull(), // { steps: string[], reason: string }
  failCount: integer("fail_count").notNull().default(1),
  hitCount: integer("hit_count").notNull().default(0),
  lastHitAt: timestamp("last_hit_at"),
  sourcePlanId: text("source_plan_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("idx_falsified_routes_tenant").on(t.tenantId),
  // HNSW index intentionally NOT declared (same deploy-migration opclass issue
  // as episode_playbooks above) — create manually when the table grows.
}));

// Durable knowledge triples (admin-tenant PILOT, Bob 2026-08-10) — persists the
// autoresearch session-scoped evidence-graph triples (subject|predicate|object)
// across sessions so later research on related objectives starts with prior
// grounded facts. ADMIN TENANT ONLY by writer-side gate (pilot scope: no
// customer-tenant writes until the pilot proves relational retrieval value).
// ADVISORY + fail-open: never blocks a session; consumers re-sanitize at render.
// Rollback: DROP TABLE knowledge_triples;
export const knowledgeTriples = pgTable("knowledge_triples", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  subject: text("subject").notNull(),
  predicate: text("predicate").notNull(),
  object: text("object").notNull(),
  // Canonical lowercase "s|p|o" identity for atomic UPSERT dedup.
  normKey: text("norm_key").notNull(),
  seenCount: integer("seen_count").notNull().default(1),
  hitCount: integer("hit_count").notNull().default(0),
  lastHitAt: timestamp("last_hit_at"),
  sourceSessionId: integer("source_session_id"),
  // Semantics: "last confirmed at" — reinforcement refreshes it so frequently
  // re-observed facts never age out of the 90-day read window.
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("idx_knowledge_triples_tenant").on(t.tenantId),
  tenantNormUq: uniqueIndex("uq_knowledge_triples_tenant_norm").on(t.tenantId, t.normKey),
}));
export type KnowledgeTriple = typeof knowledgeTriples.$inferSelect;
export type FalsifiedRoute = typeof falsifiedRoutes.$inferSelect;

// Training-Free GRPO (Tencent / Youtu-Agent Team, arXiv:2510.08191) — SHADOW MODE.
// Comparative "semantic advantage" lessons distilled from a GROUP of jury
// (ensemble_query / MoA) proposer rollouts: when proposers diverged, an
// extractor LLM explains WHY the strongest reasoning won and stores a compact,
// transferable lesson keyed by (tenantId, requestClass) with an embedding for
// semantic retrieval. NOTHING here is injected into the live prompt yet — these
// rows are collected + surfaced on /admin/ecosystem-health for quality
// inspection. Flip to live token-prior injection ONLY after lessons prove out
// behind an eval gate (docs/architecture-notes.md § Action candidates).
export const juryExperiences = pgTable("jury_experiences", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  requestClass: text("request_class").notNull(),
  question: text("question").notNull(),
  questionEmbedding: vector("question_embedding", { dimensions: 1536 }),
  lesson: text("lesson").notNull(),
  winningSummary: text("winning_summary"),
  losingSummary: text("losing_summary"),
  concordance: real("concordance"),
  proposerCount: integer("proposer_count"),
  status: text("status").notNull().default("shadow"), // shadow | validated | rejected | superseded
  confidence: real("confidence").notNull().default(0.5),
  sourceResponseId: integer("source_response_id"),
  hitCount: integer("hit_count").notNull().default(0),
  validatedAt: timestamp("validated_at"),
  validUntil: timestamp("valid_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantClassIdx: index("idx_jury_exp_tenant_class").on(t.tenantId, t.requestClass),
  statusIdx: index("idx_jury_exp_status").on(t.status),
  createdIdx: index("idx_jury_exp_created").on(t.createdAt),
  // HNSW on question_embedding created manually in dev+prod once the table
  // grows (same Replit deploy-migration caveat as plan_replay_cache above):
  //   CREATE INDEX idx_jury_exp_embedding ON jury_experiences
  //     USING hnsw (question_embedding vector_cosine_ops);
}));
export type JuryExperience = typeof juryExperiences.$inferSelect;

// Atomic claim-before-spend ledger for the autonomous-spend governor. Background
// loops reserve an estimated cost here BEFORE driving any paid LLM work, so two
// loops starting near the daily cap can't both read "under budget" and both
// spend (the non-atomic read-gate race). Claims are short-lived reservations:
// only rows within AUTONOMOUS_CLAIM_TTL_MINUTES count toward the cap, after
// which the real agent_cost_ledger spend is authoritative and expired claims are
// swept. tenant_id is notNull with NO default — every claim is tenant-scoped.
export const autonomousBudgetClaims = pgTable("autonomous_budget_claims", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  label: text("label"),
  estimatedUsd: numeric("estimated_usd").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  tenantCreatedIdx: index("autonomous_budget_claims_tenant_created_idx").on(t.tenantId, t.createdAt),
}));
export const insertAutonomousBudgetClaimSchema = createInsertSchema(autonomousBudgetClaims).omit({ id: true, createdAt: true });
export type InsertAutonomousBudgetClaim = z.infer<typeof insertAutonomousBudgetClaimSchema>;
export type AutonomousBudgetClaim = typeof autonomousBudgetClaims.$inferSelect;

// Replay-proof processed-entry ledger for the jury-queue drainer (HIGH-1 closure,
// fable-5 review of R125+52.9). `data/jury-decisions/queue.json` is app-writable
// and its `_drained` bookkeeping is UNSIGNED, so a file-write primitive can flip a
// previously-processed entry's `_drained` back to false and replay a legitimately-
// signed past fix. This DB table is the out-of-tree integrity store the deferral
// called for: the drainer records each processed entry's content fingerprint
// (sha256 of the integrity canonicalization) and refuses to re-route any key it has
// already seen — so `_drained` becomes a cheap optimization and the ledger is
// authoritative. `entry_key` is GLOBALLY unique on purpose: replay protection is
// content-based, not tenant-based (an entry processed under ANY tenant must never
// be replayable), so the drainer's existence check is intentionally NOT tenant-
// scoped. `tenant_id` is retained for record-keeping/auditing of which tenant the
// fix was billed+routed under.
export const juryDrainLedger = pgTable("jury_drain_ledger", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  entryKey: text("entry_key").notNull().unique(),
  issueSlug: text("issue_slug"),
  outcome: text("outcome"),
  drainedAt: timestamp("drained_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  tenantIdx: index("jury_drain_ledger_tenant_idx").on(t.tenantId),
}));
export const insertJuryDrainLedgerSchema = createInsertSchema(juryDrainLedger).omit({ id: true, drainedAt: true });
export type InsertJuryDrainLedger = z.infer<typeof insertJuryDrainLedgerSchema>;
export type JuryDrainLedger = typeof juryDrainLedger.$inferSelect;

