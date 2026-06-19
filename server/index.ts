import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic, getCachedIndexHtml } from "./static";
import { createServer } from "http";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import { logSilentCatch } from "./lib/silent-catch";
import { installConsoleRedactor } from "./log-redactor";

// R84 — Wrap console.* with the secret redactor BEFORE anything logs.
installConsoleRedactor();
// v5.1.1 — per-tenant WhatsApp, Coinbase, research engine

import fs from "fs";

// R74.13c-fix — both push scripts use git credential.helper to keep the
// GITHUB_TOKEN out of process argv / shell history / log lines.
// Version marker bumps force regeneration of stale /tmp scripts on boot.
const PUSH_SCRIPT_VERSION = "R74.13c-credhelper-1";

function writeScriptIfStale(scriptPath: string, body: string) {
  try {
    if (fs.existsSync(scriptPath)) {
      const existing = fs.readFileSync(scriptPath, "utf8");
      if (existing.includes(`# version: ${PUSH_SCRIPT_VERSION}`)) return;
    }
    fs.writeFileSync(scriptPath, body, { mode: 0o755 });
  } catch (_silentErr) { logSilentCatch("server/index.ts", _silentErr); }
}

(function ensureGitPushScript() {
  const scriptPath = "/tmp/push-gh.sh";
  const script = `#!/bin/bash
# version: ${PUSH_SCRIPT_VERSION}
set -e
export GIT_TERMINAL_PROMPT=0
cd /home/runner/workspace
PATTERNS='ghp_[A-Za-z0-9]{36}|ya29\\.[A-Za-z0-9_-]{50,}|pplx-[A-Za-z0-9]{40,}|GOCSPX-[A-Za-z0-9_-]{20,}|xai-[A-Za-z0-9]{60,}|AIzaSy[A-Za-z0-9_-]{33}|am_us_pod_[a-f0-9]{64}|sk-ant-[A-Za-z0-9_-]{80,}|whsec_[A-Za-z0-9]{32,}|wss://chrome\\.browserless\\.io\\?token=[A-Za-z0-9]+'
echo "[push] Scanning tracked files for secrets..."
LEAKS=$(git ls-files -- ':!*.md' ':!docs/' ':!references/' ':!script/generate-*' | xargs grep -lP "$PATTERNS" 2>/dev/null || true)
if [ -n "$LEAKS" ]; then
  echo "SECRET SCAN FAILED: $LEAKS"
  exit 1
fi
echo "[push] Secret scan passed"
MUST_EXCLUDE=(".replit" "data/browser-config.json")
for item in "\${MUST_EXCLUDE[@]}"; do
  if git ls-files --error-unmatch "$item" >/dev/null 2>&1; then
    echo "BLOCKED: $item is tracked — run: git rm --cached $item"
    exit 1
  fi
done
git add -A
AGENT_NAME="\${SITE_AGENT_NAME:-Platform Agent}"
GIT_EMAIL="\${GIT_COMMIT_EMAIL:-agent@platform.local}"
git diff --cached --quiet || git -c user.name="\${AGENT_NAME}" -c user.email="\${GIT_EMAIL}" commit -m "\${1:-Auto-backup commit}"
export GITHUB_TOKEN_VAL="\${GITHUB_PERSONAL_ACCESS_TOKEN_2:-\${GITHUB_TOKEN}}"
if [ -z "\$GITHUB_TOKEN_VAL" ]; then echo "No GITHUB_TOKEN"; exit 0; fi
GITHUB_REPO_VAL="\${GITHUB_REPO:-}"
if [ -z "\$GITHUB_REPO_VAL" ]; then echo "No GITHUB_REPO set"; exit 0; fi
# R74.13c — credential-helper keeps token out of argv. Stderr scrubbed in case
# git ever echoes the URL with embedded creds (it shouldn't, but defense in depth).
GIT_ASKPASS="" git \\
  -c credential.helper='!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN_VAL"; }; f' \\
  push "https://github.com/\${GITHUB_REPO_VAL}.git" main 2>&1 \\
  | sed -E 's#https://[^@[:space:]]+@github\\.com#https://[REDACTED]@github.com#g'
echo "[push] Done"
`;
  writeScriptIfStale(scriptPath, script);
})();

