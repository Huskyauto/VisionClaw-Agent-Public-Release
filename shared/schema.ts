import { pgTable, serial, text, timestamp, integer, boolean, jsonb, bigint, real, varchar, index, numeric, uniqueIndex, vector, primaryKey, doublePrecision, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export * from "./models/auth";

export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  name: text("name").notNull(),
  replitUserId: text("replit_user_id").unique(),
  plan: text("plan").notNull().default("trial"),
  trialConversationsUsed: integer("trial_conversations_used").notNull().default(0),
  trialMaxConversations: integer("trial_max_conversations").notNull().default(5),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeConnectAccountId: text("stripe_connect_account_id"),
  stripeConnectEnabled: boolean("stripe_connect_enabled").notNull().default(false),
  stripePaymentMode: text("stripe_payment_mode").notNull().default("none"),
  stripeBYOKSecretKey: text("stripe_byok_secret_key"),
  stripeBYOKPublishableKey: text("stripe_byok_publishable_key"),
  stripeSetupFeePaid: boolean("stripe_setup_fee_paid").notNull().default(false),
  coinbaseCommerceApiKey: text("coinbase_commerce_api_key"),
  coinbaseCdpApiKeyId: text("coinbase_cdp_api_key_id"),
  coinbaseCdpApiKeySecret: text("coinbase_cdp_api_key_secret"),
  coinbaseCommerceWebhookSecret: text("coinbase_commerce_webhook_secret"),
  agentmailInboxId: text("agentmail_inbox_id"),
  agentmailEmail: text("agentmail_email"),
  publicChatToken: text("public_chat_token").unique(),
  publicChatEnabled: boolean("public_chat_enabled").notNull().default(false),
  vanitySlug: text("vanity_slug").unique(),
  isActive: boolean("is_active").notNull().default(true),
  emailVerified: boolean("email_verified").default(false),
  onboardingSeen: boolean("onboarding_seen").notNull().default(false),
  deletionScheduledAt: timestamp("deletion_scheduled_at"),
  accountStatus: text("account_status"),
  whatsappApprovalPhone: text("whatsapp_approval_phone"),
  isAdmin: boolean("is_admin").notNull().default(false),
  driveFolderId: text("drive_folder_id"),
  userNotesMarkdown: text("user_notes_markdown"),
  disabledSkillNames: text("disabled_skill_names").array(),
  profilePhotoPath: text("profile_photo_path"),
  forkedFrom: integer("forked_from"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  // Provenance lineage lookups ("which tenants were forked from X"). No FK by
  // platform convention (tenant relations are app-level, never DB FKs — see
  // replit.md Schema rules); the index makes the lineage scan non-sequential.
  forkedFromIdx: index("idx_tenants_forked_from").on(t.forkedFrom),
}));

export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true, trialConversationsUsed: true, emailVerified: true });
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

export const personas = pgTable("personas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().default("Personal Assistant"),
  icon: text("icon").notNull().default("Bot"),
  emoji: text("emoji").notNull().default("🤖"),
  catchphrase: text("catchphrase").notNull().default(""),
  isActive: boolean("is_active").notNull().default(false),
  soul: text("soul").notNull().default(""),
  identity: text("identity").notNull().default(""),
  memoryDoc: text("memory_doc").notNull().default(""),
  operatingLoop: text("operating_loop").notNull().default(""),
  heartbeatDoc: text("heartbeat_doc").notNull().default(""),
  toolsDoc: text("tools_doc").notNull().default(""),
  agentsDoc: text("agents_doc").notNull().default(""),
  brandVoiceDoc: text("brand_voice_doc").notNull().default(""),
  costTier: text("cost_tier").notNull().default("balanced"),
  reasoningConfig: jsonb("reasoning_config"),
  // R75.A — AHB defense layer. Per-persona safety profile:
  //   { intentGate: "off"|"moderate"|"strict",
  //     restrictedCategories: string[],
  //     refusalCopy?: string,
  //     ahbRegression?: boolean }
  // See server/safety/intent-gate.ts and .agents/skills/security-hardening/SKILL.md.
  safetyProfile: jsonb("safety_profile").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// R75.A — AHB intent-gate audit log. One row per intent-gate decision (allow + block).
export const securityIntentChecks = pgTable("security_intent_checks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  conversationId: integer("conversation_id"),
  source: text("source").notNull(),
  messageHash: text("message_hash").notNull(),
  literalIntent: text("literal_intent"),
  flaggedCategories: text("flagged_categories").array().notNull().default(sql`'{}'::text[]`),
  action: text("action").notNull(),
  reason: text("reason"),
  classifier: text("classifier"),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
});

// R75.A — Destructive-tool policy block log. One row per BLOCKED tool call.
export const securityToolBlocks = pgTable("security_tool_blocks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  toolName: text("tool_name").notNull(),
  reason: text("reason").notNull(),
  argsRedacted: jsonb("args_redacted"),
  invokedVia: text("invoked_via"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
});

export const tenantPersonaNames = pgTable("tenant_persona_names", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  personaId: integer("persona_id").notNull().references(() => personas.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
});

