import { createHash } from "node:crypto";
import { advanceParallelCompilation } from "./company-compilation-parallel";
import { advanceCompilationMatrix, newCompilationMatrix, compilationOperations,
  type CompilationMatrix, type CompilationOperation, type TargetedCompilationRepairPort } from "./company-compilation-matrix";
import { REPORT_KINDS, type PackageState, type PackageFile, type PackageKind } from "./company-report-package-core";

export type CompanyCompilationState = PackageState & { compilation?: CompilationMatrix;
  publication?: Partial<Record<PackageKind, {
    identity?: string;
    stage?: "narrating" | "assembling" | "uploading_audio" | "rendering_pdf" | "delivering_pdf" | "done";
    totalChunks?: number;
    chunks: Record<string, { claimed: true; sha?: string }>;
    audioUrl?: string; pdfUrl?: string;
  }>> };
export function companyCompilationSubject(state: PackageState): string {
  return createHash("sha256").update(JSON.stringify({ intake: state.intake, evidence: state.research?.evidence })).digest("hex");
}
/** Parallel compilation batch or one publication step per visit. Host claims and leases remain
 * authoritative; no child reviewer, jury, mission or regeneration is created. */
export async function advanceCompanyCompilation(state: CompanyCompilationState, ports: {
  checkpoint(): Promise<void>;
  request(op: CompilationOperation, drafts: string[]): Promise<unknown>;
  accept(op: CompilationOperation, raw: unknown): string;
  correct?(op: CompilationOperation, drafts: string[], original: unknown, check: string): Promise<unknown>;
  targetedRepair?: TargetedCompilationRepairPort;
  parallel?: boolean;
  publish(kind: PackageKind, text: string): Promise<PackageFile>;
  publishTeaser(): Promise<PackageFile>;
}) {
  if (state.phase === "blocked" || state.phase === "done") return;
  if (state.research?.complete !== true) throw new Error("Complete research is required before compilation");
  const subject = companyCompilationSubject(state);
  state.compilation ??= newCompilationMatrix(subject);
  if (state.compilation.subject !== subject) throw new Error("Compilation subject changed");
  if (state.compilation.phase !== "complete") {
    state.phase = "drafting";
    const advance = ports.parallel ? advanceParallelCompilation : advanceCompilationMatrix;
    await advance(state.compilation, {
      checkpoint: ports.checkpoint, request: ports.request, accept: ports.accept, correct: ports.correct,
      targetedRepair: ports.targetedRepair,
      ...(ports.parallel ? { outputContract: 2 as const } : {}),
    });
    return;
  }
  state.phase = "reviewing";
  for (const kind of REPORT_KINDS) {
    if (state.reports[kind]?.status === "done") continue;
    const operation = compilationOperations().find(op => op.kind === kind && op.stage === "synthesis")!;
    const text = state.compilation.slots[operation.key]?.text;
    if (!text) throw new Error("Accepted synthesis missing");
    const file = await ports.publish(kind, text);
    if (!file.audioUrl || !file.pdfUrl) throw new Error("Verified report PDF and audio are required");
    state.files = [...state.files.filter(f => f.key !== file.key), file];
    state.reports[kind] = { status: "done" };
    await ports.checkpoint();
    return;
  }
  if (state.files.filter(f => f.category === "full" && f.audioUrl && f.pdfUrl).length !== 3)
    throw new Error("Three verified report/audio pairs required");
  if (!state.files.some(f => f.key === "teaser-pack" && f.category === "teaser" && f.pdfUrl)) {
    const teaser = await ports.publishTeaser();
    if (teaser.key !== "teaser-pack" || teaser.category !== "teaser" || !teaser.pdfUrl)
      throw new Error("Verified three-page teaser delivery is required");
    state.files = [...state.files.filter(f => f.key !== "teaser-pack"), teaser];
    await ports.checkpoint();
  }
  state.phase = "done";
  await ports.checkpoint();
}
