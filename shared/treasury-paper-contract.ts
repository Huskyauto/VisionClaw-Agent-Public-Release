import type { PaperStrategy } from "./treasury-paper-presets";
export interface PaperBar { date: string; open: number; high: number; low: number; close: number; volume: number }
export interface PaperOptions {
  symbol: string; strategy: PaperStrategy; mode: "rules" | "jev_shadow";
  capital: number; feeBps: number; slippageBps: number;
}
export interface PaperSnapshot {
  rsi14?:number; priorHigh20?:number; sma10?:number; volatilityAnnualizationDays?:number;
  asOf: string; sourceBars: number; close: number; sma5: number; sma20: number;
  return5Pct: number; volatilityPct: number; ruleTarget: "long" | "cash";
}
export interface PaperDecision {
  target: "long" | "cash"; probability?: number; confidence?: number; inputTokens?: number; outputTokens?: number;
  latencyMs?: number; servedModel?: string; regime?: string; riskProbability?: number;
}
export interface PaperFill {
  signalDate: string; fillDate: string; side: "buy" | "sell"; shares: number;
  referencePrice: number; price: number; feeUsd: number; slippageUsd: number;
  reason: string;
}
export interface PaperMetrics {
  endEquityUsd: number; pnlUsd: number; netReturnPct: number; maxDrawdownPct: number;
  closedTrades: number; winRatePct: number | null; profitFactor: number | null;
  costsUsd: number; turnoverUsd: number; openPositionShares: number; stopped: boolean;
}
export interface PaperTrack {
  metrics: PaperMetrics; fills: PaperFill[]; equity: { date: string; equityUsd: number }[];
}
export interface PaperResult {
  engineVersion: string; strategyVersion: string; options: PaperOptions;
  dataSource?: string; fetchedAt?: string; ageCalendarDays?: number;
  dataDigest: string; startDate: string; endDate: string; sourceBars: number;
  warmupBars: number; evaluationBars: number; rule: PaperTrack; benchmark: PaperTrack;
  excessReturnPct: number; shadow: null | (PaperTrack & {
    evaluationStatus: "complete" | "incomplete";
    coverage: { planned: number; completed: number; failed: number; lowConfidence: number };
    usage: { inputTokens: number; outputTokens: number };
    directionBrierScore: number | null; directionSamples: number;
    decisions: { date: string; target: string; probability: number | null; confidence: number | null; error?: string;
      latencyMs?: number; servedModel?: string; regime?: string; riskProbability?: number }[];
  });
  limitations: string[];
}
export interface PaperRun {
  id: string; request_key: string; status: "running" | "completed" | "failed";
  options: PaperOptions; result: PaperResult | null; error: string | null;
  created_at: string; finished_at: string | null; reviewing: boolean;
  review: null | { requestedModel: string; servedModel: string; text: string; interpretationOnly: true };
  review_error: string | null; review_attempted_at: string | null;
}
