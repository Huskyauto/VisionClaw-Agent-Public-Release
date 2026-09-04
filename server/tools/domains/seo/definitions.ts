/**
 * Tools-layer-split S26f — seo-domain tool definitions.
 *
 * Three pure-text SEO/AEO analysis tools:
 *   - `aeo_score`             — citation-readiness scorer (backed by server/lib/aeo-score)
 *   - `seo_content_audit`     — SEO quality/readability/keyword audit (INLINE logic)
 *   - `generate_schema_markup`— JSON-LD structured-data generator (INLINE logic)
 *
 * All three are PURE public-param relocations — they read NO dispatcher-stripped
 * trust signals (`_tenantId`/`_personaId`/`_conversationId`/`_projectId`), touch
 * no tenant data, no money, no comms (grepped). The safest seam class.
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const aeoScoreDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "aeo_score",
    description: "R125+83 — Score a Markdown draft's citation-readiness for AI answer engines (Google AI Overviews, ChatGPT, Perplexity). Pure mechanical text analysis (no LLM, no network): checks definition-first lead, question-H2 answer coverage, TL;DR presence, structured blocks (lists/tables), sentence brevity, self-contained paragraphs, and schema front-matter. Returns a 0-100 score, per-signal breakdown, and concrete hardening advice. ADVISORY — use it on blog posts, landing copy, wedge content, and audit deliverables to answer 'will AI engines cite this?'. Do NOT use on non-prose content (code, JSON, tables of data).",
    parameters: {
      type: "object",
      properties: {
        markdown: { type: "string", description: "The full Markdown draft to score (front-matter optional; schema_type in front-matter earns the SCHEMA signal)." },
      },
      required: ["markdown"],
    },
  },
};

export const seoContentAuditDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "seo_content_audit",
    description: "Analyze content for SEO quality, readability, and keyword optimization. Returns a comprehensive SEO score (0-100) with category breakdowns: readability (Flesch Reading Ease, Flesch-Kincaid Grade Level), keyword density and distribution, content structure (heading hierarchy, paragraph length), meta element evaluation, and actionable improvement recommendations. Use when reviewing blog posts, landing pages, or any web content for search optimization.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The full text content to analyze (article body, blog post, or page content)" },
        primary_keyword: { type: "string", description: "The primary target keyword to check density and placement for" },
        secondary_keywords: { type: "string", description: "Comma-separated list of secondary/LSI keywords to check" },
        meta_title: { type: "string", description: "Page meta title to evaluate (optional)" },
        meta_description: { type: "string", description: "Page meta description to evaluate (optional)" },
        url: { type: "string", description: "URL of the page (optional, for context)" },
      },
      required: ["content", "primary_keyword"],
    },
  },
};

export const generateSchemaMarkupDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "generate_schema_markup",
    description: "Generate JSON-LD structured data (schema.org markup) for any web page. Supports Article, Product, FAQPage, HowTo, Organization, LocalBusiness, SoftwareApplication, BreadcrumbList, Event, and more. Returns valid JSON-LD ready to paste into HTML <head>. Use when optimizing pages for rich snippets, knowledge panels, or enhanced search results.",
    parameters: {
      type: "object",
      properties: {
        schema_type: { type: "string", enum: ["Article", "BlogPosting", "Product", "SoftwareApplication", "FAQPage", "HowTo", "Organization", "LocalBusiness", "Event", "BreadcrumbList", "WebSite", "VideoObject", "auto"], description: "Schema type to generate. Use 'auto' to detect best type from content." },
        page_url: { type: "string", description: "URL of the page this schema is for" },
        title: { type: "string", description: "Page/article title or product name" },
        description: { type: "string", description: "Page description or summary" },
        content: { type: "string", description: "Page content (used for auto-detection and FAQ extraction)" },
        author: { type: "string", description: "Author name (for Article/BlogPosting)" },
        date_published: { type: "string", description: "Publication date ISO 8601 (for Article)" },
        date_modified: { type: "string", description: "Last modified date ISO 8601 (for Article)" },
        image_url: { type: "string", description: "Primary image URL" },
        organization_name: { type: "string", description: "Organization/company name" },
        organization_url: { type: "string", description: "Organization website URL" },
        organization_logo: { type: "string", description: "Organization logo URL" },
        price: { type: "string", description: "Product/software price (for Product/SoftwareApplication)" },
        currency: { type: "string", description: "Price currency code e.g. USD (for Product)" },
        faq_pairs: { type: "string", description: "JSON array of {question, answer} objects for FAQPage" },
        steps: { type: "string", description: "JSON array of {name, text} objects for HowTo" },
        breadcrumbs: { type: "string", description: "JSON array of {name, url} objects for BreadcrumbList" },
        event_start: { type: "string", description: "Event start date ISO 8601" },
        event_end: { type: "string", description: "Event end date ISO 8601" },
        event_location: { type: "string", description: "Event location name or 'Online'" },
      },
      required: ["schema_type", "title"],
    },
  },
};

export const seoDomainDefinitions: ToolDefinition[] = [
  aeoScoreDefinition,
  seoContentAuditDefinition,
  generateSchemaMarkupDefinition,
];
