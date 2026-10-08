/**
 * Purpose-level safeguard for explicit third-party pseudonym-to-person requests.
 *
 * This does not search, resolve, rank, or store identities. It inspects only
 * tenant-scoped persisted USER turns supplied by an authenticated caller.
 * Keeping the original request in the conversation prevents a later benign-
 * looking step or a delegation from laundering that request's purpose.
 */
export const THIRD_PARTY_IDENTITY_REFUSAL =
  "I can't help identify a person behind a pseudonymous account or continue that task in this conversation. I can help review your own posts for privacy risks or discuss protections without identifying anyone.";

export function thirdPartyIdentityGuardEnabled(): boolean {
  return process.env.THIRD_PARTY_IDENTITY_GUARD !== "off";
}

type UserTurn = { role: string; content: string; id?: number };
export type IdentityPurposeVerdict =
  | { blocked: false }
  | { blocked: true; reason: "third_party_identity_link" | "history_unavailable" };

const PSEUDONYMOUS_TARGET =
  /\b(?:anonymous|pseudonymous|pseudonym|throwaway|alt(?:ernate)?|reddit|hacker\s*news|forum)\b.{0,85}\b(?:accounts?|users?|profiles?|handles?|posters?|commenters?|authors?)\b|\b(?:accounts?|users?|profiles?|handles?|posters?)\b.{0,85}\b(?:anonymous|pseudonymous|pseudonym|throwaway|reddit|hacker\s*news|forum)\b|(?:^|[\s(])u\/[\w-]{2,}|(?:^|[\s(])@[\w.-]{2,}/i;

// Require a requested action, not a quotation or a mention of a risk or paper.
const DIRECT_REQUEST =
  /(?:^|[.!?;:]\s+|-->\s*)(?:please\s+|can you\s+|could you\s+|help me\s+|i (?:want|need) you to\s+|your task is to\s+|now\s+|then\s+)*(?:identify|unmask|deanonymi[sz]e|re-?identify|doxx?|find (?:out )?(?:the real name|the identity|who|the person behind)|figure out who|tell me who|who (?:is|runs|owns) (?:the person )?behind)\b|\b(?:please|can you|could you|help me|i (?:want|need) you to|your task is to|now|then)\s+(?:identify|unmask|deanonymi[sz]e|re-?identify|doxx?|find (?:out )?(?:the real name|the identity|who|the person behind)|figure out who|tell me who)\b/i;

// The object of the requested action must be a person/account identity, not
// "identify privacy risks" followed later by a mention of identity leakage.
const IDENTITY_OBJECT =
  /\b(?:identify|find(?: out)?|figure out|tell me)\s+(?:(?:the|this|that|these|those|an?)\s+)?(?:real (?:name|identity|person|people)|legal name|offline identity|identity of|person behind|people behind|who (?:is|runs|owns)|anonymous (?:users?|accounts?|posters?|people)|pseudonymous (?:users?|accounts?|posters?|people))\b/i;
const DEANON_OBJECT =
  /\b(?:unmask|deanonymi[sz]e|re-?identify|doxx?)\s+(?:(?:the|this|that|these|those|an?)\s+)?(?:anonymous|pseudonymous|throwaway|reddit|forum|user|account|handle|poster|person|people|u\/|@)\b/i;
const WHO_BEHIND = /\bwho (?:is|runs|owns) (?:the person )?behind\b/i;

// An account-to-real-profile match can be split into seemingly benign steps.
// This covers explicit cross-site linkage in the original goal; it does not
// claim to infer unspoken intentions from unrelated searches.
const CROSS_SITE_LINK =
  /\b(?:match|link|connect|cross.reference|search for|find)\b.{0,180}\b(?:linkedin (?:profile|account)|real (?:name|identity)|offline (?:identity|profile)|person behind)\b|\b(?:linkedin (?:profile|account)|real (?:name|identity)|offline (?:identity|profile))\b.{0,180}\b(?:match|link|connect|cross.reference)\b|\bfind\b.{0,160}\b(?:anonymous|pseudonymous|reddit|forum)\b.{0,85}\b(?:accounts?|profiles?|users?)\b.{0,80}\bon linkedin\b|\b(?:match|link|connect|cross.reference)\b.{0,180}\b(?:to|with)\s+(?:(?:an?|the|its)\s+)?linkedin\s+(?:users?|pages?|people|person|members?)\b|\b(?:find|search for|look up)\b.{0,70}\blinkedin (?:page|profile|account)\b.{0,75}\b(?:belonging to|for|of)\b.{0,75}\b(?:anonymous|pseudonymous|reddit|forum)\b/i;
const REFERENTIAL_LINK =
  /\b(?:find|search for|look up|match|link|cross.reference|trace|identify|tell me)\b.{0,100}\b(?:their|his|her|its|that|this)\b.{0,80}\b(?:linkedin(?:\s+(?:profile|account))?|real (?:name|identity)|legal name|offline identity|person behind)\b|^(?:who (?:are|is) (?:they|he|she)(?: really)?|what(?:'s| is) (?:their|his|her) real name|who (?:is|was) behind (?:that|this|their|his|her) (?:account|profile|handle))\b/i;

function requestsIdentityLinking(text: string): boolean {
  // Whitespace folding preserves word boundaries across multiline requests.
  // All regex windows are bounded; we never retain or emit the source text.
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!PSEUDONYMOUS_TARGET.test(normalized)) return false;
  if (DIRECT_REQUEST.test(normalized) &&
    (IDENTITY_OBJECT.test(normalized) || DEANON_OBJECT.test(normalized) || WHO_BEHIND.test(normalized))) {
    return true;
  }
  return CROSS_SITE_LINK.test(normalized) && /\b(?:this|that|these|their|same|the)\b/i.test(normalized);
}

export function assessThirdPartyIdentityPurpose(turns: readonly UserTurn[]): IdentityPurposeVerdict {
  // Keep an established target through neutral follow-ups. An ambiguous
  // "their" after that target is conservatively refused; a clearly named
  // unrelated subject is not a referential identity-link request.
  let priorPseudonymousTarget = false;
  for (const turn of turns) {
    if (turn.role !== "user") continue;
    if (requestsIdentityLinking(turn.content)) return { blocked: true, reason: "third_party_identity_link" };
    const normalized = turn.content.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (priorPseudonymousTarget && REFERENTIAL_LINK.test(normalized)) {
      return { blocked: true, reason: "third_party_identity_link" };
    }
    if (PSEUDONYMOUS_TARGET.test(normalized)) priorPseudonymousTarget = true;
  }
  return { blocked: false };
}

/**
 * Caller must first authenticate the tenant and verify the conversation
 * belongs to it. The callback receives that verified scope, not tool args.
 * Keep the loaded history for the caller's existing context-building path.
 */
export async function checkThirdPartyIdentityPurpose<T extends UserTurn>(
  tenantId: number,
  conversationId: number,
  loadHistory: (conversationId: number, tenantId: number) => Promise<T[]>,
  expectedUserMessageId?: number,
): Promise<{ verdict: IdentityPurposeVerdict; history: T[] | null }> {
  if (!thirdPartyIdentityGuardEnabled()) return { verdict: { blocked: false }, history: null };
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 || !Number.isSafeInteger(conversationId) || conversationId <= 0) {
    return { verdict: { blocked: true, reason: "history_unavailable" }, history: null };
  }
  try {
    const history = await loadHistory(conversationId, tenantId);
    if (!Array.isArray(history)) throw new Error("missing history");
    if (expectedUserMessageId !== undefined &&
      !history.some((message) => message.role === "user" && message.id === expectedUserMessageId)) {
      throw new Error("persisted user message missing from history");
    }
    return { verdict: assessThirdPartyIdentityPurpose(history), history };
  } catch {
    return { verdict: { blocked: true, reason: "history_unavailable" }, history: null };
  }
}