/**
 * Tools-layer-split S33 — outlook-domain migrated handlers.
 *
 * Selection: the 3 read-only Outlook tools — `outlook_list_inbox` /
 * `outlook_search_inbox` / `outlook_read_message`. Backed solely by
 * `server/lib/outlook` (`listInboxMessages` / `searchMessages` / `readMessage`),
 * every response wrapped via `server/external-content-security`
 * `wrapExternalContent` (email is a canonical prompt-injection surface). The 3
 * legacy switch arms shared ONE block keyed on `name`; that shared body is
 * preserved here as `outlookHandler(name, …)`, called by 3 thin registrations so
 * the per-tool `name`-branching and `${name}`-suffixed error strings are byte-
 * identical to the legacy arm.
 *
 * Handler bodies are a MECHANICAL move of the legacy switch arm (standing rules:
 * no renames, no behavior change, no added/removed gate).
 *
 * SEAM (read-from-ctx, NOT re-stamp): the legacy arm read the dispatcher-STRIPPED
 * `params._tenantId` DIRECTLY for its admin-tenant gate
 * (`if (params._tenantId !== ADMIN_TENANT_ID) return { error: "... admin-tenant only" }`).
 * The migrated handler reads `ctx.tenantId` (the same platform-derived value) for
 * that same strict-inequality gate with an IDENTICAL error string. A missing
 * tenant (`ctx.tenantId === undefined`) fails closed exactly as the legacy
 * `undefined !== 1` did. `_tenantId` is the ONLY stripped trust signal these arms
 * read — `top` / `from_address` / `unread_only` / `since_iso` / `until_iso` /
 * `query` / `message_id` are PUBLIC request params (read from `params`).
 *
 * The backing `../../../lib/outlook` and `../../../external-content-security`
 * modules are pulled via call-time dynamic `import(...)` — NOT top-level static
 * imports — so the domain module statically imports only within server/tools/ and
 * cannot recurse back into the app graph (acyclicity invariant, plan.md S2).
 * Neither backing module imports the tools facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  outlookListInboxDefinition,
  outlookSearchInboxDefinition,
  outlookReadMessageDefinition,
} from "./definitions";

const ADMIN_TENANT_ID = 1;

async function outlookHandler(
  name: string,
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R125+8 — Read-only Outlook via Microsoft Graph (Replit Connectors proxy).
  // SECURITY: admin-tenant gate (Bob's personal mailbox) + every body field
  // wrapped via wrapExternalContent (email is a canonical prompt-injection
  // surface; anyone can email you).
  if (ctx.tenantId !== ADMIN_TENANT_ID) {
    return { error: `${name}: admin-tenant only (Bob's personal Outlook mailbox; no multi-tenant exposure)` };
  }
  try {
    const lib = await import("../../../lib/outlook");
    const { wrapExternalContent } = await import("../../../external-content-security");
    let raw: any;
    let sourceLabel: string;
    if (name === "outlook_list_inbox") {
      raw = await lib.listInboxMessages({
        top: typeof params.top === "number" ? params.top : undefined,
        fromAddress: params.from_address ? String(params.from_address) : undefined,
        unreadOnly: !!params.unread_only,
        sinceISO: params.since_iso ? String(params.since_iso) : undefined,
        untilISO: params.until_iso ? String(params.until_iso) : undefined,
      });
      sourceLabel = "outlook://inbox/list";
    } else if (name === "outlook_search_inbox") {
      const q = String(params.query || "").trim();
      if (!q) return { error: "query is required" };
      raw = await lib.searchMessages(q, typeof params.top === "number" ? params.top : 25);
      sourceLabel = "outlook://mail/search";
    } else {
      const id = String(params.message_id || "").trim();
      if (!id) return { error: "message_id is required" };
      raw = await lib.readMessage(id);
      sourceLabel = `outlook://message/${id.slice(0, 16)}`;
    }
    // Same fence-only contract as academic_search (R125+4+sec): return ONLY
    // wrapped content for LLM-visible callers. Pre-fence metadata (count,
    // source label) is locally-generated, never publisher-controlled.
    const meta: any = { ok: true, source: sourceLabel };
    if (typeof raw.count === "number") meta.count = raw.count;
    const { wrapped } = wrapExternalContent(JSON.stringify(raw), "web_fetch", { url: sourceLabel });
    return { ...meta, fenced: wrapped };
  } catch (e: any) {
    return { error: `${name} failed: ${e?.message || String(e)}` };
  }
}

/** Registered by ./index.ts at import time. */
export const outlookDomainTools: RegisteredTool[] = [
  defineTool(outlookListInboxDefinition, (p, c) => outlookHandler("outlook_list_inbox", p, c)),
  defineTool(outlookSearchInboxDefinition, (p, c) => outlookHandler("outlook_search_inbox", p, c)),
  defineTool(outlookReadMessageDefinition, (p, c) => outlookHandler("outlook_read_message", p, c)),
];
