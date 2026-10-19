import { z } from "zod";
import { dateSchema, evidenceSchema, titleSchema, round, type PilotResult } from "./common";

const rate = z.number().finite().min(0).max(10000);
const tokens = z.number().finite().int().min(0).max(1_000_000_000_000);
export const costSchema = z.object({
  business: titleSchema, start: dateSchema, end: dateSchema, currency: z.enum(["USD", "CAD", "GBP", "EUR"]),
  rows: z.array(z.object({
    workload: titleSchema, model: titleSchema, inputTokens: tokens, outputTokens: tokens,
    inputRate: rate, outputRate: rate, rateDate: dateSchema, rateSource: z.string().trim().min(1).max(400),
    alternative: z.object({
      model: titleSchema, inputRate: rate, outputRate: rate, qualityValidated: z.boolean(),
      evidence: evidenceSchema, testedAt: dateSchema.nullable().optional().default(null),
    }).strict().nullable().optional().default(null),
  }).strict()).min(1).max(20),
}).strict().refine(v => v.end >= v.start && Date.parse(v.end) - Date.parse(v.start) <= 366 * 86_400_000,
  { path: ["end"], message: "Use a non-reversed reporting period of at most 366 days" });
export type CostInput = z.infer<typeof costSchema>;
export function analyzeCost(input: CostInput, today = new Date().toISOString().slice(0, 10)): PilotResult {
  let total = 0, qualifiedSavings = 0;
  const findings = input.rows.map(row => {
    const current = (row.inputTokens * row.inputRate + row.outputTokens * row.outputRate) / 1_000_000;
    total += current;
    const alternative = row.alternative;
    const altCost = alternative ? (row.inputTokens * alternative.inputRate + row.outputTokens * alternative.outputRate) / 1_000_000 : null;
    const rateAge = (Date.parse(today) - Date.parse(row.rateDate)) / 86_400_000;
    const age = alternative?.testedAt ? (Date.parse(today) - Date.parse(alternative.testedAt)) / 86_400_000 : null;
    const qualified = !!alternative?.qualityValidated && !!alternative.evidence.trim() &&
      age !== null && age >= 0 && age <= 30 && rateAge >= 0 && rateAge <= 30;
    const savings = altCost === null ? 0 : Math.max(0, current - altCost);
    if (qualified) qualifiedSavings += savings;
    return { label: `${row.workload} — ${row.model}`,
      status: qualified ? "reported" as const : "unknown" as const,
      detail: `Estimated usage cost: ${round(current)} ${input.currency}. Rates supplied ${row.rateDate}; source: ${row.rateSource}. ` +
        (alternative ? `${alternative.model} same-token estimate: ${round(altCost!)} ${input.currency}. ` +
          (qualified ? `Potential reduction: ${round(savings)} ${input.currency}, supported by an operator-reported recent quality test.` :
            "Scenario only: excluded from qualified potential savings until current rates and a recent quality test with evidence are supplied.") :
          "No alternative supplied; no savings assumed.") +
        (rateAge < 0 || rateAge > 30 ? " Supplied rates are future-dated or older than the 30-day pilot freshness policy." : ""),
      ...(alternative?.evidence ? { evidence: alternative.evidence } : {}),
      nextStep: qualified ? "Review workload-specific latency, safety and output quality before manually changing routing." :
        "Benchmark a candidate on the same workload, retain results, and confirm both current and candidate rates before recommending a switch." };
  });
  return { title: `${input.business}: AI usage and routing audit`,
    verdict: "Estimate only — no routing changed",
    summary: `Reporting period ${input.start} to ${input.end}; ${input.rows.length} supplied workload/model rows.`,
    metrics: [{ label: "Estimated period usage cost", value: round(total), unit: input.currency },
      { label: "Qualified potential period savings", value: round(qualifiedSavings), unit: input.currency }],
    findings, limitations: [
      "Usage, current/candidate prices and quality-test claims are operator supplied; no provider account, price feed or invoice was accessed.",
      "Enter non-overlapping workload totals. Do not count cached/reasoning tokens twice. Rates must be in the selected currency per million tokens.",
      "Alternative scenarios assume identical token volumes and the same rate-date/source as the current model. Output length, cache pricing and quality can change costs.",
      "Subscriptions, free-tier limits, batch discounts, tools, infrastructure, taxes and minimum fees are excluded. Zero supplied rates do not prove unlimited free access.",
      "Quality qualification is an evidence-inventory gate, not independent validation. Savings are estimates for this period, not a guarantee or automatic routing permission.",
    ] };
}
