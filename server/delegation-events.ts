import { EventEmitter } from "events";

export interface DelegationEvent {
  id: string;
  conversationId: number;
  tenantId?: number;
  timestamp: number;
  type: "started" | "thinking" | "tool_call" | "sub_delegation" | "progress" | "completed" | "error" | "warning" | "failed";
  agentName: string;
  agentRole?: string;
  message: string;
  parentAgent?: string;
  depth: number;
  metadata?: Record<string, any>;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const recentEvents = new Map<number, DelegationEvent[]>();
const MAX_EVENTS_PER_CONV = 50;
const EVENT_TTL_MS = 5 * 60 * 1000;

let eventCounter = 0;

export function emitDelegationEvent(event: Omit<DelegationEvent, "id" | "timestamp">) {
  const full: DelegationEvent = {
    ...event,
    id: `de_${++eventCounter}_${Date.now()}`,
    timestamp: Date.now(),
  };

  const convEvents = recentEvents.get(event.conversationId) || [];
  convEvents.push(full);
  if (convEvents.length > MAX_EVENTS_PER_CONV) convEvents.shift();
  recentEvents.set(event.conversationId, convEvents);

  emitter.emit("delegation", full);
  emitter.emit(`delegation:${event.conversationId}`, full);

  console.log(`[delegation-event] [${event.type}] ${event.agentName}: ${event.message}`);
}

export function subscribeToDelegation(conversationId: number, callback: (event: DelegationEvent) => void): () => void {
  const handler = (event: DelegationEvent) => callback(event);
  emitter.on(`delegation:${conversationId}`, handler);
  return () => emitter.off(`delegation:${conversationId}`, handler);
}

export function subscribeToAllDelegations(callback: (event: DelegationEvent) => void, tenantId?: number): () => void {
  const handler = (event: DelegationEvent) => {
    if (tenantId && event.tenantId && event.tenantId !== tenantId) return;
    callback(event);
  };
  emitter.on("delegation", handler);
  return () => emitter.off("delegation", handler);
}

export function getRecentEvents(conversationId: number, since?: number, tenantId?: number): DelegationEvent[] {
  const events = recentEvents.get(conversationId) || [];
  let filtered = events;
  if (tenantId) filtered = filtered.filter(e => !e.tenantId || e.tenantId === tenantId);
  if (since) filtered = filtered.filter(e => e.timestamp > since);
  return [...filtered];
}

export function clearOldEvents() {
  const cutoff = Date.now() - EVENT_TTL_MS;
  for (const [convId, events] of recentEvents.entries()) {
    const filtered = events.filter(e => e.timestamp > cutoff);
    if (filtered.length === 0) recentEvents.delete(convId);
    else recentEvents.set(convId, filtered);
  }
}

setInterval(clearOldEvents, 60_000);

export function generateNarration(event: DelegationEvent): string {
  switch (event.type) {
    case "started":
      return event.parentAgent
        ? `I'm bringing in ${event.agentName} to help with this. ${event.message}`
        : `Let me work on this. ${event.message}`;
    case "thinking":
      return event.message;
    case "tool_call":
      return `${event.agentName} is ${event.message}`;
    case "sub_delegation":
      return `${event.agentName} is bringing in ${event.metadata?.targetAgent || "another specialist"}. ${event.message}`;
    case "progress":
      return event.message;
    case "completed":
      return event.parentAgent
        ? `${event.agentName} finished their part. ${event.message}`
        : event.message;
    case "error":
      return `There was a hiccup with ${event.agentName}, but we're handling it. ${event.message}`;
    default:
      return event.message;
  }
}
