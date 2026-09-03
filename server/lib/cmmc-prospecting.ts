/**
 * Bounded, read-only federal-contractor discovery.
 *
 * SAM.gov's entity API is the primary live source. Its API key is
 * configuration-gated; we deliberately do not scrape entity-search pages.
 * A batch can provide at most ten CAGE-bearing candidates per state and each
 * CAGE is rechecked against the same host by UEI.
 */
import crypto from "node:crypto";
import type { SamExactCompanySource } from "./sam-exact-company";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function firstResultRow<T extends UnknownRecord>(result: unknown): T | undefined {
  if (Array.isArray(result)) return isRecord(result[0]) ? result[0] as T : undefined;
  if (!isRecord(result) || !Array.isArray(result.rows)) return undefined;
  return isRecord(result.rows[0]) ? result.rows[0] as T : undefined;
}

export const MAX_BATCH_SOURCE_CALLS = 5;
export const MAX_CANDIDATE_VERIFICATIONS = 20;
export const MAX_OUTPUT_CANDIDATES = 50;
export const MAX_DIRECT_COMPANY_LOOKUPS = 10;
export const MAX_DIRECT_SOURCE_ATTEMPTS = 25;

export type ProspectOutcome = "ok" | "partial" | "empty" | "forbidden" | "rate_limited" | "overloaded" | "timeout" | "source_error" | "hourly_cap" | "tool_call_cap" | "dollar_cap" | "configuration_error";
export interface CmmcCandidateInput {
  company?: string;
  legalName?: string;
  state?: string;
  city?: string;
  location?: string;
  cage?: string;
  uei?: string;
  registrationStatus?: "active" | "inactive" | "unknown";
  naics?: string[];
  phone?: string;
  website?: string;
  qualificationType?: "sam_registered" | "awardee" | "gsa_schedule_holder" | "defense_supplier_signal" | "federal_vendor_signal";
  sourceUrl?: string;
  sourceUrls?: string[];
  contactPath?: string;
  noticeId?: string;
  /** Internal provenance marker: this row came directly from SAM's entity API. */
  authoritativeSamEntity?: boolean;
}
export interface CmmcProspectSource {
  discover(input: NormalizedCmmcProspectInput): Promise<{ outcome: ProspectOutcome; candidates?: CmmcCandidateInput[]; sourceCalls?: number; omittedCount?: number; diagnostic?: string; coverageIncomplete?: boolean; retryableFailure?: ProspectOutcome; completedStates?: string[]; pendingStates?: string[] }>;
  verify(candidate: CmmcCandidateInput, input: NormalizedCmmcProspectInput): Promise<{ outcome: ProspectOutcome; evidence?: { cage?: string; sourceUrl?: string }; diagnostic?: string }>;
}
export interface CmmcProspectInput {
  tenantId: number;
  query: string;
  states: string[];
  dateWindow: { from: string; to: string };
}
export interface NormalizedCmmcProspectInput extends CmmcProspectInput {
  query: string;
  states: string[];
}
export interface AcceptedCmmcProspect {
  company: string;
  company_name: string;
  legal_name: string | null;
  state: string;
  city: string | null;
  location: string;
  cage: string;
  uei: string | null;
  registration_status: "active" | "inactive" | "unknown";
  qualification_type: "sam_registered" | "awardee" | "gsa_schedule_holder" | "defense_supplier_signal" | "federal_vendor_signal";
  qualification_basis: string;
  sourceUrls: string[];
  source_records: Array<{ source: "sam" | "usaspending" | "gsa" | "other"; source_id: string | null; url: string | null; evidence: string }>;
  confidence: number;
  confidence_level: "high" | "medium" | "low";
  verification_status: "verified" | "needs_review" | "rejected";
  contactPath: string;
  website: string | null;
  phone: string | null;
  naics: string[];
  notes: string | null;
}
export interface CmmcProspectArtifact {
  fileName: string;
  mimeType: string;
  content: string;
}
export interface CmmcArtifactDelivery {
  fileName: string;
  success: boolean;
  artifactId?: number;
  fileId?: string;
  viewUrl?: string;
  downloadUrl?: string;
  projectFilesRegistered?: boolean;
  projectFilesWarning?: string;
  error?: string;
}
export interface CmmcProspectResult {
  outcome: ProspectOutcome;
  terminal: boolean;
  retryable: boolean;
  cached: boolean;
  cacheKey: string;
  candidates: AcceptedCmmcProspect[];
  excludedWithoutCage: number;
  sourceCalls: number;
  verificationCalls: number;
  retrievedCount: number;
  cappedCount: number;
  verificationFailures: ProspectOutcome[];
  coverageComplete: boolean;
  diagnostics: string[];
  completedStates: string[];
  pendingStates: string[];
}

export type CmmcCompanyLookupStatus = "matched" | "needs_review" | "not_found" | "source_error" | "configuration_error";
export type CmmcCompanyLookupOutcome = "ok" | "partial" | "empty" | ProspectOutcome;

export interface CmmcCompanyLookupInput {
  tenantId: number;
  companyNames: string[];
  includeInactive?: boolean;
}

export interface CmmcCompanyAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateOrProvinceCode: string | null;
  zipCode: string | null;
  zipCodePlus4: string | null;
  countryCode: string | null;
}

export interface CmmcCompanyPscCode {
  code: string;
  description: string | null;
}

export interface CmmcCompanyPointOfContact {
  firstName: string | null;
  middleInitial: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  phoneExtension: string | null;
  nonUsPhone: string | null;
  fax: string | null;
  address: CmmcCompanyAddress;
}

export interface CmmcCompanyMatch {
  legalName: string;
  samRegistered: string | null;
  dbaName: string | null;
  uei: string | null;
  ueiStatus: string | null;
  ueiCreationDate: string | null;
  cage: string | null;
  registrationStatus: "active" | "inactive" | "unknown";
  registrationDate: string | null;
  lastUpdateDate: string | null;
  registrationExpirationDate: string | null;
  activationDate: string | null;
  purposeOfRegistration: string | null;
  purposeOfRegistrationCode: string | null;
  exclusionStatusFlag: string | null;
  publicDisplayFlag: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  physicalAddress: CmmcCompanyAddress;
  mailingAddress: CmmcCompanyAddress;
  entityInformation: {
    entityURL: string | null;
    entityStartDate: string | null;
    fiscalYearEndCloseDate: string | null;
    submissionDate: string | null;
  };
  congressionalDistrict: string | null;
  generalInformation: Record<string, string | null>;
  businessTypes: string[];
  sbaBusinessTypes: string[];
  debtSubjectToOffset: string | null;
  primaryNaics: string | null;
  naics: string[];
  pscCodes: CmmcCompanyPscCode[];
  disasterRelief: {
    disasterRegistryFlag: string | null;
    bondingFlag: string | null;
    geographicalAreaServed: string[];
  };
  ediInformationFlag: string | null;
  pointsOfContact: Record<string, CmmcCompanyPointOfContact | null>;
  sourceUrl: string;
  matchType: "exact" | "partial";
}

export interface CmmcCompanyLookupRow {
  requestedName: string;
  status: CmmcCompanyLookupStatus;
  matches: CmmcCompanyMatch[];
  totalRecords: number;
  returnedRecords: number;
  diagnostic?: string;
}

export interface CmmcCompanyLookupResult {
  outcome: CmmcCompanyLookupOutcome;
  terminal: boolean;
  retryable: boolean;
  results: CmmcCompanyLookupRow[];
  sourceCalls: number;
  pendingNames: string[];
  diagnostics: string[];
}

interface SamCompanyLookupResponse {
  outcome: ProspectOutcome;
  entities?: unknown[];
  totalRecords?: number;
  attempts?: number;
  diagnostic?: string;
}

