import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { tenants } from "../schema";

export const commercialResearchOpportunities = pgTable("commercial_research_opportunities", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  originType: varchar("origin_type", { length: 40 }).notNull(),
  originRef: text("origin_ref"),
  buyer: text("buyer").notNull(),
  painfulJob: text("painful_job").notNull(),
  offerHypothesis: text("offer_hypothesis").notNull(),
  evidenceSummary: text("evidence_summary").notNull(),
  evidenceConfidence: varchar("evidence_confidence", { length: 16 }).notNull().default("low"),
  evidenceState: varchar("evidence_state", { length: 24 }).notNull().default("unverified"),
  assumptions: jsonb("assumptions").notNull().default(sql`'[]'::jsonb`),
  unknowns: jsonb("unknowns").notNull().default(sql`'[]'::jsonb`),
  risks: jsonb("risks").notNull().default(sql`'[]'::jsonb`),
  killCriterion: text("kill_criterion").notNull(),
  maturity: varchar("maturity", { length: 32 }).notNull().default("concept-ready"),
  lifecycleStatus: varchar("lifecycle_status", { length: 24 }).notNull().default("active"),
  nextTest: jsonb("next_test").notNull(),
  scoreInputs: jsonb("score_inputs").notNull(),
  scoreResult: jsonb("score_result").notNull(),
  validationEvidence: jsonb("validation_evidence"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("idx_commercial_research_opportunities_tenant").on(t.tenantId),
  tenantUpdatedIdx: index("idx_commercial_research_opportunities_tenant_updated").on(t.tenantId, t.updatedAt),
  tenantStatusIdx: index("idx_commercial_research_opportunities_tenant_status").on(t.tenantId, t.lifecycleStatus),
  tenantMaturityIdx: index("idx_commercial_research_opportunities_tenant_maturity").on(t.tenantId, t.maturity),
  tenantIdempotencyUnique: uniqueIndex("uq_commercial_research_opportunities_tenant_idempotency")
    .on(t.tenantId, t.idempotencyKey),
  evidenceConfidenceCheck: check("chk_commercial_research_evidence_confidence",
    sql`${t.evidenceConfidence} IN ('low','medium','high')`),
  evidenceStateCheck: check("chk_commercial_research_evidence_state",
    sql`${t.evidenceState} IN ('unverified','incomplete','mixed','supported','contradictory','verified')`),
  maturityCheck: check("chk_commercial_research_maturity",
    sql`${t.maturity} IN ('concept-ready','sales-ready','pilot-ready','fulfillment-ready','revenue-validated')`),
  lifecycleStatusCheck: check("chk_commercial_research_lifecycle_status",
    sql`${t.lifecycleStatus} IN ('active','parked','rejected','archived')`),
  jsonShapeCheck: check("chk_commercial_research_json_shapes", sql`
    jsonb_typeof(${t.assumptions}) = 'array'
    AND jsonb_typeof(${t.unknowns}) = 'array'
    AND jsonb_typeof(${t.risks}) = 'array'
    AND jsonb_typeof(${t.nextTest}) = 'object'
    AND jsonb_typeof(${t.scoreInputs}) = 'object'
    AND jsonb_typeof(${t.scoreResult}) = 'object'
    AND (${t.validationEvidence} IS NULL OR jsonb_typeof(${t.validationEvidence}) = 'object')
  `),
  listItemsCheck: check("chk_commercial_research_list_items", sql`
    jsonb_array_length(${t.assumptions}) <= 20
    AND jsonb_array_length(${t.unknowns}) <= 20
    AND jsonb_array_length(${t.risks}) <= 20
    AND NOT jsonb_path_exists(${t.assumptions}, '$[*] ? (@.type() != "string" || @ like_regex "^[[:space:]]*$" || @ like_regex "^.{255}.{246}" flag "s")')
    AND NOT jsonb_path_exists(${t.unknowns}, '$[*] ? (@.type() != "string" || @ like_regex "^[[:space:]]*$" || @ like_regex "^.{255}.{246}" flag "s")')
    AND NOT jsonb_path_exists(${t.risks}, '$[*] ? (@.type() != "string" || @ like_regex "^[[:space:]]*$" || @ like_regex "^.{255}.{246}" flag "s")')
  `),
  nextTestCheck: check("chk_commercial_research_next_test", sql`
    (
      ${t.nextTest} ?& ARRAY['type','description','successCriterion']
    AND ${t.nextTest}->>'type' IN ('buyer_interview','manual_assessment','landing_page','prototype','paid_pilot','other')
    AND NULLIF(BTRIM(${t.nextTest}->>'description'), '') IS NOT NULL
    AND NULLIF(BTRIM(${t.nextTest}->>'successCriterion'), '') IS NOT NULL
    ) IS TRUE
  `),
  scoreInputKeysCheck: check("chk_commercial_research_score_input_keys", sql`
    ${t.scoreInputs} ?& ARRAY[
      'painUrgency','buyerAccess','willingnessToPay','visionClawAdvantage',
      'evidenceStrength','speedToFirstSale','repeatability','deliveryConfidence',
      'buildCost','fulfillmentCost','legalSafetyRisk','integrationDependence','supportBurden'
    ]
  `),
  scoreInputsCheck: check("chk_commercial_research_score_inputs", sql`
    jsonb_typeof(${t.scoreInputs}->'painUrgency') = 'number'
    AND (${t.scoreInputs}->>'painUrgency')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'painUrgency')::numeric, 1) = 0
    AND jsonb_typeof(${t.scoreInputs}->'buyerAccess') = 'number'
    AND (${t.scoreInputs}->>'buyerAccess')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'buyerAccess')::numeric, 1) = 0
    AND jsonb_typeof(${t.scoreInputs}->'willingnessToPay') = 'number'
    AND (${t.scoreInputs}->>'willingnessToPay')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'willingnessToPay')::numeric, 1) = 0
    AND jsonb_typeof(${t.scoreInputs}->'visionClawAdvantage') = 'number'
    AND (${t.scoreInputs}->>'visionClawAdvantage')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'visionClawAdvantage')::numeric, 1) = 0
    AND jsonb_typeof(${t.scoreInputs}->'evidenceStrength') = 'number'
    AND (${t.scoreInputs}->>'evidenceStrength')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'evidenceStrength')::numeric, 1) = 0
    AND jsonb_typeof(${t.scoreInputs}->'speedToFirstSale') = 'number'
    AND (${t.scoreInputs}->>'speedToFirstSale')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'speedToFirstSale')::numeric, 1) = 0
    AND jsonb_typeof(${t.scoreInputs}->'repeatability') = 'number'
    AND (${t.scoreInputs}->>'repeatability')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'repeatability')::numeric, 1) = 0
    AND jsonb_typeof(${t.scoreInputs}->'deliveryConfidence') = 'number'
    AND (${t.scoreInputs}->>'deliveryConfidence')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'deliveryConfidence')::numeric, 1) = 0
    AND jsonb_typeof(${t.scoreInputs}->'buildCost') = 'number'
    AND (${t.scoreInputs}->>'buildCost')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'buildCost')::numeric, 1) = 0
    AND jsonb_typeof(${t.scoreInputs}->'fulfillmentCost') = 'number'
    AND (${t.scoreInputs}->>'fulfillmentCost')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'fulfillmentCost')::numeric, 1) = 0
    AND jsonb_typeof(${t.scoreInputs}->'legalSafetyRisk') = 'number'
    AND (${t.scoreInputs}->>'legalSafetyRisk')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'legalSafetyRisk')::numeric, 1) = 0
    AND jsonb_typeof(${t.scoreInputs}->'integrationDependence') = 'number'
    AND (${t.scoreInputs}->>'integrationDependence')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'integrationDependence')::numeric, 1) = 0
    AND jsonb_typeof(${t.scoreInputs}->'supportBurden') = 'number'
    AND (${t.scoreInputs}->>'supportBurden')::numeric BETWEEN 0 AND 5
    AND MOD((${t.scoreInputs}->>'supportBurden')::numeric, 1) = 0
  `),
  scoreResultKeysCheck: check("chk_commercial_research_score_result_keys", sql`
    ${t.scoreResult} ?& ARRAY[
      'rubricVersion','positiveTotal','riskTotal','opportunityScore','maxPositive','maxRisk'
    ]
  `),
  scoreResultValueTypesCheck: check("chk_commercial_research_score_result_value_types", sql`
    (
      jsonb_typeof(${t.scoreResult}->'rubricVersion') = 'string'
      AND jsonb_typeof(${t.scoreResult}->'positiveTotal') = 'number'
      AND jsonb_typeof(${t.scoreResult}->'riskTotal') = 'number'
      AND jsonb_typeof(${t.scoreResult}->'opportunityScore') = 'number'
      AND jsonb_typeof(${t.scoreResult}->'maxPositive') = 'number'
      AND jsonb_typeof(${t.scoreResult}->'maxRisk') = 'number'
    ) IS TRUE
  `),
  scoreResultCheck: check("chk_commercial_research_score_result", sql`
    ${t.scoreResult}->>'rubricVersion' = 'commercial-opportunity-v1'
    AND jsonb_typeof(${t.scoreResult}->'positiveTotal') = 'number'
    AND jsonb_typeof(${t.scoreResult}->'riskTotal') = 'number'
    AND jsonb_typeof(${t.scoreResult}->'opportunityScore') = 'number'
    AND (${t.scoreResult}->>'maxPositive')::numeric = 40
    AND (${t.scoreResult}->>'maxRisk')::numeric = 25
    AND (${t.scoreResult}->>'positiveTotal')::numeric =
      (${t.scoreInputs}->>'painUrgency')::numeric
      + (${t.scoreInputs}->>'buyerAccess')::numeric
      + (${t.scoreInputs}->>'willingnessToPay')::numeric
      + (${t.scoreInputs}->>'visionClawAdvantage')::numeric
      + (${t.scoreInputs}->>'evidenceStrength')::numeric
      + (${t.scoreInputs}->>'speedToFirstSale')::numeric
      + (${t.scoreInputs}->>'repeatability')::numeric
      + (${t.scoreInputs}->>'deliveryConfidence')::numeric
    AND (${t.scoreResult}->>'riskTotal')::numeric =
      (${t.scoreInputs}->>'buildCost')::numeric
      + (${t.scoreInputs}->>'fulfillmentCost')::numeric
      + (${t.scoreInputs}->>'legalSafetyRisk')::numeric
      + (${t.scoreInputs}->>'integrationDependence')::numeric
      + (${t.scoreInputs}->>'supportBurden')::numeric
    AND (${t.scoreResult}->>'opportunityScore')::numeric = GREATEST(0, LEAST(100, ROUND(
      ((${t.scoreResult}->>'positiveTotal')::numeric / 40) * 100
      - ((${t.scoreResult}->>'riskTotal')::numeric / 25) * 50
    )))
  `),
  validationEvidenceCheck: check("chk_commercial_research_validation_evidence", sql`
    (
      ${t.validationEvidence} IS NULL OR (
        ${t.validationEvidence} ?& ARRAY['type','reference','observedAt']
        AND jsonb_typeof(${t.validationEvidence}->'type') = 'string'
        AND jsonb_typeof(${t.validationEvidence}->'reference') = 'string'
        AND jsonb_typeof(${t.validationEvidence}->'observedAt') = 'string'
        AND ${t.validationEvidence}->>'type' IN ('payment','signed_pilot','buyer_commitment')
        AND NULLIF(BTRIM(${t.validationEvidence}->>'reference'), '') IS NOT NULL
        AND ${t.validationEvidence}->>'observedAt' ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$'
      )
    ) IS TRUE
  `),
  revenueValidationCheck: check("chk_commercial_research_revenue_validation", sql`
    ${t.maturity} <> 'revenue-validated'
    OR (${t.evidenceState} = 'verified' AND ${t.validationEvidence} IS NOT NULL)
  `),
}));

export const insertCommercialResearchOpportunitySchema = createInsertSchema(commercialResearchOpportunities)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type CommercialResearchOpportunity = typeof commercialResearchOpportunities.$inferSelect;
export type InsertCommercialResearchOpportunity = z.infer<typeof insertCommercialResearchOpportunitySchema>;