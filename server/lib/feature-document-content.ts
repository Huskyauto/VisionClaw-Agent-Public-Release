import { scanFailureModes } from "./deliverable-failure-modes";

export type FeatureDocumentStat = {
  label: string;
  value: string;
};

export type FeatureDocumentSection = {
  title: string;
  content?: string;
  bullets?: string[];
  table?: {
    headers: string[];
    rows: string[][];
  };
};

/** Build the exact plain-text companion file for the comprehensive features PDF. */
export function buildFeatureDocumentText({
  today,
  stats,
  sections,
}: {
  today: string;
  stats: FeatureDocumentStat[];
  sections: FeatureDocumentSection[];
}): string {
  const txtLines: string[] = [];
  txtLines.push("================================================================");
  txtLines.push(`VISIONCLAW AGENT PLATFORM — COMPREHENSIVE FEATURES — ${today}`);
  txtLines.push("================================================================");
  txtLines.push("");
  txtLines.push("[Your Company] | EIN: [YOUR-EIN] | [Your City, ST]");
  txtLines.push("Owner: Bob Washburn | huskyauto@gmail.com");
  txtLines.push("Production: https://agenticcorporation.net");
  txtLines.push("QR Code: https://agenticcorporation.net  (Drive asset REDACTED_DRIVE_FILE_ID)");
  txtLines.push("");
  txtLines.push("-- LIVE STATS ---------------------------------------------------");
  for (const stat of stats) txtLines.push(`  ${stat.label.padEnd(22)} ${stat.value}`);
  txtLines.push("");
  for (const section of sections) {
    txtLines.push("");
    txtLines.push(`## ${section.title}`);
    txtLines.push("-".repeat(64));
    if (section.content) {
      txtLines.push(section.content);
      txtLines.push("");
    }
    if (section.bullets) for (const bullet of section.bullets) txtLines.push(`  • ${bullet}`);
    if (section.table) {
      txtLines.push("  " + section.table.headers.join(" | "));
      txtLines.push("  " + section.table.headers.map((header) => "-".repeat(header.length)).join("-+-"));
      for (const row of section.table.rows) txtLines.push("  " + row.join(" | "));
    }
  }
  txtLines.push("");
  txtLines.push("================================================================");
  txtLines.push("END OF DOCUMENT");
  txtLines.push("================================================================");
  return txtLines.join("\n");
}

/** Refuse to write a companion file that the delivery verifier would reject. */
export function assertFeatureDocumentTextIsDeliverable(text: string): void {
  const scan = scanFailureModes(text, { ext: ".txt", mime: "text/plain" });
  if (scan.blocking.length > 0) {
    throw new Error(`Feature-document text failed delivery preflight: ${scan.blocking.join("; ")}`);
  }
}

/** Stable across a recovery retry, but new for each release/date document. */
export function buildFeatureDocumentDeliveryIdempotencyKey(release: string, date: string): string {
  return `features-doc:${release}:${date}`;
}

export type FeatureDocumentArtifactReceipt = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

/**
 * Reconcile project-file metadata from the durable delivery receipt, never from
 * a fresh render that may differ during an idempotent recovery attempt.
 */
export function resolveFeatureDocumentArtifactSizes({
  artifacts,
  pdfFileName,
  txtFileName,
}: {
  artifacts: FeatureDocumentArtifactReceipt[];
  pdfFileName: string;
  txtFileName: string;
}): { pdfSize: number; txtSize: number } {
  const expectedArtifacts = new Set([
    `${pdfFileName}\u0000application/pdf`,
    `${txtFileName}\u0000text/plain`,
  ]);
  if (
    artifacts.length !== expectedArtifacts.size ||
    artifacts.some((artifact) => !expectedArtifacts.has(`${artifact.fileName}\u0000${artifact.mimeType}`))
  ) {
    throw new Error("Expected exactly the PDF and TXT durable artifact receipts");
  }

  const resolveOne = (fileName: string, mimeType: string): number => {
    const matches = artifacts.filter((artifact) =>
      artifact.fileName === fileName &&
      artifact.mimeType === mimeType &&
      Number.isSafeInteger(artifact.sizeBytes) &&
      artifact.sizeBytes > 0,
    );
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one durable artifact receipt for ${fileName}`);
    }
    return matches[0].sizeBytes;
  };

  return {
    pdfSize: resolveOne(pdfFileName, "application/pdf"),
    txtSize: resolveOne(txtFileName, "text/plain"),
  };
}