import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createArrayOverviewSource,
  parseDrizzleOverviewCountResult,
  parseDrizzleOverviewPageResult,
  parsePostgresOverviewCountResult,
  parsePostgresOverviewPageResult,
  readOwnerBusinessOverview,
  type OverviewSection,
  type OverviewSource,
} from "../../server/lib/owner-business-overview";
import { ownerBusinessOverviewDefinition } from "../../server/tools/domains/income-opportunities/definitions";
import { incomeOpportunityDomainTools } from "../../server/tools/domains/income-opportunities/handlers";
import { compressToolOutput } from "../../server/lib/tool-output-compressor";
import { OWNER_SERVICE_OFFERINGS } from "../../server/lib/owner-service-offerings";

const sections: OverviewSection[] = [
  "storedIdeas",
  "builtinIdeas",
  "registeredProducts",
  "builtinProducts",
  "serviceOfferings",
];

function fixtureSources(): Record<OverviewSection, OverviewSource> {
  const records = Object.fromEntries(sections.map((section) => [
    section,
    Array.from({ length: 127 }, (_, index) => {
      const id = index + 1;
      const slug = `${section}-${id}`;
      const sku = `${section}-${id}`;
      const name = `Record ${id}`;
      if (section === "registeredProducts") {
        return { id, sku, product_name: name, price_cents: 100, kind: "static", service_type: null, active: true };
      }
      if (section === "builtinProducts") {
        return { sku, productName: name, priceCents: 100, kind: "static", tagline: "Tagline", description: "Description" };
      }
      if (section === "serviceOfferings") {
        return { id, slug, name, summary: "Summary", availability: "Proposal only" };
      }
      if (section === "storedIdeas") {
        return {
          id, slug, sku, name, source: "felix",
          category: "Assessment", buyer: "Owner", problem: "A bounded test problem",
          entryOffer: "A test offer", nextStep: "Ask for approval", evidence: "Idea",
        };
      }
      return {
        id, slug, sku, name,
        category: "Assessment", buyer: "Owner", problem: "A bounded test problem",
        entryOffer: "A test offer", nextStep: "Ask for approval", evidence: "Catalog",
      };
    }),
  ])) as Record<OverviewSection, unknown[]>;
  return Object.fromEntries(sections.map((section) => [
    section,
    createArrayOverviewSource(records[section]),
  ])) as Record<OverviewSection, OverviewSource>;
}

function assertStringsBelow600(value: unknown): void {
  if (typeof value === "string") {
    assert.ok(value.length < 600, `output string length ${value.length} must stay below compressor trimming limit`);
  } else if (Array.isArray(value)) {
    for (const item of value) assertStringsBelow600(item);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) assertStringsBelow600(item);
  }
}

test("bounded pages traverse more than 100 records and keep sections distinct", async () => {
  const sources = fixtureSources();
  for (const section of ["storedIdeas", "registeredProducts"] as const) {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await readOwnerBusinessOverview(
        { section, ...(cursor ? { cursor } : {}), pageSize: 8 },
        sources,
      );
      assert.equal(result.mode, "page");
      assert.equal(result.section, section);
      assert.ok(result.items.length <= 8);
      assertStringsBelow600(result);
      const serialized = JSON.stringify(result);
      assert.ok(serialized.length <= 5000);
      const compressed = compressToolOutput({
        toolName: "owner_business_overview",
        raw: serialized,
        maxChars: 6000,
        enabled: true,
      });
      assert.equal(compressed.strategy, "passthrough");
      assert.equal(compressed.lossy, false);
      assert.equal(compressed.text, serialized);
      assert.equal(JSON.parse(compressed.text).pagination.returned, result.items.length);
      seen.push(...result.items.map((item: any) => section === "storedIdeas" ? item.slug : item.sku));
      cursor = result.pagination.nextCursor;
    } while (cursor);
    assert.equal(seen.length, 127);
    assert.equal(new Set(seen).size, 127);
  }

  const firstIdeas = await readOwnerBusinessOverview({ section: "storedIdeas" }, sources);
  const firstBuiltinIdeas = await readOwnerBusinessOverview({ section: "builtinIdeas" }, sources);
  assert.notEqual(firstIdeas.items[0].slug, firstBuiltinIdeas.items[0].slug);
});