export type TenantPersonaName = typeof tenantPersonaNames.$inferSelect;

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default("New Chat"),
  model: text("model").notNull().default("gpt-5-mini"),
  thinking: boolean("thinking").notNull().default(false),
  thinkingLevel: text("thinking_level").notNull().default("off"),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull(),
  isPublic: boolean("is_public").notNull().default(false),
  publicToken: text("public_token"),
  projectId: integer("project_id"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  citations: jsonb("citations"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const memoryEntries = pgTable("memory_entries", {
  id: serial("id").primaryKey(),
  fact: text("fact").notNull(),
  category: text("category").notNull().default("preference"),
  source: text("source").notNull().default("conversation"),
  status: text("status").notNull().default("active"),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull(),
  accessCount: integer("access_count").notNull().default(0),
  categoryId: integer("category_id"),
  wing: text("wing"),
  room: text("room"),
  embedding: jsonb("embedding"),
  embeddingVec: vector("embedding_vec", { dimensions: 1536 }),
  expiresAt: timestamp("expires_at"),
  deletedAt: timestamp("deleted_at"),
  confidence: real("confidence").default(1.0).notNull(),
  confidenceSource: text("confidence_source"),
  // R98.24 — MNEMA Nugget 1 (phantom memory). When a fact is superseded instead of
  // hard-deleted, status flips to 'phantom', succeededById points at the new entry,
  // and validUntil records the moment it stopped being true. Retrieval still finds
  // the phantom but emits a structured refusal pointing readers at the successor —
  // kills the silent-staleness class of bugs where an agent confidently cites a
  // fact that was true 90 days ago but isn't now.
  succeededById: integer("succeeded_by_id"),
  validUntil: timestamp("valid_until"),
  // R98.25 — MNEMA Nugget 4 (decorrelated fragment redundancy). For load-bearing
  // facts (financial, contract, customer-commitment), record the same claim across
  // k=5 kin entries that share a kin_group_id but DIFFER in their provenance triple
  // (extractor model family, source-doc root, ingestion pipeline). Retrieval can
  // then prefer facts whose surviving kin span ≥3 distinct families — defense
  // against AgentPoison-class attacks that target one extractor or one source.
  // MNEMA Theorem 3 / Corollary 2: redundancy without decorrelation collapses to
  // single-storage protection. Default null; only load-bearing facts get a kin id.
  kinGroupId: text("kin_group_id"),
  provenanceTriple: jsonb("provenance_triple"),
  // R116 — agentmemory nuggets N2 + N7. lastReinforcedAt resets on every
  // retrieval hit so the Ebbinghaus curve (computed in memory-ranking with
  // per-category half-life) decays "time since last reinforcement" not
  // "time since insert". qualityScore is the structural/citation/coherence
  // score computed at write time by lib/quality-score.ts — <0.5 routes to
  // the review queue (idx_memory_entries_quality_below partial index).
  lastReinforcedAt: timestamp("last_reinforced_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  qualityScore: real("quality_score").default(1.0).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastAccessed: timestamp("last_accessed").default(sql`CURRENT_TIMESTAMP`).notNull(),
  // R125+3.8 — `tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(fact,'')))
  // STORED` lives in the DB but is intentionally NOT declared as a Drizzle column.
  // Same precedent as agent_knowledge.tsv: it's read only via raw `sql\`m.tsv @@ q.tsq\``
  // in server/embeddings.ts (bm25SearchMemory / hybridSearchMemory) and never touched
  // by typed Drizzle queries, so we skip the column to avoid pgTable's typed-builder
  // friction with custom generated columns. Backed by GIN index memory_entries_tsv_gin_idx.
  // Closes the abmind "three-tier search" gap (vector + BM25 RRF fusion).
});

// R112.15 — L2 session memory. Fills the gap between L1 (per-turn scratchpad)
// and L3 (MNEMA / Memory V2 persona-lifetime facts). Facts established earlier
// in THIS conversation that should survive context-window truncation but
// shouldn't (yet) pollute persona-lifetime memory. Auto-extracted by a cheap
// LLM after every turn once the conversation crosses 10 turns; auto-promoted
// to MNEMA when ref_count >= 3. Hard-capped at 50 facts/conv (LRU evict).
// Cascades on conversation delete.
export const conversationFacts = pgTable("conversation_facts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  personaId: integer("persona_id"),
  factText: text("fact_text").notNull(),
  factKind: text("fact_kind").notNull().default("other"), // entity | preference | constraint | task_state | other
  sourceMessageId: integer("source_message_id"),
  source: text("source").notNull().default("extractor"), // extractor | tool | manual
  refCount: integer("ref_count").notNull().default(0),
  status: text("status").notNull().default("active"), // active | promoted | expired
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastReferencedAt: timestamp("last_referenced_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  expiresAt: timestamp("expires_at"),
});

export const agentRuns = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  runType: text("run_type").notNull(),
  goal: text("goal").notNull(),
  status: text("status").notNull().default("running"),
  state: jsonb("state").notNull().default(sql`'{}'::jsonb`),
  steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`),
  result: jsonb("result"),
  error: text("error"),
  parentRunId: integer("parent_run_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
});

export const agentApprovals = pgTable("agent_approvals", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  runId: integer("run_id"),
  requestedBy: text("requested_by"),
  question: text("question").notNull(),
  context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
  status: text("status").notNull().default("pending"),
  decision: jsonb("decision"),
  decidedBy: text("decided_by"),
  requestedAt: timestamp("requested_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  decidedAt: timestamp("decided_at"),
  expiresAt: timestamp("expires_at"),
});

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

// Orchestration efficiency telemetry (arXiv:2605.22687 — illusory AI
// productivity / the dependence feedback loop). One row per orchestration (or
// heavy-loop decision): records what the resource-predictor PREDICTED vs what
// actually happened, plus the cheap "is the heavy loop worth it?" guard verdict.
// Surfaced on /admin/ecosystem-health so the felt-vs-real gap (the paper's
// 55.7s-predicted vs 7.5s-measured finding) becomes a live, measurable metric
// instead of a vibe. Telemetry table — written fire-and-forget, never blocks.
export const orchestrationEfficiency = pgTable("orchestration_efficiency", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  requestClass: text("request_class").notNull(),
  label: text("label"), // operation type: "plan" | "auto_ensemble" | etc.
  predictedDurationMs: integer("predicted_duration_ms"),
  predictedCostUsd: doublePrecision("predicted_cost_usd"),
  actualDurationMs: integer("actual_duration_ms"),
  actualCostUsd: doublePrecision("actual_cost_usd"),
  heavyLoopUsed: boolean("heavy_loop_used").notNull().default(false),
  guardVerdict: text("guard_verdict"), // "worth" | "skip" | "neutral"
  triviality: doublePrecision("triviality"), // 0..1 — how trivially-doable the request looked to the guard
  // arXiv:2606.24937 (Roitman, ch.20 + 29.2.6) — process-quality / trajectory
  // grading ("evaluation beyond final task success"). Nullable: only populated by
  // callsites that have a finished trajectory in scope (e.g. CEO plan execution).
  processQuality: doublePrecision("process_quality"), // 0..1 composite (scoreTrajectory)
  completionRate: doublePrecision("completion_rate"), // 0..1 completed/steps
  failureRate: doublePrecision("failure_rate"), // 0..1 failed/steps
  redundancyRate: doublePrecision("redundancy_rate"), // 0..1 redundant/steps
  steps: integer("steps"), // total discrete steps in the run
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantCreatedIdx: index("idx_orch_eff_tenant_created").on(t.tenantId, t.createdAt),
  classIdx: index("idx_orch_eff_class").on(t.requestClass, t.createdAt),
}));
export type OrchestrationEfficiency = typeof orchestrationEfficiency.$inferSelect;
export const insertOrchestrationEfficiencySchema = createInsertSchema(orchestrationEfficiency).omit({ id: true, createdAt: true });

// Pre-Flight Capability Review (PFCR) telemetry — reuse-vs-rebuild signal.
// Bob 2026-06-28 chose the "directive + telemetry" enforcement model: the
// do-not-rebuild block stays a prompt-level directive, and every fired review is
// recorded here so /admin/ecosystem-health can surface whether agents actually
// reuse the native assets PFCR surfaced or ignore them. tenant_id NOT NULL, no
// default (every INSERT passes it explicitly). reuse_eligible = the review
// surfaced >=1 TOOL-kind do-not-rebuild item (the only kind observable at the
// tool-dispatch chokepoint) — it is the honest denominator for the reuse rate.
export const capabilityReviews = pgTable("capability_reviews", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  conversationId: integer("conversation_id"),
  taskSummary: text("task_summary"),
  assetsSurfaced: integer("assets_surfaced").notNull().default(0),
  rebuildRisks: integer("rebuild_risks").notNull().default(0),
  reuseEligible: boolean("reuse_eligible").notNull().default(false),
  surfacedNames: text("surfaced_names").array(),
  reused: boolean("reused").notNull().default(false),
  reusedCapability: text("reused_capability"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantCreatedIdx: index("idx_cap_review_tenant_created").on(t.tenantId, t.createdAt),
}));
export type CapabilityReviewRow = typeof capabilityReviews.$inferSelect;
export const insertCapabilityReviewSchema = createInsertSchema(capabilityReviews).omit({ id: true, createdAt: true });
export type InsertOrchestrationEfficiency = z.infer<typeof insertOrchestrationEfficiencySchema>;

// Self-Directed Initiatives — the "intention engine". Unlike every other
// autonomy loop (scheduled crons, reactive repair/CI, narrow external-feed
// discovery), this is the platform's SELF-ORIGINATED goal formation: a periodic
// loop introspects the platform's OWN internal telemetry (incidents, decline
// events, lead pipeline, heartbeat errors, eval drift, …) and PROPOSES 1–3
// initiatives nobody asked for. It is genuine self-agency with HITL on
// commitment: initiatives are persisted + surfaced to the owner for approval;
// nothing here auto-executes a material change. `evidence` is the telemetry
// snapshot that motivated the proposal (auditable provenance). `signature` is a
// normalized dedup key so the loop doesn't re-propose the same idea every run.
// Tenant-scoped (no FK, app-level WHERE per house convention).
export const selfInitiatives = pgTable("self_initiatives", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  title: text("title").notNull(),
  rationale: text("rationale").notNull().default(""),
  // "revenue" | "reliability" | "quality" | "growth" | "cost" | "safety" | "capability" | "general"
  category: text("category").notNull().default("general"),
  // The telemetry snapshot the proposal was grounded in (auditable provenance).
  evidence: jsonb("evidence").notNull().default(sql`'{}'::jsonb`),
  // 0..1 — the model's self-rated confidence this is worth doing.
  confidence: real("confidence").notNull().default(0),
  // "low" | "medium" | "high" — execution/blast-radius risk if pursued.
  risk: text("risk").notNull().default("medium"),
  // Free-text value estimate (e.g. "~$X/mo", "closes a reliability gap").
  estimatedValue: text("estimated_value").notNull().default(""),
  // "surfaced" | "approved" | "dismissed" | "done" | "acting"
  status: text("status").notNull().default("surfaced"),
  // Which model authored the proposal (provider drift visibility).
  sourceModel: text("source_model").notNull().default(""),
  // Normalized dedup key (lowercased title words) — one open initiative per idea.
  signature: text("signature").notNull().default(""),
  decidedAt: timestamp("decided_at"),
  decidedBy: text("decided_by"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantStatusIdx: index("idx_self_initiatives_tenant_status").on(t.tenantId, t.status, t.createdAt),
  tenantSigIdx: index("idx_self_initiatives_tenant_sig").on(t.tenantId, t.signature),
  // Concurrency backstop for app-level dedup: one OPEN initiative per signature.
  openSigUniqIdx: uniqueIndex("idx_self_initiatives_open_sig")
    .on(t.tenantId, t.signature)
    .where(sql`status IN ('surfaced','approved','acting')`),
}));
export type SelfInitiative = typeof selfInitiatives.$inferSelect;
export const insertSelfInitiativeSchema = createInsertSchema(selfInitiatives).omit({ id: true, createdAt: true });
export type InsertSelfInitiative = z.infer<typeof insertSelfInitiativeSchema>;

// Tool-Output Compressor telemetry — one rollup row PER (tenant, day). Lets us
// SEE whether the type-aware tool-result compressor actually cuts the input
// tokens we're billed for, on real traffic (Headroom evaluation, 2026-06-13).
// tokens_saved_vs_baseline is the HONEST headline: savings vs the old dumb
// head-slice it replaced (both cap at maxChars), not vs sending raw (we never did).
export const toolCompressionStats = pgTable("tool_compression_stats", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  day: date("day").notNull(),
  calls: integer("calls").notNull().default(0),
  compressedCalls: integer("compressed_calls").notNull().default(0),
  originalChars: bigint("original_chars", { mode: "number" }).notNull().default(0),
  outputChars: bigint("output_chars", { mode: "number" }).notNull().default(0),
  baselineChars: bigint("baseline_chars", { mode: "number" }).notNull().default(0),
  tokensSavedVsRaw: bigint("tokens_saved_vs_raw", { mode: "number" }).notNull().default(0),
  tokensSavedVsBaseline: bigint("tokens_saved_vs_baseline", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantDayIdx: uniqueIndex("idx_tool_compression_tenant_day").on(t.tenantId, t.day),
}));
export type ToolCompressionStats = typeof toolCompressionStats.$inferSelect;

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

export const agentCostLedger = pgTable("agent_cost_ledger", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  toolName: text("tool_name").notNull(),
  model: text("model"),
  costUsd: text("cost_usd").notNull().default("0"),
  tokensIn: integer("tokens_in").default(0),
  tokensOut: integer("tokens_out").default(0),
  // Prompt-cache instrumentation. cachedTokensIn = input tokens served from the
  // provider's prompt cache (OpenAI prompt_tokens_details.cached_tokens / Anthropic
  // cache_read_input_tokens / Gemini cachedContentTokenCount) billed at a discount;
  // cacheWriteTokens = Anthropic cache_creation_input_tokens (cache-write surcharge).
  // Both are SUBSETS of tokensIn (normalized at capture). Nullable defaults keep
  // every existing call-site working untouched.
  cachedTokensIn: integer("cached_tokens_in").default(0),
  cacheWriteTokens: integer("cache_write_tokens").default(0),
  operation: text("operation"),
  runId: integer("run_id"),
  // R125+14 — budget attribution. Nullable so existing call-sites keep working;
  // threaded where persona/department context is known so department_budgets
  // can compute real spend without a separate accounting path.
  personaId: integer("persona_id"),
  department: text("department"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const dailyNotes = pgTable("daily_notes", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  content: text("content").notNull(),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const agentSettings = pgTable("agent_settings", {
  id: serial("id").primaryKey(),
  agentName: text("agent_name").notNull().default("VisionClaw"),
  personality: text("personality").notNull().default("You are VisionClaw, a helpful personal AI assistant."),
  defaultModel: text("default_model").notNull().default("gpt-5-mini"),
  thinkingEnabled: boolean("thinking_enabled").notNull().default(false),
  discordBotToken: text("discord_bot_token"),
  accessPin: text("access_pin"),
  whatsappApprovalPhone: text("whatsapp_approval_phone"),
  telegramBotToken: text("telegram_bot_token"),
  // Gmail-direct OAuth refresh token (encrypted JSON via crypto.encryptApiKey),
  // persisted to the shared DB so it survives prod publishes (the deploy FS is
  // ephemeral). Authorize once via /api/admin/gmail-direct/auth → read by the
  // prod ideabrowser_ingest task on every run. See server/lib/gmail-direct-token.ts.
  gmailDirectToken: text("gmail_direct_token"),
  // Built With Bob — Bob's latest stated weight context (agentic, not hardcoded).
  // Set when Bob states his numbers in a prompt; read by every recap run as the
  // source of truth. See server/lib/bwb-weight.ts.
  bwbCurrentWeight: integer("bwb_current_weight"),
  bwbTotalLost: integer("bwb_total_lost"),
  bwbStartWeight: integer("bwb_start_weight"),
  bwbWeightUpdatedAt: timestamp("bwb_weight_updated_at"),
});

export const skills = pgTable("skills", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull().default("Zap"),
  enabled: boolean("enabled").notNull().default(true),
  category: text("category").notNull().default("general"),
  promptContent: text("prompt_content"),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  // R98.24 — MNEMA Nugget 1 (phantom skills). Same idea as memory: superseded
  // skills retire to 'phantom' (not deleted) so retrieval can point at successor.
  status: text("status").notNull().default("active"),
  succeededById: integer("succeeded_by_id"),
  validUntil: timestamp("valid_until"),
});

export const agentActivity = pgTable("agent_activity", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  personaId: integer("persona_id").references(() => personas.id),
  personaName: text("persona_name").notNull().default("VisionClaw"),
  status: text("status").notNull().default("idle"),
  activityType: text("activity_type").notNull().default("chat"),
  summary: text("summary"),
  conversationId: integer("conversation_id").references(() => conversations.id),
  metadata: jsonb("metadata").default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const providerKeys = pgTable("provider_keys", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().unique(),
  apiKey: text("api_key").notNull(),
  baseUrl: text("base_url"),
  enabled: boolean("enabled").notNull().default(true),
});

export const agentKnowledge = pgTable("agent_knowledge", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category").notNull().default("insight"),
  priority: integer("priority").notNull().default(3),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull(),
  source: text("source").notNull().default("user"),
  embedding: jsonb("embedding"),
  embeddingVec: vector("embedding_vec", { dimensions: 1536 }),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const heartbeatTasks = pgTable("heartbeat_tasks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  type: text("type").notNull().default("routine"),
  cronExpression: text("cron_expression").notNull().default("*/30 * * * *"),
  enabled: boolean("enabled").notNull().default(true),
  promptContent: text("prompt_content").notNull(),
  model: text("model").notNull().default("gpt-5-nano"),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  createdBy: text("created_by").notNull().default("user"),
  parentTaskId: integer("parent_task_id"),
  runOnce: boolean("run_once").notNull().default(false),
  tenantId: integer("tenant_id").notNull(),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  approvalStatus: text("approval_status"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Offline golden-set eval history (durable cross-deploy baseline store). The
// offline-eval gate (scripts/offline-eval.ts) used to keep run history on the FS
// (data/eval/history), but prod FS resets each publish — wiping the baseline and
// degrading the gate to within-deployment-only. Persisting here makes the
// last-non-degraded baseline survive deploys. Tenant-scoped (no FK, app-level
// WHERE per platform convention); indexed on (tenant_id, created_at) for the
// "most recent non-degraded run" baseline lookup.
export const evalRuns = pgTable("eval_runs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  answerModel: text("answer_model").notNull(),
  judgeModel: text("judge_model").notNull(),
  totalCases: integer("total_cases").notNull(),
  evaluatedCases: integer("evaluated_cases").notNull(),
  coverage: real("coverage").notNull(),
  suiteScore: real("suite_score").notNull(),
  baselineScore: real("baseline_score"),
  degraded: boolean("degraded").notNull().default(false),
  regressed: boolean("regressed").notNull().default(false),
  regressionDrop: real("regression_drop").notNull().default(0),
  belowMinCases: text("below_min_cases").array().notNull().default(sql`'{}'::text[]`),
  record: jsonb("record").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantCreatedIdx: index("idx_eval_runs_tenant_created").on(t.tenantId, t.createdAt),
}));

export const heartbeatLogs = pgTable("heartbeat_logs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id"),
  taskName: text("task_name").notNull(),
  status: text("status").notNull().default("success"),
  input: text("input"),
  output: text("output"),
  model: text("model"),
  personaId: integer("persona_id"),
  personaName: text("persona_name"),
  delegatedTasks: text("delegated_tasks"),
  durationMs: integer("duration_ms"),
  // Pace-control lane tag. 'interactive' = user/chat-driven delegation (own
  // protected budget); NULL / anything-else = autonomous background run. Lets
  // the pace cap stop background scheduled-task completions from starving
  // user-initiated delegations.
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPersonaSchema = createInsertSchema(personas).omit({ id: true, createdAt: true });
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertMemoryEntrySchema = createInsertSchema(memoryEntries).omit({ id: true, createdAt: true, lastAccessed: true });
export const insertDailyNoteSchema = createInsertSchema(dailyNotes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSettingsSchema = createInsertSchema(agentSettings).omit({ id: true });
export const insertSkillSchema = createInsertSchema(skills).omit({ id: true });
export const insertProviderKeySchema = createInsertSchema(providerKeys).omit({ id: true });
export const insertKnowledgeSchema = createInsertSchema(agentKnowledge).omit({ id: true, createdAt: true, updatedAt: true });
export const insertHeartbeatTaskSchema = createInsertSchema(heartbeatTasks).omit({ id: true, createdAt: true, lastRunAt: true, nextRunAt: true });
export const insertHeartbeatLogSchema = createInsertSchema(heartbeatLogs).omit({ id: true, createdAt: true });
export const insertEvalRunSchema = createInsertSchema(evalRuns).omit({ id: true, createdAt: true });
export type InsertEvalRun = z.infer<typeof insertEvalRunSchema>;
export type EvalRun = typeof evalRuns.$inferSelect;

// R98.21 — Hyperagent-cross-pollination: skill auto-emission + cross-run A/B.
// proposed_skills queues agent-noticed reusable patterns for human review before
// they're promoted into the live `skills` table. Status flow: pending → accepted (copied
// to skills) | rejected | superseded.
export const proposedSkills = pgTable("proposed_skills", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  body: text("body").notNull(),                          // promptContent for the future skill
  category: text("category").notNull().default("general"),
  sourceContext: text("source_context"),                 // why the agent thought this was worth saving
  proposingPersona: text("proposing_persona"),           // which persona proposed it
  confidence: integer("confidence").notNull().default(70), // 0-100; mirrors memory v2 confidence ranges
  status: text("status").notNull().default("pending"),   // pending | accepted | rejected | superseded
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  promotedSkillId: integer("promoted_skill_id"),         // when accepted, the row id in `skills`
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ab_runs records cross-run A/B evaluations: same prompt, multiple agent configs
// (model + system prompt), scored against a rubric, ranked. The agent calls
// `run_ab_eval` to populate this; results are visible in the operator UI.
export const abRuns = pgTable("ab_runs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  rubric: text("rubric").notNull(),                      // human-readable scoring rubric
  configs: jsonb("configs").notNull(),                   // [{label, model, systemPrompt?}]
  runsPerConfig: integer("runs_per_config").notNull().default(1),
  status: text("status").notNull().default("pending"),   // pending | running | complete | failed
  results: jsonb("results").default([]),                 // [{configLabel, runIndex, output, score, critique}]
  ranking: jsonb("ranking").default([]),                 // [{configLabel, avgScore, runs}] sorted desc
  errorMessage: text("error_message"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertProposedSkillSchema = createInsertSchema(proposedSkills).omit({
  id: true, createdAt: true, reviewedAt: true, reviewedBy: true, promotedSkillId: true, status: true,
});
export const insertAbRunSchema = createInsertSchema(abRuns).omit({
  id: true, createdAt: true, completedAt: true, status: true, results: true, ranking: true, errorMessage: true,
});
export type ProposedSkill = typeof proposedSkills.$inferSelect;
export type InsertProposedSkill = z.infer<typeof insertProposedSkillSchema>;
export type AbRun = typeof abRuns.$inferSelect;
export type InsertAbRun = z.infer<typeof insertAbRunSchema>;

export const codeHealthFindings = pgTable("code_health_findings", {
  id: serial("id").primaryKey(),
  scanId: text("scan_id").notNull(),
  filePath: text("file_path").notNull(),
  lineNumber: integer("line_number"),
  category: text("category").notNull(),
  severity: text("severity").notNull().default("warning"),
  pattern: text("pattern").notNull(),
  snippet: text("snippet"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const codeHealthScans = pgTable("code_health_scans", {
  id: serial("id").primaryKey(),
  scanId: text("scan_id").notNull().unique(),
  filesScanned: integer("files_scanned").notNull().default(0),
  totalFindings: integer("total_findings").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  infoCount: integer("info_count").notNull().default(0),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const conversationTemplates = pgTable("conversation_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull().default("MessageSquare"),
  category: text("category").notNull().default("general"),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  model: text("model"),
  systemPromptPrefix: text("system_prompt_prefix"),
  starterMessages: text("starter_messages").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertConversationTemplateSchema = createInsertSchema(conversationTemplates).omit({ id: true, createdAt: true });

export const memoryCategories = pgTable("memory_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  description: text("description"),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").references(() => personas.id, { onDelete: "set null" }),
  memoryCount: integer("memory_count").notNull().default(0),
  // R116 — agentmemory N2. Per-category Ebbinghaus half-life in days.
  // Architecture decisions decay slowly (long half-life); transient bugs
  // decay fast (short half-life). Default 30d matches DEFAULT_TEMPORAL_DECAY
  // so legacy categories keep their existing decay profile.
  halfLifeDays: integer("half_life_days").notNull().default(30),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// R116 — agentmemory N14. Pinned edge-type taxonomy. DB-side CHECK constraint
// memory_links_link_type_check enforces membership. 'related' kept as the
// legacy fallback for un-typed pre-R116 links.
export const MEMORY_LINK_TYPES = [
  "uses",
  "depends_on",
  "contradicts",
  "caused",
  "fixed",
  "supersedes",
  "related",
] as const;
export type MemoryLinkType = typeof MEMORY_LINK_TYPES[number];

export const memoryLinks = pgTable("memory_links", {
  id: serial("id").primaryKey(),
  sourceMemoryId: integer("source_memory_id").notNull().references(() => memoryEntries.id, { onDelete: "cascade" }),
  targetMemoryId: integer("target_memory_id").notNull().references(() => memoryEntries.id, { onDelete: "cascade" }),
  linkType: text("link_type").notNull().default("related"),
  strength: real("strength").notNull().default(0.5),
  // R116 — agentmemory N14. Per-edge confidence (0..1) + count of independent
  // sources supporting this edge. Used by contradiction-resolver to weight
  // 'contradicts' edges and by lint to flag low-confidence high-strength edges.
  confidence: real("confidence").notNull().default(0.5),
  sourceCount: integer("source_count").notNull().default(1),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertMemoryCategorySchema = createInsertSchema(memoryCategories).omit({ id: true, createdAt: true });
export const insertMemoryLinkSchema = createInsertSchema(memoryLinks).omit({ id: true, createdAt: true });

export type MemoryCategory = typeof memoryCategories.$inferSelect;
export type InsertMemoryCategory = z.infer<typeof insertMemoryCategorySchema>;
export type MemoryLink = typeof memoryLinks.$inferSelect;
export type InsertMemoryLink = z.infer<typeof insertMemoryLinkSchema>;

export type Persona = typeof personas.$inferSelect;
export type InsertPersona = z.infer<typeof insertPersonaSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type MemoryEntry = typeof memoryEntries.$inferSelect;
export const insertConversationFactSchema = createInsertSchema(conversationFacts).omit({ id: true, createdAt: true, lastReferencedAt: true, refCount: true });
export type InsertConversationFact = z.infer<typeof insertConversationFactSchema>;
export type ConversationFact = typeof conversationFacts.$inferSelect;
export type InsertMemoryEntry = z.infer<typeof insertMemoryEntrySchema>;
export type DailyNote = typeof dailyNotes.$inferSelect;
export type InsertDailyNote = z.infer<typeof insertDailyNoteSchema>;
export type AgentSettings = typeof agentSettings.$inferSelect;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Skill = typeof skills.$inferSelect;
export type InsertSkill = z.infer<typeof insertSkillSchema>;
export type ProviderKey = typeof providerKeys.$inferSelect;
export type InsertProviderKey = z.infer<typeof insertProviderKeySchema>;
export type AgentKnowledge = typeof agentKnowledge.$inferSelect;
export type InsertKnowledge = z.infer<typeof insertKnowledgeSchema>;
export type HeartbeatTask = typeof heartbeatTasks.$inferSelect;
export type InsertHeartbeatTask = z.infer<typeof insertHeartbeatTaskSchema>;
export type HeartbeatLog = typeof heartbeatLogs.$inferSelect;
export type InsertHeartbeatLog = z.infer<typeof insertHeartbeatLogSchema>;
export type ConversationTemplate = typeof conversationTemplates.$inferSelect;
export type InsertConversationTemplate = z.infer<typeof insertConversationTemplateSchema>;

export const customTools = pgTable("custom_tools", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  parameters: jsonb("parameters").notNull().default("[]"),
  implementation: text("implementation").notNull(),
  createdBy: text("created_by").notNull().default("agent"),
  isActive: boolean("is_active").notNull().default(true),
  usageCount: integer("usage_count").notNull().default(0),
  tenantId: integer("tenant_id").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertCustomToolSchema = createInsertSchema(customTools).omit({ id: true, usageCount: true, createdAt: true });
export type CustomTool = typeof customTools.$inferSelect;
export type InsertCustomTool = z.infer<typeof insertCustomToolSchema>;

export const experiments = pgTable("experiments", {
  id: serial("id").primaryKey(),
  hypothesis: text("hypothesis").notNull(),
  approach: text("approach").notNull(),
  category: text("category").notNull().default("general"),
  metric: text("metric"),
  baselineValue: text("baseline_value"),
  resultValue: text("result_value"),
  status: text("status").notNull().default("running"),
  outcome: text("outcome"),
  personaId: integer("persona_id"),
  tenantId: integer("tenant_id").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertExperimentSchema = createInsertSchema(experiments).omit({ id: true, createdAt: true });
export type Experiment = typeof experiments.$inferSelect;
export type InsertExperiment = z.infer<typeof insertExperimentSchema>;

// R125+14 — Agentic gap closure (Manus review). Four new tables:

// (1) Durable sleep/wake — a persona schedules a future resume (e.g. "email sent,
// wake in 3 days to check for a reply and follow up"). Scanned by the heartbeat.
export const agentWakeSchedules = pgTable("agent_wake_schedules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  conversationId: integer("conversation_id"),
  projectId: integer("project_id"),
  kind: text("kind").notNull().default("follow_up"),
  goal: text("goal").notNull(),
  context: jsonb("context"),
  wakeAt: timestamp("wake_at").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(1),
  result: jsonb("result"),
  createdBy: text("created_by").notNull().default("agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const insertAgentWakeScheduleSchema = createInsertSchema(agentWakeSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type AgentWakeSchedule = typeof agentWakeSchedules.$inferSelect;
export type InsertAgentWakeSchedule = z.infer<typeof insertAgentWakeScheduleSchema>;

// (2) Departmental budgets — per-department spend ceilings per period. Spend is
// computed from agent_cost_ledger via the persona→department map.
export const departmentBudgets = pgTable("department_budgets", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  department: text("department").notNull(),
  period: text("period").notNull().default("monthly"),
  limitUsd: text("limit_usd").notNull().default("0"),
  periodStart: timestamp("period_start").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // Matches the live DB index `idx_dept_budget_uniq`. REQUIRED for the
  // setDepartmentBudget() ON CONFLICT (tenant_id, department, period_start)
  // upsert — without it a fresh db:push (e.g. to production) would omit the
  // constraint and the first set_department_budget call would error.
  uniqTdp: uniqueIndex("idx_dept_budget_uniq").on(t.tenantId, t.department, t.periodStart),
}));
export const insertDepartmentBudgetSchema = createInsertSchema(departmentBudgets).omit({ id: true, createdAt: true, updatedAt: true });
export type DepartmentBudget = typeof departmentBudgets.$inferSelect;
export type InsertDepartmentBudget = z.infer<typeof insertDepartmentBudgetSchema>;

// (3) Process Reward Model — per-step scores of intermediate reasoning quality,
// not just final-output grading. Feeds continuous-replanning decisions.
export const stepRewards = pgTable("step_rewards", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  planId: integer("plan_id"),
  runId: integer("run_id"),
  conversationId: integer("conversation_id"),
  stepIndex: integer("step_index").notNull(),
  agent: text("agent"),
  score: integer("score").notNull(),
  rationale: text("rationale"),
  signals: jsonb("signals"),
  model: text("model"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertStepRewardSchema = createInsertSchema(stepRewards).omit({ id: true, createdAt: true });
export type StepReward = typeof stepRewards.$inferSelect;
export type InsertStepReward = z.infer<typeof insertStepRewardSchema>;

// Action Ledger (feature contract: data/feature-contracts/action-ledger/) — durable
// record of side-effecting tool attempts for exactly-once semantics. A `prepared`
// row is persisted BEFORE crossing the external boundary; settled to committed/failed
// after; parked as `unknown` on timeout/crash for the reconciler. S1: table +
// primitives only, nothing writes to it yet.
export const actionAttempts = pgTable("action_attempts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  operationId: text("operation_id").notNull(),
  planId: integer("plan_id"),
  runId: integer("run_id"),
  conversationId: integer("conversation_id"),
  toolName: text("tool_name").notNull(),
  argumentsHash: text("arguments_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  risk: text("risk").notNull(),
  state: text("state").notNull().default("prepared"),
  providerReceipt: jsonb("provider_receipt"),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  settledAt: timestamp("settled_at"),
  committedAt: timestamp("committed_at"),
});
export const insertActionAttemptSchema = createInsertSchema(actionAttempts).omit({ id: true, startedAt: true, settledAt: true, committedAt: true });
export type ActionAttempt = typeof actionAttempts.$inferSelect;
export type InsertActionAttempt = z.infer<typeof insertActionAttemptSchema>;

// (4) Task forces — scoped "subsidiaries" within a tenant: a mission, a roster of
// personas, a capped budget, and a lifecycle (active→completed/sunset). NOT a new
// isolation boundary — all work stays under the parent tenant_id.
export const taskForces = pgTable("task_forces", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  mission: text("mission").notNull(),
  personaIds: integer("persona_ids").array(),
  budgetUsd: text("budget_usd").notNull().default("0"),
  spentUsd: text("spent_usd").notNull().default("0"),
  projectId: integer("project_id"),
  status: text("status").notNull().default("active"),
  deadline: timestamp("deadline"),
  result: jsonb("result"),
  createdBy: text("created_by").notNull().default("Felix"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  sunsetAt: timestamp("sunset_at"),
});
export const insertTaskForceSchema = createInsertSchema(taskForces).omit({ id: true, createdAt: true, updatedAt: true, sunsetAt: true });
export type TaskForce = typeof taskForces.$inferSelect;
export type InsertTaskForce = z.infer<typeof insertTaskForceSchema>;

export const fileStorage = pgTable("file_storage", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  data: text("data").notNull().default(""),
  storageKey: text("storage_key"),
  driveUrl: text("drive_url"),
  tenantId: integer("tenant_id").notNull(),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertFileStorageSchema = createInsertSchema(fileStorage).omit({ id: true, createdAt: true });
export type FileStorageEntry = typeof fileStorage.$inferSelect;
export type InsertFileStorageEntry = z.infer<typeof insertFileStorageSchema>;

export const deliveryLogs = pgTable("delivery_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  orderId: text("order_id"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  productName: text("product_name").notNull(),
  fileName: text("file_name").notNull(),
  driveFileId: text("drive_file_id"),
  driveFolderId: text("drive_folder_id"),
  folderLink: text("folder_link"),
  downloadLink: text("download_link"),
  shareableLink: text("shareable_link"),
  emailSent: boolean("email_sent").default(false),
  emailMessageId: text("email_message_id"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  stripePaymentId: text("stripe_payment_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => ({
  // Indexes for the public order-lookup endpoint, which queries by either
  // order_id (Stripe checkout session id) or stripe_payment_id. The
  // customer-facing /orders/:sessionId page polls every 3s while pending,
  // so an unindexed scan would degrade as delivery_logs grows.
  orderIdIdx: index("delivery_logs_order_id_idx").on(t.orderId),
  stripePaymentIdIdx: index("delivery_logs_stripe_payment_id_idx").on(t.stripePaymentId),
  tenantIdIdx: index("delivery_logs_tenant_id_idx").on(t.tenantId),
  // Round 27: partial unique index — at most one delivery_logs row per
  // stripe_payment_id when present. Prevents double-fulfillment when
  // Stripe webhook retries fire (network blip, 5xx, etc). Partial so
  // owner-initiated deliveries with no payment id aren't blocked.
  stripePaymentIdUniq: uniqueIndex("delivery_logs_stripe_payment_id_unique")
    .on(t.stripePaymentId)
    .where(sql`stripe_payment_id IS NOT NULL`),
}));

export const insertDeliveryLogSchema = createInsertSchema(deliveryLogs).omit({ id: true, createdAt: true, completedAt: true });
export type DeliveryLog = typeof deliveryLogs.$inferSelect;
export type InsertDeliveryLog = z.infer<typeof insertDeliveryLogSchema>;

// Delivery adoption signal — SSRN 6859839 (MIT 2026). One row per confirmed
// recipient fetch/download of a delivered file (self-hosted /uploads/delivery-N-*).
// Powers the produce -> ship -> ADOPT funnel on /admin/ecosystem-health so output
// volume isn't mistaken for value. tenant_id is NOT NULL with no default per the
// tenant-isolation convention; delivery_id is the delivery_logs.id parsed from the
// URL (nullable, no FK — mirrors the no-FK tenant-relation convention).
export const deliveryEngagement = pgTable("delivery_engagement", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  deliveryId: integer("delivery_id"),
  eventType: text("event_type").notNull().default("fetch"),
  fileName: text("file_name"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdIdx: index("delivery_engagement_tenant_id_idx").on(t.tenantId),
  deliveryIdIdx: index("delivery_engagement_delivery_id_idx").on(t.deliveryId),
}));

export const insertDeliveryEngagementSchema = createInsertSchema(deliveryEngagement).omit({ id: true, createdAt: true });
export type DeliveryEngagement = typeof deliveryEngagement.$inferSelect;
export type InsertDeliveryEngagement = z.infer<typeof insertDeliveryEngagementSchema>;


// Pending 6-digit verification codes for the public "find my orders by
// email" recovery flow. Persisted (instead of in-memory) so they survive
// server restarts and are shared across instances. The raw code is never
// stored — we keep an HMAC-style hash bound to the email. Rows are
// short-lived (15-minute TTL) and removed on first successful use or
// after the per-email attempt counter trips.
export const orderLookupCodes = pgTable("order_lookup_codes", {
  email: text("email").primaryKey(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});
export type OrderLookupCode = typeof orderLookupCodes.$inferSelect;

export const authSessions = pgTable("auth_sessions", {
  token: text("token").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
});

export const compactionArchives = pgTable("compaction_archives", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  tenantId: integer("tenant_id").notNull(),
  archivedAt: timestamp("archived_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  messageCount: integer("message_count").notNull().default(0),
  totalMessages: integer("total_messages").notNull().default(0),
  content: text("content").notNull(),
  summary: text("summary"),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("active"),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  tags: text("tags").array().default(sql`'{}'::text[]`),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
  primaryConversationId: integer("primary_conversation_id"),
  tenantId: integer("tenant_id").notNull(),
  driveFolderId: text("drive_folder_id"),
  driveFolderUrl: text("drive_folder_url"),
  currentState: text("current_state").default(""),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Felix Autonomous Loop (R74.13w, 2026-04-28) — every 4h Felix wakes,
// reads the inbox / projects / recent activity, drafts proposals into
// felix_proposals for Bob's review. Dry-run mode hard-coded for first 14 days.
export const felixLoopRuns = pgTable("felix_loop_runs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  mode: text("mode").notNull().default("dry_run"),
  startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  endedAt: timestamp("ended_at"),
  contextSummary: text("context_summary").default(""),
  intentSummary: text("intent_summary").default(""),
  proposalsDrafted: integer("proposals_drafted").notNull().default(0),
  tokensUsed: integer("tokens_used").default(0),
  costCents: integer("cost_cents").notNull().default(0),
  error: text("error"),
});

export const felixProposals = pgTable("felix_proposals", {
  id: serial("id").primaryKey(),
  loopRunId: integer("loop_run_id"),
  tenantId: integer("tenant_id").notNull(),
  kind: text("kind").notNull(),
  summary: text("summary").notNull(),
  rationale: text("rationale").notNull().default(""),
  target: text("target"),
  targetArgs: jsonb("target_args").default(sql`'{}'::jsonb`),
  estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
  status: text("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
  executedAt: timestamp("executed_at"),
  executionResult: text("execution_result"),
  // R74.13x: SWD-inspired verification rail. Felix declares the expected
  // post-state shape at draft time; executor verifies actual vs expected
  // (parameterized + table-whitelisted in server/felix-verify.ts).
  // Nullable for proposals whose kind has no verifier (e.g. review_project)
  // and for legacy rows drafted before this column existed.
  expectedPostState: jsonb("expected_post_state"),
  // R74.13z-quint Nugget 1: surprise scoring rail (LeWorldModel paper).
  // args_embedding stamped at INSERT (kind|target|args|summary), outcome
  // stamped post-execution; surprise_band is single signal: green/yellow/red/
  // no_history/error. See server/surprise-scorer.ts.
  argsEmbedding: vector("args_embedding", { dimensions: 1536 }),
  actualOutcomeEmbedding: vector("actual_outcome_embedding", { dimensions: 1536 }),
  surpriseScore: real("surprise_score"),
  surpriseBand: text("surprise_band"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  statusIdx: index("idx_felix_proposals_status").on(t.tenantId, t.status, t.createdAt.desc()),
  // R74.13z: split partial unique index pair (replaces COALESCE-based variant
  // that tripped a deploy-time introspector bug). Functionally equivalent.
  uniqActiveT: uniqueIndex("uniq_felix_proposals_active_t")
    .on(t.tenantId, t.kind, t.target)
    .where(sql`target IS NOT NULL AND status IN ('pending', 'approved')`),
  uniqActiveN: uniqueIndex("uniq_felix_proposals_active_n")
    .on(t.tenantId, t.kind)
    .where(sql`target IS NULL AND status IN ('pending', 'approved')`),
}));

// R74.13z-quint Nugget 2: per-(tenant,persona) knowledge-diversity samples.
// Background sweep in server/knowledge-diversity-monitor.ts writes one row per
// run; alert_emitted=true means a 'knowledge_health' notification went out.
export const knowledgeDiversitySnapshots = pgTable("knowledge_diversity_snapshots", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  sampleSize: integer("sample_size").notNull(),
  meanPairwiseCosine: real("mean_pairwise_cosine").notNull(),
  sigregPvalue: real("sigreg_pvalue").notNull(),
  sigregAxesFailed: integer("sigreg_axes_failed").notNull().default(0),
  alertEmitted: boolean("alert_emitted").notNull().default(false),
  snapshotAt: timestamp("snapshot_at").default(sql`now()`).notNull(),
}, (t) => ({
  tenantPersonaIdx: index("idx_kds_tenant_persona").on(t.tenantId, t.personaId, t.snapshotAt.desc()),
}));

// R74.13z-quint Nugget 3: audit trail for plan rollout simulations.
// Only written when caller passes persist=true to simulatePlanRollout.
export const planRolloutSimulations = pgTable("plan_rollout_simulations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  planSummary: text("plan_summary").notNull().default(""),
  stepsJson: jsonb("steps_json").notNull().default(sql`'[]'::jsonb`),
  predictedSuccess: real("predicted_success").notNull(),
  estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
  weakLinksJson: jsonb("weak_links_json").notNull().default(sql`'[]'::jsonb`),
  simulatedAt: timestamp("simulated_at").default(sql`now()`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_prs_tenant").on(t.tenantId, t.simulatedAt.desc()),
}));

export const projectNotes = pgTable("project_notes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  note: text("note").notNull(),
  author: text("author").default("system"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const projectFiles = pgTable("project_files", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path"),
  fileUrl: text("file_url"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  uploadedBy: text("uploaded_by").default("system"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const projectConversations = pgTable("project_conversations", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  conversationId: integer("conversation_id").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const docCollections = pgTable("doc_collections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  tenantId: integer("tenant_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const docChunks = pgTable("doc_chunks", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").notNull(),
  docPath: text("doc_path").notNull(),
  docTitle: text("doc_title").notNull(),
  chunkIndex: integer("chunk_index").notNull().default(0),
  content: text("content").notNull(),
  context: text("context").default(""),
  embedding: jsonb("embedding"),
  tokenCount: integer("token_count").default(0),
  tenantId: integer("tenant_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// R105 — Hierarchical document index (PageIndex nugget). At ingest time we
// extract the markdown heading structure (#/##/### ...) of long PDFs/docs as
// a navigable tree so a persona can *walk* the doc (TOC-style) instead of
// relying purely on chunk-vector retrieval. Pure structural parsing — zero
// LLM cost. Surfaced via the `knowledge_navigate` tool. Only populated for
// docs with >= TREE_MIN_HEADINGS (3) so short notes don't waste a row.
export const docHeadingTrees = pgTable("doc_heading_trees", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").notNull(),
  docPath: text("doc_path").notNull(),
  docTitle: text("doc_title").notNull(),
  // Nested tree: { title, level, lineStart, lineEnd, children: [...] }.
  // Stored as jsonb for cheap whole-tree fetch + future jsonb-path queries.
  tree: jsonb("tree").notNull(),
  totalHeadings: integer("total_headings").notNull().default(0),
  totalLines: integer("total_lines").notNull().default(0),
  tenantId: integer("tenant_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type DocHeadingTree = typeof docHeadingTrees.$inferSelect;

export const briefingReports = pgTable("briefing_reports", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  content: text("content").notNull(),
  generatedBy: text("generated_by").default("ai"),
  model: text("model"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const briefingWidgets = pgTable("briefing_widgets", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  widgetType: text("widget_type").notNull().default("custom"),
  label: text("label").notNull(),
  prompt: text("prompt").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  lastValue: text("last_value"),
  lastUpdatedAt: timestamp("last_updated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const usageTracking = pgTable("usage_tracking", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  metric: text("metric").notNull(),
  count: integer("count").notNull().default(0),
  period: text("period").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const emailVerificationCodes = pgTable("email_verification_codes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  email: text("email").notNull(),
  code: text("code").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).default(sql`(EXTRACT(EPOCH FROM NOW()) * 1000)`),
});

export const researchPrograms = pgTable("research_programs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  constraints: text("constraints").notNull().default(""),
  metrics: text("metrics").notNull().default(""),
  explorationStrategy: text("exploration_strategy").notNull().default("balanced"),
  model: text("model").default("deepseek/deepseek-v3.2"),
  maxExperimentsPerSession: integer("max_experiments_per_session").default(20),
  isActive: boolean("is_active").notNull().default(true),
  baselineMetricValue: real("baseline_metric_value"),
  baselineLabel: text("baseline_label"),
  evalType: text("eval_type").default("judge"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const researchSessions = pgTable("research_sessions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  programId: integer("program_id").notNull(),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  totalExperiments: integer("total_experiments").default(0),
  experimentsKept: integer("experiments_kept").default(0),
  experimentsDiscarded: integer("experiments_discarded").default(0),
  experimentsCrashed: integer("experiments_crashed").default(0),
  totalTokensUsed: integer("total_tokens_used").default(0),
  summary: text("summary"),
  model: text("model"),
});

export const researchExperiments = pgTable("research_experiments", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  tenantId: integer("tenant_id").notNull(),
  programId: integer("program_id").notNull(),
  hypothesis: text("hypothesis").notNull(),
  approach: text("approach").notNull().default(""),
  result: text("result"),
  metric: text("metric"),
  metricValue: text("metric_value"),
  numericMetricValue: real("numeric_metric_value"),
  metricDeltaPct: real("metric_delta_pct"),
  verificationStatus: text("verification_status").default("unverified"),
  verificationDetails: text("verification_details"),
  status: text("status").notNull().default("running"),
  parentExperimentId: integer("parent_experiment_id"),
  tokensUsed: integer("tokens_used").default(0),
  durationMs: integer("duration_ms"),
  model: text("model"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const researchSchedules = pgTable("research_schedules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  programId: integer("program_id"),
  name: text("name").notNull(),
  cronExpression: text("cron_expression").notNull().default("0 2 * * *"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  runAll: boolean("run_all").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const aiInsights = pgTable("ai_insights", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  engineType: text("engine_type").notNull(),
  category: text("category").notNull().default("general"),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  details: text("details"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("new"),
  dataSnapshot: text("data_snapshot"),
  actionTaken: text("action_taken"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  token: text("token").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  email: text("email").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).default(sql`(EXTRACT(EPOCH FROM NOW()) * 1000)`),
});

export const whatsappAuth = pgTable("whatsapp_auth", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const governanceActions = pgTable("governance_actions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  ruleId: integer("rule_id"),
  ruleName: text("rule_name"),
  category: text("category"),
  conditionMet: text("condition_met"),
  actionTaken: text("action_taken"),
  actionDetail: jsonb("action_detail"),
  escalated: boolean("escalated").default(false),
  escalationStatus: text("escalation_status"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const governanceRules = pgTable("governance_rules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  category: text("category").notNull(),
  ruleName: text("rule_name").notNull(),
  description: text("description").notNull(),
  condition: jsonb("condition").notNull(),
  action: text("action").notNull(),
  actionConfig: jsonb("action_config").notNull().default({}),
  escalateToHuman: boolean("escalate_to_human").notNull().default(false),
  escalationReason: text("escalation_reason"),
  priority: integer("priority").notNull().default(5),
  enabled: boolean("enabled").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  triggerCount: integer("trigger_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const governanceFrameworks = pgTable("governance_frameworks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  organization: text("organization").notNull(),
  version: text("version").notNull(),
  sourceUrl: text("source_url"),
  category: text("category").notNull(),
  description: text("description").notNull(),
  keyPrinciples: jsonb("key_principles").notNull().default([]),
  rulesInformed: jsonb("rules_informed").notNull().default([]),
  lastReviewed: timestamp("last_reviewed", { withTimezone: true }).defaultNow().notNull(),
  nextReviewDate: timestamp("next_review_date", { withTimezone: true }),
  reviewNotes: text("review_notes"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const actionOutcomes = pgTable("action_outcomes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").notNull(),
  actionType: text("action_type").notNull(),
  actionRef: text("action_ref"),
  actionDescription: text("action_description").notNull(),
  actionTimestamp: timestamp("action_timestamp").defaultNow().notNull(),
  expectedOutcome: text("expected_outcome"),
  expectedMetric: text("expected_metric"),
  expectedValue: real("expected_value"),
  actualOutcome: text("actual_outcome"),
  actualValue: real("actual_value"),
  outcomeStatus: text("outcome_status").default("pending"),
  measuredAt: timestamp("measured_at"),
  feedbackSummary: text("feedback_summary"),
  feedbackApplied: boolean("feedback_applied").default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const outcomePatterns = pgTable("outcome_patterns", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  actionType: text("action_type").notNull(),
  pattern: text("pattern").notNull(),
  evidence: jsonb("evidence"),
  confidenceScore: real("confidence_score"),
  recommendation: text("recommendation"),
  sampleSize: integer("sample_size"),
  discoveredAt: timestamp("discovered_at").defaultNow(),
  lastValidated: timestamp("last_validated"),
});

export const agentChannels = pgTable("agent_channels", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").default("topic"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const channelMessages = pgTable("channel_messages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  channelId: integer("channel_id").notNull(),
  fromPersonaId: integer("from_persona_id"),
  messageType: text("message_type").default("message"),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  threadId: integer("thread_id"),
  readBy: jsonb("read_by").default([]),
  eventRef: integer("event_ref"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const channelSubscriptions = pgTable("channel_subscriptions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  channelId: integer("channel_id").notNull(),
  personaId: integer("persona_id").notNull(),
  priority: text("priority").default("normal"),
  filter: jsonb("filter"),
  enabled: boolean("enabled").default(true),
});

export const agentDesks = pgTable("agent_desks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").notNull(),
  activeTasks: jsonb("active_tasks").default([]),
  blockedItems: jsonb("blocked_items").default([]),
  waitingFor: jsonb("waiting_for").default([]),
  queue: jsonb("queue").default([]),
  recentCompletions: jsonb("recent_completions").default([]),
  focusArea: text("focus_area"),
  statusNote: text("status_note"),
  lastActiveAt: timestamp("last_active_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const eventLog = pgTable("event_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  eventType: text("event_type").notNull(),
  source: text("source").notNull(),
  data: jsonb("data"),
  status: text("status").default("pending"),
  processingResult: jsonb("processing_result"),
  processedBy: integer("processed_by"),
  processedAt: timestamp("processed_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  salienceScore: numeric("salience_score"),
  salienceMeta: jsonb("salience_meta"),
});

export const eventSubscriptions = pgTable("event_subscriptions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  eventType: text("event_type").notNull(),
  personaId: integer("persona_id").notNull(),
  action: text("action").default("process"),
  priority: integer("priority").default(5),
  actionConfig: jsonb("action_config"),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  objective: text("objective").notNull(),
  source: text("source").notNull().default("owner.directive"),
  sourceRef: text("source_ref"),
  status: text("status").notNull().default("awaiting_approval"),
  planJson: jsonb("plan_json").notNull().default({}),
  plannerPersonaId: integer("planner_persona_id"),
  ceoDecision: text("ceo_decision"),
  ceoDecisionReason: text("ceo_decision_reason"),
  ceoDecidedAt: timestamp("ceo_decided_at"),
  ceoDecidedByPersonaId: integer("ceo_decided_by_persona_id"),
  executionLog: jsonb("execution_log").notNull().default([]),
  version: integer("version").notNull().default(1),
  parentPlanId: integer("parent_plan_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const capabilities = pgTable("capabilities", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description").notNull(),
  codePath: text("code_path"),
  codeSymbol: text("code_symbol"),
  metadata: jsonb("metadata").default({}),
  isActive: boolean("is_active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  // Mirrors the `capabilities_kind_name_key` UNIQUE CONSTRAINT and the
  // `idx_capabilities_kind` / `idx_capabilities_active` btree indexes
  // already present in production. Required so the ON CONFLICT (kind, name)
  // upsert in capability-registry.ts is provably valid.
  kindNameUnique: uniqueIndex("capabilities_kind_name_key").on(t.kind, t.name),
  kindIdx: index("idx_capabilities_kind").on(t.kind),
  activeIdx: index("idx_capabilities_active").on(t.isActive),
}));

export const autonomyRules = pgTable("autonomy_rules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  actionType: text("action_type").notNull(),
  autonomyLevel: text("autonomy_level").notNull().default("approve_before"),
  conditions: jsonb("conditions"),
  maxValue: real("max_value"),
  requiresConfidenceScore: real("requires_confidence_score"),
  escalateTo: text("escalate_to"),
  description: text("description"),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  tenantIdx: index("idx_autonomy_rules_tenant").on(t.tenantId),
  tpaUq: uniqueIndex("autonomy_rules_tpa_uq")
    .on(t.tenantId, t.personaId, t.actionType)
    .where(sql`persona_id IS NOT NULL`),
  taUq: uniqueIndex("autonomy_rules_ta_uq")
    .on(t.tenantId, t.actionType)
    .where(sql`persona_id IS NULL`),
}));

export const agentJobs = pgTable("agent_jobs", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull().default({}),
  tenantId: integer("tenant_id"),
  personaId: integer("persona_id"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
  parentJobId: integer("parent_job_id"),
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  failureClass: text("failure_class"),
  rollbackNote: text("rollback_note"),
}, (t) => ({
  claimIdx: index("agent_jobs_claim_idx").on(t.status, t.nextRunAt).where(sql`status = 'pending'`),
  leaseIdx: index("agent_jobs_lease_idx").on(t.status, t.leaseUntil).where(sql`status = 'running'`),
  kindStatusIdx: index("agent_jobs_kind_status_idx").on(t.kind, t.status, t.createdAt.desc()),
  tenantIdx: index("agent_jobs_tenant_idx").on(t.tenantId, t.createdAt.desc()),
  failureClassIdx: index("agent_jobs_failure_class_idx").on(t.failureClass, t.createdAt.desc()).where(sql`failure_class IS NOT NULL`),
}));
export const insertAgentJobSchema = createInsertSchema(agentJobs).omit({ id: true, createdAt: true, startedAt: true, completedAt: true });
export type InsertAgentJob = z.infer<typeof insertAgentJobSchema>;
export type AgentJob = typeof agentJobs.$inferSelect;

export const autonomyLog = pgTable("autonomy_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").notNull(),
  actionType: text("action_type").notNull(),
  decision: text("decision").notNull(),
  ruleId: integer("rule_id"),
  confidenceScore: real("confidence_score"),
  context: jsonb("context"),
  escalatedTo: text("escalated_to"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const watchlistItems = pgTable("watchlist_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  createdByPersonaId: integer("created_by_persona_id"),
  name: text("name").notNull(),
  category: text("category").notNull().default("competitor"),
  searchQueries: jsonb("search_queries").notNull().default([]),
  keywords: jsonb("keywords"),
  checkFrequency: text("check_frequency").default("daily"),
  lastCheckedAt: timestamp("last_checked_at"),
  lastResults: jsonb("last_results"),
  alertThreshold: text("alert_threshold").default("any_new"),
  escalateToPersonaId: integer("escalate_to_persona_id"),
  enabled: boolean("enabled").default(true),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const watchlistAlerts = pgTable("watchlist_alerts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  watchlistItemId: integer("watchlist_item_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  source: text("source"),
  severity: text("severity").default("info"),
  matchedKeywords: jsonb("matched_keywords"),
  acknowledged: boolean("acknowledged").default(false),
  acknowledgedByPersonaId: integer("acknowledged_by_persona_id"),
  processedByEvent: integer("processed_by_event"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const oauthSubscriptions = pgTable("oauth_subscriptions", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  tenantId: integer("tenant_id"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: bigint("expires_at", { mode: "number" }),
  accountId: text("account_id"),
  email: text("email"),
  scope: text("scope"),
  tokenType: text("token_type"),
  pkceState: text("pkce_state"),
  pkceVerifier: text("pkce_verifier"),
  connectedAt: timestamp("connected_at"),
  lastRefreshed: timestamp("last_refreshed"),
  isActive: boolean("is_active"),
  consecutiveFailures: integer("consecutive_failures"),
});

export const tenantProviderKeys = pgTable("tenant_provider_keys", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  provider: text("provider").notNull(),
  apiKey: text("api_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  label: text("label"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  lastVerifiedAt: timestamp("last_verified_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const mcpServers = pgTable("mcp_servers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  serverUrl: text("server_url").notNull(),
  authType: text("auth_type").default("none"),
  authToken: text("auth_token"),
  enabled: boolean("enabled").default(true),
  toolCount: integer("tool_count").default(0),
  lastConnected: timestamp("last_connected", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const modelRegistryUpdates = pgTable("model_registry_updates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  updateType: text("update_type").notNull(),
  modelId: text("model_id").notNull(),
  modelData: jsonb("model_data"),
  status: text("status").notNull().default("pending"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const scrapedPages = pgTable("scraped_pages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  url: text("url").notNull(),
  domain: text("domain").notNull(),
  title: text("title"),
  content: text("content").notNull(),
  contentLength: integer("content_length").notNull().default(0),
  crawlJobId: text("crawl_job_id"),
  tags: text("tags").array(),
  metadata: jsonb("metadata"),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
});

export const personalityFiles = pgTable("personality_files", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").notNull(),
  fileType: text("file_type").notNull(),
  content: text("content").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const trustScores = pgTable("trust_scores", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").notNull(),
  category: text("category").notNull(),
  score: integer("score").notNull().default(50),
  autonomyLevel: text("autonomy_level").notNull().default("approve_before"),
  lastChangeReason: text("last_change_reason"),
  lastChangeAmount: integer("last_change_amount").default(0),
  consecutiveDaysAbove: integer("consecutive_days_above").default(0),
  locked: boolean("locked").notNull().default(false),
  // R98.24 — MNEMA Nugget 2 (two-channel reputation). Bayesian Beta posteriors
  // on TWO independent channels: action (did you fire when you should have) and
  // restraint (did you correctly decline when you shouldn't have). Effective trust
  // is min(actionPrecision, restraintPrecision) so a persona can't game the score
  // by being either too eager OR too cautious. Default Beta(1,1) = uniform prior.
  actionAlpha: real("action_alpha").notNull().default(1.0),
  actionBeta: real("action_beta").notNull().default(1.0),
  restraintAlpha: real("restraint_alpha").notNull().default(1.0),
  restraintBeta: real("restraint_beta").notNull().default(1.0),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});
export type TrustScore = typeof trustScores.$inferSelect;

// R98.25 — MNEMA Nugget 5: decline events as first-class typed rows.
// Today refusals (intent-gate blocks, destructive-tool-policy blocks, persona
// "insufficient info" returns, restraint-budget timeouts) are logged as soft
// strings scattered across security_intent_checks, security_tool_blocks, and
// console.warn lines. Promote to a typed row with a small reason taxonomy so
// (a) Nugget 2's restraint-precision counter has a clean signal source, and
// (b) we get "why did Felix refuse" telemetry without grepping logs.
//
// Reason taxonomy (kept short; expand only when a new MAST failure mode lands):
//   insufficient_evidence       — persona declined because data didn't support a claim
//   policy_block                — destructive-tool-policy or intent-gate refused
//   cross_family_disagreement   — Nugget 3 jury concordance below threshold (κ<0.5)
//   restraint_budget            — agent timed out / spent its budget without acting
//   safety_guard                — crisis-layer regex/Llama Guard fired
//   approval_required           — tool policy demanded an approval row that wasn't there
export const declineEvents = pgTable("decline_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  conversationId: integer("conversation_id"),
  source: text("source").notNull(), // "intent_gate" | "tool_policy" | "moa" | "persona" | "safety_guard" | "scheduler"
  reason: text("reason").notNull(), // taxonomy above
  detail: text("detail"),           // free-form, capped at insert site to ~500 chars
  toolName: text("tool_name"),      // present when source=tool_policy
  flaggedCategories: text("flagged_categories").array(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type DeclineEvent = typeof declineEvents.$inferSelect;

// R100 — Transactional No-Regression (TNR). Captures pre-action state for
// every tool call marked `irreversible` in TOOL_POLICIES. Allows `undo_last_action`
// to restore within the TTL window. Tenant-scoped (every restore enforces
// tenant_id WHERE) — no cross-tenant undo.
export const actionSnapshots = pgTable("action_snapshots", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  actionId: text("action_id").notNull().unique(), // uuid v4 surfaced to caller
  toolName: text("tool_name").notNull(),
  snapshotKind: text("snapshot_kind").notNull(),  // "scheduled_message_cancel" | "custom_tool_delete" | "scraped_pages_delete"
  payload: jsonb("payload").notNull(),            // adapter-specific captured state
  argsRedacted: jsonb("args_redacted"),           // tool args at capture (with secrets redacted)
  personaId: integer("persona_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  undoneAt: timestamp("undone_at"),
});
export type ActionSnapshot = typeof actionSnapshots.$inferSelect;

// R101 — Causality graphs. Every chat turn opens a root span; every tool
// call, LLM call, delegate, and subagent dispatch opens a child span.
// trace_id ties them together; parent_span_id forms the tree. Lets us
// follow "Bob got a wrong answer at 3:47pm" backwards from response →
// LLM call → tool calls → originating user message in one query.
export const agentTraceSpans = pgTable("agent_trace_spans", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  traceId: text("trace_id").notNull(),         // uuid v4 — shared across spans of one user turn
  spanId: text("span_id").notNull().unique(),  // uuid v4 — this span's id
  parentSpanId: text("parent_span_id"),        // null for root spans
  kind: text("kind").notNull(),                // "chat" | "tool" | "llm" | "delegate" | "subagent"
  agentName: text("agent_name"),               // persona name when relevant
  toolName: text("tool_name"),                 // present when kind="tool"
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  status: text("status"),                      // "ok" | "error" | "declined"
  summary: text("summary"),                    // short human-readable description
  metadata: jsonb("metadata"),                 // arbitrary span-specific data
});
export type AgentTraceSpan = typeof agentTraceSpans.$inferSelect;

// Per-model harness adaptation (Self-Harness, arXiv:2606.09498). Validated,
// model-specific system-prompt addenda mined from a model's own failure traces
// by the nightly self-improvement loop and injected at runtime keyed on the
// active model id. Platform-owned (tenant = ADMIN). Only rows with
// status='active' are injected; 'shadow'/'rejected'/'retired' are kept for
// audit + supersession history.
export const modelHarnessDeltas = pgTable("model_harness_deltas", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  modelId: text("model_id").notNull(),          // normalized model id this addendum targets
  weakness: text("weakness").notNull(),          // short label of the mined failure pattern
  addendum: text("addendum").notNull(),          // the minimal system-prompt addition
  status: text("status").notNull().default("shadow"), // active | shadow | rejected | retired
  heldOutPrevention: real("held_out_prevention"),// validation: prevention rate on held-out failures
  baselineRate: real("baseline_rate"),           // control prevention rate (no addendum)
  juryVerdict: text("jury_verdict"),             // FIX | ACCEPT | REJECT | ESCALATE at decision time
  juryMajority: integer("jury_majority"),
  evidenceCount: integer("evidence_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
}, (t) => ({
  modelStatusIdx: index("idx_model_harness_deltas_model_status").on(t.modelId, t.status),
  tenantCreatedIdx: index("idx_model_harness_deltas_tenant_created").on(t.tenantId, t.createdAt),
}));
export type ModelHarnessDelta = typeof modelHarnessDeltas.$inferSelect;

export const proactiveActions = pgTable("proactive_actions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id").notNull(),
  triggerCondition: text("trigger_condition").notNull(),
  actionTaken: text("action_taken").notNull(),
  pabCost: integer("pab_cost").notNull().default(1),
  outcome: text("outcome").default("pending"),
  trustImpact: integer("trust_impact").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});
export type ProactiveAction = typeof proactiveActions.$inferSelect;

export const expressLaneUsage = pgTable("express_lane_usage", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  laneId: text("lane_id").notNull(),
  fromPersonaId: integer("from_persona_id").notNull(),
  toPersonaId: integer("to_persona_id").notNull(),
  workType: text("work_type").notNull(),
  success: boolean("success"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type ExpressLaneUsage = typeof expressLaneUsage.$inferSelect;

export const evaluatorSnapshots = pgTable("evaluator_snapshots", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  evaluatorName: text("evaluator_name").notNull(),
  metrics: jsonb("metrics").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export type EvaluatorSnapshot = typeof evaluatorSnapshots.$inferSelect;

export const sentimentEvents = pgTable("sentiment_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  conversationId: integer("conversation_id").notNull(),
  frustration: boolean("frustration").default(false),
  urgency: boolean("urgency").default(false),
  confusion: boolean("confusion").default(false),
  satisfaction: boolean("satisfaction").default(false),
  score: integer("score").default(0),
  triggers: text("triggers"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type SentimentEvent = typeof sentimentEvents.$inferSelect;

export const consolidationLog = pgTable("consolidation_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  reviewed: integer("reviewed").default(0),
  merged: integer("merged").default(0),
  archived: integer("archived").default(0),
  promoted: integer("promoted").default(0),
  created: integer("created").default(0),
  errors: integer("errors").default(0),
  summary: text("summary"),
  durationMs: integer("duration_ms").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});
export type ConsolidationLog = typeof consolidationLog.$inferSelect;

export const presenterSessions = pgTable("presenter_sessions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  presentationId: text("presentation_id").notNull(),
  title: text("title").notNull(),
  slides: jsonb("slides").notNull().default([]),
  embedUrl: text("embed_url").notNull(),
  presentUrl: text("present_url").notNull(),
  token: text("token").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
});
export type PresenterSession = typeof presenterSessions.$inferSelect;

export const inboxMessages = pgTable("inbox_messages", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  messageId: varchar("message_id", { length: 255 }).notNull().unique(),
  inboxId: varchar("inbox_id", { length: 255 }).notNull(),
  fromAddress: text("from_address").notNull().default(""),
  toAddress: text("to_address").notNull().default(""),
  subject: text("subject").notNull().default("(No Subject)"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  direction: varchar("direction", { length: 10 }).notNull().default("inbound"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  isRead: boolean("is_read").notNull().default(false),
  isStarred: boolean("is_starred").notNull().default(false),
  threadId: varchar("thread_id", { length: 255 }),
  quarantined: boolean("quarantined").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type InboxMessage = typeof inboxMessages.$inferSelect;

export const inboxSenderAllowlist = pgTable("inbox_sender_allowlist", {
  tenantId: integer("tenant_id").notNull(),
  address: text("address").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("approved"),
  addedBy: varchar("added_by", { length: 80 }),
  notes: text("notes"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
}, (t) => ({
  // R104: matches the live DB PK created via psql. Also documents the contract
  // for ON CONFLICT (tenant_id, address) upserts in server/inbox-quarantine.ts.
  pk: primaryKey({ columns: [t.tenantId, t.address] }),
}));
export type InboxSenderAllowlistRow = typeof inboxSenderAllowlist.$inferSelect;

export const commitments = pgTable("commitments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  persona: varchar("persona", { length: 80 }),
  description: text("description").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  heartbeatIntervalMs: bigint("heartbeat_interval_ms", { mode: "number" }).notNull().default(3600000),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  lastNote: text("last_note"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  evidence: jsonb("evidence").notNull().default([]),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  source: varchar("source", { length: 40 }).notNull().default("manual"),
  dedupeKey: text("dedupe_key"),
  confidence: real("confidence"),
  sensitivity: varchar("sensitivity", { length: 20 }).notNull().default("routine"),
});
export type Commitment = typeof commitments.$inferSelect;

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  type: varchar("type", { length: 50 }).notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull().default(""),
  category: varchar("category", { length: 50 }).notNull().default("system"),
  isRead: boolean("is_read").notNull().default(false),
  actionUrl: text("action_url"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Notification = typeof notifications.$inferSelect;
export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  actorType: varchar("actor_type", { length: 30 }).notNull().default("agent"),
  actorName: varchar("actor_name", { length: 100 }).notNull().default("System"),
  action: varchar("action", { length: 100 }).notNull(),
  resourceType: varchar("resource_type", { length: 50 }),
  resourceId: varchar("resource_id", { length: 100 }),
  description: text("description").notNull().default(""),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ActivityLogEntry = typeof activityLog.$inferSelect;
export const insertActivityLogSchema = createInsertSchema(activityLog).omit({ id: true, createdAt: true });
export type InsertActivityLogEntry = z.infer<typeof insertActivityLogSchema>;

export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  role: varchar("role", { length: 30 }).notNull().default("viewer"),
  status: varchar("status", { length: 30 }).notNull().default("invited"),
  invitedBy: integer("invited_by"),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
});
export type TeamMember = typeof teamMembers.$inferSelect;
export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({ id: true, invitedAt: true, joinedAt: true });
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 255 }).notNull(),
  keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
  scopes: text("scopes").array().notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isRevoked: boolean("is_revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ApiKey = typeof apiKeys.$inferSelect;
export const insertApiKeySchema = createInsertSchema(apiKeys).omit({ id: true, createdAt: true, lastUsedAt: true });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;

export const researchEvidence = pgTable("research_evidence", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  projectId: integer("project_id"),
  query: text("query").notNull(),
  claim: text("claim").notNull(),
  sourceUrl: text("source_url"),
  sourceTitle: text("source_title"),
  sourceDate: text("source_date"),
  theme: text("theme"),
  confidence: integer("confidence").notNull().default(70),
  supportingQuote: text("supporting_quote"),
  contradicts: text("contradicts"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const competitorRegistry = pgTable("competitor_registry", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  website: text("website").notNull(),
  pricingUrl: text("pricing_url"),
  productUrl: text("product_url"),
  changelogUrl: text("changelog_url"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const competitorSnapshots = pgTable("competitor_snapshots", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  competitorId: integer("competitor_id").notNull(),
  url: text("url").notNull(),
  contentHash: text("content_hash"),
  contentText: text("content_text"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const competitorChanges = pgTable("competitor_changes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  competitorId: integer("competitor_id").notNull(),
  snapshotId: integer("snapshot_id").notNull(),
  changeType: text("change_type").notNull(),
  summary: text("summary").notNull(),
  details: text("details"),
  significance: text("significance").notNull().default("medium"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leadScoringRules = pgTable("lead_scoring_rules", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  icpDescription: text("icp_description").notNull(),
  criteria: text("criteria").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leadEnrichments = pgTable("lead_enrichments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  leadName: text("lead_name").notNull(),
  leadEmail: text("lead_email"),
  companyName: text("company_name"),
  companyUrl: text("company_url"),
  companyDescription: text("company_description"),
  industry: text("industry"),
  companySize: text("company_size"),
  role: text("role"),
  enrichmentData: text("enrichment_data"),
  icpScore: integer("icp_score"),
  icpGrade: text("icp_grade"),
  qualificationStatus: text("qualification_status").notNull().default("unscored"),
  stage: text("stage").notNull().default("new"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const outreachSequences = pgTable("outreach_sequences", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const outreachSequenceSteps = pgTable("outreach_sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").notNull(),
  stepNumber: integer("step_number").notNull(),
  channel: text("channel").notNull().default("email"),
  subject: text("subject"),
  bodyTemplate: text("body_template").notNull(),
  waitDays: integer("wait_days").notNull().default(3),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const outreachEnrollments = pgTable("outreach_enrollments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  sequenceId: integer("sequence_id").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  companyName: text("company_name"),
  currentStep: integer("current_step").notNull().default(1),
  status: text("status").notNull().default("active"),
  lastSentAt: timestamp("last_sent_at"),
  nextSendAt: timestamp("next_send_at"),
  replyClassification: text("reply_classification"),
  replyContent: text("reply_content"),
  personalContext: text("personal_context"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Round 25: Schema-drift mirror (8 high-traffic live tables) ───
// These tables already exist in production. Definitions mirror live columns
// exactly so types/queries flow through Drizzle while raw SQL keeps working.

export const codeProposals = pgTable("code_proposals", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  targetFile: text("target_file").notNull(),
  codeDiff: text("code_diff").notNull(),
  rationale: text("rationale").notNull(),
  source: text("source").notNull().default("autoresearch"),
  sourceSessionId: integer("source_session_id"),
  validationResult: jsonb("validation_result"),
  status: text("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  verificationStatus: text("verification_status").default("unverified"),
  verificationDetails: text("verification_details"),
  verifiedAt: timestamp("verified_at"),
});
export const insertCodeProposalSchema = createInsertSchema(codeProposals).omit({ id: true, createdAt: true, reviewedAt: true, appliedAt: true, verifiedAt: true });
export type InsertCodeProposal = z.infer<typeof insertCodeProposalSchema>;
export type CodeProposal = typeof codeProposals.$inferSelect;

export const moaResponses = pgTable("moa_responses", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  question: text("question").notNull(),
  aggregatorModel: text("aggregator_model").notNull(),
  aggregatedAnswer: text("aggregated_answer").notNull(),
  proposerCount: integer("proposer_count").notNull(),
  proposerSuccessCount: integer("proposer_success_count").notNull(),
  proposerDetailsJson: text("proposer_details_json"),
  totalLatencyMs: integer("total_latency_ms").notNull(),
  invokedVia: text("invoked_via"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type MoaResponse = typeof moaResponses.$inferSelect;

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  companyName: varchar("company_name", { length: 255 }),
  contactName: varchar("contact_name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 50 }),
  zip: varchar("zip", { length: 20 }),
  country: varchar("country", { length: 50 }).default("US"),
  industry: varchar("industry", { length: 100 }),
  status: varchar("status", { length: 30 }).default("active"),
  notes: text("notes"),
  totalRevenue: numeric("total_revenue", { precision: 12, scale: 2 }).default("0"),
  dealStage: varchar("deal_stage", { length: 50 }).default("prospect"),
  dealValue: numeric("deal_value", { precision: 12, scale: 2 }),
  assignedTo: varchar("assigned_to", { length: 100 }),
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
export type Customer = typeof customers.$inferSelect;

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  customerId: integer("customer_id"),
  invoiceNumber: varchar("invoice_number", { length: 50 }),
  status: varchar("status", { length: 30 }).default("draft"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).default("0"),
  tax: numeric("tax", { precision: 12, scale: 2 }).default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
export type Invoice = typeof invoices.$inferSelect;

export const invoiceItems = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  description: text("description"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).default("1"),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).default("0"),
});
export type InvoiceItem = typeof invoiceItems.$inferSelect;

export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  category: varchar("category", { length: 100 }),
  description: text("description"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  vendor: varchar("vendor", { length: 255 }),
  expenseDate: timestamp("expense_date", { withTimezone: true }),
  receiptUrl: text("receipt_url"),
  isDeductible: boolean("is_deductible").default(true),
  taxCategory: varchar("tax_category", { length: 100 }),
  projectId: integer("project_id"),
  approvedBy: varchar("approved_by", { length: 100 }),
  status: varchar("status", { length: 30 }).default("recorded"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export type Expense = typeof expenses.$inferSelect;

export const crews = pgTable("crews", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description").notNull().default(""),
  process: varchar("process", { length: 50 }).notNull().default("sequential"),
  managerPersonaId: integer("manager_persona_id"),
  memoryEnabled: boolean("memory_enabled").notNull().default(false),
  cacheEnabled: boolean("cache_enabled").notNull().default(true),
  isVerbose: boolean("is_verbose").notNull().default(false),
  maxRpm: integer("max_rpm").default(60),
  config: jsonb("config").notNull().default({}),
  status: varchar("status", { length: 50 }).notNull().default("idle"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Crew = typeof crews.$inferSelect;

export const crewRuns = pgTable("crew_runs", {
  id: serial("id").primaryKey(),
  crewId: integer("crew_id").notNull(),
  tenantId: integer("tenant_id").notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  process: varchar("process", { length: 50 }).notNull().default("sequential"),
  inputs: jsonb("inputs").notNull().default({}),
  taskOutputs: jsonb("task_outputs").notNull().default([]),
  finalOutput: text("final_output"),
  tokenUsage: jsonb("token_usage").notNull().default({}),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type CrewRun = typeof crewRuns.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// R74.13z-quint+2 — DreamGraph nuggets (Tensions + ADRs)
// Tensions: structured records of "predicted ≠ actual" — surfaces conflicts
// between any persona's expectation and observed reality so the next persona
// can pick up where the previous one stopped instead of relearning the wall.
// ADRs: architecture decision records — context/decision/consequences with
// supersession chains so the platform stops repeating settled choices.
// Both are tenant-scoped, queryable by personas via tools, and rendered on
// the /graph-explorer page alongside personas/tools/proposals.
// ─────────────────────────────────────────────────────────────────────────────

export const tensions = pgTable("tensions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  title: text("title").notNull(),
  predictedState: jsonb("predicted_state").notNull().default({}),
  actualState: jsonb("actual_state").notNull().default({}),
  evidence: jsonb("evidence").notNull().default([]),
  ownerPersonaId: integer("owner_persona_id"),
  sourceKind: varchar("source_kind", { length: 50 }).notNull().default("manual"),
  sourceId: integer("source_id"),
  status: varchar("status", { length: 30 }).notNull().default("open"),
  resolution: text("resolution"),
  resolutionEvidence: jsonb("resolution_evidence").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => ({
  tenantIdx: index("idx_tensions_tenant").on(t.tenantId),
  statusIdx: index("idx_tensions_tenant_status").on(t.tenantId, t.status),
  sourceIdx: index("idx_tensions_source").on(t.sourceKind, t.sourceId),
}));
export type Tension = typeof tensions.$inferSelect;
export const insertTensionSchema = createInsertSchema(tensions).omit({
  id: true, createdAt: true, updatedAt: true, resolvedAt: true,
});
export type InsertTension = z.infer<typeof insertTensionSchema>;

export const architectureDecisions = pgTable("architecture_decisions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  title: text("title").notNull(),
  status: varchar("status", { length: 30 }).notNull().default("proposed"),
  context: text("context").notNull().default(""),
  decision: text("decision").notNull().default(""),
  consequences: text("consequences").notNull().default(""),
  supersedes: integer("supersedes"),
  supersededBy: integer("superseded_by"),
  supersedeReason: text("supersede_reason"),
  tags: text("tags").array().default(sql`ARRAY[]::text[]`),
  authorPersonaId: integer("author_persona_id"),
  evidence: jsonb("evidence").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => ({
  tenantIdx: index("idx_adrs_tenant").on(t.tenantId),
  statusIdx: index("idx_adrs_tenant_status").on(t.tenantId, t.status),
  supersedesIdx: index("idx_adrs_supersedes").on(t.supersedes),
}));
export type ArchitectureDecision = typeof architectureDecisions.$inferSelect;
export const insertArchitectureDecisionSchema = createInsertSchema(architectureDecisions).omit({
  id: true, createdAt: true, updatedAt: true, decidedAt: true,
});
export type InsertArchitectureDecision = z.infer<typeof insertArchitectureDecisionSchema>;

// ============================================================================
// R75 — GraphRAG Five (community summarization, PageRank importance, causal chains)
// ============================================================================

export const knowledgeCommunities = pgTable("knowledge_communities", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  label: text("label").notNull().default(""),
  summary: text("summary").notNull().default(""),
  keyEntities: text("key_entities").array().default(sql`ARRAY[]::text[]`),
  memberPaths: text("member_paths").array().default(sql`ARRAY[]::text[]`),
  memberTripleIds: integer("member_triple_ids").array().default(sql`ARRAY[]::integer[]`),
  size: integer("size").notNull().default(0),
  importanceAvg: real("importance_avg").notNull().default(0),
  source: text("source").notNull().default("louvain"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("idx_kc_tenant").on(t.tenantId),
  refreshedIdx: index("idx_kc_refreshed").on(t.tenantId, t.refreshedAt),
}));
export type KnowledgeCommunity = typeof knowledgeCommunities.$inferSelect;
export const insertKnowledgeCommunitySchema = createInsertSchema(knowledgeCommunities).omit({
  id: true, createdAt: true, refreshedAt: true,
});
export type InsertKnowledgeCommunity = z.infer<typeof insertKnowledgeCommunitySchema>;

export const causalChains = pgTable("causal_chains", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  causeSubject: text("cause_subject").notNull(),
  causePredicate: text("cause_predicate"),
  causeObject: text("cause_object").notNull().default(""),
  effectSubject: text("effect_subject").notNull(),
  effectPredicate: text("effect_predicate"),
  effectObject: text("effect_object").notNull().default(""),
  confidence: real("confidence").notNull().default(0.5),
  timeLagSeconds: integer("time_lag_seconds"),
  evidenceText: text("evidence_text").notNull().default(""),
  sourceKind: text("source_kind").notNull().default("llm-extracted"),
  chainHash: text("chain_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("idx_cc_tenant").on(t.tenantId),
  causeIdx: index("idx_cc_cause").on(t.tenantId, t.causeSubject),
  effectIdx: index("idx_cc_effect").on(t.tenantId, t.effectSubject),
  uniqHash: uniqueIndex("uq_causal_chains_tenant_hash").on(t.tenantId, t.chainHash),
}));
export type CausalChain = typeof causalChains.$inferSelect;
export const insertCausalChainSchema = createInsertSchema(causalChains).omit({
  id: true, createdAt: true,
});
export type InsertCausalChain = z.infer<typeof insertCausalChainSchema>;

// R76 — Trust-Tier Policy Engine + Deliverable Contract Verification

export const toolPolicies = pgTable("tool_policies", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  scopeKind: text("scope_kind").notNull(),
  scopeValue: text("scope_value").notNull(),
  action: text("action").notNull(),
  maxAmountCents: integer("max_amount_cents"),
  conditions: jsonb("conditions").notNull().default(sql`'{}'::jsonb`),
  reason: text("reason").notNull().default(""),
  createdBy: text("created_by").notNull().default("owner"),
  enabled: boolean("enabled").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("idx_tp_tenant").on(t.tenantId),
  scopeIdx: index("idx_tp_scope").on(t.tenantId, t.scopeKind, t.scopeValue),
  // R76 review fix (MEDIUM #6) — prevent duplicate policy rows for the same
  // (tenant, scope, action) tuple so admins can't accidentally insert a
  // shadow policy that silently changes evaluation order.
  uniqScopeAction: uniqueIndex("uq_tp_tenant_scope_action").on(
    t.tenantId, t.scopeKind, t.scopeValue, t.action,
  ),
}));
export type ToolPolicy = typeof toolPolicies.$inferSelect;
export const insertToolPolicySchema = createInsertSchema(toolPolicies).omit({
  id: true, createdAt: true,
});
export type InsertToolPolicy = z.infer<typeof insertToolPolicySchema>;

export const policyAudit = pgTable("policy_audit", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  toolName: text("tool_name").notNull(),
  action: text("action"),
  decision: text("decision").notNull(),
  matchedPolicyId: integer("matched_policy_id").references(() => toolPolicies.id, { onDelete: "set null" }),
  reason: text("reason").notNull().default(""),
  paramsSummary: jsonb("params_summary").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("idx_pa_tenant").on(t.tenantId, t.createdAt),
  toolIdx: index("idx_pa_tool").on(t.toolName),
}));
export type PolicyAudit = typeof policyAudit.$inferSelect;

export const deliverableContracts = pgTable("deliverable_contracts", {
  id: serial("id").primaryKey(),
  deliverableType: text("deliverable_type").notNull(),
  requiredExtensions: text("required_extensions").array().default(sql`ARRAY[]::text[]`),
  requiredMimePattern: text("required_mime_pattern"),
  minSizeBytes: integer("min_size_bytes"),
  maxSizeBytes: integer("max_size_bytes"),
  schemaJsonschema: jsonb("schema_jsonschema"),
  renderCheck: text("render_check").notNull().default("none"),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqType: uniqueIndex("uq_dc_type").on(t.deliverableType),
}));
export type DeliverableContract = typeof deliverableContracts.$inferSelect;
export const insertDeliverableContractSchema = createInsertSchema(deliverableContracts).omit({
  id: true, createdAt: true,
});
export type InsertDeliverableContract = z.infer<typeof insertDeliverableContractSchema>;

export const deliveryVerifications = pgTable("delivery_verifications", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  conversationId: integer("conversation_id"),
  deliverableType: text("deliverable_type").notNull(),
  filePath: text("file_path"),
  fileUrl: text("file_url"),
  contractId: integer("contract_id").references(() => deliverableContracts.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  failures: jsonb("failures").notNull().default(sql`'[]'::jsonb`),
  detectedExtension: text("detected_extension"),
  detectedMime: text("detected_mime"),
  detectedSize: integer("detected_size"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("idx_dv_tenant").on(t.tenantId, t.verifiedAt),
  statusIdx: index("idx_dv_status").on(t.status),
}));
export type DeliveryVerification = typeof deliveryVerifications.$inferSelect;

// R79 — MarTech Bundle (ported from charlie947/social-media-skills, MIT)
// Per-tenant brand-voice profile read by every content tool (hooks, post format,
// content matrix, post scoring) so personas like Cassandra/Dexter/Atlas/Ad-Creative
// produce content that sounds consistent across channels.
export const tenantVoiceProfiles = pgTable("tenant_voice_profiles", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  profileName: text("profile_name").notNull().default("default"),
  aboutMe: text("about_me").notNull().default(""),
  voice: text("voice").notNull().default(""),
  pillars: text("pillars").array().notNull().default(sql`ARRAY[]::text[]`),
  audience: text("audience").notNull().default(""),
  samples: text("samples").array().notNull().default(sql`ARRAY[]::text[]`),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("idx_tvp_tenant").on(t.tenantId),
  uniqProfile: uniqueIndex("uq_tvp_tenant_profile").on(t.tenantId, t.profileName),
}));
export type TenantVoiceProfile = typeof tenantVoiceProfiles.$inferSelect;
export const insertTenantVoiceProfileSchema = createInsertSchema(tenantVoiceProfiles).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertTenantVoiceProfile = z.infer<typeof insertTenantVoiceProfileSchema>;

// =============================================================================
// R79.2 — Schema-drift burn-down (eliminates the recurring CI red X on the
// "Security & Tenant-Isolation Tests" job).
//
// Four live-DB objects existed in production but were never declared here,
// so a fresh CI Postgres lacked them and 15 tenant-checkout / anonymous-
// checkout tests crashed with relation-does-not-exist.
//
//   1. messages.citations  →  declared inline on the messages table above.
//   2. capability_gaps     →  declared as a normal pgTable below.
//   3. stripe.accounts/prices/products/payment_intents
//      →  these are EXTERNALLY MANAGED by a Stripe Sync mirror process
//         that uses Postgres-native GENERATED ALWAYS AS STORED columns,
//         FK constraints, BEFORE-UPDATE triggers, and a custom
//         set_updated_at() function — NONE of which Drizzle ORM can
//         faithfully express without risking a destructive ALTER on prod
//         (Drizzle can't represent stored-generated columns and would
//         silently drop the generation expression on next db:push).
//
//      So the four stripe.* tables are bootstrapped via a literal SQL
//      fixture at tests/fixtures/stripe-schema-bootstrap.sql, run by CI
//      after `db:push --force` and before the security-tests step.
//      DO NOT redeclare them here — that would re-introduce the prod risk
//      this round was created to eliminate.
// =============================================================================

export const capabilityGaps = pgTable("capability_gaps", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  personaId: integer("persona_id"),
  gapDescription: text("gap_description").notNull(),
  triggerContext: text("trigger_context"),
  source: text("source").notNull().default("auto"),
  status: text("status").notNull().default("detected"),
  researchResults: jsonb("research_results").default(sql`'[]'::jsonb`),
  resolution: text("resolution"),
  resolvedTool: text("resolved_tool"),
  resolvedSkill: text("resolved_skill"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  priority: text("priority").notNull().default("medium"),
  // Tool Forge Phase 1 (docs/tool-forge-spec.md) — demand-signal strength.
  // Incremented by detectGap() on every repeat miss of the same gap; the
  // ecosystem-health "Unmet Capabilities" card ranks gaps by missCount.
  missCount: integer("miss_count").notNull().default(1),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
}, (t) => ({
  statusIdx: index("idx_capability_gaps_status").on(t.status),
  tenantIdx: index("idx_capability_gaps_tenant").on(t.tenantId),
}));

export type CapabilityGap = typeof capabilityGaps.$inferSelect;

// R83 — Learned model context-length cache.
// Populated when a provider error reveals the actual context limit (via
// parseContextLimitFromError). Survives restarts so we don't re-probe.
export const modelContextLengths = pgTable("model_context_lengths", {
  id: serial("id").primaryKey(),
  modelId: text("model_id").notNull(),
  baseUrl: text("base_url").notNull().default(""),
  contextLength: integer("context_length").notNull(),
  source: text("source").notNull().default("learned"), // "learned" | "manual" | "registry"
  learnedAt: timestamp("learned_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  modelBaseIdx: index("idx_model_context_lengths_model_base").on(t.modelId, t.baseUrl),
}));

export type ModelContextLength = typeof modelContextLengths.$inferSelect;

// R99 — Felix Visual Continuity (ViMax nuggets #1 + #2)
// character_portrait_registry: tenant-scoped library of canonical character/asset
// portraits, generated once and reused across video jobs. Identifier+view is the
// natural key (UPSERT on collision). Examples: ('bob','front'), ('bob','side'),
// ('bob','three_quarter'), ('gym_background','env').
export const characterPortraitRegistry = pgTable("character_portrait_registry", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  identifier: text("identifier").notNull(),
  view: text("view").notNull(),
  imagePath: text("image_path").notNull(),
  description: text("description").default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  // R99 architect MEDIUM fix: app-level read-then-write UPSERT was racy under
  // concurrent init_character_portraits calls (same tenant, same character).
  // The DB-level unique index makes the natural key authoritative so the
  // ON CONFLICT path in registerPortrait() is atomic. Live in dev DB via
  // CREATE UNIQUE INDEX IF NOT EXISTS character_portrait_registry_tenant_id_view_uq.
  tenantIdentifierViewUq: uniqueIndex("character_portrait_registry_tenant_id_view_uq").on(t.tenantId, t.identifier, t.view),
  tenantIdx: index("idx_cpr_tenant").on(t.tenantId),
}));
export type CharacterPortrait = typeof characterPortraitRegistry.$inferSelect;

// video_job_frame_pool: per-job chronological log of every generated scene image
// (winner only — losing best-of-N candidates are NOT logged). Read recency-weighted
// by reference-selector when picking which prior frames to feed back into the
// next scene's prompt for visual continuity.
export const videoJobFramePool = pgTable("video_job_frame_pool", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  jobId: text("job_id").notNull(),
  frameIdx: integer("frame_idx").notNull(),
  imagePath: text("image_path").notNull(),
  description: text("description").default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantJobFrameIdx: index("idx_vjfp_tenant_job_frame").on(t.tenantId, t.jobId, t.frameIdx),
  tenantJobIdx: index("idx_vjfp_tenant_job").on(t.tenantId, t.jobId),
}));
export type VideoJobFrame = typeof videoJobFramePool.$inferSelect;

// R111 — Persistent video-jobs index. The chapter MP4s + state.json on disk
// (data/video-jobs/<jobId>/) remain the source of truth for binaries; this
// table is the queryable mirror that survives process restarts and powers
// /jobs dashboard + heartbeat banner. Every writeStateAtomic() also upserts
// here. On boot, rows in ('queued','rendering','concating') with stale
// updatedAt are marked 'failed' with errorMessage='process restart'.
export const videoJobs = pgTable("video_jobs", {
  jobId: varchar("job_id", { length: 100 }).primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("queued"),
  totalChapters: integer("total_chapters").notNull(),
  chapters: jsonb("chapters").notNull().default([]),
  spec: jsonb("spec").notNull().default({}),
  finalFilePath: text("final_file_path"),
  finalDriveUrl: text("final_drive_url"),
  finalWatchUrl: text("final_watch_url"),
  finalDurationSec: real("final_duration_sec"),
  finalSizeBytes: bigint("final_size_bytes", { mode: "number" }),
  errorMessage: text("error_message"),
  // Free-text phase line for builds that have stages without per-chapter detail
  // (e.g. the BWB weekly recap: discover → transcribe → write → bake → render).
  // Nullable; only the BWB weekly-recap progress writer sets it. Added via psql
  // ALTER TABLE prior to this decl (additive, shared dev+prod DB).
  phase: text("phase"),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  concatAttempts: integer("concat_attempts").notNull().default(0),
  // R111 architect fix — instance marker. Set to RUNNER_INSTANCE_ID on every
  // mirror write. Boot recovery fails any active row whose instance_id !=
  // current process's instance_id, deterministically catching ALL orphans
  // from a previous process regardless of how recently they were updated.
  instanceId: text("instance_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => ({
  tenantStatusIdx: index("idx_video_jobs_tenant_status").on(t.tenantId, t.status, t.updatedAt),
  tenantCreatedIdx: index("idx_video_jobs_tenant_created").on(t.tenantId, t.createdAt),
}));
export const insertVideoJobSchema = createInsertSchema(videoJobs).omit({ createdAt: true, updatedAt: true, completedAt: true });
export type VideoJob = typeof videoJobs.$inferSelect;
export type InsertVideoJob = typeof videoJobs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// R106 — LuaN1aoAgent nuggets (Apache-2.0). Four new tables, all tenant-scoped
// .notNull() with NO default (per Bob's hard rule). Created via psql ALTER
// TABLE prior to this decl; this Drizzle decl is for IDE/typecheck parity.
// ─────────────────────────────────────────────────────────────────────────────

// N1: L0–L5 failure attribution audit trail.
export const failureAttributions = pgTable("failure_attributions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  scope: text("scope").notNull(),
  scopeRef: text("scope_ref").notNull(),
  level: text("level").notNull(),
  detail: text("detail").notNull().default(""),
  context: jsonb("context").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantScopeIdx: index("idx_fa_tenant_scope").on(t.tenantId, t.scope, t.scopeRef, t.id),
}));
export type FailureAttribution = typeof failureAttributions.$inferSelect;

// N2: Shared findings bulletin board for parallel chunk-and-parallel jobs.
export const parallelJobFindings = pgTable("parallel_job_findings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  jobId: text("job_id").notNull(),
  subtaskId: text("subtask_id").notNull(),
  finding: jsonb("finding").notNull(),
  confidence: real("confidence").notNull().default(0.7),
  // R125+15 — Blackboard slot semantics (TigrimOSR-inspired). When slotKey is
  // set, this row is a KEYED shared-state slot (latest-wins reads) rather than
  // an append-only discovery. When claim=true, the row is an atomic claim of
  // that slot for division-of-labor (one winner per tenant+job+slotKey).
  slotKey: text("slot_key"),
  claim: boolean("claim").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantJobIdx: index("idx_pjf_tenant_job").on(t.tenantId, t.jobId, t.id),
  // At most one CLAIM per (tenant, job, slot) — makes blackboard_claim atomic.
  claimIdx: uniqueIndex("idx_pjf_claim").on(t.tenantId, t.jobId, t.slotKey).where(sql`claim = true`),
}));
export type ParallelJobFinding = typeof parallelJobFindings.$inferSelect;

// N4: Pinned hypotheses (must survive chat-engine compression).
export const pinnedHypotheses = pgTable("pinned_hypotheses", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  conversationId: integer("conversation_id"),
  personaId: integer("persona_id"),
  hypothesis: text("hypothesis").notNull(),
  confidence: real("confidence").notNull().default(0.7),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
}, (t) => ({
  tenantConvIdx: index("idx_ph_tenant_conv").on(t.tenantId, t.conversationId, t.status),
}));
export type PinnedHypothesis = typeof pinnedHypotheses.$inferSelect;

// N5: Plan-on-Graph DAG nodes for orchestration.
// R108 A — `maxSteps` per-node budget cherry-picked from LuaN1aoAgent's
// adaptive `max_steps` allocation: easy nodes use the orchestrator default,
// hard nodes (multi-stage retry, blind exploration) get an explicit larger
// budget set on the node itself. Nullable = "use orchestrator default".
export const planNodes = pgTable("plan_nodes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  planId: text("plan_id").notNull(),
  nodeId: text("node_id").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull().default("pending"),
  dependsOn: jsonb("depends_on").notNull().default([]),
  metadata: jsonb("metadata").notNull().default({}),
  maxSteps: integer("max_steps"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  tenantPlanIdx: index("idx_pn_tenant_plan").on(t.tenantId, t.planId),
  uniqueNode: uniqueIndex("plan_nodes_tenant_id_plan_id_node_id_key").on(t.tenantId, t.planId, t.nodeId),
}));
export type PlanNode = typeof planNodes.$inferSelect;

// R108 B — Causal-graph evidence edges per pinned hypothesis. Each row is a
// directed edge from a piece of evidence (memory entry id, finding id, tool
// result snippet, free text) to a hypothesis with a per-edge confidence
// score. Forces personas to ground load-bearing claims in retrievable
// evidence rather than asserting them. LuaN1aoAgent (Apache-2.0) Causal
// Graph Reasoning second-pass cherry-pick. Tenant-scoped, no FK.
export const hypothesisEvidenceEdges = pgTable("hypothesis_evidence_edges", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  hypothesisId: integer("hypothesis_id").notNull(),
  evidenceKind: text("evidence_kind").notNull(),  // 'memory_entry' | 'finding' | 'tool_result' | 'free_text'
  evidenceRef: text("evidence_ref").notNull(),     // memory id / finding id / sanitized snippet
  confidence: real("confidence").notNull().default(0.6),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tenantHypoIdx: index("idx_hee_tenant_hypothesis").on(t.tenantId, t.hypothesisId),
}));
export type HypothesisEvidenceEdge = typeof hypothesisEvidenceEdges.$inferSelect;

// R107 — Geometry of Consolidation (Vangara & Gopinath, NeurIPS 2026 sub.).
// Per-scan record of cluster geometry — used by `memory_geometry_scan` tool
// and by the regime-aware consolidation gate in dream-consolidation +
// memory-intelligence to surface clusters at risk of identity collapse.
export const memoryGeometryAudits = pgTable("memory_geometry_audits", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  scope: text("scope").notNull(),                 // 'all' | 'persona' | 'wing' | 'category' | 'pair-gate' | 'dream-gate'
  scopeValue: text("scope_value"),
  n: integer("n").notNull(),
  dBar: real("d_bar").notNull(),
  dEff: real("d_eff").notNull(),
  thetaPrime: real("theta_prime").notNull(),
  regime: text("regime").notNull(),               // 'tight' | 'spread' | 'degenerate'
  spreadPairs: integer("spread_pairs").notNull().default(0),
  totalPairs: integer("total_pairs").notNull().default(0),
  notes: text("notes"),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("idx_memory_geometry_audits_tenant").on(t.tenantId, t.computedAt),
  regimeIdx: index("idx_memory_geometry_audits_regime").on(t.tenantId, t.regime, t.computedAt),
}));
export type MemoryGeometryAudit = typeof memoryGeometryAudits.$inferSelect;

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

// ─────────────────────────────────────────────────────────────────────────────
// Venture Discovery Loop (2026-06-17) — a named, owner-only, dry-run-default,
// hard-capped, HITL-gated 9-stage business-discovery loop. Parent run table is
// the state machine; the 9 child tables hold per-stage outputs. All tenant-
// isolated (tenant_id NOT NULL + index); every child also indexes run_id.
// ─────────────────────────────────────────────────────────────────────────────
export const ventureDiscoveryRuns = pgTable("venture_discovery_runs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  objective: text("objective").notNull(),
  status: text("status").notNull().default("awaiting_approval"), // awaiting_approval | running | completed | killed | failed | budget_exceeded
  currentStage: text("current_stage").notNull().default("discovery"),
  dryRun: boolean("dry_run").notNull().default(true),
  completedStages: jsonb("completed_stages").notNull().default(sql`'[]'::jsonb`),
  createdBy: text("created_by"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_venture_runs_tenant").on(t.tenantId),
}));
export const insertVentureDiscoveryRunSchema = createInsertSchema(ventureDiscoveryRuns).omit({ id: true, createdAt: true, updatedAt: true });
export type VentureDiscoveryRun = typeof ventureDiscoveryRuns.$inferSelect;
export type InsertVentureDiscoveryRun = z.infer<typeof insertVentureDiscoveryRunSchema>;

export const ventureIdeas = pgTable("venture_ideas", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  runId: integer("run_id").notNull().references(() => ventureDiscoveryRuns.id),
  idx: integer("idx").notNull().default(0),
  title: text("title").notNull(),
  targetCustomer: text("target_customer"),
  problem: text("problem"),
  solution: text("solution"),
  revenueModel: text("revenue_model"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_venture_ideas_tenant").on(t.tenantId),
  runIdx: index("idx_venture_ideas_run").on(t.runId),
}));
export const insertVentureIdeaSchema = createInsertSchema(ventureIdeas).omit({ id: true, createdAt: true });
export type VentureIdea = typeof ventureIdeas.$inferSelect;
export type InsertVentureIdea = z.infer<typeof insertVentureIdeaSchema>;

export const ventureScores = pgTable("venture_scores", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  runId: integer("run_id").notNull().references(() => ventureDiscoveryRuns.id),
  ideaId: integer("idea_id").notNull().references(() => ventureIdeas.id),
  scores: jsonb("scores").notNull().default(sql`'{}'::jsonb`), // {painSeverity, willingnessToPay, marketSize, easeOfMvp, competition, speedToRevenue, grossMargin, founderFit, risk}
  total: real("total").notNull().default(0),
  rank: integer("rank"),
  recommendation: text("recommendation"), // build | test | revise | kill
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_venture_scores_tenant").on(t.tenantId),
  runIdx: index("idx_venture_scores_run").on(t.runId),
}));
export const insertVentureScoreSchema = createInsertSchema(ventureScores).omit({ id: true, createdAt: true });
export type VentureScore = typeof ventureScores.$inferSelect;
export type InsertVentureScore = z.infer<typeof insertVentureScoreSchema>;

export const syntheticCustomers = pgTable("synthetic_customers", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  runId: integer("run_id").notNull().references(() => ventureDiscoveryRuns.id),
  ideaId: integer("idea_id").notNull().references(() => ventureIdeas.id),
  name: text("name").notNull(),
  role: text("role"),
  industry: text("industry"),
  businessSize: text("business_size"),
  profile: jsonb("profile").notNull().default(sql`'{}'::jsonb`), // {painPoints, currentWorkaround, buyingTrigger, objections, budgetRange, decisionCriteria}
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_synthetic_customers_tenant").on(t.tenantId),
  runIdx: index("idx_synthetic_customers_run").on(t.runId),
}));
export const insertSyntheticCustomerSchema = createInsertSchema(syntheticCustomers).omit({ id: true, createdAt: true });
export type SyntheticCustomer = typeof syntheticCustomers.$inferSelect;
export type InsertSyntheticCustomer = z.infer<typeof insertSyntheticCustomerSchema>;

export const validationRuns = pgTable("validation_runs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  runId: integer("run_id").notNull().references(() => ventureDiscoveryRuns.id),
  ideaId: integer("idea_id").notNull().references(() => ventureIdeas.id),
  icpProfile: text("icp_profile"),
  offerStatement: text("offer_statement"),
  landingHeadline: text("landing_headline"),
  coldOutreach: text("cold_outreach"),
  surveyQuestions: jsonb("survey_questions").notNull().default(sql`'[]'::jsonb`),
  discoveryCallScript: text("discovery_call_script"),
  recommendedChannel: text("recommended_channel"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_validation_runs_tenant").on(t.tenantId),
  runIdx: index("idx_validation_runs_run").on(t.runId),
}));
export const insertValidationRunSchema = createInsertSchema(validationRuns).omit({ id: true, createdAt: true });
export type ValidationRun = typeof validationRuns.$inferSelect;
export type InsertValidationRun = z.infer<typeof insertValidationRunSchema>;

export const mvpBriefs = pgTable("mvp_briefs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  runId: integer("run_id").notNull().references(() => ventureDiscoveryRuns.id),
  ideaId: integer("idea_id").notNull().references(() => ventureIdeas.id),
  scope: text("scope"),
  integrations: jsonb("integrations").notNull().default(sql`'[]'::jsonb`),
  components: jsonb("components").notNull().default(sql`'[]'::jsonb`),
  difficulty: text("difficulty"),
  fastestPath: text("fastest_path"),
  risks: jsonb("risks").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_mvp_briefs_tenant").on(t.tenantId),
  runIdx: index("idx_mvp_briefs_run").on(t.runId),
}));
export const insertMvpBriefSchema = createInsertSchema(mvpBriefs).omit({ id: true, createdAt: true });
export type MvpBrief = typeof mvpBriefs.$inferSelect;
export type InsertMvpBrief = z.infer<typeof insertMvpBriefSchema>;

export const financialModels = pgTable("financial_models", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  runId: integer("run_id").notNull().references(() => ventureDiscoveryRuns.id),
  ideaId: integer("idea_id").notNull().references(() => ventureIdeas.id),
  pricingOptions: jsonb("pricing_options").notNull().default(sql`'[]'::jsonb`),
  startupCostUsd: real("startup_cost_usd"),
  monthlyOpexUsd: real("monthly_opex_usd"),
  revenueScenarios: jsonb("revenue_scenarios").notNull().default(sql`'[]'::jsonb`),
  breakEvenNote: text("break_even_note"),
  cashPlan90d: text("cash_plan_90d"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_financial_models_tenant").on(t.tenantId),
  runIdx: index("idx_financial_models_run").on(t.runId),
}));
export const insertFinancialModelSchema = createInsertSchema(financialModels).omit({ id: true, createdAt: true });
export type FinancialModel = typeof financialModels.$inferSelect;
export type InsertFinancialModel = z.infer<typeof insertFinancialModelSchema>;

export const legalRiskReviews = pgTable("legal_risk_reviews", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  runId: integer("run_id").notNull().references(() => ventureDiscoveryRuns.id),
  ideaId: integer("idea_id").notNull().references(() => ventureIdeas.id),
  complianceRisk: text("compliance_risk"),
  privacyRisk: text("privacy_risk"),
  ipRisk: text("ip_risk"),
  disclaimers: jsonb("disclaimers").notNull().default(sql`'[]'::jsonb`),
  regulatedConcerns: text("regulated_concerns"),
  goNoGo: text("go_no_go"), // go | no_go | conditional
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_legal_risk_reviews_tenant").on(t.tenantId),
  runIdx: index("idx_legal_risk_reviews_run").on(t.runId),
}));
export const insertLegalRiskReviewSchema = createInsertSchema(legalRiskReviews).omit({ id: true, createdAt: true });
export type LegalRiskReview = typeof legalRiskReviews.$inferSelect;
export type InsertLegalRiskReview = z.infer<typeof insertLegalRiskReviewSchema>;

export const ventureDecisions = pgTable("venture_decisions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  runId: integer("run_id").notNull().references(() => ventureDiscoveryRuns.id),
  ideaId: integer("idea_id").references(() => ventureIdeas.id),
  decision: text("decision"), // build | test | revise | kill
  executiveSummary: text("executive_summary"),
  actionPlan7d: jsonb("action_plan_7d").notNull().default(sql`'[]'::jsonb`),
  assignedAgents: jsonb("assigned_agents").notNull().default(sql`'[]'::jsonb`),
  requiredDeliverables: jsonb("required_deliverables").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_venture_decisions_tenant").on(t.tenantId),
  runIdx: index("idx_venture_decisions_run").on(t.runId),
}));
export const insertVentureDecisionSchema = createInsertSchema(ventureDecisions).omit({ id: true, createdAt: true });
export type VentureDecision = typeof ventureDecisions.$inferSelect;
export type InsertVentureDecision = z.infer<typeof insertVentureDecisionSchema>;

export const ventureArtifacts = pgTable("venture_artifacts", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  runId: integer("run_id").notNull().references(() => ventureDiscoveryRuns.id),
  ideaId: integer("idea_id").references(() => ventureIdeas.id),
  kind: text("kind").notNull(), // json | markdown | pdf | xlsx | deck
  title: text("title"),
  content: text("content"),
  filePath: text("file_path"),
  deliveryUrl: text("delivery_url"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_venture_artifacts_tenant").on(t.tenantId),
  runIdx: index("idx_venture_artifacts_run").on(t.runId),
}));
export const insertVentureArtifactSchema = createInsertSchema(ventureArtifacts).omit({ id: true, createdAt: true });
export type VentureArtifact = typeof ventureArtifacts.$inferSelect;
export type InsertVentureArtifact = z.infer<typeof insertVentureArtifactSchema>;

// ============================================================
// SIMULATION SANDBOX — extracted to shared/models/sandbox.ts (girth guard).
// Re-exported here so every consumer keeps importing from @shared/schema.
// ============================================================
export * from "./models/sandbox";
