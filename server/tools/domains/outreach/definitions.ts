/**
 * Tools-layer-split S16 — outreach-domain tool definitions.
 *
 * Selection: the 8 AI-SDR lead/sequence tools — `enrich_lead`, `score_leads`,
 * `qualify_leads`, `create_sequence`, `enroll_in_sequence`, `advance_sequence`,
 * `classify_reply`, `list_sequences`. In the legacy facade these were the LAST 8
 * labels of a SHARED case-fallthrough block that dispatched (via one `fnMap`) to
 * `./agentic-features`; the block's other 9 arms (research —
 * `save_evidence`/`query_evidence`/`synthesize_research`; competitor —
 * `add_competitor`/`list_competitors`/`take_competitor_snapshot`/
 * `detect_competitor_changes`/`competitor_briefing`; and `define_icp`) belong to
 * the agentic domain and STAY LEGACY for a later slice. The 8 outreach fns take
 * `{ tenantId, ...realParams }` and read NO `_`-prefixed trust signal (verified),
 * so the only migration seam is `_tenantId`→`ctx.tenantId`. Adjacent comms tools
 * stay legacy per smallest-safe-batch: `send_email`, `send_message`,
 * `check_inbox`, the inbox sender/quarantine cluster
 * (`inbox_sender_approve`/`inbox_sender_block`/`inbox_quarantine_list`/
 * `inbox_allowlist_list`), and `outlook_list_inbox`/`outlook_search_inbox` are
 * scattered / network / destructive and migrate later.
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes — inventory diff must stay byte-clean).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const enrichLeadDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "enrich_lead",
    description: "Enrich a lead with company data scraped from their website. Extracts industry, company size, products, and target market. Stores enriched data for scoring.",
    parameters: {
      type: "object",
      properties: {
        leadName: { type: "string", description: "Contact name" },
        leadEmail: { type: "string", description: "Contact email" },
        companyName: { type: "string", description: "Company name" },
        companyUrl: { type: "string", description: "Company website URL (will be crawled for enrichment)" },
        role: { type: "string", description: "Contact's role/title" },
      },
      required: ["leadName"],
    },
  },
};

export const scoreLeadsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "score_leads",
    description: "Score all enriched leads against the active ICP criteria using AI. Assigns scores (0-100), grades (A-F), and qualification status (qualified/nurture/disqualified). Requires define_icp to be called first.",
    parameters: {
      type: "object",
      properties: {
        ruleId: { type: "number", description: "Specific ICP rule ID (optional — uses most recent active rule)" },
      },
      required: [],
    },
  },
};

export const qualifyLeadsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "qualify_leads",
    description: "View the lead qualification pipeline — shows qualified, nurture, and disqualified leads with their ICP scores and grades.",
    parameters: {
      type: "object",
      properties: {
        minScore: { type: "number", description: "Minimum score threshold for 'qualified' (default: 70)" },
      },
      required: [],
    },
  },
};

export const createSequenceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_sequence",
    description: "Create a multi-step outreach email sequence. Define each step's subject, body template, and wait time. Templates support {{name}}, {{company}}, {{email}} placeholders. Steps are personalized with AI when personal context is provided.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Sequence name (e.g. 'Cold outreach - SaaS founders')" },
        description: { type: "string", description: "Sequence description/purpose" },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              subject: { type: "string", description: "Email subject line" },
              bodyTemplate: { type: "string", description: "Email body with {{name}}, {{company}} placeholders" },
              waitDays: { type: "number", description: "Days to wait before next step (default: 3)" },
              channel: { type: "string", enum: ["email"], description: "Channel (currently email only)" },
            },
            required: ["bodyTemplate"],
          },
          description: "Ordered list of outreach steps",
        },
      },
      required: ["name", "steps"],
    },
  },
};

export const enrollInSequenceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "enroll_in_sequence",
    description: "Enroll a contact in an outreach sequence. They'll receive step 1 immediately when the sequence is advanced, then subsequent steps at the defined intervals.",
    parameters: {
      type: "object",
      properties: {
        sequenceId: { type: "number", description: "Sequence ID to enroll in" },
        contactName: { type: "string", description: "Contact's name" },
        contactEmail: { type: "string", description: "Contact's email address" },
        companyName: { type: "string", description: "Contact's company name" },
        personalContext: { type: "string", description: "Context about this contact for AI personalization (e.g. 'Met at Chicago AI meetup, interested in agent frameworks')" },
      },
      required: ["sequenceId", "contactName", "contactEmail"],
    },
  },
};

export const advanceSequenceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "advance_sequence",
    description: "Process all outreach enrollments that are due. Sends personalized emails for the current step, then schedules the next step. Run this periodically or via Heartbeat to automate outreach.",
    parameters: {
      type: "object",
      properties: {
        sequenceId: { type: "number", description: "Specific sequence ID (optional — processes all sequences if omitted)" },
      },
      required: [],
    },
  },
};

export const classifyReplyDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "classify_reply",
    description: "Classify a reply to an outreach email. Determines if it's positive, interested, meeting request, objection, unsubscribe, out-of-office, etc. Automatically pauses or stops the sequence based on classification.",
    parameters: {
      type: "object",
      properties: {
        contactEmail: { type: "string", description: "Email address of the contact who replied" },
        replyContent: { type: "string", description: "The reply email content" },
      },
      required: ["contactEmail", "replyContent"],
    },
  },
};

export const listSequencesDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_sequences",
    description: "Use when auditing outreach performance, before launching a new campaign (to learn from what worked), or when Bob asks \"which sequence is converting\". Returns each sequence with enrollment, completion, and reply-rate stats. Pair with sequence-detail tools to see step-level performance.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

/** Full ordered set, for any consumer that wants the domain's definitions. */
export const outreachDomainDefinitions: ToolDefinition[] = [
  enrichLeadDefinition,
  scoreLeadsDefinition,
  qualifyLeadsDefinition,
  createSequenceDefinition,
  enrollInSequenceDefinition,
  advanceSequenceDefinition,
  classifyReplyDefinition,
  listSequencesDefinition,
];
