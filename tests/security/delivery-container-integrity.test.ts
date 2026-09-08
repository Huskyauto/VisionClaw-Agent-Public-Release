import test from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  checkRender,
  MAX_OFFICE_DOCUMENT_VALIDATION_BYTES,
  readAndValidateDocxFile,
} from "../../server/deliverable-verifier";

function validDocxBuffer(): Buffer {
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`));
  zip.addFile("_rels/.rels", Buffer.from(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`));
  zip.addFile("word/document.xml", Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`));
  return zip.toBuffer();
}

test("delivery verifier rejects random bytes masquerading as a video, audio file, or slide deck", () => {
  const garbage = Buffer.alloc(8192, 0x41);

  assert.match(checkRender("video", garbage, ".mp4") || "", /signature is invalid/);
  assert.match(checkRender("audio", garbage, ".mp3") || "", /signature is invalid/);
  assert.match(checkRender("slide_deck", garbage, ".pptx") || "", /not a ZIP container/);
  assert.match(checkRender("office_document", garbage, ".docx") || "", /not a valid DOCX OOXML container/);
  const genericZip = new AdmZip();
  genericZip.addFile("notes.txt", Buffer.from("not a Word document"));
  assert.match(checkRender("office_document", genericZip.toBuffer(), ".docx") || "", /not a valid DOCX OOXML container/);
  const incompleteOoxml = new AdmZip();
  incompleteOoxml.addFile("[Content_Types].xml", Buffer.from(`<?xml version="1.0"?><Types/>`));
  incompleteOoxml.addFile("_rels/.rels", Buffer.from(`<?xml version="1.0"?><Relationships/>`));
  incompleteOoxml.addFile("word/document.xml", Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`));
  assert.match(checkRender("office_document", incompleteOoxml.toBuffer(), ".docx") || "", /not a valid DOCX OOXML container/);
});

test("delivery verifier accepts recognizable media and presentation containers", () => {
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.alloc(32)]);
  const mp3 = Buffer.from("ID3" + "x".repeat(2048));
  const pptx = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.alloc(2048)]);

  assert.equal(checkRender("video", mp4, ".mp4"), null);
  assert.equal(checkRender("audio", mp3, ".mp3"), null);
  assert.equal(checkRender("slide_deck", pptx, ".pptx"), null);
  assert.equal(checkRender("office_document", validDocxBuffer(), ".docx"), null);
});

test("DOCX file validation reads the complete bounded package and rejects oversized buffers", () => {
  const zip = new AdmZip(validDocxBuffer());
  zip.addFile("word/media/padding.bin", randomBytes(80 * 1024));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmmc-docx-"));
  const filePath = path.join(tempDir, "large.docx");
  try {
    fs.writeFileSync(filePath, zip.toBuffer());
    assert.ok(fs.statSync(filePath).size > 64 * 1024, "fixture must place OOXML metadata beyond the former header-only read");
    assert.equal(readAndValidateDocxFile(filePath), true);
    assert.equal(checkRender("office_document", Buffer.alloc(MAX_OFFICE_DOCUMENT_VALIDATION_BYTES + 1, 0x50), ".docx"), "office-document-container-check: .docx is not a valid DOCX OOXML container");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});