import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLatestRun } from "../../client/src/lib/latest-run-confirmation";

test("one click reads the newest run and its confirmation without replaying actions", async () => {
  const calls: string[] = [];
  const run = { id: 19, objective: "Prepare report", status: "completed" };
  const confirmation = { version: 1, status: "unverified", scope: "trace",
    subjectDigest: "abc", checks: [], limitations: [] };
  const result = await checkLatestRun(async (url, init) => {
    calls.push(url);
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "include");
    return Response.json(calls.length === 1 ? { runs: [run] } : { ...run, confirmation });
  });
  assert.deepEqual(calls, ["/api/agent-insights/runs?limit=1", "/api/agent-insights/runs/19"]);
  assert.deepEqual(result, { run, confirmation });
});

test("no saved run returns an empty state without requesting details", async () => {
  let calls = 0;
  assert.equal(await checkLatestRun(async () => {
    calls++;
    return Response.json({ runs: [] });
  }), null);
  assert.equal(calls, 1);
});

test("request failures and malformed evidence never become a success", async () => {
  for (const status of [401, 403, 500]) {
    await assert.rejects(checkLatestRun(async () => new Response(null, { status })));
  }
  for (const body of [{}, { runs: [null] }, { runs: [{ id: "../2" }] }]) {
    await assert.rejects(checkLatestRun(async () => Response.json(body)));
  }
});

test("detail must match selected identity and missing receipts stay missing", async () => {
  for (const detail of [
    { id: 18, status: "completed" },
    { id: 19, status: "completed", confirmation: { status: "confirmed", checks: [null] } },
    { id: 19, status: "completed", confirmation: { status: "green", checks: [] } },
  ]) {
    await assert.rejects(checkLatestRun(async (url) => Response.json(
      url.includes("?") ? { runs: [{ id: 19 }] } : detail,
    )));
  }
  const result = await checkLatestRun(async (url) => Response.json(
    url.includes("?") ? { runs: [{ id: 19 }] } : { id: 19, status: "completed" },
  ));
  assert.equal(result?.confirmation, undefined);
});
