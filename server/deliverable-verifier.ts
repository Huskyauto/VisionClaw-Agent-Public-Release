import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { deliverableContracts, deliveryVerifications, type DeliverableContract } from "@shared/schema";
import { logSilentCatch } from "./lib/silent-catch";

// R76 review fix (CRITICAL #2) — verifier path jail. filePath inputs from
// agents must resolve under one of these roots. Anything else is rejected
// (no probing /etc/passwd, /proc, other tenants' workspaces, etc.).
const WORKSPACE_ROOT = path.resolve(process.cwd());
const ALLOWED_FILE_ROOTS: string[] = [
  path.resolve(WORKSPACE_ROOT, "deliverables"),
  path.resolve(WORKSPACE_ROOT, "uploads"),
  path.resolve(WORKSPACE_ROOT, "project-assets"),
  path.resolve(WORKSPACE_ROOT, "attached_assets"),
  path.resolve(WORKSPACE_ROOT, "stress-test-output"),
  path.resolve(WORKSPACE_ROOT, "data"),
  path.resolve(WORKSPACE_ROOT, "public", "videos"),
  "/tmp",
];

// R110.21.2 (Manus AI cross-review #1) — defense-in-depth: ALWAYS realpath
// before checking. Previously this used string-prefix matching with a fallback
// realpath dance at one callsite (line 188-ish), but a symlink INSIDE an
// allowed dir (`attached_assets/escape -> /etc/passwd`) passed the direct
// check and never got escape-validated. Now strict for every callsite. Falls
// CLOSED on realpath failure.
function isPathAllowed(absPath: string): boolean {
  const abs = path.resolve(absPath);
  // R110.21.2 architect FAIL fix: ENOENT/EACCES must NOT collapse
  // "missing file" into "path-jail rejected" (downstream stat surfaces
  // missing-file properly). Symlink-escape attacks require the target
  // to exist for realpath to follow them, so lexical fallback is safe.
  let target = abs;
  try {
    target = fs.realpathSync(abs);
  } catch (e: any) {
    if (e?.code !== "ENOENT" && e?.code !== "EACCES") {
      logSilentCatch("server/deliverable-verifier.ts:isPathAllowed", e);
      return false;
    }
  }
  for (const root of ALLOWED_FILE_ROOTS) {
    const rel = path.relative(root, target);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return true;
    }
  }
  return false;
}

// R76 review fix (CRITICAL #2) — fileUrl handling. We do NOT fetch URLs from
// here (would open SSRF). Inferred extension/mime is used for a lightweight
// shape check only. If the contract requires content bytes (render_check or
// size bounds), URL-only deliverables are reported as "skipped", NOT "passed".
const URL_FETCH_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  // intentionally empty — set by future opt-in. Until then, no fetches.
]);

export interface VerifyInput {
  tenantId: number;
  deliverableType: string;
  filePath?: string;
  fileUrl?: string;
  personaId?: number;
  conversationId?: number;
  buffer?: Buffer; // for in-memory check
}

export interface VerifyResult {
  passed: boolean;
  status: "passed" | "failed" | "skipped";
  failures: string[];
  contractId?: number;
  verificationId?: number;
  detected: { extension?: string; mime?: string; size?: number };
}

let contractCache: { rows: DeliverableContract[]; loadedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function loadContracts(): Promise<DeliverableContract[]> {
  if (contractCache && Date.now() - contractCache.loadedAt < CACHE_TTL_MS) return contractCache.rows;
  const rows = await db.select().from(deliverableContracts);
  contractCache = { rows, loadedAt: Date.now() };
  return rows;
}

export function invalidateContractCache(): void { contractCache = null; }

async function getContract(deliverableType: string): Promise<DeliverableContract | null> {
  const rows = await loadContracts();
  return rows.find((c) => c.deliverableType === deliverableType) || null;
}

const MAGIC_BYTES: Record<string, (buf: Buffer) => boolean> = {
  pdf: (b) => b.length >= 4 && b.slice(0, 4).toString("ascii") === "%PDF",
  png: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpg: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => b.length >= 4 && b.slice(0, 4).toString("ascii") === "GIF8",
  webp: (b) => b.length >= 12 && b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP",
  mp4: (b) => b.length >= 12 && b.slice(4, 8).toString("ascii") === "ftyp",
  webm: (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  mp3: (b) => b.length >= 3 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)),
  zip: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
};

