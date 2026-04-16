import { Bot, Context } from "grammy";
import { storage } from "./storage";
import { processMessage } from "./chat-engine";
import { db } from "./db";
import { sql } from "drizzle-orm";

let telegramBot: Bot | null = null;
let isConnected = false;
let botUsername = "";
let botInfo: { id: number; first_name: string; username?: string } | null = null;

const telegramConversations = new Map<string, number>();

const pendingPairings = new Map<string, { code: string; userId: number; chatId: number; username: string; firstName: string; createdAt: number }>();
const approvedUsers = new Set<number>();

const MESSAGE_CHUNK_SIZE = 4096;

export function getTelegramStatus(): {
  connected: boolean;
  username?: string;
  approvedUsers?: number;
} {
  if (!telegramBot || !isConnected) return { connected: false };
  return {
    connected: true,
    username: botUsername ? `@${botUsername}` : botInfo?.first_name,
    approvedUsers: approvedUsers.size,
  };
}

export async function startTelegramBot(token: string): Promise<void> {
  if (telegramBot) {
    await stopTelegramBot();
  }

  telegramBot = new Bot(token);

  telegramBot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (ctx.chat.type !== "private") {
      await ctx.reply("Please start a private chat with me to pair your account.");
      return;
    }

    if (approvedUsers.has(userId)) {
      await ctx.reply(
        "Welcome back to VisionClaw! Send me any message and I'll route it to the right AI agent.\n\n" +
        "Commands:\n/status — Check connection status\n/reset — Start a new conversation\n/agents — List available AI agents",
        { parse_mode: "HTML" }
      );
      return;
    }

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    pendingPairings.set(code, {
      code,
      userId,
      chatId: ctx.chat.id,
      username: ctx.from?.username || "",
      firstName: ctx.from?.first_name || "Unknown",
      createdAt: Date.now(),
    });

    setTimeout(() => pendingPairings.delete(code), 3600000);

    await ctx.reply(
      `Welcome to VisionClaw AI!\n\nTo connect your account, enter this pairing code in your VisionClaw dashboard:\n\n<b>${code}</b>\n\nThis code expires in 1 hour.`,
      { parse_mode: "HTML" }
    );
  });

  telegramBot.command("status", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !approvedUsers.has(userId)) {
      await ctx.reply("You haven't been paired yet. Send /start to get a pairing code.");
      return;
    }
    await ctx.reply(
      `<b>VisionClaw Status</b>\nBot: @${botUsername}\nYour status: Paired & active\nAgents: 14 specialized personas ready`,
      { parse_mode: "HTML" }
    );
  });

  telegramBot.command("reset", async (ctx) => {
    const chatKey = `tg-${ctx.chat.id}`;
    telegramConversations.delete(chatKey);
    await ctx.reply("Conversation reset. Send a new message to start fresh.");
  });

  telegramBot.command("agents", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !approvedUsers.has(userId)) {
      await ctx.reply("You haven't been paired yet. Send /start to get a pairing code.");
      return;
    }
    await ctx.reply(
      "<b>VisionClaw AI Agent Team</b>\n\n" +
      "1. <b>VisionClaw</b> — Personal Assistant\n" +
      "2. <b>Felix</b> — CEO & Strategist\n" +
      "3. <b>Forge</b> — Staff Engineer\n" +
      "4. <b>Teagan</b> — Content Marketing\n" +
      "5. <b>Chief of Staff</b> — Operations\n" +
      "6. <b>Scribe</b> — Content Creator\n" +
      "7. <b>Proof</b> — Content Reviewer\n" +
      "8. <b>Radar</b> — Intelligence Analyst\n" +
      "9. <b>Neptune</b> — Deep Research\n" +
      "10. <b>Apollo</b> — Revenue Manager\n" +
      "11. <b>Atlas</b> — Metrics & Analytics\n" +
      "12. <b>Blueprint</b> — Multi-Agent Ops\n" +
      "13. <b>Cassandra</b> — CFO\n" +
      "14. <b>Luna</b> — Legal & Compliance\n\n" +
      "Just send your message and the right agent will handle it!",
      { parse_mode: "HTML" }
    );
  });

  telegramBot.on("message:text", async (ctx) => {
    await handleTextMessage(ctx);
  });

  telegramBot.on("message:voice", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !approvedUsers.has(userId)) {
      await ctx.reply("Send /start to pair your account first.");
      return;
    }

    await ctx.reply("Voice messages received! I'll process your text messages — voice transcription coming soon.");
  });

  telegramBot.catch((err) => {
    console.error("[telegram] Bot error:", err.message || err);
  });

  try {
    const me = await telegramBot.api.getMe();
    botInfo = me;
    botUsername = me.username || "";
    isConnected = true;

    await loadApprovedUsers();

    telegramBot.start({
      onStart: () => {
        console.log(`[telegram] Bot online as @${botUsername}`);
      },
    });
  } catch (err: any) {
    console.error("[telegram] Login failed:", err.message);
    telegramBot = null;
    isConnected = false;
    throw err;
  }
}

