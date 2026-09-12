/**
 * Tools-layer-split S9 — web-domain tool DEFINITIONS.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 *
 * Each const below was moved VERBATIM from `server/tools.ts`, which now
 * references these consts in the exact original TOOL_DEFINITIONS array
 * positions — array order (and therefore the LLM-facing tool ordering and
 * `scripts/list-tools.ts` output) is byte-identical.
 */

import type { ToolDefinition } from "../../types";

export const webFetchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "web_fetch",
    description: "Use when you ALREADY have a specific URL and need its content (do NOT use to discover URLs — that is web_search). Cheap, fast. Multi-tier extraction: Defuddle (R125+13, local linkedom-based extractor, kepano/obsidian-skills — free, no API, 60–80% token reduction on cluttered articles) → Readability (Jina AI) → Firecrawl (stealth/cached) → basic HTML cleanup (R112.17: Tier 3 plain fetch sends Bayesian-network-trained realistic browser headers via Apify's header-generator — User-Agent + sec-ch-ua* + sec-fetch-* coherent set — so many sites that previously returned 403/429 to our static UA now succeed without escalating to the more expensive stealth_browse_camofox). Handles JS-heavy + bot-protected pages. Returns extracted text plus optional title/byline/wordCount from the Defuddle tier. PREFER this over stealth_browse_camofox when you just need text content from a single URL — only escalate to camofox if web_fetch returns a fallback_hint indicating the site needs full-browser rendering or CAPTCHA solving. For research that needs synthesis across 5+ sources, escalate to deep_research instead.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch content from" },
      },
      required: ["url"],
    },
  },
};

export const webSearchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for information. Uses Perplexity Sonar (when configured) for AI-powered research with citations, with Wikipedia and Jina AI as fallbacks. Use when the user asks a factual question, needs current information, or you need to research a topic before responding.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — keywords or question to search for" },
      },
      required: ["query"],
    },
  },
};

// ─── R125+35 — Public-API live-data pack (Agenvoy-inspired). Six FREE,
// no-auth, READ-ONLY GET tools. Host is HARDCODED per tool; the LLM controls
// only validated+encoded query params (no SSRF surface). Universal — wired to
// all 16 personas via PLATFORM_TOOLS_CONTRACT + ALWAYS_INCLUDE. ───
export const fetchWeatherDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "fetch_weather",
    description: "R125+35 — Current weather for any city/place name. FREE, no key (open-meteo.com): geocodes the name then returns current temperature, apparent temp, humidity, precipitation, wind, weather code + units. Use when the user asks about weather, temperature, or conditions in a place. Pass a human place name ('Tucson', 'Paris, France'), NOT coordinates.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City or place name, e.g. 'Tucson' or 'London, UK'." },
      },
      required: ["city"],
    },
  },
};

export const fetchCryptoPriceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "fetch_crypto_price",
    description: "R125+35 — Live cryptocurrency prices. FREE, no key (CoinGecko). Pass CoinGecko COIN IDs (lowercase slugs like 'bitcoin','ethereum','solana' — NOT ticker symbols like 'BTC'), comma-separated for multiple. Returns price + 24h % change in the chosen fiat. Use for crypto price / market questions.",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "string", description: "Comma-separated CoinGecko coin ids, e.g. 'bitcoin,ethereum'. Use ids (slugs), not symbols." },
        vs_currency: { type: "string", description: "Optional fiat code, 2-8 letters. Default 'usd'." },
      },
      required: ["ids"],
    },
  },
};

export const fetchExchangeRateDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "fetch_exchange_rate",
    description: "R125+35 — Live fiat currency exchange rates. FREE, no key (open.er-api.com). Give a 3-letter base ISO code (default USD); optionally a target code to get a single pair rate, else returns all rates for the base. Use for currency conversion / FX questions.",
    parameters: {
      type: "object",
      properties: {
        base: { type: "string", description: "3-letter ISO base currency, e.g. 'USD'. Default USD." },
        target: { type: "string", description: "Optional 3-letter ISO target currency, e.g. 'EUR'. If set, returns just that pair." },
      },
      required: [],
    },
  },
};

export const fetchWikipediaDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "fetch_wikipedia",
    description: "R125+35 — Plain-language Wikipedia summary (intro extract + description + canonical URL) for a topic/person/place. FREE, no key (en.wikipedia.org REST). Use for quick encyclopedic facts and definitions. Extract text is fenced (untrusted external content). For deep/multi-source research prefer academic_search.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Article title / topic, e.g. 'Photosynthesis' or 'Alan Turing'." },
      },
      required: ["title"],
    },
  },
};

export const fetchHackerNewsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "fetch_hacker_news",
    description: "R125+35 — Hacker News stories. FREE, no key (HN Algolia API). With no query returns the current front page; with a query returns matching stories. Each: title, url, points, author, comment count, HN discussion link. Use for tech-news pulse, trending topics, or 'what's on Hacker News'. Titles are fenced (untrusted external content).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional search query. Omit for the front page." },
        count: { type: "number", description: "Optional 1-30, default 10." },
      },
      required: [],
    },
  },
};

