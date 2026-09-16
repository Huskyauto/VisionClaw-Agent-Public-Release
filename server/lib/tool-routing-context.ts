type RoutingMessage = {
  role?: unknown;
  content?: unknown;
};

const MAX_RECENT_USER_MESSAGES = 3;
const MAX_ROUTING_CONTEXT_CHARS = 4_000;

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: unknown; text?: unknown } => !!part && typeof part === "object")
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join(" ");
}

export function buildRecentUserRoutingContext(messages: RoutingMessage[]): string {
  const recent = messages
    .filter((message) => message?.role === "user")
    .map((message) => messageText(message.content).trim())
    .filter(Boolean)
    .slice(-MAX_RECENT_USER_MESSAGES);

  return recent.join("\n").slice(-MAX_ROUTING_CONTEXT_CHARS).toLowerCase();
}

export function getLatestUserRoutingMessage(messages: RoutingMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    return messageText(message.content).trim().toLowerCase();
  }
  return "";
}

export function getMandatoryContextTools(routingContext: string): string[] {
  const hasCmmcProspectingIntent =
    /\bcmmc\b/i.test(routingContext)
    || /\bsam[.-]gov\b/i.test(routingContext)
    || /\bfederal[-\s]contract(?:or|ors|ing)?\b/i.test(routingContext)
    || /\bcage(?:[-\s]+code)?\b/i.test(routingContext);

  if (!hasCmmcProspectingIntent) return [];
  const delimitedLookup = routingContext.match(
    /\b(?:look\s*up|verify|check|find)\s+(?!all\b|every\b|companies\b|entities\b|contractors\b)(.{2,180}?)\s+(?:in|on|against)\s+sam[.-]gov\b/i,
  );
  const delimitedNames = delimitedLookup?.[1].split(/[,/]/).map((part) => part.trim()).filter(Boolean) ?? [];
  const secondDelimitedName = delimitedNames[1] ?? "";
  const hasSuppliedDelimitedList = delimitedNames.length > 2
    || (delimitedNames.length === 2
      && !/^(?:incorporated|inc|llc|ltd|limited|corp|corporation|company|co|lp|llp|pllc)\.?$/i.test(secondDelimitedName)
      && !/&\s*co\.?$/i.test(secondDelimitedName));
  const hasSuppliedNameList =
    /\b(?:companies|entities|contractors|roster|tier\s*\d+|group)\s*:\s*[^,;\n]+[,;]\s*[^,;\n]+/i.test(routingContext)
    || /\b(?:companies|entities|contractors|roster|tier\s*\d+|group)\s*:\s*(?:\n\s*[-*]\s*[^\n]+){2,}/i.test(routingContext)
    || /\bhere\s+is\s+(?:our|the)\s+(?:roster|list)\s*:\s*[^,;\n]+[,;]\s*[^,;\n]+/i.test(routingContext)
    || /\blook\s*up\s+(?!all\b|every\b|companies\b|entities\b|contractors\b).{1,80}\band\s+(?!its\b|their\b|the\b).{1,80}\bsam[.-]gov\b/i.test(routingContext)
    || hasSuppliedDelimitedList
    || /\bverify\s+(?:these|those|the following)\s+(?:companies|entities|contractors)\b/i.test(routingContext);
  const hasUnsuppliedRosterIntent =
    !hasSuppliedNameList
    && /\b(?:build|create|find|discover|list|verify|check)\b.{0,100}\b(?:roster(?:\s+of)?|all|every|compan(?:y|ies)|entit(?:y|ies)|contractors?)\b.{0,80}\b(?:in|from|across|within)\s+(?!sam[.-]gov\b)[a-z]{2,}/i.test(routingContext);
  if (hasUnsuppliedRosterIntent) return ["discover_cmmc_prospects"];
  const hasSingleCompanyPossessiveLookup =
    /\blook\s*up\b.{1,100}\band\s+(?:its|the\s+company(?:'s)?)\b.{0,80}\bsam[.-]gov\b/i.test(routingContext);
  if (hasSingleCompanyPossessiveLookup) return ["lookup_sam_exact_company"];
  const hasSimpleNamedCompanyLookup =
    /\b(?:look\s*up|verify|check|find)\s+(?!all\b|every\b|these\b|those\b|multiple\b|companies\b|entities\b|contractors\b).{2,100}\b(?:in|on|against)\s+sam[.-]gov\b/i.test(routingContext);
  const hasGroupedCompanyLookupIntent =
    hasSuppliedNameList
    || /\b(?:tier|group|roster|list|batch)\b.{0,100}\b(?:compan(?:y|ies)|entit(?:y|ies)|contractors?)\b/i.test(routingContext)
    || /\b(?:every|all|these|those|multiple)\b.{0,60}\b(?:compan(?:y|ies)|entit(?:y|ies)|contractors?)\b/i.test(routingContext)
    || (/\btier\s*\d+\b/i.test(routingContext) && /\b(?:look\s*up|verify|check)\b/i.test(routingContext));
  if (hasGroupedCompanyLookupIntent) return ["lookup_sam_company_cage"];
  const hasNamedCompanyLookupIntent =
    hasSimpleNamedCompanyLookup
    || /\bcage(?:[-\s]+code)?\b.{0,40}\b(?:for|of)\b/i.test(routingContext)
    || /\blook\s*up\b.{0,80}\b(?:the\s+)?company\b/i.test(routingContext)
    || /\bcompany\s+name\b.{0,80}\bsam[.-]gov\b/i.test(routingContext);
  return hasNamedCompanyLookupIntent ? ["lookup_sam_exact_company"] : ["discover_cmmc_prospects"];
}

export type CmmcAuthoritativeSourceLock =
  | "cmmc_sam_exact"
  | "cmmc_sam_batch"
  | "cmmc_sam_discovery";

export function getCmmcAuthoritativeSourceLock(routingContext: string): CmmcAuthoritativeSourceLock | undefined {
  const selected = getMandatoryContextTools(routingContext)[0];
  if (selected === "lookup_sam_exact_company") return "cmmc_sam_exact";
  if (selected === "lookup_sam_company_cage") return "cmmc_sam_batch";
  if (selected === "discover_cmmc_prospects") return "cmmc_sam_discovery";
  return undefined;
}

export function isForbiddenCmmcFallbackDelegation(input: string): boolean {
  const raw = String(input || "");
  const text = raw.toLowerCase();
  const hasCmmcSourceIntent =
    /\bcmmc\b/.test(text)
    || /\bsam[.-]gov\b/.test(text)
    || /\bSAM\b/.test(raw)
    || /\bcage(?:[-\s]+code)?\b/.test(text)
    || /\bfederal[-\s]contract(?:or|ors|ing)?\b/.test(text);
  if (!hasCmmcSourceIntent) return false;

  return /\b(prospect|roster|research|discover|find|search|source|fetch|browse|browser|scrape|verify|compan(?:y|ies)|entit(?:y|ies)|contractor|cage)\b/.test(text);
}