import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

type Helpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  isAdminRequest: (req: Request) => boolean;
  ADMIN_TENANT_ID: number;
};

const WEDGES = [
  { slug: "audit-pro", label: "Audit Pro", priceLabel: "$299 one-shot" },
  { slug: "built-with-x", label: "Built-With-X", priceLabel: "$99-$999/mo" },
  { slug: "youtube-portfolio-ops", label: "YouTube Portfolio Ops", priceLabel: "$199-$999/mo" },
] as const;

const CACHE_TTL_MS = 30_000;
const cache = new Map<number, { ts: number; payload: any }>();
const BRAIN_DIR = path.resolve(process.cwd(), "project-brains");

export function registerAdminWedgesRoutes(app: Express, h: Helpers) {
  app.get("/api/admin/wedges/status", h.authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = h.getTenantFromRequest(req);
      if (tenantId !== h.ADMIN_TENANT_ID || !h.isAdminRequest(req)) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const cached = cache.get(tenantId);
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        res.setHeader("X-Cache", "HIT");
        return res.json(cached.payload);
      }

      const wedges = await Promise.all(WEDGES.map(async (w) => {
        const tag = `wedge:${w.slug}`;

        const projRes: any = await db.execute(sql`
          SELECT id, name, status, description, primary_conversation_id,
                 drive_folder_url, current_state, updated_at, created_at
          FROM projects
          WHERE tenant_id = ${tenantId} AND ${tag} = ANY(tags)
          ORDER BY id ASC
          LIMIT 1
        `);
        const project = ((projRes as any).rows || projRes)[0] || null;

        let pendingDrafts = 0;
        try {
          const dRes: any = await db.execute(sql`
            SELECT COUNT(*)::int AS c
            FROM lead_nurture_drafts
            WHERE tenant_id = ${tenantId}
              AND wedge_slug = ${w.slug}
              AND status = 'pending_review'
          `);
          pendingDrafts = Number(((dRes as any).rows || dRes)[0]?.c || 0);
        } catch (e: any) {
          // Table created lazily by lead-nurture-cron; absent until first run.
          // PG 42P01 = undefined_table — only swallow that; surface anything else.
          if (e?.code !== "42P01") {
            console.warn("[admin-wedges] pendingDrafts query failed:", e?.code, e?.message);
          }
          pendingDrafts = 0;
        }

        // Word-boundary match so e.g. slug "audit" doesn't grab tasks for "audit-pro".
        // POSIX \m / \M = start/end of word in Postgres regex.
        const slugRe = `\\m${w.slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\M`;
        const hbRes: any = await db.execute(sql`
          SELECT name, last_run_at, next_run_at, enabled, cron_expression
          FROM heartbeat_tasks
          WHERE tenant_id = ${tenantId}
            AND (
              LOWER(name) ~ ${slugRe}
              OR LOWER(description) ~ ${slugRe}
              OR LOWER(prompt_content) ~ ${slugRe}
            )
          ORDER BY next_run_at NULLS LAST
          LIMIT 1
        `);
        const heartbeat = ((hbRes as any).rows || hbRes)[0] || null;

        // project.id is a serial PK integer from the DB so traversal is structurally impossible,
        // but enforce a strict directory boundary anyway (architect defensive-pattern).
        let brainPath: string | null = null;
        let brainExists = false;
        if (project && Number.isInteger(project.id)) {
          const candidate = path.resolve(BRAIN_DIR, `project-${project.id}-brain.md`);
          if (candidate.startsWith(BRAIN_DIR + path.sep)) {
            brainPath = path.relative(process.cwd(), candidate);
            brainExists = fs.existsSync(candidate);
          }
        }

        const lastRunAt = heartbeat?.last_run_at ? new Date(heartbeat.last_run_at) : null;
        const nextRunAt = heartbeat?.next_run_at ? new Date(heartbeat.next_run_at) : null;
        const now = Date.now();
        const isOverdue = nextRunAt ? nextRunAt.getTime() < now : false;

        let nextAction: { label: string; href: string; urgency: "high" | "medium" | "low" };
        if (pendingDrafts > 0) {
          nextAction = {
            label: `${pendingDrafts} draft${pendingDrafts === 1 ? "" : "s"} to review`,
            href: project?.primary_conversation_id ? `/chat/${project.primary_conversation_id}` : "/inbox",
            urgency: "high",
          };
        } else if (isOverdue) {
          nextAction = { label: `Heartbeat overdue — ${heartbeat.name}`, href: "/heartbeat", urgency: "high" };
        } else if (project?.primary_conversation_id) {
          nextAction = { label: "Open project chat", href: `/chat/${project.primary_conversation_id}`, urgency: "medium" };
        } else if (project) {
          nextAction = { label: "View project", href: "/projects", urgency: "low" };
        } else {
          nextAction = { label: "Wedge not wired", href: "/admin/wedges", urgency: "high" };
        }

        return {
          slug: w.slug,
          label: w.label,
          priceLabel: w.priceLabel,
          project: project ? {
            id: project.id,
            name: project.name,
            status: project.status,
            currentState: project.current_state || "",
            driveFolderUrl: project.drive_folder_url || null,
            primaryConversationId: project.primary_conversation_id || null,
            updatedAt: project.updated_at,
          } : null,
          heartbeat: heartbeat ? {
            name: heartbeat.name,
            lastRunAt: heartbeat.last_run_at,
            nextRunAt: heartbeat.next_run_at,
            enabled: heartbeat.enabled,
            cron: heartbeat.cron_expression,
            isOverdue,
          } : null,
          pendingDrafts,
          brainPath: brainExists ? brainPath : null,
          nextAction,
        };
      }));

      const payload = { tenantId, computedAt: new Date().toISOString(), wedges };
      cache.set(tenantId, { ts: Date.now(), payload });
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (err: any) {
      console.error("[admin-wedges] failed:", err);
      res.status(500).json({ error: "wedge-status-failed", detail: String(err?.message || err) });
    }
  });
}
