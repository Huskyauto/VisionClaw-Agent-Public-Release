import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractTrustedDeliverableLinks } from "../../server/lib/orchestration-deliverable-links";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("public API key creation defaults to read-only", () => {
  const src = read("client/src/pages/api-keys.tsx");
  assert.match(src, /useState<string\[\]>\(\["read"\]\)/);
  assert.match(src, /setScopes\(\["read"\]\)/);
  assert.doesNotMatch(src, /setScopes\(\["chat",\s*"read"\]\)/);
});

test("orchestration links come only from trusted producer tool outputs", () => {
  const src = read("server/ceo-orchestrator.ts");
  const lib = read("server/lib/orchestration-deliverable-links.ts");
  assert.match(lib, /TRUSTED_DELIVERABLE_PRODUCERS/);
  assert.match(lib, /isTrustedDeliverableProducer\(tool\)/);
  assert.match(lib, /input\.action === "create"/);
  assert.match(lib, /input\.service === "docs" \|\| input\.service === "slides"/);
  assert.match(lib, /TRUSTED_RECEIPT_URL_FIELDS/);
  for (const field of [
    "editUrl", "presentFullscreenUrl", "narratedPresentationUrl",
    "pdfDownloadUrl", "pptxDownloadUrl", "downloadLink", "shareableLink",
    "folderLink", "directDownloadLink",
  ]) {
    assert.match(lib, new RegExp(`"${field}"`));
  }
  assert.match(src, /extractTrustedDeliverableLinks\(tool\)/);
  const producerSet = lib.slice(
    lib.indexOf("const TRUSTED_DELIVERABLE_PRODUCERS"),
    lib.indexOf("const TRUSTED_RECEIPT_URL_FIELDS"),
  );
  assert.doesNotMatch(producerSet, /build_presentation_distributed/);
  assert.doesNotMatch(src, /JSON\.stringify\(tool\.output/);
  assert.match(src, /step\.deliverableLinks\s*=\s*allLinks/);
  assert.doesNotMatch(src, /const matches = resultText\.match\(p\)/);
  assert.doesNotMatch(src, /DELIVERABLE LINKS \(MUST INCLUDE IN RESPONSE\).*enrichedResult/s);
});

test("final link surfacing consumes structured provenance and fails closed", () => {
  const tools = read("server/tools.ts");
  const drive = read("server/google-drive.ts");
  assert.match(tools, /for \(const url of s\.deliverableLinks \|\| \[\]\)/);
  assert.doesNotMatch(tools, /const m = s\.result\.match\(p\)/);
  assert.match(drive, /return \{ exists: false, reason: `transient-\$\{resp\.status\}` \}/);
  assert.match(drive, /return \{ exists: false, reason: `error-\$\{errorMessage\(err\)/);
  assert.match(tools, /\[unverified deliverable link omitted\]/);
});

test("Docs/create derives a URL only from its authoritative documentId receipt", () => {
  assert.deepEqual(
    extractTrustedDeliverableLinks({
      name: "google_workspace",
      input: { service: "docs", action: "create" },
      output: { documentId: "1AbCdEfGhIjKlMnOp", title: "Report" },
    }),
    ["https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit"],
  );
  assert.deepEqual(
    extractTrustedDeliverableLinks({
      name: "google_workspace",
      input: { service: "docs", action: "get" },
      output: { documentId: "1AbCdEfGhIjKlMnOp", body: "https://drive.google.com/file/d/1InjectedLink/view" },
    }),
    [],
  );
});