// R74.13l Stage 7 — admin routes extracted from server/routes.ts. 24 handlers
// covering: health-audit, claude-runner, service-orders policy + review queue
// (list/get/file/approve/reject), replay-research-proposals, cost-audit,
// stuck diagnostics, tenants list+update+reset-usage, data-protection backups
// (backup-tenant, backup-conversation, purge-expired), concurrency observability,
// tool-curator status, dormant-tools (preview/apply/clear), silent-failures.
//
// Pure move — zero behavior change. Auth pattern preserved verbatim from
// routes.ts: most routes use the explicit `tenantId !== ADMIN_TENANT_ID
// || !isAdminRequest(req)` check (functionally equivalent to
// requirePlatformAdmin but kept verbatim to honor the no-fix-during-refactor
// rule). The 3 data-protection routes use the canonical requirePlatformAdmin
// helper as they did pre-extraction.
import { type Express, type Request, type Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { validate, adminTenantUpdateSchema } from "../validation";

type AdminHelpers = {
  authMiddleware: any;
  getTenantFromRequest: (req: Request) => number | null;
  isAdminRequest: (req: Request) => boolean;
  ADMIN_TENANT_ID: number;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
};

export function registerAdminRoutes(app: Express, helpers: AdminHelpers) {
  const { authMiddleware, getTenantFromRequest, isAdminRequest, ADMIN_TENANT_ID, requirePlatformAdmin } = helpers;

  // R70 — Health audit endpoint (admin only). Surfaces stale plans, orphan
  // modules, route orphans, browser-action symmetry breaks, and stale
  // proposals/heartbeats. POST /api/admin/health-audit?apply=1 to also archive.
  app.get("/api/admin/health-audit", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const { runFullAudit } = await import("../health-audit");
      const apply = String(req.query.apply || "") === "1";
      const report = await runFullAudit({ apply });
      res.json(report);
    } catch (err: any) {
      console.error("[health-audit] route failed:", err);
      res.status(500).json({ error: err?.message || "audit failed" });
    }
  });

  app.get("/api/admin/claude-runner", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const { isClaudeRunnerAvailable, getClaudeRunnerStats } = await import("../claude-runner");
      res.json({
        available: isClaudeRunnerAvailable(),
        ...getClaudeRunnerStats(),
        description: "Routes Anthropic models through Claude Code CLI — uses your Anthropic plan quota (Pro or Max), NOT per-token API billing. Counts against subscription's rolling quota window."
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // SERVICE-PRODUCT REVIEW QUEUE — admin-only endpoints used by the
  // /admin/service-orders page. Every service-product order (e.g. the
  // Custom AI Research Report) lands here AFTER generation but BEFORE
  // delivery, so Bob can proofread the PDF and confirm the download
  // link works before any customer-facing email is sent.
  // ──────────────────────────────────────────────────────────────────────
  app.get("/api/admin/service-orders/policy", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const { listAllPolicies, getSkuStats, getAutoShipPolicy } = await import("../service-review-queue");
      const { listSkus, lookupProduct } = await import("../product-catalog");
      // Surface every service-product SKU known to the catalog, with its
      // current stats and policy. Static products are excluded — they
      // already auto-ship by definition.
      const out: any[] = [];
      for (const sku of listSkus()) {
        const p = lookupProduct(sku);
        if (!p || p.kind !== 'service') continue;
        out.push({
          sku,
          productName: p.productName,
          stats: getSkuStats(sku),
          policy: getAutoShipPolicy(sku),
        });
      }
      // Plus any orphan policies (SKU was removed from catalog after enabling)
      const seen = new Set(out.map(o => o.sku));
      for (const pol of listAllPolicies()) {
        if (!seen.has(pol.sku)) {
          out.push({ sku: pol.sku, productName: '(removed from catalog)', stats: getSkuStats(pol.sku), policy: pol });
        }
      }
      res.json({ policies: out });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/service-orders/policy/:sku", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const { setAutoShipPolicy, getSkuStats, getAutoShipPolicy } = await import("../service-review-queue");
      const { lookupProduct } = await import("../product-catalog");
      const sku = req.params.sku as string;
      const product = lookupProduct(sku);
      if (!product || product.kind !== 'service') {
        return res.status(404).json({ error: "Unknown service SKU" });
      }
      const { enabled, threshold } = req.body || {};
      const current = getAutoShipPolicy(sku);
      const stats = getSkuStats(sku);
      // Guard: refuse to enable if the threshold isn't met. Frontend should
      // already grey out the toggle, but we enforce it server-side too so a
      // direct API caller can't bypass the gate. Use the since-reset counts
      // so a SKU can earn auto-ship back after an investigated broken ship.
      if (enabled === true) {
        const wantedThreshold = (threshold && threshold > 0) ? Math.floor(threshold) : current.threshold;
        if (stats.cleanShipsSinceReset < wantedThreshold) {
          return res.status(400).json({ error: `Cannot enable: only ${stats.cleanShipsSinceReset}/${wantedThreshold} clean ships since last reset` });
        }
        if (stats.brokenShipsSinceReset > 0) {
          return res.status(400).json({ error: `Cannot enable: ${stats.brokenShipsSinceReset} broken ship(s) since last reset` });
        }
      }
      const next = await setAutoShipPolicy(sku, { enabled, threshold });
      console.log(`[service-review] Policy update sku=${sku} enabled=${next.enabled} threshold=${next.threshold} by admin`);
      res.json({ ok: true, policy: next, stats });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Replay historical high-value research findings through the code-proposal pipeline.
  // Idempotent — uses research_experiments.replayed_at to skip already-processed rows.
  // POST /api/admin/replay-research-proposals?min_score=8&limit=200&dry_run=1
  app.post("/api/admin/replay-research-proposals", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      // Defense-in-depth: tenant-scope AND session must carry isAdmin=true.
      // Tenant-only check would let any non-admin session in tenant 1 trigger replay.
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) {
        return res.status(403).json({ error: "Admin access required" });
      }
      const minScore = Math.max(1, Math.min(10, parseInt((req.query.min_score as string) || "8", 10)));
      const limit = Math.max(1, Math.min(500, parseInt((req.query.limit as string) || "200", 10)));
      const dryRun = req.query.dry_run === "1" || req.query.dry_run === "true";
      const { replayHighValueFindings } = await import("../research-engine");
      const summary = await replayHighValueFindings({ minScore, limit, tenantId, dryRun });
      console.log(`[replay] minScore=${minScore} limit=${limit} dry=${dryRun} → scanned=${summary.scanned} attempted=${summary.attempted} created=${summary.proposalsCreated} skippedNoMap=${summary.skippedNoMapping} skippedNoCode=${summary.skippedNoCode} errors=${summary.errors.length} (${summary.durationMs}ms)`);
      res.json({ ok: true, ...summary });
    } catch (err: any) {
      console.error(`[replay] FAILED: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/service-orders", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const { listReviewItems } = await import("../service-review-queue");
      const status = (req.query.status as string) || undefined;
      const items = listReviewItems(status ? { status: status as any } : undefined);
      // Strip the review tokens from the listing response — they are
      // sensitive (per-item bearer-style links emailed to the owner).
      const safe = items.map(({ reviewToken, ...rest }) => rest);
      res.json({ items: safe });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/service-orders/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const { getReviewItem } = await import("../service-review-queue");
      const item = getReviewItem((req.params.id as string));
      if (!item) return res.status(404).json({ error: "Not found" });
      const { reviewToken: _t, ...safe } = item;
      res.json({ item: safe });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/service-orders/:id/file", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const { getReviewItem } = await import("../service-review-queue");
      const item = getReviewItem((req.params.id as string));
      if (!item) return res.status(404).json({ error: "Not found" });
      const path = await import("path");
      const fs = await import("fs");
      const ALLOWED = path.resolve(process.cwd(), "uploads");
      const abs = path.isAbsolute(item.filePath) ? path.resolve(item.filePath) : path.resolve(process.cwd(), item.filePath);
      // Strict directory-boundary check. Plain `startsWith(ALLOWED)` would
      // accept e.g. `/home/runner/workspace/uploads-evil/x.pdf`. Require
      // either an exact match or that the next char is the path separator.
      if (abs !== ALLOWED && !abs.startsWith(ALLOWED + path.sep)) {
        return res.status(400).json({ error: "Invalid path" });
      }
      if (!fs.existsSync(abs)) return res.status(404).json({ error: "File missing on disk" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${item.fileName}"`);
      fs.createReadStream(abs).pipe(res);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/service-orders/:id/approve", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const { getReviewItem, updateReviewItem } = await import("../service-review-queue");
      const item = getReviewItem((req.params.id as string));
      if (!item) return res.status(404).json({ error: "Not found" });
      if (item.status === "shipped") {
        return res.status(409).json({ error: "Already shipped", deliveryId: item.deliveryId });
      }
      if (item.status === "rejected") {
        return res.status(409).json({ error: "Order is rejected — cannot approve" });
      }
      if (!item.filePath || !item.fileName) {
        return res.status(400).json({ error: "Item has no generated file to ship" });
      }
      const { deliverDigitalProduct } = await import("../delivery-pipeline");
      // Use the same paymentKey shape the webhook uses (`cs_<session>` when
      // no payment_intent), so the delivery-pipeline dedupe table treats
      // this as the same payment as a future Stripe replay or auto-ship
      // attempt for the same checkout. Prevents double-delivery if the
      // approve button is clicked while a webhook retry is in-flight.
      const stripePaymentId = `cs_${item.sessionId}`;
      const result = await deliverDigitalProduct({
        customerName: item.customerName,
        customerEmail: item.customerEmail,
        productName: item.productName,
        filePath: item.filePath,
        fileName: item.fileName,
        mimeType: "application/pdf",
        orderId: item.sessionId,
        stripePaymentId,
        sendEmail: true,
        metadata: { sku: item.sku, reviewItemId: item.id, source: 'service-review-queue' },
      });
      if (!result.success) {
        await updateReviewItem(item.id, {
          status: 'failed',
          rejectedReason: `Delivery failed: ${result.error || 'unknown'}`,
          reviewedAt: new Date().toISOString(),
        });
        return res.status(500).json({ error: result.error || 'Delivery failed', deliveryResult: result });
      }
      const updated = await updateReviewItem(item.id, {
        status: 'shipped',
        reviewedAt: new Date().toISOString(),
        deliveryId: result.deliveryId,
        deliveryLinkVerified: result.linkVerified,
      });
      console.log(`[service-review] Approved & shipped ${item.id} → delivery ${result.deliveryId} linkVerified=${result.linkVerified}`);
      const { reviewToken: _t, ...safe } = updated || item;
      res.json({ ok: true, item: safe, delivery: { id: result.deliveryId, linkVerified: result.linkVerified, downloadLink: result.downloadLink, emailSent: result.emailSent } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/service-orders/:id/reject", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const { getReviewItem, updateReviewItem } = await import("../service-review-queue");
      const item = getReviewItem((req.params.id as string));
      if (!item) return res.status(404).json({ error: "Not found" });
      if (item.status === "shipped") {
        return res.status(409).json({ error: "Already shipped — cannot reject" });
      }
      const reason = String(req.body?.reason || "").slice(0, 500) || "Rejected by reviewer";
      const updated = await updateReviewItem(item.id, {
        status: 'rejected',
        reviewedAt: new Date().toISOString(),
        rejectedReason: reason,
      });
      console.log(`[service-review] Rejected ${item.id}: ${reason}`);
      const { reviewToken: _t, ...safe } = updated || item;
      res.json({ ok: true, item: safe });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/cost-audit", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const days = Math.min(90, Math.max(1, parseInt((req.query.days as string) || "7", 10)));
      const { getCostSummary, getRevenueVsCost } = await import("../agentic/cost-ledger");
      const [costs, revenue] = await Promise.all([
        getCostSummary(tenantId, days),
        getRevenueVsCost(tenantId, days),
      ]);
      res.json({
        backgroundFreeTierOnly: process.env.BACKGROUND_FREE_TIER_ONLY === "true",
        claudeRunner: (await import("../claude-runner")).isClaudeRunnerAvailable(),
        notice: "costUsd is an ESTIMATE based on per-token list pricing. OAuth/Runner lanes consume your subscription quota and incur $0 per-token API spend, but show non-zero estimated cost here.",
        costs,
        revenue,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/diagnostics/stuck", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const { inspectDiagnostics, getRecentPatterns } = await import("../stuck-diagnostics");
      const report = await inspectDiagnostics();
      const recentPatterns = getRecentPatterns(Date.now() - 30 * 60 * 1000);
      res.json({ ...report, recentPatterns });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/tenants", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });
      const result = await db.execute(sql`
        SELECT id, name, email, plan, is_active, created_at, email_verified,
               trial_conversations_used, trial_max_conversations,
               stripe_customer_id, stripe_subscription_id,
               account_status, deletion_scheduled_at,
               vanity_slug
        FROM tenants ORDER BY id ASC
      `);
      const rows = (result as any).rows || result;
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/tenants/:id", authMiddleware, validate(adminTenantUpdateSchema), async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });

      const targetId = parseInt(req.params.id as string);
      if (isNaN(targetId)) return res.status(400).json({ error: "Invalid tenant ID" });

      const { plan, unlimited, trialMaxConversations, isActive } = req.body;

      const updates: string[] = [];

      if (plan !== undefined) {
        const validPlans = ["trial", "starter", "starter-byok", "pro", "pro-byok", "enterprise", "enterprise-byok", "admin"];
        if (!validPlans.includes(plan)) return res.status(400).json({ error: "Invalid plan" });
        await db.execute(sql`UPDATE tenants SET plan = ${plan} WHERE id = ${targetId}`);
        updates.push(`plan → ${plan}`);
      }

      if (unlimited !== undefined) {
        const maxConvs = unlimited ? 999999 : (trialMaxConversations || 5);
        await db.execute(sql`UPDATE tenants SET trial_max_conversations = ${maxConvs} WHERE id = ${targetId}`);
        updates.push(`unlimited → ${unlimited} (max: ${maxConvs})`);
      } else if (trialMaxConversations !== undefined) {
        await db.execute(sql`UPDATE tenants SET trial_max_conversations = ${trialMaxConversations} WHERE id = ${targetId}`);
        updates.push(`trialMaxConversations → ${trialMaxConversations}`);
      }

      if (isActive !== undefined) {
        await db.execute(sql`UPDATE tenants SET is_active = ${isActive} WHERE id = ${targetId}`);
        updates.push(`isActive → ${isActive}`);
      }

      console.log(`[admin] Updated tenant ${targetId}: ${updates.join(", ")}`);
      res.json({ success: true, updates });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/tenants/:id/reset-usage", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin access required" });

      const targetId = parseInt(req.params.id as string);
      if (isNaN(targetId)) return res.status(400).json({ error: "Invalid tenant ID" });

      await db.execute(sql`UPDATE tenants SET trial_conversations_used = 0 WHERE id = ${targetId}`);
      console.log(`[admin] Reset usage for tenant ${targetId}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Data-protection backups (R74.13l Stage 7 — these 3 routes use the
  // canonical requirePlatformAdmin helper which writes 403 itself, vs.
  // the verbose tenantId+isAdminRequest pattern used by the rest of this
  // module. Behavior is identical; preserved verbatim.
  // ──────────────────────────────────────────────────────────────────────
  app.post("/api/admin/backup-tenant", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const { tenantId } = req.body;
    if (!tenantId) return res.status(400).json({ error: "tenantId required" });
    try {
      const { backupTenantDataToDrive } = await import("../data-protection");
      const result = await backupTenantDataToDrive(tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/backup-conversation", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const { conversationId, tenantId } = req.body;
    if (!conversationId || !tenantId) return res.status(400).json({ error: "conversationId and tenantId required" });
    try {
      const { backupConversationToDrive } = await import("../data-protection");
      const result = await backupConversationToDrive(conversationId, tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/purge-expired", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { permanentlyPurgeSoftDeleted } = await import("../data-protection");
      const result = await permanentlyPurgeSoftDeleted();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // R58 — concurrency budget observability. Surfaces all in-flight task
  // counters in one place so the owner can spot pool pressure (heartbeat
  // tasks + research sessions + plan executor + background tasks all
  // share the 30-conn DB pool). No scheduling change — read-only view.
  app.get("/api/admin/concurrency", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const [{ getActiveSessionCount }, { getPlanExecutorStats }, { getHeartbeatStats }] = await Promise.all([
        import("../research-engine"),
        import("../plan-executor"),
        import("../heartbeat"),
      ]);
      res.json({
        research: { activeSessions: getActiveSessionCount(), maxConcurrent: 6 },
        plans: getPlanExecutorStats(),
        heartbeat: getHeartbeatStats(),
        dbPool: { max: 30, note: "see server/db.ts pool config" },
        timestamp: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // R63.15 — Admin observability: surfaces silent-failure conditions that
  // otherwise live only in console logs. Cross-references the in-process tool
  // registry against tool_performance, finds tools with poor recent ratios,
  // surfaces self_heal insights stuck in 'new' (auto-apply routing broken),
  // and lists disabled heartbeat tasks. Read-only, admin-gated.
  // R59 — Tool Curator status. Surfaces hint coverage, embedding cache
  // health, deprecation count, and a sample of curator-driven routing
  // decisions. Read-only, admin-gated.
  app.get("/api/admin/tool-curator-status", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const { getCuratorStats, semanticRank, matchHintsToMessage, rankByPerformance } = await import("../tool-curator");
      const { getAllToolDefinitions } = await import("../tools");
      const { TOOL_USAGE_HINTS } = await import("../tool-usage-hints");
      const stats = getCuratorStats();
      const defs = await getAllToolDefinitions();
      const totalRegistered = defs.length;
      const probe = String(req.query.probe || "").trim();
      let probeResult: any = null;
      if (probe) {
        const hintMatches = matchHintsToMessage(probe);
        const semantic = await semanticRank(probe, { topK: 8 });
        probeResult = {
          query: probe,
          hintMatches: [...hintMatches.entries()].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score),
          semanticTop: semantic,
        };
      }
      res.json({
        ...stats,
        totalRegistered,
        hintCoveragePct: Math.round((stats.hintedTools / Math.max(1, totalRegistered)) * 100),
        embeddingsCoveragePct: Math.round((stats.embeddingsCached / Math.max(1, totalRegistered)) * 100),
        hintedToolNames: Object.keys(TOOL_USAGE_HINTS),
        probe: probeResult,
        timestamp: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // R65 — Dormant-tool auto-deprecation admin surface.
  // GET preview: shows what WOULD be auto-deprecated (no side effects, no auth-data exposure).
  // POST apply: actually mutates SOFT_DEPRECATED_TOOLS. Pass ?force=true to bypass the traffic gate.
  // POST clear: removes ALL auto-deprecations (preserves any hand-curated entries).
  app.get("/api/admin/dormant-tools/preview", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const { previewDormantDeprecations } = await import("../dormant-deprecation");
      const preview = await previewDormantDeprecations();
      res.json({ ...preview, timestamp: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/dormant-tools/apply", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const { applyDormantDeprecations } = await import("../dormant-deprecation");
      const force = req.query.force === "true" || req.body?.force === true;
      const result = await applyDormantDeprecations({ force });
      res.json({ ...result, timestamp: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/dormant-tools/clear", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const { clearAllAutoDeprecations } = await import("../dormant-deprecation");
      const result = await clearAllAutoDeprecations();
      res.json({ ...result, timestamp: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/silent-failures", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const { listRegisteredTools } = await import("../tool-registry") as any;
      const registered = listRegisteredTools();
      const registeredNames = new Set(registered.map((t: any) => t.name));

      // 1. Tools registered but never invoked (writes nothing to tool_performance).
      const usedRows: any = await db.execute(sql`SELECT DISTINCT tool_name FROM tool_performance`);
      const usedSet = new Set(((usedRows.rows || usedRows) as any[]).map(r => r.tool_name));
      const neverInvoked = [...registeredNames].filter(n => !usedSet.has(n)).sort();

      // 2. Tools with high recent failure rate (last 7d ≥3 fails AND fail≥success).
      const failingRows: any = await db.execute(sql`
        SELECT tool_name, success_count, fail_count, last_success_at, last_failure_at
        FROM tool_performance
        WHERE last_failure_at > NOW() - INTERVAL '7 days'
          AND fail_count >= 3
          AND fail_count >= success_count
        ORDER BY fail_count DESC
        LIMIT 25
      `);

      // 3. Self-heal insights stuck in 'new' status (means auto-apply policy
      // didn't route them, or storeInsight bypassed). HIGH-priority ones in
      // particular signal a routing-pipe break.
      const stuckInsights: any = await db.execute(sql`
        SELECT id, engine_type, category, title, priority, created_at
        FROM ai_insights
        WHERE status = 'new'
          AND (engine_type = 'self_heal' OR priority = 'high')
          AND created_at > NOW() - INTERVAL '14 days'
        ORDER BY created_at DESC
        LIMIT 25
      `);

      // 4. Heartbeat tasks that have been disabled (5 consecutive failures).
      const disabledTasks: any = await db.execute(sql`
        SELECT id, name, enabled, consecutive_failures, last_run_at
        FROM heartbeat_tasks
        WHERE enabled = false OR consecutive_failures >= 3
        ORDER BY consecutive_failures DESC NULLS LAST, name
        LIMIT 25
      `);

      // 5. HIGH-priority insights stuck in pending plan-routing (Minerva failed
      // mid-handoff). The durability sweep should be retrying these — if
      // they're still here past one sweep cycle, plan creation is broken.
      const stuckPending: any = await db.execute(sql`
        SELECT id, title, priority, action_taken, created_at
        FROM ai_insights
        WHERE status = 'applied'
          AND priority = 'high'
          AND action_taken = 'Auto-applied: pending Minerva plan'
          AND created_at < NOW() - INTERVAL '15 minutes'
        ORDER BY created_at DESC
        LIMIT 10
      `);

      res.json({
        timestamp: new Date().toISOString(),
        toolsRegistered: registered.length,
        toolsEverInvoked: usedSet.size,
        neverInvoked: { count: neverInvoked.length, sample: neverInvoked.slice(0, 25) },
        recentlyFailingTools: failingRows.rows || failingRows,
        stuckInsightsHighOrSelfHeal: stuckInsights.rows || stuckInsights,
        disabledOrFailingHeartbeatTasks: disabledTasks.rows || disabledTasks,
        stuckPendingMinervaRouting: stuckPending.rows || stuckPending,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Task #54 — the self-repair DECISION LEDGER the owner reviews. Every captured
  // failure (runtime self-heal / CI self-healer / Felix delivery) lands here with
  // its classification, the remedy DISPATCHED (action_taken), the VERIFIED outcome
  // (action_outcome + action_detail.verification), whether it resolved/escalated,
  // and whether the safety invariant blocked auto-fix. `?status=` filters:
  // open (not resolved, not escalated) | resolved | escalated | needs_review
  // (escalated OR safety-blocked OR autofix_disabled). `?source=` / `?limit=` too.
  app.get("/api/admin/repair-incidents", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const { ensureRepairIncidentsTable } = await import("../agentic/repair-incident-table");
      await ensureRepairIncidentsTable();
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 200);
      const status = String(req.query.status || "").toLowerCase();
      const source = String(req.query.source || "");

      const conds: any[] = [sql`tenant_id = ${tenantId}`];
      if (source) conds.push(sql`source = ${source}`);
      if (status === "open") conds.push(sql`resolved = false AND escalated = false`);
      else if (status === "resolved") conds.push(sql`resolved = true`);
      else if (status === "escalated") conds.push(sql`escalated = true`);
      else if (status === "needs_review")
        conds.push(sql`(escalated = true OR safety_blocked_autofix = true OR action_outcome = 'autofix_disabled')`);
      const where = conds.reduce((acc, c, i) => (i === 0 ? c : sql`${acc} AND ${c}`));

      const rows: any = await db.execute(sql`
        SELECT id, source, signature, title, classification, classification_confidence,
               classified_by, routed_to, safety_blocked_autofix, jury_verdict,
               action_taken, action_outcome, action_detail, resolved, escalated,
               human_label, created_at, classified_at, dispatched_at, resolved_at
        FROM repair_incidents
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `);

      const stats: any = await db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE resolved = true)::int AS resolved,
          COUNT(*) FILTER (WHERE escalated = true)::int AS escalated,
          COUNT(*) FILTER (WHERE resolved = false AND escalated = false)::int AS open,
          COUNT(*) FILTER (WHERE safety_blocked_autofix = true)::int AS safety_blocked,
          COUNT(*) FILTER (WHERE action_outcome = 'autofix_disabled')::int AS autofix_disabled
        FROM repair_incidents WHERE tenant_id = ${tenantId}
      `);

      // Task #64 — confirm the WHOLE self-repair schema set is live in prod, not
      // just the incident ledger. The executor (#52 → repo_surgeon_attempts) and
      // the resume/reconstitution layer (#53 → pipeline_stage_artifacts) each
      // self-create via their own idempotent ensure-on-first-use helpers. Calling
      // them here (then a read-only to_regclass confirm) makes a single admin GET
      // the trigger that brings the full self-repair system live + verifies it.
      // repair_incidents is proven present by the queries above; the extra ensures
      // are best-effort so a probe failure never breaks the incident view —
      // to_regclass then honestly reports any table we could not bring up.
      const schema: Record<string, boolean> = {
        repair_incidents: true,
        repo_surgeon_attempts: false,
        pipeline_stage_artifacts: false,
      };
      try {
        const { ensureRepoSurgeonAttemptsTable } = await import("../agentic/repo-surgeon-table");
        const { ensurePipelineStageArtifactsTable } = await import("../agentic/pipeline-checkpoint-table");
        await Promise.allSettled([ensureRepoSurgeonAttemptsTable(), ensurePipelineStageArtifactsTable()]);
        const reg: any = await db.execute(sql`
          SELECT
            to_regclass('public.repair_incidents') IS NOT NULL AS repair_incidents,
            to_regclass('public.repo_surgeon_attempts') IS NOT NULL AS repo_surgeon_attempts,
            to_regclass('public.pipeline_stage_artifacts') IS NOT NULL AS pipeline_stage_artifacts
        `);
        const r = (reg.rows || reg)[0] || {};
        schema.repair_incidents = r.repair_incidents === true;
        schema.repo_surgeon_attempts = r.repo_surgeon_attempts === true;
        schema.pipeline_stage_artifacts = r.pipeline_stage_artifacts === true;
      } catch (probeErr: any) {
        console.warn(`[repair-incidents] schema health probe failed: ${probeErr?.message || probeErr}`);
      }

      // Strip the heavy before/after revert plan from the list payload — the UI
      // only needs the find/replace `edits` for display + the `revertable` flag;
      // the full plan is re-read server-side at revert time. (Task #65)
      const incidents = (rows.rows || rows).map((inc: any) => {
        const d = inc.action_detail;
        if (d && typeof d === "object" && "revertPlan" in d) {
          const { revertPlan, ...rest } = d;
          return { ...inc, action_detail: rest };
        }
        return inc;
      });

      res.json({
        timestamp: new Date().toISOString(),
        autofixEnabled: process.env.REPAIR_AUTOFIX_ENABLED === "1",
        schema,
        stats: (stats.rows || stats)[0] || {},
        incidents,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Task #65 — the owner's one-click UNDO of an automatically-landed code fix.
  // Reverse-applies the stored diff (left in the working tree for Auto Git Push)
  // and marks the revert in the ledger. Admin-tenant gated; only a LANDED
  // repo_surgeon fix can be reverted; idempotent (a re-revert is refused).
  app.post("/api/admin/repair-incidents/:id/revert", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    const incidentId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(incidentId) || incidentId <= 0) {
      return res.status(400).json({ error: "Invalid incident id" });
    }
    try {
      const { revertIncidentFix } = await import("../agentic/repair-incident");
      const result = await revertIncidentFix(incidentId, tenantId);
      if (!result.ok) return res.status(409).json({ error: result.reason });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
