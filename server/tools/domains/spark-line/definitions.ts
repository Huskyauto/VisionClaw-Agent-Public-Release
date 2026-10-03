import type { ToolDefinition } from "../../types";

export const sparkSendMessageDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "spark_send_message",
    description: "Send bounded, non-sensitive free text to Spark's private owner-tenant outbox. No customer data or credentials, echoes, spend, outreach or publishing; no direct Muse access.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          minLength: 1,
          maxLength: 4000,
          description: "Your own concise 1–4000 character status, question or safe project-path reference. Never include customer information, contact details, secrets, credentials or copied private source content.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
};

export const sparkLineDomainDefinitions: ToolDefinition[] = [
  sparkSendMessageDefinition,
];