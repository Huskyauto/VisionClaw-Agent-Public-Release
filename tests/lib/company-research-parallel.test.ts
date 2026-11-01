import test from "node:test";
import assert from "node:assert/strict";
import { researchCompanyPackageBatch } from "../../server/lib/company-report-research-batch";

test("distinct browser systems claim separate pages concurrently and serialize durable captures", async () => {
  const root = "https://example.test/";
  const urls = Array.from({ length: 6 }, (_, i) => `${root}service-${i}`);
  const gates: (() => void)[] = [], engines = new Set<string>(), visits = new Set<string>();
  let active = 0, peak = 0, writes = 0, peakWrites = 0;
  const lane = (engine: string) => ({ engine, browse: async (p: any) => {
    if (p.action === "close_session") return { ok: true };
    assert.ok(!visits.has(p.url)); visits.add(p.url); engines.add(engine);
    active++; peak = Math.max(peak, active);
    if (gates.length < 3) await new Promise<void>(resolve => gates.push(resolve));
    active--;
    return { ok: true, tabId: engine, url: p.url, snapshot: "Public company service details and reliable operating information. ".repeat(5) };
  } });
  const run = researchCompanyPackageBatch({ company: "Fixture", website: root }, 1, 42, {
    prior: { evidence: { version: 1, capturedAt: "fixture", sources: [], limitations: [] },
      map: { root, resumeVersion: 1, urls, pages: [], sitemapFiles: [], sitemapQueue: [], discoveryComplete: true } },
    collect: async () => { throw new Error("saved evidence must be reused"); },
    live: async () => {}, fetch: async () => ({ ok: true, text: "<html></html>" }),
    browse: async () => { throw new Error("must use selected lanes"); },
    browserLanes: [lane("camofox-a"), lane("camofox-b"), lane("remote-chromium")],
    checkpoint: async () => {
      writes++; peakWrites = Math.max(peakWrites, writes);
      await new Promise(resolve => setImmediate(resolve)); writes--;
    },
  });
  for (let i = 0; i < 100 && gates.length < 3; i++) await new Promise(resolve => setImmediate(resolve));
  const simultaneous = gates.length;
  gates.forEach(release => release());
  const result = await run;
  assert.equal(simultaneous, 3);
  assert.equal(peak, 3);
  assert.equal(engines.size, 3);
  assert.equal(peakWrites, 1);
  assert.equal(result.coverage.reviewed, 6);
  assert.equal(new Set(result.evidence.sources.map(source => source.id)).size, result.evidence.sources.length);
});
