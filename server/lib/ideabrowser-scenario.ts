/**
 * Shared IdeaBrowser money-scenario simulation core.
 *
 * Extracted from scripts/ideabrowser-weekly-scenario.ts so the weekly Monday
 * cron and ad-hoc master/archive passes run the EXACT same analyst prompt,
 * validator prompt, and parsing/guard logic. Pure LLM + parsing — no DB, no
 * side effects; callers own candidate selection, reporting, and delivery.
 */
import Anthropic from "@anthropic-ai/sdk";
import { resolveScorerModel } from "./ideabrowser-score";

export interface Candidate {
  id: number;
  name: string;
  description: string;
  tier: string | null;
  composite: number | null;
  /** Advisory Evidence Confidence from the scorer (High/Medium/Low) — null when unscored/legacy. */
  evidenceConfidence?: string | null;
}

export interface Scenario {
  projectId: number;
  name: string;
  revenue12moUsd: number;
  buildCostUsd: number;
  buildHours: number;
  monthlyRunCostUsd: number;
  daysToFirstDollar: number;
  successProbabilityPct: number; // 0–100, model's realistic chance the idea profits at all
  expectedProfitUsd: number; // probability-weighted: p*revenue − totalCost, computed locally
  roi: number; // revenue / (buildCost + 12*runCost + hours*$50), computed locally
  visionclawLeverage: string;
  goToMarket: string;
  topRisk: string;
  verdict: string;
}

export const SCENARIO_PROMPT = `You are a venture-grade analyst running a MONEY SCENARIO simulation for VisionClaw — Bob's solo-founder, multi-tenant agentic-AI platform (a ~400-tool platform; Felix persona executes deliverable pipelines end-to-end: videos, PDFs, landing pages, email/CRM, lead capture wedge landings, payment links via Stripe; near-zero marginal labor cost since the platform does the work).

Given ONE product idea, output STRICT JSON (no prose, no markdown fence) with these keys:
{
  "revenue12moUsd": <realistic 12-month revenue for a solo founder w/ this platform, integer USD>,
  "buildCostUsd": <one-time out-of-pocket cost to implement (APIs, infra, ads for validation), integer USD>,
  "buildHours": <Bob-hours to ship an MVP using VisionClaw to do most of the work, integer>,
  "monthlyRunCostUsd": <ongoing monthly cost, integer USD>,
  "daysToFirstDollar": <days until first paying customer, integer>,
  "successProbabilityPct": <realistic probability 0-100 that this idea produces ANY net profit in 12 months for this solo founder — be brutally honest; most ideas are 5-40>,
  "visionclawLeverage": "<1 sentence: which existing VisionClaw capabilities do 80% of the work>",
  "goToMarket": "<1 sentence: the single fastest distribution channel>",
  "topRisk": "<1 sentence: the biggest reason this makes $0>",
  "verdict": "<1 sentence: build / skip and why>"
}
Be conservative on revenue and honest on risk — Bob is optimizing for most money for least cost/effort.`;

export interface Validation {
  whatItIs: string;
  numbersVerdict: string; // critic's independent take on the scenario numbers
  adjustedSuccessProbabilityPct: number;
  cheapestMoneyPlan: string[]; // ordered steps, each with an out-of-pocket $ figure
  totalOutOfPocketUsd: number;
  week1Actions: string[];
  goNoGo: string;
}

export const VALIDATION_PROMPT = `You are an INDEPENDENT skeptical validator (a second opinion — do NOT rubber-stamp). A venture analyst just simulated a money scenario for a product idea that a solo founder (Bob) would build on VisionClaw, his ~400-tool agentic-AI platform (Felix persona ships videos, PDFs, landing pages, email/CRM, lead-capture wedge pages, Stripe payment links with near-zero marginal labor).

Your job:
1. Explain in plain English what this project actually is and who pays for it.
2. Independently sanity-check the analyst's numbers — call out anything inflated or missed.
3. Lay out the CHEAPEST possible path to first revenue: ordered steps, each with its out-of-pocket dollar cost (Bob optimizes for least cash spent, platform does the labor).
4. Give concrete week-1 actions and a final go/no-go.

Output STRICT JSON (no prose, no markdown fence):
{
  "whatItIs": "<2-3 sentences: what the product is, who the customer is, why they pay>",
  "numbersVerdict": "<2-3 sentences: your independent take on the analyst's revenue/cost/probability — agree, or state what you'd change and why>",
  "adjustedSuccessProbabilityPct": <your own honest 0-100 probability of ANY net profit in 12 months>,
  "cheapestMoneyPlan": ["<step 1 with $ cost, e.g. 'Ship landing page + Stripe link via Felix — $0'>", "<step 2 …>", "<3-6 steps total, cheapest viable path to first dollar>"],
  "totalOutOfPocketUsd": <sum of cash costs across the plan, integer USD>,
  "week1Actions": ["<concrete action 1>", "<action 2>", "<2-4 actions>"],
  "goNoGo": "<1 sentence: GO or NO-GO and the single deciding reason>"
}`;

