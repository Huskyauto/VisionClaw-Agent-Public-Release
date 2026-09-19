import test from "node:test";
import assert from "node:assert/strict";
import {
  MEMORY_LIFECYCLE_SOURCES,
  classifyMemorySource,
  decideMemoryLifecycleAction,
  defaultMemoryRetentionPolicy,
} from "../../server/memory/forgetting-policy";
import { ALL_UNIFIED_SOURCES } from "../../server/memory/unified-context";

test("every unified-memory source has an explicit lifecycle classification", () => {
  for (const source of ALL_UNIFIED_SOURCES) {
    assert.notEqual(classifyMemorySource(source).kind, "unknown", source);
  }
  assert.ok(MEMORY_LIFECYCLE_SOURCES.includes("compaction_archives"));
  assert.ok(MEMORY_LIFECYCLE_SOURCES.includes("skills"));
});

test("operational evidence is never automatically expired or purged", () => {
  for (const source of [
    "procedure_edits",
    "agent_runs",
    "agent_trace_spans",
    "mind_events",
  ] as const) {
    assert.equal(classifyMemorySource(source).kind, "protected_evidence");
    assert.deepEqual(
      decideMemoryLifecycleAction({
        source,
        status: "completed",
        createdAt: "2020-01-01T00:00:00.000Z",
        lastAccessedAt: null,
        expiresAt: "2020-01-02T00:00:00.000Z",
        accessCount: 0,
      }, defaultMemoryRetentionPolicy, Date.parse("2026-09-15T00:00:00.000Z")),
      { action: "keep", reasonCode: "protected_evidence" },
    );
  }
});

test("explicit expiry wins while ordinary retention archives before purge", () => {
  const now = Date.parse("2026-09-15T00:00:00.000Z");
  assert.deepEqual(
    decideMemoryLifecycleAction({
      source: "memory_entries",
      status: "active",
      createdAt: "2026-09-01T00:00:00.000Z",
      lastAccessedAt: "2026-09-10T00:00:00.000Z",
      expiresAt: "2026-09-14T00:00:00.000Z",
      accessCount: 10,
    }, defaultMemoryRetentionPolicy, now),
    { action: "archive", reasonCode: "explicit_expiry" },
  );

  assert.deepEqual(
    decideMemoryLifecycleAction({
      source: "memory_entries",
      status: "active",
      createdAt: "2025-01-01T00:00:00.000Z",
      lastAccessedAt: "2025-01-01T00:00:00.000Z",
      expiresAt: null,
      accessCount: 0,
    }, defaultMemoryRetentionPolicy, now),
    { action: "archive", reasonCode: "retention_age" },
  );

  assert.deepEqual(
    decideMemoryLifecycleAction({
      source: "memory_entries",
      status: "archived",
      createdAt: "2024-01-01T00:00:00.000Z",
      lastAccessedAt: "2024-01-01T00:00:00.000Z",
      archivedAt: "2024-01-01T00:00:00.000Z",
      expiresAt: null,
      accessCount: 0,
    }, defaultMemoryRetentionPolicy, now),
    { action: "purge", reasonCode: "archived_retention_age" },
  );
});

test("frequently used durable knowledge is retained without an explicit expiry", () => {
  const now = Date.parse("2026-09-15T00:00:00.000Z");
  assert.deepEqual(
    decideMemoryLifecycleAction({
      source: "agent_knowledge",
      status: "active",
      createdAt: "2024-01-01T00:00:00.000Z",
      lastAccessedAt: "2026-09-10T00:00:00.000Z",
      expiresAt: null,
      accessCount: 25,
    }, defaultMemoryRetentionPolicy, now),
    { action: "keep", reasonCode: "within_retention" },
  );
});