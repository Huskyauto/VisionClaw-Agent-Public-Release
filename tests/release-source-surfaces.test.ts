import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readCurrentRelease } from "../scripts/lib/release-round";

const read = (file: string) => readFileSync(file, "utf8");
const isPrivateSource = JSON.parse(read("package.json")).private === true;
const notice = read("client/src/components/prepublication-notice.tsx");
const landing = read("client/src/pages/landing.tsx");
const sidebar = read("client/src/components/app-sidebar.tsx");
const updates = JSON.parse(read("client/src/data/updates.json"));
const release = /CURRENT_SOURCE_RELEASE = "([^"]+)"/.exec(notice)?.[1];
const currentDate = /— ([A-Za-z]+ \d{1,2}, \d{4}) source update:/.exec(notice)?.[1];

test("current release agrees across shared summary, dashboard data and both READMEs", () => {
  assert.match(release ?? "", /^R\d/);
  assert.ok(currentDate);
  if (isPrivateSource) {
    const published = readCurrentRelease("replit.md");
    assert.equal(published.round, release);
    assert.equal(published.date, currentDate);
  }
  assert.equal(updates[0].version, release);
  assert.equal(updates[0].date, currentDate);
  const readmes = isPrivateSource ? ["README.md", "README.md"] : ["README.md"];
  for (const file of [...readmes, "ROADMAP.md"]) {
    assert.ok(read(file).slice(0, 18000).includes(release!));
    assert.doesNotMatch(read(file), /Latest source update[^\n]*R137\+sec/);
  }
  const evidenceDate = JSON.parse(read("docs/release-facts.json")).releaseDate;
  const [year, month, day] = evidenceDate.split("-").map(Number);
  const evidenceLabel = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  assert.ok(read("ROADMAP.md").includes(`${evidenceLabel} development snapshot). ${release}`));
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

test("last-72-hour features reach both landing views and the shared dashboard release feed", () => {
  const current = read("client/src/components/recent-platform-updates.tsx");
  for (const term of ["Business health", "Release readiness", "Governance", "Cost/routing",
    "Website readiness", "Company report", "Alert logs", "Outcome-first", "Video packaging"]) {
    assert.ok(current.includes(term), `missing current feature: ${term}`);
  }
  assert.match(current, /\{releaseFacts\.releaseDate\} development inventory/);
  assert.match(current, /owner-only/i);
  assert.match(JSON.stringify(updates[0]), /production|deployment/i);
  assert.match(JSON.stringify(updates[0]), /not (?:presented as |whole-platform )?certification/i);
  assert.match(read("client/src/pages/home.tsx"), /HOME_RELEASES\.slice/);
});

test("retained November changes stay documented while current summaries use the latest source date", () => {
  const current = read("client/src/components/recent-platform-updates.tsx");
  const latest = JSON.stringify(updates);
  for (const term of ["Webhook", "confirmation", "harness", "daily upload", "PDF", "payment", "documentation"]) {
    assert.ok(current.toLowerCase().includes(term.toLowerCase()), `landing missing ${term}`);
    assert.ok(latest.toLowerCase().includes(term.toLowerCase()), `release feed missing ${term}`);
  }
  assert.equal(updates[0].date, currentDate);
  assert.match(notice, /audit remains degraded and incomplete/);
  assert.match(latest, /not certification/i);
  assert.match(latest, /does not replay/i);
  for (const file of isPrivateSource ? ["README.md", "README.md"] : ["README.md"]) {
    const top = read(file).split("The dated snapshot")[0];
    for (const term of ["webhook", "confirmation", "harness", "daily upload", "PDF", "payment", "documentation"]) {
      assert.ok(top.toLowerCase().includes(term.toLowerCase()), `${file} missing ${term}`);
    }
  }
  assert.ok(read("client/index.html").includes(release!));
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

test("the current repository hold overrides standing private-backup authority", () => {
  if (!isPrivateSource) return; // Private backup instructions are not exported.
  assert.match(read("README.md"), /Private source backup:[\s\S]{0,100}owner-authorized/);
  assert.match(read("README.md"), /temporarily paused during review/);
  const authority = read("replit.md").split("**Current repository/publication authority:**")[1]?.split("\n\n")[0];
  assert.ok(authority, "current repository authority must be explicit");
  assert.match(authority, /Normal private pushes and\s+`Auto Git Push` remain on hold/);
  assert.match(authority, /release-checks\/<digest>/);
  assert.match(authority, /does not\s+authorize main updates/);
  assert.doesNotMatch(authority, /normal private source[\s\S]*do not need repeated approval/);
});

test("private README current tables and every literal sidebar path remain aligned", () => {
  if (isPrivateSource) {
    const facts = JSON.parse(read("docs/release-facts.json")).metrics;
    const currentReadme = read("README.md");
    const architecture = currentReadme.split("## Architecture at a glance")[1]?.split("## Documentation")[0];
    assert.ok(architecture?.includes(`${facts.declaredTables} declared / ${facts.liveTables} live development`));
    assert.doesNotMatch(architecture ?? "", /195 declared \/ 276 live/);
  }
  const app = read("client/src/App.tsx");
  const paths = [...sidebar.matchAll(/<NavLink\s+(?:[^>]*?\s+)?path="([^"?]+)/g)].map(m => m[1]);
  assert.ok(paths.length > 60, "the navigation inventory must not silently shrink");
  for (const path of new Set(paths)) assert.ok(app.includes(`path="${path}"`), `${path} lacks a route`);
  assert.doesNotMatch(landing, /100% uptime|mean zero downtime|Every deliverable passes a universal quality gate/);
});
