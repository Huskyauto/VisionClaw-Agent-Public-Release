import { db } from "./db";
import { sql } from "drizzle-orm";
import { DEFAULT_CHANNELS, CHANNEL_PERSONA_MAP, DEFAULT_EVENT_SUBSCRIPTIONS } from "./seed-channels";

export async function fixResearchProgramModels() {
  const { MODEL_REGISTRY } = await import("./providers");
  const knownIds = new Set(MODEL_REGISTRY.map((m: any) => m.id));
  const defaultModel = "gemini-3-flash-preview";

  if (knownIds.size < 5) {
    console.warn(`[seed] MODEL_REGISTRY too small (${knownIds.size}), skipping research program model fix`);
    return;
  }
  if (!knownIds.has(defaultModel)) {
    console.warn(`[seed] Default model "${defaultModel}" not in registry, skipping research program model fix`);
    return;
  }

  // This is owner seed repair, not a cross-tenant model migration.
  const rows = await db.execute(sql`SELECT id, name, model FROM research_programs WHERE tenant_id = 1 AND is_active = true`);
  const programs = (rows as any).rows || rows;
  let fixed = 0;
  for (const p of programs) {
    if (p.model && !knownIds.has(p.model)) {
      await db.execute(sql`UPDATE research_programs SET model = ${defaultModel} WHERE id = ${p.id} AND tenant_id = 1`);
      console.log(`[seed] Fixed research program "${p.name}": "${p.model}" → "${defaultModel}"`);
      fixed++;
    }
  }
  if (fixed > 0) console.log(`[seed] Fixed ${fixed} research programs with unknown models`);
}

