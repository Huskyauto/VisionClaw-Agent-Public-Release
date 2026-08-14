/**
 * server/agentic/harness-injection.ts — RUNTIME side of per-model harness
 * adaptation (Self-Harness, arXiv:2606.09498). Reads the `active` per-model
 * addenda once, caches them in-memory (TTL), and hands runLlmTask a ready
 * system-prompt suffix keyed on the active model id.
 *
 * Imported by the hot path (server/llm-task.ts), so it stays lean: db + the pure
 * lib only — NOT llm-task / providers / jury (those live in the nightly module).
 * Every read fails OPEN: an adaptation lookup must never block or break a task.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { ADMIN_TENANT_ID } from "../tenant-constants";
import { buildModelInjection, type DeltaLike } from "./harness-addendum-lib";

const TTL_MS = 5 * 60 * 1000; // 5-minute cache; nightly writes are infrequent

interface HarnessCache {
  byModel: Map<string, string>;
  expires: number;
}
let cache: HarnessCache | null = null;

async function loadActiveByModel(): Promise<Map<string, string>> {
  const res: any = await db.execute(
    sql`SELECT model_id, weakness, addendum
        FROM model_harness_deltas
        WHERE status = 'active' AND tenant_id = ${ADMIN_TENANT_ID}
        ORDER BY model_id, created_at ASC`,
  );
  const rows: any[] = (res as any).rows || res || [];
  const grouped = new Map<string, DeltaLike[]>();
  for (const r of rows) {
    const modelId = String(r.model_id || "");
    if (!modelId) continue;
    if (!grouped.has(modelId)) grouped.set(modelId, []);
    grouped.get(modelId)!.push({ weakness: String(r.weakness || ""), addendum: String(r.addendum || "") });
  }
  const byModel = new Map<string, string>();
  for (const [modelId, deltas] of grouped) {
    const suffix = buildModelInjection(deltas);
    if (suffix) byModel.set(modelId, suffix);
  }
  return byModel;
}

/**
 * Return the validated, model-specific system-prompt suffix for `modelId`, or ""
 * if none. Cached for TTL_MS. FAILS OPEN — any error returns "" so a task is
 * never blocked or broken by the adaptation layer.
 */
export async function getModelHarnessSuffix(modelId: string): Promise<string> {
  if (!modelId) return "";
  try {
    if (!cache || Date.now() > cache.expires) {
      cache = { byModel: await loadActiveByModel(), expires: Date.now() + TTL_MS };
    }
    return cache.byModel.get(modelId) || "";
  } catch {
    return ""; // fail-open
  }
}

/** Drop the in-memory cache — used by the nightly loop after it applies a delta, and by tests. */
export function clearHarnessCache(): void {
  cache = null;
}
