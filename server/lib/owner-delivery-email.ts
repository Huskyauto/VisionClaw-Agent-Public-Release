/**
 * Task #161 — owner-bound delivery email transport.
 *
 * Owner recipients (Bob) must receive delivery emails via his OWN Gmail
 * account: Gmail silently drops all mail from the platform's AgentMail
 * sender (provider says "sent", nothing arrives, no bounce), so AgentMail is
 * never used — and never fallen back to — for owner recipients. Because the
 * send is from Bob's account TO Bob's address, Gmail's send receipt carries
 * the message's mailbox labels; INBOX present is provider-side proof the
 * message is verifiably in his inbox, and success is only reported then.
 *
 * Content passes the same shared preflight (bounce + quality + R95 gates)
 * as every other transport. Collaborators are injectable so the flow is
 * testable without network or a DB pool (query-free at module load).
 */
import { preflightOutboundEmail } from "./outbound-email-preflight";

export interface OwnerEmailSendInput {
  tenantId: number;
  to: string;
  subject: string;
  text: string;
  html?: string;
  stableMessageKey?: string;
  existingMessageId?: string | null;
  onMessageSent?: (messageId: string) => Promise<void>;
}

export interface OwnerEmailSendDeps {
  gmailSendAndVerifyInbox?: (
    tenantId: number,
    to: string,
    subject: string,
    text: string,
    options?: {
      stableMessageKey?: string;
      existingMessageId?: string | null;
      onMessageSent?: (messageId: string) => Promise<void>;
    },
  ) => Promise<{
    messageId: string;
    inboxVerified: boolean;
    verificationAttempts: number;
  }>;
  preflight?: typeof preflightOutboundEmail;
}

export interface OwnerEmailReconcileDeps {
  gmailFindAndVerifyInbox?: (
    tenantId: number,
    to: string,
    options: { existingMessageId?: string | null; stableMessageKey?: string },
  ) => Promise<{
    messageId: string | null;
    inboxVerified: boolean;
    verificationAttempts: number;
  }>;
}

/**
 * Decide whether the delivery pipeline should enter its email stage.
 * Owner delivery is intentionally independent of AgentMail configuration.
 */
export function shouldAttemptDeliveryEmail(input: {
  requested: boolean;
  customerEmail?: string | null;
  ownerRecipient: boolean;
  agentMailConfigured: boolean;
}): boolean {
  return input.requested &&
    Boolean(input.customerEmail) &&
    (input.ownerRecipient || input.agentMailConfigured);
}

/** True when `email` resolves to one of the configured owner addresses. */
export async function isOwnerRecipient(email: string): Promise<boolean> {
  if (!email) return false;
  const { resolveOwnerEmails } = await import("./owner-email");
  return resolveOwnerEmails().map((s) => s.toLowerCase()).includes(email.toLowerCase());
}

/**
 * Gate + send + verify an owner-bound email through the owner's Gmail.
 * Throws on any gate refusal, send failure, or missing-INBOX receipt —
 * callers must only record send-success when this resolves.
 */
export async function sendOwnerEmailVerified(
  input: OwnerEmailSendInput,
  deps: OwnerEmailSendDeps = {},
): Promise<{ messageId: string }> {
  // The platform-owner mailbox is an admin-only egress channel. Never route
  // arbitrary tenant content through it merely because the destination string
  // happens to equal the configured owner address.
  const adminTenantId = Number(process.env.ADMIN_TENANT_ID) || 1;
  if (input.tenantId !== adminTenantId) {
    throw new Error(
      `owner Gmail delivery refused: tenant ${input.tenantId} is not the admin tenant`,
    );
  }

  const preflight = deps.preflight || preflightOutboundEmail;
  const gated = await preflight({
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  const gmailSendAndVerifyInbox = deps.gmailSendAndVerifyInbox
    || (await import("../google-workspace")).gmailSendAndVerifyInbox;
  const receipt = await gmailSendAndVerifyInbox(
    input.tenantId,
    input.to,
    gated.subject,
    gated.text,
    {
      stableMessageKey: input.stableMessageKey,
      existingMessageId: input.existingMessageId,
      onMessageSent: input.onMessageSent,
    },
  );
  if (!receipt.inboxVerified) {
    throw new Error(
      `owner Gmail send accepted (msg ${receipt.messageId}) but INBOX verification failed after ${receipt.verificationAttempts} checks — delivery unverified, not marking sent`,
    );
  }
  return { messageId: receipt.messageId };
}

/**
 * Find and verify a previously accepted owner message without any send path.
 * Used when Gmail acceptance succeeded but receipt persistence or verification
 * failed before the delivery could be marked complete.
 */
export async function reconcileOwnerEmailVerified(
  input: {
    tenantId: number;
    to: string;
    existingMessageId?: string | null;
    stableMessageKey?: string;
  },
  deps: OwnerEmailReconcileDeps = {},
): Promise<{ messageId: string }> {
  const adminTenantId = Number(process.env.ADMIN_TENANT_ID) || 1;
  if (input.tenantId !== adminTenantId) {
    throw new Error(`owner Gmail reconciliation refused: tenant ${input.tenantId} is not the admin tenant`);
  }
  const gmailFindAndVerifyInbox = deps.gmailFindAndVerifyInbox
    || (await import("../google-workspace")).gmailFindAndVerifyInbox;
  const receipt = await gmailFindAndVerifyInbox(input.tenantId, input.to, {
    existingMessageId: input.existingMessageId,
    stableMessageKey: input.stableMessageKey,
  });
  if (!receipt.messageId || !receipt.inboxVerified) {
    throw new Error(
      `owner Gmail message was not verifiable in INBOX after ${receipt.verificationAttempts} checks — no resend was attempted`,
    );
  }
  return { messageId: receipt.messageId };
}