export const lookupIpGeoDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "lookup_ip_geo",
    description: "R125+35 — Geolocate an IP address (city, region, country, lat/lon, timezone, ISP/org). FREE, no key (ipwho.is, HTTPS). Pass a valid IPv4/IPv6 address (required). Use for IP-to-location, abuse/triage, or 'where is this IP'.",
    parameters: {
      type: "object",
      properties: {
        ip: { type: "string", description: "IPv4 or IPv6 address to geolocate (required)." },
      },
      required: ["ip"],
    },
  },
};

// ─── R125+4 — Legitimate academic / scholarly search (4 sources + 1 meta) ───
export const academicSearchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "academic_search",
    description: "R125+4 — Fan-out scholarly search across arXiv (STEM preprints), PubMed (biomedical), OpenAlex (universal scholarly graph w/ citations), and Crossref (DOI registry). ALL four sources are FREE, public, license-clean — no shadow libraries, no copyright risk. Returns a deduplicated, citation-ranked list of papers with normalized {title, authors, year, doi, url, pdf_url?, abstract?, venue, citations?, open_access?} shape. Each source runs in PARALLEL; per-source failure is captured but never sinks the whole call. Use this as your FIRST move for ANY research question involving published academic literature — competitive intel, lit reviews, fact-checking claims, finding the canonical paper on a topic. Prefer this over web_search when the user wants RESEARCH-QUALITY sources (peer-reviewed, citeable, DOI-anchored) rather than generic web pages. For follow-up depth on a single hit, use openalex_search with the DOI or crossref_lookup.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — keywords or natural-language question. For Crossref DOI lookup, pass a DOI string (e.g. '10.1038/nature12373')." },
        max_per_source: { type: "number", description: "Optional. Max results PER source before dedup. Default 5, max 15. Total payload ≤ max_per_source × |sources|." },
        sources: { type: "array", items: { type: "string", enum: ["arxiv", "pubmed", "openalex", "crossref"] }, description: "Optional. Subset of sources to query. Default = all four. Use ['arxiv'] for STEM-only, ['pubmed'] for biomedical-only, etc." },
        open_access_only: { type: "boolean", description: "Optional. If true, restricts OpenAlex hits to open-access works (other sources ignore this flag). Default false." },
      },
      required: ["query"],
    },
  },
};

export const arxivSearchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "arxiv_search",
    description: "R125+4 — Search arXiv directly for STEM preprints (physics, math, CS, quant-bio, q-fin, stat, econ). FREE public Atom API, no key. Returns normalized ScholarResult[] with PDF URLs (every arXiv paper is open access). Use when you specifically want preprints / latest research / pre-peer-review work — arXiv catches things that haven't hit Crossref/PubMed yet (weeks to months ahead). For multi-source coverage, use academic_search instead.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — keywords across title/abstract/authors." },
        max_results: { type: "number", description: "Optional. 1-25, default 5." },
      },
      required: ["query"],
    },
  },
};

export const pubmedSearchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "pubmed_search",
    description: "R125+4 — Search PubMed/MEDLINE for biomedical literature via NCBI E-utilities (esearch+esummary, JSON). FREE public API, no key required at modest volume. Returns normalized ScholarResult[]; abstracts are NOT included by default (esummary doesn't carry them — the agent can web_fetch the pubmed URL or call openalex_search with the DOI for the abstract). Use for medical, clinical, pharmacology, genetics, public-health questions. For broader STEM coverage use academic_search.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — PubMed MeSH-friendly keywords work best (e.g. 'wellness receptor agonist wellness')." },
        max_results: { type: "number", description: "Optional. 1-25, default 5." },
      },
      required: ["query"],
    },
  },
};

export const openalexSearchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "openalex_search",
    description: "R125+4 — Search OpenAlex, the universal scholarly graph (250M+ works, replaces the discontinued Microsoft Academic Graph). FREE public JSON API, polite mailto pool. Returns normalized ScholarResult[] with citation counts, reconstructed abstracts, venue, and open-access PDF URLs when available. Best single source for ranking by influence (citations) and for cross-discipline coverage. Optional open_access_only filter restricts to free-to-read works. Use when you want the most authoritative single-source ranking; for broader recall, use academic_search.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — natural language or keywords." },
        max_results: { type: "number", description: "Optional. 1-25, default 5." },
        open_access_only: { type: "boolean", description: "Optional. If true, only returns open-access works (is_oa:true)." },
      },
      required: ["query"],
    },
  },
};

export const crossrefLookupDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "crossref_lookup",
    description: "R125+4 — Query Crossref, the authoritative DOI registry (~150M works). Dual-mode: (a) if the query LOOKS like a DOI ('10.x/y' pattern), does a direct DOI lookup; (b) otherwise runs a search query. FREE public JSON API, polite mailto pool. Returns normalized ScholarResult[] with HTML-stripped abstracts when publishers deposit them. Use for DOI resolution, exact-title disambiguation, or when you have a citation and want to fetch its canonical record. For semantic 'find me papers about X', prefer openalex_search or academic_search.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Either a DOI ('10.1038/nature12373') or a search query." },
        max_results: { type: "number", description: "Optional. 1-25, default 5. Ignored in DOI-lookup mode." },
      },
      required: ["query"],
    },
  },
};

