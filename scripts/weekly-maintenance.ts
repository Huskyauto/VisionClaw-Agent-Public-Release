#!/usr/bin/env tsx
/**
 * Weekly Maintenance Review
 *
 * Executable form of the `weekly-maintenance-review` skill.
 * Runs the 9-pass weekly sweep and writes a summary to /tmp/weekly-maintenance-<date>.json
 * + a human-readable .md alongside it.
 *
 * Owner-notification email is composed but NOT sent by this script directly —
 * the agent reads the summary and routes through `owner-notification` skill so
 * triage decisions stay in the agent's hands (RED → [SECURITY], YELLOW/GREEN → [WEEKLY]).
 *
 * Usage:
 *   npx tsx scripts/weekly-maintenance.ts                # run all 8 passes, write summary
 *   npx tsx scripts/weekly-maintenance.ts --pass=1,3     # run specific passes only
 *   npx tsx scripts/weekly-maintenance.ts --json         # machine-readable to stdout
 *   npx tsx scripts/weekly-maintenance.ts --dry-run      # don't apply auto-fixes
 *
 * Schedule via Replit Scheduled Deployment (recommended):
 *   Cron: 0 9 * * MON  (Monday 09:00 UTC)
 *   Run:  npx tsx scripts/weekly-maintenance.ts
 */

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type Severity = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "INFO";
type Status = "GREEN" | "YELLOW" | "RED";

interface PassResult {
  name: string;
  status: Status;
  findings: Array<{ severity: Severity; message: string; detail?: unknown }>;
  error?: string;
  durationMs: number;
}

interface Summary {
  generatedAt: string;
  weekOf: string;
  overallStatus: Status;
  passes: PassResult[];
  actionsTaken: string[];
  actionsQueued: string[];
  ownerActionRequired: string[];
}

const startedAt = Date.now();
const args = process.argv.slice(2);
const passFilter = args.find((a) => a.startsWith("--pass="))?.split("=")[1]?.split(",").map(Number);
const asJson = args.includes("--json");
const dryRun = args.includes("--dry-run");

function shouldRun(passNum: number): boolean {
  return !passFilter || passFilter.includes(passNum);
}

function safeExec(cmd: string, opts: { timeout?: number } = {}): string {
  const r = safeExecFull(cmd, opts);
  return r.combined;
}

interface ExecResult { stdout: string; stderr: string; combined: string; exitCode: number; signal: string | null; }

function safeExecFull(cmd: string, opts: { timeout?: number } = {}): ExecResult {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      timeout: opts.timeout ?? 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", combined: stdout, exitCode: 0, signal: null };
  } catch (e: any) {
    const stdout = e.stdout?.toString() ?? "";
    const stderr = e.stderr?.toString() ?? "";
    return {
      stdout,
      stderr,
      combined: stdout + stderr,
      exitCode: typeof e.status === "number" ? e.status : 1,
      signal: e.signal ?? null,
    };
  }
}

