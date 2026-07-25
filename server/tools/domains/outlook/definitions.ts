/**
 * Tools-layer-split S33 — outlook-domain tool definitions.
 *
 * The 3 read-only Outlook tools (`outlook_list_inbox`, `outlook_search_inbox`,
 * `outlook_read_message`) — a single coherent cluster backed solely by
 * `server/lib/outlook` (`listInboxMessages` / `searchMessages` / `readMessage`)
 * with every body field wrapped via `server/external-content-security`
 * `wrapExternalContent` (email is a canonical prompt-injection surface).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const outlookListInboxDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "outlook_list_inbox",
    description: "R125+8 — List recent messages from Bob's personal Outlook inbox (admin-tenant only, READ-ONLY). Newest first. Optional filters: from sender address, unread-only, since/until ISO date. Returns up to 100 message summaries (id, subject, from, receivedDateTime, bodyPreview, isRead, hasAttachments, webLink). Use this to scan recent mail before calling outlook_read_message on a specific item. All summaries are wrapped via wrapExternalContent — email content is a prompt-injection surface.",
    parameters: {
      type: "object",
      properties: {
        top: { type: "number", description: "Max messages to return (1-100, default 25)" },
        from_address: { type: "string", description: "Filter to a single sender email address (e.g. 'ideas@ideabrowser.com')" },
        unread_only: { type: "boolean", description: "Only return unread messages" },
        since_iso: { type: "string", description: "Only messages received on/after this ISO-8601 timestamp (e.g. '2026-05-01T00:00:00Z')" },
        until_iso: { type: "string", description: "Only messages received on/before this ISO-8601 timestamp" },
      },
    },
  },
};

export const outlookSearchInboxDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "outlook_search_inbox",
    description: "R125+8 — Full-text search across Bob's Outlook mail via Microsoft Graph $search (admin-tenant only, READ-ONLY). Searches subject + body + from. Use when you want to find messages by keyword/topic rather than by sender or date. Returns up to 100 message summaries, wrapped via wrapExternalContent.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords (KQL syntax supported)" },
        top: { type: "number", description: "Max messages to return (1-100, default 25)" },
      },
      required: ["query"],
    },
  },
};

export const outlookReadMessageDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "outlook_read_message",
    description: "R125+8 — Read a single Outlook message in full (body included) by message id (admin-tenant only, READ-ONLY). Get the id from outlook_list_inbox or outlook_search_inbox first. Returns subject, from, to, cc, receivedDateTime, body (text or HTML), conversationId. Body is wrapped via wrapExternalContent — adversarial email content cannot smuggle tool-call-shaped strings back into the next turn.",
    parameters: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Graph message id (from outlook_list_inbox or outlook_search_inbox)" },
      },
      required: ["message_id"],
    },
  },
};

export const outlookDomainDefinitions: ToolDefinition[] = [
  outlookListInboxDefinition,
  outlookSearchInboxDefinition,
  outlookReadMessageDefinition,
];
