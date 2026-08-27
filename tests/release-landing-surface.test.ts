import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const RELEASE = "R125+155+sec12";
const TOOL_COUNT = "414";
const source = fs.readFileSync("client/src/pages/landing.tsx", "utf8");

function sectionAfter(anchor: string, nextAnchor: string): string {
  const start = source.indexOf(anchor);
  const end = source.indexOf(nextAnchor, start + anchor.length);
  assert.ok(start >= 0, `missing landing anchor: ${anchor}`);
  assert.ok(end > start, `missing landing boundary after: ${anchor}`);
  return source.slice(start, end);
}

const requiredClaims = [
  RELEASE,
  "delivery retr",
  "symlink",
  "before.*state changes",
] as const;

test("both public landing render paths keep the current delivery-retry hardening claim", () => {
  const businessTrust = sectionAfter(
    "function BusinessTrustSection()",
    "function BusinessFaqSection()",
  );
  const technicalTrust = sectionAfter(
    'title: "Trust & Continuity (R64 → R125+155+sec12 Hardening)"',
    "const PRICING_TIERS",
  );
  const technicalHero = sectionAfter(
    'data-testid="badge-hero-status"',
    'data-testid="text-hero-title"',
  );

  for (const claim of requiredClaims) {
    const expression = new RegExp(claim.replaceAll("+", "\\+"), "i");
    assert.match(businessTrust, expression);
    assert.match(technicalTrust, expression);
    assert.match(technicalHero, expression);
  }

  assert.doesNotMatch(technicalHero, /R125\+155\+sec9/i);
});

test("the dashboard keeps the newest three release cards visible and archives the next one", () => {
  const home = fs.readFileSync("client/src/pages/home.tsx", "utf8");
  const archive = fs.readFileSync("client/src/components/home-release-archive-recent.tsx", "utf8");
  const visible = home.slice(0, home.indexOf('data-testid="button-toggle-all-updates"'));

  for (const release of ["sec12", "sec10", "sec9"]) {
    assert.match(visible, new RegExp(`R125\\+155\\+${release}`));
  }
  assert.doesNotMatch(visible, /R125\+155\+sec8/);
  assert.match(archive, /R125\+155\+sec8/);
});

test("the current release surfaces use the live 414-tool total", () => {
  const landing = fs.readFileSync("client/src/pages/landing.tsx", "utf8");
  const home = fs.readFileSync("client/src/pages/home.tsx", "utf8");

  assert.match(landing, new RegExp(`Connected tools\", v: \"${TOOL_COUNT}\"`));
  assert.match(home, new RegExp(`\\*\\*${TOOL_COUNT} tools\\*\\*`));
});

test("static SEO, PWA, and feature-document defaults lead with the current release", () => {
  const indexHtml = fs.readFileSync("client/index.html", "utf8");
  const manifest = fs.readFileSync("client/public/manifest.json", "utf8");
  const seoHead = fs.readFileSync("client/src/components/seo-head.tsx", "utf8");
  const featureDoc = fs.readFileSync("scripts/build-features-doc.ts", "utf8");

  for (const source of [indexHtml, manifest, seoHead]) {
    assert.match(source, new RegExp(RELEASE.replaceAll("+", "\\+")));
    assert.match(source, new RegExp(`${TOOL_COUNT} tools`, "i"));
  }
  assert.match(featureDoc, new RegExp(`tools: \"${TOOL_COUNT}`));
  assert.match(featureDoc, new RegExp(RELEASE.replaceAll("+", "\\+")));
  assert.doesNotMatch(indexHtml, /R125\+155\+sec2/);
  assert.doesNotMatch(manifest, /R125\+155\+sec2/);
  assert.match(featureDoc, /bullets:\s*\[\s*"R125\+155\+sec12/);
});

test("the public landing only fetches or renders protected platform stats for an admin tenant", () => {
  assert.match(
    source,
    /const isPlatformAdmin = tenant\?\.isAdmin === true;[\s\S]{0,600}queryKey:\s*\["\/api\/public\/stats"\],[\s\S]{0,160}enabled:\s*isPlatformAdmin,[\s\S]{0,160}const stats = isPlatformAdmin \? fetchedStats : undefined;/,
  );
});
