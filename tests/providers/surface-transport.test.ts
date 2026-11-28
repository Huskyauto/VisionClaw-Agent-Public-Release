import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { SurfaceStreamDecoder, createSurfaceTransport } from "../../server/legion/surface-client";
import { SURFACE_MODEL, SurfaceModelUnavailable } from "../../server/legion/local-router";

test("Foundry SSE assembles split UTF-8 content, keepalives and a terminal completion without max_tokens", () => {
  const decoder = new SurfaceStreamDecoder();
  const data = Buffer.from(': keepalive\r\n\r\ndata: ' + JSON.stringify({
    model: SURFACE_MODEL, choices: [{ index: 0, delta: { content: "Synthetic café" }, finish_reason: null }],
  }) + '\r\n\r\ndata: ' + JSON.stringify({
    model: SURFACE_MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 8, completion_tokens: 4 },
  }) + '\n\ndata: [DONE]\n\n');
  for (let i = 0; i < data.length; i++) decoder.push(data.subarray(i, i + 1));
  const result = decoder.finish();
  assert.equal(result.model, SURFACE_MODEL);
  assert.equal(result.choices[0].message.content, "Synthetic café");
  assert.equal(result.usage.completion_tokens, 4);
});

test("transport pins the Surface destination through the existing proxy and refuses unsafe shapes before I/O", async () => {
  const calls: any[] = [];
  const transport = createSurfaceTransport(((options: any) => {
    calls.push(options);
    const req = new EventEmitter() as any;
    req.destroy = () => { req.emit("error", Error("destroyed")); return req; };
    req.end = (body: string) => {
      if (body) assert.equal(JSON.parse(body).max_tokens, undefined);
      queueMicrotask(() => {
        const res = new PassThrough() as any;
        res.statusCode = 200;
        res.headers = { "content-type": "application/json" };
        req.emit("response", res);
        res.end(JSON.stringify({ data: [{ id: SURFACE_MODEL }] }));
      });
    };
    return req;
  }) as any);
  const catalog = await transport(10551, "/v1/models", undefined, 2500);
  assert.equal(catalog.data[0].id, SURFACE_MODEL);
  assert.equal(calls[0].host, "127.0.0.1");
  assert.equal(calls[0].path, "http://100.94.89.78:5273/v1/models");
  assert.equal(calls[0].headers.Host, "100.94.89.78:5273");
  for (const [port, path, body, timeout] of [
    [80, "/v1/models", undefined, 2500],
    [10551, "http://evil.invalid", undefined, 2500],
    [10551, "/v1/models", undefined, NaN],
    [10551, "/v1/models", {}, 2500],
    [10551, "/v1/chat/completions", { model: SURFACE_MODEL, stream: true, max_tokens: 8 }, 90_000],
    [10551, "/v1/chat/completions", { model: "phi-3.5-mini", stream: true }, 90_000],
    [10551, "/v1/chat/completions", { model: "qwen2.5-7b-instruct-qnn-npu:3", stream: true, temperature: 0,
      messages: [{ role: "user", content: "Retired model must never dispatch" }] }, 90_000],
  ] as any[]) await assert.rejects(transport(port, path, body, timeout));
  assert.equal(calls.length, 1);
});

const generationBody = { model: SURFACE_MODEL, stream: true, temperature: 0,
  messages: [{ role: "user", content: "Synthetic text" }] };

test("only explicit unloaded-model HTTP errors are classified as node-away; redirects and generic failures never are", async () => {
  for (const [status, message, away] of [
    [400, "Model is not loaded", true],
    [503, "model not loaded; restoring", true],
    [500, "model not loaded", false],
    [400, "CreatePrepared generator failed", false],
    [302, "redirect", false],
  ] as const) {
    let calls = 0;
    const transport = createSurfaceTransport((() => {
      calls++;
      const request = new EventEmitter() as any;
      request.destroy = () => request;
      request.end = () => queueMicrotask(() => {
        const response = new PassThrough() as any;
        response.statusCode = status; response.headers = {};
        request.emit("response", response);
        response.end(JSON.stringify({ error: { message } }));
      });
      return request;
    }) as any);
    await assert.rejects(transport(10551, "/v1/chat/completions", generationBody), error =>
      error instanceof Error && (error instanceof SurfaceModelUnavailable) === away);
    assert.equal(calls, 1);
  }
});

test("stream validation refuses truncation, tools, wrong models, oversized output and unfinished events", () => {
  for (const scenario of ["truncated", "tools", "wrong-model", "retired-npu", "oversized", "unfinished", "post-terminal"]) {
    const decoder = new SurfaceStreamDecoder();
    const event = (value: any) => decoder.push(Buffer.from(`data: ${JSON.stringify(value)}\n\n`));
    assert.throws(() => {
      event({ model: scenario === "wrong-model" ? "phi-3.5-mini"
        : scenario === "retired-npu" ? "qwen2.5-7b-instruct-qnn-npu:3" : SURFACE_MODEL,
        choices: [{ index: 0, delta: scenario === "tools" ? { tool_calls: [{}] } : {
          content: scenario === "oversized" ? "x".repeat(12_001) : "synthetic",
        }, finish_reason: scenario === "truncated" ? "length" : "stop" }] });
      if (scenario !== "unfinished") decoder.push(Buffer.from("data: [DONE]\n\n"));
      if (scenario === "post-terminal") event({ choices: [] });
      decoder.finish();
    }, scenario);
  }
});

test("keepalive-only streams hit the total deadline and cancellation refuses before HTTP", async () => {
  let calls = 0, destroys = 0;
  const transport = createSurfaceTransport((() => {
    calls++;
    const request = new EventEmitter() as any;
    request.destroy = () => { destroys++; return request; };
    request.end = () => queueMicrotask(() => {
      const response = new PassThrough() as any;
      response.statusCode = 200; response.headers = { "content-type": "text/event-stream" };
      request.emit("response", response);
      response.write(": preparing NPU\n\n"); // No content and no end.
    });
    return request;
  }) as any);
  await assert.rejects(transport(10551, "/v1/chat/completions", generationBody, 20), /deadline/);
  assert.equal(destroys, 1);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(transport(10551, "/v1/chat/completions", generationBody, 90_000, abort.signal));
  assert.equal(calls, 1);
});
