import fs from "fs";
import path from "path";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { MODEL_REGISTRY, type ModelInfo } from "./providers";

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
    request?: string;
    image?: string;
  };
  architecture?: {
    modality?: string;
    tokenizer?: string;
  };
  top_provider?: {
    max_completion_tokens?: number | null;
  };
  per_request_limits?: any;
}

export interface NormalizedCatalogEntry {
  rawId: string;
  normalizedId: string;
  provider: "openai" | "anthropic" | "google" | "xai" | "openrouter" | "other";
  label: string;
  contextLen: number;
  pricePromptPerM: number;
  priceCompletionPerM: number;
  modality: string;
  inferredTier: "fast" | "balanced" | "powerful" | "reasoning";
  inferredCostClass: "free" | "cheap" | "paid";
  capabilities: string[];
}

export interface CatalogDiff {
  added: NormalizedCatalogEntry[];
  priceChanged: { entry: NormalizedCatalogEntry; oldPriceM: number | null }[];
  registryNotInCatalog: { id: string; provider: string; label: string }[];
  scanned: number;
  filteredKept: number;
}

export interface CatalogSyncResult {
  fetchedAt: string;
  totalModels: number;
  diff: CatalogDiff;
  probeResults: { modelId: string; gatewayLive: boolean; reason?: string }[];
  alertsWritten: number;
  emailSent: boolean;
}

const TARGET_PROVIDERS = new Set(["openai", "anthropic", "google", "x-ai", "xai"]);

// R110.11.2 — Auto-add watchlist. When OpenRouter's catalog contains a model
// whose rawId matches one of these patterns, the catalog sync APPENDS a
// ModelInfo entry to data/model-registry-overlay.json (which providers.ts
// loads at startup). This bypasses the TARGET_PROVIDERS filter (since e.g.
// `baidu` is not in TARGET_PROVIDERS) and skips the "review-only" alert path
// — the model goes live the moment OpenRouter exposes it.
//
// Bob asked 2026-05-11 for ERNIE 5.1 the moment Baidu publishes it on OR.
// Add new patterns here for any future model you want auto-added.
export interface ModelAutoAddRule {
  pattern: RegExp;
  // OpenRouter rawId stays as the registry id (consumed via openrouter provider).
  // The fields below seed the ModelInfo entry. Tier/cost can be overridden by
  // catalog-inferred values if `useInferredTier` is true.
  provider: ModelInfo["provider"];
  tier: ModelInfo["tier"];
  costClass?: ModelInfo["costClass"];
  capabilities?: ModelInfo["capabilities"];
  trainingRegime?: ModelInfo["trainingRegime"];
  description: string;
  useInferredTier?: boolean;
  useInferredCost?: boolean;
}

// Rules are evaluated in order; FIRST match wins. Place more-specific
// patterns (e.g. -vl variant) BEFORE generic catch-alls or they'll be
// shadowed and lose their distinguishing capabilities.
export const MODEL_AUTOADD_WATCHLIST: ModelAutoAddRule[] = [
  {
    // Vision variant of ERNIE 5.x — MUST come before the generic rule below
    // or the generic /^baidu\/ernie-5(\.\d+)?(\b|[-_:])/i absorbs it and
    // VL models lose the "vision" capability tag.
    pattern: /^baidu\/ernie-5(\.\d+)?-vl/i,
    provider: "openrouter",
    tier: "powerful",
    capabilities: ["vision", "code", "tools"],
    trainingRegime: "distilled",
    description: "Baidu ERNIE 5.x VL — vision variant. Auto-added by R110.11.2 watcher.",
    useInferredCost: true,
  },
  {
    // Generic ERNIE 5.x — text-only by default. Matches baidu/ernie-5,
    // baidu/ernie-5.1, baidu/ernie-5.1-thinking, baidu/ernie-5.1-300b, etc.
    // Excludes -vl via the rule above.
    pattern: /^baidu\/ernie-5(\.\d+)?(\b|[-_:])/i,
    provider: "openrouter",
    tier: "powerful",
    capabilities: ["code", "tools"],
    trainingRegime: "distilled",
    description: "Baidu ERNIE 5.x — multi-source retrieval and synthesis flagship (Arena Search Leaderboard #4 globally as of 2026-05). Auto-added by R110.11.2 watcher.",
    useInferredCost: true,
  },
];

