/**
 * Verified Revenue Missions S5a — persona tool wiring (contract:
 * data/feature-contracts/revenue-missions). Four OWNER-ONLY tools exposing the
 * mission spine to agents. Deliberately EXCLUDED: approve / kill — those stay
 * HITL-only via the owner API + admin UI (nothing sends without
 * approved_by_owner_at; a tool must never be able to flip that gate).
 */

import type { ToolDefinition } from "../../types";

export const revenueMissionCreateDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "revenue_mission_create",
    description: "Create a Verified Revenue Mission — a durable 30+ day business experiment (hypothesis → evidence → offer → capped outreach sample → replies → payment) measured ONLY by external evidence (real replies, Stripe payments), never LLM forecasts. Owner-only. Starts at stage 'hypothesis'. Use when the owner wants to validate a business idea with a real, capped demand test instead of a forecast. Sends NOTHING — outreach requires a separately drafted experiment plus explicit owner approval in the admin UI.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short mission name, e.g. 'AI Readiness Audit — $297'." },
        hypothesis: { type: "string", description: "The falsifiable business hypothesis being tested." },
        idealCustomer: { type: "string", description: "The ideal customer profile (role, company type, pain)." },
        offer: { type: "string", description: "The smallest sellable offer (audit, report, blueprint, setup...)." },
        priceUsd: { type: "number", description: "Offer price in whole USD (optional, default 0)." },
        painStatement: { type: "string", description: "The customer pain in their words (optional)." },
        successCriteria: { type: "string", description: "External-evidence success criteria (optional)." },
        killCriteria: { type: "string", description: "When to kill the mission (optional)." },
      },
      required: ["name", "hypothesis", "idealCustomer", "offer"],
    },
  },
};

export const revenueMissionListDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "revenue_mission_list",
    description: "List all Verified Revenue Missions with stage, evidence counters (contacted / positive replies / payments), revenue vs refunds, and spend vs cap. Owner-only, read-only. Use to review the mission portfolio or before creating a new mission (max discipline: few active unproven missions).",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const revenueMissionStatusDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "revenue_mission_status",
    description: "Full status of one Revenue Mission: mission record, business-event done checks computed from EVIDENCE rows (validation_complete: ≥10 contacted + ≥3 positive replies; first_dollar_complete: net Stripe revenue > direct cost), recent evidence, and its experiments with approval state. Owner-only, read-only. Use before recommending next actions on a mission — the evidence, not your own reasoning, is the ground truth.",
    parameters: {
      type: "object",
      properties: {
        missionId: { type: "number", description: "The mission id." },
      },
      required: ["missionId"],
    },
  },
};

export const revenueMissionDraftExperimentDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "revenue_mission_draft_experiment",
    description: "Draft a capped outreach sample for a Revenue Mission: harvests candidate prospects from the owner's own Gmail graph (READ-only), ICP-filters them against the mission, drafts 2 message variants, and persists the packet as status 'awaiting_approval'. SENDS NOTHING — the owner must approve the specific experiment in the admin UI before any email goes out (fail closed). Hard caps: 25 prospects / 3 contacts each / $25; exceeding refuses, never truncates. Owner-only, trusted personas only.",
    parameters: {
      type: "object",
      properties: {
        missionId: { type: "number", description: "The mission id to draft an experiment for." },
        name: { type: "string", description: "Optional experiment name (default 'Sample #1 — <mission>')." },
      },
      required: ["missionId"],
    },
  },
};

export const missionPortfolioReviewDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "mission_portfolio_review",
    description: "Deterministic ADVISORY review of the whole Revenue Mission portfolio (capital allocator): flags over-capacity (max 2 active unproven missions), kill signals (contacts with no traction), and scale candidates (verified realized margin only — revenue minus refunds minus spend from Stripe evidence, never forecasts). Owner-only, read-only, no LLM. It recommends; it NEVER applies — kill/approve/autonomy changes stay with the owner in the admin UI.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const revenueMissionsDomainDefinitions: ToolDefinition[] = [
  revenueMissionCreateDefinition,
  revenueMissionListDefinition,
  revenueMissionStatusDefinition,
  revenueMissionDraftExperimentDefinition,
  missionPortfolioReviewDefinition,
];
