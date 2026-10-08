export type HvacEstimateAssumptions = { monthlyInboundCalls: number; missedCallRatePercent: number; bookingRatePercent: number; averageJobValueUsd: number };
export type HvacOpportunityEstimate = HvacEstimateAssumptions & { missedCallsPerMonth: number; recoverableBookingsPerMonth: number; estimatedOpportunityUsdPerMonth: number; disclaimer: "estimate_only_not_verified_revenue" };
export function calculateHvacOpportunity(input: HvacEstimateAssumptions): HvacOpportunityEstimate {
  const clamp = (v: number, min: number, max: number) => Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;
  const monthlyInboundCalls = Math.round(clamp(input.monthlyInboundCalls, 0, 100000));
  const missedCallRatePercent = clamp(input.missedCallRatePercent, 0, 100);
  const bookingRatePercent = clamp(input.bookingRatePercent, 0, 100);
  const averageJobValueUsd = clamp(input.averageJobValueUsd, 0, 1000000);
  const missedCallsPerMonth = Math.round(monthlyInboundCalls * missedCallRatePercent) / 100;
  const recoverableBookingsPerMonth = Math.round(missedCallsPerMonth * bookingRatePercent) / 100;
  return { monthlyInboundCalls, missedCallRatePercent, bookingRatePercent, averageJobValueUsd, missedCallsPerMonth, recoverableBookingsPerMonth, estimatedOpportunityUsdPerMonth: Math.round(recoverableBookingsPerMonth * averageJobValueUsd * 100) / 100, disclaimer: "estimate_only_not_verified_revenue" };
}