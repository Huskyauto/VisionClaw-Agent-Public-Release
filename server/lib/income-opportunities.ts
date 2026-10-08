import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { incomeOpportunities, fileIncomeOpportunitySchema } from "@shared/schema";
import { INCOME_OPPORTUNITIES } from "../../client/src/data/income-opportunities";
import {
  parseDrizzleOverviewCountResult,
  parseDrizzleOverviewPageResult,
} from "./owner-business-overview";
export { INCOME_OPPORTUNITIES };
import type { z } from "zod";

type Filing = z.infer<typeof fileIncomeOpportunitySchema>;
const seededTenants = new Set<number>();

// The former static catalog is now an idempotent bootstrap source, not a second
// list read by the UI. Unique (tenant, slug) also protects concurrent bootstraps.
export async function ensureOpportunityCatalog(tenantId: number) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error("Invalid tenant");
  if (seededTenants.has(tenantId)) return;
  await db.insert(incomeOpportunities).values(INCOME_OPPORTUNITIES.map((item) => ({
    tenantId,
    slug: item.slug,
    name: item.name,
    category: item.category,
    evidence: item.evidence,
    buyer: item.buyer,
    problem: item.problem,
    entryOffer: item.entryOffer,
    price: item.price,
    expansion: item.expansion,
    nextStep: item.nextStep,
    featured: item.featured ?? false,
    actionPath: item.actionPath ?? null,
    source: "catalog",
  }))).onConflictDoNothing();
  seededTenants.add(tenantId);
}

export async function listIncomeOpportunities(tenantId: number) {
  await ensureOpportunityCatalog(tenantId);
  return db.select().from(incomeOpportunities)
    .where(eq(incomeOpportunities.tenantId, tenantId))
    .orderBy(incomeOpportunities.id);
}

/** SELECT-only view for agent review; unlike the UI list, never seeds rows. */
export async function readStoredIncomeOpportunities(tenantId: number) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error("Invalid tenant");
  return db.select().from(incomeOpportunities)
    .where(eq(incomeOpportunities.tenantId, tenantId))
    .orderBy(desc(incomeOpportunities.id)).limit(100);
}

/** Tenant-scoped counted page for the read-only, bounded owner overview. */
export async function countStoredIncomeOpportunities(tenantId: number) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error("Invalid tenant");
  const result = await db.select({ total: count() }).from(incomeOpportunities)
    .where(eq(incomeOpportunities.tenantId, tenantId));
  return parseDrizzleOverviewCountResult(result);
}

/** Ordered by the stable unique id; unlike the legacy UI reader this does not seed. */
export async function readStoredIncomeOpportunityPage(tenantId: number, offset: number, limit: number) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error("Invalid tenant");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 8) {
    throw new Error("Invalid overview page bounds");
  }
  const result = await db.select({
    id: incomeOpportunities.id,
    slug: incomeOpportunities.slug,
    name: incomeOpportunities.name,
    category: incomeOpportunities.category,
    buyer: incomeOpportunities.buyer,
    problem: incomeOpportunities.problem,
    entryOffer: incomeOpportunities.entryOffer,
    price: incomeOpportunities.price,
    expansion: incomeOpportunities.expansion,
    nextStep: incomeOpportunities.nextStep,
    evidence: incomeOpportunities.evidence,
    source: incomeOpportunities.source,
  }).from(incomeOpportunities)
    .where(eq(incomeOpportunities.tenantId, tenantId))
    .orderBy(desc(incomeOpportunities.id))
    .limit(limit)
    .offset(offset);
  return parseDrizzleOverviewPageResult(result);
}

export async function fileIncomeOpportunity(tenantId: number, data: Filing) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error("Invalid tenant");
  const input = fileIncomeOpportunitySchema.parse(data);
  const slug = input.name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140);
  if (slug.length < 3) throw new Error("Name needs at least three letters or digits");
  await ensureOpportunityCatalog(tenantId);
  const [created] = await db.insert(incomeOpportunities).values({
    ...input,
    tenantId,
    slug,
    evidence: "Idea",
    source: "felix",
    featured: false,
  }).onConflictDoNothing().returning();
  const opportunity = created ?? (await db.select().from(incomeOpportunities)
    .where(and(eq(incomeOpportunities.tenantId, tenantId), eq(incomeOpportunities.slug, slug))))[0];
  if (!opportunity) throw new Error("Opportunity save could not be verified");
  if (!created && opportunity.name.toLowerCase().trim() !== input.name.toLowerCase().trim()) {
    throw new Error("An opportunity with a different name already has this identifier");
  }
  console.info("[income-opportunities] filed", { tenantId, id: opportunity.id, created: !!created });
  return { opportunity, created: !!created };
}