const OVERLAY_PATH = path.join(process.cwd(), "data", "model-registry-overlay.json");

// Distinguishes the three states the overlay file can be in. Critical so
// the writer can refuse to overwrite a CORRUPT file (which would silently
// destroy any salvageable entries an operator might want to recover by
// hand). Architect-flagged 2026-05-11.
type OverlayReadResult =
  | { status: "missing"; entries: ModelInfo[] }   // file doesn't exist or is empty — safe to write
  | { status: "ok"; entries: ModelInfo[] }        // valid JSON array — safe to write (entries preserved)
  | { status: "corrupt"; reason: string };        // parse fail or wrong shape — do NOT overwrite

function readOverlay(): OverlayReadResult {
  try {
    if (!fs.existsSync(OVERLAY_PATH)) return { status: "missing", entries: [] };
    const raw = fs.readFileSync(OVERLAY_PATH, "utf8").trim();
    if (raw.length === 0) return { status: "missing", entries: [] };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { status: "corrupt", reason: `${OVERLAY_PATH} is not a JSON array` };
    }
    return { status: "ok", entries: parsed as ModelInfo[] };
  } catch (err: any) {
    return { status: "corrupt", reason: err?.message || String(err) };
  }
}

// Atomically writes the overlay JSON (write-to-tmp + rename) so a crash
// mid-write cannot leave a corrupt file that breaks providers.ts on next boot.
function writeOverlay(entries: ModelInfo[]): void {
  const dir = path.dirname(OVERLAY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${OVERLAY_PATH}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, OVERLAY_PATH);
}

// Runs the watchlist against the full raw OpenRouter catalog. Returns the
// list of newly-promoted entries. By default PERSISTS to the overlay file
// so the heartbeat catalog sync just works. Pass `{ persist: false }` from
// tests / smoke checks to avoid polluting the production overlay (lesson
// learned the hard way 2026-05-11: a `npx tsx -e` smoke test with synthetic
// `baidu/ernie-5.1` ids wrote 4 fake entries into the real overlay file).
// Skips any rawId already in MODEL_REGISTRY (from code) or already in the
// overlay (from a previous sync). Failures are caught + logged + return [].
export function runWatchlistAutoAdd(rawCatalog: OpenRouterModel[], opts: { persist?: boolean } = {}): ModelInfo[] {
  const persist = opts.persist !== false;
  try {
    const overlayRead = readOverlay();
    if (overlayRead.status === "corrupt") {
      // Refuse to write. Overwriting a corrupt file would silently destroy
      // any recoverable entries. Loud warn — operator must hand-fix or
      // delete the file before auto-add resumes.
      console.warn(`[model-catalog] R110.11.2 auto-add ABORTED — overlay file is corrupt (${overlayRead.reason}). NOT writing. Repair or delete data/model-registry-overlay.json to re-enable.`);
      return [];
    }
    const existingIds = new Set<string>();
    for (const m of MODEL_REGISTRY) existingIds.add(m.id.toLowerCase());
    for (const m of overlayRead.entries) existingIds.add(m.id.toLowerCase());

    const promotions: ModelInfo[] = [];
    for (const cat of rawCatalog) {
      const rawId = cat?.id;
      if (typeof rawId !== "string") continue;
      if (existingIds.has(rawId.toLowerCase())) continue;

      const rule = MODEL_AUTOADD_WATCHLIST.find(r => r.pattern.test(rawId));
      if (!rule) continue;

      // Synthesize ModelInfo. Cost/tier inference reuses normalize logic.
      const promptPrice = parseFloat(cat.pricing?.prompt || "0") * 1_000_000;
      const completionPrice = parseFloat(cat.pricing?.completion || "0") * 1_000_000;
      let inferredTier: ModelInfo["tier"];
      if (completionPrice >= 50) inferredTier = "reasoning";
      else if (completionPrice >= 15) inferredTier = "powerful";
      else if (completionPrice >= 3) inferredTier = "balanced";
      else inferredTier = "fast";
      let inferredCost: ModelInfo["costClass"];
      if (completionPrice === 0) inferredCost = "free";
      else if (completionPrice < 2) inferredCost = "cheap";
      else inferredCost = "paid";

      const entry: ModelInfo = {
        id: rawId,
        label: cat.name || rawId,
        provider: rule.provider,
        tier: rule.useInferredTier ? inferredTier : rule.tier,
        description: rule.description + ` Live pricing: $${promptPrice.toFixed(2)}/M in, $${completionPrice.toFixed(2)}/M out, ${(cat.context_length || 0).toLocaleString()} ctx.`,
        capabilities: rule.capabilities,
        costClass: rule.useInferredCost ? inferredCost : (rule.costClass || inferredCost),
        trainingRegime: rule.trainingRegime || "unknown",
      };
      promotions.push(entry);
      existingIds.add(rawId.toLowerCase());
    }

    if (promotions.length > 0) {
      if (persist) {
        const next = [...overlayRead.entries, ...promotions];
        writeOverlay(next);
        console.log(`[model-catalog] R110.11.2 auto-add: promoted ${promotions.length} model(s) to overlay: ${promotions.map(p => p.id).join(", ")}`);
      } else {
        console.log(`[model-catalog] R110.11.2 auto-add (DRY-RUN, no overlay write): would promote ${promotions.length} model(s): ${promotions.map(p => p.id).join(", ")}`);
      }
    }
    return promotions;
  } catch (err: any) {
    console.warn(`[model-catalog] R110.11.2 auto-add failed (no overlay change): ${err?.message || err}`);
    return [];
  }
}

