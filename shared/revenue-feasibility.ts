export const SMART_LEADS_CORPUS_VERSION = "smart-leads-synthetic-v1";
export const REFERENCE_RULES_VERSION = "Reference RULES v1 (deterministic, not AI)";

export const TRIAGE_LABELS = [
  "quote",
  "booking",
  "dispatch",
  "escalate",
  "spam",
  "human_review",
  "no_action",
] as const;

export type TriageLabel = (typeof TRIAGE_LABELS)[number];

export interface SyntheticTriageCase {
  id: string;
  corpusVersion: string;
  message: string;
  expectedLabels: readonly TriageLabel[];
  authoring: "Fixed synthetic test fixture";
  emergency?: {
    kind: "gas-smell" | "carbon-monoxide" | "electrical-hazard";
    authoring: "Fixed synthetic hazard scenario";
  };
}

export const SYNTHETIC_COMPANY = {
  name: "Cedarloop Mechanical — Synthetic Demo Company",
  website: null,
  email: null,
  phone: null,
  profile: {
    trade: "Residential and light-commercial HVAC",
    staffing: "Fictional 8-person team: one dispatcher and seven field technicians.",
    serviceArea: "Fictional Exampleville and nearby imaginary neighborhoods; no real geography is represented.",
    operations: "Scenario hours are weekdays, 7 a.m.–6 p.m.; after-hours coverage and dispatch capacity are unknown.",
    offerContext: "Illustrative repairs, replacement estimates, seasonal tune-ups, and planned maintenance.",
  },
  facts: [
    "Source: fixed synthetic profile fixture; the trade, team, service area, operating hours, and offer above are invented scenario attributes.",
    `Source: ${SMART_LEADS_CORPUS_VERSION}; the message corpus is a fixed synthetic test fixture, not company correspondence.`,
    "No live company research, actual staffing record, actual service address, or contact identity is included.",
  ],
  operatingSignals: [
    {
      source: SMART_LEADS_CORPUS_VERSION,
      signal: "Scenario coverage includes estimate, booking, dispatch, escalation, spam, acknowledgment, and ambiguous-message patterns.",
      limit: "These are authored test categories only; they do not establish Cedarloop activity, message volume, demand, staffing capacity, or outcomes.",
    },
    {
      source: "Fixed fictional profile fixture",
      signal: "The offer scenario spans repair, replacement estimates, and planned maintenance.",
      limit: "No price list, response SLA, emergency policy, customer history, order, or fulfillment record is provided.",
    },
  ],
  hypotheses: [
    "Distinct quote and booking routes might reduce operator ambiguity; there is no measured conversion or handling evidence.",
    "A dispatcher-reviewed emergency path might help staff distinguish urgent messages; no live safety policy or capacity is verified.",
    "A fixed offer covering repair and maintenance could be relevant to contractors; no buyer demand or willingness to pay is evidenced.",
  ],
  fitScore: "2/5 illustrative scenario fit",
  fitRubric: [
    { points: 1, criterion: "Distinct quote and booking intents", rationale: "Both appear as separate synthetic cases." },
    { points: 1, criterion: "Triage variety", rationale: "The fixed corpus includes dispatch, escalation, ambiguity, and hazard scenarios." },
    { points: 0, criterion: "Verified live demand or message volume", rationale: "No live business evidence; not established." },
    { points: 0, criterion: "Verified staff capacity or safety procedure", rationale: "Fictional profile only; unknown." },
    { points: 0, criterion: "Checkout, order, payment, or paid fulfillment evidence", rationale: "Not checked and not established." },
  ],
  fitScoreNote: "Illustrative rubric total for synthetic scenario coverage only; not verified and not a real-company fit score.",
  disqualifiers: [
    "Not an actual contractor, qualified lead, prospect record, or paid-pipeline opportunity.",
    "No verified dispatch capacity, after-hours coverage, service policy, response-time commitment, or safety procedure.",
    "No consent, customer identity, source freshness, market demand, checkout, order, or fulfillment evidence.",
    "Do not use this fixture to launch a real pilot, dispatch work, contact anyone, or approve delivery.",
  ],
  reviewQuestions: [
    "Would a real dispatcher keep quote and booking intents separate, or need different routing rules?",
    "Who owns emergency acknowledgment, escalation, and any safety instructions under the contractor's approved policy?",
    "What documented hours, coverage, service boundaries, and capacity would need verification before testing?",
    "What consent, privacy, QA, and human-review controls would be required for real messages?",
    "Which real outcomes and review effort would need to be measured before any commercial claim?",
  ],
  qaChecklist: [
    "Source: synthetic fixture only; no external company facts or contacts.",
    "Freshness: unknown; no live research was performed.",
    "QA: review effort is not measured.",
    "Checkout and orders are not checked; demand is not checked.",
    "Reference labels are an unvalidated draft rubric awaiting dispatcher review; no human approval is claimed.",
    "This is a dossier-format demonstration, not an order, research deliverable, or paid pipeline.",
  ],
} as const;

