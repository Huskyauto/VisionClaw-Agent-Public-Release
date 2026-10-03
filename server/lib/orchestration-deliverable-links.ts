const TRUSTED_DELIVERABLE_PRODUCERS = new Set([
  "deliver_product",
  "create_slides",
  "create_pdf",
  "create_styled_report",
  "create_document",
  "create_spreadsheet",
  "google_drive",
  "produce_video",
  "create_slideshow_video",
  "mpeg_produce",
  "mpeg_produce_parallel",
  "generate_evidence_docket",
]);

const TRUSTED_RECEIPT_URL_FIELDS = new Set([
  "viewUrl", "downloadUrl", "driveViewUrl", "driveDownloadUrl", "driveUrl",
  "fileUrl", "deliveryUrl", "watchUrl", "presentationUrl", "documentUrl",
  "spreadsheetUrl", "webViewLink", "publicUrl", "signedUrl",
  "editUrl", "presentFullscreenUrl", "narratedPresentationUrl",
  "pdfDownloadUrl", "pptxDownloadUrl", "downloadLink", "shareableLink",
  "folderLink", "directDownloadLink",
]);

function isTrustedDeliverableProducer(tool: any): boolean {
  if (TRUSTED_DELIVERABLE_PRODUCERS.has(tool?.name)) return true;
  if (tool?.name !== "google_workspace") return false;
  const input = tool?.input || {};
  return input.action === "create" && (input.service === "docs" || input.service === "slides");
}

export function extractTrustedDeliverableLinks(tool: any): string[] {
  if (!isTrustedDeliverableProducer(tool)) return [];
  const found = new Set<string>();
  const urlPattern = /https:\/\/(?:docs\.google\.com\/(?:presentation|document|spreadsheets)\/d\/[a-zA-Z0-9_-]+(?:\/[^\s"')\]},]+)?|drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+(?:\/[^\s"')\]},]+)?|[a-z0-9-]+\.replit\.app\/present\/[a-f0-9]+)/g;
  const walk = (value: any, key = ""): void => {
    if (typeof value === "string" && TRUSTED_RECEIPT_URL_FIELDS.has(key)) {
      for (const match of value.match(urlPattern) || []) found.add(match);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
      return;
    }
    if (value && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) walk(child, childKey);
    }
  };
  walk(tool?.output);
  const input = tool?.input || {};
  const output = tool?.output || {};
  if (
    tool?.name === "google_workspace" &&
    input.service === "docs" &&
    input.action === "create" &&
    typeof output.documentId === "string" &&
    /^[A-Za-z0-9_-]{10,}$/.test(output.documentId)
  ) {
    found.add(`https://docs.google.com/document/d/${output.documentId}/edit`);
  }
  return [...found];
}