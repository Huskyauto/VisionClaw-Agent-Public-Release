import type { MagikaNode } from "magika/node";
import { promises as fsp } from "fs";

let magikaInstance: MagikaNode | null = null;
let magikaInitPromise: Promise<MagikaNode> | null = null;

async function getMagika(): Promise<MagikaNode> {
  if (magikaInstance) return magikaInstance;
  if (!magikaInitPromise) {
    magikaInitPromise = (async () => {
      try {
        const mod = await import("magika/node");
        const inst = await mod.MagikaNode.create();
        magikaInstance = inst;
        console.log("[file-detector] Magika model loaded (Google ML byte-level content type detection)");
        return inst;
      } catch (err) {
        // Round 19.2: clear the cached promise so a transient init failure
        // (network blip during model download, TF init race, etc.) doesn't
        // permanently disable upload validation until the next process restart.
        magikaInitPromise = null;
        throw err;
      }
    })();
  }
  return magikaInitPromise;
}

export async function warmupMagika(): Promise<void> {
  try {
    await getMagika();
  } catch (err) {
    console.warn("[file-detector] Magika warmup failed (file-type detection will be best-effort):", (err as Error).message);
  }
}

export interface DetectionResult {
  label: string;
  score: number;
  isText: boolean;
  group?: string;
  description?: string;
  mimeType?: string;
  extensions?: string[];
}

const MIME_TO_MAGIKA_GROUPS: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "application/msword": ["doc", "docx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx", "doc"],
  "application/vnd.ms-excel": ["xls", "xlsx", "csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx", "xls"],
  "application/vnd.ms-powerpoint": ["ppt", "pptx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx", "ppt"],
  "text/plain": ["txt", "asm", "batch", "css", "ini", "log", "makefile", "markdown", "rst", "shell"],
  "text/csv": ["csv", "txt", "tsv"],
  "text/markdown": ["markdown", "txt"],
  "text/html": ["html", "xml"],
  "application/json": ["json", "ndjson", "txt"],
  "application/xml": ["xml", "html"],
  "image/jpeg": ["jpeg"],
  "image/png": ["png"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "image/svg+xml": ["svg", "xml"],
  "audio/mpeg": ["mp3"],
  "audio/wav": ["wav"],
  "video/mp4": ["mp4"],
  "video/webm": ["webm"],
  "application/zip": ["zip", "docx", "xlsx", "pptx", "epub", "jar", "apk"],
  "application/x-zip-compressed": ["zip", "docx", "xlsx", "pptx"],
};

// Canonical Magika label names — verified against
// node_modules/magika/dist/cjs/src/content-type-label.js
const HIGH_RISK_LABELS = new Set([
  // Native executables / libraries
  "pebin",         // Windows PE binary
  "exe",           // Windows .exe
  "dll",           // Windows DLL
  "elf",           // Linux ELF binary
  "macho",         // macOS Mach-O binary
  // Installers / packages that can run code
  "msi",           // Windows installer
  "msix",          // Windows store package
  "deb",           // Debian package
  "rpm",           // RPM package
  "apk",           // Android package
  "dex",           // Dalvik bytecode (Android)
  "jar",           // Java archive
  // Raw scripts (any of these masquerading as a doc/image is hostile)
  "shell",         // Bash/sh/zsh script
  "batch",         // .bat / .cmd
  "powershell",    // .ps1
  "javascript",    // .js
  "typescript",    // .ts
  "coffeescript",  // .coffee
  "python",        // .py
  "pythonbytecode",// .pyc
  "perl",          // .pl
  "ruby",          // .rb
  "php",           // .php
  "scriptwsf",     // Windows Script File
  "dmscript",      // DM script
  "vba",           // Office macros
]);

export async function detectFromBytes(bytes: Uint8Array): Promise<DetectionResult | null> {
  try {
    const magika = await getMagika();
    const result = await magika.identifyBytes(bytes);
    const out = result.prediction.output;
    return {
      label: out.label,
      score: result.prediction.score,
      isText: out.is_text,
    };
  } catch (err) {
    console.warn("[file-detector] detectFromBytes failed:", (err as Error).message?.slice(0, 100));
    return null;
  }
}

export async function detectFromFile(filePath: string): Promise<DetectionResult | null> {
  try {
    const buf = await fsp.readFile(filePath);
    return await detectFromBytes(new Uint8Array(buf));
  } catch (err) {
    console.warn("[file-detector] detectFromFile failed:", (err as Error).message?.slice(0, 100));
    return null;
  }
}

export interface ValidationVerdict {
  ok: boolean;
  detected: DetectionResult | null;
  reason?: string;
  highRisk?: boolean;
}

// Validates that an uploaded file's true content matches the claimed MIME type.
// Returns ok:false when the file is high-risk (executable masquerading as a doc),
// or when claimed and detected types are clearly incompatible.
export async function validateUpload(
  filePath: string,
  claimedMime: string,
  originalName: string,
): Promise<ValidationVerdict> {
  const detected = await detectFromFile(filePath);

  // If detection failed, fall back to allowing (don't break uploads on infra error)
  if (!detected) {
    return { ok: true, detected: null, reason: "detection_unavailable" };
  }

  // Block high-risk content types regardless of claimed MIME
  if (HIGH_RISK_LABELS.has(detected.label)) {
    return {
      ok: false,
      detected,
      highRisk: true,
      reason: `High-risk content detected: file appears to be '${detected.label}' (score=${detected.score.toFixed(2)}) but was uploaded as '${claimedMime}' (${originalName}). Executables, scripts, and installer packages are not allowed.`,
    };
  }

  // Loose match: extension or claimed MIME group includes the detected label
  const expectedLabels = MIME_TO_MAGIKA_GROUPS[claimedMime] || [];
  const ext = (originalName.split(".").pop() || "").toLowerCase();
  const matches =
    expectedLabels.includes(detected.label) ||
    expectedLabels.includes(ext) ||
    detected.label === ext ||
    // Generic text fallback — many text-ish formats are interchangeable
    (detected.isText && (claimedMime.startsWith("text/") || claimedMime === "application/json"));

  if (!matches && detected.score >= 0.85) {
    return {
      ok: false,
      detected,
      reason: `Content/type mismatch: file content is '${detected.label}' (score=${detected.score.toFixed(2)}) but was uploaded as '${claimedMime}' (${originalName}).`,
    };
  }

  return { ok: true, detected };
}
