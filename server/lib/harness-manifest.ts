/**
 * Durable provenance for the mutable execution harness.
 *
 * The snapshot describes the effective configuration an evaluator or harness
 * candidate used. It is intentionally metadata-only: secrets and raw learned
 * addendum text are stripped, while each learned addendum is represented by an
 * immutable content hash. Repeated captures of the same tenant-scoped snapshot
 * collapse onto one row via the content hash.
 */

import { and, asc, eq } from "drizzle-orm";
import { withTenantTx } from "../db";
import { harnessManifests, modelHarnessDeltas } from "@shared/schema";
import {
  buildHarnessManifest,
  buildProfiledHarnessManifest,
  type HarnessManifestProfile,
} from "./harness-manifest-core";

export const HARNESS_MANIFEST_SCHEMA_VERSION = 1;

export interface CaptureHarnessManifestInput {
  tenantId: number;
  profile: HarnessManifestProfile;
}

export interface HarnessManifestRef {
  id: number;
  hash: string;
}

interface ActiveAddendumRow {
  id: number;
  modelId: string;
  weakness: string;
  addendum: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

function enabled(): boolean {
  return process.env.HARNESS_MANIFEST_ENABLED !== "0";
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

/**
 * Create or retrieve the content-addressed manifest for an evaluation or
 * candidate. A write failure throws: callers must not persist a record that
 * claims to be reproducible when it has no provenance identity.
 *
 * `HARNESS_MANIFEST_ENABLED=0` is an operator kill switch. It is intentionally
 * visible to callers as null so their durable record says provenance was off.
 */
export async function captureHarnessManifest(
  input: CaptureHarnessManifestInput,
): Promise<HarnessManifestRef | null> {
  if (!enabled()) return null;
  if (!Number.isInteger(input.tenantId) || input.tenantId <= 0) {
    throw new Error("captureHarnessManifest requires a positive tenantId");
  }

  const activeAddenda: ActiveAddendumRow[] = await withTenantTx(input.tenantId, async (tx) => {
    return tx
      .select({
        id: modelHarnessDeltas.id,
        modelId: modelHarnessDeltas.modelId,
        weakness: modelHarnessDeltas.weakness,
        addendum: modelHarnessDeltas.addendum,
        createdAt: modelHarnessDeltas.createdAt,
        updatedAt: modelHarnessDeltas.updatedAt,
      })
      .from(modelHarnessDeltas)
      .where(and(
        eq(modelHarnessDeltas.tenantId, input.tenantId),
        eq(modelHarnessDeltas.status, "active"),
      ))
      .orderBy(asc(modelHarnessDeltas.modelId), asc(modelHarnessDeltas.id));
  });

  const addenda = activeAddenda.map((row) => ({
    id: row.id,
    modelId: row.modelId,
    weakness: row.weakness,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    addendum: row.addendum,
  }));
  const built = buildProfiledHarnessManifest({
    schemaVersion: HARNESS_MANIFEST_SCHEMA_VERSION,
    profile: input.profile,
    activeAddenda: addenda,
  });

  return withTenantTx(input.tenantId, async (tx) => {
    await tx
      .insert(harnessManifests)
      .values({
        tenantId: input.tenantId,
        manifestHash: built.hash,
        snapshot: built.snapshot,
      })
      .onConflictDoNothing({
        target: [harnessManifests.tenantId, harnessManifests.manifestHash],
      });

    const rows = await tx
      .select({
        id: harnessManifests.id,
        manifestHash: harnessManifests.manifestHash,
        snapshot: harnessManifests.snapshot,
      })
      .from(harnessManifests)
      .where(and(
        eq(harnessManifests.tenantId, input.tenantId),
        eq(harnessManifests.manifestHash, built.hash),
      ))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error("Harness manifest was not readable after upsert");
    if (
      row.manifestHash !== built.hash ||
      buildHarnessManifest(row.snapshot).hash !== built.hash
    ) {
      throw new Error("Harness manifest integrity check failed after upsert");
    }
    console.log(`[harness-manifest] ${input.profile.kind} captured ${built.hash.slice(0, 12)}`);
    return { id: row.id, hash: built.hash };
  });
}