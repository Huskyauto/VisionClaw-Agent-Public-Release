import test from "node:test";
import assert from "node:assert/strict";
import { researchCompanyPackageBatch } from "../../server/lib/company-report-research-batch";
import { companyResearchBrowserLanes } from "../../server/lib/company-research-browser";
import { companyResearchDeadline } from "../../server/lib/company-research-deadline";
import { initialWorkspaceState, WorkspaceCoordinator } from "../../server/lib/browser-workspace";

test("a hung browser cannot renew research forever or persist a late result", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const root = "https://example.test/";
  let release!: (value: any) => void;
  let entered!: () => void;
  const browsing = new Promise<void>(resolve => { entered = resolve; });
  let writes = 0;
  const run = researchCompanyPackageBatch({ company: "Fixture", website: root }, 1, 42, {
    prior: { evidence: { version: 1, capturedAt: "fixture", sources: [], limitations: [] },
      map: { root, resumeVersion: 1, urls: [root], pages: [], sitemapFiles: [],
        sitemapQueue: [], discoveryComplete: true } },
    collect: async () => { throw new Error("must reuse evidence"); },
    live: async () => {},
    fetch: async () => ({ ok: false }),
    browse: async () => {
      entered();
      return new Promise(resolve => { release = resolve; });
    },
    checkpoint: async () => { writes++; },
  });
  // Attach rejection handling before advancing the clock.
  const outcome = run.then(() => "unexpected completion", error => error.code);
  await browsing;
  t.mock.timers.tick(180_001);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await Promise.race([outcome, Promise.resolve("still stuck")]), "COMPANY_RESEARCH_TIMEOUT");
  const saved = writes;
  release({ ok: true, tabId: "late", url: root, snapshot: "Company service information. ".repeat(20) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, saved, "timed-out browser results must not mutate durable research");
});

test("production browser selection never races two Camofox actions against one tenant lock", () => {
  const lanes = companyResearchBrowserLanes(async () => ({ ok: false }));
  assert.equal(lanes.filter(lane => lane.engine === "camofox").length, 1);
});

for (const stuckAt of ["fetch", "cleanup"] as const) {
  test(`hung ${stuckAt} stops explicitly after preserving successful sibling pages`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const root = "https://example.test/";
    let entered!: () => void;
    const stuck = new Promise<void>(resolve => { entered = resolve; });
    let release!: (value: any) => void;
    let saved: any;
    const snapshot = "Our team provides scheduled repair and maintenance services for local businesses. ".repeat(5);
    const run = researchCompanyPackageBatch({ company: "Fixture", website: root }, 1, 42, {
      prior: { evidence: { version: 1, capturedAt: "fixture", sources: [], limitations: [] },
        map: { root, resumeVersion: 1, urls: [root, `${root}services`], pages: [], sitemapFiles: [],
          sitemapQueue: [], discoveryComplete: true } },
      collect: async () => { throw new Error("must reuse evidence"); },
      live: async () => {},
      fetch: async url => {
        if (stuckAt === "fetch" && url.endsWith("services")) {
          entered();
          return new Promise(resolve => { release = resolve; });
        }
        return { ok: true, text: "<html></html>" };
      },
      browse: async params => {
        if (stuckAt === "cleanup" && params.action === "close_session") {
          entered();
          return new Promise(resolve => { release = resolve; });
        }
        return { ok: true, tabId: "fixture", url: params.url, snapshot };
      },
      checkpoint: async value => { saved = structuredClone(value); },
    });
    const outcome = run.then(() => "unexpected completion", error => error.code);
    await stuck;
    t.mock.timers.tick(180_001);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await Promise.race([outcome, Promise.resolve("still stuck")]), "COMPANY_RESEARCH_TIMEOUT");
    assert.ok(saved.coverage.reviewed >= 1, "previously verified pages survive timeout");
    const retained = JSON.stringify(saved);
    release({ ok: true, text: "<html>late</html>" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(JSON.stringify(saved), retained);
  });
}

