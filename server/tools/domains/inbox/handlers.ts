/**
 * Tools-layer-split S25g — inbox-domain migrated handlers.
 *
 * Selection: the 4 contiguous R104 inbox quarantine + sender-allowlist tools
 * (anti-prompt-injection gate) — `inbox_sender_approve`, `inbox_sender_block`,
 * `inbox_quarantine_list`, `inbox_allowlist_list`. All backed by the single
 * `server/inbox-quarantine` module, one thematically coherent cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim). Seam edit:
 * the caller-supplied trust signal becomes the trusted `ctx` value (the
 * dispatcher strips + re-stamps it) — `params._tenantId`→`ctx.tenantId` (all 4,
 * numeric guard verbatim). The PUBLIC params (`params.address`, `params.notes`,
 * `params.limit`) stay verbatim `params` reads — they are not trust signals.
 * `params._personaName` ALSO stays a verbatim `params` read: it is a
 * non-authoritative telemetry passthrough (only the audit `by` field), NOT a
 * trust key — the dispatcher deliberately does NOT strip it (see
 * server/tools/context.ts TRUST_SIGNAL_KEYS note; media/agentic precedent).
 * The backing dependency (`../../../inbox-quarantine`) is pulled via call-time
 * dynamic `import(...)` inside each handler — NOT a top-level static import —
 * so the domain module statically imports only within server/tools/ and cannot
 * recurse back into the app graph (acyclicity invariant, plan.md S2; same seam
 * S8/S9/S11/S25d/S25e used).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  inboxSenderApproveDefinition,
  inboxSenderBlockDefinition,
  inboxQuarantineListDefinition,
  inboxAllowlistListDefinition,
} from "./definitions";

async function inboxSenderApproveHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for inbox_sender_approve" };
  if (!params.address) return { error: "address is required" };
  const { approveSender } = await import("../../../inbox-quarantine");
  try {
    const row = await approveSender(ctx.tenantId, String(params.address), String(params._personaName || "agent"), params.notes ? String(params.notes) : undefined);
    return { ok: true, address: row.address, status: row.status };
  } catch (e: any) { return { error: e?.message || String(e) }; }
}

async function inboxSenderBlockHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for inbox_sender_block" };
  if (!params.address) return { error: "address is required" };
  const { blockSender } = await import("../../../inbox-quarantine");
  try {
    const row = await blockSender(ctx.tenantId, String(params.address), String(params._personaName || "agent"), params.notes ? String(params.notes) : undefined);
    return { ok: true, address: row.address, status: row.status };
  } catch (e: any) { return { error: e?.message || String(e) }; }
}

async function inboxQuarantineListHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for inbox_quarantine_list" };
  const { listQuarantined } = await import("../../../inbox-quarantine");
  const rows = await listQuarantined(ctx.tenantId, Number(params.limit) || 100);
  return { count: rows.length, quarantined: rows };
}

async function inboxAllowlistListHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId || typeof ctx.tenantId !== "number") return { error: "Tenant context required for inbox_allowlist_list" };
  const { listAllowlist } = await import("../../../inbox-quarantine");
  const rows = await listAllowlist(ctx.tenantId);
  return { count: rows.length, entries: rows };
}

/** Registered by ./index.ts at import time. */
export const inboxDomainTools: RegisteredTool[] = [
  defineTool(inboxSenderApproveDefinition, inboxSenderApproveHandler),
  defineTool(inboxSenderBlockDefinition, inboxSenderBlockHandler),
  defineTool(inboxQuarantineListDefinition, inboxQuarantineListHandler),
  defineTool(inboxAllowlistListDefinition, inboxAllowlistListHandler),
];
