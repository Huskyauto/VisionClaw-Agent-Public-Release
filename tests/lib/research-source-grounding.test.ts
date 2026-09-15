import assert from "node:assert/strict";
import test from "node:test";

import {
  auditResearchCitations,
  normalizeResearchSources,
  shouldSynthesizeResearch,
} from "../../server/research-pipeline";

test("research sources preserve provider metadata and receive stable citation ids", () => {
  const sources = normalizeResearchSources([
    {
      query: "battery recycling policy",
      result: {
        provider: "example-search",
        results: [
          {
            title: "Battery recycling rules",
            url: "https://example.gov/rules/#overview",
            description: "Current requirements",
            date: "2026-08-20",
          },
          {
            title: "Duplicate URL",
            url: "https://example.gov/rules/",
            description: "Duplicate result",
          },
        ],
      },
    },
  ], "2026-09-06T00:00:00.000Z");

  assert.deepEqual(sources, [{
    id: "S1",
    title: "Battery recycling rules",
    url: "https://example.gov/rules",
    description: "Current requirements",
    snippet: "Current requirements",
    publishedDate: "2026-08-20",
    retrievedAt: "2026-09-06T00:00:00.000Z",
    provider: "example-search",
    reliability: "medium",
    resolution: "unresolved",
  }]);
});

test("citation audit exposes unsupported source ids", () => {
  const audit = auditResearchCitations(
    "The rule changed in August [S1]. A second claim uses an invented source [S99].",
    [{ id: "S1", resolution: "resolved" }],
  );

  assert.deepEqual(audit, {
    citedSourceIds: ["S1", "S99"],
    resolvedSourceIds: ["S1"],
    unresolvedSourceIds: ["S99"],
    citationCount: 2,
    resolvedCitationCount: 1,
    coveragePercent: 50,
    hasCitations: true,
  });
});

test("citation audit rejects noncanonical aliases of issued source ids", () => {
  const audit = auditResearchCitations(
    "This uses a padded alias [S01] instead of the issued id.",
    [{ id: "S1", resolution: "resolved" }],
  );

  assert.deepEqual(audit.resolvedSourceIds, []);
  assert.deepEqual(audit.unresolvedSourceIds, ["S01"]);
  assert.equal(audit.coveragePercent, 0);
});

test("source normalization has a deterministic hard result cap", () => {
  const sources = normalizeResearchSources([{
    query: "large result",
    result: {
      provider: "example-search",
      results: Array.from({ length: 40 }, (_, index) => ({
        title: `Result ${index}`,
        url: `https://example.com/result/${index}`,
        description: "x".repeat(4_000),
      })),
    },
  }], "2026-09-06T00:00:00.000Z");

  assert.equal(sources.length, 20);
  assert.ok(sources.every((source) => source.description.length <= 1_000));
});

test("source normalization safely bounds circular provider payloads", () => {
  const circular: Record<string, unknown> = {
    provider: "legacy",
    content: Array.from(
      { length: 100 },
      (_, index) => `https://example.com/citation/${index}`,
    ).join(" "),
  };
  circular.self = circular;

  const sources = normalizeResearchSources(
    [{ query: "legacy result", result: circular }],
    "2026-09-06T00:00:00.000Z",
  );

  assert.equal(sources.length, 20);
  assert.equal(sources[0].url, "https://example.com/citation/0");
});

test("source normalization stops traversing provider payloads at the object cap", () => {
  const results = Array.from({ length: 150 }, (_, index) => ({
    title: `Result ${index}`,
    url: `https://example.com/result/${index}`,
  }));
  Object.defineProperty(results, "150", {
    enumerable: true,
    get() {
      throw new Error("traversed beyond the object cap");
    },
  });

  assert.doesNotThrow(() => normalizeResearchSources([{
    query: "wide result",
    result: { provider: "example-search", results },
  }]));
});

test("source normalization bounds visits across wide primitive payloads", () => {
  const values = Array.from({ length: 150 }, (_, index) => `value-${index}`);
  Object.defineProperty(values, "150", {
    enumerable: true,
    get() {
      throw new Error("traversed beyond the visit cap");
    },
  });

  assert.doesNotThrow(() => normalizeResearchSources([{
    query: "wide primitive result",
    result: { provider: "example-search", values },
  }]));
});

test("research synthesis requires at least one successfully resolved source", () => {
  assert.equal(shouldSynthesizeResearch([{ resolution: "unresolved" }]), false);
  assert.equal(shouldSynthesizeResearch([{ resolution: "resolved" }]), true);
});