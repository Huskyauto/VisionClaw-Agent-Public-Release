/**
 * seed-channels.ts — extracted from seed.ts (girth-gate ratchet fix, 2026-07-31;
 * mechanical move, zero behavior change). Static seed data for the default
 * agent channels, channel→persona membership, and default event subscriptions.
 * Consumed only by seedAgenticInfrastructure() in seed.ts.
 */

export const DEFAULT_CHANNELS = [
  { name: "#general", description: "General announcements and cross-team communication", type: "topic" },
  { name: "#content-pipeline", description: "Content briefs, drafts, reviews, and publishing", type: "topic" },
  { name: "#revenue-alerts", description: "Deal updates, payment events, and pipeline changes", type: "topic" },
  { name: "#engineering", description: "Technical tasks, bug reports, and deployment updates", type: "topic" },
  { name: "#intelligence", description: "Market intelligence, competitor alerts, and research findings", type: "topic" },
  { name: "#daily-standup", description: "Daily standup summaries from Chief of Staff", type: "broadcast" },
  { name: "#system-alerts", description: "System health, backup status, and infrastructure alerts", type: "broadcast" },
  { name: "#okr-updates", description: "OKR progress updates and sprint plan changes", type: "topic" },
  { name: "#approvals", description: "Pending human approval requests", type: "broadcast" },
];

export const CHANNEL_PERSONA_MAP: Record<string, string[]> = {
  "#general": ["all"],
  "#daily-standup": ["all"],
  "#content-pipeline": ["Teagan", "Scribe", "Proof", "Felix"],
  "#revenue-alerts": ["Apollo", "Cassandra", "Felix", "Atlas"],
  "#engineering": ["Forge", "Agent Blueprint"],
  "#intelligence": ["Radar", "Neptune", "Felix", "Apollo"],
  "#system-alerts": ["Agent Blueprint", "Forge"],
  "#okr-updates": ["Felix", "Atlas", "Chief of Staff"],
  "#approvals": ["Felix"],
};

export const DEFAULT_EVENT_SUBSCRIPTIONS = [
  { eventType: "agent.task.completed", personaName: "Chief of Staff", action: "process", priority: 6, enabled: true },
  { eventType: "agent.task.failed", personaName: "Chief of Staff", action: "process", priority: 8, enabled: true },
  { eventType: "system.health.degraded", personaName: "Agent Blueprint", action: "notify", priority: 10, enabled: true },
  { eventType: "monitor.alert", personaName: "Radar", action: "process", priority: 8, enabled: true },
  { eventType: "payment.failed", personaName: "Apollo", action: "process", priority: 9, enabled: false },
  { eventType: "payment.succeeded", personaName: "Cassandra", action: "process", priority: 5, enabled: false },
  { eventType: "payment.subscription.created", personaName: "Apollo", action: "process", priority: 7, enabled: false },
  { eventType: "email.received", personaName: "Radar", action: "process", priority: 5, enabled: false },
  { eventType: "content.published", personaName: "Atlas", action: "process", priority: 5, enabled: false },
];