test("default summary counts every source without fetching or returning record arrays", async () => {
  const sources = fixtureSources();
  let pageCalls = 0;
  for (const source of Object.values(sources)) {
    const page = source.page;
    source.page = async (...args) => {
      pageCalls++;
      return page(...args);
    };
  }
  const result = await readOwnerBusinessOverview({}, sources);
  assert.equal(result.mode, "summary");
  assert.deepEqual(Object.keys(result.counts).sort(), [...sections].sort());
  assert.equal(result.counts.storedIdeas, 127);
  assert.equal(pageCalls, 0);
  assert.equal(JSON.stringify(result).includes("Record 1"), false);
  assert.match(result.evidence.sales, /not checked/i);
  assert.match(result.evidence.duplication, /matching slugs or SKUs/i);
  assertStringsBelow600(result);
  const summaryJson = JSON.stringify(result);
  const compressedSummary = compressToolOutput({
    toolName: "owner_business_overview",
    raw: summaryJson,
    maxChars: 6000,
    enabled: true,
  });
  assert.equal(compressedSummary.text, summaryJson);
  assert.equal(compressedSummary.lossy, false);
  const defaultPage = await readOwnerBusinessOverview({ section: "storedIdeas" }, sources);
  assert.equal(defaultPage.pagination.pageSize, 5);
});

test("late terminal page is an explicit empty page with accurate count", async () => {
  const result = await readOwnerBusinessOverview({
    section: "storedIdeas",
    cursor: "obv1:storedIdeas:127",
    pageSize: 8,
  }, fixtureSources());
  assert.deepEqual(result.items, []);
  assert.equal(result.pagination.totalCount, 127);
  assert.equal(result.pagination.hasMore, false);
  assert.equal(result.pagination.nextCursor, null);
});

test("continuation beyond the validated offset ceiling fails closed", async () => {
  const sources = fixtureSources();
  sources.storedIdeas.count = async () => 100_010;
  sources.storedIdeas.page = async (_offset, limit) => Array.from({ length: limit }, (_, index) => ({
    id: index + 1,
    slug: `idea-${index + 1}`,
    name: "idea",
    source: "felix",
    category: "Assessment",
    buyer: "Owner",
    problem: "A test problem",
    entryOffer: "A test offer",
    nextStep: "Ask",
    evidence: "Idea",
  }));
  const finalSafePage = await readOwnerBusinessOverview({
    section: "storedIdeas",
    cursor: "obv1:storedIdeas:99995",
    pageSize: 8,
  }, sources);
  assert.equal(finalSafePage.items.length, 4);
  assert.equal(finalSafePage.pagination.nextCursor, "obv1:storedIdeas:99999");
  await assert.rejects(readOwnerBusinessOverview({
    section: "storedIdeas",
    cursor: "obv1:storedIdeas:99999",
    pageSize: 8,
  }, sources), /cannot fit safely/);
});

test("canonical identities sharing a 48-character prefix remain exact and distinct", async () => {
  const sources = fixtureSources();
  const prefix = "p".repeat(48);
  assert.equal(prefix.length, 48);
  const rows = [
    { id: 1, slug: `${prefix}-slug-one`, name: `${prefix}-name-one`, category: "Assessment", buyer: "Owner", problem: "Problem", entryOffer: "Offer", nextStep: "Test", evidence: "Idea", source: "felix" },
    { id: 2, slug: `${prefix}-slug-two`, name: `${prefix}-name-two`, category: "Assessment", buyer: "Owner", problem: "Problem", entryOffer: "Offer", nextStep: "Test", evidence: "Idea", source: "felix" },
  ];
  sources.storedIdeas = createArrayOverviewSource(rows);
  const result = await readOwnerBusinessOverview({ section: "storedIdeas", pageSize: 8 }, sources);
  assert.deepEqual(result.items.map((item: any) => item.slug), rows.map((row) => row.slug));
  assert.deepEqual(result.items.map((item: any) => item.name), rows.map((row) => row.name));
  const serialized = JSON.stringify(result);
  assert.ok(serialized.length <= 5000);
  assertStringsBelow600(result);
  const compressed = compressToolOutput({
    toolName: "owner_business_overview",
    raw: serialized,
    maxChars: 6000,
    enabled: true,
  });
  assert.equal(compressed.text, serialized);
  assert.equal(compressed.lossy, false);
});

