import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CURRENT_SOURCE_RELEASE } from "../client/src/components/prepublication-notice";

test("Release surfaces preserve evidence boundaries without hardcoded publication status", () => {
  const facts = JSON.parse(readFileSync("docs/release-facts.json", "utf8"));
  assert.equal(facts.releaseDate, JSON.parse(readFileSync("docs/release-facts-input.json", "utf8")).releaseDate);
  assert.equal(facts.evidenceEnvironment, "development");
  for (const file of ["README.md", "README.md"]) {
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes(CURRENT_SOURCE_RELEASE), `${file} must name the current source revision`);
    assert.doesNotMatch(source, /publication pending|not (?:yet )?published/i);
    assert.match(source, new RegExp(`${facts.metrics.registeredTools} total registered tools`, "i"));
    assert.match(source, /GPT-5\.4/);
    assert.match(source, /not enforced application-wide/i);
  }
  const updates = JSON.parse(readFileSync("client/src/data/updates.json", "utf8"));
  assert.equal(updates[0].version, CURRENT_SOURCE_RELEASE);
  assert.doesNotMatch(JSON.stringify(updates[0]), /publication pending|publication remains on hold|prepared in source/i);
  assert.doesNotMatch(readFileSync("client/index.html", "utf8"), /publication pending|not yet published/i);
  const notice = readFileSync("client/src/components/prepublication-notice.tsx", "utf8");
  assert.doesNotMatch(notice, /publication pending|not yet published/i);
  assert.match(notice, /whole-platform certification/);
  assert.match(notice, /aggregate metered-AI budget remain unverified/);
  assert.match(notice, /docs\/release-facts\.json/);
  assert.doesNotMatch(readFileSync("client/src/pages/landing.tsx", "utf8"), /<PrepublicationNotice/);
  const sidebar = readFileSync("client/src/components/app-sidebar.tsx", "utf8");
  assert.match(sidebar, /\{CURRENT_SOURCE_RELEASE\}/, "Sidebar must render the shared current source revision");
  assert.doesNotMatch(sidebar, /R\d+(?:\.\d+)*\s*·\s*pending/i);
});

test("owner layout review, metered fallback and release-only findings agree across surfaces", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  for (const path of [
    "README.md",
    "README.md",
    "client/src/components/prepublication-notice.tsx",
    "client/src/components/recent-platform-updates.tsx",
    "client/index.html",
  ]) {
    const copy = read(path);
    assert.match(copy, /GLM 5\.4/, path);
    assert.match(copy, /GPT-6 Luna/, path);
    assert.match(copy, /public or synthetic/i, path);
    assert.match(copy, /paid\s+fallback/i, path);
  }
  const latest = JSON.parse(read("client/src/data/updates.json"))[0];
  assert.match(JSON.stringify(latest), /GLM 5\.4.*GPT-6 Luna/);
  assert.doesNotMatch(read("client/index.html"), /Free trial with 5 conversations/);
  assert.match(read("client/src/components/app-sidebar.tsx"), /path="\/admin\/website-audit"[^>]+label="Website Audit"/);
});