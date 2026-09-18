import type { UnifiedSource } from "./unified-context";

export type MemoryLifecycleSource =
  | UnifiedSource
  | "compaction_archives"
  | "messages"
  | "graph_memory_links"
  | "memory_links"
  | "skills"
  | "knowledge_nudges";

export const MEMORY_LIFECYCLE_SOURCES: readonly MemoryLifecycleSource[] = [
  "memory_entries",
  "agent_knowledge",
  "conversation_facts",
  "graph_memory",
  "knowledge_triples",
  "compaction_archives",
  "messages",
  "graph_memory_links",
  "memory_links",
  "skills",
  "knowledge_nudges",
  "mind_tickets",
  "procedure_edits",
  "agent_runs",
  "agent_trace_spans",
  "mind_events",
  "conversations",
] as const;

/** Durable operational state: every cursor is a source-local numeric id. */
export type MemoryForgettingCursorMap = Partial<Record<MemoryLifecycleSource, number>>;

export type MemorySourceKind =
  | "semantic_memory"
  | "episodic_memory"
  | "derived_memory"
  | "procedural_memory"
  | "protected_evidence"
  | "container"
  | "unknown";

const SOURCE_KINDS: Record<MemoryLifecycleSource, MemorySourceKind> = {
  memory_entries: "semantic_memory",
  agent_knowledge: "semantic_memory",
  conversation_facts: "semantic_memory",
  graph_memory: "semantic_memory",
  knowledge_triples: "semantic_memory",
  compaction_archives: "episodic_memory",
  messages: "episodic_memory",
  graph_memory_links: "derived_memory",
  memory_links: "derived_memory",
  skills: "procedural_memory",
  knowledge_nudges: "derived_memory",
  mind_tickets: "protected_evidence",
  procedure_edits: "protected_evidence",
  agent_runs: "protected_evidence",
  agent_trace_spans: "protected_evidence",
  mind_events: "protected_evidence",
  conversations: "container",
};

export function classifyMemorySource(source: string): { kind: MemorySourceKind } {
  return {
    kind: Object.prototype.hasOwnProperty.call(SOURCE_KINDS, source)
      ? SOURCE_KINDS[source as MemoryLifecycleSource]
      : "unknown",
  };
}

export interface SourceRetentionRule {
  archiveAfterDays: number | null;
  purgeArchivedAfterDays: number | null;
  minimumAccessCountToRetain: number;
}

export interface MemoryRetentionPolicy {
  version: number;
  sources: Partial<Record<MemoryLifecycleSource, SourceRetentionRule>>;
}

export const defaultMemoryRetentionPolicy: MemoryRetentionPolicy = {
  version: 1,
  sources: {
    memory_entries: {
      archiveAfterDays: 180,
      purgeArchivedAfterDays: 365,
      minimumAccessCountToRetain: 6,
    },
    conversation_facts: {
      archiveAfterDays: 30,
      purgeArchivedAfterDays: 180,
      minimumAccessCountToRetain: 3,
    },
    agent_knowledge: {
      archiveAfterDays: 365,
      purgeArchivedAfterDays: null,
      minimumAccessCountToRetain: 5,
    },
    compaction_archives: {
      archiveAfterDays: null,
      purgeArchivedAfterDays: 365,
      minimumAccessCountToRetain: 0,
    },
  },
};

export interface MemoryLifecycleCandidate {
  /** Source-local primary key. It is deliberately not used in policy decisions. */
  id?: string | number;
  /** Adapters should return this as a defence-in-depth tenant check. */
  tenantId?: number;
  source: MemoryLifecycleSource;
  status: string | null;
  createdAt: string | Date;
  lastAccessedAt: string | Date | null;
  expiresAt: string | Date | null;
  archivedAt?: string | Date | null;
  accessCount: number;
}

export type MemoryLifecycleCandidatePage = MemoryLifecycleCandidate[] & {
  /** Cursor after the last row read for each source. */
  nextCursors?: MemoryForgettingCursorMap;
};

export type MemoryLifecycleDecision =
  | { action: "keep"; reasonCode: "protected_evidence" | "no_automatic_policy" | "within_retention" | "invalid_timestamp" }
  | { action: "archive"; reasonCode: "explicit_expiry" | "retention_age" }
  | { action: "purge"; reasonCode: "archived_retention_age" };

const DAY_MS = 86_400_000;

function timeMs(value: string | Date | null): number | null {
  if (value === null) return null;
  const n = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

function ageDays(value: string | Date | null, nowMs: number): number | null {
  const n = timeMs(value);
  if (n === null || n > nowMs) return null;
  return (nowMs - n) / DAY_MS;
}

function isArchivedStatus(status: string | null): boolean {
  return status === "archived" || status === "expired" || status === "superseded" || status === "phantom";
}

export function decideMemoryLifecycleAction(
  candidate: MemoryLifecycleCandidate,
  policy: MemoryRetentionPolicy,
  nowMs = Date.now(),
): MemoryLifecycleDecision {
  const kind = classifyMemorySource(candidate.source).kind;
  if (kind === "protected_evidence" || kind === "container") {
    return { action: "keep", reasonCode: "protected_evidence" };
  }

  const rule = policy.sources[candidate.source];
  if (!rule) return { action: "keep", reasonCode: "no_automatic_policy" };

  const createdAge = ageDays(candidate.createdAt, nowMs);
  const accessAge = ageDays(candidate.lastAccessedAt ?? candidate.createdAt, nowMs);
  if (createdAge === null || accessAge === null) {
    return { action: "keep", reasonCode: "invalid_timestamp" };
  }

  const expiryMs = timeMs(candidate.expiresAt);
  if (!isArchivedStatus(candidate.status) && expiryMs !== null && expiryMs <= nowMs) {
    return { action: "archive", reasonCode: "explicit_expiry" };
  }

  if (isArchivedStatus(candidate.status)) {
    const purgeAfter = rule.purgeArchivedAfterDays;
    const archivedAge = ageDays(candidate.archivedAt ?? null, nowMs);
    if (purgeAfter !== null && archivedAge !== null && archivedAge >= purgeAfter) {
      return { action: "purge", reasonCode: "archived_retention_age" };
    }
    return { action: "keep", reasonCode: "within_retention" };
  }

  const archiveAfter = rule.archiveAfterDays;
  if (
    archiveAfter !== null
    && accessAge >= archiveAfter
    && candidate.accessCount < rule.minimumAccessCountToRetain
  ) {
    return { action: "archive", reasonCode: "retention_age" };
  }

  return { action: "keep", reasonCode: "within_retention" };
}