export async function stopTelegramBot(): Promise<void> {
  if (telegramBot) {
    try {
      await telegramBot.stop();
    } catch {}
    telegramBot = null;
    isConnected = false;
    botUsername = "";
    botInfo = null;
    console.log("[telegram] Bot disconnected");
  }
}

async function handleTextMessage(ctx: Context) {
  const userId = ctx.from?.id;
  const text = ctx.message?.text;

  if (!userId || !text) return;

  if (!approvedUsers.has(userId)) {
    await ctx.reply(
      "You haven't been paired yet. Send /start to get a pairing code, then enter it in your VisionClaw dashboard."
    );
    return;
  }

  const chatKey = `tg-${ctx.chat!.id}`;

  try {
    await ctx.api.sendChatAction(ctx.chat!.id, "typing");

    const conversationId = await getOrCreateConversation(chatKey, ctx);

    const result = await processMessage(conversationId, text, { source: "telegram" });

    await sendTelegramResponse(ctx, result.response, result.thinkContent);
  } catch (err: any) {
    console.error(`[telegram] Error handling message:`, err.message);
    try {
      await ctx.reply("Sorry, I encountered an error processing that. Please try again.");
    } catch {}
  }
}

async function getOrCreateConversation(chatKey: string, ctx: Context): Promise<number> {
  if (telegramConversations.has(chatKey)) {
    const convId = telegramConversations.get(chatKey)!;
    const conv = await storage.getConversation(convId);
    if (conv) return convId;
    telegramConversations.delete(chatKey);
  }

  const settings = await storage.getSettings();
  const activePersona = await storage.getActivePersona();

  const title = ctx.chat!.type === "private"
    ? `Telegram: ${ctx.from?.first_name || "User"} ${ctx.from?.last_name || ""}`.trim()
    : `Telegram: ${(ctx.chat as any)?.title || "Group"}`;

  const conv = await storage.createConversation({
    title,
    model: settings?.defaultModel || "gemini-2.5-flash",
    thinking: settings?.thinkingEnabled ?? false,
    personaId: activePersona?.id ?? null,
  });

  telegramConversations.set(chatKey, conv.id);
  return conv.id;
}