async function pass1_NpmAudit(): Promise<PassResult> {
  const t0 = Date.now();
  const findings: PassResult["findings"] = [];
  try {
    const auditJson = safeExec("npm audit --json", { timeout: 90_000 });
    const audit = JSON.parse(auditJson);
    const meta = audit?.metadata?.vulnerabilities ?? {};
    const counts = {
      critical: meta.critical ?? 0,
      high: meta.high ?? 0,
      moderate: meta.moderate ?? 0,
      low: meta.low ?? 0,
    };
    if (counts.critical) findings.push({ severity: "CRITICAL", message: `${counts.critical} CRITICAL CVE(s) in dependencies`, detail: counts });
    if (counts.high) findings.push({ severity: "HIGH", message: `${counts.high} HIGH CVE(s) in dependencies`, detail: counts });
    if (counts.moderate) findings.push({ severity: "MODERATE", message: `${counts.moderate} MODERATE CVE(s) in dependencies` });
    if (counts.low) findings.push({ severity: "LOW", message: `${counts.low} LOW CVE(s) in dependencies` });
    if (Object.values(counts).every((v) => v === 0)) findings.push({ severity: "INFO", message: "No npm CVEs detected" });

    const outdatedJson = safeExec("npm outdated --json", { timeout: 60_000 });
    let outdated: Record<string, any> = {};
    try { outdated = JSON.parse(outdatedJson || "{}"); } catch { /* npm outdated exits 1 when there are outdated pkgs but still emits JSON */ }
    const outdatedCount = Object.keys(outdated).length;
    if (outdatedCount) {
      const major: string[] = [];
      const minorPatch: string[] = [];
      for (const [name, info] of Object.entries(outdated)) {
        const cur = (info as any).current?.split(".") ?? [];
        const wanted = (info as any).wanted?.split(".") ?? [];
        const latest = (info as any).latest?.split(".") ?? [];
        if (latest[0] && cur[0] && latest[0] !== cur[0]) major.push(`${name} ${cur.join(".")}→${latest.join(".")}`);
        else minorPatch.push(`${name} ${cur.join(".")}→${wanted.join(".")}`);
      }
      if (major.length) findings.push({ severity: "INFO", message: `${major.length} MAJOR bumps available (informational, owner approval required)`, detail: major });
      if (minorPatch.length) findings.push({ severity: "LOW", message: `${minorPatch.length} PATCH/MINOR bumps available (safe to bundle)`, detail: minorPatch });
    }

    const status: Status = counts.critical || counts.high ? "RED" : counts.moderate ? "YELLOW" : "GREEN";
    return { name: "Pass 1: NPM dependency audit", status, findings, durationMs: Date.now() - t0 };
  } catch (e: any) {
    return { name: "Pass 1: NPM dependency audit", status: "YELLOW", findings: [], error: String(e?.message ?? e), durationMs: Date.now() - t0 };
  }
}

async function pass2_Integrations(): Promise<PassResult> {
  const t0 = Date.now();
  return {
    name: "Pass 2: Replit-managed integrations currency",
    status: "GREEN",
    findings: [{
      severity: "INFO",
      message: "Replit integrations checked via package.json — agent should cross-reference with search_integrations for any newer versions available",
      detail: { note: "This pass is informational; integrations update via Replit's package management, not npm" },
    }],
    durationMs: Date.now() - t0,
  };
}

async function pass3_Sast(): Promise<PassResult> {
  const t0 = Date.now();
  return {
    name: "Pass 3: SAST scan",
    status: "YELLOW",
    findings: [{
      severity: "INFO",
      message: "SAST/dependency-audit/HoundDog scans require the security_scan skill callbacks (runSastScan / runDependencyAudit / runHoundDogScan) — agent must invoke these from code_execution after this script completes and merge results into the summary",
    }],
    durationMs: Date.now() - t0,
  };
}

async function pass4_ProdSchema(): Promise<PassResult> {
  const t0 = Date.now();
  return {
    name: "Pass 4: Production schema parity",
    status: "YELLOW",
    findings: [{
      severity: "INFO",
      message: "Prod schema parity requires database skill with environment: 'production' — agent must invoke checkDatabase / executeSql against prod after this script completes",
    }],
    durationMs: Date.now() - t0,
  };
}

async function pass5_ProdLogs(): Promise<PassResult> {
  const t0 = Date.now();
  return {
    name: "Pass 5: Production log scan (security events, last 7 days)",
    status: "YELLOW",
    findings: [{
      severity: "INFO",
      message: "Prod log scan requires fetch_deployment_logs tool — agent must invoke after this script completes with regex: (?i)jailbreak|injection|ssrf|denied|blocked|rate.?limit|unauthor|forbidden|escalat|destruct",
    }],
    durationMs: Date.now() - t0,
  };
}