test("oversized canonical identities fail closed instead of being clipped", async () => {
  const sources = fixtureSources();
  sources.storedIdeas = createArrayOverviewSource([{
    id: 1,
    slug: "s".repeat(600),
    name: "valid name",
    category: "Assessment",
    buyer: "Owner",
    problem: "Problem",
    entryOffer: "Offer",
    nextStep: "Test",
    evidence: "Idea",
    source: "felix",
  }]);
  await assert.rejects(
    readOwnerBusinessOverview({ section: "storedIdeas", pageSize: 1 }, sources),
    /invalid slug; coverage is unknown/,
  );
});

test("registered, built-in product, and service identities remain exact", async () => {
  const cases: Array<{
    section: OverviewSection;
    row: Record<string, unknown>;
    expected: Record<string, unknown>;
  }> = [
    {
      section: "registeredProducts",
      row: {
        id: 41,
        sku: "sku-with-an-exact-long-suffix-that-must-survive",
        product_name: "Registered product full name",
        price_cents: 0,
        kind: "static",
        service_type: null,
        active: true,
      },
      expected: { id: 41, sku: "sku-with-an-exact-long-suffix-that-must-survive", name: "Registered product full name" },
    },
    {
      section: "builtinProducts",
      row: {
        sku: "builtin-sku-with-an-exact-long-suffix",
        productName: "Built-in product full name",
        priceCents: 0,
        kind: "service",
      },
      expected: { sku: "builtin-sku-with-an-exact-long-suffix", name: "Built-in product full name" },
    },
    {
      section: "serviceOfferings",
      row: {
        id: "service-identity",
        slug: "service-slug-exact",
        title: "Service title exact",
        servicePath: "/services/path-exact",
        actionPath: null,
        summary: "proposal-only summary",
        availability: "feature-gated; no-action until approved",
      },
      expected: {
        id: "service-identity",
        slug: "service-slug-exact",
        title: "Service title exact",
        servicePath: "/services/path-exact",
        actionPath: null,
      },
    },
  ];

  for (const { section, row, expected } of cases) {
    const sources = fixtureSources();
    sources[section] = createArrayOverviewSource([row]);
    const result = await readOwnerBusinessOverview({ section, pageSize: 1 }, sources);
    for (const [key, value] of Object.entries(expected)) assert.equal(result.items[0][key], value);
  }
});

test("dynamically fitted prefixes preserve long valid identities and advance by returned rows", async () => {
  const sources = fixtureSources();
  const rows = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    slug: `${"s".repeat(590)}-${index}`,
    name: `${"n".repeat(590)}-${index}`,
    category: "Assessment",
    buyer: "Owner",
    problem: "Problem",
    entryOffer: "Offer",
    nextStep: "Test",
    evidence: "Idea",
    source: "felix",
  }));
  sources.storedIdeas = createArrayOverviewSource(rows);
  const result = await readOwnerBusinessOverview({ section: "storedIdeas", pageSize: 8 }, sources);
  assert.ok(result.items.length > 0 && result.items.length < 8);
  assert.equal(result.pagination.returned, result.items.length);
  assert.equal(result.pagination.nextCursor, `obv1:storedIdeas:${result.items.length}`);
  assert.deepEqual(result.items.map((item: any) => item.slug), rows.slice(0, result.items.length).map((row) => row.slug));
  assert.deepEqual(result.items.map((item: any) => item.name), rows.slice(0, result.items.length).map((row) => row.name));
  const serialized = JSON.stringify(result);
  assert.ok(serialized.length <= 5000);
  assertStringsBelow600(result);
  const compressed = compressToolOutput({
    toolName: "owner_business_overview",
    raw: serialized,
    maxChars: 6000,
    enabled: true,
  });
  assert.equal(compressed.text, serialized);
  assert.equal(compressed.lossy, false);
});

test("static array catalogue sources can be paged without database fallback", async () => {
  const source = createArrayOverviewSource([{ sku: "built-in-a" }, { sku: "built-in-b" }]);
  assert.equal(await source.count(), 2);
  assert.deepEqual(await source.page(1, 1), [{ sku: "built-in-b" }]);
});