async function sendTelegramResponse(ctx: Context, response: string, thinkContent?: string): Promise<void> {
  const chunks: string[] = [];

  if (thinkContent) {
    const thinkFormatted = `<i>Thinking: ${escapeHtml(thinkContent.slice(0, 600))}${thinkContent.length > 600 ? "..." : ""}</i>`;
    if (thinkFormatted.length <= MESSAGE_CHUNK_SIZE) {
      chunks.push(thinkFormatted);
    }
  }

  let remaining = response;
  while (remaining.length > 0) {
    if (remaining.length <= MESSAGE_CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", MESSAGE_CHUNK_SIZE - 100);
    if (splitAt < 100) splitAt = remaining.lastIndexOf(" ", MESSAGE_CHUNK_SIZE - 100);
    if (splitAt < 100) splitAt = MESSAGE_CHUNK_SIZE - 100;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: "HTML" });
    } catch {
      try {
        await ctx.reply(chunk);
      } catch {}
    }
    if (chunks.length > 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function getPendingPairings(): Array<{ code: string; username: string; firstName: string; createdAt: number }> {
  const now = Date.now();
  const result: Array<{ code: string; username: string; firstName: string; createdAt: number }> = [];
  for (const [code, pairing] of pendingPairings) {
    if (now - pairing.createdAt > 3600000) {
      pendingPairings.delete(code);
      continue;
    }
    result.push({ code, username: pairing.username, firstName: pairing.firstName, createdAt: pairing.createdAt });
  }
  return result;
}

export async function approvePairing(code: string): Promise<{ success: boolean; error?: string; telegramUserId?: number }> {
  const pairing = pendingPairings.get(code.toUpperCase());
  if (!pairing) {
    return { success: false, error: "Invalid or expired pairing code" };
  }

  const telegramUserId = pairing.userId;
  approvedUsers.add(telegramUserId);
  pendingPairings.delete(code.toUpperCase());

  try {
    await db.execute(sql`
      INSERT INTO telegram_approved_users (telegram_user_id, username, first_name, approved_at)
      VALUES (${telegramUserId}, ${pairing.username}, ${pairing.firstName}, NOW())
      ON CONFLICT (telegram_user_id) DO UPDATE SET username = ${pairing.username}, first_name = ${pairing.firstName}, approved_at = NOW()
    `);
  } catch (err: any) {
    console.error("[telegram] Failed to persist approved user:", err.message);
  }

  if (telegramBot) {
    try {
      await telegramBot.api.sendMessage(
        pairing.chatId,
        "Your account has been paired with VisionClaw! You can now send messages and I'll route them to the right AI agent.\n\nTry: /agents to see the team, or just send any message!"
      );
    } catch {}
  }

  return { success: true, telegramUserId };
}

export async function revokeUser(telegramUserId: number): Promise<void> {
  approvedUsers.delete(telegramUserId);
  try {
    await db.execute(sql`DELETE FROM telegram_approved_users WHERE telegram_user_id = ${telegramUserId}`);
  } catch {}
}

export async function getApprovedUsersList(): Promise<Array<{ telegramUserId: number; username: string; firstName: string; approvedAt: string }>> {
  try {
    const result = await db.execute(sql`SELECT telegram_user_id, username, first_name, approved_at FROM telegram_approved_users ORDER BY approved_at DESC`);
    const rows = (result as any).rows || result;
    return (rows || []).map((r: any) => ({
      telegramUserId: r.telegram_user_id,
      username: r.username,
      firstName: r.first_name,
      approvedAt: r.approved_at,
    }));
  } catch {
    return [];
  }
}

async function loadApprovedUsers(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS telegram_approved_users (
        telegram_user_id BIGINT PRIMARY KEY,
        username TEXT DEFAULT '',
        first_name TEXT DEFAULT '',
        approved_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const result = await db.execute(sql`SELECT telegram_user_id FROM telegram_approved_users`);
    const rows = (result as any).rows || result;
    for (const row of rows || []) {
      approvedUsers.add(row.telegram_user_id);
    }
    console.log(`[telegram] Loaded ${approvedUsers.size} approved user(s)`);
  } catch (err: any) {
    console.error("[telegram] Failed to load approved users:", err.message);
  }
}

async function ensureTelegramColumn(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE agent_settings ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT`);
  } catch {}
}

export async function saveTelegramToken(token: string | null): Promise<void> {
  await ensureTelegramColumn();
  if (token) {
    await db.execute(sql`UPDATE agent_settings SET telegram_bot_token = ${token} WHERE id = 1`);
  } else {
    await db.execute(sql`UPDATE agent_settings SET telegram_bot_token = NULL WHERE id = 1`);
  }
}

export async function getTelegramToken(): Promise<string | null> {
  await ensureTelegramColumn();
  const result = await db.execute(sql`SELECT telegram_bot_token FROM agent_settings WHERE id = 1`);
  const rows = (result as any).rows || result;
  return rows?.[0]?.telegram_bot_token || null;
}

export async function initTelegramFromSettings(): Promise<void> {
  try {
    await ensureTelegramColumn();
    const token = await getTelegramToken();
    if (token && typeof token === "string" && token.length > 20) {
      console.log("[telegram] Found bot token in settings, connecting...");
      await startTelegramBot(token);
    }
  } catch (err: any) {
    console.error("[telegram] Auto-init failed:", err.message);
  }
}

export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  if (!telegramBot || !isConnected) throw new Error("Telegram bot not connected");
  await telegramBot.api.sendMessage(chatId, text);
}
