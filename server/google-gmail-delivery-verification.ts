import { resolveOwnerEmail } from "./lib/owner-email";

interface GmailHeader {
  name?: unknown;
  value?: unknown;
}

interface GmailMessage {
  labelIds?: unknown;
  payload?: { headers?: unknown };
}

interface GmailProfile {
  emailAddress?: unknown;
}

function headerValues(message: GmailMessage | null | undefined, name: string): string[] {
  const headers = message?.payload?.headers;
  if (!Array.isArray(headers)) return [];
  return headers
    .filter((header): header is GmailHeader => Boolean(header) && typeof header === "object")
    .filter((header) => String(header.name || "").toLowerCase() === name.toLowerCase())
    .map((header) => String(header.value || ""));
}

function addressesInHeader(value: string): string[] {
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)?.map((address) => address.toLowerCase()) || [];
}

export function assertOwnerGmailReportDestination(
  tenantId: number,
  recipient: string,
  configuredOwner = resolveOwnerEmail(),
): string {
  const adminTenantId = Number(process.env.ADMIN_TENANT_ID) || 1;
  if (tenantId !== adminTenantId) {
    throw new Error("Direct Gmail owner-report delivery is restricted to the admin tenant.");
  }
  const owner = String(configuredOwner || "").trim().toLowerCase();
  if (!owner || String(recipient || "").trim().toLowerCase() !== owner) {
    throw new Error("Direct Gmail owner-report delivery is restricted to the configured owner recipient.");
  }
  return owner;
}

export function assertOwnerGmailConnectorProfile(
  profile: GmailProfile | null | undefined,
  expectedOwner: string,
): string {
  const expected = String(expectedOwner || "").trim().toLowerCase();
  const connected = String(profile?.emailAddress || "").trim().toLowerCase();
  if (!expected || connected !== expected) {
    throw new Error("Gmail connector is not bound to the configured owner inbox; refusing owner-report egress.");
  }
  return connected;
}

export async function resolveExistingOrSentGmailMessageId(params: {
  existingMessageId?: string | null;
  findByStableMessageKey: () => Promise<string | null>;
  send: () => Promise<string>;
}): Promise<string> {
  const persisted = String(params.existingMessageId || "").trim();
  if (persisted) return persisted;
  const found = await params.findByStableMessageKey();
  if (found) return found;
  const sent = await params.send();
  if (!sent) throw new Error("Gmail accepted the owner-report request without a message ID; refusing to claim delivery.");
  return sent;
}

/**
 * Positive evidence for the owner-only weekly-report path: the message Google
 * accepted is also visible in the destination Gmail account's Inbox. This is
 * intentionally stricter than a Gmail/AgentMail send response, which proves
 * only API acceptance.
 */
export function isGmailInboxDeliveryConfirmed(message: GmailMessage | null | undefined, expectedRecipient: string): boolean {
  const labels = Array.isArray(message?.labelIds) ? message.labelIds : [];
  if (!labels.includes("INBOX")) return false;
  const recipient = String(expectedRecipient || "").trim().toLowerCase();
  if (!recipient) return false;
  return headerValues(message, "To").some((value) => addressesInHeader(value).includes(recipient));
}

export async function verifyGmailInboxDelivery(
  getMessage: (messageId: string) => Promise<GmailMessage>,
  messageId: string,
  expectedRecipient: string,
  options: {
    retryDelaysMs?: number[];
    sleep?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<{ verified: boolean; attempts: number }> {
  const retryDelaysMs = options.retryDelaysMs || [0, 1_000, 3_000];
  const sleep = options.sleep || ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let index = 0; index < retryDelaysMs.length; index++) {
    const delayMs = retryDelaysMs[index];
    if (delayMs > 0) await sleep(delayMs);
    const message = await getMessage(messageId);
    if (isGmailInboxDeliveryConfirmed(message, expectedRecipient)) {
      return { verified: true, attempts: index + 1 };
    }
  }
  return { verified: false, attempts: retryDelaysMs.length };
}