// Messaging Gateway — unified outbound delivery across channels.
//
// Pattern ported from NousResearch/hermes-agent: a single abstraction so any
// part of the system (cron jobs, personas, tools) can say "deliver this to
// user X via channel Y" without caring whether Y is Telegram, WhatsApp, SMS,
// or email.
//
// Inbound is handled by each channel's own webhook/poller (server/telegram.ts,
// server/twilio.ts, server/agentmail webhooks). They all funnel into the same
// processMessage() chat engine.

export type Channel = "telegram" | "sms" | "whatsapp" | "email" | "web";

export interface DeliveryTarget {
  channel: Channel;
  // One of the following identifies the recipient:
  telegramChatId?: number;
  phoneNumber?: string;     // E.164, used by sms + whatsapp
  email?: string;
  conversationId?: number;  // for "web" channel = in-app
}

export interface DeliveryResult {
  success: boolean;
  channel: Channel;
  messageId?: string;
  error?: string;
}

// Lazy-loaded adapters so we don't blow up when a provider isn't configured.
async function deliverTelegram(target: DeliveryTarget, text: string): Promise<DeliveryResult> {
  if (!target.telegramChatId) return { success: false, channel: "telegram", error: "telegramChatId required" };
  try {
    const { sendTelegramMessage, getTelegramStatus } = await import("./telegram");
    if (!(getTelegramStatus() as any).running) return { success: false, channel: "telegram", error: "Telegram bot not running" };
    await sendTelegramMessage(target.telegramChatId, text);
    return { success: true, channel: "telegram" };
  } catch (e: any) {
    return { success: false, channel: "telegram", error: e.message };
  }
}

async function deliverTwilio(target: DeliveryTarget, text: string, kind: "sms" | "whatsapp"): Promise<DeliveryResult> {
  if (!target.phoneNumber) return { success: false, channel: kind, error: "phoneNumber required (E.164)" };
  try {
    const { sendTwilioMessage } = await import("./twilio");
    return await sendTwilioMessage(target.phoneNumber, text, kind);
  } catch (e: any) {
    return { success: false, channel: kind, error: e.message };
  }
}

async function deliverEmail(target: DeliveryTarget, text: string): Promise<DeliveryResult> {
  if (!target.email) return { success: false, channel: "email", error: "email required" };
  try {
    // @ts-ignore - optional dynamic module
    const mail = await import("./google-mail").catch(() => null as any);
    if (!mail?.sendEmail) return { success: false, channel: "email", error: "google-mail not available" };
    const subject = text.split("\n")[0].slice(0, 80) || "Message from [Your Product]";
    await mail.sendEmail({ to: target.email, subject, body: text });
    return { success: true, channel: "email" };
  } catch (e: any) {
    return { success: false, channel: "email", error: e.message };
  }
}

const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function deliverMessage(target: DeliveryTarget, text: string): Promise<DeliveryResult> {
  if (!text || typeof text !== "string") return { success: false, channel: target.channel, error: "text required" };
  if ((target.channel === "sms" || target.channel === "whatsapp")) {
    if (!target.phoneNumber || !E164.test(target.phoneNumber)) {
      return { success: false, channel: target.channel, error: `phoneNumber must be E.164 (e.g. +12245551234), got: ${target.phoneNumber || "(empty)"}` };
    }
  }
  if (target.channel === "email" && (!target.email || !EMAIL.test(target.email))) {
    return { success: false, channel: "email", error: `email invalid: ${target.email || "(empty)"}` };
  }

  // R95 — single-point egress gate. Every caller of deliverMessage is now
  // covered, including the cron scheduler in recurring-messages.ts and the
  // tool dispatcher's `case "send_message"`. The per-tool gate upstream is
  // idempotent (already-clean text passes through), so layered enforcement
  // is fine. SMS/WhatsApp use strict mode because phone-channel egress is
  // world-visible (carriers archive plaintext) and provider keys / JWTs are
  // never legitimately needed in a 160-char SMS.
  const { enforceOutbound } = await import("./lib/outbound-redaction");
  const strict = target.channel === "sms" || target.channel === "whatsapp";
  const gate = enforceOutbound(text, { surface: `messaging_gateway:${target.channel}`, strict });
  if (!gate.ok) {
    return { success: false, channel: target.channel, error: gate.error };
  }
  const safeText = gate.payload;

  switch (target.channel) {
    case "telegram":  return deliverTelegram(target, safeText);
    case "sms":       return deliverTwilio(target, safeText, "sms");
    case "whatsapp":  return deliverTwilio(target, safeText, "whatsapp");
    case "email":     return deliverEmail(target, safeText);
    case "web":       return { success: true, channel: "web", error: "Web delivery is in-app only — store in conversation" };
    default:          return { success: false, channel: target.channel, error: `Unknown channel: ${target.channel}` };
  }
}

// Convenience: try each target in order until one succeeds (e.g. WhatsApp → SMS fallback).
export async function deliverWithFallback(targets: DeliveryTarget[], text: string): Promise<DeliveryResult> {
  let last: DeliveryResult = { success: false, channel: "web", error: "No targets" };
  for (const t of targets) {
    last = await deliverMessage(t, text);
    if (last.success) return last;
  }
  return last;
}

// Status snapshot for diagnostics
export async function getGatewayStatus(): Promise<Record<Channel, { configured: boolean; status: string }>> {
  const status: any = {};
  try {
    const tg = await import("./telegram");
    const s = tg.getTelegramStatus() as any;
    status.telegram = { configured: !!s.token, status: s.running ? "running" : "stopped" };
  } catch { status.telegram = { configured: false, status: "unavailable" }; }
  try {
    const tw = await import("./twilio");
    status.sms = await tw.getTwilioStatus("sms");
    status.whatsapp = await tw.getTwilioStatus("whatsapp");
  } catch {
    status.sms = { configured: false, status: "unavailable" };
    status.whatsapp = { configured: false, status: "unavailable" };
  }
  status.email = { configured: !!process.env.GMAIL_REFRESH_TOKEN || !!process.env.GOOGLE_REFRESH_TOKEN, status: "via google-mail" };
  status.web = { configured: true, status: "always available (in-app conversations)" };
  return status;
}
