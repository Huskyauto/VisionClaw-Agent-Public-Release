import { z } from "zod";

export const CMMC_L1_CATALOG_VERSION = "cmmc-l1-fci-2026-09-v3-objective-support";
export const CMMC_L1_REVIEW_DATE = "August 25, 2026";
export const CMMC_L1_OBJECTIVE_COUNT = 59;
export const CMMC_L1_DISCLAIMER =
  "Customer-prepared Level 1 self-assessment documentation only. The customer and Affirming Official are solely responsible for the truth, completeness, and currency of the statements in this packet. No third party has assessed, certified, verified, or endorsed those statements. This packet is not a CMMC certification, C3PAO assessment, legal opinion, or SPRS submission.";
export const CMMC_L1_SELF_CERTIFICATION_TEXT =
  "I acknowledge that I reviewed the responses in this CMMC Level 1 self-assessment preparation questionnaire and, to the best of my knowledge, they are complete and truthful as of the signed date. I understand that the organization must implement and maintain every applicable Level 1 requirement in the stated assessment scope before it can represent a Final Level 1 (Self) result. I also understand that this customer-prepared packet does not replace the Affirming Official's review and affirmation in SPRS; it is not a CMMC certification, C3PAO assessment, SPRS submission, legal opinion, or notary service.";
export const CMMC_L1_SCOPE_GUIDANCE =
  "Tell us where your government contract information comes in, who uses it, what computers or programs hold it, where the work happens, and whether an outside company helps. Give names only—do not paste government information, passwords, screenshots, logs, IP addresses, or files.";
export const CMMC_L1_SOURCE_CITATIONS = [
  "FAR 52.204-21, Basic Safeguarding of Covered Contractor Information Systems",
  "32 CFR 170.15, Level 1 self-assessment and SPRS result fields",
  "32 CFR 170.19 and 170.22, CMMC assessment scope and affirmation",
  "CMMC Assessment Guide – Level 1, v2.13 (September 2024)",
  "CMMC Assessment Scope – Level 1, v2.13 (September 2024)",
] as const;

export type CmmcStatus = "met" | "not_met" | "not_applicable" | "";

export type CmmcAssessmentMethod = "examine" | "interview" | "test" | "examine_interview" | "examine_test" | "interview_test" | "all_three" | "";
export const CMMC_ASSESSMENT_LOCKED_STATUSES = ["inviting", "submitting", "submitted", "report_ready", "approved", "delivered"] as const;
export const CMMC_ASSESSMENT_DELIVERY_APPROVAL_STATUSES = ["submitted", "report_ready", "approved"] as const;
const cmmcAssessmentLockedStatusSet = new Set<string>(CMMC_ASSESSMENT_LOCKED_STATUSES);

export function isCmmcAssessmentLocked(status: string | null | undefined): boolean {
  return typeof status === "string" && cmmcAssessmentLockedStatusSet.has(status);
}

export interface CmmcRequirement {
  id: string;
  number: string;
  title: string;
  practice: string;
  objectiveLabels: string[];
  objectivePrompts: string[];
  objectiveGuidance: string[];
  baseline: string;
  examples: string[];
}

export interface CmmcControlAnswer {
  /** Historical drafts may contain this; current requirement status is calculated. */
  status: CmmcStatus;
  objectiveStatuses: Record<string, CmmcStatus>;
  objectiveRationales: Record<string, string>;
  objectiveImplementations: Record<string, string>;
  objectiveEvidenceLocators: Record<string, string[]>;
  objectiveAssessmentMethods: Record<string, CmmcAssessmentMethod>;
  objectiveAssessmentNotes: Record<string, string>;
  objectiveEvidenceOwners: Record<string, string>;
  objectiveEvidenceDates: Record<string, string>;
  objectiveGapStatements: Record<string, string>;
  objectiveCorrectiveActions: Record<string, CmmcCorrectiveAction>;
  objectiveConfidence: Record<string, "high" | "medium" | "low" | "">;
  owner: string;
  implementationSummary: string;
  systemsCovered: string;
  exceptions: string;
  evidenceRecords: CmmcEvidenceRecord[];
  /** Historical requirement-level evidence retained for readable old drafts. */
  evidence: string;
  evidenceDate: string;
}

export interface CmmcDraft {
  systemDescription: string;
  scopeType: string;
  inScopeLocations: string;
  inScopeAssetCategories: string[];
  assetInventoryLocator: string;
  fciFlowSummary: string;
  externalServiceProviders: string;
  assessmentStartDate: string;
  assessmentCompletionDate: string;
  assessmentParticipants: string;
  cageCodes: string;
  cmmcStatusDate: string;
  controls: Record<string, CmmcControlAnswer>;
  affirmations: Record<string, boolean>;
  /** Preserves pre-v2.13 split physical-protection answers for the customer to review. */
  legacyControls?: Record<string, CmmcControlAnswer>;
}

export interface CmmcSubmission {
  company: string;
  authorizedOfficialName: string;
  authorizedOfficialTitle: string;
  authorizedOfficialEmail: string;
  typedSignature: string;
  signedAt: string;
  draft: CmmcDraft;
}

export interface CmmcValidationIssue {
  key: string;
  label: string;
  sectionId: string;
  targetId: string;
  requirementId?: string;
  objectiveIndex?: number;
}

