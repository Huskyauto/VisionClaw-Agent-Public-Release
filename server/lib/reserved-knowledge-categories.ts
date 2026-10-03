// Reserved agent_knowledge categories that carry TRUST/ROUTING semantics and
// must NOT be writable by generic/agentic knowledge writers.
//
// `messaging_pairing` maps an inbound phone/channel to a tenant+conversation
// (server/twilio.ts). Allowing an arbitrary tenant-scoped agent (via the
// generic create_knowledge tool) or a model-produced heartbeat knowledge task
// to write it let a hostile tenant pre-claim a victim's phone or force a
// fail-closed drop — a cross-tenant SMS/WhatsApp hijack / targeted DoS
// (post-edit-code-review HIGH, 2026-07-09). Only the dedicated authenticated
// pairing path may create these rows (storage.createKnowledge accepts an
// explicit allowReservedCategory override for that single caller).
export const RESERVED_KNOWLEDGE_CATEGORIES = new Set<string>([
  "messaging_pairing",
  // Platform operational runbooks are authoritative only when written by the
  // vetted Agent Knowledge Refresh path. Generic tenant writes must never
  // mint a row that an agent could mistake for one.
  "agent_skill",
]);

export const PLATFORM_MANAGED_KNOWLEDGE_SOURCES = new Set<string>([
  "agent_skill",
  "output_skill",
  "release_log",
  "loop_contract",
  "platform_briefing",
  "knowledge_compile",
]);

export function isReservedKnowledgeCategory(category: unknown): boolean {
  return typeof category === "string"
    && RESERVED_KNOWLEDGE_CATEGORIES.has(category.trim().toLowerCase());
}

export function isPlatformManagedKnowledgeSource(source: unknown): boolean {
  return typeof source === "string"
    && PLATFORM_MANAGED_KNOWLEDGE_SOURCES.has(source.trim().toLowerCase());
}
