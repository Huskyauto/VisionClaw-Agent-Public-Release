import type { Request, Response } from "express";
import crypto from "crypto";
import fs from "fs";
import fsPromises from "fs/promises";
import multer from "multer";
import path from "path";
import { spawn } from "child_process";
import { validateUpload as detectAndValidateUpload } from "./file-detector";
import { logSilentCatch } from "./lib/silent-catch";

export { detectAndValidateUpload };

export const UPLOADS_DIR = process.env.NODE_ENV === "production"
  ? path.resolve("/tmp", "uploads")
  : path.resolve(process.cwd(), "uploads");

export const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/xml",
  "application/json",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
  "audio/mpeg",
  "audio/wav",
  "video/mp4",
  "video/webm",
]);

export const SAFE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
  "image/svg+xml": ".svg", "image/bmp": ".bmp", "image/tiff": ".tiff",
  "text/plain": ".txt", "text/markdown": ".md", "text/csv": ".csv",
  "text/html": ".html", "text/xml": ".xml",
  "application/json": ".json", "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/zip": ".zip", "application/x-zip-compressed": ".zip",
  "audio/mpeg": ".mp3", "audio/wav": ".wav",
  "video/mp4": ".mp4", "video/webm": ".webm",
};

function createUploader(maxSizeMB: number) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
      filename: (_req, file, cb) => {
        const ext = SAFE_EXTENSIONS[file.mimetype] || path.extname(file.originalname) || ".bin";
        const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
        cb(null, uniqueName);
      },
    }),
    limits: { fileSize: maxSizeMB * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`File type not allowed: ${file.mimetype}`));
      }
    },
  });
}

export const upload = createUploader(50);
export const uploadLarge = createUploader(50);