export async function seedNightlyAutoresearch() {
  const AUTORESEARCH_PROGRAMS = [
    {
      name: "Nightly AI Model & Provider Intelligence",
      personaId: 9,
      objective: "Scan for newly released or updated AI models, providers, and API changes. Check OpenAI, Anthropic, Google, xAI, Meta, Mistral, DeepSeek, Cohere, and open-source model hubs (HuggingFace trending, Ollama library). For each experiment: identify one new model or significant update, assess its capabilities (context window, pricing, speed, specialties), and recommend whether VisionClaw should add it to the model registry. Include the model ID format, provider endpoint, and estimated cost per 1M tokens.",
      constraints: "Only recommend models with public API access or open weights. Skip models in private beta unless waitlist is open. Verify pricing from official sources. Do not recommend models that duplicate existing capabilities without clear improvement.",
      metrics: "Discovery novelty (is this actually new?), Practical value for VisionClaw agents, Cost-effectiveness vs current models, Integration feasibility",
      strategy: "balanced",
      maxExperiments: 12,
    },
    {
      name: "Nightly AI Tools & Techniques Scanner",
      personaId: 5,
      objective: "Research new AI engineering techniques, frameworks, and tools that could improve VisionClaw's agent platform. Scan: arXiv (cs.AI, cs.CL, cs.MA), GitHub trending AI repos, AI engineering blogs (Simon Willison, Lilian Weng, Chip Huyen, LangChain blog, LlamaIndex blog), and product launches. Focus on: prompt engineering advances, RAG improvements, agent orchestration patterns, memory systems, tool-use frameworks, evaluation methods, and cost optimization techniques. Each experiment should produce one actionable finding with a concrete implementation recommendation.",
      constraints: "Must be directly applicable to multi-agent platforms. Skip pure research without practical application. Prefer techniques that work with existing provider APIs. No recommendations requiring GPU infrastructure we dont have.",
      metrics: "Applicability to VisionClaw, Implementation effort estimate, Expected improvement magnitude, Evidence quality",
      strategy: "aggressive",
      maxExperiments: 15,
    },
    {
      name: "Nightly Competitive Platform Analysis",
      personaId: 9,
      objective: "Track competitive AI agent platforms, automation tools, and AI-powered business tools. Monitor: AutoGPT, CrewAI, LangGraph, OpenAI Assistants API, Anthropic tool use patterns, Google Vertex AI Agent Builder, Microsoft Copilot Studio, Relevance AI, Lindy AI, Zapier AI, Make.com AI features. For each experiment, investigate one competitor or platform update: new features, pricing changes, user feedback, architectural patterns. Identify features VisionClaw should adopt or differentiate against.",
      constraints: "Use publicly available information. Focus on features relevant to small business users. Each finding must end with a specific recommendation: build, watch, or ignore.",
      metrics: "Competitive intelligence value, Actionability, Timeliness, Strategic relevance",
      strategy: "balanced",
      maxExperiments: 10,
    },
    {
      name: "Nightly Agent Architecture Research",
      personaId: 3,
      objective: "Research advances in multi-agent system architecture, coordination patterns, and autonomous agent design. Topics: agent-to-agent communication protocols, shared memory architectures, hierarchical planning, tool composition patterns, error recovery strategies, context window optimization, token-efficient prompting, structured output techniques, streaming patterns, and agent evaluation frameworks. Each experiment should analyze one technique and propose how to integrate it into VisionClaw's existing architecture (chat-engine, heartbeat, trust engine, scaffolding).",
      constraints: "Must map to VisionClaw's TypeScript/Node.js stack. Prefer patterns that work with OpenAI-compatible APIs. Consider our 15-persona architecture (including the Planner agent). No recommendations requiring Kubernetes or distributed systems beyond our single-server deployment.",
      metrics: "Architecture fit, Performance improvement potential, Implementation complexity, Risk assessment",
      strategy: "balanced",
      maxExperiments: 10,
    },
    {
      name: "Nightly Security & Safety Intelligence",
      personaId: 14,
      objective: "Monitor AI security developments, prompt injection techniques, jailbreak patterns, and safety frameworks. Track: OWASP AI Security, NIST AI RMF updates, new prompt injection vectors, data poisoning techniques, AI-specific CVEs, PII detection advances, and responsible AI guidelines. Each experiment should identify one security concern or defense technique relevant to multi-agent platforms and recommend specific mitigations for VisionClaw's safety layer, trust engine, and governance system.",
      constraints: "Focus on defensive techniques, not offensive capabilities. Prioritize threats relevant to business AI platforms. Must be implementable without external security infrastructure. Consider our existing safety-layer.ts and trust-engine.ts.",
      metrics: "Threat relevance, Mitigation practicality, Urgency level, Coverage gap identification",
      strategy: "conservative",
      maxExperiments: 8,
    },
  ];

  let inserted = 0;
  let skipped = 0;
  const insertedIds: number[] = [];

  for (const prog of AUTORESEARCH_PROGRAMS) {
    try {
      const existing = await db.execute(sql`
        SELECT id FROM research_programs WHERE tenant_id = 1 AND name = ${prog.name}
      `);
      const rows = (existing as any).rows || existing;
      if (rows.length > 0) {
        skipped++;
        insertedIds.push(rows[0].id);
        continue;
      }

      const res = await db.execute(sql`
        INSERT INTO research_programs (tenant_id, persona_id, name, objective, constraints, metrics, exploration_strategy, model, max_experiments_per_session)
        VALUES (1, ${prog.personaId}, ${prog.name}, ${prog.objective}, ${prog.constraints}, ${prog.metrics}, ${prog.strategy}, 'gemini-3-flash-preview', ${prog.maxExperiments})
        RETURNING id
      `);
      const resRows = (res as any).rows || res;
      if (resRows[0]?.id) insertedIds.push(resRows[0].id);
      inserted++;
    } catch (err: any) {
      console.warn(`[seed] Autoresearch program "${prog.name}" failed: ${err.message}`);
    }
  }

  const schedExists = await db.execute(sql`
    SELECT id FROM research_schedules WHERE tenant_id = 1
  `).catch(() => ({ rows: [] }));
  const schedRows = (schedExists as any).rows || schedExists;

  if (schedRows.length === 0 && insertedIds.length > 0) {
    const staggeredSchedules = [
      { name: "Research: AI Models & Providers", hour: 1, minute: 0, programIndex: 0 },
      { name: "Research: AI Tools & Techniques", hour: 2, minute: 30, programIndex: 1 },
      { name: "Research: Competitive Analysis", hour: 4, minute: 0, programIndex: 2 },
      { name: "Research: Agent Architecture", hour: 5, minute: 30, programIndex: 3 },
      { name: "Research: Security & Safety", hour: 7, minute: 0, programIndex: 4 },
    ];

    for (const sched of staggeredSchedules) {
      const programId = insertedIds[sched.programIndex];
      if (!programId) continue;
      const nextRun = new Date();
      nextRun.setHours(sched.hour, sched.minute, 0, 0);
      if (nextRun.getTime() < Date.now()) nextRun.setDate(nextRun.getDate() + 1);

      await db.execute(sql`
        INSERT INTO research_schedules (tenant_id, name, cron_expression, timezone, is_enabled, run_all, program_id, next_run_at)
        VALUES (1, ${sched.name}, ${`${sched.minute} ${sched.hour} * * *`}, 'America/Chicago', true, false, ${programId}, ${nextRun})
      `).catch((e: any) => console.warn(`[seed] Schedule "${sched.name}" failed: ${e.message}`));
    }
    console.log(`[seed] Autoresearch: created ${staggeredSchedules.length} staggered schedules (1:00 AM - 7:00 AM CT)`);
  }

  if (inserted > 0) console.log(`[seed] Autoresearch: seeded ${inserted} nightly research programs, ${skipped} already existed`);
  else if (skipped > 0) console.log(`[seed] Autoresearch: all ${AUTORESEARCH_PROGRAMS.length} nightly programs already exist`);
}

