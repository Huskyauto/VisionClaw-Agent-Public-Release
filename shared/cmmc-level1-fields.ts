import { z } from "zod";

export const CMMC_L1_CATALOG_VERSION = "cmmc-l1-fci-2026-08-v2.13-objectives-na";
export const CMMC_L1_REVIEW_DATE = "August 25, 2026";
export const CMMC_L1_OBJECTIVE_COUNT = 59;
export const CMMC_L1_DISCLAIMER =
  "Customer-prepared Level 1 self-assessment documentation only. The customer and Affirming Official are solely responsible for the truth, completeness, and currency of the statements in this packet. No third party has assessed, certified, verified, or endorsed those statements. This packet is not a CMMC certification, C3PAO assessment, legal opinion, or SPRS submission.";
export const CMMC_L1_SELF_CERTIFICATION_TEXT =
  "I acknowledge that I reviewed the responses in this CMMC Level 1 self-assessment preparation questionnaire and, to the best of my knowledge, they are complete and truthful as of the signed date. I understand that the organization must implement and maintain every applicable Level 1 requirement in the stated assessment scope before it can represent a Final Level 1 (Self) result. I also understand that this customer-prepared packet does not replace the Affirming Official's review and affirmation in SPRS; it is not a CMMC certification, C3PAO assessment, SPRS submission, legal opinion, or notary service.";
export const CMMC_L1_SCOPE_GUIDANCE =
  "Describe the people, technologies, facilities, and external service providers that process, store, or transmit FCI for this assessment. Use plain-language names and evidence locators only; do not enter FCI, CUI, credentials, screenshots, logs, diagrams, or evidence contents.";
export const CMMC_L1_SOURCE_CITATIONS = [
  "FAR 52.204-21, Basic Safeguarding of Covered Contractor Information Systems",
  "32 CFR 170.15, Level 1 self-assessment and SPRS result fields",
  "32 CFR 170.19 and 170.22, CMMC assessment scope and affirmation",
  "CMMC Assessment Guide – Level 1, v2.13 (September 2024)",
  "CMMC Assessment Scope – Level 1, v2.13 (September 2024)",
] as const;

export type CmmcStatus = "met" | "not_met" | "not_applicable" | "";

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
  status: CmmcStatus;
  objectiveStatuses: Record<string, CmmcStatus>;
  objectiveRationales: Record<string, string>;
  owner: string;
  evidence: string;
  evidenceDate: string;
}

export interface CmmcDraft {
  systemDescription: string;
  cageCodes: string;
  cmmcStatusDate: string;
  controls: Record<string, CmmcControlAnswer>;
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

const CMMC_PROHIBITED_CONTENT_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/i,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|passwd|private[_ -]?key)\s*[:=]\s*\S{4,}/i,
  /\b(?:authorization|cookie|set-cookie)\s*:\s*(?:bearer\s+)?\S{8,}/i,
  /\b(?:CUI|controlled unclassified information|for official use only)\b/i,
  /\b(?:FCI|federal contract information)\s+(?:content|data|document|text)\b/i,
  /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\S+\s+HTTP\/1\.[01]\b/i,
  /\bat\s+\S+\s+\([^()\n]+:\d+:\d+\)/,
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
    objectiveGuidance: objectivePrompts.map(() => "Explain which in-scope people, systems, facilities, or providers this objective covers and provide a locator-only reference to dated supporting evidence."),
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
  owner: z.unknown().optional(),
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
    owner: cleanText(value.owner, 200),
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
    cageCodes: "",
    cmmcStatusDate: "",
    controls: Object.fromEntries(CMMC_L1_REQUIREMENTS.map((item) => [item.id, sanitizeAnswer({}, item.objectivePrompts.length)])),
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
    cageCodes: cleanText(source.cageCodes, 500),
    cmmcStatusDate: cleanText(source.cmmcStatusDate, 40),
    controls,
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
    const rationales = control.objectiveRationales && typeof control.objectiveRationales === "object" && !Array.isArray(control.objectiveRationales)
      ? control.objectiveRationales as Record<string, unknown>
      : {};
    for (let index = 0; index < objectiveCount; index++) {
      inspect(`${prefix}.objectiveRationale.${index}`, rationales[String(index)]);
    }
  };

  inspect("systemDescription", source.systemDescription);
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
  if (clean.cmmcStatusDate && !isIsoCalendarDate(clean.cmmcStatusDate)) missing.push("cmmcStatusDate");

  for (const requirement of CMMC_L1_REQUIREMENTS) {
    const control = clean.controls[requirement.id];
    if (control.status !== "met" && control.status !== "not_met") missing.push(`controls.${requirement.id}.status`);
    for (let index = 0; index < requirement.objectivePrompts.length; index++) {
      const status = control.objectiveStatuses[String(index)];
      if (!status) missing.push(`controls.${requirement.id}.objective.${index}`);
      if (status === "not_applicable" && !control.objectiveRationales[String(index)]) {
        missing.push(`controls.${requirement.id}.objectiveRationale.${index}`);
      }
    }
  }
  return { ok: missing.length === 0, missing };
}

export function cmmcNotMetCount(draft: CmmcDraft): number {
  const clean = sanitizeCmmcDraft(draft);
  return CMMC_L1_REQUIREMENTS.reduce((total, requirement) => {
    const control = clean.controls[requirement.id];
    const objectiveNotMet = Object.values(control.objectiveStatuses).filter((status) => status === "not_met").length;
    return total + (control.status === "not_met" ? 1 : 0) + objectiveNotMet;
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
    return control.status === "met" && requirement.objectivePrompts.every((_, index) => {
      const status = control.objectiveStatuses[String(index)];
      return status === "met" || (status === "not_applicable" && Boolean(control.objectiveRationales[String(index)]));
    });
  });
}