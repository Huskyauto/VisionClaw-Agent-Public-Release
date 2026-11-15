import type { ToolDefinition } from "../../types";

export const sparkSendMessageDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "spark_send_message",
    description: "Send bounded, non-sensitive text to Spark (default) or Claude's private owner outbox with recipient:'claude'. No credentials, customer data, spend, outreach or publishing; no direct Muse access.",
    parameters: {
      type: "object",
      properties: {
        recipient: {
          type: "string", enum: ["spark", "claude"], default: "spark",
          description: "spark preserves the existing Spark line. claude addresses the current Claude thread, or the only active Claude connector. Multiple destinations without a matching thread are rejected.",
        },
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