test("database count and page result validators reject malformed raw shapes", () => {
  assert.equal(parseDrizzleOverviewCountResult([{ total: 3 }]), 3);
  assert.equal(parseDrizzleOverviewCountResult([{ total: "12" }]), 12);
  assert.equal(parsePostgresOverviewCountResult({ rows: [{ total: "0" }] }), 0);
  assert.deepEqual(parsePostgresOverviewPageResult({ rows: [] }), []);
  assert.deepEqual(parseDrizzleOverviewPageResult([]), []);

  for (const raw of [
    null, {}, [], [null], [{}], [{ total: null }], [{ total: "" }], [{ total: " " }],
    [{ total: -1 }], [{ total: 1.5 }], [{ total: Number.NaN }], [{ total: Infinity }],
    [{ total: "-1" }], [{ total: "1.5" }], [{ total: "9007199254740992" }],
    [{ total: true }], [{ total: 1 }, { total: 2 }],
  ]) {
    assert.throws(() => parseDrizzleOverviewCountResult(raw));
  }
  for (const raw of [
    null, {}, { rows: null }, { rows: {} }, { rows: [] }, { rows: [null] }, { rows: [{}] },
    { rows: [{ total: null }] }, { rows: [{ total: "" }] }, { rows: [{ total: " " }] },
    { rows: [{ total: -1 }] }, { rows: [{ total: 1.5 }] }, { rows: [{ total: "1.5" }] },
    { rows: [{ total: "9007199254740992" }] }, { rows: [{ total: 1 }, { total: 2 }] },
  ]) {
    assert.throws(() => parsePostgresOverviewCountResult(raw));
  }
  for (const raw of [null, {}, { rows: null }, { rows: "not-an-array" }, { rows: {} }]) {
    assert.throws(() => parsePostgresOverviewPageResult(raw));
  }
  for (const raw of [null, {}, { rows: [] }, "not-an-array"]) {
    assert.throws(() => parseDrizzleOverviewPageResult(raw));
  }
});

test("real service directory pages preserve summary and availability qualifications losslessly", async () => {
  const sources = fixtureSources();
  sources.serviceOfferings = createArrayOverviewSource(OWNER_SERVICE_OFFERINGS);
  const returned: any[] = [];
  let cursor: string | undefined;
  do {
    const result = await readOwnerBusinessOverview({
      section: "serviceOfferings",
      ...(cursor ? { cursor } : {}),
      pageSize: 8,
    }, sources);
    const serialized = JSON.stringify(result);
    assert.ok(serialized.length <= 5000);
    assertStringsBelow600(result);
    const compressed = compressToolOutput({
      toolName: "owner_business_overview",
      raw: serialized,
      maxChars: 6000,
      enabled: true,
    });
    assert.equal(compressed.text, serialized);
    assert.equal(compressed.lossy, false);
    returned.push(...result.items);
    cursor = result.pagination.nextCursor;
  } while (cursor);

  assert.equal(returned.length, OWNER_SERVICE_OFFERINGS.length);
  OWNER_SERVICE_OFFERINGS.forEach((source: any, index) => {
    assert.equal(returned[index].summary, source.summary);
    assert.equal(returned[index].availability, source.availability);
    for (const key of ["id", "slug", "sku", "name", "title", "servicePath", "service_path", "path", "actionPath"]) {
      if (source[key] !== undefined) assert.equal(returned[index][key], source[key]);
    }
  });
  assert.ok(returned.every((item) => item.name || item.title));
});

test("invalid and over-cap pagination arguments fail closed", async () => {
  const sources = fixtureSources();
  for (const params of [
    { pageSize: true },
    { section: "storedIdeas", pageSize: Number.NaN },
    { section: "storedIdeas", pageSize: Number.POSITIVE_INFINITY },
    { section: "storedIdeas", pageSize: 1.5 },
    { section: "storedIdeas", pageSize: 9 },
    { section: "storedIdeas", cursor: "obv1:registeredProducts:10" },
    { section: "storedIdeas", cursor: "obv1:storedIdeas:100001" },
    { surprise: "storedIdeas" },
    { cursor: "obv1:storedIdeas:0" },
  ]) {
    await assert.rejects(readOwnerBusinessOverview(params, sources));
  }
});

test("tool arguments expose strict bounded section pagination", () => {
  const parameters = ownerBusinessOverviewDefinition.function.parameters;
  assert.equal(parameters.additionalProperties, false);
  assert.deepEqual(parameters.properties.section.enum, sections);
  assert.equal(parameters.properties.pageSize.minimum, 1);
  assert.equal(parameters.properties.pageSize.maximum, 8);
  assert.equal(parameters.required.length, 0);
});

