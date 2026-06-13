/**
 * R70 — Health Audit Module
 *
 * Detects rot before it bites in production:
 *   A. scanStalePlans         — plan/scratch files older than threshold
 *   B. scanOrphanModules       — server/ TS files that nothing imports
 *   C. (extends wiring-invariants.ts — tool/registry/executor symmetry)
 *   D. scanRouteOrphans        — server routes that no client code calls
 *   E. archiveStaleProposals   — TTL on code_proposals + heartbeat_tasks
 *   F. scanBrowserActionDispatch — every BrowserAction variant has a case
 *
 * Single entry point: runFullAudit({ apply }). With apply=false, dry-run only.
 */

import { promises as fs } from "fs";
import path from "path";
import { db } from "./db";
import { sql } from "drizzle-orm";

import { logSilentCatch } from "./lib/silent-catch";
export interface AuditFinding {
  severity: "info" | "warn" | "high";
  category: "stale_plan" | "orphan_module" | "route_orphan" | "stale_proposal" | "browser_action" | "stale_heartbeat";
  message: string;
  path?: string;
  detail?: any;
}

export interface AuditReport {
  generatedAt: string;
  totals: Record<string, number>;
  findings: AuditFinding[];
  applied: { archivedProposals: number; archivedHeartbeats: number; deletedFiles: string[] };
}

const ROOT = process.cwd();

// ---------- A. Stale plan / scratch files ----------

const STALE_PLAN_GLOBS = [
  ".local/session_plan.md",
  ".local/tasks",          // dir
  "attached_assets",       // dir — but only *.md/*.txt (see filter below)
];

// Within attached_assets we only care about planning text artifacts (.md/.txt),
// not user-uploaded images/PDFs/zips which are reference material kept on purpose.
const ATTACHED_PLAN_EXT = /\.(md|txt)$/i;
const STALE_ROOT_MD_PATTERNS = [
  /^[A-Z][A-Z_]+_PLAN\.md$/,
  /^TODO\.md$/i,
  /^NOTES?\.md$/i,
  /^SCRATCH.*\.md$/i,
  /^.*\(copy\)\.md$/,
];
const STALE_DAYS = 14;

async function scanStalePlans(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const cutoff = Date.now() - STALE_DAYS * 24 * 3600 * 1000;

  // Direct path checks
  for (const rel of STALE_PLAN_GLOBS) {
    const abs = path.join(ROOT, rel);
    try {
      const stat = await fs.stat(abs);
      if (stat.isDirectory()) {
        const entries = await fs.readdir(abs);
        const isAttached = rel === "attached_assets";
        for (const name of entries) {
          // attached_assets: only flag stale planning artifacts (.md/.txt),
          // skip user-uploaded images/PDFs/zips (kept on purpose).
          if (isAttached && !ATTACHED_PLAN_EXT.test(name)) continue;
          const child = path.join(abs, name);
          try {
            const st = await fs.stat(child);
            if (st.mtimeMs < cutoff) {
              findings.push({
                severity: "warn",
                category: "stale_plan",
                message: `Stale file in ${rel}: ${name} (${Math.round((Date.now() - st.mtimeMs) / 86400000)}d old)`,
                path: path.relative(ROOT, child),
              });
            }
          } catch (_silentErr) { logSilentCatch("server/health-audit.ts", _silentErr); }
        }
      } else if (stat.mtimeMs < cutoff) {
        findings.push({
          severity: "warn",
          category: "stale_plan",
          message: `Stale plan file: ${rel}`,
          path: rel,
        });
      }
    } catch (_silentErr) { logSilentCatch("server/health-audit.ts", _silentErr); } // not present — fine
  }

  // Root-level *.md matching stale patterns
  try {
    const rootEntries = await fs.readdir(ROOT);
    for (const name of rootEntries) {
      if (!STALE_ROOT_MD_PATTERNS.some(rx => rx.test(name))) continue;
      const abs = path.join(ROOT, name);
      try {
        const st = await fs.stat(abs);
        if (st.isFile() && st.mtimeMs < cutoff) {
          findings.push({
            severity: "info",
            category: "stale_plan",
            message: `Stale root markdown: ${name}`,
            path: name,
          });
        }
      } catch (_silentErr) { logSilentCatch("server/health-audit.ts", _silentErr); }
    }
  } catch (_silentErr) { logSilentCatch("server/health-audit.ts", _silentErr); }

  return findings;
}

