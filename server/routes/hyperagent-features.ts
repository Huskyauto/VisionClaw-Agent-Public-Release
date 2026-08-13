// R98.21 — Hyperagent-cross-pollination routes.
// Three surfaces:
//   GET  /api/landing/recipes          — public recipe gallery (cost+duration labels)
//   GET  /api/proposed-skills          — admin queue (pending unless ?status=...)
//   POST /api/proposed-skills/:id/accept   — promote to skills, mark accepted
//   POST /api/proposed-skills/:id/reject   — mark rejected (no promotion)
//   GET  /api/ab-runs                  — admin list of A/B comparisons
//   GET  /api/ab-runs/:id              — single A/B run with results + ranking

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { proposedSkills, abRuns, skills } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { DELIVERABLE_PIPELINES, formatEstimate } from "../deliverable-contracts";
import { sanitizeUntrusted } from "../lib/sanitize-untrusted";
import { pinThrottleCheck, pinThrottleRecord } from "../lib/pin-throttle";
import crypto from "crypto";

// R98.23+sec — defense-in-depth PIN check for the ONE high-blast-radius
// admin operation: promoting a tenant-scoped proposed skill into the GLOBAL
// `skills` catalog where it becomes a live system-prompt fragment for every
// tenant on the platform. requireAdmin (platform-admin session) is necessary
// but not sufficient; a hijacked admin session must also possess the PIN.
// On any other route we fall back to admin-only.
// R125+13.16+sec — architect MEDIUM: mirror the leads.ts pin-throttle
// (8 attempts / 10min / 30min lockout). The session-admin gate is the
// primary defense, but if requireAdmin ever regresses or a session is
// hijacked, a 4-digit PIN is brute-forceable in seconds without throttle.
function requireAdminPin(req: Request, res: Response): boolean {
  const throttle = pinThrottleCheck(req);
  if (!throttle.ok) {
    res.setHeader("Retry-After", String(throttle.retryAfterSec ?? 1800));
    res.status(429).json({ error: "too many PIN attempts; locked out", retryAfterSec: throttle.retryAfterSec });
    return false;
  }
  const expected = process.env.ADMIN_PIN || "";
  if (!expected || expected.length < 4) {
    res.status(503).json({ error: "ADMIN_PIN not configured — set it in your Replit secrets to enable global-skill promotion." });
    return false;
  }
  const provided = String(req.headers["x-admin-pin"] || req.body?.adminPin || "");
  if (provided.length !== expected.length) {
    pinThrottleRecord(req, false);
    res.status(401).json({ error: "admin pin required" });
    return false;
  }
  try {
    const ok = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!ok) { pinThrottleRecord(req, false); res.status(401).json({ error: "admin pin incorrect" }); return false; }
  } catch {
    pinThrottleRecord(req, false);
    res.status(401).json({ error: "admin pin invalid" }); return false;
  }
  pinThrottleRecord(req, true);
  return true;
}

// Hard cap on a promoted skill body. Anything longer is almost certainly
// either an injection payload or a copy-pasted document, neither of which
// belongs in a system-prompt fragment shared across all tenants.
const MAX_PROMOTED_BODY_CHARS = 8000;

