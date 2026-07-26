import path from "path";
import { logSilentCatch } from "./silent-catch";
import { promises as fs } from "fs";
import { randomBytes } from "crypto";

const ROOT = process.env.TASK_WORKSPACE_ROOT || "data/task-workspaces";
const MAX_ARTIFACT_BYTES = 256 * 1024;
const MAX_FILES_PER_WORKSPACE = 200;
const MAX_WORKSPACES_PER_TENANT = 200;

function sanitizeId(raw: string): string {
  let cleaned = String(raw || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  // Collapse any run of two-or-more dots to a single dot so ".." / "..foo" / "foo.." can never
  // escape the tenant root via path.resolve. Single dots inside an id are still fine.
  cleaned = cleaned.replace(/\.{2,}/g, ".");
  // Strip leading/trailing dots and dashes so neither ".hidden" nor "trailing-" survives.
  cleaned = cleaned.replace(/^[.\-]+|[.\-]+$/g, "");
  if (!cleaned) throw new Error("workspace id cannot be empty after sanitization");
  if (cleaned.length > 80) cleaned = cleaned.slice(0, 80);
  // Final belt-and-suspenders: reject anything that still looks like traversal.
  if (cleaned === "." || cleaned === ".." || cleaned.includes("/") || cleaned.includes("\\")) {
    throw new Error("workspace id resolved to an unsafe value");
  }
  return cleaned;
}

function tenantRoot(tenantId: number): string {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error("tenantId must be a positive integer");
  return path.resolve(process.cwd(), ROOT, String(tenantId));
}

function workspaceDir(tenantId: number, jobId: string): string {
  const root = tenantRoot(tenantId);
  const safe = sanitizeId(jobId);
  const resolved = path.resolve(root, safe);
  // Containment check: resolved path must sit inside the tenant root, never outside.
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    throw new Error("workspace id resolved outside tenant root");
  }
  return resolved;
}

