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
  const hasNamedCompanyLookupIntent =
    /\bcage(?:[-\s]+code)?\b.{0,40}\b(?:for|of)\b/i.test(routingContext)
    || /\blook\s*up\b.{0,80}\b(?:the\s+|these\s+)?compan(?:y|ies)\b/i.test(routingContext)
    || /\bcompany\s+names?\b.{0,80}\bsam[.-]gov\b/i.test(routingContext);
  return hasNamedCompanyLookupIntent ? ["lookup_sam_exact_company"] : ["discover_cmmc_prospects"];
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