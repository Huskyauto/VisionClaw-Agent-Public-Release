import test from "node:test";
import assert from "node:assert/strict";
import { resolveDeliveryContractType } from "../../server/delivery-pipeline";

test("delivery pipeline resolves supported artifact formats to a contract", () => {
  assert.equal(resolveDeliveryContractType("report.pdf"), "pdf_document");
  assert.equal(resolveDeliveryContractType("walkthrough.mp4"), "video");
  assert.equal(resolveDeliveryContractType("site.html"), "html_page");
  assert.equal(resolveDeliveryContractType("quick-start-guide.md"), "markdown_document");
});

test("delivery pipeline refuses an artifact with no contract mapping", () => {
  assert.equal(resolveDeliveryContractType("archive.bin"), null);
  assert.equal(resolveDeliveryContractType("unvalidated-vector.svg"), null);
});