// ---------- B. Orphan modules ----------

async function listFiles(dir: string, ext: string[], skip: Set<string> = new Set()): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    let entries: string[] = [];
    try { entries = await fs.readdir(d); } catch { return; }
    for (const name of entries) {
      if (skip.has(name)) continue;
      const full = path.join(d, name);
      let st;
      try { st = await fs.stat(full); } catch { continue; }
      if (st.isDirectory()) await walk(full);
      else if (ext.some(e => name.endsWith(e))) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

const ORPHAN_ALLOWLIST = new Set([
  "server/index.ts",
  "server/vite.ts",
  "server/db.ts",
  "server/routes.ts",
  "server/storage.ts",
  "server/health-audit.ts",
  // CLI/seed scripts run via tsx, not imported by other modules:
  "server/seed-persona-prompts.ts",
  "server/generate-feature-pdf.ts",
  // Connector barrel files used dynamically or for type inference:
  "server/replit_integrations/batch/index.ts",
  "server/replit_integrations/image/index.ts",
]);

async function scanOrphanModules(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const serverFiles = await listFiles(path.join(ROOT, "server"), [".ts"], new Set(["node_modules", "dist", "__tests__"]));

  // Build set of every imported module path
  const imported = new Set<string>();
  const importRx = /\bfrom\s+['"](\.[^'"]+|@\/[^'"]+|@shared\/[^'"]+|\.{1,2}\/[^'"]+)['"]/g;
  const dynamicRx = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  // R70 architect-fix: also track CommonJS-style require('./foo') edges so we
  // don't false-positive orphan modules that are only loaded via require().
  const requireRx = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  // Side-effect imports (`import './foo'`) which lack a `from` keyword.
  const sideEffectRx = /\bimport\s+['"](\.[^'"]+|@\/[^'"]+|@shared\/[^'"]+)['"]/g;

  for (const file of serverFiles) {
    let src = "";
    try { src = await fs.readFile(file, "utf8"); } catch { continue; }
    for (const rx of [importRx, dynamicRx, requireRx, sideEffectRx]) {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(src))) {
        let p = m[1];
        if (p.startsWith("./") || p.startsWith("../")) {
          const resolved = path.normalize(path.join(path.dirname(file), p));
          imported.add(resolved);
          imported.add(resolved + ".ts");
          imported.add(resolved + ".tsx");
          imported.add(path.join(resolved, "index.ts"));
        } else if (p.startsWith("@/")) {
          // client alias — irrelevant for server orphan scan
        } else if (p.startsWith("@shared/")) {
          const resolved = path.join(ROOT, "shared", p.slice(8));
          imported.add(resolved);
          imported.add(resolved + ".ts");
        }
      }
    }
  }

  for (const file of serverFiles) {
    const rel = path.relative(ROOT, file);
    if (ORPHAN_ALLOWLIST.has(rel)) continue;
    if (rel.endsWith(".d.ts")) continue;
    const base = file.replace(/\.tsx?$/, "");
    const isImported =
      imported.has(file) ||
      imported.has(base) ||
      imported.has(base + ".ts") ||
      imported.has(file.replace(/\/index\.ts$/, ""));
    if (!isImported) {
      findings.push({
        severity: "warn",
        category: "orphan_module",
        message: `Orphan server module: ${rel} (no other file imports it)`,
        path: rel,
      });
    }
  }
  return findings;
}

// ---------- D. Route orphans ----------

