import path from "path";
import { getAccessToken as getDriveConnectorToken } from "./google-drive";
import { getSubscriptionAccessToken } from "./oauth-subscriptions";

import { logSilentCatch } from "./lib/silent-catch";
const GOOGLE_API = "https://www.googleapis.com";
const PEOPLE_API = "https://people.googleapis.com/v1";
const VISIONCLAW_LOGO_URL = process.env.SITE_LOGO_URL || "";

const _connectorCache: Record<string, { token: string; expiresAt: number }> = {};

export function clearGoogleTokenCache(connectorName?: string) {
  if (connectorName) {
    delete _connectorCache[connectorName];
  } else {
    for (const key of Object.keys(_connectorCache)) {
      delete _connectorCache[key];
    }
  }
  console.log(`[google_workspace] Token cache cleared${connectorName ? ` for ${connectorName}` : " (all)"}`);
}

async function getConnectorToken(connectorName: string): Promise<string | null> {
  const cached = _connectorCache[connectorName];
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? "repl " + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
    if (!hostname || !xReplitToken) return null;

    const resp = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=${connectorName}`,
      { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } }
    );
    const data = await resp.json();
    const conn = data.items?.[0];
    if (!conn) return null;

    const token = conn.settings?.access_token || conn.settings?.oauth?.credentials?.access_token;
    if (!token) return null;

    const expiresAt = conn.settings?.expires_at
      ? new Date(conn.settings.expires_at).getTime()
      : Date.now() + 4 * 60 * 1000;
    _connectorCache[connectorName] = { token, expiresAt };
    return token;
  } catch (err: any) {
    console.error(`[google_workspace] Connector ${connectorName} error:`, err.message?.substring(0, 80));
    return null;
  }
}

const SERVICE_CONNECTOR_MAP: Record<string, string> = {
  gmail: "google-mail",
  sheets: "google-sheet",
  calendar: "google-calendar",
  contacts: "google-drive",
  docs: "google-drive",
  slides: "google-drive",
};

export async function getGoogleToken(tenantId: number, service?: string): Promise<string> {
  const oauthToken = await getSubscriptionAccessToken("google-workspace", tenantId);
  if (oauthToken) return oauthToken;

  const ADMIN_TENANT_ID = Number(process.env.ADMIN_TENANT_ID) || 1;
  if (tenantId !== ADMIN_TENANT_ID) {
    console.warn(`[google_workspace] Tenant ${tenantId} has no subscription token — connector fallback only available for admin tenant (${ADMIN_TENANT_ID})`);
    throw new Error("Google account not connected for this tenant. Please connect Google in Settings.");
  }

  const connectorName = service ? SERVICE_CONNECTOR_MAP[service] : null;
  if (connectorName) {
    const token = await getConnectorToken(connectorName);
    if (token) return token;
  }

  try {
    const driveToken = await getDriveConnectorToken();
    if (driveToken) {
      console.log(`[google_workspace] Using Drive connector fallback for ${service || "unknown"} (admin tenant)`);
      return driveToken;
    }
  } catch (_silentErr) { logSilentCatch("server/google-workspace.ts", _silentErr); }

  throw new Error("Google account not connected. Please contact the administrator.");
}

async function gFetch(token: string, url: string, init?: RequestInit, _retryContext?: { tenantId: number; service?: string }): Promise<any> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (resp.status === 401 && _retryContext) {
    console.warn(`[google_workspace] Got 401 from Google API — clearing token cache and retrying`);
    clearGoogleTokenCache();
    const freshToken = await getGoogleToken(_retryContext.tenantId, _retryContext.service);
    if (freshToken && freshToken !== token) {
      const retryResp = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${freshToken}`,
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
      if (!retryResp.ok) {
        const text = await retryResp.text();
        throw new Error(`Google API ${retryResp.status}: ${text.slice(0, 500)}. Token may have expired — try reconnecting Google in Settings.`);
      }
      if (retryResp.status === 204) return { success: true };
      return retryResp.json();
    }
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google API ${resp.status}: ${text.slice(0, 500)}. Token may have expired — try reconnecting Google in Settings.`);
  }
  if (resp.status === 204) return { success: true };
  return resp.json();
}

export async function gmailSearch(tenantId: number, query: string, maxResults = 10): Promise<any> {
  const token = await getGoogleToken(tenantId, "gmail");
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const list = await gFetch(token, `${GOOGLE_API}/gmail/v1/users/me/messages?${params}`);
  if (!list.messages?.length) return { messages: [], total: 0 };

  const details = await Promise.all(
    list.messages.slice(0, maxResults).map(async (m: any) => {
      const msg = await gFetch(token, `${GOOGLE_API}/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
      return {
        id: msg.id,
        threadId: msg.threadId,
        snippet: msg.snippet,
        from: getHeader("From"),
        to: getHeader("To"),
        subject: getHeader("Subject"),
        date: getHeader("Date"),
        labels: msg.labelIds,
      };
    })
  );

  return { messages: details, total: list.resultSizeEstimate || details.length };
}

