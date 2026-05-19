import { db } from "./db";
import { notifications, activityLog } from "@shared/schema";

export async function createNotification(
  tenantId: number,
  title: string,
  message: string,
  opts: { type?: string; category?: string; actionUrl?: string; metadata?: any } = {}
) {
  try {
    await db.insert(notifications).values({
      tenantId,
      title,
      message,
      type: opts.type || "info",
      category: opts.category || "system",
      actionUrl: opts.actionUrl || null,
      metadata: opts.metadata || {},
    });
  } catch (err) {
    console.error("[activity-logger] Failed to create notification:", err);
  }
}

export async function logActivity(
  tenantId: number,
  action: string,
  description: string,
  opts: {
    actorType?: string;
    actorName?: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: any;
  } = {}
) {
  try {
    await db.insert(activityLog).values({
      tenantId,
      action,
      description,
      actorType: opts.actorType || "agent",
      actorName: opts.actorName || "System",
      resourceType: opts.resourceType || null,
      resourceId: opts.resourceId || null,
      metadata: opts.metadata || {},
    });
  } catch (err) {
    console.error("[activity-logger] Failed to log activity:", err);
  }
}

export async function notifyAndLog(
  tenantId: number,
  action: string,
  title: string,
  description: string,
  opts: {
    notifType?: string;
    category?: string;
    actionUrl?: string;
    actorType?: string;
    actorName?: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: any;
  } = {}
) {
  await Promise.all([
    createNotification(tenantId, title, description, {
      type: opts.notifType || "info",
      category: opts.category || "system",
      actionUrl: opts.actionUrl,
      metadata: opts.metadata,
    }),
    logActivity(tenantId, action, description, {
      actorType: opts.actorType || "agent",
      actorName: opts.actorName || "System",
      resourceType: opts.resourceType,
      resourceId: opts.resourceId,
      metadata: opts.metadata,
    }),
  ]);
}