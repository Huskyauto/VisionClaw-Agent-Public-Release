import type { Express, NextFunction, Request, Response } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  commercialResearchOpportunities,
  type CommercialResearchOpportunity,
  type InsertCommercialResearchOpportunity,
} from "@shared/schema";
import {
  calculateCommercialOpportunityScore,
  commercialOpportunityCreateSchema,
  commercialOpportunityListQuerySchema,
  commercialOpportunityPatchSchema,
  mergeCommercialOpportunityPatch,
  sameCommercialOpportunityPayload,
  type CommercialOpportunityPatch,
} from "../lib/commercial-research-frontier";

type OpportunityPatch = CommercialOpportunityPatch & {
  scoreResult?: ReturnType<typeof calculateCommercialOpportunityScore>;
};
type ListFilters = { page: number; limit: number; q?: string; maturity?: string; status?: string };

export interface CommercialResearchFrontierStore {
  list(tenantId: number, filters: ListFilters): Promise<{ opportunities: CommercialResearchOpportunity[]; total: number }>;
  findById(tenantId: number, id: number): Promise<CommercialResearchOpportunity | undefined>;
  findByKey(tenantId: number, idempotencyKey: string): Promise<CommercialResearchOpportunity | undefined>;
  create(row: InsertCommercialResearchOpportunity): Promise<CommercialResearchOpportunity>;
  update(tenantId: number, id: number, patch: OpportunityPatch): Promise<
    | { kind: "updated"; opportunity: CommercialResearchOpportunity }
    | { kind: "not_found" }
    | { kind: "invalid"; issues: unknown[] }
  >;
}

function productionStore(): CommercialResearchFrontierStore {
  return {
    list: async (tenantId, filters) => {
      const conditions = [eq(commercialResearchOpportunities.tenantId, tenantId)];
      if (filters.maturity) conditions.push(eq(commercialResearchOpportunities.maturity, filters.maturity));
      if (filters.status) conditions.push(eq(commercialResearchOpportunities.lifecycleStatus, filters.status));
      if (filters.q) {
        const pattern = `%${filters.q}%`;
        const search = or(
          ilike(commercialResearchOpportunities.title, pattern),
          ilike(commercialResearchOpportunities.buyer, pattern),
          ilike(commercialResearchOpportunities.offerHypothesis, pattern),
        );
        if (search) conditions.push(search);
      }
      const where = and(...conditions);
      const opportunities = await db.select().from(commercialResearchOpportunities).where(where)
        .orderBy(desc(commercialResearchOpportunities.updatedAt), desc(commercialResearchOpportunities.id))
        .limit(filters.limit).offset((filters.page - 1) * filters.limit);
      const [countRow] = await db.select({ total: sql<number>`count(*)::int` })
        .from(commercialResearchOpportunities).where(where);
      return { opportunities, total: Number(countRow?.total ?? 0) };
    },
    findById: async (tenantId, id) => {
      const [row] = await db.select().from(commercialResearchOpportunities).where(and(
        eq(commercialResearchOpportunities.tenantId, tenantId),
        eq(commercialResearchOpportunities.id, id),
      )).limit(1);
      return row;
    },
    findByKey: async (tenantId, idempotencyKey) => {
      const [row] = await db.select().from(commercialResearchOpportunities).where(and(
        eq(commercialResearchOpportunities.tenantId, tenantId),
        eq(commercialResearchOpportunities.idempotencyKey, idempotencyKey),
      )).limit(1);
      return row;
    },
    create: async row => {
      const [created] = await db.insert(commercialResearchOpportunities).values(row).returning();
      if (!created) throw new Error("opportunity insert returned no row");
      return created;
    },
    update: async (tenantId, id, patch) => db.transaction(async tx => {
      const [current] = await tx.select().from(commercialResearchOpportunities).where(and(
        eq(commercialResearchOpportunities.tenantId, tenantId),
        eq(commercialResearchOpportunities.id, id),
      )).for("update").limit(1);
      if (!current) return { kind: "not_found" as const };
      const { scoreResult: _computedScore, ...semanticPatch } = patch;
      const merged = mergeCommercialOpportunityPatch(
        current as unknown as Record<string, unknown>,
        semanticPatch,
      );
      if (!merged.success) return { kind: "invalid" as const, issues: merged.error.issues };
      const [opportunity] = await tx.update(commercialResearchOpportunities)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(
          eq(commercialResearchOpportunities.tenantId, tenantId),
          eq(commercialResearchOpportunities.id, id),
        )).returning();
      if (!opportunity) return { kind: "not_found" as const };
      return { kind: "updated" as const, opportunity };
    }),
  };
}

const enabled = () => process.env.RESEARCH_FRONTIER_ENABLED !== "0";
const setNoCache = (res: Response) => res.set("Cache-Control", "private, no-store, max-age=0");

function tenantOrRespond(req: Request, res: Response, getTenant: (req: Request) => number | null): number | null {
  const tenantId = getTenant(req);
  if (!Number.isInteger(tenantId) || tenantId! <= 0) {
    res.status(401).json({ error: "tenant context required" });
    return null;
  }
  setNoCache(res);
  return tenantId!;
}