const PROVIDER_MAP: Record<string, NormalizedCatalogEntry["provider"]> = {
  "openai": "openai",
  "anthropic": "anthropic",
  "google": "google",
  "x-ai": "xai",
  "xai": "xai",
};

const SKIP_SUFFIXES = ["-image", "-image-2", "-search-preview", "-online", "-tts", "-audio-preview", "-realtime-preview", "-audio"];
const SKIP_PREFIXES = ["~"];

export async function fetchOpenRouterCatalog(timeoutMs = 15_000): Promise<OpenRouterModel[]> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`OpenRouter /models returned HTTP ${resp.status}`);
    const json: any = await resp.json();
    if (!Array.isArray(json?.data)) throw new Error("OpenRouter /models: missing data[] array");
    return json.data as OpenRouterModel[];
  } finally {
    clearTimeout(t);
  }
}

export function normalizeOpenRouterEntry(m: OpenRouterModel): NormalizedCatalogEntry | null {
  if (!m?.id || typeof m.id !== "string") return null;
  if (SKIP_PREFIXES.some(p => m.id.startsWith(p))) return null;
  for (const sfx of SKIP_SUFFIXES) {
    if (m.id.endsWith(sfx)) return null;
  }
  const slashIdx = m.id.indexOf("/");
  if (slashIdx <= 0) return null;
  const providerSlug = m.id.slice(0, slashIdx).toLowerCase();
  const modelPart = m.id.slice(slashIdx + 1);
  if (!TARGET_PROVIDERS.has(providerSlug)) return null;
  const provider = PROVIDER_MAP[providerSlug] || "other";

  let normalizedId = modelPart;
  if (provider === "anthropic") {
    normalizedId = modelPart.replace(/\./g, "-");
  }

  const promptPrice = parseFloat(m.pricing?.prompt || "0");
  const completionPrice = parseFloat(m.pricing?.completion || "0");
  const pricePromptPerM = promptPrice * 1_000_000;
  const priceCompletionPerM = completionPrice * 1_000_000;

  let inferredTier: NormalizedCatalogEntry["inferredTier"];
  if (priceCompletionPerM >= 50) inferredTier = "reasoning";
  else if (priceCompletionPerM >= 15) inferredTier = "powerful";
  else if (priceCompletionPerM >= 3) inferredTier = "balanced";
  else inferredTier = "fast";

  let inferredCostClass: NormalizedCatalogEntry["inferredCostClass"];
  if (priceCompletionPerM === 0) inferredCostClass = "free";
  else if (priceCompletionPerM < 2) inferredCostClass = "cheap";
  else inferredCostClass = "paid";

  const modality = m.architecture?.modality || "text->text";
  const capabilities: string[] = [];
  if (modality.includes("image") && modality.includes("->")) {
    if (modality.split("->")[0].includes("image")) capabilities.push("vision");
    if (modality.split("->")[1].includes("image")) capabilities.push("image_gen");
  }
  if (modality.includes("audio")) capabilities.push("audio");
  if (modality.includes("video")) capabilities.push("video");
  capabilities.push("code", "tools");

  return {
    rawId: m.id,
    normalizedId,
    provider,
    label: m.name || m.id,
    contextLen: m.context_length || 0,
    pricePromptPerM,
    priceCompletionPerM,
    modality,
    inferredTier,
    inferredCostClass,
    capabilities,
  };
}

