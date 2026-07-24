/**
 * Tools-layer-split S9 — web domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time (registry doc: registration happens in the
 * domain index barrels as they come online).
 */
import { registerTools } from "../../registry";
import { webDomainTools } from "./handlers";

registerTools(webDomainTools);

export {
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
  webDomainDefinitions,
} from "./definitions";

export { webDomainTools, webSearch } from "./handlers";
