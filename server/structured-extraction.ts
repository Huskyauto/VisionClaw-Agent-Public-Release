import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { logSilentCatch } from "./lib/silent-catch";
// @ts-ignore - jsdom types not bundled
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
// Provider modules are loaded lazily inside generateRecipeWithLLM() so that
// importing this file in tests/CLI doesn't eagerly initialize LLM clients.

const RECIPE_CACHE_PATH = path.join(process.cwd(), "uploads", ".template-scraper-recipes.json");
const GRADUATION_THRESHOLD = 3;
const FETCH_TIMEOUT_MS = 25000;
const MAX_HTML_FOR_LLM = 60000;
const MAX_SCHEMA_BYTES = 8 * 1024;
const MAX_RECIPE_DEPTH = 4;
const MAX_FIELDS_PER_LEVEL = 40;
const MAX_HTML_RESPONSE_BYTES = 5 * 1024 * 1024;

// Async mutex for the recipe-cache JSON file (mirrors withQueueLock pattern from service-review-queue)
let recipeLockChain: Promise<any> = Promise.resolve();
function withRecipeLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const next = recipeLockChain.then(fn, fn);
  recipeLockChain = next.catch(() => undefined);
  return next;
}

// SSRF guard — block private/internal addresses + non-http(s) schemes
function isPrivateIPv4(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const parts = ip.split(".").map(Number);
  if (parts.some(p => p < 0 || p > 255)) return true; // malformed → treat as unsafe
  if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] >= 224) return true; // multicast + reserved
  return false;
}
function isPrivateIPv6(ip: string): boolean {
  const lc = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lc === "::1" || lc === "::") return true;
  if (lc.startsWith("fc") || lc.startsWith("fd")) return true; // ULA
  if (lc.startsWith("fe80") || lc.startsWith("fe9") || lc.startsWith("fea") || lc.startsWith("feb")) return true; // link-local
  if (lc.startsWith("ff")) return true; // multicast
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — re-check the v4 portion
  const v4mapped = lc.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4mapped && isPrivateIPv4(v4mapped[1])) return true;
  return false;
}
export function isSafeUrl(raw: string): { ok: boolean; reason?: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: "invalid url" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "only http/https allowed" };
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "metadata.google.internal" || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "internal hostname blocked" };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isPrivateIPv4(host)) return { ok: false, reason: "private IPv4 blocked" };
  if (host.startsWith("[") || host.includes(":")) {
    if (isPrivateIPv6(host)) return { ok: false, reason: "IPv6 private/link-local blocked" };
  }
  return { ok: true };
}

