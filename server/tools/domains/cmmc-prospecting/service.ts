/**
 * Dependency seam for the CMMC domain. The tools package must not import
 * server/lib; server/tools.ts provides this concrete implementation at startup.
 */
export type ProspectOutcome = "ok" | "partial" | "empty" | "forbidden" | "rate_limited" | "overloaded" | "timeout" | "source_error" | "hourly_cap" | "tool_call_cap" | "dollar_cap" | "configuration_error";

export interface CmmcProspectInput {
  tenantId: number;
  query: string;
  states: string[];
  dateWindow: { from: string; to: string };
}

export interface CmmcCheckpointContext {
  tenantId: number;
  projectId: number;
}

export interface CmmcProspectResult {
  outcome: ProspectOutcome;
  terminal: boolean;
  retryable: boolean;
  cached: boolean;
  cacheKey: string;
  candidates: unknown[];
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

export interface CmmcCompanyLookupResult {
  outcome: ProspectOutcome | "ok" | "partial" | "empty";
  terminal: boolean;
  retryable: boolean;
  results: unknown[];
  sourceCalls: number;
  pendingNames: string[];
  diagnostics: string[];
}

export interface SamExactCompanyLookupResult {
  resolutionStatus: "exact_match" | "near_match" | "ambiguous" | "no_attributable_match";
  coverageComplete: boolean;
  matchedEntity: unknown;
  candidates: unknown[];
  evidence: unknown;
  diagnostics: string[];
  sourceCalls: number;
  retryable: boolean;
}

export interface CmmcArtifact {
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

export interface CmmcProspectingService {
  acquireCmmcProspectLease(input: CmmcProspectInput, context: CmmcCheckpointContext): Promise<string | null>;
  cmmcProspectCacheKey(input: CmmcProspectInput): string;
  cmmcProspectSourceRunKey(cacheKey: string): string;
  discoverOrResumeCmmcProspects(input: CmmcProspectInput, recovered?: CmmcProspectResult | null): Promise<CmmcProspectResult>;
  deliverCmmcProspectArtifacts(
    result: CmmcProspectResult,
    context: CmmcCheckpointContext,
    deliver: (artifact: CmmcArtifact, idempotencyKey: string) => Promise<Omit<CmmcArtifactDelivery, "fileName">>,
  ): Promise<CmmcArtifactDelivery[]>;
  isCmmcProspectDeliveryReady(result: CmmcProspectResult): boolean;
  loadCmmcProspectCheckpoint(input: CmmcProspectInput, context: CmmcCheckpointContext): Promise<CmmcProspectResult | null>;
  persistCmmcProspectCheckpoint(input: CmmcProspectInput, context: CmmcCheckpointContext, result: CmmcProspectResult): Promise<unknown>;
  releaseCmmcProspectLease(input: CmmcProspectInput, context: CmmcCheckpointContext, owner: string): Promise<void>;
  lookupSamCompanies(input: { tenantId: number; companyNames: string[]; includeInactive: boolean }): Promise<CmmcCompanyLookupResult>;
  lookupSamExactCompany(input: {
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
  }): Promise<SamExactCompanyLookupResult>;
}

let service: CmmcProspectingService | undefined;

export function configureCmmcProspectingService(dependency: CmmcProspectingService): void {
  service = dependency;
}

export function getCmmcProspectingService(): CmmcProspectingService {
  if (!service) throw new Error("CMMC prospecting service is not configured");
  return service;
}