import type { ToolDefinition } from "../../types";

export const opportunityBankFileDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "opportunity_bank_file",
    description: "File an unvalidated Idea in the owner's Income Opportunities tab. Use for 'opportunities folder'; never create a project or mission instead.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short distinct opportunity name (3–160 characters)." },
        category: { type: "string", enum: ["Assessment", "Monitoring", "Implementation", "Partner", "Education"] },
        buyer: { type: "string", description: "Who would buy this." },
        problem: { type: "string", description: "Specific buyer problem and its supporting evidence; label hypotheses clearly." },
        entryOffer: { type: "string", description: "A small first offer, not a claim that it was sold." },
        price: { type: "string", description: "Optional price hypothesis. Do not present as verified." },
        expansion: { type: "string", description: "Optional later offer, not an automatic commitment." },
        nextStep: { type: "string", description: "Smallest way to test buyer demand." },
      },
      required: ["name", "category", "buyer", "problem", "entryOffer", "nextStep"],
      additionalProperties: false,
    },
  },
};

export const ownerBusinessOverviewDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "owner_business_overview",
    description: "Read-only, bounded owner catalogue overview for Felix in the owner tenant. Omit all arguments for compact per-source counts, then request one section at a time with section and optional pageSize (1–8; default 5); continue using that section's nextCursor while hasMore is true. Sections: storedIdeas, builtinIdeas, registeredProducts, builtinProducts, serviceOfferings. Counts and pages are not sales evidence; customer/order data is excluded. Matching slugs/SKUs may be catalog counterparts, not distinct offers. Errors mean coverage is unknown, never empty inventory or zero sales. Propose changes for Bob's approval; nothing is filed, listed, delivered, or changed.",
    parameters: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: ["storedIdeas", "builtinIdeas", "registeredProducts", "builtinProducts", "serviceOfferings"],
          description: "Omit for a compact count summary; set one section to read a bounded page.",
        },
        cursor: {
          type: "string",
          maxLength: 40,
          pattern: "^obv1:(storedIdeas|builtinIdeas|registeredProducts|builtinProducts|serviceOfferings):[0-9]{1,6}$",
          description: "Use only the nextCursor returned for the same section.",
        },
        pageSize: {
          type: "integer",
          minimum: 1,
          maximum: 8,
          description: "Maximum detailed records returned; defaults to 5; maximum 8.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
};