import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const RELEASE = "R125+155+sec2";
const CURRENT_STATS = [
  "18-agent",
  "413 tools",
  "134 capabilities",
  "155 reference surfaces",
] as const;

const indexHtml = fs.readFileSync("client/index.html", "utf8");
const manifestRaw = fs.readFileSync("client/public/manifest.json", "utf8");
const manifest = JSON.parse(manifestRaw) as { description?: unknown };

function metaContent(attribute: "name" | "property", value: string): string {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = indexHtml.match(
    new RegExp(`<meta\\s+${attribute}="${escaped}"\\s+content="([^"]*)"\\s*/?>`, "i"),
  );
  assert.ok(match, `missing ${attribute}="${value}" metadata`);
  return match[1];
}

test("static HTML and PWA metadata stay synchronized with the current release", () => {
  assert.equal(typeof manifest.description, "string");

  const descriptions = [
    metaContent("name", "description"),
    metaContent("property", "og:description"),
    metaContent("name", "twitter:description"),
    manifest.description,
  ];

  for (const description of descriptions) {
    assert.match(description, new RegExp(RELEASE.replaceAll("+", "\\+")));
    for (const stat of CURRENT_STATS) {
      assert.match(description, new RegExp(stat.replaceAll("+", "\\+"), "i"));
    }
  }

  const jsonLd = indexHtml.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i,
  )?.[1];
  const noScript = indexHtml.match(/<noscript>([\s\S]*?)<\/noscript>/i)?.[1];
  assert.match(jsonLd ?? "", new RegExp(RELEASE.replaceAll("+", "\\+")));
  assert.match(noScript ?? "", new RegExp(RELEASE.replaceAll("+", "\\+")));

  const staticSurfaces = `${indexHtml}\n${manifestRaw}`;
  const staleClaims = [
    /\b16-agent\b/i,
    /\b16\s+(?:specialist\s+)?(?:AI\s+)?agents?\b/i,
    /\b(?:243|391)\s+(?:Enterprise\s+)?tools\b/i,
    /\b62\s+skills\b/i,
    /\b189\s+(?:database\s+)?tables\b/i,
    /\bR77(?:\.\d+)?\b/i,
  ];
  for (const staleClaim of staleClaims) {
    assert.doesNotMatch(staticSurfaces, staleClaim);
  }
});