import express, { type Express, type Request, type Response } from "express";
import { logSilentCatch } from "./lib/silent-catch";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// EIO-resilient static serving.
//
// Reserved VM deploys have been observed returning intermittent `EIO: i/o
// error, read` from the overlay filesystem (same fault class the ffmpeg→tmpfs
// workaround in server/lib/ffmpeg-paths.ts already sidesteps). When that hits
// `express.static` / `res.sendFile`, the read throws straight through to
// Express's default error handler and the user gets a bare "Internal Server
// Error" page on EVERY request — the whole frontend is down even though the
// process is healthy.
//
// Fix: read the built frontend into memory ONCE at boot (with retry) and serve
// every static asset + the SPA index.html from RAM. The faulty disk is never
// touched on the request hot path. Cache misses (a file that failed boot-load
// on the flaky disk, or one over the size cap) fall back to a disk read WITH
// EIO retry and are served as the real asset (or 404) — never the SPA HTML.

type CachedFile = { buf: Buffer; type: string; etag: string };

// The SPA shell, kept module-scoped so the global error handler can serve it as
// a last-resort safety net: if ANY route/middleware throws on a browser
// navigation, we return the working app shell (the client then retries its API
// calls) instead of a dead "Internal Server Error" page. Set during serveStatic.
let cachedIndex: { buf: Buffer; etag: string } | null = null;

