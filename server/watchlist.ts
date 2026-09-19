import { db } from "./db";
import { sql } from "drizzle-orm";

export async function addWatchlistItem(params: {
  tenantId: number;
  createdByPersonaId?: number;
  name: string;
  category: string;
  searchQueries: string[];
  keywords?: string[];
  checkFrequency?: string;
  alertThreshold?: string;
  escalateToPersonaId?: number;
  metadata?: any;
}) {
  const result = await db.execute(sql`
    INSERT INTO watchlist_items (tenant_id, created_by_persona_id, name, category, search_queries, keywords, check_frequency, alert_threshold, escalate_to_persona_id, metadata)
    VALUES (${params.tenantId}, ${params.createdByPersonaId || null}, ${params.name}, ${params.category}, ${JSON.stringify(params.searchQueries)}::jsonb, ${params.keywords ? JSON.stringify(params.keywords) : null}::jsonb, ${params.checkFrequency || "daily"}, ${params.alertThreshold || "any_new"}, ${params.escalateToPersonaId || null}, ${params.metadata ? JSON.stringify(params.metadata) : null}::jsonb)
    RETURNING *
  `);
  const item = ((result as any).rows || [])[0];
  console.log(`[watchlist] Added item: ${params.name} (${params.category})`);
  return item;
}

export async function updateWatchlistItem(tenantId: number, itemId: number, data: Partial<{
  name: string;
  category: string;
  searchQueries: string[];
  keywords: string[];
  checkFrequency: string;
  alertThreshold: string;
  escalateToPersonaId: number | null;
  enabled: boolean;
}>) {
  await db.execute(sql`
    UPDATE watchlist_items SET
      name = COALESCE(${data.name || null}, name),
      category = COALESCE(${data.category || null}, category),
      search_queries = COALESCE(${data.searchQueries ? JSON.stringify(data.searchQueries) : null}::jsonb, search_queries),
      keywords = COALESCE(${data.keywords ? JSON.stringify(data.keywords) : null}::jsonb, keywords),
      check_frequency = COALESCE(${data.checkFrequency || null}, check_frequency),
      alert_threshold = COALESCE(${data.alertThreshold || null}, alert_threshold),
      escalate_to_persona_id = ${data.escalateToPersonaId === undefined ? sql`escalate_to_persona_id` : data.escalateToPersonaId},
      enabled = COALESCE(${data.enabled !== undefined ? data.enabled : null}, enabled)
    WHERE id = ${itemId} AND tenant_id = ${tenantId}
  `);
}

export async function removeWatchlistItem(tenantId: number, itemId: number) {
  await db.execute(sql`DELETE FROM watchlist_alerts WHERE watchlist_item_id = ${itemId} AND tenant_id = ${tenantId}`);
  await db.execute(sql`DELETE FROM watchlist_items WHERE id = ${itemId} AND tenant_id = ${tenantId}`);
}

export async function getWatchlistItems(tenantId: number) {
  const result = await db.execute(sql`
    SELECT * FROM watchlist_items WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
  `);
  return (result as any).rows || [];
}

export async function getWatchlistItem(tenantId: number, itemId: number) {
  const result = await db.execute(sql`
    SELECT * FROM watchlist_items WHERE id = ${itemId} AND tenant_id = ${tenantId}
  `);
  return ((result as any).rows || [])[0] || null;
}

