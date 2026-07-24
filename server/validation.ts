import { z } from "zod";
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export const adminTenantUpdateSchema = z.object({
  plan: z.enum(["trial", "starter", "starter-byok", "pro", "pro-byok", "enterprise", "enterprise-byok", "admin"]).optional(),
  unlimited: z.boolean().optional(),
  trialMaxConversations: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});

export const forkTenantSchema = z.object({
  sourceTenantId: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  plan: z.enum(["trial", "starter", "starter-byok", "pro", "pro-byok", "enterprise", "enterprise-byok", "admin"]).optional(),
});

// `clientIdempotencyToken` mirrors the format enforced by
// readClientIdempotencyToken in server/anonymousVisitorPartition.ts. We
// must whitelist it here so Zod's default strip-unknown behavior does not
// silently drop the body field before the route's partition logic gets a
// chance to read it. Format kept identical to CLIENT_TOKEN_RE so a token
// that would be rejected by the partition reader is rejected at validation
// time instead of being silently demoted to the session-cookie fallback.
export const stripeCheckoutSchema = z.object({
  priceId: z.string().min(1).max(200),
  mode: z.enum(["payment", "subscription"]).optional(),
  customerEmail: z.string().email().max(200).optional(),
  clientIdempotencyToken: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).optional(),
});

// Self-Directed Initiative ("intention engine") owner decision body.
// The :id param is validated in-route (parseInt finite check); this guards
// the body field that drives the status transition.
export const selfInitiativeDecideSchema = z.object({
  decision: z.enum(["approve", "dismiss"]),
});

export const presenterSessionSchema = z.object({
  presentationId: z.union([z.string(), z.number()]),
  title: z.string().min(1).max(500),
  slides: z.array(z.any()).min(1),
  embedUrl: z.preprocess(v => (v === "" || v === undefined || v === null) ? undefined : v, z.string().url().max(2000).optional()),
  presentUrl: z.preprocess(v => (v === "" || v === undefined || v === null) ? undefined : v, z.string().url().max(2000).optional()),
  tenantId: z.number().int().positive().optional(),
});

export const contactFormSchema = z.object({
  name: z.string().transform(v => v.trim()).pipe(z.string().min(1, "Name is required").max(100)),
  email: z.string().transform(v => v.trim()).pipe(z.string().email().max(200)),
  subject: z.enum(["general", "sales", "support", "billing", "partnership", "enterprise", "bug", "other"]).default("general"),
  message: z.string().transform(v => v.trim()).pipe(z.string().min(1, "Message is required").max(5000)),
});

export const stripeBYOKSchema = z.object({
  secretKey: z.string().regex(/^sk_(live|test)_/, "Secret key must start with sk_live_ or sk_test_"),
  publishableKey: z.string().regex(/^pk_(live|test)_/, "Publishable key must start with pk_live_ or pk_test_"),
});

export const stripeSetupFeeSchema = z.object({
  setupType: z.enum(["managed", "byok"]).default("managed"),
});

export const mcpServerSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().default(""),
  serverUrl: z.string().url().max(2000),
  authType: z.enum(["none", "bearer", "api-key"]).optional().default("none"),
  authToken: z.string().max(500).optional(),
});

export const mcpToolCallSchema = z.object({
  serverId: z.number().int().positive(),
  toolName: z.string().min(1).max(200),
  args: z.record(z.any()).optional().default({}),
});

export const triggerSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  personaId: z.number().int().positive().optional(),
});

export const channelRouteSchema = z.object({
  channel: z.string().min(1).max(100),
  personaId: z.number().int().positive(),
});

export const personalityFileSchema = z.object({
  fileType: z.string().min(1).max(50),
  content: z.string().max(100000),
});

export const marketplaceInstallSchema = z.object({
  templateId: z.union([z.string(), z.number()]),
});

export const trustEventSchema = z.object({
  personaId: z.number().int().positive(),
  event: z.string().min(1).max(200),
  reason: z.string().max(500).optional(),
});

export const expressLaneCheckSchema = z.object({
  fromPersonaId: z.number().int().positive(),
  toPersonaId: z.number().int().positive(),
  workType: z.string().min(1).max(100),
});

export const inboxReadSchema = z.object({
  is_read: z.boolean(),
});

export const inboxStarSchema = z.object({
  is_starred: z.boolean(),
});