// Curated public recipe gallery — surfaces the cost+duration estimates from
// the canonical DELIVERABLE_PIPELINES so the landing page doesn't drift.
const RECIPES: Array<{ id: string; label: string; format: keyof typeof DELIVERABLE_PIPELINES; prompt: string; tagline: string }> = [
  { id: "explainer-video", label: "60-Second Explainer Video", format: "video",
    prompt: "Make a 60-second explainer video for a small SaaS founder explaining how customer feedback loops accelerate product-market fit. Friendly tone, voice 'onyx', 1080p.",
    tagline: "Script → onyx narration → cinematic scenes → 1080p MP4 in Drive." },
  { id: "branded-pdf-report", label: "Branded PDF Report", format: "pdf",
    prompt: "Build a branded 6-page PDF on 'Q2 retention drivers for D2C subscription brands' with a stats grid, two-column layout, and a Q3 action checklist.",
    tagline: "Executive cover → stats grid → tables → emailed Drive link." },
  { id: "investor-deck", label: "Investor Deck (Slides)", format: "slides",
    prompt: "Build a 12-slide investor deck for a Series A AI agent platform. Hero photo on the title slide, narration row per slide, export PPTX + PDF.",
    tagline: "Outline → hero photo → per-slide narration → PPTX + PDF." },
  { id: "downloadable-tool", label: "Downloadable HTML Utility", format: "html_app",
    prompt: "Build a single-file HTML password generator with length slider, symbol toggle, copy-to-clipboard, and a strength meter.",
    tagline: "Self-contained HTML → jsdom smoke-test → emailed download." },
  { id: "research-brief", label: "Deep Research Brief", format: "research",
    prompt: "Deep-research the current state of small-language-model fine-tuning on consumer GPUs. Cite sources, surface 5 actionable takeaways.",
    tagline: "Multi-source synthesis with cited findings, no file artifact." },
];