export async function getDueWatchlistItems(tenantId: number): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT * FROM watchlist_items
    WHERE tenant_id = ${tenantId}
      AND enabled = TRUE
      AND (
        last_checked_at IS NULL
        OR (check_frequency = 'hourly' AND last_checked_at < NOW() - INTERVAL '1 hour')
        OR (check_frequency = 'daily' AND last_checked_at < NOW() - INTERVAL '1 day')
        OR (check_frequency = 'weekly' AND last_checked_at < NOW() - INTERVAL '7 days')
      )
    ORDER BY last_checked_at ASC NULLS FIRST
    LIMIT 5
  `);
  return (result as any).rows || [];
}

export async function createAlert(params: {
  tenantId: number;
  watchlistItemId: number;
  title: string;
  summary: string;
  source?: string;
  severity?: string;
  matchedKeywords?: string[];
}) {
  const result = await db.execute(sql`
    INSERT INTO watchlist_alerts (tenant_id, watchlist_item_id, title, summary, source, severity, matched_keywords)
    VALUES (${params.tenantId}, ${params.watchlistItemId}, ${params.title}, ${params.summary}, ${params.source || null}, ${params.severity || "info"}, ${params.matchedKeywords ? JSON.stringify(params.matchedKeywords) : null}::jsonb)
    RETURNING *
  `);
  const alert = ((result as any).rows || [])[0];
  console.log(`[watchlist] Alert created: ${params.title} (${params.severity || "info"})`);
  return alert;
}

export async function getAlerts(tenantId: number, filters?: {
  watchlistItemId?: number;
  acknowledged?: boolean;
  limit?: number;
}) {
  const limit = filters?.limit || 50;
  let query = sql`SELECT wa.*, wi.name as watchlist_name, wi.category FROM watchlist_alerts wa LEFT JOIN watchlist_items wi ON wa.watchlist_item_id = wi.id WHERE wa.tenant_id = ${tenantId}`;

  if (filters?.watchlistItemId) {
    query = sql`${query} AND wa.watchlist_item_id = ${filters.watchlistItemId}`;
  }
  if (filters?.acknowledged !== undefined) {
    query = sql`${query} AND wa.acknowledged = ${filters.acknowledged}`;
  }

  query = sql`${query} ORDER BY wa.created_at DESC LIMIT ${limit}`;

  const result = await db.execute(query);
  return (result as any).rows || [];
}

export async function acknowledgeAlert(tenantId: number, alertId: number, acknowledgedByPersonaId?: number) {
  await db.execute(sql`
    UPDATE watchlist_alerts SET acknowledged = TRUE, acknowledged_by_persona_id = ${acknowledgedByPersonaId || null}
    WHERE id = ${alertId} AND tenant_id = ${tenantId}
  `);
}

export async function scanWatchlistItem(tenantId: number, item: any): Promise<{ alerts: any[]; newResults: number }> {
  const searchQueries = item.search_queries || [];
  const keywords = item.keywords || [];
  const previousResults = item.last_results || [];
  const alerts: any[] = [];
  let newResults = 0;

  try {
    const { executeTool } = await import("./tools");

    const allResults: any[] = [];

    for (const query of searchQueries.slice(0, 3)) {
      try {
        const searchResult = await executeTool("web_search", { query, max_results: 5, _tenantId: tenantId });
        const resultText = typeof searchResult === "string" ? searchResult : JSON.stringify(searchResult);

        const lines = resultText.split("\n").filter((l: string) => l.trim().length > 10);
        for (const line of lines.slice(0, 5)) {
          allResults.push({ query, text: line.substring(0, 500), source: query });
        }
      } catch (err: any) {
        console.warn(`[watchlist] Search failed for "${query}":`, err.message);
      }
    }

    const previousTexts = new Set((previousResults as any[]).map((r: any) => r.text?.substring(0, 100)));
    const newItems = allResults.filter(r => !previousTexts.has(r.text?.substring(0, 100)));
    newResults = newItems.length;

    if (newItems.length > 0 && (item.alert_threshold === "any_new" || item.alert_threshold === "keyword_match")) {
      for (const newItem of newItems.slice(0, 3)) {
        const matchedKw: string[] = [];
        const textLower = (newItem.text || "").toLowerCase();

        for (const kw of keywords) {
          if (textLower.includes((kw as string).toLowerCase())) {
            matchedKw.push(kw as string);
          }
        }

        if (item.alert_threshold === "keyword_match" && matchedKw.length === 0) continue;

        const severity = matchedKw.length >= 3 ? "high" : matchedKw.length >= 1 ? "medium" : "info";

        const alert = await createAlert({
          tenantId,
          watchlistItemId: item.id,
          title: `${item.name}: New finding`,
          summary: newItem.text.substring(0, 500),
          source: newItem.query,
          severity,
          matchedKeywords: matchedKw.length > 0 ? matchedKw : undefined,
        });
        alerts.push(alert);
      }
    }

    await db.execute(sql`
      UPDATE watchlist_items SET
        last_checked_at = NOW(),
        last_results = ${JSON.stringify(allResults.slice(0, 20))}::jsonb
      WHERE id = ${item.id} AND tenant_id = ${tenantId}
    `);

  } catch (err: any) {
    console.error(`[watchlist] Scan failed for ${item.name}:`, err.message);
  }

  return { alerts, newResults };
}

export async function scanDueWatchlistItems(tenantId: number): Promise<{ scanned: number; alerts: number }> {
  const dueItems = await getDueWatchlistItems(tenantId);
  if (dueItems.length === 0) return { scanned: 0, alerts: 0 };

  let totalAlerts = 0;
  for (const item of dueItems) {
    const result = await scanWatchlistItem(tenantId, item);
    totalAlerts += result.alerts.length;

    if (result.alerts.length > 0) {
      try {
        const { emitEvent } = await import("./event-bus");
        for (const alert of result.alerts) {
          await emitEvent({
            type: item.category === "competitor" ? "monitor.competitor" : "monitor.alert",
            source: "watchlist",
            tenantId,
            data: {
              watchlistItemId: item.id,
              watchlistName: item.name,
              alertId: alert.id,
              title: alert.title,
              summary: alert.summary,
              severity: alert.severity,
            },
          });
        }
      } catch (err: any) {
        console.warn("[watchlist] Event emission failed:", err.message);
      }
    }
  }

  console.log(`[watchlist] Scanned ${dueItems.length} items, created ${totalAlerts} alerts`);
  return { scanned: dueItems.length, alerts: totalAlerts };
}
