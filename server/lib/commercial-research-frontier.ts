import { z } from "zod";

export const COMMERCIAL_OPPORTUNITY_RUBRIC_VERSION = "commercial-opportunity-v1";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const boundedList = z.array(boundedText(500)).max(20);
const score = z.number().int().min(0).max(5);

export const commercialOpportunityScoreInputsSchema = z.object({
  painUrgency: score,
  buyerAccess: score,
  willingnessToPay: score,
  visionClawAdvantage: score,
  evidenceStrength: score,
  speedToFirstSale: score,
  repeatability: score,
  deliveryConfidence: score,
  buildCost: score,
  fulfillmentCost: score,
  legalSafetyRisk: score,
  integrationDependence: score,
  supportBurden: score,
}).strict();

export type CommercialOpportunityScoreInputs = z.infer<typeof commercialOpportunityScoreInputsSchema>;

export function calculateCommercialOpportunityScore(input: CommercialOpportunityScoreInputs) {
  const parsed = commercialOpportunityScoreInputsSchema.parse(input);
  const positiveTotal = parsed.painUrgency + parsed.buyerAccess + parsed.willingnessToPay
    + parsed.visionClawAdvantage + parsed.evidenceStrength + parsed.speedToFirstSale
    + parsed.repeatability + parsed.deliveryConfidence;
  const riskTotal = parsed.buildCost + parsed.fulfillmentCost + parsed.legalSafetyRisk
    + parsed.integrationDependence + parsed.supportBurden;
  const opportunityScore = Math.max(0, Math.min(100,
    Math.round((positiveTotal / 40) * 100 - (riskTotal / 25) * 50),
  ));
  return {
    rubricVersion: COMMERCIAL_OPPORTUNITY_RUBRIC_VERSION,
    positiveTotal,
    riskTotal,
    opportunityScore,
    maxPositive: 40,
    maxRisk: 25,
  };
}

export const commercialOpportunityValidationEvidenceSchema = z.object({
  type: z.enum(["payment", "signed_pilot", "buyer_commitment"]),
  reference: boundedText(300),
  observedAt: z.string().datetime(),
}).strict();

const nextTestSchema = z.object({
  type: z.enum(["buyer_interview", "manual_assessment", "landing_page", "prototype", "paid_pilot", "other"]),
  description: boundedText(1000),
  successCriterion: boundedText(1000),
}).strict();

const originTypeSchema = z.enum([
  "external_report",
  "market_change",
  "customer_pain",
  "platform_capability",
  "internal_idea",
  "existing_research",
]);
const evidenceConfidenceSchema = z.enum(["low", "medium", "high"]);
const evidenceStateSchema = z.enum(["unverified", "incomplete", "mixed", "supported", "contradictory", "verified"]);
const maturitySchema = z.enum(["concept-ready", "sales-ready", "pilot-ready", "fulfillment-ready", "revenue-validated"]);
const lifecycleStatusSchema = z.enum(["active", "parked", "rejected", "archived"]);

const createShape = {
  idempotencyKey: z.string().trim().min(3).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  title: boundedText(180),
  originType: originTypeSchema,
  originRef: z.string().trim().max(500).nullable().optional(),
  buyer: boundedText(1000),
  painfulJob: boundedText(2000),
  offerHypothesis: boundedText(2000),
  evidenceSummary: boundedText(4000),
  evidenceConfidence: evidenceConfidenceSchema,
  evidenceState: evidenceStateSchema,
  assumptions: boundedList,
  unknowns: boundedList,
  risks: boundedList,
  killCriterion: boundedText(2000),
  maturity: maturitySchema,
  lifecycleStatus: lifecycleStatusSchema,
  nextTest: nextTestSchema,
  scoreInputs: commercialOpportunityScoreInputsSchema,
  validationEvidence: commercialOpportunityValidationEvidenceSchema.nullable().optional(),
};

function requireRevenueEvidence(value: {
  maturity?: string;
  evidenceState?: string;
  validationEvidence?: unknown;
}, ctx: z.RefinementCtx) {
  if (value.maturity !== "revenue-validated") return;
  if (value.evidenceState !== "verified" || !value.validationEvidence) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maturity"],
      message: "Revenue validation requires verified evidence and an authoritative reference",
    });
  }
}

export const commercialOpportunityCreateSchema = z.object(createShape).strict()
  .superRefine(requireRevenueEvidence);

export const commercialOpportunityPatchSchema = z.object({
  title: createShape.title.optional(),
  originType: createShape.originType.optional(),
  originRef: createShape.originRef,
  buyer: createShape.buyer.optional(),
  painfulJob: createShape.painfulJob.optional(),
  offerHypothesis: createShape.offerHypothesis.optional(),
  evidenceSummary: createShape.evidenceSummary.optional(),
  evidenceConfidence: createShape.evidenceConfidence.optional(),
  evidenceState: createShape.evidenceState.optional(),
  assumptions: createShape.assumptions.optional(),
  unknowns: createShape.unknowns.optional(),
  risks: createShape.risks.optional(),
  killCriterion: createShape.killCriterion.optional(),
  maturity: createShape.maturity.optional(),
  lifecycleStatus: createShape.lifecycleStatus.optional(),
  nextTest: createShape.nextTest.optional(),
  scoreInputs: createShape.scoreInputs.optional(),
  validationEvidence: createShape.validationEvidence,
}).strict().refine(value => Object.keys(value).length > 0, { message: "At least one field is required" })
  .superRefine(requireRevenueEvidence);

export type CommercialOpportunityPatch = z.infer<typeof commercialOpportunityPatchSchema>;

export const commercialOpportunityListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(120).optional(),
  maturity: maturitySchema.optional(),
  status: lifecycleStatusSchema.optional(),
}).strict();

type CreatePayload = z.infer<typeof commercialOpportunityCreateSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameCommercialOpportunityPayload(existing: Record<string, unknown>, requested: CreatePayload): boolean {
  const semanticExisting = Object.fromEntries(Object.keys(createShape).map(key => [key, existing[key] ?? null]));
  const semanticRequested = Object.fromEntries(Object.keys(createShape).map(key => [key, requested[key as keyof CreatePayload] ?? null]));
  return canonical(semanticExisting) === canonical(semanticRequested);
}

export function mergeCommercialOpportunityPatch(
  current: Record<string, unknown>,
  patch: CommercialOpportunityPatch,
) {
  return commercialOpportunityCreateSchema.safeParse({
    idempotencyKey: current.idempotencyKey,
    title: current.title,
    originType: current.originType,
    originRef: current.originRef,
    buyer: current.buyer,
    painfulJob: current.painfulJob,
    offerHypothesis: current.offerHypothesis,
    evidenceSummary: current.evidenceSummary,
    evidenceConfidence: current.evidenceConfidence,
    evidenceState: current.evidenceState,
    assumptions: current.assumptions,
    unknowns: current.unknowns,
    risks: current.risks,
    killCriterion: current.killCriterion,
    maturity: current.maturity,
    lifecycleStatus: current.lifecycleStatus,
    nextTest: current.nextTest,
    scoreInputs: current.scoreInputs,
    validationEvidence: current.validationEvidence,
    ...patch,
  });
}