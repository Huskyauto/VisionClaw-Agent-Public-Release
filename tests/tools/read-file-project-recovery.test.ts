/**
 * Regression pins for the read_file project-files recovery fallback
 * (architect-reviewed PASS, 2026-08-09).
 *
 * Incident: a persona saved a project document (project_files row with a
 * local path + Drive URL); the ephemeral prod filesystem lost the local
 * copy and read_file returned "File not found" because its fallback chain
 * only checked disk dirs + file_storage. The fix recovers from the Drive
 * copy via a tenant-scoped project_files→projects join.
 *
 * These are STATIC source pins (repo convention — importing the handler
 * module pulls the db pool and hangs the node:test runner; see
 * .agents/memory/test-exit-hang-loop-holders.md). They pin the security
 * properties the architect required:
 *   1. tenant-scoped join (projects.tenantId gated on ctx.tenantId, -1 fallback)
 *   2. recovery runs AFTER the file_storage lookup (resolution order preserved)
 *   3. downloaded file confined to the workspace uploads root before trust
 *   4. uploads ownership gate bypass is EXACT-path (absPath === projectRecoveredPath),
 *      never a broad prefix exemption
 *   5. unrecoverable registered rows return the guided project-tool error
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.resolve(process.cwd(), "server/tools/domains/files/handlers.ts"),
  "utf-8",
);

// Slice the readFileHandler body so pins don't accidentally match other handlers.
function handlerBody(): string {
  const start = SRC.indexOf("export async function readFileHandler");
  assert.ok(start >= 0, "readFileHandler not found");
  const end = SRC.indexOf("export async function", start + 10);
  return SRC.slice(start, end > 0 ? end : undefined);
}

test("project-files fallback exists and is tenant-scoped through the projects join", () => {
  const body = handlerBody();
  assert.match(body, /innerJoin\(projects, eq\(projects\.id, projectFiles\.projectId\)\)/,
    "recovery query must inner-join projects for tenant scoping");
  assert.match(body, /ctx\.tenantId \? eq\(projects\.tenantId, ctx\.tenantId\) : eq\(projects\.tenantId, -1\)/,
    "tenant filter must gate on ctx.tenantId and fail closed (-1) without tenant context");
});

test("resolution order: file_storage DB lookup comes before project_files recovery", () => {
  const body = handlerBody();
  const fileStorageIdx = body.indexOf("fileStorage.filename, basename");
  const projectFilesIdx = body.indexOf("from(projectFiles)");
  assert.ok(fileStorageIdx > 0, "file_storage lookup missing");
  assert.ok(projectFilesIdx > fileStorageIdx,
    "project_files recovery must run AFTER the file_storage lookup (precedence preserved)");
});

test("Drive-recovered file is confined to the workspace uploads root before being trusted", () => {
  const body = handlerBody();
  // The confinement check must run on the resolved download path before absPath is set.
  assert.match(body, /recovered\.startsWith\(uploadsRoot\)/,
    "downloaded path must be startsWith-confined to the uploads root");
  const confineIdx = body.indexOf("recovered.startsWith(uploadsRoot)");
  const trustIdx = body.indexOf("projectRecoveredPath = recovered");
  assert.ok(confineIdx > 0 && trustIdx > confineIdx,
    "projectRecoveredPath may only be set after the confinement check");
});

test("uploads ownership gate bypass is exact-path equality, not a prefix exemption", () => {
  const body = handlerBody();
  assert.match(body, /absPath !== projectRecoveredPath/,
    "ownership gate must compare the exact recovered path");
  assert.ok(!/project-recovered-\S*\*|startsWith\(["']uploads\/project-recovered/.test(body),
    "no broad project-recovered-* prefix exemption allowed");
});

test("projectRecoveredPath initializes null and is only assigned in the recovery branch", () => {
  const body = handlerBody();
  assert.match(body, /let projectRecoveredPath: string \| null = null;/,
    "marker must start null");
  const assignments = body.match(/projectRecoveredPath = /g) || [];
  // one declaration-adjacent init (the `= null` is part of the declaration regex above,
  // counted here too) plus exactly one assignment in the Drive recovery branch
  assert.ok(assignments.length <= 2,
    `projectRecoveredPath assigned ${assignments.length} times — must only be set in the Drive recovery branch`);
});

test("registered-but-unrecoverable rows return the guided project-tool error", () => {
  const body = handlerBody();
  assert.match(body, /registered on project #\$\{pf\.projectId\}/,
    "unrecoverable rows must name the project");
  assert.match(body, /project \{command:"get"/,
    "error must guide the agent to the project tool");
});

test("final not-found error mentions project files and the note-recovery hint", () => {
  const body = handlerBody();
  assert.match(body, /and project files\)/, "error must state project files were checked");
  assert.match(body, /project NOTE/, "error must hint that memos may be project notes");
});

test("symlink/realpath protections remain downstream of the recovery", () => {
  const body = handlerBody();
  const recoveryIdx = body.indexOf("from(projectFiles)");
  const symlinkIdx = body.indexOf("isSymbolicLink()");
  const realpathIdx = body.indexOf("realpathSync(absPath)");
  assert.ok(symlinkIdx > recoveryIdx && realpathIdx > recoveryIdx,
    "symlink + realpath checks must still apply to recovered paths");
});