const CMMC_PROHIBITED_CONTENT_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/i,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|passwd|private[_ -]?key)\s*[:=]\s*\S{4,}/i,
  /\b(?:authorization|cookie|set-cookie)\s*:\s*(?:bearer\s+)?\S{8,}/i,
  /\b(?:CUI|controlled unclassified information|for official use only)\b/i,
  /\b(?:FCI|federal contract information)\s+(?:content|data|document|text)\b/i,
  /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\S+\s+HTTP\/1\.[01]\b/i,
  /\bat\s+\S+\s+\([^()\n]+:\d+:\d+\)/,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  /\b(?:screenshot|screen capture)\s*(?:data|contents?|attached|below|follows?)/i,
  /\b(?:network|security|system)\s+diagram\s*(?:contents?|attached|below|follows?)/i,
] as const;

export const CMMC_ASSESSMENT_METHODS = [
  "examine", "interview", "test", "examine_interview", "examine_test", "interview_test", "all_three",
] as const;
function requirement(
  id: string,
  number: string,
  practice: string,
  title: string,
  objectivePrompts: string[],
  baseline: string,
  examples: string[],
): CmmcRequirement {
  return {
    id,
    number,
    practice,
    title,
    objectiveLabels: objectivePrompts.map((_, index) => String.fromCharCode(97 + index)),
    objectivePrompts,
    objectiveGuidance: objectivePrompts.map(() => "Choose Met only if this is true today and you can show where the proof is kept. Choose Not met if it is missing or incomplete. Use Not applicable only when it truly does not apply to this setup."),
    baseline,
    examples,
  };
}

export const CMMC_L1_REQUIREMENTS: CmmcRequirement[] = [
  requirement("access-authorized", "01", "AC.L1-b.1.i", "Authorized Access Control", [
    "authorized users are identified;",
    "processes acting on behalf of authorized users are identified;",
    "devices (and other systems) authorized to connect to the system are identified;",
    "system access is limited to authorized users;",
    "system access is limited to processes acting on behalf of authorized users; and",
    "system access is limited to authorized devices (including other systems).",
  ], "Identify authorized users, acting processes, and connecting devices, then limit access to them.", ["Account inventory locator", "Access approval record locator", "Device inventory locator"]),
  requirement("access-functions", "02", "AC.L1-b.1.ii", "Transaction & Function Control", [
    "the types of transactions and functions that authorized users are permitted to execute are defined; and",
    "system access is limited to the defined types of transactions and functions for authorized users.",
  ], "Define the transactions and functions each authorized user may execute, then enforce those limits.", ["Role matrix locator", "Application permission locator", "Access review locator"]),
  requirement("external-connections", "03", "AC.L1-b.1.iii", "External Connections", [
    "connections to external systems are identified;",
    "the use of external systems is identified;",
    "connections to external systems are verified;",
    "the use of external systems is verified;",
    "connections to external systems are controlled/limited; and",
    "the use of external systems is controlled/limited.",
  ], "Identify, verify, and control connections to and use of external systems.", ["External-connection inventory locator", "Vendor approval locator", "Boundary-rule locator"]),
  requirement("public-information", "04", "AC.L1-b.1.iv", "Control Public Information", [
    "individuals authorized to post or process information on publicly accessible systems are identified;",
    "procedures to ensure [FCI] is not posted or processed on publicly accessible systems are identified;",
    "a review process is in place prior to posting of any content to publicly accessible systems;",
    "content on publicly accessible systems is reviewed to ensure that it does not include [FCI]; and",
    "mechanisms are in place to remove and address improper posting of [FCI].",
  ], "Control public posting and processing so FCI is not exposed on publicly accessible systems.", ["Publishing procedure locator", "Public-content review locator", "Removal-process locator"]),
  requirement("identify-users", "05", "IA.L1-b.1.v", "Identification", [
    "system users are identified;",
    "processes acting on behalf of users are identified; and",
    "devices accessing the system are identified.",
  ], "Use identifiable accounts, processes, and devices for the assessed system.", ["Account standard locator", "Service-account register locator", "Asset inventory locator"]),
  requirement("authenticate-users", "06", "IA.L1-b.1.vi", "Authentication", [
    "the identity of each user is authenticated or verified as a prerequisite to system access;",
    "the identity of each process acting on behalf of a user is authenticated or verified as a prerequisite to system access; and",
    "the identity of each device accessing or connecting to the system is authenticated or verified as a prerequisite to system access.",
  ], "Authenticate or verify users, acting processes, and connecting devices before system access.", ["Authentication setting locator", "Credential procedure locator", "Device-management locator"]),
  requirement("media-disposal", "07", "MP.L1-b.1.vii", "Media Disposal", [
    "system media containing [FCI] is sanitized or destroyed before disposal; and",
    "system media containing [FCI] is sanitized before it is released for reuse.",
  ], "Sanitize or destroy FCI-containing system media before disposal or reuse.", ["Media procedure locator", "Destruction record locator", "Sanitization record locator"]),
  requirement("physical-access", "08", "PE.L1-b.1.viii", "Limit Physical Access", [
    "authorized individuals allowed physical access are identified;",
    "physical access to organizational systems is limited to authorized individuals;",
    "physical access to equipment is limited to authorized individuals; and",
    "physical access to operating environments is limited to authorized individuals.",
  ], "Identify authorized people and limit physical access to systems, equipment, and operating environments.", ["Facility-access list locator", "Physical-security procedure locator", "Badge or key register locator"]),
  requirement("physical-visitors", "09", "PE.L1-b.1.ix", "Manage Visitors & Physical Access", [
    "visitors are escorted;",
    "visitor activity is monitored;",
    "audit logs of physical access are maintained;",
    "physical access devices are identified;",
    "physical access devices are controlled; and",
    "physical access devices are managed.",
  ], "Escort and monitor visitors, retain physical-access audit logs, and manage physical-access devices.", ["Visitor-log locator", "Escort procedure locator", "Badge or key register locator"]),
  requirement("communications", "10", "SC.L1-b.1.x", "Boundary Protection", [
    "the external system boundary is defined;",
    "key internal system boundaries are defined;",
    "communications are monitored at the external system boundary;",
    "communications are monitored at key internal boundaries;",
    "communications are controlled at the external system boundary;",
    "communications are controlled at key internal boundaries;",
    "communications are protected at the external system boundary; and",
    "communications are protected at key internal boundaries.",
  ], "Define, monitor, control, and protect communications at external and key internal boundaries.", ["Boundary diagram locator", "Firewall rule locator", "Monitoring configuration locator"]),
  requirement("subnetworks", "11", "SC.L1-b.1.xi", "Public-Access System Separation", [
    "publicly accessible system components are identified; and",
    "subnetworks for publicly accessible system components are physically or logically separated from internal networks.",
  ], "Identify public components and separate them physically or logically from internal networks.", ["Public-component inventory locator", "Segmentation diagram locator", "Architecture record locator"]),
  requirement("flaw-remediation", "12", "SI.L1-b.1.xii", "Flaw Remediation", [
    "the time within which to identify system flaws is specified;",
    "system flaws are identified within the specified time frame;",
    "the time within which to report system flaws is specified;",
    "system flaws are reported within the specified time frame;",
    "the time within which to correct system flaws is specified; and",
    "system flaws are corrected within the specified time frame.",
  ], "Specify and meet time frames to identify, report, and correct system flaws.", ["Vulnerability procedure locator", "Ticketing-system locator", "Patch record locator"]),
  requirement("malicious-code", "13", "SI.L1-b.1.xiii", "Malicious Code Protection", [
    "designated locations for malicious code protection are identified; and",
    "protection from malicious code at designated locations is provided.",
  ], "Identify locations needing malicious-code protection and provide it at each location.", ["Endpoint-protection locator", "Coverage report locator", "Security procedure locator"]),
  requirement("malicious-code-updates", "14", "SI.L1-b.1.xiv", "Update Malicious Code Protection", [
    "malicious code protection mechanisms are updated when new releases are available.",
  ], "Update malicious-code protection mechanisms when new releases are available.", ["Update-setting locator", "Release-management locator", "Endpoint console locator"]),
  requirement("security-alerts", "15", "SI.L1-b.1.xv", "System & File Scanning", [
    "the frequency for malicious code scans is defined;",
    "malicious code scans are performed with the defined frequency; and",
    "real-time malicious code scans of files from external sources as files are downloaded, opened, or executed are performed.",
  ], "Define and perform periodic malicious-code scans, including real-time scanning of external-source files.", ["Scan configuration locator", "Scan report locator", "Endpoint-protection locator"]),
];

