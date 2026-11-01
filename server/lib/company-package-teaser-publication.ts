import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { AgentJob } from "../job-queue";
import type { DeliveryRequest } from "../delivery-pipeline";
import { REPORT_KINDS, type PackageFile } from "./company-report-package-core";
import type { CompanyCompilationState } from "./company-package-v3";
import { companyCompilationSubject } from "./company-package-v3";
import { COMPANY_HEADINGS, publicationCompilationEvidence } from "./company-compilation-content";
import { validateCompiledReport } from "./business-report-evidence";
import { createPackageTeaser, combinePackageTeasers } from "./company-report-teasers";

type TeaserHost = {
  live(): Promise<void>;
  checkpoint(): Promise<void>;
  packageFile(key: string): Promise<Buffer | null>;
  storeFile(key: string, bytes: Uint8Array): Promise<string | undefined>;
};
type TeaserDelivery = (request: DeliveryRequest) =>
  Promise<{ success: boolean; linkVerified?: boolean; shareableLink?: string }>;
const selected = { readiness: [0, 1, 4], executive: [0, 1, 3], opportunities: [1, 2, 4] };

/** Conservative sentence-level projection, not a claim verifier. Quantified or
 * promissory sentences stay in the qualified full report, never the sales PDF. */
export function teaserRecommendationExcerpt(paragraphs: string[]): string {
  const excluded = /[\p{N}$€£%]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|double|triple|twice|percent|percentage|forecast\w*|projected|projection\w*|guarantee\w*|promise\w*)\b/iu;
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const text = paragraphs.flatMap(paragraph => paragraph.split(/\n+/))
    .flatMap(line => [...segmenter.segment(line)].map(part => part.segment))
    .filter(sentence => !excluded.test(sentence))
    .join(" ").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Safe recommendation excerpt unavailable for teaser");
  const words = text.split(/\s+/);
  return words.slice(0, 45).join(" ") + (words.length > 45 ? " …" : "");
}

/** Deterministic excerpts only: no new inference, audio, email or payment.
 * Persist exact PDF bytes before delivery so restart/retry keeps its identity. */
export async function publishCompanyTeaserPack(job: AgentJob, state: CompanyCompilationState,
  host: TeaserHost, deliver?: TeaserDelivery): Promise<PackageFile> {
  if (job.tenantId !== 1 || job.payload.tenantId !== job.tenantId || job.payload.productionVersion !== 3)
    throw new Error("Package teaser owner scope mismatch");
  if (!state.research?.complete || state.compilation?.phase !== "complete" ||
      state.compilation.subject !== companyCompilationSubject(state))
    throw new Error("Accepted company compilation required for teaser");
  await host.live();
  let pdf = await host.packageFile("teaser-pack");
  if (!pdf) {
    const pages: Uint8Array[] = [];
    for (const kind of REPORT_KINDS) {
      const slots = Object.entries(state.compilation.slots).filter(([key]) => key.startsWith(`synthesis:${kind}:`));
      if (slots.length !== 1 || slots[0][1].phase !== "complete" || !slots[0][1].text)
        throw new Error("Accepted synthesis missing for teaser");
      const report = JSON.parse(slots[0][1].text);
      const validated = validateCompiledReport(report, COMPANY_HEADINGS[kind],
        publicationCompilationEvidence(state, report), true, "compilation");
      const previewRows = selected[kind].map(index => {
        const section = validated.compiled.sections[index];
        // Preserve the recommendation label; omit forecasts, prices and assumptions.
        const text = teaserRecommendationExcerpt(section.blocks
          .filter(block => block.type === "recommendation").map(block => block.text));
        return { heading: section.heading, text: `Recommendation: ${text}` };
      });
      pages.push(await createPackageTeaser({ kind, company: state.intake.company,
        principalName: state.intake.principalName, sections: validated.sections, previewRows,
        capturedAt: state.research.evidence.capturedAt, evidence: state.research.evidence,
        coverage: `${state.research.coverage.reviewed} URLs reviewed; ${state.research.coverage.failed} failed. Public-source review only. See full reports for scope and limitations.` }));
    }
    pdf = Buffer.from(await combinePackageTeasers(pages));
    await host.live();
    await host.storeFile("teaser-pack", pdf);
    await host.checkpoint();
  }
  if ((await PDFDocument.load(pdf)).getPageCount() !== 3) throw new Error("Teaser must contain exactly three pages");
  await host.live();
  const hash = createHash("sha256").update(pdf).digest("hex");
  const delivery = await (deliver ?? (async request =>
    (await import("../delivery-pipeline")).deliverDigitalProduct(request)))({
    tenantId: job.tenantId, customerName: state.intake.company,
    productName: `${state.intake.company} - Three-page preview of the $497 report package`,
    fileData: pdf, fileName: `Company-${job.id}-three-page-teaser.pdf`, mimeType: "application/pdf",
    sendEmail: false, idempotencyKey: `company-v3-teaser:${job.id}:${state.compilation.subject}:${hash}`,
  });
  if (!delivery.success || !delivery.linkVerified || !delivery.shareableLink)
    throw Object.assign(new Error("Three-page teaser delivery unverified; saved reports and teaser retained"),
      { code: "COMPANY_TEASER_DELIVERY_FAILED" });
  // The API and UI accept this canonical Drive view shape.
  const match = delivery.shareableLink.match(/^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,200})\/view(?:\?[^#]*)?$/);
  if (!match) throw new Error("Invalid teaser Drive delivery identity");
  await host.live();
  return { key: "teaser-pack", label: "Three-page teaser — $497 full-package offer",
    filename: "free-teaser-pack.pdf", category: "teaser",
    pdfUrl: `https://drive.google.com/file/d/${match[1]}/view` };
}
