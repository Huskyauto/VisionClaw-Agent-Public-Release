#!/usr/bin/env -S npx tsx
/**
 * R122 — CLI grep across the unified memory surface.
 *
 * Usage:
 *   npx tsx scripts/memory-find.ts "keyword"
 *   npx tsx scripts/memory-find.ts "keyword" --tenant=1 --since=30 --limit=50 --sources=memory_entries,agent_knowledge
 *
 * Exit codes: 0 = items found, 2 = no items, 1 = error.
 */
import { getUnifiedMemoryContext, ALL_UNIFIED_SOURCES, type UnifiedSource } from "../server/memory/unified-context";

function arg(name: string, def?: string): string | undefined {
  const flag = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(flag));
  return found ? found.slice(flag.length) : def;
}

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const query = positional.join(" ").trim() || undefined;
  const tenantArg = arg("tenant", process.env.TENANT_ID);
  if (!tenantArg) {
    console.error("ERROR: tenant required. Pass --tenant=N or set TENANT_ID=N env. No default fallback.");
    console.error("Usage: npx tsx scripts/memory-find.ts [query] --tenant=N [--since=N] [--limit=N] [--sources=a,b]");
    process.exit(1);
  }
  const tenantId = Number(tenantArg);
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    console.error(`ERROR: tenant must be a positive integer, got "${tenantArg}"`);
    process.exit(1);
  }
  const sinceDays = Number(arg("since", "90"));
  const limit = Number(arg("limit", "50"));
  const srcRaw = arg("sources");
  let sources: UnifiedSource[] | undefined;
  if (srcRaw) {
    const parts = srcRaw.split(",").map((s) => s.trim());
    sources = parts.filter((p): p is UnifiedSource =>
      (ALL_UNIFIED_SOURCES as readonly string[]).includes(p),
    );
    if (sources.length === 0) {
      console.error(`No valid sources in --sources=${srcRaw}. Valid: ${ALL_UNIFIED_SOURCES.join(",")}`);
      process.exit(1);
    }
  }

  try {
    const r = await getUnifiedMemoryContext({ tenantId, query, sinceDays, limit, sources });
    console.error(
      `Tenant ${tenantId} · query=${JSON.stringify(query ?? null)} · sinceDays=${sinceDays} · sources=${(sources ?? ALL_UNIFIED_SOURCES).join(",")}`,
    );
    console.error(
      `Filtered ${r.items.length}/${Object.values(r.totals).reduce((a, b) => a + b, 0)} total rows across ${r.sources.length} sources` +
        (r.truncated ? " (truncated)" : ""),
    );
    console.error("");
    if (r.items.length === 0) {
      console.error("(no items)");
      process.exit(2);
    }
    // Compact table: ts | source | title | body(first 80)
    for (const it of r.items) {
      const ts = new Date(it.ts).toISOString().replace("T", " ").slice(0, 16);
      const src = it.source.padEnd(18);
      const title = (it.title || "").slice(0, 40).padEnd(40);
      const body = (it.body || "").replace(/\s+/g, " ").slice(0, 100);
      console.log(`${ts}  ${src}  ${title}  ${body}`);
    }
    process.exit(0);
  } catch (e: any) {
    console.error(`memory-find failed: ${e?.message || e}`);
    process.exit(1);
  }
}

main();