function parseJsonObject(raw: string, source: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`no JSON object in ${source} output (${raw.slice(0, 120)}…)`);
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`empty required field ${field}`);
  return value.trim();
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`empty ${field}`);
  const strings = value.map((item) => requiredText(item, field));
  return strings;
}

function requiredNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`bad ${field}: ${String(value)}`);
  }
  return value;
}

export function parseValidationOutput(raw: string): Validation {
  const p = parseJsonObject(raw, "validator");
  const prob = requiredNonNegativeNumber(p.adjustedSuccessProbabilityPct, "adjustedSuccessProbabilityPct");
  if (prob > 100) {
    throw new Error(`bad adjustedSuccessProbabilityPct: ${String(p.adjustedSuccessProbabilityPct)}`);
  }
  const oop = requiredNonNegativeNumber(p.totalOutOfPocketUsd, "totalOutOfPocketUsd");
  return {
    whatItIs: requiredText(p.whatItIs, "whatItIs"),
    numbersVerdict: requiredText(p.numbersVerdict, "numbersVerdict"),
    adjustedSuccessProbabilityPct: Math.round(prob),
    cheapestMoneyPlan: requiredStringArray(p.cheapestMoneyPlan, "cheapestMoneyPlan"),
    totalOutOfPocketUsd: Math.round(oop),
    week1Actions: requiredStringArray(p.week1Actions, "week1Actions"),
    goNoGo: requiredText(p.goNoGo, "goNoGo"),
  };
}

export function parseScenarioOutput(raw: string, c: Candidate): Scenario {
  const p = parseJsonObject(raw, "model");
  const nums = ["revenue12moUsd", "buildCostUsd", "buildHours", "monthlyRunCostUsd", "daysToFirstDollar"] as const;
  for (const k of nums) {
    const value = requiredNonNegativeNumber(p[k], `numeric field ${k}`);
    p[k] = Math.round(value);
  }
  const prob = requiredNonNegativeNumber(p.successProbabilityPct, "successProbabilityPct");
  if (prob > 100) {
    throw new Error(`bad successProbabilityPct: ${String(p.successProbabilityPct)}`);
  }
  const roundedProb = Math.round(prob);
  const revenue12moUsd = p.revenue12moUsd as number;
  const buildCostUsd = p.buildCostUsd as number;
  const buildHours = p.buildHours as number;
  const monthlyRunCostUsd = p.monthlyRunCostUsd as number;
  const totalCost = buildCostUsd + 12 * monthlyRunCostUsd + buildHours * 50;
  const roi = totalCost > 0 ? revenue12moUsd / totalCost : revenue12moUsd;
  return {
    projectId: c.id,
    name: c.name,
    revenue12moUsd,
    buildCostUsd,
    buildHours,
    monthlyRunCostUsd,
    daysToFirstDollar: p.daysToFirstDollar as number,
    successProbabilityPct: roundedProb,
    expectedProfitUsd: Math.round((roundedProb / 100) * revenue12moUsd - totalCost),
    roi: Math.round(roi * 100) / 100,
    visionclawLeverage: requiredText(p.visionclawLeverage, "visionclawLeverage"),
    goToMarket: requiredText(p.goToMarket, "goToMarket"),
    topRisk: requiredText(p.topRisk, "topRisk"),
    verdict: requiredText(p.verdict, "verdict"),
  };
}

export async function runValidation(client: Anthropic, c: Candidate, s: Scenario): Promise<Validation | null> {
  try {
    const msg = await client.messages.create({
      model: await resolveScorerModel(client),
      max_tokens: 1200,
      messages: [{
        role: "user",
        content: `${VALIDATION_PROMPT}\n\nIDEA:\nName: ${c.name}\nDescription: ${(c.description || "").slice(0, 2000)}\n\nANALYST SCENARIO (to be validated):\n12-mo revenue $${s.revenue12moUsd} · build cost $${s.buildCostUsd} + ${s.buildHours} founder-hours + $${s.monthlyRunCostUsd}/mo · first dollar in ${s.daysToFirstDollar} days · success probability ${s.successProbabilityPct}% · leverage: ${s.visionclawLeverage} · GTM: ${s.goToMarket} · risk: ${s.topRisk} · verdict: ${s.verdict}`,
      }],
    });
    const raw = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return parseValidationOutput(raw);
  } catch (e: any) {
    console.error(`[validate] idea #${c.id} "${c.name}" validation failed: ${e?.message || e}`);
    return null;
  }
}

export async function runScenario(client: Anthropic, c: Candidate): Promise<Scenario | null> {
  try {
    const msg = await client.messages.create({
      model: await resolveScorerModel(client),
      max_tokens: 800,
      messages: [{
        role: "user",
        content: `${SCENARIO_PROMPT}\n\nIDEA (portfolio tier ${c.tier ?? "?"}, composite ${c.composite ?? "?"}):\nName: ${c.name}\nDescription: ${(c.description || "").slice(0, 2000)}`,
      }],
    });
    const raw = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return parseScenarioOutput(raw, c);
  } catch (e: any) {
    console.error(`[scenario] idea #${c.id} "${c.name}" failed: ${e?.message || e}`);
    return null;
  }
}
