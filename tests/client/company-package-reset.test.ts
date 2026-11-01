import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("preparing another package clears displayed and persisted fields, including hidden context", () => {
  const source = readFileSync("client/src/components/company-report-package.tsx", "utf8");
  const empty = source.match(/const EMPTY_FIELDS: PackageFields = \{([\s\S]*?)\n\};/)![1];
  for (const field of ["company", "contactEmail", "website", "principalName", "industry", "crm", "notes", "intakeText"])
    assert.match(empty, new RegExp(`${field}: "",`));
  const reset = source.split("function prepareAnotherPackage() {")[1].split("async function downloadFile")[0];
  assert.match(reset, /const emptyFields = \{ \.\.\.EMPTY_FIELDS \}/);
  assert.match(reset, /setFields\(emptyFields\)/);
  assert.match(reset, /persistDraft\(emptyFields, nextId\)/);
  assert.doesNotMatch(reset, /persistDraft\(fields,/);
  assert.match(reset, /setAcceptResearchCost\(false\)/);
  assert.match(reset, /localStorage\.removeItem\(activeStorageKey\)/);
});
