import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { scanFailureModes } from "../../server/lib/deliverable-failure-modes";
import {
  assertFeatureDocumentTextIsDeliverable,
  buildFeatureDocumentDeliveryIdempotencyKey,
  buildFeatureDocumentText,
  resolveFeatureDocumentArtifactSizes,
} from "../../server/lib/feature-document-content";

function collectStaticLiterals(source: string): string[] {
  const ast = ts.createSourceFile("build-features-doc.ts", source, ts.ScriptTarget.Latest, true);
  const literals: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return literals;
}

test("feature-document source literals contain no blocking delivery tokens", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts/build-features-doc.ts"), "utf8");
  const text = collectStaticLiterals(source).join("\n");
  const scan = scanFailureModes(text, { ext: ".txt", mime: "text/plain" });

  assert.deepEqual(
    scan.blocking,
    [],
    `feature-document content would be refused before delivery: ${scan.blocking.join("; ")}`,
  );
});

test("feature-document text builder scans final text and rejects blocked token mutations", () => {
  const text = buildFeatureDocumentText({
    today: "2026-08-27",
    stats: [{ label: "Tools", value: "414" }],
    sections: [{
      title: "Current Release",
      content: `Template-literal content is included in the final companion document.`,
      bullets: ["Historical release descriptions remain readable."],
      table: { headers: ["Name"], rows: [["VisionClaw"]] },
    }],
  });

  assert.doesNotThrow(() => assertFeatureDocumentTextIsDeliverable(text));
  for (const blockedToken of ["undefined", "NaN"]) {
    assert.throws(
      () => assertFeatureDocumentTextIsDeliverable(`${text}\nRuntime value: ${blockedToken}`),
      /error_token_leakage/,
    );
  }
});

test("feature-document recovery key is stable for the same release document", () => {
  const first = buildFeatureDocumentDeliveryIdempotencyKey("R125+155.2+sec5", "2026-08-27");
  assert.equal(first, "features-doc:R125+155.2+sec5:2026-08-27");
  assert.equal(first, buildFeatureDocumentDeliveryIdempotencyKey("R125+155.2+sec5", "2026-08-27"));
  assert.notEqual(first, buildFeatureDocumentDeliveryIdempotencyKey("R125+155.2+sec5", "2026-08-28"));
  assert.notEqual(first, buildFeatureDocumentDeliveryIdempotencyKey("R125+155.2+sec6", "2026-08-27"));
});

test("feature-document headline release is the first current archive entry", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts/build-features-doc.ts"), "utf8");
  const headlineRelease = source.match(/release:\s*"([^"]+)"/)?.[1];
  assert.ok(headlineRelease, "feature document must declare a current release");
  const archiveStart = source.indexOf('title: "Current Release and Historical Archive"');
  const firstArchiveBullet = source.indexOf(`"${headlineRelease} (`, archiveStart);
  assert.ok(
    archiveStart >= 0 && firstArchiveBullet > archiveStart,
    "the first archive bullet must match the document headline's current release",
  );
});

test("feature-document registration uses immutable receipt artifact sizes, not rerendered local sizes", () => {
  const receiptSizes = resolveFeatureDocumentArtifactSizes({
    artifacts: [
      { fileName: "features.pdf", mimeType: "application/pdf", sizeBytes: 1_024 },
      { fileName: "features.txt", mimeType: "text/plain", sizeBytes: 512 },
    ],
    pdfFileName: "features.pdf",
    txtFileName: "features.txt",
  });
  assert.deepEqual(receiptSizes, { pdfSize: 1_024, txtSize: 512 });
  assert.throws(
    () => resolveFeatureDocumentArtifactSizes({
      artifacts: [
        { fileName: "features.pdf", mimeType: "application/pdf", sizeBytes: 1_024 },
        { fileName: "features.pdf", mimeType: "application/pdf", sizeBytes: 1_025 },
        { fileName: "features.txt", mimeType: "text/plain", sizeBytes: 512 },
      ],
      pdfFileName: "features.pdf",
      txtFileName: "features.txt",
    }),
    /exactly the PDF and TXT durable artifact receipts/i,
  );
  assert.throws(
    () => resolveFeatureDocumentArtifactSizes({
      artifacts: [
        { fileName: "features.pdf", mimeType: "application/pdf", sizeBytes: 1_024 },
        { fileName: "features.txt", mimeType: "text/plain", sizeBytes: 512 },
        { fileName: "unexpected.csv", mimeType: "text/csv", sizeBytes: 64 },
      ],
      pdfFileName: "features.pdf",
      txtFileName: "features.txt",
    }),
    /exactly the PDF and TXT durable artifact receipts/i,
  );
});