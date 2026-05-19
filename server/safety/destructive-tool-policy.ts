/**
 * DESTRUCTIVE TOOL POLICY — structural defense against tool-call jailbreaks.
 *
 * Companion to intent-gate.ts. Where intent-gate stops poetic prompts BEFORE
 * the LLM thinks, this layer stops dangerous tool calls AFTER the LLM has
 * decided to invoke them — a second line of defense at the action boundary.
 *
 * Per AHB (Galisai et al., 2026): a stylistically-obfuscated jailbreak can
 * make a model emit harmful PROSE. Layered with hierarchical reasoning, it
 * can also make the model emit harmful TOOL CALLS. We mitigate the second
 * case structurally — destructive tools require args that match a strict
 * schema and (where applicable) an explicit human-approved allowlist value.
 * Free-text arguments to destructive tools are rejected, full stop.
 *
 * This module is the policy registry + enforcement function. It is wired
 * into guarded-tool-executor.ts:executeGuardedTool as a pre-execution gate.
 */
import { pool } from "../db";
import { logSilentCatch } from "../lib/silent-catch";

export type ToolRiskLevel = "safe" | "sensitive" | "destructive";

/**
 * R98.17 — Cairo cross-pollination: 4-tier risk class.
 *
 * The existing `risk` field ("safe"/"sensitive"/"destructive") is the
 * structural enforcement layer (does the tool need structured args, approval,
 * trusted-persona gate, etc.). The new `riskClass` is the human-facing
 * severity label surfaced in HITL approval prompts and owner-notification
 * emails so Bob sees "HIGH-risk action: send_email to 47 recipients" instead
 * of just "approve?". Inspired by Cairo's OPA-style LOW/MEDIUM/HIGH/CRITICAL
 * action classification.
 */
export type ToolRiskClass = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ToolPolicy {
  name: string;
  risk: ToolRiskLevel;
  /** Human-facing severity label for HITL prompts + owner alerts. */
  riskClass?: ToolRiskClass;
  /** When true, args MUST be a structured object (not a single free-text string). */
  requiresStructuredArgs?: boolean;
  /** Tools that may only be called by trusted personas (admin/Felix only). */
  trustedPersonasOnly?: boolean;
  /** Optional per-call cap (e.g., max wire amount). Reject if exceeded. */
  maxValue?: { argPath: string; max: number; unit?: string };
  /** Tools that always require a fresh approval row in agent_approvals. */
  requiresApproval?: boolean;
  /**
   * R100 — Transactional No-Regression. When set, the dispatcher captures
   * pre-action state via the named adapter BEFORE the tool runs. Within
   * `ttlMinutes` the caller can `undo_last_action` to restore. Failure
   * to capture is fail-CLOSED — the destructive call is refused.
   */
  irreversible?: {
    kind: "scheduled_message_cancel" | "custom_tool_delete" | "scraped_pages_delete";
    ttlMinutes: number;
  };
}

// Heuristic deny-list of tool name fragments. ANY unregistered tool whose
// name matches one of these is treated as `destructive` by default — fail-
// CLOSED for the case where someone ships a new dangerous tool and forgets
// to add it to TOOL_POLICIES. Explicit registry below always wins.
const SUSPICIOUS_NAME_FRAGMENTS = [
  "delete_", "drop_", "destroy_", "wipe_", "purge_", "truncate_",
  "exec_sql", "exec_shell", "shell_exec", "run_command",
  "transfer_", "wire_", "payout", "refund_all",
  "reveal_secret", "expose_secret", "dump_secret", "rotate_secret",
  "impersonate_", "su_", "sudo_", "admin_override",
];

function inferRiskFromName(toolName: string): ToolRiskLevel {
  const n = toolName.toLowerCase();
  for (const frag of SUSPICIOUS_NAME_FRAGMENTS) {
    if (n.includes(frag)) return "destructive";
  }
  return "safe";
}