async function scanRouteOrphans(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const routesPath = path.join(ROOT, "server/routes.ts");
  let routesSrc = "";
  try { routesSrc = await fs.readFile(routesPath, "utf8"); } catch { return findings; }

  // Extract all server routes
  const routeRx = /app\.(get|post|put|patch|delete)\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
  const serverRoutes = new Set<string>();
  let m;
  while ((m = routeRx.exec(routesSrc))) {
    const p = m[2];
    if (p.startsWith("/api/")) serverRoutes.add(p);
  }

  // R71: Scan client + server (server-to-server fetch) + scripts (cron/CLI)
  // for any reference to an /api/... path. Without this, server-side cron
  // jobs and CLI tools would falsely flag their own routes as orphans.
  const consumerFiles = [
    ...await listFiles(path.join(ROOT, "client/src"), [".ts", ".tsx"]),
    ...await listFiles(path.join(ROOT, "server"), [".ts"], new Set(["node_modules"])),
    ...await listFiles(path.join(ROOT, "scripts"), [".ts", ".js", ".sh"]),
  ];
  const referenced = new Set<string>();
  for (const file of consumerFiles) {
    // Don't let routes.ts count as its own consumer
    if (file.endsWith("/server/routes.ts")) continue;
    let src = "";
    try { src = await fs.readFile(file, "utf8"); } catch { continue; }
    // Match: '/api/...' or `/api/...` literal anywhere
    const refRx = /[`'"](\/api\/[a-zA-Z0-9_\-/:.]+)[`'"]/g;
    let mm;
    while ((mm = refRx.exec(src))) {
      // Normalize template literal placeholders: take the static prefix
      const literal = mm[1].replace(/\$\{[^}]+\}/g, ":param");
      referenced.add(literal);
      // Also add prefix segments (queryKey arrays often store '/api/foo' and pass id separately)
      const segs = literal.split("/");
      for (let i = 3; i <= segs.length; i++) {
        referenced.add(segs.slice(0, i).join("/"));
      }
    }
  }

  // Match: server route used by something with the same path-prefix structure
  for (const route of serverRoutes) {
    // Param-aware: replace /:foo with /:param for comparison
    const normalized = route.replace(/:[^/]+/g, ":param");
    const prefix = normalized.split(":param")[0].replace(/\/$/, "");
    let matched = false;
    for (const ref of referenced) {
      if (ref === normalized || ref === route || ref.startsWith(prefix + "/") || ref === prefix) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      // R71 (architect-fix): narrow allowlist to actual external entry points
      // only. No broad namespace allowlists — those would mask real orphans
      // inside the namespace (e.g. an unused /api/stripe/foo).
      if (
        route.includes("/webhook") ||              // generic webhook receivers
        route.includes("/healthz") ||
        route.includes("/oauth/") ||                // OAuth flow endpoints
        route.includes("/callback") ||              // external callbacks
        route.startsWith("/api/glasses") ||         // hardware client
        route.startsWith("/api/public/") ||         // explicit public surface
        route.startsWith("/api/admin/health-audit") ||
        // Specific public/shareable URL patterns (token in path):
        route.startsWith("/api/presenter/:token") ||
        route.startsWith("/api/c/:slug") ||
        route.startsWith("/api/trigger/:key")
      ) continue;
      findings.push({
        severity: "info",
        category: "route_orphan",
        message: `Server route with no client caller: ${route}`,
        path: route,
      });
    }
  }
  return findings;
}

// ---------- E. Stale proposals + heartbeat tasks (TTL) ----------

const PROPOSAL_TTL_DAYS = 14;
const HEARTBEAT_STUCK_DAYS = 7;

