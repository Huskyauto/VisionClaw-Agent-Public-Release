import express from "express";
import type { Express, Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { type Server } from "http";
import { db } from "./db";
import { sql, eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { storage } from "./storage";
import { seedDatabase } from "./seed";
// R74.13k — A-MEDIUM cleanup: insertPersonaSchema, insertMemoryEntrySchema,
// insertHeartbeatTaskSchema removed — moved to personas.ts/memory.ts/heartbeat.ts.
import { insertKnowledgeSchema, insertSkillSchema, insertDailyNoteSchema, conversations, messages, heartbeatTasks, heartbeatLogs, memoryEntries, fileStorage, notifications, activityLog } from "@shared/schema";
import { splitSystemForCache } from "./anthropic-prompt-cache";
import { getClientForModel, getAvailableModels, getAvailableModelsForTenant, MODEL_REGISTRY, replitOpenai, getMaxOutputTokens, maskApiKey, markSubscriptionFailed, markProviderUnhealthy, getUnhealthyProviders, resetProviderHealth } from "./providers";
// R74.13k — A-MEDIUM cleanup: stopHeartbeat + delegateTaskFromChat were dead
// (stopHeartbeat is wired through the lifecycle module, delegateTaskFromChat is
// only invoked by the chat-engine import path).
import { startHeartbeat, isHeartbeatRunning, activeTaskTracker, notifyHeartbeatActivity } from "./heartbeat";
import { buildSystemPrompt, stripThinkTags, windowMessages, updateDailyLog, parseXmlToolCalls, parseInlineToolCalls, buildFelixProtocol } from "./chat-engine";
import { intelligentExtractMemory } from "./memory-intelligence";
import { authMiddleware, handleLogin, handleAuthStatus, isValidSession, getSessionSync, handleTenantRegister, handleTenantLogin, handleForgotPassword, handleResetPassword, handleVerifyEmail, handleResendVerification, getTenantFromRequest, getTenantFromRequestAsync, isAdminRequest, requirePlatformAdmin, isPlatformAdmin, ADMIN_TENANT_ID, loadSessionsFromDb } from "./auth";
import { getDiscordStatus, initDiscordFromSettings } from "./discord";
import { startTelegramBot, stopTelegramBot, getTelegramStatus, initTelegramFromSettings, getPendingPairings, approvePairing, revokeUser, getApprovedUsersList, saveTelegramToken } from "./telegram";
import { logSilentCatch } from "./lib/silent-catch";
import { warnIfPartialBotConfig } from "./lib/bot-protection";
import { resolveToolCallIndex, SYNTHETIC_TOOL_CALL_ID_PREFIX } from "./lib/tool-call-accumulator";
// R59 — mcp-client exports moved into ./routes/mcp.ts.
import { listTriggers, createTrigger, deleteTrigger, toggleTrigger, processTriggerEvent, getTriggerEvents } from "./webhook-triggers";
import { listChannelRoutes, setChannelRoute, removeChannelRoute } from "./channel-routing";
import { getMarketplaceTemplates, getCategories, installSkillFromTemplate, exportSkill, importSkill } from "./skills-marketplace";
import { validateUpload as detectAndValidateUpload } from "./file-detector";
// R74.13k — A-MEDIUM cleanup: trustEventSchema + expressLaneCheckSchema were
// dead (the trust-event/express-lane endpoints validate inline).
// R74.13l Stage 7 cleanup — adminTenantUpdateSchema moved to routes/admin.ts (only callsite was the PATCH /api/admin/tenants/:id route).
// R74.13n Stage 9 cleanup — inboxReadSchema + inboxStarSchema moved to routes/inbox-notifications.ts.
import { validate, stripeCheckoutSchema, presenterSessionSchema, contactFormSchema, triggerSchema, channelRouteSchema, personalityFileSchema, marketplaceInstallSchema, toggleSchema, scheduledPostCreateSchema, emptyBodySchema, messageFeedbackSchema, selfInitiativeDecideSchema, createCsrfMiddleware, generateCsrfToken, getCsrfSessionKey } from "./validation";
import { getPersonalityFiles, getAllPersonalityFiles, upsertPersonalityFile, deletePersonalityFile, getFileDescriptions } from "./personality-files";
// R74.13k — A-MEDIUM cleanup: static embeddings imports were dead (the 4
// in-file callsites all use dynamic `await import("./embeddings")`).
import { PROVIDERS_SUPPORTING_TOOLS, getAllToolDefinitions } from "./tools";
import { reflectOnResponse, refineResponse } from "./self-reflection";
import { registerCodeProposalsRoutes } from "./routes/code-proposals";
import { registerEventsRoutes } from "./routes/events";
import { registerGoalLedgerRoutes } from "./routes/goal-ledger";
import { registerGalleryRoutes } from "./routes/gallery";
import { registerTrustRoutes } from "./routes/trust";
import { registerSkillsCatalogRoutes } from "./routes/skills-catalog";
import { registerAuditRoutes } from "./routes/audit";
import { registerEnrichmentRoutes } from "./routes/enrichment";
import { registerLeadsRoutes } from "./routes/leads";
import { registerArchiveRescueRoutes } from "./routes/archive-rescue";
import { registerGmailDirectRoutes } from "./routes/gmail-direct";
import { registerMcpRoutes } from "./routes/mcp";
import { registerMcpServerRoutes } from "./routes/mcp-server";
import { registerMindsRoutes } from "./routes/minds";
import { registerBrowserRoutes } from "./routes/browser";
import { registerApiV1Routes } from "./routes/api-v1";
import { registerAgencyRoutes } from "./routes/agency";
import { registerAgentJobsRoutes } from "./routes/agent-jobs";
import { registerProjectsRoutes } from "./routes/projects";
import { registerPersonasRoutes } from "./routes/personas";
import { registerPersonaCostRoutes } from "./routes/persona-cost";
import { registerSlackRoutes } from "./routes/slack";
import { registerClaudeImportRoutes } from "./routes/claude-import";
import { registerHeartbeatRoutes } from "./routes/heartbeat";
import { registerWhatsAppRoutes } from "./routes/whatsapp";
import { registerInboxNotificationsRoutes } from "./routes/inbox-notifications";
import { registerBillingRoutes } from "./routes/billing";
import { registerConversationsRoutes } from "./routes/conversations";
import { registerStripeCheckoutRoutes } from "./routes/stripe-checkout";
import { registerStoreCheckoutRoutes } from "./routes/store-checkout";
import { registerStripeTenantBillingRoutes } from "./routes/stripe-tenant-billing";
import { registerRunsRoutes } from "./routes/runs";
import { registerGovernorRoutes } from "./routes/governor";
import { registerWatchlistRoutes } from "./routes/watchlist";
import { registerAgentManagerRoutes } from "./routes/agent-manager";
import { registerBriefingsRoutes } from "./routes/briefings";
import { registerCredentialsRoutes } from "./routes/credentials";
import { registerCrewsFlowsRoutes } from "./routes/crews-flows";
import { registerDocCollectionsRoutes } from "./routes/doc-collections";
import { registerLobsterRoutes } from "./routes/lobster";
import { registerOAuthSubscriptionsRoutes } from "./routes/oauth-subscriptions";
import { registerPlatformConfigRoutes } from "./routes/platform-config";
import { registerPublicChatRoutes } from "./routes/public-chat";
import { registerAgenticPolicyRoutes } from "./routes/agentic-policy";
import { registerTeamAdminRoutes } from "./routes/team-admin";
import { registerAgentMailWebhookRoutes } from "./routes/agentmail-webhook";
import { registerActivityRoutes } from "./routes/activity";
import { registerVideoJobRoutes } from "./routes/video-jobs";
import { registerChannelsRoutes } from "./routes/channels";
import { registerSculptorRoutes } from "./routes/sculptor";
import { registerStatsRoutes } from "./routes/stats";
import { registerTenantBYOKRoutes } from "./routes/tenant-byok";
import { registerMemoryRoutes } from "./routes/memory";
import { registerResearchRoutes } from "./routes/research";
import { registerAdminRoutes } from "./routes/admin";
import { buildAdaptiveHint, getRelevantLessons, saveLessonLearned, shouldEscalateToHuman } from "./adaptive-execution";
import { shouldCompact, compactMessages, splitForCompaction, buildCompactedMessages } from "./compaction";
import { compactLadder } from "./lib/compaction-ladder";
import { isRetryableError, findFallbackModel } from "./model-failover";
import { createCompletionWithTimeout, StreamCreateTimeoutError } from "./lib/stream-create-timeout";
import { ToolLoopDetector } from "./tool-loop-detection";
import { wrapExternalContent } from "./external-content-security";
import { scanInboundMessage } from "./safety-layer";
import { scanAndAnnotate, getInjectionRiskLevel } from "./injection-scanner";
import { acquireConversationLock } from "./conversation-queue";
import { captureToolChainMemory } from "./auto-memory";
import { understandLinks, formatLinkContext } from "./link-understanding";
import { evaluateContextGuard, truncateWithSummary, extractDroppedMessagesSummary } from "./context-window-guard";
import { compressToolOutput } from "./lib/tool-output-compressor";
import { recordToolCompression } from "./lib/tool-compression-stats";
import { getDesk, getAllDesks, getDesksOverview, setDeskFocus, setDeskStatus } from "./agent-desk";
import { emitEvent } from "./event-bus";
import { classifyToolRisk, recordMutation, requestToolConfirmation, resolveToolConfirmation } from "./tool-mutation";
import { reviewToolCall, shouldReview } from "./trust-reviewer";
import { routeTools, MAX_ROUTED_TOOLS_PER_TURN } from "./tool-router";
import { handleVoiceMessage, handleListVoices, handleTextToSpeech, handleSpeechToText } from "./voice";
import { handleVoiceWakeGet, handleVoiceWakeSet } from "./voice-wake";
import { getProviderHealth, getAuthStatusCode, getCachedHealth } from "./auth-monitor";
import { registerWebhookRoutes, configureWebhooks, getWebhookStatus } from "./webhooks";
import { listHooks, enableHook, disableHook, getHookLog, emitHookEvent } from "./hooks";
import { loadTTSConfig, saveTTSConfig } from "./tts-config";
import { loadFirecrawlConfig, saveFirecrawlConfig, isFirecrawlAvailable, getFirecrawlCacheStats, clearFirecrawlCache } from "./firecrawl";
import { loadSearchConfig, saveSearchConfig, getSearchStatus } from "./perplexity-search";
import { autoRouteModel, listRouteCategories } from "./auto-router";
import { getIntakeInstruction } from "./intake-interview";
// R59 — most browser-tool exports moved into ./routes/browser.ts; only init helpers
// and symbols still referenced elsewhere in routes.ts remain imported here.
import { autoConfigureFromEnv, startSessionCleanup, startScreenshotPruning } from "./browser-tool";
import { validateSubscriptionsOnStartup, startOAuthRefreshLoop } from "./oauth-subscriptions";
import { getSubagentRuns, getSubagentInfo, killSubagent, killAllSubagents, spawnSubagent } from "./subagents";
import { loadExecConfig, saveExecConfig, getExecStatus } from "./exec-tool";
import { loadLoopDetectionConfig, saveLoopDetectionConfig } from "./tool-loop-detection";
import { getUncachableStripeClient, buildCheckoutIdempotencyKey } from "./stripeClient";
import { anonymousVisitorPartition } from "./anonymousVisitorPartition";
import stripeConnectRouter from "./stripe-connect";
import coinbaseCommerceRouter from "./coinbase-commerce";
import { isEmailConfigured, listInboxes, getOrCreateTenantInbox, sendEmail, replyToEmail } from "./email";
import { sendUsageWarningEmail, sendLimitReachedEmail } from "./email-notifications";
import multer from "multer";
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import crypto from "crypto";
import { getSubscriptionStatus, disconnectSubscription, getOAuthProviderInfo, getAppBaseUrl, initiateLocalRedirectOAuth, exchangeCodeWithLocalRedirect } from "./oauth-subscriptions";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const UPLOADS_DIR = process.env.NODE_ENV === "production"
  ? path.resolve("/tmp", "uploads")
  : path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
console.log(`[uploads] Directory: ${UPLOADS_DIR} (exists: ${fs.existsSync(UPLOADS_DIR)})`);

(async function restoreUploadsFromDb() {
  try {
    const { db } = await import("./db");
    const { like, isNull } = await import("drizzle-orm");
    const { and } = await import("drizzle-orm");
    const rows = await db.select({
      filename: fileStorage.filename,
      data: fileStorage.data,
      storageKey: fileStorage.storageKey,
    }).from(fileStorage).where(
      and(like(fileStorage.mimeType, "image/%"), isNull(fileStorage.storageKey))
    );
    let restored = 0;
    for (const row of rows) {
      if (!row.data || row.data.length === 0) continue;
      const fp = path.join(UPLOADS_DIR, row.filename);
      if (!fs.existsSync(fp)) {
        try {
          await fsPromises.writeFile(fp, Buffer.from(row.data, "base64"));
          restored++;
        } catch (err: any) {
          console.warn(`[uploads] Failed to restore ${row.filename}: ${err?.message || err}`);
        }
      }
    }
    if (restored > 0) console.log(`[uploads] Restored ${restored} image(s) from DB`);
  } catch (err: any) {
    console.warn(`[uploads] DB-to-disk restore skipped: ${err?.message || err}`);
  }
})();

const ALLOWED_MIME_TYPES = new Set([
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

const SAFE_EXTENSIONS: Record<string, string> = {
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

const upload = createUploader(50);
const uploadLarge = createUploader(50);

// Magika-powered post-multer validation. Inspects actual file bytes (not the
// browser-supplied MIME) and rejects executables/scripts disguised as documents
// plus any clear content/type mismatch. On failure: deletes the file from disk
// and sends a 400. Returns true only if the request should continue.
async function validateUploadedFile(req: Request, res: Response): Promise<boolean> {
  const file = req.file;
  if (!file) return true; // nothing to validate; let downstream handle "no file"
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

    // R110 +sec — Pre-ingest secret-pattern scan. CRITICAL/HIGH hits in an
    // uploaded file are rejected so a leaked key cannot poison Felix's
    // reasoning context. R110 +sec gold-pass-3 hardening: now FAIL-CLOSED
    // on both text-extract failures AND scanner-infra failures for any
    // file type the scanner is supposed to handle (text/code OR
    // pdf/docx/xlsx). An attacker can craft a malformed PDF that throws
    // during pdf-parse to bypass the scan; we now reject those uploads
    // with 503 + retry messaging instead of silently waving them through.
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
    // R108.1 +sec — Fail CLOSED on validator infra errors. Previously this
    // returned `true` ("never break uploads on detector errors"), which made
    // the magic-byte / content-type validation gate bypass on any detector
    // crash. Per spend/safety/admission-gate consistency policy now applied
    // to rate-limit and usage-metering catches, this is now fail-closed.
    // Caller checks the boolean and surfaces a 4xx upload error.
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

async function extractTextFromFile(filePath: string, ext: string): Promise<string> {
  // R110 +sec architect-pass-1 fix — async readFile so the chat-ingress
  // upload validator doesn't block the Express event loop while a 5 MB PDF
  // is being slurped on a high-concurrency request.
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

const chunkedUploads = new Map<string, { fileName: string; fileSize: number; chunks: Map<number, string>; totalChunks: number; createdAt: number }>();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, u] of chunkedUploads) {
    if (u.createdAt < cutoff) {
      for (const p of u.chunks.values()) { try { fs.unlinkSync(p); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); } }
      chunkedUploads.delete(id);
    }
  }
}, 60_000);

const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, _file, cb) => cb(null, `chunk-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.bin`),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
});

function getRecencyTier(lastAccessed: Date | string): "hot" | "warm" | "cold" {
  const now = Date.now();
  const accessed = new Date(lastAccessed).getTime();
  const daysSince = (now - accessed) / (1000 * 60 * 60 * 24);
  if (daysSince <= 7) return "hot";
  if (daysSince <= 30) return "warm";
  return "cold";
}

const MAX_MEMORY_CHARS = 3000;
const MAX_MEMORY_FACT_CHARS = 300;

function truncateFact(fact: string): string {
  return fact.length > MAX_MEMORY_FACT_CHARS ? fact.slice(0, MAX_MEMORY_FACT_CHARS) + "..." : fact;
}

// Strict integer cap parser for env-overridable budgets. Returns the fallback on
// anything that isn't a whole number inside [min,max] (undefined, "", "abc",
// "10.5", negatives, NaN/Infinity) so a malformed override can NEVER produce a
// NaN cap (which would make `round <= NaN` run zero iterations → empty turn).
function parseIntCap(raw: string | undefined, fallback: number, min: number, max: number, label: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    console.warn(`[tool-budget] Ignoring invalid ${label}="${raw}" (must be an integer ${min}..${max}) — using ${fallback}.`);
    return fallback;
  }
  return n;
}

const tenantRateLimits = new Map<string, { count: number; resetAt: number }>();
const TENANT_RATE_WINDOW_MS = 60 * 1000;
const TENANT_RATE_MAX = 120;

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of tenantRateLimits) {
    if (now > bucket.resetAt) tenantRateLimits.delete(key);
  }
}, 5 * 60 * 1000);

function tenantRateLimiter(req: Request, res: Response, next: express.NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const tenantId = getTenantFromRequest(req);
  const tenantKey = tenantId ? `tid:${tenantId}` : `ip:${ip}`;
  // Unauthenticated requests get a stricter cap to limit DoS surface (one IP
  // can't burn the same bucket as an authenticated tenant).
  const cap = tenantId ? TENANT_RATE_MAX : Math.floor(TENANT_RATE_MAX / 4);
  const now = Date.now();
  let bucket = tenantRateLimits.get(tenantKey);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + TENANT_RATE_WINDOW_MS };
    if (tenantRateLimits.size >= 10000) {
      for (const [k, v] of tenantRateLimits) {
        if (now > v.resetAt) tenantRateLimits.delete(k);
      }
      // R77.7: fail-CLOSED when the limiter map is saturated. Previously the
      // bucket was discarded but the request was allowed through, which let
      // an attacker bypass rate limiting once 10000 unique IPs were registered.
      if (tenantRateLimits.size >= 10000) {
        return res.status(429).json({ error: "Rate limiter saturated, please try again later" });
      }
    }
    tenantRateLimits.set(tenantKey, bucket);
  }
  bucket.count++;
  res.setHeader("X-RateLimit-Limit", cap);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, cap - bucket.count));
  if (bucket.count > cap) {
    return res.status(429).json({ error: "Too many requests, please try again later" });
  }
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again later" },
});

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many contact submissions, please try again later" },
});

// Per-IP limiter for the public order-recovery endpoint. Kept tight
// (5 per 15min) to make email-address enumeration impractical while
// still letting a real customer retry once or twice if they fat-finger
// their email. The endpoint also always returns a generic success
// response regardless of whether a match was found (see route handler).
const orderLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // SECURITY: key off the raw TCP socket source. express-rate-limit's
  // default keyGenerator uses req.ip, which honors X-Forwarded-For when
  // "trust proxy" is set — letting an attacker rotate that header and
  // bypass the per-IP cap. The TCP source can't be spoofed.
  keyGenerator: (req) => (req.socket?.remoteAddress || 'unknown'),
  message: { error: "Too many lookup attempts, please try again later" },
});

// Per-IP limiter for the order verification step. The verify endpoint
// receives the 6-digit code from the customer's email and, on a match,
// returns the actual list of /orders/:sessionId links inline so they
// don't have to wait for the email round-trip. Tighter than the lookup
// limiter because each verify attempt is a chance for an attacker to
// brute-force the 6-digit code (1 in 1,000,000 per try).
const orderVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.socket?.remoteAddress || 'unknown'),
  message: { error: "Too many verification attempts, please try again later" },
});

// Generic per-IP limiter for authenticated mutating endpoints that don't
// have a more specific limiter. Sized for legitimate human + UI use (60/min
// is one action per second per user) while making spam-style abuse expensive.
// Applied to: profile updates, conversation mutations, file/logo uploads,
// stripe self-service. Keys off raw socket source to prevent X-Forwarded-For
// rotation from bypassing the cap (same rationale as orderLookupLimiter).
const mutateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.socket?.remoteAddress || 'unknown'),
  message: { error: "Too many requests, please slow down" },
});

// Per-IP limiter for the unauthenticated /api/trigger/:key endpoint.
// The webhook key is 128-bit random so brute-force isn't realistic, but
// if any key is leaked (logs, accidental commit, screenshot) this cap
// stops an attacker from draining the LLM budget. 60 req/min per IP is
// generous for legitimate event-bus usage and tight for abuse.
const triggerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.socket?.remoteAddress || 'unknown'),
  message: { error: "Too many trigger requests, please slow down" },
});

// Persistent store of pending order-lookup verification codes. Backed
// by Postgres (order_lookup_codes table) so codes survive server
// restarts/redeploys and are shared across instances — a code issued
// by one node is recognised by every other node. Keyed by lowercased
// email. We hash the code so the raw value never sits at rest. Codes
// expire after 15 minutes and are single-use. A small per-email
// attempt counter prevents online brute-force of the 6-digit space
// (max 5 wrong guesses, then the code is invalidated and the user
// must request a new one).
const ORDER_LOOKUP_CODE_TTL_MS = 15 * 60 * 1000;
const ORDER_LOOKUP_MAX_ATTEMPTS = 5;

// R125+ — bound the upstream chat.completions.create() (stream establishment).
// The first-CHUNK timeout only arms after the stream object returns; opening the
// stream should be near-instant (connection + first response), so a 120s ceiling
// catches a hung provider without tripping on legitimate long token generation
// (which is the first-chunk/iteration timeout's job).
const STREAM_CREATE_TIMEOUT_MS = 120_000;

(async function ensureOrderLookupCodesTable() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS order_lookup_codes (
        email TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err: any) {
    console.error("[order-lookup] failed to ensure table:", err?.message);
  }
})();

async function pruneOrderLookupCodes() {
  try {
    await db.execute(sql`DELETE FROM order_lookup_codes WHERE expires_at < NOW()`);
  } catch (err: any) {
    console.warn(`[order-lookup] prune failed: ${err?.message || err}`);
  }
}
setInterval(() => { void pruneOrderLookupCodes(); }, 5 * 60 * 1000).unref?.();

function hashLookupCode(email: string, code: string): string {
  // Bind the hash to the email so a code leaked for one address can't
  // be replayed against a different one.
  return crypto.createHash("sha256").update(`${email}:${code}`).digest("hex");
}

const emailDedupCache = new Set<string>();
setInterval(() => emailDedupCache.clear(), 24 * 60 * 60 * 1000);

async function cleanupTestTenants() {
  try {
    const testEmails = ["test-e2e@example.com"];
    for (const email of testEmails) {
      const candidates = await db.execute(sql`
        SELECT id FROM tenants WHERE email = ${email} AND id != 1
        AND id NOT IN (SELECT DISTINCT tenant_id FROM conversations WHERE tenant_id IS NOT NULL)
        AND id NOT IN (SELECT DISTINCT tenant_id FROM projects WHERE tenant_id IS NOT NULL)
      `);
      const rows = (candidates as any).rows || candidates;
      if (!rows || rows.length === 0) continue;
      for (const row of rows) {
        const tid = Number(row.id);
        await db.execute(sql`DELETE FROM auth_sessions WHERE tenant_id = ${tid}`).catch(() => {});
        await db.execute(sql`DELETE FROM tenants WHERE id = ${tid}`);
        console.log(`[cleanup] Removed test tenant id=${tid} email=${email}`);
      }
    }
  } catch (err) {
    console.warn("[cleanup] Test tenant cleanup failed:", err);
  }
}

function logStartupProviderHealth() {
  const keys: Record<string, string> = {
    "Replit OpenAI": "AI_INTEGRATIONS_OPENAI_API_KEY",
    "OpenAI Direct": "OPENAI_API_KEY",
    "Anthropic": "ANTHROPIC_API_KEY",
    "xAI (Grok)": "XAI_API_KEY",
    "OpenRouter": "OPENROUTER_API_KEY",
    "ElevenLabs": "ELEVENLABS_API_KEY",
    "Browserless": "BROWSERLESS_API_KEY",
    "Stripe": "STRIPE_LIVE_SECRET_KEY",
  };
  const ready: string[] = [];
  const missing: string[] = [];
  for (const [label, envVar] of Object.entries(keys)) {
    const val = process.env[envVar];
    if (val && val.length > 5) {
      ready.push(label);
    } else {
      missing.push(label);
    }
  }
  console.log(`[startup] Provider keys ready: ${ready.join(", ") || "none"}`);
  if (missing.length > 0) {
    console.log(`[startup] Provider keys missing (features disabled): ${missing.join(", ")}`);
  }
  warnIfPartialBotConfig();
}

async function backfillProjectDriveFolders() {
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");

    await db.execute(sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS drive_folder_id TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS drive_folder_id TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS drive_folder_url TEXT`);
    await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_state TEXT DEFAULT ''`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS felix_loop_runs (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        mode TEXT NOT NULL DEFAULT 'dry_run',
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMP,
        context_summary TEXT DEFAULT '',
        intent_summary TEXT DEFAULT '',
        proposals_drafted INTEGER NOT NULL DEFAULT 0,
        tokens_used INTEGER DEFAULT 0,
        cost_cents INTEGER NOT NULL DEFAULT 0,
        error TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS felix_proposals (
        id SERIAL PRIMARY KEY,
        loop_run_id INTEGER,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        rationale TEXT NOT NULL DEFAULT '',
        target TEXT,
        target_args JSONB DEFAULT '{}'::jsonb,
        estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by TEXT,
        reviewed_at TIMESTAMP,
        rejection_reason TEXT,
        executed_at TIMESTAMP,
        execution_result TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_felix_loop_runs_tenant_started ON felix_loop_runs(tenant_id, started_at DESC)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_felix_proposals_status ON felix_proposals(tenant_id, status, created_at DESC)`);
    // R74.13x verification rail: nullable JSONB column carrying the
    // expected post-state shape. Pure additive — no PK touched.
    await db.execute(sql`ALTER TABLE felix_proposals ADD COLUMN IF NOT EXISTS expected_post_state JSONB`);
    // R74.13w architect fix: race-safe dedup. Partial unique index on
    // active (pending/approved) proposals so two concurrent loop runs cannot
    // both insert the same kind+target proposal. The check-then-insert
    // dedup in felix-loop.ts is now backed by a DB-level guarantee.
    // R74.13z: split the original COALESCE-based index into two simple
    // partial indexes (one for non-null target, one for null target).
    // Functionally equivalent dedup, but avoids a deploy-time introspector
    // bug that mis-tagged text columns with int4_ops when COALESCE was used.
    await db.execute(sql`DROP INDEX IF EXISTS uniq_felix_proposals_active`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_felix_proposals_active_t
      ON felix_proposals(tenant_id, kind, target)
      WHERE target IS NOT NULL AND status IN ('pending', 'approved')
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_felix_proposals_active_n
      ON felix_proposals(tenant_id, kind)
      WHERE target IS NULL AND status IN ('pending', 'approved')
    `);
    console.log("[drive-backfill] Schema columns ensured");

    const rows = (await db.execute(sql`
      SELECT p.id, p.name, p.tenant_id, t.name as tenant_name
      FROM projects p
      JOIN tenants t ON t.id = p.tenant_id
      WHERE p.drive_folder_id IS NULL OR p.drive_folder_id = ''
    `)) as any;
    const projects = rows.rows || rows;
    if (!Array.isArray(projects) || projects.length === 0) {
      console.log("[drive-backfill] All projects already have Drive folders");
      return;
    }
    const { ensureProjectFolder } = await import("./google-drive");
    let created = 0;
    for (const p of projects) {
      try {
        await ensureProjectFolder(p.id, p.name, p.tenant_id, p.tenant_name || (await import("./site-config")).siteConfig.platformName);
        created++;
      } catch (err: any) {
        console.warn(`[drive-backfill] Failed for project ${p.id} (${p.name}): ${err.message}`);
      }
    }
    console.log(`[drive-backfill] Backfill complete: ${created}/${projects.length} project Drive folders created`);
  } catch (err: any) {
    console.warn(`[drive-backfill] Backfill failed: ${err.message}`);
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  await seedDatabase();
  await loadSessionsFromDb();
  await cleanupTestTenants();

  // Round 20: Glasses gateway — public /v1/glasses/* endpoints for the
  // VisionClaw Android client (Meta Ray-Ban DAT SDK + Gemini Live).
  // Mounted BEFORE the /api auth middleware so it has its own Bearer-token
  // auth path and is not subject to CSRF or tenant rate limiting.
  try {
    const { registerGlassesGateway } = await import("./glasses-gateway");
    registerGlassesGateway(app);
  } catch (e: any) {
    console.warn("[startup] Glasses gateway not mounted:", e.message?.slice(0, 120));
  }

  try {
    const { getAllToolDefinitions } = await import("./tools");
    const { runToolRegistryAudit } = await import("./tool-router");
    const allDefs = await getAllToolDefinitions();
    runToolRegistryAudit(allDefs);
  } catch (e: any) {
    console.warn("[startup] Tool registry audit skipped:", e.message?.slice(0, 100));
  }

  import("./data-protection").then(dp => dp.ensureDataProtectionColumns()).catch(e => console.warn("[startup] data-protection columns:", e.message));

  validateSubscriptionsOnStartup().then(() => startOAuthRefreshLoop()).catch(() => startOAuthRefreshLoop());
  logStartupProviderHealth();

  import("./whatsapp-approval").then(wa => wa.loadAllApprovalPhones()).catch(() => {});
  import("./whatsapp").then(wa => wa.autoConnectWhatsApp()).catch(() => {});
  import("./auto-transcript").then(t => t.backfillProjectTranscripts()).catch(() => {});
  import("./auto-asset-capture").then(a => a.backfillProjectAssets()).catch(() => {});
  import("./project-brain").then(b => b.backfillProjectBrains()).catch(() => {});
  backfillProjectDriveFolders().catch(() => {});
  await startHeartbeat();
  import("./db").then(d => d.startPoolMonitor()).catch(() => {});
  import("./health-monitor").then(hm => hm.startHealthMonitor()).catch(() => {});
  import("./stability-watchdog").then(sw => sw.startStabilityWatchdog()).catch(() => {});
  import("./auto-tuner").then(at => at.startAutoTuner()).catch(() => {});
  import("./tool-sommelier").then(ts => ts.startToolSommelier()).catch(() => {});
  import("./auto-consolidation").then(ac => ac.startAutoConsolidation()).catch(() => {});
  initDiscordFromSettings().catch(() => {});
  initTelegramFromSettings().catch(() => {});
  import("./whatsapp").then(wa => wa.initWhatsAppFromSettings()).catch(() => {});
  autoConfigureFromEnv();
  startSessionCleanup();
  startScreenshotPruning();

  // Liveness probe — must come BEFORE auth/rate-limit/CSRF middleware so the
  // Docker HEALTHCHECK and external monitors (UptimeRobot, k8s, etc.) can hit
  // it without credentials. Returns 200 once the process is serving requests.
  // Does NOT touch the DB or any provider — that's what /api/health is for
  // (auth-gated, deeper subsystem report).
  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).type("text/plain").send("ok");
  });

  // R110.11.3 — Deep liveness probe. Unauthenticated like /healthz so external
  // monitors (UptimeRobot, k8s readiness, status pages) can hit it, BUT it
  // actually exercises the dependencies via the cached health-monitor report.
  // Returns 503 if ANY dependency is "down", 200 otherwise. Inspired by the
  // Taranis-AI /api/health convention (split liveness vs readiness).
  //
  // Security posture: returns ONLY {status, checks:{name:status}} — no
  // latencies, no error messages, no auto-remediation list. The rich shape
  // stays on the auth-gated /api/health endpoint (server/routes/stats.ts).
  //
  // Three layers of DoS / freshness protection (architect-suggested):
  //   1. 5s response cache (_deepCache)        — repeat hits return instantly
  //   2. 60s staleness bound (_STALE_MS)       — forces refresh if monitor's
  //      own 5-min cadence + off-hours skips drift the cached report past 60s
  //   3. In-flight coalescing (_inflightProbe) — concurrent cold-cache callers
  //      share a single underlying Promise so a startup-time probe burst can
  //      only trigger ONE runHealthChecks() at a time
  let _deepCache: { at: number; statusCode: number; body: any } | null = null;
  let _inflightProbe: Promise<{ statusCode: number; body: any }> | null = null;
  const _DEEP_CACHE_MS = 5000;
  const _STALE_MS = 60_000;
  app.get("/healthz/deep", async (_req: Request, res: Response) => {
    if (_deepCache && (Date.now() - _deepCache.at) < _DEEP_CACHE_MS) {
      return res.status(_deepCache.statusCode).json(_deepCache.body);
    }
    try {
      // Coalesce concurrent cold-cache callers onto a single probe Promise.
      // R110.11.5 (architect): freshness must be evaluated AT probe execution
      // time and the cache stamped at completion (not request-arrival), so the
      // worst case stays at the documented 60s + 5s endpoint cache instead of
      // up to 65-70s when callers queue behind a slow inflight probe.
      if (!_inflightProbe) {
        _inflightProbe = (async () => {
          const { getLastHealthReport, runHealthChecks } = await import("./health-monitor");
          const cached = getLastHealthReport();
          const probeNow = Date.now();
          const cachedAge = cached ? (probeNow - new Date(cached.generatedAt).getTime()) : Infinity;
          const report = (cached && cachedAge < _STALE_MS) ? cached : await runHealthChecks();
          const anyDown = report.checks.some(c => c.status === "down");
          const anyDegraded = report.checks.some(c => c.status === "degraded");
          const status = anyDown ? "down" : (anyDegraded ? "degraded" : "up");
          const statusCode = anyDown ? 503 : 200;
          const body = {
            status,
            checks: Object.fromEntries(
              report.checks.map(c => [c.name, c.status === "healthy" ? "up" : c.status])
            ),
            generatedAt: report.generatedAt,
          };
          return { statusCode, body };
        })().finally(() => { _inflightProbe = null; });
      }
      const result = await _inflightProbe;
      _deepCache = { at: Date.now(), statusCode: result.statusCode, body: result.body };
      res.status(result.statusCode).json(result.body);
    } catch (err: any) {
      // If the probe itself fails we are by definition not ready. Don't cache
      // — next caller should retry immediately. Strict shape: no error string
      // leaks. Internals stay on the auth-gated /api/health endpoint.
      res.status(503).json({
        status: "down",
        checks: {},
        generatedAt: new Date().toISOString(),
      });
    }
  });

  // Weekly maintenance cron — manual trigger (mirrors the in-process scheduler).
  // Auth: Bearer ${CRON_SECRET}. Idempotent: rejects if a run is already in flight.
  // Status endpoint exposes last-run timestamp + status without triggering a run.
  app.get("/api/cron/weekly-maintenance/status", async (_req: Request, res: Response) => {
    try {
      const { getWeeklyMaintenanceStatus } = await import("./weekly-maintenance-cron");
      res.json(getWeeklyMaintenanceStatus());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  app.post("/api/cron/weekly-maintenance", async (req: Request, res: Response) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return res.status(503).json({ error: "CRON_SECRET not configured" });
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== cronSecret) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { runWeeklyMaintenance } = await import("./weekly-maintenance-cron");
      // Fire-and-forget: maintenance can take minutes; don't block the cron caller.
      runWeeklyMaintenance().catch((e) => console.error("[cron] weekly maintenance error:", e.message));
      res.status(202).json({ accepted: true, message: "Weekly maintenance started in background" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Task #63 — self-repair loop health, secret-gated (NOT public, NOT admin-login).
  // Mirrors the autofix-flag + incident-stats payload of /api/admin/repair-incidents
  // but authenticates with `Bearer ${CRON_SECRET}` (same pattern as the cron routes)
  // so the post-deploy verifier + weekly-maintenance sweep can run the FULL green
  // check WITHOUT a hand-supplied admin session token. Read-only: no incident bodies,
  // just the counts + the prod runtime's view of REPAIR_AUTOFIX_ENABLED.
  app.get("/api/cron/repair-loop-health", async (req: Request, res: Response) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return res.status(503).json({ error: "CRON_SECRET not configured" });
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== cronSecret) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { ensureRepairIncidentsTable } = await import("./agentic/repair-incident-table");
      await ensureRepairIncidentsTable();
      const stats: any = await db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE resolved = true)::int AS resolved,
          COUNT(*) FILTER (WHERE escalated = true)::int AS escalated,
          COUNT(*) FILTER (WHERE resolved = false AND escalated = false)::int AS open,
          COUNT(*) FILTER (WHERE safety_blocked_autofix = true)::int AS safety_blocked,
          COUNT(*) FILTER (WHERE action_outcome = 'autofix_disabled')::int AS autofix_disabled
        FROM repair_incidents WHERE tenant_id = ${ADMIN_TENANT_ID}
      `);

      // Task #64 — confirm the WHOLE self-repair schema set is live in prod, not
      // just the incident ledger. Mirror /api/admin/repair-incidents: ensure the
      // executor (#52 → repo_surgeon_attempts) + resume layer (#53 →
      // pipeline_stage_artifacts) tables via their idempotent ensure-helpers, then
      // a read-only to_regclass confirm. Best-effort so a probe failure never
      // breaks the health view — to_regclass honestly reports any table we couldn't
      // bring up, and the verifier fails CLOSED (exit 7) on a missing table.
      const schema: Record<string, boolean> = {
        repair_incidents: true,
        repo_surgeon_attempts: false,
        pipeline_stage_artifacts: false,
      };
      try {
        const { ensureRepoSurgeonAttemptsTable } = await import("./agentic/repo-surgeon-table");
        const { ensurePipelineStageArtifactsTable } = await import("./agentic/pipeline-checkpoint-table");
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
        console.warn(`[repair-loop-health] schema health probe failed: ${probeErr?.message || probeErr}`);
      }

      res.json({
        timestamp: new Date().toISOString(),
        autofixEnabled: process.env.REPAIR_AUTOFIX_ENABLED === "1",
        incidentLedgerQueryable: true,
        schema,
        stats: (stats.rows || stats)[0] || {},
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.use("/widget.js", express.static(path.join(PUBLIC_DIR, "widget.js")));

  // R74.13z-quint+10b: Public instant-play routes for video/audio deliverables.
  // MUST be registered BEFORE the auth-gated /uploads middleware so customers
  // clicking the "Watch Now" button in their delivery email get instant playback
  // (no Drive transcoder wait, no Drive mobile-app interception, no auth wall).
  // Security model: the URL contains a 128-bit random token in the filename, so
  // it's unguessable — same model as Google Drive's "anyone with link" sharing.
  {
    const { mountInstantPlayRoutes } = await import("./instant-play");
    mountInstantPlayRoutes(app);
  }

  // R64.C — DELIVERY HARDENING:
  // The /uploads static mount used to serve any file on disk to ANYONE,
  // bypassing the hardened /uploads/:filename auth route below. We now
  // gate the entire /uploads namespace at the middleware boundary:
  //   1) Require either a signed expiring URL (?tid=&exp=&sig=) OR a
  //      Bearer session token.
  //   2) If the file has a file_storage row, enforce tenant ownership —
  //      no cross-tenant reads even with a valid session.
  // Files without a DB row (legacy / /tmp uploads / dev-only) are still
  // served once authenticated, but the static directory is restricted
  // to the project's uploads/ folder (no path traversal).
  app.use("/uploads", async (req: Request, res: Response, next: express.NextFunction) => {
    const ext = path.extname(req.path).toLowerCase();
    const baseName = path.basename(req.path);
    const relPath = req.path.replace(/^\/+/, "");
    const sigQ = typeof req.query.sig === "string" ? req.query.sig : "";
    const expQ = typeof req.query.exp === "string" ? req.query.exp : "";
    const tidQ = typeof req.query.tid === "string" ? req.query.tid : "";
    // Path-confusion guard: both the signature and the file_storage ownership
    // check are keyed on basename only. A nested request path could therefore
    // replay a basename signature against a same-basename file in another
    // tenant's subdir. Signed delivery URLs are ALWAYS flat (delivery-pipeline
    // writes basenames into uploads/ root), so a *signed* request MUST be flat.
    // The one legitimate nested tree is the unsigned, Bearer-authed
    // presenter-slides thumbnail cache (server/google-workspace.ts emits
    // /uploads/presenter-slides/<presentationId>/<file>) — allow exactly that
    // shape and reject every other nested path.
    const isFlat = relPath === baseName;
    const isPresenterSlide =
      !relPath.includes("..") &&
      /^presenter-slides\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(relPath);
    const usingSignature = Boolean(sigQ && expQ && tidQ);
    if (!isFlat && (usingSignature || !isPresenterSlide)) {
      return res.status(404).json({ error: "File not found" });
    }

    // ---- Auth gate (signed URL or Bearer) ----
    let authedTenantId: number | undefined;
    // True only when auth came from a valid signed capability URL — which binds
    // this exact (baseName, tenant) pair via HMAC. A bare platform session does
    // NOT carry that per-file binding, so it must not reach a delivery asset that
    // has no file_storage owner row to verify against (see ownership check below).
    let authViaSignedUrl = false;
    if (sigQ && expQ && tidQ) {
      try {
        const { verifyUploadSig } = await import("./upload-signing");
        const tid = Number(tidQ);
        const exp = Number(expQ);
        if (Number.isFinite(tid) && verifyUploadSig(baseName, tid, exp, sigQ)) {
          authedTenantId = tid;
          authViaSignedUrl = true;
        }
      } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    }
    if (authedTenantId === undefined) {
      const bearer = req.headers.authorization?.replace("Bearer ", "") || "";
      if (bearer && isValidSession(bearer)) {
        authedTenantId = getTenantFromRequest(req) ?? undefined;
        if (!authedTenantId) {
          const session = getSessionSync(bearer);
          if (session) authedTenantId = session.tenantId;
        }
      }
    }
    if (authedTenantId === undefined) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // ---- Tenant ownership check via file_storage ----
    try {
      const { db } = await import("./db");
      const { eq } = await import("drizzle-orm");
      // Fetch ALL owners of this basename (not LIMIT 1) so a cross-tenant
      // basename collision can't non-deterministically bind to the wrong row —
      // which would both false-deny the legitimate owner AND misattribute the
      // adoption-funnel event below. If ANY file_storage row for this basename
      // belongs to the authenticated tenant, the requester is a legitimate
      // owner; otherwise (rows exist but none are theirs) deny with 404 so we
      // don't leak existence to other tenants.
      const owners = await db.select({ tenantId: fileStorage.tenantId })
        .from(fileStorage).where(eq(fileStorage.filename, baseName));
      if (owners.length > 0 && !owners.some((o) => o.tenantId === authedTenantId)) {
        return res.status(404).json({ error: "File not found" });
      }
      // Delivery assets (`delivery-<id>-*`) intentionally have NO file_storage
      // owner row — they're authorized by the signed capability URL, not by
      // file_storage. So when there's no owner row to verify against, a delivery
      // asset MUST have been reached via a valid signed URL. A bare platform
      // session (any tenant) must not be able to read another tenant's delivery
      // file by guessing the sequential id; deny (404, no existence leak). This
      // also guarantees the adoption-funnel write below is attributed to a tenant
      // that provably owns this exact file.
      if (owners.length === 0 && /^delivery-\d+-/.test(baseName) && !authViaSignedUrl) {
        return res.status(404).json({ error: "File not found" });
      }
    } catch (dbErr) {
      console.error("[uploads-auth] DB ownership check failed:", (dbErr as Error).message);
      // Fail closed — if we can't verify ownership, deny.
      return res.status(503).json({ error: "Storage unavailable" });
    }
    // Customer-delivery HTML apps (named `delivery-<id>-*.html`) are allowed
    // to render in-browser when the customer explicitly opts in with ?play=1
    // — this is the "tap to open on mobile" path. We sandbox with strict CSP
    // because Drive's mobile preview can't render HTML and download-then-
    // double-click doesn't work on phones. Other .html / .svg / .xml files
    // remain octet-stream by default.
    const isDeliveryHtml = ext === ".html" && /^delivery-\d+-/.test(baseName);
    const wantsPlay = req.query.play === "1";
    if (isDeliveryHtml && wantsPlay) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      // Lock down the page: no remote scripts, no framing of arbitrary origins,
      // no plugins. Allows inline JS/CSS so single-file apps still work.
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self' 'unsafe-inline' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
      );
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "no-referrer");
    } else if ([".html", ".htm", ".svg", ".xml"].includes(ext)) {
      res.setHeader("Content-Disposition", "attachment");
      res.setHeader("Content-Type", "application/octet-stream");
    } else if (req.query.dl === "1" || req.query.download === "1") {
      // Force browser to save instead of stream — used for the "Download" button
      // in delivery emails so customers get a real file save (and don't get
      // hijacked by Drive's mobile preview).
      const filename = path.basename(req.path);
      res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
    }
    // SSRN 6859839 adoption signal — record a confirmed recipient fetch of a
    // delivered file so the produce -> ship -> adopt funnel on
    // /admin/ecosystem-health is real, not a vibe. Recorded on response 'finish'
    // and gated by parseDeliveryFetch() so ONLY a successful (200/206) INITIAL
    // GET counts — a 404/403, a mid-stream 206 chunk, or a bad filename never
    // fabricates adoption (the paper's whole point). A synthetic delivery_id is
    // harmless too: summarizeDeliveryFunnel only counts ids that JOIN a real
    // shipped delivery_logs row for the tenant. Strictly fire-and-forget — must
    // never block or break file serving.
    if (req.method === "GET" && /^delivery-\d+-/.test(baseName)) {
      const tid = authedTenantId;
      const isDownload = req.query.dl === "1" || req.query.download === "1";
      const rangeHeader = req.headers.range;
      res.on("finish", () => {
        void import("./delivery-funnel")
          .then(({ parseDeliveryFetch, recordDeliveryEngagement }) => {
            const decision = parseDeliveryFetch({
              method: req.method,
              baseName,
              range: rangeHeader,
              statusCode: res.statusCode,
            });
            if (!decision.record) return;
            return recordDeliveryEngagement({
              tenantId: tid,
              deliveryId: decision.deliveryId,
              eventType: isDownload ? "download" : "fetch",
              fileName: baseName,
            });
          })
          .catch((e) => logSilentCatch("server/routes.ts", e));
      });
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  }, express.static(path.join(process.cwd(), "uploads")));
  // R115.5+sec round 3 — `/deliverables` previously served the entire directory
  // as `express.static`, relying on filename entropy for access control. Replaced
  // with an explicit-allowlist handler: only the Cascadia Comfort HVAC landing-
  // page variants and the `project-N/*` subdirs (intentionally-public artifacts)
  // are served. Anything else 404s. Defense-in-depth against future drops into
  // `deliverables/` that contain tenant-private content (the project convention
  // routes private artifacts through `deliverDigitalProduct()` → `/uploads/`).
  app.use("/deliverables", (req: Request, res: Response, next) => {
    const rawPath = req.path.replace(/^\/+/, "");
    // Reject traversal + absolute-ish + null-byte attempts before resolution.
    if (rawPath.includes("..") || rawPath.includes("\0") || rawPath.startsWith("/")) {
      return res.status(404).end();
    }
    const allowed =
      /^cascadia[-_]comfort[-_]hvac[-_a-z0-9]*\.html$/i.test(rawPath) ||
      /^project-\d+\/[A-Za-z0-9._-]+\.[A-Za-z0-9]+$/.test(rawPath);
    if (!allowed) {
      return res.status(404).end();
    }
    next();
  }, express.static(path.join(process.cwd(), "deliverables")));

  app.get("/api/public/site-config", async (_req: Request, res: Response) => {
    try {
      const { getPublicSiteConfig } = await import("./site-config");
      res.json(getPublicSiteConfig());
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load site config" });
    }
  });

  // R63.7 gate-before-compress — public read-only stats for the API cost cache.
  // Shows how many expensive API calls have been short-circuited by the cache
  // (image gen, TTS) and the estimated USD savings since process start.
  app.get("/api/cache/stats", async (req: Request, res: Response) => {
    // R74 SECURITY: was pre-auth, leaking system internals. Now admin-only
    // — same gate as /api/onedrive-health below it. Code-review HIGH fix.
    if (!isAdminRequest(req)) {
      return res.status(403).json({ error: "Admin only" });
    }
    try {
      const { getCacheStats } = await import("./cache-gate");
      const s = getCacheStats();
      res.json({
        ...s,
        hitRate: s.hits + s.misses === 0 ? 0 : Number((s.hits / (s.hits + s.misses)).toFixed(3)),
        savedUsdFormatted: `$${s.savedUsd.toFixed(3)}`,
        note: "Counters reset on server restart. File cache itself is persistent in .api-cache/",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/setup/status", async (req: Request, res: Response) => {
    // R74 SECURITY: was leaking the entire env-var matrix to unauthenticated
    // probes (giving attackers a complete fingerprint of which integrations
    // are configured). Now: full matrix only on a fresh deploy (when no
    // tenant/admin exists yet — needed by the public setup wizard) OR for
    // an authenticated admin. Otherwise, only return the bare boolean.
    // Code-review HIGH fix.
    try {
      const hasDb = !!process.env.DATABASE_URL;
      let hasTenant = false;
      let hasAdmin = false;
      if (hasDb) {
        try {
          const tenantResult = await db.execute(sql`SELECT id FROM tenants LIMIT 1`);
          hasTenant = ((tenantResult as any).rows || tenantResult).length > 0;
          const userResult = await db.execute(sql`SELECT id FROM users LIMIT 1`);
          hasAdmin = ((userResult as any).rows || userResult).length > 0;
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      }
      const isFreshDeploy = !hasTenant && !hasAdmin;
      const adminAuthed = isAdminRequest(req);
      const exposeMatrix = isFreshDeploy || adminAuthed;

      if (!exposeMatrix) {
        const needsSetup = !hasDb;
        return res.json({ needsSetup, isFreshDeploy: false });
      }

      const hasSiteConfig = !!(process.env.SITE_COMPANY_NAME || process.env.SITE_OWNER_EMAIL);
      const hasAi = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.XAI_API_KEY || process.env.OPENROUTER_API_KEY);
      const hasEmail = !!process.env.AGENTMAIL_API_KEY;
      const hasPayments = !!(process.env.STRIPE_LIVE_SECRET_KEY || process.env.STRIPE_SECRET_KEY);
      const hasDrive = !!process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
      const hasVoice = !!process.env.ELEVENLABS_API_KEY;
      const hasScraping = !!(process.env.FIRECRAWL_API_KEY || process.env.BROWSERLESS_API_KEY);
      const hasTelegram = !!process.env.TELEGRAM_BOT_TOKEN;
      const hasDiscord = !!process.env.DISCORD_BOT_TOKEN;
      const hasCoinbase = !!(process.env.COINBASE_COMMERCE_API_KEY || process.env.COINBASE_CDP_API_KEY_ID);

      const checks = {
        database: hasDb,
        tenant: hasTenant,
        adminUser: hasAdmin,
        siteConfig: hasSiteConfig,
        aiProvider: hasAi,
        email: hasEmail,
        payments: hasPayments,
        drive: hasDrive,
        voice: hasVoice,
        scraping: hasScraping,
        telegram: hasTelegram,
        discord: hasDiscord,
        crypto: hasCoinbase,
      };
      const needsSetup = !checks.database || !checks.aiProvider || isFreshDeploy;
      res.json({ needsSetup, isFreshDeploy, checks });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to check setup status" });
    }
  });

  app.get("/api/public/deliverable/:project/:file", (req, res) => {
    const projectParam = req.params.project.replace(/[^a-zA-Z0-9_-]/g, "");
    const fileParam = path.basename(req.params.file as string);
    const baseDir = path.resolve(process.cwd(), "deliverables", `project-${projectParam}`);
    const filePath = path.resolve(baseDir, fileParam);
    if (!filePath.startsWith(baseDir)) return res.status(400).send("Invalid path");
    if (!fs.existsSync(filePath)) return res.status(404).send("File not found");
    res.sendFile(filePath);
  });

  app.use("/api", tenantRateLimiter);

  const csrfMiddleware = createCsrfMiddleware(getTenantFromRequestAsync);
  app.use("/api", csrfMiddleware);

  app.post("/api/auth/login", loginLimiter, handleLogin);
  app.get("/api/auth/status", handleAuthStatus);

  // R79.3d — Public HITL approve/deny endpoints. Registered BEFORE the
  // /api authMiddleware gate at line ~2064 because the email recipient
  // (the owner) doesn't have a session cookie when clicking the link.
  // Token signature IS the auth — see server/hitl-tokens.ts.
  //
  // CRITICAL DESIGN: GET is idempotent and renders a confirmation page
  // with a button; POST actually resolves the confirmation. This blocks
  // email link prefetchers (Outlook Safe Links, corporate URL scanners,
  // Slack unfurl, antivirus) from silently auto-approving HITL requests
  // by fetching the link in transit. Without this split, ANY corporate
  // mail scanner Bob's email goes through would auto-resolve every HITL
  // before he even sees the email — strictly worse than the original
  // "no clickable links" problem.
  const hitlPage = (status: "ok" | "error" | "confirm", title: string, body: string, opts?: { token?: string; decision?: "approve" | "deny"; cid?: string }): string => {
    const accent = status === "ok" ? "#16a34a" : status === "error" ? "#dc2626" : "#2563eb";
    const icon = status === "ok" ? "&#10003;" : status === "error" ? "&#10007;" : "&#9888;";
    let buttonBlock = "";
    if (status === "confirm" && opts?.token && opts?.decision) {
      const btnColor = opts.decision === "approve" ? "#16a34a" : "#dc2626";
      const btnLabel = opts.decision === "approve" ? "Confirm Approve" : "Confirm Deny";
      const prefix = (opts as any).actionPrefix || "/api/hitl";
      const action = opts.decision === "approve" ? `${prefix}/approve` : `${prefix}/deny`;
      buttonBlock = `<form method="POST" action="${action}" style="margin-top:24px;">
        <input type="hidden" name="token" value="${opts.token.replace(/"/g, "&quot;")}"/>
        <button type="submit" style="background:${btnColor};color:#fff;border:none;padding:14px 32px;border-radius:6px;font-weight:600;font-size:16px;cursor:pointer;">${btnLabel}</button>
      </form>
      <p style="font-size:11px;color:#aaa;margin-top:16px;">This two-step flow protects against email link prefetchers (Outlook Safe Links, antivirus scanners) that fetch URLs automatically.</p>`;
    }
    return `<!doctype html><html><head><meta name="robots" content="noindex,nofollow"/><meta name="referrer" content="no-referrer"/></head><body style="font-family:-apple-system,sans-serif;max-width:480px;margin:80px auto;padding:24px;color:#222;text-align:center;">
      <div style="font-size:48px;margin-bottom:8px;color:${accent};">${icon}</div>
      <h1 style="color:${accent};margin:0 0 16px 0;">${title}</h1>
      <p style="color:#555;line-height:1.5;">${body}</p>
      ${buttonBlock}
      <p style="color:#999;font-size:12px;margin-top:32px;">&mdash; VisionClaw HITL</p>
    </body></html>`;
  };

  const renderHitlConfirmPage = async (req: Request, res: Response) => {
    try {
      const { verifyHitlToken } = await import("./hitl-tokens");
      const token = String(req.query.token || "");
      const payload = verifyHitlToken(token);
      if (!payload) {
        return res.status(400).type("html").send(hitlPage("error", "Link invalid or expired", "This approval link could not be verified. It may have been tampered with, expired, or the server was restarted with a new key. Open the workspace or reply via WhatsApp instead."));
      }
      const expectedDecision = req.path.endsWith("/approve") ? "approve" : "deny";
      if (payload.decision !== expectedDecision) {
        return res.status(400).type("html").send(hitlPage("error", "Token mismatch", "This token doesn't match the action requested."));
      }
      // Render confirmation page — does NOT mutate state. State change
      // happens on the POST after Bob clicks the button.
      const verb = payload.decision === "approve" ? "approve" : "deny";
      return res.type("html").send(
        hitlPage(
          "confirm",
          `Confirm ${verb}?`,
          `You're about to <b>${verb}</b> agent action <code style="font-size:11px;color:#888;">${payload.cid}</code> for tenant ${payload.tid}.`,
          { token, decision: payload.decision, cid: payload.cid },
        ),
      );
    } catch (err: any) {
      console.warn(`[hitl-link] GET error: ${err.message}`);
      res.status(500).type("html").send(hitlPage("error", "Server error", "Something went wrong loading this approval page."));
    }
  };

  const handleHitlSubmit = async (req: Request, res: Response) => {
    try {
      const { verifyHitlToken } = await import("./hitl-tokens");
      const token = String((req.body && (req.body as any).token) || req.query.token || "");
      const payload = verifyHitlToken(token);
      if (!payload) {
        return res.status(400).type("html").send(hitlPage("error", "Link invalid or expired", "This approval link could not be verified."));
      }
      const expectedDecision = req.path.endsWith("/approve") ? "approve" : "deny";
      if (payload.decision !== expectedDecision) {
        return res.status(400).type("html").send(hitlPage("error", "Token mismatch", "This token doesn't match the action requested."));
      }
      const approved = payload.decision === "approve";
      const resolved = resolveToolConfirmation(payload.cid, approved, payload.tid);
      if (!resolved) {
        return res.type("html").send(hitlPage("error", "Already handled", `This request was already resolved (or timed out and auto-denied). No action taken.`));
      }
      return res.type("html").send(hitlPage("ok", approved ? "Approved" : "Denied", `The agent action has been ${approved ? "approved and will proceed" : "denied"}.<br/><br/><code style="font-size:11px;color:#999;">${payload.cid}</code>`));
    } catch (err: any) {
      console.warn(`[hitl-link] POST error: ${err.message}`);
      res.status(500).type("html").send(hitlPage("error", "Server error", "Something went wrong handling this approval. Try the workspace or WhatsApp instead."));
    }
  };

  app.get("/api/hitl/approve", renderHitlConfirmPage);
  app.get("/api/hitl/deny", renderHitlConfirmPage);
  app.post("/api/hitl/approve", express.urlencoded({ extended: false }), handleHitlSubmit);
  app.post("/api/hitl/deny", express.urlencoded({ extended: false }), handleHitlSubmit);

  // Built With Bob — durable one-tap weekly-recap approval (publish on approve).
  // Mirrors the HITL prefetch-safe GET-confirm / POST-resolve flow, but resolves
  // against the durable `agentApprovals` row (cid = bwb-approval-<id>) and, on
  // approve, publishes to YouTube + native Facebook video.
  const renderBwbConfirmPage = async (req: Request, res: Response) => {
    try {
      const { verifyHitlToken } = await import("./hitl-tokens");
      const { bwbApprovalIdFromCid } = await import("./bwb-weekly-publish");
      const token = String(req.query.token || "");
      const payload = verifyHitlToken(token);
      if (!payload || bwbApprovalIdFromCid(payload.cid) == null) {
        return res.status(400).type("html").send(hitlPage("error", "Link invalid or expired", "This approval link could not be verified. It may have been tampered with, expired, or the server restarted with a new key."));
      }
      const expectedDecision = req.path.endsWith("/approve") ? "approve" : "deny";
      if (payload.decision !== expectedDecision) {
        return res.status(400).type("html").send(hitlPage("error", "Token mismatch", "This token doesn't match the action requested."));
      }
      const verb = payload.decision === "approve" ? "approve &amp; publish" : "deny";
      return res.type("html").send(
        hitlPage(
          "confirm",
          payload.decision === "approve" ? "Approve & publish?" : "Deny?",
          `You're about to <b>${verb}</b> this week's Built With Bob recap <code style="font-size:11px;color:#888;">${payload.cid}</code>.`,
          { token, decision: payload.decision, cid: payload.cid, actionPrefix: "/api/bwb" } as any,
        ),
      );
    } catch (err: any) {
      console.warn(`[bwb-link] GET error: ${err.message}`);
      res.status(500).type("html").send(hitlPage("error", "Server error", "Something went wrong loading this approval page."));
    }
  };

  const handleBwbSubmit = async (req: Request, res: Response) => {
    try {
      const { verifyHitlToken } = await import("./hitl-tokens");
      const { bwbApprovalIdFromCid, resolveBwbApproval } = await import("./bwb-weekly-publish");
      const token = String((req.body && (req.body as any).token) || req.query.token || "");
      const payload = verifyHitlToken(token);
      const approvalId = payload ? bwbApprovalIdFromCid(payload.cid) : null;
      if (!payload || approvalId == null) {
        return res.status(400).type("html").send(hitlPage("error", "Link invalid or expired", "This approval link could not be verified."));
      }
      const expectedDecision = req.path.endsWith("/approve") ? "approve" : "deny";
      if (payload.decision !== expectedDecision) {
        return res.status(400).type("html").send(hitlPage("error", "Token mismatch", "This token doesn't match the action requested."));
      }
      const approved = payload.decision === "approve";
      const outcome = await resolveBwbApproval({ approvalId, tenantId: payload.tid, approved, decidedBy: "bwb-email-link" });
      if (!outcome.ok) {
        const msg = outcome.reason === "already_handled"
          ? "This recap was already approved or denied. No action taken."
          : "This approval could not be found for your account.";
        return res.type("html").send(hitlPage("error", "Already handled", msg));
      }
      if (!outcome.approved) {
        return res.type("html").send(hitlPage("ok", "Denied", "The weekly recap was denied and will NOT be published."));
      }
      const yt = outcome.publish.youtube;
      const fb = outcome.publish.facebook;
      // Escape provider-supplied strings (postUrl / error) before they land in
      // the HTML confirmation page — they are not trusted markup.
      const esc = (s: unknown) =>
        String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
      const lines = [
        `YouTube: ${yt.success ? `published — ${esc(yt.postUrl)}` : `FAILED — ${esc(yt.error || "unknown")}`}`,
        `Facebook: ${fb.success ? `published — ${esc(fb.postUrl)}` : `FAILED — ${esc(fb.error || "unknown")}`}`,
      ].join("<br/>");
      const anyOk = yt.success || fb.success;
      return res.type("html").send(hitlPage(anyOk ? "ok" : "error", anyOk ? "Approved & published" : "Approved but publish failed", lines));
    } catch (err: any) {
      console.warn(`[bwb-link] POST error: ${err.message}`);
      res.status(500).type("html").send(hitlPage("error", "Server error", "Something went wrong handling this approval."));
    }
  };

  app.get("/api/bwb/approve", renderBwbConfirmPage);
  app.get("/api/bwb/deny", renderBwbConfirmPage);
  app.post("/api/bwb/approve", express.urlencoded({ extended: false }), handleBwbSubmit);
  app.post("/api/bwb/deny", express.urlencoded({ extended: false }), handleBwbSubmit);

  app.get("/api/auth/csrf-token", async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.json({ csrfToken: null });
    // SECURITY (R74.13u-sec): key CSRF tokens by per-session id (Bearer token
    // hash or Replit OIDC sub) so two browser sessions in the same tenant
    // can't share/replay each other's tokens. Falls back to tenant id only
    // when no session signal is available.
    const sessionKey = getCsrfSessionKey(req, tenantId);
    if (!sessionKey) return res.json({ csrfToken: null });
    const token = generateCsrfToken(sessionKey);
    res.json({ csrfToken: token });
  });
  app.post("/api/tenants/register", loginLimiter, handleTenantRegister);
  app.post("/api/tenants/login", loginLimiter, handleTenantLogin);

  app.post("/api/onboarding/seen", authMiddleware, async (req, res) => {
    try {
      const tid = getTenantFromRequest(req);
      if (!tid) return res.status(401).json({ error: "Not authenticated" });
      await db.execute(sql`UPDATE tenants SET onboarding_seen = true WHERE id = ${tid}`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update onboarding status" });
    }
  });
  app.post("/api/auth/forgot-password", loginLimiter, handleForgotPassword);
  app.post("/api/auth/reset-password", loginLimiter, handleResetPassword);
  app.post("/api/auth/verify-email", loginLimiter, handleVerifyEmail);
  app.post("/api/auth/resend-verification", loginLimiter, handleResendVerification);

  app.get("/api/tenants/me", async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      res.set("Cache-Control", "no-cache, no-store");
      res.json({
        id: tenant.id,
        name: tenant.name,
        email: tenant.email,
        plan: tenant.plan,
        trialConversationsUsed: tenant.trialConversationsUsed,
        trialMaxConversations: tenant.trialMaxConversations,
        isAdmin: tenantId === ADMIN_TENANT_ID || !!tenant.isAdmin,
        isActive: tenant.isActive,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Round 18: hand-edited user profile (OpenClaw USER.md equivalent)
  app.get("/api/tenants/me/profile", async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      res.set("Cache-Control", "no-cache, no-store");
      res.json({
        userNotesMarkdown: (tenant as any).userNotesMarkdown || "",
        disabledSkillNames: (tenant as any).disabledSkillNames || [],
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  app.patch("/api/tenants/me/profile", mutateLimiter, async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { userNotesMarkdown, disabledSkillNames } = req.body || {};
      const updates: any = {};
      if (typeof userNotesMarkdown === "string") {
        if (userNotesMarkdown.length > 32_000) return res.status(400).json({ error: "userNotesMarkdown exceeds 32KB" });
        updates.userNotesMarkdown = userNotesMarkdown;
      }
      if (Array.isArray(disabledSkillNames)) {
        if (disabledSkillNames.some(n => typeof n !== "string")) return res.status(400).json({ error: "disabledSkillNames must be string array" });
        if (disabledSkillNames.length > 200) return res.status(400).json({ error: "disabledSkillNames cap is 200" });
        updates.disabledSkillNames = disabledSkillNames;
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update" });
      const updated = await storage.updateTenant(tenantId, updates);
      res.json({
        userNotesMarkdown: (updated as any)?.userNotesMarkdown || "",
        disabledSkillNames: (updated as any)?.disabledSkillNames || [],
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.get("/api/public/stats", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql: s } = await import("drizzle-orm");
      const [[convCount], [msgCount], [taskCount], [memCount], [logCount]] = await Promise.all([
        db.select({ count: s<number>`count(*)::int` }).from(conversations),
        db.select({ count: s<number>`count(*)::int` }).from(messages),
        db.select({ count: s<number>`count(*)::int` }).from(heartbeatTasks),
        db.select({ count: s<number>`count(*)::int` }).from(memoryEntries),
        db.select({ count: s<number>`count(*)::int` }).from(heartbeatLogs),
      ]);
      res.json({
        totalConversations: convCount.count,
        totalMessages: msgCount.count,
        totalAutonomousTasks: taskCount.count,
        totalTasksRun: logCount.count,
        totalMemories: memCount.count,
        status: "online",
        uptime: Math.floor(process.uptime()),
      });
    } catch (err: any) {
      console.error("[public-stats] Error:", err.message);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  app.get("/api/public/architecture", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql: s } = await import("drizzle-orm");
      const { getRegistryStats } = await import("./tool-registry") as any;
      const toolStats = getRegistryStats();
      const [convR, msgR, personaR, projR, skillR, memR, taskR, logR, inboxR, ruleR, personaListR, researchR] = await Promise.all([
        db.execute(s`SELECT count(*)::int as count FROM conversations`),
        db.execute(s`SELECT count(*)::int as count FROM messages`),
        db.execute(s`SELECT count(*)::int as count FROM personas WHERE is_active = true`),
        db.execute(s`SELECT count(*)::int as count FROM projects`),
        db.execute(s`SELECT count(*)::int as count FROM skills`),
        db.execute(s`SELECT count(*)::int as count FROM memory_entries`),
        db.execute(s`SELECT count(*)::int as count FROM heartbeat_tasks`),
        db.execute(s`SELECT count(*)::int as count FROM heartbeat_logs`),
        db.execute(s`SELECT count(*)::int as count FROM inbox_messages`),
        db.execute(s`SELECT count(*)::int as count FROM governance_rules`),
        db.execute(s`SELECT name, role, cost_tier as "costTier" FROM personas WHERE is_active = true ORDER BY name`),
        db.execute(s`SELECT count(*)::int as count FROM research_sessions`),
      ]);
      const getCount = (r: any) => ((r as any).rows || r)?.[0]?.count || 0;
      const personaList = ((personaListR as any).rows || personaListR) || [];
      const personaCount = getCount(personaR);
      const skillCount = getCount(skillR);
      const ruleCount = getCount(ruleR);

      res.json({
        stats: {
          conversations: getCount(convR),
          messages: getCount(msgR),
          personas: personaCount,
          projects: getCount(projR),
          skills: skillCount,
          memories: getCount(memR),
          autonomousTasks: getCount(taskR),
          tasksExecuted: getCount(logR),
          emailsProcessed: getCount(inboxR),
          governanceRules: ruleCount,
          tools: toolStats.total,
          researchSessions: getCount(researchR),
        },
        personas: personaList,
        architecture: {
          layers: [
            { name: "CEO Orchestrator", component: "Felix", description: "Autonomous CEO agent — delegates, monitors, decides" },
            { name: "Persona Team", component: `${personaCount} Specialists`, description: `${personaList.slice(0, 4).map((p: any) => p.name).join(", ")}, and ${Math.max(0, personaCount - 4)} more` },
            { name: "Tool Layer", component: `${toolStats.total}+ Tools`, description: "Google Drive, Slides, Docs, Search, Code, Email, Voice, PDF, Video, Research" },
            { name: "Skill Layer", component: `${skillCount}+ Skills`, description: "Domain expertise modules loaded on-demand by agents" },
            { name: "Memory System", component: "Persistent Memory", description: "Long-term memory, scratchpads, project brains, knowledge base" },
            { name: "Governance", component: `${ruleCount} Rules`, description: "Trust scores, spending limits, approval chains, safety guardrails" },
            { name: "Heartbeat Engine", component: "Autonomous Tasks", description: "Scheduled background tasks — research, monitoring, reporting" },
            { name: "Communication", component: "Multi-Channel", description: "Chat, Email, WhatsApp, Voice, Webhooks, MCP" },
          ],
          agentLoop: {
            steps: ["PERCEIVE", "REASON", "ACT", "OBSERVE", "REPEAT"],
            maxToolRounds: 7,
            maxToolCallsPerRound: 6,
            models: ["Claude (Anthropic)", "GPT-4o (OpenAI)", "Grok (xAI)", "Gemini (Google)"],
          },
        },
        uptime: Math.floor(process.uptime()),
        status: "online",
      });
    } catch (err: any) {
      console.error("[architecture] Error:", err.message);
      res.status(500).json({ error: "Failed to fetch architecture data" });
    }
  });

  app.get("/api/public/stripe/products", async (_req: Request, res: Response) => {
    try {
      const { db } = await import("./db");
      const { sql: s } = await import("drizzle-orm");
      const result = await db.execute(s`
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.active as product_active,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring,
          pr.active as price_active
        FROM stripe.products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true
        ORDER BY pr.unit_amount ASC NULLS LAST
      `);

      const productsMap = new Map<string, any>();
      for (const row of result.rows) {
        const r = row as any;
        if (!productsMap.has(r.product_id)) {
          productsMap.set(r.product_id, {
            id: r.product_id,
            name: r.product_name,
            description: r.product_description,
            metadata: r.product_metadata,
            prices: [],
          });
        }
        if (r.price_id) {
          productsMap.get(r.product_id).prices.push({
            id: r.price_id,
            unit_amount: r.unit_amount,
            currency: r.currency,
            recurring: r.recurring,
          });
        }
      }

      res.json({ products: Array.from(productsMap.values()) });
    } catch (err: any) {
      console.error("[public-stripe] Products error:", err.message);
      res.json({ products: [] });
    }
  });

  const checkoutRateLimit = new Map<string, number[]>();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of checkoutRateLimit) {
      const valid = timestamps.filter(t => now - t < 120000);
      if (valid.length === 0) checkoutRateLimit.delete(ip);
      else checkoutRateLimit.set(ip, valid);
    }
  }, 10 * 60 * 1000);
  app.post("/api/public/stripe/checkout", validate(stripeCheckoutSchema), async (req: Request, res: Response) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const windowMs = 60000;
      const maxRequests = 5;
      const timestamps = (checkoutRateLimit.get(ip) || []).filter(t => now - t < windowMs);
      if (timestamps.length >= maxRequests) return res.status(429).json({ error: "Too many requests. Please try again later." });
      timestamps.push(now);
      checkoutRateLimit.set(ip, timestamps);

      const { priceId, customerEmail } = req.body;

      // R74.13z-quint+7 SECURITY follow-up (Tier-1): mirror the priceId
      // allowlist already enforced on the authenticated /api/stripe/checkout
      // route. Without this, an anonymous caller could pass any active price
      // ID in the Stripe account (e.g. a $0.01 trial price for the
      // enterprise plan).
      //
      // R125+12+sec (architect HIGH closed 2026-05-24): this is the anonymous
      // public checkout — additionally require product.metadata.kind='audit'
      // to scope it to the wedge funnel only. New anonymous-sale categories
      // must either get a dedicated route OR set kind='audit'.
      {
        const { db: _db } = await import("./db");
        const { sql: _sql } = await import("drizzle-orm");
        const allow = await _db.execute(_sql`
          SELECT pr.id
          FROM stripe.prices pr
          JOIN stripe.products p ON p.id = pr.product
          WHERE pr.id = ${priceId}
            AND pr.active = true
            AND p.active = true
            AND p.metadata->>'kind' = 'audit'
          LIMIT 1
        `);
        if (((allow as any).rows || allow).length === 0) {
          return res.status(400).json({ error: "Unknown, inactive, or non-audit priceId" });
        }
      }

      // R125+12+sec (architect HIGH closed 2026-05-24): mirror canonical-domain
      // enforcement from /api/stripe/checkout — never trust the Host header
      // for success/cancel URLs in production (redirect-target manipulation).
      const domains = process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || "";
      const primaryDomain = domains.split(",")[0]?.trim();
      if (!primaryDomain && process.env.NODE_ENV === "production") {
        return res.status(500).json({ error: "Checkout disabled: no canonical domain configured" });
      }
      const baseUrl = primaryDomain ? `https://${primaryDomain}` : `${req.protocol}://${req.get('host')}`;

      const stripe = await getUncachableStripeClient();
      const sessionData: any = {
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${baseUrl}/?status=success`,
        cancel_url: `${baseUrl}/?status=cancelled`,
      };
      if (customerEmail) sessionData.customer_email = customerEmail;

      // When the visitor supplied an email, that's a stable per-customer
      // identity — keep using it so an honest double-click within Stripe's
      // 24h window still dedups to the same session. Without an email the
      // prior `pub_<ip>` partition collapsed every cookieless visitor
      // behind a shared NAT/CDN edge onto one slot, so two strangers
      // checking out at the same moment could collide on a single Stripe
      // idempotency key. Falling back to `anonymousVisitorPartition` makes
      // the partition unique per visitor (session id / client token / UUID).
      const partition = customerEmail
        ? `pub_email_${customerEmail}`
        : `pub_${anonymousVisitorPartition(req)}`;
      const session = await stripe.checkout.sessions.create(sessionData, {
        idempotencyKey: buildCheckoutIdempotencyKey(partition, "subscription", sessionData),
      });
      res.json({ url: session.url, sessionId: session.id });
    } catch (err: any) {
      console.error("[public-stripe] Checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  app.get("/api/drive-health", async (req: Request, res: Response) => {
    // R74 SECURITY: was pre-auth, leaking integration posture. Now admin-only
    // — same gate as /api/onedrive-health below it for symmetry.
    // Code-review HIGH fix.
    if (!isAdminRequest(req)) {
      return res.status(403).json({ connected: false, error: "Admin only" });
    }
    try {
      const { getDriveHealthStatus, isDemoMode } = await import("./google-drive");
      const health = getDriveHealthStatus(true);
      res.json({ ...health, demoMode: isDemoMode() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/onedrive-health", async (req: Request, res: Response) => {
    try {
      if (!isAdminRequest(req)) {
        return res.status(403).json({ connected: false, error: "Admin only" });
      }
      const { getOneDriveHealth } = await import("./onedrive");
      const health = await getOneDriveHealth();
      res.json(health);
    } catch (e: any) {
      res.status(500).json({ connected: false, error: e.message });
    }
  });

  app.post("/api/demo/warmup", async (req: Request, res: Response) => {
    try {
      if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
      const { demoWarmup } = await import("./google-drive");
      const result = await demoWarmup();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/demo/exit", async (req: Request, res: Response) => {
    try {
      if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
      const { exitDemoMode } = await import("./google-drive");
      exitDemoMode();
      res.json({ success: true, message: "Demo mode deactivated, normal intervals restored" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/demo/felix-check", async (req: Request, res: Response) => {
    try {
      if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
      const checks: { name: string; status: "pass" | "fail" | "warn"; detail: string }[] = [];
      const fs = await import("fs");

      const personaResult = await db.execute(sql`SELECT id, name, role FROM personas WHERE id = 2`);
      const personaRows = (personaResult as any).rows || personaResult;
      if (personaRows.length > 0) {
        checks.push({ name: "Felix Persona", status: "pass", detail: `id=${personaRows[0].id}, name=${personaRows[0].name}` });
        const trustResult = await db.execute(sql`SELECT score FROM trust_scores WHERE persona_id = 2 AND tenant_id = 1`);
        const trustRows = (trustResult as any).rows || trustResult;
        const score = trustRows.length > 0 ? parseInt(trustRows[0].score) : 0;
        checks.push({ name: "Trust Score", status: score >= 70 ? "pass" : "warn", detail: `${score} (need ≥70 for full_auto)` });
      } else {
        checks.push({ name: "Felix Persona", status: "fail", detail: "Not found in database" });
      }

      const bloatResult = await db.execute(sql`
        SELECT c.id,
          (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) as msg_count,
          (SELECT coalesce(sum(length(m.content)), 0) FROM messages m WHERE m.conversation_id = c.id) as total_chars
        FROM conversations c WHERE c.tenant_id = 1 AND c.persona_id = 2
        ORDER BY c.id DESC LIMIT 20
      `);
      const convRows = (bloatResult as any).rows || bloatResult;
      const bloated = convRows.filter((r: any) => parseInt(r.total_chars || 0) > 500000);
      checks.push({
        name: "Conversation Health",
        status: bloated.length === 0 ? "pass" : "fail",
        detail: bloated.length === 0 ? "No bloated conversations" : `${bloated.length} conversation(s) over 500K chars`
      });

      const metaResult = await db.execute(sql`
        SELECT count(*) as cnt FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.tenant_id = 1 AND c.persona_id = 2 AND m.role = 'assistant'
          AND m.content LIKE '%<!-- tools:%' AND length(m.content) > 50000
      `);
      const metaRows = (metaResult as any).rows || metaResult;
      const metaCnt = parseInt(metaRows[0]?.cnt || 0);
      checks.push({
        name: "Tool Metadata",
        status: metaCnt === 0 ? "pass" : "warn",
        detail: metaCnt === 0 ? "No oversized metadata" : `${metaCnt} message(s) with oversized metadata`
      });

      const chatEngine = fs.readFileSync("server/chat-engine.ts", "utf-8");
      const windowMatch = chatEngine.match(/const MAX_WINDOW\s*=\s*(\d+)/);
      if (windowMatch) {
        const windowVal = parseInt(windowMatch[1]);
        checks.push({
          name: "MAX_WINDOW",
          status: windowVal <= 20 ? "pass" : "fail",
          detail: `${windowVal} messages (optimal ≤20)`
        });
      } else {
        checks.push({ name: "MAX_WINDOW", status: "fail", detail: "Setting not found in chat-engine.ts" });
      }

      const routesSrc = fs.readFileSync("server/routes.ts", "utf-8");

      const ctxCapMatch = routesSrc.match(/const MAX_CONTEXT_CHARS\s*=\s*(\d[\d_]*)/);
      if (ctxCapMatch) {
        const val = parseInt(ctxCapMatch[1].replace(/_/g, ""));
        checks.push({ name: "Context Cap", status: val <= 200_000 ? "pass" : "warn", detail: `${val.toLocaleString()} char hard cap` });
      } else {
        checks.push({ name: "Context Cap", status: "fail", detail: "No MAX_CONTEXT_CHARS found" });
      }

      const timeoutMatch = routesSrc.match(/STREAM_FIRST_CHUNK_TIMEOUT\s*=\s*(\d[\d_]*)/);
      if (timeoutMatch) {
        const val = parseInt(timeoutMatch[1].replace(/_/g, ""));
        checks.push({ name: "Stream Timeout", status: "pass", detail: `${val / 1000}s timeout active` });
      } else {
        checks.push({ name: "Stream Timeout", status: "fail", detail: "No stream timeout found" });
      }

      checks.push({
        name: "Crash Guard",
        status: routesSrc.includes("try { clearInterval(globalKeepalive)") ? "pass" : "fail",
        detail: routesSrc.includes("try { clearInterval(globalKeepalive)") ? "globalKeepalive wrapped in try/catch" : "globalKeepalive NOT wrapped — crash risk"
      });

      const hasInstructions = fs.existsSync("data/Felix-Presentation-Instructions.txt");
      const hasFeatures = fs.existsSync("data/VisionClaw-Comprehensive-Features.txt");
      const hasLogo = fs.existsSync("data/visionclaw-logo.png");
      const fileList = [hasInstructions && "Instructions", hasFeatures && "Features", hasLogo && "Logo"].filter(Boolean);
      checks.push({
        name: "Instruction Files",
        status: hasInstructions && hasFeatures ? "pass" : "fail",
        detail: fileList.length > 0 ? `${fileList.join(", ")} present` : "No instruction files found"
      });

      const toolsSrc = fs.readFileSync("server/tools.ts", "utf-8");
      const hasSlides = toolsSrc.includes("create_slides");
      const hasPdf = toolsSrc.includes("create_pdf");
      const toolList = [hasSlides && "create_slides", hasPdf && "create_pdf"].filter(Boolean);
      checks.push({
        name: "Presentation Tools",
        status: hasSlides && hasPdf ? "pass" : "fail",
        detail: toolList.length > 0 ? `${toolList.join(", ")} registered` : "No presentation tools found"
      });

      checks.push({
        name: "Browserless",
        status: process.env.BROWSERLESS_API_KEY ? "pass" : "fail",
        detail: process.env.BROWSERLESS_API_KEY ? "API key configured" : "Missing BROWSERLESS_API_KEY"
      });

      const passCount = checks.filter(c => c.status === "pass").length;
      const failCount = checks.filter(c => c.status === "fail").length;
      const warnCount = checks.filter(c => c.status === "warn").length;

      res.json({ checks, summary: { pass: passCount, fail: failCount, warn: warnCount, total: checks.length } });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const _adminUploadAttempts = new Map<string, { count: number; lockedUntil: number }>();
  const ADMIN_MAX_ATTEMPTS = 5;
  const ADMIN_LOCKOUT_MS = 15 * 60 * 1000;
  const ADMIN_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

  app.post("/api/admin-drive-upload", express.json({ limit: "10mb" }), async (req: Request, res: Response) => {
    try {
      // R64.C — DELIVERY HARDENING: require an authenticated session in
      // addition to the PIN. PIN-only authn meant any unauthenticated
      // attacker who exfiltrated/guessed the PIN could abuse this endpoint
      // to upload arbitrary content into the platform's Google Drive. The
      // session check ensures the caller is at minimum a logged-in user.
      const sessionToken = req.headers.authorization?.replace("Bearer ", "") || "";
      if (!sessionToken || !isValidSession(sessionToken)) {
        return res.status(401).json({ error: "Authentication required" });
      }
      // R74.3 SECURITY — Authenticated-but-not-admin users with a leaked
      // or guessed PIN must NOT be able to upload to the platform's Drive.
      // Require platform-admin gate as the primary authn factor; the PIN
      // remains as a secondary factor below for defense-in-depth.
      if (!requirePlatformAdmin(req, res)) return;

      const adminPin = process.env.ADMIN_PIN;
      if (!adminPin) {
        return res.status(503).json({ error: "Admin upload not configured" });
      }

      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      const attempt = _adminUploadAttempts.get(clientIp);
      if (attempt && attempt.lockedUntil > Date.now()) {
        const retryAfter = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
        return res.status(429).json({ error: "Too many failed attempts. Try again later.", retryAfter });
      }

      const { pin, data, fileName, mimeType, folderLabel } = req.body;
      const crypto = await import("crypto");
      const salt = "visionclaw-pin-v1";
      const hash = crypto.createHmac("sha256", salt).update(String(pin || "")).digest("hex");
      const expectedHash = crypto.createHmac("sha256", salt).update(adminPin).digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash))) {
        const current = _adminUploadAttempts.get(clientIp) || { count: 0, lockedUntil: 0 };
        current.count += 1;
        if (current.count >= ADMIN_MAX_ATTEMPTS) {
          current.lockedUntil = Date.now() + ADMIN_LOCKOUT_MS;
          console.warn(`[admin-upload] IP ${clientIp} locked out after ${ADMIN_MAX_ATTEMPTS} failed PIN attempts`);
        }
        _adminUploadAttempts.set(clientIp, current);
        return res.status(403).json({ error: "Unauthorized" });
      }

      if (attempt) _adminUploadAttempts.delete(clientIp);

      if (!data || !fileName) return res.status(400).json({ error: "Missing data or fileName" });
      if (typeof data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 100))) {
        return res.status(400).json({ error: "Invalid base64 data" });
      }
      const estimatedBytes = Math.ceil(data.length * 0.75);
      if (estimatedBytes > ADMIN_MAX_PAYLOAD_BYTES) {
        return res.status(413).json({ error: `Payload too large. Max ${ADMIN_MAX_PAYLOAD_BYTES / (1024 * 1024)}MB decoded.` });
      }

      const { uploadAndShare } = await import("./google-drive");
      const fileData = Buffer.from(data, "base64");

      // R64.C — VALIDATE MIME against actual file magic bytes. The client-
      // supplied mimeType cannot be trusted; an attacker could upload a HTML
      // file labelled "image/png" and serve it from Drive to host phishing
      // pages, or upload an executable labelled "application/pdf". The sniff
      // covers the common bundle Drive sees: PDF / PNG / JPG / GIF / WEBP /
      // ZIP-family (docx/xlsx/pptx) / MP3 / MP4 / WAV. Anything else falls
      // back to "application/octet-stream" so the browser will download
      // (not render/execute) the file even if the client mimeType lies.
      const sniffMime = (buf: Buffer): string | null => {
        if (buf.length < 4) return null;
        if (buf.slice(0, 4).toString() === "%PDF") return "application/pdf";
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
        if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
        if (buf.slice(0, 6).toString() === "GIF87a" || buf.slice(0, 6).toString() === "GIF89a") return "image/gif";
        if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
        if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WAVE") return "audio/wav";
        if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) return "application/zip";
        if (buf.slice(0, 3).toString() === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "audio/mpeg";
        if (buf.slice(4, 8).toString() === "ftyp") return "video/mp4";
        // R64.C — STRICT: require a recognized binary signature. The earlier
        // "<"/"["/"{" → text/plain heuristic was too permissive: HTML, SVG,
        // and XML payloads (XSS / SVG-script vectors) all match `<`. We no
        // longer auto-classify text bytes here; the upstream allowlist below
        // rejects anything not detected as a known binary type.
        return null;
      };
      const detected = sniffMime(fileData);
      const claimedMime = (typeof mimeType === "string" ? mimeType : "").toLowerCase();
      let safeMime: string;
      if (detected) {
        // ZIP family covers docx/xlsx/pptx — accept the claimed sub-type if it's an Office MIME.
        if (detected === "application/zip" && claimedMime.startsWith("application/vnd.openxmlformats-officedocument")) {
          safeMime = claimedMime;
        } else if (detected === "image/jpeg" && claimedMime === "image/jpg") {
          safeMime = "image/jpeg";
        } else if (claimedMime === detected) {
          safeMime = detected;
        } else {
          console.warn(`[admin-drive-upload] MIME mismatch — claimed="${claimedMime}", detected="${detected}". Using detected.`);
          safeMime = detected;
        }
      } else {
        // No recognized binary signature: REJECT. This blocks HTML / SVG /
        // XML / JSON / arbitrary text payloads (XSS / SVG-script / phishing
        // pages hosted from our Drive) regardless of what the client claimed.
        return res.status(415).json({ error: "Unsupported file type. Allowed: PDF, PNG, JPEG, GIF, WEBP, MP3, WAV, MP4, ZIP-family (docx/xlsx/pptx)." });
      }

      const result = await uploadAndShare({ fileData, fileName, mimeType: safeMime, folderLabel: folderLabel || "deliverables" });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/presenter/:token", async (req: Request, res: Response) => {
    try {
      const rawToken = req.params.token as string;
      const token = rawToken?.replace(/[^a-f0-9]/gi, '').slice(0, 32).toLowerCase();
      if (!token || token.length < 16 || !/^[a-f0-9]+$/.test(token)) return res.status(400).json({ error: "Invalid token" });
      const result = await db.execute(sql`SELECT id, tenant_id, presentation_id, title, slides, embed_url, present_url, token, created_at FROM presenter_sessions WHERE token = ${token}`);
      if (result.rows.length === 0) return res.status(404).json({ error: "Presenter session not found" });
      const row = result.rows[0] as any;
      res.json({
        id: row.id,
        token: row.token,
        title: row.title,
        presentationId: row.presentation_id,
        slides: typeof row.slides === "string" ? JSON.parse(row.slides) : row.slides,
        embedUrl: row.embed_url,
        presentUrl: row.present_url,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/presenter/:token/slide/:index", async (req: Request, res: Response) => {
    try {
      const rawToken = req.params.token as string;
      const token = rawToken?.replace(/[^a-f0-9]/gi, '').slice(0, 32).toLowerCase();
      const { index } = req.params;
      if (!token || token.length < 16 || !/^[a-f0-9]+$/.test(token)) return res.status(400).json({ error: "Invalid token" });
      const slideIndex = parseInt(index as string, 10);
      if (isNaN(slideIndex) || slideIndex < 0) return res.status(400).json({ error: "Invalid slide index" });
      const ALLOWED_QUALITIES = new Set(["full", "thumb"]);
      const quality = ALLOWED_QUALITIES.has(req.query.quality as string) ? (req.query.quality as string) : "full";

      const sessionResult = await db.execute(sql`SELECT id FROM presenter_sessions WHERE token = ${token}`);
      if (sessionResult.rows.length === 0) return res.status(404).json({ error: "Session not found" });
      const sessionId = (sessionResult.rows[0] as any).id;

      const imgResult = await db.execute(sql`SELECT image_data, image_size FROM presenter_slide_images WHERE session_id = ${sessionId} AND slide_index = ${slideIndex} AND quality = ${quality} LIMIT 1`);
      if (imgResult.rows.length === 0) {
        const fallback = await db.execute(sql`SELECT image_data, image_size FROM presenter_slide_images WHERE session_id = ${sessionId} AND slide_index = ${slideIndex} ORDER BY quality ASC LIMIT 1`);
        if (fallback.rows.length === 0) return res.status(404).json({ error: "Slide image not found" });
        const row = fallback.rows[0] as any;
        const buf = Buffer.isBuffer(row.image_data) ? row.image_data : Buffer.from(row.image_data);
        res.set({ "Content-Type": "image/png", "Content-Length": String(buf.length), "Cache-Control": "public, max-age=86400" });
        return res.send(buf);
      }
      const row = imgResult.rows[0] as any;
      const buf = Buffer.isBuffer(row.image_data) ? row.image_data : Buffer.from(row.image_data);
      res.set({ "Content-Type": "image/png", "Content-Length": String(buf.length), "Cache-Control": "public, max-age=31536000, immutable" });
      return res.send(buf);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/presenter/:token/tts", express.json(), async (req: Request, res: Response) => {
    try {
      const rawToken = req.params.token as string;
      const token = rawToken?.replace(/[^a-f0-9]/gi, '').slice(0, 32).toLowerCase();
      if (!token || token.length < 16 || !/^[a-f0-9]+$/.test(token)) return res.status(400).json({ error: "Invalid token" });
      const check = await db.execute(sql`SELECT id FROM presenter_sessions WHERE token = ${token}`);
      if (check.rows.length === 0) return res.status(404).json({ error: "Session not found" });
      return handleTextToSpeech(req, res);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/presenter", express.json(), validate(presenterSessionSchema), async (req: Request, res: Response) => {
    try {
      const internalKey = req.headers["x-internal-key"];
      const expectedKey = process.env.SESSION_SECRET;
      if (!expectedKey) return res.status(500).json({ error: "Server misconfigured — SESSION_SECRET required" });
      // Constant-time compare so a remote caller can't recover SESSION_SECRET
      // byte-by-byte via response-timing differential. (R78 review hardening.)
      const _ikStr = typeof internalKey === "string" ? internalKey : "";
      const _ikBuf = Buffer.from(_ikStr);
      const _xkBuf = Buffer.from(expectedKey);
      // R98.19+sec — was require("crypto") under "type":"module" → threw and
      // catch returned false, hard-blocking every legitimate presenter call.
      // Use the top-level static `crypto` import (line 124).
      const _ikOk = _ikBuf.length === _xkBuf.length && (() => { try { return crypto.timingSafeEqual(_ikBuf, _xkBuf); } catch { return false; } })();
      if (!_ikOk) return res.status(403).json({ error: "Forbidden" });
      const { presentationId, title, slides, embedUrl, presentUrl, tenantId } = req.body;
      const slidesJson = JSON.stringify(slides);
      // R98.19+sec — was `const crypto = await import("crypto")` which shadowed
      // the top-level static `crypto` import (line 124) and made the timingSafeEqual
      // call above use a TDZ-undefined `crypto`. Use the top-level import directly.
      const token = crypto.randomBytes(16).toString("hex");
      if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
      const result = await db.execute(sql`INSERT INTO presenter_sessions (tenant_id, presentation_id, title, slides, embed_url, present_url, token) VALUES (${tenantId}, ${presentationId}, ${title}, ${slidesJson}::jsonb, ${embedUrl || ""}, ${presentUrl || ""}, ${token}) RETURNING id, token`);
      const row = result.rows[0] as any;
      res.json({ id: row.id, token: row.token });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const repairInProgress = new Set<string>();
  app.post("/api/presenter/:token/repair-images", express.json(), async (req: Request, res: Response) => {
    let token: string | undefined;
    try {
      const internalKey = req.headers["x-internal-key"];
      const expectedKey = process.env.SESSION_SECRET;
      if (!expectedKey) return res.status(403).json({ error: "Forbidden — internal key required" });
      // Constant-time compare (R78 review hardening) — same fix as /api/presenter.
      const _ikStr = typeof internalKey === "string" ? internalKey : "";
      const _ikBuf = Buffer.from(_ikStr);
      const _xkBuf = Buffer.from(expectedKey);
      // R98.19+sec — same require()-under-ESM bug as above; use static import.
      const _ikOk = _ikBuf.length === _xkBuf.length && (() => { try { return crypto.timingSafeEqual(_ikBuf, _xkBuf); } catch { return false; } })();
      if (!_ikOk) return res.status(403).json({ error: "Forbidden — internal key required" });

      const rawToken = req.params.token as string;
      token = rawToken?.replace(/[^a-f0-9]/gi, '').slice(0, 32).toLowerCase();
      if (!token || token.length < 16 || !/^[a-f0-9]+$/.test(token)) return res.status(400).json({ error: "Invalid token" });

      if (repairInProgress.has(token)) return res.status(409).json({ error: "Repair already in progress for this session" });
      repairInProgress.add(token);

      const sessionResult = await db.execute(sql`SELECT id, presentation_id, slides FROM presenter_sessions WHERE token = ${token}`);
      if (sessionResult.rows.length === 0) { repairInProgress.delete(token); return res.status(404).json({ error: "Session not found" }); }
      const session = sessionResult.rows[0] as any;
      const sessionId = session.id;
      const presentationId = session.presentation_id;

      const existingImages = await db.execute(sql`SELECT slide_index FROM presenter_slide_images WHERE session_id = ${sessionId} AND quality = 'full'`);
      const existingSet = new Set((existingImages.rows as any[]).map(r => r.slide_index));

      const slides = typeof session.slides === "string" ? JSON.parse(session.slides) : session.slides;
      const totalSlides = slides.length;

      let googleToken: string | null = null;
      try {
        const gd = await import("./google-drive");
        googleToken = await gd.getAccessToken();
      } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      if (!googleToken) { repairInProgress.delete(token); return res.status(503).json({ error: "Google token unavailable — cannot fetch slides" }); }

      const thumbResp = await fetch(`https://slides.googleapis.com/v1/presentations/${presentationId}?fields=slides.objectId`, {
        headers: { Authorization: `Bearer ${googleToken}` },
      });
      if (!thumbResp.ok) { repairInProgress.delete(token); return res.status(502).json({ error: "Failed to fetch slide metadata from Google" }); }
      const thumbData = await thumbResp.json();
      const pageIds = (thumbData.slides || []).map((s: any) => s.objectId);

      const sharp = await import("sharp").then((m: any) => m.default || m).catch(() => null);
      let downloaded = 0;
      let skipped = 0;

      const MAX_SLIDE_BYTES = 10 * 1024 * 1024;
      const FETCH_TIMEOUT = 30_000;
      const MAX_REPAIR_SLIDES = 50;
      for (let ti = 0; ti < pageIds.length && ti < totalSlides && ti < MAX_REPAIR_SLIDES; ti++) {
        if (existingSet.has(ti)) { skipped++; continue; }
        try {
          let imgBuf: Buffer | null = null;
          const exportUrl = `https://docs.google.com/presentation/d/${presentationId}/export/png?id=${presentationId}&pageid=${pageIds[ti]}`;
          try {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
            const exportResp = await fetch(exportUrl, { headers: { Authorization: `Bearer ${googleToken}` }, redirect: "follow", signal: ac.signal });
            clearTimeout(timer);
            if (exportResp.ok) {
              const ct = exportResp.headers.get("content-type") || "";
              if (ct.includes("image")) {
                imgBuf = Buffer.from(await exportResp.arrayBuffer());
                if (imgBuf.length < 2000 || imgBuf.length > MAX_SLIDE_BYTES) imgBuf = null;
              }
            }
          } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
          if (!imgBuf) {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
            const tResp = await fetch(`https://slides.googleapis.com/v1/presentations/${presentationId}/pages/${pageIds[ti]}/thumbnail?thumbnailProperties.thumbnailSize=LARGE`, {
              headers: { Authorization: `Bearer ${googleToken}` }, signal: ac.signal,
            });
            clearTimeout(timer);
            if (tResp.ok) {
              const tData = await tResp.json();
              if (tData.contentUrl) {
                const ac2 = new AbortController();
                const timer2 = setTimeout(() => ac2.abort(), FETCH_TIMEOUT);
                const fallbackResp = await fetch(tData.contentUrl, { signal: ac2.signal });
                clearTimeout(timer2);
                if (fallbackResp.ok) {
                  const buf = Buffer.from(await fallbackResp.arrayBuffer());
                  if (buf.length > 1000 && buf.length <= MAX_SLIDE_BYTES) imgBuf = buf;
                }
              }
            }
          }
          if (imgBuf && imgBuf.length > 1000) {
            await db.execute(sql`INSERT INTO presenter_slide_images (session_id, slide_index, image_data, image_size, quality) VALUES (${sessionId}, ${ti}, ${imgBuf}, ${imgBuf.length}, 'full') ON CONFLICT (session_id, slide_index, quality) DO UPDATE SET image_data = EXCLUDED.image_data, image_size = EXCLUDED.image_size`);
            downloaded++;
            if (sharp) {
              try {
                const thumbBuf = await sharp(imgBuf).resize(480, 270, { fit: "inside", withoutEnlargement: true }).png({ quality: 80 }).toBuffer();
                await db.execute(sql`INSERT INTO presenter_slide_images (session_id, slide_index, image_data, image_size, quality) VALUES (${sessionId}, ${ti}, ${thumbBuf}, ${thumbBuf.length}, 'thumb') ON CONFLICT (session_id, slide_index, quality) DO UPDATE SET image_data = EXCLUDED.image_data, image_size = EXCLUDED.image_size`);
              } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
            }
          }
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      }

      const dbSlides = slides.map((s: any, i: number) => ({
        ...s,
        thumbnailUrl: `/api/presenter/${token}/slide/${i}`,
      }));
      await db.execute(sql`UPDATE presenter_sessions SET slides = ${JSON.stringify(dbSlides)}::jsonb WHERE id = ${sessionId}`);

      repairInProgress.delete(token);
      res.json({ repaired: downloaded, skipped, total: totalSlides, message: `Repaired ${downloaded} slides, ${skipped} already in DB` });
    } catch (e: any) {
      if (token) repairInProgress.delete(token);
      res.status(500).json({ error: e.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // PUBLIC STOREFRONT (registered BEFORE auth gate) — driven by
  // server/product-catalog.ts as the trusted source of truth.
  // /api/store/catalog → safe public listing (no raw file paths).
  // /api/store/checkout → takes a SKU, creates a Stripe Checkout Session
  // with metadata.bundle_sku = sku so the existing webhook handler
  // (server/webhookHandlers.ts) can auto-deliver after payment.
  // CSRF middleware (line 564) still protects the POST endpoint against
  // cross-origin attacks; only the AUTH gate is bypassed because the
  // storefront must be reachable to anonymous shoppers.
  // ──────────────────────────────────────────────────────────────────────
  app.get("/api/store/catalog", async (_req: Request, res: Response) => {
    try {
      const { getPublicCatalog } = await import("./product-catalog");
      res.json({ products: getPublicCatalog() });
    } catch (err: any) {
      console.error("[store] catalog error:", err.message);
      res.status(500).json({ error: "Failed to load catalog" });
    }
  });

  // POST /api/store/checkout lives in server/routes/store-checkout.ts
  // (registered below alongside the other extracted route modules) so
  // tests/security/storefront-checkout-double-click.test.ts can mount the
  // REAL handler without booting the entire app. Keep the registrar call
  // in lockstep — do not re-add an inline copy here.
  registerStoreCheckoutRoutes(app);

  // Public order lookup by Stripe Checkout Session ID. The session ID
  // is unguessable (cs_… ~64 chars) so this acts as a capability URL
  // for the customer — letting them re-download a purchase without
  // creating an account. Use case: customer loses the delivery email,
  // or Bob points a support inquiry at the link. Returns only the
  // public-safe fields (no internal IDs, error messages, or metadata).
  app.get("/api/store/order/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      if (!sessionId || typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }
      const { deliveryLogs } = await import("@shared/schema");
      const { or } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(deliveryLogs)
        .where(or(eq(deliveryLogs.orderId, sessionId), eq(deliveryLogs.stripePaymentId, sessionId)))
        .orderBy(desc(deliveryLogs.createdAt))
        .limit(1);
      const log = rows[0];
      if (!log) {
        return res.status(404).json({ error: "Order not found", status: "pending" });
      }
      // PRIVACY: this endpoint is reachable to anyone with the (unguessable)
      // session ID. We deliberately omit customerName and only return a
      // masked email so the buyer can confirm the right account received
      // the file, without leaking full PII if the URL is shared in a
      // screenshot, support thread, or referrer log.
      const maskEmail = (e: string | null | undefined): string | null => {
        if (!e) return null;
        const at = e.lastIndexOf('@');
        if (at < 1) return null;
        const local = e.slice(0, at);
        const domain = e.slice(at + 1);
        const visible = local.slice(0, 1);
        return `${visible}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
      };
      // For HTML/JS apps, derive a self-hosted play link from delivery id +
      // filename so the order page can offer "Open App" + "Download" buttons
      // that route through our own /uploads handler — bypassing the Drive
      // mobile app's PDF-preview interception that breaks .html downloads.
      const fileNameLower = (log.fileName || "").toLowerCase();
      const isApp = fileNameLower.endsWith(".html") || fileNameLower.endsWith(".htm");
      let appPlayLink: string | null = null;
      if (isApp) {
        // Sign the app play link (capability URL) instead of an unsigned,
        // host-derived one. An unsigned /uploads link 401s for anonymous
        // order-page visitors (no Bearer session), and deriving the host from
        // request headers trusts an attacker-controllable X-Forwarded-Host.
        // A signed relative URL works for anonymous customers and resolves
        // against the page origin.
        const { signUploadUrl } = await import("./upload-signing");
        const safeName = log.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        // signUploadUrl clamps ttl to its 7-day max; this order endpoint re-signs
        // the link on every page fetch, so the cap is the effective lifetime and
        // practical expiry is a non-issue. Request the cap explicitly (no clamp surprise).
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
        appPlayLink = signUploadUrl(`delivery-${log.id}-${safeName}`, (log as any).tenantId ?? 1, SEVEN_DAYS_MS);
      }
      res.json({
        sessionId,
        productName: log.productName,
        fileName: log.fileName,
        downloadLink: log.downloadLink || null,
        shareableLink: log.shareableLink || null,
        folderLink: log.folderLink || null,
        appPlayLink,
        emailSent: !!log.emailSent,
        status: log.status,
        customerEmailMasked: maskEmail(log.customerEmail),
        createdAt: log.createdAt,
        completedAt: log.completedAt,
      });
    } catch (err: any) {
      console.error("[store] order lookup error:", err.message);
      res.status(500).json({ error: "Failed to load order" });
    }
  });

  // Public "find my orders by email" recovery endpoint. A customer who
  // lost the delivery email AND the bookmark to /orders/:sessionId has
  // no way back to their downloads — this closes the loop without
  // requiring an account. To avoid being a free email-address oracle:
  //   1. The endpoint is rate-limited per IP (orderLookupLimiter).
  //   2. The response is always a generic success (`{ ok: true }`)
  //      regardless of whether the email matched any rows.
  //   3. We only ever email the address the customer typed in, so an
  //      attacker can't redirect a victim's order list anywhere.
  // The recovery email itself contains links to /orders/:sessionId,
  // which are unguessable capability URLs and already public-safe.
  app.post("/api/store/lookup-orders", orderLookupLimiter, express.json(), async (req: Request, res: Response) => {
    const genericResponse = { ok: true, message: "If we found any orders for that email, we just sent a 6-digit code to it." };
    const rawEmail = (req.body?.email ?? "").toString().trim().toLowerCase();
    // Conservative email shape check — the real validation is whether
    // any delivery_logs row matches it.
    if (!rawEmail || rawEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    // Capture base URL before going async — req is no longer reliable
    // inside setImmediate. Used to build the pre-filled lookup link in
    // the recovery email so the buyer lands on /store with the email
    // already filled and the form on the code-entry step.
    const lookupDomains = process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || "";
    const lookupPrimaryDomain = lookupDomains.split(",")[0]?.trim();
    const lookupBaseUrl = lookupPrimaryDomain ? `https://${lookupPrimaryDomain}` : `${req.protocol}://${req.get('host')}`;

    // SECURITY: timing-safe response. We respond immediately with the
    // generic OK and do all the DB / SMTP work in setImmediate, so the
    // request latency is identical whether the email matches a real
    // customer or doesn't. Otherwise an attacker could enumerate which
    // emails have purchases by measuring response time (no-match returns
    // in ms, match takes hundreds of ms for the SMTP roundtrip).
    res.json(genericResponse);
    setImmediate(async () => {
      try {
        const { deliveryLogs } = await import("@shared/schema");
        const { sql: sqlTag } = await import("drizzle-orm");

        // Case-insensitive match. Backed by a functional index on
        // lower(customer_email) so this stays cheap as the table grows.
        const rows = await db
          .select({ orderId: deliveryLogs.orderId })
          .from(deliveryLogs)
          .where(sqlTag`lower(${deliveryLogs.customerEmail}) = ${rawEmail}`)
          .limit(1);

        // No match: silently drop. Don't issue a code, don't send mail.
        if (rows.length === 0) return;

        const { isEmailConfigured, sendEmail, getPrimaryInboxId } = await import("./email");
        if (!isEmailConfigured()) {
          console.warn("[store] order recovery requested but email is not configured; skipping send");
          return;
        }

        // Generate a 6-digit code, store its hash, and email the raw
        // value to the customer. The verify endpoint will trade a valid
        // code for the actual list of order links rendered inline on
        // the storefront.
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
        const codeHash = hashLookupCode(rawEmail, code);
        const expiresAt = new Date(Date.now() + ORDER_LOOKUP_CODE_TTL_MS);
        // Upsert: requesting a new code for the same email replaces any
        // pending one and resets the attempt counter, matching the
        // previous Map-based semantics.
        await db.execute(sql`
          INSERT INTO order_lookup_codes (email, code_hash, expires_at, attempts)
          VALUES (${rawEmail}, ${codeHash}, ${expiresAt.toISOString()}, 0)
          ON CONFLICT (email) DO UPDATE
          SET code_hash = EXCLUDED.code_hash,
              expires_at = EXCLUDED.expires_at,
              attempts = 0,
              created_at = CURRENT_TIMESTAMP
        `);

        const { siteConfig } = await import("./site-config");
        const platformName = process.env.SITE_AGENT_NAME || siteConfig.platformName || "VisionClaw";

        // Pre-fill the store lookup form with this email and jump
        // straight to the code-entry step. The link does NOT include
        // the code itself — the buyer still has to copy it from the
        // email body, so possession of the email is still required.
        const lookupLink = `${lookupBaseUrl}/store?lookup=${encodeURIComponent(rawEmail)}`;

        const subject = `Your ${platformName} order lookup code: ${code}`;
        const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;color:#ccc;">
<h2 style="color:#fff;margin:0 0 15px;">Your order lookup code</h2>
<p style="line-height:1.6;">You (or someone using this email) asked to see your ${platformName} orders. <a href="${lookupLink}" style="color:#7dd3fc;text-decoration:underline;">Open the lookup page</a> and enter this code:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#fff;background:#000;padding:18px 24px;border-radius:6px;text-align:center;margin:24px 0;">${code}</p>
<p style="text-align:center;margin:24px 0;"><a href="${lookupLink}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Open lookup page</a></p>
<p style="line-height:1.6;color:#888;font-size:13px;">This code expires in 15 minutes and can only be used once. If you didn't request it, you can ignore this email — no changes were made.</p>
</div></body></html>`;
        const text = `Your ${platformName} order lookup code\n\nOpen the lookup page (your email is pre-filled):\n${lookupLink}\n\nThen enter this code:\n\n    ${code}\n\nThis code expires in 15 minutes and can only be used once. If you didn't request it, you can ignore this email.`;

        try {
          const inboxId = await getPrimaryInboxId();
          await sendEmail({ inboxId, to: rawEmail, subject, text, html });
          console.log(`[store] order lookup code sent to ${rawEmail}`);
        } catch (sendErr: any) {
          console.error(`[store] order lookup code email failed for ${rawEmail}:`, sendErr.message);
        }
      } catch (err: any) {
        console.error("[store] order lookup (async) error:", err.message);
      }
    });
  });

  // Step 2 of the order recovery flow. The customer pastes the 6-digit
  // code we just emailed them and, on a match, we return the list of
  // their orders inline so the storefront can render them without a
  // second email round-trip.
  //
  // SECURITY:
  //   1. Per-IP rate limit (orderVerifyLimiter).
  //   2. Per-email attempt counter — 5 wrong guesses invalidates the
  //      code, forcing the user to request a new one. With a 6-digit
  //      space (1e6 possibilities) and only 5 tries before the code
  //      is destroyed, online brute-force is infeasible.
  //   3. Codes are single-use: a successful verify deletes the entry.
  //   4. Codes expire after 15 minutes.
  //   5. The hash is bound to the email so a leaked code can't be
  //      replayed against a different address.
  //   6. Generic error message ("Invalid or expired code") for every
  //      failure mode so we don't tell an attacker which addresses
  //      have a pending code.
  app.post("/api/store/verify-orders", orderVerifyLimiter, express.json(), async (req: Request, res: Response) => {
    const rawEmail = (req.body?.email ?? "").toString().trim().toLowerCase();
    const rawCode = (req.body?.code ?? "").toString().trim();
    if (!rawEmail || rawEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (!/^\d{6}$/.test(rawCode)) {
      return res.status(400).json({ error: "Enter the 6-digit code from your email." });
    }

    const genericFail = { error: "Invalid or expired code. Request a new one." };
    const submittedHash = hashLookupCode(rawEmail, rawCode);

    // Atomic single-use consumption: delete the row only if the email,
    // hash, and (non-expired) expiry all match, returning the row in
    // the same statement. With concurrent verify attempts (including
    // across instances) at most one request will see a returned row,
    // so the code is genuinely single-use even under races. We rely
    // on the hash equality check here rather than timing-safe compare
    // because the SQL comparison runs against a SHA-256 hex digest of
    // attacker input, not against the code itself.
    const consumeRes: any = await db.execute(sql`
      DELETE FROM order_lookup_codes
      WHERE email = ${rawEmail}
        AND code_hash = ${submittedHash}
        AND expires_at > NOW()
      RETURNING email
    `);
    const consumed = ((consumeRes.rows || consumeRes) as any[]).length > 0;
    if (!consumed) {
      // Either no row, expired, or wrong code. Atomically bump the
      // per-email attempt counter (and delete the row if the cap is
      // hit) in one statement to close the read-then-write race the
      // old in-memory code had. If there is no matching row at all
      // (no pending code for this email), this is a no-op — which
      // also means a brute-force attacker who has no code on file
      // can't accumulate attempts against another user's slot.
      await db.execute(sql`
        WITH bumped AS (
          UPDATE order_lookup_codes SET attempts = attempts + 1
          WHERE email = ${rawEmail}
          RETURNING email, attempts
        )
        DELETE FROM order_lookup_codes
        WHERE email IN (
          SELECT email FROM bumped WHERE attempts >= ${ORDER_LOOKUP_MAX_ATTEMPTS}
        )
           OR email IN (
             SELECT email FROM order_lookup_codes
             WHERE email = ${rawEmail} AND expires_at <= NOW()
           )
      `);
      return res.status(400).json(genericFail);
    }

    try {
      const { deliveryLogs } = await import("@shared/schema");
      const { sql: sqlTag } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(deliveryLogs)
        .where(sqlTag`lower(${deliveryLogs.customerEmail}) = ${rawEmail}`)
        .orderBy(desc(deliveryLogs.createdAt))
        .limit(50);

      // Mirror the email-recovery filter: only include rows with a
      // Stripe Checkout Session id we can build /orders/:sessionId from.
      const linkable = rows.filter(r => r.orderId && /^cs_[A-Za-z0-9_]+$/.test(r.orderId));
      const orders = linkable.map((r: any) => ({
        sessionId: r.orderId!,
        productName: r.productName,
        productSku: r.productSku,
        createdAt: r.createdAt,
      }));
      return res.json({ ok: true, orders });
    } catch (err: any) {
      console.error("[store] order verify lookup error:", err.message);
      return res.status(500).json({ error: "Failed to load orders. Please try again." });
    }
  });

  app.use("/api", authMiddleware);

  app.use("/api", async (req: Request, _res: Response, next: Function) => {
    if (!getTenantFromRequest(req)) {
      await getTenantFromRequestAsync(req);
    }
    next();
  });

  app.post("/api/gdrive/refresh-token", express.json(), async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const gd = await import("./google-drive");
      const body = req.body || {};
      const token = body.token;

      if (token && typeof token === "string") {
        await gd.setDriveToken(token);
        return res.json({ success: true, message: "Google Drive token set manually" });
      }

      const refreshed = await gd.forceTokenRefresh();
      if (refreshed) {
        return res.json({ success: true, message: "Google Drive token refreshed via connector" });
      }

      res.status(400).json({ error: "No token provided and auto-refresh failed. Pass { \"token\": \"...\" } or reconnect the Google Drive integration." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/gdrive/folder", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const gd = await import("./google-drive");
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      if (tenant.isAdmin) {
        const rootId = gd.getVisionClawFolderId();
        return res.json({ rootUrl: `https://drive.google.com/drive/folders/${rootId}`, isAdmin: true });
      }

      const folder = await gd.ensureTenantFolder(tenantId, tenant.name);
      res.json({ rootUrl: folder.url, folderId: folder.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use("/api/stripe-connect", stripeConnectRouter);
  app.use("/api/coinbase", coinbaseCommerceRouter);

  (async () => {
    try {
      const { db: d } = await import("./db");
      const { sql: s } = await import("drizzle-orm");
      await d.execute(s`
        CREATE TABLE IF NOT EXISTS contact_submissions (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          subject TEXT DEFAULT 'general',
          message TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch (e: any) { console.warn("[contact] Table init:", e.message); }
  })();

  app.post("/api/public/contact", contactLimiter, validate(contactFormSchema), async (req: Request, res: Response) => {
    try {
      const { name: trimName, email: trimEmail, subject: safeSubject, message: trimMessage } = req.body;
      const { db: d } = await import("./db");
      const { sql: s } = await import("drizzle-orm");
      await d.execute(s`INSERT INTO contact_submissions (name, email, subject, message) VALUES (${trimName}, ${trimEmail}, ${safeSubject}, ${trimMessage})`);
      try {
        const { sendEmail } = await import("./email");
        const { siteConfig: sc } = await import("./site-config");
        const contactTo = sc.contactEmail || sc.ownerEmail;
        if (contactTo) {
          const cleanName = String(trimName ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Anonymous';
          const cleanSubject = String(safeSubject ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || '(no subject)';
          const cleanMessage = String(trimMessage ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 5000);
          await sendEmail({ inboxId: "default", to: contactTo, subject: `${sc.platformName} Contact: ${cleanSubject} from ${cleanName}`, text: `From: ${cleanName} (${trimEmail})\nSubject: ${cleanSubject}\n\n${cleanMessage}` });
        }
      } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      res.json({ success: true });
    } catch (err: any) {
      console.error("[contact] Submission error:", err.message);
      res.status(500).json({ error: "Failed to submit message. Please try again later." });
    }
  });

  app.get("/uploads/:filename", async (req: Request, res: Response) => {
    // R64.C — DELIVERY HARDENING:
    // 1) Removed the `?token=<rawSessionToken>` query-auth path. Putting raw
    //    session tokens in URLs leaks them via browser history, server logs,
    //    Referer headers, and proxy logs.
    // 2) Two accepted authn paths now:
    //      (a) Authorization: Bearer <session-token>   (programmatic clients)
    //      (b) Signed expiring URL: ?tid=<n>&exp=<ms>&sig=<hmac>
    //          — produced by signUploadUrl() at upload time. Filename + tenant
    //          + expiry are HMAC'd with SESSION_SECRET; tampering invalidates.
    const filename = path.basename(req.params.filename as string);
    let tenantId: number | undefined;

    const sigParam = typeof req.query.sig === "string" ? req.query.sig : "";
    const expParam = typeof req.query.exp === "string" ? req.query.exp : "";
    const tidParam = typeof req.query.tid === "string" ? req.query.tid : "";
    if (sigParam && expParam && tidParam) {
      const { verifyUploadSig } = await import("./upload-signing");
      const tid = Number(tidParam);
      const exp = Number(expParam);
      if (Number.isFinite(tid) && verifyUploadSig(filename, tid, exp, sigParam)) {
        tenantId = tid;
      }
    }

    if (tenantId === undefined) {
      const bearer = req.headers.authorization?.replace("Bearer ", "") || "";
      if (!bearer || !isValidSession(bearer)) {
        return res.status(401).json({ error: "Authentication required" });
      }
      tenantId = getTenantFromRequest(req) ?? undefined;
      if (!tenantId) {
        const session = getSessionSync(bearer);
        if (session) tenantId = session.tenantId;
      }
      if (!tenantId) {
        return res.status(403).json({ error: "Tenant context required" });
      }
    }

    const mimeMap: Record<string, string> = {
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".txt": "text/plain",
      ".csv": "text/csv",
      ".json": "application/json",
      ".md": "text/markdown",
    };
    const ext = path.extname(filename).toLowerCase();
    const mime = mimeMap[ext] || "application/octet-stream";

    const serveBuffer = (buffer: Buffer, serveName: string) => {
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `attachment; filename="${serveName}"`);
      res.setHeader("Content-Length", buffer.length.toString());
      return res.send(buffer);
    };

    try {
      const { db } = await import("./db");
      const { eq, and } = await import("drizzle-orm");
      const conditions = and(eq(fileStorage.filename, filename), eq(fileStorage.tenantId, tenantId));
      const [stored] = await db.select().from(fileStorage).where(conditions).limit(1);
      if (stored) {
        if (stored.storageKey) {
          try {
            const { downloadTenantFile } = await import("./object-storage");
            const tId = stored.tenantId || ADMIN_TENANT_ID;
            const buffer = await downloadTenantFile(tId, stored.storageKey);
            return serveBuffer(buffer, stored.originalName || filename);
          } catch (osErr) {
            console.error("[upload] Object Storage retrieval failed:", (osErr as Error).message);
          }
        }
        if (stored.data && stored.data.length > 0) {
          const isText = stored.mimeType?.startsWith("text/") || stored.mimeType?.includes("json") || stored.mimeType?.includes("xml");
          let buffer: Buffer;
          if (isText && /[{[\n=<]/.test(stored.data.slice(0, 100))) {
            buffer = Buffer.from(stored.data, "utf-8");
          } else {
            try {
              buffer = Buffer.from(stored.data, "base64");
              if (isText && buffer.includes(0xFFFD)) {
                buffer = Buffer.from(stored.data, "utf-8");
              }
            } catch {
              buffer = Buffer.from(stored.data, "utf-8");
            }
          }
          return serveBuffer(buffer, stored.originalName || filename);
        }
      }
    } catch (dbErr) {
      console.error("[upload] DB retrieval failed:", (dbErr as Error).message);
    }

    const searchPaths = [
      path.join(UPLOADS_DIR, filename),
      path.join("/tmp/uploads", filename),
      path.join(process.cwd(), "uploads", filename),
    ];
    for (const fp of searchPaths) {
      if (fs.existsSync(fp)) {
        try {
          const buffer = await fsPromises.readFile(fp);
          if (buffer.length > 0) {
            return serveBuffer(buffer, filename);
          }
        } catch (readErr) {
          console.error("[upload] File read failed:", (readErr as Error).message);
        }
      }
    }

    return res.status(404).json({ error: "File not found. It may have been removed after a server restart." });
  });

  app.post("/api/voice/conversations/:id/messages", authMiddleware, handleVoiceMessage);
  app.post("/api/voice/tts", authMiddleware, handleTextToSpeech);
  app.post("/api/voice/stt", authMiddleware, handleSpeechToText);
  app.get("/api/voice/voices", authMiddleware, handleListVoices);
  app.get("/api/voice/wake", authMiddleware, handleVoiceWakeGet);
  app.post("/api/voice/wake", authMiddleware, handleVoiceWakeSet);

  app.get("/api/vibevoice/info", authMiddleware, async (_req: Request, res: Response) => {
    const { VIBEVOICE_ASR_INFO } = await import("./vibevoice");
    res.json({ asr: VIBEVOICE_ASR_INFO });
  });

  app.post("/api/vibevoice/transcribe", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { vibevoiceTranscribe } = await import("./vibevoice");
      const result = await vibevoiceTranscribe(req.body);
      res.json(result);
    } catch (err: any) {
      console.error("[vibevoice] Transcribe route error:", err.message);
      res.status(500).json({ success: false, error: "Internal server error during transcription", provider: "vibevoice-asr" });
    }
  });

  app.post("/api/upload-base64", authMiddleware, express.json({ limit: "50mb" }), async (req: Request, res: Response) => {
    try {
      console.log("[upload-b64] POST /api/upload-base64 received");
      const { data, fileName, mimeType } = req.body;
      if (!data || !fileName) {
        return res.status(400).json({ error: "Missing data or fileName" });
      }
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });

      const fileBuffer = Buffer.from(data, "base64");
      const ext = SAFE_EXTENSIONS[mimeType] || path.extname(fileName) || ".bin";
      const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
      const filePath = path.join(UPLOADS_DIR, uniqueName);
      await fsPromises.writeFile(filePath, fileBuffer);

      const verdict = await detectAndValidateUpload(filePath, mimeType || "application/octet-stream", fileName);
      if (!verdict.ok) {
        try { await fsPromises.unlink(filePath); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        console.warn(`[upload-b64] BLOCKED ${fileName} (tenant=${tenantId}): ${verdict.reason}`);
        return res.status(415).json({ error: `File rejected: ${verdict.reason}`, detected: verdict.detected?.label });
      }

      let storageKey: string | null = null;
      try {
        const { uploadTenantFile } = await import("./object-storage");
        const result = await uploadTenantFile(tenantId, "uploads", fileName, fileBuffer);
        storageKey = result.storageKey;
        console.log(`[upload-b64] Stored in Object Storage: ${storageKey}`);
      } catch (osErr) {
        console.warn("[upload-b64] Object Storage unavailable:", (osErr as Error).message);
      }

      let driveUrl: string | null = null;
      try {
        const { uploadAndShare } = await import("./google-drive");
        const tenant = await storage.getTenant(tenantId);
        const folderLabel = tenant ? `User Vault/${tenant.name}` : `User Vault/tenant-${tenantId}`;
        const driveResult = await uploadAndShare({ filePath, fileName, mimeType, folderLabel, description: `User upload: ${fileName}`, share: true });
        if (driveResult.viewUrl) { driveUrl = driveResult.viewUrl; console.log(`[upload-b64] Drive: ${driveUrl}`); }
      } catch (driveErr) {
        console.log(`[upload-b64] Drive skipped: ${(driveErr as Error).message}`);
      }

      try {
        const { db } = await import("./db");
        await db.insert(fileStorage).values({
          filename: uniqueName, originalName: fileName, mimeType: mimeType || "application/octet-stream",
          size: fileBuffer.length, data: storageKey ? "" : data,
          storageKey, driveUrl, tenantId,
        });
      } catch (dbErr) {
        console.error("[upload-b64] DB failed:", (dbErr as Error).message);
      }

      // R64.C — return a signed expiring delivery URL (no raw session token).
      const { signUploadUrl } = await import("./upload-signing");
      const url = signUploadUrl(uniqueName, tenantId);
      res.json({ url, filename: fileName, type: mimeType || "application/octet-stream", size: fileBuffer.length, storageKey, driveUrl });
    } catch (e) {
      console.error("[upload-b64] Error:", e);
      res.status(500).json({ error: "Upload processing failed" });
    }
  });

  app.post("/api/upload", authMiddleware, (req: Request, res: Response) => {
    console.log("[upload] POST /api/upload received");
    upload.single("file")(req, res, async (err: any) => {
      if (err) {
        console.error("[upload] Multer error:", err.code, err.message);
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large (max 50MB)" });
        }
        if (err.message?.includes("File type not allowed")) {
          return res.status(400).json({ error: "File type not allowed" });
        }
        return res.status(400).json({ error: err.message || "Upload failed" });
      }
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file provided" });
      }
      if (!(await validateUploadedFile(req, res))) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const filePath = path.join(UPLOADS_DIR, file.filename);
      const fileBuffer = await fsPromises.readFile(filePath);

      let storageKey: string | null = null;
      try {
        const { uploadTenantFile } = await import("./object-storage");
        const result = await uploadTenantFile(tenantId, "uploads", file.originalname, fileBuffer);
        storageKey = result.storageKey;
        console.log(`[upload] Stored in Object Storage: ${storageKey}`);
      } catch (osErr) {
        console.warn("[upload] Object Storage unavailable, falling back to DB:", (osErr as Error).message);
      }

      let driveUrl: string | null = null;
      try {
        const { uploadAndShare } = await import("./google-drive");
        const tenant = await storage.getTenant(tenantId);
        const folderLabel = tenant ? `User Vault/${tenant.name}` : `User Vault/tenant-${tenantId}`;
        const driveResult = await uploadAndShare({
          filePath,
          fileName: file.originalname,
          mimeType: file.mimetype,
          folderLabel,
          description: `User upload: ${file.originalname}`,
          share: true,
        });
        if (driveResult.viewUrl) {
          driveUrl = driveResult.viewUrl;
          console.log(`[upload] Drive link: ${driveUrl}`);
        }
      } catch (driveErr) {
        console.log(`[upload] Drive upload skipped: ${(driveErr as Error).message}`);
      }

      try {
        const { db } = await import("./db");
        await db.insert(fileStorage).values({
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          data: storageKey
            ? (file.mimetype.startsWith("text/") || file.mimetype.includes("json") || file.mimetype.includes("xml")
              ? fileBuffer.toString("utf-8")
              : "")
            : (file.mimetype.startsWith("text/") || file.mimetype.includes("json") || file.mimetype.includes("xml")
              ? fileBuffer.toString("utf-8")
              : fileBuffer.toString("base64")),
          storageKey: storageKey,
          driveUrl: driveUrl,
          tenantId: tenantId,
        });
      } catch (dbErr) {
        console.error("[upload] DB metadata storage failed:", (dbErr as Error).message);
      }
      const { signUploadUrl } = await import("./upload-signing");
      const url = signUploadUrl(file.filename, tenantId);
      res.json({
        url,
        filename: file.originalname,
        type: file.mimetype,
        size: file.size,
        storageKey,
        driveUrl,
      });
    });
  });


  app.get("/api/tenant/files", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { eq, desc } = await import("drizzle-orm");
      const files = await db.select({
        id: fileStorage.id,
        filename: fileStorage.filename,
        originalName: fileStorage.originalName,
        mimeType: fileStorage.mimeType,
        size: fileStorage.size,
        storageKey: fileStorage.storageKey,
        driveUrl: fileStorage.driveUrl,
        createdAt: fileStorage.createdAt,
      }).from(fileStorage).where(eq(fileStorage.tenantId, tenantId)).orderBy(desc(fileStorage.createdAt));
      res.json(files);
    } catch (err) {
      console.error("[tenant-files] List failed:", (err as Error).message);
      res.status(500).json({ error: "Failed to list files" });
    }
  });

  app.get("/api/tenant/files/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const fileId = parseInt(req.params.id as string);
      if (isNaN(fileId)) return res.status(400).json({ error: "Invalid file ID" });
      const { eq, and } = await import("drizzle-orm");
      const [file] = await db.select().from(fileStorage).where(
        and(eq(fileStorage.id, fileId), eq(fileStorage.tenantId, tenantId))
      ).limit(1);
      if (!file) return res.status(404).json({ error: "File not found" });

      const ext = path.extname(file.originalName || file.filename).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".txt": "text/plain", ".csv": "text/csv",
        ".json": "application/json", ".md": "text/markdown",
      };
      const mime = mimeMap[ext] || file.mimeType || "application/octet-stream";

      let buffer: Buffer | null = null;
      if (file.storageKey) {
        try {
          const { downloadTenantFile } = await import("./object-storage");
          buffer = await downloadTenantFile(tenantId, file.storageKey);
        } catch (osErr) {
          console.error("[tenant-files] Object Storage download failed:", (osErr as Error).message);
        }
      }
      if (!buffer && file.data && file.data.length > 0) {
        buffer = Buffer.from(file.data, "base64");
      }
      if (!buffer) return res.status(404).json({ error: "File data not found" });

      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `attachment; filename="${file.originalName || file.filename}"`);
      res.setHeader("Content-Length", buffer.length.toString());
      res.send(buffer);
    } catch (err) {
      console.error("[tenant-files] Download failed:", (err as Error).message);
      res.status(500).json({ error: "Failed to download file" });
    }
  });

  app.delete("/api/tenant/files/:id", mutateLimiter, authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const fileId = parseInt(req.params.id as string);
      if (isNaN(fileId)) return res.status(400).json({ error: "Invalid file ID" });
      const { eq, and } = await import("drizzle-orm");
      const [file] = await db.select().from(fileStorage).where(
        and(eq(fileStorage.id, fileId), eq(fileStorage.tenantId, tenantId))
      ).limit(1);
      if (!file) return res.status(404).json({ error: "File not found" });

      if (file.storageKey) {
        try {
          const { deleteTenantFile } = await import("./object-storage");
          await deleteTenantFile(tenantId, file.storageKey);
        } catch (osErr) {
          console.warn("[tenant-files] Object Storage delete failed:", (osErr as Error).message);
        }
      }

      await db.delete(fileStorage).where(
        and(eq(fileStorage.id, fileId), eq(fileStorage.tenantId, tenantId))
      );
      res.json({ success: true });
    } catch (err) {
      console.error("[tenant-files] Delete failed:", (err as Error).message);
      res.status(500).json({ error: "Failed to delete file" });
    }
  });

  app.post("/api/brand-logo", mutateLimiter, authMiddleware, (req: Request, res: Response) => {
    upload.single("file")(req, res, async (err: any) => {
      if (err) return res.status(400).json({ error: err.message || "Upload failed" });
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file provided" });
      // R116.2 — tenant-scope the logo path + DB row so one tenant cannot
      // overwrite another tenant's brand logo. Previously: shared `brand_logo.ext`
      // disk path + tenant-less DELETE/INSERT in `file_storage`.
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const ext = path.extname(file.originalname).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
        return res.status(400).json({ error: "Only PNG, JPG, and WebP images are supported" });
      }
      const filename = `brand_logo_t${tenantId}${ext}`;
      const brandPath = path.join(UPLOADS_DIR, filename);
      try {
        for (const old of [".png", ".jpg", ".jpeg", ".webp"]) {
          const p = path.join(UPLOADS_DIR, `brand_logo_t${tenantId}${old}`);
          if (fs.existsSync(p)) await fsPromises.unlink(p).catch(() => {});
        }
        await fsPromises.copyFile(file.path, brandPath);
        await fsPromises.unlink(file.path);
        const fileData = (await fsPromises.readFile(brandPath)).toString("base64");
        const { db } = await import("./db");
        const { fileStorage } = await import("@shared/schema");
        const { like, and, eq } = await import("drizzle-orm");
        await db.delete(fileStorage).where(
          and(like(fileStorage.filename, `brand_logo_t${tenantId}%`), eq(fileStorage.tenantId, tenantId))
        );
        await db.insert(fileStorage).values({
          tenantId,
          filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          data: fileData,
        } as any);
      } catch (e: any) {
        console.error("[brand-logo] Save failed:", e.message);
      }
      res.json({
        url: `/uploads/${filename}`,
        path: `uploads/${filename}`,
        filename,
        message: `Brand logo saved. Agents can now use path 'uploads/${filename}' in create_pdf headerImage.`,
      });
    });
  });

  app.get("/api/brand-logo", authMiddleware, (req: Request, res: Response) => {
    // R116.2 — tenant-scoped lookup. Falls back to legacy unscoped `brand_logo.ext`
    // for backward compat with assets uploaded before the R116.2 patch (admin-tenant=1
    // owns those legacy files), so old `create_pdf headerImage: "uploads/brand_logo.png"`
    // calls keep working until those assets are re-uploaded.
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
      const filename = `brand_logo_t${tenantId}${ext}`;
      const p = path.join(UPLOADS_DIR, filename);
      if (fs.existsSync(p)) {
        return res.json({ exists: true, path: `uploads/${filename}`, url: `/uploads/${filename}` });
      }
    }
    if (tenantId === 1) {
      for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
        const p = path.join(UPLOADS_DIR, `brand_logo${ext}`);
        if (fs.existsSync(p)) {
          return res.json({ exists: true, path: `uploads/brand_logo${ext}`, url: `/uploads/brand_logo${ext}` });
        }
      }
    }
    res.json({ exists: false });
  });

  // ─── Delivery Pipeline ────────────────────────────────────
  app.get("/api/deliveries", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const { listDeliveries } = await import("./delivery-pipeline");
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const deliveries = await listDeliveries(limit, offset, tenantId);
    res.json(deliveries);
  });

  app.get("/api/deliveries/stats", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const { getDeliveryStats } = await import("./delivery-pipeline");
    const stats = await getDeliveryStats(tenantId);
    res.json(stats);
  });

  app.get("/api/deliveries/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const { getDeliveryStatus } = await import("./delivery-pipeline");
    const delivery = await getDeliveryStatus(parseInt(req.params.id as string), tenantId);
    if (!delivery) return res.status(404).json({ error: "Delivery not found" });
    res.json(delivery);
  });

  app.post("/api/deliveries/:id/retry", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const { retryDelivery } = await import("./delivery-pipeline");
    const result = await retryDelivery(parseInt(req.params.id as string), tenantId);
    res.json(result);
  });

  // ─── Discord ────────────────────────────────────────────
  app.get("/api/discord/status", async (_req, res) => {
    res.json(getDiscordStatus());
  });

  // ─── Telegram ───────────────────────────────────────────
  app.get("/api/telegram/status", async (_req, res) => {
    res.json(getTelegramStatus());
  });

  app.post("/api/telegram/connect", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { token } = req.body;
      if (!token || typeof token !== "string" || token.length < 20) {
        return res.status(400).json({ error: "Invalid Telegram bot token" });
      }
      await startTelegramBot(token);
      await saveTelegramToken(token);
      res.json({ success: true, status: getTelegramStatus() });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to connect Telegram bot" });
    }
  });

  app.post("/api/telegram/disconnect", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      await stopTelegramBot();
      await saveTelegramToken(null);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to disconnect" });
    }
  });

  app.get("/api/telegram/pairings", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json(getPendingPairings());
  });

  app.post("/api/telegram/approve", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ error: "Pairing code required" });
      const result = await approvePairing(code);
      if (!result.success) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/telegram/revoke", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { telegramUserId } = req.body;
      if (!telegramUserId) return res.status(400).json({ error: "User ID required" });
      await revokeUser(telegramUserId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/telegram/users", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json(await getApprovedUsersList());
  });

  // ─── MCP Servers ────────────────────────────────────────
  // R59 — extracted to ./routes/mcp.ts (registered with other extracted modules).

  // ─── Webhook Triggers ─────────────────────────────────────
  app.get("/api/triggers", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try { res.json(await listTriggers()); } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/triggers", validate(triggerSchema), async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { name, description, personaId } = req.body;
      const trigger = await createTrigger({ name, description, personaId });
      res.json(trigger);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/triggers/:id", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try { await deleteTrigger(parseInt(req.params.id as string)); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/triggers/:id/toggle", validate(toggleSchema), async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try { await toggleTrigger(parseInt(req.params.id as string), req.body.enabled); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/triggers/:id/events", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try { res.json(await getTriggerEvents(parseInt(req.params.id as string))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/trigger/:key", triggerLimiter, async (req, res) => {
    try {
      const result = await processTriggerEvent((req.params.key as string), req.body);
      if (!result.success) return res.status(404).json({ error: result.error });
      res.json({ ok: true, response: result.response?.slice(0, 500) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── Channel Routing ──────────────────────────────────────
  app.get("/api/channel-routes", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try { res.json(await listChannelRoutes()); } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/channel-routes", validate(channelRouteSchema), async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { channel, personaId } = req.body;
      await setChannelRoute(channel, personaId);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/channel-routes/:channel", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try { await removeChannelRoute(req.params.channel as any); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── Personality Files (SOUL.md) ──────────────────────────
  app.get("/api/personality-files/types", async (_req, res) => {
    res.json(getFileDescriptions());
  });

  app.get("/api/personality-files", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try { res.json(await getAllPersonalityFiles(tenantId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/personality-files/:personaId", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try { res.json(await getPersonalityFiles(tenantId, parseInt(req.params.personaId as string))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/personality-files/:personaId", validate(personalityFileSchema), async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const { fileType, content } = req.body;
    try {
      const file = await upsertPersonalityFile(tenantId, parseInt(req.params.personaId as string), fileType, content);
      res.json(file);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/personality-files/:personaId/:fileType", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      await deletePersonalityFile(tenantId, parseInt(req.params.personaId as string), (req.params.fileType as string));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── Skills Marketplace ───────────────────────────────────
  app.get("/api/marketplace/templates", async (req, res) => {
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    res.json(getMarketplaceTemplates(category, search));
  });

  app.get("/api/marketplace/categories", async (_req, res) => {
    res.json(getCategories());
  });

  app.post("/api/marketplace/install", validate(marketplaceInstallSchema), async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { templateId } = req.body;
      const result = await installSkillFromTemplate(templateId);
      if (!result.success) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/marketplace/export/:id", async (req, res) => {
    try {
      const result = await exportSkill(parseInt(req.params.id as string));
      if (!result.success) return res.status(404).json({ error: result.error });
      res.json(result.data);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/marketplace/import", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const result = await importSkill(req.body);
      if (!result.success) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── Conversation Sync (cross-device real-time mirror) ───
  const convSyncClients = new Map<number, Set<Response>>();

  function broadcastToConversation(conversationId: number, event: any) {
    const clients = convSyncClients.get(conversationId);
    if (!clients || clients.size === 0) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      try { client.write(data); } catch { clients.delete(client); }
    }
  }

  app.get("/api/conversations/:id/sync", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const conversationId = parseInt(req.params.id as string);

    const conv = await storage.getConversation(conversationId, tenantId);
    if (!conv) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    if (!convSyncClients.has(conversationId)) {
      convSyncClients.set(conversationId, new Set());
    }
    convSyncClients.get(conversationId)!.add(res);

    const heartbeat = setInterval(() => {
      try { res.write(`: heartbeat\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    }, 15000);

    req.on("close", () => {
      convSyncClients.get(conversationId)?.delete(res);
      if (convSyncClients.get(conversationId)?.size === 0) {
        convSyncClients.delete(conversationId);
      }
      clearInterval(heartbeat);
    });
  });

  // ─── Delegation Live Events (SSE + Poll) ─────────────────
  app.get("/api/delegation-events/stream", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const { subscribeToAllDelegations } = await import("./delegation-events");
    const unsubscribe = subscribeToAllDelegations((event) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    }, tenantId);

    const heartbeat = setInterval(() => {
      try { res.write(`: heartbeat\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    }, 15000);

    req.on("close", () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });

  app.get("/api/delegation-events/:conversationId", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const conversationId = parseInt(req.params.conversationId as string);

    const conv = isAdminRequest(req)
      ? await storage.getConversationUnscoped(conversationId)
      : await storage.getConversation(conversationId, tenantId);
    if (conv && conv.tenantId !== tenantId && !isAdminRequest(req)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const since = req.query.since ? parseInt(req.query.since as string) : undefined;
    const { getRecentEvents } = await import("./delegation-events");
    const events = getRecentEvents(conversationId, since, tenantId);
    res.json({ events });
  });

  app.get("/api/delegation-events", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const since = req.query.since ? parseInt(req.query.since as string) : Date.now() - 60000;
    const { getRecentEvents } = await import("./delegation-events");
    const events = getRecentEvents(0, since, tenantId);
    res.json({ events });
  });



  async function validateModelForTenant(modelId: string, tenantId: number): Promise<boolean> {
    if (modelId === "auto") return true;
    const isAdmin = tenantId === ADMIN_TENANT_ID;
    const allowed = await getAvailableModelsForTenant(tenantId, isAdmin);
    return allowed.some(m => m.id === modelId);
  }

  // ─── Messages (streaming SSE) ────────────────────────────
  // R118 — per-message thumbs feedback (Tigrimos nugget #1). Becomes 4th
  // evidence dimension for the AEvo meta-editor. Tenant-scoped via
  // upsertMessageFeedback (verifies messageId belongs to caller's tenant
  // before insert/upsert). Idempotent: a user changing their vote updates
  // the existing row rather than stacking.
  app.post("/api/messages/:id/feedback", validate(messageFeedbackSchema), async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const messageId = parseInt(req.params.id as string, 10);
      if (!Number.isInteger(messageId) || messageId <= 0) {
        return res.status(400).json({ error: "Invalid messageId" });
      }
      const { rating, comment } = req.body as { rating: 1 | -1; comment?: string };
      // Look up conversationId for the message (storage method re-verifies tenant).
      const msgRow = await db.select({ conversationId: messages.conversationId, tenantId: messages.tenantId })
        .from(messages).where(eq(messages.id, messageId)).limit(1);
      if (!msgRow[0]) return res.status(404).json({ error: "Message not found" });
      if (msgRow[0].tenantId !== tenantId) return res.status(403).json({ error: "Forbidden" });

      const userId = (req as any).session?.userId ?? null;
      const saved = await storage.upsertMessageFeedback({
        tenantId,
        conversationId: msgRow[0].conversationId,
        messageId,
        userId: typeof userId === "number" ? userId : null,
        rating,
        comment: comment && comment.trim() ? comment.trim() : null,
        topicHint: null,
      } as any);
      return res.json({ ok: true, feedback: { id: saved.id, rating: saved.rating } });
    } catch (err: any) {
      console.error("[message-feedback] error:", err?.message || err);
      const msg = String(err?.message || "");
      if (msg.includes("Tenant mismatch") || msg.includes("Forbidden")) return res.status(403).json({ error: "Forbidden" });
      if (msg.includes("Message not found")) return res.status(404).json({ error: "Message not found" });
      return res.status(500).json({ error: "Failed to save feedback" });
    }
  });

  app.post("/api/conversations/:id/messages", async (req, res) => {
    notifyHeartbeatActivity();
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const conversationId = parseInt(req.params.id as string);
    const { content, attachments, suggestQuestions, pageContext } = req.body;
    if (!content?.trim() && (!attachments || attachments.length === 0)) return res.status(400).json({ error: "Content required" });

    // R102 — Per-tenant token-bucket rate limit (admission control). Architect
    // pass found this gate was unwired even though chat-engine carried a
    // comment claiming route-layer enforcement; fix lands here at the chat
    // ingress so a runaway client can't burn the chat slot pool.
    try {
      const { checkTenantRate } = await import("./lib/tenant-rate-limit");
      const decision = checkTenantRate(tenantId);
      if (!decision.allowed) {
        res.setHeader("Retry-After", String(decision.retryAfterSeconds));
        res.setHeader("X-RateLimit-Limit", String(decision.limitPerMin));
        res.setHeader("X-RateLimit-Remaining", "0");
        return res.status(429).json({
          error: `Per-tenant chat rate limit exceeded (${decision.limitPerMin}/min). Retry in ${decision.retryAfterSeconds}s.`,
          code: "TENANT_RATE_LIMIT",
          retryAfterSeconds: decision.retryAfterSeconds,
        });
      }
    } catch (rateErr: any) {
      // R108.1 +sec — Fail CLOSED on rate-limiter errors. Per replit.md user
      // preference: "Rate limiters: fail-CLOSED on Redis/store outage". The
      // gate is in-process (no redis) so the only way it errors is a module
      // load / runtime bug; either way, silently letting traffic through
      // would re-open the R102 gap the limiter was added to close.
      console.error("[rate-limit] gate error → fail-closed 503:", rateErr?.message || String(rateErr));
      res.setHeader("Retry-After", "30");
      return res.status(503).json({
        error: "Rate-limit gate temporarily unavailable. Please retry shortly.",
        code: "RATE_LIMIT_GATE_ERROR",
        retryAfterSeconds: 30,
      });
    }

    // R108.1 +sec — Two-phase usage metering:
    //   Phase 1 (gating, fail-CLOSED): checkMessageLimit + trackMessage. Both
    //   must succeed before the request is admitted. A throw here returns
    //   503 instead of silently passing the request through (which would
    //   re-open the spend-control gap).
    //   Phase 2 (best-effort, fail-OPEN): warning email + over-limit email.
    //   Notification side-effects must NOT fail the request; throwing here
    //   would cause retry-induced double-counts because trackMessage already
    //   incremented in phase 1.
    let msgCheck: any = null;
    try {
      const { checkMessageLimit, trackMessage } = await import("./usage-metering");
      msgCheck = await checkMessageLimit(tenantId);
      if (!msgCheck.allowed) {
        // Send over-limit email best-effort (do NOT count as gate failure).
        try {
          const dedupKey = `limit-${tenantId}-messages_day-${new Date().toISOString().split("T")[0]}`;
          if (!emailDedupCache.has(dedupKey)) {
            emailDedupCache.add(dedupKey);
            const tenant = await storage.getTenant(tenantId);
            if (tenant?.email) {
              sendLimitReachedEmail(tenant.email, tenant.name, "messages_day", msgCheck.limit, tenant.plan || "trial").catch(() => {});
            }
          }
        } catch (notifyErr) {
          console.warn("[usage] over-limit email best-effort failed:", (notifyErr as any)?.message);
        }
        return res.status(429).json({ error: msgCheck.reason, code: "USAGE_LIMIT", current: msgCheck.current, limit: msgCheck.limit });
      }
      await trackMessage(tenantId);
    } catch (e) {
      console.error("[usage] metering gate error → fail-closed 503:", (e as any)?.message || String(e));
      res.setHeader("Retry-After", "30");
      return res.status(503).json({
        error: "Usage-metering gate temporarily unavailable. Please retry shortly.",
        code: "USAGE_METERING_GATE_ERROR",
        retryAfterSeconds: 30,
      });
    }
    // Phase 2 — best-effort 80% warning email. Must NOT throw out of this
    // block: trackMessage already incremented; a throw → 503 → client retry
    // → double-count.
    try {
      if (msgCheck && msgCheck.limit > 0 && msgCheck.current > 0) {
        const pct = (msgCheck.current / msgCheck.limit) * 100;
        if (pct >= 80 && pct < 81) {
          const dedupKey = `warn-${tenantId}-messages_day-${new Date().toISOString().split("T")[0]}`;
          if (!emailDedupCache.has(dedupKey)) {
            emailDedupCache.add(dedupKey);
            const tenant = await storage.getTenant(tenantId);
            if (tenant?.email) {
              sendUsageWarningEmail(tenant.email, tenant.name, "messages_day", msgCheck.current, msgCheck.limit, tenant.plan || "trial").catch(() => {});
            }
          }
        }
      }
    } catch (warnErr) {
      console.warn("[usage] 80% warning email best-effort failed:", (warnErr as any)?.message);
    }

    const conv = isAdminRequest(req)
      ? await storage.getConversationUnscoped(conversationId)
      : await storage.getConversation(conversationId, tenantId);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    if (conv.tenantId !== tenantId && !isAdminRequest(req)) {
      return res.status(403).json({ error: "Access denied" });
    }

    let releaseQueue: (() => void) | null = null;
    try {
      releaseQueue = await acquireConversationLock(conversationId);
    } catch (queueErr: any) {
      return res.status(429).json({ error: queueErr.message || "Conversation is busy — please wait for the current message to finish" });
    }

    try {

    let storedContent = (content || "").trim();

    const secretScan = scanInboundMessage(storedContent);
    if (secretScan.containsSecret && secretScan.warning) {
      console.log(`[safety] Inbound message contains potential secrets for conv ${conversationId}`);
    }

    const parsedAttachments: { url: string; name: string; type: string }[] = Array.isArray(attachments) ? attachments : [];
    if (parsedAttachments.length > 0) {
      const attachJson = JSON.stringify(parsedAttachments);
      const attachScan = scanAndAnnotate(attachJson, `conv:${conversationId}:attachments`);
      if (!attachScan.safe) {
        return res.status(400).json({
          error: "Attachment metadata blocked by security scanner.",
          riskLevel: getInjectionRiskLevel(attachScan.riskScore),
        });
      }
      storedContent = `<!-- attachments:${attachJson} -->\n${storedContent}`;
    }

    const injectionScan = scanAndAnnotate(storedContent, `conv:${conversationId}`);
    if (!injectionScan.safe) {
      return res.status(400).json({
        error: "Message blocked by security scanner. Prompt injection detected.",
        riskLevel: getInjectionRiskLevel(injectionScan.riskScore),
      });
    }
    if (injectionScan.warnings.length > 0) {
      storedContent = injectionScan.content;
    }

    const savedUserMsg = await storage.createMessage({ conversationId, role: "user", content: storedContent, tenantId });
    if (!savedUserMsg?.id) {
      console.error(`[data-protection] CRITICAL: User message failed to save for conv ${conversationId}`);
      return res.status(500).json({ error: "Message could not be saved. Please try again." });
    }
    broadcastToConversation(conversationId, { type: "new_message", message: { id: savedUserMsg.id, role: "user", content: storedContent, conversationId, createdAt: new Date().toISOString() } });

    const { detectSentiment, logSentimentEvent } = await import("./sentiment-detector");
    const sentimentSignal = detectSentiment(storedContent);
    if (sentimentSignal.triggers.length > 0) {
      console.log(`[sentiment] Conv ${conversationId}: score=${sentimentSignal.score} triggers=[${sentimentSignal.triggers.join(", ")}]`);
      logSentimentEvent(tenantId, conversationId, sentimentSignal).catch(() => {});
    }

    const { trackConversationActivity } = await import("./auto-consolidation");
    trackConversationActivity(tenantId, conversationId);

    emitHookEvent({
      type: "message", action: "received", sessionKey: `conv:${conversationId}`,
      timestamp: new Date(), messages: [],
      context: { from: "user", content: storedContent.slice(0, 500), conversationId, tenantId },
    }).catch(() => {});
    const allMessages = await storage.getMessages(conversationId, tenantId);
    const settings = await storage.getSettings();

    const persona = conv.personaId ? await storage.getPersona(conv.personaId) : await storage.getActivePersona();
    const convTenantId = conv.tenantId ?? ADMIN_TENANT_ID;

    // ---- EARLY SSE STREAM OPEN ----
    // Open the event stream BEFORE the heavy pre-flight (memory load, auto-route
    // classify, system-prompt build, project context). Previously headers weren't
    // flushed until after ALL of that ran, so the client sat on a bare
    // "Connecting to agent…" for the entire pre-flight (observed ~140s). Flushing
    // here makes the browser's fetch() resolve immediately and lets us stream
    // phase breadcrumbs while we prepare. The outer error handler already guards
    // every late failure with `if (!res.headersSent)` → SSE-error path, so this
    // is safe; the one pre-stream JSON error (unknown model) is converted to an
    // SSE error below.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    if (req.socket) req.socket.setTimeout(960_000);
    let streamAborted = false;
    let globalKeepalive: ReturnType<typeof setInterval> | null = null;
    try { res.flushHeaders(); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    const sendStatus = (phase: string) => {
      if (streamAborted) return;
      try { res.write(`data: ${JSON.stringify({ type: "status", phase })}\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    };
    globalKeepalive = setInterval(() => {
      if (!streamAborted) {
        try { res.write(`: keepalive\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      }
    }, 15000);
    sendStatus("connecting");

    sendStatus("loading_context");
    const [memResult, enabledSkills, knResult] = await Promise.all([
      storage.getMemoryEntries(persona?.id, 100, 0, convTenantId),
      storage.getEnabledSkillsWithPrompts(persona?.id),
      storage.getKnowledge(persona?.id, 100, 0, convTenantId),
    ]);

    let model = conv.model || "gpt-5.5";
    if (model !== "auto") {
      const modelAllowed = await validateModelForTenant(model, tenantId);
      if (!modelAllowed) {
        model = "gpt-5.5";
      }
    }

    const isThinkingMode = !!conv.thinking;
    let thinkingLevel = (conv as any).thinkingLevel || (isThinkingMode ? "medium" : "off");
    if (thinkingLevel === "auto") {
      const { autoDetectThinkingLevel } = await import("./chat-engine");
      thinkingLevel = autoDetectThinkingLevel(content.trim());
    }

    // Parallelize the two pre-flight long poles. Auto-routing (an LLM classify
    // call) and system-prompt assembly are independent — neither consumes the
    // other's output — so run them concurrently instead of serially. autoRouteP is
    // self-guarded (falls back to gpt-5.5 on failure, never rejects); a
    // buildSystemPrompt rejection propagates to the outer handler exactly as it
    // did before this change.
    sendStatus("routing");
    type AutoRouteDecision = { modelId: string; label: string; reason: string; category: string };
    // NOTE: the decision is RETURNED from the IIFE (not assigned to an outer
    // `let`) so it's captured via the Promise.all destructure below. Assigning
    // to an outer `let` from inside this closure would leave TS's control-flow
    // analysis blind to the assignment → the outer var narrows to `never`.
    const autoRouteP = (async (): Promise<AutoRouteDecision | null> => {
      if (model !== "auto") return null;
      try {
        // Reasoning Front Door (env-gated, fail-open): let the agent form an
        // explicit plan and pick the route itself; the category classifier is
        // demoted to a hint. Disabled or null → identical to today's path.
        let categoryOverride: string | undefined;
        // Env-gate BEFORE the dynamic import so the disabled path is byte-identical
        // to the legacy route — no module load, no new failure surface, just a string compare.
        if (process.env.REASONING_FRONT_DOOR === "1") {
          try {
            const fd = await import("./reasoning-front-door");
            const plan = await fd.runReasoningFrontDoor({
              userMessage: storedContent,
              tenantId: convTenantId,
              personaName: persona?.name,
            });
            if (fd.shouldTrustPlan(plan, listRouteCategories())) {
              categoryOverride = plan!.category;
            }
          } catch (_fdErr) { logSilentCatch("server/routes.ts", _fdErr); }
        }

        const decision = await autoRouteModel(storedContent, convTenantId, categoryOverride);
        model = decision.modelId;
        console.log(`[auto-router] "${decision.category}" → ${decision.label} (${decision.reason})`);
        return decision;
      } catch (err) {
        console.error("[auto-router] Classification failed, using gpt-5.5:", err);
        model = "gpt-5.5";
        return { modelId: "gpt-5.5", label: "GPT-5.5", reason: "Fallback", category: "general" };
      }
    })();
    const buildPromptP = buildSystemPrompt(
      persona, memResult.data, settings, enabledSkills, knResult.data,
      isThinkingMode || thinkingLevel !== "off", thinkingLevel, content.trim(),
      tenantId, undefined, conversationId, "web",
    );
    const [autoRouteDecision, promptBundle] = await Promise.all([autoRouteP, buildPromptP]);
    const { prompt: basePrompt, stablePrompt: baseStablePrompt, injectedMemoryIds, citations: collectedCitations } = promptBundle;
    sendStatus("preparing");

    let systemPrompt = basePrompt;
    try {
      const { getConversationProjectContext } = await import("./chat-engine");
      const projectResult = await getConversationProjectContext(conversationId, conv);
      if (projectResult) systemPrompt += "\n\n" + projectResult.context;
    } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }

    if (sentimentSignal.adaptiveDirective) {
      systemPrompt += "\n\n" + sentimentSignal.adaptiveDirective;
    }

    const intakeInstruction = getIntakeInstruction(allMessages.slice(0, -1), storedContent);
    let pageContextBlock = "";
    try {
      if (pageContext) {
        const { sanitizePageContext, renderPageContextBlock } = await import("./lib/page-context");
        pageContextBlock = renderPageContextBlock(sanitizePageContext(pageContext));
      }
    } catch (_pcErr) { logSilentCatch("server/routes.ts", _pcErr); }
    const finalSystemPrompt = (intakeInstruction ? `${systemPrompt}\n\n${intakeInstruction}` : systemPrompt) + pageContextBlock;

    const registeredModel = MODEL_REGISTRY.find((m) => m.id === model);
    if (!registeredModel) {
      // Headers already flushed (early SSE open) → emit an SSE error instead of a
      // JSON 400, then end the stream cleanly.
      try { res.write(`data: ${JSON.stringify({ type: "fatal_error", error: `Unknown model: ${model}. Update the model in conversation settings.` })}\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      try { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      try { if (globalKeepalive) clearInterval(globalKeepalive); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      streamAborted = true;
      return res.end();
    }

    storage.touchMemoryEntries(injectedMemoryIds, tenantId).catch(() => {});

    const missingFiles = new Set<string>();
    for (const m of allMessages) {
      if (m.role === "assistant") continue;
      const attachMatch = m.content.match(/^<!-- attachments:(\[[\s\S]*?\]) -->\n?/);
      if (!attachMatch) continue;
      try {
        const atts: { url: string; name: string; type: string }[] = JSON.parse(attachMatch[1]);
        for (const a of atts) {
          if (a.type.startsWith("image/") && a.url.startsWith("/uploads/")) {
            const safeName = path.basename(a.url);
            const localPath = path.join(UPLOADS_DIR, safeName);
            if (!fs.existsSync(localPath)) missingFiles.add(safeName);
          }
        }
      } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    }

    const restoredFiles = new Map<string, { mimeType: string; data: string }>();
    if (missingFiles.size > 0) {
      try {
        const { db: fileDb } = await import("./db");
        const { inArray, and, eq } = await import("drizzle-orm");
        // Tenant-scope the restore: filenames are derived from user-supplied
        // attachment metadata, so an unscoped lookup would restore another
        // tenant's file content by referencing its filename. Bound to the
        // conversation's owning tenant.
        const stored = await fileDb.select().from(fileStorage).where(and(inArray(fileStorage.filename, [...missingFiles]), eq(fileStorage.tenantId, convTenantId)));
        for (const s of stored) {
          restoredFiles.set(s.filename, { mimeType: s.mimeType, data: s.data });
          try {
            await fsPromises.writeFile(path.join(UPLOADS_DIR, s.filename), Buffer.from(s.data, "base64"));
          } catch (writeErr) {
            // Loud — silent failure here masked the upload "missing on disk"
            // class of bug for months. The file is still in DB so retries can
            // recover, but downstream OCR/analysis will blame the wrong layer.
            console.warn(`[upload] DB→disk restore writeFile failed for ${s.filename}:`, (writeErr as Error)?.message);
          }
        }
      } catch (restoreErr) {
        console.error("[upload] Batch DB restore failed:", (restoreErr as Error).message);
      }
    }

    const fileTextCache = new Map<string, string>();
    {
      const { extractPdfText } = await import("./pdf-tool");
      const DOC_TYPES = new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword", "application/vnd.google-apps.document"]);
      const DOC_EXTS = new Set([".docx", ".doc", ".gdoc"]);
      for (const m of allMessages) {
        if (m.role === "assistant") continue;
        const am = m.content.match(/^<!-- attachments:(\[[\s\S]*?\]) -->\n?/);
        if (!am) continue;
        try {
          const atts: { url: string; name: string; type: string }[] = JSON.parse(am[1]);
          for (const f of atts) {
            if (fileTextCache.has(f.url)) continue;
            const fExt = path.extname(f.name || "").toLowerCase();

            if (f.type === "application/pdf" && f.url.startsWith("/uploads/")) {
              const pdfPath = path.join(UPLOADS_DIR, path.basename(f.url));
              if (fs.existsSync(pdfPath)) {
                try {
                  const result = await extractPdfText(pdfPath);
                  if (result.success && result.text) {
                    const truncText = result.text.length > 8000 ? result.text.slice(0, 8000) + "\n...(truncated)" : result.text;
                    fileTextCache.set(f.url, `\n\n--- Content of ${f.name} (${result.pages || "?"} pages) ---\n${truncText}\n--- End of ${f.name} ---`);
                  }
                } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
              }
            }

            if ((DOC_TYPES.has(f.type) || DOC_EXTS.has(fExt)) && f.url.startsWith("/uploads/")) {
              const docPath = path.join(UPLOADS_DIR, path.basename(f.url));
              if (fs.existsSync(docPath)) {
                try {
                  const text = await extractTextFromFile(docPath, fExt || ".docx");
                  if (text) {
                    const truncText = text.length > 8000 ? text.slice(0, 8000) + "\n...(truncated)" : text;
                    fileTextCache.set(f.url, `\n\n--- Content of ${f.name} ---\n${truncText}\n--- End of ${f.name} ---`);
                  }
                } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
              }
            }

            const gdocMatch = f.url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/) || f.name.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
            if (gdocMatch || f.type === "application/vnd.google-apps.document") {
              try {
                let docId = gdocMatch?.[1];
                if (!docId && f.url.startsWith("/uploads/")) {
                  const gdocPath = path.join(UPLOADS_DIR, path.basename(f.url));
                  if (fs.existsSync(gdocPath)) {
                    const gdocContent = fs.readFileSync(gdocPath, "utf-8");
                    const idMatch = gdocContent.match(/"doc_id"\s*:\s*"([^"]+)"/) || gdocContent.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
                    if (idMatch) docId = idMatch[1];
                  }
                }
                if (docId) {
                  const { getAccessToken } = await import("./google-drive");
                  const token = await getAccessToken();
                  if (token) {
                    const gdocResp = await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`, {
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    if (gdocResp.ok) {
                      const gdocText = await gdocResp.text();
                      if (gdocText) {
                        const truncText = gdocText.length > 8000 ? gdocText.slice(0, 8000) + "\n...(truncated)" : gdocText;
                        fileTextCache.set(f.url, `\n\n--- Content of ${f.name} (Google Doc) ---\n${truncText}\n--- End of ${f.name} ---`);
                        console.log(`[attachment] Extracted Google Doc "${f.name}" (${gdocText.length} chars)`);
                      }
                    }
                  }
                }
              } catch (gdocErr: any) {
                console.warn(`[attachment] Google Doc extraction failed for "${f.name}": ${gdocErr.message?.slice(0, 80)}`);
              }
            }
          }
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      }
    }

    {
      const lastMsg = allMessages[allMessages.length - 1];
      if (lastMsg?.role === "user") {
        const gdocUrlRegex = /https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/g;
        let gdocUrlMatch;
        while ((gdocUrlMatch = gdocUrlRegex.exec(lastMsg.content)) !== null) {
          const docId = gdocUrlMatch[1];
          const cacheKey = `gdoc:${docId}`;
          if (fileTextCache.has(cacheKey)) continue;
          try {
            const { getAccessToken } = await import("./google-drive");
            const token = await getAccessToken();
            if (token) {
              const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (resp.ok) {
                const text = await resp.text();
                if (text) {
                  const metaResp = await fetch(`https://www.googleapis.com/drive/v3/files/${docId}?fields=name`, {
                    headers: { Authorization: `Bearer ${token}` },
                  }).catch(() => null);
                  const docName = metaResp?.ok ? (await metaResp.json()).name || "Google Doc" : "Google Doc";
                  const truncText = text.length > 8000 ? text.slice(0, 8000) + "\n...(truncated)" : text;
                  fileTextCache.set(cacheKey, `\n\n--- Content of "${docName}" (Google Doc) ---\n${truncText}\n--- End of "${docName}" ---`);
                  console.log(`[attachment] Auto-fetched Google Doc "${docName}" from inline URL (${text.length} chars)`);
                }
              }
            }
          } catch (e: any) {
            console.warn(`[attachment] Inline Google Doc fetch failed: ${e.message?.slice(0, 80)}`);
          }
        }
      }
    }

    const inlineDocContext = [...fileTextCache.entries()]
      .filter(([k]) => k.startsWith("gdoc:"))
      .map(([, v]) => v)
      .join("");

    const MAX_FILE_CONTEXT_CHARS = 4000;
    const chatMessages = windowMessages(
      (allMessages as any).map((m: any, idx: number) => {
        const isRecent = idx >= allMessages.length - 2;
        if (m.role === "assistant") {
          let cleaned = stripThinkTags(m.content);
          if (!isRecent && cleaned.length > 1500) {
            cleaned = cleaned.slice(0, 800) + `\n[... truncated ${cleaned.length} chars ...]`;
          }
          return { role: "assistant" as const, content: cleaned };
        }
        if (!isRecent && m.content.length > 2000) {
          const stripped = m.content.replace(/^<!-- attachments:[\s\S]*?-->\n?/, "");
          return { role: "user" as const, content: stripped.slice(0, 1500) + `\n[... truncated older message ...]` };
        }
        const attachMatch = m.content.match(/^<!-- attachments:(\[[\s\S]*?\]) -->\n?/);
        if (!attachMatch) {
          if (isRecent && inlineDocContext && idx === allMessages.length - 1) {
            return { role: "user" as const, content: m.content + inlineDocContext };
          }
          return { role: "user" as const, content: m.content };
        }
        const textContent = m.content.slice(attachMatch[0].length);
        try {
          const atts: { url: string; name: string; type: string }[] = JSON.parse(attachMatch[1]);
          const imageAtts = atts.filter((a) => a.type.startsWith("image/"));
          const fileAtts = atts.filter((a) => !a.type.startsWith("image/"));
          const parts: any[] = [];

          let fileContext = "";
          for (const f of fileAtts) {
            const cached = fileTextCache.get(f.url);
            if (cached) fileContext += cached.slice(0, MAX_FILE_CONTEXT_CHARS);
          }

          if (textContent.trim()) {
            let textPart = textContent.trim();
            if (fileAtts.length > 0) {
              textPart += "\n\n[Attached files: " + fileAtts.map((f) => `${f.name} (${f.url})`).join(", ") + "]";
            }
            if (fileContext) textPart += "\n\n" + fileContext;
            parts.push({ type: "text", text: textPart });
          } else if (fileAtts.length > 0) {
            let textPart = "[Attached files: " + fileAtts.map((f) => `${f.name} (${f.url})`).join(", ") + "]";
            if (fileContext) textPart += "\n\n" + fileContext;
            parts.push({ type: "text", text: textPart });
          }
          if (isRecent) {
            for (const img of imageAtts) {
              let imgUrl = img.url;
              if (img.url.startsWith("/uploads/")) {
                const safeName = path.basename(img.url);
                const localPath = path.join(UPLOADS_DIR, safeName);
                let resolved = false;
                try {
                  if (fs.existsSync(localPath)) {
                    const realPath = fs.realpathSync(localPath);
                    const uploadsReal = fs.realpathSync(UPLOADS_DIR);
                    if (realPath.startsWith(uploadsReal + path.sep)) {
                      const b64 = fs.readFileSync(localPath).toString("base64");
                      const mimeType = img.type || "image/png";
                      imgUrl = `data:${mimeType};base64,${b64}`;
                      resolved = true;
                    }
                  }
                } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
                if (!resolved) {
                  const dbFile = restoredFiles.get(safeName);
                  if (dbFile) {
                    imgUrl = `data:${dbFile.mimeType};base64,${dbFile.data}`;
                    resolved = true;
                  }
                }
                if (!resolved) {
                  parts.push({ type: "text", text: `[Image: ${img.name || safeName} — file available at ${img.url}]` });
                  continue;
                }
              }
              if (!imgUrl.startsWith("http://") && !imgUrl.startsWith("https://") && !imgUrl.startsWith("data:")) {
                parts.push({ type: "text", text: `[Image: ${img.name || "attachment"} — available at ${img.url}]` });
                continue;
              }
              parts.push({ type: "image_url", image_url: { url: imgUrl } });
            }
          } else {
            for (const img of imageAtts) {
              parts.push({ type: "text", text: `[Image: ${img.name || "attachment"} — available at ${img.url}]` });
            }
          }
          if (parts.length === 0) {
            parts.push({ type: "text", text: textContent || "(attachment)" });
          }
          return { role: "user" as const, content: parts };
        } catch {
          return { role: "user" as const, content: m.content.slice(attachMatch[0].length) || m.content };
        }
      })
    );

    // SSE headers + keepalive are now opened EARLY (see "EARLY SSE STREAM OPEN"
    // above), so streamAborted / globalKeepalive are already declared and the
    // keepalive interval is already running by this point.
    const pendingConfirmationIds: string[] = [];

    let globalBrowserLiveHandler: ((evt: any) => void) | null = null;
    if (tenantId) {
      try {
        const { browserEvents } = await import("./browser-tool");
        globalBrowserLiveHandler = (evt: any) => {
          if (evt.tenantId === tenantId && !streamAborted) {
            try { res.write(`data: ${JSON.stringify({ browser_live: { type: evt.type, statusText: evt.statusText, screenshotUrl: evt.screenshotUrl, screenshotBase64: evt.screenshotBase64, pageTitle: evt.pageTitle, pageUrl: evt.pageUrl, visionNarration: evt.visionNarration } })}\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
          }
        };
        browserEvents.on("live", globalBrowserLiveHandler);
      } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
    }

    // R74.13z-tris (architect Area A #1, D #2): AbortController for in-flight
    // RLM recovery and any other long-running async that should bail when the
    // client disconnects. Without this, runRecursiveLLM keeps fanning out
    // sub-calls (up to 50 of them, ~30-90s of capacity each) AFTER the SSE
    // socket is dead. Wired into runRecursiveLLM(...,{signal}) at the recovery
    // hook below.
    const streamAbortController = new AbortController();
    // R87 — FIRST_COMPLETED-style teardown: when EITHER side closes, abort the
    // upstream stream + perform full cleanup so we don't keep burning provider
    // tokens (or holding pending tool confirmations) on a connection nobody is
    // reading. Both req.on('close') and res.on('close'/'error') route through
    // the same teardown to avoid asymmetric cleanup.
    let clientDisconnected = false;
    const onClientGone = (reasonTag: string) => {
      if (clientDisconnected) return;
      clientDisconnected = true;
      streamAborted = true;
      try { streamAbortController.abort(); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      try { if (globalKeepalive) clearInterval(globalKeepalive); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      for (const cid of pendingConfirmationIds) {
        try { resolveToolConfirmation(cid, false); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      }
      if (globalBrowserLiveHandler) {
        import("./browser-tool").then(({ browserEvents }) => {
          try { browserEvents.removeListener("live", globalBrowserLiveHandler!); } catch (_e) { logSilentCatch("server/routes.ts", _e); }
          globalBrowserLiveHandler = null;
        }).catch(() => {});
      }
      console.log(`[sse] client disconnected (${reasonTag}) — full teardown`);
    };
    (req as any)._clientDisconnected = () => clientDisconnected;
    res.on("close", () => onClientGone("res:close"));
    res.on("error", () => onClientGone("res:error"));
    req.on("close", () => onClientGone("req:close"));
    req.on("aborted", () => onClientGone("req:aborted"));

    if (intakeInstruction) {
      const priorMsgCount = allMessages.length - 1;
      res.write(`data: ${JSON.stringify({ type: "intake_interview", phase: priorMsgCount === 0 ? "offer" : "interviewing" })}\n\n`);
    }

    if (autoRouteDecision) {
      res.write(`data: ${JSON.stringify({ type: "auto_route", model: autoRouteDecision.modelId, label: autoRouteDecision.label, category: autoRouteDecision.category, reason: autoRouteDecision.reason })}\n\n`);
    }

    try {
      let activeClient: any;
      let activeModelId: string = "";
      let currentRegistryModelId = model;
      let failoverInfo: { used: boolean; from?: string; to?: string; reason?: string } = { used: false };

      try {
        const result = await getClientForModel(model, conv.tenantId, { requiresTools: true });
        activeClient = result.client;
        activeModelId = result.actualModelId;
      } catch (primaryErr: any) {
        const available = await getAvailableModels();
        const excludedProviders = new Set<string>();
        const failedProv = MODEL_REGISTRY.find(m => m.id === model)?.provider;
        if (failedProv) { excludedProviders.add(failedProv); markProviderUnhealthy(failedProv, String(primaryErr.message || "")); }
        for (const p of getUnhealthyProviders()) excludedProviders.add(p);

        let resolved = false;
        for (let attempt = 0; attempt < 5 && !resolved; attempt++) {
          const filtered = available.filter(m => !excludedProviders.has(m.provider));
          const fallback = findFallbackModel(model, filtered.length > 0 ? filtered : available);
          if (!fallback) break;
          try {
            const fbResult = await getClientForModel(fallback.id, conv.tenantId, { requiresTools: true });
            activeClient = fbResult.client;
            activeModelId = fbResult.actualModelId;
            currentRegistryModelId = fallback.id;
            failoverInfo = { used: true, from: model, to: fallback.id, reason: primaryErr.message };
            console.log(`[failover] Init ${attempt + 1}: ${model} → ${fallback.id} (${fallback.provider})`);
            res.write(`data: ${JSON.stringify({ type: "failover", from: model, to: fallback.id, reason: primaryErr.message })}\n\n`);
            resolved = true;
          } catch (fbErr: any) {
            markProviderUnhealthy(fallback.provider, String(fbErr.message || ""));
            excludedProviders.add(fallback.provider);
          }
        }
        if (!resolved) throw primaryErr;
      }

      const activeProvider = failoverInfo.used
        ? (MODEL_REGISTRY.find((m) => m.id === failoverInfo.to)?.provider || registeredModel.provider)
        : registeredModel.provider;
      const providerSupportsTools = PROVIDERS_SUPPORTING_TOOLS.has(activeProvider);
      let useTools = providerSupportsTools;
      // R125+47 — one-shot guard: a cold-empty completion (model returns 0 chars +
      // no tool calls + no error/abort) fails over to a stable model exactly once.
      let emptyResponseFailedOver = false;
      // R125+52.16 — bound the empty-after-tools deliverable re-inject. Re-prompting
      // the SAME model that just no-op'd loops uselessly until MAX_TOOL_ROUNDS and
      // ends the turn blank (Felix: "Used 7 tools", no answer, no error). After ONE
      // re-inject we fall through to the model-failover (switch providers) → visible
      // message → final-non-empty guarantee.
      let emptyDeliverableReinjects = 0;

      let finalChatMessages = chatMessages;
      if (shouldCompact(chatMessages.length)) {
        // Cost-ordered ladder: run the FREE deterministic head+tail compression
        // first; only pay for the LLM summary when cheap compression can't get
        // the conversation under the model's token budget. A 25-message-but-small
        // conversation now skips the gpt-5-mini summary entirely.
        const ladder = compactLadder(chatMessages, { modelId: model });
        if (ladder.fits) {
          finalChatMessages = ladder.messages;
          if (ladder.layersFired.length > 0) {
            console.log(`[compaction] Free ladder reclaimed budget [${ladder.layersFired.join(" → ")}]: ${ladder.estimatedTokensBefore} → ${ladder.estimatedTokensAfter} est. tokens — skipped LLM summary`);
          }
        } else {
          try {
            const compactionResult = await compactMessages(chatMessages, conversationId, tenantId);
            if (compactionResult.compacted && compactionResult.summary) {
              const { toKeep } = splitForCompaction(chatMessages);
              finalChatMessages = buildCompactedMessages(compactionResult.summary, toKeep, conversationId);
              console.log(`[compaction] Free ladder insufficient (${ladder.estimatedTokensAfter} est. tokens still over budget) → LLM summary: compacted ${compactionResult.removedCount} messages → summary + ${compactionResult.keptCount} recent`);
              res.write(`data: ${JSON.stringify({ type: "compaction", removed: compactionResult.removedCount, kept: compactionResult.keptCount })}\n\n`);
            } else {
              // LLM summary did not produce a usable result — still hand the
              // model the free-ladder-compressed messages rather than the raw set.
              finalChatMessages = ladder.messages;
            }
          } catch (compErr) {
            console.error("[compaction] Error during LLM compaction:", compErr);
            finalChatMessages = ladder.messages;
          }
        }
      }

      let linkContext = "";
      try {
        const linkResults = await understandLinks(content);
        if (linkResults.length > 0) {
          linkContext = formatLinkContext(linkResults);
          if (linkContext) {
            console.log(`[link-understanding] Auto-fetched ${linkResults.filter(r => !r.error).length} link(s)`);
            res.write(`data: ${JSON.stringify({ type: "link_understanding", links: linkResults.map(r => ({ url: r.url, title: r.title, error: r.error })) })}\n\n`);
          }
        }
      } catch (linkErr) {
        console.error("[link-understanding] Error:", linkErr);
      }

      if (linkContext && finalChatMessages.length > 0) {
        const lastMsg = finalChatMessages[finalChatMessages.length - 1];
        if (typeof lastMsg.content === "string") {
          const { wrapped } = wrapExternalContent(linkContext, "web_fetch", { url: "auto-fetched links" });
          lastMsg.content = lastMsg.content + "\n\n" + wrapped;
        }
      }

      // TokenPilot prompt-cache split: emit [stable(cached), dynamic+appendages].
      // finalSystemPrompt starts with basePrompt → starts with baseStablePrompt, so
      // the split prefix holds; fail-safe to a single system message otherwise.
      let apiMessages: any[] = [...splitSystemForCache(finalSystemPrompt, baseStablePrompt), ...finalChatMessages];

      try {
        const { checkAndAutoCreateProject } = await import("./auto-project");
        const autoProj = await checkAndAutoCreateProject(conversationId, tenantId, content);
        if (autoProj?.created && autoProj.directive) {
          apiMessages.push({ role: "system", content: autoProj.directive });
          res.write(`data: ${JSON.stringify({ type: "auto_project", projectId: autoProj.projectId, projectName: autoProj.projectName, trigger: autoProj.trigger })}\n\n`);
          conv.projectId = autoProj.projectId ?? null;
        }
      } catch (apErr: any) {
        console.error(`[auto-project] Hook error:`, apErr?.message);
      }

      if (persona?.id === 2 && useTools) {
        try {
          const { isComplexRequest, isCasualChat } = await import("./ceo-orchestrator");
          const casual = isCasualChat(content);
          if (!casual) {
            apiMessages.push({
              role: "system",
              content: `ORCHESTRATION REQUIRED — MANDATORY CEO PROTOCOL:
You are Felix, the CEO orchestrator. You NEVER do work directly. For EVERY task — presentations, research, emails, documents, analysis, anything that produces a deliverable — you MUST call the "orchestrate" tool immediately.

Your role: Plan → Delegate → Synthesize. Your sub-agents (Scribe, Forge, Radar, Neptune, Teagan, Apollo, etc.) do ALL the actual work. Each sub-agent handles a small, focused task with minimal token usage. This is faster and more efficient than you doing it yourself.

Call orchestrate NOW with the user's full request as the objective. Do NOT attempt any tool calls yourself (no create_slides, no google_workspace, no send_email, etc.). The orchestrator will route those to the right specialist.

${buildFelixProtocol()}`
            });
            res.write(`data: ${JSON.stringify({ type: "auto_route", label: "CEO Orchestration", reason: "Routing to specialist sub-agents for efficient execution" })}\n\n`);
            console.log(`[felix-auto-orchestrate] Task detected — forcing orchestration pipeline`);
          } else {
            apiMessages.push({
              role: "system",
              content: buildFelixProtocol()
            });
          }
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      }

      let fullResponse = "";
      // Tool-budget caps — tenant-aware. The admin/owner tenant (Bob) gets a much
      // larger budget for deep multi-step investigations; customer tenants keep a
      // tighter cost/abuse guardrail. All env-overridable. The ToolLoopDetector
      // still independently halts genuine repetition, so a higher ceiling does NOT
      // mean runaway loops — it just lets a legitimate long investigation finish
      // instead of dying mid-way at an artificially low round cap.
      const isAdminTenant = conv.tenantId === ADMIN_TENANT_ID;
      const MAX_TOOL_ROUNDS = isAdminTenant
        ? parseIntCap(process.env.MAX_TOOL_ROUNDS_ADMIN, 20, 1, 50, "MAX_TOOL_ROUNDS_ADMIN")
        : parseIntCap(process.env.MAX_TOOL_ROUNDS, 10, 1, 50, "MAX_TOOL_ROUNDS");
      const MAX_TOTAL_TOOL_CALLS = isAdminTenant
        ? parseIntCap(process.env.MAX_TOTAL_TOOL_CALLS_ADMIN, 40, 1, 200, "MAX_TOTAL_TOOL_CALLS_ADMIN")
        : parseIntCap(process.env.MAX_TOTAL_TOOL_CALLS, 25, 1, 200, "MAX_TOTAL_TOOL_CALLS");
      const MAX_TOOL_CALLS_PER_ROUND = isAdminTenant
        ? parseIntCap(process.env.MAX_TOOL_CALLS_PER_ROUND_ADMIN, 8, 1, 50, "MAX_TOOL_CALLS_PER_ROUND_ADMIN")
        : parseIntCap(process.env.MAX_TOOL_CALLS_PER_ROUND, 6, 1, 50, "MAX_TOOL_CALLS_PER_ROUND");
      const executedTools: { id: string; name: string; input: any; output: any }[] = [];
      const loopDetector = new ToolLoopDetector();
      const toolRetryTracker: Record<string, number> = {};
      let totalToolCalls = 0;
      let toolBudgetSynthesisInjected = false;

      round_loop: for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        // R87 — FIRST_COMPLETED guard: if the client is gone, stop iterating.
        if ((req as any)._clientDisconnected?.()) {
          console.log(`[sse] round ${round}: client disconnected — exiting round_loop`);
          break round_loop;
        }
        const guard = evaluateContextGuard(activeModelId, apiMessages);
        if (guard.action === "truncate") {
          console.log(`[context-guard] Round ${round}: ${guard.message}`);

          const systemMsg = apiMessages[0]?.role === "system" ? apiMessages[0] : null;
          const nonSystem = systemMsg ? apiMessages.slice(1) : apiMessages;
          const keepN = guard.truncateToMessages - (systemMsg ? 1 : 0) - 1;
          const dropCount = nonSystem.length - keepN;
          const droppedMessages = dropCount > 0 ? nonSystem.slice(0, dropCount) : [];

          if (droppedMessages.length > 0) {
            try {
              const { archiveMessages, extractAndSaveMemories } = await import("./compaction");
              await archiveMessages(conversationId, droppedMessages as any, apiMessages as any);
              console.log(`[context-guard] Archived ${droppedMessages.length} messages to compaction_archives before condensing`);

              extractAndSaveMemories(droppedMessages as any, conversationId, tenantId).then(saved => {
                if (saved > 0) console.log(`[context-guard] Extracted ${saved} memories from dropped messages`);
              }).catch(() => {});
            } catch (archiveErr: any) {
              console.error(`[context-guard] Archive save failed: ${archiveErr.message}`);
            }

            try {
              const projIdResult = await db.execute(sql`SELECT project_id FROM conversations WHERE id = ${conversationId} AND project_id IS NOT NULL`);
              const projIdRows = (projIdResult as any).rows || projIdResult;
              if (Array.isArray(projIdRows) && projIdRows.length > 0 && projIdRows[0].project_id) {
                const projId = projIdRows[0].project_id;
                const snapshot = extractDroppedMessagesSummary(apiMessages, guard.truncateToMessages);
                if (snapshot) {
                  await db.execute(sql`
                    INSERT INTO project_notes (project_id, note, author)
                    VALUES (${projId}, ${snapshot.slice(0, 5000)}, ${'system:context-guard'})
                  `);
                }
              }
            } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
          }

          apiMessages = truncateWithSummary(apiMessages, guard.truncateToMessages);
          console.log(`[context-guard] Summarized ${guard.info.estimatedTokens.toLocaleString()} tokens → ${apiMessages.length} messages (${droppedMessages.length} archived)`);
          res.write(`data: ${JSON.stringify({ type: "context_guard", action: "truncate", message: guard.message, usage: Math.round(guard.info.usageRatio * 100) })}\n\n`);
        } else if (guard.action === "warn") {
          console.log(`[context-guard] Round ${round}: ${guard.message}`);
          res.write(`data: ${JSON.stringify({ type: "context_guard", action: "warn", message: guard.message, usage: Math.round(guard.info.usageRatio * 100) })}\n\n`);
        }

        const createParams: any = {
          model: activeModelId,
          messages: apiMessages,
          stream: true,
          max_completion_tokens: getMaxOutputTokens(currentRegistryModelId),
        };
        if (useTools && round < MAX_TOOL_ROUNDS) {
          const allToolDefs = await getAllToolDefinitions(conv.tenantId);
          const routed = await routeTools(allToolDefs, apiMessages, { maxTools: MAX_ROUTED_TOOLS_PER_TURN, personaRole: persona?.role, tenantId: conv.tenantId });
          createParams.tools = routed.tools;
          createParams.tool_choice = "auto";
          if (round === 0 && routed.matchedCategories[0] !== "all") {
            res.write(`data: ${JSON.stringify({ type: "tool_routing", categories: routed.matchedCategories, selected: routed.tools.length, total: routed.totalAvailable })}\n\n`);
          }
        } else if (useTools && round >= MAX_TOOL_ROUNDS && executedTools.length > 0 && !toolBudgetSynthesisInjected) {
          // FINAL toolless round: tools are intentionally withheld once the round
          // budget (MAX_TOOL_ROUNDS) is reached. Without an explicit instruction the
          // model doesn't know it can no longer act, so it dangles a continuation
          // preamble ("Let me look at the heartbeat source code...") with no tool
          // call — which the loop then accepts as the FINAL answer (user sees a
          // promise, no result). This mirrors the MAX_TOTAL_TOOL_CALLS forced-final
          // injection below; the round cap previously had no equivalent nudge.
          toolBudgetSynthesisInjected = true;
          apiMessages.push({ role: "user", content: "SYSTEM: You have reached the maximum number of tool-use rounds and can no longer call any tools. Based on EVERYTHING you have already gathered, write your COMPLETE final answer to the user NOW. Do NOT say 'let me', 'I'll look', 'next I will', or otherwise promise further actions — there are no more tool calls available. Present all findings, analysis, and conclusions in full detail. If the investigation is incomplete, clearly state what you DID determine and what remains unknown." });
          console.log(`[sse-round] Round ${round}: tool-round budget (${MAX_TOOL_ROUNDS}) reached — injected final-synthesis instruction so the model answers instead of dangling a preamble.`);
        }

        const presToolsInContext = executedTools.some(t => ["create_slides", "build_presentation_distributed", "google_workspace", "produce_video", "mpeg_produce", "mpeg_produce_parallel"].includes(t.name));
        const MAX_CONTEXT_CHARS = presToolsInContext ? 300_000 : 500_000;
        let totalChars = apiMessages.reduce((sum: number, m: any) => sum + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content || "").length), 0);
        if (totalChars > MAX_CONTEXT_CHARS) {
          console.warn(`[context-cap] Round ${round}: ${totalChars} chars exceeds ${MAX_CONTEXT_CHARS} cap — trimming messages`);
          for (let i = 0; i < apiMessages.length - 2; i++) {
            const msg = apiMessages[i];
            if (msg.role === "system") continue;
            if (Array.isArray(msg.content)) {
              const textParts = msg.content.filter((p: any) => p.type === "text");
              const textOnly = textParts.map((p: any) => p.text).join(" ").slice(0, 1000);
              const oldSize = JSON.stringify(msg.content).length;
              msg.content = textOnly || "[previous message with images removed]";
              totalChars -= (oldSize - msg.content.length);
            }
          }
          if (totalChars > MAX_CONTEXT_CHARS) {
            for (let i = 0; i < apiMessages.length - 4 && totalChars > MAX_CONTEXT_CHARS; i++) {
              const msg = apiMessages[i];
              if (msg.role === "system") continue;
              const contentStr = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content || "");
              if (contentStr.length > 2000) {
                const trimmed = typeof msg.content === "string"
                  ? msg.content.slice(0, 500) + `\n[... trimmed from ${contentStr.length} chars ...]`
                  : JSON.stringify(msg.content).slice(0, 500);
                const saved = contentStr.length - (typeof trimmed === "string" ? trimmed.length : 500);
                msg.content = trimmed;
                totalChars -= saved;
              }
            }
          }
          if (totalChars > MAX_CONTEXT_CHARS) {
            const keepLast = 6;
            const removable = apiMessages.length - keepLast - 1;
            for (let i = 1; i < removable && totalChars > MAX_CONTEXT_CHARS; i++) {
              const msg = apiMessages[i];
              if (msg.role === "system") continue;
              const oldLen = typeof msg.content === "string" ? msg.content.length : JSON.stringify(msg.content || "").length;
              msg.content = `[old message removed to free context — ${oldLen} chars]`;
              totalChars -= (oldLen - msg.content.length);
            }
          }
          console.log(`[context-cap] After trimming: ~${totalChars} chars (${apiMessages.length} messages)`);
        }
        console.log(`[sse-round] Round ${round}: total context ~${totalChars} chars across ${apiMessages.length} messages`);

        console.log(`[sse-round] Round ${round}: creating stream with model=${activeModelId}, msgs=${apiMessages.length}, tools=${createParams.tools?.length || 0}, maxTokens=${createParams.max_completion_tokens}`);

        const thinkingLabels = [
          "Analyzing request...", "Planning approach...", "Working on it...",
          "Processing...", "Building response...", "Still working...",
          "Preparing content...", "Generating output...", "Almost there..."
        ];
        let thinkingIdx = 0;
        const thinkingTimer = setInterval(() => {
          if (!streamAborted) {
            try {
              res.write(`data: ${JSON.stringify({ type: "thinking_progress", message: thinkingLabels[thinkingIdx % thinkingLabels.length], round })}\n\n`);
              thinkingIdx++;
            } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
          }
        }, 3000);

        let stream: any;
        try {
          // R87 — pass abort signal so the upstream HTTP stream itself is
          // cancelled if the SSE client disconnects mid-round.
          // R125+ — bound the create() call itself. The first-CHUNK timeout
          // below only arms AFTER the stream object returns; a provider can hang
          // for minutes establishing the stream (observed: gemini-3.5-flash ~4min
          // → 1 char → 353s dead turn). createCompletionWithTimeout surfaces a
          // distinguishable StreamCreateTimeoutError that routes into failover
          // (not the client-disconnect path), without poisoning the shared signal.
          stream = await createCompletionWithTimeout(
            (signal) => activeClient.chat.completions.create(createParams, { signal }),
            streamAbortController.signal,
            STREAM_CREATE_TIMEOUT_MS,
            currentRegistryModelId,
          );
          console.log(`[sse-round] Round ${round}: stream created successfully`);
        } catch (streamErr: any) {
          const isCreateTimeout = streamErr instanceof StreamCreateTimeoutError;
          if (isCreateTimeout) {
            console.error(`[sse-round] Round ${round}: stream CREATION timed out after ${STREAM_CREATE_TIMEOUT_MS / 1000}s on ${currentRegistryModelId} — routing to failover`);
          }
          // R125+ — client-disconnect / abort during stream CREATION (before the
          // first token) throws an AbortError here. It is NOT a provider fault and
          // is NOT retryable, so without this guard it falls through to the
          // `throw streamErr` below — propagating out of the round_loop AND past
          // the post-loop persistence block, losing the ENTIRE turn (including all
          // already-executed tool outputs) with zero rows saved. Break to the
          // normal post-loop path instead: the Felix completion-gate rebuilds the
          // deliverable from the tool outputs server-side and persistence saves it
          // with a [stream-aborted] suffix (broadcast skipped). Mirrors the
          // mid-stream `streamAborted` handling in the iteration catch below.
          if (streamAbortController.signal.aborted || (req as any)._clientDisconnected?.() || streamAborted) {
            console.log(`[sse-round] Round ${round}: client disconnected during stream creation — breaking to persistence (executedTools=${executedTools.length})`);
            streamAborted = true;
            try { clearInterval(thinkingTimer); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
            break round_loop;
          }
          const errStatus = streamErr?.status || streamErr?.statusCode;
          const errMsg = String(streamErr?.message || "");
          const failedProv = MODEL_REGISTRY.find((m) => m.id === currentRegistryModelId)?.provider;

          if (failedProv) {
            markProviderUnhealthy(failedProv, errMsg);
            if ((errStatus === 401 || errStatus === 403 || errStatus === 429) && conv.tenantId) {
              markSubscriptionFailed(failedProv, conv.tenantId, errStatus);
            }
          }

          if (isCreateTimeout || isRetryableError(streamErr)) {
            const available = await getAvailableModels();
            const excludedProviders = new Set<string>();
            if (failedProv) excludedProviders.add(failedProv);
            for (const p of getUnhealthyProviders()) excludedProviders.add(p);

            let streamResolved = false;
            for (let attempt = 0; attempt < 5 && !streamResolved; attempt++) {
              const filtered = available.filter(m => !excludedProviders.has(m.provider));
              if (filtered.length === 0) {
                console.warn(`[failover] No remaining providers after excluding ${[...excludedProviders].join(", ")}`);
                break;
              }
              const fallback = findFallbackModel(currentRegistryModelId, filtered);
              if (!fallback) break;

              try {
                const fbResult = await getClientForModel(fallback.id, conv.tenantId, { requiresTools: useTools });
                activeClient = fbResult.client;
                activeModelId = fbResult.actualModelId;
                currentRegistryModelId = fallback.id;
                createParams.model = activeModelId;
                createParams.max_completion_tokens = getMaxOutputTokens(fallback.id);
                const fbProvider = MODEL_REGISTRY.find((m) => m.id === fallback.id)?.provider;
                if (fbProvider && !PROVIDERS_SUPPORTING_TOOLS.has(fbProvider)) {
                  delete createParams.tools;
                  delete createParams.tool_choice;
                }
                failoverInfo = { used: true, from: failoverInfo.to || model, to: fallback.id, reason: errMsg };
                console.log(`[failover] Stream ${attempt + 1} (round ${round}): → ${fallback.id} (${fbProvider})`);
                res.write(`data: ${JSON.stringify({ type: "failover", from: model, to: fallback.id, reason: errMsg })}\n\n`);
                stream = await createCompletionWithTimeout(
                  (signal) => activeClient.chat.completions.create(createParams, { signal }),
                  streamAbortController.signal,
                  STREAM_CREATE_TIMEOUT_MS,
                  fallback.id,
                );
                if (fbProvider) resetProviderHealth(fbProvider);
                streamResolved = true;
              } catch (fbErr: any) {
                const fbProvider = fallback.provider;
                const fbMsg = String(fbErr?.message || "");
                console.warn(`[failover] Stream ${attempt + 1} failed: ${fallback.id} (${fbProvider}): ${fbMsg.slice(0, 60)}`);
                markProviderUnhealthy(fbProvider, fbMsg);
                excludedProviders.add(fbProvider);
                if ((fbErr?.status === 401 || fbErr?.status === 403 || fbErr?.status === 429) && conv.tenantId) {
                  markSubscriptionFailed(fbProvider, conv.tenantId, fbErr?.status);
                }
              }
            }

            if (!streamResolved) {
              // RLM recovery — last-ditch fallback after all provider failovers exhausted.
              // Implements Algorithm 1 from Zhang/Kraska/Khattab "Recursive Language Models"
              // (arXiv:2512.24601v2, MIT CSAIL Jan 2026) to recover long-context conversations
              // that exceed direct-call limits. See agent_knowledge entry #2212 for context.
              try {
                const { runRecursiveLLM, flattenMessagesForRecursive } = await import("./recursive-llm");
                const flat = flattenMessagesForRecursive(createParams.messages as any);
                console.warn(`[rlm-recovery] All providers failed (${String(streamErr?.message).slice(0, 100)}). Engaging RLM fallback. promptChars=${flat.prompt.length}`);
                try { res.write(`data: ${JSON.stringify({ type: "recursive_recovery", message: "Direct call exhausted; engaging Recursive Language Model fallback" })}\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
                const rlmResult = await runRecursiveLLM(flat.prompt, {
                  tenantId: conv.tenantId ?? undefined,
                  taskHint: flat.taskHint,
                  signal: streamAbortController.signal,
                  onProgress: (ev) => {
                    if (streamAborted) return;
                    try { res.write(`data: ${JSON.stringify({ type: "recursive_progress", event: ev })}\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
                  },
                });
                if (rlmResult.ok && rlmResult.answer) {
                  console.log(`[rlm-recovery] succeeded: rounds=${rlmResult.rounds} subCalls=${rlmResult.subCalls} answerChars=${rlmResult.answer.length}`);
                  failoverInfo = { used: true, from: failoverInfo.to || model, to: `RLM(${rlmResult.rootModel}+${rlmResult.subModel})`, reason: "recursive recovery" };
                  try { res.write(`data: ${JSON.stringify({ type: "failover", from: model, to: failoverInfo.to, reason: "recursive recovery" })}\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
                  const _rlmAnswer = rlmResult.answer;
                  stream = (async function* () {
                    yield { choices: [{ delta: { content: _rlmAnswer, role: "assistant" }, finish_reason: "stop", index: 0 }] } as any;
                  })();
                  streamResolved = true;
                } else {
                  console.warn(`[rlm-recovery] failed: ${rlmResult.error || "no answer"}`);
                  throw streamErr;
                }
              } catch (rlmErr: any) {
                console.warn(`[rlm-recovery] threw: ${String(rlmErr?.message).slice(0, 200)}`);
                throw streamErr;
              }
            }
          } else {
            throw streamErr;
          }
        }

        let roundContent = "";
        let inThinkBlock = false;
        let thinkBuffer = "";
        const toolCallBuffers: Record<number, { id: string; name: string; args: string }> = {};
        let hasToolCalls = false;

        const PRESENTATION_TOOLS = new Set(["create_slides", "build_presentation_distributed", "google_workspace", "produce_video", "mpeg_produce", "mpeg_produce_parallel", "create_slideshow_video"]);
        const ORCHESTRATION_TOOLS = new Set(["orchestrate", "plan_and_execute", "delegate_task", "deep_research"]);
        const hadSlowTool = executedTools.some(t => PRESENTATION_TOOLS.has(t.name));
        const hadOrchestration = executedTools.some(t => ORCHESTRATION_TOOLS.has(t.name));
        const STREAM_FIRST_CHUNK_TIMEOUT = hadOrchestration ? 960_000 : hadSlowTool ? 300_000 : 120_000;

        // R81 — true mid-stream context-overflow recovery. When the LLM throws a
        // context-window error mid-stream, swap to the next big-context model via
        // getNextBigContextEscalation, recreate the stream, and resume. The retry
        // loop wraps stream-creation + iteration so we can attempt up to 4 swaps
        // (covers the full Gemini 1M → Claude Opus 1M → Nemotron 1M → Grok 4.20 2M chain).
        const _bigCtxTried = new Set<string>();
        let firstChunkReceived = false;
        let streamTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
        let thinkingCleared = false;

        escalation_retry: for (let _escAttempt = 0; _escAttempt < 4; _escAttempt++) {
        // Reset round-local stream state for this attempt (preserves fullResponse — caller-visible).
        roundContent = "";
        inThinkBlock = false;
        thinkBuffer = "";
        for (const k of Object.keys(toolCallBuffers)) delete toolCallBuffers[Number(k) as any];
        hasToolCalls = false;
        firstChunkReceived = false;
        thinkingCleared = false;
        if (streamTimeoutTimer) { clearTimeout(streamTimeoutTimer); streamTimeoutTimer = null; }
        streamTimeoutTimer = setTimeout(() => {
          if (!firstChunkReceived && !streamAborted) {
            console.error(`[sse-round] Round ${round}: TIMEOUT — no chunks received in ${STREAM_FIRST_CHUNK_TIMEOUT / 1000}s (hadSlowTool=${hadSlowTool}), aborting stream`);
            streamAborted = true;
            try { if (stream && typeof stream.controller?.abort === "function") stream.controller.abort(); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
          }
        }, STREAM_FIRST_CHUNK_TIMEOUT);

        try {
        for await (const chunk of stream) {
          if (!firstChunkReceived) {
            firstChunkReceived = true;
            if (streamTimeoutTimer) { clearTimeout(streamTimeoutTimer); streamTimeoutTimer = null; }
          }
          if (!thinkingCleared) { clearInterval(thinkingTimer); thinkingCleared = true; }
          if (streamAborted) break;
          const choice = chunk.choices[0];
          if (!choice) continue;
          const delta = choice.delta as any;

          if (delta?.tool_calls) {
            hasToolCalls = true;
            for (const tc of delta.tool_calls) {
              // Resolve which buffer slot this delta belongs to. Extracted and
              // unit-tested in ./lib/tool-call-accumulator — it handles providers
              // (observed: gemini-flash via OpenAI-compat) that stream parallel
              // tool calls without a per-call `index`, which would otherwise all
              // collapse into slot 0 and have their names concatenated into one
              // bogus "check_system_statustest_api_keys..." unknown tool.
              const idx = resolveToolCallIndex(toolCallBuffers, tc);
              if (!toolCallBuffers[idx]) {
                toolCallBuffers[idx] = { id: tc.id || `${SYNTHETIC_TOOL_CALL_ID_PREFIX}${idx}_${round}`, name: "", args: "" };
              }
              if (tc.function?.name) {
                const cur = toolCallBuffers[idx].name;
                const incoming = tc.function.name;
                if (!cur) {
                  toolCallBuffers[idx].name = incoming;
                } else if (cur === incoming) {
                  // replay — ignore (root cause of `create_memorycreate_memory` corruption)
                } else if (incoming.startsWith(cur)) {
                  // cumulative-prefix delta — replace with longer cumulative value
                  toolCallBuffers[idx].name = incoming;
                } else if (!cur.endsWith(incoming)) {
                  // genuine suffix-chunked name — concatenate (legacy path)
                  toolCallBuffers[idx].name = cur + incoming;
                }
                // else: incoming is a suffix already present — ignore
              }
              if (tc.function?.arguments) toolCallBuffers[idx].args += tc.function.arguments;
            }
          }

          // R86 — capture reasoning from non-standard delta fields (DeepSeek
          // reasoning_content, OpenRouter reasoning_details, Anthropic
          // reasoning). Stream as a thinking event so the UI shows it in the
          // thinking pane instead of dropping it.
          try {
            const { extractReasoningFromDelta } = await import("./reasoning-extractor");
            const reasoningDelta = extractReasoningFromDelta(delta);
            if (reasoningDelta) {
              res.write(`data: ${JSON.stringify({ thinking: reasoningDelta })}\n\n`);
            }
          } catch (_silentErr) { logSilentCatch("server/routes.ts:r86", _silentErr); }

          const rawDelta = delta?.content || "";
          if (!rawDelta) continue;
          // R91 — accumulate RAW (with <tool_call> tags intact) into roundContent
          // so the fallback parser downstream can detect Hermes-format blocks.
          // Strip tool/invoke wrapper tags ONLY for what we stream to the client
          // and persist as fullResponse, since those are the user-visible bytes.
          roundContent += rawDelta;
          let contentDelta = rawDelta.replace(/<\/?tool_call>/g, "").replace(/<\/?function_calls?>/g, "").replace(/<invoke\s+name="[^"]*"\s*\/?>/g, "").replace(/<\/?antml:\w+>/g, "");
          if (!contentDelta.trim() && delta?.content) continue;
          fullResponse += contentDelta;

          if (isThinkingMode) {
            thinkBuffer += contentDelta;
            while (thinkBuffer.length > 0) {
              if (!inThinkBlock) {
                const idx1 = thinkBuffer.indexOf("<think>");
                const idx2 = thinkBuffer.indexOf("<thinking>");
                let openIdx = -1;
                let openTagLen = 0;
                if (idx1 !== -1 && (idx2 === -1 || idx1 <= idx2)) { openIdx = idx1; openTagLen = 7; }
                else if (idx2 !== -1) { openIdx = idx2; openTagLen = 10; }
                if (openIdx === -1) {
                  if (thinkBuffer.length > 10) {
                    const safe = thinkBuffer.slice(0, thinkBuffer.length - 10);
                    res.write(`data: ${JSON.stringify({ content: safe })}\n\n`);
                    thinkBuffer = thinkBuffer.slice(safe.length);
                  }
                  break;
                } else {
                  if (openIdx > 0) {
                    res.write(`data: ${JSON.stringify({ content: thinkBuffer.slice(0, openIdx) })}\n\n`);
                  }
                  res.write(`data: ${JSON.stringify({ thinkStart: true })}\n\n`);
                  thinkBuffer = thinkBuffer.slice(openIdx + openTagLen);
                  inThinkBlock = true;
                }
              } else {
                const ci1 = thinkBuffer.indexOf("</think>");
                const ci2 = thinkBuffer.indexOf("</thinking>");
                let closeIdx = -1;
                let closeTagLen = 0;
                if (ci1 !== -1 && (ci2 === -1 || ci1 <= ci2)) { closeIdx = ci1; closeTagLen = 8; }
                else if (ci2 !== -1) { closeIdx = ci2; closeTagLen = 11; }
                if (closeIdx === -1) {
                  if (thinkBuffer.length > 11) {
                    const safe = thinkBuffer.slice(0, thinkBuffer.length - 11);
                    res.write(`data: ${JSON.stringify({ thinking: safe })}\n\n`);
                    thinkBuffer = thinkBuffer.slice(safe.length);
                  }
                  break;
                } else {
                  if (closeIdx > 0) {
                    res.write(`data: ${JSON.stringify({ thinking: thinkBuffer.slice(0, closeIdx) })}\n\n`);
                  }
                  res.write(`data: ${JSON.stringify({ thinkEnd: true })}\n\n`);
                  thinkBuffer = thinkBuffer.slice(closeIdx + closeTagLen);
                  inThinkBlock = false;
                }
              }
            }
          } else {
            res.write(`data: ${JSON.stringify({ content: contentDelta })}\n\n`);
            broadcastToConversation(conversationId, { type: "stream", content: contentDelta });
          }
        }
        clearInterval(thinkingTimer);
        if (streamTimeoutTimer) { clearTimeout(streamTimeoutTimer); streamTimeoutTimer = null; }
        if (streamAborted && !roundContent && !hasToolCalls) {
          if (hadSlowTool && round > 0 && executedTools.length > 0) {
            console.log(`[sse-round] Round ${round}: stream timed out after presentation/slow tool — attempting recovery retry`);
            streamAborted = false;
            res.write(`data: ${JSON.stringify({ type: "thinking_progress", message: "Recovering from timeout, retrying response...", round })}\n\n`);
            const recoveryMessages = [
              apiMessages[0],
              ...apiMessages.slice(-4),
              { role: "user", content: `SYSTEM RECOVERY: Your previous response stream timed out. You have already completed the tool work. Summarize the results and deliver the final response to the user NOW. Do NOT call any more tools. Be concise.` }
            ];
            try {
              const recoveryParams: any = { model: activeModelId, messages: recoveryMessages, stream: true, max_completion_tokens: 2000 };
              const recoveryStream = await activeClient.chat.completions.create(recoveryParams);
              for await (const rChunk of recoveryStream) {
                const rDelta = rChunk.choices?.[0]?.delta?.content || "";
                if (rDelta) {
                  roundContent += rDelta;
                  fullResponse += rDelta;
                  res.write(`data: ${JSON.stringify({ content: rDelta })}\n\n`);
                }
              }
              if (roundContent) {
                console.log(`[sse-round] Recovery succeeded — ${roundContent.length} chars delivered`);
                break round_loop;
              }
            } catch (recoveryErr: any) {
              console.error(`[sse-round] Recovery retry also failed: ${recoveryErr.message?.slice(0, 200)}`);
            }
          }
          console.error(`[sse-round] Round ${round}: stream timed out with no content, sending timeout message`);
          const timeoutMsg = "\n\n*[The model took too long to respond. Please try again — this usually works on a fresh attempt.]*";
          fullResponse += timeoutMsg;
          res.write(`data: ${JSON.stringify({ content: timeoutMsg })}\n\n`);
          break round_loop;
        }
        console.log(`[sse-round] Round ${round}: stream iteration complete, content=${roundContent.length} chars, hasToolCalls=${hasToolCalls}, toolBuffers=${Object.keys(toolCallBuffers).length}`);
        break escalation_retry; // success — no overflow, exit retry loop
        } catch (midStreamErr: any) {
          clearInterval(thinkingTimer);
          if (streamTimeoutTimer) { clearTimeout(streamTimeoutTimer); streamTimeoutTimer = null; }
          const midMsg = String(midStreamErr?.message || midStreamErr || "");
          const midMsgLower = midMsg.toLowerCase();
          console.error(`[stream] Mid-stream error (round ${round}): ${midMsg.slice(0, 300)}`);
          const isOverflow = midMsgLower.includes("context length") || midMsgLower.includes("context window") || midMsgLower.includes("maximum context") || midMsgLower.includes("too many tokens") || (midMsgLower.includes("maximum") && midMsgLower.includes("token"));
          if (isOverflow) {
            // R81 — true mid-stream context-overflow recovery via escalator chain.
            try {
              const { getNextBigContextEscalation } = await import("./context-overflow-escalator");
              _bigCtxTried.add(currentRegistryModelId);
              const next = getNextBigContextEscalation(currentRegistryModelId, _bigCtxTried);
              if (next) {
                try {
                  const escResult = await getClientForModel(next.modelId, conv.tenantId, { requiresTools: useTools });
                  const fromModel = currentRegistryModelId;
                  activeClient = escResult.client;
                  activeModelId = escResult.actualModelId;
                  currentRegistryModelId = next.modelId;
                  createParams.model = activeModelId;
                  createParams.max_completion_tokens = getMaxOutputTokens(next.modelId);
                  const nextProvider = MODEL_REGISTRY.find(m => m.id === next.modelId)?.provider;
                  if (nextProvider && !PROVIDERS_SUPPORTING_TOOLS.has(nextProvider)) {
                    delete createParams.tools;
                    delete createParams.tool_choice;
                  }
                  failoverInfo = { used: true, from: failoverInfo.to || model, to: next.modelId, reason: `context-overflow-escalation: ${next.contextWindow.toLocaleString()} ctx` };
                  res.write(`data: ${JSON.stringify({ type: "context_escalation", from: fromModel, to: next.modelId, contextWindow: next.contextWindow, rationale: next.rationale, attempt: _escAttempt + 1 })}\n\n`);
                  // Soft-notify in chat as well so the user sees it without needing the SSE event channel.
                  const escNote = `\n\n*[Context window exceeded — auto-escalating to ${next.modelId} (${(next.contextWindow / 1_000_000).toFixed(1)}M context) and resuming...]*\n\n`;
                  fullResponse += escNote;
                  res.write(`data: ${JSON.stringify({ content: escNote })}\n\n`);
                  console.log(`[sse-overflow-escalate] Round ${round} attempt ${_escAttempt + 1}: ${fromModel} → ${next.modelId} (${next.contextWindow.toLocaleString()} ctx)`);
                  // Recreate stream with the bigger-context model. The retry loop will iterate again.
                  stream = await activeClient.chat.completions.create(createParams);
                  continue escalation_retry;
                } catch (escErr: any) {
                  console.warn(`[sse-overflow-escalate] Failed to switch to ${next.modelId}: ${String(escErr?.message).slice(0, 200)}`);
                  // Fall through to chain-exhausted message below.
                }
              }
            } catch (escImportErr: any) {
              console.warn(`[sse-overflow-escalate] Escalator import failed: ${String(escImportErr?.message).slice(0, 200)}`);
            }
            // Chain exhausted or escalation failed.
            const truncNote = "\n\n*[Context window exceeded and the auto-escalation chain (Gemini 3.1 Pro 1M → Claude Opus 4.7 1M → Nemotron 1M → Grok 4.20 Multi-Agent 2M) is exhausted. Please start a new conversation or ask me to summarize and continue.]*";
            fullResponse += truncNote;
            res.write(`data: ${JSON.stringify({ content: truncNote })}\n\n`);
            hasToolCalls = false;
            break escalation_retry;
          } else if (streamAborted) {
            console.error(`[sse-round] Round ${round}: stream aborted after timeout`);
            const timeoutMsg = "\n\n*[Connection timed out. Please try again.]*";
            fullResponse += timeoutMsg;
            res.write(`data: ${JSON.stringify({ content: timeoutMsg })}\n\n`);
            hasToolCalls = false;
            break escalation_retry;
          } else if (!roundContent) {
            throw midStreamErr;
          }
          break escalation_retry; // non-overflow, partial content — exit retry loop
        }
        } // end escalation_retry

        if (isThinkingMode && thinkBuffer.length > 0) {
          if (inThinkBlock) {
            res.write(`data: ${JSON.stringify({ thinking: thinkBuffer })}\n\n`);
            res.write(`data: ${JSON.stringify({ thinkEnd: true })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ content: thinkBuffer })}\n\n`);
          }
        }

        let toolCallCount = Object.keys(toolCallBuffers).length;
        // R91 — Hermes-format fallback parser. Try the <tool_call>{json}</tool_call>
        // format BEFORE the XML invoke parser since they're disjoint and
        // open-weight models (Kimi/Qwen via vLLM/OpenRouter) prefer this form.
        if ((!hasToolCalls || toolCallCount === 0) && roundContent && roundContent.includes("<tool_call>")) {
          try {
            const { parseToolCallsFromContent } = await import("./tool-call-fallback-parser");
            const r91 = parseToolCallsFromContent(roundContent);
            if (r91.toolCalls.length > 0) {
              console.log(`[tools] R91 fallback parser recovered ${r91.toolCalls.length} <tool_call> block(s) from streamed text`);
              for (const tc of r91.toolCalls) {
                const idx = Object.keys(toolCallBuffers).length;
                toolCallBuffers[idx] = { id: tc.id, name: tc.function.name, args: tc.function.arguments };
              }
              hasToolCalls = true;
              toolCallCount = Object.keys(toolCallBuffers).length;
              // Strip the recovered tags from what we'll persist as content.
              roundContent = r91.cleanedContent;
            }
          } catch (_silentErr) { logSilentCatch("server/routes.ts:r91", _silentErr); }
        }
        if ((!hasToolCalls || toolCallCount === 0) && roundContent) {
          const xmlParsed = parseXmlToolCalls(roundContent);
          if (xmlParsed.length > 0) {
            console.log(`[tools] Recovered ${xmlParsed.length} XML-style tool call(s) from streamed text`);
            hasToolCalls = true;
            for (let xi = 0; xi < xmlParsed.length; xi++) {
              const xtc = xmlParsed[xi];
              toolCallBuffers[xi] = { id: xtc.id, name: xtc.function.name, args: xtc.function.arguments };
            }
            toolCallCount = xmlParsed.length;
            roundContent = roundContent
              .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
              .replace(/<function_calls>[\s\S]*$/g, '')
              .replace(/<invoke\s+name="[^"]*">[\s\S]*?<\/(?:antml:)?invoke>/g, '')
              .trim();
            fullResponse = fullResponse
              .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
              .replace(/<function_calls>[\s\S]*$/g, '')
              .replace(/<invoke\s+name="[^"]*">[\s\S]*?<\/(?:antml:)?invoke>/g, '')
              .trim();
          }
        }
        if ((!hasToolCalls || toolCallCount === 0) && roundContent) {
          const inlineParsed = parseInlineToolCalls(roundContent);
          if (inlineParsed.length > 0) {
            console.log(`[tools] Recovered ${inlineParsed.length} inline browse/browser tool call(s) from streamed text. Args: ${inlineParsed.map(t => t.function.arguments).join(', ')}`);
            hasToolCalls = true;
            for (let ii = 0; ii < inlineParsed.length; ii++) {
              const itc = inlineParsed[ii];
              toolCallBuffers[ii] = { id: itc.id, name: itc.function.name, args: itc.function.arguments };
            }
            toolCallCount = inlineParsed.length;
            const cleanKw = /\b(?:browse|browser)\s+(?:action|url|selector|text|tabIndex|fullPage|script|ms|profile|returnBase64)\s*=\s*\S+(?:\s+(?:action|url|selector|text|tabIndex|fullPage|script|ms|profile|returnBase64)\s*=\s*\S+)*/gi;
            const cleanJson = /\b(?:browse|browser)\s*\(\s*\{[\s\S]*?\}\s*\)/g;
            roundContent = roundContent.replace(cleanKw, '').replace(cleanJson, '').trim();
            fullResponse = fullResponse.replace(cleanKw, '').replace(cleanJson, '').trim();
          } else if (roundContent.includes("browse") || roundContent.includes("browser")) {
            console.log(`[tools] Text mentions browse/browser but inline parser didn't match. Snippet: ${roundContent.slice(0, 300)}`);
          }
        }
        if (!hasToolCalls || toolCallCount === 0) {
          // R125+ — near-empty completion: a response of ≤1 meaningful char (a lone
          // whitespace/stray token) with no tool calls is a silent no-op, not an
          // answer (observed in prod: gemini emitted exactly 1 char after a multi-min
          // hang → a dead turn). Normalize it to truly-empty so the existing 0-char
          // re-inject + cross-provider failover path below catches it, and strip the
          // junk fragment from fullResponse so it is neither persisted nor prefixed
          // ahead of the failover model's real answer. Only strips when the fragment
          // is cleanly the tail of fullResponse (no parser desync).
          if (
            roundContent.length > 0 &&
            roundContent.trim().length <= 1 &&
            fullResponse.endsWith(roundContent)
          ) {
            console.error(`[sse-round] Round ${round}: model ${currentRegistryModelId} returned a NEAR-EMPTY response (${roundContent.length} char(s), no tool calls) — treating as empty for failover.`);
            fullResponse = fullResponse.slice(0, fullResponse.length - roundContent.length);
            roundContent = "";
          }
          if (!roundContent && round > 0 && executedTools.length > 0 && emptyDeliverableReinjects < 1) {
            emptyDeliverableReinjects++;
            console.log(`[sse-round] Empty response with no tool calls after ${executedTools.length} tools in round ${round}. Injecting deliverable instruction (attempt ${emptyDeliverableReinjects}).`);
            apiMessages.push({ role: "assistant", content: "" });
            apiMessages.push({ role: "user", content: `SYSTEM: Your previous response was empty. You MUST now write a COMPLETE response. You have already used ${executedTools.length} tools and gathered data. Present ALL your findings, analysis, and deliverables to the user NOW. Do not call any more tools. Write the full response.` });
            useTools = false;
            continue;
          }
          // R125+47 — cold empty completion: the model returned 0 chars, no tool
          // calls, no error and no abort (e.g. a preview model silently no-op'ing on
          // a large context, or a safety/recitation-blocked empty candidate).
          // Previously this just `break`-ed and ended the turn with ZERO output — the
          // user saw the agent "start then stop". Fail over to a stable, tool-capable
          // model from a different provider and retry once; if it STILL empties,
          // surface a visible message (never a silent zero-output 200).
          if (!roundContent && !emptyResponseFailedOver) {
            emptyResponseFailedOver = true;
            const fromModel = currentRegistryModelId;
            try {
              const available = await getAvailableModels();
              const fromProvider = MODEL_REGISTRY.find(m => m.id === fromModel)?.provider;
              // Rank candidates: stable (non-preview) tool-capable from a DIFFERENT
              // provider first, then non-preview from a different provider, then any
              // other non-preview model. Iterate until a client actually binds — a
              // single candidate can fail getClientForModel (tenant key / transient).
              const ranked = [
                ...available.filter(m => m.provider !== fromProvider && !/preview/i.test(m.id) && PROVIDERS_SUPPORTING_TOOLS.has(m.provider)),
                ...available.filter(m => m.provider !== fromProvider && !/preview/i.test(m.id)),
                ...available.filter(m => !/preview/i.test(m.id)),
              ];
              const seen = new Set<string>([fromModel]);
              const candidates: typeof ranked = [];
              for (const m of ranked) { if (!seen.has(m.id)) { seen.add(m.id); candidates.push(m); } }
              let bound = false;
              for (const candidate of candidates.slice(0, 4)) {
                try {
                  const foResult = await getClientForModel(candidate.id, conv.tenantId, { requiresTools: useTools });
                  activeClient = foResult.client;
                  activeModelId = foResult.actualModelId;
                  currentRegistryModelId = candidate.id;
                  if (!PROVIDERS_SUPPORTING_TOOLS.has(candidate.provider)) useTools = false;
                  failoverInfo = { used: true, from: fromModel, to: candidate.id, reason: "empty-response-failover" };
                  console.error(`[sse-round] Round ${round}: model ${fromModel} returned EMPTY (0 chars, no tool calls, no error). Failing over to ${candidate.id} and retrying.`);
                  res.write(`data: ${JSON.stringify({ type: "thinking_progress", message: `The model returned an empty response — switching to ${candidate.id} and retrying...`, round })}\n\n`);
                  res.write(`data: ${JSON.stringify({ type: "model_failover", from: fromModel, to: candidate.id, reason: "empty-response" })}\n\n`);
                  bound = true;
                  break;
                } catch (bindErr: any) {
                  console.warn(`[sse-round] Empty-response failover candidate ${candidate.id} failed to bind: ${String(bindErr?.message).slice(0, 150)}`);
                }
              }
              if (bound) continue;
              console.error(`[sse-round] Round ${round}: model ${fromModel} returned EMPTY — no failover candidate bound.`);
            } catch (foErr: any) {
              console.error(`[sse-round] Empty-response failover failed: ${String(foErr?.message).slice(0, 200)}`);
            }
          }
          if (!roundContent) {
            const emptyMsg = "\n\n*[The model returned an empty response. This can happen on very long conversations — please try again, ideally in a fresh chat.]*";
            fullResponse += emptyMsg;
            res.write(`data: ${JSON.stringify({ content: emptyMsg })}\n\n`);
            console.error(`[sse-round] Round ${round}: empty completion and failover exhausted — surfaced retry message to user.`);
          }
          break;
        }

        const effectiveCount = Math.min(toolCallCount, MAX_TOOL_CALLS_PER_ROUND);
        if (totalToolCalls + effectiveCount > MAX_TOTAL_TOOL_CALLS) {
          console.log(`[tools] Total tool call cap reached (${totalToolCalls}/${MAX_TOTAL_TOOL_CALLS}). Forcing final response.`);
          res.write(`data: ${JSON.stringify({ type: "tool_cap_reached", total: totalToolCalls })}\n\n`);
          apiMessages.push({ role: "assistant", content: roundContent || null });
          apiMessages.push({ role: "user", content: "SYSTEM: Maximum tool call limit reached. You MUST respond now with a COMPLETE deliverable based on everything you have gathered. Do NOT call any more tools. CRITICAL: If you were asked to create a report, analysis, summary, or document — you must present ALL findings, data, and conclusions RIGHT NOW in full detail. Do not say 'I will prepare' or 'let me create' — the response you write next IS the final deliverable the user receives. Include all specific data, numbers, findings, and recommendations." });
          useTools = false;
          continue;
        }

        if (toolCallCount > MAX_TOOL_CALLS_PER_ROUND) {
          console.log(`[tools] Capping tool calls from ${toolCallCount} to ${MAX_TOOL_CALLS_PER_ROUND} in round ${round}`);
          const keys = Object.keys(toolCallBuffers).slice(MAX_TOOL_CALLS_PER_ROUND);
          for (const k of keys) delete toolCallBuffers[parseInt(k)];
        }

        const assistantMsg: any = { role: "assistant", content: roundContent || null, tool_calls: [] };
        for (const [, tc] of Object.entries(toolCallBuffers)) {
          // R116.1 — canonicalize args before re-sending to next provider.
          // Malformed/truncated JSON args (e.g. from aborted streams) used to
          // poison failover retries with Anthropic 400 "Failed to parse JSON".
          let safeArgs = tc.args || "{}";
          try { safeArgs = JSON.stringify(JSON.parse(safeArgs)); }
          catch (_e) {
            logSilentCatch("server/routes.ts", _e);
            console.warn(`[tool-call] dropping malformed args for ${tc.name} (id=${tc.id}): ${(tc.args || "").slice(0, 80)}`);
            safeArgs = "{}";
          }
          assistantMsg.tool_calls.push({ id: tc.id, type: "function", function: { name: tc.name, arguments: safeArgs } });
        }
        apiMessages.push(assistantMsg);

        for (const [, tc] of Object.entries(toolCallBuffers)) {
          totalToolCalls++;
          let parsedArgs: Record<string, any> = {};
          try { parsedArgs = JSON.parse(tc.args || "{}"); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }

          const toolRisk = classifyToolRisk(tc.name, parsedArgs);
          res.write(`data: ${JSON.stringify({ tool_call: { id: tc.id, name: tc.name, input: parsedArgs, risk: toolRisk.riskLevel } })}\n\n`);
          broadcastToConversation(conversationId, { type: "tool_call", tool: { name: tc.name } });
          console.log(`[tools] Executing: ${tc.name} [${toolRisk.riskLevel}] round=${round} total=${totalToolCalls} (${JSON.stringify(parsedArgs).slice(0, 100)})`);

          if (toolRisk.isMutating) {
            recordMutation({
              timestamp: new Date().toISOString(),
              toolName: tc.name,
              riskLevel: toolRisk.riskLevel,
              args: parsedArgs,
              conversationId,
              personaId: persona?.id,
            });
          }

          if (streamAborted) break;

          const needsReview = shouldReview(tc.name, toolRisk.riskLevel,
            persona?.id ? (await (async () => {
              try { const { getAutonomyLevel } = await import("./trust-engine"); return getAutonomyLevel(tenantId, persona.id, tc.name); } catch { return "approve_before" as const; }
            })()) : "approve_before" as any
          );

          if (needsReview) {
            const reviewResult = await reviewToolCall({
              toolName: tc.name,
              args: parsedArgs,
              userMessage: storedContent.slice(0, 500),
              personaId: persona?.id || null,
              personaName: persona?.name || "Unknown",
              tenantId,
              conversationId,
              riskLevel: toolRisk.riskLevel,
            });

            res.write(`data: ${JSON.stringify({
              type: "trust_review",
              toolName: tc.name,
              verdict: reviewResult.verdict,
              reason: reviewResult.reason,
              riskFactors: reviewResult.riskFactors,
              reviewTimeMs: reviewResult.reviewTimeMs,
              reviewer: reviewResult.reviewerModel,
            })}\n\n`);

            if (reviewResult.verdict === "deny") {
              const denyResult = { denied: true, message: `Tool "${tc.name}" denied by trust reviewer: ${reviewResult.reason}` };
              res.write(`data: ${JSON.stringify({ tool_result: { id: tc.id, output: denyResult } })}\n\n`);
              apiMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(denyResult) });
              console.log(`[trust-reviewer] Denied ${tc.name} — skipping HITL escalation`);
              continue;
            }

            if (reviewResult.verdict === "approve" && !toolRisk.requiresConfirmation) {
              console.log(`[trust-reviewer] Auto-approved ${tc.name} — skipping HITL`);
            } else if (reviewResult.verdict === "escalate" || toolRisk.requiresConfirmation) {
              const { confirmationId, promise } = requestToolConfirmation(
                tc.name, parsedArgs, toolRisk.riskLevel, conversationId, tenantId
              );
              pendingConfirmationIds.push(confirmationId);
              res.write(`data: ${JSON.stringify({
                type: "tool_confirmation_required",
                confirmationId,
                toolName: tc.name,
                args: parsedArgs,
                riskLevel: toolRisk.riskLevel,
                description: toolRisk.description,
                reviewReason: reviewResult.reason,
                reviewRiskFactors: reviewResult.riskFactors,
              })}\n\n`);
              console.log(`[hitl] Awaiting confirmation ${confirmationId} for ${tc.name} (reviewer: ${reviewResult.verdict})`);
              const approved = await promise;
              res.write(`data: ${JSON.stringify({
                type: "tool_confirmation_result",
                confirmationId,
                approved,
                toolName: tc.name,
              })}\n\n`);
              if (!approved) {
                const denyResult = { denied: true, message: `Tool "${tc.name}" was denied by user. The action was not executed.` };
                res.write(`data: ${JSON.stringify({ tool_result: { id: tc.id, output: denyResult } })}\n\n`);
                apiMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(denyResult) });
                if (persona?.id) {
                  try { const { recordTrustEvent } = await import("./trust-engine"); recordTrustEvent(tenantId, persona.id, "hitl_rejection", `User denied ${tc.name}`).catch(() => {}); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
                }
                continue;
              }
            }
          } else if (toolRisk.requiresConfirmation) {
            const { confirmationId, promise } = requestToolConfirmation(
              tc.name, parsedArgs, toolRisk.riskLevel, conversationId, tenantId
            );
            pendingConfirmationIds.push(confirmationId);
            res.write(`data: ${JSON.stringify({
              type: "tool_confirmation_required",
              confirmationId,
              toolName: tc.name,
              args: parsedArgs,
              riskLevel: toolRisk.riskLevel,
              description: toolRisk.description,
            })}\n\n`);
            console.log(`[hitl] Awaiting confirmation ${confirmationId} for ${tc.name}`);
            const approved = await promise;
            res.write(`data: ${JSON.stringify({
              type: "tool_confirmation_result",
              confirmationId,
              approved,
              toolName: tc.name,
            })}\n\n`);
            if (!approved) {
              const denyResult = { denied: true, message: `Tool "${tc.name}" was denied by user. The action was not executed.` };
              res.write(`data: ${JSON.stringify({ tool_result: { id: tc.id, output: denyResult } })}\n\n`);
              apiMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(denyResult) });
              if (persona?.id) {
                try { const { recordTrustEvent } = await import("./trust-engine"); recordTrustEvent(tenantId, persona.id, "hitl_rejection", `User denied ${tc.name}`).catch(() => {}); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
              }
              continue;
            }
          }

          if (tc.name === "sessions_send") {
            parsedArgs._sourceSessionKey = `conv:${conversationId}`;
            parsedArgs._sourcePersonaName = persona?.name || "main";
          }

          if (tc.name === "sessions_spawn" || tc.name === "subagents" || tc.name === "lobster" || tc.name === "project" || tc.name === "orchestrate") {
            parsedArgs._conversationId = conversationId;
          }

          if (tc.name === "orchestrate") {
            parsedArgs._tenantId = tenantId;

            const { orchestrationProgressEmitter } = await import("./tools");
            const onOrchProgress = (_convId: number, progressData: any) => {
              if (_convId === conversationId) {
                try {
                  res.write(`data: ${JSON.stringify({ type: "orchestration_progress", ...progressData })}\n\n`);
                } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
              }
            };
            orchestrationProgressEmitter.on("progress", onOrchProgress);
            const cleanupOrchListener = () => orchestrationProgressEmitter.removeListener("progress", onOrchProgress);
            res.on("close", cleanupOrchListener);
            setTimeout(() => cleanupOrchListener(), 300000);
          }

          if (tc.name === "recall_context") {
            parsedArgs.conversationId = conversationId;
            parsedArgs._tenantId = tenantId;
          }

          if (tc.name === "sessions_spawn") {
            parsedArgs._depth = 1;
          }

          for (const k of Object.keys(parsedArgs)) {
            if (k.startsWith("_")) delete parsedArgs[k];
          }
          if (tc.name === "recall_context") parsedArgs.conversationId = conversationId;
          if (tc.name === "sessions_spawn") parsedArgs._depth = 1;
          if (!tenantId) {
            res.write(`data: ${JSON.stringify({ type: "error", error: "Tenant context lost mid-stream — refusing to execute tool with admin fallback" })}\n\n`);
            res.end();
            return;
          }
          parsedArgs._tenantId = tenantId;
          parsedArgs._invokedByModel = true;

          let result: any;
          const keepaliveTimer = setInterval(() => {
            if (!streamAborted) {
              try { res.write(`: keepalive\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
            }
          }, 8000);
          try {
            const { executeGuardedTool } = await import("./guarded-tool-executor");
            result = await executeGuardedTool(tc.name, parsedArgs, {
              tenantId,
              conversationId,
              personaRole: persona?.role,
              personaName: persona?.name,
              invokedVia: "main_chat",
              // R74.13z-quint+7 (Tier-1 #8): main_chat ran the rich SSE
              // approval flow above. Skip the in-executor fallback gate
              // so we don't double-prompt on the same call.
              skipApprovalGate: true,
            });
          } catch (err: any) {
            result = { error: err.message || "Tool execution failed" };
          }
          clearInterval(keepaliveTimer);

          const hasError = result && typeof result === "object" && result.error;
          if (hasError) {
            const retryKey = `${tc.name}:${JSON.stringify(parsedArgs).slice(0, 100)}`;
            toolRetryTracker[retryKey] = (toolRetryTracker[retryKey] || 0) + 1;
            const attempt = toolRetryTracker[retryKey];

            const escalation = shouldEscalateToHuman(tc.name, attempt, result.error);
            if (escalation.escalate) {
              console.log(`[adaptive] ESCALATION: ${escalation.reason}`);
              result._selfHealHint = `ESCALATION: ${escalation.reason}. Tell the user what happened and what you tried. Ask if they want you to try a different approach or handle it manually.`;
              res.write(`data: ${JSON.stringify({ type: "adaptive_escalation", tool: tc.name, error: result.error, attempt, reason: escalation.reason })}\n\n`);
            } else if (attempt <= 3) {
              const lessons = await getRelevantLessons(tc.name, tenantId);
              const adaptiveHint = buildAdaptiveHint(tc.name, result.error, attempt, lessons);
              console.log(`[adaptive] Tool "${tc.name}" failed (attempt ${attempt}): ${result.error}`);
              result._selfHealHint = adaptiveHint;
              res.write(`data: ${JSON.stringify({ type: "adaptive_heal", tool: tc.name, error: result.error, attempt, hasLessons: lessons.length > 0 })}\n\n`);
            }
          } else if (result && typeof result === "object" && result.success) {
            const retryKey = `${tc.name}:${JSON.stringify(parsedArgs).slice(0, 100)}`;
            const prevAttempts = toolRetryTracker[retryKey] || 0;
            if (prevAttempts > 0) {
              const lesson = `Succeeded on attempt ${prevAttempts + 1} with args: ${JSON.stringify(parsedArgs).slice(0, 150)}`;
              saveLessonLearned(tc.name, "previous attempts failed", lesson, tenantId, persona?.id).catch(() => {});
              console.log(`[adaptive] Tool "${tc.name}" succeeded after ${prevAttempts} failure(s) — lesson saved`);
            }
          }

          loopDetector.record(tc.name, parsedArgs, result);

          if (result && typeof result === "object" && result.error) {
            result._userFacingInstruction = `MANDATORY: You MUST tell the user that the "${tc.name}" tool failed with this exact error: "${String(result.error).slice(0, 300)}". Do NOT hide this behind vague language. State the tool name and error clearly.`;
          }
          const resultJson = JSON.stringify(result);
          const PRES_TOOLS = new Set(["create_slides", "build_presentation_distributed", "google_workspace", "produce_video", "mpeg_produce", "mpeg_produce_parallel", "create_slideshow_video"]);
          const MAX_TOOL_RESULT_FOR_MODEL = PRES_TOOLS.has(tc.name) ? 4000 : 6000;
          // Type-aware semantic compression (replaces dumb head-slice) — fail-open,
          // honors the budget cap, keeps head+tail so end-of-payload signal survives.
          // Disable with TOOL_OUTPUT_COMPRESSION=off.
          const _comp = compressToolOutput({
            toolName: tc.name,
            raw: resultJson,
            maxChars: MAX_TOOL_RESULT_FOR_MODEL,
            enabled: process.env.TOOL_OUTPUT_COMPRESSION !== "off",
          });
          const resultStr = _comp.text;
          if (_comp.strategy !== "passthrough" && _comp.tokensSaved > 0) {
            console.log(`[tool-compress] ${tc.name}: ${_comp.originalChars}→${_comp.outputChars} chars, ~${_comp.tokensSaved} tok saved (${_comp.strategy})`);
          }
          // Fire-and-forget: persist the savings so /admin/ecosystem-health can show
          // whether this actually dents the input-token bill on real traffic.
          recordToolCompression({
            tenantId,
            originalChars: _comp.originalChars,
            outputChars: _comp.outputChars,
            maxChars: MAX_TOOL_RESULT_FOR_MODEL,
            compressed: _comp.strategy !== "passthrough",
          });
          res.write(`data: ${JSON.stringify({ tool_result: { id: tc.id, name: tc.name, output: result } })}\n\n`);
          executedTools.push({ id: tc.id, name: tc.name, input: parsedArgs, output: result });

          if (PRES_TOOLS.has(tc.name) && result && !result.error) {
            try {
              const deliveryPayload: any = { toolName: tc.name, conversationId, personaName: persona?.name || "Felix" };
              const rStr = typeof result === "string" ? result : JSON.stringify(result);
              const presTokenMatch = rStr.match(/\/present\/([a-f0-9]{16,32})/);
              if (presTokenMatch) deliveryPayload.presenterToken = presTokenMatch[1];
              const presUrlMatch = rStr.match(/(https?:\/\/[^\s"']+\/present\/[a-f0-9]{16,32})/);
              if (presUrlMatch) deliveryPayload.presenterUrl = presUrlMatch[1];
              const editMatch = rStr.match(/(https?:\/\/docs\.google\.com\/presentation\/d\/[^\s"']+)/);
              if (editMatch) deliveryPayload.editUrl = editMatch[1];
              const slideCountMatch = rStr.match(/(\d+)\s*slides?/i);
              if (slideCountMatch) deliveryPayload.slideCount = parseInt(slideCountMatch[1]);
              if (deliveryPayload.presenterToken || deliveryPayload.presenterUrl) {
                await db.execute(sql`INSERT INTO pending_deliveries (tenant_id, conversation_id, delivery_type, payload) VALUES (${tenantId}, ${conversationId}, 'presentation', ${JSON.stringify(deliveryPayload)}::jsonb)`);
                broadcastToConversation(conversationId, { type: "delivery_ready", delivery: deliveryPayload });
                const _tokRedact = deliveryPayload.presenterToken ? `${String(deliveryPayload.presenterToken).slice(0, 4)}***(len=${String(deliveryPayload.presenterToken).length})` : "?";
                console.log(`[delivery-guarantee] Saved presentation delivery for conv ${conversationId}: token=${_tokRedact}`);
              }
            } catch (delErr: any) {
              console.warn(`[delivery-guarantee] Failed to save delivery: ${delErr.message?.slice(0, 100)}`);
            }
          }

          apiMessages.push({ role: "tool", tool_call_id: tc.id, content: resultStr });
        }

        const loopCheck = loopDetector.check();
        if (loopCheck.stuck) {
          console.log(`[tool-loop] ${loopCheck.level}: ${loopCheck.message}`);
          res.write(`data: ${JSON.stringify({ type: "tool_loop_detected", level: loopCheck.level, detector: loopCheck.detector, message: loopCheck.message })}\n\n`);
          if (loopCheck.level === "critical") {
            apiMessages.push({ role: "user", content: `SYSTEM: Tool loop detected — ${loopCheck.message} Stop calling tools and respond with what you have so far.` });
            useTools = false;
          } else {
            apiMessages.push({ role: "user", content: `SYSTEM: Warning — ${loopCheck.message} Try a different approach or respond directly.` });
          }
        }
        console.log(`[sse-round] Round ${round} complete: ${totalToolCalls} total tool calls, ${executedTools.length} executed, starting round ${round + 1}`);
      }

      if (fullResponse.length > 50 && !isThinkingMode && executedTools.length === 0) {
        try {
          res.write(`data: ${JSON.stringify({ type: "reflection", status: "evaluating" })}\n\n`);
          const reflection = await reflectOnResponse(content, fullResponse, persona?.name);
          res.write(`data: ${JSON.stringify({ type: "reflection", status: "complete", scores: reflection.scores, critique: reflection.critique, shouldRefine: reflection.shouldRefine })}\n\n`);

          if (reflection.shouldRefine) {
            console.log(`[self-reflection] Refining response (overall: ${reflection.scores.overall}/10): ${reflection.critique.slice(0, 100)}`);
            res.write(`data: ${JSON.stringify({ type: "reflection", status: "refining" })}\n\n`);
            const refined = await refineResponse(content, fullResponse, reflection, activeModelId);
            if (refined !== fullResponse) {
              fullResponse = refined;
              res.write(`data: ${JSON.stringify({ type: "reflection", status: "refined", content: refined })}\n\n`);
              console.log(`[self-reflection] Response refined successfully`);
            }
          }
        } catch (reflErr: any) {
          console.log(`[self-reflection] Error: ${reflErr.message}`);
        }
      }

      if (persona?.id === 2 && executedTools.length > 0) {
        try {
          const { detectIncompleteOutcome } = await import("./chat-engine");
          const incompleteOutcome = detectIncompleteOutcome(content.trim(), fullResponse.trim(), executedTools.map(t => ({ name: t.name, input: t.input, output: t.output })));
          if (incompleteOutcome) {
            console.log(`[completion-gate] SSE: Incomplete outcome detected: ${incompleteOutcome.reason}`);
            let cgClient = replitOpenai;
            let cgModel = "gpt-5-mini";
            try {
              const cgResult = await getClientForModel("gpt-5-mini", conv.tenantId);
              cgClient = cgResult.client;
              cgModel = cgResult.actualModelId;
            } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
            const maxToolOutputChars = 2000;
            const maxTotalPayload = 30000;
            let toolSummary = "";
            for (const t of executedTools) {
              const entry = `Tool: ${t.name}\nOutput: ${JSON.stringify(t.output).slice(0, maxToolOutputChars)}`;
              if (toolSummary.length + entry.length > maxTotalPayload) {
                toolSummary += "\n\n[Additional tool outputs truncated for size]";
                break;
              }
              toolSummary += (toolSummary ? "\n\n" : "") + entry;
            }
            const completionResp = await cgClient.chat.completions.create({
              model: cgModel,
              messages: [
                { role: "system", content: `You are Felix, the CEO. The user asked: "${content.slice(0, 300)}"\n\nYour response was flagged as INCOMPLETE because: ${incompleteOutcome.reason}\n\nHere is the tool output you received but failed to fully present:\n${toolSummary}\n\nYou MUST now write the COMPLETE deliverable response. Extract ALL findings, data, analysis, and links from the tool outputs above. Present them in a professional, well-organized format. The user should get everything they need in this one response.` },
                { role: "user", content: `Deliver the complete result now. The user's original request was: "${content.slice(0, 500)}"` },
              ],
              max_completion_tokens: 4000,
            });
            const completionContent = completionResp.choices[0]?.message?.content;
            if (completionContent && completionContent.length > fullResponse.trim().length) {
              const replacement = completionContent;
              res.write(`data: ${JSON.stringify({ content: "\n\n---\n\n" + replacement })}\n\n`);
              fullResponse = replacement;
              console.log(`[completion-gate] SSE: Response rebuilt: ${fullResponse.length} chars (was ${incompleteOutcome.originalLength})`);
            }
          }
        } catch (cgErr: any) {
          console.warn(`[completion-gate] SSE: Rebuild failed: ${cgErr.message}`);
        }
      }

      // R125+52.16 — FINAL NON-EMPTY GUARANTEE (mirrors chat-engine.ts processMessage).
      // Every upstream recovery (one-shot re-inject, empty-response failover, Felix
      // completion-gate) is best-effort and can individually no-op or throw, leaving
      // fullResponse === "" — which the UI renders as tool chrome ("Used N tools")
      // with NO written answer, forcing the user to re-ask. This is the last line of
      // defense so a turn that ran tools is NEVER delivered blank.
      if (executedTools.length > 0 && fullResponse.trim().length === 0) {
        const toolList = Array.from(new Set(executedTools.map(t => t.name))).join(", ");
        const fallback = `I ran ${executedTools.length} tool call(s) (${toolList}) but couldn't compose the written summary on this pass. The work itself executed — reply "summarize what you just found" and I'll lay out the full results, or re-send your request and I'll finish it.`;
        res.write(`data: ${JSON.stringify({ content: fallback })}\n\n`);
        fullResponse += fallback;
        console.warn(`[final-guarantee] SSE: empty user-facing response after ${executedTools.length} tool(s) — emitted deterministic fallback so the turn is never blank`);
      }

      const toolMeta = executedTools.length > 0
        ? `<!-- tools:${JSON.stringify(executedTools.map(t => ({ id: t.id, name: t.name, input: t.input, output: typeof t.output === "string" ? t.output.slice(0, 500) : JSON.stringify(t.output).slice(0, 500) })))} -->\n`
        : "";
      const routeMeta = autoRouteDecision
        ? `<!-- auto_route:${JSON.stringify({ model: autoRouteDecision.modelId, label: autoRouteDecision.label, category: autoRouteDecision.category, reason: autoRouteDecision.reason })} -->\n`
        : "";
      if (persona?.id === 2 && executedTools.length === 0 && fullResponse.length > 500) {
        const deliverableKeywords = /\b(presentation|slide\s*deck|slides|pdf|report|document|proposal|white\s*paper|deck)\b/i;
        if (deliverableKeywords.test(content)) {
          const notice = "\n\n---\n\n**Note:** I wrote out the content above but wasn't able to create a file from it. Please ask me again — say something like \"Now create that as a PDF\" or \"Build that as a slide deck\" and I'll produce the actual document for you.";
          res.write(`data: ${JSON.stringify({ content: notice })}\n\n`);
          fullResponse += notice;
          console.warn(`[felix-guard] Felix produced ${fullResponse.length} chars but called 0 tools for a deliverable request — appended notice`);
        }
      }

      // R94 SECURITY — also strip Hermes-format <tool_call>{json}</tool_call>
      // blocks (the R91 fallback parser cleans roundContent but fullResponse
      // is independently accumulated for persistence/broadcast). Without this
      // the raw tool-call JSON body would be persisted as assistant text and
      // streamed to the client.
      const cleanedFullResponse = fullResponse
        .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
        .replace(/<function_calls>[\s\S]*$/g, '')
        .replace(/<invoke\s+name="[^"]*">[\s\S]*?<\/(?:antml:)?invoke>/g, '')
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .replace(/<tool_call>[\s\S]*$/g, '')
        .trim();
      // R94 SECURITY — if the client disconnected mid-stream, do NOT persist
      // partial assistant output as a normal success. The round_loop already
      // exits on disconnect, so cleanedFullResponse may be truncated. Mark
      // the partial as aborted via a [stream-aborted] suffix so it's clear in
      // the DB, and skip the broadcast/title/hooks pipeline below.
      const __wasAborted = (req as any)._clientDisconnected?.() === true || streamAborted;
      const __persistContent = __wasAborted
        ? `${routeMeta}${toolMeta}${cleanedFullResponse}\n\n[stream-aborted: client disconnected before completion]`
        : `${routeMeta}${toolMeta}${cleanedFullResponse}`;
      const __asstMsg = await storage.createMessage({ conversationId, role: "assistant", content: __persistContent, tenantId });
      // R62 — persist citations BEFORE broadcasting so the client refetch sees them on first read.
      if (Array.isArray(collectedCitations) && collectedCitations.length > 0 && (__asstMsg as any)?.id) {
        try { await storage.attachCitations((__asstMsg as any).id, collectedCitations); }
        catch (citErr: any) { console.warn(`[citations] persist failed: ${citErr.message}`); }
      }
      // R94 SECURITY — skip broadcast when stream was aborted (client is gone
      // and other watchers shouldn't see truncated content as a normal reply).
      if (!__wasAborted) {
        broadcastToConversation(conversationId, { type: "new_message", message: { id: (__asstMsg as any)?.id, role: "assistant", content: cleanedFullResponse, conversationId, createdAt: new Date().toISOString(), citations: collectedCitations && collectedCitations.length > 0 ? collectedCitations : undefined } });
      }

      let titleForLog = conv.title;
      const needsTitle = conv.title === "New Chat" || allMessages.length <= 2;
      if (needsTitle) {
        try {
          const contextSnippet = content.slice(0, 200);
          const responseSnippet = fullResponse.slice(0, 200);
          const titleResp = await replitOpenai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
              { role: "user", content: `Generate a concise, descriptive 3-7 word title summarizing this conversation.\n\nUser said: "${contextSnippet}"\nAssistant replied about: "${responseSnippet}"\n\nReply with ONLY the title text, no quotes, no punctuation at the end.` }
            ],
            max_completion_tokens: 30,
          });
          let newTitle = titleResp.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, "").replace(/\.+$/, "") || "";
          if (!newTitle || newTitle.toLowerCase() === "new chat") {
            newTitle = content.slice(0, 60).replace(/\n/g, " ").trim();
            if (newTitle.length > 50) newTitle = newTitle.slice(0, 50) + "...";
          }
          await storage.updateConversation(conversationId, { title: newTitle }, conv.tenantId ?? ADMIN_TENANT_ID);
          titleForLog = newTitle;
          res.write(`data: ${JSON.stringify({ titleUpdate: newTitle })}\n\n`);
          broadcastToConversation(conversationId, { type: "title_update", title: newTitle });
        } catch (titleErr) {
          console.error("Auto-title failed:", titleErr);
          const fallbackTitle = content.slice(0, 60).replace(/\n/g, " ").trim();
          if (fallbackTitle && conv.title === "New Chat") {
            const truncated = fallbackTitle.length > 50 ? fallbackTitle.slice(0, 50) + "..." : fallbackTitle;
            await storage.updateConversation(conversationId, { title: truncated }, conv.tenantId ?? ADMIN_TENANT_ID).catch(() => {});
            titleForLog = truncated;
            res.write(`data: ${JSON.stringify({ titleUpdate: truncated })}\n\n`);
          } else {
            await storage.updateConversation(conversationId, {}, conv.tenantId ?? ADMIN_TENANT_ID).catch(() => {});
          }
        }
      } else {
        await storage.updateConversation(conversationId, {}, conv.tenantId ?? ADMIN_TENANT_ID);
      }

      intelligentExtractMemory(fullResponse, content.trim(), persona?.id, conv.tenantId ?? ADMIN_TENANT_ID).catch(() => {});
      updateDailyLog(titleForLog, persona?.id).catch(() => {});

      captureToolChainMemory(
        conversationId, persona?.id, conv.tenantId ?? ADMIN_TENANT_ID,
        executedTools, content.trim(), fullResponse.length > 0
      ).catch(() => {});

      import("./auto-transcript").then(({ autoSaveProjectTranscript }) => {
        autoSaveProjectTranscript(conversationId, tenantId).catch(() => {});
      }).catch(() => {});

      import("./auto-asset-capture").then(({ captureProjectAssets }) => {
        captureProjectAssets(conversationId, tenantId, fullResponse).catch(() => {});
      }).catch(() => {});

      import("./project-brain").then(({ updateProjectBrain }) => {
        const pId = conv.projectId || conv.projectId;
        if (pId) {
          updateProjectBrain(pId, conversationId, content, fullResponse, persona?.name).catch(() => {});
        }
      }).catch(() => {});

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);

      if (suggestQuestions) {
        try {
          const sqSnippet = fullResponse.slice(0, 600).replace(/[^\x20-\x7E\n]/g, "");
          const sqUserSnippet = content.slice(0, 200).replace(/[^\x20-\x7E\n]/g, "");
          const sqResp = await replitOpenai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
              { role: "system", content: "Generate exactly 3 short follow-up questions the user might ask next based on this conversation. Each question should be concise (under 60 chars), actionable, and different from each other. Return ONLY a JSON array of 3 strings, no other text." },
              { role: "user", content: `User asked: "${sqUserSnippet}"\n\nAssistant replied: "${sqSnippet}"` }
            ],
            max_completion_tokens: 150,
          });
          const sqText = sqResp.choices[0]?.message?.content?.trim() || "";
          const sqMatch = sqText.match(/\[[\s\S]*\]/);
          if (sqMatch) {
            const suggestions = JSON.parse(sqMatch[0])
              .filter((s: any) => typeof s === "string" && s.trim().length > 0)
              .slice(0, 3)
              .map((s: string) => s.trim().replace(/[^\x20-\x7E?!.,'":\-()]/g, "").slice(0, 80));
            const unique = ([...new Set(suggestions)] as string[]).filter((s: string) => s.length > 5);
            if (unique.length > 0) {
              res.write(`data: ${JSON.stringify({ suggestedQuestions: unique })}\n\n`);
            }
          }
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      }

      try { clearInterval(globalKeepalive); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      try { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }

      emitHookEvent({
        type: "message", action: "sent", sessionKey: `conv:${conversationId}`,
        timestamp: new Date(), messages: [],
        context: {
          from: "assistant",
          content: fullResponse.slice(0, 500),
          conversationId,
          tenantId,
          toolCalls: executedTools.map(t => ({ name: t.name, success: !t.output?.error })),
        },
      }).catch(() => {});

      res.end();
    } catch (err: any) {
      try { clearInterval(globalKeepalive); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      const errMsg = err?.message || "Stream failed";
      const errStack = err?.stack?.slice(0, 500) || "";
      console.error(`[sse-fatal] Stream error (conv ${conversationId}): ${errMsg}`);
      console.error(`[sse-fatal] Stack: ${errStack}`);

      const errLower = errMsg.toLowerCase();
      const friendlyErr = (errLower.includes("timed out") || errLower.includes("etimedout") || errLower.includes("timeout"))
        ? "The operation timed out. This usually happens with complex multi-step tasks. Try breaking your request into smaller pieces."
        : (errLower.includes("rate limit") || errLower.includes("rate_limit") || errMsg.includes("429") || errLower.includes("too many requests"))
        ? "Hit an AI provider rate limit. Wait a moment and try again."
        : (errLower.includes("econnreset") || errLower.includes("socket") || errLower.includes("econnrefused") || errLower.includes("epipe"))
        ? "Connection was interrupted. Please try again."
        : (errLower.includes("context length") || errLower.includes("context window") || errLower.includes("maximum context") || errLower.includes("too many tokens"))
        ? "The conversation exceeded the model's context window. Retry the same question — the system will auto-escalate up the 1M→2M big-context chain on the next attempt."
        : (errLower.includes("capacity") || errLower.includes("overloaded") || errLower.includes("503") || errLower.includes("unavailable"))
        ? "The AI provider is temporarily overloaded. Try again in a moment."
        : `Something went wrong: ${errMsg.slice(0, 200)}`;

      if (!res.headersSent) {
        res.status(500).json({ error: friendlyErr });
      } else {
        try {
          res.write(`data: ${JSON.stringify({ error: friendlyErr, errorDetail: errMsg.slice(0, 300), type: "fatal_error" })}\n\n`);
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        res.end();
      }
    }

    } finally {
      // @ts-ignore — globalKeepalive is in scope at runtime (declared in handler body); TS scope analysis confused by deeply-nested try/catch chain above
      try { clearInterval(globalKeepalive); } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
      if (releaseQueue) releaseQueue();
    }
  });

  // ─── Shared admin gate ───────────────────────────────────
  // R65 follow-up: local wrapper delegates to requirePlatformAdmin so 14+ inline
  // admin routes still scattered through this file (export/backup/email/etc.)
  // can call `requireAdmin(req, res)` without redundant imports. Settings,
  // provider-keys, and models routes that originally lived here moved out in
  // R74.13t Stage 21 → server/routes/platform-config.ts (which calls
  // requirePlatformAdmin directly).
  const requireAdmin = (req: Request, res: Response): boolean => requirePlatformAdmin(req, res);

  // ─── CEO Orchestrator Status ─────────────────────────
  app.get("/api/orchestration/active", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { getAllActivePlans } = await import("./ceo-orchestrator");
      const plans = getAllActivePlans().filter(p => p.tenantId === tenantId);
      res.json(plans.map(p => ({
        id: p.id, objective: p.objective, status: p.status,
        stepsCompleted: p.steps.filter(s => s.status === "complete").length,
        totalSteps: p.steps.length,
        steps: p.steps.map(s => ({ taskId: s.taskId, description: s.description, persona: s.assignedPersona, status: s.status })),
      })));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── Tool Confirmation (HITL) ────────────────────────
  app.post("/api/tool-confirm/:id", async (req, res) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const { id } = req.params;
      const { approved } = req.body;
      if (typeof approved !== "boolean") return res.status(400).json({ error: "approved (boolean) is required" });
      const resolved = resolveToolConfirmation(id, approved, tenantId);
      if (!resolved) return res.status(404).json({ error: "Confirmation not found or already resolved" });
      res.json({ success: true, approved });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // R79.3d — Email-link approve/deny routes are registered earlier in
  // registerRoutes (right after /api/auth/login) so they're public, since
  // the email recipient won't have a session cookie when clicking.




  // ─── Auth Monitoring ──────────────────────────────────────
  app.get("/api/auth/health", authMiddleware, async (req, res) => {
    const force = req.query.refresh === "true";
    const health = await getProviderHealth(force);
    const exitCode = getAuthStatusCode(health);
    res.json({ providers: health, exitCode, exitLabel: exitCode === 0 ? "ok" : exitCode === 1 ? "expired" : "expiring_soon" });
  });

  app.get("/api/auth/health/check", authMiddleware, async (_req, res) => {
    const health = getCachedHealth();
    const exitCode = getAuthStatusCode(health);
    res.json({ exitCode, exitLabel: exitCode === 0 ? "ok" : exitCode === 1 ? "expired" : "expiring_soon" });
  });

  // ─── Hooks ────────────────────────────────────────────────
  // Admin-only — these affect global, process-level hook configuration that
  // operates on the admin tenant. Any non-admin tenant could otherwise
  // enable/disable hooks, read the log, or list registered hooks.
  app.get("/api/hooks/list", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json({ hooks: listHooks() });
  });

  app.post("/api/hooks/:name/enable", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const ok = enableHook((req.params.name as string));
    if (!ok) return res.status(404).json({ error: "Hook not found" });
    res.json({ ok: true });
  });

  app.post("/api/hooks/:name/disable", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const ok = disableHook((req.params.name as string));
    if (!ok) return res.status(404).json({ error: "Hook not found" });
    res.json({ ok: true });
  });

  app.get("/api/hooks/log", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    res.json({ log: getHookLog(limit) });
  });

  // ─── Tenant config-forking ─────────────────────────────────
  // Provision a NEW tenant pre-loaded with a SOURCE tenant's configuration
  // (voice, governance, tool policies, persona overrides, automation
  // schedules, …) but NEVER its data or memory. Owner/platform-admin only.
  app.post("/api/admin/tenants/fork", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { forkTenantSchema } = await import("./validation");
      const parsed = forkTenantSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
      }
      const { sourceTenantId, name, email, plan } = parsed.data;
      const { forkTenant } = await import("./tenant-fork");
      const result = await forkTenant(sourceTenantId, { name, email, plan });
      res.json(result);
    } catch (err: any) {
      // Body validation already returned 400 above; anything thrown here is an
      // internal/runtime failure (DB, transaction abort) — surface it as 500 so
      // it isn't miscategorised as client error in logs/alerting.
      console.error(`[tenant-fork] internal failure: ${err?.message || err}`);
      res.status(500).json({ error: err?.message || "fork failed" });
    }
  });

  // ─── Code Health (BS Detector) ─────────────────────────────
  app.get("/api/code-health/latest", authMiddleware, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { db } = await import("./db");
      const { sql: _sql } = await import("drizzle-orm");
      const scanRow: any = (await db.execute(_sql`
        SELECT * FROM code_health_scans ORDER BY created_at DESC LIMIT 1
      `)).rows?.[0];
      if (!scanRow) return res.json({ scan: null, findings: [] });
      const findingsRows: any[] = (await db.execute(_sql`
        SELECT severity, pattern, category, file_path, line_number, snippet
        FROM code_health_findings
        WHERE scan_id = ${scanRow.scan_id}
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                 file_path, line_number
        LIMIT 500
      `)).rows;
      res.json({ scan: scanRow, findings: findingsRows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/code-health/scan", authMiddleware, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { runCodeHealthScan } = await import("./code-health");
      const result = await runCodeHealthScan({ quiet: true });
      res.json({
        scanId: result.scanId,
        filesScanned: result.filesScanned,
        totalFindings: result.findings.length,
        durationMs: result.durationMs,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Pace Control snapshot ─────────────────────────────────
  app.get("/api/pace/snapshot", authMiddleware, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { getPaceSnapshot } = await import("./pace-control");
      res.json(await getPaceSnapshot());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── TTS Config ──────────────────────────────────────────
  app.get("/api/tts/config", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json(loadTTSConfig());
  });

  app.put("/api/tts/config", authMiddleware, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const updated = saveTTSConfig(req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ─── Firecrawl Config ──────────────────────────────────────
  app.get("/api/firecrawl/config", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const config = loadFirecrawlConfig();
    res.json({ ...config, apiKey: config.apiKey ? config.apiKey.slice(0, 8) + "..." : "" });
  });

  app.put("/api/firecrawl/config", authMiddleware, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { apiKey, baseUrl, onlyMainContent, maxAgeMs, timeoutSeconds, enabled } = req.body;
      const update: any = {};
      if (typeof apiKey === "string") update.apiKey = apiKey;
      if (typeof baseUrl === "string") update.baseUrl = baseUrl;
      if (typeof onlyMainContent === "boolean") update.onlyMainContent = onlyMainContent;
      if (typeof maxAgeMs === "number") update.maxAgeMs = maxAgeMs;
      if (typeof timeoutSeconds === "number") update.timeoutSeconds = timeoutSeconds;
      if (typeof enabled === "boolean") update.enabled = enabled;
      const updated = saveFirecrawlConfig(update);
      res.json({ ...updated, apiKey: updated.apiKey ? updated.apiKey.slice(0, 8) + "..." : "" });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/firecrawl/status", authMiddleware, async (_req, res) => {
    res.json({
      available: isFirecrawlAvailable(),
      cache: getFirecrawlCacheStats(),
    });
  });

  app.post("/api/firecrawl/cache/clear", authMiddleware, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    clearFirecrawlCache();
    res.json({ ok: true });
  });

  // ─── Web Search Config (Perplexity Sonar) ───────────────────
  app.get("/api/search/config", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const config = loadSearchConfig();
    res.json({ ...config, perplexity: { ...config.perplexity, apiKey: config.perplexity.apiKey ? config.perplexity.apiKey.slice(0, 8) + "..." : "" } });
  });

  app.put("/api/search/config", authMiddleware, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { provider, perplexity } = req.body;
      const update: any = {};
      if (provider === "perplexity" || provider === "legacy") update.provider = provider;
      if (perplexity && typeof perplexity === "object") {
        const p: any = {};
        if (typeof perplexity.apiKey === "string") p.apiKey = perplexity.apiKey;
        if (typeof perplexity.baseUrl === "string") p.baseUrl = perplexity.baseUrl;
        if (typeof perplexity.model === "string") p.model = perplexity.model;
        update.perplexity = p;
      }
      const updated = saveSearchConfig(update);
      res.json({ ...updated, perplexity: { ...updated.perplexity, apiKey: updated.perplexity.apiKey ? updated.perplexity.apiKey.slice(0, 8) + "..." : "" } });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/search/status", authMiddleware, async (_req, res) => {
    res.json(getSearchStatus());
  });

  // ─── Browser Tool ───────────────────────────────────────
  // R59 — extracted to ./routes/browser.ts (registered with other extracted modules).
  app.get("/api/subagents", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const parentId = req.query.conversationId ? parseInt(req.query.conversationId as string) : undefined;
    const runs = getSubagentRuns(parentId);
    res.json(runs.map(r => ({
      id: r.id,
      label: r.label,
      status: r.status,
      task: r.task.slice(0, 200),
      model: r.model,
      depth: r.depth,
      mode: r.mode,
      parentConversationId: r.parentConversationId,
      childConversationId: r.childConversationId,
      childSessionKey: r.childSessionKey,
      createdAt: new Date(r.createdAt).toISOString(),
      finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
    })));
  });

  app.get("/api/subagents/:id", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const info = getSubagentInfo((req.params.id as string));
    if (!info) return res.status(404).json({ error: "Run not found" });
    res.json(info);
  });

  app.post("/api/subagents/:id/kill", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const result = killSubagent((req.params.id as string));
    res.json(result);
  });

  // R98.17 — Cairo cross-pollination admin endpoints.
  // Hard kill switch: halt heartbeat-driven background work (auto-memorize,
  // auto-consolidation, scheduled CEO autonomous tick, scheduled jobs) within
  // ~60s (next heartbeat tick boundary). Enforcement point: server/heartbeat.ts
  // calls isBackgroundHalted() before each tick. Manual user-driven actions
  // (live /api/chat, manually invoked CEO orchestration from a chat tool,
  // explicit admin endpoints) are NOT affected — those are user intent and
  // should never be silently dropped. POSTing { halted: false } resumes.
  // R98.19+sec: setBackgroundHalted now THROWS if disk persistence fails
  // (in-memory state still applied), so admin sees 500 and knows to retry.
  app.post("/api/admin/halt-background", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { setBackgroundHalted } = await import("./lib/system-state");
      const halted = req.body?.halted !== false; // default true
      const reason = (req.body?.reason || "manual").toString().slice(0, 200);
      const state = setBackgroundHalted(halted, { reason, actor: `admin:${getTenantFromRequest(req) || "?"}` });
      res.json({ ok: true, state });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "halt failed" });
    }
  });

  app.post("/api/admin/resume-background", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { setBackgroundHalted } = await import("./lib/system-state");
      const state = setBackgroundHalted(false, { actor: `admin:${getTenantFromRequest(req) || "?"}` });
      res.json({ ok: true, state });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "resume failed" });
    }
  });

  app.get("/api/admin/system-state", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const [{ getSystemState }, { poolStats }] = await Promise.all([
        import("./lib/system-state"),
        import("./lib/concurrency-pool"),
      ]);
      res.json({ system: getSystemState(), concurrency: poolStats() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "state read failed" });
    }
  });

  app.get("/api/admin/risk-classes", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { listToolRiskClasses } = await import("./safety/destructive-tool-policy");
      res.json({ tools: listToolRiskClasses() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "risk-class list failed" });
    }
  });

  // R98.25 — MNEMA Nugget 6: ecosystem-health dashboard.
  // Returns the 4 health indicators (diversity, coverage, contradiction
  // density, freshness median) for the caller's tenant. Admin-gated because
  // it leaks structural counts about another tenant's memory ecosystem if a
  // bad actor could pivot the tenantId param — we always read the caller's
  // tenant from the auth session, never from a query param.
  app.get("/api/admin/ecosystem-health", authMiddleware, async (req: any, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(400).json({ error: "no tenant in session" });
      const { computeEcosystemHealth } = await import("./lib/ecosystem-health");
      const health = await computeEcosystemHealth(tenantId);
      if (!health) return res.status(500).json({ error: "compute failed" });
      res.json(health);
    } catch (e: any) {
      console.error("[ecosystem-health] compute failed:", e?.message || e);
      res.status(500).json({ error: "ecosystem-health compute failed" });
    }
  });

  // Recent decline events for the same dashboard panel. Tenant-scoped.
  app.get("/api/admin/decline-events", authMiddleware, async (req: any, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(400).json({ error: "no tenant in session" });
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const result = await db.execute(sql`
        SELECT id, persona_id, conversation_id, source, reason, detail, tool_name, flagged_categories, created_at
        FROM decline_events
        WHERE tenant_id = ${tenantId}
        ORDER BY id DESC
        LIMIT ${limit}
      `);
      const rows = (result as any).rows || result;
      res.json({ events: rows, count: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "decline-events read failed" });
    }
  });

  // ─── Self-Directed Initiatives (the "intention engine") — HITL review ─────
  // The platform's self-originated goal-formation loop persists initiatives it
  // proposes unprompted; the owner reviews + commits/dismisses them here.
  // GET  /api/admin/self-initiatives           — list (tenant-scoped, ?status=)
  // POST /api/admin/self-initiatives/:id/decide — { decision: "approve"|"dismiss" }
  app.get("/api/admin/self-initiatives", authMiddleware, async (req: any, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(400).json({ error: "no tenant in session" });
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
      const status = req.query.status ? String(req.query.status) : null;
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const result = status
        ? await db.execute(sql`
            SELECT id, title, rationale, category, evidence, confidence, risk, estimated_value, status, source_model, decided_at, decided_by, created_at
            FROM self_initiatives
            WHERE tenant_id = ${tenantId} AND status = ${status}
            ORDER BY id DESC LIMIT ${limit}`)
        : await db.execute(sql`
            SELECT id, title, rationale, category, evidence, confidence, risk, estimated_value, status, source_model, decided_at, decided_by, created_at
            FROM self_initiatives
            WHERE tenant_id = ${tenantId}
            ORDER BY id DESC LIMIT ${limit}`);
      const rows = (result as any).rows || result;
      res.json({ initiatives: rows, count: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "self-initiatives read failed" });
    }
  });

  app.post("/api/admin/self-initiatives/:id/decide", authMiddleware, validate(selfInitiativeDecideSchema), async (req: any, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(400).json({ error: "no tenant in session" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
      const decision = req.body.decision as "approve" | "dismiss";
      const newStatus = decision === "approve" ? "approved" : "dismissed";
      const decidedBy = req.user?.email || req.user?.username || "owner";
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      // Tenant-scoped UPDATE; RETURNING gates the response on a real owned row.
      const result = await db.execute(sql`
        UPDATE self_initiatives
        SET status = ${newStatus}, decided_at = now(), decided_by = ${decidedBy}
        WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'surfaced'
        RETURNING id, status`);
      const rows = (result as any).rows || result;
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: "initiative not found, not yours, or already decided" });
      }
      res.json({ ok: true, id, status: newStatus });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "self-initiative decide failed" });
    }
  });

  // ─── R113.5 — Self-hosted multi-platform scheduled-post API ──────────────
  // GET    /api/scheduled-posts          — list (tenant-scoped, optional ?status=)
  // POST   /api/scheduled-posts          — create (validated)
  // DELETE /api/scheduled-posts/:id      — cancel (pending only)
  app.get("/api/scheduled-posts", authMiddleware, async (req: any, res) => {
    try {
      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(400).json({ error: "no tenant in session" });
      const { listScheduledPosts } = await import("./lib/scheduled-post-runner");
      const status = req.query.status ? String(req.query.status) : undefined;
      const limit = req.query.limit ? Math.min(200, Math.max(1, parseInt(String(req.query.limit), 10) || 50)) : 50;
      const r = await listScheduledPosts({ tenantId, status, limit });
      if (!r.ok) return res.status(400).json({ error: r.error });
      res.json({ posts: r.posts });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "list failed" });
    }
  });

  app.post("/api/scheduled-posts", authMiddleware, validate(scheduledPostCreateSchema), async (req: any, res) => {
    try {
      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(400).json({ error: "no tenant in session" });
      const { scheduleCrossPlatformPost } = await import("./lib/scheduled-post-runner");
      const b = req.body;
      const r = await scheduleCrossPlatformPost({
        tenantId,
        platforms: Array.isArray(b.platforms) ? b.platforms.map((p: any) => String(p)) : [],
        content: String(b.content || ""),
        scheduledFor: String(b.scheduledFor || ""),
        imageUrl: b.imageUrl ? String(b.imageUrl) : undefined,
        videoUrl: b.videoUrl ? String(b.videoUrl) : undefined,
        campaign: b.campaign ? String(b.campaign) : undefined,
        createdBy: req.user?.email || req.user?.id || "user",
      });
      if (!r.ok) return res.status(400).json({ error: r.error });
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "schedule failed" });
    }
  });

  app.delete("/api/scheduled-posts/:id", authMiddleware, validate(emptyBodySchema), async (req: any, res) => {
    try {
      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) return res.status(400).json({ error: "no tenant in session" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
      const { cancelScheduledPost } = await import("./lib/scheduled-post-runner");
      const r = await cancelScheduledPost(id, tenantId);
      if (!r.ok) return res.status(400).json({ error: r.error });
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "cancel failed" });
    }
  });

  // R114 — AEvo Meta-Editing of Procedure Context. HITL-gated edit queue
  // for output-skill playbooks. Read routes are tenant-scoped; mutating
  // routes (PATCH review, POST apply, POST rollback) require authMiddleware
  // PLUS the procedure_edits.tenantId check inside the router itself.
  const { procedureEditsRouter } = await import("./routes/procedure-edits");
  app.use("/api/procedure-edits", authMiddleware, procedureEditsRouter);

  // R115 — External Review Council. Tenant-auth only; no admin gate (Council
  // writes only to its own table; procedure-edit read is already tenant-scoped).
  const { councilVerdictsRouter } = await import("./routes/council-verdicts");
  app.use("/api/council-verdicts", authMiddleware, councilVerdictsRouter);

  // Venture Discovery Loop — owner-only, dry-run-default, hard-capped, HITL 9-stage
  // business-discovery loop. Owner gate enforced inside the router (session tenant
  // must equal ownerTenantId()); authMiddleware ensures a resolved session first.
  const { ventureDiscoveryRouter } = await import("./routes/venture-discovery");
  app.use("/api/venture-discovery", authMiddleware, ventureDiscoveryRouter);

  // Built With Bob weight tracker — owner-only GET/POST backing the project-16
  // weight card. Decoupled from the build: logging a weigh-in writes the same
  // agent_settings row the recap reads, with NO video build triggered.
  const { bwbWeightRouter } = await import("./routes/bwb-weight");
  app.use("/api/bwb/weight", authMiddleware, bwbWeightRouter);

  app.post("/api/subagents/kill-all", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const parentId = req.body.conversationId ? parseInt(req.body.conversationId) : undefined;
    const result = killAllSubagents(parentId);
    res.json(result);
  });

  app.post("/api/subagents/spawn", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { parentConversationId, task, label, agentId, model, thinkingLevel, runTimeoutSeconds, mode } = req.body;
      if (!parentConversationId || !task) {
        return res.status(400).json({ error: "parentConversationId and task required" });
      }
      const result = await spawnSubagent({ parentConversationId, task, label, agentId, model, thinkingLevel, runTimeoutSeconds, mode });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Exec Tool Config ────────────────────────────────────
  app.get("/api/exec/config", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json(loadExecConfig());
  });

  app.put("/api/exec/config", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { enabled, securityMode, timeoutSeconds, maxOutputBytes, allowlist, denyPatterns, workdir } = req.body;
      const update: any = {};
      if (typeof enabled === "boolean") update.enabled = enabled;
      if (typeof securityMode === "string" && ["deny", "allowlist", "full"].includes(securityMode)) update.securityMode = securityMode;
      if (typeof timeoutSeconds === "number") update.timeoutSeconds = Math.min(Math.max(timeoutSeconds, 5), 300);
      if (typeof maxOutputBytes === "number") update.maxOutputBytes = Math.min(Math.max(maxOutputBytes, 1024), 1048576);
      if (Array.isArray(allowlist)) update.allowlist = allowlist.filter((s: any) => typeof s === "string");
      if (Array.isArray(denyPatterns)) update.denyPatterns = denyPatterns.filter((s: any) => typeof s === "string");
      if (typeof workdir === "string") update.workdir = workdir;
      const updated = saveExecConfig(update);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/exec/status", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json(getExecStatus());
  });

  // ─── Tool Loop Detection Config ─────────────────────────
  app.get("/api/loop-detection/config", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json(loadLoopDetectionConfig());
  });

  app.put("/api/loop-detection/config", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    try {
      const { enabled, historySize, warningThreshold, criticalThreshold, globalCircuitBreakerThreshold, detectors } = req.body;
      const update: any = {};
      if (typeof enabled === "boolean") update.enabled = enabled;
      if (typeof historySize === "number") update.historySize = Math.min(Math.max(historySize, 5), 100);
      if (typeof warningThreshold === "number") update.warningThreshold = Math.max(warningThreshold, 2);
      if (typeof criticalThreshold === "number") update.criticalThreshold = Math.max(criticalThreshold, 3);
      if (typeof globalCircuitBreakerThreshold === "number") update.globalCircuitBreakerThreshold = Math.max(globalCircuitBreakerThreshold, 5);
      if (detectors && typeof detectors === "object") update.detectors = detectors;
      const updated = saveLoopDetectionConfig(update);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ─── Webhooks Config ─────────────────────────────────────
  // Admin-only — webhook config is process-global. Any non-admin tenant
  // could otherwise rotate the global token and effectively own external
  // webhook delivery for the whole installation.
  app.get("/api/webhooks/config", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    res.json(getWebhookStatus());
  });

  app.put("/api/webhooks/config", authMiddleware, async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const { enabled, token } = req.body;
    const currentStatus = getWebhookStatus();
    const effectiveToken = (token && token !== "keep-existing") ? token : undefined;

    if (enabled && !currentStatus.hasToken && (!effectiveToken || effectiveToken.length < 8)) {
      return res.status(400).json({ error: "Token must be at least 8 characters when webhooks are enabled" });
    }

    const update: any = { enabled: !!enabled };
    if (effectiveToken) update.token = effectiveToken;
    configureWebhooks(update);
    res.json(getWebhookStatus());
  });

  registerWebhookRoutes(app);

  // Twilio inbound (SMS + WhatsApp) — funnels into the same chat engine as Telegram
  try {
    const { registerTwilioRoutes } = await import("./twilio");
    registerTwilioRoutes(app);
  } catch (e: any) {
    console.warn("[routes] Twilio route registration skipped:", e.message);
  }

  // ─── Projects ────────────────────────────────────────────────
  // Round 60: Projects routes extracted to server/routes/projects.ts
  // (~337 LOC removed from this file). Pure move — no behavior changes.
  registerProjectsRoutes(app, { getTenantFromRequest, authMiddleware, upload, SAFE_EXTENSIONS, UPLOADS_DIR });

  // ─── Skills ────────────────────────────────────────────────
  // R54.A: gated — skill prompts contain system-prompt content; not for unauthenticated readers
  app.get("/api/skills", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    res.json(await storage.getSkills());
  });

  app.patch("/api/skills/:id", async (req, res) => {
    if (!requirePlatformAdmin(req, res)) return;
    const body = { ...req.body };
    if (body.personaId === null) {
      const { personaId: _, ...rest } = body;
      const parsed = insertSkillSchema.partial().safeParse(rest);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const skill = await storage.updateSkill(parseInt(req.params.id as string), { ...parsed.data, personaId: null });
      if (!skill) return res.status(404).json({ error: "Skill not found" });
      return res.json(skill);
    }
    const parsed = insertSkillSchema.partial().safeParse(body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const skill = await storage.updateSkill(parseInt(req.params.id as string), parsed.data);
    if (!skill) return res.status(404).json({ error: "Skill not found" });
    res.json(skill);
    if (body.enabled !== undefined) {
      import("./persona-sync").then(m => m.syncPersonaDocs()).catch(e => console.error("[persona-sync] Auto-sync after skill toggle failed:", e.message));
    }
  });

  // ─── Persona Sync ────────────────────────────────────────
  // Round 60.B: Personas + persona-sync routes extracted to server/routes/personas.ts
  // (~186 LOC removed). Pure move — no behavior changes. 13 handlers.
  registerPersonasRoutes(app, { getTenantFromRequest, authMiddleware, requirePlatformAdmin });
  registerPersonaCostRoutes(app, { authMiddleware, requirePlatformAdmin });
  registerSlackRoutes(app, { ADMIN_TENANT_ID });
  registerClaudeImportRoutes(app, { requirePlatformAdmin, getTenantFromRequest });

  // ─── Heartbeat ───────────────────────────────────────────
  // Round 60+ Stage 4: Heartbeat routes extracted to server/routes/heartbeat.ts
  // (~165 LOC removed). Pure move — no behavior changes. 13 handlers.
  registerHeartbeatRoutes(app, { getTenantFromRequest, requireAdmin, requirePlatformAdmin });

  // ─── R98.21 Hyperagent-cross-pollination ────────────────
  // Public landing recipe gallery + admin proposed-skills queue + admin A/B runs.
  try {
    const { registerHyperagentRoutes } = await import("./routes/hyperagent-features");
    registerHyperagentRoutes(app, {
      requireAdmin,
      // R98.22+sec — strict resolver; null triggers 401 inside the route
      // (was previously `?? 1` which silently fell back to admin tenant).
      getTenant: (req) => getTenantFromRequest(req) ?? null,
    });
  } catch (e: any) {
    console.warn("[startup] Hyperagent routes not mounted:", e.message?.slice(0, 120));
  }

  // ─── Memory ──────────────────────────────────────────────
  // Round 60+ Stage 5: 16 of 18 memory routes extracted to server/routes/memory.ts
  // (~310 LOC removed). Pure move — no behavior changes. The 2 multer-heavy
  // upload routes are intentionally deferred to Stage 5b (file-storage bundle).
  registerMemoryRoutes(app, { getTenantFromRequest, isAdminRequest, ADMIN_TENANT_ID, requirePlatformAdmin });

  // ─── Research Engine ─────────────────────────────────────
  // Round 60+ Stage 6: All 16 research routes extracted to server/routes/research.ts
  // (~430 LOC removed). Pure move — no behavior changes. Routes were scattered
  // through the monolith with treasury/admin/register-call interlopers; those
  // were left in place.
  registerResearchRoutes(app, { getTenantFromRequest, requirePlatformAdmin });

  // ─── Situation Room ──────────────────────────────────────
  app.get("/api/situation-room", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const { getSituationSnapshot } = await import("./situation-room");
      const forceRefresh = req.query.refresh === "true";
      const snapshot = await getSituationSnapshot(tenantId, forceRefresh);
      res.json(snapshot);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/situation-room/briefing", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const { getSituationSnapshot, getSituationBriefing } = await import("./situation-room");
      const snapshot = await getSituationSnapshot(tenantId);
      res.json({ briefing: getSituationBriefing(snapshot), systemStatus: snapshot.systemStatus, alerts: snapshot.alerts });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─── Auto-Consolidation ──────────────────────────────────
  app.get("/api/consolidation/status", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const { getConsolidationState } = await import("./auto-consolidation");
      res.json(getConsolidationState(tenantId));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/consolidation/trigger", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const { triggerManualConsolidation } = await import("./auto-consolidation");
      const result = await triggerManualConsolidation(tenantId);
      if (!result) return res.json({ status: "already_running" });
      res.json({ status: "completed", ...result });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─── Sentiment Analytics ───────────────────────────────────
  app.get("/api/sentiment/recent", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const rows = await db.execute(sql`
        SELECT * FROM sentiment_events WHERE tenant_id = ${tenantId}
        ORDER BY created_at DESC LIMIT ${limit}
      `);
      res.json((rows as any)?.rows || rows || []);
    } catch (err) {
      res.json([]);
    }
  });

  // ─── Daily Notes ──────────────────────────────────────────
  app.get("/api/daily-notes", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const personaId = req.query.personaId ? parseInt(req.query.personaId as string) : undefined;
    res.json(await storage.getDailyNotes(personaId, tenantId));
  });

  app.get("/api/daily-notes/:date", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const personaId = req.query.personaId ? parseInt(req.query.personaId as string) : undefined;
    const note = await storage.getDailyNote((req.params.date as string), personaId, tenantId);
    res.json(note || { date: (req.params.date as string), content: "", personaId: null });
  });

  app.put("/api/daily-notes/:date", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const parsed = insertDailyNoteSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const note = await storage.upsertDailyNote({ date: (req.params.date as string), content: parsed.data.content || "", personaId: parsed.data.personaId || null, tenantId });
    res.json(note);
  });

  // ─── Knowledge Base ─────────────────────────────────────────
  app.get("/api/knowledge", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const personaId = req.query.personaId ? parseInt(req.query.personaId as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    res.json(await storage.getKnowledge(personaId, limit, offset, tenantId));
  });

  app.post("/api/knowledge", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const parsed = insertKnowledgeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const entry = await storage.createKnowledge({ ...parsed.data, tenantId });
    // R74.13k — converted to dynamic import to match the 4 other embedding
    // callsites in this file (the static import was removed as dead).
    import("./embeddings").then(({ generateEmbedding }) =>
      generateEmbedding(`${entry.title} ${entry.content}`).then((emb: number[] | null) => {
        if (emb) storage.updateKnowledgeEmbedding(entry.id, emb).catch(() => {});
      }).catch(() => {})
    ).catch(() => {});
    res.json(entry);
  });

  // R54.B: replace list-then-search IDOR with direct scoped lookup
  app.patch("/api/knowledge/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const partial = insertKnowledgeSchema.partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json({ error: partial.error.message });
    const knId = parseInt(req.params.id as string);
    if (tenantId !== ADMIN_TENANT_ID) {
      const { db } = await import("./db");
      const { agentKnowledge } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [owned] = await db.select({ id: agentKnowledge.id }).from(agentKnowledge)
        .where(and(eq(agentKnowledge.id, knId), eq(agentKnowledge.tenantId, tenantId)));
      if (!owned) return res.status(403).json({ error: "Access denied" });
    }
    // R74.13d C3: storage now requires tenantId — defense-in-depth on top of
    // the ownership check above. Admin still scopes to ADMIN_TENANT_ID for now.
    const entry = await storage.updateKnowledge(knId, partial.data, tenantId);
    if (!entry) return res.status(404).json({ error: "Not found" });
    res.json(entry);
  });

  app.delete("/api/knowledge/:id", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const knId = parseInt(req.params.id as string);
    if (tenantId !== ADMIN_TENANT_ID) {
      const { db } = await import("./db");
      const { agentKnowledge } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [owned] = await db.select({ id: agentKnowledge.id }).from(agentKnowledge)
        .where(and(eq(agentKnowledge.id, knId), eq(agentKnowledge.tenantId, tenantId)));
      if (!owned) return res.status(403).json({ error: "Access denied" });
    }
    // R74.13d C3: tenant-scoped delete at storage layer.
    await storage.deleteKnowledge(knId, tenantId);
    res.json({ ok: true });
  });

  app.get("/api/experiments", async (req, res) => {
    // R60 — admin-only: global experiment history leaks cross-tenant
    // telemetry and is not user-facing data.
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    const { getExperimentHistory } = await import("./self-improvement");
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const category = req.query.category as string | undefined;
    const exps = await getExperimentHistory(limit, category);
    res.json({ experiments: exps, count: exps.length });
  });

  app.post("/api/experiments/run", async (req, res) => {
    // R60 — admin-only: runs expensive self-improvement cycle.
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    const { runSelfImprovementCycle } = await import("./self-improvement");
    const validCategories = ["prompt_optimization", "response_quality", "tool_usage", "persona_tuning"];
    const category = validCategories.includes(req.body.category) ? req.body.category : "response_quality";
    const personaId = req.body.personaId ? parseInt(req.body.personaId) : undefined;
    if (personaId !== undefined && isNaN(personaId)) {
      return res.status(400).json({ error: "Invalid personaId" });
    }
    const results = await runSelfImprovementCycle({ category, personaId, tenantId: ADMIN_TENANT_ID });
    res.json({
      experimentsRun: results.length,
      kept: results.filter(r => r.status === "kept").length,
      reverted: results.filter(r => r.status === "reverted").length,
      results,
    });
  });

  // R74.13u Stage 29 — credentials (4 routes for the per-tenant Credential
  // Vault) extracted to server/routes/credentials.ts. Local `requireTenant`
  // helper kept verbatim; uses `(req as any).tenantId` not `getTenantFromRequest`.

  // R74.13u Stage 27 — briefings (9 routes) extracted to server/routes/briefings.ts.
  // Includes orphan GET /api/briefing (which has its OWN requirePlatformAdmin
  // gate — R66 follow-up), the briefing widgets CRUD, /api/briefing/generate
  // (AI-powered), /api/briefing/latest, /api/reports/corporation (PDF), and
  // /api/activity/pulse (also requirePlatformAdmin per R66). Heavy raw-SQL via
  // db.execute(sql`…`) for briefing_widgets + briefing_reports tables.

  // ─── Search ────────────────────────────────────────────────
  app.get("/api/search", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    const q = (req.query.q as string || "").trim();
    if (!q) return res.json([]);
    const results = await storage.searchConversations(q, tenantId);
    res.json(results);
  });

  // ─── Cloud Backup ──────────────────────────────────────
  app.post("/api/backup/cloud", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { runBackupToGoogleDrive } = await import("./backup");
      const summary = await runBackupToGoogleDrive();
      res.json({ success: true, summary });
    } catch (err: any) {
      console.error("[backup] Manual backup failed:", err.message);
      res.status(500).json({ error: "Backup failed: " + err.message });
    }
  });

  app.post("/api/backup/full", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const results: Record<string, any> = {};
    try {
      const { runBackupToGoogleDrive, runMemoryBackupToGoogleDrive } = await import("./backup");
      try {
        results.cloudBackup = await runBackupToGoogleDrive();
      } catch (err: any) { results.cloudBackup = { error: err.message }; }
      try {
        results.memoryBackup = await runMemoryBackupToGoogleDrive();
      } catch (err: any) { results.memoryBackup = { error: err.message }; }
      try {
        const { execSync } = await import("child_process");
        const fs = await import("fs");
        if (fs.existsSync("/tmp/push-gh.sh")) {
          // R125+13.21+sec — scrub loader-hijack env before the child spawn
          // (parity with the credential-helper branch below + heartbeat).
          const { sanitizeSpawnEnv } = await import("./safety/spawn-env-guard");
          execSync("bash /tmp/push-gh.sh 'Auto-backup commit'", { cwd: process.cwd(), timeout: 60000, stdio: "pipe", env: sanitizeSpawnEnv(process.env) });
          results.githubPush = "Pushed to GitHub (with secret scan)";
        } else if (process.env.GITHUB_TOKEN) {
          // R74.13c — H3 fix. Previously embedded GITHUB_TOKEN directly into the
          // git URL, which leaks via:
          //   - process listing (visible to other processes/operators)
          //   - error messages (returned to API caller via results.githubPush)
          //   - shell history / logs
          // Now uses git's credential.helper machinery to feed the token via
          // env var only. Token NEVER appears on the command line or in error
          // messages, and we sanitize errors as a defense in depth.
          const agentName = process.env.SITE_AGENT_NAME || "Platform Agent";
          const gitEmail = process.env.GIT_COMMIT_EMAIL || "agent@platform.local";
          const ghRepo = process.env.GITHUB_REPO;
          if (!ghRepo) throw new Error("GITHUB_REPO env var not set");
          // R125+13.19+sec1 — strip loader-hijack env before adding GIT_* vars.
          const { sanitizeSpawnEnv } = await import("./safety/spawn-env-guard");
          const gitEnv = {
            ...sanitizeSpawnEnv(process.env),
            GIT_AUTHOR_NAME: agentName,
            GIT_AUTHOR_EMAIL: gitEmail,
            GIT_COMMITTER_NAME: agentName,
            GIT_COMMITTER_EMAIL: gitEmail,
            GIT_TERMINAL_PROMPT: "0",
          };
          execSync("git add -A && git diff --cached --quiet || git commit -m 'Auto-backup commit'", { cwd: process.cwd(), timeout: 15000, stdio: "pipe", env: gitEnv }).toString();
          // Credential helper reads username/password from stdin via the env
          // var GITHUB_TOKEN — no inline interpolation, no token in argv.
          const credHelper = `!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f`;
          execSync(
            `git -c credential.helper='${credHelper}' push https://github.com/${ghRepo}.git main`,
            { cwd: process.cwd(), timeout: 30000, stdio: "pipe", env: gitEnv }
          );
          results.githubPush = "Pushed to GitHub (no secret scan — /tmp/push-gh.sh missing)";
        } else {
          results.githubPush = "Skipped — GITHUB_TOKEN not set";
        }
      } catch (err: any) {
        // R74.13c — H3 fix. Strip any token-shaped substrings before returning
        // to the API caller. Belt-and-suspenders even though the new push path
        // shouldn't include the token in error output.
        const sanitized = String(err?.message || err).replace(/https:\/\/[^@\s]+@github\.com/gi, "https://[REDACTED]@github.com");
        results.githubPush = { error: sanitized };
      }
      res.json({ success: true, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message, partialResults: results });
    }
  });

  app.get("/api/backup/status", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const allTasks = await storage.getHeartbeatTasks();
      const backupTasks = allTasks.filter((t: any) => t.type === "cloud_backup" || t.type === "memory_backup");
      const allLogs = await storage.getHeartbeatLogs(20);
      const recentBackupLogs = allLogs.filter((l: any) =>
        l.taskName === "Daily Cloud Backup" || l.taskName === "Memory Snapshot Backup"
      );
      const exportData = await storage.getAllDataForExport();
      res.json({
        scheduledTasks: backupTasks.map((t: any) => ({
          name: t.name, type: t.type, enabled: t.enabled,
          cronExpression: t.cronExpression, nextRunAt: t.nextRunAt, lastRunAt: t.lastRunAt,
        })),
        recentBackupLogs: recentBackupLogs.map((l: any) => ({
          taskName: l.taskName, status: l.status, output: l.output?.slice(0, 200),
          createdAt: l.createdAt, durationMs: l.durationMs,
        })),
        dataSnapshot: exportData.tableCounts,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Export / Import ──────────────────────────────────────
  app.get("/api/export", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const data = await storage.getAllDataForExport();
      res.setHeader("Content-Disposition", `attachment; filename="visionclaw-export-${new Date().toISOString().split("T")[0]}.json"`);
      res.setHeader("Content-Type", "application/json");
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/import", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const data = req.body;
      if (!data || !data.version) {
        return res.status(400).json({ error: "Invalid export file format" });
      }
      let imported = { conversations: 0, messages: 0, personas: 0, memories: 0, knowledge: 0, tasks: 0 };

      if (data.personas?.length) {
        for (const p of data.personas) {
          try {
            const { id, isActive, createdAt, ...rest } = p;
            await storage.createPersona(rest);
            imported.personas++;
          } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        }
      }

      if (data.memoryEntries?.length) {
        for (const m of data.memoryEntries) {
          try {
            const { id, createdAt, ...rest } = m;
            await storage.createMemoryEntry({ ...rest, personaId: rest.personaId || null });
            imported.memories++;
          } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        }
      }

      if (data.knowledge?.length) {
        for (const k of data.knowledge) {
          try {
            const { id, createdAt, updatedAt, ...rest } = k;
            await storage.createKnowledge({ ...rest, personaId: rest.personaId || null });
            imported.knowledge++;
          } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        }
      }

      if (data.conversations?.length) {
        for (const conv of data.conversations) {
          try {
            const { id: oldId, createdAt, updatedAt, ...rest } = conv;
            const newConv = await storage.createConversation(rest);
            imported.conversations++;
            const convMessages = (data.messages || []).filter((m: any) => m.conversationId === oldId);
            for (const msg of convMessages) {
              try {
                const { id, createdAt, ...msgRest } = msg;
                await storage.createMessage({ ...msgRest, conversationId: newConv.id });
                imported.messages++;
              } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
            }
          } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        }
      }

      if (data.heartbeatTasks?.length) {
        for (const t of data.heartbeatTasks) {
          try {
            const { id, createdAt, lastRunAt, nextRunAt, ...rest } = t;
            await storage.createHeartbeatTask(rest);
            imported.tasks++;
          } catch (_silentErr) { logSilentCatch("server/routes.ts", _silentErr); }
        }
      }

      res.json({ success: true, imported });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Email (AgentMail) — tenant-scoped ─────────────────────
  app.get("/api/email/status", async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!isEmailConfigured()) {
        return res.json({ configured: false, inbox: null });
      }
      const tenantData = await storage.getTenant(tenantId);
      res.json({
        configured: true,
        inbox: tenantData?.agentmailEmail || null,
        inboxId: tenantData?.agentmailInboxId || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/email/inbox/provision", async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!isEmailConfigured()) {
        return res.status(503).json({ error: "Email service not configured" });
      }
      const result = await getOrCreateTenantInbox(tenantId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/email/messages", async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!isEmailConfigured()) return res.json({ messages: [] });
      const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
      const offset = parseInt(req.query.offset as string) || 0;
      const result = await db.execute(
        sql`SELECT id, message_id, from_address as from, to_address as to, subject,
            SUBSTRING(body_text, 1, 200) as preview, received_at as date, is_read, is_starred
            FROM inbox_messages WHERE tenant_id = ${tenantId}
            ORDER BY received_at DESC LIMIT ${limit} OFFSET ${offset}`
      );
      const messages = ((result as any).rows || result) || [];
      res.json({ messages });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/email/messages/:messageId", async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!isEmailConfigured()) return res.status(503).json({ error: "Email not configured" });
      const msgId = parseInt(req.params.messageId as string);
      const result = await db.execute(
        sql`SELECT * FROM inbox_messages WHERE id = ${msgId} AND tenant_id = ${tenantId}`
      );
      const msg = ((result as any).rows || result)?.[0];
      if (!msg) return res.status(404).json({ error: "Message not found" });
      res.json(msg);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/email/send", async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!isEmailConfigured()) return res.status(503).json({ error: "Email not configured" });
      const { inboxId } = await getOrCreateTenantInbox(tenantId);
      const { to, subject, text, html, cc, bcc } = req.body;
      if (!to || !subject || !text) {
        return res.status(400).json({ error: "to, subject, and text are required" });
      }
      const result = await sendEmail({ inboxId, to, subject, text, html, cc, bcc });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/email/reply", async (req, res) => {
    try {
      const tenantId = await getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!isEmailConfigured()) return res.status(503).json({ error: "Email not configured" });
      const { inboxId } = await getOrCreateTenantInbox(tenantId);
      const { messageId, text, html } = req.body;
      if (!messageId || !text) {
        return res.status(400).json({ error: "messageId and text are required" });
      }
      const result = await replyToEmail({ inboxId, messageId, text, html });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/email/inboxes", requireAdmin, async (_req, res) => {
    try {
      if (!isEmailConfigured()) return res.json([]);
      const inboxes = await listInboxes();
      res.json(inboxes);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Account Deletion (30-day grace period) ────────────────
  app.get("/api/account/deletion-summary", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });

      const { db: database } = await import("./db");
      const { sql: s } = await import("drizzle-orm");

      const [convResult] = (await database.execute(s`SELECT count(*)::int as count FROM conversations WHERE tenant_id = ${tenantId}`)).rows as any[];
      const [msgResult] = (await database.execute(s`SELECT count(*)::int as count FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE tenant_id = ${tenantId})`)).rows as any[];
      const [memResult] = (await database.execute(s`SELECT count(*)::int as count FROM memory_entries WHERE tenant_id = ${tenantId}`)).rows as any[];
      const [fileResult] = (await database.execute(s`SELECT count(*)::int as count, COALESCE(sum(size), 0)::bigint as total_size FROM file_storage WHERE tenant_id = ${tenantId}`)).rows as any[];
      const [knowledgeResult] = (await database.execute(s`SELECT count(*)::int as count FROM agent_knowledge WHERE tenant_id = ${tenantId}`)).rows as any[];
      const [toolResult] = (await database.execute(s`SELECT count(*)::int as count FROM custom_tools WHERE tenant_id = ${tenantId}`)).rows as any[];
      const [keyResult] = (await database.execute(s`SELECT count(*)::int as count FROM provider_keys WHERE tenant_id = ${tenantId}`)).rows as any[];
      const [tenantRow] = (await database.execute(s`SELECT account_status, deletion_scheduled_at FROM tenants WHERE id = ${tenantId}`)).rows as any[];

      res.json({
        conversations: convResult?.count || 0,
        messages: msgResult?.count || 0,
        memories: memResult?.count || 0,
        files: fileResult?.count || 0,
        fileStorageBytes: parseInt(fileResult?.total_size || "0"),
        knowledgeEntries: knowledgeResult?.count || 0,
        customTools: toolResult?.count || 0,
        apiKeys: keyResult?.count || 0,
        accountStatus: tenantRow?.account_status || "active",
        deletionScheduledAt: tenantRow?.deletion_scheduled_at || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/account/schedule-deletion", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (tenantId === 1) return res.status(403).json({ error: "Admin account cannot be deleted" });

      const { db: database } = await import("./db");
      const { sql: s } = await import("drizzle-orm");

      const deletionDate = new Date();
      deletionDate.setDate(deletionDate.getDate() + 30);

      await database.execute(s`UPDATE tenants SET account_status = 'pending_deletion', deletion_scheduled_at = ${deletionDate.toISOString()}::timestamp WHERE id = ${tenantId}`);

      const tenant = await storage.getTenant(tenantId);
      if (tenant?.email) {
        const { sendAccountDeletionScheduledEmail } = await import("./email-notifications");
        await sendAccountDeletionScheduledEmail(tenant.email, tenant.name, deletionDate);
      }

      console.log(`[account] Tenant ${tenantId} scheduled for deletion on ${deletionDate.toISOString()}`);
      res.json({
        success: true,
        deletionScheduledAt: deletionDate.toISOString(),
        message: `Account scheduled for permanent deletion on ${deletionDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. You have 30 days to download your data or cancel.`,
      });
    } catch (err: any) {
      console.error("[account] Schedule deletion error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/account/cancel-deletion", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });

      const { db: database } = await import("./db");
      const { sql: s } = await import("drizzle-orm");

      await database.execute(s`UPDATE tenants SET account_status = 'active', deletion_scheduled_at = NULL WHERE id = ${tenantId}`);

      console.log(`[account] Tenant ${tenantId} cancelled account deletion`);
      res.json({ success: true, message: "Account deletion cancelled. Your account is active again." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/account", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (tenantId === 1) return res.status(403).json({ error: "Admin account cannot be deleted" });

      const { db: database } = await import("./db");
      const { sql: s } = await import("drizzle-orm");

      const [tenant] = (await database.execute(s`SELECT account_status, deletion_scheduled_at FROM tenants WHERE id = ${tenantId}`)).rows as any[];
      if (tenant?.account_status !== "pending_deletion") {
        return res.status(400).json({ error: "Account must be scheduled for deletion first. Use the 30-day grace period process." });
      }

      const scheduledDate = new Date(tenant.deletion_scheduled_at);
      const now = new Date();
      if (now < scheduledDate) {
        const daysRemaining = Math.ceil((scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return res.status(400).json({ error: `Deletion grace period has not expired. ${daysRemaining} days remaining. Data will be permanently deleted on ${scheduledDate.toLocaleDateString()}.` });
      }

      await database.execute(s`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE tenant_id = ${tenantId})`);
      await database.execute(s`DELETE FROM conversations WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM memory_entries WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM daily_notes WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM agent_knowledge WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM custom_tools WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM experiments WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM file_storage WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM tenant_persona_names WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM heartbeat_tasks WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM tenant_provider_keys WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM auth_sessions WHERE tenant_id = ${tenantId}`);
      await database.execute(s`DELETE FROM tenants WHERE id = ${tenantId}`);

      console.log(`[account] Tenant ${tenantId} permanently deleted after grace period`);
      res.json({ success: true, message: "Account and all associated data have been permanently deleted." });
    } catch (err: any) {
      console.error("[account] Deletion error:", err.message);
      res.status(500).json({ error: "Failed to delete account: " + err.message });
    }
  });

  // ─── Agent Activity Board ───────────────────────────────────
  // Per-tenant rate limiter: live endpoint polled every 2s, others ~10s.
  // 60 req/min covers normal polling with headroom; blocks runaway clients.
  const agentActivityLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request, res) => {
      const tenantId = getTenantFromRequest(req as any);
      return tenantId ? `tenant:${tenantId}` : (ipKeyGenerator as any)(req.ip || "", res as any);
    },
    message: { error: "Too many activity requests, please slow polling" },
  });

  app.get("/api/agent-activity", authMiddleware, agentActivityLimiter, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { getRecentActivity } = await import("./agent-activity");
      const rawLimit = parseInt(req.query.limit as string);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 200)
        : 50;
      const activity = await getRecentActivity(tenantId, limit);
      res.json(activity);
    } catch (err: any) {
      console.error("[agent-activity] recent failed:", err);
      res.status(500).json({ error: "Failed to load activity" });
    }
  });

  app.get("/api/agent-activity/live", authMiddleware, agentActivityLimiter, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { getLiveAgentStatuses } = await import("./agent-activity");
      res.json(getLiveAgentStatuses(tenantId));
    } catch (err: any) {
      console.error("[agent-activity] live failed:", err);
      res.status(500).json({ error: "Failed to load live status" });
    }
  });

  app.get("/api/agent-activity/summary", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { getActivitySummary } = await import("./agent-activity");
      res.json(await getActivitySummary(tenantId));
    } catch (err: any) {
      console.error("[agent-activity] summary failed:", err);
      res.status(500).json({ error: "Failed to load summary" });
    }
  });

  app.get("/api/agent-activity/skills", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { getLearnedSkillsActivity } = await import("./agent-activity");
      res.json(await getLearnedSkillsActivity(tenantId));
    } catch (err: any) {
      console.error("[agent-activity] skills failed:", err);
      res.status(500).json({ error: "Failed to load skills activity" });
    }
  });

  // R74.13z-quint: surface the LeWorldModel surprise-band stats including the
  // 'error' band so embedding outages stay visible (don't hide as no_history).
  app.get("/api/agent/surprise-stats", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const { getSurpriseStats } = await import("./surprise-scorer");
      res.json(await getSurpriseStats(tenantId));
    } catch (err: any) {
      console.error("[agent] surprise-stats failed:", err);
      res.status(500).json({ error: "Failed to load surprise stats" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // R74.13z-quint+2 — Tensions + ADRs + Graph Explorer (DreamGraph nuggets)
  // Tenant-scoped on every read/write. Refuses to default to owner tenant —
  // would leak cross-tenant context. Validation via Zod insert schemas.
  // ─────────────────────────────────────────────────────────────────────────
  const { insertTensionSchema, insertArchitectureDecisionSchema } = await import("@shared/schema");

  app.post("/api/tensions", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const parsed = insertTensionSchema.safeParse({ ...req.body, tenantId });
      if (!parsed.success) return res.status(400).json({ error: "Invalid tension payload", issues: parsed.error.issues });
      const row = await storage.createTension(parsed.data);
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[tensions] create failed:", err);
      res.status(500).json({ error: "Failed to create tension" });
    }
  });

  app.get("/api/tensions", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const sourceKind = typeof req.query.sourceKind === "string" ? req.query.sourceKind : undefined;
      const ownerPersonaId = req.query.ownerPersonaId ? parseInt(String(req.query.ownerPersonaId), 10) : undefined;
      const limit = req.query.limit ? Math.min(500, parseInt(String(req.query.limit), 10) || 100) : 100;
      const rows = await storage.listTensions(tenantId, { status, sourceKind, ownerPersonaId, limit });
      res.json(rows);
    } catch (err: any) {
      console.error("[tensions] list failed:", err);
      res.status(500).json({ error: "Failed to list tensions" });
    }
  });

  app.get("/api/tensions/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid tension id" });
      const row = await storage.getTension(id, tenantId);
      if (!row) return res.status(404).json({ error: "Tension not found" });
      res.json(row);
    } catch (err: any) {
      console.error("[tensions] get failed:", err);
      res.status(500).json({ error: "Failed to fetch tension" });
    }
  });

  app.patch("/api/tensions/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid tension id" });
      const allowed = new Set(["open", "investigating", "resolved", "superseded", "wontfix"]);
      const status = String(req.body?.status ?? "");
      if (!allowed.has(status)) return res.status(400).json({ error: "Invalid status (allowed: open|investigating|resolved|superseded|wontfix)" });
      const row = await storage.updateTensionStatus(id, tenantId, status);
      if (!row) return res.status(404).json({ error: "Tension not found" });
      res.json(row);
    } catch (err: any) {
      console.error("[tensions] update failed:", err);
      res.status(500).json({ error: "Failed to update tension" });
    }
  });

  app.post("/api/tensions/:id/resolve", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid tension id" });
      const parsed = z.object({
        resolution: z.string().trim().min(1, "resolution text required"),
        resolutionEvidence: z.any().optional(),
      }).safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      const row = await storage.resolveTension(id, tenantId, parsed.data.resolution, parsed.data.resolutionEvidence ?? {});
      if (!row) return res.status(404).json({ error: "Tension not found" });
      res.json(row);
    } catch (err: any) {
      console.error("[tensions] resolve failed:", err);
      res.status(500).json({ error: "Failed to resolve tension" });
    }
  });

  app.post("/api/adrs", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const parsed = insertArchitectureDecisionSchema.safeParse({ ...req.body, tenantId });
      if (!parsed.success) return res.status(400).json({ error: "Invalid ADR payload", issues: parsed.error.issues });
      const row = await storage.createAdr(parsed.data);
      res.status(201).json(row);
    } catch (err: any) {
      console.error("[adrs] create failed:", err);
      res.status(500).json({ error: "Failed to create ADR" });
    }
  });

  app.get("/api/adrs", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
      const limit = req.query.limit ? Math.min(500, parseInt(String(req.query.limit), 10) || 100) : 100;
      res.json(await storage.listAdrs(tenantId, { status, tag, limit }));
    } catch (err: any) {
      console.error("[adrs] list failed:", err);
      res.status(500).json({ error: "Failed to list ADRs" });
    }
  });

  app.get("/api/adrs/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ADR id" });
      const row = await storage.getAdr(id, tenantId);
      if (!row) return res.status(404).json({ error: "ADR not found" });
      res.json(row);
    } catch (err: any) {
      console.error("[adrs] get failed:", err);
      res.status(500).json({ error: "Failed to fetch ADR" });
    }
  });

  app.patch("/api/adrs/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ADR id" });
      const allowed = new Set(["proposed", "accepted", "deprecated", "superseded"]);
      const status = String(req.body?.status ?? "");
      if (!allowed.has(status)) return res.status(400).json({ error: "Invalid status (allowed: proposed|accepted|deprecated|superseded)" });
      const row = await storage.updateAdrStatus(id, tenantId, status);
      if (!row) return res.status(404).json({ error: "ADR not found" });
      res.json(row);
    } catch (err: any) {
      console.error("[adrs] update failed:", err);
      res.status(500).json({ error: "Failed to update ADR" });
    }
  });

  app.post("/api/adrs/:id/supersede", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const oldId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(oldId)) return res.status(400).json({ error: "Invalid ADR id" });
      const parsed = z.object({
        newAdrId: z.coerce.number().int().positive(),
        reason: z.string().trim().min(1, "reason required"),
      }).safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      const result = await storage.supersedeAdr(oldId, parsed.data.newAdrId, tenantId, parsed.data.reason);
      if (!result) return res.status(404).json({ error: "One or both ADRs not found in tenant" });
      res.json(result);
    } catch (err: any) {
      console.error("[adrs] supersede failed:", err);
      res.status(500).json({ error: "Failed to supersede ADR" });
    }
  });

  // GET /api/graph-explorer — returns nodes+edges across the whole tenant
  // knowledge graph: personas (always), tensions (open by default), ADRs,
  // and a sample of recent felix proposals. Edges: persona OWNS tension,
  // persona AUTHORED adr, adr SUPERSEDES adr, tension SOURCED_FROM proposal.
  app.get("/api/graph-explorer", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
      const includeKinds = String(req.query.kinds ?? "personas,tensions,adrs,proposals").split(",").map((s) => s.trim());
      const proposalLimit = Math.min(50, parseInt(String(req.query.proposalLimit ?? "20"), 10) || 20);

      const nodes: Array<any> = [];
      const edges: Array<any> = [];

      if (includeKinds.includes("personas")) {
        const personasList = await storage.getPersonas();
        for (const p of personasList) {
          nodes.push({ id: `persona:${p.id}`, kind: "persona", label: p.name, role: p.role, emoji: p.emoji, isActive: p.isActive });
        }
      }

      if (includeKinds.includes("tensions")) {
        const ts = await storage.listTensions(tenantId, { limit: 200 });
        for (const t of ts) {
          nodes.push({ id: `tension:${t.id}`, kind: "tension", label: t.title, status: t.status, sourceKind: t.sourceKind, createdAt: t.createdAt });
          if (t.ownerPersonaId) edges.push({ from: `persona:${t.ownerPersonaId}`, to: `tension:${t.id}`, kind: "owns" });
          if (t.sourceKind === "surprise" && t.sourceId) edges.push({ from: `tension:${t.id}`, to: `proposal:${t.sourceId}`, kind: "sourced_from" });
        }
      }

      if (includeKinds.includes("adrs")) {
        const adrs = await storage.listAdrs(tenantId, { limit: 200 });
        for (const a of adrs) {
          nodes.push({ id: `adr:${a.id}`, kind: "adr", label: a.title, status: a.status, tags: a.tags, createdAt: a.createdAt });
          if (a.authorPersonaId) edges.push({ from: `persona:${a.authorPersonaId}`, to: `adr:${a.id}`, kind: "authored" });
          if (a.supersedes) edges.push({ from: `adr:${a.id}`, to: `adr:${a.supersedes}`, kind: "supersedes" });
        }
      }

      if (includeKinds.includes("proposals")) {
        const propRows: any = await db.execute(sql`
          SELECT id, kind, status, surprise_band FROM felix_proposals
          WHERE tenant_id = ${tenantId}
          ORDER BY id DESC LIMIT ${proposalLimit}
        `);
        for (const p of (propRows.rows || [])) {
          nodes.push({ id: `proposal:${p.id}`, kind: "proposal", label: `${p.kind} #${p.id}`, status: p.status, surpriseBand: p.surprise_band });
        }
      }

      res.json({ tenantId, nodes, edges, generatedAt: new Date().toISOString() });
    } catch (err: any) {
      console.error("[graph-explorer] failed:", err);
      res.status(500).json({ error: "Failed to build graph" });
    }
  });

  // R74.13u Stage 28 — stats (6 routes: /api/health, /api/stats,
  // /api/sessions, /api/sessions/:k/history, /api/sessions/send,
  // /api/tool-audit) extracted to server/routes/stats.ts. Mixed gating
  // preserved verbatim: /api/health+/api/stats tenant-only, /api/sessions/*
  // requirePlatformAdmin, /api/tool-audit raw `tenantId===ADMIN && isAdminRequest`.

  // ─── Analytics ─────────────────────────────────────────
  app.get("/api/analytics", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const analytics = await storage.getAnalytics(tenantId);
      res.json(analytics);
    } catch (err: any) {
      console.error("[analytics] Error:", err.message);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  // ─── Context Summary ─────────────────────────────────────
  app.get("/api/context/summary", authMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Authentication required" });
    try {
      const summary = await storage.getContextSummary(tenantId);
      res.json(summary);
    } catch (err: any) {
      console.error("[context] Error:", err.message);
      res.status(500).json({ error: "Failed to fetch context" });
    }
  });

  // ─── Conversation Templates ───────────────────────────────
  app.get("/api/templates", authMiddleware, async (_req: Request, res: Response) => {
    res.json(await storage.getConversationTemplates());
  });

  app.post("/api/templates", authMiddleware, async (req: Request, res: Response) => {
    // R74.13h: conversation_templates is global (no tenant_id) and is mutated
    // by other admin paths via isAdminRequest gate. POST was missing it —
    // any authenticated user could create global templates visible to all
    // tenants. Match PATCH/DELETE gating.
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const { insertConversationTemplateSchema } = await import("@shared/schema");
      const parsed = insertConversationTemplateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const template = await storage.createConversationTemplate(parsed.data);
      res.status(201).json(template);
    } catch (err: any) {
      console.error("[templates] Error:", err.message);
      res.status(500).json({ error: "Failed to create template" });
    }
  });

  app.patch("/api/templates/:id", authMiddleware, async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    try {
      const { insertConversationTemplateSchema } = await import("@shared/schema");
      const parsed = insertConversationTemplateSchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const updated = await storage.updateConversationTemplate(parseInt(req.params.id as string), parsed.data);
      res.json(updated);
    } catch (err: any) {
      console.error("[templates] Update error:", err.message);
      res.status(500).json({ error: "Failed to update template" });
    }
  });

  app.delete("/api/templates/:id", authMiddleware, async (req: Request, res: Response) => {
    if (!isAdminRequest(req)) return res.status(403).json({ error: "Admin only" });
    await storage.deleteConversationTemplate(parseInt(req.params.id as string));
    res.status(204).send();
  });

  app.post("/api/templates/:id/start", async (req: Request, res: Response) => {
    try {
      // R74.13s SECURITY HARDENING — was unauthenticated. Architect-found CRITICAL:
      // anon could spawn conversations + system messages + starter messages using
      // the global active persona + global default model, burning AI tokens against
      // the platform's default provider key. Now requires a valid tenant session
      // and scopes the new conversation to that tenant.
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Authentication required" });
      const templates = await storage.getConversationTemplates();
      const template = templates.find(t => t.id === parseInt(req.params.id as string));
      if (!template) return res.status(404).json({ error: "Template not found" });

      const activePersona = await storage.getActivePersona();
      const settings = await storage.getSettings();
      const conv = await storage.createConversation({
        title: template.name,
        model: template.model || settings?.defaultModel || "gemini-2.5-flash",
        thinking: true,
        thinkingLevel: "auto",
        personaId: template.personaId || activePersona?.id || null,
        tenantId,
      } as any);

      if (template.systemPromptPrefix) {
        await storage.createMessage({ conversationId: conv.id, role: "system", content: template.systemPromptPrefix } as any);
      }

      if (template.starterMessages && template.starterMessages.length > 0) {
        for (const msg of template.starterMessages) {
          await storage.createMessage({ conversationId: conv.id, role: "user", content: msg } as any);
        }
      }

      res.status(201).json(conv);
    } catch (err: any) {
      console.error("[templates] Start error:", err.message);
      res.status(500).json({ error: "Failed to start from template" });
    }
  });

  // R74.13u Stage 26 — public-chat (13 routes incl. /api/c/:slug aliases +
  // 2 limiters + 2 tenant resolvers) extracted to server/routes/public-chat.ts.
  // Owner endpoints tenant-gated; token-keyed visitor endpoints intentionally
  // PUBLIC. Streaming POST handler keeps publicChatGuard + restricted tool
  // whitelist + scanInbound/scanAndAnnotate + MAX_TOOL_ROUNDS=3 verbatim.

  // ===== RESEARCH ENGINE ROUTES =====
  // Round 60+ Stage 6: Moved to server/routes/research.ts (registerResearchRoutes).

  // ── Treasury & Market Intelligence (Round 23) ─────────────────────────
  app.post("/api/treasury/forecast", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { symbol, horizonDays } = req.body || {};
      if (!symbol || typeof symbol !== "string") return res.status(400).json({ error: "symbol required" });
      const { forecastTicker } = await import("./treasury");
      const result = await forecastTicker(String(symbol), Number(horizonDays) || 30, tenantId);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message || "Forecast failed" }); }
  });
  app.post("/api/treasury/portfolio", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { holdings } = req.body || {};
      if (!Array.isArray(holdings) || holdings.length === 0) return res.status(400).json({ error: "holdings array required" });
      if (holdings.length > 50) return res.status(400).json({ error: "Maximum 50 holdings per request" });
      const { analyzePortfolio } = await import("./treasury");
      const result = await analyzePortfolio(holdings, tenantId);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message || "Portfolio analysis failed" }); }
  });

  // Round 25: Code-Proposals routes extracted to server/routes/code-proposals.ts
  // (first slice of routes.ts decomposition — 70 LOC removed from this file).
  registerCodeProposalsRoutes(app, { getTenantFromRequest, isAdminRequest });
  registerEventsRoutes(app, { authMiddleware, getTenantFromRequest, isAdminRequest });
  registerGoalLedgerRoutes(app, { authMiddleware, requirePlatformAdmin });
  registerGalleryRoutes(app);
  registerTrustRoutes(app);
  registerSkillsCatalogRoutes(app);
  registerAuditRoutes(app);
  registerEnrichmentRoutes(app);
  registerLeadsRoutes(app);
  registerArchiveRescueRoutes(app, { upload, getTenantFromRequest });
  registerGmailDirectRoutes(app);
  const { registerZombieDetectorRoutes } = await import("./routes/admin-zombie-detector");
  registerZombieDetectorRoutes(app, { authMiddleware, getTenantFromRequest, isAdminRequest, ADMIN_TENANT_ID });
  const { registerAdminWedgesRoutes } = await import("./routes/admin-wedges");
  registerAdminWedgesRoutes(app, { authMiddleware, getTenantFromRequest, isAdminRequest, ADMIN_TENANT_ID });
  registerMcpRoutes(app, { isAdminRequest, requirePlatformAdmin });
  registerMcpServerRoutes(app, { requirePlatformAdmin, getTenantFromRequest });
  registerMindsRoutes(app, { authMiddleware, getTenantFromRequest, requirePlatformAdmin });
  registerBrowserRoutes(app, { authMiddleware, getTenantFromRequestAsync, isPlatformAdmin, requirePlatformAdmin });
  registerApiV1Routes(app, { authMiddleware, getTenantFromRequest });
  registerAgencyRoutes(app, { authMiddleware, getTenantFromRequest, isAdminRequest, requirePlatformAdmin });
  registerAgentJobsRoutes(app, { authMiddleware, requirePlatformAdmin });
  // R74.13l Stage 7 — admin routes (24 handlers) extracted to server/routes/admin.ts
  // Covers: health-audit, claude-runner, service-orders policy + review queue,
  // replay-research-proposals, cost-audit, stuck diagnostics, tenants CRUD,
  // data-protection backups, concurrency, tool-curator, dormant-tools, silent-failures.
  registerAdminRoutes(app, { authMiddleware, getTenantFromRequest, isAdminRequest, ADMIN_TENANT_ID, requirePlatformAdmin });
  registerWhatsAppRoutes(app, { getTenantFromRequest, ADMIN_TENANT_ID, requirePlatformAdmin });
  registerInboxNotificationsRoutes(app, { authMiddleware, getTenantFromRequest, getTenantFromRequestAsync });
  registerBillingRoutes(app, { getTenantFromRequest, mutateLimiter });
  registerConversationsRoutes(app, { getTenantFromRequest, getTenantFromRequestAsync, ADMIN_TENANT_ID, isAdminRequest, mutateLimiter, validateModelForTenant });
  registerStripeCheckoutRoutes(app, { getTenantFromRequest, requirePlatformAdmin, authMiddleware });
  registerStripeTenantBillingRoutes(app, { getTenantFromRequest, requirePlatformAdmin, mutateLimiter });
  // R74.13t Stages 15-18 — governor (12), crews+flows (15), watchlist (7), runs (7) extracted.
  registerRunsRoutes(app, { authMiddleware, getTenantFromRequest });
  registerGovernorRoutes(app, { authMiddleware, getTenantFromRequest, requirePlatformAdmin });
  registerWatchlistRoutes(app, { authMiddleware, getTenantFromRequest, requirePlatformAdmin });
  registerCrewsFlowsRoutes(app, { authMiddleware, getTenantFromRequest, requirePlatformAdmin });
  await registerDocCollectionsRoutes(app, { getTenantFromRequest, upload, chunkUpload, chunkedUploads, UPLOADS_DIR, validateUploadedFile, extractTextFromFile });
  registerOAuthSubscriptionsRoutes(app, { getTenantFromRequest });
  registerPlatformConfigRoutes(app, { getTenantFromRequest, requirePlatformAdmin, ADMIN_TENANT_ID });
  registerTenantBYOKRoutes(app, { getTenantFromRequest });
  registerAgentManagerRoutes(app, { authMiddleware, getTenantFromRequest, requirePlatformAdmin });
  registerSculptorRoutes(app, { authMiddleware, getTenantFromRequest, requirePlatformAdmin });
  registerLobsterRoutes(app, { authMiddleware, requirePlatformAdmin });
  // R74.13u Stages 26-29 — public-chat (13), stats (6), briefings (9), credentials (4) extracted.
  registerCredentialsRoutes(app);
  registerBriefingsRoutes(app, { getTenantFromRequest, requirePlatformAdmin });
  registerStatsRoutes(app, { authMiddleware, getTenantFromRequest, requirePlatformAdmin, isAdminRequest, ADMIN_TENANT_ID });
  registerPublicChatRoutes(app, { getTenantFromRequest, ADMIN_TENANT_ID });
  // R74.13v Stages 30-34 — agentic-policy (14), team-admin (8), agentmail-webhook (1), activity (1), channels (4) extracted.
  registerAgenticPolicyRoutes(app, { authMiddleware, getTenantFromRequest, requirePlatformAdmin, isAdminRequest });
  registerTeamAdminRoutes(app, { authMiddleware, getTenantFromRequest, requirePlatformAdmin });
  registerAgentMailWebhookRoutes(app);
  registerActivityRoutes(app, { authMiddleware, getTenantFromRequest });
  registerVideoJobRoutes(app, { authMiddleware, getTenantFromRequest });
  registerChannelsRoutes(app, { authMiddleware, getTenantFromRequest });

  // R88 — Per-tenant usage analytics (cost, model breakdown, tool histogram, activity heatmap)
  app.get("/api/insights/usage", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const days = Math.max(1, Math.min(365, parseInt(String(req.query.days || "30"), 10)));
      const { getUsageInsights } = await import("./insights-engine");
      const data = await getUsageInsights({ tenantId, days });
      res.json(data);
    } catch (e: any) {
      console.error("[api/insights/usage] failed:", e?.message);
      res.status(500).json({ error: e?.message || "insights-failed" });
    }
  });

  app.get("/api/insights", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const engineType = req.query.engine as string | undefined;
      let result;
      if (engineType) {
        result = await db.execute(sql`
          SELECT * FROM ai_insights WHERE tenant_id = ${tenantId} AND engine_type = ${engineType}
          ORDER BY created_at DESC LIMIT 100
        `);
      } else {
        result = await db.execute(sql`
          SELECT * FROM ai_insights WHERE tenant_id = ${tenantId}
          ORDER BY created_at DESC LIMIT 100
        `);
      }
      res.json((result as any).rows || result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/insights/stats", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const result = await db.execute(sql`
        SELECT engine_type, COUNT(*) as total,
               COUNT(CASE WHEN status = 'new' THEN 1 END) as new_count,
               COUNT(CASE WHEN status = 'applied' THEN 1 END) as applied_count,
               COUNT(CASE WHEN priority = 'high' THEN 1 END) as high_priority
        FROM ai_insights WHERE tenant_id = ${tenantId}
        GROUP BY engine_type
      `);
      res.json((result as any).rows || result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/insights/:id/dismiss", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = parseInt(req.params.id as string);
      await db.execute(sql`UPDATE ai_insights SET status = 'dismissed' WHERE id = ${id} AND tenant_id = ${tenantId}`);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/insights/:id/apply", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const id = parseInt(req.params.id as string);
      const { actionTaken } = req.body;
      await db.execute(sql`UPDATE ai_insights SET status = 'applied', action_taken = ${actionTaken || 'Applied'} WHERE id = ${id} AND tenant_id = ${tenantId}`);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/insights/run/:engine", async (req, res) => {
    const tenantId = getTenantFromRequest(req);
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const engine = req.params.engine as string;
      const { runDecisionEngine, runPredictiveEngine, runOptimizationEngine, runAllEngines } = await import("./agentic-engines");
      let result;
      switch (engine) {
        case "decision": result = await runDecisionEngine(tenantId); break;
        case "prediction": result = await runPredictiveEngine(tenantId); break;
        case "optimization": result = await runOptimizationEngine(tenantId); break;
        case "all": result = await runAllEngines(tenantId); break;
        default: return res.status(400).json({ error: "Invalid engine. Use: decision, prediction, optimization, or all" });
      }
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/desks", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const desks = await getAllDesks(tenantId);
      res.json(desks);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/desks/overview", authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!requirePlatformAdmin(req, res)) return;
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const overview = await getDesksOverview(tenantId);
      res.json(overview);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/desks/:personaId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const desk = await getDesk(tenantId, parseInt(req.params.personaId as string));
      res.json(desk);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/desks/:personaId", authMiddleware, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantFromRequest(req);
      if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
      const personaId = parseInt(req.params.personaId as string);
      const { focusArea, statusNote } = req.body;
      if (focusArea !== undefined) await setDeskFocus(tenantId, personaId, focusArea);
      if (statusNote !== undefined) await setDeskStatus(tenantId, personaId, statusNote);
      const desk = await getDesk(tenantId, personaId);
      res.json(desk);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // R59 — events routes extracted to ./routes/events.ts (registered above).
  // R74.13v Stages 30-34: agentic-policy + team-admin + agentmail-webhook + activity + channels blocks moved to ./routes/{agentic-policy,team-admin,agentmail-webhook,activity,channels}.ts.

  return httpServer;
}

// Round 60+ Stage 6: computeNextRun moved into server/routes/research.ts
// (was only used by /api/research/schedules POST/PUT).