export interface CmmcCompanyLookupSource {
  lookupCompanyName(name: string, includeInactive: boolean, maxAttempts?: number): Promise<SamCompanyLookupResponse>;
}

export interface CmmcProspectCheckpointContext {
  tenantId: number;
  projectId: number;
}

function normalizeCompanyLookupName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeCmmcCompanyLookupInput(input: CmmcCompanyLookupInput): { tenantId: number; companyNames: string[]; includeInactive: boolean } {
  if (!Number.isInteger(input.tenantId) || input.tenantId <= 0) throw new Error("tenantId is required");
  if (!Array.isArray(input.companyNames) || input.companyNames.length === 0 || input.companyNames.length > MAX_DIRECT_COMPANY_LOOKUPS) {
    throw new Error(`companyNames must contain 1-${MAX_DIRECT_COMPANY_LOOKUPS} names`);
  }
  const companyNames: string[] = [];
  const seenCompanyNames = new Set<string>();
  for (const name of input.companyNames) {
    if (typeof name !== "string") throw new Error("each company name must be a string");
    const normalized = name.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length > 255) throw new Error("each company name must be 1-255 characters");
    const canonical = normalizeCompanyLookupName(normalized);
    if (!seenCompanyNames.has(canonical)) {
      seenCompanyNames.add(canonical);
      companyNames.push(normalized);
    }
  }
  if (companyNames.length === 0) throw new Error("companyNames must contain at least one non-empty name");
  return {
    tenantId: input.tenantId,
    companyNames,
    includeInactive: input.includeInactive === true,
  };
}

function registrationStatus(value: unknown): CmmcCompanyMatch["registrationStatus"] {
  const status = String(value || "").trim().toLowerCase();
  if (status === "active") return "active";
  if (status === "inactive" || status === "expired") return "inactive";
  return "unknown";
}

function nullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function mapCompanyAddress(value: unknown): CmmcCompanyAddress {
  const address = recordOrEmpty(value);
  return {
    addressLine1: nullableString(address.addressLine1),
    addressLine2: nullableString(address.addressLine2),
    city: nullableString(address.city),
    stateOrProvinceCode: nullableString(address.stateOrProvinceCode)?.toUpperCase() || null,
    zipCode: nullableString(address.zipCode),
    zipCodePlus4: nullableString(address.zipCodePlus4),
    countryCode: nullableString(address.countryCode)?.toUpperCase() || null,
  };
}

function mapTextList(value: unknown, fields: string[]): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item: unknown) => {
    if (typeof item === "string") return item.trim();
    if (!isRecord(item)) return "";
    for (const field of fields) {
      const text = nullableString(item[field]);
      if (text) return text;
    }
    return "";
  }).filter(Boolean))];
}

function mapPscCodes(value: unknown): CmmcCompanyPscCode[] {
  if (!Array.isArray(value)) return [];
  return value.map((value: unknown) => {
    const item = recordOrEmpty(value);
    return {
      code: nullableString(item.pscCode || item.code) || "",
      description: nullableString(item.pscDescription || item.description),
    };
  }).filter((item) => Boolean(item.code));
}

function mapCompanyPoc(value: unknown): CmmcCompanyPointOfContact | null {
  if (!isRecord(value)) return null;
  const poc = value;
  const hasData = [
    "firstName", "middleInitial", "lastName", "title", "email", "usPhone",
    "usPhoneExtension", "nonUsPhone", "nonUSPhone", "fax", "addressLine1",
    "city", "stateOrProvinceCode",
  ]
    .some((field) => nullableString(poc[field]));
  if (!hasData) return null;
  return {
    firstName: nullableString(poc.firstName),
    middleInitial: nullableString(poc.middleInitial),
    lastName: nullableString(poc.lastName),
    title: nullableString(poc.title),
    email: nullableString(poc.email),
    phone: nullableString(poc.usPhone || poc.phone),
    phoneExtension: nullableString(poc.usPhoneExtension),
    nonUsPhone: nullableString(poc.nonUsPhone || poc.nonUSPhone),
    fax: nullableString(poc.fax),
    address: mapCompanyAddress(poc),
  };
}

export function mapSamCompanyMatch(value: unknown, requestedName: string): CmmcCompanyMatch | null {
  const entity = recordOrEmpty(value);
  const registration = recordOrEmpty(entity.entityRegistration);
  const coreData = recordOrEmpty(entity.coreData);
  const address = recordOrEmpty(coreData.physicalAddress);
  const mailingAddress = recordOrEmpty(coreData.mailingAddress);
  const entityInformation = recordOrEmpty(coreData.entityInformation);
  const generalInformation = recordOrEmpty(coreData.generalInformation);
  const assertions = recordOrEmpty(entity.assertions);
  const goodsAndServices = recordOrEmpty(assertions.goodsAndServices);
  const disasterReliefData = recordOrEmpty(assertions.disasterReliefData);
  const pointsOfContact = recordOrEmpty(entity.pointsOfContact);
  const legalName = String(registration.legalBusinessName || "").trim();
  if (!legalName) return null;
  const uei = nullableString(registration?.ueiSAM);
  const cage = nullableString(registration?.cageCode)?.toUpperCase() || null;
  const businessTypeData = recordOrEmpty(coreData.businessTypes);
  const businessTypes = mapTextList(businessTypeData.businessTypeList, ["businessTypeDesc", "businessType"]);
  const sbaBusinessTypes = mapTextList(businessTypeData.sbaBusinessTypeList, ["businessTypeDesc", "businessType"]);
  const naics = mapTextList(goodsAndServices.naicsList, ["naicsCode", "code"]);
  const pscCodes = mapPscCodes(goodsAndServices.pscList);
  const pocFields: Record<string, string> = {
    governmentBusiness: "governmentBusinessPOC",
    electronicBusiness: "electronicBusinessPOC",
    governmentBusinessAlternate: "governmentBusinessAlternatePOC",
    electronicBusinessAlternate: "electronicBusinessAlternatePOC",
    pastPerformance: "pastPerformancePOC",
    pastPerformanceAlternate: "pastPerformanceAlternatePOC",
  };
  const mappedPocs = Object.fromEntries(Object.entries(pocFields)
    .map(([name, source]) => [name, mapCompanyPoc(pointsOfContact[source])]));
  return {
    legalName,
    samRegistered: nullableString(registration.samRegistered),
    dbaName: nullableString(registration.dbaName || registration.doingBusinessAsName),
    uei,
    ueiStatus: nullableString(registration.ueiStatus),
    ueiCreationDate: nullableString(registration.ueiCreationDate),
    cage,
    registrationStatus: registrationStatus(registration.registrationStatus),
    registrationDate: nullableString(registration.registrationDate),
    lastUpdateDate: nullableString(registration.lastUpdateDate),
    registrationExpirationDate: nullableString(registration.registrationExpirationDate),
    activationDate: nullableString(registration.activationDate),
    purposeOfRegistration: nullableString(registration.purposeOfRegistrationDesc),
    purposeOfRegistrationCode: nullableString(registration.purposeOfRegistrationCode),
    exclusionStatusFlag: nullableString(registration.exclusionStatusFlag),
    publicDisplayFlag: nullableString(registration.publicDisplayFlag),
    addressLine1: nullableString(address.addressLine1),
    city: nullableString(address.city),
    state: nullableString(address.stateOrProvinceCode)?.toUpperCase() || null,
    zipCode: nullableString(address.zipCode),
    physicalAddress: mapCompanyAddress(address),
    mailingAddress: mapCompanyAddress(mailingAddress),
    entityInformation: {
      entityURL: nullableString(entityInformation.entityURL),
      entityStartDate: nullableString(entityInformation.entityStartDate),
      fiscalYearEndCloseDate: nullableString(entityInformation.fiscalYearEndCloseDate),
      submissionDate: nullableString(entityInformation.submissionDate),
    },
    congressionalDistrict: nullableString(coreData.congressionalDistrict),
    generalInformation: Object.fromEntries([
      "entityStructureCode", "entityStructureDesc", "entityTypeCode", "entityTypeDesc",
      "profitStructureCode", "profitStructureDesc", "organizationStructureCode",
      "organizationStructureDesc", "stateOfIncorporationCode", "stateOfIncorporationDesc",
      "countryOfIncorporationCode", "countryOfIncorporationDesc",
    ].map((field) => [field, nullableString(generalInformation[field])])),
    businessTypes,
    sbaBusinessTypes,
    debtSubjectToOffset: nullableString(recordOrEmpty(coreData.financialInformation).debtSubjectToOffset),
    primaryNaics: nullableString(goodsAndServices.primaryNaics),
    naics,
    pscCodes,
    disasterRelief: {
      disasterRegistryFlag: nullableString(disasterReliefData.disasterRegistryFlag),
      bondingFlag: nullableString(disasterReliefData.bondingFlag),
      geographicalAreaServed: mapTextList(disasterReliefData.geographicalAreaServed, ["areaServed", "area", "description", "code"]),
    },
    ediInformationFlag: nullableString(recordOrEmpty(assertions.ediInformation).ediInformationFlag),
    pointsOfContact: mappedPocs,
    sourceUrl: uei
      ? `https://sam.gov/entity/${encodeURIComponent(uei)}/coreData`
      : "https://www.sam.gov/entity-information",
    matchType: normalizeCompanyLookupName(legalName) === normalizeCompanyLookupName(requestedName) ? "exact" : "partial",
  };
}

