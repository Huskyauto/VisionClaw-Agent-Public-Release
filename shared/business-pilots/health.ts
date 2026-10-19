import { z } from "zod";
import { amountSchema, countSchema, dateSchema, titleSchema, round, type PilotResult } from "./common";

export const healthSchema = z.object({
  business: titleSchema, reference: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  currency: z.enum(["USD", "CAD", "GBP", "EUR"]),
  start: dateSchema, end: dateSchema,
  calls: countSchema, missedCalls: countSchema, quotes: countSchema, wonQuotes: countSchema,
  timelyFollowups: countSchema, customers: countSchema, repeatCustomers: countSchema,
  receivables: amountSchema, overdueReceivables: amountSchema,
}).strict().superRefine((v, ctx) => {
  if (v.end < v.start || Date.parse(v.end) - Date.parse(v.start) > 366 * 86_400_000)
    ctx.addIssue({ code: "custom", path: ["end"], message: "Use an end date on/after start and a period no longer than 366 days" });
  for (const [n, d] of [["missedCalls", "calls"], ["wonQuotes", "quotes"], ["timelyFollowups", "quotes"],
    ["repeatCustomers", "customers"], ["overdueReceivables", "receivables"]] as const) {
    if (v[n] != null && (v[d] == null || v[n]! > v[d]!))
      ctx.addIssue({ code: "custom", path: [n], message: `${n} requires ${d} and cannot exceed it` });
  }
});
export type HealthInput = z.infer<typeof healthSchema>;
export function analyzeHealth(input: HealthInput, baseline?: HealthInput): PilotResult {
  if (baseline && (input.reference !== baseline.reference || input.currency !== baseline.currency ||
      input.business.trim().toLowerCase() !== baseline.business.trim().toLowerCase()))
    throw new Error("Baseline must be for the same business reference and currency");
  if (baseline && baseline.end >= input.start) throw new Error("Baseline period must be earlier and non-overlapping");
  const definitions = [
    ["Missed-call rate", "missedCalls", "calls", false],
    ["Quote win rate", "wonQuotes", "quotes", true],
    ["Follow-ups within one day", "timelyFollowups", "quotes", true],
    ["Repeat-customer rate", "repeatCustomers", "customers", true],
    ["Receivables over 30 days", "overdueReceivables", "receivables", false],
  ] as const;
  const rate = (data: HealthInput, n: typeof definitions[number][1], d: typeof definitions[number][2]) =>
    data[n] == null || data[d] == null || data[d] === 0 ? null : 100 * data[n]! / data[d]!;
  const metrics = definitions.map(([label, n, d, higherBetter]) => {
    const raw = rate(input, n, d), prior = baseline ? rate(baseline, n, d) : null;
    const delta = raw == null || prior == null ? null : round(raw - prior);
    return { label, value: raw == null ? null : round(raw), unit: "% (change in percentage points)",
      delta, direction: delta == null ? "unknown" as const : delta === 0 ? "unchanged" as const :
        (delta > 0) === higherBetter ? "improved" as const : "worsened" as const };
  });
  return {
    title: `${input.business}: business health ${input.start} to ${input.end}`,
    verdict: baseline ? "Re-scan compared with selected baseline" : "Baseline captured",
    summary: `${metrics.filter(m => m.value !== null).length}/5 metrics supplied with usable denominators. No overall health score or industry benchmark is invented.`,
    metrics, findings: metrics.map(metric => ({
      label: metric.label, status: metric.value == null ? "unknown" : metric.direction === "worsened" ? "gap" : "reported",
      detail: metric.value == null ? "Inputs are missing or the denominator is zero." :
        `${metric.value}% from operator-supplied counts/amounts. ${baseline ? `Comparison: ${metric.direction}.` : "No prior baseline selected."}`,
      nextStep: metric.value == null ? "Supply the underlying totals for this reporting period." :
        metric.direction === "worsened" ? "Review the underlying records and agree a specific corrective action." :
          "Retain source records and compare the next non-overlapping reporting period.",
    })),
    limitations: ["Operator-supplied aggregate data; source records were not independently connected or verified.",
      "Missing data is unknown, never zero. Changes show association, not causation or a promised business outcome.",
      "Use consistent definitions, reporting lengths and quote cohorts; different periods or customer mixes can distort comparisons.",
      "Receivables figures are reporting-date balances; no invoice-level financial advice is provided."],
  };
}
