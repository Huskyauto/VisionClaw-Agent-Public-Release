/**
 * Tools-layer-split S25g — inbox-domain tool DEFINITIONS.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * Each const below was moved VERBATIM from `server/tools.ts`, which now
 * references these consts in the exact original TOOL_DEFINITIONS array
 * positions — array order (and therefore the LLM-facing tool ordering and
 * `scripts/list-tools.ts` output) is byte-identical. The R104 inbox quarantine
 * + sender allowlist cluster (anti-prompt-injection gate).
 */

import type { ToolDefinition } from "../../types";

export const inboxSenderApproveDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "inbox_sender_approve",
    description: "R104 — Approve an inbound email sender. Marks the address as a trusted correspondent so future inbound messages skip quarantine, and un-quarantines any prior held messages from this address. Trusted-only.",
    parameters: {
      type: "object",
      properties: {
        address: { type: "string", description: "Email address to approve (e.g. 'partner@example.com'). Will be lowercased + bare-address-extracted." },
        notes: { type: "string", description: "Optional context why this sender is trusted." },
      },
      required: ["address"],
    },
  },
};

export const inboxSenderBlockDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "inbox_sender_block",
    description: "R104 — Block an inbound email sender. Future inbound messages from this address remain quarantined permanently and cannot reach personas. Trusted-only.",
    parameters: {
      type: "object",
      properties: {
        address: { type: "string", description: "Email address to block." },
        notes: { type: "string", description: "Optional reason for the block." },
      },
      required: ["address"],
    },
  },
};

export const inboxQuarantineListDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "inbox_quarantine_list",
    description: "R104 — List inbound messages currently held in quarantine for this tenant (unknown senders, no prior correspondence, no allowlist entry). Use to triage which addresses to inbox_sender_approve.",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "Max rows (default 100)." } },
      required: [],
    },
  },
};

export const inboxAllowlistListDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "inbox_allowlist_list",
    description: "R104 — List the inbox sender allowlist entries (approved + blocked) for this tenant.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const inboxDomainDefinitions: ToolDefinition[] = [
  inboxSenderApproveDefinition,
  inboxSenderBlockDefinition,
  inboxQuarantineListDefinition,
  inboxAllowlistListDefinition,
];
