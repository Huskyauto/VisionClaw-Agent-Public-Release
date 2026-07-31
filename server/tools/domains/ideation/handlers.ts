/**
 * Tools-layer-split S26e — ideation-domain migrated handler.
 *
 * Selection: the single structured-ideation tool — `ideation_session`. Backed
 * solely by `server/ideation-engine` (`runIdeationSession` /
 * `formatIdeationAsMarkdown`).
 *
 * Handler body is a MECHANICAL move of the legacy switch arm (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): the legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY for its fail-closed tenant-context guard
 * (`if (!params._tenantId) return { error: "Tenant context required for ideation_session" }`)
 * AND as the backing-lib + storage `tenantId` scope, plus `params._personaId` as the
 * persona stamp (passed to `runIdeationSession`, and `|| 2` in the memory entry).
 * Migrated handler reads `ctx.tenantId` / `ctx.personaId` (the same platform-derived
 * values) in the SAME order with IDENTICAL error strings and the SAME `|| 2` default.
 * `_tenantId`/`_personaId` are the ONLY stripped signals this arm read (grepped — no
 * `_conversationId`/`_projectId`).
 *
 * The backing `../../../ideation-engine` and `../../../storage` modules are pulled
 * via call-time dynamic `import(...)` — NOT top-level static imports — so the domain
 * module statically imports only within server/tools/ and cannot recurse back into
 * the app graph (acyclicity invariant, plan.md S2). Neither `ideation-engine` nor
 * `storage` imports the tools facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { ideationSessionDefinition } from "./definitions";

async function ideationSessionHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for ideation_session" };
  const tid = ctx.tenantId;
  if (!params.idea) return { error: "Parameter 'idea' is required" };
  try {
    const { runIdeationSession, formatIdeationAsMarkdown } = await import("../../../ideation-engine");
    const result = await runIdeationSession({
      idea: params.idea,
      phase: params.phase || "full",
      frameworks: params.frameworks,
      context: params.context,
      tenantId: tid,
      personaId: ctx.personaId,
    });

    const markdown = formatIdeationAsMarkdown(result);
    const { storage } = await import("../../../storage");

    if (params.save_as_note) {
      try {
        const today = new Date().toISOString().split("T")[0];
        const existing = await storage.getDailyNote(today, undefined, tid);
        const noteContent = `## Ideation Session\n${markdown}`;
        if (existing) {
          await storage.upsertDailyNote({ tenantId: tid, date: today, content: existing.content + "\n\n" + noteContent });
        } else {
          await storage.upsertDailyNote({ tenantId: tid, date: today, content: noteContent });
        }
      } catch (noteErr: any) {
        console.warn(`[ideation] Failed to save daily note: ${noteErr.message}`);
      }
    }

    try {
      await storage.createMemoryEntry({
        fact: `Ideation session on: ${params.idea.slice(0, 100)}. HMW: ${result.hmwStatement}. ${result.variations.length} framework variations generated.${result.onePager ? ` MVP: ${result.onePager.mvpScope.slice(0, 100)}` : ""}`,
        category: "ideation",
        source: "ideation_session",
        status: "active",
        personaId: ctx.personaId || 2,
        tenantId: tid,
      });
    } catch (memErr: any) {
      console.warn(`[ideation] Failed to save memory entry: ${memErr.message}`);
    }

    return {
      ...result,
      markdown,
      frameworks_used: result.variations.map(v => v.framework),
      saved_as_note: !!params.save_as_note,
    };
  } catch (err: any) {
    return { error: `Ideation session failed: ${err.message}` };
  }
}

/** Registered by ./index.ts at import time. */
export const ideationDomainTools: RegisteredTool[] = [
  defineTool(ideationSessionDefinition, ideationSessionHandler),
];