async function writeFileAtomic(file: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    await fs.writeFile(tmp, body, "utf8");
    await fs.rename(tmp, file);
  } catch (e) {
    // Best-effort cleanup of the tmp file if write or rename failed midway.
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

export interface WorkspaceInitInput {
  tenantId: number;
  jobId: string;
  personaId?: number;
  goal: string;
  plan?: string[];
  context?: string;
}

export async function initWorkspace(input: WorkspaceInitInput): Promise<{ jobId: string; dir: string; created: boolean }> {
  const dir = workspaceDir(input.tenantId, input.jobId);
  const safe = sanitizeId(input.jobId);
  const existing = await readIfExists(path.join(dir, "task_plan.md"));
  if (!existing) {
    // Per-tenant workspace cap — only enforced on NEW workspaces so existing ones can always
    // be re-initialized / resumed even if the tenant is at the cap.
    const root = tenantRoot(input.tenantId);
    try {
      const entries = await fs.readdir(root);
      if (entries.length >= MAX_WORKSPACES_PER_TENANT) {
        throw new Error(`tenant ${input.tenantId} has hit MAX_WORKSPACES_PER_TENANT=${MAX_WORKSPACES_PER_TENANT}; finalize and prune old workspaces before opening more`);
      }
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
    }
  }
  await fs.mkdir(path.join(dir, "tool_results"), { recursive: true });
  const planMd = [
    `# Task ${safe}`,
    ``,
    `Created: ${new Date().toISOString()}`,
    `Persona: ${input.personaId ?? "n/a"}`,
    ``,
    `## Goal`,
    String(input.goal || "").trim() || "(no goal supplied)",
    ``,
    `## Plan`,
    ...(Array.isArray(input.plan) && input.plan.length > 0
      ? input.plan.map((s, i) => `${i + 1}. ${String(s).trim()}`)
      : ["(plan not supplied at init)"]),
    ``,
    input.context ? `## Context\n${String(input.context).trim()}\n` : "",
  ].join("\n");
  await writeFileAtomic(path.join(dir, "task_plan.md"), planMd);
  if (!existing) {
    await writeFileAtomic(path.join(dir, "current_status.md"), `# Status\n\nin_progress — initialized at ${new Date().toISOString()}\n`);
    await writeFileAtomic(path.join(dir, "next_steps.md"), `# Next steps\n\n- (populate via workspace_update_status)\n`);
    await writeFileAtomic(path.join(dir, "open_questions.md"), `# Open questions\n\n(none yet)\n`);
  }
  return { jobId: safe, dir, created: !existing };
}

export interface WorkspaceUpdateInput {
  tenantId: number;
  jobId: string;
  status?: "in_progress" | "blocked" | "needs_review" | "complete" | "failed";
  progress_note?: string;
  next_steps?: string[];
  open_questions?: string[];
}

export async function updateWorkspaceStatus(input: WorkspaceUpdateInput): Promise<{ jobId: string; updated: string[] }> {
  const dir = workspaceDir(input.tenantId, input.jobId);
  await fs.mkdir(dir, { recursive: true });
  const updated: string[] = [];
  if (input.status || input.progress_note) {
    const statusPath = path.join(dir, "current_status.md");
    const stamp = new Date().toISOString();
    const line = `- [${stamp}] ${input.status ? `status=${input.status}` : ""} ${input.progress_note ? `— ${input.progress_note.replace(/\n+/g, " ")}` : ""}`.trim();
    // Append-only so two parallel update calls can't lose each other's status lines.
    // Seed the header on first append.
    const exists = (await readIfExists(statusPath)) != null;
    if (!exists) await writeFileAtomic(statusPath, "# Status\n\n");
    await fs.appendFile(statusPath, `${line}\n`, "utf8");
    updated.push("current_status.md");
  }
  if (Array.isArray(input.next_steps)) {
    const body = `# Next steps\n\nUpdated: ${new Date().toISOString()}\n\n${input.next_steps.map((s, i) => `${i + 1}. ${String(s).trim()}`).join("\n")}\n`;
    await writeFileAtomic(path.join(dir, "next_steps.md"), body);
    updated.push("next_steps.md");
  }
  if (Array.isArray(input.open_questions)) {
    const body = input.open_questions.length === 0
      ? `# Open questions\n\n(none)\n`
      : `# Open questions\n\nUpdated: ${new Date().toISOString()}\n\n${input.open_questions.map((q) => `- ${String(q).trim()}`).join("\n")}\n`;
    await writeFileAtomic(path.join(dir, "open_questions.md"), body);
    updated.push("open_questions.md");
  }
  return { jobId: sanitizeId(input.jobId), updated };
}

export interface WorkspaceArtifactInput {
  tenantId: number;
  jobId: string;
  name: string;
  content: string;
}

export async function logArtifact(input: WorkspaceArtifactInput): Promise<{ jobId: string; path: string; bytes: number; truncated: boolean }> {
  const dir = workspaceDir(input.tenantId, input.jobId);
  const artifactsDir = path.join(dir, "tool_results");
  await fs.mkdir(artifactsDir, { recursive: true });
  const existing = await fs.readdir(artifactsDir).catch(() => []);
  if (existing.length >= MAX_FILES_PER_WORKSPACE) {
    throw new Error(`workspace ${input.jobId} has hit MAX_FILES_PER_WORKSPACE=${MAX_FILES_PER_WORKSPACE}; finalize or prune before logging more`);
  }
  const safeName = sanitizeId(input.name).slice(0, 60) || "artifact";
  const stamp = Date.now().toString(36);
  const filename = `${stamp}-${safeName}.md`;
  const raw = String(input.content || "");
  const truncated = raw.length > MAX_ARTIFACT_BYTES;
  const body = truncated ? `${raw.slice(0, MAX_ARTIFACT_BYTES)}\n\n[truncated at ${MAX_ARTIFACT_BYTES} bytes]` : raw;
  const file = path.join(artifactsDir, filename);
  await writeFileAtomic(file, body);
  return { jobId: sanitizeId(input.jobId), path: path.relative(process.cwd(), file), bytes: Buffer.byteLength(body, "utf8"), truncated };
}

export async function readWorkspace(tenantId: number, jobId: string): Promise<{
  exists: boolean;
  jobId: string;
  task_plan?: string;
  current_status?: string;
  next_steps?: string;
  open_questions?: string;
  artifacts?: Array<{ path: string; bytes: number }>;
}> {
  const dir = workspaceDir(tenantId, jobId);
  const safe = sanitizeId(jobId);
  const plan = await readIfExists(path.join(dir, "task_plan.md"));
  if (plan == null) return { exists: false, jobId: safe };
  const [status, next, qs] = await Promise.all([
    readIfExists(path.join(dir, "current_status.md")),
    readIfExists(path.join(dir, "next_steps.md")),
    readIfExists(path.join(dir, "open_questions.md")),
  ]);
  let artifacts: Array<{ path: string; bytes: number }> = [];
  try {
    const entries = await fs.readdir(path.join(dir, "tool_results"));
    artifacts = await Promise.all(
      entries.sort().map(async (e) => {
        const full = path.join(dir, "tool_results", e);
        const stat = await fs.stat(full);
        return { path: path.relative(process.cwd(), full), bytes: stat.size };
      })
    );
  } catch (_silentErr) { logSilentCatch("server/lib/task-workspace.ts", _silentErr); }
  const nonce = randomBytes(8).toString("hex");
  const wrap = (label: string, body: string | null | undefined): string | undefined => {
    if (body == null) return undefined;
    const escaped = String(body).replace(/<<<(BEGIN|END)_WORKSPACE_/g, "<<<$1_WORKSPACE_ESCAPED_");
    return `<<<BEGIN_WORKSPACE_${label}_${nonce}>>>\n${escaped}\n<<<END_WORKSPACE_${label}_${nonce}>>>`;
  };
  return {
    exists: true,
    jobId: safe,
    task_plan: wrap("TASK_PLAN", plan),
    current_status: wrap("CURRENT_STATUS", status),
    next_steps: wrap("NEXT_STEPS", next),
    open_questions: wrap("OPEN_QUESTIONS", qs),
    artifacts,
  };
}

export interface WorkspaceListEntry {
  jobId: string;
  finalized: boolean;
  last_modified: string;
  artifact_count: number;
  status_tail?: string;
}

export async function listWorkspaces(
  tenantId: number,
  opts?: { include_finalized?: boolean; limit?: number }
): Promise<{ tenantId: number; total: number; workspaces: WorkspaceListEntry[] }> {
  const root = tenantRoot(tenantId);
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 50));
  const includeFinal = opts?.include_finalized === true;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch (e: any) {
    if (e?.code === "ENOENT") return { tenantId, total: 0, workspaces: [] };
    throw e;
  }
  const rows: WorkspaceListEntry[] = [];
  for (const e of entries) {
    if (e.startsWith(".")) continue;
    const dir = path.join(root, e);
    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) continue;
      const planExists = (await readIfExists(path.join(dir, "task_plan.md"))) != null;
      if (!planExists) continue;
      const finalized = (await readIfExists(path.join(dir, "final_summary.md"))) != null;
      if (finalized && !includeFinal) continue;
      const status = await readIfExists(path.join(dir, "current_status.md"));
      const tail = status
        ? status.trim().split("\n").filter((l) => l.startsWith("- ")).slice(-1)[0]
        : undefined;
      let artifact_count = 0;
      try {
        const arts = await fs.readdir(path.join(dir, "tool_results"));
        artifact_count = arts.length;
      } catch (_silentErr) { logSilentCatch("server/lib/task-workspace.ts", _silentErr); }
      rows.push({
        jobId: e,
        finalized,
        last_modified: stat.mtime.toISOString(),
        artifact_count,
        status_tail: tail,
      });
    } catch (_silentErr) { logSilentCatch("server/lib/task-workspace.ts", _silentErr); }
  }
  rows.sort((a, b) => (a.last_modified < b.last_modified ? 1 : -1));
  return { tenantId, total: rows.length, workspaces: rows.slice(0, limit) };
}

export interface WorkspaceFinalizeInput {
  tenantId: number;
  jobId: string;
  outcome: "complete" | "failed" | "abandoned";
  summary: string;
  next_session_handoff?: string;
}

export async function finalizeWorkspace(input: WorkspaceFinalizeInput): Promise<{ jobId: string; dir: string }> {
  const dir = workspaceDir(input.tenantId, input.jobId);
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString();
  const body = [
    `# Final summary`,
    ``,
    `Outcome: ${input.outcome}`,
    `Closed: ${stamp}`,
    ``,
    `## Summary`,
    String(input.summary || "").trim() || "(no summary supplied)",
    ``,
    input.next_session_handoff
      ? `## Handoff for next session\n${String(input.next_session_handoff).trim()}\n`
      : "",
  ].join("\n");
  await writeFileAtomic(path.join(dir, "final_summary.md"), body);
  await writeFileAtomic(
    path.join(dir, "current_status.md"),
    ((await readIfExists(path.join(dir, "current_status.md"))) || "# Status\n\n") +
      `\n- [${stamp}] FINALIZED outcome=${input.outcome}\n`
  );
  return { jobId: sanitizeId(input.jobId), dir };
}
