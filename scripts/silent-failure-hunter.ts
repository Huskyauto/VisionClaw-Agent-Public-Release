#!/usr/bin/env tsx
/**
 * Silent-Failure Hunter — scans server/ and shared/ for known classes of
 * silent failures before they make it to architect review.
 *
 * Inspired by IJFW's "permanent specialist swarm" pattern, scoped to the
 * exact landmines that bit us in R74:
 *
 *   - R74.A — `tenantId ?? 1` defaulted unresolved-tenant emails to admin
 *             tenant. Cross-tenant data leak.
 *   - R74.B — Stripe Connect routes used `?? 1` for the same reason. Dead
 *             code today, fail-open landmine for any future regression.
 *   - R74.5 — `buildSystemPrompt(tenantId: number = 1)` — same shape, in
 *             a function signature default.
 *   - R74 H2 — Stripe webhook handlers wrapped everything in try/catch
 *              that just logged. Lost subscription events silently.
 *
 * This script catches all four of those shapes proactively and exits 1 if
 * any HIGH-severity finding lands, so it can be wired into CI as a hard
 * gate when the false-positive rate is comfortable.
 *
 * Usage:
 *   npx tsx scripts/silent-failure-hunter.ts          # human-readable
 *   npx tsx scripts/silent-failure-hunter.ts --json   # machine-readable
 *
 * Exit code:
 *   0 — no HIGH-severity findings
 *   1 — at least one HIGH-severity finding
 */

import fs from 'fs';
import path from 'path';

interface Finding {
  file: string;
  line: number;
  severity: 'high' | 'medium' | 'low';
  pattern: string;
  snippet: string;
  why: string;
}

interface PatternDef {
  name: string;
  re: RegExp;
  severity: Finding['severity'];
  why: string;
  /** If the matched line ALSO matches this regex, suppress the finding. */
  excludeLine?: RegExp;
}

const ROOT = process.cwd();
const SCAN_DIRS = ['server', 'shared'];
const EXCLUDE_DIR_NAMES = new Set([
  'node_modules', '.git', 'dist', 'build', 'tests', '__tests__', 'coverage',
]);

const PATTERNS: PatternDef[] = [
  {
    name: 'tenant-default-via-??',
    re: /\b(tenantId|tenant_id|userId|user_id|orgId|org_id)\s*\?\?\s*\d+\b/g,
    severity: 'high',
    why: 'Fail-open default to a literal — R74.A class bug. Use the named ADMIN_TENANT_ID constant, or fail-closed (return 401 / throw).',
    // Skip explicit-named-constant fixes, comment lines documenting prior fixes, and TODO markers.
    excludeLine: /ADMIN_TENANT_ID|TODO|FIXME|^\s*(\/\/|\*)/,
  },
  {
    name: 'tenant-default-via-||',
    re: /\b(tenantId|tenant_id|userId|user_id|orgId|org_id)\s*\|\|\s*\d+\b/g,
    severity: 'high',
    why: 'Same as ?? form. Fail-open landmine.',
    excludeLine: /ADMIN_TENANT_ID|TODO|FIXME|^\s*(\/\/|\*)/,
  },
  {
    name: 'tenant-default-param',
    re: /\b(tenantId|tenant_id|userId|user_id|orgId)\s*:\s*number\s*=\s*\d+\b/g,
    severity: 'high',
    why: 'Default-value of literal in a function signature — R74.5 class bug. Make the param required; force callers to pass tenantId explicitly.',
    // R74.13f: skip comment lines (// or *) and TODO markers — last
    // session this rule was missing here even though patterns 1 & 2
    // had it. Found by self-discovery: my own R74.13f comment line
    // explaining a fix to this very pattern got flagged as a HIGH.
    excludeLine: /TODO|FIXME|^\s*(\/\/|\*)/,
  },
  {
    name: 'empty-catch',
    re: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    severity: 'medium',
    why: 'Empty catch block swallows every error silently. Either log + rethrow, or document why the swallow is intentional.',
  },
  {
    name: 'log-and-swallow-catch',
    re: /catch\s*\([^)]*\)\s*\{\s*console\.(error|warn|log)\s*\([^)]*\)\s*;?\s*\}/g,
    severity: 'medium',
    why: 'Catch logs but does not rethrow or surface the error. R74 H2 (Stripe webhooks) class bug — caller thinks success, downstream silently broken.',
  },
  {
    name: 'literal-fallback-for-secret',
    re: /process\.env\.(SESSION_SECRET|JWT_SECRET|API_KEY|DATABASE_URL|STRIPE_SECRET|OPENAI_API_KEY|ANTHROPIC_API_KEY|XAI_API_KEY|GOOGLE_OAUTH_CLIENT_SECRET)\s*\|\|\s*['"][^'"]+['"]/g,
    severity: 'high',
    why: 'Hard-coded fallback for a secret. In production this is either a leaked dev secret or fail-open behavior. Should fail-closed at startup.',
  },
];

function walk(dirRel: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, dirRel);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
    const rel = path.join(dirRel, entry.name);
    if (entry.isDirectory()) {
      walk(rel, out);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      // Skip type declaration and test files
      if (/\.(d|test|spec)\.tsx?$/.test(entry.name)) continue;
      out.push(rel);
    }
  }
  return out;
}

function scanFile(file: string): Finding[] {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const lines = text.split('\n');
  const findings: Finding[] = [];

  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text)) !== null) {
      const before = text.slice(0, m.index);
      const lineNum = before.split('\n').length;
      const lineText = lines[lineNum - 1] || '';
      const snippet = lineText.trim();
      if (p.excludeLine && p.excludeLine.test(lineText)) continue;
      findings.push({
        file,
        line: lineNum,
        severity: p.severity,
        pattern: p.name,
        snippet: snippet.length > 140 ? snippet.slice(0, 140) + '…' : snippet,
        why: p.why,
      });
    }
  }
  return findings;
}

function main(): void {
  const json = process.argv.includes('--json');
  const allFiles: string[] = [];
  for (const d of SCAN_DIRS) walk(d, allFiles);

  const findings: Finding[] = [];
  for (const f of allFiles) findings.push(...scanFile(f));

  if (json) {
    console.log(JSON.stringify({ scanned: allFiles.length, findings }, null, 2));
  } else {
    const high = findings.filter((f) => f.severity === 'high');
    const medium = findings.filter((f) => f.severity === 'medium');
    const low = findings.filter((f) => f.severity === 'low');

    console.log('');
    console.log('='.repeat(78));
    console.log('  SILENT-FAILURE HUNTER  —  scan report');
    console.log('='.repeat(78));
    console.log(`  Scanned: ${allFiles.length} TS files in ${SCAN_DIRS.join(', ')}`);
    console.log(`  Findings: HIGH=${high.length}  MEDIUM=${medium.length}  LOW=${low.length}`);
    console.log('='.repeat(78));
    console.log('');

    for (const f of [...high, ...medium, ...low]) {
      const tag =
        f.severity === 'high'   ? '[HIGH]   ' :
        f.severity === 'medium' ? '[MEDIUM] ' :
                                  '[LOW]    ';
      console.log(`${tag} ${f.file}:${f.line}  (${f.pattern})`);
      console.log(`          ${f.snippet}`);
      console.log(`          -> ${f.why}`);
      console.log('');
    }

    if (findings.length === 0) {
      console.log('  OK  No silent-failure patterns detected.');
      console.log('');
    }
  }

  process.exit(findings.filter((f) => f.severity === 'high').length > 0 ? 1 : 0);
}

main();
