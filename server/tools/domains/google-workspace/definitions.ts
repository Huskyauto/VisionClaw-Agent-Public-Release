/**
 * Tools-layer-split S34 — google-workspace-domain tool definition.
 *
 * The Google Workspace access tool (1 tool): `google_workspace` — Gmail,
 * Calendar, Contacts, Sheets, Docs, and Slides via server/google-workspace.ts.
 * The definition is a VERBATIM lift of the inline object literal previously in
 * server/tools.ts's TOOL_DEFINITIONS array — same name/description/parameters
 * (the LLM-facing contract is byte-identical); only its storage location
 * changes. The facade re-imports this const ref and splices it back at its
 * original array position.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const googleWorkspaceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "google_workspace",
    description: "Access Google Workspace services: Gmail, Calendar, Contacts, Sheets, Docs, and Slides. Requires Google account to be connected via Settings > General > Connect Subscription. Use this for reading/sending emails, managing calendar events, looking up contacts, reading/writing spreadsheets, reading/creating documents, and creating professional Google Slides presentations.",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string", enum: ["gmail", "calendar", "contacts", "sheets", "docs", "slides"], description: "Which Google service to use" },
        action: { type: "string", description: "Action to perform. Gmail: search, read, send, label. Calendar: list, create, delete. Contacts: list, create. Sheets: get, update, append, clear, metadata. Docs: get, create. Slides: create." },
        query: { type: "string", description: "Gmail: search query (e.g. 'newer_than:7d from:boss@company.com'). Contacts: search name/email." },
        messageId: { type: "string", description: "Gmail message ID for read/label actions" },
        to: { type: "string", description: "Gmail send: recipient email address" },
        cc: { type: "string", description: "Gmail send: CC recipients" },
        bcc: { type: "string", description: "Gmail send: BCC recipients" },
        subject: { type: "string", description: "Gmail send: email subject. Docs create: document title. Calendar create: event title. Slides create: presentation title." },
        body: { type: "string", description: "Gmail send: email body (HTML supported). Docs create: initial text content." },
        addLabels: { type: "array", items: { type: "string" }, description: "Gmail label: label IDs to add (e.g. ['STARRED', 'IMPORTANT'])" },
        removeLabels: { type: "array", items: { type: "string" }, description: "Gmail label: label IDs to remove (e.g. ['UNREAD'])" },
        timeMin: { type: "string", description: "Calendar list: start time ISO 8601 (e.g. '2026-03-20T00:00:00Z')" },
        timeMax: { type: "string", description: "Calendar list: end time ISO 8601" },
        start: { type: "string", description: "Calendar create: event start (ISO 8601 datetime or YYYY-MM-DD for all-day)" },
        end: { type: "string", description: "Calendar create: event end (ISO 8601 datetime or YYYY-MM-DD for all-day)" },
        description: { type: "string", description: "Calendar create: event description" },
        location: { type: "string", description: "Calendar create: event location" },
        attendees: { type: "array", items: { type: "string" }, description: "Calendar create: attendee email addresses" },
        eventId: { type: "string", description: "Calendar delete: event ID" },
        calendarId: { type: "string", description: "Calendar: calendar ID (default: 'primary')" },
        name: { type: "string", description: "Contacts create: full name" },
        email: { type: "string", description: "Contacts create: email address" },
        phone: { type: "string", description: "Contacts create: phone number" },
        organization: { type: "string", description: "Contacts create: company/organization name" },
        spreadsheetId: { type: "string", description: "Sheets: Google Sheets spreadsheet ID" },
        documentId: { type: "string", description: "Docs: Google Docs document ID" },
        range: { type: "string", description: "Sheets: cell range (e.g. 'Sheet1!A1:D10')" },
        values: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Sheets update/append: 2D array of values" },
        inputOption: { type: "string", enum: ["RAW", "USER_ENTERED"], description: "Sheets: how to interpret input values (default: USER_ENTERED)" },
        maxResults: { type: "number", description: "Max results to return (default varies by service)" },
        slides: { type: "array", description: "Slides create: structured slide array. Each: { title, subtitle?, body?, bullets[]?, speakerNotes?, layout ('TITLE'|'TITLE_AND_BODY'|'SECTION_HEADER'|'TWO_COLUMNS'|'IMAGE_RIGHT'|'IMAGE_LEFT'|'IMAGE_FULL'|'BIG_NUMBER'|'QUOTE'|'BLANK'|'FLOWCHART'|'TABLE'|'ARCHITECTURE'|'TIMELINE'|'COMPARISON'|'METRICS_DASHBOARD'|'PROCESS'), imageUrl?, imageCaption?, leftColumn?, rightColumn?, table?, bigNumber?, bigNumberLabel?, quote?, quoteAttribution?, accentColor?, flowSteps[]?, timelineItems[]?, architectureTiers[]?, comparisonItems[]?, metrics[]?, processSteps[]? }", items: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
        theme: { type: "string", description: "Slides create: theme name ('dark-tech', 'corporate', 'startup', 'minimal', 'neon') or custom object { primaryColor, backgroundColor, fontFamily }" },
        logoUrl: { type: "string", description: "Slides create: public HTTPS URL of logo image. Placed large on title slides and as watermark on all other slides." },
      },
      required: ["service", "action"],
    },
  },
};

export const googleWorkspaceDomainDefinitions: ToolDefinition[] = [
  googleWorkspaceDefinition,
];