const answerSchema = z.object({
  status: z.unknown().optional(),
  objectiveStatuses: z.unknown().optional(),
  objectiveRationales: z.unknown().optional(),
  objectiveImplementations: z.unknown().optional(),
  objectiveEvidenceLocators: z.unknown().optional(),
  objectiveAssessmentMethods: z.unknown().optional(),
  objectiveAssessmentNotes: z.unknown().optional(),
  objectiveEvidenceOwners: z.unknown().optional(),
  objectiveEvidenceDates: z.unknown().optional(),
  objectiveGapStatements: z.unknown().optional(),
  objectiveCorrectiveActions: z.unknown().optional(),
  objectiveConfidence: z.unknown().optional(),
  owner: z.unknown().optional(),
  implementationSummary: z.unknown().optional(),
  systemsCovered: z.unknown().optional(),
  exceptions: z.unknown().optional(),
  evidenceRecords: z.unknown().optional(),
  evidence: z.unknown().optional(),
  evidenceDate: z.unknown().optional(),
}).passthrough();

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanStatus(value: unknown): CmmcStatus {
  return value === "met" || value === "not_met" || value === "not_applicable" ? value : "";
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function meaningfulTokens(value: string): Set<string> {
  const stop = new Set(["that", "this", "with", "from", "into", "each", "every", "system", "systems", "organization", "organizational", "identified", "defined", "provided", "performed"]);
  return new Set((value.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).filter((token) => !stop.has(token)));
}
export function resolveCmmcRetention(cmmcStatusDate: string, signedAt: Date): {
  retentionUntil: Date;
  provisional: boolean;
} {
  const statusDate = cleanText(cmmcStatusDate, 40);
  const provisional = !isIsoCalendarDate(statusDate);
  const anchor = provisional ? new Date(signedAt) : new Date(`${statusDate}T00:00:00.000Z`);
  const retentionUntil = new Date(anchor);
  retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + 6);
  return { retentionUntil, provisional };
}