test("wrong role is rejected before overview collaborators are loaded", async () => {
  const overviewTool = incomeOpportunityDomainTools.find(
    (tool) => tool.definition.function.name === "owner_business_overview",
  );
  assert.ok(overviewTool);
  const result = await overviewTool.handler({}, { tenantId: 1, personaId: 1 });
  assert.match(result.error, /Owner Felix context required/);
});

test("database page and count collaborators bind every query to the owner tenant", () => {
  const income = fs.readFileSync(path.resolve("server/lib/income-opportunities.ts"), "utf8");
  const commerce = fs.readFileSync(path.resolve("server/lib/commerce-catalog.ts"), "utf8");
  const handlers = fs.readFileSync(
    path.resolve("server/tools/domains/income-opportunities/handlers.ts"),
    "utf8",
  );
  assert.match(income, /countStoredIncomeOpportunities[\s\S]*?where\(eq\(incomeOpportunities\.tenantId, tenantId\)\)/);
  assert.match(income, /readStoredIncomeOpportunityPage[\s\S]*?where\(eq\(incomeOpportunities\.tenantId, tenantId\)\)/);
  assert.match(income, /return parseDrizzleOverviewCountResult\(result\)/);
  assert.match(income, /return parseDrizzleOverviewPageResult\(result\)/);
  assert.match(commerce, /COUNT\(\*\)::text AS total[\s\S]*?WHERE tenant_id = \$\{tenantId\}/);
  assert.match(commerce, /readProductsPageForOverview[\s\S]*?WHERE tenant_id = \$\{tenantId\}/);
  assert.match(commerce, /return parsePostgresOverviewCountResult\(result\)/);
  assert.match(commerce, /return parsePostgresOverviewPageResult\(result\)/);
  const overviewCommerce = commerce.slice(
    commerce.indexOf("export async function countProductsForOverview"),
    commerce.indexOf("export async function getProductBySku"),
  );
  assert.doesNotMatch(overviewCommerce, /rows\s*\|\|\s*\[\]/);
  assert.match(handlers, /countStoredIncomeOpportunities\(tenantId\)/);
  assert.match(handlers, /countProductsForOverview\(tenantId\)/);
});

test("partial count or page failure is not converted into empty-success", async () => {
  const sources = fixtureSources();
  sources.registeredProducts.count = async () => { throw new Error("database unavailable"); };
  await assert.rejects(readOwnerBusinessOverview({}, sources), /database unavailable/);

  const pageSources = fixtureSources();
  pageSources.storedIdeas.page = async () => { throw new Error("page unavailable"); };
  await assert.rejects(readOwnerBusinessOverview({ section: "storedIdeas" }, pageSources), /page unavailable/);
});

test("malformed source records fail closed rather than becoming empty projected items", async () => {
  for (const malformed of [
    null,
    { id: 1, slug: "missing-name" },
    { id: 1, slug: "wrong-name-type", name: 42 },
    { id: {}, slug: "wrong-id-type", name: "Valid name" },
  ]) {
    const sources = fixtureSources();
    sources.storedIdeas.count = async () => 1;
    sources.storedIdeas.page = async () => [malformed];
    await assert.rejects(
      readOwnerBusinessOverview({ section: "storedIdeas", pageSize: 1 }, sources),
      /Malformed storedIdeas record.*coverage is unknown/,
    );
  }
});

