import { readFileSync, writeFileSync } from "fs";

const raw = JSON.parse(readFileSync("data/monid/catalog-raw.json", "utf-8"));
const eps: any[] = Object.entries(raw.endpoints).map(([slug, e]: any) => ({ slug, ...e }));

const CATEGORIES: Record<string, { keywords: string[]; description: string; vcaUseCase: string }> = {
  social_media: {
    keywords: ["twitter","instagram","linkedin","tiktok","reddit","facebook","youtube","threads"],
    description: "Scrape posts, profiles, engagement metrics from social platforms",
    vcaUseCase: "Competitive intel, brand monitoring, content research for Felix videos, Robert/CEO market sweep, lead-gen profile enrichment",
  },
  commerce_reviews: {
    keywords: ["amazon","shopify","etsy","ebay","yelp","google-maps","tripadvisor","glassdoor","reviews","best-sellers","google-shopping","product-search"],
    description: "Product listings, reviews, ratings, seller data from e-commerce + review platforms",
    vcaUseCase: "Felix product PDFs (review summaries), competitor pricing intel, employer-brand research",
  },
  web_research: {
    keywords: ["google-search","bing","screenshot","meta-extract","sitemap","whois","dns","rss","wikipedia","mx-lookup","google-news","exa/contents","url-to-text","url-to-markdown"],
    description: "Web search, page metadata, screenshots, domain intel, structured web data, content extraction",
    vcaUseCase: "Autoresearch loop, competitor domain audits, knowledge-library ingestion, fact-check on public claims",
  },
  finance_market: {
    keywords: ["stock","crypto","sec","earnings","forex","exchange-rate","binance","polymarket","ticker","wallet","/trades","dflow","candles","candlestick","up/down","prediction-market"],
    description: "Stock/crypto prices, SEC filings, market data, prediction markets, on-chain wallet activity",
    vcaUseCase: "CEO Robert market briefings, finance-personas portfolio analysis, ticker forecasting cross-check",
  },
  lead_enrichment: {
    keywords: ["pdl","person","enrich","email-validate","email-valid","phone-validate","company-finder","linkedin-company","linkedin-employees","postal-code","adverse-media"],
    description: "Person + company enrichment, email/phone validation, B2B contact discovery, screening",
    vcaUseCase: "CRM lead-gen pipeline, sales-outreach prep, account-based marketing, deal qualification, KYC pre-screen",
  },
  media_ai: {
    keywords: ["ocr","transcrib","whisper","image-to-text","background-remove","upscale","speech","video-download","image-resize","image-crop","image-convert"],
    description: "OCR, transcription, image cleanup/resize, video download — AI media utilities",
    vcaUseCase: "Felix media pipeline (OCR receipts/screenshots, transcribe podcasts, image prep), accessibility passes",
  },
  document_pdf: {
    keywords: ["pdf-extract","pdf","docx","html-to-pdf","markdown-to-html","doc-merge"],
    description: "PDF text extraction, doc conversion, HTML/markdown↔PDF",
    vcaUseCase: "Customer-uploaded contract analysis, legal review, deliverable conversion",
  },
  comms_outreach: {
    keywords: ["twilio","sms","transactional-email","email-send","email-draft","outreach"],
    description: "Email drafting, SMS/transactional email send, outbound outreach helpers",
    vcaUseCase: "Outbound sales cadence pre-flight, drip campaign hygiene, customer comms",
  },
  utilities: {
    keywords: ["translate","currency-convert","exchange","qr-code","weather","forecast","air-quality","language-detect","payment-reference"],
    description: "Translation, currency, weather, QR, language detection, small utility calls",
    vcaUseCase: "i18n customer comms, multi-currency invoicing, travel-assistant briefings",
  },
};

const MANUAL_OVERRIDES: Record<string, string> = {
  "blockrun.ai/api/v1/exa/contents": "web_research",
  "api.strale.io/x402/url-to-text": "web_research",
  "openweather-coral.vercel.app/weather/forecast": "utilities",
  "openweather-coral.vercel.app/weather/current": "utilities",
  "openweather-coral.vercel.app/weather/air-quality": "utilities",
  "api.strale.io/x402/payment-reference-generate": "utilities",
  "api.strale.io/x402/image-to-text": "media_ai",
  "blockrun.ai/api/v1/pm/dflow/trades": "finance_market",
  "api.strale.io/x402/wallet-transactions-lookup": "finance_market",
  "api.strale.io/x402/email-draft": "comms_outreach",
  "pdl/v5/company/enrich": "lead_enrichment",
};

function categorize(e: any): string | null {
  if (MANUAL_OVERRIDES[e.slug]) return MANUAL_OVERRIDES[e.slug];
  const slug = (e.slug || "").toLowerCase();
  const desc = (e.description || "").toLowerCase();
  const haystack = `${slug} ${desc}`;
  let best: { cat: string; score: number } | null = null;
  for (const [cat, def] of Object.entries(CATEGORIES)) {
    let score = 0;
    for (const k of def.keywords) if (haystack.includes(k)) score++;
    if (score > 0 && (!best || score > best.score)) best = { cat, score };
  }
  return best?.cat || null;
}

function fmtPrice(p: any): string {
  if (!p) return "?";
  if (typeof p === "string") return p;
  const amt = p.amount;
  const type = p.type === "PER_RESULT" ? "/result" : "/call";
  const flat = p.flatFee ? ` + $${p.flatFee} flat` : "";
  return `$${amt}${type}${flat}`;
}

const curated: Record<string, any[]> = {};
for (const c of Object.keys(CATEGORIES)) curated[c] = [];

eps.sort((a,b) => ((b.score||0) - (a.score||0)) || String(a.slug).localeCompare(String(b.slug)));
for (const e of eps) {
  const cat = categorize(e);
  if (!cat) continue;
  if (curated[cat].length >= 8) continue;
  if ((e.score || 0) < 1.2) continue;
  curated[cat].push({
    slug: e.slug,
    provider: e.providerName,
    description: (e.description || "").slice(0, 220),
    price: fmtPrice(e.price),
    score: Number((e.score || 0).toFixed(2)),
  });
}
for (const c of Object.keys(curated)) {
  curated[c].sort((a,b) => (b.score - a.score) || a.slug.localeCompare(b.slug));
}

const total = Object.values(curated).reduce((s, a) => s + a.length, 0);
const out = {
  generatedAt: new Date().toISOString(),
  source: "monid api.monid.ai/v1/discover",
  rawEndpointsHarvested: eps.length,
  curatedEndpoints: total,
  refreshCmd: "npx tsx scripts/monid-catalog-survey.ts && npx tsx scripts/monid-catalog-curate.ts",
  categories: Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, {
    description: v.description,
    vcaUseCase: v.vcaUseCase,
    endpoints: curated[k],
  }])),
};
writeFileSync("data/monid/catalog-curated.json", JSON.stringify(out, null, 2));
console.log(`Curated ${total} endpoints across ${Object.keys(CATEGORIES).length} categories → data/monid/catalog-curated.json`);
for (const [cat, items] of Object.entries(curated)) console.log(`  ${cat.padEnd(20)} ${items.length} endpoints`);
