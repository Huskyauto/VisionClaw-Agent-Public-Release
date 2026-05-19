// R98.25 — MNEMA Nugget 6: ecosystem health metrics.
//
// MNEMA (Smith, Gentic Lab, EUMAS 2026) §6 argues that any living memory
// system needs a small dashboard of "ecosystem" indicators that reveal
// pathologies invisible to per-row metrics:
//
//   1) DIVERSITY              — distinct authority-decisive sources per category.
//                               Low diversity = an attacker who compromises one
//                               source can poison a whole category.
//   2) COVERAGE               — fraction of categories served by at least one
//                               "adult" (mature, repeatedly-cited) source.
//                               Low coverage = blind spots.
//   3) CONTRADICTION DENSITY  — fraction of recent jury votes returning
//                               low-concordance (Nugget 3 κ < 0.5).
//                               High contradiction = retrieval is mixing facts
//                               from incompatible regimes (e.g. pre/post a
//                               policy change).
//   4) FRESHNESS MEDIAN       — median age of canonical (status='active')
//                               memory entries per category. High median = the
//                               knowledge base is drifting stale.
//
// All four are computable from data we already have:
//   diversity        ← memory_entries.provenance_triple->>'extractorFamily'
//   coverage         ← memory_entries.category presence
//   contradiction    ← moa_logs concordance distribution (R98.24 added the field)
//   freshness        ← memory_entries.created_at vs NOW
//
// Threshold defaults (tweakable):
//   diversity:    ≥ 3 distinct families per category
//   coverage:     ≥ 80% of categories have ≥ 5 active rows
//   contradiction: ≤ 15% of last-100 ensemble votes had κ<0.5
//   freshness:    median age of last-100 active rows ≤ 90 days

import { db } from "../db";
import { logSilentCatch } from "./silent-catch";
import { sql } from "drizzle-orm";

export interface EcosystemHealth {
  tenantId: number;
  computedAt: string;
  diversity: {
    perCategory: Array<{ category: string; distinctFamilies: number; rowCount: number }>;
    averageFamilies: number;
    threshold: number;
    breached: boolean;
  };
  coverage: {
    totalCategories: number;
    matureCategories: number;
    coverageRatio: number;
    threshold: number;
    breached: boolean;
  };
  contradiction: {
    sampleSize: number;
    lowConcordanceCount: number;
    contradictionRatio: number;
    threshold: number;
    breached: boolean;
  };
  freshness: {
    sampleSize: number;
    medianAgeDays: number;
    threshold: number;
    breached: boolean;
  };
  anyBreached: boolean;
}

const DEFAULTS = {
  diversityMinFamilies: 3,
  coverageMinRowsPerCategory: 5,
  coverageMinRatio: 0.8,
  contradictionWindow: 100,
  contradictionMaxRatio: 0.15,
  freshnessWindow: 100,
  freshnessMaxMedianDays: 90,
};

export async function computeEcosystemHealth(tenantId: number): Promise<EcosystemHealth | null> {
  if (!tenantId || !Number.isInteger(tenantId)) return null;

  // 1) Diversity per category — count distinct extractor families.
  // Categories with no provenance metadata (legacy rows) report distinctFamilies=0;
  // they don't fail the dashboard but flag as a gap.
  const diversityRows = await db.execute(sql`
    SELECT
      category,
      COUNT(*)::int AS row_count,
      COUNT(DISTINCT (provenance_triple->>'extractorFamily'))::int AS distinct_families
    FROM memory_entries
    WHERE tenant_id = ${tenantId}
      AND status = 'active'
    GROUP BY category
    ORDER BY row_count DESC
    LIMIT 50
  `);
  const dRows = ((diversityRows as any).rows || diversityRows) as any[];
  const perCategory = dRows.map(r => ({
    category: r.category,
    distinctFamilies: Number(r.distinct_families) || 0,
    rowCount: Number(r.row_count) || 0,
  }));
  const avgFamilies = perCategory.length > 0
    ? perCategory.reduce((s, c) => s + c.distinctFamilies, 0) / perCategory.length
    : 0;

  // 2) Coverage — what fraction of categories has at least N active rows.
  const totalCategories = perCategory.length;
  const matureCategories = perCategory.filter(c => c.rowCount >= DEFAULTS.coverageMinRowsPerCategory).length;
  const coverageRatio = totalCategories > 0 ? matureCategories / totalCategories : 1;

  // 3) Contradiction density — fraction of recent ensemble votes that fell
  //    below the κ<0.5 escalation threshold. We read from moa_logs which
  //    moa.ts populates; if it doesn't exist yet, treat as 0.
  let contradictionSample = 0, lowConcordance = 0;
  try {
    const cRows = await db.execute(sql`
      SELECT concordance
      FROM moa_responses
      WHERE tenant_id = ${tenantId}
        AND concordance IS NOT NULL
      ORDER BY id DESC
      LIMIT ${DEFAULTS.contradictionWindow}
    `);
    const rows = ((cRows as any).rows || cRows) as any[];
    contradictionSample = rows.length;
    lowConcordance = rows.filter(r => Number(r.concordance) < 0.5).length;
  } catch (_silentErr) { logSilentCatch("server/lib/ecosystem-health.ts", _silentErr); }
  const contradictionRatio = contradictionSample > 0 ? lowConcordance / contradictionSample : 0;

  // 4) Freshness median — how old is the median active memory row.
  const fRows = await db.execute(sql`
    WITH recent AS (
      SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0 AS age_days
      FROM memory_entries
      WHERE tenant_id = ${tenantId}
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT ${DEFAULTS.freshnessWindow}
    )
    SELECT
      COUNT(*)::int AS sample,
      COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY age_days), 0) AS median_age
    FROM recent
  `);
  const fRow = (((fRows as any).rows || fRows) as any[])[0] || {};
  const freshnessSample = Number(fRow.sample) || 0;
  const medianAgeDays = Number(fRow.median_age) || 0;

  const diversityBreached = perCategory.some(c => c.distinctFamilies < DEFAULTS.diversityMinFamilies && c.rowCount >= DEFAULTS.coverageMinRowsPerCategory);
  const coverageBreached = totalCategories > 0 && coverageRatio < DEFAULTS.coverageMinRatio;
  const contradictionBreached = contradictionSample >= 10 && contradictionRatio > DEFAULTS.contradictionMaxRatio;
  const freshnessBreached = freshnessSample >= 10 && medianAgeDays > DEFAULTS.freshnessMaxMedianDays;

  return {
    tenantId,
    computedAt: new Date().toISOString(),
    diversity: {
      perCategory,
      averageFamilies: Math.round(avgFamilies * 100) / 100,
      threshold: DEFAULTS.diversityMinFamilies,
      breached: diversityBreached,
    },
    coverage: {
      totalCategories,
      matureCategories,
      coverageRatio: Math.round(coverageRatio * 100) / 100,
      threshold: DEFAULTS.coverageMinRatio,
      breached: coverageBreached,
    },
    contradiction: {
      sampleSize: contradictionSample,
      lowConcordanceCount: lowConcordance,
      contradictionRatio: Math.round(contradictionRatio * 100) / 100,
      threshold: DEFAULTS.contradictionMaxRatio,
      breached: contradictionBreached,
    },
    freshness: {
      sampleSize: freshnessSample,
      medianAgeDays: Math.round(medianAgeDays * 10) / 10,
      threshold: DEFAULTS.freshnessMaxMedianDays,
      breached: freshnessBreached,
    },
    anyBreached: diversityBreached || coverageBreached || contradictionBreached || freshnessBreached,
  };
}