// `requireAdmin` is the project's gate-style helper: returns true if the request
// is authorized (caller proceeds), and writes the 401/403 response itself if not
// (caller must short-circuit). `getTenant` extracts the tenant id from the req.
export function registerHyperagentRoutes(
  app: Express,
  deps: {
    requireAdmin: (req: Request, res: Response) => boolean;
    getTenant: (req: Request) => number | null;
  },
) {
  const { requireAdmin, getTenant } = deps;
  // R98.22+sec — strict tenant resolver. Returns false (after writing 401) if
  // no tenant context — prevents the prior `?? 1` fail-open which silently
  // wrote/read against admin tenant 1 when tenant context was missing.
  const resolveTenant = (req: Request, res: Response): number | null => {
    const tid = getTenant(req);
    if (typeof tid !== "number" || tid <= 0) {
      res.status(401).json({ error: "tenant context required" });
      return null;
    }
    return tid;
  };
  // ── Public landing recipe gallery ───────────────────────────────────────
  // Public path under /api/public/* so it skips the global auth middleware
  // (see PUBLIC_PATH_PREFIXES in server/auth.ts).
  app.get("/api/public/recipes", (_req: Request, res: Response) => {
    const items = RECIPES.map((r) => {
      const p = DELIVERABLE_PIPELINES[r.format];
      return {
        id: r.id,
        label: r.label,
        format: r.format,
        prompt: r.prompt,
        tagline: r.tagline,
        description: p.description,
        estimate: formatEstimate(p),
        durationMinutes: { low: p.estDurationMinLow, median: p.estDurationMinMedian, high: p.estDurationMinHigh },
        costUsd: { low: p.estCostUsdLow, median: p.estCostUsdMedian, high: p.estCostUsdHigh },
        passingGradeBar: p.passingGradeBar,
      };
    });
    res.json({ recipes: items });
  });

  // ── Proposed skills queue (admin) ───────────────────────────────────────
  app.get("/api/proposed-skills", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tid = resolveTenant(req, res); if (tid === null) return;
      const status = typeof req.query.status === "string" ? req.query.status : "pending";
      const allowed = ["pending", "accepted", "rejected", "superseded", "all"];
      if (!allowed.includes(status)) return res.status(400).json({ error: "invalid status" });
      const where = status === "all"
        ? eq(proposedSkills.tenantId, tid)
        : and(eq(proposedSkills.tenantId, tid), eq(proposedSkills.status, status))!;
      const rows = await db.select().from(proposedSkills).where(where).orderBy(desc(proposedSkills.createdAt)).limit(200);
      res.json({ proposedSkills: rows });
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });

  app.post("/api/proposed-skills/:id/accept", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    // R98.23+sec — second-factor PIN gate (architect H1): a hijacked admin
    // session alone cannot promote a proposed skill into the global catalog.
    if (!requireAdminPin(req, res)) return;
    try {
      const tid = resolveTenant(req, res); if (tid === null) return;
      const reviewer = (req as any).session?.user?.email || (req as any).session?.user?.username || "admin";
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
      const [row] = await db.select().from(proposedSkills)
        .where(and(eq(proposedSkills.id, id), eq(proposedSkills.tenantId, tid))!).limit(1);
      if (!row) return res.status(404).json({ error: "not found" });
      if (row.status !== "pending") return res.status(409).json({ error: `already ${row.status}` });
      // R98.23+sec architect H2 — sanitize + length-cap before promoting agent-
      // authored prose into the GLOBAL system-prompt path. Rejection over
      // truncation: if a body has somehow slipped past the propose-time
      // sanitizer or exceeds the hard cap, refuse the promotion so a human
      // re-edits the proposal instead of letting an injection payload land.
      if ((row.body || "").length > MAX_PROMOTED_BODY_CHARS) {
        return res.status(413).json({ error: `body exceeds ${MAX_PROMOTED_BODY_CHARS}-char cap; edit the proposal first` });
      }
      const cleanName = sanitizeUntrusted(row.name || "", { maxBytes: 200 });
      const cleanDesc = sanitizeUntrusted(row.description || "", { maxBytes: 1000 });
      const cleanBody = sanitizeUntrusted(row.body || "", { maxBytes: MAX_PROMOTED_BODY_CHARS });
      // Promote to live skills table. NOTE: the live `skills` catalog is
      // global (no tenant_id) by platform design — once promoted, the skill is
      // available to every tenant. The proposal row stays tenant-scoped, so we
      // still know who suggested it.
      const [promoted] = await db.insert(skills).values({
        name: cleanName,
        description: cleanDesc,
        promptContent: cleanBody,
        category: row.category,
        enabled: true,
      } as any).returning();
      // R98.22+sec — tenant-scope the UPDATE (previously bare `eq(id)` allowed
      // cross-tenant promotion if an attacker guessed an id from another tenant).
      await db.update(proposedSkills).set({
        status: "accepted",
        reviewedBy: reviewer,
        reviewedAt: new Date(),
        promotedSkillId: promoted.id,
      }).where(and(eq(proposedSkills.id, id), eq(proposedSkills.tenantId, tid))!);
      res.json({ ok: true, promotedSkillId: promoted.id });
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });

  app.post("/api/proposed-skills/:id/reject", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tid = resolveTenant(req, res); if (tid === null) return;
      const reviewer = (req as any).session?.user?.email || (req as any).session?.user?.username || "admin";
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
      const result = await db.update(proposedSkills).set({
        status: "rejected", reviewedBy: reviewer, reviewedAt: new Date(),
      }).where(and(eq(proposedSkills.id, id), eq(proposedSkills.tenantId, tid), eq(proposedSkills.status, "pending"))!).returning();
      if (!result.length) return res.status(404).json({ error: "not found or not pending" });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });

  // ── A/B runs (admin) ────────────────────────────────────────────────────
  app.get("/api/ab-runs", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tid = resolveTenant(req, res); if (tid === null) return;
      const rows = await db.select({
        id: abRuns.id, name: abRuns.name, status: abRuns.status,
        configs: abRuns.configs, runsPerConfig: abRuns.runsPerConfig,
        ranking: abRuns.ranking, createdAt: abRuns.createdAt, completedAt: abRuns.completedAt,
        createdBy: abRuns.createdBy,
      }).from(abRuns).where(eq(abRuns.tenantId, tid)).orderBy(desc(abRuns.createdAt)).limit(100);
      res.json({ abRuns: rows });
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });

  app.get("/api/ab-runs/:id", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tid = resolveTenant(req, res); if (tid === null) return;
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
      const [row] = await db.select().from(abRuns)
        .where(and(eq(abRuns.id, id), eq(abRuns.tenantId, tid))!).limit(1);
      if (!row) return res.status(404).json({ error: "not found" });
      res.json({ abRun: row });
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });
}
