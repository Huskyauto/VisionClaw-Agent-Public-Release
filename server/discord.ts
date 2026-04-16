import { Client, GatewayIntentBits, Events, Message, ChannelType, TextChannel } from "discord.js";
import { storage } from "./storage";
import { processMessage } from "./chat-engine";

let discordClient: Client | null = null;
let isConnected = false;

const discordConversations = new Map<string, number>();

export function getDiscordStatus(): { connected: boolean; username?: string; guilds?: number } {
  if (!discordClient || !isConnected) return { connected: false };
  return {
    connected: true,
    username: discordClient.user?.tag,
    guilds: discordClient.guilds.cache.size,
  };
}

export async function startDiscordBot(token: string): Promise<void> {
  if (discordClient) {
    await stopDiscordBot();
  }

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  discordClient.once(Events.ClientReady, (c) => {
    isConnected = true;
    console.log(`[discord] Bot online as ${c.user.tag} — ${c.guilds.cache.size} server(s)`);
  });

  discordClient.on(Events.MessageCreate, handleMessage);

  discordClient.on(Events.Error, (err) => {
    console.error("[discord] Client error:", err.message);
  });

  try {
    await discordClient.login(token);
  } catch (err: any) {
    console.error("[discord] Login failed:", err.message);
    discordClient = null;
    isConnected = false;
    throw err;
  }
}

export async function stopDiscordBot(): Promise<void> {
  if (discordClient) {
    discordClient.removeAllListeners();
    await discordClient.destroy();
    discordClient = null;
    isConnected = false;
    console.log("[discord] Bot disconnected");
  }
}

async function handleMessage(message: Message) {
  if (message.author.bot) return;

  const isDM = message.channel.type === ChannelType.DM;
  const isMentioned = message.mentions.has(discordClient!.user!);

  if (!isDM && !isMentioned) return;

  let userContent = message.content;
  if (isMentioned && !isDM) {
    userContent = userContent.replace(/<@!?\d+>/g, "").trim();
  }
  if (!userContent) return;

  const channelKey = isDM
    ? `dm-${message.author.id}`
    : `guild-${message.guildId}-${message.channelId}`;

  try {
    const channel = message.channel;
    if ("sendTyping" in channel) {
      await channel.sendTyping();
    }

    const conversationId = await getOrCreateConversation(channelKey, message);

    const result = await processMessage(conversationId, userContent, { source: "discord" });

    await sendDiscordResponse(message, result.response, result.thinkContent);
  } catch (err: any) {
    console.error(`[discord] Error handling message:`, err.message);
    try {
      await message.reply("Sorry, I encountered an error processing that. Please try again.");
    } catch {
    }
  }
}

async function getOrCreateConversation(channelKey: string, message: Message): Promise<number> {
  if (discordConversations.has(channelKey)) {
    const convId = discordConversations.get(channelKey)!;
    const conv = await storage.getConversation(convId);
    if (conv) return convId;
    discordConversations.delete(channelKey);
  }

  const isDM = message.channel.type === ChannelType.DM;
  const settings = await storage.getSettings();
  const activePersona = await storage.getActivePersona();

  const title = isDM
    ? `Discord DM: ${message.author.displayName}`
    : `Discord: #${(message.channel as TextChannel).name || "channel"}`;

  const conv = await storage.createConversation({
    title,
    model: settings?.defaultModel || "gemini-2.5-flash",
    thinking: settings?.thinkingEnabled ?? false,
    personaId: activePersona?.id ?? null,
  });

  discordConversations.set(channelKey, conv.id);
  return conv.id;
}

async function sendDiscordResponse(message: Message, response: string, thinkContent?: string): Promise<void> {
  const chunks: string[] = [];

  if (thinkContent) {
    const thinkFormatted = `||**Thinking:** ${thinkContent.slice(0, 800)}${thinkContent.length > 800 ? "..." : ""}||`;
    if (thinkFormatted.length <= 2000) {
      chunks.push(thinkFormatted);
    }
  }

  let remaining = response;
  while (remaining.length > 0) {
    if (remaining.length <= 2000) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", 1900);
    if (splitAt < 100) splitAt = remaining.lastIndexOf(" ", 1900);
    if (splitAt < 100) splitAt = 1900;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      await message.reply(chunks[i]);
    } else {
      await message.channel.send(chunks[i]);
    }
  }
}

export async function initDiscordFromSettings(): Promise<void> {
  try {
    const settings = await storage.getSettings();
    const token = (settings as any)?.discordBotToken;
    if (token && typeof token === "string" && token.length > 20) {
      console.log("[discord] Found bot token in settings, connecting...");
      await startDiscordBot(token);
    }
  } catch {
  }
}