test("valid product identities with malformed attributes fail closed", async () => {
  const invalidRows: Array<{ section: OverviewSection; row: Record<string, unknown> }> = [
    {
      section: "registeredProducts",
      row: { id: 1, sku: "registered-sku", product_name: "Registered", price_cents: -1, kind: "static", service_type: null, active: true },
    },
    {
      section: "registeredProducts",
      row: { id: 1, sku: "registered-sku", product_name: "Registered", price_cents: 0, kind: "static", service_type: null, active: "true" },
    },
    {
      section: "registeredProducts",
      row: { id: 1, sku: "registered-sku", product_name: "Registered", price_cents: 0, kind: "digital", service_type: null, active: true },
    },
    {
      section: "registeredProducts",
      row: { id: 1, sku: "registered-sku", product_name: "Registered", price_cents: Number.NaN, kind: "static", service_type: null, active: true },
    },
    {
      section: "registeredProducts",
      row: { id: 1, sku: "registered-sku", product_name: "Registered", price_cents: Infinity, kind: "static", service_type: null, active: true },
    },
    {
      section: "registeredProducts",
      row: { id: 1, sku: "registered-sku", product_name: "Registered", price_cents: 0, kind: "static", service_type: {}, active: true },
    },
    {
      section: "builtinProducts",
      row: { sku: "builtin-sku", productName: "Built-in", priceCents: -1, kind: "service" },
    },
    {
      section: "builtinProducts",
      row: { sku: "builtin-sku", productName: "Built-in", priceCents: 1, kind: "unknown-kind" },
    },
    {
      section: "builtinProducts",
      row: { sku: "builtin-sku", productName: "Built-in", priceCents: 1, kind: "static", description: {} },
    },
  ];
  for (const { section, row } of invalidRows) {
    const sources = fixtureSources();
    sources[section] = createArrayOverviewSource([row]);
    await assert.rejects(
      readOwnerBusinessOverview({ section, pageSize: 1 }, sources),
      /Malformed .*coverage is unknown/,
    );
  }
});

test("idea attributes enforce source types while absent or nullable optionals remain valid", async () => {
  const sources = fixtureSources();
  sources.storedIdeas = createArrayOverviewSource([{
    id: 1,
    slug: "valid-idea",
    name: "Valid idea",
    category: "Assessment",
    buyer: "Owner",
    problem: "Problem",
    entryOffer: "Offer",
    price: null,
    nextStep: "Test",
    evidence: "Idea",
    source: "felix",
  }]);
  const result = await readOwnerBusinessOverview({ section: "storedIdeas", pageSize: 1 }, sources);
  assert.equal(result.items[0].price, undefined);

  for (const badField of [
    { category: {} },
    { problem: 42 },
    { evidence: false },
    { source: [] },
  ]) {
    const badSources = fixtureSources();
    badSources.storedIdeas = createArrayOverviewSource([{
      id: 1,
      slug: "valid-idea",
      name: "Valid idea",
      category: "Assessment",
      buyer: "Owner",
      problem: "Problem",
      entryOffer: "Offer",
      nextStep: "Test",
      evidence: "Idea",
      source: "felix",
      ...badField,
    }]);
    await assert.rejects(
      readOwnerBusinessOverview({ section: "storedIdeas", pageSize: 1 }, badSources),
      /Malformed storedIdeas.*coverage is unknown/,
    );
  }
});

test("page projection is bounded, allowlisted, and never leaks nested/private fields", async () => {
  const sources = fixtureSources();
  sources.storedIdeas.page = async (_offset, limit) => Array.from({ length: limit }, (_, index) => ({
    id: index + 1,
    slug: `idea-${index}`,
    name: `Valid idea ${index}`,
    category: "Assessment",
    buyer: "Owner",
    problem: "P".repeat(10000),
    entryOffer: "E".repeat(10000),
    nextStep: "N".repeat(10000),
    evidence: "Idea",
    source: "felix",
    category: "C".repeat(10000),
    buyer: "B".repeat(10000),
    problem: "P".repeat(10000),
    entryOffer: "E".repeat(10000),
    price: "R".repeat(10000),
    expansion: "X".repeat(10000),
    nextStep: "S".repeat(10000),
    evidence: "V".repeat(10000),
    source: "T".repeat(10000),
    privateNotes: "must not leak",
    nested: { token: "must not leak" },
  }));
  const result = await readOwnerBusinessOverview({ section: "storedIdeas", pageSize: 8 }, sources);
  const serialized = JSON.stringify(result);
  assert.ok(serialized.length <= 5000);
  assertStringsBelow600(result);
  const compressed = compressToolOutput({
    toolName: "owner_business_overview",
    raw: serialized,
    maxChars: 6000,
    enabled: true,
  });
  assert.equal(compressed.text, serialized);
  assert.equal(compressed.lossy, false);
  assert.equal(JSON.stringify(result).includes("must not leak"), false);
  assert.ok(result.items[0].name.length < 10000);
  assert.equal(result.items[0].textTruncated, true);
  assert.equal(result.items[0].privateNotes, undefined);
  assert.equal(result.pagination.returned, result.items.length);
});