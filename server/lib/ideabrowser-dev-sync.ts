// DEV-workspace-only IdeaBrowser folder freshness sync (Task 160).
//
// The IdeaBrowser pipeline's canonical home is PRODUCTION (separate DB): daily
// ingest+score at 11:00 UTC and Monday Weekly Scenario at 13:15 UTC run there.
// Bob, however, works from the DEV workspace app's Projects → IdeaBrowser
// folder, which silently froze (Jul 20 → Aug 7, 2026) because dev had no cron.
//
// This module is the dev-side daily counterpart:
//   1. ingestNewIdeabrowser + scoreUnscoredIsenberg run directly against the
//      dev DB (both idempotent — dedupe on message_id / slug tag). Wired in
//      the heartbeat handler (server/heartbeat.ts, type ideabrowser_dev_sync).
//   2. Weekly Run cards can't be read from the prod DB (its DATABASE_URL is
//      runtime-managed and unreachable from dev), and the weekly delivery
//      EMAIL is unreliable (verified 2026-08-07: delivery_logs email_sent=t
//      but zero matching messages in the Gmail inbox, even in:anywhere).
//      The reliable prod artifact is the Drive report upload
//      (ideabrowser-weekly-scenario-YYYY-MM-DD.md), so we discover reports by
//      Drive name search, mirror each as a "Weekly Run YYYY-MM-DD" project
//      (dedupe on run name + tag, same key prod uses), attach the Drive link
//      as a project_files row, and download the report to extract the ranking
//      into a project_notes row.
//
// Never throws — all failures are collected loudly in `errors` (the heartbeat
// handler logs them and marks the run status "error"; nothing is silent).

import { db } from "../db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { searchDriveFiles, downloadFromDrive } from "../google-drive";

const REPORT_NAME_PREFIX = "ideabrowser-weekly-scenario-";
const MAX_WEEKLY_REPORTS = 8;

export interface WeeklyCardSyncSummary {
  found: number;
  createdProjectIds: number[];
  errors: string[];
}