// Resolve DNS and reject if any A/AAAA record points to a private network.
// Defends against DNS-rebinding where a public hostname resolves to 127.0.0.1.
export async function isSafeDns(hostname: string): Promise<{ ok: boolean; reason?: string }> {
  const dns = await import("dns/promises");
  // Skip if hostname is already a literal IP (covered by isSafeUrl)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return { ok: true };
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    for (const r of records) {
      if (r.family === 4 && isPrivateIPv4(r.address)) return { ok: false, reason: `DNS resolves to private IPv4 ${r.address}` };
      if (r.family === 6 && isPrivateIPv6(r.address)) return { ok: false, reason: `DNS resolves to private IPv6 ${r.address}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: `DNS lookup failed: ${e.code || e.message?.slice(0, 60)}` };
  }
}

// Validate the LLM-emitted recipe shape; reject anything weird before we run cheerio against it
const ALLOWED_ATTRS = new Set(["text", "html", "href", "src", "title", "alt", "value", "id", "class", "name"]);
export function validateRules(rules: any, depth = 0): { ok: boolean; reason?: string } {
  if (depth > MAX_RECIPE_DEPTH) return { ok: false, reason: `recipe nesting exceeds depth ${MAX_RECIPE_DEPTH}` };
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return { ok: false, reason: "rules must be an object" };
  const keys = Object.keys(rules);
  if (keys.length === 0) return { ok: false, reason: "rules object is empty" };
  if (keys.length > MAX_FIELDS_PER_LEVEL) return { ok: false, reason: `too many fields (${keys.length} > ${MAX_FIELDS_PER_LEVEL})` };
  for (const k of keys) {
    const r = rules[k];
    if (!r || typeof r !== "object" || Array.isArray(r)) return { ok: false, reason: `field "${k}" missing rule object` };
    if (typeof r.selector !== "string" || r.selector.length === 0 || r.selector.length > 500) {
      return { ok: false, reason: `field "${k}" has invalid selector` };
    }
    if (r.attr !== undefined) {
      if (typeof r.attr !== "string") return { ok: false, reason: `field "${k}" attr must be string` };
      const attrLc = r.attr.toLowerCase();
      // Allow data-* attrs explicitly
      if (!ALLOWED_ATTRS.has(attrLc) && !attrLc.startsWith("data-")) {
        return { ok: false, reason: `field "${k}" attr "${r.attr}" not in allowlist` };
      }
    }
    if (r.multiple !== undefined && typeof r.multiple !== "boolean") return { ok: false, reason: `field "${k}" multiple must be boolean` };
    if (r.fields !== undefined) {
      const sub = validateRules(r.fields, depth + 1);
      if (!sub.ok) return sub;
    }
  }
  return { ok: true };
}

type ExtractionRule = {
  selector: string;
  attr?: string;
  multiple?: boolean;
  fields?: Record<string, ExtractionRule>;
};

type Recipe = {
  tenantId: number | null;
  domain: string;
  schemaHash: string;
  schemaName: string;
  rules: Record<string, ExtractionRule>;
  createdAt: string;
  successfulRuns: number;
  brokenRuns: number;
  graduated: boolean;
  graduatedAt?: string;
  lastResetAt?: string;
  lastModel?: string;
};

type RecipeStore = { recipes: Recipe[] };

async function fetchHtml(url: string): Promise<string> {
  const safety = isSafeUrl(url);
  if (!safety.ok) throw new Error(`unsafe url: ${safety.reason}`);
  // DNS-rebinding defense: resolve the hostname and reject if any A/AAAA
  // record points to a private network. A literal-IP hostname short-circuits
  // inside isSafeDns.
  const hostname = new URL(url).hostname.toLowerCase();
  const dnsSafety = await isSafeDns(hostname);
  if (!dnsSafety.ok) throw new Error(`unsafe url: ${dnsSafety.reason}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; VisionClawAgent/1.0; +https://agenticcorporation.net)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    // Re-check the final URL after redirects (defense in depth) — both URL shape and DNS
    const finalSafety = isSafeUrl(resp.url || url);
    if (!finalSafety.ok) throw new Error(`unsafe redirect target: ${finalSafety.reason}`);
    if (resp.url && resp.url !== url) {
      const finalHost = new URL(resp.url).hostname.toLowerCase();
      const finalDns = await isSafeDns(finalHost);
      if (!finalDns.ok) throw new Error(`unsafe redirect target: ${finalDns.reason}`);
    }
    // Cap response size to prevent memory exhaustion
    const reader = resp.body?.getReader();
    if (!reader) return await resp.text();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_RESPONSE_BYTES) {
        try { reader.cancel(); } catch (_silentErr) { logSilentCatch("server/structured-extraction.ts", _silentErr); }
        throw new Error(`response exceeds ${MAX_HTML_RESPONSE_BYTES} bytes`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map(c => Buffer.from(c))).toString("utf-8");
  } finally {
    clearTimeout(timer);
  }
}

export async function readabilityExtract(url: string): Promise<{
  success: boolean;
  url: string;
  title?: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  lang?: string;
  textContent?: string;
  contentLength?: number;
  publishedTime?: string;
  error?: string;
}> {
  try {
    const html = await fetchHtml(url);
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article) return { success: false, url, error: "Readability could not parse this page (likely no main article content)" };
    const text = (article.textContent || "").trim();
    return {
      success: true,
      url,
      title: article.title || undefined,
      byline: article.byline || undefined,
      excerpt: article.excerpt || undefined,
      siteName: article.siteName || undefined,
      lang: article.lang || undefined,
      publishedTime: (article as any).publishedTime || undefined,
      textContent: text.slice(0, 12000),
      contentLength: text.length,
    };
  } catch (e: any) {
    return { success: false, url, error: e.message?.slice(0, 200) || "fetch failed" };
  }
}

