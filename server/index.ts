import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
// v5.1.1 — per-tenant WhatsApp, Coinbase, research engine

import fs from "fs";
(function ensureGitPushScript() {
  const scriptPath = "/tmp/push-gh.sh";
  if (fs.existsSync(scriptPath)) return;
  const script = `#!/bin/bash
set -e
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
GITHUB_TOKEN_VAL="\${GITHUB_PERSONAL_ACCESS_TOKEN_2:-\${GITHUB_TOKEN}}"
if [ -z "\$GITHUB_TOKEN_VAL" ]; then echo "No GITHUB_TOKEN"; exit 0; fi
GITHUB_REPO_VAL="\${GITHUB_REPO:-}"
if [ -z "\$GITHUB_REPO_VAL" ]; then echo "No GITHUB_REPO set"; exit 0; fi
GIT_ASKPASS="" git push "https://\${GITHUB_TOKEN_VAL}@github.com/\${GITHUB_REPO_VAL}.git" main 2>&1
echo "[push] Done"
`;
  try { fs.writeFileSync(scriptPath, script, { mode: 0o755 }); } catch {}
})();

(function ensurePublicPushScript() {
  const scriptPath = "/tmp/push-public.sh";
  if (fs.existsSync(scriptPath)) return;
  const script = `#!/bin/bash
set -e
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
GITHUB_TOKEN_VAL="\${GITHUB_PERSONAL_ACCESS_TOKEN_2:-\${GITHUB_TOKEN}}"
if [ -z "$GITHUB_TOKEN_VAL" ]; then echo "No GITHUB_TOKEN"; exit 1; fi
git remote add origin "https://\${GITHUB_TOKEN_VAL}@github.com/\${PUBLIC_REPO}.git"
GIT_ASKPASS="" git push -f origin main 2>&1
echo "[public-push] Done — https://github.com/\${PUBLIC_REPO}"
cd /home/runner/workspace
rm -rf /tmp/visionclaw-public
`;
  try { fs.writeFileSync(scriptPath, script, { mode: 0o755 }); } catch {}
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

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []), "https://js.stripe.com", "https://accounts.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      connectSrc: ["'self'", "https://api.openai.com", "https://api.anthropic.com", "https://generativelanguage.googleapis.com", "https://api.x.ai", "https://openrouter.ai", "https://api.perplexity.ai", "https://api.elevenlabs.io", "https://api.stripe.com", "https://api.commerce.coinbase.com", "https://r.jina.ai", "https://api.firecrawl.dev", "https://ip-api.com", "https://api.open-meteo.com", "https://geocoding-api.open-meteo.com", "https://accounts.google.com", "https://www.googleapis.com", "wss:", "ws:"],
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
      console.error('Webhook error:', error.message);
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
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

app.use(express.urlencoded({ extended: false }));

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
        await runMigrations({ databaseUrl, schema: 'stripe' });
        console.log('[stripe] Schema ready');

        const stripeSync = await getStripeSync();
        const replitDomains = process.env.REPLIT_DOMAINS;
        if (replitDomains) {
          const webhookBaseUrl = `https://${replitDomains.split(',')[0]}`;
          try {
            const result = await stripeSync.findOrCreateManagedWebhook(
              `${webhookBaseUrl}/api/stripe/webhook`
            );
            if (result?.webhook?.url) {
              console.log(`[stripe] Webhook configured: ${result.webhook.url}`);
            } else {
              console.log('[stripe] Webhook setup returned no endpoint — will retry on next restart');
            }
          } catch (whErr: any) {
            console.log(`[stripe] Webhook setup skipped: ${whErr.message}`);
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

  if (process.env.NODE_ENV === "production") {
    setTimeout(async () => {
      try {
        const { initPgVector } = await import("./embeddings");
        await initPgVector();
      } catch (err: any) {
        console.log("[pgvector] Init skipped:", err.message?.substring(0, 80));
      }
    }, 10000);
  }

  const { setupAuth, registerAuthRoutes } = await import("./replit_integrations/auth");
  await setupAuth(app);
  registerAuthRoutes(app);

  try {
    const { startClaudeRunnerBridge } = await import("./claude-runner");
    const bridgeOk = await startClaudeRunnerBridge();
    if (bridgeOk) {
      console.log("[startup] Claude Runner bridge active — Anthropic models routed through CLI (Max plan, $0 cost)");
    } else {
      console.log("[startup] Claude Runner bridge not available — using standard Anthropic API");
    }
  } catch (err: any) {
    console.log("[startup] Claude Runner init skipped:", err.message?.slice(0, 80));
  }

  try {
    const { registerMcpRoutes } = await import("./mcp-server");
    registerMcpRoutes(app);
  } catch (e: any) {
    console.warn(`[startup] MCP server registration skipped: ${e.message?.slice(0, 80)}`);
  }

  await registerRoutes(httpServer, app);


  try {
    const { processMessage } = await import("./chat-engine");
    const { registerProcessMessage } = await import("./heartbeat");
    registerProcessMessage(processMessage);
  } catch (e: any) {
    console.warn(`[startup] Failed to register processMessage for delegation: ${e.message}`);
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
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

  const port = parseInt(process.env.PORT || "5000", 10);

  async function clearPort(p: number) {
    try {
      const { execSync } = await import("node:child_process");
      const pids = execSync(`lsof -ti :${p} 2>/dev/null || true`, { timeout: 5000 }).toString().trim();
      if (pids) {
        const myPid = process.pid.toString();
        const otherPids = pids.split("\n").filter(pid => pid.trim() && pid.trim() !== myPid);
        if (otherPids.length > 0) {
          log(`Killing ${otherPids.length} process(es) on port ${p}: ${otherPids.join(", ")}`, "startup");
          execSync(`kill -9 ${otherPids.join(" ")} 2>/dev/null || true`, { timeout: 5000 });
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
        try { httpServer.close(() => {}); } catch {}
        await listenWithRetry(retriesLeft - 1, Math.min(backoffMs * 1.5, 5000));
      } else if (err.code === "EADDRINUSE") {
        log(`Port ${port} still in use after all retries — doing final aggressive clear...`, "startup");
        await clearPort(port);
        await new Promise(r => setTimeout(r, 3000));
        try { httpServer.close(() => {}); } catch {}
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
  await listenWithRetry(5);

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
  }, 15000);

  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received — starting graceful shutdown`, "shutdown");

    try {
      const { stopHeartbeat } = await import("./heartbeat");
      stopHeartbeat();
      log("Heartbeat stopped", "shutdown");
    } catch {}

    try {
      const { stopInboxPolling } = await import("./email");
      stopInboxPolling();
      log("Inbox polling stopped", "shutdown");
    } catch {}

    try {
      const { stopAutoTokenRefresh, stopOAuthRefreshLoop } = await import("./oauth-subscriptions");
      stopAutoTokenRefresh();
      stopOAuthRefreshLoop();
      log("Token refresh loops stopped", "shutdown");
    } catch {}

    try {
      const { stopDriveTokenRefreshLoop } = await import("./google-drive");
      stopDriveTokenRefreshLoop();
      log("Drive refresh loop stopped", "shutdown");
    } catch {}

    httpServer.close(() => {
      log("HTTP server closed", "shutdown");
    });

    setTimeout(async () => {
      try {
        const { pool } = await import("./db");
        await pool.end();
        log("DB pool drained", "shutdown");
      } catch {}
      process.exit(0);
    }, 10000);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
})();
