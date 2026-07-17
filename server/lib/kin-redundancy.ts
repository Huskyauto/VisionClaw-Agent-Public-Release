// R98.25 — MNEMA Nugget 4: decorrelated fragment redundancy for load-bearing facts.
//
// MNEMA (Smith, Gentic Lab, EUMAS 2026) Theorem 3 / Corollary 2: storing a
// load-bearing fact k times offers no real protection unless the k copies are
// extracted by DIFFERENT model families, from DIFFERENT source documents, via
// DIFFERENT ingestion pipelines. Otherwise the AgentPoison-class attack that
// compromised one extractor / one source / one pipeline corrupts all k copies
// simultaneously.
//
// We adapt the idea narrowly: only "load-bearing" facts (financial commitments,
// contract terms, customer SLAs, billing entitlements) get the kin treatment.
// Routine preferences and observations stay as single rows — kin redundancy at
// k=5 multiplies storage cost by ~5x, which doesn't earn its keep for chatter.
//
// Two operations:
//   1) recordKinFact() — write a single fact to the canonical memory_entries
//      table, tagged with a shared kin_group_id and a provenance triple.
//      Caller is expected to call this k times across decorrelated extractors.
//   2) kinDiversityScore() — given a kin_group_id, return a 0..1 score = number
//      of distinct provenance families divided by 5 (ceiled). Retrieval can
//      use this as a confidence multiplier or a threshold.
//
// What this module does NOT do (deferred wiring):
//   - The actual k=5 fan-out across extractors. That's an ingestion-pipeline
//     concern; this module gives the storage primitive only.
//   - Modify default vector retrieval. Today retrieval treats all matching
//     active rows equally; a future patch can prefer rows whose kin diversity
//     score is high. Opt-in only for now.

import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "node:crypto";

export interface ProvenanceTriple {
  /** Model family that extracted the fact (e.g. "openai", "anthropic", "gemini", "deepseek", "human"). */
  extractorFamily: string;
  /** Stable identifier for the source-document root (URL host, file hash, "persona_chat", etc). */
  sourceRoot: string;
  /** Ingestion pipeline that produced the row ("memory-queue-v1", "chat-extractor", "manual-import", "doc-collection"). */
  ingestionPipeline: string;
}

const VALID_FAMILIES = new Set([
  "openai", "anthropic", "gemini", "google", "deepseek", "xai", "openrouter",
  "human", "manual", "external_api", "tool", "unknown",
]);

const MIN_FAMILIES_FOR_DIVERSITY = 3;
const TARGET_K = 5;

/**
 * Generate a fresh kin_group_id. Callers should reuse this across k=5 inserts
 * that share a single underlying claim.
 */
export function newKinGroupId(): string {
  // 12 bytes = 96 bits, enough entropy that collisions across the lifetime of
  // the platform are vanishingly unlikely; URL-safe base64 keeps it portable.
  return "kin_" + crypto.randomBytes(12).toString("base64url");
}

/**
 * Validate a provenance triple before it touches the DB. Fails CLOSED — a
 * malformed triple defeats the whole defense, so we'd rather refuse the write
 * than store a kin row with garbage metadata.
 */
export function validateProvenance(p: ProvenanceTriple): { ok: boolean; error?: string } {
  if (!p || typeof p !== "object") return { ok: false, error: "provenance triple required" };
  if (!p.extractorFamily || typeof p.extractorFamily !== "string") return { ok: false, error: "extractorFamily required" };
  if (!p.sourceRoot || typeof p.sourceRoot !== "string") return { ok: false, error: "sourceRoot required" };
  if (!p.ingestionPipeline || typeof p.ingestionPipeline !== "string") return { ok: false, error: "ingestionPipeline required" };
  const fam = p.extractorFamily.toLowerCase();
  if (!VALID_FAMILIES.has(fam)) {
    return { ok: false, error: `unknown extractor family "${fam}" (allowed: ${[...VALID_FAMILIES].join(", ")})` };
  }
  if (p.sourceRoot.length > 500 || p.ingestionPipeline.length > 200) {
    return { ok: false, error: "sourceRoot or ingestionPipeline exceeds length cap" };
  }
  return { ok: true };
}

/**
 * Stamp an existing memory_entries row with a kin_group_id + provenance.
 * Use this when you already have the row id (e.g. from createMemoryEntry).
 *
 * Same-tenant check is enforced — silently linking another tenant's row would
 * leak the kin pointer.
 */
export async function attachKinProvenance(opts: {
  memoryEntryId: number;
  tenantId: number;
  kinGroupId: string;
  provenance: ProvenanceTriple;
}): Promise<{ ok: boolean; error?: string }> {
  const { memoryEntryId, tenantId, kinGroupId, provenance } = opts;
  if (!tenantId) return { ok: false, error: "tenantId required" };
  if (!Number.isInteger(memoryEntryId) || memoryEntryId <= 0) {
    return { ok: false, error: "memoryEntryId must be positive integer" };
  }
  if (!kinGroupId || !kinGroupId.startsWith("kin_")) {
    return { ok: false, error: "kinGroupId must start with 'kin_' (use newKinGroupId())" };
  }
  const v = validateProvenance(provenance);
  if (!v.ok) return v;
  try {
    const result = await db.execute(sql`
      UPDATE memory_entries
      SET kin_group_id = ${kinGroupId},
          provenance_triple = ${JSON.stringify({
            extractorFamily: provenance.extractorFamily.toLowerCase(),
            sourceRoot: provenance.sourceRoot,
            ingestionPipeline: provenance.ingestionPipeline,
          })}::jsonb
      WHERE id = ${memoryEntryId}
        AND tenant_id = ${tenantId}
      RETURNING id
    `);
    const rows = (result as any).rows || result;
    if (!rows || rows.length === 0) {
      return { ok: false, error: "memory entry not found or wrong tenant" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message?.slice(0, 200) || "unknown" };
  }
}

/**
 * Compute kin diversity for a group. Returns:
 *   - kinCount: number of active kin entries
 *   - distinctFamilies: how many distinct extractor families wrote them
 *   - diversityScore: distinctFamilies / TARGET_K, clamped to [0,1]
 *   - meetsThreshold: distinctFamilies >= MIN_FAMILIES_FOR_DIVERSITY (default 3)
 *
 * meetsThreshold = true is the binary "this fact is well-attested" signal a
 * retrieval scorer can use to break ties or down-weight unattested facts.
 */
export async function kinDiversityScore(
  kinGroupId: string,
  tenantId: number,
): Promise<{ kinCount: number; distinctFamilies: number; diversityScore: number; meetsThreshold: boolean } | null> {
  if (!kinGroupId || !tenantId) return null;
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int AS kin_count,
        COUNT(DISTINCT (provenance_triple->>'extractorFamily'))::int AS distinct_families
      FROM memory_entries
      WHERE kin_group_id = ${kinGroupId}
        AND tenant_id = ${tenantId}
        AND status = 'active'
    `);
    const rows = (result as any).rows || result;
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    const kinCount = Number(r.kin_count) || 0;
    const distinctFamilies = Number(r.distinct_families) || 0;
    return {
      kinCount,
      distinctFamilies,
      diversityScore: Math.min(1, distinctFamilies / TARGET_K),
      meetsThreshold: distinctFamilies >= MIN_FAMILIES_FOR_DIVERSITY,
    };
  } catch {
    return null;
  }
}