export async function validateUploadedFile(req: Request, res: Response): Promise<boolean> {
  const file = req.file;
  if (!file) return true;
  const fullPath = path.join(UPLOADS_DIR, file.filename);
  try {
    const verdict = await detectAndValidateUpload(fullPath, file.mimetype, file.originalname);
    if (!verdict.ok) {
      console.warn(`[upload-security] BLOCKED ${file.originalname} (claimed=${file.mimetype}): ${verdict.reason}`);
      try { await fsPromises.unlink(fullPath); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      res.status(400).json({
        error: verdict.highRisk
          ? "File rejected: content does not match declared type and appears to be high-risk (executable/script)."
          : "File rejected: content does not match declared type.",
        detail: verdict.reason,
        detected: verdict.detected ? { label: verdict.detected.label, score: verdict.detected.score } : null,
      });
      return false;
    }
    if (verdict.detected) {
      console.log(`[upload-security] OK ${file.originalname} (claimed=${file.mimetype}, detected=${verdict.detected.label}, score=${verdict.detected.score.toFixed(2)})`);
    }

    {
      const ext = path.extname(file.originalname).toLowerCase();
      const { isLikelyTextPath, scanFileForSecrets, scanForSecrets, summarizeReport } = await import("./lib/secret-scan");
      let scanReport: Awaited<ReturnType<typeof scanForSecrets>> | null = null;
      let scanFailed = false;
      let scanFailReason = "";
      const isTextPath = isLikelyTextPath(file.originalname);
      const isExtractable = ext === ".pdf" || ext === ".docx" || ext === ".doc" || ext === ".xlsx";
      try {
        if (isTextPath) {
          scanReport = await scanFileForSecrets(fullPath, { source: file.originalname });
        } else if (isExtractable) {
          const text = await extractTextFromFile(fullPath, ext);
          if (text && text.length > 0) scanReport = scanForSecrets(text, { source: file.originalname });
        }
      } catch (scanErr: any) {
        scanFailed = true;
        scanFailReason = String(scanErr?.message || scanErr).slice(0, 200);
        console.warn(`[secret-scan] FAIL-CLOSED upload ${file.originalname} (${isTextPath ? "text" : "extract"} path): ${scanFailReason}`);
      }
      if (scanFailed && (isTextPath || isExtractable)) {
        try { await fsPromises.unlink(fullPath); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        res.status(503).json({
          error: "Upload rejected: secret scanner could not verify this file. Please re-upload, or convert to a different format and try again.",
          code: "UPLOAD_SECRET_SCAN_UNAVAILABLE",
          detail: scanFailReason,
        });
        return false;
      }
      if (scanReport && scanReport.shouldBlock) {
        console.warn(`[secret-scan] BLOCK upload ${file.originalname}: ${summarizeReport(scanReport)}`);
        try { await fsPromises.unlink(fullPath); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        res.status(400).json({
          error: "Upload rejected: file contains a credential-shaped secret. Remove it and re-upload.",
          code: "UPLOAD_SECRET_BLOCKED",
          severity: scanReport.worstSeverity,
          summary: summarizeReport(scanReport),
        });
        return false;
      }
      if (scanReport && scanReport.hits.length > 0) {
        console.log(`[secret-scan] FLAG upload ${file.originalname}: ${summarizeReport(scanReport)}`);
      }
    }

    return true;
  } catch (err) {
    console.error(`[upload-security] validator gate error → fail-closed REJECT for ${file.originalname}:`, (err as Error).message?.slice(0, 200));
    try {
      res.status(503).json({
        error: "Upload validator temporarily unavailable. Please retry shortly.",
        code: "UPLOAD_VALIDATOR_GATE_ERROR",
      });
    } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    return false;
  }
}

export async function extractTextFromFile(filePath: string, ext: string): Promise<string> {
  const fileBuf = await fs.promises.readFile(filePath);
  if (ext === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser: any = new PDFParse({ data: new Uint8Array(fileBuf) });
    await parser.load();
    const text = await parser.getText();
    parser.destroy();
    return (typeof text === "string" ? text : (text as any)?.text || "") || "";
  }
  if (ext === ".docx" || ext === ".doc") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: fileBuf });
    return result.value;
  }
  if (ext === ".xls") {
    throw new Error(
      "Legacy .xls (binary BIFF) format is not supported. Please re-save as .xlsx and re-upload. " +
      "The previous xlsx parser was removed due to unpatched HIGH-severity Prototype Pollution + ReDoS CVEs."
    );
  }
  if (ext === ".xlsx") {
    const csvEscape = (raw: string): string => {
      if (raw === "") return "";
      if (/[",\r\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
      return raw;
    };
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(fileBuf);
      const sheets: string[] = [];
      workbook.eachSheet((worksheet) => {
        const rows: string[] = [];
        worksheet.eachRow({ includeEmpty: false }, (row) => {
          const values = (row.values as any[]).slice(1).map((v) => {
            if (v == null) return "";
            if (typeof v === "object") {
              if ("text" in v) return csvEscape(String((v as any).text));
              if ("result" in v) return csvEscape(String((v as any).result));
              if (v instanceof Date) return csvEscape(v.toISOString());
              if ("hyperlink" in v) return csvEscape(String((v as any).hyperlink || (v as any).text || ""));
              if ("richText" in v && Array.isArray((v as any).richText)) {
                return csvEscape((v as any).richText.map((r: any) => r.text || "").join(""));
              }
              return csvEscape(JSON.stringify(v));
            }
            return csvEscape(String(v));
          });
          rows.push(values.join(","));
        });
        sheets.push(`--- Sheet: ${worksheet.name} ---\n${rows.join("\n")}`);
      });
      return sheets.join("\n\n");
    } catch (err: any) {
      throw new Error(`Failed to parse .xlsx file: ${err?.message || "unknown error"}`);
    }
  }
  const textExts = [".txt", ".md", ".markdown", ".csv", ".json", ".yaml", ".yml", ".xml", ".html", ".htm", ".log", ".env", ".ts", ".js", ".py", ".tsx", ".jsx", ".pptx", ".ppt"];
  if (textExts.includes(ext)) {
    return fileBuf.toString("utf-8");
  }
  throw new Error(`Unsupported file type: ${ext}. Supported: PDF, Word (.doc/.docx), Excel (.xlsx only — re-save legacy .xls), TXT, Markdown, CSV, JSON, YAML, XML, HTML, code files.`);
}

/** Fail-closed bounded PDF inspection for operator-supplied deliverables. */
export async function extractPdfTextBounded(filePath: string, opts?: { maxBytes?: number; maxPages?: number; maxChars?: number; timeoutMs?: number; parserFactory?: (data: Uint8Array) => any; workerPath?: string }): Promise<string> {
  const maxBytes = opts?.maxBytes ?? 15 * 1024 * 1024;
  const maxPages = opts?.maxPages ?? 100;
  const maxChars = opts?.maxChars ?? 200_000;
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const stat = await fs.promises.stat(filePath);
  if (stat.size > maxBytes) throw new Error("PDF exceeds bounded inspection size");
  const fileBuf = await fs.promises.readFile(filePath);
  const parse = async (): Promise<string> => {
    if (!opts?.parserFactory) {
      const workerPath = opts?.workerPath ||
        (fs.existsSync(path.resolve(process.cwd(), "dist/pdf-inspect-worker.cjs"))
          ? path.resolve(process.cwd(), "dist/pdf-inspect-worker.cjs")
          : path.resolve(process.cwd(), "server/workers/pdf-inspect-worker.cjs"));
      const child = spawn(process.execPath, [workerPath, path.resolve(filePath)], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const result = await new Promise<string>((resolve, reject) => {
        const maxOut = 256 * 1024, maxErr = 16 * 1024;
        let timedOut = false;
        let outputOverflow = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
          if (Buffer.byteLength(stdout) > maxOut) { outputOverflow = true; child.kill("SIGKILL"); }
        });
        child.stderr.on("data", (chunk) => { stderr += chunk.toString(); if (Buffer.byteLength(stderr) > maxErr) stderr = stderr.slice(-maxErr); });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("close", (code, signal) => {
          clearTimeout(timer);
          if (timedOut) return reject(new Error("PDF parser timeout"));
          if (outputOverflow) return reject(new Error("PDF worker output exceeded bound"));
          if (code !== 0) return reject(new Error(`PDF worker failed${signal ? ` (${signal})` : ""}: ${stderr.slice(0, 500)}`));
          try {
            const parsed = JSON.parse(stdout);
            if (!parsed?.ok || typeof parsed.text !== "string" || parsed.text.length > maxChars) throw new Error("invalid bounded PDF worker result");
            resolve(parsed.text);
          } catch (e) { reject(e); }
        });
      });
      return result;
    }
    const { PDFParse } = await import("pdf-parse");
    const parser: any = opts?.parserFactory
      ? opts.parserFactory(new Uint8Array(fileBuf))
      : new PDFParse({ data: new Uint8Array(fileBuf) });
    try {
      await parser.load();
      const info: any = await parser.getInfo({ parsePageInfo: true });
      const pages = Number(info?.total ?? info?.numPages ?? info?.pages?.length ?? 0);
      if (pages > maxPages) throw new Error("PDF exceeds bounded page count");
      const result: any = await parser.getText();
      const text = typeof result === "string" ? result : result?.text || "";
      if (text.length > maxChars) throw new Error("PDF text exceeds bounded inspection length");
      return text;
    } finally {
      try { parser.destroy(); } catch { /* parser cleanup is best-effort */ }
    }
  };
  if (!opts?.parserFactory) {
    // The subprocess path owns its deadline and settles only from `close`, after
    // a timed-out worker has actually been killed.
    return parse();
  }
  return Promise.race([
    parse(),
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error("PDF parser timeout")), timeoutMs)),
  ]);
}