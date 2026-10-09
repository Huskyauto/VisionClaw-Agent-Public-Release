import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CURRENT_SOURCE_RELEASE } from "../client/src/components/prepublication-notice";

test("Release surfaces preserve evidence boundaries without hardcoded publication status", () => {
  const facts = JSON.parse(readFileSync("docs/release-facts.json", "utf8"));
  assert.equal(facts.releaseDate, "2026-10-03");
  assert.equal(facts.evidenceEnvironment, "development");
  for (const file of ["README.md", "README.md"]) {
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes(CURRENT_SOURCE_RELEASE), `${file} must name the current source revision`);
    assert.doesNotMatch(source, /publication pending|not (?:yet )?published/i);
    assert.match(source, /425 total registered tools/i);
    assert.match(source, /GPT-5\.4/);
    assert.match(source, /not enforced application-wide/i);
  }
  const updates = JSON.parse(readFileSync("client/src/data/updates.json", "utf8"));
  assert.equal(updates[0].version, CURRENT_SOURCE_RELEASE);
  assert.doesNotMatch(JSON.stringify(updates[0]), /publication pending|publication remains on hold|prepared in source/i);
  assert.doesNotMatch(readFileSync("client/index.html", "utf8"), /publication pending|not yet published/i);
  const notice = readFileSync("client/src/components/prepublication-notice.tsx", "utf8");
  assert.doesNotMatch(notice, /publication pending|not yet published/i);
  assert.match(notice, /Production verification and aggregate budget enforcement remain incomplete/);
  assert.match(notice, /docs\/release-facts\.json/);
  assert.doesNotMatch(readFileSync("client/src/pages/landing.tsx", "utf8"), /<PrepublicationNotice/);
  const sidebar = readFileSync("client/src/components/app-sidebar.tsx", "utf8");
  assert.ok(sidebar.includes(CURRENT_SOURCE_RELEASE), "Sidebar must name the current source revision");
  assert.doesNotMatch(sidebar, /R\d+(?:\.\d+)*\s*·\s*pending/i);
});