export function getCachedIndexHtml(): { buf: Buffer; etag: string } | null {
  return cachedIndex;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function makeEtag(buf: Buffer): string {
  return 'W/"' + crypto.createHash("sha1").update(buf).digest("hex").slice(0, 27) + '"';
}

// Synchronous read that tolerates the intermittent overlayFS EIO by retrying a
// few times with a short backoff. Returns null on ENOENT/EISDIR/EACCES or after
// EIO retries are exhausted.
function readFileWithRetry(p: string, tries = 6): Buffer | null {
  for (let i = 0; i < tries; i++) {
    try {
      return fs.readFileSync(p);
    } catch (e: any) {
      if (e?.code === "EIO" && i < tries - 1) {
        const until = Date.now() + 20 * (i + 1);
        while (Date.now() < until) {
          /* brief backoff before retrying the bad disk */
        }
        continue;
      }
      return null;
    }
  }
  return null;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

// Cap per-file in-memory caching so an unexpectedly huge asset can't blow up
// RAM; oversized files fall back to disk-with-retry at request time.
const MAX_CACHE_BYTES = 12 * 1024 * 1024;

function loadCache(distPath: string): { cache: Map<string, CachedFile>; bytes: number; failed: number } {
  const cache = new Map<string, CachedFile>();
  let bytes = 0;
  let failed = 0;
  for (const full of walk(distPath)) {
    let size = 0;
    try {
      size = fs.statSync(full).size;
    } catch (_silentErr) { logSilentCatch("server/static.ts", _silentErr); }
    if (size > MAX_CACHE_BYTES) continue;
    const buf = readFileWithRetry(full);
    if (!buf) {
      failed++;
      continue;
    }
    const rel = path.relative(distPath, full).split(path.sep).join("/");
    cache.set("/" + rel, { buf, type: mimeFor(full), etag: makeEtag(buf) });
    bytes += buf.length;
  }
  return { cache, bytes, failed };
}

function cacheControlFor(key: string): string {
  if (key === "/index.html") return "no-cache";
  // Vite emits content-hashed filenames under /assets — safe to cache forever.
  if (key.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

// RFC-ish If-None-Match: comma list, "*", weak/strong comparison.
function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  const norm = (t: string) => t.trim().replace(/^W\//, "");
  const target = norm(etag);
  return header.split(",").some((t) => norm(t) === target);
}

function sendBuffer(req: Request, res: Response, key: string, buf: Buffer, type: string, etag: string) {
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", cacheControlFor(key));
  res.setHeader("ETag", etag);
  res.setHeader("Accept-Ranges", "bytes");

  if (etagMatches(req.headers["if-none-match"] as string | undefined, etag)) {
    res.status(304).end();
    return;
  }

  const range = req.headers.range;
  const m = typeof range === "string" ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m) {
    const size = buf.length;
    let start: number;
    let end: number;
    if (m[1] === "" && m[2] !== "") {
      start = Math.max(0, size - parseInt(m[2], 10));
      end = size - 1;
    } else {
      start = m[1] === "" ? 0 : parseInt(m[1], 10);
      end = m[2] === "" ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      res.status(416).setHeader("Content-Range", `bytes */${size}`);
      res.end();
      return;
    }
    const slice = buf.subarray(start, end + 1);
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", String(slice.length));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(slice);
    return;
  }

  res.setHeader("Content-Length", String(buf.length));
  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }
  res.status(200).end(buf);
}

export function serveStatic(app: Express, distPathOverride?: string) {
  const distPath = distPathOverride || path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const { cache, bytes, failed } = loadCache(distPath);
  const idx = cache.get("/index.html");
  if (idx) cachedIndex = { buf: idx.buf, etag: idx.etag };
  console.log(
    `[static] preloaded ${cache.size} file(s) (${(bytes / 1024 / 1024).toFixed(1)} MB) into memory — EIO-resilient serving active` +
      (failed ? ` (${failed} file(s) failed boot-load, will retry from disk)` : ""),
  );

  // Resolve a URL path to an absolute path inside distPath, guarding against
  // path traversal. Returns null if the path escapes distPath.
  function resolveOnDisk(urlKey: string): string | null {
    const rel = urlKey.replace(/^\/+/, "");
    if (!rel) return null;
    const full = path.resolve(distPath, rel);
    if (full !== distPath && !full.startsWith(distPath + path.sep)) return null;
    return full;
  }

  // Static asset middleware: serve from RAM first; on a cache miss, try a real
  // disk read (with EIO retry) so known assets are never replaced by SPA HTML.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.originalUrl.startsWith("/deliverables/")) return next();

    let key: string;
    try {
      key = decodeURIComponent(req.path);
    } catch {
      key = req.path;
    }

    const hit = cache.get(key);
    if (hit) {
      sendBuffer(req, res, key, hit.buf, hit.type, hit.etag);
      return;
    }

    const full = resolveOnDisk(key);
    if (full) {
      const buf = readFileWithRetry(full);
      if (buf) {
        const etag = makeEtag(buf);
        if (buf.length <= MAX_CACHE_BYTES) {
          cache.set(key, { buf, type: mimeFor(full), etag });
        }
        sendBuffer(req, res, key, buf, mimeFor(full), etag);
        return;
      }
    }
    next();
  });

  const deliverablesPath = path.resolve(process.cwd(), "deliverables");
  if (fs.existsSync(deliverablesPath)) {
    app.use("/deliverables", express.static(deliverablesPath));
  }

  // SPA fallback — every unmatched route returns index.html (from RAM; retry
  // from disk if it somehow wasn't cached at boot).
  app.use("/{*path}", (req, res) => {
    if (req.originalUrl.startsWith("/deliverables/")) {
      res.status(404).send("Not found");
      return;
    }
    // A request that looks like a static asset (has a file extension, e.g.
    // /assets/index-abc123.js) but reached the SPA fallback means the asset
    // genuinely does not exist — return a real 404 instead of masking it as
    // 200 index.html. A hashed-chunk fetch served HTML would fail to parse as
    // JS/CSS with a confusing error; client (wouter) routes are extensionless.
    if (/\.[a-z0-9]+$/i.test(req.path)) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    const cached = cache.get("/index.html");
    if (cached) {
      sendBuffer(req, res, "/index.html", cached.buf, cached.type, cached.etag);
      return;
    }
    const buf = readFileWithRetry(path.resolve(distPath, "index.html"));
    if (!buf) {
      res.status(503).set("Retry-After", "3").type("text/plain").send("Service temporarily unavailable");
      return;
    }
    // Disk fallback succeeded where boot-load missed: backfill both caches so
    // RAM serving + the global stay-online shell fallback are armed from now on.
    const etag = makeEtag(buf);
    cache.set("/index.html", { buf, type: "text/html; charset=utf-8", etag });
    cachedIndex = { buf, etag };
    sendBuffer(req, res, "/index.html", buf, "text/html; charset=utf-8", etag);
  });
}
