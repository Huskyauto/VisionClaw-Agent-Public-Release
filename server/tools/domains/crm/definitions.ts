/**
 * Tools-layer-split — crm-domain tool definitions.
 *
 * Selection: the 5 contiguous DB-backed CRM tools — `add_customer`,
 * `update_customer`, `list_customers`, `log_interaction`, `customer_pipeline`.
 * In the legacy facade each was an individual switch arm that dispatched into
 * `./business-tools` with `{ ...params, tenant_id: params._tenantId }`
 * (`customer_pipeline` passed only `{ tenant_id }`). The sole trust channel is
 * `_tenantId`, covered by the trusted ToolContext seam; the `business-tools`
 * fns read NO `_`-prefixed key so the dispatcher's `stripTrustSignals` is
 * behavior-neutral — same seam as the finance domain (S17).
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes — inventory diff must stay byte-clean).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const addCustomerDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "add_customer",
    description: "Add a new customer/prospect to the CRM. Track company info, contact details, deal stage, and value.",
    parameters: {
      type: "object",
      properties: {
        company_name: { type: "string" }, contact_name: { type: "string" }, email: { type: "string" },
        phone: { type: "string" }, address: { type: "string" }, city: { type: "string" },
        state: { type: "string" }, zip: { type: "string" }, industry: { type: "string" },
        deal_stage: { type: "string", enum: ["prospect", "lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"] },
        deal_value: { type: "number", description: "Potential deal value in dollars" },
        assigned_to: { type: "string", description: "Who owns this account" },
        notes: { type: "string" },
      },
      required: ["company_name"],
    },
  },
};

export const updateCustomerDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "update_customer",
    description: "Use AFTER any meaningful customer interaction (call, email, demo) to advance pipeline state — change deal_stage, add a note, update value. Two-step pattern: get_customer first to confirm current state, then update_customer. Returns the updated row. Stage changes auto-trigger the appropriate followup workflow.",
    parameters: {
      type: "object",
      properties: {
        customer_id: { type: "number" }, company_name: { type: "string" }, contact_name: { type: "string" },
        email: { type: "string" }, phone: { type: "string" }, deal_stage: { type: "string" },
        deal_value: { type: "number" }, notes: { type: "string" }, assigned_to: { type: "string" },
        status: { type: "string", enum: ["active", "inactive", "churned"] },
      },
      required: ["customer_id"],
    },
  },
};

export const listCustomersDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_customers",
    description: "Use when reviewing the pipeline at session start, when Bob asks \"who is in the funnel\", before drafting outreach to avoid duplicates, or when a follow-up is overdue. Returns customer/prospect rows with name, deal stage, status, value, and last-contact date. Filter by stage to focus (e.g. only \"negotiation\").",
    parameters: { type: "object", properties: { deal_stage: { type: "string" }, status: { type: "string" }, limit: { type: "number" } }, required: [] },
  },
};

export const logInteractionDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "log_interaction",
    description: "Log a customer interaction (call, email, meeting, demo, proposal, follow_up, note). Automatically updates last contact date.",
    parameters: {
      type: "object",
      properties: {
        customer_id: { type: "number" }, interaction_type: { type: "string", enum: ["call", "email", "meeting", "demo", "proposal", "follow_up", "note"] },
        subject: { type: "string" }, notes: { type: "string" }, outcome: { type: "string" },
        follow_up_date: { type: "string", description: "Follow-up date YYYY-MM-DD" },
      },
      required: ["customer_id", "interaction_type"],
    },
  },
};

export const customerPipelineDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "customer_pipeline",
    description: "View the sales pipeline — shows deal counts and values at each stage (prospect → lead → qualified → proposal → negotiation → closed). Includes win rate and lifetime revenue.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

/** Full ordered set, for any consumer that wants the domain's definitions. */
export const crmDomainDefinitions: ToolDefinition[] = [
  addCustomerDefinition,
  updateCustomerDefinition,
  listCustomersDefinition,
  logInteractionDefinition,
  customerPipelineDefinition,
];
