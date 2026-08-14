import { db } from "./db";
import { sql } from "drizzle-orm";

export type ChannelType = "web" | "telegram" | "discord" | "whatsapp" | "webhook" | "email";

export interface ChannelRoute {
  id: number;
  channel: ChannelType;
  personaId: number;
  personaName: string;
  enabled: boolean;
  createdAt: string;
}

export async function ensureChannelRoutingTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS channel_routes (
      id SERIAL PRIMARY KEY,
      channel TEXT NOT NULL,
      persona_id INTEGER NOT NULL,
      enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(channel)
    )
  `);
}

export async function listChannelRoutes(): Promise<ChannelRoute[]> {
  await ensureChannelRoutingTable();
  const result = await db.execute(sql`
    SELECT cr.*, p.name as persona_name
    FROM channel_routes cr
    JOIN personas p ON p.id = cr.persona_id
    WHERE cr.enabled = true
    ORDER BY cr.channel
  `);
  const rows = (result as any).rows || result;
  return (rows || []).map((r: any) => ({
    id: r.id,
    channel: r.channel,
    personaId: r.persona_id,
    personaName: r.persona_name,
    enabled: r.enabled,
    createdAt: r.created_at,
  }));
}

export async function setChannelRoute(channel: ChannelType, personaId: number | null): Promise<void> {
  await ensureChannelRoutingTable();
  if (personaId === null) {
    await db.execute(sql`DELETE FROM channel_routes WHERE channel = ${channel}`);
  } else {
    await db.execute(sql`
      INSERT INTO channel_routes (channel, persona_id)
      VALUES (${channel}, ${personaId})
      ON CONFLICT (channel) DO UPDATE SET persona_id = ${personaId}, enabled = true
    `);
  }
}

export async function getPersonaForChannel(channel: ChannelType): Promise<number | null> {
  await ensureChannelRoutingTable();
  const result = await db.execute(sql`
    SELECT persona_id FROM channel_routes WHERE channel = ${channel} AND enabled = true
  `);
  const rows = (result as any).rows || result;
  return rows?.[0]?.persona_id || null;
}

export async function removeChannelRoute(channel: ChannelType): Promise<void> {
  await db.execute(sql`DELETE FROM channel_routes WHERE channel = ${channel}`);
}
