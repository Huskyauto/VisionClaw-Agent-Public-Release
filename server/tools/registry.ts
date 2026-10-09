/**
 * Tools-layer-split S2 — definition+handler registry for migrated tools.
 *
 * DISTINCT from `server/tool-registry.ts` (the METADATA registry: speed
 * class, category, product-output/network flags). Decision recorded in
 * data/feature-contracts/tools-layer-split/plan.md (S2): the two stay
 * separate — this one owns WHAT a tool is (contract + code), the metadata
 * registry owns HOW the platform schedules/times it. Merge is a post-S25
 * follow-up at most.
 *
 * Invariants (enforced here fail-LOUD at registration time, and re-checked by
 * tests/tools/registry-invariants.test.ts):
 *   - no duplicate tool names across all registered modules;
 *   - every entry passed through `defineTool` validation.
 */

import { assertValidDefinition } from "./define-tool";
import type { RegisteredTool, ToolDefinition, ToolHandler } from "./types";

const tools = new Map<string, RegisteredTool>();

/** Register a domain module's tools. Called at import time by
 * `server/tools/domains/<domain>/index.ts` files as they come online. */
export function registerTools(entries: RegisteredTool[]): void {
  for (const entry of entries) {
    assertValidDefinition(entry.definition);
    const name = entry.definition.function.name;
    if (tools.has(name)) {
      throw new Error(`[tools-registry] duplicate tool name registered: "${name}"`);
    }
    tools.set(name, entry);
  }
}

export function getMigratedHandler(name: string): ToolHandler | undefined {
  return tools.get(name)?.handler;
}

export function getMigratedDefinitions(): ToolDefinition[] {
  return Array.from(tools.values(), (t) => t.definition);
}

export function getMigratedToolNames(): string[] {
  return Array.from(tools.keys());
}

export function isMigrated(name: string): boolean {
  return tools.has(name);
}

/** Test-only escape hatch so invariant tests can run repeated registration
 * scenarios without cross-test bleed. Never call from production code. */
export function __resetRegistryForTests(): void {
  tools.clear();
}
