import { sql } from "drizzle-orm";
import { db } from "../db";

export const BUSINESS_OPPORTUNITY_TAG = "business-opportunity";
export const INCOME_PRODUCT_TAG = "income-product";
const MAX_PROMOTIONS = 5;

export interface IdeaBrowserLifecycleProject {
  id: number;
  tags: string[];
  metadata: Record<string, any>;
}

function hasTag(project: IdeaBrowserLifecycleProject, tag: string): boolean {
  return (project.tags || []).includes(tag);
}

function compositeOf(project: IdeaBrowserLifecycleProject): number | null {
  const value = project.metadata?.priority?.composite;
  const composite = typeof value === "number" ? value : Number(value);
  return Number.isFinite(composite) ? composite : null;
}

/** Pure ranking contract, kept query-free so the ordering is easy to verify. */
export function rankEligibleIdeas(projects: IdeaBrowserLifecycleProject[]): IdeaBrowserLifecycleProject[] {
  return projects
    .filter((project) =>
      hasTag(project, "idea-stage") &&
      ["ideabrowser", "isenberg", "iotd"].some((tag) => hasTag(project, tag)) &&
      !hasTag(project, "ideabrowser-weekly-run") &&
      !hasTag(project, "ideabrowser-master-run") &&
      !hasTag(project, INCOME_PRODUCT_TAG) &&
      compositeOf(project) !== null
    )
    .sort((a, b) => {
      const scoreDelta = (compositeOf(b) as number) - (compositeOf(a) as number);
      return scoreDelta || b.id - a.id;
    })
    .slice(0, MAX_PROMOTIONS);
}

function withOpportunityMetadata(metadata: Record<string, any>, promotedAt: string) {
  return {
    ...metadata,
    ideabrowserOpportunity: {
      ...(metadata.ideabrowserOpportunity || {}),
      source: "ideabrowser",
      promotedAt,
    },
  };
}

export function addBusinessOpportunity<T extends IdeaBrowserLifecycleProject>(project: T, promotedAt = new Date().toISOString()): T {
  if (hasTag(project, BUSINESS_OPPORTUNITY_TAG) || hasTag(project, INCOME_PRODUCT_TAG)) return project;
  return {
    ...project,
    tags: [...(project.tags || []), BUSINESS_OPPORTUNITY_TAG],
    metadata: withOpportunityMetadata(project.metadata || {}, promotedAt),
  };
}

export function moveToIncomeProduct<T extends IdeaBrowserLifecycleProject>(project: T, movedAt = new Date().toISOString()): T {
  if (hasTag(project, INCOME_PRODUCT_TAG) || !hasTag(project, BUSINESS_OPPORTUNITY_TAG)) return project;
  const metadata = project.metadata || {};
  return {
    ...project,
    tags: [...(project.tags || []).filter((tag) => tag !== BUSINESS_OPPORTUNITY_TAG), INCOME_PRODUCT_TAG],
    metadata: {
      ...metadata,
      ideabrowserOpportunity: {
        ...(metadata.ideabrowserOpportunity || {}),
        incomeProductAt: movedAt,
      },
    },
  };
}

export interface OpportunityPromotionSummary {
  newlyPromotedIds: number[];
  disabled: boolean;
}

/**
 * Promote at most five rows in one tenant-scoped, rechecked UPDATE. The
 * absent-tag predicate makes retries and concurrent daily handlers idempotent.
 */
export async function promoteTopIdeaBrowserOpportunities(tenantId: number): Promise<OpportunityPromotionSummary> {
  if (process.env.IDEABROWSER_OPPORTUNITY_PROMOTION_DISABLED === "1") {
    return { newlyPromotedIds: [], disabled: true };
  }

  const result: any = await db.execute(sql`
    WITH scoreable AS (
      SELECT id,
        CASE
          WHEN length(metadata #>> '{priority,composite}') <= 12
            AND metadata #>> '{priority,composite}' ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN (metadata #>> '{priority,composite}')::double precision
          ELSE NULL
        END AS composite
      FROM projects
      WHERE tenant_id = ${tenantId}
        AND 'idea-stage' = ANY(tags)
        AND ('ideabrowser' = ANY(tags) OR 'isenberg' = ANY(tags) OR 'iotd' = ANY(tags))
        AND NOT ('ideabrowser-weekly-run' = ANY(tags))
        AND NOT ('ideabrowser-master-run' = ANY(tags))
        AND NOT (${INCOME_PRODUCT_TAG} = ANY(tags))
    ),
    eligible AS (
      SELECT id, composite,
        ROW_NUMBER() OVER (
          ORDER BY composite DESC, id DESC
        ) AS opportunity_rank
      FROM scoreable
      WHERE composite IS NOT NULL
      ORDER BY composite DESC, id DESC
      LIMIT 5
    )
    UPDATE projects AS p
    SET tags = array_append(COALESCE(p.tags, ARRAY[]::text[]), ${BUSINESS_OPPORTUNITY_TAG}),
        metadata = (CASE WHEN jsonb_typeof(p.metadata) = 'object' THEN p.metadata ELSE '{}'::jsonb END) || jsonb_build_object(
          'ideabrowserOpportunity',
          (CASE WHEN jsonb_typeof(p.metadata->'ideabrowserOpportunity') = 'object' THEN p.metadata->'ideabrowserOpportunity' ELSE '{}'::jsonb END) ||
            jsonb_build_object(
              'source', 'ideabrowser',
              'promotedAt', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'composite', eligible.composite,
               'rankAtPromotion', eligible.opportunity_rank
            )
        ),
        updated_at = CURRENT_TIMESTAMP
    FROM eligible
    WHERE p.id = eligible.id
      AND p.tenant_id = ${tenantId}
      AND NOT (${BUSINESS_OPPORTUNITY_TAG} = ANY(p.tags))
      AND NOT (${INCOME_PRODUCT_TAG} = ANY(p.tags))
    RETURNING p.id
  `);
  const rows = (result as any).rows || result;
  return {
    newlyPromotedIds: Array.isArray(rows) ? rows.map((row: any) => Number(row.id)) : [],
    disabled: false,
  };
}

export async function transitionBusinessOpportunityToIncomeProduct(tenantId: number, projectId: number) {
  const result: any = await db.execute(sql`
    UPDATE projects
    SET tags = array_append(
      array_remove(COALESCE(tags, ARRAY[]::text[]), ${BUSINESS_OPPORTUNITY_TAG}),
      ${INCOME_PRODUCT_TAG}
    ),
    metadata = (CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END) || jsonb_build_object(
      'ideabrowserOpportunity',
      (CASE WHEN jsonb_typeof(metadata->'ideabrowserOpportunity') = 'object' THEN metadata->'ideabrowserOpportunity' ELSE '{}'::jsonb END) ||
        jsonb_build_object(
          'source', 'ideabrowser',
          'incomeProductAt', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE id = ${projectId}
      AND tenant_id = ${tenantId}
      AND ${BUSINESS_OPPORTUNITY_TAG} = ANY(tags)
      AND NOT (${INCOME_PRODUCT_TAG} = ANY(tags))
      AND ('ideabrowser' = ANY(tags) OR 'isenberg' = ANY(tags) OR 'iotd' = ANY(tags))
    RETURNING *
  `);
  const rows = (result as any).rows || result;
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}
