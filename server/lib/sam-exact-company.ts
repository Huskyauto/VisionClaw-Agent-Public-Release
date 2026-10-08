import {
  mapSamCompanyMatch,
  samGovSource,
  type CmmcCompanyMatch,
  type ProspectOutcome,
} from "./cmmc-prospecting";

const MAX_ALIASES = 10;
const DEFAULT_MAX_CANDIDATES = 10;

export interface SamExactCompanyInput {
  tenantId: number;
  companyName: string;
  state?: string;
  city?: string;
  streetAddress?: string;
  zip?: string;
  websiteDomain?: string;
  aliases?: string[];
  includeInactive?: boolean;
  maxCandidates?: number;
}

export interface SamExactSearchQuery {
  legalBusinessName: string;
  state?: string;
}

export interface SamExactSearchResponse {
  outcome: ProspectOutcome;
  entities?: unknown[];
  attempts?: number;
  coverageComplete?: boolean;
  diagnostics?: string[];
}

export interface SamExactCompanySource {
  search(input: {
    queries: SamExactSearchQuery[];
    includeInactive: boolean;
    maxAttempts: number;
  }): Promise<SamExactSearchResponse>;
}

export interface SamExactCandidate {
  legalName: string;
  matchScore: number;
  whyMatched: string[];
  whyNotFinal: string[];
}

