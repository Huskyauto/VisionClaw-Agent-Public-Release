/**
 * Tools-layer-split S2 — unknown-tool response, extracted verbatim from the
 * legacy monolith's fall-through arm so the S4 dispatcher can reuse the exact
 * same operator-facing copy. NOT wired anywhere yet (zero behavior change);
 * the legacy string in `server/tools.ts` remains the live one until S4.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

export function unknownToolError(name: string): { error: string } {
  return {
    error: `Unknown tool: "${name}". This tool does not exist yet. You have two options: 1) Use create_tool to build a simple sandboxed tool. 2) Use skill_seeker with action "seek" to research this capability online, find solutions on GitHub/npm, and auto-create the right tool or skill. skill_seeker is preferred for complex capabilities.`,
  };
}
