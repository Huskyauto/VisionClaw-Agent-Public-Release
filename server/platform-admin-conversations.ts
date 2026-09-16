import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { conversations, type Conversation } from "@shared/schema";
import { isPlatformAdmin } from "./auth";
import { db } from "./db";

/**
 * The sole cross-tenant conversation lookup. Authorization is checked inside
 * this boundary rather than represented by an importable capability token.
 */
export async function getConversationForPlatformAdmin(
  req: Request,
  conversationId: number,
): Promise<Conversation | undefined> {
  if (!isPlatformAdmin(req)) {
    throw new Error("Platform admin access required");
  }
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)));
  return conversation;
}