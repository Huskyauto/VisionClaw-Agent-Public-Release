/**
 * Tools-layer-split S26f — seo-domain migrated handlers.
 *
 * Three pure-text SEO/AEO analysis tools — `aeo_score`, `seo_content_audit`,
 * `generate_schema_markup`. Each handler body is a MECHANICAL move of the legacy
 * switch arm (standing rules: no renames, no behavior change, no added/removed
 * gate). The inner logic — Flesch/keyword scoring, schema.org type switch — is
 * preserved VERBATIM.
 *
 * SEAM: PURE public-param relocation. These arms read NONE of the
 * dispatcher-stripped trust signals (`_tenantId`/`_personaId`/`_conversationId`/
 * `_projectId`) — grepped. They touch no tenant data, no DB, no money, no comms;
 * `generate_schema_markup` reads only `process.env` org defaults. `ctx` is
 * therefore unused (kept in the signature for handler-shape uniformity).
 *
 * `aeo_score`'s backing `../../../lib/aeo-score` module is pulled via call-time
 * dynamic `import(...)` — NOT a top-level static import — so the domain module
 * statically imports only within server/tools/ and cannot recurse back into the
 * app graph (acyclicity invariant, plan.md S2). `lib/aeo-score` does not import
 * the tools facade (grepped). `seo_content_audit` / `generate_schema_markup` have
 * no backing lib (fully inline), so they are trivially acyclic.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  aeoScoreDefinition,
  seoContentAuditDefinition,
  generateSchemaMarkupDefinition,
} from "./definitions";

async function aeoScoreHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  // R125+83 — AEO citation-readiness scorer (adapted from siddiqss/semantic-seo-suite, MIT).
  // Pure text analysis: no LLM, no network, no DB, no tenant data touched.
  const md = typeof params.markdown === "string" ? params.markdown : "";
  if (md.trim().length < 40) return { error: "markdown must be a draft of at least 40 characters" };
  const { scoreAeo } = await import("../../../lib/aeo-score");
  return { success: true, ...scoreAeo(md) };
}

async function seoContentAuditHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const text = typeof params.content === "string" ? params.content : String(params.content || "");
  if (!text.trim()) return { error: "content is required and cannot be empty" };
  if (text.length > 500_000) return { error: "content too large — max 500,000 characters" };
  const keyword = typeof params.primary_keyword === "string" ? params.primary_keyword.toLowerCase().trim() : "";
  if (!keyword) return { error: "primary_keyword is required and cannot be empty" };
  const secondaryKws = (typeof params.secondary_keywords === "string" ? params.secondary_keywords : "").split(",").map((k: string) => k.trim().toLowerCase()).filter(Boolean).slice(0, 20);

  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentences = text.split(/[.!?]+/).filter((s: string) => s.trim().length > 0);
  const sentenceCount = sentences.length;
  const syllableCount = (word: string) => {
    word = word.toLowerCase().replace(/[^a-z]/g, "");
    if (word.length <= 3) return 1;
    let count = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").match(/[aeiouy]{1,2}/g)?.length || 1;
    return Math.max(count, 1);
  };
  const totalSyllables = words.reduce((sum: number, w: string) => sum + syllableCount(w), 0);
  const avgSyllPerWord = totalSyllables / Math.max(wordCount, 1);
  const avgWordsPerSent = wordCount / Math.max(sentenceCount, 1);
  const fleschEase = Math.round((206.835 - 1.015 * avgWordsPerSent - 84.6 * avgSyllPerWord) * 10) / 10;
  const fleschKincaid = Math.round((0.39 * avgWordsPerSent + 11.8 * avgSyllPerWord - 15.59) * 10) / 10;

  const lowerText = text.toLowerCase();
  const keywordRegex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  const keywordMatches = (text.match(keywordRegex) || []).length;
  const keywordDensity = Math.round((keywordMatches / Math.max(wordCount, 1)) * 10000) / 100;

  const headings = text.match(/^#{1,6}\s.+$/gm) || text.match(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi) || [];
  const h1Count = headings.filter((h: string) => /^#\s|<h1/i.test(h)).length;
  const h2Count = headings.filter((h: string) => /^##\s|<h2/i.test(h)).length;
  const headingsWithKeyword = headings.filter((h: string) => h.toLowerCase().includes(keyword)).length;

  const paragraphs = text.split(/\n\n+/).filter((p: string) => p.trim().length > 20);
  const avgParaLen = paragraphs.reduce((s: number, p: string) => s + p.split(/\s+/).length, 0) / Math.max(paragraphs.length, 1);

  const first100 = words.slice(0, 100).join(" ").toLowerCase();
  const keywordInFirst100 = first100.includes(keyword);
  const last100 = words.slice(-100).join(" ").toLowerCase();
  const keywordInConclusion = last100.includes(keyword);

  const secondaryResults = secondaryKws.map((kw: string) => {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const count = (text.match(re) || []).length;
    return { keyword: kw, count, density: Math.round((count / Math.max(wordCount, 1)) * 10000) / 100 };
  });

  let metaScore = 0;
  const metaIssues: string[] = [];
  if (params.meta_title) {
    const tLen = params.meta_title.length;
    if (tLen >= 50 && tLen <= 60) metaScore += 15; else if (tLen >= 40 && tLen <= 70) { metaScore += 10; metaIssues.push(`Meta title is ${tLen} chars (ideal: 50-60)`); } else { metaScore += 5; metaIssues.push(`Meta title is ${tLen} chars (ideal: 50-60)`); }
    if (params.meta_title.toLowerCase().includes(keyword)) metaScore += 10; else metaIssues.push("Primary keyword missing from meta title");
  } else { metaIssues.push("No meta title provided"); }
  if (params.meta_description) {
    const dLen = params.meta_description.length;
    if (dLen >= 150 && dLen <= 160) metaScore += 10; else if (dLen >= 120 && dLen <= 170) { metaScore += 7; metaIssues.push(`Meta description is ${dLen} chars (ideal: 150-160)`); } else { metaScore += 3; metaIssues.push(`Meta description is ${dLen} chars (ideal: 150-160)`); }
    if (params.meta_description.toLowerCase().includes(keyword)) metaScore += 5; else metaIssues.push("Primary keyword missing from meta description");
  } else { metaIssues.push("No meta description provided"); }

  let readabilityScore = 0;
  if (fleschEase >= 60) readabilityScore = 20; else if (fleschEase >= 50) readabilityScore = 15; else if (fleschEase >= 30) readabilityScore = 10; else readabilityScore = 5;

  let keywordScore = 0;
  if (keywordDensity >= 0.5 && keywordDensity <= 2.5) keywordScore += 10; else if (keywordDensity > 2.5) keywordScore += 3; else keywordScore += 5;
  if (keywordInFirst100) keywordScore += 5;
  if (keywordInConclusion) keywordScore += 3;
  if (headingsWithKeyword >= 2) keywordScore += 7; else if (headingsWithKeyword >= 1) keywordScore += 4;

  let structureScore = 0;
  if (h1Count === 1) structureScore += 5; else if (h1Count > 1) structureScore += 2;
  if (h2Count >= 3) structureScore += 5; else if (h2Count >= 1) structureScore += 3;
  if (wordCount >= 2000) structureScore += 5; else if (wordCount >= 1000) structureScore += 3; else structureScore += 1;
  if (avgParaLen <= 80) structureScore += 5; else if (avgParaLen <= 120) structureScore += 3;

  const totalScore = Math.min(100, readabilityScore + keywordScore + metaScore + structureScore);
  const grade = totalScore >= 80 ? "A" : totalScore >= 60 ? "B" : totalScore >= 40 ? "C" : totalScore >= 20 ? "D" : "F";

  const recommendations: string[] = [];
  if (keywordDensity < 0.5) recommendations.push(`Increase keyword "${keyword}" usage — currently ${keywordDensity}%, aim for 1-2%`);
  if (keywordDensity > 2.5) recommendations.push(`Reduce keyword "${keyword}" density — currently ${keywordDensity}% (risk of keyword stuffing)`);
  if (!keywordInFirst100) recommendations.push(`Add "${keyword}" to the first 100 words of your content`);
  if (headingsWithKeyword < 2) recommendations.push(`Include "${keyword}" in at least 2 headings`);
  if (wordCount < 1500) recommendations.push(`Content is ${wordCount} words — consider expanding to 2000+ for competitive SEO`);
  if (fleschEase < 50) recommendations.push(`Readability is low (Flesch: ${fleschEase}) — simplify sentences and use shorter words`);
  if (avgParaLen > 100) recommendations.push(`Paragraphs are too long (avg ${Math.round(avgParaLen)} words) — break into 40-80 word chunks`);
  if (h2Count < 3) recommendations.push("Add more H2 subheadings to improve scannability");
  recommendations.push(...metaIssues);

  return {
    seo_score: { total: totalScore, grade, breakdown: { readability: readabilityScore, keyword_optimization: keywordScore, meta_elements: metaScore, content_structure: structureScore } },
    readability: { flesch_reading_ease: fleschEase, flesch_kincaid_grade: fleschKincaid, avg_words_per_sentence: Math.round(avgWordsPerSent * 10) / 10, avg_syllables_per_word: Math.round(avgSyllPerWord * 100) / 100, interpretation: fleschEase >= 70 ? "Easy to read" : fleschEase >= 50 ? "Fairly easy" : fleschEase >= 30 ? "Difficult" : "Very difficult" },
    keyword_analysis: { primary: { keyword, count: keywordMatches, density_pct: keywordDensity, in_first_100_words: keywordInFirst100, in_conclusion: keywordInConclusion, in_headings: headingsWithKeyword, optimal_range: "1.0-2.0%" }, secondary: secondaryResults },
    content_structure: { word_count: wordCount, sentence_count: sentenceCount, paragraph_count: paragraphs.length, heading_count: headings.length, h1_count: h1Count, h2_count: h2Count, avg_paragraph_length: Math.round(avgParaLen) },
    recommendations,
  };
}

async function generateSchemaMarkupHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const type = params.schema_type || "auto";
  const title = typeof params.title === "string" ? params.title.trim() : "";
  if (!title) return { error: "title is required" };
  const desc = typeof params.description === "string" ? params.description : "";
  const url = typeof params.page_url === "string" ? params.page_url : "";
  const parseJsonParam = (val: any, label: string): { data: any[]; warning?: string } => {
    if (!val) return { data: [] };
    try { const d = JSON.parse(val); return Array.isArray(d) ? { data: d } : { data: [], warning: `${label} must be a JSON array` }; }
    catch { return { data: [], warning: `Invalid JSON in ${label}` }; }
  };

  const buildOrg = () => {
    const org: any = { "@type": "Organization", name: params.organization_name || (process.env.SITE_COMPANY_LEGAL || "Your Organization"), url: params.organization_url || (process.env.SITE_WEBSITE_URL || "") };
    if (params.organization_logo) org.logo = params.organization_logo;
    return org;
  };

  let schema: any;
  const effectiveType = type === "auto" ? (params.faq_pairs ? "FAQPage" : params.steps ? "HowTo" : params.price ? "Product" : params.event_start ? "Event" : "Article") : type;

  switch (effectiveType) {
    case "Article":
    case "BlogPosting":
      schema = { "@context": "https://schema.org", "@type": effectiveType, headline: title, description: desc, url, author: { "@type": "Person", name: params.author || "" }, datePublished: params.date_published || new Date().toISOString(), dateModified: params.date_modified || new Date().toISOString(), publisher: buildOrg(), mainEntityOfPage: { "@type": "WebPage", "@id": url } };
      if (params.image_url) schema.image = params.image_url;
      break;
    case "Product":
      schema = { "@context": "https://schema.org", "@type": "Product", name: title, description: desc, url };
      if (params.image_url) schema.image = params.image_url;
      if (params.price) schema.offers = { "@type": "Offer", price: params.price, priceCurrency: params.currency || "USD", availability: "https://schema.org/InStock", url };
      break;
    case "SoftwareApplication":
      schema = { "@context": "https://schema.org", "@type": "SoftwareApplication", name: title, description: desc, url, applicationCategory: "BusinessApplication", operatingSystem: "Web" };
      if (params.price) schema.offers = { "@type": "Offer", price: params.price, priceCurrency: params.currency || "USD" };
      break;
    case "FAQPage": {
      const faqResult = parseJsonParam(params.faq_pairs, "faq_pairs");
      schema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqResult.data.map((p: any) => ({ "@type": "Question", name: p.question, acceptedAnswer: { "@type": "Answer", text: p.answer } })) };
      if (faqResult.warning) (schema as any)._warning = faqResult.warning;
      break;
    }
    case "HowTo": {
      const stepsResult = parseJsonParam(params.steps, "steps");
      schema = { "@context": "https://schema.org", "@type": "HowTo", name: title, description: desc, step: stepsResult.data.map((s: any, i: number) => ({ "@type": "HowToStep", position: i + 1, name: s.name, text: s.text })) };
      if (params.image_url) schema.image = params.image_url;
      if (stepsResult.warning) (schema as any)._warning = stepsResult.warning;
      break;
    }
    case "Organization":
      schema = { "@context": "https://schema.org", ...buildOrg(), description: desc };
      break;
    case "LocalBusiness":
      schema = { "@context": "https://schema.org", "@type": "LocalBusiness", name: title, description: desc, url };
      if (params.image_url) schema.image = params.image_url;
      break;
    case "Event":
      schema = { "@context": "https://schema.org", "@type": "Event", name: title, description: desc, url, startDate: params.event_start, endDate: params.event_end, location: params.event_location === "Online" ? { "@type": "VirtualLocation", url } : { "@type": "Place", name: params.event_location || "" }, organizer: buildOrg() };
      if (params.image_url) schema.image = params.image_url;
      break;
    case "BreadcrumbList": {
      const crumbResult = parseJsonParam(params.breadcrumbs, "breadcrumbs");
      schema = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbResult.data.map((c: any, i: number) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })) };
      if (crumbResult.warning) (schema as any)._warning = crumbResult.warning;
      break;
    }
    case "WebSite":
      schema = { "@context": "https://schema.org", "@type": "WebSite", name: title, url, description: desc, publisher: buildOrg() };
      break;
    case "VideoObject":
      schema = { "@context": "https://schema.org", "@type": "VideoObject", name: title, description: desc, url, thumbnailUrl: params.image_url || "", uploadDate: params.date_published || new Date().toISOString() };
      break;
    default:
      schema = { "@context": "https://schema.org", "@type": effectiveType, name: title, description: desc, url };
  }

  const jsonLd = JSON.stringify(schema, null, 2);
  const safeJsonLd = jsonLd.replace(/<\//g, "<\\/");
  const htmlSnippet = `<script type="application/ld+json">\n${safeJsonLd}\n</script>`;
  return { schema_type: effectiveType, json_ld: schema, html_snippet: htmlSnippet, validation_url: `https://search.google.com/test/rich-results`, notes: `Generated ${effectiveType} schema. Validate at Google Rich Results Test before deploying.` };
}

/** Registered by ./index.ts at import time. */
export const seoDomainTools: RegisteredTool[] = [
  defineTool(aeoScoreDefinition, aeoScoreHandler),
  defineTool(seoContentAuditDefinition, seoContentAuditHandler),
  defineTool(generateSchemaMarkupDefinition, generateSchemaMarkupHandler),
];