export async function gmailGetMessage(tenantId: number, messageId: string): Promise<any> {
  const token = await getGoogleToken(tenantId, "gmail");
  const msg = await gFetch(token, `${GOOGLE_API}/gmail/v1/users/me/messages/${messageId}?format=full`);
  const headers = msg.payload?.headers || [];
  const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

  let body = "";
  function extractBody(part: any): string {
    if (part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf-8");
    if (part.parts) return part.parts.map(extractBody).join("\n");
    return "";
  }
  body = extractBody(msg.payload);

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader("From"),
    to: getHeader("To"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    body: body.slice(0, 10000),
    labels: msg.labelIds,
  };
}

export async function gmailSend(tenantId: number, to: string, subject: string, body: string, cc?: string, bcc?: string): Promise<any> {
  const token = await getGoogleToken(tenantId, "gmail");

  let rawEmail = `To: ${to}\nSubject: ${subject}\nContent-Type: text/html; charset=utf-8\nMIME-Version: 1.0\n`;
  if (cc) rawEmail += `Cc: ${cc}\n`;
  if (bcc) rawEmail += `Bcc: ${bcc}\n`;
  rawEmail += `\n${body}`;

  const encoded = Buffer.from(rawEmail).toString("base64url");
  return gFetch(token, `${GOOGLE_API}/gmail/v1/users/me/messages/send`, {
    method: "POST",
    body: JSON.stringify({ raw: encoded }),
  });
}

export async function gmailModifyLabels(tenantId: number, messageId: string, addLabels?: string[], removeLabels?: string[]): Promise<any> {
  const token = await getGoogleToken(tenantId, "gmail");
  return gFetch(token, `${GOOGLE_API}/gmail/v1/users/me/messages/${messageId}/modify`, {
    method: "POST",
    body: JSON.stringify({
      addLabelIds: addLabels || [],
      removeLabelIds: removeLabels || [],
    }),
  });
}

export async function calendarListEvents(tenantId: number, timeMin?: string, timeMax?: string, maxResults = 20, calendarId = "primary"): Promise<any> {
  const token = await getGoogleToken(tenantId, "calendar");
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime",
  });
  if (timeMin) params.set("timeMin", timeMin);
  else params.set("timeMin", new Date().toISOString());
  if (timeMax) params.set("timeMax", timeMax);

  const data = await gFetch(token, `${GOOGLE_API}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  return {
    events: (data.items || []).map((e: any) => ({
      id: e.id,
      summary: e.summary,
      description: e.description,
      location: e.location,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      status: e.status,
      htmlLink: e.htmlLink,
      attendees: e.attendees?.map((a: any) => ({ email: a.email, responseStatus: a.responseStatus })),
    })),
    nextPageToken: data.nextPageToken,
  };
}

export async function calendarCreateEvent(
  tenantId: number,
  summary: string,
  start: string,
  end: string,
  options?: { description?: string; location?: string; attendees?: string[]; calendarId?: string }
): Promise<any> {
  const token = await getGoogleToken(tenantId, "calendar");
  const calId = options?.calendarId || "primary";

  const isAllDay = !start.includes("T");
  const event: any = {
    summary,
    start: isAllDay ? { date: start } : { dateTime: start },
    end: isAllDay ? { date: end } : { dateTime: end },
  };
  if (options?.description) event.description = options.description;
  if (options?.location) event.location = options.location;
  if (options?.attendees?.length) event.attendees = options.attendees.map(email => ({ email }));

  const created = await gFetch(token, `${GOOGLE_API}/calendar/v3/calendars/${encodeURIComponent(calId)}/events?sendUpdates=all`, {
    method: "POST",
    body: JSON.stringify(event),
  });
  return { id: created.id, htmlLink: created.htmlLink, summary: created.summary, start: created.start, end: created.end };
}

export async function calendarDeleteEvent(tenantId: number, eventId: string, calendarId = "primary"): Promise<any> {
  const token = await getGoogleToken(tenantId, "calendar");
  await gFetch(token, `${GOOGLE_API}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`, { method: "DELETE" });
  return { success: true, deleted: eventId };
}

export async function contactsList(tenantId: number, query?: string, maxResults = 20): Promise<any> {
  const token = await getGoogleToken(tenantId, "contacts");
  const params = new URLSearchParams({
    pageSize: String(maxResults),
    personFields: "names,emailAddresses,phoneNumbers,organizations",
  });
  if (query) params.set("query", query);

  const endpoint = query
    ? `${PEOPLE_API}/people:searchContacts?${params}`
    : `${PEOPLE_API}/people/me/connections?${params}&sortOrder=LAST_MODIFIED_DESCENDING`;

  const data = await gFetch(token, endpoint);
  const results = query ? data.results?.map((r: any) => r.person) : data.connections;

  return {
    contacts: (results || []).map((p: any) => ({
      resourceName: p.resourceName,
      name: p.names?.[0]?.displayName,
      email: p.emailAddresses?.[0]?.value,
      phone: p.phoneNumbers?.[0]?.value,
      organization: p.organizations?.[0]?.name,
    })),
  };
}

export async function contactsCreate(tenantId: number, name: string, email?: string, phone?: string, organization?: string): Promise<any> {
  const token = await getGoogleToken(tenantId, "contacts");
  const person: any = {
    names: [{ givenName: name.split(" ")[0], familyName: name.split(" ").slice(1).join(" ") || undefined }],
  };
  if (email) person.emailAddresses = [{ value: email }];
  if (phone) person.phoneNumbers = [{ value: phone }];
  if (organization) person.organizations = [{ name: organization }];

  const created = await gFetch(token, `${PEOPLE_API}/people:createContact`, {
    method: "POST",
    body: JSON.stringify(person),
  });
  return { resourceName: created.resourceName, name: created.names?.[0]?.displayName };
}

export async function sheetsGet(tenantId: number, spreadsheetId: string, range: string): Promise<any> {
  const token = await getGoogleToken(tenantId, "sheets");
  const data = await gFetch(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  return { range: data.range, values: data.values || [], majorDimension: data.majorDimension };
}

export async function sheetsUpdate(tenantId: number, spreadsheetId: string, range: string, values: any[][], inputOption = "USER_ENTERED"): Promise<any> {
  const token = await getGoogleToken(tenantId, "sheets");
  return gFetch(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=${inputOption}`, {
    method: "PUT",
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
}

export async function sheetsAppend(tenantId: number, spreadsheetId: string, range: string, values: any[][], inputOption = "USER_ENTERED"): Promise<any> {
  const token = await getGoogleToken(tenantId, "sheets");
  return gFetch(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=${inputOption}&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
}

export async function sheetsClear(tenantId: number, spreadsheetId: string, range: string): Promise<any> {
  const token = await getGoogleToken(tenantId, "sheets");
  return gFetch(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function sheetsMetadata(tenantId: number, spreadsheetId: string): Promise<any> {
  const token = await getGoogleToken(tenantId, "sheets");
  const data = await gFetch(token, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties`);
  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title,
    sheets: (data.sheets || []).map((s: any) => ({
      sheetId: s.properties?.sheetId,
      title: s.properties?.title,
      rowCount: s.properties?.gridProperties?.rowCount,
      columnCount: s.properties?.gridProperties?.columnCount,
    })),
  };
}

export async function docsGet(tenantId: number, documentId: string): Promise<any> {
  const token = await getGoogleToken(tenantId, "docs");
  const doc = await gFetch(token, `https://docs.googleapis.com/v1/documents/${documentId}`);

  let textContent = "";
  function extractText(elements: any[]) {
    for (const el of elements || []) {
      if (el.paragraph?.elements) {
        for (const pe of el.paragraph.elements) {
          if (pe.textRun?.content) textContent += pe.textRun.content;
        }
      }
      if (el.table) {
        for (const row of el.table.tableRows || []) {
          for (const cell of row.tableCells || []) {
            extractText(cell.content || []);
          }
        }
      }
    }
  }
  extractText(doc.body?.content || []);

  return {
    documentId: doc.documentId,
    title: doc.title,
    textContent: textContent.slice(0, 20000),
  };
}

export async function docsCreate(tenantId: number, title: string, content?: string): Promise<any> {
  const token = await getGoogleToken(tenantId, "docs");
  const doc = await gFetch(token, `https://docs.googleapis.com/v1/documents`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });

  if (content) {
    await gFetch(token, `https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [{ insertText: { location: { index: 1 }, text: content } }],
      }),
    });
  }

  return { documentId: doc.documentId, title: doc.title };
}

interface SlideContent {
  title: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  speakerNotes?: string;
  layout?: "TITLE" | "TITLE_AND_BODY" | "SECTION_HEADER" | "TWO_COLUMNS" | "IMAGE_RIGHT" | "IMAGE_LEFT" | "IMAGE_FULL" | "BIG_NUMBER" | "QUOTE" | "BLANK" | "FLOWCHART" | "TABLE" | "ARCHITECTURE" | "TIMELINE" | "COMPARISON" | "METRICS_DASHBOARD" | "PROCESS";
  imageUrl?: string;
  imageCaption?: string;
  leftColumn?: { title?: string; bullets?: string[] };
  rightColumn?: { title?: string; bullets?: string[] };
  table?: { headers: string[]; rows: string[][] };
  bigNumber?: string;
  bigNumberLabel?: string;
  quote?: string;
  quoteAttribution?: string;
  accentColor?: string;
  flowSteps?: { label: string; description?: string; color?: string }[];
  timelineItems?: { date: string; title: string; description?: string }[];
  architectureTiers?: { label: string; items: string[]; color?: string }[];
  comparisonItems?: { title: string; bullets: string[]; highlight?: boolean }[];
  metrics?: { value: string; label: string; trend?: string }[];
  processSteps?: { number: string; title: string; description?: string }[];
}

interface SlideThemePreset {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  titleBgColor: string;
  textColor: string;
  subtextColor: string;
  accentColor: string;
  fontFamily: string;
  headingFont: string;
}

const THEME_PRESETS: Record<string, SlideThemePreset> = {
  "dark-tech": {
    primaryColor: "#00d4ff",
    secondaryColor: "#7c3aed",
    backgroundColor: "#0f172a",
    titleBgColor: "#1e293b",
    textColor: "#e2e8f0",
    subtextColor: "#94a3b8",
    accentColor: "#00d4ff",
    fontFamily: "Roboto",
    headingFont: "Montserrat",
  },
  "corporate": {
    primaryColor: "#1e40af",
    secondaryColor: "#3b82f6",
    backgroundColor: "#ffffff",
    titleBgColor: "#1e40af",
    textColor: "#1e293b",
    subtextColor: "#64748b",
    accentColor: "#3b82f6",
    fontFamily: "Open Sans",
    headingFont: "Montserrat",
  },
  "startup": {
    primaryColor: "#7c3aed",
    secondaryColor: "#ec4899",
    backgroundColor: "#faf5ff",
    titleBgColor: "#7c3aed",
    textColor: "#1e1b4b",
    subtextColor: "#6b7280",
    accentColor: "#ec4899",
    fontFamily: "Inter",
    headingFont: "Inter",
  },
  "minimal": {
    primaryColor: "#18181b",
    secondaryColor: "#71717a",
    backgroundColor: "#ffffff",
    titleBgColor: "#18181b",
    textColor: "#18181b",
    subtextColor: "#71717a",
    accentColor: "#ef4444",
    fontFamily: "Roboto",
    headingFont: "Roboto",
  },
  "neon": {
    primaryColor: "#22d3ee",
    secondaryColor: "#a855f7",
    backgroundColor: "#030712",
    titleBgColor: "#111827",
    textColor: "#f9fafb",
    subtextColor: "#9ca3af",
    accentColor: "#22d3ee",
    fontFamily: "Roboto Mono",
    headingFont: "Montserrat",
  },
};

interface SlidesCreateOptions {
  title: string;
  slides: SlideContent[];
  theme?: string | {
    primaryColor?: string;
    backgroundColor?: string;
    fontFamily?: string;
  };
  logoUrl?: string;
  _projectDriveFolderId?: string;
}

function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  const h = hex.replace("#", "");
  return {
    red: parseInt(h.substring(0, 2), 16) / 255,
    green: parseInt(h.substring(2, 4), 16) / 255,
    blue: parseInt(h.substring(4, 6), 16) / 255,
  };
}

function resolveTheme(themeInput?: string | { primaryColor?: string; backgroundColor?: string; fontFamily?: string }): SlideThemePreset {
  if (!themeInput) return THEME_PRESETS["dark-tech"];
  if (typeof themeInput === "string") {
    const key = themeInput.toLowerCase().replace(/[\s_]+/g, "-");
    if (THEME_PRESETS[key]) return THEME_PRESETS[key];
    for (const [k, v] of Object.entries(THEME_PRESETS)) {
      if (key.includes(k) || k.includes(key)) return v;
    }
    if (key.includes("dark")) return THEME_PRESETS["dark-tech"];
    if (key.includes("corp") || key.includes("business")) return THEME_PRESETS["corporate"];
    if (key.includes("startup") || key.includes("pitch")) return THEME_PRESETS["startup"];
    if (key.includes("neon") || key.includes("cyber")) return THEME_PRESETS["neon"];
    return THEME_PRESETS["dark-tech"];
  }
  const base = { ...THEME_PRESETS["dark-tech"] };
  if (themeInput.primaryColor) base.primaryColor = themeInput.primaryColor;
  if (themeInput.backgroundColor) base.backgroundColor = themeInput.backgroundColor;
  if (themeInput.fontFamily) { base.fontFamily = themeInput.fontFamily; base.headingFont = themeInput.fontFamily; }
  return base;
}

const EMU_INCH = 914400;
const SLIDE_W = 9144000;
const SLIDE_H = 5143500;
const MARGIN = 457200;

function eid(prefix: string, index: number): string {
  return `vc_${prefix}_${index}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

function safeHexToRgb(hex: string | undefined, fallback: { red: number; green: number; blue: number }): { red: number; green: number; blue: number } {
  if (!hex || typeof hex !== "string") return fallback;
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback;
  return hexToRgb(hex);
}

function isValidImageUrl(url: string | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.startsWith("127.") || hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname === "0.0.0.0" || hostname.startsWith("169.254.") || hostname.endsWith(".local") || hostname.startsWith("172.") && parseInt(hostname.split(".")[1]) >= 16 && parseInt(hostname.split(".")[1]) <= 31) return false;
    const lower = url.toLowerCase();
    if (lower.includes("placeholder") || lower.includes("example.com") || lower.includes("1abc123") || lower.includes("your-image") || lower.includes("sample-image") || lower.includes("fake") || lower.includes("dummy") || /id=1[a-z]+$/i.test(lower)) return false;
    return true;
  } catch { return false; }
}

function makeTextBox(id: string, slideId: string, x: number, y: number, w: number, h: number): any {
  return {
    createShape: {
      objectId: id,
      shapeType: "TEXT_BOX",
      elementProperties: {
        pageObjectId: slideId,
        size: { width: { magnitude: w, unit: "EMU" }, height: { magnitude: h, unit: "EMU" } },
        transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "EMU" },
      },
    },
  };
}

function makeRect(id: string, slideId: string, x: number, y: number, w: number, h: number): any {
  return {
    createShape: {
      objectId: id,
      shapeType: "RECTANGLE",
      elementProperties: {
        pageObjectId: slideId,
        size: { width: { magnitude: w, unit: "EMU" }, height: { magnitude: h, unit: "EMU" } },
        transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "EMU" },
      },
    },
  };
}

function fillRect(id: string, color: { red: number; green: number; blue: number }): any {
  return {
    updateShapeProperties: {
      objectId: id,
      shapeProperties: {
        shapeBackgroundFill: { solidFill: { color: { rgbColor: color } } },
        outline: { propertyState: "NOT_RENDERED" },
      },
      fields: "shapeBackgroundFill.solidFill.color,outline",
    },
  };
}

function styleText(id: string, opts: { font: string; size: number; color: { red: number; green: number; blue: number }; bold?: boolean; italic?: boolean }): any {
  const style: any = {
    fontFamily: opts.font,
    fontSize: { magnitude: opts.size, unit: "PT" },
    foregroundColor: { opaqueColor: { rgbColor: opts.color } },
  };
  const fields = ["fontFamily", "fontSize", "foregroundColor"];
  if (opts.bold !== undefined) { style.bold = opts.bold; fields.push("bold"); }
  if (opts.italic !== undefined) { style.italic = opts.italic; fields.push("italic"); }
  return {
    updateTextStyle: {
      objectId: id,
      style,
      textRange: { type: "ALL" },
      fields: fields.join(","),
    },
  };
}

function alignText(id: string, alignment: string): any {
  return {
    updateParagraphStyle: {
      objectId: id,
      style: { alignment },
      textRange: { type: "ALL" },
      fields: "alignment",
    },
  };
}

function makeBullets(id: string): any[] {
  return [
    { createParagraphBullets: { objectId: id, textRange: { type: "ALL" }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } },
    { updateParagraphStyle: { objectId: id, style: { spaceAbove: { magnitude: 4, unit: "PT" }, spaceBelow: { magnitude: 4, unit: "PT" }, lineSpacing: 130 }, textRange: { type: "ALL" }, fields: "spaceAbove,spaceBelow,lineSpacing" } },
  ];
}

export async function slidesCreate(tenantId: number, options: SlidesCreateOptions): Promise<any> {
  const token = await getGoogleToken(tenantId, "slides");
  const SLIDES_API = "https://slides.googleapis.com/v1/presentations";
  const theme = resolveTheme(options.theme);

  let presentation: any;
  try {
    presentation = await gFetch(token, SLIDES_API, {
      method: "POST",
      body: JSON.stringify({ title: options.title }),
    });
  } catch (createErr: any) {
    if (createErr.message?.includes("403") || createErr.message?.includes("insufficient") || createErr.message?.includes("scope") || createErr.message?.includes("PERMISSION_DENIED")) {
      console.log("[slides] Slides API scope not available, falling back to Drive API");
      const driveResp = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: options.title, mimeType: "application/vnd.google-apps.presentation" }),
      });
      if (!driveResp.ok) {
        const errText = await driveResp.text();
        throw new Error(`Drive API fallback failed (${driveResp.status}): ${errText.slice(0, 300)}`);
      }
      const driveFile = await driveResp.json();
      const presentationId = driveFile.id;
      await fetch(`https://www.googleapis.com/drive/v3/files/${presentationId}/permissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      }).catch(() => {});
      const slidesUrl = `https://docs.google.com/presentation/d/${presentationId}/edit`;
      try {
        presentation = await gFetch(token, `${SLIDES_API}/${presentationId}`);
      } catch {
        return { presentationId, url: slidesUrl, title: options.title, slideCount: 0, warning: "Slides API scope not available - presentation created as empty shell via Drive API" };
      }
    } else {
      throw createErr;
    }
  }

  const presentationId = presentation.presentationId;
  const defaultSlideId = presentation.slides?.[0]?.objectId;

  const primaryRgb = hexToRgb(theme.primaryColor);
  const secondaryRgb = hexToRgb(theme.secondaryColor);
  const bgRgb = hexToRgb(theme.backgroundColor);
  const titleBgRgb = hexToRgb(theme.titleBgColor);
  const textRgb = hexToRgb(theme.textColor);
  const subtextRgb = hexToRgb(theme.subtextColor);
  const accentRgb = hexToRgb(theme.accentColor);

  const requests: any[] = [];
  const notesDeferral: { slideId: string; text: string }[] = [];
  const slideRequestBoundaries: number[] = [];

  if (defaultSlideId) {
    requests.push({ deleteObject: { objectId: defaultSlideId } });
  }

  const totalSlides = options.slides.length;

  const deferredImageRequests: any[] = [];
  const chunkFailures: number[] = [];

  for (let i = 0; i < totalSlides; i++) {
    const slide = options.slides[i];
    const sid = eid("slide", i);
    const layout = slide.layout || (i === 0 ? "TITLE" : "TITLE_AND_BODY");
    const slideAccent = safeHexToRgb(slide.accentColor, accentRgb);
    const validImage = isValidImageUrl(slide.imageUrl);

    slideRequestBoundaries.push(requests.length);

    requests.push({
      createSlide: { objectId: sid, insertionIndex: i, slideLayoutReference: { predefinedLayout: "BLANK" } },
    });

    requests.push({
      updatePageProperties: {
        objectId: sid,
        pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: bgRgb } } } },
        fields: "pageBackgroundFill.solidFill.color",
      },
    });

    const accentBarId = eid("accent", i);
    requests.push(makeRect(accentBarId, sid, 0, 0, SLIDE_W, 28000));
    requests.push(fillRect(accentBarId, slideAccent));

    if (i > 0) {
      const numId = eid("num", i);
      requests.push(makeTextBox(numId, sid, SLIDE_W - 900000, SLIDE_H - 350000, 800000, 250000));
      requests.push({ insertText: { objectId: numId, text: `${i + 1}/${totalSlides}`, insertionIndex: 0 } });
      requests.push(styleText(numId, { font: theme.fontFamily, size: 10, color: subtextRgb }));
      requests.push(alignText(numId, "END"));
    }

    if (layout !== "TITLE" && options.logoUrl && isValidImageUrl(options.logoUrl)) {
      const wmLogoW = EMU_INCH * 0.8;
      const wmLogoH = EMU_INCH * 0.28;
      const wmLogoX = MARGIN * 0.5;
      const wmLogoY = SLIDE_H - wmLogoH - EMU_INCH * 0.15;
      const wmLogoId = eid("wmlogo", i);
      console.log(`[slides] Adding watermark logo to slide ${i + 1} (${layout}): ${options.logoUrl.slice(0, 60)}`);
      deferredImageRequests.push({
        createImage: {
          objectId: wmLogoId,
          url: options.logoUrl,
          elementProperties: {
            pageObjectId: sid,
            size: { width: { magnitude: wmLogoW, unit: "EMU" }, height: { magnitude: wmLogoH, unit: "EMU" } },
            transform: { scaleX: 1, scaleY: 1, translateX: wmLogoX, translateY: wmLogoY, unit: "EMU" },
          },
        },
      });
    }

    switch (layout) {
      case "TITLE": {
        const barId = eid("tbar", i);
        requests.push(makeRect(barId, sid, 0, 0, SLIDE_W, SLIDE_H));
        requests.push(fillRect(barId, titleBgRgb));

        const hasLogo = !!(options.logoUrl && isValidImageUrl(options.logoUrl));
        const titleLen = (slide.title || "").length;
        const hasSubtitle = !!(slide.subtitle || slide.body);
        const isLongTitle = titleLen > 50;
        const titleFontSize = isLongTitle ? 32 : 40;

        let logoBottomY = 0;
        if (hasLogo) {
          const logoW = EMU_INCH * 3.5;
          const logoH = EMU_INCH * 1.2;
          const logoX = (SLIDE_W - logoW) / 2;
          const logoY = SLIDE_H * 0.08;
          logoBottomY = logoY + logoH;
          const logoId = eid("logo", i);
          console.log(`[slides] Adding title logo to slide ${i + 1}: ${options.logoUrl!.slice(0, 60)}`);
          deferredImageRequests.push({
            createImage: {
              objectId: logoId,
              url: options.logoUrl!,
              elementProperties: {
                pageObjectId: sid,
                size: { width: { magnitude: logoW, unit: "EMU" }, height: { magnitude: logoH, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: logoX, translateY: logoY, unit: "EMU" },
              },
            },
          });
        }

        const titleStartY = hasLogo
          ? logoBottomY + EMU_INCH * 0.15
          : (isLongTitle && hasSubtitle ? SLIDE_H * 0.15 : SLIDE_H * 0.3);
        const titleBoxH = isLongTitle ? EMU_INCH * 2.0 : EMU_INCH * 1.2;

        const tId = eid("title", i);
        requests.push(makeTextBox(tId, sid, MARGIN, titleStartY, SLIDE_W - MARGIN * 2, titleBoxH));
        requests.push({ insertText: { objectId: tId, text: slide.title, insertionIndex: 0 } });
        requests.push(styleText(tId, { font: theme.headingFont, size: titleFontSize, color: primaryRgb, bold: true }));
        requests.push(alignText(tId, "CENTER"));

        if (hasSubtitle) {
          const stId = eid("subtitle", i);
          const subText = slide.subtitle || slide.body || "";
          const subY = hasLogo
            ? titleStartY + titleBoxH + EMU_INCH * 0.15
            : (isLongTitle ? SLIDE_H * 0.72 : SLIDE_H * 0.58);
          const subFontSize = subText.length > 60 ? 13 : 16;
          requests.push(makeTextBox(stId, sid, MARGIN, subY, SLIDE_W - MARGIN * 2, EMU_INCH * 0.6));
          requests.push({ insertText: { objectId: stId, text: subText, insertionIndex: 0 } });
          requests.push(styleText(stId, { font: theme.fontFamily, size: subFontSize, color: subtextRgb }));
          requests.push(alignText(stId, "CENTER"));
        }

        const dividerY = hasLogo
          ? titleStartY + titleBoxH + EMU_INCH * 0.05
          : (isLongTitle && hasSubtitle ? SLIDE_H * 0.68 : SLIDE_H * 0.54);
        const lineId = eid("divider", i);
        requests.push(makeRect(lineId, sid, SLIDE_W * 0.35, dividerY, SLIDE_W * 0.3, 20000));
        requests.push(fillRect(lineId, primaryRgb));
        break;
      }

      case "SECTION_HEADER": {
        const secBg = eid("secbg", i);
        requests.push(makeRect(secBg, sid, 0, 0, SLIDE_W, SLIDE_H));
        requests.push(fillRect(secBg, secondaryRgb));

        const secT = eid("sectitle", i);
        requests.push(makeTextBox(secT, sid, MARGIN, SLIDE_H * 0.35, SLIDE_W - MARGIN * 2, EMU_INCH));
        requests.push({ insertText: { objectId: secT, text: slide.title, insertionIndex: 0 } });
        requests.push(styleText(secT, { font: theme.headingFont, size: 36, color: { red: 1, green: 1, blue: 1 }, bold: true }));
        requests.push(alignText(secT, "CENTER"));

        if (slide.body) {
          const secSub = eid("secsub", i);
          requests.push(makeTextBox(secSub, sid, MARGIN * 2, SLIDE_H * 0.58, SLIDE_W - MARGIN * 4, EMU_INCH * 0.6));
          requests.push({ insertText: { objectId: secSub, text: slide.body, insertionIndex: 0 } });
          requests.push(styleText(secSub, { font: theme.fontFamily, size: 18, color: { red: 0.9, green: 0.9, blue: 0.9 } }));
          requests.push(alignText(secSub, "CENTER"));
        }
        break;
      }

      case "BIG_NUMBER": {
        const bnId = eid("bignum", i);
        requests.push(makeTextBox(bnId, sid, MARGIN, SLIDE_H * 0.15, SLIDE_W - MARGIN * 2, EMU_INCH * 1.8));
        requests.push({ insertText: { objectId: bnId, text: slide.bigNumber || slide.title, insertionIndex: 0 } });
        requests.push(styleText(bnId, { font: theme.headingFont, size: 72, color: primaryRgb, bold: true }));
        requests.push(alignText(bnId, "CENTER"));

        const bnLabel = eid("bignumlabel", i);
        const labelText = slide.bigNumberLabel || slide.body || slide.title;
        requests.push(makeTextBox(bnLabel, sid, MARGIN, SLIDE_H * 0.60, SLIDE_W - MARGIN * 2, EMU_INCH * 0.6));
        requests.push({ insertText: { objectId: bnLabel, text: labelText, insertionIndex: 0 } });
        requests.push(styleText(bnLabel, { font: theme.fontFamily, size: 22, color: subtextRgb }));
        requests.push(alignText(bnLabel, "CENTER"));

        if (slide.bullets?.length) {
          const bnBul = eid("bignumbul", i);
          requests.push(makeTextBox(bnBul, sid, MARGIN * 2, SLIDE_H * 0.72, SLIDE_W - MARGIN * 4, EMU_INCH));
          requests.push({ insertText: { objectId: bnBul, text: slide.bullets.join("\n"), insertionIndex: 0 } });
          requests.push(styleText(bnBul, { font: theme.fontFamily, size: 14, color: subtextRgb }));
          requests.push(...makeBullets(bnBul));
        }
        break;
      }

      case "QUOTE": {
        const qMark = eid("quotemark", i);
        requests.push(makeTextBox(qMark, sid, MARGIN, SLIDE_H * 0.12, EMU_INCH, EMU_INCH));
        requests.push({ insertText: { objectId: qMark, text: "\u201C", insertionIndex: 0 } });
        requests.push(styleText(qMark, { font: "Georgia", size: 96, color: primaryRgb }));

        const qId = eid("quotetext", i);
        const quoteText = slide.quote || slide.body || slide.title;
        requests.push(makeTextBox(qId, sid, MARGIN * 2, SLIDE_H * 0.30, SLIDE_W - MARGIN * 4, EMU_INCH * 1.5));
        requests.push({ insertText: { objectId: qId, text: quoteText, insertionIndex: 0 } });
        requests.push(styleText(qId, { font: theme.fontFamily, size: 24, color: textRgb, italic: true }));
        requests.push(alignText(qId, "CENTER"));

        if (slide.quoteAttribution) {
          const qaId = eid("quoteattr", i);
          requests.push(makeTextBox(qaId, sid, MARGIN * 2, SLIDE_H * 0.70, SLIDE_W - MARGIN * 4, EMU_INCH * 0.4));
          requests.push({ insertText: { objectId: qaId, text: `\u2014 ${slide.quoteAttribution}`, insertionIndex: 0 } });
          requests.push(styleText(qaId, { font: theme.fontFamily, size: 16, color: subtextRgb }));
          requests.push(alignText(qaId, "END"));
        }
        break;
      }

      case "TWO_COLUMNS": {
        const tcTitle = eid("coltitle", i);
        requests.push(makeTextBox(tcTitle, sid, MARGIN, 120000, SLIDE_W - MARGIN * 2, EMU_INCH * 0.6));
        requests.push({ insertText: { objectId: tcTitle, text: slide.title, insertionIndex: 0 } });
        requests.push(styleText(tcTitle, { font: theme.headingFont, size: 26, color: textRgb, bold: true }));

        const colW = (SLIDE_W - MARGIN * 3) / 2;
        const colY = EMU_INCH * 0.9;
        const colH = SLIDE_H - colY - MARGIN;

        const divId = eid("coldiv", i);
        requests.push(makeRect(divId, sid, SLIDE_W / 2 - 10000, colY, 20000, colH));
        requests.push(fillRect(divId, subtextRgb));

        if (slide.leftColumn) {
          if (slide.leftColumn.title) {
            const lcTid = eid("lefttitle", i);
            requests.push(makeTextBox(lcTid, sid, MARGIN, colY, colW, EMU_INCH * 0.4));
            requests.push({ insertText: { objectId: lcTid, text: slide.leftColumn.title, insertionIndex: 0 } });
            requests.push(styleText(lcTid, { font: theme.headingFont, size: 18, color: primaryRgb, bold: true }));
          }
          if (slide.leftColumn.bullets?.length) {
            const lcBid = eid("leftbul", i);
            const lcBulY = slide.leftColumn.title ? colY + EMU_INCH * 0.45 : colY;
            const lcBulH = slide.leftColumn.title ? colH - EMU_INCH * 0.45 : colH;
            requests.push(makeTextBox(lcBid, sid, MARGIN, lcBulY, colW, lcBulH));
            requests.push({ insertText: { objectId: lcBid, text: slide.leftColumn.bullets.join("\n"), insertionIndex: 0 } });
            requests.push(styleText(lcBid, { font: theme.fontFamily, size: 14, color: textRgb }));
            requests.push(...makeBullets(lcBid));
          }
        }

        if (slide.rightColumn) {
          const rcX = SLIDE_W / 2 + MARGIN / 2;
          if (slide.rightColumn.title) {
            const rcTid = eid("righttitle", i);
            requests.push(makeTextBox(rcTid, sid, rcX, colY, colW, EMU_INCH * 0.4));
            requests.push({ insertText: { objectId: rcTid, text: slide.rightColumn.title, insertionIndex: 0 } });
            requests.push(styleText(rcTid, { font: theme.headingFont, size: 18, color: primaryRgb, bold: true }));
          }
          if (slide.rightColumn.bullets?.length) {
            const rcBid = eid("rightbul", i);
            const rcBulY = slide.rightColumn.title ? colY + EMU_INCH * 0.45 : colY;
            const rcBulH = slide.rightColumn.title ? colH - EMU_INCH * 0.45 : colH;
            requests.push(makeTextBox(rcBid, sid, rcX, rcBulY, colW, rcBulH));
            requests.push({ insertText: { objectId: rcBid, text: slide.rightColumn.bullets.join("\n"), insertionIndex: 0 } });
            requests.push(styleText(rcBid, { font: theme.fontFamily, size: 14, color: textRgb }));
            requests.push(...makeBullets(rcBid));
          }
        }
        break;
      }

      case "IMAGE_RIGHT":
      case "IMAGE_LEFT":
      case "IMAGE_FULL": {
        const isFullImage = layout === "IMAGE_FULL";
        const isImageRight = layout === "IMAGE_RIGHT";
        const textSide = isImageRight ? "left" : "right";

        if (!isFullImage) {
          const imgTitleId = eid("imgtitle", i);
          const textX = textSide === "left" ? MARGIN : SLIDE_W / 2 + MARGIN / 2;
          const textW = SLIDE_W / 2 - MARGIN * 1.5;
          requests.push(makeTextBox(imgTitleId, sid, textX, 150000, textW, EMU_INCH * 0.6));
          requests.push({ insertText: { objectId: imgTitleId, text: slide.title, insertionIndex: 0 } });
          requests.push(styleText(imgTitleId, { font: theme.headingFont, size: 24, color: textRgb, bold: true }));

          if (slide.bullets?.length || slide.body) {
            const imgBodyId = eid("imgbody", i);
            const bodyText = slide.bullets?.length ? slide.bullets.join("\n") : (slide.body || "");
            requests.push(makeTextBox(imgBodyId, sid, textX, EMU_INCH * 0.85, textW, SLIDE_H - EMU_INCH * 1.2));
            requests.push({ insertText: { objectId: imgBodyId, text: bodyText, insertionIndex: 0 } });
            requests.push(styleText(imgBodyId, { font: theme.fontFamily, size: 14, color: textRgb }));
            if (slide.bullets?.length) requests.push(...makeBullets(imgBodyId));
          }
        }

        if (validImage) {
          const imgId = eid("image", i);
          if (isFullImage) {
            const imgTopY = 120000;
            const titleH = EMU_INCH * 0.55;
            const imgStartY = imgTopY + titleH + 80000;
            const imgAvailH = SLIDE_H - imgStartY - MARGIN * 0.8;
            const imgAvailW = SLIDE_W - MARGIN * 2;
            deferredImageRequests.push({
              createImage: {
                objectId: imgId,
                url: slide.imageUrl,
                elementProperties: {
                  pageObjectId: sid,
                  size: { width: { magnitude: imgAvailW, unit: "EMU" }, height: { magnitude: imgAvailH, unit: "EMU" } },
                  transform: { scaleX: 1, scaleY: 1, translateX: MARGIN, translateY: imgStartY, unit: "EMU" },
                },
              },
            });
            const imgCapId = eid("imgcap", i);
            requests.push(makeTextBox(imgCapId, sid, MARGIN, imgTopY, SLIDE_W - MARGIN * 2, titleH));
            requests.push({ insertText: { objectId: imgCapId, text: slide.title, insertionIndex: 0 } });
            requests.push(styleText(imgCapId, { font: theme.headingFont, size: 24, color: textRgb, bold: true }));
            requests.push(alignText(imgCapId, "CENTER"));
          } else {
            const imgX = isImageRight ? SLIDE_W / 2 + MARGIN / 4 : MARGIN;
            const imgW = SLIDE_W / 2 - MARGIN;
            deferredImageRequests.push({
              createImage: {
                objectId: imgId,
                url: slide.imageUrl,
                elementProperties: {
                  pageObjectId: sid,
                  size: { width: { magnitude: imgW, unit: "EMU" }, height: { magnitude: SLIDE_H - MARGIN * 2, unit: "EMU" } },
                  transform: { scaleX: 1, scaleY: 1, translateX: imgX, translateY: MARGIN, unit: "EMU" },
                },
              },
            });
          }

          if (slide.imageCaption && !isFullImage) {
            const capId = eid("imgcaption", i);
            const capX = isImageRight ? SLIDE_W / 2 + MARGIN / 4 : MARGIN;
            requests.push(makeTextBox(capId, sid, capX, SLIDE_H - MARGIN, SLIDE_W / 2 - MARGIN, EMU_INCH * 0.3));
            requests.push({ insertText: { objectId: capId, text: slide.imageCaption, insertionIndex: 0 } });
            requests.push(styleText(capId, { font: theme.fontFamily, size: 10, color: subtextRgb, italic: true }));
          }
        } else if (isFullImage) {
          const phId = eid("placeholder", i);
          requests.push(makeTextBox(phId, sid, MARGIN, SLIDE_H * 0.35, SLIDE_W - MARGIN * 2, EMU_INCH));
          requests.push({ insertText: { objectId: phId, text: slide.title, insertionIndex: 0 } });
          requests.push(styleText(phId, { font: theme.headingFont, size: 32, color: textRgb, bold: true }));
          requests.push(alignText(phId, "CENTER"));
        }
        break;
      }

      case "FLOWCHART": {
        const fcTitle = eid("fctitle", i);
        requests.push(makeTextBox(fcTitle, sid, MARGIN, 120000, SLIDE_W - MARGIN * 2, EMU_INCH * 0.5));
        requests.push({ insertText: { objectId: fcTitle, text: slide.title, insertionIndex: 0 } });
        requests.push(styleText(fcTitle, { font: theme.headingFont, size: 24, color: textRgb, bold: true }));

        if (validImage) {
          const imgId = eid("fcimg", i);
          const fcImgY = EMU_INCH * 0.8;
          const fcImgH = SLIDE_H - fcImgY - MARGIN * 0.8;
          deferredImageRequests.push({
            createImage: {
              objectId: imgId,
              url: slide.imageUrl,
              elementProperties: {
                pageObjectId: sid,
                size: { width: { magnitude: SLIDE_W - MARGIN * 2, unit: "EMU" }, height: { magnitude: fcImgH, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: MARGIN, translateY: fcImgY, unit: "EMU" },
              },
            },
          });
          break;
        }

        const steps = slide.flowSteps || [];
        if (steps.length === 0) {
          const placeholderId = eid("fcplaceholder", i);
          requests.push(makeTextBox(placeholderId, sid, MARGIN * 2, SLIDE_H * 0.35, SLIDE_W - MARGIN * 4, SLIDE_H * 0.3));
          const placeholderText = slide.bullets?.join("\n") || slide.body || slide.title || "";
          if (placeholderText) {
            requests.push({ insertText: { objectId: placeholderId, text: placeholderText, insertionIndex: 0 } });
            requests.push(styleText(placeholderId, { font: theme.fontFamily, size: 16, color: subtextRgb }));
            requests.push(alignText(placeholderId, "CENTER"));
          }
          break;
        }
        const maxCols = Math.min(steps.length, 5);
        const boxW = Math.min(1500000, (SLIDE_W - MARGIN * 2 - 200000 * (maxCols - 1)) / maxCols);
        const boxH = 800000;
        const startY = SLIDE_H * 0.28;
        const totalW = maxCols * boxW + (maxCols - 1) * 200000;
        const startX = (SLIDE_W - totalW) / 2;
        const arrowW = 200000;

        for (let s = 0; s < maxCols; s++) {
          const step = steps[s];
          const x = startX + s * (boxW + arrowW);
          const boxColor = safeHexToRgb(step.color, primaryRgb);

          const boxId = eid(`fcbox${s}`, i);
          requests.push({
            createShape: {
              objectId: boxId, shapeType: "ROUND_RECTANGLE",
              elementProperties: {
                pageObjectId: sid,
                size: { width: { magnitude: boxW, unit: "EMU" }, height: { magnitude: boxH, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: startY, unit: "EMU" },
              },
            },
          });
          requests.push(fillRect(boxId, boxColor));
          requests.push({ insertText: { objectId: boxId, text: step.label, insertionIndex: 0 } });
          requests.push(styleText(boxId, { font: theme.headingFont, size: maxCols <= 4 ? 14 : 11, color: { red: 1, green: 1, blue: 1 }, bold: true }));
          requests.push(alignText(boxId, "CENTER"));
          requests.push({
            updateShapeProperties: {
              objectId: boxId,
              shapeProperties: { contentAlignment: "MIDDLE" },
              fields: "contentAlignment",
            },
          });

          if (step.description) {
            const descId = eid(`fcdesc${s}`, i);
            requests.push(makeTextBox(descId, sid, x, startY + boxH + 80000, boxW, 400000));
            requests.push({ insertText: { objectId: descId, text: step.description, insertionIndex: 0 } });
            requests.push(styleText(descId, { font: theme.fontFamily, size: 11, color: subtextRgb }));
            requests.push(alignText(descId, "CENTER"));
          }

          if (s < maxCols - 1) {
            const arrowId = eid(`fcarrow${s}`, i);
            requests.push(makeTextBox(arrowId, sid, x + boxW, startY + boxH / 2 - 120000, arrowW, 240000));
            requests.push({ insertText: { objectId: arrowId, text: "\u25B6", insertionIndex: 0 } });
            requests.push(styleText(arrowId, { font: "Arial", size: 20, color: primaryRgb }));
            requests.push(alignText(arrowId, "CENTER"));
          }
        }
        break;
      }

      case "TABLE": {
        const tTitle = eid("ttitle", i);
        requests.push(makeTextBox(tTitle, sid, MARGIN, 120000, SLIDE_W - MARGIN * 2, EMU_INCH * 0.5));
        requests.push({ insertText: { objectId: tTitle, text: slide.title, insertionIndex: 0 } });
        requests.push(styleText(tTitle, { font: theme.headingFont, size: 24, color: textRgb, bold: true }));

        if (slide.table && slide.table.headers?.length > 0) {
          const tblId = eid("tftable", i);
          const cols = Math.min(slide.table.headers.length, 10);
          const safeRows = Array.isArray(slide.table.rows) ? slide.table.rows : [];
          const dataRows = Math.min(safeRows.length, 12);
          const totalRows = dataRows + 1;
          const tblY = EMU_INCH * 0.85;
          const tblH = SLIDE_H - tblY - MARGIN;

          requests.push({
            createTable: {
              objectId: tblId,
              elementProperties: {
                pageObjectId: sid,
                size: { width: { magnitude: SLIDE_W - MARGIN * 2, unit: "EMU" }, height: { magnitude: tblH, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: MARGIN, translateY: tblY, unit: "EMU" },
              },
              rows: totalRows, columns: cols,
            },
          });

          for (let c = 0; c < cols; c++) {
            requests.push({ insertText: { objectId: tblId, text: slide.table.headers[c], cellLocation: { rowIndex: 0, columnIndex: c }, insertionIndex: 0 } });
            requests.push({
              updateTextStyle: {
                objectId: tblId, cellLocation: { rowIndex: 0, columnIndex: c },
                style: { foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } } }, bold: true, fontSize: { magnitude: 11, unit: "PT" }, fontFamily: theme.headingFont },
                textRange: { type: "ALL" }, fields: "foregroundColor,bold,fontSize,fontFamily",
              },
            });
          }
          requests.push({
            updateTableCellProperties: {
              objectId: tblId,
              tableRange: { location: { rowIndex: 0, columnIndex: 0 }, rowSpan: 1, columnSpan: cols },
              tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: primaryRgb } } } },
              fields: "tableCellBackgroundFill.solidFill.color",
            },
          });

          for (let r = 0; r < dataRows; r++) {
            for (let c = 0; c < cols; c++) {
              const val = safeRows[r]?.[c] || "";
              if (val) {
                requests.push({ insertText: { objectId: tblId, text: val, cellLocation: { rowIndex: r + 1, columnIndex: c }, insertionIndex: 0 } });
                requests.push({
                  updateTextStyle: {
                    objectId: tblId, cellLocation: { rowIndex: r + 1, columnIndex: c },
                    style: { foregroundColor: { opaqueColor: { rgbColor: textRgb } }, fontSize: { magnitude: 10, unit: "PT" }, fontFamily: theme.fontFamily },
                    textRange: { type: "ALL" }, fields: "foregroundColor,fontSize,fontFamily",
                  },
                });
              }
            }
            if (r % 2 === 1) {
              requests.push({
                updateTableCellProperties: {
                  objectId: tblId,
                  tableRange: { location: { rowIndex: r + 1, columnIndex: 0 }, rowSpan: 1, columnSpan: cols },
                  tableCellProperties: { tableCellBackgroundFill: { solidFill: { color: { rgbColor: { red: bgRgb.red * 0.95, green: bgRgb.green * 0.95, blue: bgRgb.blue * 0.95 } } } } },
                  fields: "tableCellBackgroundFill.solidFill.color",
                },
              });
            }
          }
        }
        break;
      }

      case "ARCHITECTURE": {
        const archTitle = eid("archtitle", i);
        requests.push(makeTextBox(archTitle, sid, MARGIN, 120000, SLIDE_W - MARGIN * 2, EMU_INCH * 0.5));
        requests.push({ insertText: { objectId: archTitle, text: slide.title, insertionIndex: 0 } });
        requests.push(styleText(archTitle, { font: theme.headingFont, size: 24, color: textRgb, bold: true }));

        if (validImage) {
          const imgId = eid("archimg", i);
          const archImgY = EMU_INCH * 0.8;
          const archImgH = SLIDE_H - archImgY - MARGIN * 0.8;
          deferredImageRequests.push({
            createImage: {
              objectId: imgId,
              url: slide.imageUrl,
              elementProperties: {
                pageObjectId: sid,
                size: { width: { magnitude: SLIDE_W - MARGIN * 2, unit: "EMU" }, height: { magnitude: archImgH, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: MARGIN, translateY: archImgY, unit: "EMU" },
              },
            },
          });
          break;
        }

        const tiers = slide.architectureTiers || [];
        const tierCount = Math.min(tiers.length, 4);
        const titleBottom = EMU_INCH * 0.85;
        const archAvailH = SLIDE_H - titleBottom - MARGIN;
        const tierGap = tierCount > 3 ? 120000 : 160000;
        const tierH = Math.min(600000, (archAvailH - tierGap * (tierCount - 1)) / tierCount);
        const totalTierH = tierCount * tierH + (tierCount - 1) * tierGap;
        const tierStartY = titleBottom + (archAvailH - totalTierH) / 2;
        const tierW = SLIDE_W - MARGIN * 4;
        const tierX = MARGIN * 2;

        for (let t = 0; t < tierCount; t++) {
          const tier = tiers[t];
          const y = tierStartY + t * (tierH + tierGap);
          const tierColor = safeHexToRgb(tier.color, t === 0 ? primaryRgb : secondaryRgb);

          const tierId = eid(`tier${t}`, i);
          requests.push({
            createShape: {
              objectId: tierId, shapeType: "ROUND_RECTANGLE",
              elementProperties: {
                pageObjectId: sid,
                size: { width: { magnitude: tierW, unit: "EMU" }, height: { magnitude: tierH, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: tierX, translateY: y, unit: "EMU" },
              },
            },
          });
          requests.push(fillRect(tierId, tierColor));

          const labelH = 260000;
          const tierLabelId = eid(`tierlbl${t}`, i);
          requests.push(makeTextBox(tierLabelId, sid, tierX, y, tierW, labelH));
          requests.push({ insertText: { objectId: tierLabelId, text: tier.label, insertionIndex: 0 } });
          requests.push(styleText(tierLabelId, { font: theme.headingFont, size: 16, color: { red: 1, green: 1, blue: 1 }, bold: true }));
          requests.push(alignText(tierLabelId, "CENTER"));
          requests.push({
            updateShapeProperties: {
              objectId: tierLabelId,
              shapeProperties: { contentAlignment: "MIDDLE" },
              fields: "contentAlignment",
            },
          });

          const safeItems = Array.isArray(tier.items) ? tier.items : [];
          const itemCount = Math.min(safeItems.length, 4);
          const itemAreaW = tierW - 160000;
          const itemW = Math.min(1400000, (itemAreaW - 80000 * (itemCount - 1)) / itemCount);
          const totalItemsW = itemCount * itemW + (itemCount - 1) * 80000;
          const itemStartX = tierX + (tierW - totalItemsW) / 2;
          for (let it = 0; it < itemCount; it++) {
            const itemId = eid(`tieritem${t}_${it}`, i);
            const ix = itemStartX + it * (itemW + 80000);
            requests.push({
              createShape: {
                objectId: itemId, shapeType: "ROUND_RECTANGLE",
                elementProperties: {
                  pageObjectId: sid,
                  size: { width: { magnitude: itemW, unit: "EMU" }, height: { magnitude: tierH - labelH - 80000, unit: "EMU" } },
                  transform: { scaleX: 1, scaleY: 1, translateX: ix, translateY: y + labelH + 20000, unit: "EMU" },
                },
              },
            });
            requests.push(fillRect(itemId, { red: 1, green: 1, blue: 1 }));
            requests.push({
              updateShapeProperties: {
                objectId: itemId,
                shapeProperties: { outline: { outlineFill: { solidFill: { color: { rgbColor: tierColor } } }, weight: { magnitude: 1, unit: "PT" }, propertyState: "RENDERED" } },
                fields: "outline",
              },
            });
            const itemText = typeof safeItems[it] === "string" && safeItems[it].length > 18 ? safeItems[it].slice(0, 18).trim() : (safeItems[it] || "");
            requests.push({ insertText: { objectId: itemId, text: itemText, insertionIndex: 0 } });
            requests.push(styleText(itemId, { font: theme.fontFamily, size: 10, color: { red: 0.15, green: 0.15, blue: 0.2 } }));
            requests.push(alignText(itemId, "CENTER"));
            requests.push({
              updateShapeProperties: {
                objectId: itemId,
                shapeProperties: { contentAlignment: "MIDDLE" },
                fields: "contentAlignment",
              },
            });
          }

          if (t < tierCount - 1) {
            const connId = eid(`tierconn${t}`, i);
            const connX = SLIDE_W / 2 - 60000;
            requests.push(makeTextBox(connId, sid, connX, y + tierH, 120000, tierGap));
            requests.push({ insertText: { objectId: connId, text: "\u25BC", insertionIndex: 0 } });
            requests.push(styleText(connId, { font: "Arial", size: 16, color: primaryRgb }));
            requests.push(alignText(connId, "CENTER"));
          }
        }
        break;
      }

      case "TIMELINE": {
        const tlTitle = eid("tltitle", i);
        requests.push(makeTextBox(tlTitle, sid, MARGIN, 120000, SLIDE_W - MARGIN * 2, EMU_INCH * 0.5));
        requests.push({ insertText: { objectId: tlTitle, text: slide.title, insertionIndex: 0 } });
        requests.push(styleText(tlTitle, { font: theme.headingFont, size: 24, color: textRgb, bold: true }));

        const items = slide.timelineItems || [];
        const count = Math.min(items.length, 7);
        const lineY = SLIDE_H * 0.5;
        const lineX1 = MARGIN * 2;
        const lineX2 = SLIDE_W - MARGIN * 2;
        const lineW = lineX2 - lineX1;

        const lineId = eid("tline", i);
        requests.push(makeRect(lineId, sid, lineX1, lineY - 15000, lineW, 30000));
        requests.push(fillRect(lineId, primaryRgb));

        for (let t = 0; t < count; t++) {
          const item = items[t];
          const x = lineX1 + (lineW / (count - 1 || 1)) * t;
          const above = t % 2 === 0;

          const dotId = eid(`tldot${t}`, i);
          requests.push({
            createShape: {
              objectId: dotId, shapeType: "ELLIPSE",
              elementProperties: {
                pageObjectId: sid,
                size: { width: { magnitude: 120000, unit: "EMU" }, height: { magnitude: 120000, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: x - 60000, translateY: lineY - 60000, unit: "EMU" },
              },
            },
          });
          requests.push(fillRect(dotId, accentRgb));

          const dateId = eid(`tldate${t}`, i);
          const dateY = above ? lineY - 380000 : lineY + 180000;
          requests.push(makeTextBox(dateId, sid, x - 500000, dateY, 1000000, 220000));
          requests.push({ insertText: { objectId: dateId, text: item.date, insertionIndex: 0 } });
          requests.push(styleText(dateId, { font: theme.headingFont, size: 12, color: primaryRgb, bold: true }));
          requests.push(alignText(dateId, "CENTER"));

          const ttlId = eid(`tltxt${t}`, i);
          const ttlY = above ? lineY - 620000 : lineY + 400000;
          requests.push(makeTextBox(ttlId, sid, x - 600000, ttlY, 1200000, 280000));
          const safeTitle = typeof item.title === "string" && item.title.length > 28 ? item.title.slice(0, 28).trim() : (item.title || "");
          requests.push({ insertText: { objectId: ttlId, text: safeTitle, insertionIndex: 0 } });
          requests.push(styleText(ttlId, { font: theme.fontFamily, size: 10, color: textRgb }));
          requests.push(alignText(ttlId, "CENTER"));

          if (item.description) {
            const descId = eid(`tldesc${t}`, i);
            const descY = above ? lineY - 900000 : lineY + 680000;
            const safeDesc = typeof item.description === "string" && item.description.length > 40 ? item.description.slice(0, 40).trim() : (item.description || "");
            requests.push(makeTextBox(descId, sid, x - 600000, descY, 1200000, 300000));
            requests.push({ insertText: { objectId: descId, text: safeDesc, insertionIndex: 0 } });
            requests.push(styleText(descId, { font: theme.fontFamily, size: 9, color: subtextRgb }));
            requests.push(alignText(descId, "CENTER"));
          }
        }
        break;
      }

      case "COMPARISON": {
        const cmpTitle = eid("cmptitle", i);
        requests.push(makeTextBox(cmpTitle, sid, MARGIN, 120000, SLIDE_W - MARGIN * 2, EMU_INCH * 0.5));
        requests.push({ insertText: { objectId: cmpTitle, text: slide.title, insertionIndex: 0 } });
        requests.push(styleText(cmpTitle, { font: theme.headingFont, size: 24, color: textRgb, bold: true }));

        const cards = slide.comparisonItems || [];
        const cardCount = Math.min(cards.length, 4);
        const cardGap = 120000;
        const cardW = (SLIDE_W - MARGIN * 2 - cardGap * (cardCount - 1)) / cardCount;
        const cardY = EMU_INCH * 0.9;
        const cardH = SLIDE_H - cardY - MARGIN;

        for (let c = 0; c < cardCount; c++) {
          const card = cards[c];
          const cx = MARGIN + c * (cardW + cardGap);
          const cardBorder = card.highlight ? primaryRgb : subtextRgb;

          const cardBg = eid(`cardbg${c}`, i);
          requests.push({
            createShape: {
              objectId: cardBg, shapeType: "ROUND_RECTANGLE",
              elementProperties: {
                pageObjectId: sid,
                size: { width: { magnitude: cardW, unit: "EMU" }, height: { magnitude: cardH, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: cx, translateY: cardY, unit: "EMU" },
              },
            },
          });
          requests.push(fillRect(cardBg, bgRgb));
          requests.push({
            updateShapeProperties: {
              objectId: cardBg,
              shapeProperties: { outline: { outlineFill: { solidFill: { color: { rgbColor: cardBorder } } }, weight: { magnitude: card.highlight ? 3 : 1, unit: "PT" }, propertyState: "RENDERED" } },
              fields: "outline",
            },
          });

          const headerBg = eid(`cardhdr${c}`, i);
          requests.push(makeRect(headerBg, sid, cx, cardY, cardW, 320000));
          requests.push(fillRect(headerBg, card.highlight ? primaryRgb : secondaryRgb));

          const headerTxt = eid(`cardhdrtxt${c}`, i);
          requests.push(makeTextBox(headerTxt, sid, cx, cardY, cardW, 320000));
          requests.push({ insertText: { objectId: headerTxt, text: card.title, insertionIndex: 0 } });
          requests.push(styleText(headerTxt, { font: theme.headingFont, size: 16, color: { red: 1, green: 1, blue: 1 }, bold: true }));
          requests.push(alignText(headerTxt, "CENTER"));
          requests.push({
            updateShapeProperties: {
              objectId: headerTxt,
              shapeProperties: { contentAlignment: "MIDDLE" },
              fields: "contentAlignment",
            },
          });

          if (card.bullets?.length) {
            const bulId = eid(`cardbul${c}`, i);
            requests.push(makeTextBox(bulId, sid, cx + 60000, cardY + 380000, cardW - 120000, cardH - 440000));
            requests.push({ insertText: { objectId: bulId, text: card.bullets.join("\n"), insertionIndex: 0 } });
            requests.push(styleText(bulId, { font: theme.fontFamily, size: 13, color: textRgb }));
            requests.push(...makeBullets(bulId));
          }
        }
        break;
      }

      case "METRICS_DASHBOARD": {
        const mdTitle = eid("mdtitle", i);
        requests.push(makeTextBox(mdTitle, sid, MARGIN, 120000, SLIDE_W - MARGIN * 2, EMU_INCH * 0.5));
        requests.push({ insertText: { objectId: mdTitle, text: slide.title, insertionIndex: 0 } });
        requests.push(styleText(mdTitle, { font: theme.headingFont, size: 24, color: textRgb, bold: true }));

        const mets = slide.metrics || [];
        const metCount = Math.min(mets.length, 6);
        const cols = metCount <= 3 ? metCount : Math.ceil(metCount / 2);
        const rows = metCount <= 3 ? 1 : 2;
        const metGap = 120000;
        const metW = (SLIDE_W - MARGIN * 2 - metGap * (cols - 1)) / cols;
        const metH = rows === 1 ? SLIDE_H * 0.5 : SLIDE_H * 0.32;
        const metStartY = rows === 1 ? SLIDE_H * 0.28 : SLIDE_H * 0.18;

        for (let m = 0; m < metCount; m++) {
          const met = mets[m];
          const col = m % cols;
          const row = Math.floor(m / cols);
          const mx = MARGIN + col * (metW + metGap);
          const my = metStartY + row * (metH + metGap);

          const metBg = eid(`metbg${m}`, i);
          requests.push({
            createShape: {
              objectId: metBg, shapeType: "ROUND_RECTANGLE",
              elementProperties: {
                pageObjectId: sid,
                size: { width: { magnitude: metW, unit: "EMU" }, height: { magnitude: metH, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: mx, translateY: my, unit: "EMU" },
              },
            },
          });
          requests.push(fillRect(metBg, secondaryRgb));

          const valId = eid(`metval${m}`, i);
          requests.push(makeTextBox(valId, sid, mx + 40000, my + metH * 0.15, metW - 80000, metH * 0.45));
          requests.push({ insertText: { objectId: valId, text: String(met.value), insertionIndex: 0 } });
          requests.push(styleText(valId, { font: theme.headingFont, size: rows === 1 ? 42 : 32, color: { red: 1, green: 1, blue: 1 }, bold: true }));
          requests.push(alignText(valId, "CENTER"));

          const lblId = eid(`metlbl${m}`, i);
          requests.push(makeTextBox(lblId, sid, mx + 40000, my + metH * 0.58, metW - 80000, metH * 0.2));
          requests.push({ insertText: { objectId: lblId, text: String(met.label), insertionIndex: 0 } });
          requests.push(styleText(lblId, { font: theme.fontFamily, size: rows === 1 ? 14 : 11, color: { red: 0.85, green: 0.85, blue: 0.85 } }));
          requests.push(alignText(lblId, "CENTER"));

          if (met.trend) {
            const trendId = eid(`mettrend${m}`, i);
            const trendColor = met.trend.startsWith("+") || met.trend.startsWith("\u2191") ? { red: 0.2, green: 0.8, blue: 0.4 } : met.trend.startsWith("-") || met.trend.startsWith("\u2193") ? { red: 0.9, green: 0.3, blue: 0.3 } : { red: 0.85, green: 0.85, blue: 0.85 };
            requests.push(makeTextBox(trendId, sid, mx + 40000, my + metH * 0.78, metW - 80000, metH * 0.15));
            requests.push({ insertText: { objectId: trendId, text: String(met.trend), insertionIndex: 0 } });
            requests.push(styleText(trendId, { font: theme.fontFamily, size: 10, color: trendColor }));
            requests.push(alignText(trendId, "CENTER"));
          }
        }
        break;
      }

      case "PROCESS": {
        const prTitle = eid("prtitle", i);
        requests.push(makeTextBox(prTitle, sid, MARGIN, 120000, SLIDE_W - MARGIN * 2, EMU_INCH * 0.5));
        requests.push({ insertText: { objectId: prTitle, text: slide.title, insertionIndex: 0 } });
        requests.push(styleText(prTitle, { font: theme.headingFont, size: 24, color: textRgb, bold: true }));

        const prSteps = slide.processSteps || [];
        const prCount = Math.min(prSteps.length, 6);
        const prStartY = EMU_INCH * 0.85;
        const availH = SLIDE_H - prStartY - MARGIN;
        const prGap = prCount > 4 ? 40000 : 60000;
        const prStepH = Math.min(400000, (availH - prGap * (prCount - 1)) / prCount);
        const numCircleSize = Math.min(300000, prStepH * 0.8);
        const prContentX = MARGIN + numCircleSize + 120000;
        const prContentW = SLIDE_W - prContentX - MARGIN;

        for (let p = 0; p < prCount; p++) {
          const step = prSteps[p];
          const py = prStartY + p * (prStepH + prGap);

          const circleId = eid(`prcircle${p}`, i);
          requests.push({
            createShape: {
              objectId: circleId, shapeType: "ELLIPSE",
              elementProperties: {
                pageObjectId: sid,
                size: { width: { magnitude: numCircleSize, unit: "EMU" }, height: { magnitude: numCircleSize, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: MARGIN, translateY: py + (prStepH - numCircleSize) / 2, unit: "EMU" },
              },
            },
          });
          requests.push(fillRect(circleId, primaryRgb));
          requests.push({ insertText: { objectId: circleId, text: String(step.number), insertionIndex: 0 } });
          requests.push(styleText(circleId, { font: theme.headingFont, size: 18, color: { red: 1, green: 1, blue: 1 }, bold: true }));
          requests.push(alignText(circleId, "CENTER"));
          requests.push({
            updateShapeProperties: {
              objectId: circleId,
              shapeProperties: { contentAlignment: "MIDDLE" },
              fields: "contentAlignment",
            },
          });

          const stTitleId = eid(`prsteptitle${p}`, i);
          requests.push(makeTextBox(stTitleId, sid, prContentX, py, prContentW, 220000));
          requests.push({ insertText: { objectId: stTitleId, text: step.title, insertionIndex: 0 } });
          requests.push(styleText(stTitleId, { font: theme.headingFont, size: 16, color: textRgb, bold: true }));

          if (step.description) {
            const stDescId = eid(`prdesc${p}`, i);
            requests.push(makeTextBox(stDescId, sid, prContentX, py + 200000, prContentW, 200000));
            requests.push({ insertText: { objectId: stDescId, text: step.description, insertionIndex: 0 } });
            requests.push(styleText(stDescId, { font: theme.fontFamily, size: 12, color: subtextRgb }));
          }

          if (p < prCount - 1) {
            const lineId = eid(`prline${p}`, i);
            requests.push(makeRect(lineId, sid, MARGIN + numCircleSize / 2 - 10000, py + prStepH, 20000, prGap));
            requests.push(fillRect(lineId, primaryRgb));
          }
        }
        break;
      }

      default: {
        const defTitleId = eid("dtitle", i);
        requests.push(makeTextBox(defTitleId, sid, MARGIN, 150000, SLIDE_W - MARGIN * 2, EMU_INCH * 0.6));
        requests.push({ insertText: { objectId: defTitleId, text: slide.title, insertionIndex: 0 } });
        requests.push(styleText(defTitleId, { font: theme.headingFont, size: 26, color: textRgb, bold: true }));

        const contentY = EMU_INCH * 0.85;
        const hasImage = validImage;
        const hasTable = !!(slide.table && slide.table.headers?.length > 0);
        const contentW = hasImage ? SLIDE_W * 0.48 : SLIDE_W - MARGIN * 2;

        if (slide.body || slide.bullets?.length) {
          const defBodyId = eid("dbody", i);
          const bodyText = slide.bullets?.length ? slide.bullets.join("\n") : (slide.body || "");
          const bodyH = hasTable ? (SLIDE_H - contentY - MARGIN) * 0.45 : SLIDE_H - contentY - MARGIN;
          requests.push(makeTextBox(defBodyId, sid, MARGIN, contentY, contentW, bodyH));
          requests.push({ insertText: { objectId: defBodyId, text: bodyText, insertionIndex: 0 } });
          requests.push(styleText(defBodyId, { font: theme.fontFamily, size: 16, color: textRgb }));
          if (slide.bullets?.length) requests.push(...makeBullets(defBodyId));
        }

        if (hasImage) {
          const imgId = eid("dimage", i);
          const imgX = SLIDE_W * 0.52;
          const imgW = SLIDE_W * 0.44;
          const imgH = SLIDE_H - contentY - MARGIN * 0.8;
          deferredImageRequests.push({
            createImage: {
              objectId: imgId,
              url: slide.imageUrl,
              elementProperties: {
                pageObjectId: sid,
                size: { width: { magnitude: imgW, unit: "EMU" }, height: { magnitude: imgH, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: imgX, translateY: contentY, unit: "EMU" },
              },
            },
          });
        }

        if (hasTable && slide.table) {
          const tblId = eid("table", i);
          const tblCols = slide.table.headers.length;
          const tblRows = Math.min(slide.table.rows.length + 1, 20);
          const tblY = slide.body || slide.bullets?.length ? SLIDE_H * 0.55 : contentY;
          const tblH = SLIDE_H - tblY - MARGIN;

          requests.push({
            createTable: {
              objectId: tblId,
              elementProperties: {
                pageObjectId: sid,
                size: { width: { magnitude: SLIDE_W - MARGIN * 2, unit: "EMU" }, height: { magnitude: tblH, unit: "EMU" } },
                transform: { scaleX: 1, scaleY: 1, translateX: MARGIN, translateY: tblY, unit: "EMU" },
              },
              rows: tblRows,
              columns: tblCols,
            },
          });

          for (let c = 0; c < tblCols; c++) {
            requests.push({
              insertText: {
                objectId: tblId,
                cellLocation: { rowIndex: 0, columnIndex: c },
                text: slide.table.headers[c] || "",
                insertionIndex: 0,
              },
            });
          }

          const dataRows = slide.table.rows.slice(0, tblRows - 1);
          for (let r = 0; r < dataRows.length; r++) {
            for (let c = 0; c < tblCols; c++) {
              const cellText = String(dataRows[r]?.[c] ?? "");
              if (cellText) {
                requests.push({
                  insertText: {
                    objectId: tblId,
                    cellLocation: { rowIndex: r + 1, columnIndex: c },
                    text: cellText,
                    insertionIndex: 0,
                  },
                });
              }
            }
          }

          requests.push({
            updateTableCellProperties: {
              objectId: tblId,
              tableRange: { location: { rowIndex: 0, columnIndex: 0 }, rowSpan: 1, columnSpan: tblCols },
              tableCellProperties: {
                tableCellBackgroundFill: { solidFill: { color: { rgbColor: primaryRgb } } },
              },
              fields: "tableCellBackgroundFill.solidFill.color",
            },
          });

          for (let c = 0; c < tblCols; c++) {
            requests.push({
              updateTextStyle: {
                objectId: tblId,
                cellLocation: { rowIndex: 0, columnIndex: c },
                style: {
                  fontFamily: theme.headingFont,
                  fontSize: { magnitude: 12, unit: "PT" },
                  foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } } },
                  bold: true,
                },
                textRange: { type: "ALL" },
                fields: "fontFamily,fontSize,foregroundColor,bold",
              },
            });
          }
        }
        break;
      }
    }

    if (slide.speakerNotes) {
      notesDeferral.push({ slideId: sid, text: slide.speakerNotes });
    }
  }

  const qrSlideIndex = totalSlides;
  const qrSid = eid("slide", qrSlideIndex);
  requests.push({
    createSlide: { objectId: qrSid, insertionIndex: qrSlideIndex, slideLayoutReference: { predefinedLayout: "BLANK" } },
  });
  requests.push({
    updatePageProperties: {
      objectId: qrSid,
      pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: bgRgb } } } },
      fields: "pageBackgroundFill.solidFill.color",
    },
  });
  const qrAccentId = eid("accent", qrSlideIndex);
  requests.push(makeRect(qrAccentId, qrSid, 0, 0, SLIDE_W, 28000));
  requests.push(fillRect(qrAccentId, primaryRgb));

  const qrTitleId = eid("qrtitle", qrSlideIndex);
  requests.push(makeTextBox(qrTitleId, qrSid, MARGIN, 300000, SLIDE_W - MARGIN * 2, 600000));
  requests.push({ insertText: { objectId: qrTitleId, text: "VisionClaw Agent Platform", insertionIndex: 0 } });
  requests.push(styleText(qrTitleId, { font: theme.headingFont, size: 36, color: textRgb, bold: true }));
  requests.push(alignText(qrTitleId, "CENTER"));

  const qrUrlId = eid("qrurl", qrSlideIndex);
  requests.push(makeTextBox(qrUrlId, qrSid, MARGIN, 900000, SLIDE_W - MARGIN * 2, 400000));
  const platformUrl = (process.env.SITE_WEBSITE_URL || "").replace(/^https?:\/\//, "") || "VisionClaw";
  requests.push({ insertText: { objectId: qrUrlId, text: platformUrl, insertionIndex: 0 } });
  requests.push(styleText(qrUrlId, { font: theme.fontFamily, size: 20, color: primaryRgb }));
  requests.push(alignText(qrUrlId, "CENTER"));

  const qrImageSize = 2700000;
  const qrImageX = (SLIDE_W - qrImageSize) / 2;
  const qrImageY = 1450000;
  const qrImgId = eid("qrimg", qrSlideIndex);
  deferredImageRequests.push({
    createImage: {
      objectId: qrImgId,
      url: process.env.SITE_QR_LOGO_URL || "",
      elementProperties: {
        pageObjectId: qrSid,
        size: { width: { magnitude: qrImageSize, unit: "EMU" }, height: { magnitude: qrImageSize, unit: "EMU" } },
        transform: { scaleX: 1, scaleY: 1, translateX: qrImageX, translateY: qrImageY, unit: "EMU" },
      },
    },
  });

  const qrScanId = eid("qrscan", qrSlideIndex);
  requests.push(makeTextBox(qrScanId, qrSid, MARGIN, 4300000, SLIDE_W - MARGIN * 2, 350000));
  requests.push({ insertText: { objectId: qrScanId, text: "Scan to visit", insertionIndex: 0 } });
  requests.push(styleText(qrScanId, { font: theme.fontFamily, size: 14, color: subtextRgb }));
  requests.push(alignText(qrScanId, "CENTER"));

  notesDeferral.push({ slideId: qrSid, text: `Thank you for watching. The QR code on screen links to ${platformUrl} — scan to visit and explore the platform. This slide stays visible until the presentation is closed.` });

  if (requests.length > 0) {
    const MAX_CHUNK_SIZE = 50;
    if (requests.length <= MAX_CHUNK_SIZE) {
      await gFetch(token, `${SLIDES_API}/${presentationId}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ requests }),
      });
    } else {
      const slideChunks: any[][] = [];
      const allBoundaries = [...slideRequestBoundaries, requests.length];
      let currentChunk: any[] = [];
      for (let bi = 0; bi < allBoundaries.length - 1; bi++) {
        const slideReqs = requests.slice(allBoundaries[bi], allBoundaries[bi + 1]);
        if (currentChunk.length + slideReqs.length > MAX_CHUNK_SIZE && currentChunk.length > 0) {
          slideChunks.push(currentChunk);
          currentChunk = [];
        }
        currentChunk.push(...slideReqs);
      }
      if (currentChunk.length > 0) slideChunks.push(currentChunk);
      if (allBoundaries[0] > 0) {
        const preSlideReqs = requests.slice(0, allBoundaries[0]);
        slideChunks[0] = [...preSlideReqs, ...slideChunks[0]];
      }

      console.log(`[slides] Large batch (${requests.length} requests) — splitting into ${slideChunks.length} slide-aware chunks`);
      const CHUNK_DELAY_MS = 1500;
      const RETRY_DELAY_MS = 800;
      const MAX_INDIVIDUAL_RETRIES = 3;
      for (let ci = 0; ci < slideChunks.length; ci++) {
        const chunk = slideChunks[ci];
        if (ci > 0) await new Promise(r => setTimeout(r, CHUNK_DELAY_MS));
        let chunkSuccess = false;
        for (let attempt = 0; attempt < 3 && !chunkSuccess; attempt++) {
          try {
            if (attempt > 0) {
              const backoff = CHUNK_DELAY_MS * Math.pow(2, attempt);
              console.log(`[slides] Chunk ${ci + 1} retry attempt ${attempt + 1}, waiting ${backoff}ms...`);
              await new Promise(r => setTimeout(r, backoff));
            }
            await gFetch(token, `${SLIDES_API}/${presentationId}:batchUpdate`, {
              method: "POST",
              body: JSON.stringify({ requests: chunk }),
            });
            console.log(`[slides] Chunk ${ci + 1}/${slideChunks.length} sent (${chunk.length} requests)${attempt > 0 ? ` on attempt ${attempt + 1}` : ""}`);
            chunkSuccess = true;
          } catch (chunkErr: any) {
            const is429 = chunkErr.message?.includes("429") || chunkErr.message?.includes("Quota");
            if (is429 && attempt < 2) {
              console.warn(`[slides] Chunk ${ci + 1} hit rate limit (attempt ${attempt + 1}/3), will retry with backoff...`);
              continue;
            }
            console.error(`[slides] Chunk ${ci + 1}/${slideChunks.length} failed after ${attempt + 1} attempts: ${chunkErr.message?.slice(0, 200)}`);
            chunkFailures.push(ci + 1);
            if (ci === 0) throw chunkErr;
            console.warn(`[slides] Retrying failed chunk ${ci + 1} with individual requests (${RETRY_DELAY_MS}ms between each)...`);
            for (let ri = 0; ri < chunk.length; ri++) {
              if (ri > 0) await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
              let reqSuccess = false;
              for (let ra = 0; ra < MAX_INDIVIDUAL_RETRIES && !reqSuccess; ra++) {
                try {
                  if (ra > 0) await new Promise(r => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, ra)));
                  await gFetch(token, `${SLIDES_API}/${presentationId}:batchUpdate`, {
                    method: "POST",
                    body: JSON.stringify({ requests: [chunk[ri]] }),
                  });
                  reqSuccess = true;
                } catch (retryErr: any) {
                  if (ra === MAX_INDIVIDUAL_RETRIES - 1) {
                    console.warn(`[slides] Individual request ${ri + 1}/${chunk.length} in chunk ${ci + 1} failed after ${MAX_INDIVIDUAL_RETRIES} retries: ${retryErr.message?.slice(0, 100)}`);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  let imagesFailed = 0;
  if (deferredImageRequests.length > 0) {
    const validDeferredImages = deferredImageRequests.filter(r => {
      const url = r.createImage?.url;
      return isValidImageUrl(url);
    });
    const skipped = deferredImageRequests.length - validDeferredImages.length;
    if (skipped > 0) console.log(`[slides] Skipped ${skipped} deferred images with invalid/placeholder URLs`);
    const logoCount = validDeferredImages.filter(r => r.createImage?.objectId?.includes("_logo_") || r.createImage?.objectId?.includes("_wmlogo_")).length;
    console.log(`[slides] Processing ${validDeferredImages.length} deferred images in PARALLEL (${logoCount} logo, ${validDeferredImages.length - logoCount} content)`);
    const failedDriveIds = new Set<string>();
    const succeededUrl = new Map<string, string>();
    const extractDriveId = (url: string): string | null => {
      const m = url?.match(/(?:\/d\/|[?&]id=)([a-zA-Z0-9_-]+)/);
      return m ? m[1] : null;
    };
    const insertOneImage = async (imgReq: any): Promise<boolean> => {
      let inserted = false;
      const origUrl = imgReq.createImage?.url;
      const driveId = extractDriveId(origUrl);
      if (driveId && failedDriveIds.has(driveId)) {
        const isLogo = imgReq.createImage?.objectId?.includes("_logo_") || imgReq.createImage?.objectId?.includes("_wmlogo_");
        if (isLogo) {
          try {
            const fallbackReq = JSON.parse(JSON.stringify(imgReq));
            fallbackReq.createImage.url = VISIONCLAW_LOGO_URL;
            await gFetch(token, `${SLIDES_API}/${presentationId}:batchUpdate`, {
              method: "POST",
              body: JSON.stringify({ requests: [fallbackReq] }),
            });
            return true;
          } catch { return false; }
        }
        return false;
      }
      if (driveId && succeededUrl.has(driveId)) {
        try {
          const req = JSON.parse(JSON.stringify(imgReq));
          req.createImage.url = succeededUrl.get(driveId)!;
          await gFetch(token, `${SLIDES_API}/${presentationId}:batchUpdate`, {
            method: "POST",
            body: JSON.stringify({ requests: [req] }),
          });
          return true;
        } catch (_silentErr) { logSilentCatch("server/google-workspace.ts", _silentErr); }
      }
      const urlVariants = [origUrl];
      if (origUrl?.includes("lh3.googleusercontent.com/d/")) {
        const fid = origUrl.split("/d/")[1]?.split("?")[0];
        if (fid) {
          urlVariants.push(`https://drive.google.com/uc?export=download&id=${fid}`);
          urlVariants.push(`https://drive.google.com/thumbnail?id=${fid}&sz=w1600`);
        }
      } else if (origUrl?.includes("drive.google.com") || origUrl?.includes("docs.google.com")) {
        const driveIdMatch = origUrl.match(/(?:\/d\/|[?&]id=)([a-zA-Z0-9_-]+)/);
        if (driveIdMatch) {
          urlVariants.unshift(`https://lh3.googleusercontent.com/d/${driveIdMatch[1]}`);
          urlVariants.push(`https://drive.google.com/thumbnail?id=${driveIdMatch[1]}&sz=w1600`);
        }
      }
      for (const url of urlVariants) {
        try {
          const req = JSON.parse(JSON.stringify(imgReq));
          req.createImage.url = url;
          await gFetch(token, `${SLIDES_API}/${presentationId}:batchUpdate`, {
            method: "POST",
            body: JSON.stringify({ requests: [req] }),
          });
          inserted = true;
          if (driveId) succeededUrl.set(driveId, url);
          if (url !== origUrl) console.log(`[slides] Image inserted with fallback URL format: ${url.slice(0, 60)}...`);
          break;
        } catch (imgErr: any) {
          const is429 = imgErr.message?.includes("429") || imgErr.message?.includes("Quota");
          if (is429) {
            await new Promise(r => setTimeout(r, 3000));
            try {
              const req = JSON.parse(JSON.stringify(imgReq));
              req.createImage.url = url;
              await gFetch(token, `${SLIDES_API}/${presentationId}:batchUpdate`, {
                method: "POST",
                body: JSON.stringify({ requests: [req] }),
              });
              inserted = true;
              if (driveId) succeededUrl.set(driveId, url);
              break;
            } catch (_silentErr) { logSilentCatch("server/google-workspace.ts", _silentErr); }
          }
          console.warn(`[slides] Image URL failed (${url.slice(0, 50)}...): ${imgErr.message?.slice(0, 100)}`);
        }
      }
      if (!inserted) {
        if (driveId) failedDriveIds.add(driveId);
        const isLogo = imgReq.createImage?.objectId?.includes("_logo_") || imgReq.createImage?.objectId?.includes("_wmlogo_");
        if (isLogo && origUrl !== VISIONCLAW_LOGO_URL) {
          try {
            const fallbackReq = JSON.parse(JSON.stringify(imgReq));
            fallbackReq.createImage.url = VISIONCLAW_LOGO_URL;
            await gFetch(token, `${SLIDES_API}/${presentationId}:batchUpdate`, {
              method: "POST",
              body: JSON.stringify({ requests: [fallbackReq] }),
            });
            inserted = true;
            console.log(`[slides] Logo fallback to default succeeded for ${imgReq.createImage?.objectId}`);
          } catch (fallbackErr: any) {
            console.warn(`[slides] Logo default fallback also failed: ${fallbackErr.message?.slice(0, 100)}`);
          }
        }
      }
      return inserted;
    };
    const IMG_CONCURRENCY = 2;
    const IMG_BATCH_DELAY_MS = 1200;
    for (let batch = 0; batch < validDeferredImages.length; batch += IMG_CONCURRENCY) {
      if (batch > 0) await new Promise(r => setTimeout(r, IMG_BATCH_DELAY_MS));
      const chunk = validDeferredImages.slice(batch, batch + IMG_CONCURRENCY);
      const results = await Promise.allSettled(chunk.map(img => insertOneImage(img)));
      for (const r of results) {
        if (r.status === "rejected" || (r.status === "fulfilled" && !r.value)) imagesFailed++;
      }
    }
  }

  if (notesDeferral.length > 0) {
    const finalPres = await gFetch(token, `${SLIDES_API}/${presentationId}`);
    const notesBatch: any[] = [];
    for (const finalSlide of finalPres.slides || []) {
      const sid = finalSlide.objectId;
      const note = notesDeferral.find(n => n.slideId === sid);
      if (note && finalSlide.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId) {
        notesBatch.push({
          insertText: {
            objectId: finalSlide.slideProperties.notesPage.notesProperties.speakerNotesObjectId,
            text: note.text,
            insertionIndex: 0,
          },
        });
      }
    }
    if (notesBatch.length > 0) {
      try {
        await gFetch(token, `${SLIDES_API}/${presentationId}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests: notesBatch }),
        });
      } catch (err: any) {
        console.warn("[slides] Speaker notes insertion failed (non-critical):", err.message?.slice(0, 200));
      }
    }
  }

  try {
    const verifyPres = await gFetch(token, `${SLIDES_API}/${presentationId}?fields=slides.objectId,slides.pageElements`);
    const verifySlides = verifyPres.slides || [];
    const blankSlides: number[] = [];
    for (let vi = 0; vi < verifySlides.length; vi++) {
      const elements = verifySlides[vi].pageElements || [];
      const hasText = elements.some((el: any) => el.shape?.text?.textElements?.some((te: any) => te.textRun?.content?.trim()));
      if (!hasText && vi > 0) blankSlides.push(vi + 1);
    }
    if (blankSlides.length > 0) {
      console.warn(`[slides] POST-BUILD CHECK: ${blankSlides.length} blank slides detected: [${blankSlides.join(", ")}]. Attempting repair...`);
      for (const blankIdx of blankSlides) {
        const srcSlide = options.slides[blankIdx - 1];
        if (!srcSlide) continue;
        const bSid = eid("slide", blankIdx - 1);
        const repairReqs: any[] = [];
        const rTitle = eid("reptitle", blankIdx - 1);
        repairReqs.push(makeTextBox(rTitle, bSid, MARGIN, 120000, SLIDE_W - MARGIN * 2, EMU_INCH * 0.7));
        repairReqs.push({ insertText: { objectId: rTitle, text: srcSlide.title || `Slide ${blankIdx}`, insertionIndex: 0 } });
        repairReqs.push(styleText(rTitle, { font: theme.headingFont, size: 28, color: textRgb, bold: true }));
        if (srcSlide.body || srcSlide.bullets?.length) {
          const rBody = eid("repbody", blankIdx - 1);
          const bodyText = srcSlide.bullets?.length ? srcSlide.bullets.join("\n") : (srcSlide.body || "");
          repairReqs.push(makeTextBox(rBody, bSid, MARGIN, EMU_INCH, SLIDE_W - MARGIN * 2, SLIDE_H - EMU_INCH * 1.5));
          repairReqs.push({ insertText: { objectId: rBody, text: bodyText, insertionIndex: 0 } });
          repairReqs.push(styleText(rBody, { font: theme.fontFamily, size: 16, color: subtextRgb }));
          if (srcSlide.bullets?.length) repairReqs.push(...makeBullets(rBody));
        }
        try {
          await gFetch(token, `${SLIDES_API}/${presentationId}:batchUpdate`, {
            method: "POST",
            body: JSON.stringify({ requests: repairReqs }),
          });
          console.log(`[slides] Repaired blank slide ${blankIdx}`);
        } catch (repairErr: any) {
          console.warn(`[slides] Repair failed for slide ${blankIdx}: ${repairErr.message?.slice(0, 100)}`);
        }
      }
    } else {
      console.log(`[slides] POST-BUILD CHECK: All ${verifySlides.length} slides have content — verified OK`);
    }
  } catch (verifyErr: any) {
    console.warn(`[slides] Post-build verification failed (non-critical): ${verifyErr.message?.slice(0, 100)}`);
  }

  try {
    const shareResp = await fetch(`https://www.googleapis.com/drive/v3/files/${presentationId}/permissions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
    if (shareResp.ok) {
      console.log(`[slides] Sharing set to 'anyone can view' for presentation ${presentationId}`);
    } else {
      const errText = await shareResp.text().catch(() => "");
      console.warn(`[slides] Direct sharing failed (${shareResp.status}): ${errText.slice(0, 150)}`);
    }

    const { makeFileShareable } = await import("./google-drive");
    await makeFileShareable(presentationId);
    console.log(`[slides] Double-shared via Drive API for presentation ${presentationId}`);

    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${presentationId}/permissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone", allowFileDiscovery: false }),
      });
    } catch (_silentErr) { logSilentCatch("server/google-workspace.ts", _silentErr); }

    try {
      const publishResp = await fetch(`https://www.googleapis.com/drive/v3/files/${presentationId}/revisions/head`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ published: true, publishAuto: true, publishedOutsideDomain: true }),
      });
      if (publishResp.ok) {
        console.log(`[slides] Published to web for presentation ${presentationId}`);
      } else {
        console.warn(`[slides] Publish-to-web failed (${publishResp.status}): ${(await publishResp.text().catch(() => "")).slice(0, 150)}`);
      }
    } catch (pubErr: any) {
      console.warn(`[slides] Publish-to-web error: ${pubErr.message?.slice(0, 100)}`);
    }

    const verifyResp = await fetch(`https://www.googleapis.com/drive/v3/files/${presentationId}?fields=webViewLink,shared,permissions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (verifyResp.ok) {
      const verifyData = await verifyResp.json();
      console.log(`[slides] Share verification: shared=${verifyData.shared}, permissions=${JSON.stringify(verifyData.permissions?.map((p: any) => p.role + ":" + p.type))}`);
      if (!verifyData.shared) {
        console.warn(`[slides] WARNING: File ${presentationId} is NOT shared — attempting explicit user share as fallback`);
        try {
          const { db } = await import("./db");
          const { sql } = await import("drizzle-orm");
          const tenantRows = await db.execute(sql`SELECT email FROM tenants WHERE id = 1 LIMIT 1`);
          const ownerEmail = ((tenantRows as any).rows?.[0]?.email || (tenantRows as any)[0]?.email) as string | undefined;
          if (ownerEmail) {
            const userShareResp = await fetch(`https://www.googleapis.com/drive/v3/files/${presentationId}/permissions?sendNotificationEmail=false`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ role: "writer", type: "user", emailAddress: ownerEmail }),
            });
            if (userShareResp.ok) {
              console.log(`[slides] Shared directly with owner: ${ownerEmail}`);
            } else {
              console.warn(`[slides] User share failed: ${(await userShareResp.text().catch(() => "")).slice(0, 150)}`);
            }
          }
        } catch (userShareErr: any) {
          console.warn(`[slides] User share fallback error: ${userShareErr.message?.slice(0, 100)}`);
        }
      }
    }
  } catch (shareErr: any) {
    console.warn(`[slides] Could not set sharing on presentation: ${shareErr.message?.slice(0, 100)}`);
    try {
      const { makeFileShareable } = await import("./google-drive");
      await makeFileShareable(presentationId);
    } catch (_silentErr) { logSilentCatch("server/google-workspace.ts", _silentErr); }
  }

  const slidesUrl = `https://docs.google.com/presentation/d/${presentationId}/edit`;
  const presentUrl = `https://docs.google.com/presentation/d/${presentationId}/present`;

  try {
    const accessCheck = await fetch(slidesUrl, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(10000) });
    if (accessCheck.ok || accessCheck.status === 302 || accessCheck.status === 303) {
      console.log(`[slides] Link accessibility check: ${slidesUrl} → ${accessCheck.status} OK`);
    } else {
      console.error(`[slides] LINK ACCESSIBILITY FAILED: ${slidesUrl} → HTTP ${accessCheck.status} — this link will NOT work for users`);
    }
  } catch (accessErr: any) {
    console.warn(`[slides] Link accessibility check error: ${accessErr.message?.slice(0, 100)}`);
  }

  let pdfDriveUrl = `https://docs.google.com/presentation/d/${presentationId}/export/pdf`;
  let pptxDriveUrl = `https://docs.google.com/presentation/d/${presentationId}/export/pptx`;
  let localPdfSavedPath = "";

  try {
    const { uploadToDrive, makeFileShareable } = await import("./google-drive");

    const pdfResp = await fetch(`https://www.googleapis.com/drive/v3/files/${presentationId}/export?mimeType=application/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (pdfResp.ok) {
      const pdfBuf = Buffer.from(await pdfResp.arrayBuffer());
      const safeTitle = options.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
      const pdfUpload = await uploadToDrive({
        fileName: `${safeTitle}.pdf`,
        mimeType: "application/pdf",
        fileData: pdfBuf,
        description: `PDF export of presentation: ${options.title}`,
        parentFolderId: options._projectDriveFolderId || undefined,
      });
      if (pdfUpload.success && pdfUpload.fileId) {
        await makeFileShareable(pdfUpload.fileId);
        pdfDriveUrl = pdfUpload.shareableLink || pdfUpload.webViewLink || pdfDriveUrl;
        console.log(`[slides] PDF exported & uploaded to Drive: ${pdfDriveUrl}`);
      }
      try {
        const fs = await import("fs");
        const path = await import("path");
        const localPdfDir = path.resolve(process.cwd(), "project-assets");
        if (!fs.existsSync(localPdfDir)) fs.mkdirSync(localPdfDir, { recursive: true });
        localPdfSavedPath = path.join(localPdfDir, `${safeTitle}.pdf`);
        fs.writeFileSync(localPdfSavedPath, pdfBuf);
        console.log(`[slides] PDF also saved locally: ${localPdfSavedPath}`);
      } catch (localErr: any) {
        console.warn(`[slides] Local PDF save failed (non-critical): ${localErr.message?.slice(0, 100)}`);
      }
    }

    const pptxResp = await fetch(`https://www.googleapis.com/drive/v3/files/${presentationId}/export?mimeType=application/vnd.openxmlformats-officedocument.presentationml.presentation`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (pptxResp.ok) {
      const pptxBuf = Buffer.from(await pptxResp.arrayBuffer());
      const safeTitle = options.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
      const pptxUpload = await uploadToDrive({
        fileName: `${safeTitle}.pptx`,
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        description: `PowerPoint export of presentation: ${options.title}`,
        fileData: pptxBuf,
        parentFolderId: options._projectDriveFolderId || undefined,
      });
      if (pptxUpload.success && pptxUpload.fileId) {
        await makeFileShareable(pptxUpload.fileId);
        pptxDriveUrl = pptxUpload.shareableLink || pptxUpload.webViewLink || pptxDriveUrl;
        console.log(`[slides] PPTX exported & uploaded to Drive: ${pptxDriveUrl}`);
      }
    }
  } catch (exportErr: any) {
    console.warn(`[slides] PDF/PPTX export-to-Drive failed (non-critical): ${exportErr.message?.slice(0, 200)}`);
  }

  let presenterUrl = "";
  try {
    let slideThumbnails: Record<number, string> = {};
    const slideImageBuffers: Record<number, Buffer> = {};
    try {
      const fs = await import("fs");
      const path = await import("path");
      const slideDir = path.join(process.cwd(), "uploads", "presenter-slides", presentationId);
      if (!fs.existsSync(slideDir)) fs.mkdirSync(slideDir, { recursive: true });

      const existingFiles = fs.readdirSync(slideDir).filter((f: string) => f.startsWith("slide_") && f.endsWith(".png"));
      if (existingFiles.length > 0) {
        for (const f of existingFiles) {
          const idx = parseInt(f.replace("slide_", "").replace(".png", ""), 10);
          if (!isNaN(idx)) {
            const filePath = path.join(slideDir, f);
            const stat = fs.statSync(filePath);
            if (stat.size > 1000) {
              slideThumbnails[idx] = `/uploads/presenter-slides/${presentationId}/${f}`;
            }
          }
        }
        if (Object.keys(slideThumbnails).length > 0) {
          console.log(`[slides] Cache hit: ${Object.keys(slideThumbnails).length} thumbnails already on disk for ${presentationId}`);
        }
      }

      const thumbResp = await fetch(`https://slides.googleapis.com/v1/presentations/${presentationId}?fields=slides.objectId`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (thumbResp.ok) {
        const thumbData = await thumbResp.json();
        const pageIds = (thumbData.slides || []).map((s: any) => s.objectId);
        let downloaded = 0;
        let skipped = 0;
        for (let ti = 0; ti < pageIds.length; ti++) {
          if (slideThumbnails[ti]) {
            skipped++;
            continue;
          }
          const MAX_SLIDE_BYTES = 10 * 1024 * 1024;
          const FETCH_TIMEOUT = 30_000;
          try {
            let imgBuf: Buffer | null = null;
            const exportUrl = `https://docs.google.com/presentation/d/${presentationId}/export/png?id=${presentationId}&pageid=${pageIds[ti]}`;
            try {
              const ac = new AbortController();
              const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
              const exportResp = await fetch(exportUrl, {
                headers: { Authorization: `Bearer ${token}` },
                redirect: "follow",
                signal: ac.signal,
              });
              clearTimeout(timer);
              if (exportResp.ok) {
                const ct = exportResp.headers.get("content-type") || "";
                const cl = parseInt(exportResp.headers.get("content-length") || "0", 10);
                if (ct.includes("image") && (!cl || cl <= MAX_SLIDE_BYTES)) {
                  imgBuf = Buffer.from(await exportResp.arrayBuffer());
                  if (imgBuf.length < 2000 || imgBuf.length > MAX_SLIDE_BYTES) imgBuf = null;
                }
              }
            } catch (_silentErr) { logSilentCatch("server/google-workspace.ts", _silentErr); }

            if (!imgBuf) {
              const ac = new AbortController();
              const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
              const tResp = await fetch(`https://slides.googleapis.com/v1/presentations/${presentationId}/pages/${pageIds[ti]}/thumbnail?thumbnailProperties.thumbnailSize=LARGE`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: ac.signal,
              });
              clearTimeout(timer);
              if (tResp.ok) {
                const tData = await tResp.json();
                if (tData.contentUrl) {
                  const ac2 = new AbortController();
                  const timer2 = setTimeout(() => ac2.abort(), FETCH_TIMEOUT);
                  const fallbackResp = await fetch(tData.contentUrl, { signal: ac2.signal });
                  clearTimeout(timer2);
                  if (fallbackResp.ok) {
                    const buf = Buffer.from(await fallbackResp.arrayBuffer());
                    if (buf.length > 1000 && buf.length <= MAX_SLIDE_BYTES) imgBuf = buf;
                  }
                }
              }
            }

            if (imgBuf && imgBuf.length > 1000) {
              const fileName = `slide_${ti}.png`;
              try { fs.writeFileSync(path.join(slideDir, fileName), imgBuf); } catch (_silentErr) { logSilentCatch("server/google-workspace.ts", _silentErr); }
              slideThumbnails[ti] = `/uploads/presenter-slides/${presentationId}/${fileName}`;
              slideImageBuffers[ti] = imgBuf;
              downloaded++;
            }
          } catch (slideErr: any) {
            console.warn(`[slides] Slide ${ti} fetch failed: ${slideErr.message?.slice(0, 80)}`);
          }
        }
        console.log(`[slides] Thumbnails: ${downloaded} downloaded, ${skipped} cached, ${pageIds.length} total for ${presentationId}`);
      }
    } catch (thumbErr: any) {
      console.warn(`[slides] Thumbnail fetch failed (non-critical): ${thumbErr.message?.slice(0, 100)}`);
    }

    // Also try to load any cached disk images not already in memory
    for (const [idxStr, thumbPath] of Object.entries(slideThumbnails)) {
      const idx = parseInt(idxStr, 10);
      if (slideImageBuffers[idx]) continue;
      try {
        const fs = await import("fs");
        const fullPath = path.join(process.cwd(), thumbPath);
        if (fs.existsSync(fullPath)) {
          slideImageBuffers[idx] = fs.readFileSync(fullPath);
        }
      } catch (_silentErr) { logSilentCatch("server/google-workspace.ts", _silentErr); }
    }

    const slidesForPresenter = options.slides.map((s, i) => ({
      index: i,
      title: s.title || `Slide ${i + 1}`,
      speakerNotes: s.speakerNotes || "",
      thumbnailUrl: slideThumbnails[i] || "",
    }));
    slidesForPresenter.push({
      index: options.slides.length,
      title: "Thank You — Scan to Visit",
      speakerNotes: "Thank you for watching. Scan the QR code to visit and explore the VisionClaw Agent Platform. This slide will stay visible until the presentation is closed.",
      thumbnailUrl: slideThumbnails[options.slides.length] || "",
    });
    const embedUrl = `https://docs.google.com/presentation/d/${presentationId}/embed?start=false&loop=false&delayms=0&rm=minimal`;
    const presResp = await fetch("http://localhost:5000/api/presenter", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-key": process.env.SESSION_SECRET || "" },
      body: JSON.stringify({
        presentationId,
        title: options.title,
        slides: slidesForPresenter,
        embedUrl,
        presentUrl,
        tenantId,
      }),
    });
    let presenterToken = "";
    if (presResp.ok) {
      const presData = await presResp.json();
      presenterToken = presData.token;
      const sessionId = presData.id;
      const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
      const domain = isProduction
        ? (process.env.REPLIT_DOMAINS?.split(",")[0] || process.env.PRODUCTION_DOMAIN || "localhost:5000")
        : (process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000");
      const protocol = domain.includes("localhost") ? "http" : "https";
      presenterUrl = `${protocol}://${domain}/present/${presData.token}`;
      console.log(`[slides] Presenter session created: ${presenterUrl}`);

      try {
        const { db: dbConn } = await import("./db");
        const { sql: sqlTag } = await import("drizzle-orm");
        const sharp = await import("sharp").then(m => m.default || m).catch(() => null);
        let persisted = 0;
        for (const [idxStr, imgBuf] of Object.entries(slideImageBuffers)) {
          const idx = parseInt(idxStr, 10);
          try {
            await dbConn.execute(sqlTag`INSERT INTO presenter_slide_images (session_id, slide_index, image_data, image_size, quality) VALUES (${sessionId}, ${idx}, ${imgBuf}, ${imgBuf.length}, 'full') ON CONFLICT (session_id, slide_index, quality) DO UPDATE SET image_data = EXCLUDED.image_data, image_size = EXCLUDED.image_size`);
            persisted++;

            if (sharp) {
              try {
                const thumbBuf = await sharp(imgBuf).resize(480, 270, { fit: "inside", withoutEnlargement: true }).png({ quality: 80 }).toBuffer();
                await dbConn.execute(sqlTag`INSERT INTO presenter_slide_images (session_id, slide_index, image_data, image_size, quality) VALUES (${sessionId}, ${idx}, ${thumbBuf}, ${thumbBuf.length}, 'thumb') ON CONFLICT (session_id, slide_index, quality) DO UPDATE SET image_data = EXCLUDED.image_data, image_size = EXCLUDED.image_size`);
              } catch (_silentErr) { logSilentCatch("server/google-workspace.ts", _silentErr); }
            }
          } catch (dbErr: any) {
            console.warn(`[slides] DB persist slide ${idx} failed: ${dbErr.message?.slice(0, 100)}`);
          }
        }
        console.log(`[slides] Persisted ${persisted} slide images to DB (session ${sessionId})`);

        if (presenterToken) {
          const dbSlides = slidesForPresenter.map((s, i) => ({
            ...s,
            thumbnailUrl: `/api/presenter/${presenterToken}/slide/${i}`,
          }));
          await dbConn.execute(sqlTag`UPDATE presenter_sessions SET slides = ${JSON.stringify(dbSlides)}::jsonb WHERE id = ${sessionId}`);
          console.log(`[slides] Updated slide URLs to DB-backed endpoints`);
        }
      } catch (persistErr: any) {
        console.warn(`[slides] DB image persistence failed (non-critical): ${persistErr.message?.slice(0, 200)}`);
      }
    }
  } catch (presErr: any) {
    console.warn(`[slides] Presenter session creation failed (non-critical): ${presErr.message?.slice(0, 200)}`);
  }

  let linksBlock = "";
  if (presenterUrl) {
    linksBlock += `🎤 [Auto-Present with Narration](${presenterUrl})\n\n`;
  }
  linksBlock += `📎 [Edit Slides](${slidesUrl})\n\n🎬 [Present Fullscreen](${presentUrl})\n\n📥 [Download PPTX](${pptxDriveUrl})\n\n📄 [Download PDF](${pdfDriveUrl})`;

  const speakerNotesArray = options.slides.map((s: any, i: number) => ({
    slideIndex: i + 1,
    title: s.title || `Slide ${i + 1}`,
    speakerNotes: s.speakerNotes || "",
  }));

  let speakerNotesPath = "";
  try {
    const fs = await import("fs");
    const path = await import("path");
    const safeName = (options.title || "presentation").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    speakerNotesPath = path.join(process.cwd(), "project-assets", `${safeName}_speaker_notes.json`);
    const dir = path.dirname(speakerNotesPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(speakerNotesPath, JSON.stringify(speakerNotesArray, null, 2));
    console.log(`[slides] Auto-saved complete speaker notes JSON (${speakerNotesArray.length} slides) → ${speakerNotesPath}`);
  } catch (notesErr: any) {
    console.warn(`[slides] Failed to auto-save speaker notes: ${notesErr.message?.slice(0, 100)}`);
  }

  const result: any = {
    title: options.title,
    slideCount: options.slides.length,
    theme: typeof options.theme === "string" ? options.theme : "custom",
    imagesInserted: deferredImageRequests.length - imagesFailed,
    localPdfPath: localPdfSavedPath || undefined,
    speakerNotesJsonPath: speakerNotesPath || undefined,
    presentationId,
    editUrl: slidesUrl,
    presentFullscreenUrl: presentUrl,
    narratedPresentationUrl: presenterUrl || null,
    pdfDownloadUrl: pdfDriveUrl,
    pptxDownloadUrl: pptxDriveUrl,
    speakerNotesSummary: `${speakerNotesArray.length} slides have speaker notes (saved to ${speakerNotesPath || "disk"}). Use speakerNotesJsonPath to read full narration.`,
    LINKS_FORMATTED: linksBlock,
    MANDATORY_INSTRUCTIONS: `CRITICAL: You MUST copy-paste EVERY link below EXACTLY as shown. Put each link on its OWN line with a blank line between links. Do NOT construct your own URLs from the presentationId. Do NOT run link text together — each link must be a separate bullet or line.

FORMAT EACH LINK EXACTLY LIKE THIS (note the blank lines between each one):

${presenterUrl ? `🎤 Narrated Presentation: ${presenterUrl}

` : ""}📊 Edit Slides: ${slidesUrl}

📺 Present Fullscreen: ${presentUrl}

📄 Download PDF: ${pdfDriveUrl}

📥 Download PPTX: ${pptxDriveUrl}

${presenterUrl ? `The 🎤 Narrated Presentation link is the MOST IMPORTANT — it plays the slides with live AI voice narration. List it FIRST and PROMINENTLY. NEVER skip it.` : ""}
ALL LINKS ARE API-VERIFIED AND ACCESSIBLE. Do NOT use the browser tool to verify Google links — the headless browser cannot open Google pages.`,
    RESPONSE_STYLE: "You are the PRESENTER explaining this to a live audience of software engineers and VCs. Write a detailed walkthrough (3-5 paragraphs) explaining: what the presentation covers, what each major section demonstrates, how the platform works, and why it matters. Speak in first person as if you are on stage presenting — 'Here is what we built...', 'In this deck you will see...'. This text IS the presentation script the attendees will read. Be thorough and substantive. After the walkthrough, include ALL links listed in MANDATORY_INSTRUCTIONS.",
  };
  if (imagesFailed > 0) {
    result.imageWarning = `${imagesFailed} image(s) failed to insert (URL may be unreachable). The slides were created successfully without those images.`;
  }
  if (chunkFailures.length > 0) {
    result.partialSuccess = true;
    result.chunkWarning = `${chunkFailures.length} batch chunk(s) failed. Some slides may have missing elements. Failed chunks: ${chunkFailures.join(", ")}`;
  }
  return result;
}