function sanitizeAnswer(candidate: unknown, objectiveCount: number): CmmcControlAnswer {
  const parsed = answerSchema.safeParse(candidate);
  const value = parsed.success ? parsed.data : {};
  const rawObjectives = value.objectiveStatuses && typeof value.objectiveStatuses === "object"
    ? value.objectiveStatuses as Record<string, unknown>
    : {};
  const rawRationales = value.objectiveRationales && typeof value.objectiveRationales === "object"
    ? value.objectiveRationales as Record<string, unknown>
    : {};
  const rawMethods = cleanRecord(value.objectiveAssessmentMethods);
  const rawLocators = cleanRecord(value.objectiveEvidenceLocators);
  const rawActions = cleanRecord(value.objectiveCorrectiveActions);
  const rawConfidence = cleanRecord(value.objectiveConfidence);
  const evidenceDate = cleanText(value.evidenceDate, 40);
  return {
    status: cleanStatus(value.status),
    objectiveStatuses: Object.fromEntries(Array.from({ length: objectiveCount }, (_, index) => [
      String(index),
      cleanStatus(rawObjectives[String(index)]),
    ])),
    objectiveRationales: Object.fromEntries(Array.from({ length: objectiveCount }, (_, index) => [
      String(index),
      cleanText(rawRationales[String(index)], 500),
    ])),
    objectiveImplementations: cleanStringMap(value.objectiveImplementations, objectiveCount, 2_000),
    objectiveEvidenceLocators: Object.fromEntries(Array.from({ length: objectiveCount }, (_, index) => {
      const locators = Array.isArray(rawLocators[String(index)]) ? rawLocators[String(index)] as unknown[] : [];
      return [String(index), locators.slice(0, 10).map((locator) => cleanText(locator, 1_000)).filter(Boolean)];
    })),
    objectiveAssessmentMethods: Object.fromEntries(Array.from({ length: objectiveCount }, (_, index) => {
      const method = rawMethods[String(index)];
      return [String(index), CMMC_ASSESSMENT_METHODS.includes(method as any) ? method as CmmcAssessmentMethod : ""];
    })),
    objectiveAssessmentNotes: cleanStringMap(value.objectiveAssessmentNotes, objectiveCount, 1_000),
    objectiveEvidenceOwners: cleanStringMap(value.objectiveEvidenceOwners, objectiveCount, 200),
    objectiveEvidenceDates: cleanDateMap(value.objectiveEvidenceDates, objectiveCount),
    objectiveGapStatements: cleanStringMap(value.objectiveGapStatements, objectiveCount, 2_000),
    objectiveCorrectiveActions: Object.fromEntries(Array.from({ length: objectiveCount }, (_, index) => {
      const action = cleanRecord(rawActions[String(index)]);
      return [String(index), {
        action: cleanText(action.action, 2_000),
        owner: cleanText(action.owner, 200),
        targetDate: isIsoCalendarDate(cleanText(action.targetDate, 40)) ? cleanText(action.targetDate, 40) : "",
        completionEvidenceLocator: cleanText(action.completionEvidenceLocator, 1_000),
        reassessmentDate: isIsoCalendarDate(cleanText(action.reassessmentDate, 40)) ? cleanText(action.reassessmentDate, 40) : "",
      }];
    })),
    objectiveConfidence: Object.fromEntries(Array.from({ length: objectiveCount }, (_, index) => {
      const confidence = rawConfidence[String(index)];
      return [String(index), confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : ""];
    })),
    owner: cleanText(value.owner, 200),
    implementationSummary: cleanText(value.implementationSummary, 2_000),
    systemsCovered: cleanText(value.systemsCovered, 1_000),
    exceptions: cleanText(value.exceptions, 1_000),
    evidenceRecords: (Array.isArray(value.evidenceRecords) ? value.evidenceRecords : []).slice(0, 25).map((item) => {
      const record = cleanRecord(item);
      return {
        type: cleanText(record.type, 200),
        locator: cleanText(record.locator, 1_000),
        owner: cleanText(record.owner, 200),
        date: isIsoCalendarDate(cleanText(record.date, 40)) ? cleanText(record.date, 40) : "",
        reviewFrequency: cleanText(record.reviewFrequency, 200),
        objectiveIds: Array.isArray(record.objectiveIds)
          ? record.objectiveIds.map((id) => cleanText(id, 20)).filter((id) => /^\d+$/.test(id) && Number(id) < objectiveCount)
          : [],
      };
    }).filter((record) => record.locator),
    evidence: cleanText(value.evidence, 1_000),
    evidenceDate: isIsoCalendarDate(evidenceDate) ? evidenceDate : "",
  };
}

function legacyPhysicalControls(sourceControls: Record<string, unknown>, rawLegacyControls: unknown): Record<string, CmmcControlAnswer> | undefined {
  const legacySource = rawLegacyControls && typeof rawLegacyControls === "object" && !Array.isArray(rawLegacyControls)
    ? rawLegacyControls as Record<string, unknown>
    : {};
  const legacy: Record<string, CmmcControlAnswer> = {};
  for (const id of ["visitor-escort", "physical-logs"]) {
    const candidate = sourceControls[id] ?? legacySource[id];
    if (candidate !== undefined) legacy[id] = sanitizeAnswer(candidate, 4);
  }
  return Object.keys(legacy).length > 0 ? legacy : undefined;
}

export function emptyCmmcDraft(): CmmcDraft {
  return {
    systemDescription: "",
    scopeType: "",
    inScopeLocations: "",
    inScopeAssetCategories: [],
    assetInventoryLocator: "",
    fciFlowSummary: "",
    externalServiceProviders: "",
    assessmentStartDate: "",
    assessmentCompletionDate: "",
    assessmentParticipants: "",
    cageCodes: "",
    cmmcStatusDate: "",
    controls: Object.fromEntries(CMMC_L1_REQUIREMENTS.map((item) => [item.id, sanitizeAnswer({}, item.objectivePrompts.length)])),
    affirmations: Object.fromEntries(CMMC_AFFIRMATION_KEYS.map((key) => [key, false])),
  };
}

