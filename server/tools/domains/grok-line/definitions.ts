import type { ToolDefinition } from "../../types";

export const grokSendMessageDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "grok_send_message",
    description: "Queue your own 1–4000 character non-sensitive status or question for Grok in the private owner outbox; never echo incoming messages.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          minLength: 1,
          maxLength: 4000,
          description: "Your own concise, non-sensitive status or question for Grok. No customer data, contact details, secrets, credentials, copied private source content, or replies echoing Grok.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
};

export const grokLineDomainDefinitions: ToolDefinition[] = [
  grokSendMessageDefinition,
];
