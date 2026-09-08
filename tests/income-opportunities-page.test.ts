import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "client/src/components/app-sidebar.tsx"), "utf8");
const page = fs.readFileSync(path.join(root, "client/src/pages/admin-income-opportunities.tsx"), "utf8");
const catalog = fs.readFileSync(path.join(root, "client/src/data/income-opportunities.ts"), "utf8");

test("income opportunities route and sidebar folder are owner-only", () => {
  assert.match(app, /\{isAdmin && <Route path="\/admin\/income-opportunities"/);
  assert.match(
    sidebar,
    /\{isAdmin && \(\s*<NavSection title="Income Opportunities"[\s\S]*?path="\/admin\/income-opportunities"/,
  );
});

test("opportunity bank starts with ten distinct browseable ideas", () => {
  const slugs = [...catalog.matchAll(/^\s+slug: "([^"]+)"/gm)].map((match) => match[1]);
  assert.equal(slugs.length, 10);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.match(page, /INCOME_OPPORTUNITIES\.filter/);
  assert.match(page, /input-opportunity-search/);
  assert.match(page, /button-opportunity-category-/);
});

test("future templates and systems are visible without pretending they are built", () => {
  assert.match(page, /card-future-templates/);
  assert.match(page, /card-future-systems/);
  assert.match(page, />Next<\/Badge>/);
  assert.match(page, />Future<\/Badge>/);
});

test("opportunity filters meet the mobile touch-target minimum", () => {
  assert.match(page, /className="min-h-11 shrink-0"/);
  assert.match(sidebar, /title="Income Opportunities"[\s\S]*?touchFriendly/);
  assert.match(sidebar, /path="\/admin\/income-opportunities"[\s\S]*?touchFriendly/);
});

test("opportunity controls expose accessible names and state", () => {
  assert.match(page, /aria-label="Search income opportunities"/);
  assert.match(sidebar, /aria-expanded=\{open\}/);
});