export const toggleSchema = z.object({
  enabled: z.boolean(),
});

// R114 — AEvo procedure edits (HITL-gated playbook surgery).
export const procedureEditProposeSchema = z.object({
  targetKind: z.string().min(1).max(64),
  targetId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "targetId must be lowercase alphanumeric/hyphens, 1-64 chars"),
  evidenceWindowDays: z.number().int().min(1).max(90).optional(),
});
export const procedureEditReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(2000).optional(),
});
// R115.2 +sec — Generic empty-body schema for mutating routes whose action is
// fully encoded in the URL (DELETEs, parameterless POSTs). `.strict()` rejects
// any unexpected keys so the "all mutating routes carry validate()" invariant
// holds across procedure-edits, council-verdicts, mcp-server, scheduled-posts.
// Body-smuggling (e.g. an attacker stuffing extra fields hoping a downstream
// handler picks them up) is rejected at the gate.
export const emptyBodySchema = z.object({}).strict();
export const procedureEditApplySchema = emptyBodySchema;

export const procedureEditRollbackSchema = z.object({
  reason: z.string().max(500).optional(),
});

// R118 — per-message user feedback (thumbs + optional comment). rating constrained
// to -1 | +1 at the schema level (DB also enforces via CHECK). Comment soft-capped
// 2000 chars (long enough for a paragraph, short enough not to swallow context).
export const messageFeedbackSchema = z.object({
  rating: z.union([z.literal(-1), z.literal(1)]),
  comment: z.string().trim().max(2000).optional(),
});

// R115 — External Review Council final-decision record.
export const councilFinalDecisionSchema = z.object({
  finalDecision: z.enum(["approved", "rejected", "deferred"]),
});

// R113.6 — Scheduled cross-platform post creation.
export const scheduledPostCreateSchema = z.object({
  platforms: z.array(z.string().min(1).max(32)).min(1).max(10),
  content: z.string().min(1).max(10000),
  scheduledFor: z.string().min(1).max(64),
  imageUrl: z.string().url().max(2048).optional(),
  videoUrl: z.string().url().max(2048).optional(),
  campaign: z.string().max(200).optional(),
});

// R113.7 — MCP API key creation. Scope validation is enforced server-side
// against the MCP_SCOPES registry; here we just bound shape + length.
export const mcpKeyCreateSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1).max(64)).max(16).optional(),
});

// Built With Bob weight log (project-page card). All three figures optional —
// persist only what's supplied (Bob usually just logs currentWeight on Monday).
// Bounded to a sane human-weight range so a fat-fingered entry can't poison the
// recap's supplied-fact guard. At least one field must be present.
export const bwbWeightUpdateSchema = z
  .object({
    currentWeight: z.number().positive().max(1000).optional(),
    totalLost: z.number().positive().max(1000).optional(),
    startWeight: z.number().positive().max(1000).optional(),
  })
  .refine(
    (v) => v.currentWeight != null || v.totalLost != null || v.startWeight != null,
    { message: "Provide at least one of currentWeight, totalLost, startWeight" },
  );

// Simulation Sandbox (S5) — /api/admin/sandbox/runs launch body. Corpus-
// specific requirements (intentGateMode for safety, model for model-swap)
// are enforced in the route; the cap is capped at the spec's $5 default so
// the route can never raise it.
export const sandboxLaunchSchema = z.object({
  corpus: z.enum(["safety", "conversation", "orchestration"]),
  sampleSize: z.number().int().min(1).max(200),
  intentGateMode: z.enum(["off", "moderate", "strict"]).optional(),
  restrictedCategories: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  perRunCapUsd: z.number().positive().max(5).optional(),
});

export const heartbeatDelegateSchema = z.object({
  fromPersonaId: z.number().int().positive().nullable().optional(),
  targetPersona: z.string().trim().min(1).max(100),
  taskName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  prompt: z.string().trim().min(1).max(20000),
  // "once" runs inline; any other value is treated as a cron expression by
  // delegateTaskFromChat — constrain to a plausible 5-field cron shape.
  schedule: z.string().trim().max(100).optional().default("once")
    .refine(
      (s) => s === "once" || /^[\d*/,\-A-Za-z ]{5,100}$/.test(s) && s.split(/\s+/).length === 5,
      { message: 'schedule must be "once" or a 5-field cron expression' }
    ),
  model: z.string().trim().min(1).max(100).optional().default("gpt-5-mini"),
});