test("a different in-flight lane cannot return a successful value after a sibling timeout", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const clock = companyResearchDeadline();
  let release!: (value: string) => void;
  const first = clock.read("first lane", 10, () => new Promise<never>(() => {}))
    .catch(error => error.code);
  const sibling = clock.read("second lane", 100, () => new Promise<string>(resolve => { release = resolve; }))
    .then(() => "late success", error => error.code);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(11);
  assert.equal(await first, "COMPANY_RESEARCH_TIMEOUT");
  release("late page");
  assert.equal(await sibling, "COMPANY_RESEARCH_TIMEOUT");
});

test("the optional remote engine honors actual human-control state before any rendering", async () => {
  let mode: "human" | "agent" = "human", renders = 0;
  const workspace = new WorkspaceCoordinator({
    exclusive: async (_tenant, fn) => fn({
      read: async () => ({ ...initialWorkspaceState(1), mode }),
      write: async () => { throw new Error("read-only render must not alter controls"); },
    }),
  });
  const lanes = companyResearchBrowserLanes(async () => ({ ok: false }), {
    config: { enabled: true, defaultProfile: "remote", profiles: { remote: { cdpUrl: "wss://example.test/" } } } as any,
    workspace,
    render: async () => { renders++; return { ok: true }; },
  });
  assert.equal(lanes[0].exclusiveGroup, lanes[1].exclusiveGroup);
  const params = { action: "open", url: "https://example.test/", _tenantId: 1 };
  await assert.rejects(lanes[1].browse(params), /human control/);
  assert.equal(renders, 0);
  mode = "agent";
  assert.equal((await lanes[1].browse(params)).ok, true);
  assert.equal(renders, 1);
});

test("lanes sharing a tenant coordinator queue rather than consume busy failures", async () => {
  const root = "https://example.test/";
  let active = 0, peak = 0;
  const browse = async (params: any) => {
    if (params.action === "close_session") return { ok: true };
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { ok: true, tabId: "fixture", url: params.url,
      snapshot: "Company services and local business operating information. ".repeat(5) };
  };
  const result = await researchCompanyPackageBatch({ company: "Fixture", website: root }, 1, 42, {
    prior: { evidence: { version: 1, capturedAt: "fixture", sources: [], limitations: [] },
      map: { root, resumeVersion: 1, urls: [root, `${root}services`, `${root}about`], pages: [],
        sitemapFiles: [], sitemapQueue: [], discoveryComplete: true } },
    collect: async () => { throw new Error("must reuse evidence"); },
    live: async () => {},
    fetch: async () => ({ ok: true, text: "<html></html>" }),
    browse,
    browserLanes: ["camofox", "remote"].map(engine => ({ engine, exclusiveGroup: "same-tenant", browse })),
    checkpoint: async () => {},
  });
  assert.equal(peak, 1);
  assert.equal(result.coverage.reviewed, 3);
  assert.equal(result.coverage.failed, 0);
});

test("expired queued cleanup never deletes a session after hung navigation settles late", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const root = "https://example.test/";
  let entered!: () => void, release!: (value: any) => void, closes = 0;
  const navigating = new Promise<void>(resolve => { entered = resolve; });
  const browse = async (params: any) => {
    if (params.action === "close_session") { closes++; return { ok: true }; }
    if (params.action === "navigate") {
      entered();
      return new Promise(resolve => { release = resolve; });
    }
    return { ok: true, tabId: "fixture", url: params.url,
      snapshot: "Company services and local business operating information. ".repeat(5) };
  };
  const run = researchCompanyPackageBatch({ company: "Fixture", website: root }, 1, 42, {
    prior: { evidence: { version: 1, capturedAt: "fixture", sources: [], limitations: [] },
      map: { root, resumeVersion: 1, urls: [root, `${root}services`], pages: [], sitemapFiles: [],
        sitemapQueue: [], discoveryComplete: true } },
    collect: async () => { throw new Error("must reuse evidence"); },
    live: async () => {}, fetch: async () => ({ ok: true, text: "<html></html>" }),
    browse, browserLanes: [{ engine: "camofox", exclusiveGroup: "tenant-browser", browse }],
    checkpoint: async () => {},
  });
  const outcome = run.then(() => "unexpected completion", error => error.code);
  await navigating;
  t.mock.timers.tick(75_001);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(10_001);
  assert.equal(await outcome, "COMPANY_RESEARCH_TIMEOUT");
  release({ ok: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closes, 0, "expired queued cleanup cannot become a late remote delete");
});
