/**
 * Tools-layer-split S18 — legal-domain tool definitions.
 *
 * Selection: the 5 legal tools forming a coherent domain — the 3 DB-backed
 * contract-record tools (create_contract, list_contracts,
 * update_contract_status; contiguous in both the legacy TOOL_DEFINITIONS array
 * and the legacy switch, each dispatching into ./business-tools with
 * { ...params, tenant_id: params._tenantId }) plus the 2 pure-logic legal-
 * document tools (legal_review — regex risk-scoring; generate_legal_document —
 * template synthesis). The two doc tools read NO trust signal, no DB, no
 * network — self-contained deterministic logic — so migrating them alongside
 * the contract trio keeps the whole legal surface in one domain module.
 * Adjacent business tools stay legacy per the smallest-safe-batch precedent
 * (S3): the finance-report/KPI cluster and the CRM tools interleave the
 * contract region and migrate with their own domains later; compliance_audit
 * already migrated (S6 security) and sits between legal_review and
 * generate_legal_document in the facade array as a const reference.
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * server/tools.ts TOOL_DEFINITIONS (no renames, no description edits, no schema
 * changes — inventory diff stays byte-clean; the only edit is the cosmetic
 * type: "function" as const -> type: "function" annotation, which does not
 * change the serialized surface).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const createContractDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_contract",
    description: "Create a contract record linked to a customer. Track type, dates, value, and status.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" }, customer_id: { type: "number" },
        contract_type: { type: "string", enum: ["service", "license", "nda", "consulting", "partnership", "employment", "other"] },
        start_date: { type: "string" }, end_date: { type: "string" }, value: { type: "number" },
        terms: { type: "string", description: "Contract terms or summary" },
      },
      required: ["title"],
    },
  },
};

export const listContractsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_contracts",
    description: "Use BEFORE renewals, when reviewing legal exposure, or when Bob asks \"what contracts are expiring\" — also before customer outreach to know what they signed. Returns contract rows with party, status, value, and dates. Filter by status (draft/sent/signed/active/expired/cancelled).",
    parameters: { type: "object", properties: { status: { type: "string" }, limit: { type: "number" } }, required: [] },
  },
};

export const updateContractStatusDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "update_contract_status",
    description: "Update a contract's status. Setting to 'signed' auto-records the signing timestamp.",
    parameters: { type: "object", properties: { contract_id: { type: "number" }, status: { type: "string", enum: ["draft", "sent", "signed", "active", "expired", "cancelled"] } }, required: ["contract_id", "status"] },
  },
};

export const legalReviewDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "legal_review",
    description: "Analyze a contract or legal document with comprehensive risk scoring. Returns a Contract Safety Score (0-100) with letter grade, clause-by-clause risk analysis with severity ratings, missing protections detection, obligations timeline, and prioritized negotiation recommendations. Inspired by professional legal review workflows. Use for contract review, NDA analysis, lease agreements, freelancer contracts, partnership agreements, or any legal document.",
    parameters: {
      type: "object",
      properties: {
        document_text: { type: "string", description: "Full text of the contract or legal document to analyze" },
        document_type: { type: "string", enum: ["contract", "nda", "lease", "employment", "freelancer", "partnership", "terms_of_service", "privacy_policy", "sow", "msa", "other"], description: "Type of legal document being reviewed" },
        party_perspective: { type: "string", description: "Which party's perspective to review from (e.g. 'freelancer', 'vendor', 'employee', 'landlord', 'company'). Affects risk assessment." },
        industry: { type: "string", description: "Industry context for specialized clause analysis (e.g. 'technology', 'healthcare', 'real_estate', 'finance')" },
        jurisdiction: { type: "string", description: "Legal jurisdiction (e.g. 'US-IL', 'US-CA', 'UK', 'EU'). Affects compliance flags." },
      },
      required: ["document_text", "document_type"],
    },
  },
};

export const generateLegalDocumentDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "generate_legal_document",
    description: "Generate professional legal documents from specifications. Supports NDAs (mutual, one-way, employee, vendor), terms of service, privacy policies, freelancer agreements, partnership agreements, SOWs (statements of work), MSAs (master service agreements), and cease & desist letters. Documents include standard protective clauses and are customized to the specified jurisdiction and industry.",
    parameters: {
      type: "object",
      properties: {
        document_type: { type: "string", enum: ["nda_mutual", "nda_one_way", "nda_employee", "terms_of_service", "privacy_policy", "freelancer_agreement", "partnership_agreement", "sow", "msa", "cease_desist", "consulting_agreement", "licensing_agreement"], description: "Type of legal document to generate" },
        party_a: { type: "string", description: "First party name (disclosing party for NDAs, company for employment)" },
        party_b: { type: "string", description: "Second party name (receiving party for NDAs, freelancer/partner)" },
        description: { type: "string", description: "Description of the business relationship, project scope, or purpose of the document" },
        jurisdiction: { type: "string", description: "Legal jurisdiction (e.g. 'Illinois, USA', 'California, USA', 'United Kingdom')" },
        duration: { type: "string", description: "Agreement duration (e.g. '12 months', '2 years', 'indefinite')" },
        compensation: { type: "string", description: "Payment terms if applicable (e.g. '$5,000/month', '$150/hour', 'equity split 50/50')" },
        special_terms: { type: "string", description: "Any special terms, clauses, or conditions to include" },
      },
      required: ["document_type", "party_a", "description"],
    },
  },
};

/** Full ordered set, for any consumer that wants the domain definitions. */
export const legalDomainDefinitions: ToolDefinition[] = [
  createContractDefinition,
  listContractsDefinition,
  updateContractStatusDefinition,
  legalReviewDefinition,
  generateLegalDocumentDefinition,
];