export const firecrawlSearchDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "firecrawl_search",
    description: "Search the web using Firecrawl and get clean, LLM-ready markdown results. Better than web_search for getting actual page content — returns full scraped markdown from top results. Use for deep research when you need the actual content of web pages, not just summaries.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — keywords or question" },
        limit: { type: "number", description: "Number of results to return (1-10, default 5)" },
      },
      required: ["query"],
    },
  },
};

export const firecrawlScrapeDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "firecrawl_scrape",
    description: "Scrape a single URL using Firecrawl, extract clean markdown content, and save it to the scraped pages database for later retrieval. Returns the page content and a database ID. Use when you need to capture and store a specific web page.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to scrape" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags to organize this page (e.g. ['competitor', 'pricing'])" },
      },
      required: ["url"],
    },
  },
};

export const readabilityExtractDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "readability_extract",
    description: "Extract clean article text from any URL using Mozilla's Readability.js (the Firefox Reader View engine). Free, runs locally, zero per-call API cost. Best for articles, blog posts, docs, news. Returns title, byline, excerpt, and clean text. Use this BEFORE firecrawl_scrape when you only need readable article text — it costs nothing.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The article URL to extract" },
      },
      required: ["url"],
    },
  },
};

export const firecrawlCrawlDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "firecrawl_crawl",
    description: "Crawl an entire website using Firecrawl — follows links from a starting URL, scrapes multiple pages, and stores all content in the database. Great for indexing competitor sites, documentation portals, or any multi-page site. Returns list of all pages found and stored.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Starting URL to crawl from" },
        limit: { type: "number", description: "Max pages to crawl (1-100, default 20)" },
        maxDepth: { type: "number", description: "Max link depth from starting URL (default 3)" },
        includePaths: { type: "array", items: { type: "string" }, description: "Only crawl URLs matching these path patterns (e.g. ['/blog/*', '/docs/*'])" },
        excludePaths: { type: "array", items: { type: "string" }, description: "Skip URLs matching these path patterns (e.g. ['/login', '/admin/*'])" },
        tags: { type: "array", items: { type: "string" }, description: "Tags to apply to all crawled pages" },
      },
      required: ["url"],
    },
  },
};

export const firecrawlMapDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "firecrawl_map",
    description: "Quickly discover all URLs on a website without scraping them. Returns a sitemap-like list of all reachable pages. Use to plan a targeted crawl or understand a site's structure before scraping.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The website URL to map" },
      },
      required: ["url"],
    },
  },
};

export const scrapedPagesQueryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "scraped_pages_query",
    description: "Search and browse the database of previously scraped/crawled web pages. Filter by domain, search content, or browse by tags. Returns page summaries with content previews.",
    parameters: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Filter by domain (e.g. 'example.com')" },
        search: { type: "string", description: "Search term to find in page content or titles" },
        limit: { type: "number", description: "Results per page (default 20, max 50)" },
        offset: { type: "number", description: "Offset for pagination (default 0)" },
      },
      required: [],
    },
  },
};

export const scrapedPageReadDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "scraped_page_read",
    description: "Read the full content of a specific scraped page by its database ID. Use after scraped_pages_query to get the complete markdown content of a page.",
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "number", description: "The page ID from scraped_pages_query results" },
      },
      required: ["pageId"],
    },
  },
};

export const scrapedPagesDeleteDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "scraped_pages_delete",
    description: "Use when cleaning up the scraped-pages cache — typically before re-scraping fresh content, when removing pages from a deprecated source, or when pruning to free DB space. Three sub-ops: by ID(s), by domain, or by age (older than N days). Returns deleted count. Irreversible — re-scrape if needed afterward.",
    parameters: {
      type: "object",
      properties: {
        pageIds: { type: "array", items: { type: "number" }, description: "Specific page IDs to delete" },
        domain: { type: "string", description: "Delete all pages from this domain" },
        olderThanDays: { type: "number", description: "Delete pages scraped more than N days ago" },
      },
      required: [],
    },
  },
};

export const webDomainDefinitions: ToolDefinition[] = [
  webFetchDefinition,
  webSearchDefinition,
  fetchWeatherDefinition,
  fetchCryptoPriceDefinition,
  fetchExchangeRateDefinition,
  fetchWikipediaDefinition,
  fetchHackerNewsDefinition,
  lookupIpGeoDefinition,
  academicSearchDefinition,
  arxivSearchDefinition,
  pubmedSearchDefinition,
  openalexSearchDefinition,
  crossrefLookupDefinition,
  firecrawlSearchDefinition,
  firecrawlScrapeDefinition,
  readabilityExtractDefinition,
  firecrawlCrawlDefinition,
  firecrawlMapDefinition,
  scrapedPagesQueryDefinition,
  scrapedPageReadDefinition,
  scrapedPagesDeleteDefinition,
];
