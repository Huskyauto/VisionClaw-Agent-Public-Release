import type { ToolDefinition } from "../../types";

export const discoverCmmcProspectsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "discover_cmmc_prospects",
    description: "Build paced CAGE-backed SAM.gov rosters; checkpoint throttled states, retry only pending states, then export to the active project.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Report objective/qualification context; SAM entity retrieval itself is filtered by state and active registration." },
        states: { type: "array", items: { type: "string" }, description: "One to five two-letter states." },
        dateWindow: {
          type: "object",
          properties: {
              from: { type: "string", description: "Report evidence-window start (YYYY-MM-DD), not a SAM registration filter." },
              to: { type: "string", description: "Report evidence-window end (YYYY-MM-DD), not a SAM registration filter." },
          },
          required: ["from", "to"],
        },
        deliver: {
          type: "boolean",
          description: "Create and upload JSON, CSV, Markdown report, and run log (default true when a project is active).",
        },
      },
      required: ["query", "states", "dateWindow"],
    },
  },
};

export const lookupSamCompanyCageDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "lookup_sam_company_cage",
    description: "Verify supplied tier/group rosters in official SAM.gov, 1-10 names per paced call; repeat larger groups and preserve tier labels.",
    parameters: {
      type: "object",
      properties: {
        companyNames: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          description: "One tier/group batch of one to ten legal or commonly used company names. For larger rosters, call again with the next batch and retain the same tier label in the report.",
        },
        includeInactive: {
          type: "boolean",
          description: "Also search entities without an active SAM registration; default false.",
        },
        tierLabel: {
          type: "string",
          description: "Original caller-supplied group label, such as Tier 1; returned unchanged for reliable batch merging.",
        },
      },
      required: ["companyNames"],
    },
  },
};

export const lookupSamExactCompanyDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "lookup_sam_exact_company",
    description: "Resolve one named company against SAM.gov using name and address/domain anchors; return CAGE only when attribution is strong.",
    parameters: {
      type: "object",
      properties: {
        companyName: { type: "string", description: "Requested company legal or commonly used name." },
        state: { type: "string", description: "Optional two-letter state code." },
        city: { type: "string", description: "Optional city anchor." },
        streetAddress: { type: "string", description: "Optional street-address anchor." },
        zip: { type: "string", description: "Optional postal-code anchor." },
        websiteDomain: { type: "string", description: "Optional public website domain used only for corroboration." },
        aliases: {
          type: "array",
          items: { type: "string" },
          maxItems: 10,
          description: "Optional alternate company names.",
        },
        includeInactive: { type: "boolean", description: "Include inactive registrations; defaults true." },
        maxCandidates: {
          type: "integer",
          minimum: 1,
          maximum: 25,
          description: "Maximum ranked candidates returned; defaults 10.",
        },
      },
      required: ["companyName"],
    },
  },
};

export const cmmcProspectingDomainDefinitions = [
  discoverCmmcProspectsDefinition,
  lookupSamCompanyCageDefinition,
  lookupSamExactCompanyDefinition,
];