export function sanitizeCmmcDraft(raw: unknown): CmmcDraft {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const sourceControls = source.controls && typeof source.controls === "object" && !Array.isArray(source.controls)
    ? source.controls as Record<string, unknown>
    : {};
  const legacyControls = legacyPhysicalControls(sourceControls, source.legacyControls);
  const controls: Record<string, CmmcControlAnswer> = {};

  for (const item of CMMC_L1_REQUIREMENTS) {
    controls[item.id] = sanitizeAnswer(sourceControls[item.id], item.objectivePrompts.length);
  }

  return {
    systemDescription: cleanText(source.systemDescription, 2_000),
    scopeType: cleanText(source.scopeType, 100),
    inScopeLocations: cleanText(source.inScopeLocations, 1_000),
    inScopeAssetCategories: Array.isArray(source.inScopeAssetCategories)
      ? source.inScopeAssetCategories.map((item) => cleanText(item, 100)).filter(Boolean).slice(0, 25)
      : [],
    assetInventoryLocator: cleanText(source.assetInventoryLocator, 1_000),
    fciFlowSummary: cleanText(source.fciFlowSummary, 2_000),
    externalServiceProviders: cleanText(source.externalServiceProviders, 2_000),
    assessmentStartDate: isIsoCalendarDate(cleanText(source.assessmentStartDate, 40)) ? cleanText(source.assessmentStartDate, 40) : "",
    assessmentCompletionDate: isIsoCalendarDate(cleanText(source.assessmentCompletionDate, 40)) ? cleanText(source.assessmentCompletionDate, 40) : "",
    assessmentParticipants: cleanText(source.assessmentParticipants, 1_000),
    cageCodes: cleanText(source.cageCodes, 500),
    cmmcStatusDate: cleanText(source.cmmcStatusDate, 40),
    controls,
    affirmations: Object.fromEntries(CMMC_AFFIRMATION_KEYS.map((key) => [key, cleanRecord(source.affirmations)[key] === true])),
    ...(legacyControls ? { legacyControls } : {}),
  };
}

/**
 * The CMMC workflow intentionally stores only scope descriptions and evidence
 * locators. Reject obvious restricted material before either a draft or a
 * signed snapshot can persist it; never attempt to silently redact a customer
 * response and leave the customer believing their statement was recorded.
 */
export function cmmcProhibitedContentFields(raw: unknown): string[] {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const sourceControls = source.controls && typeof source.controls === "object" && !Array.isArray(source.controls)
    ? source.controls as Record<string, unknown>
    : {};
  const sourceLegacyControls = source.legacyControls && typeof source.legacyControls === "object" && !Array.isArray(source.legacyControls)
    ? source.legacyControls as Record<string, unknown>
    : {};
  const blocked: string[] = [];
  const inspect = (field: string, value: unknown) => {
    if (typeof value !== "string") return;
    if (value && CMMC_PROHIBITED_CONTENT_PATTERNS.some((pattern) => pattern.test(value))) blocked.push(field);
  };
  const inspectControl = (prefix: string, rawControl: unknown, objectiveCount: number) => {
    if (!rawControl || typeof rawControl !== "object" || Array.isArray(rawControl)) return;
    const control = rawControl as Record<string, unknown>;
    inspect(`${prefix}.owner`, control.owner);
    inspect(`${prefix}.evidence`, control.evidence);
    inspect(`${prefix}.implementationSummary`, control.implementationSummary);
    inspect(`${prefix}.systemsCovered`, control.systemsCovered);
    inspect(`${prefix}.exceptions`, control.exceptions);
    for (const [recordIndex, record] of (Array.isArray(control.evidenceRecords) ? control.evidenceRecords : []).entries()) {
      const evidenceRecord = cleanRecord(record);
      inspect(`${prefix}.evidenceRecords.${recordIndex}.type`, evidenceRecord.type);
      inspect(`${prefix}.evidenceRecords.${recordIndex}.locator`, evidenceRecord.locator);
      inspect(`${prefix}.evidenceRecords.${recordIndex}.owner`, evidenceRecord.owner);
      inspect(`${prefix}.evidenceRecords.${recordIndex}.reviewFrequency`, evidenceRecord.reviewFrequency);
    }
    const rationales = control.objectiveRationales && typeof control.objectiveRationales === "object" && !Array.isArray(control.objectiveRationales)
      ? control.objectiveRationales as Record<string, unknown>
      : {};
    for (let index = 0; index < objectiveCount; index++) {
      inspect(`${prefix}.objectiveRationale.${index}`, rationales[String(index)]);
      inspect(`${prefix}.objectiveImplementation.${index}`, cleanRecord(control.objectiveImplementations)[String(index)]);
      const locators = cleanRecord(control.objectiveEvidenceLocators)[String(index)];
      if (Array.isArray(locators)) locators.forEach((locator, locatorIndex) => inspect(`${prefix}.objectiveEvidenceLocator.${index}.${locatorIndex}`, locator));
      inspect(`${prefix}.objectiveAssessmentNote.${index}`, cleanRecord(control.objectiveAssessmentNotes)[String(index)]);
      inspect(`${prefix}.objectiveEvidenceOwner.${index}`, cleanRecord(control.objectiveEvidenceOwners)[String(index)]);
      inspect(`${prefix}.objectiveGapStatement.${index}`, cleanRecord(control.objectiveGapStatements)[String(index)]);
      const action = cleanRecord(cleanRecord(control.objectiveCorrectiveActions)[String(index)]);
      for (const field of ["action", "owner", "completionEvidenceLocator"] as const) {
        inspect(`${prefix}.objectiveCorrectiveAction.${index}.${field}`, action[field]);
      }
    }
  };

  inspect("systemDescription", source.systemDescription);
  for (const field of ["scopeType", "inScopeLocations", "assetInventoryLocator", "fciFlowSummary", "externalServiceProviders", "assessmentParticipants"] as const) {
    inspect(field, source[field]);
  }
  if (Array.isArray(source.inScopeAssetCategories)) source.inScopeAssetCategories.forEach((value, index) => inspect(`inScopeAssetCategories.${index}`, value));
  inspect("cageCodes", source.cageCodes);
  for (const requirement of CMMC_L1_REQUIREMENTS) {
    inspectControl(`controls.${requirement.id}`, sourceControls[requirement.id], requirement.objectivePrompts.length);
  }
  for (const id of ["visitor-escort", "physical-logs"]) {
    // Legacy fields may be supplied under either key; both can still be
    // preserved for customer reference, so both must pass the storage gate.
    inspectControl(`legacyControls.${id}`, sourceControls[id] ?? sourceLegacyControls[id], 4);
  }
  return blocked;
}