function buildRegistryIndex(): Map<string, { provider: string; id: string; label: string }> {
  const idx = new Map<string, { provider: string; id: string; label: string }>();
  for (const m of MODEL_REGISTRY) {
    const key = `${m.provider}::${m.id.toLowerCase()}`;
    idx.set(key, { provider: m.provider, id: m.id, label: m.label });
    const altKey = m.id.toLowerCase();
    if (!idx.has(altKey)) idx.set(altKey, { provider: m.provider, id: m.id, label: m.label });
  }
  return idx;
}

export function diffAgainstRegistry(catalog: NormalizedCatalogEntry[]): CatalogDiff {
  const registryIdx = buildRegistryIndex();
  const added: NormalizedCatalogEntry[] = [];

  const seenInCatalog = new Set<string>();
  for (const entry of catalog) {
    const candidates = [
      `${entry.provider}::${entry.normalizedId.toLowerCase()}`,
      `replit::${entry.normalizedId.toLowerCase()}`,
      entry.normalizedId.toLowerCase(),
      entry.rawId.toLowerCase(),
    ];
    let matched = false;
    for (const k of candidates) {
      if (registryIdx.has(k)) {
        seenInCatalog.add(registryIdx.get(k)!.id.toLowerCase());
        matched = true;
        break;
      }
    }
    if (!matched) added.push(entry);
  }

  const registryNotInCatalog: CatalogDiff["registryNotInCatalog"] = [];
  for (const m of MODEL_REGISTRY) {
    if (!TARGET_PROVIDERS.has(m.provider) && m.provider !== "openai" && m.provider !== "anthropic" && m.provider !== "google" && m.provider !== "xai") continue;
    if (seenInCatalog.has(m.id.toLowerCase())) continue;
    registryNotInCatalog.push({ id: m.id, provider: m.provider, label: m.label });
  }

  return {
    added,
    priceChanged: [],
    registryNotInCatalog,
    scanned: catalog.length,
    filteredKept: catalog.length,
  };
}

export async function probeReplitGateway(modelId: string): Promise<{ live: boolean; reason?: string }> {
  try {
    const { replitOpenai } = await import("./providers");
    const resp = await replitOpenai.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: "ok" }],
      max_completion_tokens: 10,
    } as any);
    if (resp.choices?.[0]?.message) return { live: true };
    return { live: false, reason: "no choices in response" };
  } catch (e: any) {
    return { live: false, reason: (e?.message || String(e)).slice(0, 200) };
  }
}

export interface RunCatalogSyncOptions {
  tenantId?: number;
  maxAlerts?: number;
  maxProbes?: number;
  emailOwner?: boolean;
  source?: string;
}

