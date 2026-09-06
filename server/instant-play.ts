import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type express from "express";
import { logSilentCatch } from "./lib/silent-catch";

const CWD = process.cwd();
const PUBLIC_VIDEOS_DIR = path.resolve(CWD, "public", "videos");
fs.mkdirSync(PUBLIC_VIDEOS_DIR, { recursive: true });

function getBaseUrl(): string {
  // R98.5 — In production deploys both REPLIT_DEV_DOMAIN and REPLIT_DOMAINS
  // exist; the dev-domain points at the spock.replit.dev preview which is
  // OFFLINE for end users (shows "Run this app to see the results here"),
  // making every watch_url/download_url Felix sends to a customer broken.
  // Mirror the production-detection used in server/tools.ts:8024.
  const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
  const domain = isProduction
    ? (process.env.REPLIT_DOMAINS?.split(",")[0] || process.env.PRODUCTION_DOMAIN || process.env.REPLIT_DEV_DOMAIN || "localhost:5000")
    : (process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000");
  const protocol = domain.includes("localhost") ? "http" : "https";
  return `${protocol}://${domain}`;
}

function safeExtFromName(fileName: string, mimeType?: string): string {
  const fromName = path.extname(fileName || "").toLowerCase();
  if (fromName) return fromName;
  const mt = (mimeType || "").toLowerCase();
  if (mt === "video/mp4") return ".mp4";
  if (mt === "video/webm") return ".webm";
  if (mt === "video/quicktime") return ".mov";
  if (mt === "audio/mpeg") return ".mp3";
  if (mt === "audio/mp4") return ".m4a";
  if (mt === "audio/wav") return ".wav";
  return ".bin";
}

export interface InstantPlayResult {
  watchUrl: string;
  mediaUrl: string;
  token: string;
  publicPath: string;
}

export function publishMediaForInstantPlay(opts: {
  filePath: string;
  fileName?: string;
  mimeType?: string;
}): InstantPlayResult | null {
  try {
    if (!opts.filePath || !fs.existsSync(opts.filePath)) return null;
    const stat = fs.statSync(opts.filePath);
    if (!stat.isFile() || stat.size === 0) return null;

    const token = crypto.randomBytes(16).toString("hex");
    const ext = safeExtFromName(opts.fileName || opts.filePath, opts.mimeType);
    const publicName = `${token}${ext}`;
    const dest = path.join(PUBLIC_VIDEOS_DIR, publicName);
    fs.copyFileSync(opts.filePath, dest);

    const base = getBaseUrl();
    return {
      token,
      publicPath: dest,
      mediaUrl: `${base}/v/${publicName}`,
      watchUrl: `${base}/watch/${publicName}`,
    };
  } catch (err: any) {
    console.warn(`[instant-play] publishMediaForInstantPlay failed: ${err?.message || err}`);
    return null;
  }
}

// R74.13z-quint+10c (architect-fix): Async sibling that uses fs.promises.copyFile
// so the caller doesn't block the Node event loop while a 50-500MB video is
// copied byte-for-byte. The sync version is kept for the healing script and
// any future synchronous callers; agent runtime now uses this async version
// via attachInstantPlayUrls() and produce_video.
export async function publishMediaForInstantPlayAsync(opts: {
  filePath: string;
  fileName?: string;
  mimeType?: string;
}): Promise<InstantPlayResult | null> {
  try {
    if (!opts.filePath) return null;
    const stat = await fs.promises.stat(opts.filePath).catch(() => null);
    if (!stat || !stat.isFile() || stat.size === 0) return null;

    const token = crypto.randomBytes(16).toString("hex");
    const ext = safeExtFromName(opts.fileName || opts.filePath, opts.mimeType);
    const publicName = `${token}${ext}`;
    const dest = path.join(PUBLIC_VIDEOS_DIR, publicName);
    await fs.promises.copyFile(opts.filePath, dest);

    const base = getBaseUrl();
    return {
      token,
      publicPath: dest,
      mediaUrl: `${base}/v/${publicName}`,
      watchUrl: `${base}/watch/${publicName}`,
    };
  } catch (err: any) {
    console.warn(`[instant-play] publishMediaForInstantPlayAsync failed: ${err?.message || err}`);
    return null;
  }
}

const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogv"]);
const AUDIO_EXTS = new Set([".mp3", ".m4a", ".wav", ".ogg", ".aac"]);

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
};

function pipeWithErrorGuard(stream: fs.ReadStream, res: express.Response, label: string) {
  stream.on("error", (err: any) => {
    console.warn(`[instant-play] read stream error (${label}): ${err?.message || err}`);
    if (!res.headersSent) {
      try { res.status(500).type("text/plain").end("Stream error"); } catch (_silentErr) { logSilentCatch("server/instant-play.ts", _silentErr); }
    } else {
      try { res.destroy(err); } catch (_silentErr) { logSilentCatch("server/instant-play.ts", _silentErr); }
    }
  });
  res.on("close", () => { try { stream.destroy(); } catch (_silentErr) { logSilentCatch("server/instant-play.ts", _silentErr); } });
  stream.pipe(res);
}

