import { monidDiscover } from "../server/lib/monid";
import { writeFileSync } from "fs";

const QUERIES = [
  // Social media / brand intel (Robert, Felix, marketing personas)
  "twitter posts by handle", "instagram profile scraper", "tiktok trending videos",
  "linkedin company employees", "youtube channel statistics", "reddit subreddit posts",
  "facebook page posts", "threads posts",
  // Commerce / reviews (Felix product PDFs, competitive intel)
  "amazon product reviews", "amazon best sellers", "shopify store products",
  "ebay listings search", "etsy product search", "yelp business reviews",
  "google maps reviews", "tripadvisor reviews",
  // Web data / scraping (autoresearch, competitor intel)
  "google search results", "bing search results", "wikipedia article",
  "domain whois lookup", "website screenshot", "url metadata extraction",
  "rss feed parser", "sitemap extraction",
  // Finance / market data (CEO Robert, finance personas)
  "stock price quote", "crypto price ticker", "company financials",
  "sec filings", "earnings calendar", "news sentiment analysis",
  "forex exchange rates", "commodity prices",
  // Real estate / lead gen (CRM, lead gen personas)
  "zillow property data", "redfin listings", "realtor mls search",
  "linkedin lead enrichment", "company email finder", "phone number lookup",
  // Travel / location (assistants)
  "flight search", "hotel availability", "restaurant search by location",
  "google places api", "weather forecast",
  // Media / AI (Felix media generation, transcription)
  "youtube video download", "video transcription whisper", "image background remove",
  "image upscale", "ocr text from image", "speech to text",
  // Document / PDF (Felix deliverables)
  "pdf to text extraction", "pdf merge", "html to pdf", "docx to pdf",
  // Comms / outreach (sales/CRM)
  "send sms twilio", "email validation", "send transactional email",
  // Productivity / data
  "translate text", "currency converter", "qr code generator",
  // Job market / research
  "indeed jobs search", "glassdoor company reviews", "github repository data",
  "hackernews top stories", "producthunt today",
];

const out: Record<string, any> = {};
const errors: any[] = [];
let i = 0;
const BATCH = 5;
const DELAY_MS = 1500;

// R110.11.5 (architect): hard spend cap. monidDiscover hits a paid external API;
// without an upper bound a future-Bob who appends queries can quietly run up
// the bill. Default 200 covers the current 67-query catalog with headroom;
// set MONID_MAX_QUERIES=N to override (or 0 to disable, explicit opt-out).
const MAX_QUERIES = process.env.MONID_MAX_QUERIES !== undefined
  ? Math.max(0, parseInt(process.env.MONID_MAX_QUERIES, 10) || 0)
  : 200;
if (MAX_QUERIES > 0 && QUERIES.length > MAX_QUERIES) {
  console.error(`[monid-survey] REFUSING TO RUN — ${QUERIES.length} queries exceeds MONID_MAX_QUERIES=${MAX_QUERIES}. Trim QUERIES or raise the cap.`);
  process.exit(3);
}

async function run() {
  for (let b = 0; b < QUERIES.length; b += BATCH) {
    const batch = QUERIES.slice(b, b + BATCH);
    const results = await Promise.all(batch.map(async (q) => {
      try {
        const r: any = await monidDiscover({ query: q, limit: 5 });
        return { q, r };
      } catch (e: any) { return { q, error: e?.message || String(e) }; }
    }));
    for (const { q, r, error } of results) {
      if (error) { errors.push({ q, error }); continue; }
      if (r?.error) { errors.push({ q, error: r.error, status: r.status, body: r.body }); continue; }
      const items = r?.endpoints || r?.results || r?.data || (Array.isArray(r) ? r : []);
      for (const item of items) {
        const slug = `${item.provider}${item.endpoint}`;
        if (!out[slug]) {
          out[slug] = {
            provider: item.provider,
            providerName: item.providerName,
            endpoint: item.endpoint,
            description: item.description,
            price: item.price,
            score: item.score,
            tags: item.tags,
            matchedQueries: [],
          };
        }
        out[slug].matchedQueries.push(q);
        if ((item.score ?? 0) > (out[slug].score ?? 0)) out[slug].score = item.score;
      }
      i++;
    }
    process.stdout.write(`  batch ${Math.floor(b/BATCH)+1}/${Math.ceil(QUERIES.length/BATCH)} done — ${Object.keys(out).length} unique endpoints so far\n`);
    if (b + BATCH < QUERIES.length) await new Promise(r => setTimeout(r, DELAY_MS));
  }
  writeFileSync("data/monid/catalog-raw.json", JSON.stringify({
    queriedAt: new Date().toISOString(),
    queriesRun: QUERIES.length,
    queriesSucceeded: i,
    uniqueEndpoints: Object.keys(out).length,
    endpoints: out,
    errors,
  }, null, 2));
  console.log(`\nDONE. ${Object.keys(out).length} unique endpoints across ${i}/${QUERIES.length} successful queries. ${errors.length} errors.`);
  console.log(`Raw catalog → data/monid/catalog-raw.json`);
}
run().catch(e => { console.error(e); process.exit(1); });
