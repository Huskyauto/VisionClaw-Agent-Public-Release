// ─────────────────────────────────────────────────────────────────────────────
// Verified Revenue Missions — owner-only HTTP surface (S1/S2).
// Feature contract: data/feature-contracts/revenue-missions.
//
// Every endpoint resolves tenantId from the AUTHENTICATED SESSION (never the
// body) and refuses any non-owner tenant (403). HITL: drafting an experiment
// sends NOTHING; approval only flips the flag the (future S3) send path
// requires — fail closed.
//   POST /api/revenue-missions                      create mission
//   GET  /api/revenue-missions                      list missions
//   GET  /api/revenue-missions/:id                  mission + evidence + experiments + done-checks
//   POST /api/revenue-missions/:id/evidence         attach manual evidence
//   POST /api/revenue-missions/:id/experiments/draft   Gmail-sample review packet (no sends)
//   POST /api/revenue-missions/:id/experiments/:eid/approve  HITL approve (idempotent)
//   POST /api/revenue-missions/:id/kill             kill the mission
// ─────────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { getTenantFromRequest } from "../auth";
import { ownerTenantId } from "../agentic/autonomous-budget";
import {
  missionCreateSchema,
  missionEvidenceSchema,
  missionKillSchema,
  missionDraftExperimentSchema,
  missionAutonomySchema,
} from "../validation";
import * as rm from "../lib/revenue-missions";

export const revenueMissionsRouter = Router();

function ownerTenantOrNull(req: Request): number | null {
  const tenantId = getTenantFromRequest(req);
  if (tenantId == null || tenantId !== ownerTenantId()) return null;
  return tenantId;
}

function parseId(v: unknown): number | null {
  const id = parseInt(String(v), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

revenueMissionsRouter.post("/", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  const parsed = missionCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const mission = await rm.createMission({ tenantId, ...parsed.data });
  res.status(201).json({ mission });
});

revenueMissionsRouter.get("/", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  res.json({ missions: await rm.listMissions(tenantId) });
});

// Capital allocator (S5d) — deterministic ADVISORY portfolio review. Applies
// nothing: kill/approve/autonomy remain HITL decisions made from this report.
// Registered BEFORE /:id so the literal path isn't shadowed by the param route.
revenueMissionsRouter.get("/portfolio/review", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  try {
    const { reviewPortfolio } = await import("../lib/mission-capital-allocator");
    res.json(await reviewPortfolio(tenantId));
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

revenueMissionsRouter.get("/:id", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "bad_id" });
  const mission = await rm.getMission(tenantId, id);
  if (!mission) return res.status(404).json({ error: "not_found" });
  const [evidence, experiments, doneChecks] = await Promise.all([
    rm.listEvidence(tenantId, id),
    rm.listExperiments(tenantId, id),
    rm.computeDoneChecks(tenantId, id),
  ]);
  res.json({ mission, evidence, experiments, doneChecks });
});

revenueMissionsRouter.post("/:id/evidence", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "bad_id" });
  const parsed = missionEvidenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  try {
    const evidence = await rm.addEvidence({ tenantId, missionId: id, ...parsed.data });
    if (!evidence) return res.status(200).json({ evidence: null, duplicate: true });
    res.status(201).json({ evidence });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

revenueMissionsRouter.post("/:id/experiments/draft", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "bad_id" });
  const parsed = missionDraftExperimentSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  try {
    const { draftSampleExperiment } = await import("../lib/mission-sample-harvest");
    const result = await draftSampleExperiment({ tenantId, missionId: id, name: parsed.data.name });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

revenueMissionsRouter.post("/:id/experiments/:eid/approve", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  const id = parseId(req.params.id);
  const eid = parseId(req.params.eid);
  if (id == null || eid == null) return res.status(400).json({ error: "bad_id" });
  try {
    // The experiment must belong to the mission in the URL (reject mismatches).
    const existing = await rm.getExperiment(tenantId, eid);
    if (!existing || Number(existing.mission_id) !== id) return res.status(404).json({ error: "not_found" });
    const experiment = await rm.approveExperiment(tenantId, eid, "owner");
    if (!experiment) return res.status(404).json({ error: "not_found" });
    // S3: approval immediately wires the capped send (sequence + enrollments).
    // Idempotent — a second approve returns alreadyRan and creates nothing new.
    const { runApprovedExperiment } = await import("../lib/mission-experiment-run");
    const run = await runApprovedExperiment({ tenantId, experimentId: eid });
    res.json({ experiment, run });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

// Autonomy ladder (S5c) — HITL like approve/kill: level changes happen ONLY
// here (owner session), NEVER via an agent tool. Fail closed on junk levels.
revenueMissionsRouter.post("/:id/autonomy", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "bad_id" });
  const parsed = missionAutonomySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  try {
    const { parseAutonomyLevel } = await import("../lib/mission-autonomy");
    const level = parseAutonomyLevel(parsed.data.level);
    if (level == null) return res.status(400).json({ error: "bad_level" });
    const mission = await rm.getMission(tenantId, id);
    if (!mission) return res.status(404).json({ error: "not_found" });
    if (mission.stage === "killed") return res.status(400).json({ error: "mission_killed" });
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const result: any = await db.execute(sql`
      UPDATE revenue_missions
      SET autonomy_level = ${level}, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING *
    `);
    const updated = ((result?.rows ?? result) as any[])[0];
    console.log(`[mission-autonomy] owner set mission ${id} autonomy_level → ${level}`);
    res.json({ mission: updated });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});

revenueMissionsRouter.post("/:id/kill", async (req: Request, res: Response) => {
  const tenantId = ownerTenantOrNull(req);
  if (tenantId == null) return res.status(403).json({ error: "owner_only" });
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "bad_id" });
  const parsed = missionKillSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  try {
    const mission = await rm.setStage(tenantId, id, "killed", parsed.data.reason);
    if (!mission) return res.status(404).json({ error: "not_found" });
    // S3: kill freezes outreach — stop live/paused enrollments, cancel experiments.
    const { pauseMissionEnrollments } = await import("../lib/mission-experiment-run");
    const paused = await pauseMissionEnrollments(tenantId, id);
    res.json({ mission, paused });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || err) });
  }
});
