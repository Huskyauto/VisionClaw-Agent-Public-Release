import type { ReportEvidence, ReportSection } from "./business-report-evidence";
export const REPORT_KINDS = ["readiness", "executive", "opportunities"] as const;
export const isPackageFileKey = (key: string): boolean => key === key.trim() &&
  /^(?:(?:readiness|executive|opportunities)-(?:full|teaser)(?:-v[1-9]\d{0,3})?|teaser-pack(?:-v[1-9]\d{0,3})?)$/.test(key);
export type PackageKind = typeof REPORT_KINDS[number];
export type PackageIntake = {
  company: string; website: string; principalName?: string; industry?: string;
  crm?: string; notes?: string; intakeText?: string;
};
export type PackageFile = { key: string; label: string; filename: string; category: "full" | "teaser" };
export type Coverage = { discovered: number; reviewed: number; failed: number; capped: boolean };
export type PackageState = {
  intake: PackageIntake; phase: "new" | "researching" | "drafting" | "reviewing" | "done" | "blocked";
  research?: { evidence: ReportEvidence; coverage: Coverage; map?: unknown };
  reports: Partial<Record<PackageKind, { status: "starting" | "pending" | "done" | "error"; jobId?: number; error?: string }>>;
  files: PackageFile[]; error?: string; emailSummary?: string;
};
export interface PackagePorts {
  checkpoint(state: PackageState): Promise<void>;
  research(): Promise<NonNullable<PackageState["research"]>>;
  draft(kind: PackageKind, evidence: ReportEvidence): Promise<number>;
  recover(kind: PackageKind): Promise<number | null>;
  review(id: number, kind: PackageKind): Promise<{ status: string; sections?: ReportSection[]; filename?: string }>;
  assemble(kind: PackageKind, review: { sections?: ReportSection[]; filename?: string }): Promise<PackageFile[]>;
  combine(): Promise<void>;
}
export const initialPackage = (intake: PackageIntake): PackageState =>
  ({ intake, phase: "new", reports: {}, files: [] });

/** Durable checkpoints precede every spend-bearing dispatch. No blind replay. */
export async function advancePackage(state: PackageState, ports: PackagePorts) {
  if (state.phase === "done" || state.phase === "blocked") return;
  if (!state.research) {
    if (state.phase === "researching") {
      state.phase = "blocked"; state.error = "Research was interrupted before its snapshot committed. Owner recovery required.";
      return ports.checkpoint(state);
    }
    state.phase = "researching"; await ports.checkpoint(state);
    state.research = await ports.research();
    state.phase = "drafting"; return ports.checkpoint(state);
  }
  for (const kind of REPORT_KINDS) {
    let report = state.reports[kind];
    if (!report) {
      report = state.reports[kind] = { status: "starting" };
      await ports.checkpoint(state);
      try {
        report.jobId = await ports.draft(kind, state.research.evidence);
        report.status = "pending";
      } catch {
        // Check for an accepted child before declaring the draft unconfirmed.
        const recovered = await ports.recover(kind);
        if (recovered) { report.jobId = recovered; report.status = "pending"; }
        else { report.status = "error"; report.error = "Draft interrupted without a confirmed review receipt. No automatic duplicate dispatch."; }
      }
      return ports.checkpoint(state);
    }
    if (report.status === "starting") {
      const recovered = await ports.recover(kind);
      if (recovered) { report.jobId = recovered; report.status = "pending"; return ports.checkpoint(state); }
      state.phase = "blocked"; state.error = `Interrupted ${kind} draft has no confirmed child receipt; no automatic duplicate dispatch.`;
      return ports.checkpoint(state);
    }
  }
  state.phase = "reviewing";
  let waiting = false, failed = false;
  for (const kind of REPORT_KINDS) {
    const report = state.reports[kind]!;
    if (report.status === "done") continue;
    if (report.status === "error") { failed = true; continue; }
    const review = await ports.review(report.jobId!, kind);
    if (review.status === "error") {
      report.status = "error"; report.error = "Report review blocked or failed. Completed reports retained; inspect the existing report review before retrying.";
      failed = true; continue;
    }
    if (review.status !== "done") { waiting = true; continue; }
    const files = await ports.assemble(kind, review);
    state.files.push(...files.filter(file => !state.files.some(prior => prior.key === file.key)));
    report.status = "done"; await ports.checkpoint(state);
  }
  if (failed) {
    state.phase = "blocked"; state.error = "Package incomplete: one or more report reviews need owner attention. Available reports remain downloadable.";
    return ports.checkpoint(state);
  }
  if (waiting) return ports.checkpoint(state);
  await ports.combine();
  state.phase = "done";
  state.emailSummary = `${state.intake.company}: we reviewed your public website and prepared three short previews covering AI readiness, business growth and income opportunities. The previews highlight supported findings and practical next steps, with research limits disclosed. The complete three-report package is $497 total. Reply if you would like the full reports. No invoice or payment is required to review these previews.`;
  await ports.checkpoint(state);
}