const makeCase = (
  id: number,
  message: string,
  expectedLabels: readonly TriageLabel[],
  emergency?: SyntheticTriageCase["emergency"],
): SyntheticTriageCase => Object.freeze({
  id: `SL-${String(id).padStart(3, "0")}`,
  corpusVersion: SMART_LEADS_CORPUS_VERSION,
  message,
  expectedLabels: Object.freeze([...expectedLabels]),
  authoring: "Fixed synthetic test fixture",
  ...(emergency ? {
    emergency: Object.freeze({
      ...emergency,
      authoring: "Fixed synthetic hazard scenario" as const,
    }),
  } : {}),
});

export const SMART_LEADS_CORPUS: readonly SyntheticTriageCase[] = Object.freeze([
  makeCase(1, "Could you quote a replacement heat pump and schedule a visit next week?", ["quote", "booking"]),
  makeCase(2, "The furnace stopped overnight and the house is getting cold. Can someone come today?", ["dispatch", "booking"]),
  makeCase(3, "Please send an estimate for a seasonal tune-up; no rush.", ["quote"]),
  makeCase(4, "I want to book a technician for Tuesday afternoon.", ["booking"]),
  makeCase(5, "The thermostat is blank and the system will not start. Please send help.", ["dispatch"]),
  makeCase(6, "Do you service rooftop units for a small office? I need a price range.", ["quote", "human_review"]),
  makeCase(7, "Can you move my appointment from Friday to Monday?", ["booking"]),
  makeCase(8, "There is water coming from the indoor unit and it is spreading.", ["dispatch", "escalate"]),
  makeCase(9, "I am comparing options for a new air conditioner. Could I get a written quote?", ["quote"]),
  makeCase(10, "A technician was here yesterday and the same problem returned. I need a manager to call.", ["escalate", "human_review"]),
  makeCase(11, "The CO Company account needs an annual equipment estimate for its office.", ["quote"]),
  makeCase(12, "The carbon monoxide alarm is sounding near the furnace. What should I do?", ["dispatch", "escalate"], {
    kind: "carbon-monoxide",
    authoring: "Fixed synthetic hazard scenario",
  }),
  makeCase(13, "I smell gas near the furnace right now.", ["dispatch", "escalate"], {
    kind: "gas-smell",
    authoring: "Fixed synthetic hazard scenario",
  }),
  makeCase(14, "There are sparks at the service panel beside the heating equipment.", ["dispatch", "escalate"], {
    kind: "electrical-hazard",
    authoring: "Fixed synthetic hazard scenario",
  }),
  makeCase(15, "Can you explain whether a repair or replacement makes more sense? I am unsure.", ["human_review"]),
  makeCase(16, "We need an HVAC maintenance bid for a new commercial property.", ["quote"]),
  makeCase(17, "Please cancel tomorrow's service booking; the issue is resolved.", ["booking"]),
  makeCase(18, "Your invoice seems wrong. Please have someone review the charge before I pay.", ["escalate", "human_review"]),
  makeCase(19, "The cooling stopped and the building is occupied. Is same-day dispatch available?", ["dispatch", "booking"]),
  makeCase(20, "This is an automated message confirming receipt of your service request.", ["no_action"]),
  makeCase(21, "We cannot tell if the noise is from the furnace or the vent. Could somebody advise?", ["human_review"]),
  makeCase(22, "A tenant says one room is not heating. Please arrange a diagnostic visit.", ["dispatch", "booking"]),
  makeCase(23, "Limited-time backlink packages and search ranking services. Reply to learn more.", ["spam"]),
  makeCase(24, "Thanks, we received the estimate and will discuss it internally. No appointment yet.", ["no_action"]),
]);