export function validateCmmcSubmission(input: CmmcSubmission): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const clean = sanitizeCmmcDraft(input.draft);
  missing.push(...cmmcProhibitedContentFields(input.draft).map((field) => `prohibitedContent.${field}`));
  if (!cleanText(input.company, 255)) missing.push("company");
  if (!cleanText(input.authorizedOfficialName, 200)) missing.push("authorizedOfficialName");
  if (!cleanText(input.authorizedOfficialTitle, 200)) missing.push("authorizedOfficialTitle");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanText(input.authorizedOfficialEmail, 320))) missing.push("authorizedOfficialEmail");
  if (!cleanText(input.typedSignature, 200)) missing.push("typedSignature");
  if (!cleanText(input.signedAt, 40)) missing.push("signedAt");
  if (!clean.systemDescription || clean.systemDescription.split(/\s+/).filter(Boolean).length < 3) missing.push("systemDescription");
  if (!clean.scopeType) missing.push("scopeType");
  if (!clean.inScopeLocations) missing.push("inScopeLocations");
  if (clean.inScopeAssetCategories.length === 0) missing.push("inScopeAssetCategories");
  if (!clean.assetInventoryLocator) missing.push("assetInventoryLocator");
  if (!clean.fciFlowSummary) missing.push("fciFlowSummary");
  if (!clean.assessmentStartDate) missing.push("assessmentStartDate");
  if (!clean.assessmentCompletionDate) missing.push("assessmentCompletionDate");
  if (!clean.assessmentParticipants) missing.push("assessmentParticipants");
  if (clean.cmmcStatusDate && !isIsoCalendarDate(clean.cmmcStatusDate)) missing.push("cmmcStatusDate");

  for (const requirement of CMMC_L1_REQUIREMENTS) {
    const control = clean.controls[requirement.id];
    if (!control.owner) missing.push(`controls.${requirement.id}.owner`);
    if (!control.implementationSummary) missing.push(`controls.${requirement.id}.implementationSummary`);
    if (!control.systemsCovered) missing.push(`controls.${requirement.id}.systemsCovered`);
    if (!control.exceptions) missing.push(`controls.${requirement.id}.exceptions`);
    if (control.evidenceRecords.length === 0) missing.push(`controls.${requirement.id}.evidenceRecords`);
    for (let index = 0; index < requirement.objectivePrompts.length; index++) {
      const status = control.objectiveStatuses[String(index)];
      if (!status) missing.push(`controls.${requirement.id}.objective.${index}`);
      if (status === "met") {
        if (!hasMeaningfulNarrative(control.objectiveImplementations[String(index)], requirement.objectivePrompts[index])) missing.push(`controls.${requirement.id}.objectiveImplementation.${index}`);
        if (control.objectiveEvidenceLocators[String(index)].length === 0 || !control.objectiveEvidenceLocators[String(index)].every(hasMeaningfulLocator)) missing.push(`controls.${requirement.id}.objectiveEvidenceLocators.${index}`);
        if (!control.objectiveAssessmentMethods[String(index)]) missing.push(`controls.${requirement.id}.objectiveAssessmentMethod.${index}`);
        if (!control.objectiveEvidenceOwners[String(index)]) missing.push(`controls.${requirement.id}.objectiveEvidenceOwner.${index}`);
        const date = control.objectiveEvidenceDates[String(index)];
        if (!date || date > new Date().toISOString().slice(0, 10)) missing.push(`controls.${requirement.id}.objectiveEvidenceDate.${index}`);
      }
      if (status === "not_applicable" && !control.objectiveRationales[String(index)]) {
        missing.push(`controls.${requirement.id}.objectiveRationale.${index}`);
      }
      if (status === "not_applicable" && !hasMeaningfulNarrative(control.objectiveRationales[String(index)])) {
        missing.push(`controls.${requirement.id}.objectiveRationale.${index}`);
      }
      if (status === "not_met") {
        if (!control.objectiveGapStatements[String(index)]) missing.push(`controls.${requirement.id}.objectiveGapStatement.${index}`);
        const action = control.objectiveCorrectiveActions[String(index)];
        for (const field of ["action", "owner", "targetDate", "completionEvidenceLocator", "reassessmentDate"] as const) {
          if (!action[field]) missing.push(`controls.${requirement.id}.objectiveCorrectiveAction.${index}.${field}`);
        }
      }
    }
    const locatorObjectives = new Map<string, number[]>();
    requirement.objectivePrompts.forEach((_, index) => {
      for (const locator of control.objectiveEvidenceLocators[String(index)]) {
        locatorObjectives.set(locator.toLowerCase(), [...(locatorObjectives.get(locator.toLowerCase()) || []), index]);
      }
    });
    for (const [locator, indexes] of locatorObjectives) {
      if (indexes.length < 2) continue;
      const mapped = control.evidenceRecords.some((record) => record.locator.toLowerCase() === locator && indexes.every((index) => record.objectiveIds.includes(String(index))));
      if (!mapped) {
        const recordIndex = control.evidenceRecords.findIndex((record) => record.locator.toLowerCase() === locator);
        indexes.forEach((index) => missing.push(`controls.${requirement.id}.objectiveEvidenceMapping.${index}.${recordIndex >= 0 ? recordIndex : "add"}`));
      }
    }
    if (calculatedCmmcRequirementResult(control, requirement) === "not_met"
      && requirement.objectivePrompts.every((_, index) => control.objectiveStatuses[String(index)] === "met")) {
      missing.push(`controls.${requirement.id}.exceptionsConflict`);
    }
  }
  for (const key of CMMC_AFFIRMATION_KEYS) if (!clean.affirmations[key]) missing.push(`affirmations.${key}`);
  return { ok: missing.length === 0, missing };
}