export function validate<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstError = result.error.errors[0];
      return res.status(400).json({
        error: `Validation failed: ${firstError.path.join(".")} — ${firstError.message}`,
        details: result.error.errors.map(e => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }
    req.body = result.data;
    next();
  };
}

const csrfTokens = new Map<string, { token: string; expiresAt: number }>();

// SECURITY (R74.13u-sec): derive a stable per-session key for CSRF token
// storage so two different browser sessions in the same tenant cannot share
// or replay each other's CSRF tokens. Prefers (in order):
//   1. Hash of the Bearer session token (custom auth — one key per session token)
//   2. Replit Auth `claims.sub` (one key per OIDC subject / browser session)
//   3. Tenant id fallback (legacy path; only when neither above is present)
// The returned key is opaque to callers — never expose it to clients.
export function getCsrfSessionKey(req: Request, tenantId?: number | null): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      return "tok:" + crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
    }
  }
  const replitSub = (req as any).user?.claims?.sub;
  if (replitSub) return "rpl:" + String(replitSub);
  if (tenantId != null) return "tnt:" + String(tenantId);
  return null;
}

export function generateCsrfToken(sessionKey: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  csrfTokens.set(sessionKey, {
    token,
    expiresAt: Date.now() + 4 * 60 * 60 * 1000,
  });
  return token;
}

export function createCsrfMiddleware(
  getTenantId: (req: Request) => number | null | Promise<number | null>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return next();
    }

    const skipPaths = [
      "/api/public/",
      "/api/trigger/",
      "/api/webhooks/",
      "/api/tenants/register",
      "/api/tenants/login",
      "/api/tenants/forgot-password",
      "/api/tenants/reset-password",
      "/api/presenter",
      "/api/mcp/sse",
      // R79.3d — HITL email-link approve/deny. Token signature is a stronger
      // authenticator than CSRF here: the token is HMAC-signed with cid +
      // decision + tenant + exp, so it can't be forged or replayed cross-site.
      // CSRF would block legit clicks from logged-in browsers since the form
      // (rendered into Bob's email) has no session-bound CSRF token.
      "/api/hitl/",
      // Built With Bob weekly-recap email approve/deny. Same rationale as HITL:
      // the link carries an HMAC-signed token (cid + decision + tenant + exp) that
      // is a stronger authenticator than CSRF, and the form rendered into Bob's
      // email has no session-bound CSRF token.
      "/api/bwb/",
      // R98.26 — Slack signs requests with HMAC-SHA256 over the raw body
      // (verifySlackSignature in server/routes/slack.ts) which is a stronger
      // authenticator than CSRF for cross-origin Slack → us POSTs.
      "/api/slack/",
    ];
    if (skipPaths.some(p => req.path.startsWith(p))) {
      return next();
    }

    // R125+13.16+sec2 — narrow `/api/auth/*` allowlist. The previous
    // `/api/auth/` prefix-skip was too broad: it also exempted state-changing
    // routes like `verify-email` and `resend-verification` from CSRF. Those
    // are cookie-authenticated and must be CSRF-protected. Only truly
    // unauthenticated / bootstrap auth endpoints stay on the allowlist.
    // R125+13.16+sec2 architect HIGH: `/api/auth/logout` removed — no such
    // POST route exists (frontend uses GET `/api/logout` via Replit-auth) AND
    // even if it did, allowing CSRF-free POST to logout enables CSRF-logout
    // attacks (malicious site force-terminates a victim session). Keep
    // logout endpoints CSRF-protected.
    const authExactAllowlist = new Set<string>([
      "/api/auth/login",
      "/api/auth/callback",
      "/api/auth/replit/callback",
      "/api/auth/csrf-token",
      "/api/auth/forgot-password",
      "/api/auth/reset-password",
    ]);
    if (authExactAllowlist.has(req.path)) {
      return next();
    }

    // SECURITY (R74.13u-sec): only bypass CSRF for vc_-prefixed API keys.
    // API keys are inherently CSRF-immune (browsers don't auto-send the
    // Authorization header cross-site), but the previous "Bearer ..." catch-
    // all also exempted custom session tokens, which made cookie+bearer mixed
    // clients effectively CSRF-free. Restrict to the API-key prefix only.
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer vc_")) {
      return next();
    }

    // R74.13z-quint+7 SECURITY (Tier-1 #4): csrfMiddleware mounts BEFORE
    // authMiddleware (so it sees mutating routes that authMiddleware later
    // rejects). The previous sync `getTenantFromRequest` returned null for
    // any Replit-Auth cookie that wasn't pre-cached, which silently SKIPPED
    // CSRF entirely on the very first POST after a fresh login. Awaiting an
    // async resolver hydrates the tenant from getOrCreateTenantForReplitUser
    // before deciding to enforce.
    let tenantId: number | null = null;
    try {
      tenantId = await getTenantId(req);
    } catch {
      tenantId = null;
    }
    if (!tenantId) {
      return next();
    }

    const csrfToken = req.headers["x-csrf-token"] as string;
    const sessionKey = getCsrfSessionKey(req, tenantId);
    if (!sessionKey) {
      return next();
    }

    const stored = csrfTokens.get(sessionKey);
    if (!stored || stored.expiresAt < Date.now()) {
      return res.status(403).json({ error: "CSRF token missing or expired. Please refresh the page." });
    }

    if (!csrfToken || csrfToken !== stored.token) {
      return res.status(403).json({ error: "Invalid CSRF token" });
    }

    next();
  };
}

