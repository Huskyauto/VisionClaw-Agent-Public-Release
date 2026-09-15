// R98.14 — Reference learner. Lets Felix LOOK AT a real high-quality example
// on the open web (a YouTube video, a published PDF, a polished slide deck, a
// well-built HTML app, a styled report) and EXTRACT the patterns that make it
// good — then store those patterns as STRATEGIC_REFERENCE_V1: rows in
// memory_entries so future plans of the same format start with that taste
// already loaded. The Replit-Agent advantage was "I've seen a lot of good
// code"; this is how we give Felix the same advantage at deliverable level.
//
// Architecture:
//   1. SSRF-jail the URL (https only, no internal hosts, no metadata IPs).
//   2. Fetch the page (HTML for non-video; oEmbed + transcript for YouTube).
//   3. Optional Browserless screenshot if puppeteer-core is wired up.
//   4. Vision/text LLM extracts 3-5 bulleted patterns.
//   5. Persist as STRATEGIC_REFERENCE_V1 in memory_entries (category 'strategic_reference').
//
// Felix's persona prompt is updated to call this when Bob points him at a
// reference ("learn from this video before you make mine"). It also surfaces
// alongside strategic_wins / failure_patterns at task start.

import { runLlmTask } from "./llm-task";
import { logSilentCatch } from "./lib/silent-catch";
import { QUALITY_TAGLINES } from "./quality-cards";
import { ssrfSafeUrl, pinnedDispatcher } from "./lib/ssrf-jail";   // R98.14 +sec-2 — shared jail (was inline-duplicated)

const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 2 * 1024 * 1024;

async function fetchTextWithCap(url: URL, addresses: string[]): Promise<{ ok: true; body: string; contentType: string; bytes: number } | { ok: false; reason: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  // R125+61 — pin the socket to the IPs ssrfSafeUrl() already validated so a
  // hostile DNS server can't rebind the hostname to a private IP between the jail
  // check and connect (TOCTOU). redirect:"error" already blocks 30x escapes.
  const dispatcher = pinnedDispatcher(addresses);
  try {
    // R98.14 +sec-2 (2nd round) — architect CRITICAL: redirect:"follow" lets a
    // jailed input URL 30x to an internal target, bypassing the SSRF jail
    // entirely. Switch to redirect:"error" so any redirect = hard fail. Real
    // reference URLs (YouTube, blog posts, PDFs hosted on CDNs) resolve directly
    // without 30x; the loss is acceptable. URL-shortener inputs (bit.ly etc.)
    // will now be rejected — the agent should ask the customer for the canonical URL.
    const res = await fetch(url.toString(), { signal: ctrl.signal, redirect: "error", headers: { "User-Agent": "VisionClaw-Reference-Learner/1.0 (+https://visionclaw.replit.app)" }, dispatcher } as any);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const ct = res.headers.get("content-type") || "";
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, reason: "no body" };
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { try { reader.cancel(); } catch (_e) { logSilentCatch("reference-learner:cancel", _e); } break; }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const text = buf.toString("utf8").slice(0, MAX_BYTES);
    return { ok: true, body: text, contentType: ct, bytes: total };
  } catch (e: any) {
    return { ok: false, reason: `fetch failed: ${e?.message || String(e)}` };
  } finally {
    clearTimeout(t);
    dispatcher.destroy().catch((_e) => logSilentCatch("reference-learner:dispatcher-destroy", _e));
  }
}