(function ensurePublicPushScript() {
  const scriptPath = "/tmp/push-public.sh";
  const script = `#!/bin/bash
# version: ${PUSH_SCRIPT_VERSION}
set -e
export GIT_TERMINAL_PROMPT=0
cd /home/runner/workspace
PUBLIC_REPO="\${PUBLIC_GITHUB_REPO:-}"
if [ -z "$PUBLIC_REPO" ]; then
  echo "[public-push] ERROR: Set PUBLIC_GITHUB_REPO env var (e.g. YourUser/YourRepo-Public)"
  exit 1
fi
echo "[public-push] Building clean release copy..."
rm -rf /tmp/visionclaw-public
bash scripts/clean-for-release.sh /tmp/visionclaw-public
echo ""
echo "[public-push] Initializing git in clean copy..."
cd /tmp/visionclaw-public
git init -q
git add -A
git -c user.name="Platform Agent" -c user.email="agent@platform.local" commit -q -m "\${1:-Update public release}"
echo "[public-push] Pushing to \${PUBLIC_REPO}..."
export GITHUB_TOKEN_VAL="\${GITHUB_PERSONAL_ACCESS_TOKEN_2:-\${GITHUB_TOKEN}}"
if [ -z "$GITHUB_TOKEN_VAL" ]; then echo "No GITHUB_TOKEN"; exit 1; fi
# R74.13c — credential-helper keeps token out of argv (no inline-token URL).
git remote add origin "https://github.com/\${PUBLIC_REPO}.git"
GIT_ASKPASS="" git \\
  -c credential.helper='!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN_VAL"; }; f' \\
  push -f origin main 2>&1 \\
  | sed -E 's#https://[^@[:space:]]+@github\\.com#https://[REDACTED]@github.com#g'
echo "[public-push] Done — https://github.com/\${PUBLIC_REPO}"
cd /home/runner/workspace
rm -rf /tmp/visionclaw-public
`;
  writeScriptIfStale(scriptPath, script);
})();

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err.message, err.stack?.split("\n").slice(0, 5).join("\n"));
  setTimeout(() => {
    console.error("[FATAL] Forcing process exit after uncaught exception");
    process.exit(1);
  }, 3000);
});

process.on("unhandledRejection", (reason: any) => {
  console.error("[FATAL] Unhandled rejection:", reason?.message || reason);
});

const app = express();
const httpServer = createServer(app);

// R74.2 — Tag every Express response so the client can distinguish app-level
// 5xx (which should surface to the user) from platform/edge-proxy 5xx
// (cold-start, autoscale warm-up, transient gateway errors — safe to retry).
// The Replit edge proxy cannot forge this header on responses it generates
// when the upstream container is unreachable, so absence == platform-originated.
// MUST stay as the first `app.use(...)` so it covers webhook POSTs and every
// other route mounted below — moving routes above this breaks client retry
// safety silently.
app.use((_req, res, next) => {
  res.setHeader("x-app-origin", "express");
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []), "https://js.stripe.com", "https://accounts.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      connectSrc: ["'self'", "https://api.openai.com", "https://api.anthropic.com", "https://generativelanguage.googleapis.com", "https://api.x.ai", "https://openrouter.ai", "https://api.perplexity.ai", "https://api.elevenlabs.io", "https://api.stripe.com", "https://api.commerce.coinbase.com", "https://r.jina.ai", "https://api.firecrawl.dev", "https://ipwho.is", "https://api.open-meteo.com", "https://geocoding-api.open-meteo.com", "https://accounts.google.com", "https://www.googleapis.com", "wss:", "ws:"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com", "https://accounts.google.com", "https://commerce.coinbase.com"],
      mediaSrc: ["'self'", "blob:", "data:", "https:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      workerSrc: ["'self'", "blob:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// R110.11.6 +sec — Auth bypass probe detector. Logs nomore403-style 403/401
// bypass attempts (X-Original-URL, X-HTTP-Method-Override, localhost-spoofed
// X-Forwarded-For, path mutations on /api/admin/* and trusted-tool routes).
// NEVER blocks — real auth still runs. Telemetry only.
import { authBypassProbeMiddleware } from "./lib/auth-bypass-detector";
app.use(authBypassProbeMiddleware());

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      if (!Buffer.isBuffer(req.body)) {
        console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
        return res.status(500).json({ error: 'Webhook processing error' });
      }
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error: any) {
      // R74.13u — Classify failures: signature errors → 400 (alerting),
      // anything else → 500 (alerting + on-call). Stripe retries any
      // non-2xx response, so the status code is for our monitoring, not
      // for retry control. The webhook-dedupe claim is left uncommitted on
      // any failure path here, so retries will re-process correctly.
      const { StripeWebhookSignatureError } = await import('./webhookHandlers');
      if (error instanceof StripeWebhookSignatureError) {
        console.error('[stripe-webhook] Signature error (400):', error.message?.slice(0, 200));
        return res.status(400).json({ error: 'Webhook signature verification failed' });
      }
      console.error('[stripe-webhook] Processing error (500, Stripe will retry):', error.message?.slice(0, 200));
      return res.status(500).json({ error: 'Webhook processing error' });
    }
  }
);