export type TriageFixtureView = Pick<SyntheticTriageCase, "id" | "message" | "authoring"> &
  Partial<Pick<SyntheticTriageCase, "emergency" | "expectedLabels">>;

export function getTriageFixtureView(id: string, revealEvaluationDetails = false): TriageFixtureView {
  const item = SMART_LEADS_CORPUS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown synthetic fixture id: ${id}.`);
  const view: TriageFixtureView = {
    id: item.id,
    message: item.message,
    authoring: item.authoring,
  };
  return revealEvaluationDetails
    ? { ...view, ...(item.emergency ? { emergency: item.emergency } : {}), expectedLabels: item.expectedLabels }
    : view;
}

export type PredictionRow = { id: string; labels: readonly TriageLabel[] };

export interface ErrorDetail {
  code: "malformed_prediction" | "unknown_id" | "duplicate_id" | "missing_id" | "invalid_label";
  id?: string;
  message: string;
}

export interface LabelMetrics {
  TP: number;
  FP: number;
  FN: number;
  precision: number | null;
  recall: number | null;
  tpIds: string[];
  fpIds: string[];
  fnIds: string[];
}

export interface TriageEvaluation {
  ok: true;
  coverage: { predicted: number; total: number };
  metrics: Record<TriageLabel, LabelMetrics>;
  dispatchReviewCounts: { expected: number; predicted: number };
  safetyHardFail: boolean;
  emergencyMisses: Array<{ id: string; kind: NonNullable<SyntheticTriageCase["emergency"]>["kind"] }>;
  failedIds: string[];
  reviewBurdenInstruction: string;
  disclaimer: string;
}

export interface TriageEvaluationError {
  ok: false;
  coverage: { predicted: number; total: number };
  errorDetails: ErrorDetail[];
  failedIds: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLabel = (value: unknown): value is TriageLabel =>
  typeof value === "string" && (TRIAGE_LABELS as readonly string[]).includes(value);

const unique = <T,>(values: T[]): T[] => [...new Set(values)];

export function evaluateTriagePredictions(input: unknown): TriageEvaluation | TriageEvaluationError {
  const ids = new Set(SMART_LEADS_CORPUS.map((item) => item.id));
  const errors: ErrorDetail[] = [];
  const rows = new Map<string, TriageLabel[]>();
  if (!Array.isArray(input)) {
    return {
      ok: false,
      coverage: { predicted: 0, total: SMART_LEADS_CORPUS.length },
      errorDetails: [{ code: "malformed_prediction", message: "Predictions must be an array of { id, labels } rows." }],
      failedIds: [],
    };
  }

  for (const raw of input) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !Array.isArray(raw.labels)) {
      errors.push({ code: "malformed_prediction", message: "Each prediction must have a string fixture id and a labels array." });
      continue;
    }
    const id = raw.id;
    if (!ids.has(id)) {
      errors.push({ code: "unknown_id", id, message: `Unknown fixture id: ${id}.` });
      continue;
    }
    if (rows.has(id)) {
      errors.push({ code: "duplicate_id", id, message: `Fixture id ${id} was submitted more than once.` });
      continue;
    }
    const invalid = raw.labels.filter((label) => !isLabel(label));
    const noActionCombined = raw.labels.includes("no_action") && raw.labels.length !== 1;
    if (invalid.length > 0 || new Set(raw.labels).size !== raw.labels.length || noActionCombined) {
      errors.push({
        code: "invalid_label",
        id,
        message: invalid.length > 0
          ? `Fixture ${id} contains invalid labels: ${invalid.map(String).join(", ")}.`
          : noActionCombined
            ? `Fixture ${id} cannot combine no_action with another label.`
            : `Fixture ${id} contains a duplicate label.`,
      });
      continue;
    }
    rows.set(id, raw.labels as TriageLabel[]);
  }
  for (const item of SMART_LEADS_CORPUS) {
    if (!rows.has(item.id)) errors.push({ code: "missing_id", id: item.id, message: `Prediction missing for fixture ${item.id}.` });
  }
  const coverage = { predicted: rows.size, total: SMART_LEADS_CORPUS.length };
  if (errors.length) {
    return {
      ok: false,
      coverage,
      errorDetails: errors,
      failedIds: unique(errors.flatMap((error) => error.id ? [error.id] : [])),
    };
  }

  const metrics = Object.fromEntries(TRIAGE_LABELS.map((label) => {
    const tpIds: string[] = [];
    const fpIds: string[] = [];
    const fnIds: string[] = [];
    for (const item of SMART_LEADS_CORPUS) {
      const expected = item.expectedLabels.includes(label);
      const predicted = rows.get(item.id)!.includes(label);
      if (expected && predicted) tpIds.push(item.id);
      else if (!expected && predicted) fpIds.push(item.id);
      else if (expected && !predicted) fnIds.push(item.id);
    }
    const TP = tpIds.length;
    const FP = fpIds.length;
    const FN = fnIds.length;
    return [label, {
      TP,
      FP,
      FN,
      precision: TP + FP === 0 ? null : TP / (TP + FP),
      recall: TP + FN === 0 ? null : TP / (TP + FN),
      tpIds,
      fpIds,
      fnIds,
    }];
  })) as Record<TriageLabel, LabelMetrics>;

  const emergencyMisses = SMART_LEADS_CORPUS.flatMap((item) =>
    item.emergency && !rows.get(item.id)!.includes("escalate")
      ? [{ id: item.id, kind: item.emergency.kind }]
      : [],
  );
  const failedIds = emergencyMisses.map((miss) => miss.id);
  return {
    ok: true,
    coverage,
    metrics,
    dispatchReviewCounts: {
      expected: SMART_LEADS_CORPUS.filter((item) => item.expectedLabels.includes("dispatch")).length,
      predicted: SMART_LEADS_CORPUS.filter((item) => rows.get(item.id)!.includes("dispatch")).length,
    },
    safetyHardFail: emergencyMisses.length > 0,
    emergencyMisses,
    failedIds,
    reviewBurdenInstruction: "Compare the expected and predicted dispatch counts, then inspect dispatch IDs manually. This is a count comparison only; review effort and timings were not measured or invented.",
    disclaimer: "Synthetic only: this fixture evaluation is no proof of demand, real performance on real messages, customer outcomes, or paid fulfillment.",
  };
}

const matches = (text: string, pattern: RegExp): boolean => pattern.test(text);

export function runReferenceRulesBaseline(): PredictionRow[] {
  return SMART_LEADS_CORPUS.map((item) => {
    const text = item.message;
    const labels = new Set<TriageLabel>();
    const emergency = matches(text, /\b(?:smell(?:ing)? gas|gas odor|gas leak|carbon monoxide|CO\s+(?:alarm|detector)|sparks? (?:at|from|near)|exposed (?:electrical )?wire)\b/i);
    if (emergency) {
      labels.add("dispatch");
      labels.add("escalate");
    } else if (matches(text, /\b(?:backlink package|search ranking services|cryptocurrency giveaway)\b/i)) {
      labels.add("spam");
    } else if (matches(text, /\b(?:automated message confirming receipt|thanks, we received)\b/i)) {
      labels.add("no_action");
    } else {
      if (matches(text, /\b(?:quote|estimate|price range|price|bid|cost)\b/i)) labels.add("quote");
      if (matches(text, /\b(?:book|booking|schedule|appointment|arrange a .*visit|dispatch available)\b/i)) labels.add("booking");
      if (matches(text, /\b(?:stopped|stopped working|not heating|not cooling|water coming|same-day dispatch|send help|diagnostic visit)\b/i)) labels.add("dispatch");
      if (matches(text, /\b(?:manager|wrong|complaint|same problem returned|review the charge)\b/i)) labels.add("escalate");
      if (matches(text, /\b(?:unsure|not sure|cannot tell|could somebody advise|somebody advise|might benefit)\b/i)) labels.add("human_review");
      if (labels.size === 0) labels.add("human_review");
    }
    return { id: item.id, labels: [...labels] };
  });
}

export function makeExamplePrediction(): PredictionRow {
  return { id: "SL-001", labels: ["quote"] };
}