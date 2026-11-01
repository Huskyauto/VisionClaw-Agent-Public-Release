import test from "node:test";
import assert from "node:assert/strict";
import { submitCompanyPackage } from "../../client/src/lib/company-package-submit";

const body = JSON.stringify({
  requestId: "9c6d7b88-3fc7-4cfa-9d77-1b8143f14444",
  company: "Synthetic company", website: "https://example.com/",
  acceptResearchCost: true, modelBudgetUsd: 150,
});
const pause = async () => {};

test("lost response after admission retries identical bytes and receives the same job, not another paid run", async () => {
  const admitted = new Map<string, number>();
  const requests: string[] = [];
  const response = await submitCompanyPackage(body, async (url, init) => {
    assert.equal(url, "/api/admin/company-report-packages");
    assert.equal(init.method, "POST");
    const bytes = String(init.body);
    requests.push(bytes);
    const input = JSON.parse(bytes);
    if (!admitted.has(input.requestId)) admitted.set(input.requestId, admitted.size + 1);
    if (requests.length === 1) return new Response("Bad Gateway", { status: 502 });
    return Response.json({ id: admitted.get(input.requestId), status: "pending" }, { status: 202 });
  }, pause);
  assert.equal(response.status, 202);
  assert.deepEqual(requests, [body, body]);
  assert.equal(admitted.size, 1);
  assert.equal((await response.json()).id, 1);
});

test("repeated gateway errors stop after two calls and preserve the final response", async () => {
  let calls = 0;
  const response = await submitCompanyPackage(body, async () => {
    calls++;
    return new Response(null, { status: 504 });
  }, pause);
  assert.equal(calls, 2);
  assert.equal(response.status, 504);
});

test("network failure gets only one same-body admission retry", async () => {
  const requests: unknown[] = [];
  await assert.rejects(submitCompanyPackage(body, async (_url, init) => {
    requests.push(init.body);
    throw new TypeError("Failed to fetch");
  }, pause), /Check Recent packages.*retry without editing/);
  assert.deepEqual(requests, [body, body]);
});

test("application failures, authorization, quota and success are not automatically retried", async () => {
  for (const status of [202, 400, 401, 403, 409, 429, 500, 503]) {
    let calls = 0;
    const response = await submitCompanyPackage(body, async () => {
      calls++;
      return new Response(null, { status, headers: { "x-app-origin": "express" } });
    }, pause);
    assert.equal(response.status, status);
    assert.equal(calls, 1);
  }
});

test("changed authentication aborts retry rather than resubmitting under a new identity", async () => {
  let calls = 0;
  let identity = 1;
  await assert.rejects(submitCompanyPackage(body, async () => {
    if (identity !== 1) throw new Error("Authentication identity changed");
    calls++;
    return new Response(null, { status: 502 });
  }, async () => { identity = 2; }), /identity changed/);
  assert.equal(calls, 1);
});

test("invalid identity or missing cost approval never submits", async () => {
  for (const invalid of [{ requestId: "bad", acceptResearchCost: true },
    { requestId: JSON.parse(body).requestId, acceptResearchCost: false }]) {
    await assert.rejects(submitCompanyPackage(JSON.stringify(invalid), async () => {
      assert.fail("must not send unapproved or unidentifiable work");
    }, pause), /identity.*approval/);
  }
});
