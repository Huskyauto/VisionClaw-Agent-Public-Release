import crypto from "node:crypto";
import { ssrfSafeUrl } from "./lib/ssrf-jail";
import { checkToolRateLimitPaced, recordToolUsage } from "./tool-rate-limiter";
import { wrapExternalContent } from "./external-content-security";
import { scraplingScrape, type ScraplingMode } from "./scrapling-client";
import { claimWebDomainUsage, reportWebDomainCooldown } from "./lib/web-domain-budget";
import {
  claimWebCollectionRun,
  completeWebCollectionRun,
  makeWebCollectionRunKey,
  renewWebCollectionRunLease,
} from "./lib/web-collection-idempotency";

export type CollectionLane = "web_fetch" | "firecrawl_scrape" | "scrapling_scrape";
type LaneResult = { lane: CollectionLane; ok: boolean; content?: string; title?: string; url?: string; status?: number; retryAfter?: string; retryAfterMs?: number; error?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fingerprint(content: string): string {
  return crypto.createHash("sha256").update(content.replace(/\s+/g, " ").trim().slice(0, 12_000)).digest("hex");
}

async function claimLane(tenantId: number, lane: CollectionLane): Promise<string | null> {
  const rate = await checkToolRateLimitPaced(tenantId, lane);
  if (!rate.allowed) return `${rate.reason || "Rate limited"}${rate.window === "hour" || rate.window === "day" ? " Hard ceiling; sibling lanes will not be used to evade it." : ""}`;
  recordToolUsage(tenantId, lane);
  return null;
}

export async function collectFromMultipleSources(
  url: string,
  tenantId: number,
  options: { lanes?: CollectionLane[]; mode?: ScraplingMode; staggerMs?: number } = {},
): Promise<Record<string, unknown>> {
  const safe = await ssrfSafeUrl(url);
  if (!safe.ok) return { success: false, url, error: `URL rejected: ${safe.reason}` };
  const lanes: CollectionLane[] = Array.from(
    new Set<CollectionLane>(options.lanes ?? ["web_fetch", "firecrawl_scrape", "scrapling_scrape"]),
  ).slice(0, 3);
  const mode = options.mode ?? "static";
  const { runKey, urlHash } = makeWebCollectionRunKey(tenantId, safe.url.toString(), lanes, mode);
  const runClaim = await claimWebCollectionRun(tenantId, runKey, urlHash);
  if (runClaim.state === "completed") {
    return { ...runClaim.result, idempotentReplay: true };
  }
  if (runClaim.state === "in_progress") {
    return {
      success: false,
      url,
      idempotentInProgress: true,
      retryAfterMs: runClaim.retryAfterMs,
      error: "An identical coordinated collection is already running",
    };
  }
  const staggerMs = Math.max(250, Math.min(Math.trunc(options.staggerMs ?? 1_500), 10_000));
  let leaseLost = false;
  let leaseError: unknown;
  let renewal = Promise.resolve();
  const renewalTimer = setInterval(() => {
    renewal = renewal
      .then(async () => {
        if (!await renewWebCollectionRunLease(tenantId, runKey, runClaim.claimToken)) leaseLost = true;
      })
      .catch((error) => {
        leaseLost = true;
        leaseError = error;
      });
  }, 30_000);
  renewalTimer.unref();
  const jobs = lanes.map(async (lane, index): Promise<LaneResult> => {
    try {
      if (index > 0) await sleep(staggerMs * index);
      const domainClaim = await claimWebDomainUsage(tenantId, safe.url.toString());
      if (!domainClaim.allowed) {
        return { lane, ok: false, retryAfterMs: domainClaim.retryAfterMs, error: domainClaim.reason };
      }
      const denied = await claimLane(tenantId, lane);
      if (denied) return { lane, ok: false, error: denied };
      if (lane === "scrapling_scrape") {
        const result = await scraplingScrape(url, { mode, requestId: `${runKey}:${lane}` });
        if (result.status === 429 || result.retryAfterMs) await reportWebDomainCooldown(tenantId, url, result.retryAfterMs || 60_000);
        return { lane, ok: result.ok, content: result.text, title: result.title, url: result.finalUrl, status: result.status, retryAfter: result.retryAfter, retryAfterMs: result.retryAfterMs, error: result.error };
      }
      if (lane === "firecrawl_scrape") {
        const { firecrawlScrape } = await import("./firecrawl");
        const result = await firecrawlScrape(url);
        if (result.status === 429 || result.retryAfterMs !== undefined) {
          await reportWebDomainCooldown(tenantId, url, result.retryAfterMs ?? 60_000);
        }
        return { lane, ok: Boolean(result.success && result.content), content: result.content, title: result.title, url: result.sourceUrl, status: result.status, retryAfter: result.retryAfter, retryAfterMs: result.retryAfterMs, error: result.error };
      }
      const { webFetch } = await import("./tools/domains/web/handlers");
      const result: any = await webFetch(url);
      if (result.status === 429 || result.retryAfterMs !== undefined) {
        await reportWebDomainCooldown(tenantId, url, result.retryAfterMs ?? 60_000);
      }
      return { lane, ok: Boolean(result.success && result.content), content: result.content, title: result.title, url: result.url, status: result.status, retryAfter: result.retryAfter, retryAfterMs: result.retryAfterMs, error: result.error };
    } catch (error: any) {
      return { lane, ok: false, error: String(error?.message || error).slice(0, 300) };
    }
  });

  const outcomes = await Promise.all(jobs);
  clearInterval(renewalTimer);
  await renewal;
  if (leaseLost) {
    throw new Error("web collection idempotency lease renewal failed", { cause: leaseError });
  }
  let retryAfterMs = 0;
  for (const outcome of outcomes) {
    if (outcome.status === 429 || outcome.retryAfterMs) retryAfterMs = Math.max(retryAfterMs, outcome.retryAfterMs || 60_000);
  }
  if (retryAfterMs > 0) await reportWebDomainCooldown(tenantId, url, retryAfterMs);

  const seen = new Set<string>();
  const evidence = outcomes.flatMap((outcome) => {
    if (!outcome.ok || !outcome.content) return [];
    const hash = fingerprint(outcome.content);
    if (seen.has(hash)) return [];
    seen.add(hash);
    const clipped = outcome.content.slice(0, 12_000);
    const { wrapped, suspicious } = wrapExternalContent(clipped, "web_fetch", { url: outcome.url || url });
    return [{ lane: outcome.lane, title: outcome.title, url: outcome.url || url, content: wrapped, suspiciousPatterns: suspicious.length, truncated: outcome.content.length > clipped.length }];
  });
  const result = {
    success: evidence.length > 0,
    url,
    requestedLanes: lanes,
    successfulLanes: outcomes.filter((o) => o.ok).map((o) => o.lane),
    failedLanes: outcomes.filter((o) => !o.ok).map((o) => ({ lane: o.lane, status: o.status, retryAfter: o.retryAfter, retryAfterMs: o.retryAfterMs, error: o.error })),
    partialSuccess: evidence.length > 0 && outcomes.some((o) => !o.ok),
    deduplicatedEvidenceCount: evidence.length,
    domainCooldown: retryAfterMs > 0,
    retryAfterMs: retryAfterMs || undefined,
    domainCooldownMs: retryAfterMs || undefined,
    evidence,
  };
  await completeWebCollectionRun(tenantId, runKey, runClaim.claimToken, result);
  return result;
}

export async function reportDomainCooldown(tenantId: number, url: string, retryAfterMs: number): Promise<void> {
  await reportWebDomainCooldown(tenantId, url, retryAfterMs);
}