async function archiveStaleProposals(apply: boolean): Promise<{ findings: AuditFinding[]; archivedProposals: number; archivedHeartbeats: number }> {
  const findings: AuditFinding[] = [];
  let archivedProposals = 0;
  let archivedHeartbeats = 0;

  // Stale code_proposals: pending/proposed older than TTL
  const stale: any = await db.execute(sql`
    SELECT id, title, status, created_at
    FROM code_proposals
    WHERE status IN ('pending', 'proposed', 'unverified')
      AND created_at < NOW() - (${PROPOSAL_TTL_DAYS} || ' days')::interval
    ORDER BY created_at ASC
    LIMIT 200
  `);
  const staleRows = (stale as any).rows || stale || [];
  for (const r of staleRows) {
    findings.push({
      severity: "warn",
      category: "stale_proposal",
      message: `Stale code_proposal #${r.id} ("${String(r.title).slice(0, 60)}") — status=${r.status}, ${Math.round((Date.now() - new Date(r.created_at).getTime()) / 86400000)}d old`,
      detail: { id: r.id, status: r.status },
    });
  }
  if (apply && staleRows.length > 0) {
    const ids = staleRows.map((r: any) => r.id);
    await db.execute(sql`
      UPDATE code_proposals
      SET status = 'archived_stale'
      WHERE id = ANY(${ids}::int[])
    `);
    archivedProposals = staleRows.length;
  }

  // Stuck heartbeat tasks: schedule-aware (architect-fix R71).
  // Only flag if next_run_at IS SET and has passed by >7d AND task never ran.
  // This avoids disabling legitimate quarterly/monthly tasks that haven't been
  // due to fire yet. Falls back to created_at only if next_run_at is null AND
  // the task is unreasonably old (30d) — pure safety net for pre-cron tasks.
  const stuck: any = await db.execute(sql`
    SELECT id, name, created_at, next_run_at
    FROM heartbeat_tasks
    WHERE enabled = true
      AND last_run_at IS NULL
      AND (
        (next_run_at IS NOT NULL AND next_run_at < NOW() - (${HEARTBEAT_STUCK_DAYS} || ' days')::interval)
        OR (next_run_at IS NULL AND created_at < NOW() - INTERVAL '30 days')
      )
    LIMIT 100
  `);
  const stuckRows = (stuck as any).rows || stuck || [];
  for (const r of stuckRows) {
    findings.push({
      severity: "warn",
      category: "stale_heartbeat",
      message: `Heartbeat task #${r.id} "${r.name}" enabled but never ran (${Math.round((Date.now() - new Date(r.created_at).getTime()) / 86400000)}d old)`,
      detail: { id: r.id, name: r.name },
    });
  }
  if (apply && stuckRows.length > 0) {
    const ids = stuckRows.map((r: any) => r.id);
    await db.execute(sql`
      UPDATE heartbeat_tasks SET enabled = false
      WHERE id = ANY(${ids}::int[])
    `);
    archivedHeartbeats = stuckRows.length;
  }

  return { findings, archivedProposals, archivedHeartbeats };
}

// ---------- F. BrowserAction dispatch symmetry ----------

async function scanBrowserActionDispatch(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const file = path.join(ROOT, "server/browser-tool.ts");
  let src = "";
  try { src = await fs.readFile(file, "utf8"); } catch { return findings; }

  // Extract every action label from the BrowserAction union type
  const unionRx = /\{\s*action:\s*"([a-z_]+)"/g;
  const declared = new Set<string>();
  let m;
  while ((m = unionRx.exec(src))) declared.add(m[1]);

  // Extract every `case "xxx":` label inside any switch (we just check presence in file)
  const caseRx = /case\s+"([a-z_]+)"\s*:/g;
  const cases = new Set<string>();
  while ((m = caseRx.exec(src))) cases.add(m[1]);

  for (const action of declared) {
    if (!cases.has(action)) {
      findings.push({
        severity: "high",
        category: "browser_action",
        message: `BrowserAction "${action}" declared in union but no dispatch case found in browser-tool.ts`,
        detail: { action },
      });
    }
  }
  return findings;
}

// ---------- runFullAudit ----------

export async function runFullAudit(opts: { apply?: boolean } = {}): Promise<AuditReport> {
  const apply = opts.apply === true;
  const findings: AuditFinding[] = [];

  const stale = await scanStalePlans().catch(() => []);
  findings.push(...stale);

  const orphans = await scanOrphanModules().catch(() => []);
  findings.push(...orphans);

  const routes = await scanRouteOrphans().catch(() => []);
  findings.push(...routes);

  const browser = await scanBrowserActionDispatch().catch(() => []);
  findings.push(...browser);

  const proposals = await archiveStaleProposals(apply).catch(() => ({ findings: [], archivedProposals: 0, archivedHeartbeats: 0 }));
  findings.push(...proposals.findings);

  const totals: Record<string, number> = {};
  for (const f of findings) totals[f.category] = (totals[f.category] || 0) + 1;
  totals.total = findings.length;
  totals.high = findings.filter(f => f.severity === "high").length;

  return {
    generatedAt: new Date().toISOString(),
    totals,
    findings,
    applied: {
      archivedProposals: proposals.archivedProposals,
      archivedHeartbeats: proposals.archivedHeartbeats,
      deletedFiles: [],
    },
  };
}