function streamFileWithRange(req: express.Request, res: express.Response, filePath: string, contentType: string) {
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  if (range) {
    // RFC 7233: reject multi-range requests outright (we don't emit
    // multipart/byteranges) and parse both `bytes=START-END` and the
    // suffix form `bytes=-N` (last N bytes — used by some video players
    // for moov-atom-at-end probing).
    if (range.includes(",")) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`);
      return res.end();
    }
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`);
      return res.end();
    }
    const startStr = m[1];
    const endStr = m[2];
    let start: number;
    let end: number;
    if (startStr === "" && endStr === "") {
      // `bytes=-` — malformed
      res.status(416).setHeader("Content-Range", `bytes */${total}`);
      return res.end();
    } else if (startStr === "") {
      // Suffix range: last N bytes
      const suffixLen = parseInt(endStr, 10);
      if (Number.isNaN(suffixLen) || suffixLen <= 0) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`);
        return res.end();
      }
      start = Math.max(0, total - suffixLen);
      end = total - 1;
    } else {
      start = parseInt(startStr, 10);
      end = endStr === "" ? total - 1 : parseInt(endStr, 10);
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || end >= total) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`);
      return res.end();
    }
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", String(chunkSize));
    pipeWithErrorGuard(fs.createReadStream(filePath, { start, end }), res, "range");
  } else {
    res.status(200);
    res.setHeader("Content-Length", String(total));
    pipeWithErrorGuard(fs.createReadStream(filePath), res, "full");
  }
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderWatchPage(filename: string, mediaUrl: string, isVideo: boolean, isAudio: boolean): string {
  const playerHtml = isVideo
    ? `<video src="${htmlEscape(mediaUrl)}" controls autoplay playsinline preload="auto" style="max-width:100%;max-height:80vh;width:auto;display:block;margin:0 auto;border-radius:12px;background:#000;"></video>`
    : isAudio
    ? `<audio src="${htmlEscape(mediaUrl)}" controls autoplay preload="auto" style="width:100%;max-width:520px;display:block;margin:0 auto;"></audio>`
    : `<p>Unsupported media type. <a href="${htmlEscape(mediaUrl)}">Download the file</a>.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${htmlEscape(filename)}</title>
<meta name="robots" content="noindex,nofollow" />
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px 16px}
  .brand{font-size:14px;opacity:.7;margin-bottom:18px;letter-spacing:.5px}
  .card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:20px;width:100%;max-width:920px;backdrop-filter:blur(8px)}
  .filename{font-size:13px;opacity:.65;text-align:center;margin:14px 0 8px;word-break:break-all}
  .actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px}
  .btn{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;border:none;cursor:pointer}
  .btn.secondary{background:transparent;border:1px solid rgba(255,255,255,.25);color:#fff}
  .btn:hover{filter:brightness(1.1)}
</style>
</head>
<body>
  <div class="brand">VisionClaw</div>
  <div class="card">
    ${playerHtml}
    <div class="filename">${htmlEscape(filename)}</div>
    <div class="actions">
      <a class="btn" href="${htmlEscape(mediaUrl)}?dl=1" download>Download</a>
      <a class="btn secondary" href="${htmlEscape(mediaUrl)}" target="_blank" rel="noopener">Open Direct Link</a>
    </div>
  </div>
</body>
</html>`;
}

export function mountInstantPlayRoutes(app: express.Express): void {
  // Raw media stream — works as <video src="..."> or as a direct link.
  // Token in filename is unguessable (128-bit random hex) so this is safe to
  // be public, same security model as Drive's "anyone with link" sharing.
  app.get("/v/:filename", (req, res) => {
    const filename = path.basename(req.params.filename || "");
    if (!/^[a-f0-9]{32}\.[a-z0-9]{2,5}$/i.test(filename)) {
      return res.status(404).type("text/plain").send("Not found");
    }
    const filePath = path.join(PUBLIC_VIDEOS_DIR, filename);
    if (!filePath.startsWith(PUBLIC_VIDEOS_DIR + path.sep) || !fs.existsSync(filePath)) {
      return res.status(404).type("text/plain").send("Not found");
    }
    const ext = path.extname(filename).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";

    // ?dl=1 forces an attachment download (used by the "Download" button on
    // the watch page). Without it, the browser plays the file inline.
    if (req.query.dl === "1") {
      res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
    }
    streamFileWithRange(req, res, filePath, contentType);
  });

  // Branded landing page with embedded HTML5 player. This is what we put in
  // emails. Customer taps "Watch Now" -> sees a real video player on a
  // VisionClaw-branded page, no Drive transcoder, no app interception.
  app.get("/watch/:filename", (req, res) => {
    const filename = path.basename(req.params.filename || "");
    if (!/^[a-f0-9]{32}\.[a-z0-9]{2,5}$/i.test(filename)) {
      return res.status(404).type("text/plain").send("Not found");
    }
    const filePath = path.join(PUBLIC_VIDEOS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).type("text/plain").send("Not found");
    }
    const ext = path.extname(filename).toLowerCase();
    const isVideo = VIDEO_EXTS.has(ext);
    const isAudio = AUDIO_EXTS.has(ext);
    const base = `${req.protocol}://${req.get("host")}`;
    const mediaUrl = `${base}/v/${filename}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.send(renderWatchPage(filename, mediaUrl, isVideo, isAudio));
  });
}
