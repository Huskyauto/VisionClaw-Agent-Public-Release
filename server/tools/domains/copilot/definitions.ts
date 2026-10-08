import type { ToolDefinition } from "../../types";
export const copilotChatDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "copilot_chat",
    description: "Owner-only GitHub Copilot text chat. Sends only Bob's latest explicit Copilot request from trusted conversation history, never model-chosen context. No tools or fallback. 20 shared attempts/day, one concurrent; subscription limits apply.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        model: { type: "string", enum: ["gpt-5.4-mini", "gpt-5.4", "claude-sonnet-5"], description: "Optional Copilot model; defaults to gpt-5.4-mini. GitHub allowance/multipliers apply." },
      }, required: [],
    },
  },
};