export async function seedGovernanceRules() {
  const RULES = [
    { n: "disable-dead-subscriptions", c: "resource_management", d: "Auto-disable event subscriptions with zero matching activity for 30+ days", cond: '{"check":"subscription_activity","value":0,"metric":"activity_count","operator":"equals","lookback_days":30}', a: "disable_subscription", ac: '{"log_reason":true,"notify_channel":"#system-alerts"}', e: false, p: 6 },
    { n: "enable-justified-subscriptions", c: "resource_management", d: "Auto-enable subscriptions when real business activity is detected", cond: '{"check":"subscription_activity","value":0,"metric":"activity_count","operator":"greater_than"}', a: "enable_subscription", ac: '{"log_reason":true,"notify_channel":"#system-alerts"}', e: false, p: 7 },
    { n: "kill-failing-tasks", c: "resource_management", d: "Auto-disable heartbeat tasks with 100% failure rate over 7 days (5+ attempts)", cond: '{"check":"task_failure_rate","value":1,"metric":"failure_rate","operator":"equals","min_attempts":5,"lookback_days":7}', a: "disable_task", ac: '{"log_reason":true,"notify_channel":"#system-alerts"}', e: false, p: 8 },
    { n: "block-task-cascades", c: "resource_management", d: "Block agent-created tasks that spawn more tasks from within heartbeat context", cond: '{"check":"delegation_source","value":["persona_heartbeat","task_heartbeat"],"metric":"source_type","operator":"in"}', a: "block_delegation", ac: '{"log_reason":true}', e: false, p: 9 },
    { n: "daily-token-budget-warning", c: "cost_control", d: "Throttle non-essential tasks when daily AI token spend exceeds 80% of budget", cond: '{"check":"daily_spend","value":80,"metric":"spend_percent","operator":"greater_than"}', a: "throttle_tasks", ac: '{"keep_types":["delegation","process_governance","agentic_engine"],"throttle_types":["reflection","self_improvement","content"]}', e: false, p: 7 },
    { n: "daily-token-budget-critical", c: "cost_control", d: "Escalate when daily AI token spend exceeds 200% of budget", cond: '{"check":"daily_spend","value":200,"metric":"spend_percent","operator":"greater_than"}', a: "escalate", ac: '{"message":"Daily AI spend has exceeded 2x the configured budget. Non-essential tasks have been paused.","pause_non_essential":true}', e: true, p: 10 },
    { n: "auto-restart-stalled-agents", c: "operations", d: "Re-enable agents stalled for 24+ hours with pending queue items", cond: '{"check":"desk_status","value":24,"metric":"stalled_hours","operator":"greater_than","has_pending":true}', a: "restart_agent", ac: '{"log_reason":true,"notify_channel":"#system-alerts"}', e: false, p: 6 },
    { n: "watchlist-alert-routing", c: "operations", d: "Auto-route watchlist alerts to the most relevant persona", cond: '{"check":"watchlist_alert","value":0,"metric":"unacknowledged","operator":"greater_than"}', a: "route_alert", ac: '{"routing":{"customer":"Apollo","industry":"Neptune","competitor":"Radar","regulation":"Cassandra","technology":"Forge"}}', e: false, p: 5 },
    { n: "provider-key-failure-escalate", c: "security", d: "Escalate when all provider keys for a model tier fail simultaneously", cond: '{"check":"provider_health","value":0,"metric":"tier_available","operator":"equals"}', a: "escalate", ac: '{"message":"All AI provider keys for a model tier have failed."}', e: true, p: 10 },
    { n: "auth-anomaly-detection", c: "security", d: "Escalate on 10+ failed login attempts in 1 hour", cond: '{"check":"auth_failures","value":10,"metric":"failed_attempts","operator":"greater_than","window_hours":1}', a: "escalate", ac: '{"action":"block_source","message":"Potential brute-force login attempt detected."}', e: true, p: 10 },
    { n: "slow-response-detection", c: "performance", d: "Investigate when average agent response time exceeds 30 seconds", cond: '{"check":"response_time","value":30000,"metric":"avg_duration_ms","operator":"greater_than","window_hours":1}', a: "investigate", ac: '{"assign_to":"Agent Blueprint","notify_channel":"#system-alerts"}', e: false, p: 5 },
    { n: "queue-depth-warning", c: "performance", d: "Alert when any agent desk has 10+ pending queue items", cond: '{"check":"desk_queue","value":10,"metric":"queue_depth","operator":"greater_than"}', a: "rebalance", ac: '{"strategy":"redistribute","notify_channel":"#system-alerts"}', e: false, p: 6 },
    { n: "content-review-enforcement", c: "compliance", d: "Ensure all Scribe content goes through Proof before publishing", cond: '{"check":"content_pipeline","value":0,"metric":"unreviewed_content","operator":"greater_than","source_persona":"Scribe"}', a: "enforce_review", ac: '{"block_publish":true,"require_persona":"Proof"}', e: false, p: 8 },
    { n: "autonomy-override-escalate", c: "compliance", d: "Escalate when an agent attempts blocked actions 3+ times in 24h", cond: '{"check":"autonomy_violation","value":3,"metric":"blocked_attempts","operator":"greater_than","window_hours":24}', a: "escalate", ac: '{"message":"An agent has repeatedly attempted a blocked action."}', e: true, p: 9 },
    { n: "cascading-failure-detection", c: "security", d: "Detect when 3+ agents fail in sequence within 30 minutes", cond: '{"check":"cascading_failures","value":2,"metric":"distinct_failing_agents","operator":"greater_than","window_minutes":30}', a: "escalate", ac: '{"message":"Cascading failure detected: 3+ agents failing in sequence.","pause_non_essential":true}', e: true, p: 10 },
    { n: "rogue-agent-detection", c: "security", d: "Detect agent with 5+ out-of-scope actions in 24 hours", cond: '{"check":"agent_scope_violations","value":5,"metric":"out_of_scope_actions","operator":"greater_than","window_hours":24}', a: "escalate", ac: '{"message":"Possible rogue agent behavior detected.","disable_agent":true}', e: true, p: 10 },
    { n: "delegation-chain-depth-limit", c: "security", d: "Prevent delegation chains deeper than 2 levels", cond: '{"check":"delegation_depth","value":2,"metric":"max_chain_depth","operator":"greater_than"}', a: "block_delegation", ac: '{"max_depth":2,"log_reason":true,"notify_channel":"#system-alerts"}', e: false, p: 9 },
    { n: "memory-integrity-check", c: "security", d: "Detect anomalous memory writes — 20+ entries in single session", cond: '{"check":"memory_write_rate","value":20,"metric":"writes_per_session","operator":"greater_than","window_hours":1}', a: "investigate", ac: '{"assign_to":"Agent Blueprint","cap_writes":true,"notify_channel":"#system-alerts"}', e: false, p: 7 },
    { n: "agent-action-boundaries", c: "compliance", d: "Enforce agents only use tools assigned to their persona", cond: '{"check":"tool_boundary_violations","value":3,"metric":"unauthorized_tool_attempts","operator":"greater_than","window_hours":24}', a: "investigate", ac: '{"assign_to":"Agent Blueprint","restrict_tools":true}', e: false, p: 8 },
    { n: "emergency-kill-switch", c: "security", d: "Disable all non-essential operations in critical state", cond: '{"check":"system_critical_state","value":0,"metric":"critical_failures","operator":"greater_than"}', a: "kill_switch", ac: '{"message":"Emergency kill switch activated.","protected_personas":[5,6]}', e: true, p: 10 },
    { n: "purpose-binding-enforcement", c: "compliance", d: "Monitor for persona drift from defined specialization", cond: '{"check":"purpose_drift","value":0.5,"metric":"off_topic_ratio","operator":"greater_than","window_hours":48}', a: "investigate", ac: '{"assign_to":"Chief of Staff","notify_channel":"#system-alerts"}', e: false, p: 6 },
    { n: "segregation-of-duties", c: "compliance", d: "No single agent controls end-to-end sensitive workflows", cond: '{"check":"duty_segregation","value":0,"metric":"single_agent_sensitive_workflows","operator":"greater_than"}', a: "block_delegation", ac: '{"sensitive_actions":["payment_action","publish_content","send_email","execute_shell"],"require_different_agent":true}', e: false, p: 8 },
    { n: "conflict-of-interest-prevention", c: "compliance", d: "Agents cannot approve or review their own work", cond: '{"check":"self_approval","value":0,"metric":"self_approved_actions","operator":"greater_than"}', a: "block_delegation", ac: '{"enforce_different_reviewer":true}', e: false, p: 8 },
    { n: "pii-handling-enforcement", c: "compliance", d: "Block PII exposure in external-facing outputs", cond: '{"check":"pii_exposure","value":0,"metric":"pii_in_output","context":"external","operator":"greater_than"}', a: "block_delegation", ac: '{"scan_outputs":true,"block_external":true,"notify_channel":"#system-alerts"}', e: false, p: 9 },
    { n: "change-management-audit", c: "operations", d: "Track all changes to agent configurations", cond: '{"check":"config_changes","value":0,"metric":"unlogged_changes","operator":"greater_than"}', a: "log_change", ac: '{"track":["persona_config","autonomy_rules","governance_rules","tool_assignments","event_subscriptions"]}', e: false, p: 5 },
    { n: "audit-log-retention", c: "compliance", d: "Ensure governance logs are retained properly", cond: '{"check":"log_retention","value":365,"metric":"oldest_log_days","operator":"less_than"}', a: "investigate", ac: '{"assign_to":"Agent Blueprint","notify_channel":"#system-alerts"}', e: false, p: 6 },
    { n: "per-agent-token-budget", c: "cost_control", d: "Throttle agents consuming more than 30% of daily total", cond: '{"check":"agent_spend_ratio","value":30,"metric":"agent_percent_of_total","operator":"greater_than"}', a: "throttle_tasks", ac: '{"cap_percent":30,"notify_channel":"#system-alerts","throttle_agent":true}', e: false, p: 7 },
    { n: "business-hours-scheduling", c: "operations", d: "Reduce non-essential agent activity during off-hours", cond: '{"check":"time_of_day","value":true,"metric":"off_hours","operator":"equals"}', a: "throttle_tasks", ac: '{"keep_types":["process_governance","agentic_engine","cloud_backup"],"throttle_types":["reflection","self_improvement","content","delegation"],"reduce_frequency":true}', e: false, p: 4 },
    { n: "agent-workload-balance", c: "operations", d: "Detect severe task distribution imbalance across agents", cond: '{"check":"workload_balance","value":5,"metric":"max_vs_avg_ratio","operator":"greater_than"}', a: "rebalance", ac: '{"strategy":"redistribute_to_underloaded","notify_channel":"#system-alerts"}', e: false, p: 5 },
    { n: "model-failover-health", c: "performance", d: "Investigate when 40%+ of requests require failover", cond: '{"check":"failover_rate","value":40,"metric":"failover_percent","operator":"greater_than","window_hours":1}', a: "investigate", ac: '{"assign_to":"Agent Blueprint","notify_channel":"#system-alerts"}', e: false, p: 6 },
    { n: "governance_framework_review", c: "compliance", d: "Review governance frameworks when review date has passed", cond: '{"check":"framework_review_due"}', a: "review_frameworks", ac: '{"notify_channel":"#system-alerts"}', e: false, p: 3 },
    { n: "trust_score_update", c: "agency_expansion", d: "Log trust score changes for audit trail", cond: '{"check":"trust_score_update"}', a: "log_trust_change", ac: '{"notify_channel":"#system-alerts"}', e: false, p: 3 },
    { n: "trust_score_critical_drop", c: "agency_expansion", d: "Lock agents whose trust scores drop to critical levels (<=25)", cond: '{"check":"trust_score_critical","threshold":25}', a: "lock_agent_autonomy", ac: '{"notify_channel":"#system-alerts"}', e: true, p: 9 },
    { n: "proactive_action_quality_monitor", c: "agency_expansion", d: "Alert when negative proactive outcome ratio exceeds 30%", cond: '{"check":"proactive_action_quality","threshold":0.3}', a: "suspend_proactive", ac: '{"notify_channel":"#system-alerts"}', e: true, p: 6 },
    { n: "proactive_action_budget_enforcement", c: "agency_expansion", d: "Enforce daily PAB limits per agent", cond: '{"check":"proactive_action_budget"}', a: "enforce_pab_limit", ac: '{"notify_channel":"#system-alerts"}', e: false, p: 5 },
    { n: "express_lane_health_monitor", c: "agency_expansion", d: "Monitor and alert on auto-suspended express lanes", cond: '{"check":"express_lane_health"}', a: "alert_lane_health", ac: '{"notify_channel":"#system-alerts"}', e: false, p: 5 },
    { n: "express_lane_volume_cap", c: "agency_expansion", d: "Enforce daily volume caps on express lanes", cond: '{"check":"express_lane_volume","cap":10}', a: "cap_lane_volume", ac: '{"notify_channel":"#system-alerts"}', e: false, p: 4 },
    { n: "environmental_signal_escalation", c: "agency_expansion", d: "Escalate URGENT/CRITICAL signals not handled within 1 hour", cond: '{"check":"environmental_signal_escalation"}', a: "escalate_signal", ac: '{"notify_channel":"#system-alerts"}', e: true, p: 8 },
    { n: "collective_intelligence_budget", c: "agency_expansion", d: "Enforce daily limits on expensive CI protocols", cond: '{"check":"collective_intelligence_budget"}', a: "cap_ci_protocols", ac: '{"notify_channel":"#system-alerts"}', e: false, p: 5 },
    { n: "earned_autonomy_audit", c: "agency_expansion", d: "Periodic audit of earned autonomy levels", cond: '{"check":"earned_autonomy_audit"}', a: "audit_autonomy", ac: '{"notify_channel":"#system-alerts"}', e: false, p: 3 },
    // R114 — AEvo Meta-Editing of Procedure Context (Zhang et al., arXiv:2605.13821).
    // Every apply_procedure_edit / rollback_procedure_edit ALWAYS routes through
    // HITL — destructive HIGH + requiresApproval. The propose/review surface is
    // agent-callable but the file mutation is human-gated.
    // R115 +sec — JS string literal "\\.agents/skills/" becomes runtime "\.agents/skills/"
    // which is an INVALID JSON escape; postgres ::jsonb cast rejects it and the
    // INSERT silently warns + skips. Doubled to "\\\\.agents/skills/" so the
    // runtime string contains "\\.agents/skills/" — a valid JSON escape that
    // parses back to the literal "\.agents/skills/" inside the forbidden_patterns
    // array. Caught by R115 post-edit code review log scan.
    { n: "procedure_edit_governance", c: "compliance", d: "HITL approval required on every apply_procedure_edit and rollback_procedure_edit; edit surface allowlist is hardcoded to output_skill only; validator fail-CLOSED on safety_profile / intentGate / doctrine / persona souls / .agents/skills/ / TOOL_POLICIES patterns; CAS sha256 pin verified at apply time", cond: '{"check":"procedure_edit_apply","value":0,"metric":"unapproved_apply","operator":"greater_than"}', a: "block_delegation", ac: '{"require_hitl":true,"editable_surfaces":["output_skill"],"forbidden_patterns":["safety_profile","intentGate","restrictedCategories","destructiveToolPolicy","refusalCopy","AHB regression","\\\\.agents/skills/","TOOL_POLICIES","doctrine","persona_soul"],"min_evidence_count":3,"size_bounds":{"min":0.5,"max":2.0}}', e: true, p: 10 },
  ];

  let inserted = 0;
  let skipped = 0;
  for (const r of RULES) {
    try {
      const res = await db.execute(sql`
        INSERT INTO governance_rules (tenant_id, category, rule_name, description, condition, action, action_config, escalate_to_human, priority, enabled)
        SELECT 1, ${r.c}, ${r.n}, ${r.d}, ${r.cond}::jsonb, ${r.a}, ${r.ac}::jsonb, ${r.e}, ${r.p}, true
        WHERE NOT EXISTS (SELECT 1 FROM governance_rules WHERE tenant_id = 1 AND rule_name = ${r.n})
      `);
      const rowCount = (res as any).rowCount ?? (res as any).rows?.length ?? 0;
      if (rowCount > 0) inserted++;
      else skipped++;
    } catch (err: any) {
      console.warn(`[seed] Governance rule "${r.n}" failed: ${err.message}`);
    }
  }
  if (inserted > 0) console.log(`[seed] Seeded ${inserted} governance rules (${skipped} already existed, ${RULES.length} total defined)`);
  else if (skipped > 0) console.log(`[seed] All ${RULES.length} governance rules already exist`);
}