import { handleCoinbaseWebhook } from "./coinbase-commerce";
app.post(
  '/api/coinbase/webhook',
  express.raw({ type: 'application/json' }),
  handleCoinbaseWebhook,
);

import { virtualPortMiddleware } from "./virtual-ports";
app.use(virtualPortMiddleware());

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(
  express.urlencoded({
    extended: false,
    verify: (req, _res, buf) => {
      // R98.26 — Slack slash commands arrive as application/x-www-form-urlencoded
      // and need the exact raw bytes for HMAC-SHA256 v0 signature verification
      // in server/routes/slack.ts. Capture rawBody on the global parser so the
      // route handler doesn't have to fight ordering with this middleware.
      req.rawBody = buf;
    },
  }),
);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  const channel = (req as any)._vpChannel || "unknown";

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms [${channel}]`);
    }
  });

  next();
});

(async () => {
  (async () => {
    try {
      const databaseUrl = process.env.DATABASE_URL;
      if (databaseUrl) {
        console.log('[stripe] Initializing Stripe schema...');
        await runMigrations({ databaseUrl, schema: 'stripe' } as any);
        console.log('[stripe] Schema ready');

        const stripeSync = await getStripeSync();
        const replitDomains = process.env.REPLIT_DOMAINS;
        if (replitDomains) {
          const webhookBaseUrl = `https://${replitDomains.split(',')[0]}`;
          const desiredUrl = `${webhookBaseUrl}/api/stripe/webhook`;
          try {
            const { stripe } = await import('./stripeClient') as any;
            if (stripe) {
              // Match by URL only (Stripe rejects duplicate URLs even when disabled).
              // If a disabled webhook exists for our URL, re-enable instead of creating a duplicate.
              const existing = await stripe.webhookEndpoints.list({ limit: 100 });
              const match = existing.data.find((e: any) => e.url === desiredUrl);
              if (match) {
                if (match.status !== 'enabled') {
                  try {
                    await stripe.webhookEndpoints.update(match.id, { disabled: false } as any);
                    console.log(`[stripe] Webhook re-enabled: ${match.url}`);
                  } catch (updErr: any) {
                    console.log(`[stripe] Webhook exists but disabled, re-enable failed: ${updErr.message?.slice(0, 80)}`);
                  }
                } else {
                  console.log(`[stripe] Webhook already configured: ${match.url}`);
                }
              } else {
                try {
                  const created = await stripe.webhookEndpoints.create({
                    url: desiredUrl,
                    enabled_events: ['*'],
                  });
                  console.log(`[stripe] Webhook created: ${created.url}`);
                } catch (createErr: any) {
                  console.log(`[stripe] Webhook auto-create failed (${createErr.message?.slice(0, 80)}); configure manually in Stripe Dashboard if needed`);
                }
              }
            } else {
              try {
                const result = await stripeSync.findOrCreateManagedWebhook(desiredUrl);
                if (result?.webhook?.url) {
                  console.log(`[stripe] Webhook configured: ${result.webhook.url}`);
                }
              } catch (whErr: any) {
                console.log(`[stripe] Webhook setup skipped: ${whErr.message?.slice(0, 80)}`);
              }
            }
          } catch (whErr: any) {
            console.log(`[stripe] Webhook setup skipped: ${whErr.message?.slice(0, 80)}`);
          }
        } else {
          console.log('[stripe] No REPLIT_DOMAINS, webhook setup skipped');
        }

        stripeSync.syncBackfill()
          .then(() => console.log('[stripe] Data synced'))
          .catch((err: any) => console.error('[stripe] Sync error:', err.message));
      }
    } catch (err: any) {
      console.error('[stripe] Init error (non-fatal):', err.message);
    }
  })();

  (async () => {
    try {
      const { forceTokenRefresh, startDriveTokenRefreshLoop } = await import("./google-drive");
      const refreshed = await forceTokenRefresh();
      console.log("[gdrive] Startup token:", refreshed ? "ready (connector/DB)" : "will resolve on first use");
      startDriveTokenRefreshLoop();
    } catch (gdErr: any) {
      console.log("[gdrive] Startup init (non-fatal):", gdErr.message);
    }
    try {
      const { startAutoTokenRefresh } = await import("./oauth-subscriptions");
      startAutoTokenRefresh();
    } catch (autoErr: any) {
      console.log("[auto-refresh] Startup init (non-fatal):", autoErr.message);
    }
  })();

  setTimeout(async () => {
    try {
      const { initPgVector } = await import("./embeddings");
      await initPgVector();
    } catch (err: any) {
      console.log("[pgvector] Init skipped:", err.message?.substring(0, 80));
    }
  }, 10000);

  const { setupAuth, registerAuthRoutes } = await import("./replit_integrations/auth");
  await setupAuth(app);
  registerAuthRoutes(app);

  // R98.27.10 — Cold-boot UX gate. Between early-bind (port open) and
  // serveStatic mount, GET / hits Express's default 404 ("Cannot GET /").
  // On a phone reopened after Autoscale spin-down there's no hard-reload,
  // so the user sees a broken page. Serve a tiny self-refreshing placeholder
  // for GET / until the static/Vite handler mounts. Once `appReady` flips,
  // this middleware is a pass-through and the real handler takes over.
  let appReady = false;
  app.use((req, res, next) => {
    if (appReady) return next();
    if (req.method !== "GET") return next();
    if (req.path !== "/" && req.path !== "/index.html") return next();
    const accept = req.headers.accept || "";
    if (!accept.includes("text/html")) return next();
    res.status(503).set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "5",
    }).send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="4"><title>Starting VisionClaw…</title><style>html,body{margin:0;height:100%;background:#0b0d12;color:#e6e8ee;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center}.dot{width:10px;height:10px;border-radius:50%;background:#5b8cff;box-shadow:0 0 16px #5b8cff;animation:p 1.2s ease-in-out infinite}.t{font-size:18px;font-weight:600}.s{font-size:13px;opacity:.65;max-width:320px;line-height:1.45}@keyframes p{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}</style></head><body><div class="wrap"><div class="dot"></div><div class="t">Starting VisionClaw…</div><div class="s">The server is warming up after an idle period. This page will reload in a few seconds.</div></div></body></html>`);
  });

  // R98.26.2 — Reserved VM (gce) deploys kill the worker if port 5000 isn't
  // open within ~60s. Our boot does ~50s of synchronous seeding (Stripe,
  // gdrive, pgvector, governance rules, trust scores, capability registry,
  // dev snapshot import) before reaching the late `listenWithRetry` call,
  // which caused a restart loop on first deploy. Bind the port EARLY in
  // production so the platform health check sees an open socket immediately;
  // routes registered later via app.use/app.post still take effect dynamically
  // once Express attaches them. Dev keeps the late listenWithRetry path
  // (which has EADDRINUSE retry logic for stale processes).
  if (process.env.NODE_ENV === "production") {
    const earlyPort = parseInt(process.env.PORT || "5000", 10);
    await new Promise<void>((resolve, reject) => {
      const onError = (err: any) => { httpServer.removeListener("listening", onListen); reject(err); };
      const onListen = () => { httpServer.removeListener("error", onError); resolve(); };
      httpServer.once("error", onError);
      httpServer.once("listening", onListen);
      httpServer.listen({ port: earlyPort, host: "0.0.0.0" });
    });
    log(`serving on port ${earlyPort} (early-bind for Reserved VM health check; seeding continues)`);
  }

  // R110.20 — proactive ffmpeg capability check so missing encoders/filters
  // (notably the drawtext gap in bundled ffmpeg-static) are surfaced loudly at
  // startup, not discovered at runtime when Felix tries to burn a caption.
  try {
    const { probeFfmpegCapabilities, describeFfmpegResolution } = await import("./lib/ffmpeg-paths");
    const r = describeFfmpegResolution();
    console.log(`[startup] ffmpeg=${r.ffmpegSource} (${r.ffmpeg}) ffprobe=${r.ffprobeSource} (${r.ffprobe})`);
    probeFfmpegCapabilities(); // logs warnings internally; cached for runtime callers
  } catch (e: any) {
    console.warn(`[startup] ffmpeg capability probe failed: ${e?.message?.slice(0, 120)}`);
  }

  try {
    const { startClaudeRunnerBridge } = await import("./claude-runner");
    const bridgeOk = await startClaudeRunnerBridge();
    if (bridgeOk) {
      console.log("[startup] Claude Runner bridge active — Anthropic models route through your CLI plan quota (Pro/Max). NOT free per-token; counts against your subscription's rolling window.");
    } else {
      console.log("[startup] Claude Runner bridge not available — using standard Anthropic API");
    }
  } catch (err: any) {
    console.log("[startup] Claude Runner init skipped:", err.message?.slice(0, 80));
  }

  // R115.2 +sec — legacy SSE MCP surface (server/mcp-server.ts) is gated behind
  // LEGACY_MCP_ENABLED=1, default OFF. The legacy server authenticates with a
  // SINGLE shared MCP_API_KEY and exposes the FULL 353-tool catalog with no
  // scope discrimination — that's the bypass the R113.7+sec scope-restricted
  // /mcp surface was designed to replace. Default-disable closes the legacy
  // bypass; flip the env flag if a legacy MCP client still depends on it.
  // The new Streamable HTTP MCP at POST /mcp (server/routes/mcp-server.ts) is
  // always enabled and is the supported integration surface for external
  // clients (Claude Desktop, Cursor, custom agents).
  if (process.env.LEGACY_MCP_ENABLED === "1") {
    try {
      const { registerMcpRoutes } = await import("./mcp-server");
      registerMcpRoutes(app);
      console.warn(`[startup] LEGACY MCP routes ENABLED via LEGACY_MCP_ENABLED=1 — /api/mcp/sse + /api/mcp/messages exposing full tool catalog with single-key auth. Migrate to /mcp (Streamable HTTP, per-tenant keys + scopes) and unset the flag.`);
    } catch (e: any) {
      console.warn(`[startup] LEGACY MCP server registration skipped: ${e.message?.slice(0, 80)}`);
    }
  } else {
    console.log(`[startup] legacy MCP surface DISABLED (set LEGACY_MCP_ENABLED=1 to re-enable). New scope-restricted MCP at POST /mcp remains active.`);
  }

  await registerRoutes(httpServer, app);

  // Warm up Magika file-type detector in the background so the first upload
  // doesn't pay the model-load latency. Failures are non-fatal — uploads still
  // work, validation just becomes a no-op until the model loads later.
  import("./file-detector").then(({ warmupMagika }) => {
    warmupMagika().catch(() => {});
  }).catch(() => {});


  try {
    const { processMessage } = await import("./chat-engine");
    const { registerProcessMessage } = await import("./heartbeat");
    registerProcessMessage(processMessage);
  } catch (e: any) {
    console.warn(`[startup] Failed to register processMessage for delegation: ${e.message}`);
  }

  // R53.D — Rehydrate in-flight task state from agent_runs so a server
  // restart doesn't blank out the TASK STATE TRACKER prompt section for any
  // conversation that had a still-running run. Architect-flagged: AWAIT this
  // (was fire-and-forget) so a request that arrives in the first 2-5s after
  // boot can't outrun rehydration and clobber a recovered TaskState by
  // creating a fresh empty one. Non-fatal — failure logs and continues.
  try {
    const { rehydrateTaskStateOnBoot } = await import("./felix-brain");
    await rehydrateTaskStateOnBoot();
  } catch (e: any) {
    console.warn(`[startup] taskState rehydration failed: ${e?.message}`);
  }

  // R111 — Recover stale video jobs from DB. Any row in queued/rendering/concating
  // with updated_at older than 2 minutes (well past the 5-min per-chapter timeout
  // for whatever was in flight) is marked failed with a clear error message, so
  // the /jobs dashboard shows the truth instead of a phantom "still rendering".
  try {
    const { recoverStaleVideoJobs, armPeriodicRecoverySweeper } = await import("./video-job-runner");
    const r = await recoverStaleVideoJobs();
    if (r.recovered > 0) console.log(`[startup] video-jobs recovery: ${r.recovered} stale jobs marked failed`);
    // R111 architect fix — periodic 60s sweeper post-boot catches in-process
    // runner deaths (e.g. uncaught throw in renderChapter) where the HTTP
    // server kept serving but the runner stopped writing state.
    armPeriodicRecoverySweeper();
    // R111.2 architect fix — bound failed-job quarantine dir so it can't fill
    // the disk. Prunes by age (default 14d) AND total bytes (default 5GiB),
    // oldest first. Initial prune runs immediately, then every 6h.
    const { armQuarantineRetentionSweeper } = await import("./mpeg-engine");
    armQuarantineRetentionSweeper();
  } catch (e: any) {
    console.warn(`[startup] video-jobs recovery failed: ${e?.message}`);
  }

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    // Stay-online safety net: if a server-side error escapes on a browser page
    // navigation (GET wanting HTML), serve the cached SPA shell from RAM instead
    // of a dead error page. The app boots and the client retries its API calls,
    // so a transient backend fault (e.g. overlayFS EIO) never blanks the site.
    // EXCLUDE /api and /uploads: a browser GET to those carries Accept:text/html
    // too, and masking their real 500 as a 200 HTML shell would feed callers an
    // HTML document where they expect a JSON error / a file (broken-contract).
    const isAppNavigation = !req.path.startsWith("/api/") && !req.path.startsWith("/uploads/");
    if (status >= 500 && req.method === "GET" && isAppNavigation && (req.headers.accept || "").includes("text/html")) {
      const shell = getCachedIndexHtml();
      if (shell) {
        // HTTP 200 hides this from status-code uptime monitors, so log it loudly
        // for rate alarms — the x-app-shell-fallback header is the wire signal.
        console.warn(`[stay-online] SPA shell fallback served for ${req.method} ${req.path} (underlying status ${status})`);
        res.status(200);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("ETag", shell.etag);
        res.setHeader("x-app-shell-fallback", "1");
        return res.end(shell.buf);
      }
    }

    return res.status(status).json({ message: status >= 500 ? "Internal Server Error" : (err.message || "Request failed") });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }
  appReady = true;

  const port = parseInt(process.env.PORT || "5000", 10);

  async function clearPort(p: number) {
    try {
      // R125+13.19+sec1 — wrap operator-controlled spawns with sanitizeSpawnEnv
      // so a loader-hijack env doesn't survive into lsof/kill child processes.
      const { execSync } = await import("node:child_process");
      const { sanitizeSpawnEnv } = await import("./safety/spawn-env-guard");
      const safeEnv = sanitizeSpawnEnv(process.env);
      const pids = execSync(`lsof -ti :${p} 2>/dev/null || true`, { timeout: 5000, env: safeEnv }).toString().trim();
      if (pids) {
        const myPid = process.pid.toString();
        const otherPids = pids.split("\n").filter(pid => pid.trim() && pid.trim() !== myPid);
        if (otherPids.length > 0) {
          log(`Killing ${otherPids.length} process(es) on port ${p}: ${otherPids.join(", ")}`, "startup");
          execSync(`kill -9 ${otherPids.join(" ")} 2>/dev/null || true`, { timeout: 5000, env: safeEnv });
        }
      }
    } catch (e: any) {
      log(`Port clear attempt: ${e.message}`, "startup");
    }
  }

  async function listenWithRetry(retriesLeft: number, backoffMs = 1000) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: any) => { httpServer.removeListener("listening", onListen); reject(err); };
        const onListen = () => { httpServer.removeListener("error", onError); resolve(); };
        httpServer.once("error", onError);
        httpServer.once("listening", onListen);
        httpServer.listen({ port, host: "0.0.0.0" });
      });
      log(`serving on port ${port}`);
    } catch (err: any) {
      if (err.code === "EADDRINUSE" && retriesLeft > 0) {
        log(`Port ${port} in use — attempt ${6 - retriesLeft}/5, clearing and retrying in ${backoffMs}ms...`, "startup");
        await clearPort(port);
        await new Promise(r => setTimeout(r, backoffMs));
        try { httpServer.close(() => {}); } catch (_silentErr) { logSilentCatch("server/index.ts", _silentErr); }
        await listenWithRetry(retriesLeft - 1, Math.min(backoffMs * 1.5, 5000));
      } else if (err.code === "EADDRINUSE") {
        log(`Port ${port} still in use after all retries — doing final aggressive clear...`, "startup");
        await clearPort(port);
        await new Promise(r => setTimeout(r, 3000));
        try { httpServer.close(() => {}); } catch (_silentErr) { logSilentCatch("server/index.ts", _silentErr); }
        await new Promise<void>((resolve, reject) => {
          const onError = (err2: any) => { httpServer.removeListener("listening", onListen); reject(err2); };
          const onListen = () => { httpServer.removeListener("error", onError); resolve(); };
          httpServer.once("error", onError);
          httpServer.once("listening", onListen);
          httpServer.listen({ port, host: "0.0.0.0" });
        });
        log(`serving on port ${port} (after final retry)`);
      } else {
        throw err;
      }
    }
  }
  // R98.26.2 — In production we already bound the port early (above) so the
  // Reserved VM health check passes; skip the retry path here.
  if (!httpServer.listening) {
    await listenWithRetry(5);
  }

  setTimeout(async () => {
    try {
      const { isEmailConfigured, startInboxPolling, provisionAllTenantInboxes, backfillEmptyBodies } = await import("./email");
      if (isEmailConfigured()) {
        await provisionAllTenantInboxes();
        await backfillEmptyBodies();
        startInboxPolling(120000);
      }
    } catch (e: any) {
      log(`Inbox polling startup skipped: ${e.message}`, "startup");
    }
    // R103 — owner-email digest scheduler. Decoupled from inbox-polling try
    // block so a backfill/provision failure can't strand the digest scheduler
    // (architect re-review finding #2).
    try {
      const { startOwnerDigestScheduler } = await import("./owner-email-digest");
      startOwnerDigestScheduler();
    } catch (e: any) {
      log(`Owner digest scheduler startup skipped: ${e.message}`, "startup");
    }
    // R104 — commitment heartbeat scanner. Independent loop; scans active
    // commitments past due_at without recent heartbeats, escalates via
    // owner-email-digest (so it lands in the daily summary, not as a
    // standalone email).
    try {
      const { startCommitmentHeartbeatScanner } = await import("./commitments");
      startCommitmentHeartbeatScanner();
    } catch (e: any) {
      log(`Commitment scanner startup skipped: ${e.message}`, "startup");
    }
  }, 15000);

  // Round 26 — boot recovery for the plan executor. Picks up any plan
  // left in 'approved' (never started) or stuck in 'executing' beyond
  // the staleness window (process died mid-run). Delayed so listen + DB
  // pool are warm.
  // R74.3 — Arm the periodic sweep INDEPENDENTLY of the boot pass so a
  // transient boot-time DB hiccup doesn't permanently disable self-healing.
  // The boot pass is best-effort; the interval is the durable safety net.
  setTimeout(async () => {
    try {
      const { resumeStuckPlans } = await import("./plan-executor");
      await resumeStuckPlans();
    } catch (e: any) {
      log(`Plan executor boot recovery skipped: ${e.message}`, "startup");
    }
  }, 8000);
  log("Periodic stuck-plan sweep armed (every 5 min)", "plan-executor");
  setInterval(async () => {
    try {
      const { resumeStuckPlans: sweep } = await import("./plan-executor");
      const result = await sweep();
      if (result.resumed > 0 || result.restarted > 0) {
        log(`Periodic sweep reclaimed ${result.resumed} approved + ${result.restarted} stuck-executing plan(s)`, "plan-executor");
      }
    } catch (e: any) {
      log(`Periodic stuck-plan sweep failed: ${e.message}`, "plan-executor");
    }
  }, 5 * 60 * 1000);

  // R74.13u — GC committed webhook_events rows older than 14 days every 6h.
  // Keeps the dedupe table from growing unbounded while preserving any
  // in-flight (uncommitted) claims so Stripe/Coinbase retries can re-process.
  setInterval(async () => {
    try {
      const { cleanupOldWebhookEvents } = await import("./webhook-dedupe");
      const removed = await cleanupOldWebhookEvents(14);
      if (removed > 0) log(`Webhook dedupe GC removed ${removed} old row(s)`, "webhook-dedupe");
    } catch (e: any) {
      log(`Webhook dedupe GC failed: ${e.message}`, "webhook-dedupe");
    }
  }, 6 * 60 * 60 * 1000);

  // Weekly maintenance scheduler — runs the dependency/security/health sweep
  // every 7 days from boot, emails owner with the triaged summary. First run
  // fires 60s after boot so dev restarts don't hammer it.
  try {
    const { startWeeklyMaintenanceScheduler } = await import("./weekly-maintenance-cron");
    startWeeklyMaintenanceScheduler();
  } catch (e: any) {
    log(`Weekly maintenance scheduler failed to start: ${e.message}`, "weekly-maintenance");
  }

  // Built With Bob — autonomous weekly recap scheduler. Disarmed unless
  // BWB_WEEKLY_ENABLED=1. Spawns the orchestrator (discover this week's Shorts →
  // synthesize one ~5-min weekly story in Bob's Fish voice → deliver →
  // approval-first email OR autopublish) every 7 days from boot.
  try {
    const { startBwbWeeklyScheduler } = await import("./bwb-weekly-cron");
    startBwbWeeklyScheduler();
  } catch (e: any) {
    log(`BWB weekly scheduler failed to start: ${e.message}`, "bwb-weekly");
  }

  // Nightly memory backup — dumps memory_entries to Drive once per day,
  // 30-day retention, emails owner only on failure. Insurance against any
  // accidental UPDATE/DELETE wiping the memory graph.
  try {
    const { startNightlyMemoryBackupScheduler } = await import("./nightly-memory-backup-cron");
    startNightlyMemoryBackupScheduler();
  } catch (e: any) {
    log(`Nightly memory backup scheduler failed to start: ${e.message}`, "memory-backup");
  }

  // R60 — Durable agent job queue worker. Start after DB pool is warm.
  // Drains agent_jobs (research post-proc, digest generation — more
  // subsystems to follow). Boot tick reclaims any expired-lease jobs
  // stranded by the previous process.
  setTimeout(async () => {
    try {
      const { startJobWorker } = await import("./job-worker");
      startJobWorker();
      // R60.B — Filesystem spool drainer: rescues jobs spooled to disk while
      // the DB was unavailable. Boot pass runs immediately; periodic pass
      // every 5 min catches anything written during a later DB outage.
      const { startSpoolDrainer } = await import("./job-spool");
      startSpoolDrainer();
    } catch (e: any) {
      log(`Job worker failed to start: ${e.message}`, "startup");
    }
  }, 9000);

  // Round 29 — start the in-process watchdog. Scans every 30s for
  // registered inflight operations past their hard cap (force-cancels
  // them via AbortController) and for orphan heartbeat tasks (>30 min
  // in activeTaskTracker — typically left behind by a worker that
  // died mid-task).
  setTimeout(async () => {
    try {
      const { startWatchdog } = await import("./process-watchdog");
      startWatchdog(30_000);
    } catch (e: any) {
      log(`Process watchdog start skipped: ${e.message}`, "startup");
    }
  }, 9000);

  // R59 — Tool Curator: precompute embeddings for every registered tool's
  // description+hint corpus so the router's semantic-fallback path is warm
  // by the time real traffic arrives. Cache file is content-hashed so this
  // is a no-op on subsequent boots unless tool descriptions changed.
  setTimeout(async () => {
    try {
      const { precomputeEmbeddings } = await import("./tool-curator");
      const { getAllToolDefinitions } = await import("./tools");
      const defs = await getAllToolDefinitions();
      const stats = await precomputeEmbeddings(defs);
      log(`Tool curator embeddings: ${stats.generated} new, ${stats.reused} cached, ${stats.failed} failed`, "startup");
    } catch (e: any) {
      log(`Tool curator embeddings precompute skipped: ${e.message}`, "startup");
    }
  }, 12000);

  // R65 — Dormant-tool auto-deprecation. Engine kept in place behind admin
  // endpoints (/api/admin/dormant-tools/{preview,apply,clear}) for future
  // manual curation, but the automatic scheduler is DISABLED by owner
  // decision (Apr 23, 2026): "we have them available for them when they
  // get into situations when it's called for." Tools cost real time/money
  // to build — keep them all visible to the agents until we have evidence
  // a specific one is genuinely dead, then handle it manually. Set
  // ENABLE_DORMANT_AUTO_DEPRECATION=true to re-arm.
  if (process.env.ENABLE_DORMANT_AUTO_DEPRECATION === "true") {
    setTimeout(async () => {
      try {
        const { rehydrateAutoDeprecationsFromDisk, startAutoDeprecationScheduler } = await import("./dormant-deprecation");
        const { restored } = rehydrateAutoDeprecationsFromDisk();
        startAutoDeprecationScheduler();
        log(`Dormant-deprecation: ${restored} prior auto-deprecation(s) restored, scheduler armed (ENABLE_DORMANT_AUTO_DEPRECATION=true)`, "startup");
      } catch (e: any) {
        log(`Dormant-deprecation startup skipped: ${e.message}`, "startup");
      }
    }, 14000);
  } else {
    log("Dormant-deprecation: scheduler DISABLED by owner policy. All tools remain visible to agents. Set ENABLE_DORMANT_AUTO_DEPRECATION=true to re-arm.", "startup");
  }

  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received — starting graceful shutdown`, "shutdown");

    try {
      const { stopHeartbeat } = await import("./heartbeat");
      stopHeartbeat();
      log("Heartbeat stopped", "shutdown");
    } catch (_silentErr) { logSilentCatch("server/index.ts", _silentErr); }

    try {
      const { stopInboxPolling } = await import("./email");
      stopInboxPolling();
      log("Inbox polling stopped", "shutdown");
    } catch (_silentErr) { logSilentCatch("server/index.ts", _silentErr); }

    try {
      const { stopAutoTokenRefresh, stopOAuthRefreshLoop } = await import("./oauth-subscriptions");
      stopAutoTokenRefresh();
      stopOAuthRefreshLoop();
      log("Token refresh loops stopped", "shutdown");
    } catch (_silentErr) { logSilentCatch("server/index.ts", _silentErr); }

    try {
      const { stopDriveTokenRefreshLoop } = await import("./google-drive");
      stopDriveTokenRefreshLoop();
      log("Drive refresh loop stopped", "shutdown");
    } catch (_silentErr) { logSilentCatch("server/index.ts", _silentErr); }

    try {
      const { stopAutoTuner } = await import("./auto-tuner");
      stopAutoTuner();
      log("Auto-tuner stopped", "shutdown");
    } catch (_silentErr) { logSilentCatch("server/index.ts", _silentErr); }

    try {
      const { stopAutoConsolidation } = await import("./auto-consolidation");
      stopAutoConsolidation();
      log("Auto-consolidation stopped", "shutdown");
    } catch (_silentErr) { logSilentCatch("server/index.ts", _silentErr); }

    httpServer.close(() => {
      log("HTTP server closed", "shutdown");
    });

    setTimeout(async () => {
      try {
        const { pool } = await import("./db");
        await pool.end();
        log("DB pool drained", "shutdown");
      } catch (_silentErr) { logSilentCatch("server/index.ts", _silentErr); }
      process.exit(0);
    }, 10000);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
})();
