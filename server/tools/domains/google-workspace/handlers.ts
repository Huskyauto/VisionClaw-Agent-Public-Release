/**
 * Tools-layer-split S34 — google-workspace-domain migrated handler.
 *
 * The Google Workspace access tool (1 tool): `google_workspace` — a thin
 * service/action router over server/google-workspace.ts (Gmail, Calendar,
 * Contacts, Sheets, Docs, Slides). The body is a MECHANICAL move of the legacy
 * switch arm (standing rules: no renames, no behavior change, no added/removed
 * gate; result field shapes, coercions, console logs, and error strings
 * preserved VERBATIM).
 *
 * SEAM (read-from-ctx): the legacy arm read the dispatcher-stripped
 * `params._tenantId` for its fail-closed tenant guard (`!params._tenantId`) AND
 * threaded it into every backing-lib call + the 401 token-repair path. This
 * handler reads `ctx.tenantId` — the same platform-derived value — with the
 * IDENTICAL guard + error string. `_tenantId` is the ONLY stripped trust signal
 * this arm read. `_projectDriveFolderId` (threaded into slidesCreate) is a
 * DELIBERATELY non-stripped, non-authoritative passthrough (see
 * server/tools/context.ts) so it is read from `params` verbatim, exactly as the
 * legacy arm did. All other keys (service/action/query/messageId/… ) are PUBLIC
 * request params.
 *
 * The backing lib is pulled via call-time dynamic `import(...)` — NOT top-level
 * static imports — so the domain module statically imports only within
 * server/tools/ and cannot recurse into the app graph (acyclicity invariant,
 * plan.md S2). server/google-workspace.ts does not import the tools facade
 * (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import { retryWithBackoff } from "../../lib/retry";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { googleWorkspaceDefinition } from "./definitions";

async function googleWorkspaceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for google_workspace" };
  const tenantId = ctx.tenantId;
  const { service, action } = params;

  const {
    gmailSearch,
    gmailGetMessage,
    gmailSend,
    gmailModifyLabels,
    calendarListEvents,
    calendarCreateEvent,
    calendarDeleteEvent,
    contactsList,
    contactsCreate,
    sheetsGet,
    sheetsUpdate,
    sheetsAppend,
    sheetsClear,
    sheetsMetadata,
    docsGet,
    docsCreate,
    slidesCreate,
  } = await import("../../../google-workspace");

  const execGws = async (): Promise<any> => {
    switch (service) {
      case "gmail":
        switch (action) {
          case "search": return await gmailSearch(tenantId, params.query || "newer_than:7d", params.maxResults);
          case "read": {
            if (!params.messageId) return { error: "messageId is required" };
            return await gmailGetMessage(tenantId, params.messageId);
          }
          case "send": {
            if (!params.to || !params.subject) return { error: "to and subject are required" };
            const { enforceOutbound } = await import("../../../lib/outbound-redaction");
            const subjectGate = enforceOutbound(String(params.subject || ""), { surface: "gmail_send:subject" });
            if (!subjectGate.ok) return { error: subjectGate.error };
            const bodyGate = enforceOutbound(String(params.body || ""), { surface: "gmail_send:body" });
            if (!bodyGate.ok) return { error: bodyGate.error };
            const result = await gmailSend(tenantId, params.to, subjectGate.payload, bodyGate.payload, params.cc, params.bcc);
            return (subjectGate.redacted || bodyGate.redacted)
              ? { ...(result as any), redactionWarning: "Outbound payload redacted by R95 safety gate." }
              : result;
          }
          case "label": {
            if (!params.messageId) return { error: "messageId is required" };
            return await gmailModifyLabels(tenantId, params.messageId, params.addLabels, params.removeLabels);
          }
          default: return { error: `Unknown gmail action: ${action}. Use: search, read, send, label` };
        }
      case "calendar":
        switch (action) {
          case "list": return await calendarListEvents(tenantId, params.timeMin, params.timeMax, params.maxResults, params.calendarId);
          case "create": {
            if (!params.subject || !params.start || !params.end) return { error: "subject, start, and end are required" };
            return await calendarCreateEvent(tenantId, params.subject, params.start, params.end, {
              description: params.description, location: params.location, attendees: params.attendees, calendarId: params.calendarId,
            });
          }
          case "delete": {
            if (!params.eventId) return { error: "eventId is required" };
            return await calendarDeleteEvent(tenantId, params.eventId, params.calendarId);
          }
          default: return { error: `Unknown calendar action: ${action}. Use: list, create, delete` };
        }
      case "contacts":
        switch (action) {
          case "list": return await contactsList(tenantId, params.query, params.maxResults);
          case "create": {
            if (!params.name) return { error: "name is required" };
            return await contactsCreate(tenantId, params.name, params.email, params.phone, params.organization);
          }
          default: return { error: `Unknown contacts action: ${action}. Use: list, create` };
        }
      case "sheets":
        switch (action) {
          case "get": {
            if (!params.spreadsheetId || !params.range) return { error: "spreadsheetId and range are required" };
            return await sheetsGet(tenantId, params.spreadsheetId, params.range);
          }
          case "update": {
            if (!params.spreadsheetId || !params.range || !params.values) return { error: "spreadsheetId, range, and values are required" };
            return await sheetsUpdate(tenantId, params.spreadsheetId, params.range, params.values, params.inputOption);
          }
          case "append": {
            if (!params.spreadsheetId || !params.range || !params.values) return { error: "spreadsheetId, range, and values are required" };
            return await sheetsAppend(tenantId, params.spreadsheetId, params.range, params.values, params.inputOption);
          }
          case "clear": {
            if (!params.spreadsheetId || !params.range) return { error: "spreadsheetId and range are required" };
            return await sheetsClear(tenantId, params.spreadsheetId, params.range);
          }
          case "metadata": {
            if (!params.spreadsheetId) return { error: "spreadsheetId is required" };
            return await sheetsMetadata(tenantId, params.spreadsheetId);
          }
          default: return { error: `Unknown sheets action: ${action}. Use: get, update, append, clear, metadata` };
        }
      case "docs":
        switch (action) {
          case "get": {
            if (!params.documentId) return { error: "documentId is required" };
            return await docsGet(tenantId, params.documentId);
          }
          case "create": {
            if (!params.subject) return { error: "subject (document title) is required" };
            return await docsCreate(tenantId, params.subject, params.body);
          }
          default: return { error: `Unknown docs action: ${action}. Use: get, create` };
        }
      case "slides":
        switch (action) {
          case "create": {
            if (!params.subject) return { error: "subject (presentation title) is required" };
            let slidesList = params.slides;
            if (!slidesList || !Array.isArray(slidesList) || slidesList.length === 0) {
              const topicText = params.body || params.subject;
              const lines = topicText.split(/\n+/).filter((l: string) => l.trim());
              slidesList = [
                { title: params.subject, body: "AI-Powered Presentation", layout: "TITLE" },
              ];
              let currentSlide: any = null;
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.match(/^#{1,3}\s/) || trimmed.match(/^[A-Z].*:$/) || (trimmed.length < 60 && !trimmed.startsWith("-") && !trimmed.startsWith("•"))) {
                  if (currentSlide) slidesList.push(currentSlide);
                  currentSlide = { title: trimmed.replace(/^#+\s*/, "").replace(/:$/, ""), bullets: [] };
                } else if (currentSlide) {
                  currentSlide.bullets.push(trimmed.replace(/^[-•*]\s*/, ""));
                } else {
                  currentSlide = { title: "Overview", bullets: [trimmed.replace(/^[-•*]\s*/, "")] };
                }
              }
              if (currentSlide) slidesList.push(currentSlide);
              if (slidesList.length < 2) {
                slidesList = [
                  { title: params.subject, body: topicText.slice(0, 100), layout: "TITLE" },
                  { title: "Overview", bullets: lines.slice(0, 6).map((l: string) => l.trim().replace(/^[-•*]\s*/, "")) },
                  { title: "Key Points", bullets: lines.slice(6, 12).map((l: string) => l.trim().replace(/^[-•*]\s*/, "")) },
                  { title: "Summary", body: "Thank you" },
                ].filter(s => s.bullets ? s.bullets.length > 0 : true);
              }
              console.log(`[google_workspace/slides] Auto-generated ${slidesList.length} slides from topic text`);
            }
            const GWS_LOGO_URL = process.env.SITE_LOGO_URL || "";
            const gwsIsRealDriveId = (id: string) => /^[a-zA-Z0-9_-]{20,}$/.test(id) && !/^\d{10,}-/.test(id);
            let gwsLogoUrl: string = GWS_LOGO_URL;
            if (params.logoUrl && typeof params.logoUrl === "string" && params.logoUrl !== GWS_LOGO_URL) {
              try {
                const parsed = new URL(params.logoUrl);
                const h = parsed.hostname.toLowerCase();
                if (h === "lh3.googleusercontent.com" && parsed.pathname.startsWith("/d/")) {
                  const gwsFileId = parsed.pathname.split("/d/")[1]?.split("?")[0] || "";
                  if (gwsIsRealDriveId(gwsFileId)) {
                    gwsLogoUrl = params.logoUrl;
                    console.log(`[google_workspace/slides] Custom logoUrl accepted (lh3 format, valid Drive ID)`);
                  } else {
                    console.log(`[google_workspace/slides] logoUrl has lh3 format but invalid Drive ID (${gwsFileId.slice(0, 20)}), using default logo`);
                  }
                } else if (h === "drive.google.com" || h === "docs.google.com") {
                  const driveIdMatch = params.logoUrl.match(/(?:\/d\/|[?&]id=)([a-zA-Z0-9_-]+)/);
                  if (driveIdMatch && gwsIsRealDriveId(driveIdMatch[1])) {
                    gwsLogoUrl = `https://lh3.googleusercontent.com/d/${driveIdMatch[1]}`;
                    console.log(`[google_workspace/slides] Converted Drive logoUrl to lh3 format: ${gwsLogoUrl.slice(0, 60)}`);
                  } else {
                    console.log(`[google_workspace/slides] Could not extract valid Drive file ID, using default logo`);
                  }
                } else {
                  console.log(`[google_workspace/slides] logoUrl not Google-hosted (${h}), using default logo`);
                }
              } catch {
                console.log(`[google_workspace/slides] Invalid logoUrl, using default logo`);
              }
            }
            console.log(`[google_workspace/slides] Logo auto-injected: ${gwsLogoUrl.slice(0, 60)}...`);
            return await slidesCreate(tenantId, {
              title: params.subject,
              slides: slidesList,
              theme: params.theme,
              logoUrl: gwsLogoUrl,
              _projectDriveFolderId: params._projectDriveFolderId,
            });
          }
          default: return { error: `Unknown slides action: ${action}. Use: create` };
        }
      default: return { error: `Unknown service: ${service}. Use: gmail, calendar, contacts, sheets, docs, slides` };
    }
  };

  try {
    return await retryWithBackoff(execGws, { retries: 1, delayMs: 2000, label: `google_workspace/${service}/${action}` });
  } catch (err: any) {
    const msg = err.message || "";
    if (msg.includes("401") || msg.includes("invalid_grant") || msg.includes("invalid authentication")) {
      console.warn(`[google_workspace] 401 auth error — forcing full token repair and retrying`);
      try {
        const { clearGoogleTokenCache } = await import("../../../google-workspace");
        const { connectGoogleViaReplit } = await import("../../../oauth-subscriptions");
        clearGoogleTokenCache();
        // R64.C — fail-closed: don't attempt Google reconnect against the
        // admin tenant if the caller omitted tenant context.
        const tid = ctx.tenantId;
        if (!tid) {
          return { error: `Google Workspace auth error (${service}/${action}): ${msg.slice(0, 200)}. Tenant context required for token repair.` };
        }
        await connectGoogleViaReplit(tid).catch(() => {});
        const retryResult = await execGws();
        return retryResult;
      } catch (retryErr: any) {
        return { error: `Google Workspace auth error (${service}/${action}): ${(retryErr.message || msg).slice(0, 200)}. Token may have expired — try reconnecting Google in Settings.` };
      }
    }
    if (msg.includes("403")) {
      return { error: `Google Workspace auth error (${service}/${action}): ${msg.slice(0, 200)}. Token may have expired — try reconnecting Google in Settings.` };
    }
    return { error: `Google Workspace error (${service}/${action}): ${msg.slice(0, 300)}` };
  }
}

/** Registered by ./index.ts at import time. */
export const googleWorkspaceDomainTools: RegisteredTool[] = [
  defineTool(googleWorkspaceDefinition, googleWorkspaceHandler),
];
