import assert from "node:assert/strict";
import { test } from "node:test";
import { runGlm54Trial } from "../../scripts/lib/glm54-development-trial";

const dev = { NODE_ENV: "development", AIHUBMIX_API_KEY: "test-only-key" };

test("no request is made without exact opt-in, a development runtime, and a credential", async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => { requests++; throw new Error("unexpected request"); };
  for (const [args, env, expected] of [
    [[], dev, "opt_in_required"],
    [["--live", "custom input"], dev, "opt_in_required"],
    [["--live"], { ...dev, NODE_ENV: "production" }, "development_required"],
    [["--live"], { ...dev, REPLIT_DEPLOYMENT: "1" }, "development_required"],
    [["--live"], { ...dev, AIHUBMIX_API_KEY: "" }, "credential_missing"],
  ] as const) {
    assert.deepEqual(await runGlm54Trial(args, env, fetcher), { status: expected, results: [] });
  }
  assert.equal(requests, 0);
});

const model = "coding-glm-5.4";
const visual = { marker: "R7", clipped_edge: "right", fix: "box-sizing: border-box;" };
const review = { verdict: "abstain", reason: "missing_test_receipt" };
const response = (value: unknown, servedModel = model, finish = "stop") => Response.json({
  model: servedModel,
  choices: [{ finish_reason: finish, message: { role: "assistant", content: JSON.stringify(value) } }],
  usage: { prompt_tokens: 190, completion_tokens: 70, completion_tokens_details: { reasoning_tokens: 23 } },
});

test("only the two bundled cases go to the exact endpoint, with a bounded image and usage report", async () => {
  const bodies: Array<{ model: string; max_tokens: number; stream: boolean; messages: Array<{ content: any }> }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://aihubmix.com/v1/chat/completions");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-only-key");
    bodies.push(JSON.parse(String(init.body)));
    return response(bodies.length === 1 ? visual : review);
  };
  const result = await runGlm54Trial(["--live"], dev, fetcher);
  assert.equal(result.status, "passed");
  assert.equal(bodies.length, 2);
  assert.ok(bodies.every(body => body.model === model && body.max_tokens === 512 &&
    body.stream === false && body.messages.length === 1));
  const [text, image] = bodies[0].messages[0].content;
  assert.equal(text.text.includes("R7"), false);
  assert.match(image.image_url.url, /^data:image\/png;base64,iVBORw0KGgo/);
  assert.ok(image.image_url.url.length < 11_000);
  assert.equal(typeof bodies[1].messages[0].content, "string");
  assert.deepEqual(result.results.map(r => [r.id, r.status, r.model, r.usage?.reasoning]), [
    ["screenshot_layout", "pass", model, 23], ["advisory_review", "pass", model, 23],
  ]);
});

test("records the documented upstream model ID without changing the pinned gateway request", async () => {
  let calls = 0;
  const result = await runGlm54Trial(["--live"], dev, async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).model, model);
    return response(++calls === 1 ? visual : review, "glm-5.4");
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.results.map(row => row.model), ["glm-5.4", "glm-5.4"]);
});

test("wrong provider identity, quota errors, transport failures, and oversized replies never retry", async () => {
  for (const [reply, expected] of [
    [() => response(visual, "coding-glm-5.3"), "model_mismatch"],
    [() => new Response("secret provider details", { status: 429 }), "http_error"],
    [() => { throw new Error("secret transport details"); }, "transport_error"],
    [() => new Response("x".repeat(40_000)), "bad_response"],
  ] as const) {
    let calls = 0;
    const output = await runGlm54Trial(["--live"], dev, async () => { calls++; return reply(); });
    assert.equal(calls, 1);
    assert.equal(output.status, "not_passed");
    assert.equal(output.results[0].status, expected);
    assert.equal(JSON.stringify(output).includes("secret"), false);
  }
});

test("rejected images do not count as vision and the separate text case can still run", async () => {
  let calls = 0;
  const output = await runGlm54Trial(["--live"], dev, async () => {
    calls++;
    return calls === 1 ? new Response(null, { status: 415 }) : response(review);
  });
  assert.equal(output.status, "not_passed");
  assert.deepEqual(output.results.map(r => [r.status, r.httpStatus]), [["http_error", 415], ["pass", undefined]]);
});

test("incomplete, guessed, and unsolicited answer fields are not a pass", async () => {
  for (const [reply, expected] of [
    [response(visual, model, "length"), "invalid_answer"],
    [response({ ...visual, marker: "unknown" }), "wrong_answer"],
    [response({ ...visual, extra: true }), "invalid_answer"],
  ] as const) {
    let calls = 0;
    const output = await runGlm54Trial(["--live"], dev, async () => ++calls === 1 ? reply : response(review));
    assert.equal(output.status, "not_passed");
    assert.deepEqual(output.results.map(r => r.status), [expected, "pass"]);
  }
});
