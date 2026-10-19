import { z } from "zod";

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}, "Enter a real date as YYYY-MM-DD");
export const titleSchema = z.string().trim().min(1).max(160);
export const countSchema = z.number().finite().int().min(0).max(1_000_000_000).nullable().optional().default(null);
export const amountSchema = z.number().finite().min(0).max(1_000_000_000).nullable().optional().default(null);
export const round = (n: number) => Math.round(n * 100) / 100;
export interface PilotFinding {
  label: string; status: "reported" | "gap" | "blocked" | "unknown";
  detail: string; nextStep: string; evidence?: string;
}
export interface PilotMetric {
  label: string; value: number | null; unit: string; delta?: number | null;
  direction?: "improved" | "worsened" | "unchanged" | "unknown";
}
export interface PilotResult {
  title: string; verdict: string; summary: string; findings: PilotFinding[];
  metrics: PilotMetric[]; limitations: string[];
}
export const evidenceSchema = z.string().trim().max(1200).default("");
export function reportText(result: PilotResult): string {
  return [
    result.title, result.verdict, result.summary, "",
    ...result.metrics.map(m => `${m.label}: ${m.value === null ? "Unknown" : `${m.value} ${m.unit}`}` +
      (m.delta == null ? "" : `; change ${m.delta > 0 ? "+" : ""}${m.delta} ${m.unit} (${m.direction})`)),
    "", ...result.findings.flatMap(f => [
      `${f.label} — ${f.status}`, f.detail, ...(f.evidence ? [`Evidence reference: ${f.evidence}`] : []),
      `Next step: ${f.nextStep}`, "",
    ]), "Limitations", ...result.limitations.map(l => `- ${l}`),
  ].join("\n");
}
