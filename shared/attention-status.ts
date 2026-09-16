/**
 * Event-bus states that still require attention on the owner dashboard.
 * "routed" means a subscriber received the event, not that its work was
 * completed or acknowledged.
 */
export const ACTIVE_ATTENTION_EVENT_STATUSES = ["pending", "routed"] as const;

export function isActiveAttentionEventStatus(status: unknown): boolean {
  return typeof status === "string" &&
    (ACTIVE_ATTENTION_EVENT_STATUSES as readonly string[]).includes(status);
}