import type { Express, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { activityLog, synergyTrials } from "@shared/schema";
import { sameSynergyPayload, scoreHumanAiSynergyTrial } from "../lib/human-ai-synergy-core";

const enabled = () => process.env.HUMAN_AI_SYNERGY_TRIAL_ENABLED === "1";
const keyPattern = /^[A-Za-z0-9._:-]{3,80}$/;
const RUBRIC_VERSION = "human-ai-synergy-v1";
type TrialRow = typeof synergyTrials.$inferSelect;
type TrialInsert = typeof synergyTrials.$inferInsert;

export interface HumanAiSynergyStore {
  findByKey(tenantId: number, idempotencyKey: string): Promise<TrialRow | undefined>;
  createWithAudit(row: TrialInsert, audit: { trialId: number; idempotencyKey: string; verdict: string }): Promise<TrialRow>;
}

function productionStore(): HumanAiSynergyStore {
  return {
    findByKey: async (tenantId, idempotencyKey) => {
      const [row] = await db.select().from(synergyTrials).where(and(
        eq(synergyTrials.tenantId, tenantId), eq(synergyTrials.idempotencyKey, idempotencyKey),
      )).limit(1);
      return row;
    },
    createWithAudit: async (row, audit) => db.transaction(async (tx) => {
      const [created] = await tx.insert(synergyTrials).values(row).returning();
      if (!created) throw new Error("trial insert returned no row");
      await tx.insert(activityLog).values({
        tenantId: row.tenantId, actorType: "user", actorName: "Admin",
        action: "human_ai_synergy_trial_created", resourceType: "synergy_trial",
        resourceId: String(created.id), description: "Created Human-AI Synergy trial",
        metadata: { trialId: created.id, idempotencyKey: audit.idempotencyKey, rubricVersion: RUBRIC_VERSION, verdict: audit.verdict },
      });
      return created;
    }),
  };
}

export function createHumanAiSynergyPostHandler(deps: {
  requireOwnerAdmin: (req: Request, res: Response) => boolean;
  getTenant: (req: Request) => number | null;
  store: HumanAiSynergyStore;
}) {
  return async (req: Request, res: Response) => {
    if (!enabled()) { res.status(404).json({ error: "feature disabled" }); return; }
    if (!deps.requireOwnerAdmin(req, res)) return;
    const tenantId = deps.getTenant(req);
    if (!Number.isInteger(tenantId) || tenantId! <= 0) { res.status(401).json({ error: "tenant context required" }); return; }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const { trialName, taskLabel, participantAlias, idempotencyKey, notes, securityPass, arms } = body;
    if (typeof idempotencyKey !== "string" || !keyPattern.test(idempotencyKey) ||
      typeof trialName !== "string" || trialName.trim().length < 1 || trialName.length > 120 ||
      typeof taskLabel !== "string" || taskLabel.trim().length < 1 || taskLabel.length > 200 ||
      typeof participantAlias !== "string" || participantAlias.trim().length < 1 || participantAlias.length > 120 ||
      (notes !== undefined && (typeof notes !== "string" || notes.trim().length < 1 || notes.length > 1000))) {
      res.status(400).json({ error: "invalid bounded trial metadata" }); return;
    }
    const canonicalTrialName = trialName.trim(), canonicalTaskLabel = taskLabel.trim();
    const canonicalParticipantAlias = participantAlias.trim(), canonicalNotes = notes === undefined ? null : notes.trim();
    const semanticPayload = { trialName: canonicalTrialName, taskLabel: canonicalTaskLabel, participantAlias: canonicalParticipantAlias, notes: canonicalNotes, securityPass, arms, rubricVersion: RUBRIC_VERSION };
    const compare = (existing: TrialRow) => {
      const m = existing.measurements as any;
      return m && !Array.isArray(m) && sameSynergyPayload(semanticPayload, {
        trialName: existing.trialName, taskLabel: existing.taskLabel, participantAlias: existing.participantAlias,
        notes: existing.notes ?? null, securityPass: m.securityPass, arms: m.arms, rubricVersion: existing.rubricVersion,
      });
    };
    try {
      const existing = await deps.store.findByKey(tenantId!, idempotencyKey);
      if (existing) return compare(existing)
        ? res.status(200).json({ trial: existing, idempotent: true })
        : res.status(409).json({ error: "idempotency conflict" });
      const scored = scoreHumanAiSynergyTrial({ task: canonicalTaskLabel, securityPass, arms });
      if (!scored.valid) return res.status(400).json({ error: "invalid trial measurements", reasons: scored.errors });
      const row = await deps.store.createWithAudit({
        tenantId: tenantId!, idempotencyKey, trialName: canonicalTrialName, taskLabel: canonicalTaskLabel,
        participantAlias: canonicalParticipantAlias, rubricVersion: RUBRIC_VERSION, notes: canonicalNotes,
        measurements: { securityPass, arms }, result: scored,
      }, { trialId: 0, idempotencyKey, verdict: scored.verdict });
      return res.status(201).json({ trial: row, idempotent: false });
    } catch {
      try {
        const existing = await deps.store.findByKey(tenantId!, idempotencyKey);
        if (existing) return compare(existing)
          ? res.status(200).json({ trial: existing, idempotent: true })
          : res.status(409).json({ error: "idempotency conflict" });
      } catch { /* controlled response below */ }
      return res.status(500).json({ error: "unable to create synergy trial" });
    }
  };
}

export function registerHumanAiSynergyRoutes(
  app: Express,
  deps: {
    requireOwnerAdmin: (req: Request, res: Response) => boolean;
    getTenant: (req: Request) => number | null;
    store?: HumanAiSynergyStore;
  },
) {
  const store = deps.store ?? productionStore();
  const guard = (req: Request, res: Response) => {
    if (!enabled()) { res.status(404).json({ error: "feature disabled" }); return false; }
    if (!deps.requireOwnerAdmin(req, res)) return false;
    const tenantId = deps.getTenant(req);
    if (!Number.isInteger(tenantId) || tenantId! <= 0) { res.status(401).json({ error: "tenant context required" }); return false; }
    return tenantId!;
  };

  app.get("/api/human-ai-synergy-trials", async (req, res) => {
    const tenantId = guard(req, res); if (tenantId === false) return;
    try {
      const rows = await db.select().from(synergyTrials).where(eq(synergyTrials.tenantId, tenantId))
        .orderBy(desc(synergyTrials.createdAt)).limit(100);
      res.json({ trials: rows });
    } catch { res.status(500).json({ error: "unable to list synergy trials" }); }
  });

  app.get("/api/human-ai-synergy-trials/:id", async (req, res) => {
    const tenantId = guard(req, res); if (tenantId === false) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    try {
      const [row] = await db.select().from(synergyTrials)
        .where(and(eq(synergyTrials.id, id), eq(synergyTrials.tenantId, tenantId))).limit(1);
      if (!row) return res.status(404).json({ error: "not found" });
      res.json({ trial: row });
    } catch { res.status(500).json({ error: "unable to read synergy trial" }); }
  });

  app.post("/api/human-ai-synergy-trials", createHumanAiSynergyPostHandler({ ...deps, store }));
}