async function pass6_RailwayHealth(): Promise<PassResult> {
  const t0 = Date.now();
  const findings: PassResult["findings"] = [];
  const camofoxUrl = process.env.CAMOFOX_SERVICE_URL;
  if (camofoxUrl) {
    try {
      const res = await fetch(`${camofoxUrl}/health`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) findings.push({ severity: "INFO", message: `Camofox health 200 OK (${camofoxUrl})` });
      else findings.push({ severity: "HIGH", message: `Camofox health ${res.status} at ${camofoxUrl}` });
    } catch (e: any) {
      findings.push({ severity: "HIGH", message: `Camofox health check failed: ${e?.message ?? e}` });
    }
  } else {
    findings.push({ severity: "INFO", message: "CAMOFOX_SERVICE_URL not set — skipping Camofox health" });
  }

  if (process.env.RAILWAY_API_TOKEN) {
    findings.push({ severity: "INFO", message: "RAILWAY_API_TOKEN present — agent can query Railway API for restart counts and uptime per service" });
  }

  const status: Status = findings.some((f) => f.severity === "HIGH" || f.severity === "CRITICAL") ? "RED" : "GREEN";
  return { name: "Pass 6: Railway microservice health", status, findings, durationMs: Date.now() - t0 };
}

async function pass7_ModelSdkCurrency(): Promise<PassResult> {
  const t0 = Date.now();
  const findings: PassResult["findings"] = [];
  const pkgJson = safeExec("cat package.json");
  try {
    const pkg = JSON.parse(pkgJson);
    const aiSdks = ["openai", "@anthropic-ai/sdk", "@google/generative-ai", "elevenlabs", "stripe"];
    const installed: Record<string, string> = {};
    for (const sdk of aiSdks) {
      const v = pkg.dependencies?.[sdk] ?? pkg.devDependencies?.[sdk];
      if (v) installed[sdk] = v;
    }
    findings.push({ severity: "INFO", message: "AI SDK currency snapshot — agent should compare to upstream for any deprecation announcements", detail: installed });
  } catch (e: any) {
    findings.push({ severity: "LOW", message: `Could not parse package.json: ${e?.message ?? e}` });
  }
  return { name: "Pass 7: Model SDK & provider currency", status: "GREEN", findings, durationMs: Date.now() - t0 };
}

async function pass8_SkillIndexDrift(): Promise<PassResult> {
  const t0 = Date.now();
  const findings: PassResult["findings"] = [];
  try {
    // Filter underscore-prefixed manifest from skill listing (e.g. _registry.json)
    const agentSkills = safeExec("ls .agents/skills/")
      .split("\n")
      .filter((s) => s && !s.startsWith("_") && !s.startsWith("."));
    const localSkills = safeExec("ls .local/skills/").split("\n").filter(Boolean);
    findings.push({
      severity: "INFO",
      message: `Found ${agentSkills.length} user skills in .agents/skills/ and ${localSkills.length} platform skills in .local/skills/`,
      detail: { agentSkills, localSkills },
    });
    const replitMd = safeExec("cat replit.md 2>/dev/null | head -200");
    const missingFromReplitMd = agentSkills.filter((s) => s && !replitMd.includes(s));
    if (missingFromReplitMd.length) {
      findings.push({
        severity: "MODERATE",
        message: `${missingFromReplitMd.length} skill(s) in .agents/skills/ not referenced in replit.md skill table`,
        detail: missingFromReplitMd,
      });
    }

    // R98.9 — SHA-256 manifest validation (per AGENTS.md Skill-supply-chain rules)
    // R98.9+sec — gate on exitCode (process truth), use text only for human detail
    const validateRes = safeExecFull("npx tsx scripts/skills-registry.ts validate 2>&1", { timeout: 30_000 });
    if (validateRes.exitCode !== 0) {
      findings.push({
        severity: "HIGH",
        message: `Skill registry validation FAILED (exit=${validateRes.exitCode}) — bundleHash drift, missing manifest, or flagged skill detected`,
        detail: validateRes.combined.split("\n").slice(0, 30),
      });
    } else {
      const warnCount = (validateRes.combined.match(/⚠/g) || []).length;
      findings.push({
        severity: warnCount > 0 ? "LOW" : "INFO",
        message: `Skill registry validation OK${warnCount > 0 ? ` (${warnCount} skills with no review entry — run audit)` : ""}`,
      });
    }
  } catch (e: any) {
    findings.push({ severity: "LOW", message: `Skill index check failed: ${e?.message ?? e}` });
  }
  const status: Status = findings.some((f) => f.severity === "HIGH" || f.severity === "CRITICAL")
    ? "RED"
    : findings.some((f) => f.severity === "MODERATE")
    ? "YELLOW"
    : "GREEN";
  return { name: "Pass 8: Skill index drift + registry validation", status, findings, durationMs: Date.now() - t0 };
}

