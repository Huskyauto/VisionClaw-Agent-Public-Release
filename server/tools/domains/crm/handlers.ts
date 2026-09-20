/**
 * Tools-layer-split — crm-domain migrated handlers.
 *
 * The 5 DB-backed CRM tools. In the legacy facade each was an individual switch
 * arm of the form:
 *   const biz = await import("./business-tools");
 *   return biz.<fn>({ ...params, tenant_id: params._tenantId });
 * (`customer_pipeline` passed only `{ tenant_id: params._tenantId }` — no
 * `...params` — preserved verbatim below).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (no renames, no
 * behavior change, no added gate). The ONLY edit: the caller-supplied
 * `params._tenantId` read becomes `ctx.tenantId` (the dispatcher strips +
 * re-stamps it from the trusted context). VERIFIED SAFE: the `business-tools`
 * fns read the tenant solely via `tenantGuard(params.tenant_id)` (throws on a
 * falsy value — the legacy arms had NO explicit gate, so this fail-closed
 * behavior is unchanged) and read NO `_`-prefixed trust signal, so passing the
 * dispatcher-stripped `params` alongside `tenant_id: ctx.tenantId` is
 * behavior-identical to the legacy `{ ...params, tenant_id: params._tenantId }`.
 * The sole external dependency (`../../../business-tools`) is pulled via a
 * call-time dynamic `import(...)` inside each handler (acyclicity invariant,
 * plan.md S2; same seam as the finance domain S17).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  addCustomerDefinition,
  updateCustomerDefinition,
  listCustomersDefinition,
  logInteractionDefinition,
  customerPipelineDefinition,
} from "./definitions";

async function addCustomerHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.addCustomer({ ...params, tenant_id: ctx.tenantId });
}

async function updateCustomerHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.updateCustomer({ ...params, tenant_id: ctx.tenantId });
}

async function listCustomersHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.listCustomers({ ...params, tenant_id: ctx.tenantId });
}

async function logInteractionHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.logInteraction({ ...params, tenant_id: ctx.tenantId });
}

async function customerPipelineHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.customerPipeline({ tenant_id: ctx.tenantId });
}

/** Registered by ./index.ts at import time. */
export const crmDomainTools: RegisteredTool[] = [
  defineTool(addCustomerDefinition, addCustomerHandler),
  defineTool(updateCustomerDefinition, updateCustomerHandler),
  defineTool(listCustomersDefinition, listCustomersHandler),
  defineTool(logInteractionDefinition, logInteractionHandler),
  defineTool(customerPipelineDefinition, customerPipelineHandler),
];
