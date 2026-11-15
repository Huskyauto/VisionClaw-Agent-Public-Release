/**
 * Tools-layer-split S4 — dispatcher shell.
 *
 * WRAPS (does not replace) the monolith's executeTool flow: server/tools.ts's
 * `_executeToolInner` now delegates here. All upstream gates in executeTool —
 * rate-limit handshake (`_rateLimitChecked`), autonomy gate, TNR snapshot,
 * tracing span, tool_performance ledger — run BEFORE this function and are
 * untouched by the split (verified by tests/tools/dispatcher.test.ts).
 *
 * Routing:
 *   1. Migrated tool (registered in ./registry) → its handler, with
 *      caller-visible trust signals STRIPPED from params and identity passed
 *      via the trusted ToolContext instead. Identity comes ONLY from sealed
 *      invocation-authority ALS. The dispatcher never derives identity from
 *      task parameters and refuses calls without separate host authority.
 *   2. Unmigrated tool → the injected legacy switch, with the ORIGINAL
 *      compatibility params. The private legacy implementation also requires
 *      sealed authority and re-stamps identity before evaluating its switch.
 *   3. No legacy executor injected (unit tests / boot error) → the same
 *      structured unknown-tool error the legacy default arm returns.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { getMigratedHandler } from "./registry";
import { stripTrustSignals, buildToolContext } from "./context";
import { getLegacyExecutor } from "./legacy-switch";
import { unknownToolError } from "./unknown-tool";
import { currentToolAuthority } from "./invocation-authority";
import type { ToolResult } from "./types";

// Importing the domain barrels registers their handlers (side-effectful by
// design — same pattern as the definitions splice in server/tools.ts).
import "./domains/system";
import "./domains/treasury-paper";
import "./domains/files";
import "./domains/security";
import "./domains/memory";
import "./domains/knowledge";
import "./domains/web";
import "./domains/quality";
import "./domains/documents";
import "./domains/browser";
import "./domains/workspace";
import "./domains/social";
import "./domains/x-twitter";
import "./domains/outreach";
import "./domains/research-intel";
import "./domains/finance";
import "./domains/crm";
import "./domains/legal";
import "./domains/multiagent";
import "./domains/agentic";
import "./domains/media";
import "./domains/delivery";
import "./domains/governance";
import "./domains/research";
import "./domains/commitment";
import "./domains/reasoning";
import "./domains/inbox";
import "./domains/skills";
import "./domains/felix-loop";
import "./domains/spark-line";
import "./domains/grok-line";
import "./domains/instinct-line";
import "./domains/income-opportunities";
import "./domains/tensions";
import "./domains/scheduled-posts";
import "./domains/procedures";
import "./domains/sprint-contracts";
import "./domains/finance-market";
import "./domains/treasury";
import "./domains/agent-eval";
import "./domains/scratchpad";
import "./domains/self-reflection";
import "./domains/social-marketing";
import "./domains/monid";
import "./domains/crews";
import "./domains/background";
import "./domains/minerva";
import "./domains/safety";
import "./domains/design-doc";
import "./domains/voice-profile";
import "./domains/task-forces";
import "./domains/department-budgets";
import "./domains/self-improvement";
import "./domains/ab-optimizer";
import "./domains/cost-ledger";
import "./domains/copilot";
import "./domains/reference-learner";
import "./domains/wake-scheduler";
import "./domains/messaging";
import "./domains/recurring-messages";
import "./domains/outcome-tracking";
import "./domains/ideation";
import "./domains/user-modeling";
import "./domains/skill-evolution";
import "./domains/strategic-memory";
import "./domains/knowledge-nudges";
import "./domains/codebase-graph";
import "./domains/code-chunker";
import "./domains/minds";
import "./domains/context-compressor";
import "./domains/structured-extraction";
import "./domains/seo";
import "./domains/content-ops";
import "./domains/custom-tools";
import "./domains/video-editor";
import "./domains/character-portraits";
import "./domains/video-selectors";
import "./domains/outlook";
import "./domains/sessions";
import "./domains/google-workspace";
import "./domains/sandbox";
import "./domains/revenue-missions";
import "./domains/commerce";
import "./domains/audit-fixkit";
import "./domains/derived-api";
import "./domains/typesafe-jev";
import "./domains/cmmc-prospecting";
import "./domains/business-pilots";

export async function dispatchTool(
  name: string,
  params: Record<string, any>,
): Promise<ToolResult> {
  const authority = currentToolAuthority();
  if (!authority) return { error: "Missing trusted tool authority; dispatcher refused execution." };
  const handler = getMigratedHandler(name);
  if (handler) {
    // Action Ledger S4 — abort-signal ALS lives in server/lib/; a call-time
    // dynamic import keeps the server/tools/ package acyclic w.r.t. server/
    // (registry-invariants guard). Set only by executeToolWithTimeout —
    // unforgeable (a caller-supplied `_abortSignal` param would be spoofable;
    // that channel deliberately does not exist).
    let abortSignal: AbortSignal | undefined;
    try {
      const mod = await import("../lib/tool-abort-context");
      abortSignal = mod.getCurrentToolAbortSignal() ?? undefined;
    } catch (e) {
      console.warn("[silent-catch] server/tools/dispatcher.ts:", (e as any)?.message ?? e);
    }
    const ctx = buildToolContext({
      invokedVia: authority.invokedVia,
      tenantId: authority.tenantId,
      personaId: authority.personaId,
      conversationId: authority.conversationId,
      projectId: authority.projectId,
      allowedPaths: authority.allowedPaths ? [...authority.allowedPaths] : undefined,
      rateLimitChecked: authority.rateLimitChecked === true,
      abortSignal,
    });
    return handler(stripTrustSignals(params), ctx);
  }
  const legacy = getLegacyExecutor();
  if (legacy) return legacy(name, params);
  return unknownToolError(name);
}