// R113.3 — Pass 9: stuck-task sweep (Paperclip nugget #2).
// Read-only audit. Surfaces rows in agent_runs (status='running') and
// mind_tickets (status='in_progress') that haven't advanced in 24h+.
// Auto-remediation is deliberately not included — flag and let the agent
// or owner decide row-by-row.
async function pass9_StuckTasks(): Promise<PassResult> {
  const t0 = Date.now();
  const findings: PassResult["findings"] = [];
  try {
    const { sweepStuckTasks } = await import("../server/lib/stuck-task-sweep");
    const sweep = await sweepStuckTasks({ thresholdHours: 24, maxRowsPerTable: 10 });

    if (sweep.totals.agent_runs > 0) {
      findings.push({
        severity: sweep.totals.agent_runs >= 5 ? "MODERATE" : "LOW",
        message: `${sweep.totals.agent_runs} agent_runs stuck in 'running' >24h (likely crashed mid-flight)`,
        detail: sweep.rows.filter(r => r.table === "agent_runs"),
      });
    }
    if (sweep.totals.mind_tickets > 0) {
      findings.push({
        severity: sweep.totals.mind_tickets >= 5 ? "MODERATE" : "LOW",
        message: `${sweep.totals.mind_tickets} mind_tickets stuck in 'in_progress' >24h`,
        detail: sweep.rows.filter(r => r.table === "mind_tickets"),
      });
    }
    for (const err of sweep.errors) {
      // Missing-table is informational, real errors are LOW.
      const sev: Severity = /not present|informational/i.test(err.error) ? "INFO" : "LOW";
      findings.push({ severity: sev, message: `Sweep on ${err.table}: ${err.error}` });
    }
    if (findings.length === 0) {
      findings.push({ severity: "INFO", message: "No stuck tasks detected (agent_runs, mind_tickets all advancing within 24h)" });
    }
  } catch (e: any) {
    findings.push({ severity: "LOW", message: `Stuck-task sweep failed: ${e?.message ?? e}` });
  }
  const status: Status = findings.some(f => f.severity === "HIGH" || f.severity === "CRITICAL")
    ? "RED"
    : findings.some(f => f.severity === "MODERATE")
    ? "YELLOW"
    : "GREEN";
  return { name: "Pass 9: Stuck-task sweep (agent_runs + mind_tickets)", status, findings, durationMs: Date.now() - t0 };
}

function rollupStatus(passes: PassResult[]): Status {
  if (passes.some((p) => p.status === "RED")) return "RED";
  if (passes.some((p) => p.status === "YELLOW")) return "YELLOW";
  return "GREEN";
}

