/**
 * Tools-layer-split S26d — messaging-domain tool definitions.
 *
 * The 2 channel-delivery tools (`send_message`, `messaging_status`) — a single
 * coherent cluster backed solely by `server/messaging-gateway` (`deliverMessage` /
 * `getGatewayStatus`; `send_message` additionally runs the outbound-redaction gate
 * `server/lib/outbound-redaction`).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const sendMessageDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "send_message",
    description: "Deliver a message to a user via any channel: telegram, sms, whatsapp, email, or web (in-app). Use to reach users wherever they are. Auto-falls-back if a target fails. Returns delivery status.",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["telegram", "sms", "whatsapp", "email", "web"], description: "Delivery channel" },
        telegramChatId: { type: "number", description: "Required for telegram" },
        phoneNumber: { type: "string", description: "E.164 phone (e.g. +12245551234) — required for sms/whatsapp" },
        email: { type: "string", description: "Required for email" },
        conversationId: { type: "number", description: "For web (in-app)" },
        text: { type: "string", description: "Message body (max ~1500 chars for SMS)" },
      },
      required: ["channel", "text"],
    },
  },
};

export const messagingStatusDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "messaging_status",
    description: "Use BEFORE scheduling or sending on a specific channel to confirm it's configured AND running — also when diagnosing a delivery failure (\"did SMS just stop working?\"). Returns telegram/sms/whatsapp/email/web status with configured flag, running flag, and last-error if applicable.",
    parameters: { type: "object", properties: {} },
  },
};

export const messagingDomainDefinitions: ToolDefinition[] = [
  sendMessageDefinition,
  messagingStatusDefinition,
];