// .unref(): housekeeping timer must not hold the event loop open (test-exit hang).
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of csrfTokens) {
    if (val.expiresAt < now) csrfTokens.delete(key);
  }
}, 15 * 60 * 1000).unref();

// Tenant self-profile PATCH — at least one valid field required.
export const tenantProfilePatchSchema = z.object({
  userNotesMarkdown: z.string().max(32_000, "userNotesMarkdown exceeds 32KB").optional(),
  disabledSkillNames: z.array(z.string().max(200)).max(200, "disabledSkillNames cap is 200").optional(),
}).refine(
  (b) => typeof b.userNotesMarkdown === "string" || Array.isArray(b.disabledSkillNames),
  { message: "No valid fields to update" },
);

// Venture Discovery Loop (2026-06-17) — owner-only, dry-run-default, HITL loop.
export const ventureStartSchema = z.object({
  objective: z.string().min(8, "objective must be at least 8 characters").max(2000),
  dryRun: z.boolean().optional(),
});
export const ventureExportSchema = z.object({
  format: z.enum(["json", "markdown"]).optional(),
});

// ── Verified Revenue Missions (data/feature-contracts/revenue-missions) ─────
export const missionCreateSchema = z.object({
  name: z.string().min(3).max(200),
  hypothesis: z.string().min(10).max(2000),
  idealCustomer: z.string().min(5).max(1000),
  offer: z.string().min(5).max(2000),
  painStatement: z.string().max(2000).optional(),
  priceUsd: z.number().int().min(0).max(100000).optional(),
  acquisitionChannel: z.enum(["email", "call", "social", "landing_page"]).optional(),
  successCriteria: z.string().max(2000).optional(),
  killCriteria: z.string().max(2000).optional(),
  projectId: z.number().int().positive().optional(),
  notes: z.string().max(4000).optional(),
});
export const missionEvidenceSchema = z.object({
  type: z.enum([
    "positive_reply", "negative_reply", "call_booked", "checkout_started",
    "payment", "refund", "complaint_sourced", "competitor_found",
    "prospect_agreed_price", "other",
  ]),
  summary: z.string().min(3).max(2000),
  source: z.enum(["gmail", "stripe", "manual", "web", "crm"]),
  experimentId: z.number().int().positive().optional(),
  externalRef: z.string().min(1).max(500).optional(),
  amountUsdCents: z.number().int().min(0).optional(),
  contactEmail: z.string().email().optional(),
  raw: z.record(z.unknown()).optional(),
}).refine(
  (v) => v.source === "manual" || (typeof v.externalRef === "string" && v.externalRef.length > 0),
  { message: "externalRef is required for non-manual evidence sources (gmail/stripe/web/crm) — provenance must be traceable", path: ["externalRef"] },
);
export const missionAutonomySchema = z.object({
  level: z.number().int().min(0).max(6),
});
export const missionKillSchema = z.object({
  reason: z.string().max(1000).optional(),
});
export const missionDraftExperimentSchema = z.object({
  name: z.string().min(3).max(200).optional(),
});
