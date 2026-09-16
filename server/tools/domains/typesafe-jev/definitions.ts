import type { ToolDefinition } from "../../types";

const instructions = { type: "string", minLength: 1, maxLength: 500 };
const primitive = {
  oneOf: [
    {
      type: "object",
      properties: { type: { const: "noul" }, instructions },
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
        state: { type: "string", minLength: 1, maxLength: 12_000 },
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