function inferMimeFromExtension(ext: string): string | undefined {
  const map: Record<string, string> = {
    ".html": "text/html",
    ".htm": "text/html",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".csv": "text/csv",
    ".json": "application/json",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
  };
  return map[ext.toLowerCase()];
}

function checkRender(renderCheck: string, buf: Buffer | null, ext: string): string | null {
  if (renderCheck === "none" || !buf) return null;
  switch (renderCheck) {
    case "html": {
      const head = buf.slice(0, Math.min(8192, buf.length)).toString("utf8").toLowerCase();
      if (!head.includes("<html") && !head.includes("<!doctype html")) return "html-render-check: no <html> or <!doctype html> in first 8KB";
      return null;
    }
    case "json": {
      try { JSON.parse(buf.toString("utf8")); return null; }
      catch (e) { return `json-render-check: ${(e as Error).message}`; }
    }
    case "pdf":
      if (!MAGIC_BYTES.pdf(buf)) return "pdf-render-check: missing %PDF magic header";
      return null;
    case "image": {
      const e = ext.replace(".", "");
      const checker = MAGIC_BYTES[e === "jpeg" ? "jpg" : e];
      if (checker && !checker(buf)) return `image-render-check: ${e} magic bytes invalid`;
      return null;
    }
    default:
      return null;
  }
}