export async function lookupSamCompanies(
  input: CmmcCompanyLookupInput,
  source: CmmcCompanyLookupSource = samGovSource(),
): Promise<CmmcCompanyLookupResult> {
  const normalized = normalizeCmmcCompanyLookupInput(input);
  const results: CmmcCompanyLookupRow[] = [];
  const pendingNames: string[] = [];
  const diagnostics: string[] = [];
  let sourceCalls = 0;
  let successfulRows = 0;
  let failedRows = 0;
  let retryableFailure = false;
  const failureOutcomes: ProspectOutcome[] = [];

  for (let nameIndex = 0; nameIndex < normalized.companyNames.length; nameIndex++) {
    const requestedName = normalized.companyNames[nameIndex];
    const remainingAttempts = MAX_DIRECT_SOURCE_ATTEMPTS - sourceCalls;
    if (remainingAttempts <= 0) {
      const unattemptedNames = normalized.companyNames.slice(nameIndex);
      pendingNames.push(...unattemptedNames);
      retryableFailure = true;
      failureOutcomes.push("tool_call_cap");
      for (const unattemptedName of unattemptedNames) {
        failedRows++;
        results.push({
          requestedName: unattemptedName,
          status: "source_error",
          matches: [],
          totalRecords: 0,
          returnedRecords: 0,
          diagnostic: "source_attempt_budget_exhausted",
        });
      }
      diagnostics.push("sam_company_source_attempt_budget_exhausted");
      break;
    }
    const response = await source.lookupCompanyName(
      requestedName,
      normalized.includeInactive,
      Math.min(3, remainingAttempts),
    );
    sourceCalls += response.attempts ?? 1;
    if (response.outcome !== "ok") {
      failedRows++;
      failureOutcomes.push(response.outcome);
      if (TRANSIENT_OUTCOMES.has(response.outcome)) {
        pendingNames.push(requestedName);
        retryableFailure = true;
      }
      const diagnostic = response.diagnostic || response.outcome;
      diagnostics.push(`sam_company_${requestedName}_${diagnostic}`);
      results.push({
        requestedName,
        status: response.outcome === "configuration_error" ? "configuration_error" : "source_error",
        matches: [],
        totalRecords: 0,
        returnedRecords: 0,
        diagnostic,
      });
      continue;
    }

    successfulRows++;
    const entities = Array.isArray(response.entities) ? response.entities : [];
    const matches = entities
      .map((entity) => mapSamCompanyMatch(entity, requestedName))
      .filter((match): match is CmmcCompanyMatch => Boolean(match));
    const totalRecords = Number.isInteger(response.totalRecords) && (response.totalRecords as number) >= 0
      ? response.totalRecords as number
      : matches.length;
    const truncated = totalRecords > entities.length;
    const exactMatches = matches.filter((match) => match.matchType === "exact");
    const status: CmmcCompanyLookupStatus = exactMatches.length === 1 && matches.length === 1 && !truncated
      ? "matched"
      : matches.length === 0
        ? "not_found"
        : exactMatches.length > 1 || matches.length > 1 || truncated
          ? "needs_review"
          : "needs_review";
    if (truncated) diagnostics.push(`sam_company_${requestedName}_bounded_results_${totalRecords - entities.length}`);
    results.push({
      requestedName,
      status,
      matches,
      totalRecords,
      returnedRecords: entities.length,
      ...(truncated ? { diagnostic: `bounded_results_omitted_${totalRecords - entities.length}` } : {}),
    });
  }

  const failurePriority: ProspectOutcome[] = [
    "configuration_error",
    "forbidden",
    "hourly_cap",
    "rate_limited",
    "overloaded",
    "timeout",
    "source_error",
    "dollar_cap",
    "tool_call_cap",
  ];
  const strongestFailure = failurePriority.find((candidate) => failureOutcomes.includes(candidate)) || "source_error";
  const outcome: CmmcCompanyLookupOutcome = failedRows === normalized.companyNames.length
    ? strongestFailure
    : failedRows > 0
      ? "partial"
      : successfulRows > 0 && results.some((row) => row.status === "matched" || row.status === "needs_review")
        ? "ok"
        : "empty";
  return {
    outcome,
    terminal: !retryableFailure,
    retryable: retryableFailure,
    results,
    sourceCalls,
    pendingNames,
    diagnostics,
  };
}

const CACHE_TTL_MS = 20 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; result: CmmcProspectResult }>();
export function createRequestPacer(
  minimumIntervalMs: number,
  dependencies: { now?: () => number; sleep?: (milliseconds: number) => Promise<void> } = {},
): () => Promise<void> {
  if (!Number.isFinite(minimumIntervalMs) || minimumIntervalMs < 0) throw new Error("Request pace interval is invalid");
  const now = dependencies.now || Date.now;
  const sleep = dependencies.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let nextSlotAt = 0;
  let tail = Promise.resolve();
  return async () => {
    let release!: () => void;
    const previous = tail;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const waitMs = Math.max(0, nextSlotAt - now());
      if (waitMs) await sleep(waitMs);
      nextSlotAt = now() + minimumIntervalMs;
    } finally {
      release();
    }
  };
}

const reserveLiveSamRequest = createRequestPacer(350);
const CAGE = /^[A-Z0-9]{5}$/;
const TERMINAL_NO_DATA = new Set<ProspectOutcome>(["empty", "forbidden", "hourly_cap", "tool_call_cap", "dollar_cap", "configuration_error"]);
const TRANSIENT_OUTCOMES = new Set<ProspectOutcome>(["rate_limited", "overloaded", "timeout", "source_error"]);

