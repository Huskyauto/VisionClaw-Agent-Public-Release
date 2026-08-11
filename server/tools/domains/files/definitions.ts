/**
 * Tools-layer-split S5 — files-domain tool DEFINITIONS.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * Each const below was moved VERBATIM from `server/tools.ts`, which now
 * references these consts in the exact original TOOL_DEFINITIONS array
 * positions — array order (and therefore the LLM-facing tool ordering and
 * `scripts/list-tools.ts` output) is byte-identical.
 */

import type { ToolDefinition } from "../../types";

export const readOutputBlobDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "read_output_blob",
    description: "R117 token-saver: partial read of a sandbox blob (offloaded large tool output). When a previous tool returned a wrapped result like {truncated:true, sandboxLabel:'web_fetch-20260519...', head, tail, hint}, use this to fetch JUST the lines you need instead of pulling the whole file with run_command. Three modes: (1) default = head up to max_bytes; (2) slice_lines: [start, end] for an explicit line range; (3) grep: 'pattern' for regex-matched lines with surrounding context_lines. Returns {ok, content, totalLines, totalBytes, returnedLines, returnedBytes, matchedLines?, truncated, mode}. Prefer over run_command get_output when you only need to confirm a value, search for an error message, or extract a specific section — saves 80–98% of the tokens a full re-read would burn.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "The sandboxLabel returned by the wrapping tool (e.g. 'web_fetch-20260519123045'). Required." },
        slice_lines: { type: "array", description: "Optional [startLine, endLine] (1-indexed, inclusive). Mutually exclusive with grep.", items: { type: "number" } },
        grep: { type: "string", description: "Optional regex pattern. Returns matching lines plus context_lines around each match." },
        grep_flags: { type: "string", description: "Optional regex flags subset of 'gimsuy'. Default 'g'." },
        context_lines: { type: "number", description: "Lines of context around each grep match (0–20, default 2)." },
        max_bytes: { type: "number", description: "Hard cap on returned bytes (default 8192, max 65536). Set higher only when you genuinely need more." },
      },
      required: ["label"],
    },
  },
};

export const codeSliceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "code_slice",
    description: "R117 token-saver: extract ONLY the named symbols (functions, classes, types, exports) or line ranges from a source file, instead of pulling the whole file with read_file. Saves 70–95% of tokens when you only need to review a couple of functions in a 5,000-line file. AST-based for .ts/.tsx/.js/.jsx via the TypeScript compiler (precise); regex-based fallback for .py/.go/.rs/.java/.rb (best-effort, function/class/struct only). Returns {ok, slices: [{symbol, kind, startLine, endLine, exported, code}], totalLines, totalBytes, returnedBytes, compressionRatio}. Use this BEFORE read_file when you know what symbols you care about. Combine with codebase_diff_impact to slice just the symbols touched by a diff.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path to the source file (e.g. 'server/routes.ts'). Required." },
        symbols: { type: "array", description: "Symbol names to extract (case-insensitive). E.g. ['handleBrandLogoPost', 'safeFetchFollowRedirects']. Omit to return all top-level symbols.", items: { type: "string" } },
        line_ranges: { type: "array", description: "Additional explicit [start, end] line ranges to include (1-indexed, inclusive). Useful when you have a stack trace line number but not a symbol name.", items: { type: "array", items: { type: "number" } } },
        context_lines: { type: "number", description: "Lines of surrounding context above/below each extracted symbol (0–20, default 0)." },
        exported_only: { type: "boolean", description: "When true, only return symbols with an `export` (TS/JS) or `pub` (Rust) modifier. Default false." },
      },
      required: ["path"],
    },
  },
};

export const scanFileDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "scan_file",
    description: "Security: scan a file using Google Magika ML to identify its TRUE content type from raw bytes (not extension or claimed MIME). Returns detected label, confidence score, whether it's text, and a security verdict. Use BEFORE processing any user-uploaded or untrusted file, especially when investigating suspicious uploads, validating archives before extraction, or checking files quarantined for review. Detects 200+ file types with >99% accuracy and flags high-risk content (executables, scripts, installers, Office macros) regardless of what the file claims to be.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Absolute or relative path to the file on disk to scan." },
        claimedMime: { type: "string", description: "Optional: the MIME type the file was claimed to be (e.g. 'application/pdf'). When provided, the verdict will flag mismatches between claimed and detected content." },
      },
      required: ["filePath"],
    },
  },
};