export async function verifyDeliverable(input: VerifyInput): Promise<VerifyResult> {
  const failures: string[] = [];
  const detected: VerifyResult["detected"] = {};

  const contract = await getContract(input.deliverableType);
  if (!contract) {
    const skipResult: VerifyResult = {
      passed: true, status: "skipped", failures: [`unknown deliverable_type: ${input.deliverableType}`], detected,
    };
    await persistVerification(input, null, skipResult);
    return skipResult;
  }

  const sourceName = input.filePath || input.fileUrl || "";
  const ext = sourceName ? path.extname(sourceName).toLowerCase() : "";
  detected.extension = ext || undefined;
  detected.mime = inferMimeFromExtension(ext);

  if (contract.requiredExtensions && contract.requiredExtensions.length > 0) {
    if (!ext) failures.push(`extension required (one of ${contract.requiredExtensions.join(",")}) but none detected`);
    else if (!contract.requiredExtensions.map((e) => e.toLowerCase()).includes(ext)) {
      failures.push(`extension ${ext} not in allowed [${contract.requiredExtensions.join(",")}]`);
    }
  }

  if (contract.requiredMimePattern && detected.mime) {
    const pattern = contract.requiredMimePattern.replace("*", ".*");
    if (!new RegExp("^" + pattern + "$", "i").test(detected.mime)) {
      failures.push(`mime ${detected.mime} does not match required pattern ${contract.requiredMimePattern}`);
    }
  }

  let buf: Buffer | null = input.buffer ?? null;
  let pathRejected = false;
  if (!buf && input.filePath) {
    try {
      const abs = path.resolve(input.filePath);
      // R76 review fix (CRITICAL #2) — path jail. Reject anything outside
      // approved roots (covers absolute paths, .. traversal, and symlink
      // escapes via realpath). Also reject symlinks pointing outside.
      if (!isPathAllowed(abs)) {
        pathRejected = true;
        failures.push(`file path outside allowed roots (deliverables/uploads/project-assets/attached_assets/stress-test-output/data/public/videos/tmp): ${abs}`);
      } else {
        // R110.21.2 architect (B): the redundant post-check realpath dance
        // that lived here is now folded INTO isPathAllowed (which always
        // realpaths first when the file exists). Just resolve once for the
        // file ops below.
        let realAbs = abs;
        try { realAbs = fs.realpathSync(abs); } catch (_silentErr) { logSilentCatch("server/deliverable-verifier.ts", _silentErr); }
        {
          const stat = fs.statSync(realAbs);
          if (!stat.isFile()) {
            failures.push(`path is not a regular file (mode=${stat.mode.toString(8)})`);
          } else {
            detected.size = stat.size;
            const readN = Math.min(stat.size, 64 * 1024);
            const fd = fs.openSync(realAbs, "r");
            try {
              buf = Buffer.alloc(readN);
              fs.readSync(fd, buf, 0, readN, 0);
            } finally { fs.closeSync(fd); }
          }
        }
      }
    } catch (e) {
      failures.push(`file read failed: ${(e as Error).message}`);
    }
  } else if (buf) {
    detected.size = buf.length;
  }

  // R76 review fix (CRITICAL #2) — URL-only path. We never fetch arbitrary
  // URLs (SSRF). If the contract requires content-byte verification (render
  // check beyond "none" or any min/max size), and we have no buffer, mark the
  // verification as SKIPPED rather than passed/failed so callers know it
  // hasn't been content-verified.
  const needsBytes =
    contract.renderCheck !== "none" ||
    contract.minSizeBytes != null ||
    contract.maxSizeBytes != null;
  if (!buf && !pathRejected && input.fileUrl && !input.filePath) {
    if (URL_FETCH_ALLOWED_HOSTS.size === 0 && needsBytes) {
      const skipResult: VerifyResult = {
        passed: false,
        status: "skipped",
        failures: [
          ...failures,
          "url-only deliverable cannot be content-verified (fetch allowlist empty)",
        ],
        contractId: contract.id,
        detected,
      };
      await persistVerification(input, contract, skipResult);
      return skipResult;
    }
  }

  if (contract.minSizeBytes != null && detected.size != null && detected.size < contract.minSizeBytes) {
    failures.push(`size ${detected.size} bytes < min ${contract.minSizeBytes}`);
  }
  if (contract.maxSizeBytes != null && detected.size != null && detected.size > contract.maxSizeBytes) {
    failures.push(`size ${detected.size} bytes > max ${contract.maxSizeBytes}`);
  }

  const renderErr = checkRender(contract.renderCheck, buf, ext);
  if (renderErr) failures.push(renderErr);

  const passed = failures.length === 0;
  const result: VerifyResult = {
    passed,
    status: passed ? "passed" : "failed",
    failures,
    contractId: contract.id,
    detected,
  };
  await persistVerification(input, contract, result);
  return result;
}

async function persistVerification(input: VerifyInput, contract: DeliverableContract | null, result: VerifyResult): Promise<void> {
  try {
    const inserted = await db.execute(sql`
      INSERT INTO delivery_verifications
        (tenant_id, persona_id, conversation_id, deliverable_type, file_path, file_url, contract_id, status, failures, detected_extension, detected_mime, detected_size)
      VALUES
        (${input.tenantId}, ${input.personaId ?? null}, ${input.conversationId ?? null}, ${input.deliverableType},
         ${input.filePath ?? null}, ${input.fileUrl ?? null}, ${contract?.id ?? null}, ${result.status},
         ${JSON.stringify(result.failures)}::jsonb, ${result.detected.extension ?? null}, ${result.detected.mime ?? null}, ${result.detected.size ?? null})
      RETURNING id
    `);
    result.verificationId = ((inserted as any).rows?.[0]?.id ?? (inserted as any)[0]?.id) as number;
  } catch (e) {
    console.warn(`[deliverable-verifier] persist failed: ${(e as Error).message}`);
  }
}

export async function listContracts(): Promise<DeliverableContract[]> {
  return loadContracts();
}
