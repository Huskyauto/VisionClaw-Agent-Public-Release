import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("October source synchronization distinguishes development evidence from publication", () => {
  const facts = JSON.parse(readFileSync("docs/release-facts.json", "utf8"));
  assert.equal(facts.releaseDate, "2026-10-03");
  assert.equal(facts.evidenceEnvironment, "development");
  for (const file of ["README.md", "README.md"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /R135\.7/);
    assert.match(source, /not (?:yet )?published/i);
    assert.match(source, /425 total registered tools/i);
    assert.match(source, /GPT-5\.4/);
    assert.match(source, /not enforced application-wide/i);
  }
  const updates = JSON.parse(readFileSync("client/src/data/updates.json", "utf8"));
  assert.equal(updates[0].version, "R135.7");
  assert.match(updates[0].title, /publication pending/i);
  const notice = readFileSync("client/src/components/prepublication-notice.tsx", "utf8");
  assert.match(notice, /mode === "business"/);
  assert.match(notice, /not yet published/);
  assert.match(notice, /Production completion is not yet proven/);
  assert.match(notice, /docs\/release-facts\.json/);
  assert.match(readFileSync("client/src/pages/landing.tsx", "utf8"), /<PrepublicationNotice mode=\{viewMode\}/);
  assert.match(readFileSync("client/src/components/app-sidebar.tsx", "utf8"), /R135\.7 · pending/);
});