export const readFileDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read the contents of a local file. Use this to read scripts, text files, configs, or any file in the workspace. Safe — read-only, cannot modify files. Supports text files only.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root (e.g. 'project-assets/script.txt', 'uploads/notes.md')" },
        maxLines: { type: "number", description: "Maximum number of lines to return (default: 200). Use for large files." },
      },
      required: ["path"],
    },
  },
};

export const writeFileDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "write_file",
    description: "Write content to a file in the workspace AND automatically upload it to Google Drive. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories automatically. Use for creating HTML, scripts, configs, mockups, or any text file. Max 500KB. The result includes a drive_url — ALWAYS share this link with the user so they can access the file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root (e.g. 'deliverables/mockup.html', 'project-assets/report.txt')" },
        content: { type: "string", description: "The full content to write to the file" },
        append: { type: "boolean", description: "If true, append to existing file instead of overwriting. Default: false." },
      },
      required: ["path", "content"],
    },
  },
};

export const listUploadsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_uploads",
    description: "List all previously uploaded files (images, PDFs, etc.) stored in the system. Use this to find uploaded logos, images, or documents before referencing them in create_pdf headerImage or other tools. Returns filename, original name, type, and size.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", description: "Filter by MIME type prefix (e.g. 'image' for images only, 'application/pdf' for PDFs). Omit to list all." },
      },
    },
  },
};

export const googleDriveDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "google_drive",
    description: "Manage files in Google Drive. R98: when `projectId` is given on upload, the file lands DIRECTLY in the project's named Drive folder (e.g. '[Your Product]') and a project_files DB row is auto-written for later lookup — USE THIS FOR ALL PROJECT DELIVERABLES. Use 'search' to find a previously-uploaded file by name when you've lost the link (DB-first, falls back to Drive API). Returns shareable view link + direct download link.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["upload", "search", "list", "download", "delete", "share", "info", "status"], description: "Operation: upload (auto-shares + auto-registers when projectId given), search (find file by name), list, download, delete, share (make existing file public), info, or status (connectivity/health probe — use this for a 'is Google Drive connected?' system check; returns {connected, folderId, fileCount})" },
        filePath: { type: "string", description: "Local file path to upload (for 'upload'). Can be relative like 'uploads/my_file.pdf'" },
        fileName: { type: "string", description: "Name for the file in Drive (for 'upload'). If omitted, uses the local filename" },
        mimeType: { type: "string", description: "MIME type. For upload: defaults from extension. For search: filter by mime type (e.g. 'video/mp4')" },
        description: { type: "string", description: "Optional description for the uploaded file" },
        share: { type: "boolean", description: "Whether to make the file publicly shareable (default: true). Set false to keep private." },
        customerName: { type: "string", description: "Customer name for the delivery subfolder (e.g. 'John Smith'). Creates a dated subfolder like '2026-03-14_14-30-00_John Smith'. NOT NEEDED when projectId is given." },
        folderLabel: { type: "string", description: "Custom label for the delivery subfolder. NOT NEEDED when projectId is given." },
        projectId: { type: "number", description: "R98 PREFERRED — Project ID. When given on upload, file goes directly into the project's named Drive folder and is auto-registered in project_files. When given on search, scopes the search to that project." },
        fileId: { type: "string", description: "Google Drive file ID (for 'download', 'delete', and 'share')" },
        query: { type: "string", description: "Search query to filter files by name (for 'list' or 'search')" },
        namePattern: { type: "string", description: "Filename substring to match (for 'search'). Case-insensitive. Example: 'real_weight_loss' matches 'Real_Weight_Loss_with_Bob_Channel_Introduction.mp4'" },
        maxResults: { type: "number", description: "Max results to return (for 'search', default 10, max 50)" },
        savePath: { type: "string", description: "Local path to save downloaded file (for 'download'). Default: uploads/<filename>" },
      },
      required: ["command"],
    },
  },
};

/** All files-domain definitions migrated so far (S5). */
export const filesDomainDefinitions: ToolDefinition[] = [
  readOutputBlobDefinition,
  codeSliceDefinition,
  scanFileDefinition,
  readFileDefinition,
  writeFileDefinition,
  listUploadsDefinition,
  googleDriveDefinition,
];