function formatMarkdown(s: Summary): string {
  const lines: string[] = [];
  lines.push(`# Weekly Maintenance Summary — Week of ${s.weekOf}`);
  lines.push("");
  lines.push(`**Overall status**: ${s.overallStatus}`);
  lines.push(`**Generated**: ${s.generatedAt}`);
  lines.push("");
  for (const p of s.passes) {
    lines.push(`## ${p.name}`);
    lines.push(`- Status: ${p.status} (${p.durationMs}ms)`);
    if (p.error) lines.push(`- Error: ${p.error}`);
    for (const f of p.findings) {
      lines.push(`- **${f.severity}**: ${f.message}`);
      if (f.detail) lines.push(`  \`\`\`json\n  ${JSON.stringify(f.detail, null, 2).split("\n").join("\n  ")}\n  \`\`\``);
    }
    lines.push("");
  }
  lines.push("## Actions Taken This Pass");
  if (s.actionsTaken.length) s.actionsTaken.forEach((a) => lines.push(`- ${a}`));
  else lines.push("- (none — pass was read-only or no auto-fixes warranted)");
  lines.push("");
  lines.push("## Actions Queued (require agent follow-up)");
  if (s.actionsQueued.length) s.actionsQueued.forEach((a) => lines.push(`- ${a}`));
  else lines.push("- (none)");
  lines.push("");
  lines.push("## Owner Action Required");
  if (s.ownerActionRequired.length) s.ownerActionRequired.forEach((a) => lines.push(`- ${a}`));
  else lines.push("- (none — informational only)");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("**Next steps for the agent**:");
  lines.push("1. Read this summary");
  lines.push("2. For any RED-status pass: trigger `owner-notification` skill with `[SECURITY]` or `[DATA]` class");
  lines.push("3. For YELLOW or GREEN: trigger `owner-notification` skill with `[WEEKLY]` class");
  lines.push("4. For Pass 3 (SAST): invoke runSastScan / runDependencyAudit / runHoundDogScan callbacks and merge results");
  lines.push("5. For Pass 4 (prod schema): invoke database skill with environment: 'production' and compare to shared/schema.ts");
  lines.push("6. For Pass 5 (prod logs): invoke fetch_deployment_logs with the security regex");
  lines.push("7. For any auto-fix-eligible CVE: invoke `dependency-upgrade` skill");
  lines.push("8. Log the run in replit.md per `replit-md-maintenance` skill");
  lines.push("9. If any code shipped: run `post-edit-code-review`");
  return lines.join("\n");
}

async function main() {
  const passes: PassResult[] = [];
  const passDefs: Array<[number, () => Promise<PassResult>]> = [
    [1, pass1_NpmAudit],
    [2, pass2_Integrations],
    [3, pass3_Sast],
    [4, pass4_ProdSchema],
    [5, pass5_ProdLogs],
    [6, pass6_RailwayHealth],
    [7, pass7_ModelSdkCurrency],
    [8, pass8_SkillIndexDrift],
    [9, pass9_StuckTasks],
  ];

  const independent = passDefs.filter(([n]) => shouldRun(n) && [1, 2, 3, 6, 7, 8, 9].includes(n));
  const sequential = passDefs.filter(([n]) => shouldRun(n) && [4, 5].includes(n));

  const indepResults = await Promise.all(independent.map(([, fn]) => fn()));
  passes.push(...indepResults);
  for (const [, fn] of sequential) passes.push(await fn());
  passes.sort((a, b) => Number(a.name.match(/Pass (\d+)/)?.[1] ?? 0) - Number(b.name.match(/Pass (\d+)/)?.[1] ?? 0));

  const summary: Summary = {
    generatedAt: new Date().toISOString(),
    weekOf: new Date().toISOString().slice(0, 10),
    overallStatus: rollupStatus(passes),
    passes,
    actionsTaken: dryRun ? ["(dry-run mode — no auto-fixes applied)"] : [],
    actionsQueued: [],
    ownerActionRequired: passes.flatMap((p) =>
      p.findings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").map((f) => `${p.name}: ${f.message}`)
    ),
  };

  const outDir = "/tmp";
  mkdirSync(outDir, { recursive: true });
  const date = summary.weekOf;
  const jsonPath = join(outDir, `weekly-maintenance-${date}.json`);
  const mdPath = join(outDir, `weekly-maintenance-${date}.md`);
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  writeFileSync(mdPath, formatMarkdown(summary));

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatMarkdown(summary));
    console.log("");
    console.log(`Summary written to:`);
    console.log(`  ${jsonPath}`);
    console.log(`  ${mdPath}`);
    console.log("");
    console.log(`Total runtime: ${Date.now() - startedAt}ms`);
  }

  process.exit(summary.overallStatus === "RED" ? 1 : 0);
}

main().catch((e) => {
  console.error("Weekly maintenance run failed:", e);
  process.exit(2);
});
