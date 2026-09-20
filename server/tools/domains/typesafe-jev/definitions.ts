import type { ToolDefinition } from "../../types";

const instructions = { type: "string", minLength: 1, maxLength: 500 };
const primitive = {
  oneOf: [
    {
      type: "object",
      properties: {
        type: { const: "noul" },
        instructions,
        criteria: {
          type: "object",
          properties: {
            true: { type: "string", minLength: 1, maxLength: 500 },
            false: { type: "string", minLength: 1, maxLength: 500 },
          },
          required: ["true", "false"],
          additionalProperties: false,
        },
      },
      required: ["type", "instructions"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "choice" },
        instructions,
        criteria: {
          type: "object",
          minProperties: 2,
          maxProperties: 20,
          propertyNames: { pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" },
          additionalProperties: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
      required: ["type", "instructions", "criteria"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "score" },
        instructions,
        criteria: {
          type: "array",
          minItems: 2,
          maxItems: 20,
          items: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
      required: ["type", "instructions", "criteria"],
      additionalProperties: false,
    },
  ],
};

export const typesafeJevDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "typesafe_jev_advisory",
    description: "Classify bounded state with Jev; advisory only, never authorization or action approval.",
    parameters: {
      type: "object",
      properties: {
        state: {
          oneOf: [
            { type: "string", minLength: 1, maxLength: 12_000 },
            { type: "object", minProperties: 1, additionalProperties: true },
            { type: "array", minItems: 1, items: {} },
          ],
          description: "Bounded text or JSON state (12k chars, depth 8, 1k nodes). Prefer named fields; never send secrets and minimize/redact PII.",
        },
        questions: {
          type: "object",
          minProperties: 1,
          maxProperties: 3,
          propertyNames: { pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" },
          additionalProperties: primitive,
        },
      },
      required: ["state", "questions"],
      additionalProperties: false,
    },
  },
};