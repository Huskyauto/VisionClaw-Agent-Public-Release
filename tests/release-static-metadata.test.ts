import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { extractToolNamesStatic } from "../scripts/lib/tool-source-files";

const RELEASE = "R125+155+sec12";
const CURRENT_STATS = [
  "18-agent",
  "414 tools",
  "135 capabilities",
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
  const structuredData = JSON.parse(jsonLd ?? "{}") as { featureList?: unknown };
  assert.ok(Array.isArray(structuredData.featureList));
  assert.deepEqual(
    structuredData.featureList.slice(0, 3),
    [
      "18 Specialist AI Agents with Distinct Personalities",
      "414 Enterprise Tools, 135 Capabilities, and 155 Reference Surfaces",
      "175 Declared / 230 Live Database Tables, 686 Platform Indexes, and 41 Governance Rules",
    ],
  );

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

test("the totals refresh uses the dependency-light unique tool source union", () => {
  const refreshTotals = fs.readFileSync("scripts/refresh-totals.ts", "utf8");
  const { names: toolNames, duplicates } = extractToolNamesStatic();

  assert.match(refreshTotals, /from "\.\/lib\/tool-source-files"/);
  assert.match(refreshTotals, /extractToolNamesStatic\(\)/);
  assert.match(refreshTotals, /duplicate tool definitions/);
  assert.match(refreshTotals, /FROM capabilities WHERE is_active=true/);
  assert.doesNotMatch(refreshTotals, /from "\.\.\/server\/tools"/);
  assert.equal(toolNames.length, 414);
  assert.equal(new Set(toolNames).size, toolNames.length);
  assert.deepEqual(duplicates, []);
});

test("current public totals share the complete authoritative platform snapshot", () => {
  const readme = fs.readFileSync("README-PUBLIC.md", "utf8");
  const roadmap = fs.readFileSync("ROADMAP.md", "utf8");
  const forkSetup = fs.readFileSync("FORK-SETUP.md", "utf8");
  const landing = fs.readFileSync("client/src/pages/landing.tsx", "utf8");
  const about = fs.readFileSync("client/src/pages/about.tsx", "utf8");
  const seo = fs.readFileSync("client/src/components/seo-head.tsx", "utf8");
  const featureDoc = fs.readFileSync("scripts/build-features-doc.ts", "utf8");

  for (const text of [readme, roadmap, forkSetup]) {
    assert.match(text, /175 declared \/ 230 live (?:database )?tables/i);
    assert.match(text, /686 platform indexes/i);
    assert.match(text, /135 active capabilities/i);
  }
  assert.match(readme, /76 curated AI models/i);
  assert.match(roadmap, /76 curated AI models/i);
  assert.doesNotMatch(readme, /\b67 curated\b/i);
  assert.doesNotMatch(readme, /\b135 declared\b/i);
  assert.match(landing, /Platform Online — 18 Agents, 414 Tools, 175 Declared \/ 230 Live Tables, 686 Platform Indexes, 135 Capabilities, 67 Platform Skills, 155 Reference Surfaces, 41 Governance Rules/);
  assert.match(landing, /414 tools, 67 platform skills and 155 reference surfaces/i);
  assert.match(landing, /powered by 76 curated AI models/i);
  assert.match(landing, /76 Curated AI Models \+ 1000\+ Daily Discovery/);
  assert.doesNotMatch(landing, /\b67 curated AI models\b/i);
  assert.doesNotMatch(landing, /\b67-model curated registry\b/i);
  assert.match(landing, /Active capabilities", v: "135"/);
  assert.match(landing, /Database tables", v: "175 declared \/ 230 live tables"/);
  assert.match(landing, /Model routes", v: "76\+1000"/);
  assert.match(landing, /const models = useCountUp\(76/);
  assert.match(landing, /const skills = useCountUp\(67/);
  assert.match(landing, /const capabilities = useCountUp\(135/);
  assert.match(landing, /Live DB Tables/);
  assert.match(landing, /> 135 active capabilities</);
  assert.match(landing, /self-evolving AI corporation with 414 tools/i);
  assert.match(landing, /label === "Production tools" \? "414" : value/);
  assert.match(about, /414 tools, 135 active capabilities, 175 declared \/ 230 live tables, 686 platform indexes, and 76 curated AI models/i);
  assert.match(about, /414 tools and 76 curated AI models in the registry/i);
  assert.match(about, /76 curated AI models from OpenAI/i);
  assert.doesNotMatch(about, /\b67 curated AI models\b/i);
  assert.match(seo, /414 tools, 135 capabilities, and 155 reference surfaces/i);
  assert.match(featureDoc, /capabilities: "135"/);
  assert.match(featureDoc, /tables: "175 declared \/ 230 live"/);
  assert.match(featureDoc, /indexes: "686"/);
  assert.match(featureDoc, /models: "76 curated \+ 1000\+"/);
});