import { db } from "./db";
import { sql } from "drizzle-orm";

export interface ChannelMessage {
  id: number;
  tenantId: number;
  channelId: number;
  fromPersonaId: number | null;
  messageType: string;
  content: string;
  metadata: any;
  threadId: number | null;
  readBy: number[];
  eventRef: number | null;
  createdAt: string;
}

export interface Channel {
  id: number;
  tenantId: number;
  name: string;
  description: string | null;
  type: string;
  createdAt: string;
}

export async function getChannels(tenantId: number): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT ac.*, COALESCE(sub_counts.subscriber_count, 0)::int as "subscriberCount"
    FROM agent_channels ac
    LEFT JOIN (
      SELECT channel_id, COUNT(*) as subscriber_count
      FROM channel_subscriptions WHERE tenant_id = ${tenantId} AND enabled = TRUE
      GROUP BY channel_id
    ) sub_counts ON sub_counts.channel_id = ac.id
    WHERE ac.tenant_id = ${tenantId}
    ORDER BY ac.name
  `);
  return (result as any).rows || result;
}

export async function getChannelByName(tenantId: number, name: string): Promise<Channel | null> {
  const result = await db.execute(sql`
    SELECT * FROM agent_channels WHERE tenant_id = ${tenantId} AND name = ${name} LIMIT 1
  `);
  const rows = (result as any).rows || result;
  return rows.length > 0 ? rows[0] : null;
}

export async function createChannel(tenantId: number, name: string, description?: string, type?: string, createdBy?: number): Promise<Channel> {
  const result = await db.execute(sql`
    INSERT INTO agent_channels (tenant_id, name, description, type, created_by)
    VALUES (${tenantId}, ${name}, ${description || null}, ${type || "topic"}, ${createdBy || null})
    ON CONFLICT (tenant_id, name) DO NOTHING
    RETURNING *
  `);
  const rows = (result as any).rows || result;
  if (rows.length > 0) return rows[0];

  const existing = await getChannelByName(tenantId, name);
  return existing!;
}

export async function postMessage(params: {
  tenantId: number;
  channelName: string;
  fromPersonaId?: number;
  content: string;
  messageType?: string;
  metadata?: any;
  threadId?: number;
  eventRef?: number;
}): Promise<ChannelMessage | null> {
  const channel = await getChannelByName(params.tenantId, params.channelName);
  if (!channel) {
    console.log(`[channels] Channel ${params.channelName} not found for tenant ${params.tenantId}`);
    return null;
  }

  const result = await db.execute(sql`
    INSERT INTO channel_messages (tenant_id, channel_id, from_persona_id, message_type, content, metadata, thread_id, event_ref)
    VALUES (
      ${params.tenantId},
      ${channel.id},
      ${params.fromPersonaId || null},
      ${params.messageType || "message"},
      ${params.content},
      ${params.metadata ? JSON.stringify(params.metadata) : null}::jsonb,
      ${params.threadId || null},
      ${params.eventRef || null}
    )
    RETURNING *
  `);
  const rows = (result as any).rows || result;
  return rows.length > 0 ? rows[0] : null;
}

export async function readMessages(params: {
  tenantId: number;
  channelName?: string;
  channelId?: number;
  personaId?: number;
  unreadOnly?: boolean;
  limit?: number;
}): Promise<ChannelMessage[]> {
  const limit = params.limit || 20;

  if (params.channelId || params.channelName) {
    let channelId = params.channelId;
    if (!channelId && params.channelName) {
      const ch = await getChannelByName(params.tenantId, params.channelName);
      if (!ch) return [];
      channelId = ch.id;
    }

    if (params.unreadOnly && params.personaId) {
      const result = await db.execute(sql`
        SELECT cm.*, ac.name as channel_name, p.name as from_persona_name
        FROM channel_messages cm
        LEFT JOIN agent_channels ac ON ac.id = cm.channel_id
        LEFT JOIN personas p ON p.id = cm.from_persona_id
        WHERE cm.tenant_id = ${params.tenantId}
          AND cm.channel_id = ${channelId}
          AND NOT (cm.read_by @> ${JSON.stringify([params.personaId])}::jsonb)
        ORDER BY cm.created_at DESC LIMIT ${limit}
      `);
      return ((result as any).rows || result) as ChannelMessage[];
    }

    const result = await db.execute(sql`
      SELECT cm.*, ac.name as channel_name, p.name as from_persona_name
      FROM channel_messages cm
      LEFT JOIN agent_channels ac ON ac.id = cm.channel_id
      LEFT JOIN personas p ON p.id = cm.from_persona_id
      WHERE cm.tenant_id = ${params.tenantId} AND cm.channel_id = ${channelId}
      ORDER BY cm.created_at DESC LIMIT ${limit}
    `);
    return ((result as any).rows || result) as ChannelMessage[];
  }

  if (params.personaId) {
    const subResult = await db.execute(sql`
      SELECT channel_id FROM channel_subscriptions
      WHERE tenant_id = ${params.tenantId} AND persona_id = ${params.personaId} AND enabled = TRUE
    `);
    const subRows = (subResult as any).rows || subResult;
    if (subRows.length === 0) return [];

    const channelIds = subRows.map((r: any) => r.channel_id);

    if (params.unreadOnly) {
      const result = await db.execute(sql`
        SELECT cm.*, ac.name as channel_name FROM channel_messages cm
        JOIN agent_channels ac ON ac.id = cm.channel_id
        WHERE cm.tenant_id = ${params.tenantId}
          AND cm.channel_id = ANY(${channelIds}::int[])
          AND NOT (cm.read_by @> ${JSON.stringify([params.personaId])}::jsonb)
        ORDER BY cm.created_at DESC LIMIT ${limit}
      `);
      return ((result as any).rows || result) as ChannelMessage[];
    }

    const result = await db.execute(sql`
      SELECT cm.*, ac.name as channel_name FROM channel_messages cm
      JOIN agent_channels ac ON ac.id = cm.channel_id
      WHERE cm.tenant_id = ${params.tenantId}
        AND cm.channel_id = ANY(${channelIds}::int[])
      ORDER BY cm.created_at DESC LIMIT ${limit}
    `);
    return ((result as any).rows || result) as ChannelMessage[];
  }

  const result = await db.execute(sql`
    SELECT cm.*, ac.name as channel_name FROM channel_messages cm
    JOIN agent_channels ac ON ac.id = cm.channel_id
    WHERE cm.tenant_id = ${params.tenantId}
    ORDER BY cm.created_at DESC LIMIT ${limit}
  `);
  return ((result as any).rows || result) as ChannelMessage[];
}

export async function markMessagesRead(tenantId: number, personaId: number, messageIds: number[]): Promise<void> {
  for (const msgId of messageIds) {
    await db.execute(sql`
      UPDATE channel_messages
      SET read_by = read_by || ${JSON.stringify([personaId])}::jsonb
      WHERE id = ${msgId} AND tenant_id = ${tenantId}
        AND NOT (read_by @> ${JSON.stringify([personaId])}::jsonb)
    `);
  }
}

export async function getUnreadCount(tenantId: number, personaId: number): Promise<{ channelName: string; count: number }[]> {
  const result = await db.execute(sql`
    SELECT ac.name as channel_name, COUNT(*) as count
    FROM channel_messages cm
    JOIN agent_channels ac ON ac.id = cm.channel_id
    JOIN channel_subscriptions cs ON cs.channel_id = cm.channel_id AND cs.persona_id = ${personaId}
    WHERE cm.tenant_id = ${tenantId}
      AND cs.enabled = TRUE
      AND NOT (cm.read_by @> ${JSON.stringify([personaId])}::jsonb)
    GROUP BY ac.name
    ORDER BY count DESC
  `);
  return ((result as any).rows || result) as { channelName: string; count: number }[];
}

export async function getChannelSubscribers(tenantId: number, channelId: number): Promise<number[]> {
  const result = await db.execute(sql`
    SELECT persona_id FROM channel_subscriptions
    WHERE tenant_id = ${tenantId} AND channel_id = ${channelId} AND enabled = TRUE
  `);
  return ((result as any).rows || result).map((r: any) => r.persona_id);
}

export async function subscribeToChannel(tenantId: number, channelId: number, personaId: number, priority?: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO channel_subscriptions (tenant_id, channel_id, persona_id, priority)
    VALUES (${tenantId}, ${channelId}, ${personaId}, ${priority || "normal"})
    ON CONFLICT (channel_id, persona_id) DO UPDATE SET enabled = TRUE, priority = ${priority || "normal"}
  `);
}

export async function unsubscribeFromChannel(tenantId: number, channelId: number, personaId: number): Promise<void> {
  await db.execute(sql`
    UPDATE channel_subscriptions SET enabled = FALSE
    WHERE tenant_id = ${tenantId} AND channel_id = ${channelId} AND persona_id = ${personaId}
  `);
}

export function buildChannelContext(messages: ChannelMessage[], personaName?: string): string {
  if (messages.length === 0) return "";

  let context = `\n## Recent Channel Messages\n`;
  // R119: bumped from 10→30 messages, 200→500 chars (modern 1M-context models can absorb 3× the cross-channel awareness)
  for (const msg of messages.slice(0, 30)) {
    const from = msg.fromPersonaId ? `Persona #${msg.fromPersonaId}` : "System";
    const channel = (msg as any).channel_name || `Channel #${msg.channelId}`;
    context += `- [${channel}] ${from} (${msg.messageType}): ${msg.content.substring(0, 500)}\n`;
  }
  return context;
}