function audit(action: string, tenantId: number, opportunityId: number, status: string) {
  console.info("[commercial-research-frontier:audit]", { action, tenantId, opportunityId, status });
}

function logFailure(operation: string, tenantId: number, error: unknown, opportunityId?: number) {
  console.error(
    "[commercial-research-frontier:error]",
    opportunityId === undefined ? { operation, tenantId } : { operation, tenantId, opportunityId },
    error,
  );
}

export function registerCommercialResearchFrontierRoutes(app: Express, deps: {
  authMiddleware: (req: Request, res: Response, next: NextFunction) => unknown;
  requirePlatformAdmin: (req: Request, res: Response) => boolean;
  getTenantFromRequest: (req: Request) => number | null;
  store?: CommercialResearchFrontierStore;
}) {
  const store = deps.store ?? productionStore();
  const featureGuard = (_req: Request, res: Response, next: NextFunction) => {
    if (!enabled()) return res.status(404).json({ error: "feature disabled" });
    next();
  };
  const ownerGuard = (req: Request, res: Response, next: NextFunction) => {
    if (deps.requirePlatformAdmin(req, res)) next();
  };
  const middleware = [featureGuard, deps.authMiddleware, ownerGuard] as const;

  app.get("/api/admin/research-frontier/opportunities", ...middleware, async (req, res) => {
    const tenantId = tenantOrRespond(req, res, deps.getTenantFromRequest); if (!tenantId) return;
    const parsed = commercialOpportunityListQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "invalid filters", issues: parsed.error.issues });
    try {
      const result = await store.list(tenantId, parsed.data);
      res.json({ ...result, page: parsed.data.page, limit: parsed.data.limit });
    } catch (error) {
      logFailure("list", tenantId, error);
      res.status(500).json({ error: "unable to list opportunities" });
    }
  });

  app.get("/api/admin/research-frontier/opportunities/:id", ...middleware, async (req, res) => {
    const tenantId = tenantOrRespond(req, res, deps.getTenantFromRequest); if (!tenantId) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    try {
      const opportunity = await store.findById(tenantId, id);
      if (!opportunity) return res.status(404).json({ error: "opportunity not found" });
      res.json({ opportunity });
    } catch (error) {
      logFailure("read", tenantId, error, id);
      res.status(500).json({ error: "unable to read opportunity" });
    }
  });

  app.post("/api/admin/research-frontier/opportunities", ...middleware, async (req, res) => {
    const tenantId = tenantOrRespond(req, res, deps.getTenantFromRequest); if (!tenantId) return;
    const parsed = commercialOpportunityCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid opportunity", issues: parsed.error.issues });
    const requested = parsed.data;
    try {
      const existing = await store.findByKey(tenantId, requested.idempotencyKey);
      if (existing) {
        return sameCommercialOpportunityPayload(existing as unknown as Record<string, unknown>, requested)
          ? res.status(200).json({ opportunity: existing, idempotent: true })
          : res.status(409).json({ error: "idempotency key belongs to another opportunity" });
      }
      const opportunity = await store.create({
        ...requested,
        originRef: requested.originRef ?? null,
        validationEvidence: requested.validationEvidence ?? null,
        tenantId,
        scoreResult: calculateCommercialOpportunityScore(requested.scoreInputs),
      });
      audit("create", tenantId, opportunity.id, opportunity.lifecycleStatus);
      return res.status(201).json({ opportunity, idempotent: false });
    } catch (error) {
      logFailure("create", tenantId, error);
      try {
        const raced = await store.findByKey(tenantId, requested.idempotencyKey);
        if (raced) {
          return sameCommercialOpportunityPayload(raced as unknown as Record<string, unknown>, requested)
            ? res.status(200).json({ opportunity: raced, idempotent: true })
            : res.status(409).json({ error: "idempotency key belongs to another opportunity" });
        }
      } catch (reconcileError) {
        logFailure("create-reconcile", tenantId, reconcileError);
      }
      return res.status(500).json({ error: "unable to create opportunity" });
    }
  });

  app.patch("/api/admin/research-frontier/opportunities/:id", ...middleware, async (req, res) => {
    const tenantId = tenantOrRespond(req, res, deps.getTenantFromRequest); if (!tenantId) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid id" });
    const parsed = commercialOpportunityPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid opportunity update", issues: parsed.error.issues });
    try {
      const patch: OpportunityPatch = {
        ...parsed.data,
        ...(parsed.data.scoreInputs
          ? { scoreResult: calculateCommercialOpportunityScore(parsed.data.scoreInputs) }
          : {}),
      };
      const result = await store.update(tenantId, id, patch);
      if (result.kind === "not_found") return res.status(404).json({ error: "opportunity not found" });
      if (result.kind === "invalid") {
        return res.status(400).json({ error: "update would leave an invalid opportunity", issues: result.issues });
      }
      audit("update", tenantId, id, result.opportunity.lifecycleStatus);
      res.json({ opportunity: result.opportunity });
    } catch (error) {
      logFailure("update", tenantId, error, id);
      res.status(500).json({ error: "unable to update opportunity" });
    }
  });
}