export function normalizeCmmcProspectInput(input: CmmcProspectInput): NormalizedCmmcProspectInput {
  if (!Number.isInteger(input.tenantId) || input.tenantId <= 0) throw new Error("tenantId is required");
  const query = input.query.replace(/\s+/g, " ").trim().toLowerCase();
  const states = [...new Set(input.states.map((state) => state.trim().toUpperCase()).filter((state) => /^[A-Z]{2}$/.test(state)))].sort();
  if (!query || states.length === 0 || states.length > MAX_BATCH_SOURCE_CALLS) throw new Error("query and 1-5 two-letter states are required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateWindow.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateWindow.to)) throw new Error("dateWindow must use YYYY-MM-DD");
  return { tenantId: input.tenantId, query, states, dateWindow: input.dateWindow };
}

export function cmmcProspectCacheKey(input: CmmcProspectInput): string {
  const normalized = normalizeCmmcProspectInput(input);
  return `cmmc-prospects:t${normalized.tenantId}:${normalized.query}:${normalized.states.join(",")}:${normalized.dateWindow.from}:${normalized.dateWindow.to}:active-sam-entities-v5`;
}

export function cmmcProspectCheckpointFilename(input: CmmcProspectInput, projectId: number): string {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Error("CMMC checkpoint requires a valid project");
  const digest = crypto.createHash("sha256").update(cmmcProspectCacheKey(input)).digest("hex").slice(0, 32);
  return `cmmc-report-prospects-p${projectId}-${digest}.json`;
}

function cmmcProspectLeaseFilename(input: CmmcProspectInput, projectId: number): string {
  return cmmcProspectCheckpointFilename(input, projectId).replace("cmmc-report-prospects-", "cmmc-report-lease-");
}

export async function acquireCmmcProspectLease(
  input: CmmcProspectInput,
  context: CmmcProspectCheckpointContext,
  leaseMs = 10 * 60 * 1000,
): Promise<string | null> {
  if (context.tenantId !== input.tenantId) throw new Error("CMMC lease tenant mismatch");
  const filename = cmmcProspectLeaseFilename(input, context.projectId);
  const owner = crypto.randomUUID();
  const lease = Buffer.from(JSON.stringify({ owner, expiresAt: Date.now() + leaseMs }), "utf8").toString("base64");
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const claimed = await db.execute(sql`
    INSERT INTO file_storage
      (filename, original_name, mime_type, size, data, tenant_id, is_public)
    SELECT
      ${filename}, ${filename}, ${"application/json"}, ${Buffer.byteLength(lease, "utf8")},
      ${lease}, ${context.tenantId}, false
    WHERE EXISTS (
      SELECT 1 FROM projects
      WHERE id = ${context.projectId} AND tenant_id = ${context.tenantId}
    )
    ON CONFLICT (tenant_id, filename) WHERE filename LIKE 'cmmc-report-%'
    DO UPDATE SET
      size = EXCLUDED.size,
      data = EXCLUDED.data,
      is_public = false
    WHERE
      ((convert_from(decode(file_storage.data, 'base64'), 'UTF8')::jsonb)->>'expiresAt')::bigint < ${Date.now()}
    RETURNING data
  `);
  const row = firstResultRow<{ data: unknown }>(claimed);
  if (!row) return null;
  const stored: unknown = JSON.parse(Buffer.from(String(row.data), "base64").toString("utf8"));
  return isRecord(stored) && stored.owner === owner ? owner : null;
}

export async function releaseCmmcProspectLease(
  input: CmmcProspectInput,
  context: CmmcProspectCheckpointContext,
  owner: string,
): Promise<void> {
  if (context.tenantId !== input.tenantId) throw new Error("CMMC lease tenant mismatch");
  const filename = cmmcProspectLeaseFilename(input, context.projectId);
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    DELETE FROM file_storage fs
    USING projects p
    WHERE fs.filename = ${filename}
      AND fs.tenant_id = ${context.tenantId}
      AND p.id = ${context.projectId}
      AND p.tenant_id = ${context.tenantId}
      AND ((convert_from(decode(fs.data, 'base64'), 'UTF8')::jsonb)->>'owner') = ${owner}
  `);
}

function parseCheckpointResult(value: unknown, expectedCacheKey: string): CmmcProspectResult | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as { version?: unknown; sha256?: unknown; result?: unknown };
  let candidateValue: unknown = value;
  if (envelope.version === 1) {
    if (typeof envelope.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(envelope.sha256) || !envelope.result) return null;
    const serializedResult = JSON.stringify(envelope.result);
    if (crypto.createHash("sha256").update(serializedResult).digest("hex") !== envelope.sha256) return null;
    candidateValue = envelope.result;
  }
  const candidate = candidateValue as CmmcProspectResult;
  if (
    candidate.cacheKey !== expectedCacheKey ||
    !Array.isArray(candidate.candidates) ||
    !Array.isArray(candidate.verificationFailures) ||
    !Array.isArray(candidate.diagnostics) ||
    typeof candidate.outcome !== "string" ||
    typeof candidate.coverageComplete !== "boolean"
  ) return null;
  return candidate;
}

export async function persistCmmcProspectCheckpoint(
  input: CmmcProspectInput,
  context: CmmcProspectCheckpointContext,
  prospectResult: CmmcProspectResult,
): Promise<{ filename: string; size: number; sha256: string }> {
  if (context.tenantId !== input.tenantId) throw new Error("CMMC checkpoint tenant mismatch");
  const filename = cmmcProspectCheckpointFilename(input, context.projectId);
  const serializedResult = JSON.stringify(prospectResult);
  const bytes = Buffer.from(JSON.stringify({
    version: 1,
    sha256: crypto.createHash("sha256").update(serializedResult).digest("hex"),
    result: prospectResult,
  }), "utf8");
  if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) throw new Error("CMMC checkpoint size is invalid");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const stored = await db.execute(sql`
    INSERT INTO file_storage
      (filename, original_name, mime_type, size, data, tenant_id, is_public)
    SELECT
      ${filename}, ${filename}, ${"application/json"}, ${bytes.length},
      ${bytes.toString("base64")}, ${context.tenantId}, false
    WHERE EXISTS (
      SELECT 1 FROM projects
      WHERE id = ${context.projectId} AND tenant_id = ${context.tenantId}
    )
    ON CONFLICT (tenant_id, filename) WHERE filename LIKE 'cmmc-report-%'
    DO UPDATE SET
      original_name = EXCLUDED.original_name,
      mime_type = EXCLUDED.mime_type,
      size = EXCLUDED.size,
      data = EXCLUDED.data,
      is_public = false
    WHERE
      COALESCE(
        jsonb_array_length((convert_from(decode(file_storage.data, 'base64'), 'UTF8')::jsonb)->'result'->'pendingStates'),
        CASE WHEN ((convert_from(decode(file_storage.data, 'base64'), 'UTF8')::jsonb)->'result'->>'coverageComplete')::boolean THEN 0 ELSE 999 END
      ) >=
      COALESCE(
        jsonb_array_length((convert_from(decode(EXCLUDED.data, 'base64'), 'UTF8')::jsonb)->'result'->'pendingStates'),
        CASE WHEN ((convert_from(decode(EXCLUDED.data, 'base64'), 'UTF8')::jsonb)->'result'->>'coverageComplete')::boolean THEN 0 ELSE 999 END
      )
    RETURNING filename, size, data
  `);
  let row = firstResultRow<{ filename: unknown; size: unknown; data: unknown }>(stored);
  if (!row) {
    const current = await db.execute(sql`
      SELECT fs.filename, fs.size, fs.data
      FROM file_storage fs
      JOIN projects p ON p.id = ${context.projectId} AND p.tenant_id = ${context.tenantId}
      WHERE fs.tenant_id = ${context.tenantId} AND fs.filename = ${filename}
      LIMIT 1
    `);
    row = firstResultRow<{ filename: unknown; size: unknown; data: unknown }>(current);
  }
  if (!row || row.filename !== filename) throw new Error("CMMC checkpoint project does not belong to this tenant");
  const verified = Buffer.from(String(row.data || ""), "base64");
  const verifiedSha256 = crypto.createHash("sha256").update(verified).digest("hex");
  if (verified.length !== Number(row.size) || parseCheckpointResult(JSON.parse(verified.toString("utf8")), cmmcProspectCacheKey(input)) === null) {
    throw new Error("CMMC checkpoint read-back verification failed");
  }
  return { filename, size: verified.length, sha256: verifiedSha256 };
}

export async function loadCmmcProspectCheckpoint(
  input: CmmcProspectInput,
  context: CmmcProspectCheckpointContext,
): Promise<CmmcProspectResult | null> {
  if (context.tenantId !== input.tenantId) throw new Error("CMMC checkpoint tenant mismatch");
  const filename = cmmcProspectCheckpointFilename(input, context.projectId);
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const stored = await db.execute(sql`
    SELECT fs.data, fs.size
    FROM file_storage fs
    JOIN projects p ON p.id = ${context.projectId} AND p.tenant_id = ${context.tenantId}
    WHERE fs.tenant_id = ${context.tenantId}
      AND fs.filename = ${filename}
    LIMIT 1
  `);
  const row = firstResultRow<{ data: unknown; size: unknown }>(stored);
  if (!row?.data) return null;
  const bytes = Buffer.from(String(row.data), "base64");
  if (bytes.length !== Number(row.size) || bytes.length === 0 || bytes.length > 2 * 1024 * 1024) {
    throw new Error("CMMC checkpoint bytes are invalid");
  }
  try {
    const raw = JSON.parse(bytes.toString("utf8"));
    const parsed = parseCheckpointResult(raw, cmmcProspectCacheKey(input));
    if (!parsed) throw new Error("shape mismatch");
    if ((raw as { version?: unknown }).version !== 1) {
      // Upgrade checkpoints written before the integrity envelope existed.
      await persistCmmcProspectCheckpoint(input, context, parsed);
    }
    return { ...parsed, cached: true, diagnostics: [...parsed.diagnostics, "durable_checkpoint_recovered"] };
  } catch {
    throw new Error("CMMC checkpoint content is invalid");
  }
}

function result(outcome: ProspectOutcome, cacheKey: string, candidates: AcceptedCmmcProspect[], excludedWithoutCage: number, sourceCalls: number, verificationCalls: number, retrievedCount = 0, cappedCount = 0, verificationFailures: ProspectOutcome[] = [], diagnostics: string[] = [], coverageIncomplete = false, retryableOverride?: boolean): CmmcProspectResult {
  return {
    outcome,
    terminal: TERMINAL_NO_DATA.has(outcome),
    retryable: retryableOverride ?? !TERMINAL_NO_DATA.has(outcome),
    cached: false,
    cacheKey,
    candidates,
    excludedWithoutCage,
    sourceCalls,
    verificationCalls,
    retrievedCount,
    cappedCount,
    verificationFailures,
    coverageComplete: !coverageIncomplete && cappedCount === 0 && verificationFailures.length === 0,
    diagnostics,
    completedStates: [],
    pendingStates: [],
  };
}

export async function discoverCmmcProspects(input: CmmcProspectInput, source: CmmcProspectSource = samGovSource()): Promise<CmmcProspectResult> {
  const normalized = normalizeCmmcProspectInput(input);
  const cacheKey = cmmcProspectCacheKey(normalized);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.result, cached: true };

  const batch = await source.discover(normalized);
  if (batch.outcome !== "ok") {
    const noData = {
      ...result(batch.outcome, cacheKey, [], 0, batch.sourceCalls ?? 1, 0, 0, batch.omittedCount || 0, [], batch.diagnostic ? [batch.diagnostic] : []),
      completedStates: batch.completedStates || [],
      pendingStates: batch.pendingStates || normalized.states,
    };
    if (noData.terminal) cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result: noData });
    return noData;
  }
  const accepted: AcceptedCmmcProspect[] = [];
  let excludedWithoutCage = 0;
  let verificationCalls = 0;
  const verificationFailures: ProspectOutcome[] = [];
  const transientVerificationFailureStates = new Set<string>();
  const verificationDiagnostics: string[] = [];
  const retrievedCount = batch.candidates?.length || 0;
  const cappedCount = (batch.omittedCount || 0) + Math.max(0, retrievedCount - MAX_CANDIDATE_VERIFICATIONS);
  for (const candidate of (batch.candidates || []).slice(0, MAX_CANDIDATE_VERIFICATIONS)) {
    const candidateState = (candidate.state || candidate.location || "").trim().toUpperCase();
    if (!normalized.states.includes(candidateState)) {
      excludedWithoutCage++;
      continue;
    }
    verificationCalls++;
    const verified = await source.verify(candidate, normalized);
    if (verified.outcome !== "ok") {
      if (verified.outcome !== "empty") {
        verificationFailures.push(verified.outcome);
        if (TRANSIENT_OUTCOMES.has(verified.outcome)) transientVerificationFailureStates.add(candidateState);
      }
      else excludedWithoutCage++;
      if (verified.diagnostic) verificationDiagnostics.push(verified.diagnostic);
      continue;
    }
    const cage = verified.evidence?.cage?.toUpperCase();
    const company = candidate.company?.trim();
    const state = candidateState;
    const urls = [...new Set([candidate.sourceUrl, ...(candidate.sourceUrls || []), verified.evidence?.sourceUrl].filter((url): url is string => {
      if (!url) return false;
      try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && (parsed.hostname === "sam.gov" || parsed.hostname.endsWith(".gov"));
      } catch {
        return false;
      }
    }))];
    if (!company || !/^[A-Z]{2}$/.test(state) || !cage || !CAGE.test(cage) || urls.length === 0 || !candidate.contactPath) {
      excludedWithoutCage++;
      continue;
    }
    const sourceId = candidate.uei || candidate.noticeId || null;
    accepted.push({
      company,
      company_name: company,
      legal_name: candidate.legalName || company,
      state,
      city: candidate.city || null,
      location: candidate.location || state,
      cage,
      uei: candidate.uei || candidate.noticeId || null,
      registration_status: candidate.registrationStatus || "unknown",
      qualification_type: candidate.qualificationType || "sam_registered",
      qualification_basis: "Authoritative federal entity evidence links this business to a CAGE code in the requested state; this supports outreach prospecting but does not prove CMMC scope or certification.",
      sourceUrls: urls,
      source_records: urls.map((url) => ({
        source: url.includes("usaspending.gov") ? "usaspending" : url.includes("sam.gov") ? "sam" : "other",
        source_id: sourceId,
        url,
        evidence: "Federal source directly attributes the entity identity, target-state address, and CAGE code.",
      })),
      confidence: 95,
      confidence_level: "high",
      verification_status: "verified",
      contactPath: candidate.contactPath,
      website: candidate.website || (candidate.contactPath.startsWith("http") ? candidate.contactPath : null),
      phone: candidate.phone || null,
      naics: candidate.naics || [],
      notes: null,
    });
    if (accepted.length === MAX_OUTPUT_CANDIDATES) break;
  }
  const failurePriority: ProspectOutcome[] = ["configuration_error", "forbidden", "hourly_cap", "rate_limited", "overloaded", "timeout", "dollar_cap", "tool_call_cap"];
  const outcome = accepted.length
    ? (batch.coverageIncomplete || verificationFailures.length > 0 || cappedCount > 0 ? "partial" : "ok")
    : batch.retryableFailure || failurePriority.find((candidate) => verificationFailures.includes(candidate)) || "empty";
  const retryableOverride = batch.retryableFailure
    ? TRANSIENT_OUTCOMES.has(batch.retryableFailure)
    : verificationFailures.length > 0
      ? verificationFailures.some((failure) => TRANSIENT_OUTCOMES.has(failure))
      : undefined;
  const completed = result(
    outcome,
    cacheKey,
    accepted,
    excludedWithoutCage,
    batch.sourceCalls ?? 1,
    verificationCalls,
    retrievedCount,
    cappedCount,
    verificationFailures,
    [batch.diagnostic, ...verificationDiagnostics].filter((value): value is string => Boolean(value)),
    Boolean(batch.coverageIncomplete),
    retryableOverride,
  );
  const sourceCompletedStates = batch.completedStates || normalized.states;
  completed.completedStates = sourceCompletedStates.filter((state) => !transientVerificationFailureStates.has(state));
  completed.pendingStates = normalized.states.filter((state) => !completed.completedStates.includes(state));
  completed.coverageComplete = completed.coverageComplete && completed.pendingStates.length === 0;
  const transientBatchFailure = batch.retryableFailure ? TRANSIENT_OUTCOMES.has(batch.retryableFailure) : false;
  if (outcome === "ok" || outcome === "empty" || TERMINAL_NO_DATA.has(outcome) || (outcome === "partial" && verificationFailures.length === 0 && !transientBatchFailure)) {
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result: completed });
  }
  return completed;
}

export async function discoverOrResumeCmmcProspects(
  input: CmmcProspectInput,
  prior: CmmcProspectResult | null,
  source: CmmcProspectSource = samGovSource(),
): Promise<CmmcProspectResult> {
  const normalized = normalizeCmmcProspectInput(input);
  const originalCacheKey = cmmcProspectCacheKey(normalized);
  if (!prior || prior.cacheKey !== originalCacheKey) {
    return discoverCmmcProspects(normalized, source);
  }
  const completedStates = prior.coverageComplete
    ? normalized.states
    : [...new Set(prior.completedStates || [])].filter((state) => normalized.states.includes(state));
  const pendingStates = normalized.states.filter((state) => !completedStates.includes(state));
  if (pendingStates.length === 0 || prior.coverageComplete || !prior.retryable) {
    return { ...prior, completedStates, pendingStates };
  }

  const resumed = await discoverCmmcProspects({ ...normalized, states: pendingStates }, source);
  const mergedCompleted = [...new Set([...completedStates, ...(resumed.completedStates || [])])]
    .filter((state) => normalized.states.includes(state));
  const mergedPending = normalized.states.filter((state) => !mergedCompleted.includes(state));
  const candidates = [...prior.candidates, ...resumed.candidates].filter((candidate, index, all) =>
    all.findIndex((other) => other.state === candidate.state && other.cage === candidate.cage) === index);
  const verificationFailures = [
    ...prior.verificationFailures.filter((failure) => !TRANSIENT_OUTCOMES.has(failure)),
    ...resumed.verificationFailures,
  ];
  const cappedCount = prior.cappedCount + resumed.cappedCount;
  const coverageComplete = mergedPending.length === 0
    && cappedCount === 0
    && verificationFailures.length === 0
    && resumed.coverageComplete;
  const outcome: ProspectOutcome = mergedPending.length > 0
    ? (candidates.length > 0 ? "partial" : resumed.outcome)
    : (candidates.length > 0 ? (coverageComplete ? "ok" : "partial") : "empty");

  return {
    ...resumed,
    outcome,
    terminal: mergedPending.length === 0 && TERMINAL_NO_DATA.has(outcome),
    retryable: mergedPending.length > 0 || resumed.retryable,
    cached: false,
    cacheKey: originalCacheKey,
    candidates,
    excludedWithoutCage: prior.excludedWithoutCage + resumed.excludedWithoutCage,
    sourceCalls: prior.sourceCalls + resumed.sourceCalls,
    verificationCalls: prior.verificationCalls + resumed.verificationCalls,
    retrievedCount: prior.retrievedCount + resumed.retrievedCount,
    cappedCount,
    verificationFailures,
    coverageComplete,
    diagnostics: [...new Set([...prior.diagnostics, ...resumed.diagnostics])],
    completedStates: mergedCompleted,
    pendingStates: mergedPending,
  };
}

export function isCmmcProspectDeliveryReady(result: CmmcProspectResult): boolean {
  const supportedOutcome = result.outcome === "ok" || result.outcome === "partial" || result.outcome === "empty";
  const noPendingStates = Array.isArray(result.pendingStates)
    ? result.pendingStates.length === 0
    : result.coverageComplete;
  return supportedOutcome && noPendingStates && result.verificationFailures.length === 0;
}

function classifyHttp(status: number): ProspectOutcome {
  if (status === 400 || status === 401) return "configuration_error";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status === 529) return "overloaded";
  if (status >= 500) return "source_error";
  if (status >= 200 && status < 300) return "ok";
  return "source_error";
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(";") : value == null ? "" : String(value);
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export function buildCmmcProspectArtifacts(result: CmmcProspectResult): CmmcProspectArtifact[] {
  const rows = result.candidates;
  // Cache/recovery diagnostics describe how the current invocation obtained
  // the result, not the source run itself. Excluding them keeps a retried
  // artifact byte-identical to the first export under the same idempotency key.
  const sourceDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic !== "durable_checkpoint_recovered");
  const json = JSON.stringify({
    metadata: {
      retrieved_count: result.retrievedCount,
      verified_count: rows.filter((row) => row.verification_status === "verified").length,
      needs_review_count: rows.filter((row) => row.verification_status === "needs_review").length,
      rejected_count: result.excludedWithoutCage,
      coverage_complete: result.coverageComplete,
      capped_count: result.cappedCount,
      verification_failures: result.verificationFailures,
      diagnostics: sourceDiagnostics,
    },
    prospects: rows,
  }, null, 2) + "\n";
  const columns = ["company_name", "legal_name", "state", "city", "cage", "uei", "registration_status", "qualification_type", "qualification_basis", "confidence_level", "verification_status", "website", "phone", "naics", "source_urls", "notes"];
  const csv = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => [
      row.company_name, row.legal_name, row.state, row.city, row.cage, row.uei,
      row.registration_status, row.qualification_type, row.qualification_basis,
      row.confidence_level, row.verification_status, row.website, row.phone,
      row.naics, row.sourceUrls, row.notes,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
  const report = [
    "# CMMC Level 1 Prospect Roster",
    "",
    `Evidence scope: active SAM.gov entities in ${[...new Set(rows.map((row) => row.state))].join(", ") || "the requested states"}`,
    "",
    "> Prospecting evidence only. A CAGE code or federal registration does not prove CMMC applicability, readiness, or certification.",
    "",
    `Verified prospects: ${rows.length}`,
    `Excluded or rejected records: ${result.excludedWithoutCage}`,
    "",
    ...rows.flatMap((row) => [
      `## ${row.company_name}`,
      `- Location: ${row.city ? `${row.city}, ` : ""}${row.state}`,
      `- CAGE: ${row.cage}`,
      `- UEI: ${row.uei || "Not provided"}`,
      `- Confidence: ${row.confidence_level}`,
      `- Basis: ${row.qualification_basis}`,
      `- Sources: ${row.sourceUrls.join(", ")}`,
      "",
    ]),
  ].join("\n");
  const log = [
    "# CMMC Prospect Run Log",
    "",
    `Outcome: ${result.outcome}`,
    `Source calls: ${result.sourceCalls}`,
    `Verification calls: ${result.verificationCalls}`,
    `Accepted: ${rows.length}`,
    `Rejected/excluded: ${result.excludedWithoutCage}`,
    `Retrieved: ${result.retrievedCount}`,
    `Capped before verification: ${result.cappedCount}`,
    `Coverage complete: ${result.coverageComplete}`,
    `Verification failures: ${result.verificationFailures.join(", ") || "none"}`,
    `Diagnostics: ${sourceDiagnostics.join("; ") || "none"}`,
    `Cache key: ${result.cacheKey}`,
    "",
  ].join("\n");
  return [
    { fileName: "prospects.json", mimeType: "application/json", content: json },
    { fileName: "prospects.csv", mimeType: "text/csv", content: csv },
    { fileName: "prospects_report.md", mimeType: "text/markdown", content: report },
    { fileName: "run_log.md", mimeType: "text/markdown", content: log },
  ];
}