/** Ranking/summary block from the weekly report markdown (best-effort, never throws). */
export function extractRankingNote(reportText: string): string {
  const t = (reportText || "").replace(/\r/g, "").trim();
  if (!t) return "";
  // Prefer the section that carries the ranking/winner if present.
  const secIdx = t.search(/^#{1,3}\s*(ranking|winner|results?)/im);
  const body = secIdx >= 0 ? t.slice(secIdx) : t;
  return body.slice(0, 2000).trim();
}

/**
 * Mirror prod "Weekly Run YYYY-MM-DD" cards into the dev DB from the Drive
 * report uploads. Idempotent on run name + ideabrowser-weekly-run tag.
 */
export async function syncWeeklyRunCardsFromDrive(opts: { tenantId: number }): Promise<WeeklyCardSyncSummary> {
  const { tenantId } = opts;
  const summary: WeeklyCardSyncSummary = { found: 0, createdProjectIds: [], errors: [] };

  let matches: any[] = [];
  try {
    const res = await searchDriveFiles({ namePattern: REPORT_NAME_PREFIX, tenantId, limit: 25 });
    if (!res.success) {
      // LOUD skip — Drive auth/token failures must never be silent.
      summary.errors.push(`weekly-card sync: Drive search failed — ${res.error || "unknown error"} (skipping, will retry tomorrow)`);
      return summary;
    }
    matches = res.matches || [];
  } catch (e: any) {
    summary.errors.push(`weekly-card sync: Drive search threw — ${e?.message || e}`);
    return summary;
  }

  // One entry per run date, newest first (search can return DB + Drive dupes).
  const byDate = new Map<string, any>();
  for (const m of matches) {
    const name = String(m.name || m.fileName || "");
    const dm = name.match(/ideabrowser-weekly-scenario-(\d{4}-\d{2}-\d{2})/i);
    if (!dm) continue;
    if (!byDate.has(dm[1])) byDate.set(dm[1], m);
  }
  const runs = Array.from(byDate.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, MAX_WEEKLY_REPORTS);
  summary.found = runs.length;

  for (const [runDate, file] of runs) {
    try {
      const runName = `Weekly Run ${runDate}`;

      // Dedupe on run name + tag (same key prod uses).
      const existing: any = await db.execute(sql`
        SELECT id FROM projects
        WHERE tenant_id = ${tenantId} AND name = ${runName}
          AND 'ideabrowser-weekly-run' = ANY(tags)
        LIMIT 1
      `);
      if (((existing?.rows || existing) as any[]).length > 0) continue;

      const fileId: string | null = file.id || file.fileId || null;
      const fileUrl: string | null =
        file.webViewLink || file.viewLink || file.webContentLink || file.downloadLink || file.fileUrl ||
        (fileId ? `https://drive.google.com/file/d/${fileId}/view` : null);

      // Pull the report content for the ranking note (best-effort).
      let rankingNote = "";
      if (fileId) {
        const tmpPath = `uploads/tmp-ideabrowser-sync-${runDate}.md`;
        try {
          const dl = await downloadFromDrive({ fileId, savePath: tmpPath });
          if (dl.success && dl.path) {
            const abs = path.resolve(process.cwd(), dl.path);
            rankingNote = extractRankingNote(fs.readFileSync(abs, "utf-8"));
            fs.unlinkSync(abs);
          } else {
            summary.errors.push(`weekly-card sync ${runDate}: report download failed — ${dl.error || "unknown"} (card created without ranking note)`);
          }
        } catch (e: any) {
          summary.errors.push(`weekly-card sync ${runDate}: report read failed — ${e?.message || e} (card created without ranking note)`);
        }
      }

      const runDesc =
        `IdeaBrowser weekly money scenario (mirrored from the prod Drive report, ${runDate}). ` +
        `Canonical run lives in the production DB; this card mirrors it for the workspace app.`;
      const tagsLiteral = `{"ideabrowser","ideabrowser-weekly-run"}`;
      const ins: any = await db.execute(sql`
        INSERT INTO projects (tenant_id, name, description, status, tags, metadata)
        VALUES (${tenantId}, ${runName}, ${runDesc}, 'completed', ${tagsLiteral}::text[],
                jsonb_build_object('kind', 'ideabrowser-weekly-run', 'date', ${runDate}::text,
                  'source', 'prod-drive-sync', 'driveFileId', ${fileId}::text))
        RETURNING id
      `);
      const projectId = (((ins?.rows || ins) as any[])[0] || {}).id;
      if (!projectId) {
        summary.errors.push(`weekly-card sync: INSERT for "${runName}" returned no id`);
        continue;
      }
      summary.createdProjectIds.push(projectId);

      if (rankingNote) {
        await db.execute(sql`
          INSERT INTO project_notes (project_id, note, author)
          SELECT ${projectId}, ${rankingNote}, 'ideabrowser-dev-sync'
          WHERE NOT EXISTS (
            SELECT 1 FROM project_notes WHERE project_id = ${projectId} AND author = 'ideabrowser-dev-sync'
          )
        `);
      }

      if (fileUrl) {
        const fileName = `${REPORT_NAME_PREFIX}${runDate}.md`;
        await db.execute(sql`
          INSERT INTO project_files (project_id, file_name, file_url, file_type, uploaded_by)
          SELECT ${projectId}, ${fileName}, ${fileUrl}, 'text/markdown', 'ideabrowser-dev-sync'
          WHERE NOT EXISTS (
            SELECT 1 FROM project_files WHERE project_id = ${projectId} AND file_name = ${fileName}
          )
        `);
      }
    } catch (e: any) {
      summary.errors.push(`weekly-card sync ${runDate}: ${e?.message || e}`);
    }
  }

  return summary;
}
