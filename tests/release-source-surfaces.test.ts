import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");
const isPrivateSource = JSON.parse(read("package.json")).private === true;
const notice = read("client/src/components/prepublication-notice.tsx");
const landing = read("client/src/pages/landing.tsx");
const sidebar = read("client/src/components/app-sidebar.tsx");
const updates = JSON.parse(read("client/src/data/updates.json"));
const release = /CURRENT_SOURCE_RELEASE = "([^"]+)"/.exec(notice)?.[1];

test("current release agrees across shared summary, dashboard data and both READMEs", () => {
  assert.equal(release, "R136.2");
  assert.equal(updates[0].version, release);
  assert.equal(updates[0].date, "October 14, 2026");
  const readmes = isPrivateSource ? ["README.md", "README.md"] : ["README.md"];
  for (const file of [...readmes, "ROADMAP.md"]) {
    assert.ok(read(file).slice(0, 18000).includes(release!));
  }
  assert.match(sidebar, /badge-updates-new[\s\S]{0,160}\{CURRENT_SOURCE_RELEASE\}/);
  assert.match(read("client/src/components/home-release-updates.tsx"), /updatesData/);
  assert.match(read("client/src/components/seo-head.tsx"), /CURRENT_PLATFORM_DESCRIPTION/);
});

test("both landing menus target the rendered recent-update section", () => {
  assert.equal((landing.match(/id: "section-recent-updates", label: "Latest Updates"/g) ?? []).length, 2);
  assert.match(landing, /<RecentPlatformUpdates\s*\/>/);
  assert.match(landing, /<RecentPlatformUpdates technical\s*\/>/);
  assert.match(read("client/src/components/recent-platform-updates.tsx"), /id="section-recent-updates"/);
});

test("navigation retains owner gating and existing routes instead of phantom tools", () => {
  assert.match(sidebar, /isPlatformAdmin && <span[^>]*data-testid="badge-treasury-paper"/);
  assert.match(sidebar, /isAdmin && <NavLink path="\/api-keys"/);
  assert.match(sidebar, /path="\/code-proposals"[^>]*badge="SOURCE"/);
  assert.match(sidebar, /path="\/landing"[^>]*label="Website & Latest Features"/);
  assert.doesNotMatch(sidebar, /path="\/(?:hermes|rea|worktree-swarm|cue-integration)"/);
  const app = read("client/src/App.tsx");
  for (const path of ["/landing", "/treasury", "/content-writing", "/api-keys", "/code-proposals", "/settings"]) {
    assert.ok(app.includes(`path="${path}"`), `${path} must be an implemented route`);
  }
});

test("new source claims keep paid, paper, partial and unverified boundaries explicit", () => {
  const current = read("client/src/components/recent-platform-updates.tsx");
  for (const term of ["AgentID", "Robert", "CheaperInference", "OpenClaw", "Muse", "HERMES"]) {
    assert.ok(current.includes(term), `missing ${term}`);
  }
  assert.match(current, /not a platform-wide spending guarantee/);
  assert.match(current, /does not place trades/);
  assert.match(current, /not independently certified/);
  assert.match(current, /integration is partial/);
  assert.match(current, /were not installed/);
  const document = read("docs/platform-update-2026-10-14.md");
  assert.match(document, /October 8 development evidence snapshot/);
  assert.match(document, /backs up source, not databases, credentials, uploads/);
});

test("public current-count table and architecture diagram agree with dated release facts", () => {
  const publicReadme = read(isPrivateSource ? "README.md" : "README.md");
  const facts = JSON.parse(read("docs/release-facts.json")).metrics;
  const glance = publicReadme.split("## Platform at a Glance")[1]?.split("## How It Works")[0];
  assert.ok(glance, "the public current-count table must be retained");
  const rows = new Map(glance.split("\n").filter(line => line.startsWith("|"))
    .map(line => line.split("|").slice(1, -1).map(cell => cell.trim()))
    .map(cells => [cells[0], cells[1]]));
  for (const [label, key] of [
    ["AI Agents (Personas)", "activePersonas"],
    ["Tools (total registered)", "registeredTools"],
    ["Tools (public documented)", "publicDocumentedTools"],
    ["Governance Rules", "governanceRules"],
  ]) {
    assert.equal(rows.get(label), String(facts[key]), `${label} drift`);
  }
  assert.equal(rows.get("AI Models in Core Registry"), `${facts.coreRegistryModels} curated`);
  assert.equal(rows.get("Database Tables"), `${facts.declaredTables} declared / ${facts.liveTables} live development`);
  assert.equal(rows.get("Platform Indexes"), `${facts.platformIndexes} (${facts.nonPrimaryKeyIndexes} non-PK)`);
  assert.match(glance, /dated development snapshot, not live production telemetry/);
  const diagram = publicReadme.split("## How It Works")[1]?.split("**Example flow:**")[0];
  assert.ok(diagram?.includes(`D${facts.declaredTables}/L${facts.liveTables}`));
  assert.ok(diagram?.includes(`${facts.coreRegistryModels} curated`));
});

test("private backup wording preserves the automatic-push hold", () => {
  if (!isPrivateSource) return; // Private backup instructions are not exported.
  assert.match(read("README.md"), /Private source backup:[\s\S]{0,70}Auto Git Push is on HOLD/);
  assert.match(read("replit.md"), /^## R136\.2 — .+ \(October 14, 2026\)$/m);
});