// Registry. Default policy for unlisted tools whose names look suspicious
// is `destructive` (fail-closed); other unlisted tools default to `safe`.
// Add to this list when introducing new destructive surface area.
export const TOOL_POLICIES: Record<string, ToolPolicy> = {
  // Money movement
  stripe_create_payout:        { name: "stripe_create_payout",        risk: "destructive", riskClass: "CRITICAL", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true, maxValue: { argPath: "amount", max: 500_00, unit: "cents" } },
  stripe_create_transfer:      { name: "stripe_create_transfer",      risk: "destructive", riskClass: "CRITICAL", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true, maxValue: { argPath: "amount", max: 500_00, unit: "cents" } },
  // PRE-REGISTERED — tool not yet in TOOL_DEFINITIONS. Kept here so when the
  // tool ships it cannot accidentally run unchecked (default policy is `safe`).
  stripe_refund:               { name: "stripe_refund",               risk: "sensitive",   riskClass: "HIGH",     requiresStructuredArgs: true },
  // PRE-REGISTERED — tool not yet in TOOL_DEFINITIONS.
  coinbase_create_charge:      { name: "coinbase_create_charge",      risk: "sensitive",   riskClass: "MEDIUM",   requiresStructuredArgs: true },

  // Mass communication
  send_email:                  { name: "send_email",                  risk: "sensitive",   riskClass: "MEDIUM",   requiresStructuredArgs: true },
  // PRE-REGISTERED — tool not yet in TOOL_DEFINITIONS.
  send_bulk_email:             { name: "send_bulk_email",             risk: "destructive", riskClass: "HIGH",     requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  // PRE-REGISTERED — tool not yet in TOOL_DEFINITIONS.
  send_sms:                    { name: "send_sms",                    risk: "sensitive",   riskClass: "MEDIUM",   requiresStructuredArgs: true },

  // Data destruction
  // PRE-REGISTERED — tool not yet in TOOL_DEFINITIONS.
  delete_conversation:         { name: "delete_conversation",         risk: "sensitive",   riskClass: "MEDIUM",   requiresStructuredArgs: true },
  // PRE-REGISTERED — tool not yet in TOOL_DEFINITIONS.
  delete_persona:              { name: "delete_persona",              risk: "destructive", riskClass: "HIGH",     requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  // PRE-REGISTERED — tool not yet in TOOL_DEFINITIONS.
  delete_tenant:               { name: "delete_tenant",               risk: "destructive", riskClass: "CRITICAL", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  // PRE-REGISTERED — tool not yet in TOOL_DEFINITIONS.
  bulk_delete:                 { name: "bulk_delete",                 risk: "destructive", riskClass: "CRITICAL", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },

  // R100 — Irreversible-but-recoverable tools. Snapshot captured pre-dispatch,
  // restorable via undo_last_action within ttlMinutes window.
  cancel_scheduled_message:    { name: "cancel_scheduled_message",    risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true, irreversible: { kind: "scheduled_message_cancel", ttlMinutes: 30 } },
  delete_custom_tool:          { name: "delete_custom_tool",          risk: "destructive", riskClass: "HIGH",   requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true, irreversible: { kind: "custom_tool_delete", ttlMinutes: 60 } },
  scraped_pages_delete:        { name: "scraped_pages_delete",        risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true, irreversible: { kind: "scraped_pages_delete", ttlMinutes: 30 } },
  // Undo itself is trusted-persona-only — wrapping the undo wouldn't make sense.
  undo_last_action:            { name: "undo_last_action",            risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true, trustedPersonasOnly: true },
  // R101 / R102 — Observability + admission. Read-only, but trusted-only so
  // adversarial agents can't exfiltrate trace topology or load fingerprints.
  query_trace:                 { name: "query_trace",                 risk: "safe",        riskClass: "LOW",    requiresStructuredArgs: true, trustedPersonasOnly: true },
  recommend_best_tool:         { name: "recommend_best_tool",         risk: "safe",        riskClass: "LOW",    requiresStructuredArgs: true },
  ingest_paper:                { name: "ingest_paper",                risk: "safe",        riskClass: "LOW",    requiresStructuredArgs: true },
  lookup_output_skill:         { name: "lookup_output_skill",         risk: "safe",        riskClass: "LOW",    requiresStructuredArgs: true },
  // R113.5 — Self-hosted cross-platform social scheduler. schedule_* is destructive
  // (publishes public content from Bob's connected accounts); cancel_* is sensitive
  // (only voids 'pending' rows, can't unsend a live post); list_* is read-only.
  schedule_cross_platform_post:{ name: "schedule_cross_platform_post",risk: "destructive", riskClass: "HIGH",   requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  cancel_scheduled_post:       { name: "cancel_scheduled_post",       risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true },
  list_scheduled_posts:        { name: "list_scheduled_posts",        risk: "safe",        riskClass: "LOW" },
  // R114 — AEvo Meta-Editing of Procedure Context. Apply + rollback mutate a
  // versioned procedure surface (output-skill playbooks); both fail-CLOSED
  // require approval. Propose/review/list are non-destructive (write only to
  // procedure_edits, no file touch).
  propose_procedure_edit:      { name: "propose_procedure_edit",      risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true },
  list_procedure_edits:        { name: "list_procedure_edits",        risk: "safe",        riskClass: "LOW" },
  approve_procedure_edit:      { name: "approve_procedure_edit",      risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true },
  reject_procedure_edit:       { name: "reject_procedure_edit",       risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true },
  apply_procedure_edit:        { name: "apply_procedure_edit",        risk: "destructive", riskClass: "HIGH",   requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  rollback_procedure_edit:     { name: "rollback_procedure_edit",     risk: "destructive", riskClass: "HIGH",   requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  // R115.5 — Sprint contract (pre-flight done-condition pin). pin_done_condition
  // is `sensitive` because force=true cancels a sibling open contract; the other
  // two are read-only / write-once-per-contract verdict-recording.
  pin_done_condition:          { name: "pin_done_condition",          risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true },
  get_done_condition:          { name: "get_done_condition",          risk: "safe",        riskClass: "LOW" },
  evaluate_against_contract:   { name: "evaluate_against_contract",   risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true },
  system_load_status:          { name: "system_load_status",          risk: "safe",        riskClass: "LOW",    trustedPersonasOnly: true },
  // R104 — Inbox sender allowlist (admin curation surface). Approve / block
  // gate the inbox-quarantine pipeline; trusted-only so adversarial agents
  // can't whitelist their own injection sources. List endpoints are read-only
  // but kept trusted-only to avoid leaking quarantine topology.
  inbox_sender_approve:        { name: "inbox_sender_approve",        risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true, trustedPersonasOnly: true },
  inbox_sender_block:          { name: "inbox_sender_block",          risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true, trustedPersonasOnly: true },
  inbox_quarantine_list:       { name: "inbox_quarantine_list",       risk: "safe",        riskClass: "LOW",    trustedPersonasOnly: true },
  inbox_allowlist_list:        { name: "inbox_allowlist_list",        risk: "safe",        riskClass: "LOW",    trustedPersonasOnly: true },
  // R104 — Commitments primitive. Long-running agent promises with heartbeat;
  // create/heartbeat/list are tenant-scoped (any persona); cancel is sensitive
  // (cancelling a tracked obligation should leave a clear audit trail).
  // R112.15 — L2 session memory pin. Tenant + conversation scoped, no money,
  // no comms, no deletes; classifier "safe" with structured-args so the AHB
  // governance gate evaluates every call.
  remember_for_this_session:   { name: "remember_for_this_session",   risk: "safe",        riskClass: "LOW",    requiresStructuredArgs: true },
  commitment_create:           { name: "commitment_create",           risk: "safe",        riskClass: "LOW",    requiresStructuredArgs: true },
  commitment_list:             { name: "commitment_list",             risk: "safe",        riskClass: "LOW" },
  commitment_heartbeat:        { name: "commitment_heartbeat",        risk: "safe",        riskClass: "LOW",    requiresStructuredArgs: true },
  commitment_complete:         { name: "commitment_complete",         risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true },
  commitment_cancel:           { name: "commitment_cancel",           risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true },
  exec_sql:                    { name: "exec_sql",                    risk: "destructive", riskClass: "CRITICAL", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  shell_exec:                  { name: "shell_exec",                  risk: "destructive", riskClass: "CRITICAL", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  // R115.5+sec — close named-example coverage gaps from post-edit-code-review
  // Pass B HIGH-1. `exec` is the bare shell tool (Settings-gated allowlist), but
  // the registry never explicitly classified it; the heuristic only matches
  // `exec_sql`/`shell_exec`/`exec_shell`/`run_command` fragments, so bare
  // `exec` fell to default `safe`. Force destructive + approval + trusted-only
  // so the AHB gate fires before dispatch regardless of Settings flag.
  exec:                        { name: "exec",                        risk: "destructive", riskClass: "CRITICAL", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  // deliver_product fans out: writes to Drive (creates customer-visible folder),
  // sends branded email to a third-party customer address. That's mass-comms
  // + external data exfil class. sensitive HIGH with structured-args so the
  // gate inspects customerEmail before any send.
  deliver_product:             { name: "deliver_product",             risk: "sensitive",   riskClass: "HIGH",     requiresStructuredArgs: true },
  // google_drive / google_workspace operate on Bob's connected OAuth account.
  // Read+write capable (create/move/share/delete in Drive; send/draft in Mail
  // when used through the workspace facade). sensitive MEDIUM at minimum so
  // approval ladder + audit trail engage on every call.
  google_drive:                { name: "google_drive",                risk: "sensitive",   riskClass: "MEDIUM",   requiresStructuredArgs: true },
  google_workspace:            { name: "google_workspace",            risk: "sensitive",   riskClass: "MEDIUM",   requiresStructuredArgs: true },
  // create_invoice / create_contract write tenant rows that downstream produce
  // legally-binding artifacts (PDF + signature flow) and trigger customer-
  // facing emails. Not money-movement (Stripe is separate) but they create
  // commitments under the tenant's name → sensitive MEDIUM.
  create_invoice:              { name: "create_invoice",              risk: "sensitive",   riskClass: "MEDIUM",   requiresStructuredArgs: true },
  create_contract:             { name: "create_contract",             risk: "sensitive",   riskClass: "MEDIUM",   requiresStructuredArgs: true },
  // R115.5+sec round 2 — architect re-verify named additional unregistered
  // mutating/HIGH-risk tools that were defaulting to `safe`. Classifications:
  //  - delegate_task: routes work to other personas; can amplify any blast
  //    radius the target persona has. sensitive MEDIUM (not destructive —
  //    target persona's own policy still applies at dispatch time).
  //  - sessions_send: writes into chat conversations; can be used as
  //    cross-tenant comms vector if tenant-scoping regresses upstream.
  //  - whatsapp: sends customer-facing messages over Twilio. Mass-comms class.
  //  - lobster: mock-payment toy tool for testing — sensitive because the
  //    name camouflages intent; force classification so future readers see it.
  //  - create_tool: defines NEW tools at runtime (custom tool factory).
  //    Trusted-only + approval — destructive HIGH (a malicious create_tool
  //    call could ship a backdoored tool that bypasses the registry).
  //  - manage_skills: edits .agents/skills/* bodies. Already gated by R114
  //    procedure_edit_governance for output-skill surface, but the bare tool
  //    needs an explicit policy floor. destructive HIGH.
  //  - draft_social_post / marketing_experiment: write to publisher queues
  //    and tenant marketing tables; sensitive MEDIUM.
  //  - set_policy: edits TOOL_POLICIES at runtime if writable. The single
  //    most dangerous tool in the platform if exposed — it can downgrade
  //    every other policy. destructive CRITICAL + trusted + approval, and
  //    treat as kill-switch: if this ever appears in a non-trusted persona
  //    invocation, hard-fail the dispatcher.
  delegate_task:               { name: "delegate_task",               risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true },
  sessions_send:               { name: "sessions_send",               risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true },
  whatsapp:                    { name: "whatsapp",                    risk: "sensitive",   riskClass: "HIGH",   requiresStructuredArgs: true },
  lobster:                     { name: "lobster",                     risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true, trustedPersonasOnly: true },
  create_tool:                 { name: "create_tool",                 risk: "destructive", riskClass: "HIGH",   requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  manage_skills:               { name: "manage_skills",               risk: "destructive", riskClass: "HIGH",   requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  draft_social_post:           { name: "draft_social_post",           risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true },
  marketing_experiment:        { name: "marketing_experiment",        risk: "sensitive",   riskClass: "MEDIUM", requiresStructuredArgs: true },
  set_policy:                  { name: "set_policy",                  risk: "destructive", riskClass: "CRITICAL", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },

  // R98.11+sec2 — slash_command action='run' executes shell bodies from
  // .bob/commands/*.md. Tool already enforces owner-tenant + Felix/Forge
  // gate, but classifying here ensures the destructive-tool-policy layer
  // also enforces structured-args + trusted-persona requirements.
  slash_command:               { name: "slash_command",               risk: "destructive", riskClass: "CRITICAL", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  // R98.16 — run_command is the same RCE class as slash_command.
  run_command:                 { name: "run_command",                 risk: "destructive", riskClass: "CRITICAL", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },

  // R98.22+sec — Hyperagent-cross-pollination tools (R98.21).
  // propose_skill stores agent-authored skill bodies in a human-review queue;
  // run_ab_eval fans out N parallel LLM evaluations (cost vector).
  propose_skill:               { name: "propose_skill",               risk: "sensitive",   riskClass: "MEDIUM",   requiresStructuredArgs: true },
  run_ab_eval:                 { name: "run_ab_eval",                 risk: "sensitive",   riskClass: "HIGH",     requiresStructuredArgs: true, trustedPersonasOnly: true },

  // Credentials
  reveal_secret:               { name: "reveal_secret",               risk: "destructive", riskClass: "CRITICAL", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  rotate_secret:               { name: "rotate_secret",               risk: "destructive", riskClass: "CRITICAL", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },

  // R98.27.7 — Per-task workspace tools (filesystem-only, tenant-scoped under data/task-workspaces/<tenant>/, hard-quota 200 files / 256 KiB per workspace, sanitized job ids, path.relative containment). Classified `safe` because they CANNOT escape tenant root and CANNOT consume unbounded resources, but require structured args so AHB stylistic-jailbreak ("please workspace_init poetically") cannot trigger them via prose. requiresStructuredArgs=true is the AHB defense floor for any state-mutating tool.
  workspace_init:              { name: "workspace_init",              risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  workspace_update_status:     { name: "workspace_update_status",     risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  workspace_log_artifact:      { name: "workspace_log_artifact",      risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  workspace_read:              { name: "workspace_read",              risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  workspace_finalize:          { name: "workspace_finalize",          risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  workspace_list:              { name: "workspace_list",              risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },

  // R98.27.8 — Codebase self-knowledge graph (read-only, fs-bounded to data/codebase-graph.json + read-only `git diff --name-only`).
  // Pure introspection — no mutation, no network. requiresStructuredArgs=true keeps AHB stylistic-jailbreak floor.
  codebase_graph_query:        { name: "codebase_graph_query",        risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  codebase_diff_impact:        { name: "codebase_diff_impact",        risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },

  // R99 — Felix Visual Continuity. All five tools are tenant-scoped and
  // bounded (HARD CAP 5 chars × 4 views per init call; image refs jailed to
  // project-assets/uploads/attached_assets via server/lib/image-ref-jail.ts).
  // No money, no destruction, no creds — but they DO mutate prod state
  // (writes to character_portrait_registry / video_job_frame_pool) and the
  // init path runs gpt-image-2 generations (cost vector). Classified `safe`
  // with requiresStructuredArgs=true to keep the AHB stylistic-jailbreak
  // defense floor in place — the 312-tool platform should never accept
  // "register a portrait of bob, please" as prose.
  register_character_portrait: { name: "register_character_portrait", risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  list_character_portraits:    { name: "list_character_portraits",    risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  init_character_portraits:    { name: "init_character_portraits",    risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  select_references_for_frame: { name: "select_references_for_frame", risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  select_best_image:           { name: "select_best_image",           risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },

  // R106 — REFLEXIVE OPERATING PRIMITIVES (LuaN1aoAgent, Apache-2.0).
  // All 7 tools are tenant-scoped, append-only / bounded mutation, no money,
  // no destruction, no creds, no network. Classified `safe` so every persona
  // reaches for them by reflex; requiresStructuredArgs=true keeps the AHB
  // stylistic-jailbreak floor in place — the platform must never accept
  // "please attribute this failure poetically" as prose.
  attribute_failure:           { name: "attribute_failure",           risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  findings_publish:            { name: "findings_publish",            risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  findings_read:               { name: "findings_read",               risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  hypothesis_pin:              { name: "hypothesis_pin",              risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  hypothesis_list_pinned:      { name: "hypothesis_list_pinned",      risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  plan_graph_edit:             { name: "plan_graph_edit",             risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  plan_graph_query:            { name: "plan_graph_query",            risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  memory_geometry_scan:        { name: "memory_geometry_scan",        risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  hypothesis_attach_evidence:  { name: "hypothesis_attach_evidence",  risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  hypothesis_evidence_chain:   { name: "hypothesis_evidence_chain",   risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  monid_discover:              { name: "monid_discover",              risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  monid_inspect:               { name: "monid_inspect",               risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  monid_catalog_browse:        { name: "monid_catalog_browse",        risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  monid_run:                   { name: "monid_run",                   risk: "sensitive",   riskClass: "MEDIUM",   requiresStructuredArgs: true },

  // R110 +sec — Pre-delivery secret scanner. Read-only, no network, no LLM,
  // pure-stdlib regex catalog. Classified `safe` so every persona reaches
  // for it by reflex; structured args keep the AHB stylistic-jailbreak
  // floor in place (must pass {text|filePath}, never prose).
  scan_for_secrets:            { name: "scan_for_secrets",            risk: "safe",        riskClass: "LOW",      requiresStructuredArgs: true },
  // R115.5+sec round 3 — bulk backfill of every previously-unregistered
  // tool. Auto-classified by name heuristic (scripts/backfill-tool-policies.ts):
  //   delete/destroy/drop/wipe/purge → destructive HIGH
  //   create/update/send/post/publish/schedule/run/etc. → sensitive MEDIUM
  //   get/list/search/query/read/check → safe LOW
  //   ambiguous → sensitive MEDIUM (fail-secure default)
  // Re-classify any individual entry by editing the row directly.
  add_competitor:                 { name: "add_competitor", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  add_customer:                   { name: "add_customer", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  advance_sequence:               { name: "advance_sequence", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  agent_cost_summary:             { name: "agent_cost_summary", risk: "safe", riskClass: "LOW" },
  agent_security_scan:            { name: "agent_security_scan", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  agent_status:                   { name: "agent_status", risk: "safe", riskClass: "LOW" },
  agentic_cache_stats:            { name: "agentic_cache_stats", risk: "safe", riskClass: "LOW" },
  analyst:                        { name: "analyst", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  analyze_pdf:                    { name: "analyze_pdf", risk: "safe", riskClass: "LOW" },
  analyze_portfolio:              { name: "analyze_portfolio", risk: "safe", riskClass: "LOW" },
  approve_felix_proposal:         { name: "approve_felix_proposal", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  audit_reasoning_step:           { name: "audit_reasoning_step", risk: "safe", riskClass: "LOW" },
  auto_memorize_now:              { name: "auto_memorize_now", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  autonomous_task:                { name: "autonomous_task", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  browser:                        { name: "browser", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  browser_workflow:               { name: "browser_workflow", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  build_html_app:                 { name: "build_html_app", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  build_presentation_distributed: { name: "build_presentation_distributed", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  build_video_from_brief:         { name: "build_video_from_brief", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  build_voice_profile:            { name: "build_voice_profile", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  business_health_score:          { name: "business_health_score", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  calendar_sync:                  { name: "calendar_sync", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  cash_flow_summary:              { name: "cash_flow_summary", risk: "safe", riskClass: "LOW" },
  check_background_task:          { name: "check_background_task", risk: "safe", riskClass: "LOW" },
  check_inbox:                    { name: "check_inbox", risk: "safe", riskClass: "LOW" },
  check_system_status:            { name: "check_system_status", risk: "safe", riskClass: "LOW" },
  check_video_job:                { name: "check_video_job", risk: "safe", riskClass: "LOW" },
  chunk_code:                     { name: "chunk_code", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  classify_reply:                 { name: "classify_reply", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  commit_decision:                { name: "commit_decision", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  competitor_briefing:            { name: "competitor_briefing", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  compliance_audit:               { name: "compliance_audit", risk: "safe", riskClass: "LOW" },
  compose_social_post:            { name: "compose_social_post", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  compress_context:               { name: "compress_context", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  context_budget_audit:           { name: "context_budget_audit", risk: "safe", riskClass: "LOW" },
  create_adr:                     { name: "create_adr", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_crew:                    { name: "create_crew", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_document:                { name: "create_document", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_flow:                    { name: "create_flow", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_knowledge:               { name: "create_knowledge", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_memory:                  { name: "create_memory", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_mind:                    { name: "create_mind", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_pdf:                     { name: "create_pdf", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_plan:                    { name: "create_plan", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_sequence:                { name: "create_sequence", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_slides:                  { name: "create_slides", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_slideshow_video:         { name: "create_slideshow_video", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_spreadsheet:             { name: "create_spreadsheet", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_styled_report:           { name: "create_styled_report", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  create_tension:                 { name: "create_tension", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  critic:                         { name: "critic", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  critique_response:              { name: "critique_response", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  cross_critique:                 { name: "cross_critique", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  customer_pipeline:              { name: "customer_pipeline", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  debate:                         { name: "debate", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  decide_approval:                { name: "decide_approval", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  deep_research:                  { name: "deep_research", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  define_icp:                     { name: "define_icp", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  delivery_status:                { name: "delivery_status", risk: "safe", riskClass: "LOW" },
  detect_competitor_changes:      { name: "detect_competitor_changes", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  detect_emotional_state:         { name: "detect_emotional_state", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  detect_fatigue:                 { name: "detect_fatigue", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  doc_search:                     { name: "doc_search", risk: "safe", riskClass: "LOW" },
  edit_pdf:                       { name: "edit_pdf", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  emit_event:                     { name: "emit_event", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  enrich_lead:                    { name: "enrich_lead", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  enroll_in_sequence:             { name: "enroll_in_sequence", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  ensemble_query:                 { name: "ensemble_query", risk: "safe", riskClass: "LOW" },
  estimate_cost:                  { name: "estimate_cost", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  execute_code:                   { name: "execute_code", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  execute_felix_proposal:         { name: "execute_felix_proposal", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  expense_report:                 { name: "expense_report", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  expire_triple:                  { name: "expire_triple", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  export_persona:                 { name: "export_persona", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  felix_loop_run_now:             { name: "felix_loop_run_now", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  felix_loop_status:              { name: "felix_loop_status", risk: "safe", riskClass: "LOW" },
  figma:                          { name: "figma", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  fill_pdf:                       { name: "fill_pdf", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  finalize_video:                 { name: "finalize_video", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  finance_market_overview:        { name: "finance_market_overview", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  finance_news:                   { name: "finance_news", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  finance_stock_price:            { name: "finance_stock_price", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  finance_stock_search:           { name: "finance_stock_search", risk: "safe", riskClass: "LOW" },
  financial_snapshot:             { name: "financial_snapshot", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  firecrawl_crawl:                { name: "firecrawl_crawl", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  firecrawl_map:                  { name: "firecrawl_map", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  firecrawl_scrape:               { name: "firecrawl_scrape", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  firecrawl_search:               { name: "firecrawl_search", risk: "safe", riskClass: "LOW" },
  forecast_ticker:                { name: "forecast_ticker", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  fork_conversation:              { name: "fork_conversation", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  format_post:                    { name: "format_post", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  generate_audio:                 { name: "generate_audio", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  generate_chart:                 { name: "generate_chart", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  generate_content_matrix:        { name: "generate_content_matrix", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  generate_dashboard:             { name: "generate_dashboard", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  generate_hooks:                 { name: "generate_hooks", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  generate_legal_document:        { name: "generate_legal_document", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  generate_schema_markup:         { name: "generate_schema_markup", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  generate_social_image:          { name: "generate_social_image", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  get_agent_run:                  { name: "get_agent_run", risk: "safe", riskClass: "LOW" },
  get_daily_notes:                { name: "get_daily_notes", risk: "safe", riskClass: "LOW" },
  get_eval_report:                { name: "get_eval_report", risk: "safe", riskClass: "LOW" },
  get_experiments:                { name: "get_experiments", risk: "safe", riskClass: "LOW" },
  get_minerva_roster:             { name: "get_minerva_roster", risk: "safe", riskClass: "LOW" },
  get_plan:                       { name: "get_plan", risk: "safe", riskClass: "LOW" },
  get_usage_analytics:            { name: "get_usage_analytics", risk: "safe", riskClass: "LOW" },
  get_user_info:                  { name: "get_user_info", risk: "safe", riskClass: "LOW" },
  get_voice_profile:              { name: "get_voice_profile", risk: "safe", riskClass: "LOW" },
  grade_deliverable:              { name: "grade_deliverable", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  graph_memory:                   { name: "graph_memory", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  grounding_intervention:         { name: "grounding_intervention", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  ideation_session:               { name: "ideation_session", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  introspect_tools:               { name: "introspect_tools", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  invoice_aging_report:           { name: "invoice_aging_report", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  knowledge_navigate:             { name: "knowledge_navigate", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  knowledge_nudge_stats:          { name: "knowledge_nudge_stats", risk: "safe", riskClass: "LOW" },
  kpi_dashboard:                  { name: "kpi_dashboard", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  kpi_trend:                      { name: "kpi_trend", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  learn_from_reference:           { name: "learn_from_reference", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  legal_review:                   { name: "legal_review", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  list_adrs:                      { name: "list_adrs", risk: "safe", riskClass: "LOW" },
  list_agent_runs:                { name: "list_agent_runs", risk: "safe", riskClass: "LOW" },
  list_background_tasks:          { name: "list_background_tasks", risk: "safe", riskClass: "LOW" },
  list_competitors:               { name: "list_competitors", risk: "safe", riskClass: "LOW" },
  list_contracts:                 { name: "list_contracts", risk: "safe", riskClass: "LOW" },
  list_conversations:             { name: "list_conversations", risk: "safe", riskClass: "LOW" },
  list_critiques:                 { name: "list_critiques", risk: "safe", riskClass: "LOW" },
  list_custom_tools:              { name: "list_custom_tools", risk: "safe", riskClass: "LOW" },
  list_customers:                 { name: "list_customers", risk: "safe", riskClass: "LOW" },
  list_expenses:                  { name: "list_expenses", risk: "safe", riskClass: "LOW" },
  list_felix_loop_runs:           { name: "list_felix_loop_runs", risk: "safe", riskClass: "LOW" },
  list_felix_proposals:           { name: "list_felix_proposals", risk: "safe", riskClass: "LOW" },
  list_invoices:                  { name: "list_invoices", risk: "safe", riskClass: "LOW" },
  list_models:                    { name: "list_models", risk: "safe", riskClass: "LOW" },
  list_open_tensions:             { name: "list_open_tensions", risk: "safe", riskClass: "LOW" },
  list_pdf_fields:                { name: "list_pdf_fields", risk: "safe", riskClass: "LOW" },
  list_pending_approvals:         { name: "list_pending_approvals", risk: "safe", riskClass: "LOW" },
  list_plans:                     { name: "list_plans", risk: "safe", riskClass: "LOW" },
  list_scheduled_messages:        { name: "list_scheduled_messages", risk: "safe", riskClass: "LOW" },
  list_sequences:                 { name: "list_sequences", risk: "safe", riskClass: "LOW" },
  list_skill_candidates:          { name: "list_skill_candidates", risk: "safe", riskClass: "LOW" },
  list_uploads:                   { name: "list_uploads", risk: "safe", riskClass: "LOW" },
  llm_task:                       { name: "llm_task", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  log_expense:                    { name: "log_expense", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  log_experiment:                 { name: "log_experiment", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  log_interaction:                { name: "log_interaction", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  manage_content_calendar:        { name: "manage_content_calendar", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  manage_desk:                    { name: "manage_desk", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  manage_social_accounts:         { name: "manage_social_accounts", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  manage_watchlist:               { name: "manage_watchlist", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  marketing_analytics:            { name: "marketing_analytics", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  messaging_status:               { name: "messaging_status", risk: "safe", riskClass: "LOW" },
  micro_sabbatical:               { name: "micro_sabbatical", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  mind_ticket:                    { name: "mind_ticket", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  mpeg_add_audio:                 { name: "mpeg_add_audio", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  mpeg_concat:                    { name: "mpeg_concat", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  mpeg_produce:                   { name: "mpeg_produce", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  mpeg_produce_parallel:          { name: "mpeg_produce_parallel", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  nudge_self:                     { name: "nudge_self", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  orchestrate:                    { name: "orchestrate", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  parallel_research:              { name: "parallel_research", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  plan_and_execute:               { name: "plan_and_execute", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  plan_deliverable:               { name: "plan_deliverable", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  plan_video_production:          { name: "plan_video_production", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  post_to_channel:                { name: "post_to_channel", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  produce_video:                  { name: "produce_video", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  profit_and_loss:                { name: "profit_and_loss", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  project:                        { name: "project", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  promote_skill_candidate:        { name: "promote_skill_candidate", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  publish_social_post:            { name: "publish_social_post", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  qualify_leads:                  { name: "qualify_leads", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  quality_baseline_check:         { name: "quality_baseline_check", risk: "safe", riskClass: "LOW" },
  quality_baseline_save:          { name: "quality_baseline_save", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  query_causal:                   { name: "query_causal", risk: "safe", riskClass: "LOW" },
  query_communities:              { name: "query_communities", risk: "safe", riskClass: "LOW" },
  query_evidence:                 { name: "query_evidence", risk: "safe", riskClass: "LOW" },
  query_triples:                  { name: "query_triples", risk: "safe", riskClass: "LOW" },
  read_channels:                  { name: "read_channels", risk: "safe", riskClass: "LOW" },
  read_file:                      { name: "read_file", risk: "safe", riskClass: "LOW" },
  read_scratchpad:                { name: "read_scratchpad", risk: "safe", riskClass: "LOW" },
  readability_extract:            { name: "readability_extract", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  recall_context:                 { name: "recall_context", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  recall_failure_patterns:        { name: "recall_failure_patterns", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  recall_references:              { name: "recall_references", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  recall_strategic_wins:          { name: "recall_strategic_wins", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  record_failure_pattern:         { name: "record_failure_pattern", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  record_kpi:                     { name: "record_kpi", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  record_strategic_win:           { name: "record_strategic_win", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  recursive_synthesize:           { name: "recursive_synthesize", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  reject_felix_proposal:          { name: "reject_felix_proposal", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  reject_skill_candidate:         { name: "reject_skill_candidate", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  render_diagram:                 { name: "render_diagram", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  repurpose_content:              { name: "repurpose_content", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  request_approval:               { name: "request_approval", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  research_digest:                { name: "research_digest", risk: "safe", riskClass: "LOW" },
  researcher:                     { name: "researcher", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  resolve_tension:                { name: "resolve_tension", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  revenue_report:                 { name: "revenue_report", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  revenue_vs_cost:                { name: "revenue_vs_cost", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  run_agent_eval:                 { name: "run_agent_eval", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  run_background_task:            { name: "run_background_task", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  run_self_improvement:           { name: "run_self_improvement", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  run_supervisor:                 { name: "run_supervisor", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  save_evidence:                  { name: "save_evidence", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  scan_file:                      { name: "scan_file", risk: "safe", riskClass: "LOW" },
  scan_for_prompt_injection:      { name: "scan_for_prompt_injection", risk: "safe", riskClass: "LOW" },
  schedule_message:               { name: "schedule_message", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  score_leads:                    { name: "score_leads", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  score_post:                     { name: "score_post", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  scraped_page_read:              { name: "scraped_page_read", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  scraped_pages_query:            { name: "scraped_pages_query", risk: "safe", riskClass: "LOW" },
  sculptor_review:                { name: "sculptor_review", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  sculptor_session:               { name: "sculptor_session", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  search_knowledge:               { name: "search_knowledge", risk: "safe", riskClass: "LOW" },
  search_memory:                  { name: "search_memory", risk: "safe", riskClass: "LOW" },
  search_stock_media:             { name: "search_stock_media", risk: "safe", riskClass: "LOW" },
  self_diagnose:                  { name: "self_diagnose", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  self_heal:                      { name: "self_heal", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  self_heal_inspect:              { name: "self_heal_inspect", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  self_heal_log:                  { name: "self_heal_log", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  send_message:                   { name: "send_message", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  seo_content_audit:              { name: "seo_content_audit", risk: "safe", riskClass: "LOW" },
  sessions_history:               { name: "sessions_history", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  sessions_list:                  { name: "sessions_list", risk: "safe", riskClass: "LOW" },
  sessions_spawn:                 { name: "sessions_spawn", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  set_my_profile_photo:           { name: "set_my_profile_photo", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  show_diff:                      { name: "show_diff", risk: "safe", riskClass: "LOW" },
  simulate_plan:                  { name: "simulate_plan", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  site_login:                     { name: "site_login", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  skill_seeker:                   { name: "skill_seeker", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  skillify:                       { name: "skillify", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  start_video_job:                { name: "start_video_job", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  stealth_browse:                 { name: "stealth_browse", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  stealth_browse_camofox:         { name: "stealth_browse_camofox", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  store_triple:                   { name: "store_triple", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  strategic_interview:            { name: "strategic_interview", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  stress_intervention:            { name: "stress_intervention", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  subagents:                      { name: "subagents", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  supersede_adr:                  { name: "supersede_adr", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  sync_personas:                  { name: "sync_personas", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  synthesize_research:            { name: "synthesize_research", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  synthesize_skill:               { name: "synthesize_skill", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  take_competitor_snapshot:       { name: "take_competitor_snapshot", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  template_scrape:                { name: "template_scrape", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  template_scraper_stats:         { name: "template_scraper_stats", risk: "safe", riskClass: "LOW" },
  test_api_keys:                  { name: "test_api_keys", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  tool_performance_report:        { name: "tool_performance_report", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  track_intervention:             { name: "track_intervention", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  track_outcome:                  { name: "track_outcome", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  tree_of_thought:                { name: "tree_of_thought", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  trend_research:                 { name: "trend_research", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  update_contract_status:         { name: "update_contract_status", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  update_customer:                { name: "update_customer", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  update_invoice_status:          { name: "update_invoice_status", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  update_memory:                  { name: "update_memory", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  user_model_query:               { name: "user_model_query", risk: "safe", riskClass: "LOW" },
  verify_deliverable:             { name: "verify_deliverable", risk: "safe", riskClass: "LOW" },
  verify_delivery_proof:          { name: "verify_delivery_proof", risk: "safe", riskClass: "LOW" },
  verify_felix_proposal_spec:     { name: "verify_felix_proposal_spec", risk: "safe", riskClass: "LOW" },
  verify_math_chain:              { name: "verify_math_chain", risk: "safe", riskClass: "LOW" },
  verify_outbound_safety:         { name: "verify_outbound_safety", risk: "safe", riskClass: "LOW" },
  vibevoice_transcribe:           { name: "vibevoice_transcribe", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  video_burn_captions:            { name: "video_burn_captions", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  video_cut_fillers:              { name: "video_cut_fillers", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  video_transcribe_words:         { name: "video_transcribe_words", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  vision_browse:                  { name: "vision_browse", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  web_fetch:                      { name: "web_fetch", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  web_search:                     { name: "web_search", risk: "safe", riskClass: "LOW" },
  write_daily_note:               { name: "write_daily_note", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  write_file:                     { name: "write_file", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  write_scratchpad:               { name: "write_scratchpad", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  writer:                         { name: "writer", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  x_delete_tweet:                 { name: "x_delete_tweet", risk: "destructive", riskClass: "HIGH", requiresStructuredArgs: true, requiresApproval: true, trustedPersonasOnly: true },
  x_get_me:                       { name: "x_get_me", risk: "safe", riskClass: "LOW" },
  x_get_mentions:                 { name: "x_get_mentions", risk: "safe", riskClass: "LOW" },
  x_get_timeline:                 { name: "x_get_timeline", risk: "safe", riskClass: "LOW" },
  x_get_tweet:                    { name: "x_get_tweet", risk: "safe", riskClass: "LOW" },
  x_like_tweet:                   { name: "x_like_tweet", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  x_post_tweet:                   { name: "x_post_tweet", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  x_retweet:                      { name: "x_retweet", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
  x_search:                       { name: "x_search", risk: "safe", riskClass: "LOW" },
  youtube:                        { name: "youtube", risk: "sensitive", riskClass: "MEDIUM", requiresStructuredArgs: true },
};

/**
 * R98.17 — Resolve the human-facing risk class for any tool name.
 *
 * Lookup order:
 *   1. Explicit `riskClass` on the registered TOOL_POLICIES row.
 *   2. Inferred from `risk` level (destructive → HIGH, sensitive → MEDIUM, safe → LOW).
 *   3. Inferred from suspicious name fragments (default CRITICAL when matched).
 *   4. Default: LOW.
 *
 * Use this in HITL approval prompts, owner-notification emails, and audit
 * logs so the severity label is consistent across every surface.
 */
export function getToolRiskClass(toolName: string): ToolRiskClass {
  const policy = TOOL_POLICIES[toolName];
  if (policy?.riskClass) return policy.riskClass;
  if (policy?.risk === "destructive") return "HIGH";
  if (policy?.risk === "sensitive") return "MEDIUM";
  if (policy?.risk === "safe") return "LOW";
  // Unregistered — infer from name.
  const inferred = inferRiskFromName(toolName);
  if (inferred === "destructive") return "CRITICAL";
  return "LOW";
}

export function listToolRiskClasses(): Array<{ name: string; riskClass: ToolRiskClass; risk: ToolRiskLevel }> {
  return Object.values(TOOL_POLICIES).map((p) => ({
    name: p.name,
    riskClass: p.riskClass || (p.risk === "destructive" ? "HIGH" : p.risk === "sensitive" ? "MEDIUM" : "LOW"),
    risk: p.risk,
  }));
}

export interface ToolPolicyContext {
  tenantId: number;
  personaId?: number | null;
  personaName?: string;
  invokedVia?: string;
  /** Whether the caller has already obtained a fresh agent_approvals row. */
  hasApproval?: boolean;
}

export interface ToolPolicyResult {
  action: "allow" | "block";
  reason?: string;
  policy: ToolPolicy;
}

export const TRUSTED_PERSONA_NAMES = new Set(["Felix", "Forge", "VisionClaw", "system"]);

function getByPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function redactArgs(args: any): any {
  if (!args || typeof args !== "object") return { _kind: typeof args };
  const out: any = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 80) out[k] = `${v.slice(0, 60)}…(${v.length}chars)`;
    else if (typeof v === "string" && /key|secret|token|password|auth/i.test(k)) out[k] = "[REDACTED]";
    else out[k] = v;
  }
  return out;
}

/**
 * Enforce destructive-tool policy. Returns { action: "block", reason } when
 * the call must not proceed. Otherwise { action: "allow" }.
 *
 * Audit-logs every block to security_tool_blocks (best-effort).
 */
export async function enforceToolPolicy(
  toolName: string,
  args: any,
  ctx: ToolPolicyContext,
): Promise<ToolPolicyResult> {
  let policy = TOOL_POLICIES[toolName];
  if (!policy) {
    // Unregistered tool — infer risk from name. Suspicious names default to
    // `destructive` + structured-args + trusted-personas-only, fail-closed.
    const inferred = inferRiskFromName(toolName);
    if (inferred === "destructive") {
      console.warn(`[tool-policy] UNREGISTERED suspicious tool "${toolName}" — applying destructive defaults (fail-closed). Add to TOOL_POLICIES.`);
      policy = { name: toolName, risk: "destructive", requiresStructuredArgs: true, trustedPersonasOnly: true, requiresApproval: true };
    } else {
      policy = { name: toolName, risk: "safe" };
    }
  }
  // Safe tools fast-path — but ONLY if NO additional gate is declared.
  // R106 architect re-review (round 1) caught that the prior early-return
  // bypassed AHB stylistic-jailbreak defense for every safe+requiresStructuredArgs
  // tool (workspace_*, codebase_*, R99 portraits, R104 commitments, R106
  // reflexive primitives). Round 2 caught that safe+trustedPersonasOnly tools
  // (query_trace, system_load_status, inbox_quarantine_list, inbox_allowlist_list)
  // were ALSO bypassing their trusted-persona gate via the same path —
  // pre-existing broken-access-control. Tightening here closes both holes:
  // ANY policy flag (structured-args, trusted-personas, approval, value-cap)
  // forces the call through the full pipeline.
  const hasAnyGate =
    policy.requiresStructuredArgs ||
    policy.trustedPersonasOnly ||
    policy.requiresApproval ||
    !!policy.maxValue;
  if (policy.risk === "safe" && !hasAnyGate) {
    return { action: "allow", policy };
  }

  const riskClass = policy.riskClass || (policy.risk === "destructive" ? "HIGH" : policy.risk === "sensitive" ? "MEDIUM" : "LOW");
  const block = (reason: string, declineReason: "policy_block" | "approval_required" = "policy_block"): ToolPolicyResult => {
    // R98.17 — prepend risk class so HITL prompts + owner alerts surface severity.
    const labeled = `[${riskClass}-risk] ${reason}`;
    pool.query(
      `INSERT INTO security_tool_blocks (tenant_id, persona_id, tool_name, reason, args_redacted, invoked_via)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [ctx.tenantId, ctx.personaId ?? null, toolName, labeled, JSON.stringify(redactArgs(args)), ctx.invokedVia || null]
    ).catch((e) => logSilentCatch("server/safety/destructive-tool-policy.ts", e));
    console.warn(`[tool-policy] BLOCK [${riskClass}] ${toolName} persona=${ctx.personaName || ctx.personaId} reason="${reason}"`);
    // R98.25 — MNEMA Nugget 5 + 2: emit typed decline_event AND credit the
    // restraint channel. A correctly-blocked destructive tool is a "restraint
    // worked" signal. NOTE: we credit restraint_ok optimistically here; if a
    // human later overrides this block (approval+retry), the next call's
    // success will credit action_ok. The two channels balance out over time.
    // Fire-and-forget — telemetry must not stall a refusal.
    // R98.25.1+sec — Architect MEDIUM (whole-app review pass 3): wrap the entire
    // Promise.all construction in try/catch as defense-in-depth. The inner
    // .catch() handles all async rejections, but a synchronous throw during
    // arg evaluation (e.g., reason.slice on a non-string) would escape before
    // .catch() attaches and bubble into the block path, failing the refusal
    // path OPEN. Belt-and-suspenders: telemetry must NEVER block the block().
    try {
      Promise.all([
        import("../lib/decline-events").then(({ recordDeclineAsync }) =>
          recordDeclineAsync({
            tenantId: ctx.tenantId,
            personaId: ctx.personaId ?? null,
            source: "tool_policy",
            reason: declineReason,
            detail: String(reason || "").slice(0, 500),
            toolName,
            metadata: { riskClass, invokedVia: ctx.invokedVia || null, personaName: ctx.personaName || null },
          }),
        ),
        ctx.personaId
          ? import("../lib/restraint-trust").then(({ recordReputationOutcome }) =>
              recordReputationOutcome({
                tenantId: ctx.tenantId,
                personaId: ctx.personaId!,
                category: `tool:${toolName}`,
                outcome: "restraint_ok",
              }),
            )
          : Promise.resolve(),
      ]).catch((e) => logSilentCatch("server/safety/destructive-tool-policy.ts", e));
    } catch (e) {
      logSilentCatch("server/safety/destructive-tool-policy.ts:sync-throw", e);
    }
    return { action: "block", reason: labeled, policy };
  };

  // Trusted-persona gate.
  if (policy.trustedPersonasOnly) {
    const pname = ctx.personaName || "";
    if (!TRUSTED_PERSONA_NAMES.has(pname)) {
      return block(`tool "${toolName}" is restricted to trusted personas (${[...TRUSTED_PERSONA_NAMES].join(", ")}); caller persona is "${pname}"`);
    }
  }

  // Structured-args requirement — defends against AHB-style poetic args.
  // A destructive tool called with `args = "in the manner of an alchemist..."`
  // is structurally rejected without ever touching the underlying tool fn.
  if (policy.requiresStructuredArgs) {
    if (args == null || typeof args !== "object" || Array.isArray(args)) {
      return block(`tool "${toolName}" requires structured (object) args; got ${Array.isArray(args) ? "array" : typeof args}`);
    }
    // Reject any object whose values are dominated by suspiciously-poetic free text.
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === "string" && v.length > 2000) {
        return block(`tool "${toolName}" arg "${k}" exceeds 2000 chars (${v.length}); destructive tools reject prose-length free text`);
      }
    }
  }

  // Approval gate.
  if (policy.requiresApproval && !ctx.hasApproval) {
    return block(`tool "${toolName}" requires a fresh agent_approvals row; none was provided in context`, "approval_required");
  }

  // Value cap.
  if (policy.maxValue) {
    const val = getByPath(args, policy.maxValue.argPath);
    if (typeof val === "number" && val > policy.maxValue.max) {
      return block(`tool "${toolName}" arg "${policy.maxValue.argPath}"=${val} exceeds policy max ${policy.maxValue.max}${policy.maxValue.unit ? ` ${policy.maxValue.unit}` : ""}`);
    }
  }

  // R98.25 — MNEMA Nugget 2: credit the action channel when a destructive call
  // makes it through every gate AND has a fresh approval. We treat "approved
  // destructive call passed all gates" as the closest proxy for action_ok we
  // can get inside this function (true ground truth = downstream tool success,
  // which lives in the executor). For destructive-without-approval we already
  // return early via block() above, so reaching here on requiresApproval means
  // hasApproval was true.
  if (policy.requiresApproval && ctx.hasApproval && ctx.personaId) {
    Promise.resolve().then(() =>
      import("../lib/restraint-trust").then(({ recordReputationOutcome }) =>
        recordReputationOutcome({
          tenantId: ctx.tenantId,
          personaId: ctx.personaId!,
          category: `tool:${toolName}`,
          outcome: "action_ok",
        }),
      ),
    ).catch((e) => logSilentCatch("server/safety/destructive-tool-policy.ts", e));
  }

  return { action: "allow", policy };
}

/** Test seam: list registered destructive tools (used by tests + admin UI). */
export function listDestructiveTools(): string[] {
  return Object.values(TOOL_POLICIES).filter((p) => p.risk === "destructive").map((p) => p.name);
}