export interface SamExactMatchedEntity {
  legalName: string;
  cage: string | null;
  uei: string | null;
  samStatus: "active" | "inactive" | "unknown";
  entityType: string | null;
  address: {
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  naics: string[];
  psc: string[];
  contacts: Array<NonNullable<CmmcCompanyMatch["pointsOfContact"][string]>>;
  source: "SAM.gov Entity API";
  sourceUrl: string;
}

export interface SamExactCompanyResult {
  query: Omit<SamExactCompanyInput, "tenantId">;
  resolutionStatus: "exact_match" | "near_match" | "ambiguous" | "no_attributable_match";
  coverageComplete: boolean;
  matchedEntity: SamExactMatchedEntity | null;
  candidates: SamExactCandidate[];
  evidence: {
    strongIdentifiersMatched: string[];
    notes: string[];
  };
  diagnostics: string[];
  sourceCalls: number;
  retryable: boolean;
}

type NormalizedInput = Required<Pick<SamExactCompanyInput, "tenantId" | "companyName" | "includeInactive" | "maxCandidates">>
  & Omit<SamExactCompanyInput, "tenantId" | "companyName" | "includeInactive" | "maxCandidates">;

type ScoredMatch = {
  match: CmmcCompanyMatch;
  score: number;
  whyMatched: string[];
  whyNotFinal: string[];
  strongIdentifiers: string[];
  exactName: boolean;
  attributable: boolean;
};

function cleanText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must be 1-${maxLength} characters`);
  }
  return normalized;
}

function normalizeInput(input: SamExactCompanyInput): NormalizedInput {
  if (!Number.isInteger(input.tenantId) || input.tenantId <= 0) throw new Error("tenantId is required");
  const companyName = cleanText(input.companyName, "companyName", 255);
  if (!companyName) throw new Error("companyName is required");
  const state = cleanText(input.state, "state", 40)?.toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) throw new Error("state must be a two-letter code");
  const aliases = input.aliases === undefined
    ? []
    : Array.isArray(input.aliases)
      ? input.aliases.map((alias) => cleanText(alias, "each alias", 255) as string)
      : (() => { throw new Error("aliases must be an array of strings"); })();
  if (aliases.length > MAX_ALIASES) throw new Error(`aliases must contain at most ${MAX_ALIASES} names`);
  const maxCandidates = input.maxCandidates === undefined ? DEFAULT_MAX_CANDIDATES : Number(input.maxCandidates);
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 25) {
    throw new Error("maxCandidates must be an integer from 1-25");
  }
  return {
    tenantId: input.tenantId,
    companyName,
    state,
    city: cleanText(input.city, "city", 120),
    streetAddress: cleanText(input.streetAddress, "streetAddress", 255),
    zip: cleanText(input.zip, "zip", 20),
    websiteDomain: cleanText(input.websiteDomain, "websiteDomain", 255),
    aliases,
    includeInactive: input.includeInactive !== false,
    maxCandidates,
  };
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function rootName(value: string): string {
  return normalizeName(value)
    .replace(/\b(incorporated|inc|limited|ltd|llc|l l c|company|co|corporation|corp)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddress(value: string): string {
  return normalizeName(value)
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(highway)\b/g, "hwy")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(lane)\b/g, "ln");
}

function normalizedDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value.toLowerCase().replace(/^www\./, "").split("/")[0];
  }
}

function buildQueries(input: NormalizedInput): SamExactSearchQuery[] {
  const names = [input.companyName, ...(input.aliases || [])];
  const root = rootName(input.companyName);
  if (root && root !== normalizeName(input.companyName)) names.push(root);
  const queries: SamExactSearchQuery[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    for (const state of [input.state, undefined]) {
      const query = { legalBusinessName: name, ...(state ? { state } : {}) };
      const key = JSON.stringify(query);
      if (!seen.has(key)) {
        seen.add(key);
        queries.push(query);
      }
    }
  }
  return queries.slice(0, 10);
}

function scoreMatch(match: CmmcCompanyMatch, input: NormalizedInput): ScoredMatch {
  let score = 0;
  const whyMatched: string[] = [];
  const whyNotFinal: string[] = [];
  const strongIdentifiers = new Set<string>();
  const requestedName = normalizeName(input.companyName);
  const candidateName = normalizeName(match.legalName);
  const exactName = candidateName === requestedName;
  const exactAlias = (input.aliases || []).some((alias) => normalizeName(alias) === candidateName);
  if (exactName || exactAlias) {
    score += 0.5;
    whyMatched.push(exactName ? "exact_legal_name" : "exact_alias");
    strongIdentifiers.add("name");
  } else if (rootName(match.legalName) === rootName(input.companyName)) {
    score += 0.2;
    whyMatched.push("name_root");
  } else {
    whyNotFinal.push("legal_name_differs");
  }

  const stateMatches = !input.state || match.state === input.state;
  const cityMatches = !input.city || normalizeName(match.city || "") === normalizeName(input.city);
  if (input.city && input.state && stateMatches && cityMatches) {
    score += 0.15;
    whyMatched.push("city_state_match");
    strongIdentifiers.add("address");
  } else {
    if (input.state && stateMatches) {
      score += 0.05;
      whyMatched.push("state_match");
    }
    if (input.state && !stateMatches) {
      score -= 0.35;
      whyNotFinal.push("state_conflict");
    }
    if (input.city && !cityMatches) {
      score -= 0.15;
      whyNotFinal.push("city_conflict");
    }
  }

  if (input.streetAddress) {
    const requestedStreet = normalizeAddress(input.streetAddress);
    const candidateStreet = normalizeAddress(match.addressLine1 || "");
    if (requestedStreet && candidateStreet && (requestedStreet === candidateStreet || candidateStreet.includes(requestedStreet) || requestedStreet.includes(candidateStreet))) {
      score += 0.2;
      whyMatched.push("street_address_match");
      strongIdentifiers.add("address");
    } else {
      score -= 0.2;
      whyNotFinal.push("street_address_conflict");
    }
  }

  if (input.zip) {
    const requestedZip = input.zip.replace(/\D/g, "").slice(0, 5);
    const candidateZip = String(match.zipCode || "").replace(/\D/g, "").slice(0, 5);
    if (requestedZip && candidateZip === requestedZip) {
      score += 0.1;
      whyMatched.push("zip_match");
      strongIdentifiers.add("address");
    } else if (candidateZip) {
      score -= 0.1;
      whyNotFinal.push("zip_conflict");
    }
  }

  if (input.websiteDomain) {
    const requestedDomain = normalizedDomain(input.websiteDomain);
    const candidateDomain = normalizedDomain(match.entityInformation.entityURL);
    if (requestedDomain && candidateDomain === requestedDomain) {
      score += 0.2;
      whyMatched.push("website_domain_match");
      strongIdentifiers.add("website");
    } else if (candidateDomain) {
      score -= 0.15;
      whyNotFinal.push("website_domain_conflict");
    }
  }

  const roundedScore = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  const strong = [...strongIdentifiers];
  return {
    match,
    score: roundedScore,
    whyMatched,
    whyNotFinal,
    strongIdentifiers: strong,
    exactName: exactName || exactAlias,
    attributable: strong.includes("name") && strong.length >= 2 && roundedScore >= 0.65,
  };
}

function matchedEntity(match: CmmcCompanyMatch): SamExactMatchedEntity {
  return {
    legalName: match.legalName,
    cage: match.cage,
    uei: match.uei,
    samStatus: match.registrationStatus,
    entityType: match.generalInformation.entityTypeDesc || null,
    address: {
      street: match.addressLine1,
      city: match.city,
      state: match.state,
      zip: match.zipCode,
    },
    naics: match.naics,
    psc: match.pscCodes.map((item) => item.code),
    contacts: Object.values(match.pointsOfContact).filter(
      (contact): contact is NonNullable<typeof contact> => contact !== null,
    ),
    source: "SAM.gov Entity API",
    sourceUrl: match.sourceUrl,
  };
}

export async function lookupSamExactCompany(
  rawInput: SamExactCompanyInput,
  source: SamExactCompanySource = samGovSource(),
): Promise<SamExactCompanyResult> {
  const input = normalizeInput(rawInput);
  const response = await source.search({
    queries: buildQueries(input),
    includeInactive: input.includeInactive,
    maxAttempts: 10,
  });
  const query = {
    companyName: input.companyName,
    ...(input.state ? { state: input.state } : {}),
    ...(input.city ? { city: input.city } : {}),
    ...(input.streetAddress ? { streetAddress: input.streetAddress } : {}),
    ...(input.zip ? { zip: input.zip } : {}),
    ...(input.websiteDomain ? { websiteDomain: input.websiteDomain } : {}),
    ...(input.aliases?.length ? { aliases: input.aliases } : {}),
    includeInactive: input.includeInactive,
    maxCandidates: input.maxCandidates,
  };
  const diagnostics = [...new Set(response.diagnostics || [])];
  if (response.outcome !== "ok") {
    return {
      query,
      resolutionStatus: "no_attributable_match",
      coverageComplete: false,
      matchedEntity: null,
      candidates: [],
      evidence: { strongIdentifiersMatched: [], notes: ["SAM.gov lookup did not complete"] },
      diagnostics: diagnostics.length ? diagnostics : [response.outcome],
      sourceCalls: response.attempts || 0,
      retryable: ["rate_limited", "overloaded", "timeout", "source_error"].includes(response.outcome),
    };
  }

  const deduped = new Map<string, CmmcCompanyMatch>();
  for (const entity of response.entities || []) {
    const mapped = mapSamCompanyMatch(entity, input.companyName);
    if (!mapped) continue;
    const key = mapped.uei || mapped.cage || `${normalizeName(mapped.legalName)}:${mapped.state || ""}:${mapped.zipCode || ""}`;
    if (!deduped.has(key)) deduped.set(key, mapped);
  }
  const scored = [...deduped.values()]
    .map((match) => scoreMatch(match, input))
    .sort((a, b) => b.score - a.score || a.match.legalName.localeCompare(b.match.legalName));
  const top = scored[0];
  const second = scored[1];
  const closeCompetingMatch = Boolean(top && second && second.score >= top.score - 0.08 && second.score >= 0.5);
  const coverageComplete = response.coverageComplete === true;
  const eligibleTop = coverageComplete && Boolean(top?.attributable);
  const resolutionStatus: SamExactCompanyResult["resolutionStatus"] = !coverageComplete
    ? "no_attributable_match"
    : closeCompetingMatch
    ? "ambiguous"
    : eligibleTop
      ? top!.exactName ? "exact_match" : "near_match"
      : top && top.score >= 0.5
        ? "near_match"
        : scored.length > 1 && scored.some((candidate) => candidate.whyMatched.includes("name_root"))
          ? "ambiguous"
          : "no_attributable_match";
  const attributable = eligibleTop && !closeCompetingMatch ? top : undefined;
  if (!coverageComplete && !diagnostics.some((item) => item.includes("coverage"))) {
    diagnostics.push("sam_search_coverage_incomplete");
  }
  return {
    query,
    resolutionStatus,
    coverageComplete,
    matchedEntity: attributable ? matchedEntity(attributable.match) : null,
    candidates: scored.slice(0, input.maxCandidates).map((candidate) => ({
      legalName: candidate.match.legalName,
      matchScore: candidate.score,
      whyMatched: candidate.whyMatched,
      whyNotFinal: candidate.attributable && !closeCompetingMatch
        ? candidate.whyNotFinal
        : [...candidate.whyNotFinal, "attribution_threshold_not_cleared"],
    })),
    evidence: {
      strongIdentifiersMatched: attributable?.strongIdentifiers || [],
      notes: attributable
        ? [`Matched ${attributable.strongIdentifiers.join(", ")} against one SAM.gov entity`]
        : ["No candidate cleared the attributable two-identifier threshold"],
    },
    diagnostics,
    sourceCalls: response.attempts || 0,
    retryable: false,
  };
}