export async function seedAgenticInfrastructure() {
  try {
    const channelCheck = await db.execute(sql`SELECT COUNT(*) as cnt FROM agent_channels WHERE tenant_id = 1`);
    const channelCount = parseInt(((channelCheck as any).rows || channelCheck)?.[0]?.cnt || "0");
    if (channelCount === 0) {
      for (const ch of DEFAULT_CHANNELS) {
        await db.execute(sql`
          INSERT INTO agent_channels (tenant_id, name, description, type)
          VALUES (1, ${ch.name}, ${ch.description}, ${ch.type})
          ON CONFLICT (tenant_id, name) DO NOTHING
        `);
      }
      console.log(`[seed] Created ${DEFAULT_CHANNELS.length} default agent channels`);

      const allPersonas = await db.execute(sql`SELECT id, name FROM personas`);
      const personaRows = (allPersonas as any).rows || allPersonas;
      const personaMap = new Map<string, number>();
      for (const p of personaRows) personaMap.set(p.name, p.id);

      const channels = await db.execute(sql`SELECT id, name FROM agent_channels WHERE tenant_id = 1`);
      const channelRows = (channels as any).rows || channels;
      const channelMap = new Map<string, number>();
      for (const c of channelRows) channelMap.set(c.name, c.id);

      for (const [channelName, personaNames] of Object.entries(CHANNEL_PERSONA_MAP)) {
        const channelId = channelMap.get(channelName);
        if (!channelId) continue;

        const targetPersonas = personaNames[0] === "all"
          ? Array.from(personaMap.values())
          : personaNames.map(n => personaMap.get(n)).filter(Boolean) as number[];

        for (const personaId of targetPersonas) {
          await db.execute(sql`
            INSERT INTO channel_subscriptions (tenant_id, channel_id, persona_id, priority)
            VALUES (1, ${channelId}, ${personaId}, 'normal')
            ON CONFLICT (channel_id, persona_id) DO NOTHING
          `);
        }
      }
      console.log("[seed] Created default channel subscriptions");
    }

    const eventSubCheck = await db.execute(sql`SELECT COUNT(*) as cnt FROM event_subscriptions WHERE tenant_id = 1`);
    const eventSubCount = parseInt(((eventSubCheck as any).rows || eventSubCheck)?.[0]?.cnt || "0");
    if (eventSubCount === 0) {
      const allPersonas = await db.execute(sql`SELECT id, name FROM personas`);
      const personaRows = (allPersonas as any).rows || allPersonas;
      const personaMap = new Map<string, number>();
      for (const p of personaRows) personaMap.set(p.name, p.id);

      for (const sub of DEFAULT_EVENT_SUBSCRIPTIONS) {
        const personaId = personaMap.get(sub.personaName);
        if (!personaId) continue;
        await db.execute(sql`
          INSERT INTO event_subscriptions (tenant_id, event_type, persona_id, action, priority, enabled)
          VALUES (1, ${sub.eventType}, ${personaId}, ${sub.action}, ${sub.priority}, ${sub.enabled !== false})
        `);
      }
      console.log(`[seed] Created ${DEFAULT_EVENT_SUBSCRIPTIONS.length} default event subscriptions`);
    }
  } catch (err: any) {
    console.error("[seed] Agentic infrastructure seed error:", err.message);
  }
}