const CMMC_PROFILE_FIELD_LABELS: Record<string, string> = {
  company: "Company name is missing.",
  authorizedOfficialName: "Enter the Affirming Official's name.",
  authorizedOfficialTitle: "Enter the Affirming Official's title and authority.",
  authorizedOfficialEmail: "Enter a valid business email for the Affirming Official.",
  typedSignature: "Enter the Affirming Official's name as the signature.",
  signedAt: "The signature date is missing.",
  systemDescription: "Describe the FCI assessment scope in at least three words.",
  scopeType: "Select the assessment-scope type.",
  inScopeLocations: "List the locations included in the assessment.",
  inScopeAssetCategories: "List at least one in-scope asset category.",
  assetInventoryLocator: "Enter where the asset inventory can be found.",
  fciFlowSummary: "Describe how FCI is received, used, stored, and disposed.",
  assessmentStartDate: "Enter the assessment start date.",
  assessmentCompletionDate: "Enter the assessment completion date.",
  assessmentParticipants: "List the people who participated in the assessment.",
  cmmcStatusDate: "Enter the CMMC Status Date as YYYY-MM-DD, or leave it blank.",
};

export function describeCmmcValidationIssues(missing: string[]): CmmcValidationIssue[] {
  return [...new Set(missing)].map((key) => {
    const validationKey = key.startsWith("prohibitedContent.") ? key.slice("prohibitedContent.".length) : key;
    const prohibited = validationKey !== key;
    if (key.startsWith("affirmations.")) {
      return { key, sectionId: "cmmc-affirmation", targetId: `cmmc-field-${key}`, label: "Review and check this required acknowledgment." };
    }
    const match = /^controls\.([^.]+)\.(.+)$/.exec(validationKey);
    if (!match) {
      const profileField = validationKey.replace(/\.\d+$/, "");
      const targetKey = profileField === "typedSignature" || profileField === "signedAt" ? "authorizedOfficialName" : profileField;
      return {
        key,
        sectionId: profileField.startsWith("authorizedOfficial") || profileField === "typedSignature" || profileField === "signedAt" ? "cmmc-affirmation" : "cmmc-profile",
        targetId: `cmmc-field-${targetKey}`,
        label: prohibited ? "Remove sensitive or prohibited content from this profile response before saving." : CMMC_PROFILE_FIELD_LABELS[profileField] || "Complete this required assessment field.",
      };
    }
    const [, requirementId, fieldPath] = match;
    const objectiveMatch = /^(objective(?:Implementation|EvidenceLocators?|AssessmentMethod|AssessmentNote|EvidenceOwner|EvidenceDate|Rationale|GapStatement|CorrectiveAction|EvidenceMapping)|objective)\.(\d+)/.exec(fieldPath);
    const rawField = objectiveMatch?.[1] || fieldPath;
    const field = rawField === "objectiveEvidenceLocator" ? "objectiveEvidenceLocators" : rawField;
    const rawIndex = objectiveMatch?.[2];
    const correctiveField = field === "objectiveCorrectiveAction" ? fieldPath.split(".")[2] : undefined;
    const evidenceMappingTarget = field === "objectiveEvidenceMapping" ? fieldPath.split(".")[2] : undefined;
    const evidenceRecordMatch = /^evidenceRecords\.(\d+)\.([^.]+)$/.exec(fieldPath);
    const requirement = CMMC_L1_REQUIREMENTS.find((item) => item.id === requirementId);
    const objectiveIndex = rawIndex === undefined ? undefined : Number(rawIndex);
    const objectiveName = objectiveIndex === undefined
      ? ""
      : ` Objective ${objectiveIndex + 1}${requirement?.objectiveLabels[objectiveIndex] ? ` (${requirement.objectiveLabels[objectiveIndex]})` : ""}:`;
    const labels: Record<string, string> = {
      owner: " enter the accountable control owner.",
      implementationSummary: " explain how the requirement is implemented.",
      systemsCovered: " list the systems and locations covered.",
      exceptions: " state any exceptions or enter “None identified.”",
      evidenceRecords: " add at least one primary evidence record with a locator.",
      objective: " choose Met, Not met, or Not applicable.",
      objectiveImplementation: " add a specific implementation explanation of at least 12 words that addresses this objective.",
      objectiveEvidenceLocators: " add a specific, retrievable evidence locator.",
      objectiveAssessmentMethod: " select how the evidence was assessed.",
      objectiveEvidenceOwner: " name the owner of the evidence.",
      objectiveEvidenceDate: " enter a valid last-verified date that is not in the future.",
      objectiveRationale: " explain the scope facts that make this objective not applicable.",
      objectiveGapStatement: " describe the factual gap.",
      objectiveCorrectiveAction: " complete the corrective action, owner, target date, completion-evidence locator, and reassessment date.",
      objectiveEvidenceMapping: " map the shared evidence record to every objective it supports.",
      exceptionsConflict: " change the exceptions to “None identified” or correct the objective findings.",
    };
    return {
      key,
      requirementId,
      objectiveIndex,
      sectionId: objectiveIndex === undefined ? `cmmc-requirement-${requirementId}` : `cmmc-objective-${requirementId}-${objectiveIndex}`,
      targetId: objectiveIndex === undefined
        ? evidenceRecordMatch
          ? `cmmc-field-${requirementId}-evidenceRecords-${evidenceRecordMatch[1]}-${evidenceRecordMatch[2]}`
          : `cmmc-field-${requirementId}-${field === "exceptionsConflict" ? "exceptions" : field}`
        : evidenceMappingTarget
          ? evidenceMappingTarget === "add"
            ? `cmmc-field-${requirementId}-evidenceRecords`
            : `cmmc-field-${requirementId}-evidenceRecords-${evidenceMappingTarget}-objectiveIds`
          : `cmmc-field-${requirementId}-${correctiveField ? `${field}-${correctiveField}` : field}-${objectiveIndex}`,
      label: prohibited
        ? `Requirement ${requirement?.number || requirementId}${objectiveName} remove sensitive or prohibited content from this response before saving.`
        : `Requirement ${requirement?.number || requirementId}${objectiveName}${labels[field] || " complete the missing support."}`,
    };
  });
}