export async function runCatalogSync(opts: RunCatalogSyncOptions = {}): Promise<CatalogSyncResult> {
  const tenantId = opts.tenantId ?? 1;
  const maxAlerts = opts.maxAlerts ?? 10;
  const maxProbes = opts.maxProbes ?? 5;
  const emailOwner = opts.emailOwner !== false;
  const source = opts.source || "heartbeat:model_catalog_sync";

  const fetchedAt = new Date().toISOString();
  const raw = await fetchOpenRouterCatalog();
  const normalized: NormalizedCatalogEntry[] = [];
  for (const m of raw) {
    const n = normalizeOpenRouterEntry(m);
    if (n) normalized.push(n);
  }

  // R110.11.2 — watchlist auto-add. Runs against the FULL raw catalog (not
  // just TARGET_PROVIDERS) so models like baidu/ernie-5.1 get promoted into
  // the overlay the moment OpenRouter exposes them. Failures don't abort
  // the rest of the sync.
  const autoAdded = runWatchlistAutoAdd(raw);
  if (autoAdded.length > 0 && emailOwner) {
    try {
      const { sendEmail } = await import("./email");
      const lines = autoAdded.map(e => `• ${e.label} (${e.id}) — tier=${e.tier}, cost=${e.costClass}`).join("\n");
      await sendEmail({
        inboxId: "",
        to: process.env.OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com",
        subject: `[VisionClaw] Auto-added ${autoAdded.length} watchlisted model(s)`,
        body:
          `The catalog watcher (R110.11.2) found ${autoAdded.length} model(s) on OpenRouter ` +
          `matching MODEL_AUTOADD_WATCHLIST and promoted them into MODEL_REGISTRY ` +
          `via data/model-registry-overlay.json (effective on next process restart):\n\n${lines}\n\n` +
          `These are now usable by ensemble_query, persona routing, and any caller that reads MODEL_REGISTRY.`,
      });
    } catch (err: any) {
      console.warn(`[model-catalog] auto-add notification email failed: ${err?.message || err}`);
    }
  }

  const diff = diffAgainstRegistry(normalized);

  const ranked = [...diff.added].sort((a, b) => {
    const tierOrder: Record<string, number> = { reasoning: 4, powerful: 3, balanced: 2, fast: 1 };
    if ((tierOrder[b.inferredTier] || 0) !== (tierOrder[a.inferredTier] || 0)) {
      return (tierOrder[b.inferredTier] || 0) - (tierOrder[a.inferredTier] || 0);
    }
    return b.contextLen - a.contextLen;
  });

  const probeResults: CatalogSyncResult["probeResults"] = [];
  const probeCandidates = ranked.filter(e => e.provider === "openai").slice(0, maxProbes);
  for (const c of probeCandidates) {
    const r = await probeReplitGateway(c.normalizedId);
    probeResults.push({ modelId: c.normalizedId, gatewayLive: r.live, reason: r.reason });
  }

  // Idempotency: skip alerts for any rawId we've ever alerted on. Without
  // this, every daily run re-emails the same models until Bob adds them to
  // MODEL_REGISTRY (or flags them dismissed in a future Phase 2). The
  // category=model_catalog table stays bounded at ~few hundred rows over
  // time (one per discovered model), so a single SELECT with a 5000-row
  // safety cap is cheap. A 7-day window would let stale rows fall out and
  // the same alerts would re-fire weekly — bad. Lifetime dedupe is right.
  const recentlyAlertedRawIds = new Set<string>();
  try {
    const recent = await db.execute(sql`
      SELECT fact FROM memory_entries
      WHERE category = 'model_catalog'
      ORDER BY id DESC
      LIMIT 5000
    `);
    const rows: any[] = (recent as any).rows || (recent as any);
    for (const r of rows) {
      const f = String(r.fact || "");
      const m = f.match(/\(([a-z0-9_\-]+\/[a-z0-9_\.\-:]+)\)/i);
      if (m) recentlyAlertedRawIds.add(m[1].toLowerCase());
    }
  } catch (err: any) {
    console.warn(`[model-catalog] dedupe lookup failed (will write all alerts): ${err?.message || err}`);
  }

  let alertsWritten = 0;
  const newToAlert = ranked.filter(e => !recentlyAlertedRawIds.has(e.rawId.toLowerCase()));
  const topAlerts = newToAlert.slice(0, maxAlerts);
  const dedupedCount = ranked.length - newToAlert.length;
  for (const entry of topAlerts) {
    const probe = probeResults.find(p => p.modelId === entry.normalizedId);
    const probeNote = probe
      ? probe.gatewayLive
        ? " [Replit gateway: LIVE]"
        : ` [Replit gateway: not yet (${probe.reason?.slice(0, 80)})]`
      : "";
    const fact = `New model discovered: ${entry.label} (${entry.rawId}). Provider=${entry.provider}, ` +
      `tier=${entry.inferredTier}, cost=${entry.inferredCostClass}, ` +
      `prompt=$${entry.pricePromptPerM.toFixed(2)}/1M, completion=$${entry.priceCompletionPerM.toFixed(2)}/1M, ` +
      `context=${entry.contextLen.toLocaleString()}, modality=${entry.modality}.${probeNote} ` +
      `Consider adding to MODEL_REGISTRY in server/providers.ts. Discovered ${fetchedAt}.`;
    try {
      await db.execute(sql`
        INSERT INTO memory_entries (tenant_id, fact, category, source, status, created_at, last_accessed, access_count)
        VALUES (${tenantId}, ${fact}, 'model_catalog', ${source}, 'active', NOW(), NOW(), 1)
      `);
      alertsWritten++;
    } catch (err: any) {
      console.warn(`[model-catalog] memory_entry insert failed for ${entry.normalizedId}: ${err?.message || err}`);
    }
  }
  if (dedupedCount > 0) {
    console.log(`[model-catalog] suppressed ${dedupedCount} alert(s) already raised at any point (lifetime dedupe)`);
  }

  let emailSent = false;
  if (emailOwner && topAlerts.length > 0) {
    try {
      const { sendEmail } = await import("./email");
      const lines = topAlerts.map(e => {
        const probe = probeResults.find(p => p.modelId === e.normalizedId);
        const probeNote = probe ? (probe.gatewayLive ? " [LIVE on Replit]" : " [not on Replit yet]") : "";
        return `• ${e.label} (${e.rawId})${probeNote}\n` +
          `    tier=${e.inferredTier}, cost=${e.inferredCostClass}, ` +
          `$${e.pricePromptPerM.toFixed(2)}/$${e.priceCompletionPerM.toFixed(2)} per 1M (in/out), ` +
          `${e.contextLen.toLocaleString()} ctx`;
      }).join("\n");
      const body =
        `Daily catalog sync found ${diff.added.length} new model(s) on OpenRouter ` +
        `that aren't in MODEL_REGISTRY yet. Top ${topAlerts.length} (sorted by tier+context):\n\n` +
        lines +
        `\n\nNo auto-add was performed (review-only mode). When you're ready to wire any of these in, ` +
        `add an entry to MODEL_REGISTRY in server/providers.ts with the inferred tier and capabilities above.\n\n` +
        (diff.registryNotInCatalog.length > 0
          ? `Also: ${diff.registryNotInCatalog.length} model(s) in your registry no longer appear in OpenRouter ` +
            `(possibly deprecated): ${diff.registryNotInCatalog.slice(0, 5).map(r => r.id).join(", ")}\n\n`
          : "") +
        `Total OpenRouter models scanned: ${diff.scanned} (filtered to ${TARGET_PROVIDERS.size} target providers).`;
      await sendEmail({
        inboxId: "",
        to: process.env.OWNER_EMAIL || "owner@example.com",
        subject: `[VisionClaw] Model catalog: ${diff.added.length} new model(s) discovered`,
        body,
      });
      emailSent = true;
    } catch (err: any) {
      console.warn(`[model-catalog] email send failed: ${err?.message || err}`);
    }
  }

  return {
    fetchedAt,
    totalModels: raw.length,
    diff,
    probeResults,
    alertsWritten,
    emailSent,
  };
}