function extractText(html: string): { title: string; metaDesc: string; visibleText: string } {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["']/i)
             || html.match(/<meta[^>]+content=["']([^"']{1,500})["'][^>]+name=["']description["']/i);
  // Cheap visible-text extraction — good enough for LLM analysis.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
  return {
    title: (titleM?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 300),
    metaDesc: (descM?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 500),
    visibleText: stripped,
  };
}

function isYouTubeUrl(u: URL): { videoId: string } | null {
  if (/(?:^|\.)youtube\.com$/i.test(u.hostname)) {
    const id = u.searchParams.get("v");
    if (id && /^[\w-]{6,20}$/.test(id)) return { videoId: id };
    const m = u.pathname.match(/\/(?:embed|shorts)\/([\w-]{6,20})/);
    if (m) return { videoId: m[1] };
  }
  if (/^youtu\.be$/i.test(u.hostname)) {
    const m = u.pathname.match(/^\/([\w-]{6,20})/);
    if (m) return { videoId: m[1] };
  }
  return null;
}

async function fetchYouTubeOEmbed(videoId: string): Promise<{ title?: string; author?: string; thumbnailUrl?: string } | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`, { signal: AbortSignal.timeout(8000), redirect: "error" });
    if (!res.ok) return null;
    const j: any = await res.json();
    return { title: j.title, author: j.author_name, thumbnailUrl: j.thumbnail_url };
  } catch (_e) { logSilentCatch("reference-learner:oembed", _e); return null; }
}

const PATTERN_SCHEMA = {
  type: "object",
  required: ["patterns", "best_for", "summary"],
  properties: {
    patterns: { type: "array", minItems: 3, maxItems: 8, items: { type: "object", required: ["pattern", "why_it_works"], properties: { pattern: { type: "string" }, why_it_works: { type: "string" }, applies_to: { type: "string" } } } },
    best_for: { type: "string", description: "Short tag of when Felix should reach for this style. e.g. 'cinematic 60s product ads', 'investor pitch decks', 'productivity HTML utilities'." },
    summary: { type: "string", description: "One-sentence taste statement Felix can drop into a planning chain-of-thought." },
    style_tags: { type: "array", items: { type: "string" }, maxItems: 8 },
  },
} as const;

export interface LearnFromReferenceInput {
  tenantId: number;
  personaId?: number;
  referenceUrl: string;
  deliverableType: string;          // video / audio / pdf / slides / html_app / spreadsheet / document / image
  whatToLearn?: string;             // optional caller hint
  model?: string;
}

export interface LearnFromReferenceResult {
  success: boolean;
  reference_url: string;
  deliverable_type: string;
  patterns: { pattern: string; why_it_works: string; applies_to?: string }[];
  best_for?: string;
  summary?: string;
  style_tags?: string[];
  source: { title?: string; author?: string; meta_desc?: string; bytes_fetched?: number; thumbnail_url?: string; kind: "youtube" | "html_page" };
  stored_memory_id?: number;
  error?: string;
}

const SUPPORTED_FORMATS = new Set(["video", "audio", "pdf", "slides", "html_app", "spreadsheet", "document", "image"]);

export async function learnFromReference(input: LearnFromReferenceInput): Promise<LearnFromReferenceResult> {
  const dt = (input.deliverableType || "").toLowerCase();
  const baseFail = (reason: string): LearnFromReferenceResult => ({ success: false, reference_url: input.referenceUrl, deliverable_type: dt, patterns: [], source: { kind: "html_page" }, error: reason });

  if (!SUPPORTED_FORMATS.has(dt)) return baseFail(`deliverable_type '${dt}' not supported (use one of ${Array.from(SUPPORTED_FORMATS).join(", ")})`);
  if (typeof input.tenantId !== "number" || input.tenantId <= 0) return baseFail("tenantId required");

  const safe = await ssrfSafeUrl(input.referenceUrl);
  if (!safe.ok) return baseFail(`URL rejected by SSRF jail: ${safe.reason}`);
  const url = safe.url;

  let title = "";
  let author = "";
  let metaDesc = "";
  let bodyText = "";
  let bytesFetched = 0;
  let thumbnailUrl: string | undefined;
  let kind: "youtube" | "html_page" = "html_page";
  let visionImage: string | undefined;

  const yt = isYouTubeUrl(url);
  if (yt) {
    kind = "youtube";
    const oe = await fetchYouTubeOEmbed(yt.videoId);
    if (oe) { title = oe.title || ""; author = oe.author || ""; thumbnailUrl = oe.thumbnailUrl; }
    // Fetch the watch page for description + caption hints. Captions themselves
    // are gated behind YouTube's API; we just take what oEmbed + page metadata give us.
    const fetched = await fetchTextWithCap(url, safe.addresses);
    if (fetched.ok) {
      bytesFetched = fetched.bytes;
      const ex = extractText(fetched.body);
      if (!title) title = ex.title;
      metaDesc = ex.metaDesc;
      bodyText = ex.visibleText;
    }
    // Use the YT thumbnail as the vision input (high-res maxres if available).
    // Architect HIGH fix: thumbnailUrl came from oEmbed JSON — re-jail it
    // through the same SSRF check as the input URL. YouTube SHOULD always
    // return an i.ytimg.com / i9.ytimg.com URL but we don't trust by reputation.
    if (thumbnailUrl) {
      const thumbSafe = await ssrfSafeUrl(thumbnailUrl);
      if (thumbSafe.ok) {
        const thumbDispatcher = pinnedDispatcher(thumbSafe.addresses);
        try {
          const tRes = await fetch(thumbSafe.url.toString(), { signal: AbortSignal.timeout(8000), redirect: "error", dispatcher: thumbDispatcher } as any);
          if (tRes.ok) {
            const ab = await tRes.arrayBuffer();
            if (ab.byteLength <= 4 * 1024 * 1024) visionImage = `data:image/jpeg;base64,${Buffer.from(ab).toString("base64")}`;
          }
        } catch (_e) { logSilentCatch("reference-learner:thumb-fetch", _e); }
        finally { thumbDispatcher.destroy().catch((_e) => logSilentCatch("reference-learner:thumb-dispatcher-destroy", _e)); }
      } else {
        logSilentCatch("reference-learner:thumb-ssrf-rejected", new Error(thumbSafe.reason));
      }
    }
  } else {
    const fetched = await fetchTextWithCap(url, safe.addresses);
    if (!fetched.ok) return baseFail(fetched.reason);
    bytesFetched = fetched.bytes;
    const ex = extractText(fetched.body);
    title = ex.title;
    metaDesc = ex.metaDesc;
    bodyText = ex.visibleText;
  }

  const baselineTagline = QUALITY_TAGLINES[dt] || "";

  const analysisPrompt = `You are a senior creative director analyzing a reference example so an AI agent can copy its TASTE — the structural patterns that make it work — without copying its content.

REFERENCE
- URL: ${url.toString()}
- Source kind: ${kind}
- Title: ${title || "(no title extracted)"}
${author ? `- Author/Channel: ${author}` : ""}
${metaDesc ? `- Description: ${metaDesc}` : ""}
- Caller is studying this for: ${input.whatToLearn || "(unspecified — extract whatever is most teachable)"}

${bodyText ? `EXTRACTED PAGE TEXT (first 8KB):\n"""\n${bodyText}\n"""` : ""}

DELIVERABLE FORMAT BEING STUDIED: ${dt}
EXISTING BASELINE TASTE for ${dt}: ${baselineTagline}

YOUR JOB
Extract 3-8 SPECIFIC, COPYABLE patterns this reference demonstrates that go BEYOND the baseline taste above. For each pattern: state it as a rule the agent could literally check ("opens with a 2-second close-up of the product" not "good opening"), and explain why it works ("creates curiosity before any text appears, lifting first-3s retention").

Then give ONE sentence Felix can drop into a planning chain-of-thought when reaching for this style ("for cinematic product ads in this style: open with a 2-3s close-up, hold beat for 1s, then narration cuts in over a wide shot").

Then a "best_for" tag (≤80 chars) — the kind of project where this style fits.

Then 3-8 style_tags (single words/short phrases) for retrieval.

CRITICAL: Patterns must be CONCRETE and CHECKABLE. NOT "high quality cinematography". YES "shallow depth of field on every product shot, deep DoF on every lifestyle shot".

Output ONLY JSON conforming to the schema.`;

  let analysis: any;
  try {
    const r = await runLlmTask({
      tenantId: input.tenantId,
      prompt: analysisPrompt,
      schema: PATTERN_SCHEMA as any,
      model: input.model || "gemini-2.5-flash",
      timeoutMs: 60000,
      temperature: 0.2,
      maxTokens: 4000,
      images: visionImage ? [visionImage] : undefined,
    });
    analysis = (r as any)?.json;
  } catch (e: any) { return baseFail(`analysis LLM failed: ${e?.message || String(e)}`); }

  if (!analysis || !Array.isArray(analysis.patterns)) return baseFail("analysis returned no patterns");

  // Persist as STRATEGIC_REFERENCE_V1: in memory_entries.
  let storedId: number | undefined;
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const personaId = input.personaId || 2;
    const normKey = (title || url.hostname).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "reference";
    const payload = {
      v: 1,
      url: url.toString(),
      kind,
      deliverable_type: dt,
      title,
      author,
      thumbnail_url: thumbnailUrl,
      what_to_learn: (input.whatToLearn || "").slice(0, 300),
      patterns: analysis.patterns.slice(0, 8),
      best_for: (analysis.best_for || "").slice(0, 200),
      summary: (analysis.summary || "").slice(0, 400),
      style_tags: (analysis.style_tags || []).slice(0, 8),
    };
    const fact = `STRATEGIC_REFERENCE_V1:${dt}:${normKey}|${JSON.stringify(payload)}`;
    const dedupPrefix = `STRATEGIC_REFERENCE_V1:${dt}:${normKey}|`;
    const existing: any = await db.execute(sql`
      SELECT id FROM memory_entries
      WHERE tenant_id = ${input.tenantId} AND persona_id = ${personaId}
        AND category = 'strategic_reference'
        AND fact LIKE ${dedupPrefix + "%"}
      LIMIT 1
    `);
    if (existing.rows?.length > 0) {
      storedId = existing.rows[0].id;
      await db.execute(sql`UPDATE memory_entries SET fact = ${fact}, last_accessed = NOW(), access_count = access_count + 1 WHERE id = ${storedId}`);
    } else {
      const ins: any = await db.execute(sql`
        INSERT INTO memory_entries (tenant_id, persona_id, fact, category, source, created_at)
        VALUES (${input.tenantId}, ${personaId}, ${fact}, 'strategic_reference', 'reference_learner', NOW())
        RETURNING id
      `);
      storedId = ins.rows?.[0]?.id;
    }
  } catch (e: any) {
    logSilentCatch("reference-learner:persist", e);
  }

  return {
    success: true,
    reference_url: url.toString(),
    deliverable_type: dt,
    patterns: analysis.patterns,
    best_for: analysis.best_for,
    summary: analysis.summary,
    style_tags: analysis.style_tags || [],
    source: { title, author, meta_desc: metaDesc, bytes_fetched: bytesFetched, thumbnail_url: thumbnailUrl, kind },
    stored_memory_id: storedId,
  };
}

export interface RecallReferencesInput {
  tenantId: number;
  personaId?: number;
  deliverableType?: string;
  styleTags?: string[];
  limit?: number;
}

export interface RecallReferencesResult {
  count: number;
  references: any[];
}

export async function recallReferences(input: RecallReferencesInput): Promise<RecallReferencesResult> {
  if (typeof input.tenantId !== "number" || input.tenantId <= 0) return { count: 0, references: [] };
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const personaId = input.personaId || 2;
    const limit = Math.max(1, Math.min(50, Number(input.limit) || 10));
    const rows: any = await db.execute(sql`
      SELECT id, fact, last_accessed, access_count, created_at FROM memory_entries
      WHERE tenant_id = ${input.tenantId} AND persona_id = ${personaId}
        AND category = 'strategic_reference'
      ORDER BY last_accessed DESC NULLS LAST, created_at DESC
      LIMIT ${limit * 3}
    `);
    const out: any[] = [];
    const wantType = (input.deliverableType || "").toLowerCase();
    const wantTags = new Set((input.styleTags || []).map((t) => String(t).toLowerCase()));
    for (const r of rows.rows || []) {
      const f = String(r.fact || "");
      if (!f.startsWith("STRATEGIC_REFERENCE_V1:")) continue;
      const pipe = f.indexOf("|");
      if (pipe < 0) continue;
      let payload: any;
      try { payload = JSON.parse(f.slice(pipe + 1)); } catch { continue; }
      if (wantType && payload.deliverable_type !== wantType) continue;
      if (wantTags.size > 0) {
        const has = (payload.style_tags || []).some((t: string) => wantTags.has(String(t).toLowerCase()));
        if (!has) continue;
      }
      out.push({ id: r.id, ...payload, last_accessed: r.last_accessed, access_count: r.access_count });
      if (out.length >= limit) break;
    }
    return { count: out.length, references: out };
  } catch (_e) {
    logSilentCatch("reference-learner:recall", _e);
    return { count: 0, references: [] };
  }
}
