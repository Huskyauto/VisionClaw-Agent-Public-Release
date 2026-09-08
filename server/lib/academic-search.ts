/**
 * R125+4 — Academic / scholarly search across four FREE, public, license-clean
 * scholarly indexes. The legitimate alternative to shadow-library scraping.
 *
 *   arxiv      — STEM preprints (Atom XML)        — export.arxiv.org/api
 *   pubmed     — biomedical citations (E-utilities) — eutils.ncbi.nlm.nih.gov
 *   openalex   — universal scholarly graph (JSON)   — api.openalex.org
 *   crossref   — DOI metadata + abstracts (JSON)    — api.crossref.org
 *
 * All are read-only HTTP GETs against public endpoints. No API keys required.
 * Polite-pool best practice for OpenAlex + Crossref: pass a `mailto:` UA so
 * upstream rate-limits us into the friendly bucket instead of the anonymous one.
 *
 * Every public function returns a NORMALIZED `ScholarResult[]` — the same shape
 * regardless of source — so the LLM can reason over the merged set cleanly.
 *
 * Safety: every textual field from a remote response MUST be passed through the
 * caller's `wrapExternalContent` before re-injection into a prompt. The lib
 * here just fetches + normalizes; wrapping is the tool-handler's job (see
 * server/tools.ts academic_search case).
 */

// R125+4+sec — architect MEDIUM: do NOT hardcode a personal-email fallback.
// Polite-pool participation is opt-in via env var; when unset we send a neutral
// project address (purely for User-Agent identification, not contact) and skip
// the ?mailto= query-param entirely, dropping us into the anonymous OpenAlex /
// Crossref pool. That's the correct safer default — the polite-pool benefit is
// rate-limit headroom, never something worth leaking PII for.
const POLITE_MAILTO_RAW = process.env.OPENALEX_MAILTO || process.env.CROSSREF_MAILTO || "";
const POLITE_MAILTO_FOR_QUERY = POLITE_MAILTO_RAW.trim();  // empty ⇒ omit query param
const UA_CONTACT = POLITE_MAILTO_FOR_QUERY || "noreply@visionclaw.local";
const UA = `VisionClaw-academic-search/1.0 (+mailto:${UA_CONTACT})`;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface ScholarResult {
  source: "arxiv" | "pubmed" | "openalex" | "crossref";
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  url: string;          // canonical landing page (DOI URL or source-native)
  pdf_url?: string;     // direct PDF if the source advertises one (open access only)
  abstract?: string;
  venue?: string;       // journal / preprint server / conference
  citations?: number;   // when the source provides it (OpenAlex does)
  open_access?: boolean;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": UA, ...(init.headers as any) } });
  } finally {
    clearTimeout(t);
  }
}

function clampInt(n: any, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&"); // last so we don't double-decode
}

