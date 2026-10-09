export interface EmailChannelResult {
  success: boolean;
  channel: "email";
  messageId?: string;
  error?: string;
  uncertain?: boolean;
}

type GmailSender = (
  tenantId: number, to: string, subject: string, body: string,
) => Promise<{ id?: unknown }>;

const sendWithGmail: GmailSender = async (...args) => {
  const { gmailSend } = await import("../google-workspace");
  return gmailSend(...args);
};

export async function getEmailChannelStatus(
  tenantId: number | null | undefined,
  checkConnection: (tenantId: number) => Promise<void> = async tenant => {
    const { getGoogleToken } = await import("../google-workspace");
    await getGoogleToken(tenant, "gmail");
  },
): Promise<{ configured: boolean; status: string }> {
  if (!Number.isSafeInteger(tenantId) || (tenantId as number) <= 0) {
    return { configured: false, status: "Trusted tenant context required" };
  }
  try {
    await checkConnection(tenantId as number);
    return { configured: true, status: "Connected Gmail; delivery receipt checked when sending" };
  } catch {
    return { configured: false, status: "Gmail connection unavailable for this tenant" };
  }
}

/** Tenant identity comes from authenticated server context, never the target. */
export async function deliverEmailChannel(
  tenantId: number | null | undefined,
  recipient: string,
  text: string,
  send: GmailSender = sendWithGmail,
): Promise<EmailChannelResult> {
  if (!Number.isSafeInteger(tenantId) || (tenantId as number) <= 0) {
    return { success: false, channel: "email", error: "Trusted tenant context required for email delivery" };
  }
  if (typeof recipient !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return { success: false, channel: "email", error: "Valid email recipient required" };
  }
  if (typeof text !== "string" || !text.trim()) {
    return { success: false, channel: "email", error: "Email text required" };
  }
  // gmailSend's existing contract is HTML. Preserve plain message text without
  // interpreting caller content as markup or discarding line breaks.
  const body = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\r\n|\r|\n/g, "<br>");
  const subject = text.split(/\r\n|\r|\n/)[0].slice(0, 80) || "Message from [Your Product]";
  try {
    const receipt = await send(tenantId as number, recipient, subject, body);
    if (typeof receipt?.id !== "string" || !receipt.id.trim()) {
      return { success: false, channel: "email", uncertain: true, error: "Email provider acceptance could not be confirmed" };
    }
    return { success: true, channel: "email", messageId: receipt.id };
  } catch {
    // A transport exception is not proof that the provider rejected the send.
    // Do not automatically fall through to another channel and duplicate it.
    return { success: false, channel: "email", uncertain: true, error: "Email delivery failed; provider acceptance was not confirmed" };
  }
}