/**
 * Tools-layer-split S5 — files-domain migrated handlers.
 *
 * Selection per plan.md: `read_output_blob`, `code_slice`, `scan_file`,
 * `list_uploads`, and `read_file` migrated in S5 — their trust needs fit the
 * existing ToolContext (`read_file` used `params._tenantId` only, now
 * `ctx.tenantId`; the others use no trust signals). `google_drive` migrates
 * in a later slice once the trust seam grew `ctx.projectId`: its legacy
 * `params._projectId` (runtime project context) read becomes `ctx.projectId`
 * and `params._tenantId` becomes `ctx.tenantId`; the LLM-supplied
 * `params.projectId` (no underscore — survives the strip) is still read for
 * the cross-project mismatch refusal, and the non-authoritative telemetry
 * hint `params._projectDriveFolderId` is a passthrough (deliberately NOT a
 * TRUST_SIGNAL_KEY, so it survives the strip verbatim — media/agentic
 * precedent). `write_file` migrated once the trust seam grew
 * `ctx.allowedPaths` (R125+106 infra): its platform-stamped `_allowedPaths`
 * freeze-guard channel becomes `ctx.allowedPaths`, `_tenantId`/`_conversationId`
 * become `ctx.tenantId`/`ctx.conversationId`, and the non-authoritative
 * `_projectDriveFolderId` telemetry hint is a passthrough (deliberately NOT a
 * TRUST_SIGNAL_KEY — survives the strip verbatim, same as google_drive).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change). The `scanFile` helper and its two
 * path-jail helpers moved here with the arm — the scan_file arm was their
 * only consumer in the monolith.
 *
 * App-module imports are DYNAMIC (call-time), mirroring the legacy arms'
 * `await import(...)` pattern and preserving the package's acyclic static
 * import graph. Node builtins (`path`, `os`) are static — they cannot
 * participate in an app-module cycle.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import path from "node:path";
import os from "node:os";
import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  readOutputBlobDefinition,
  codeSliceDefinition,
  scanFileDefinition,
  readFileDefinition,
  writeFileDefinition,
  listUploadsDefinition,
  googleDriveDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// scan_file helpers (moved with the arm from server/tools.ts — Round 19.2)
// ---------------------------------------------------------------------------

// Round 19.2: agent-callable scan_file is JAILED to a small allowlist of roots.
// Without this jail, an agent (or a prompt-injected agent) can probe arbitrary
// host paths (existence + size + content type), which is a recon primitive
// against /etc, .env, other tenants' uploads, etc. Allowed roots are computed
// at call time from cwd so they work in dev and prod.
function getScanAllowedRoots(): string[] {
  // R76 review fix (CRITICAL) — was using bare require() under ESM, which
  // throws "require is not defined" and silent-fails through the caller's
  // try/catch, leaving scan_file's path jail effectively bypassed. Use the
  // top-level static imports instead.
  const cwd = process.cwd();
  return [
    path.resolve(cwd, "uploads"),
    path.resolve(cwd, "attached_assets"),
    path.resolve(cwd, "quarantine"),
    path.resolve(cwd, "tmp"),
    path.resolve(os.tmpdir()), // OS tmp — multer's default destination
  ];
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function scanFile(filePath: string, claimedMime?: string) {
  if (!filePath || typeof filePath !== "string") {
    return { error: "filePath is required (absolute or relative path to a file on disk)" };
  }
  try {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    // Resolve relative paths against the workspace root for safety
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    // Round 19.2: enforce allowlist — reject anything outside upload/quarantine/tmp dirs.
    const allowedRoots = getScanAllowedRoots();
    const insideAllowedRoot = allowedRoots.some((root) => isPathInsideRoot(resolved, root));
    if (!insideAllowedRoot) {
      return {
        error: `scan_file is restricted to upload, attached_assets, quarantine, and tmp directories. Path '${filePath}' is outside the allowed roots.`,
        allowedRoots: allowedRoots.map((r) => path.relative(process.cwd(), r) || r),
      };
    }
    try {
      await fs.access(resolved);
    } catch {
      return { error: `File not found: ${filePath}` };
    }
    // R94 SECURITY — reject symlinks and resolve realpath to prevent symlink
    // pivot bypassing the allowed-roots check (parity with read_file/write_file).
    try {
      const lstat = await fs.lstat(resolved);
      if (lstat.isSymbolicLink()) {
        return { error: `Symlink path rejected (security): ${filePath}` };
      }
    } catch {
      return { error: `Stat failed: ${filePath}` };
    }
    const realResolved = await fs.realpath(resolved);
    if (realResolved !== resolved) {
      const stillInside = allowedRoots.some((root) => isPathInsideRoot(realResolved, root));
      if (!stillInside) {
        return { error: `Realpath escapes allowed roots (security): ${filePath} → ${realResolved}` };
      }
    }
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return { error: `Not a regular file: ${filePath}` };
    }
    const { detectFromFile, validateUpload } = await import("../../../file-detector");
    const detected = await detectFromFile(resolved);
    if (!detected) {
      return { error: "Magika detection unavailable (model not loaded or file unreadable)", filePath: resolved };
    }
    let verdict: any = null;
    if (claimedMime) {
      const v = await validateUpload(resolved, claimedMime, path.basename(resolved));
      verdict = {
        ok: v.ok,
        highRisk: v.highRisk || false,
        reason: v.reason || null,
      };
    }
    return {
      filePath: resolved,
      sizeBytes: stat.size,
      detected: {
        label: detected.label,
        score: detected.score,
        confidencePercent: Math.round(detected.score * 100),
        isText: detected.isText,
      },
      claimedMime: claimedMime || null,
      verdict,
      summary: `Detected '${detected.label}' with ${Math.round(detected.score * 100)}% confidence${claimedMime ? ` (claimed: ${claimedMime}, verdict: ${verdict?.ok ? "OK" : "BLOCKED"})` : ""}`,
    };
  } catch (err) {
    return { error: `scan_file failed: ${(err as Error).message?.slice(0, 200)}` };
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function readOutputBlobHandler(params: Record<string, any>): Promise<ToolResult> {
  // R117 — token-saver: partial read (slice / grep / head) of a sandbox
  // blob written by wrapLargeResult. Replaces having to call run_command
  // get_output for the whole file.
  try {
    const { readBlob } = await import("../../../lib/blob-reader");
    const label = String(params.label || "").trim();
    if (!label) return { error: "label is required" };
    let sliceLines: [number, number] | undefined = undefined;
    if (Array.isArray(params.slice_lines) && params.slice_lines.length === 2) {
      sliceLines = [Number(params.slice_lines[0]), Number(params.slice_lines[1])];
    }
    const r = readBlob({
      label,
      sliceLines,
      grep: params.grep ? String(params.grep) : undefined,
      grepFlags: params.grep_flags ? String(params.grep_flags) : undefined,
      maxBytes: params.max_bytes ? Number(params.max_bytes) : undefined,
      contextLines: params.context_lines ? Number(params.context_lines) : undefined,
    });
    return r;
  } catch (e: any) {
    return { error: `read_output_blob failed: ${String(e?.message || e).slice(0, 200)}` };
  }
}

export async function codeSliceHandler(params: Record<string, any>): Promise<ToolResult> {
  // R117 — token-saver: extract only named symbols (or line ranges) from
  // a file instead of reading the whole thing. AST-based for TS/JS via
  // the TypeScript compiler, regex-based for py/go/rust/etc.
  try {
    const { sliceFile } = await import("../../../lib/code-symbol-slicer");
    const filePath = String(params.path || params.filePath || "").trim();
    if (!filePath) return { error: "path is required" };
    const symbols = Array.isArray(params.symbols)
      ? params.symbols.map((s: any) => String(s)).filter(Boolean)
      : undefined;
    let lineRanges: Array<[number, number]> | undefined = undefined;
    if (Array.isArray(params.line_ranges)) {
      lineRanges = params.line_ranges
        .filter((r: any) => Array.isArray(r) && r.length === 2)
        .map((r: any) => [Number(r[0]), Number(r[1])] as [number, number]);
    }
    const r = await sliceFile({
      filePath,
      symbols,
      lineRanges,
      contextLines: params.context_lines ? Number(params.context_lines) : 0,
      exportedOnly: Boolean(params.exported_only),
    });
    return r;
  } catch (e: any) {
    return { error: `code_slice failed: ${String(e?.message || e).slice(0, 200)}` };
  }
}

export async function scanFileHandler(params: Record<string, any>): Promise<ToolResult> {
  return scanFile(params.filePath, params.claimedMime);
}

export async function listUploadsHandler(params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
  const fs = await import("node:fs");
  const { logSilentCatch } = await import("../../../lib/silent-catch");
  const { fileStorage } = await import("@shared/schema");
  const uploadsDir = path.join(process.cwd(), "uploads");
  // Each entry carries an explicit `source` tag — path/url mapping is derived
  // from the source, NEVER from a filesystem-existence check (a tenant upload
  // whose name collides with a data/ file must not flip to a data/ path —
  // post-edit-code-review finding, 2026-07-07).
  const dbFiles: { filename: string; originalName: string; mimeType: string; size: number; source: "uploads" | "data" }[] = [];
  try {
    const { db } = await import("../../../db");
    const { eq } = await import("drizzle-orm");
    // Tenant isolation: enumerate file_storage rows ONLY for the caller's
    // tenant. Fail CLOSED — a missing/non-numeric tenant context skips the DB
    // query entirely rather than leaking every tenant's filenames/metadata.
    if (typeof ctx.tenantId === "number") {
      const all = await db.select({
        filename: fileStorage.filename,
        originalName: fileStorage.originalName,
        mimeType: fileStorage.mimeType,
        size: fileStorage.size,
      }).from(fileStorage).where(eq(fileStorage.tenantId, ctx.tenantId));
      dbFiles.push(...all.map(f => ({ ...f, source: "uploads" as const })));
    }
  } catch (_silentErr) { logSilentCatch("server/tools/domains/files/handlers.ts", _silentErr); }
  const localFiles: string[] = [];
  try {
    // Admin-tenant only: uploads/ is a SHARED flat directory across all
    // tenants — enumerating raw fs entries for a non-admin tenant discloses
    // every other tenant's upload filenames (post-edit-code-review HIGH,
    // 2026-07-08). Non-admin tenants see ONLY their tenant-scoped
    // file_storage rows from the DB query above. Fail closed.
    if (ctx.tenantId === 1 && fs.existsSync(uploadsDir)) {
      localFiles.push(...fs.readdirSync(uploadsDir));
    }
  } catch (_silentErr) { logSilentCatch("server/tools/domains/files/handlers.ts", _silentErr); }
  const dataDir = path.join(process.cwd(), "data");
  try {
    // Admin-tenant only: data/ holds internal operational artifacts; enumerating
    // it for non-admin tenants is a cross-tenant information-disclosure path
    // (post-edit-code-review finding, 2026-07-07). Fail closed for tenant !== 1.
    if (ctx.tenantId === 1 && fs.existsSync(dataDir)) {
      const dataFiles = fs.readdirSync(dataDir).filter((f: string) => !f.startsWith("."));
      for (const df of dataFiles) {
        const dfPath = path.join(dataDir, df);
        const dfStat = fs.statSync(dfPath);
        if (!dfStat.isDirectory()) {
          const ext = path.extname(df).toLowerCase();
          const mimeMap: Record<string, string> = { ".txt": "text/plain", ".json": "application/json", ".csv": "text/csv", ".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf", ".svg": "image/svg+xml" };
          dbFiles.push({ filename: df, originalName: df, mimeType: mimeMap[ext] || "application/octet-stream", size: dfStat.size, source: "data" });
        }
      }
    }
  } catch (_silentErr) { logSilentCatch("server/tools/domains/files/handlers.ts", _silentErr); }
  const seen = new Set(dbFiles.map(f => f.filename));
  for (const lf of localFiles) {
    if (!seen.has(lf)) {
      const stat = fs.statSync(path.join(uploadsDir, lf));
      const ext = path.extname(lf).toLowerCase();
      const mimeMap: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf", ".svg": "image/svg+xml" };
      dbFiles.push({ filename: lf, originalName: lf, mimeType: mimeMap[ext] || "application/octet-stream", size: stat.size, source: "uploads" });
    }
  }
  let results = dbFiles;
  if (params.type) {
    results = results.filter(f => f.mimeType.startsWith(params.type));
  }
  return {
    files: results.map(f => {
      const isDataFile = f.source === "data";
      return {
        filename: f.filename,
        originalName: f.originalName,
        type: f.mimeType,
        size: f.size,
        path: isDataFile ? `data/${f.filename}` : `uploads/${f.filename}`,
        url: isDataFile ? `data/${f.filename}` : `/uploads/${f.filename}`,
      };
    }),
    count: results.length,
  };
}

export async function readFileHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { logSilentCatch } = await import("../../../lib/silent-catch");
  const filePath = params.path;
  if (!filePath || typeof filePath !== "string") return { error: "path is required" };
  const safeParts = filePath.replace(/\.\./g, "").replace(/^\/+/, "");
  // Symmetry with write_file BLOCKED_PATTERNS — a prompt-injected agent
  // could otherwise read secrets / oauth tokens / git history. .env first
  // because it is the highest-value exfil target.
  const READ_BLOCKED_PATTERNS = [
    ".env",
    "node_modules/",
    ".git/",
    ".replit",
    "scripts/git-auto-push",      // contains GH PAT references
    ".local/mcp-key.txt",          // MCP server admin key
    "id_rsa", "id_ed25519",        // SSH keys if ever present
    ".ssh/",
    "drizzle/.snapshot",            // not secret but noisy + recon
  ];
  const safeLower = safeParts.toLowerCase();
  for (const blocked of READ_BLOCKED_PATTERNS) {
    if (safeLower.includes(blocked.toLowerCase())) {
      return { error: `Access denied: '${blocked}' is on the read blocklist (secrets / credentials / VCS internals).` };
    }
  }
  // Block bare dotfiles at workspace root that aren't explicitly safe.
  const basenameLower = path.basename(safeLower);
  const SAFE_DOTFILES = new Set([".cursorrules", ".gitignore", ".prettierrc", ".eslintrc"]);
  if (basenameLower.startsWith(".") && !SAFE_DOTFILES.has(basenameLower) && !safeLower.includes("/")) {
    return { error: `Access denied: '${basenameLower}' is a top-level dotfile not on the safe-read list.` };
  }
  let absPath = path.resolve("/home/runner/workspace", safeParts);
  if (!absPath.startsWith("/home/runner/workspace")) return { error: "Access denied: path outside workspace" };
  if (!fs.existsSync(absPath)) {
    const basename = path.basename(safeParts);
    const searchDirs = ["attached_assets", "uploads", "data", "client/public", "/tmp/uploads"];
    let found = false;
    for (const dir of searchDirs) {
      const candidate = dir.startsWith("/") ? path.join(dir, basename) : path.resolve("/home/runner/workspace", dir, basename);
      if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
        absPath = candidate;
        found = true;
        break;
      }
    }
    if (!found) {
      try {
        const { db } = await import("../../../db");
        const { fileStorage } = await import("@shared/schema");
        const { eq, desc, or, and } = await import("drizzle-orm");
        const dbRow = await db.select({
          data: fileStorage.data,
          originalName: fileStorage.originalName,
          size: fileStorage.size,
          storageKey: fileStorage.storageKey,
          mimeType: fileStorage.mimeType,
        })
          .from(fileStorage)
          .where(and(or(eq(fileStorage.filename, basename), eq(fileStorage.originalName, basename)), ctx.tenantId ? eq(fileStorage.tenantId, ctx.tenantId) : eq(fileStorage.tenantId, -1)))
          .orderBy(desc(fileStorage.createdAt))
          .limit(1);
        if (dbRow.length > 0) {
          let dbContent = dbRow[0].data;
          if ((!dbContent || dbContent === "") && dbRow[0].storageKey) {
            try {
              const { downloadTenantFile } = await import("../../../object-storage");
              const tenantId = ctx.tenantId;
              if (!tenantId) throw new Error("No tenant context for file download");
              const buf = await downloadTenantFile(tenantId, dbRow[0].storageKey);
              dbContent = buf.toString("utf-8");
            } catch (_silentErr) { logSilentCatch("server/tools/domains/files/handlers.ts", _silentErr); }
          }
          if (dbContent && dbContent !== "") {
            const isBinary = dbRow[0].mimeType && !dbRow[0].mimeType.startsWith("text/") && !dbRow[0].mimeType.includes("json") && !dbRow[0].mimeType.includes("xml");
            if (!isBinary) {
              if (/^[A-Za-z0-9+/=\r\n]+$/.test(dbContent.slice(0, 200)) && dbContent.length > 100) {
                try {
                  const decoded = Buffer.from(dbContent, "base64").toString("utf-8");
                  if (decoded.length > 0 && !decoded.includes("\ufffd")) dbContent = decoded;
                } catch (_silentErr) { logSilentCatch("server/tools/domains/files/handlers.ts", _silentErr); }
              }
              const dbLines = dbContent.split("\n");
              const maxLines = params.maxLines || 200;
              const truncated = dbLines.length > maxLines;
              return {
                success: true,
                path: safeParts,
                source: "database",
                content: truncated ? dbLines.slice(0, maxLines).join("\n") : dbContent,
                lines: dbLines.length,
                truncated,
                size: dbRow[0].size || dbContent.length,
              };
            }
          }
        }
      } catch (_silentErr) { logSilentCatch("server/tools/domains/files/handlers.ts", _silentErr); }
      return { error: `File not found: ${safeParts} (also checked attached_assets/, uploads/, data/, and database). Try read_file with path "data/VisionClaw-Comprehensive-Features.txt" for the latest platform features document.` };
    }
  }
  // TENANT ISOLATION — uploads/ is a SHARED flat directory across all
  // tenants (post-edit-code-review HIGH, 2026-07-08). A non-admin tenant may
  // only read an upload it OWNS (a tenant-scoped file_storage row matching
  // the basename). Fail closed: no ownership row, or a DB error during the
  // check, denies the read. Admin tenant (1) retains full visibility for
  // operational work (deliveries, cron artifacts).
  const uploadsRoots = [path.resolve("/home/runner/workspace", "uploads") + path.sep, "/tmp/uploads" + path.sep];
  if (uploadsRoots.some(root => absPath.startsWith(root)) && ctx.tenantId !== 1) {
    try {
      if (typeof ctx.tenantId !== "number") {
        return { error: "Access denied: uploaded files require tenant context" };
      }
      const { db } = await import("../../../db");
      const { fileStorage } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const uploadBasename = path.basename(absPath);
      // Authorize by the canonical stored filename ONLY. originalName is
      // user-controlled metadata — a tenant could upload a file whose
      // originalName matches another tenant's on-disk basename and satisfy
      // the ownership check (architect second-pass finding, 2026-07-08).
      const owned = await db.select({ id: fileStorage.id })
        .from(fileStorage)
        .where(and(
          eq(fileStorage.filename, uploadBasename),
          eq(fileStorage.tenantId, ctx.tenantId),
        ))
        .limit(1);
      if (owned.length === 0) {
        return { error: `Access denied: '${uploadBasename}' is not a file owned by your tenant.` };
      }
    } catch (e: any) {
      logSilentCatch("server/tools/domains/files/handlers.ts", e);
      return { error: "Access denied: could not verify tenant ownership of the uploaded file" };
    }
  }
  // R94 SECURITY — symlink rejection for read_file (a symlink inside
  // workspace can point to /etc/passwd, ~/.ssh/id_rsa, etc., bypassing
  // the workspace-prefix and dotfile checks above).
  try {
    const lst = fs.lstatSync(absPath);
    if (lst.isSymbolicLink()) return { error: "Access denied: target is a symlink" };
    const realPath = fs.realpathSync(absPath);
    // /tmp/uploads is a legitimate search root (multer temp uploads) — it is
    // covered by the same symlink rejection above and the tenant-ownership
    // gate, so allow it alongside the workspace prefix (architect
    // second-pass consistency finding, 2026-07-08).
    if (!realPath.startsWith("/home/runner/workspace") && !realPath.startsWith("/tmp/uploads" + path.sep)) {
      return { error: "Access denied: realpath escapes workspace" };
    }
  } catch (_silentErr) { logSilentCatch("server/tools/domains/files/handlers.ts", _silentErr); }
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) return { error: "Path is a directory, not a file" };
  const ext = path.extname(absPath).toLowerCase();
  if (ext === ".pdf") {
    return { error: `'${path.basename(absPath)}' is a PDF — use the analyze_pdf tool with this path to extract text. read_file only handles text files.` };
  }
  const BINARY_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp3", ".mp4", ".wav", ".webm", ".zip", ".docx", ".xlsx", ".pptx"]);
  if (BINARY_EXTS.has(ext)) {
    return { error: `'${path.basename(absPath)}' is a binary file (${ext}). read_file only handles text files. Use analyze_pdf for PDFs or describe the image to the user.` };
  }
  const MAX_READ_BYTES = 5 * 1024 * 1024;
  if (stat.size > MAX_READ_BYTES) return { error: `File too large (${Math.round(stat.size / 1024)}KB). Max ${MAX_READ_BYTES / 1024}KB.` };
  const content = fs.readFileSync(absPath, "utf-8");
  const lines = content.split("\n");
  const maxLines = params.maxLines || 200;
  const truncated = lines.length > maxLines;
  return {
    success: true,
    path: path.relative("/home/runner/workspace", absPath),
    content: truncated ? lines.slice(0, maxLines).join("\n") : content,
    lines: lines.length,
    truncated,
    size: stat.size,
  };
}

export async function googleDriveHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // App-module dep pulled at call time (acyclic static graph — plan.md S2).
  const gd = await import("../../../google-drive");
  // Admin-scope artifact marker. Files/folders matching this regex are
  // produced by admin-only cron jobs (e.g. scripts/nightly-memory-backup.ts
  // — a cross-tenant memory_entries aggregate) and MUST NOT be exposed
  // through the agent-facing google_drive tool surface. Naming convention:
  // double-underscore prefix + "admin" or "VisionClaw-Admin" segment.
  // (Architect HIGH finding 2026-05-20: cross-tenant data leak via Drive.)
  const ADMIN_DRIVE_ARTIFACT_RE = /^__(admin[-_]|VisionClaw-Admin[-_])/i;
  // R98 hardening: resolve project context from the TRUSTED ToolContext
  // (`ctx.projectId`), never from LLM-controlled `params.projectId`. If the
  // LLM tries to override the runtime context with a different projectId,
  // hard-fail — that's a cross-tenant write attempt. (When no runtime project
  // is bound, the LLM value is allowed but `ensureProjectFolder` +
  // `searchDriveFiles` still enforce tenant ownership downstream.)
  const runtimeProjectId: number | undefined = ctx.projectId;
  const llmProjectId: number | undefined = params.projectId;
  let effectiveProjectId: number | undefined = runtimeProjectId;
  if (llmProjectId != null && runtimeProjectId != null && llmProjectId !== runtimeProjectId) {
    return { error: `google_drive: LLM-supplied projectId (${llmProjectId}) does not match runtime project context (${runtimeProjectId}). Cross-project writes are blocked. Switch the active project before calling this tool.` };
  }
  if (effectiveProjectId == null && llmProjectId != null) {
    effectiveProjectId = llmProjectId; // no runtime context bound; tenant check still enforced downstream
  }

  switch (params.command) {
    case "upload": {
      if (!params.filePath && !params.fileData) return { error: "filePath or fileData is required for upload" };
      const fileName = params.fileName || (params.filePath ? path.basename(params.filePath) : "file");
      const shareResult = await gd.uploadAndShare({
        filePath: params.filePath,
        fileData: params.fileData ? Buffer.from(params.fileData, "base64") : undefined,
        fileName,
        mimeType: params.mimeType,
        description: params.description,
        customerName: params.customerName,
        folderLabel: params.folderLabel,
        parentFolderId: params._projectDriveFolderId || undefined,
        // R98: pass project/tenant context so file lands in named project
        // folder (e.g. "[Your Product]") and project_files row is auto-written.
        projectId: effectiveProjectId,
        tenantId: ctx.tenantId,
      });
      if (!shareResult.success) return { error: shareResult.error };
      return {
        success: true,
        fileId: shareResult.fileId,
        shareableLink: shareResult.viewUrl,
        directDownloadLink: shareResult.downloadUrl,
        imageUrl: shareResult.imageUrl,
        folderLink: shareResult.folderUrl,
        projectFilesRegistered: (shareResult as any).projectFilesRegistered,
        projectFilesWarning: (shareResult as any).projectFilesWarning,
      };
    }
    case "search": {
      if (!params.query && !params.namePattern) return { error: "query or namePattern is required for search" };
      if (!ctx.tenantId) return { error: "google_drive search requires tenant context (cross-tenant searches blocked)" };
      return gd.searchDriveFiles({
        namePattern: params.namePattern || params.query,
        tenantId: ctx.tenantId,
        projectId: effectiveProjectId,
        mimeType: params.mimeType,
        limit: params.maxResults || params.limit,
      });
    }
    case "list": {
      // Admin-scope guard: filter out cross-tenant admin aggregates
      // (nightly memory backups, future global dumps). Defense-in-depth —
      // these files carry the __admin- prefix and live under
      // __VisionClaw-Admin-Backups__/. Even if the underlying Drive listing
      // returns them, no agent-tool surface should expose them to a
      // persona running on any tenant. (Architect HIGH finding 2026-05-20.)
      const result: any = await gd.listDriveFiles({ query: params.query });
      if (result && Array.isArray(result.files)) {
        const before = result.files.length;
        result.files = result.files.filter((f: any) => !ADMIN_DRIVE_ARTIFACT_RE.test(String(f?.name || "")));
        if (result.files.length < before) result.adminArtifactsHidden = before - result.files.length;
      }
      return result;
    }
    case "download": {
      if (!params.fileId) return { error: "fileId is required for download" };
      // Fail-CLOSED metadata preflight by fileId: if we can't confirm the
      // file is NOT an admin-scope artifact, refuse the operation.
      // (Architect HIGH 2026-05-20 round 2 — downloadFromDrive does not
      // surface the filename in its return, so we must look it up here.)
      try {
        const meta: any = await gd.driveJson(`/drive/v3/files/${encodeURIComponent(String(params.fileId))}?fields=id,name,mimeType`);
        const name = String(meta?.name || "");
        if (!name || meta?.error) {
          return { error: "google_drive download blocked: cannot verify file metadata (fail-closed on admin-artifact guard)." };
        }
        if (ADMIN_DRIVE_ARTIFACT_RE.test(name)) {
          return { error: "google_drive download blocked: target is an admin-scope artifact (cross-tenant aggregate). Not accessible via agent tools." };
        }
      } catch (e: any) {
        return { error: `google_drive download blocked: metadata lookup failed (fail-closed) — ${e?.message || e}` };
      }
      return gd.downloadFromDrive({ fileId: params.fileId, savePath: params.savePath });
    }
    case "delete": {
      if (!params.fileId) return { error: "fileId is required for delete" };
      // Fail-CLOSED metadata preflight — refuse to delete admin artifacts
      // by fileId, and refuse the operation entirely if metadata can't be
      // confirmed. (Architect MEDIUM 2026-05-20 round 2.)
      try {
        const meta: any = await gd.driveJson(`/drive/v3/files/${encodeURIComponent(String(params.fileId))}?fields=id,name,mimeType`);
        const name = String(meta?.name || "");
        if (!name || meta?.error) {
          return { error: "google_drive delete blocked: cannot verify file metadata (fail-closed on admin-artifact guard)." };
        }
        if (ADMIN_DRIVE_ARTIFACT_RE.test(name)) {
          return { error: "google_drive delete blocked: target is an admin-scope artifact (cross-tenant aggregate). Not deletable via agent tools." };
        }
      } catch (e: any) {
        return { error: `google_drive delete blocked: metadata lookup failed (fail-closed) — ${e?.message || e}` };
      }
      return gd.deleteDriveFile(params.fileId);
    }
    case "share": {
      if (!params.fileId) return { error: "fileId is required for share" };
      // Mirror the download/delete fail-closed admin-artifact guard so a
      // share link can't be minted for an admin aggregate.
      try {
        const meta: any = await gd.driveJson(`/drive/v3/files/${encodeURIComponent(String(params.fileId))}?fields=id,name,mimeType`);
        const name = String(meta?.name || "");
        if (!name || meta?.error) {
          return { error: "google_drive share blocked: cannot verify file metadata (fail-closed on admin-artifact guard)." };
        }
        if (ADMIN_DRIVE_ARTIFACT_RE.test(name)) {
          return { error: "google_drive share blocked: target is an admin-scope artifact (cross-tenant aggregate). Not shareable via agent tools." };
        }
      } catch (e: any) {
        return { error: `google_drive share blocked: metadata lookup failed (fail-closed) — ${e?.message || e}` };
      }
      return gd.makeFileShareable(params.fileId);
    }
    case "info":
      return gd.getDriveFolderInfo();
    case "status":
    case "health":
    case "check":
    case "connectivity": {
      // Connectivity/status probe. Agents running a "full system check"
      // routinely call google_drive with a status-style command; hard-
      // erroring here stalls the whole status sweep (and the agent's
      // adaptive recovery can't recover an "unknown command"). Map it to a
      // real connectivity check instead so the sweep continues.
      try {
        const info: any = await gd.getDriveFolderInfo();
        return { service: "google_drive", connected: info?.success === true, ...(info || {}) };
      } catch (e: any) {
        return { service: "google_drive", connected: false, error: e?.message || String(e) };
      }
    }
    default:
      return { error: `Unknown google_drive command: ${params.command}. Use: upload, list, download, delete, share, info, status` };
  }
}

export async function writeFileHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { logSilentCatch } = await import("../../../lib/silent-catch");
  const filePath = params.path;
  const content = params.content;
  if (!filePath || typeof filePath !== "string") return { error: "path is required" };
  if (typeof content !== "string") return { error: "content is required" };
  if (content.length > 500_000) return { error: `Content too large (${Math.round(content.length / 1024)}KB). Max 500KB.` };
  const safeParts = filePath.replace(/\.\./g, "").replace(/^\/+/, "");
  // R94 SECURITY — write_file shares the same secret-protection denylist
  // as read_file, plus dotfile guard. Without this, the agent can WRITE
  // to .ssh/, .git/config, scripts/git-auto-push.sh, etc., even though
  // it can't read them.
  const safePartsLower = safeParts.toLowerCase();
  const BLOCKED_WRITE = [
    ".env", "node_modules", ".git/", ".git\\", "package.json", "package-lock",
    ".replit", ".ssh/", ".ssh\\", "scripts/git-auto-push", ".local/mcp-key",
  ];
  for (const blocked of BLOCKED_WRITE) {
    if (safePartsLower.includes(blocked)) return { error: `Cannot write to protected path: ${blocked}` };
  }
  const writeBasename = path.basename(safePartsLower);
  const SAFE_DOTFILES_WRITE = new Set([".cursorrules", ".gitignore", ".prettierrc", ".eslintrc"]);
  if (writeBasename.startsWith(".") && !SAFE_DOTFILES_WRITE.has(writeBasename) && !safePartsLower.includes("/")) {
    return { error: `Cannot write top-level dotfile '${writeBasename}'` };
  }
  // Freeze-guard: the platform-stamped allowlist of paths this tool may write.
  // Read from the trusted ToolContext (ctx.allowedPaths) — never a
  // caller-supplied `_allowedPaths` (stripped upstream; see context.ts).
  if (ctx.allowedPaths && Array.isArray(ctx.allowedPaths) && ctx.allowedPaths.length > 0) {
    const normalizedParts = safeParts.toLowerCase().split("/");
    const allowed = ctx.allowedPaths.some((ap: string) => {
      const apNorm = ap.toLowerCase().replace(/^\/+/, "").replace(/\/+$/, "");
      const apSegments = apNorm.split("/");
      return apSegments.every((seg: string, i: number) => normalizedParts[i] === seg);
    });
    if (!allowed) {
      return { error: `Directory freeze active — write blocked outside allowed paths: ${ctx.allowedPaths.join(", ")}. File: ${safeParts}` };
    }
  }
  const absPath = path.resolve("/home/runner/workspace", safeParts);
  if (!absPath.startsWith("/home/runner/workspace")) return { error: "Access denied: path outside workspace" };
  // R114 +sec v8d (architect Pass 4 HIGH closed) — AEvo bypass guard.
  // data/output-skills/*.md is a SHARED/GLOBAL surface mutated ONLY by the
  // AEvo flow (proposeProcedureEdit → reviewProcedureEdit → applyProcedureEdit),
  // which carries its own platform-admin gate at the mutator boundary.
  // write_file is a generic tool exposed to many personas; without this
  // guard a non-admin tenant could rewrite Bob's playbooks via the generic
  // path, completely bypassing the AEvo CAS + claim-then-write + review
  // pipeline. Deny ALL non-admin writes under data/output-skills/, including
  // appends — admin tenants should also go through AEvo (audit trail), but
  // we don't block admin here so emergency hand-edits remain possible.
  {
    const outputSkillsRoot = path.resolve("/home/runner/workspace", "data/output-skills");
    if (absPath === outputSkillsRoot || absPath.startsWith(outputSkillsRoot + "/")) {
      const { ADMIN_TENANT_ID: WF_ADMIN_TID } = await import("../../../auth");
      if (ctx.tenantId !== WF_ADMIN_TID) {
        return { error: "Access denied: data/output-skills/* is AEvo-managed — use propose_procedure_edit → approve → apply_procedure_edit. Direct writes require admin tenant." };
      }
    }
  }
  // R94 SECURITY — symlink rejection. If the target or any path component
  // exists as a symlink, refuse the write — a symlink in workspace can
  // point to /etc/, ~/.ssh/, etc., bypassing the prefix check above.
  try {
    if (fs.existsSync(absPath)) {
      const lst = fs.lstatSync(absPath);
      if (lst.isSymbolicLink()) return { error: "Access denied: target is a symlink" };
      const realPath = fs.realpathSync(absPath);
      if (!realPath.startsWith("/home/runner/workspace")) return { error: "Access denied: realpath escapes workspace" };
    }
  } catch (_silentErr) { logSilentCatch("server/tools/domains/files/handlers.ts", _silentErr); }
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // R94 SECURITY — also reject if the parent directory (or any ancestor
  // up to workspace root) is a symlink.
  try {
    let probe = dir;
    while (probe.startsWith("/home/runner/workspace") && probe !== "/home/runner/workspace") {
      if (fs.existsSync(probe) && fs.lstatSync(probe).isSymbolicLink()) {
        return { error: `Access denied: ancestor directory is a symlink (${probe})` };
      }
      probe = path.dirname(probe);
    }
  } catch (_silentErr) { logSilentCatch("server/tools/domains/files/handlers.ts", _silentErr); }
  if (params.append && fs.existsSync(absPath)) {
    fs.appendFileSync(absPath, content, "utf-8");
  } else {
    fs.writeFileSync(absPath, content, "utf-8");
  }
  const stat = fs.statSync(absPath);
  console.log(`[write_file] Written: ${safeParts} (${stat.size} bytes)`);

  const ext = path.extname(safeParts).toLowerCase();
  let driveUrl: string | null = null;
  let driveDownloadUrl: string | null = null;
  try {
    const MIME_MAP: Record<string, string> = {
      ".html": "text/html", ".htm": "text/html",
      ".css": "text/css", ".js": "application/javascript", ".ts": "application/typescript",
      ".json": "application/json", ".xml": "application/xml", ".svg": "image/svg+xml",
      ".md": "text/markdown", ".txt": "text/plain", ".csv": "text/csv",
      ".py": "text/x-python", ".sh": "text/x-shellscript",
      ".pdf": "application/pdf", ".doc": "application/msword",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    const mimeType = MIME_MAP[ext] || "application/octet-stream";
    const fileName = path.basename(safeParts);
    const folderParts = safeParts.split("/");
    const folderLabel = folderParts.length > 1 ? folderParts[folderParts.length - 2] : "deliverables";

    // R110 +sec gold-pass-3 — Pre-Drive secret scan on write_file
    // uploads. write_file is a back-door to Drive that bypasses
    // deliverDigitalProduct(); without this gate, an LLM-authored
    // file containing a hardcoded API key could be shared to Drive
    // unscanned. Fail-CLOSED: any CRITICAL/HIGH hit aborts the
    // upload, leaves the local file in place for the agent to
    // remediate, and surfaces the reason in the result.
    try {
      const { isLikelyTextPath, scanFileForSecrets, summarizeReport } = await import("../../../lib/secret-scan");
      if (isLikelyTextPath(fileName)) {
        const preReport = await scanFileForSecrets(absPath, { source: fileName });
        if (preReport.shouldBlock) {
          console.warn(`[write_file] BLOCK Drive upload ${fileName}: ${summarizeReport(preReport)}`);
          throw new Error(`Pre-upload secret scan BLOCKED (${preReport.worstSeverity}): ${summarizeReport(preReport)}. Replace the literal secret with process.env.X and retry.`);
        }
      }
    } catch (scanErr: any) {
      if (String(scanErr?.message || "").startsWith("Pre-upload secret scan BLOCKED")) throw scanErr;
      console.warn(`[write_file] secret-scan infra error (FAIL-CLOSED): ${scanErr?.message?.slice(0, 200)}`);
      throw new Error(`Pre-upload secret scan unavailable for ${fileName}; refusing to share to Drive. Retry shortly.`);
    }
    const { uploadAndShare } = await import("../../../google-drive");
    const driveResult = await uploadAndShare({
      filePath: absPath,
      fileName,
      mimeType,
      folderLabel,
      parentFolderId: params._projectDriveFolderId || undefined,
    });
    if (driveResult.success) {
      driveUrl = driveResult.viewUrl || null;
      driveDownloadUrl = driveResult.downloadUrl || null;
      console.log(`[write_file] Uploaded to Google Drive: ${driveUrl}`);
    } else {
      console.warn(`[write_file] Drive upload failed: ${driveResult.error}`);
    }
  } catch (driveErr: any) {
    // R110 +sec gold-pass-4 — preserve secret-scan BLOCK / scanner-
    // unavailable messages so the agent sees actionable remediation
    // (e.g. "replace with process.env.X and retry"). Without this,
    // the outer result.upload_error stayed generic and the agent
    // had no visibility into WHY Drive was refused.
    const driveErrMsg = String(driveErr?.message || driveErr);
    if (driveErrMsg.startsWith("Pre-upload secret scan BLOCKED") || driveErrMsg.startsWith("Pre-upload secret scan unavailable")) {
      console.warn(`[write_file] Drive upload BLOCKED by secret scan: ${driveErrMsg.slice(0, 300)}`);
      (driveErr as any).__secretScanBlock = driveErrMsg;
      // Stash on a request-scoped channel so the result builder below
      // can surface it. Using a plain local since we're inside the
      // same case scope.
      (params as any).__secretScanBlockReason = driveErrMsg;
    } else {
      console.warn(`[write_file] Drive upload error (non-blocking): ${driveErrMsg.slice(0, 100)}`);
    }
  }

  let linkedProjectId: number | null = null;
  try {
    const tenantId = ctx.tenantId;
    if (ctx.conversationId) {
      const { db } = await import("../../../db");
      const { sql } = await import("drizzle-orm");
      const convRes = await db.execute(sql`
        SELECT c.project_id FROM conversations c
        JOIN projects p ON p.id = c.project_id AND p.tenant_id = ${tenantId}
        WHERE c.id = ${ctx.conversationId} AND c.project_id IS NOT NULL
      `);
      const convRow = (convRes as any).rows?.[0];
      if (convRow?.project_id) {
        const projId = convRow.project_id;
        const fileName = path.basename(safeParts);
        const fileType = ext.replace(".", "") || "file";
        await db.execute(sql`
          INSERT INTO project_files (project_id, file_name, file_path, file_url, file_type, file_size, uploaded_by)
          VALUES (${projId}, ${fileName}, ${absPath}, ${driveUrl || null}, ${fileType}, ${stat.size}, ${"agent"})
        `);
        await db.execute(sql`UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ${projId}`);
        linkedProjectId = projId;
        console.log(`[write_file] Auto-linked to project ${projId} (tenant ${tenantId})`);
      }
    }
  } catch (linkErr: any) {
    console.warn(`[write_file] Project auto-link failed (non-blocking): ${linkErr.message?.slice(0, 80)}`);
  }

  let pdfResult: any = null;
  if ((ext === ".html" || ext === ".htm") && safeParts.startsWith("deliverables/")) {
    try {
      const htmlContent = fs.readFileSync(absPath, "utf-8");
      const pdfTitle = path.basename(safeParts, ext);
      const { htmlToPdfAndUpload } = await import("../../../pdf-create");
      pdfResult = await htmlToPdfAndUpload(htmlContent, pdfTitle, "invoices", ctx.tenantId);
      if (pdfResult?.success) {
        console.log(`[write_file] Auto-converted HTML to PDF: ${pdfResult.filename}`);
      } else {
        console.warn(`[write_file] HTML→PDF conversion failed: ${pdfResult?.error}`);
        pdfResult = null;
      }
    } catch (pdfErr: any) {
      console.warn(`[write_file] HTML→PDF auto-convert failed (non-blocking): ${pdfErr.message?.slice(0, 100)}`);
    }
  }

  const secretScanBlockReason: string | undefined = (params as any).__secretScanBlockReason;
  const result: any = {
    success: true,
    path: safeParts,
    size: stat.size,
    upload_success: !!driveUrl,
    upload_error: !driveUrl
      ? (secretScanBlockReason || "Google Drive upload failed or unavailable — file saved locally only")
      : undefined,
    upload_blocked_reason: secretScanBlockReason,
    message: secretScanBlockReason
      ? `File written locally: ${safeParts} (${stat.size} bytes). Drive upload BLOCKED — ${secretScanBlockReason}`
      : `File written successfully: ${safeParts} (${stat.size} bytes)`,
  };
  // R74.13z-quint+9: ALWAYS set drive_url to the original file's URL first,
  // so auto-deliver and other downstream consumers reliably see it. The PDF
  // auto-conversion below may UPGRADE this to the PDF's URL when present —
  // that's preferred when available — but if PDF conversion runs and the
  // PDF's Drive upload fails, we previously left drive_url unset, which
  // broke the auto-deliver email path. Real-world: Felix→Forge HVAC test
  // wrote html → drive succeeded → pdf conversion ran → pdf drive upload
  // failed → drive_url never set → auto-deliver skipped. Apr 30 2026.
  if (driveUrl) {
    result.drive_url = driveUrl;
    if (driveDownloadUrl) result.drive_download_url = driveDownloadUrl;
  }
  if (pdfResult?.success) {
    result.pdf_version = {
      filename: pdfResult.filename,
      size: pdfResult.size,
      drive_url: pdfResult.driveUrl || null,
      local_url: pdfResult.localPath,
    };
    if (pdfResult.driveUrl) {
      result.message += `\n\nPDF version: ${pdfResult.driveUrl}`;
      result.drive_url = pdfResult.driveUrl;  // upgrade preferred URL
    } else if (pdfResult.localPath) {
      const prodDomain = process.env.PRODUCTION_DOMAIN || "";
      if (prodDomain) result.message += `\n\nPDF version: https://${prodDomain}${pdfResult.localPath}`;
    }
    result.message += `\nIMPORTANT: Always share the PDF link with the user, NOT the HTML file.`;
  } else {
    if (driveUrl) {
      result.message += `\n\nGoogle Drive link: ${driveUrl}`;
    }
    const isViewableInBrowser = [".html", ".htm", ".svg", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext);
    if (isViewableInBrowser && safeParts.startsWith("deliverables/")) {
      const prodDomain = process.env.PRODUCTION_DOMAIN || "";
      if (prodDomain) {
        result.web_url = `https://${prodDomain}/${safeParts}`;
        result.message += `\nView in browser: ${result.web_url}`;
      }
    }
  }
  if (!result.drive_url && !result.web_url && !pdfResult) {
    result.message += `\n\nNote: File saved locally. Share the file path with the user.`;
  }
  if (linkedProjectId) {
    result.linked_to_project = linkedProjectId;
    result.message += `\nFile added to project #${linkedProjectId} — visible in the project's Files tab.`;
  }
  return result;
}

/** Registered by ./index.ts at import time. */
export const filesDomainTools: RegisteredTool[] = [
  defineTool(readOutputBlobDefinition, readOutputBlobHandler),
  defineTool(codeSliceDefinition, codeSliceHandler),
  defineTool(scanFileDefinition, scanFileHandler),
  defineTool(listUploadsDefinition, listUploadsHandler),
  defineTool(readFileDefinition, readFileHandler),
  defineTool(writeFileDefinition, writeFileHandler),
  defineTool(googleDriveDefinition, googleDriveHandler),
];
