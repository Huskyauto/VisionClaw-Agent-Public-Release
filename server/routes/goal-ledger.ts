import type { Express, Request, Response } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { db } from "../db";
import { sql } from "drizzle-orm";

interface Deps {
  authMiddleware: any;
  requirePlatformAdmin: any;
}

const REPO_ROOT = process.cwd();
const SESSION_PLAN_PATH = path.join(REPO_ROOT, ".local", "session_plan.md");
const TASKS_DIR = path.join(REPO_ROOT, ".local", "tasks");
const REPLIT_MD_PATH = path.join(REPO_ROOT, "replit.md");

async function safeReadFile(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return null;
  }
}

async function readSessionPlan() {
  const content = await safeReadFile(SESSION_PLAN_PATH);
  if (!content) return null;
  const stat = await fs.stat(SESSION_PLAN_PATH).catch(() => null);
  return {
    content,
    mtime: stat?.mtime.toISOString() ?? null,
    ageMinutes: stat ? Math.round((Date.now() - stat.mtimeMs) / 60000) : null,
  };
}

async function readTasks() {
  let files: string[] = [];
  try {
    files = await fs.readdir(TASKS_DIR);
  } catch {
    return [];
  }
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  const results = await Promise.allSettled(
    mdFiles.map(async (f) => {
      const full = path.join(TASKS_DIR, f);
      const stat = await fs.stat(full).catch(() => null);
      const content = (await safeReadFile(full)) ?? "";
      const titleMatch = content.match(/^title:\s*(.+)$/m) || content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : f.replace(/\.md$/, "");
      const firstPara = content
        .replace(/^---[\s\S]*?---\n/, "")
        .replace(/^#.*\n/, "")
        .split("\n\n")
        .find((p) => p.trim().length > 0) ?? "";
      return {
        file: f,
        title,
        summary: firstPara.trim().slice(0, 280),
        mtime: stat?.mtime.toISOString() ?? null,
        sizeBytes: stat?.size ?? 0,
      };
    })
  );
  const items = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
    .map((r) => r.value);
  return items.sort((a, b) => (b.mtime ?? "").localeCompare(a.mtime ?? ""));
}

async function readRecentRounds(limit = 5) {
  const md = await safeReadFile(REPLIT_MD_PATH);
  if (!md) return [];
  const lines = md.split("\n");
  const rounds: Array<{ round: string; date: string | null; oneLiner: string }> = [];
  for (const line of lines) {
    const m = line.match(/^- \*\*(R[\d.+a-zA-Z_-]+)\*\*\s*(?:\((\d{4}-\d{2}-\d{2})\))?\s*[—-]\s*(.+)$/);
    if (m) {
      rounds.push({
        round: m[1],
        date: m[2] ?? null,
        oneLiner: m[3].replace(/_\(model:[^)]+\)_\s*$/, "").trim().slice(0, 320),
      });
      if (rounds.length >= limit) break;
    }
  }
  return rounds;
}

async function readActiveJobs() {
  try {
    const result: any = await db.execute(sql`
      SELECT j.id, j.kind, j.status, j.tenant_id, t.name AS tenant_name,
             j.started_at, j.next_run_at, j.lease_until, j.created_at
      FROM agent_jobs j
      LEFT JOIN tenants t ON t.id = j.tenant_id
      WHERE j.status IN ('pending', 'running')
      ORDER BY j.created_at DESC
      LIMIT 20
    `);
    return (result.rows || result) as any[];
  } catch {
    return [];
  }
}

export function registerGoalLedgerRoutes(app: Express, deps: Deps) {
  app.get(
    "/api/admin/goal-ledger",
    deps.authMiddleware,
    deps.requirePlatformAdmin,
    async (_req: Request, res: Response) => {
      try {
        const [sessionPlan, tasks, recentRounds, activeJobs] = await Promise.all([
          readSessionPlan(),
          readTasks(),
          readRecentRounds(5),
          readActiveJobs(),
        ]);
        res.json({
          generatedAt: new Date().toISOString(),
          sessionPlan,
          tasks,
          recentRounds,
          activeJobs,
        });
      } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "failed to assemble goal ledger" });
      }
    }
  );
}
