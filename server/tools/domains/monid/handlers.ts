/**
 * Tools-layer-split S25r — monid-domain migrated handlers.
 *
 * Selection: the 4 contiguous Monid tools — `monid_discover`, `monid_inspect`,
 * `monid_run`, `monid_catalog_browse`. `discover`/`inspect`/`run` call
 * `server/lib/monid`; `catalog_browse` reads the FREE local curated snapshot
 * (data/monid/catalog-curated.json). All four fence upstream output through
 * `external-content-security` (`wrapExternalContent`) — one coherent cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added gate).
 *
 * SEAM (monid_run only): the legacy arm read `params._tenantId` in its per-tenant
 * cost-ledger block (`recordCost`). `_tenantId` is a dispatcher-STRIPPED trust
 * signal (TRUST_SIGNAL_KEYS in server/tools/context.ts), so the migrated handler
 * reads the trusted `ctx.tenantId` instead. Same value: the dispatcher derives
 * `ctx.tenantId` from the same pre-strip `params._tenantId` the legacy arm carried,
 * and both paths only record cost when a tenant is present (the `if (ctx.tenantId
 * && !error)` guard mirrors the legacy `if (params._tenantId && !error)`). The
 * backing `monidRun` fn takes explicit args and does NOT read `_tenantId`, so no
 * re-stamp is needed — this is the S25p (read-from-ctx) pattern, not the S25q
 * (re-stamp-passthrough) pattern. The other three handlers read only public params.
 *
 * All backing dependencies (`../../../lib/monid`, `../../../external-content-security`,
 * `../../../agentic/cost-ledger`) are pulled via call-time dynamic `import(...)`
 * inside each handler — NOT top-level static imports — so the domain module
 * statically imports only within server/tools/ and cannot recurse back into the app
 * graph (acyclicity invariant, plan.md S2). Node builtins use the `node:` prefix.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  monidDiscoverDefinition,
  monidInspectDefinition,
  monidRunDefinition,
  monidCatalogBrowseDefinition,
} from "./definitions";

async function monidDiscoverHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { monidDiscover } = await import("../../../lib/monid");
  const { wrapExternalContent } = await import("../../../external-content-security");
  const r = await monidDiscover({ query: params.query, limit: params.limit, minScore: params.minScore });
  if ((r as any)?.error) return r;
  const { wrapped } = wrapExternalContent(JSON.stringify(r), "web_fetch", { url: "monid://discover" });
  const arr = Array.isArray((r as any)?.results) ? (r as any).results : Array.isArray(r) ? r : [];
  return { ok: true, source: "monid_discover", result_count: arr.length, fenced: wrapped };
}

async function monidInspectHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { monidInspect } = await import("../../../lib/monid");
  const { wrapExternalContent } = await import("../../../external-content-security");
  const r = await monidInspect({ id: params.id });
  if ((r as any)?.error) return r;
  const { wrapped } = wrapExternalContent(JSON.stringify(r), "web_fetch", { url: `monid://inspect/${params.id}` });
  return { ok: true, source: "monid_inspect", id: params.id, fenced: wrapped };
}

async function monidRunHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { monidRun } = await import("../../../lib/monid");
  const { wrapExternalContent } = await import("../../../external-content-security");
  const r = await monidRun({ id: params.id, body: params.body, query: params.query, path: params.path, wait: params.wait, timeoutMs: params.timeoutMs });
  // R109 — record monid spend per tenant so a single tenant can't silently
  // burn the org-level Monid credit without showing up in cost analytics.
  // Flat $0.005/call estimate when the upstream doesn't echo a price; future
  // work: capture exact `price` field from inspect/discover payload upfront.
  if (ctx.tenantId && !(r as any)?.error) {
    try {
      const { recordCost } = await import("../../../agentic/cost-ledger");
      const upstreamPrice = Number((r as any)?.price ?? (r as any)?.usage?.cost ?? 0);
      await recordCost({
        tenantId: ctx.tenantId,
        toolName: "monid_run",
        costUsd: upstreamPrice > 0 ? upstreamPrice : 0.005,
        operation: `monid:${String(params.id || "").slice(0, 80)}`,
      });
    } catch (_silentErr) { const { logSilentCatch } = await import("../../../lib/silent-catch"); logSilentCatch("server/tools/domains/monid/handlers.ts", _silentErr); }
  }
  if ((r as any)?.error) return r;
  const { wrapped } = wrapExternalContent(JSON.stringify(r), "web_fetch", { url: `monid://run/${params.id}` });
  return { ok: true, source: "monid_run", id: params.id, fenced: wrapped };
}

async function monidCatalogBrowseHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const p = path.resolve(process.cwd(), "data/monid/catalog-curated.json");
    if (!fs.existsSync(p)) return { error: "Catalog snapshot not found. Run: npx tsx scripts/monid-catalog-survey.ts && npx tsx scripts/monid-catalog-curate.ts" };
    const cat = JSON.parse(fs.readFileSync(p, "utf-8"));
    const search = (params.search || "").toLowerCase();
    if (params.category && !cat.categories[params.category]) return { error: `Unknown category. Valid: ${Object.keys(cat.categories).join(", ")}` };
    const cats = params.category ? { [params.category]: cat.categories[params.category] } : cat.categories;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries<any>(cats)) {
      if (!v) continue;
      const eps = search ? v.endpoints.filter((e: any) => `${e.slug} ${e.description}`.toLowerCase().includes(search)) : v.endpoints;
      if (eps.length === 0 && search) continue;
      out[k] = { description: v.description, vcaUseCase: v.vcaUseCase, endpoints: eps };
    }
    const returned = Object.values(out).reduce((s: number, c: any) => s + c.endpoints.length, 0);
    const r = { ok: true, generatedAt: cat.generatedAt, totalCurated: cat.curatedEndpoints, returned, categories: out };
    const { wrapExternalContent } = await import("../../../external-content-security");
    const { wrapped } = wrapExternalContent(JSON.stringify(r), "web_fetch", { url: "monid://catalog-browse" });
    return { ok: true, source: "monid_catalog_browse", generatedAt: cat.generatedAt, total_curated: cat.curatedEndpoints, returned, fenced: wrapped };
  } catch (e: any) { return { error: `catalog_browse failed: ${e?.message || String(e)}` }; }
}

/** Registered by ./index.ts at import time. */
export const monidDomainTools: RegisteredTool[] = [
  defineTool(monidDiscoverDefinition, monidDiscoverHandler),
  defineTool(monidInspectDefinition, monidInspectHandler),
  defineTool(monidRunDefinition, monidRunHandler),
  defineTool(monidCatalogBrowseDefinition, monidCatalogBrowseHandler),
];