export async function deliverCmmcProspectArtifacts(
  result: CmmcProspectResult,
  context: { tenantId: number; projectId?: number },
  upload: (artifact: CmmcProspectArtifact, idempotencyKey: string) => Promise<Omit<CmmcArtifactDelivery, "fileName">>,
): Promise<CmmcArtifactDelivery[]> {
  if (!context.projectId) {
    return [{ fileName: "artifact_set", success: false, error: "Durable export requires an active project context" }];
  }
  const deliveries: CmmcArtifactDelivery[] = [];
  for (const artifact of buildCmmcProspectArtifacts(result)) {
    try {
      const receipt = await upload(artifact, cmmcProspectArtifactKey(result.cacheKey, context.projectId, artifact.fileName));
      deliveries.push({ fileName: artifact.fileName, ...receipt });
    } catch (error) {
      deliveries.push({ fileName: artifact.fileName, success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return deliveries;
}

export function cmmcProspectSourceRunKey(cacheKey: string): string {
  return cacheKey.length <= 300
    ? cacheKey
    : `cmmc-run:${crypto.createHash("sha256").update(cacheKey).digest("hex")}`;
}

export function cmmcProspectArtifactKey(cacheKey: string, projectId: number, fileName: string): string {
  const legacyKey = `cmmc:p${projectId}:${cacheKey}:${fileName}`;
  return legacyKey.length <= 300
    ? legacyKey
    : `cmmc:p${projectId}:cmmc-run:${crypto.createHash("sha256").update(cacheKey).digest("hex")}:${fileName}`;
}

/** A host-locked SAM adapter: callers never control an outbound URL. */
export function samGovSource(
  fetchImpl: typeof fetch = fetch,
  retryDependencies: {
    retry429?: boolean;
    sleep?: (milliseconds: number) => Promise<void>;
    batchDelayMs?: number;
  } = {},
): CmmcProspectSource & CmmcCompanyLookupSource & SamExactCompanySource {
  const apiKey = process.env.SAM_GOV_API_KEY;
  const retry429 = retryDependencies.retry429 ?? fetchImpl === fetch;
  const sleep = retryDependencies.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const batchDelayMs = retryDependencies.batchDelayMs ?? (fetchImpl === fetch ? 1_500 : 0);
  const request = async (params: URLSearchParams, maxAttempts = 3) => {
    if (!apiKey) return { outcome: "configuration_error" as const, attempts: 0 };
    params.set("api_key", apiKey);
    try {
       if (fetchImpl === fetch) {
         await reserveLiveSamRequest();
       }
       let attempts = 1;
       let response = await fetchImpl(`https://api.sam.gov/entity-information/v3/entities?${params}`, { signal: AbortSignal.timeout(10_000) });
       // A live SAM key can be paced more tightly than the endpoint permits.
       // Retry a bounded number of times, honoring a reasonable Retry-After
       // while never turning one discovery into an unbounded chat turn.
        for (let retry = 0; retry429 && response.status === 429 && attempts < Math.max(1, maxAttempts); retry++) {
         const retryAfterSeconds = Number(response.headers.get("retry-after"));
         const fallbackSeconds = retry === 0 ? 5 : 15;
         const waitSeconds = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
           ? Math.min(30, retryAfterSeconds)
           : fallbackSeconds;
         await response.body?.cancel().catch(() => undefined);
         await sleep(waitSeconds * 1000);
         await reserveLiveSamRequest();
         attempts++;
         response = await fetchImpl(`https://api.sam.gov/entity-information/v3/entities?${params}`, { signal: AbortSignal.timeout(10_000) });
       }
       if (!response.ok) return { outcome: classifyHttp(response.status), diagnostic: `sam_http_${response.status}`, attempts };
        const body: unknown = await response.json();
        if (!isRecord(body)) return { outcome: "source_error" as const, diagnostic: "sam_invalid_json_shape" };
       return { outcome: "ok" as const, body, attempts };
    } catch (error: unknown) {
       const errorName = isRecord(error) ? error.name : undefined;
       const timeout = errorName === "TimeoutError" || errorName === "AbortError";
       return { outcome: timeout ? "timeout" as const : "source_error" as const, diagnostic: timeout ? "sam_timeout" : "sam_transport_or_parse_error" };
    }
  };
  return {
    async search(input) {
      const entities: unknown[] = [];
      const diagnostics: string[] = [];
      const seen = new Set<string>();
      let attempts = 0;
      let coverageComplete = true;
      for (const query of input.queries) {
        let page = 0;
        let retrievedForQuery = 0;
        while (attempts < input.maxAttempts) {
          const remainingAttempts = input.maxAttempts - attempts;
          const params = new URLSearchParams({
            page: String(page),
            size: "10",
            legalBusinessName: query.legalBusinessName,
          });
          if (query.state) params.set("physicalAddressProvinceOrStateCode", query.state);
          if (!input.includeInactive) params.set("registrationStatus", "A");
          const response = await request(params, Math.min(3, remainingAttempts));
          attempts += Math.min(remainingAttempts, Math.max(1, response.attempts ?? 1));
          if (response.outcome !== "ok") {
            if (entities.length === 0) {
              return {
                outcome: response.outcome,
                attempts,
                coverageComplete: false,
                diagnostics: [response.diagnostic || response.outcome],
              };
            }
            coverageComplete = false;
            diagnostics.push(response.diagnostic || response.outcome);
            break;
          }
          if (!Array.isArray(response.body?.entityData)) {
            return {
              outcome: entities.length ? "ok" : "source_error",
              entities,
              attempts,
              coverageComplete: false,
              diagnostics: [...diagnostics, "sam_exact_entity_data_missing"],
            };
          }
          const totalRecords = Number(response.body.totalRecords);
          if (!Number.isInteger(totalRecords) || totalRecords < 0) {
            return {
              outcome: entities.length ? "ok" : "source_error",
              entities,
              attempts,
              coverageComplete: false,
              diagnostics: [...diagnostics, "sam_exact_total_records_invalid"],
            };
          }
          for (const entity of response.body.entityData) {
            const registration = recordOrEmpty(recordOrEmpty(entity).entityRegistration);
            const coreData = recordOrEmpty(recordOrEmpty(entity).coreData);
            const address = recordOrEmpty(coreData.physicalAddress);
            const key = String(registration.ueiSAM || registration.cageCode || [
              registration.legalBusinessName,
              address.stateOrProvinceCode,
              address.zipCode,
            ].join(":"));
            if (!seen.has(key)) {
              seen.add(key);
              entities.push(entity);
            }
          }
          retrievedForQuery += response.body.entityData.length;
          if (retrievedForQuery >= totalRecords) break;
          page++;
          if (attempts >= input.maxAttempts) {
            coverageComplete = false;
            diagnostics.push(`sam_exact_attempt_cap_before_query_coverage:${query.legalBusinessName}`);
          }
        }
        if (attempts >= input.maxAttempts && query !== input.queries[input.queries.length - 1]) {
          coverageComplete = false;
          diagnostics.push("sam_exact_query_variants_not_completed");
          break;
        }
      }
      return { outcome: "ok", entities, attempts, coverageComplete, diagnostics };
    },
    async discover(input) {
      const candidates: CmmcCandidateInput[] = [];
      const completedStates: string[] = [];
      let omittedCount = 0;
      let sourceCalls = 0;
      for (let stateIndex = 0; stateIndex < input.states.length; stateIndex++) {
        const state = input.states[stateIndex];
        const paceNextState = async () => {
          if (stateIndex < input.states.length - 1 && batchDelayMs > 0) {
            await sleep(batchDelayMs);
          }
        };
        const response = await request(new URLSearchParams({
          page: "0",
          size: "10",
          physicalAddressProvinceOrStateCode: state,
          registrationStatus: "A",
          purposeOfRegistrationCode: "Z2",
        }));
        sourceCalls += response.attempts ?? 1;
        if (response.outcome !== "ok") {
          const pendingStates = input.states.filter((candidateState) => !completedStates.includes(candidateState));
          if (candidates.length === 0) return { ...response, sourceCalls, completedStates, pendingStates };
          return {
            outcome: "ok",
            candidates,
            sourceCalls,
            omittedCount,
            coverageIncomplete: true,
            retryableFailure: response.outcome,
            diagnostic: `sam_state_${state}_${response.diagnostic || response.outcome}`,
            completedStates,
            pendingStates,
          };
        }
        if (!Array.isArray(response.body?.entityData)) {
          if (response.body?.totalRecords === 0) {
            completedStates.push(state);
            await paceNextState();
            continue;
          }
          if (candidates.length > 0) {
            return {
              outcome: "ok",
              candidates,
              sourceCalls,
              omittedCount,
              coverageIncomplete: true,
              retryableFailure: "source_error",
              diagnostic: `sam_state_${state}_sam_entity_data_missing`,
              completedStates,
              pendingStates: input.states.filter((candidateState) => !completedStates.includes(candidateState)),
            };
          }
          return { outcome: "source_error", sourceCalls, diagnostic: "sam_entity_data_missing", completedStates, pendingStates: input.states };
        }
        const entities = response.body.entityData;
        const totalRecords = Number(response.body.totalRecords);
        if (!Number.isInteger(totalRecords) || totalRecords < 0 || totalRecords < entities.length) {
          if (candidates.length > 0) {
            return {
              outcome: "ok",
              candidates,
              sourceCalls,
              omittedCount,
              coverageIncomplete: true,
              retryableFailure: "source_error",
              diagnostic: `sam_state_${state}_sam_total_records_invalid`,
              completedStates,
              pendingStates: input.states.filter((candidateState) => !completedStates.includes(candidateState)),
            };
          }
          return { outcome: "source_error", sourceCalls, diagnostic: "sam_total_records_invalid", completedStates, pendingStates: input.states };
        }
        if (totalRecords > entities.length) {
          omittedCount += totalRecords - entities.length;
        }
        candidates.push(...entities.map((value: unknown) => {
          const entity = recordOrEmpty(value);
          const registration = recordOrEmpty(entity.entityRegistration);
          const coreData = recordOrEmpty(entity.coreData);
          const address = recordOrEmpty(coreData.physicalAddress);
          const assertions = recordOrEmpty(entity.assertions);
          const goodsAndServices = recordOrEmpty(assertions.goodsAndServices);
          const entityState = String(address.stateOrProvinceCode || "").toUpperCase();
          const uei = String(registration.ueiSAM || "").trim();
          const mapped: CmmcCandidateInput = {
            company: typeof registration.legalBusinessName === "string" ? registration.legalBusinessName : undefined,
            legalName: typeof registration.legalBusinessName === "string" ? registration.legalBusinessName : undefined,
            state: entityState,
            city: typeof address.city === "string" ? address.city : undefined,
            location: [address.city, entityState].filter(Boolean).join(", "),
            cage: typeof registration.cageCode === "string" ? registration.cageCode : undefined,
            uei,
            registrationStatus: String(registration.registrationStatus || "").toLowerCase() === "active" ? "active" : "unknown",
            naics: Array.isArray(goodsAndServices.naicsList)
              ? goodsAndServices.naicsList.map((value: unknown) => {
                const item = recordOrEmpty(value);
                return String(item.naicsCode || "");
              }).filter(Boolean)
              : [],
            qualificationType: "sam_registered",
            sourceUrl: uei ? `https://sam.gov/entity/${encodeURIComponent(uei)}/coreData` : "https://sam.gov/content/entity-registration",
            noticeId: uei,
            contactPath: uei ? `https://sam.gov/entity/${encodeURIComponent(uei)}/coreData` : undefined,
            authoritativeSamEntity: true,
          };
          return mapped;
        }).filter((candidate: CmmcCandidateInput) => String(candidate.state || "").toUpperCase() === state));
        completedStates.push(state);
        await paceNextState();
      }
      return {
        outcome: "ok",
        candidates,
        sourceCalls,
        omittedCount,
        diagnostic: omittedCount > 0 ? `sam_bounded_page_omitted_${omittedCount}` : undefined,
        completedStates,
        pendingStates: [],
      };
    },
    async lookupCompanyName(name, includeInactive, maxAttempts) {
      const params = new URLSearchParams({
        page: "0",
        size: "10",
        legalBusinessName: name,
      });
      if (!includeInactive) params.set("registrationStatus", "A");
      const response = await request(params, maxAttempts);
      if (response.outcome !== "ok") return response;
      if (!Array.isArray(response.body?.entityData)) {
        return { outcome: "source_error", diagnostic: "sam_company_entity_data_missing", attempts: response.attempts };
      }
      const totalRecords = Number(response.body.totalRecords);
      if (!Number.isInteger(totalRecords) || totalRecords < 0 || totalRecords < response.body.entityData.length) {
        return { outcome: "source_error", diagnostic: "sam_company_total_records_invalid", attempts: response.attempts };
      }
      return {
        outcome: "ok",
        entities: response.body.entityData,
        totalRecords,
        attempts: response.attempts,
      };
    },
    async verify(candidate) {
      if (!candidate.cage || !candidate.noticeId) return { outcome: "empty" };
      // Discovery already received the legal name, state, UEI, and CAGE in one
      // attributable record from SAM's authoritative entity endpoint. Re-querying
      // every row used to multiply a two-state run into as many as 22 calls and
      // caused the repeated 429 failures this bounded workflow is meant to avoid.
      if (candidate.authoritativeSamEntity) {
        return { outcome: "ok", evidence: { cage: candidate.cage, sourceUrl: candidate.sourceUrl } };
      }
      // Non-SAM/injected candidates still require a host-locked UEI recheck.
      const response = await request(new URLSearchParams({
        page: "0",
        size: "1",
        ueiSAM: candidate.noticeId,
      }));
      if (response.outcome !== "ok") return response;
      if (!Array.isArray(response.body?.entityData)) return { outcome: "source_error", diagnostic: "sam_verification_entity_data_missing" };
      const match = response.body.entityData.find((value: unknown) => {
        const entity = recordOrEmpty(value);
        const registration = recordOrEmpty(entity.entityRegistration);
        const address = recordOrEmpty(recordOrEmpty(entity.coreData).physicalAddress);
        return String(registration.cageCode || "").toUpperCase() === candidate.cage!.toUpperCase()
          && String(registration.ueiSAM || "").trim() === candidate.noticeId
          && String(registration.legalBusinessName || "").trim() === candidate.company?.trim()
          && String(address.stateOrProvinceCode || "").toUpperCase() === String(candidate.state || "").toUpperCase();
      });
      return match ? { outcome: "ok", evidence: { cage: candidate.cage, sourceUrl: candidate.sourceUrl } } : { outcome: "empty" };
    },
  };
}