function hashSchema(schema: any): string {
  return crypto.createHash("sha1").update(JSON.stringify(schema)).digest("hex").slice(0, 16);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

async function loadRecipes(): Promise<RecipeStore> {
  try {
    const raw = await fs.readFile(RECIPE_CACHE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { recipes: [] };
  }
}

async function saveRecipes(store: RecipeStore): Promise<void> {
  // Atomic write: write to temp file, then rename. A crash mid-write leaves
  // the previous good file intact instead of a truncated JSON blob.
  await fs.mkdir(path.dirname(RECIPE_CACHE_PATH), { recursive: true });
  const tmp = `${RECIPE_CACHE_PATH}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, RECIPE_CACHE_PATH);
}

function findRecipe(store: RecipeStore, tenantId: number | null, domain: string, schemaHash: string): Recipe | undefined {
  return store.recipes.find(r => (r.tenantId ?? null) === tenantId && r.domain === domain && r.schemaHash === schemaHash);
}

function applyRule($: cheerio.CheerioAPI, $root: any, rule: ExtractionRule): any {
  if (rule.multiple) {
    const out: any[] = [];
    $root.find(rule.selector).each((_: number, el: any) => {
      const $el = $(el);
      if (rule.fields) {
        const obj: any = {};
        for (const [k, sub] of Object.entries(rule.fields)) {
          obj[k] = applyRule($, $el, sub);
        }
        out.push(obj);
      } else {
        out.push(extractOne($, $el, rule));
      }
    });
    return out;
  }
  const $el = $root.find(rule.selector).first();
  if (!$el || $el.length === 0) return null;
  if (rule.fields) {
    const obj: any = {};
    for (const [k, sub] of Object.entries(rule.fields)) {
      obj[k] = applyRule($, $el, sub);
    }
    return obj;
  }
  return extractOne($, $el, rule);
}

function extractOne($: cheerio.CheerioAPI, $el: any, rule: ExtractionRule): any {
  if (!$el || $el.length === 0) return null;
  if (rule.attr === "text" || !rule.attr) return $el.text().trim() || null;
  if (rule.attr === "html") return $el.html();
  return $el.attr(rule.attr) || null;
}

function runRecipe(html: string, rules: Record<string, ExtractionRule>): { result: Record<string, any>; coverage: number } {
  const $ = cheerio.load(html);
  const $root = $.root();
  const result: Record<string, any> = {};
  let filled = 0;
  let total = 0;
  for (const [field, rule] of Object.entries(rules)) {
    total++;
    const value = applyRule($, $root, rule);
    result[field] = value;
    if (Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "") filled++;
  }
  return { result, coverage: total === 0 ? 0 : filled / total };
}

async function generateRecipe(html: string, schema: any, schemaName: string, tenantId?: number): Promise<{ rules: Record<string, ExtractionRule>; modelUsed: string }> {
  const trimmed = html.length > MAX_HTML_FOR_LLM
    ? html.slice(0, MAX_HTML_FOR_LLM / 2) + "\n<!-- ...truncated... -->\n" + html.slice(-MAX_HTML_FOR_LLM / 2)
    : html;

  const systemPrompt = `You are a precise web-scraper recipe generator. Given an HTML page and a desired data schema, produce a JSON object that maps each schema field to a CSS selector + optional attribute. The recipe must be DETERMINISTIC and re-runnable on similar pages from the same site.

Output ONLY valid JSON of this shape (no prose, no markdown):
{
  "<fieldName>": {
    "selector": "<CSS selector>",
    "attr": "text" | "href" | "src" | "data-*" | "html",   // optional, default "text"
    "multiple": true | false,                                // optional, default false
    "fields": { ... nested rules for array-of-object items ... } // only when multiple AND items have sub-fields
  }
}

Rules:
- Prefer stable class/id selectors over positional ones
- For lists, set multiple=true and selector should match each item's container
- For nested fields, the inner "selector" is RELATIVE to each item
- "attr" of "text" extracts trimmed text; use "href" for links, "src" for images
- Never invent fields that don't appear in the schema`;

  const userPrompt = `SCHEMA (${schemaName}):
${JSON.stringify(schema, null, 2)}

HTML:
${trimmed}

Return the recipe JSON now.`;

  const { getModelForTierAsync, getAvailableModels } = await import("./providers");
  const { executeWithFailover } = await import("./model-failover");
  const modelId = await getModelForTierAsync("balanced", tenantId);
  const available = await getAvailableModels();

  const callOnce = async (messages: any[]) => {
    return await executeWithFailover(modelId, available, async (client: any, actualModel: string) => {
      const req: any = {
        model: actualModel,
        messages,
        temperature: 0.1,
        max_tokens: 1500,
      };
      try { req.response_format = { type: "json_object" }; } catch (_silentErr) { logSilentCatch("server/structured-extraction.ts", _silentErr); }
      let resp;
      try {
        resp = await client.chat.completions.create(req);
      } catch (e: any) {
        if (/response_format|json_object/i.test(e.message || "")) {
          delete req.response_format;
          resp = await client.chat.completions.create(req);
        } else {
          throw e;
        }
      }
      return { content: resp.choices?.[0]?.message?.content || "", model: actualModel };
    }, tenantId);
  };

  const baseMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  // First attempt
  const first = (await callOnce(baseMessages)).result;
  try {
    return { rules: parseRulesJson(first.content), modelUsed: first.model };
  } catch (parseErr: any) {
    // Single repair retry — feed the model its own broken output and ask for a strict-JSON fix
    const repairMessages = [
      ...baseMessages,
      { role: "assistant", content: first.content },
      { role: "user", content: `Your previous response could not be parsed as JSON: ${parseErr.message?.slice(0, 200)}\n\nReturn ONLY a single valid JSON object — no markdown fences, no comments, no trailing commas. Re-emit the recipe now.` },
    ];
    const second = (await callOnce(repairMessages)).result;
    return { rules: parseRulesJson(second.content), modelUsed: second.model };
  }
}

function parseRulesJson(raw: string): Record<string, ExtractionRule> {
  let txt = (raw || "").trim();
  // Strip code fences
  const fenceMatch = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) txt = fenceMatch[1].trim();
  // Slice to outermost braces
  const first = txt.indexOf("{");
  const last = txt.lastIndexOf("}");
  if (first >= 0 && last > first) txt = txt.slice(first, last + 1);

  const attempts = [
    txt,
    // Repair pass: strip line comments
    txt.replace(/^\s*\/\/.*$/gm, ""),
    // Repair pass: strip block comments
    txt.replace(/\/\*[\s\S]*?\*\//g, ""),
    // Repair pass: strip trailing commas before } or ]
    txt.replace(/,(\s*[}\]])/g, "$1"),
    // Repair pass: convert single quotes to double quotes (best-effort)
    txt.replace(/'/g, '"').replace(/,(\s*[}\]])/g, "$1"),
    // Combined repair
    txt
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[}\]])/g, "$1"),
  ];
  let lastErr: any;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as Record<string, ExtractionRule>;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Could not parse recipe JSON: ${lastErr?.message?.slice(0, 100)} | raw start: ${raw.slice(0, 120)}`);
}

export async function templateScrape(params: {
  url: string;
  schema: any;
  schemaName?: string;
  forceRegenerate?: boolean;
  _tenantId?: number;
}): Promise<{
  success: boolean;
  url: string;
  data?: Record<string, any>;
  source: "cache" | "fresh" | "regenerated";
  graduated: boolean;
  successfulRuns: number;
  coverage?: number;
  modelUsed?: string;
  recipeCreatedAt?: string;
  error?: string;
}> {
  const { url, schema, schemaName = "default", forceRegenerate = false, _tenantId } = params;
  const tenantKey = typeof _tenantId === "number" ? _tenantId : null;
  if (!url || typeof url !== "string") return { success: false, url, source: "fresh", graduated: false, successfulRuns: 0, error: "url is required" };
  if (!schema || typeof schema !== "object") return { success: false, url, source: "fresh", graduated: false, successfulRuns: 0, error: "schema must be an object" };

  // Schema size cap
  let schemaJson: string;
  try { schemaJson = JSON.stringify(schema); } catch { return { success: false, url, source: "fresh", graduated: false, successfulRuns: 0, error: "schema not serializable" }; }
  if (schemaJson.length > MAX_SCHEMA_BYTES) return { success: false, url, source: "fresh", graduated: false, successfulRuns: 0, error: `schema exceeds ${MAX_SCHEMA_BYTES} bytes` };

  // schemaName sanity
  if (typeof schemaName !== "string" || schemaName.length > 100) {
    return { success: false, url, source: "fresh", graduated: false, successfulRuns: 0, error: "schemaName must be a string ≤100 chars" };
  }

  const safety = isSafeUrl(url);
  if (!safety.ok) return { success: false, url, source: "fresh", graduated: false, successfulRuns: 0, error: `unsafe url: ${safety.reason}` };

  const domain = domainOf(url);
  const schemaHash = hashSchema(schema);

  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (e: any) {
    return { success: false, url, source: "fresh", graduated: false, successfulRuns: 0, error: `fetch failed: ${e.message}` };
  }

  // Phase 1: cache lookup + run + persist (atomic under lock)
  const cacheAttempt = await withRecipeLock(async () => {
    const store = await loadRecipes();
    const recipe = findRecipe(store, tenantKey, domain, schemaHash);
    if (!recipe || forceRegenerate) return { needsGenerate: true, store, recipe };
    try {
      const { result, coverage } = runRecipe(html, recipe.rules);
      if (coverage >= 0.5) {
        recipe.successfulRuns++;
        if (!recipe.graduated && recipe.successfulRuns >= GRADUATION_THRESHOLD) {
          recipe.graduated = true;
          recipe.graduatedAt = new Date().toISOString();
        }
        await saveRecipes(store);
        return {
          needsGenerate: false,
          response: {
            success: true,
            url,
            data: result,
            source: "cache" as const,
            graduated: recipe.graduated,
            successfulRuns: recipe.successfulRuns,
            coverage,
            recipeCreatedAt: recipe.createdAt,
          },
        };
      }
      // Stale — persist snap-back BEFORE we leave the lock
      recipe.brokenRuns++;
      recipe.successfulRuns = 0;
      recipe.graduated = false;
      recipe.lastResetAt = new Date().toISOString();
      await saveRecipes(store);
      return { needsGenerate: true, store, recipe };
    } catch {
      recipe.brokenRuns++;
      recipe.successfulRuns = 0;
      recipe.graduated = false;
      recipe.lastResetAt = new Date().toISOString();
      await saveRecipes(store);
      return { needsGenerate: true, store, recipe };
    }
  });

  if (!cacheAttempt.needsGenerate) return cacheAttempt.response!;

  // Phase 2: LLM generation OUTSIDE the lock (slow network call shouldn't block other tenants)
  let rules: Record<string, ExtractionRule>;
  let modelUsed: string;
  try {
    const gen = await generateRecipe(html, schema, schemaName, _tenantId);
    rules = gen.rules;
    modelUsed = gen.modelUsed;
  } catch (e: any) {
    return { success: false, url, source: "fresh", graduated: false, successfulRuns: 0, error: `Recipe generation failed: ${e.message?.slice(0, 200)}` };
  }

  // Validate the LLM-emitted recipe before executing it
  const shapeOk = validateRules(rules);
  if (!shapeOk.ok) {
    return { success: false, url, source: "fresh", graduated: false, successfulRuns: 0, error: `Invalid recipe from LLM: ${shapeOk.reason}` };
  }

  let runResult: { result: Record<string, any>; coverage: number };
  try {
    runResult = runRecipe(html, rules);
  } catch (e: any) {
    return { success: false, url, source: "fresh", graduated: false, successfulRuns: 0, error: `Recipe execution failed: ${e.message?.slice(0, 200)}` };
  }

  // Phase 3: persist new/updated recipe under lock
  const persisted = await withRecipeLock(async () => {
    const store = await loadRecipes();
    let recipe = findRecipe(store, tenantKey, domain, schemaHash);
    const now = new Date().toISOString();
    if (recipe) {
      recipe.rules = rules;
      recipe.lastModel = modelUsed;
      recipe.successfulRuns = runResult.coverage >= 0.5 ? 1 : 0;
      recipe.graduated = false;
    } else {
      recipe = {
        tenantId: tenantKey,
        domain,
        schemaHash,
        schemaName,
        rules,
        createdAt: now,
        successfulRuns: runResult.coverage >= 0.5 ? 1 : 0,
        brokenRuns: 0,
        graduated: false,
        lastModel: modelUsed,
      };
      store.recipes.push(recipe);
    }
    await saveRecipes(store);
    return recipe;
  });

  return {
    success: true,
    url,
    data: runResult.result,
    source: forceRegenerate ? "regenerated" : "fresh",
    graduated: false,
    successfulRuns: persisted.successfulRuns,
    coverage: runResult.coverage,
    modelUsed,
    recipeCreatedAt: persisted.createdAt,
  };
}

export async function templateScraperStats(params?: { _tenantId?: number }): Promise<{
  totalRecipes: number;
  graduatedRecipes: number;
  totalRunsServed: number;
  recipes: Array<{
    domain: string;
    schemaName: string;
    successfulRuns: number;
    brokenRuns: number;
    graduated: boolean;
    createdAt: string;
  }>;
}> {
  const tenantKey = typeof params?._tenantId === "number" ? params._tenantId : null;
  const store = await loadRecipes();
  // Tenant-scoped: caller only sees recipes from their tenant (anonymous callers see only anonymous recipes)
  const visible = store.recipes.filter(r => (r.tenantId ?? null) === tenantKey);
  return {
    totalRecipes: visible.length,
    graduatedRecipes: visible.filter(r => r.graduated).length,
    totalRunsServed: visible.reduce((a, r) => a + r.successfulRuns, 0),
    recipes: visible.map(r => ({
      domain: r.domain,
      schemaName: r.schemaName,
      successfulRuns: r.successfulRuns,
      brokenRuns: r.brokenRuns,
      graduated: r.graduated,
      createdAt: r.createdAt,
    })),
  };
}
