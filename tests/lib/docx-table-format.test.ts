import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import { createDocx } from "../../server/doc-create";
import { buildStyledHtml } from "../../server/pdf-create";

test("DOCX tables declare a fixed grid so Word does not collapse columns", async () => {
  const fileName = "cmmc-docx-table-format-regression";
  const outputPath = path.join(process.cwd(), "uploads", `${fileName}.docx`);

  try {
    const result = await createDocx({
      title: "CMMC table formatting regression",
      fileName,
      uploadToDrive: false,
      sections: [{
        heading: "Assessment profile",
        table: {
          headers: ["Field", "Customer-stated value"],
          rows: [["System / scope description", "A readable value that must not wrap one character per line."]],
        },
      }],
    });

    assert.equal(result.success, true);
    assert.equal(result.localPath, `/uploads/${fileName}.docx`);

    const documentXml = new AdmZip(outputPath).readAsText("word/document.xml");
    assert.match(documentXml, /w:tblLayout w:type="fixed"/);
    assert.match(documentXml, /w:gridCol w:w="2800"/);
    assert.match(documentXml, /w:gridCol w:w="6200"/);
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
});

test("customer-owned PDF and DOCX outputs omit platform identity and promotion", async () => {
  const pdfHtml = buildStyledHtml({
    title: "Lake County Tool Works North Inc.",
    subtitle: "CMMC Level 1 / FCI Self-Attestation Report",
    sections: [{ title: "Authorized-official acknowledgment", content: "Customer attestation." }],
    includePlatformBranding: false,
  });

  assert.doesNotMatch(pdfHtml, /Visit Us|QR Code|visionclaw-logo|agenticcorporation/i);

  const fileName = "cmmc-customer-owned-docx-regression";
  const outputPath = path.join(process.cwd(), "uploads", `${fileName}.docx`);
  try {
    const result = await createDocx({
      title: "Lake County Tool Works North Inc.",
      headerText: "Lake County Tool Works North Inc.",
      includeFooter: false,
      fileName,
      uploadToDrive: false,
      sections: [{
        heading: "Authorized-official acknowledgment",
        content: "Customer attestation.",
        signatureText: "CustomerSignatureForTest",
        signatureAfterContent: true,
        table: { headers: ["Field", "Value"], rows: [["Official", "Authorized Official"]] },
      }],
    });

    assert.equal(result.success, true);
    const zip = new AdmZip(outputPath);
    const headerXml = zip.readAsText("word/header1.xml");
    const documentXml = zip.readAsText("word/document.xml");
    assert.match(headerXml, /Lake County Tool Works North Inc\./);
    assert.doesNotMatch(`${headerXml}${documentXml}`, /VisionClaw|Agent Platform/i);
    assert.equal(zip.getEntry("word/footer1.xml"), null);
    assert.ok(
      documentXml.indexOf("CustomerSignatureForTest") > documentXml.indexOf("Official"),
      "signature must render after the supporting acknowledgment table",
    );
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
});

test("generic reports retain their original before-table signature placement", async () => {
  const pdfHtml = buildStyledHtml({
    title: "Generic report",
    sections: [{
      title: "Signature test",
      signature: "DefaultSignatureForTest",
      table: { headers: ["Field", "Value"], rows: [["Field", "Value"]] },
    }],
  });
  assert.ok(
    pdfHtml.indexOf("DefaultSignatureForTest") < pdfHtml.indexOf("<table"),
    "generic PDF signatures should remain before tables unless explicitly opted in",
  );

  const fileName = "generic-docx-signature-regression";
  const outputPath = path.join(process.cwd(), "uploads", `${fileName}.docx`);
  try {
    const result = await createDocx({
      title: "Generic report",
      fileName,
      uploadToDrive: false,
      sections: [{
        signatureText: "DefaultSignatureForTest",
        table: { headers: ["Field", "Value"], rows: [["Field", "Value"]] },
      }],
    });
    assert.equal(result.success, true);
    const documentXml = new AdmZip(outputPath).readAsText("word/document.xml");
    assert.ok(
      documentXml.indexOf("DefaultSignatureForTest") < documentXml.indexOf("Field"),
      "generic DOCX signatures should remain before tables unless explicitly opted in",
    );
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
});