export function cmmcNotMetCount(draft: CmmcDraft): number {
  const clean = sanitizeCmmcDraft(draft);
  return CMMC_L1_REQUIREMENTS.reduce((total, requirement) => {
    const control = clean.controls[requirement.id];
    const objectiveNotMet = Object.values(control.objectiveStatuses).filter((status) => status === "not_met").length;
    return total + objectiveNotMet;
  }, 0);
}

export function cmmcNotApplicableCount(draft: CmmcDraft): number {
  const clean = sanitizeCmmcDraft(draft);
  return CMMC_L1_REQUIREMENTS.reduce((total, requirement) => {
    const control = clean.controls[requirement.id];
    return total + Object.values(control.objectiveStatuses).filter((status) => status === "not_applicable").length;
  }, 0);
}

export function isCmmcLevel1SelfReady(draft: CmmcDraft): boolean {
  const clean = sanitizeCmmcDraft(draft);
  return CMMC_L1_REQUIREMENTS.every((requirement) => {
    const control = clean.controls[requirement.id];
    return calculatedCmmcRequirementResult(control, requirement) === "met";
  });
}

export interface CmmcEvidenceRecord {
  type: string;
  locator: string;
  owner: string;
  date: string;
  reviewFrequency: string;
  objectiveIds: string[];
}

function noMaterialException(value: string): boolean {
  return /^none(?: identified| known| reported)?[.!]?$/i.test(value.trim());
}

function hasMeaningfulLocator(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[.!]+$/, "");
  return value.trim().length >= 12
    && !["hard drive", "computer", "we comply", "policy", "record", "evidence"].includes(normalized)
    && /(?:\/|→|>|::|\b(?:20\d{2}|q[1-4]|version|revision|ticket|record|console|register|folder|policy|procedure|inventory|report|setting|configuration)\b)/i.test(value);
}

export interface CmmcCorrectiveAction {
  action: string;
  owner: string;
  targetDate: string;
  completionEvidenceLocator: string;
  reassessmentDate: string;
}

export const CMMC_AFFIRMATION_KEYS = [
  "scopeReviewed",
  "objectivesReviewed",
  "metSupportConfirmed",
  "notApplicableRationalesConfirmed",
  "notMetNotRepresentedAsCompliant",
  "preparationOnlyUnderstood",
] as const;

export function isCmmcObjectiveSupported(control: CmmcControlAnswer, index: number, objectiveText?: string): boolean {
  const key = String(index);
  const status = control.objectiveStatuses[key];
  if (status === "not_applicable") return hasMeaningfulNarrative(control.objectiveRationales[key]);
  if (status !== "met") return false;
  return hasMeaningfulNarrative(control.objectiveImplementations[key], objectiveText)
    && control.objectiveEvidenceLocators[key].length > 0
    && control.objectiveEvidenceLocators[key].every(hasMeaningfulLocator)
    && Boolean(control.objectiveAssessmentMethods[key])
    && Boolean(control.objectiveEvidenceOwners[key])
    && Boolean(control.objectiveEvidenceDates[key])
    && control.objectiveEvidenceDates[key] <= new Date().toISOString().slice(0, 10);
}

function cleanRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasMeaningfulNarrative(value: string, objectiveText?: string): boolean {
  if (value.split(/\s+/).filter(Boolean).length < 12) return false;
  if (/\b(?:we comply|compliant with|meets? this (?:control|objective|requirement)|this (?:control|objective|requirement) is (?:met|implemented))\b/i.test(value)) return false;
  if (!objectiveText) return true;
  const expected = meaningfulTokens(objectiveText);
  const actual = meaningfulTokens(value);
  return [...expected].some((token) => actual.has(token));
}

function cleanStringMap(value: unknown, count: number, maxLength: number): Record<string, string> {
  const source = cleanRecord(value);
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [String(index), cleanText(source[String(index)], maxLength)]));
}

export function calculatedCmmcRequirementResult(control: CmmcControlAnswer, requirement: CmmcRequirement): "met" | "not_met" | "incomplete" {
  if (requirement.objectivePrompts.some((_, index) => !control.objectiveStatuses[String(index)])) return "incomplete";
  if (!noMaterialException(control.exceptions)) return "not_met";
  return requirement.objectivePrompts.every((prompt, index) => isCmmcObjectiveSupported(control, index, prompt)) ? "met" : "not_met";
}

function cleanDateMap(value: unknown, count: number): Record<string, string> {
  const source = cleanRecord(value);
  return Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const date = cleanText(source[String(index)], 40);
    return [String(index), isIsoCalendarDate(date) ? date : ""];
  }));
}
