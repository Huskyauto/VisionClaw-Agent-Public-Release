import type { ToolDefinition } from "../../types";

export const instinctSendMessageDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "instinct_send_message",
    description: "Queue your own 1–4000 character non-sensitive status or question for Instinct in its private owner outbox; never echo incoming messages.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          minLength: 1,
          maxLength: 4000,
          description: "Your own concise, non-sensitive status or question for Instinct. No customer data, contact details, secrets, credentials, copied private source content, or replies echoing Instinct.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
};

export const instinctLineDomainDefinitions: ToolDefinition[] = [instinctSendMessageDefinition];