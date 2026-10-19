import fs from "node:fs/promises";
import { hashReportBytes, type ReportSection } from "./business-report-evidence";
import type { BusinessReportReviewInput } from "./business-report-review";
import type { FulfillmentResult } from "../research-report-fulfillment";

export function businessReportArtifactName(input: BusinessReportReviewInput, sections: ReportSection[]): string {
  const digest = hashReportBytes(JSON.stringify({ format: "american-full-report-audio-v4", tenantId: input.tenantId, kind: input.kind,
    orderId: input.orderId, sections }));
  // The styled renderer caps stems at 60 chars; identity must survive that cap.
  return `brr-${input.kind}-${digest.slice(0, 40)}.pdf`;
}

export async function recoverBusinessReportArtifact(
  input: BusinessReportReviewInput, sections: ReportSection[],
): Promise<FulfillmentResult | null> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const fileName = businessReportArtifactName(input, sections);
  const result: any = await db.execute(sql`SELECT data FROM file_storage
    WHERE tenant_id = ${input.tenantId} AND filename = ${fileName} AND mime_type = 'application/pdf'
    ORDER BY id DESC LIMIT 1`);
  const row = (result.rows || result)[0];
  if (!row || typeof row.data !== "string") return null;
  const bytes = Buffer.from(row.data, "base64");
  const { reportAudioLinkFromPdf } = await import("./business-report-audio");
  const audioViewUrl = await reportAudioLinkFromPdf(bytes);
  const { reportSectionAudioLinksFromPdf } = await import("./business-report-section-links");
  const audioTracks = await reportSectionAudioLinksFromPdf(bytes);
  // Renderers may persist intermediate PDF bytes before the MP3 exists.
  // Those are not a completed customer artifact and must never be recovered.
  if (!audioViewUrl) return null;
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  if (pdf.getPageCount() < 1) throw new Error("Retained report PDF is corrupt");
  const { resolveUploadsChild } = await import("../uploads-path");
  const absolute = resolveUploadsChild(fileName);
  const { restorePdfCacheFromDurableBytes } = await import("../service-review-queue");
  await restorePdfCacheFromDurableBytes(absolute, bytes);
  return { success: true, filePath: `uploads/${fileName}`, fileName, pages: pdf.getPageCount(),
    modelUsed: input.modelId, audio: { viewUrl: audioViewUrl, tracks: audioTracks }, sections: [
      { heading: "Listen to this report", body: `One complete American-English MP3 for this report: ${audioViewUrl}. Source quotations and citation codes are written-only.` },
      { heading: input.kind === "readiness" ? "About This Audit" : "About This Report",
        body: "Evidence-backed report compiled from retained source snapshots and reviewed by jury triage." },
      ...sections,
    ] };
}

/** Renderer persistence is historically fail-soft. This report-specific
 * boundary requires durable PDF bytes before issuing a fulfillment receipt. */
export async function persistBusinessReportArtifact(input: BusinessReportReviewInput, sections: ReportSection[],
  fulfillment: FulfillmentResult): Promise<void> {
  const fileName = businessReportArtifactName(input, sections);
  if (fulfillment.fileName !== fileName) throw new Error("Report renderer changed the exact artifact identity");
  const { resolveUploadsChild } = await import("../uploads-path");
  const bytes = await fs.readFile(resolveUploadsChild(fileName));
  const { reportAudioLinkFromPdf } = await import("./business-report-audio");
  if (!await reportAudioLinkFromPdf(bytes)) throw new Error("Report PDF is missing its full-report MP3 listening link");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  if (pdf.getPageCount() < 1) throw new Error("Report has no valid PDF pages");
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.tenantId}:${fileName}`}))`);
    const rows: any = await tx.execute(sql`SELECT id FROM file_storage
      WHERE tenant_id = ${input.tenantId} AND filename = ${fileName} LIMIT 1`);
    const row = (rows.rows || rows)[0];
    if (row) {
      await tx.execute(sql`UPDATE file_storage SET data = ${bytes.toString("base64")},
        size = ${bytes.length}, mime_type = 'application/pdf'
        WHERE id = ${row.id} AND tenant_id = ${input.tenantId}`);
    } else {
      await tx.execute(sql`INSERT INTO file_storage (filename, original_name, mime_type, size, data, tenant_id)
        VALUES (${fileName}, ${fileName}, 'application/pdf', ${bytes.length}, ${bytes.toString("base64")}, ${input.tenantId})`);
    }
  });
}