// ──────────────────────────────────────────────────────────────────────────
// arXiv — public Atom API. No auth, ~3 req/sec polite rate.
// ──────────────────────────────────────────────────────────────────────────
export async function searchArxiv(query: string, maxResults = 5): Promise<ScholarResult[]> {
  const q = encodeURIComponent(String(query || "").trim());
  if (!q) return [];
  const n = clampInt(maxResults, 1, 25, 5);
  // Use sortBy=relevance (default) — better signal than submitted-date for "find me papers about X".
  const url = `https://export.arxiv.org/api/query?search_query=all:${q}&start=0&max_results=${n}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
  const xml = await res.text();
  // Atom XML parser — entry blocks. Lightweight regex (no XML lib dep).
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map((e): ScholarResult => {
    const grab = (tag: string) => {
      const m = e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? decodeXmlEntities(m[1].replace(/\s+/g, " ").trim()) : "";
    };
    const title = grab("title");
    const summary = grab("summary");
    const published = grab("published");
    const idUrl = grab("id");
    // <author><name>…</name></author> blocks
    const authors = Array.from(e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)).map((m) => decodeXmlEntities(m[1].trim()));
    // pdf link is the <link title="pdf" ...> entry
    const pdfMatch = e.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/);
    const doiMatch = e.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/);
    return {
      source: "arxiv",
      title,
      authors,
      year: published ? Number(published.slice(0, 4)) : undefined,
      doi: doiMatch ? doiMatch[1].trim() : undefined,
      url: idUrl,
      pdf_url: pdfMatch ? pdfMatch[1] : undefined,
      abstract: summary,
      venue: "arXiv preprint",
      open_access: true, // arXiv is always OA
    };
  }).filter((r) => r.title);
}

// ──────────────────────────────────────────────────────────────────────────
// PubMed — NCBI E-utilities (two-step: esearch returns IDs, esummary returns
// metadata). No key required at low volume; ~3 req/sec polite limit.
// ──────────────────────────────────────────────────────────────────────────
export async function searchPubmed(query: string, maxResults = 5): Promise<ScholarResult[]> {
  const q = encodeURIComponent(String(query || "").trim());
  if (!q) return [];
  const n = clampInt(maxResults, 1, 25, 5);
  const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${n}&term=${q}`;
  const esearchRes = await fetchWithTimeout(esearchUrl);
  if (!esearchRes.ok) throw new Error(`PubMed esearch HTTP ${esearchRes.status}`);
  const esearchJson: any = await esearchRes.json();
  const ids: string[] = esearchJson?.esearchresult?.idlist || [];
  if (ids.length === 0) return [];
  const esumUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`;
  const esumRes = await fetchWithTimeout(esumUrl);
  if (!esumRes.ok) throw new Error(`PubMed esummary HTTP ${esumRes.status}`);
  const esumJson: any = await esumRes.json();
  const result = esumJson?.result || {};
  return ids.map((id) => {
    const r = result[id];
    if (!r) return null;
    const authors: string[] = Array.isArray(r.authors) ? r.authors.map((a: any) => String(a.name || "")).filter(Boolean) : [];
    // pubdate is like "2024 Jan" or "2024 Mar 15"
    const year = typeof r.pubdate === "string" ? Number(r.pubdate.slice(0, 4)) : undefined;
    const doi = Array.isArray(r.articleids) ? (r.articleids.find((a: any) => a.idtype === "doi")?.value as string | undefined) : undefined;
    return {
      source: "pubmed" as const,
      title: String(r.title || "").trim(),
      authors,
      year: Number.isFinite(year) ? year : undefined,
      doi,
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      abstract: undefined, // esummary doesn't carry abstract; agent can follow up with efetch if needed
      venue: String(r.fulljournalname || r.source || "").trim() || undefined,
    } as ScholarResult;
  }).filter((x): x is ScholarResult => !!x && !!x.title);
}

// ──────────────────────────────────────────────────────────────────────────
// OpenAlex — universal scholarly graph, JSON-native, mailto polite pool.
// Free, no key. 100k req/day in polite pool is far beyond anything we'd need.
// ──────────────────────────────────────────────────────────────────────────
export async function searchOpenalex(query: string, maxResults = 5, opts: { openAccessOnly?: boolean } = {}): Promise<ScholarResult[]> {
  const q = encodeURIComponent(String(query || "").trim());
  if (!q) return [];
  const n = clampInt(maxResults, 1, 25, 5);
  const filters: string[] = [];
  if (opts.openAccessOnly) filters.push("is_oa:true");
  const filterParam = filters.length ? `&filter=${filters.join(",")}` : "";
  const mailtoParam = POLITE_MAILTO_FOR_QUERY ? `&mailto=${encodeURIComponent(POLITE_MAILTO_FOR_QUERY)}` : "";
  const url = `https://api.openalex.org/works?search=${q}&per-page=${n}${filterParam}${mailtoParam}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  const json: any = await res.json();
  const works: any[] = json?.results || [];
  return works.map((w): ScholarResult => {
    const authorships = Array.isArray(w.authorships) ? w.authorships : [];
    const authors = authorships.map((a: any) => String(a?.author?.display_name || "")).filter(Boolean);
    // Reconstruct abstract from OpenAlex's inverted-index format if present.
    let abstract: string | undefined;
    if (w.abstract_inverted_index && typeof w.abstract_inverted_index === "object") {
      const positions: [number, string][] = [];
      for (const [word, idxs] of Object.entries(w.abstract_inverted_index)) {
        for (const i of idxs as number[]) positions.push([i, word]);
      }
      positions.sort((a, b) => a[0] - b[0]);
      abstract = positions.map(([, word]) => word).join(" ");
    }
    const doi: string | undefined = typeof w.doi === "string" ? w.doi.replace(/^https?:\/\/doi\.org\//, "") : undefined;
    const pdf = w?.open_access?.oa_url || undefined;
    return {
      source: "openalex",
      title: String(w.title || w.display_name || "").trim(),
      authors,
      year: typeof w.publication_year === "number" ? w.publication_year : undefined,
      doi,
      url: doi ? `https://doi.org/${doi}` : (w.id || ""),
      pdf_url: pdf || undefined,
      abstract,
      venue: w?.primary_location?.source?.display_name || w?.host_venue?.display_name || undefined,
      citations: typeof w.cited_by_count === "number" ? w.cited_by_count : undefined,
      open_access: w?.open_access?.is_oa === true,
    };
  }).filter((r) => r.title);
}

// ──────────────────────────────────────────────────────────────────────────
// Crossref — authoritative DOI registry. Two modes: query-string search and
// direct DOI lookup. Mailto polite pool.
// ──────────────────────────────────────────────────────────────────────────
export async function searchCrossref(query: string, maxResults = 5): Promise<ScholarResult[]> {
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];
  // DOI heuristic: "10." prefix and a slash — call the direct lookup endpoint.
  if (/^10\.[^\s]+\/[^\s]+$/.test(trimmed)) {
    const mailtoParam = POLITE_MAILTO_FOR_QUERY ? `?mailto=${encodeURIComponent(POLITE_MAILTO_FOR_QUERY)}` : "";
    const url = `https://api.crossref.org/works/${encodeURIComponent(trimmed)}${mailtoParam}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`Crossref HTTP ${res.status}`);
    }
    const json: any = await res.json();
    const r = normalizeCrossrefItem(json?.message);
    return r ? [r] : [];
  }
  const q = encodeURIComponent(trimmed);
  const n = clampInt(maxResults, 1, 25, 5);
  const mailtoParam = POLITE_MAILTO_FOR_QUERY ? `&mailto=${encodeURIComponent(POLITE_MAILTO_FOR_QUERY)}` : "";
  const url = `https://api.crossref.org/works?query=${q}&rows=${n}${mailtoParam}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`);
  const json: any = await res.json();
  const items: any[] = json?.message?.items || [];
  return items.map(normalizeCrossrefItem).filter((x): x is ScholarResult => !!x);
}

function normalizeCrossrefItem(it: any): ScholarResult | null {
  if (!it) return null;
  const titleArr = Array.isArray(it.title) ? it.title : [];
  const title = String(titleArr[0] || "").trim();
  if (!title) return null;
  const authors: string[] = Array.isArray(it.author)
    ? it.author.map((a: any) => [a?.given, a?.family].filter(Boolean).join(" ").trim()).filter(Boolean)
    : [];
  const yearParts: any[] = it?.issued?.["date-parts"]?.[0] || it?.published?.["date-parts"]?.[0] || [];
  const year = typeof yearParts[0] === "number" ? yearParts[0] : undefined;
  const doi: string | undefined = typeof it.DOI === "string" ? it.DOI : undefined;
  return {
    source: "crossref",
    title,
    authors,
    year,
    doi,
    url: doi ? `https://doi.org/${doi}` : (it.URL || ""),
    abstract: typeof it.abstract === "string" ? it.abstract.replace(/<[^>]+>/g, "").trim() : undefined,
    venue: Array.isArray(it["container-title"]) ? (it["container-title"][0] as string) : undefined,
    citations: typeof it["is-referenced-by-count"] === "number" ? it["is-referenced-by-count"] : undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Meta — fan out across selected sources in parallel, de-dupe by DOI (then by
// normalized title), interleave by source for diversity, return a ranked list.
// Each source's failure is captured per-source and surfaced; one source going
// down never sinks the whole call.
// ──────────────────────────────────────────────────────────────────────────
export type AcademicSource = "arxiv" | "pubmed" | "openalex" | "crossref";

export interface AcademicSearchOutput {
  query: string;
  results: ScholarResult[];
  sources_queried: AcademicSource[];
  source_errors: { source: AcademicSource; error: string }[];
  total_before_dedup: number;
}

export async function academicSearchAll(
  query: string,
  opts: { maxResultsPerSource?: number; sources?: AcademicSource[]; openAccessOnly?: boolean } = {}
): Promise<AcademicSearchOutput> {
  const sources: AcademicSource[] = opts.sources?.length
    ? opts.sources.filter((s) => ["arxiv", "pubmed", "openalex", "crossref"].includes(s))
    : ["arxiv", "pubmed", "openalex", "crossref"];
  const perSource = clampInt(opts.maxResultsPerSource, 1, 15, 5);
  const errors: { source: AcademicSource; error: string }[] = [];
  const tasks = sources.map(async (s): Promise<ScholarResult[]> => {
    try {
      switch (s) {
        case "arxiv": return await searchArxiv(query, perSource);
        case "pubmed": return await searchPubmed(query, perSource);
        case "openalex": return await searchOpenalex(query, perSource, { openAccessOnly: opts.openAccessOnly });
        case "crossref": return await searchCrossref(query, perSource);
      }
    } catch (e: any) {
      errors.push({ source: s, error: String(e?.message || e).slice(0, 200) });
      return [];
    }
  });
  const buckets = await Promise.all(tasks);
  const flat = buckets.flat();
  const totalBefore = flat.length;

  // De-duplication: DOI first (authoritative), then normalized title fallback.
  const seenDoi = new Set<string>();
  const seenTitle = new Set<string>();
  const merged: ScholarResult[] = [];
  // Score for ranking: citations (capped) > has-abstract > open-access > recency.
  const scored = flat.map((r) => {
    let score = 0;
    if (typeof r.citations === "number") score += Math.min(r.citations, 1000) / 10;
    if (r.abstract && r.abstract.length > 80) score += 5;
    if (r.open_access) score += 3;
    if (typeof r.year === "number") score += Math.max(0, (r.year - 2010) * 0.2);
    return { r, score };
  }).sort((a, b) => b.score - a.score);

  for (const { r } of scored) {
    const doiKey = r.doi?.toLowerCase();
    const titleKey = r.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
    if (doiKey && seenDoi.has(doiKey)) continue;
    if (!doiKey && seenTitle.has(titleKey)) continue;
    if (doiKey) seenDoi.add(doiKey);
    seenTitle.add(titleKey);
    merged.push(r);
  }

  return {
    query,
    results: merged,
    sources_queried: sources,
    source_errors: errors,
    total_before_dedup: totalBefore,
  };
}
