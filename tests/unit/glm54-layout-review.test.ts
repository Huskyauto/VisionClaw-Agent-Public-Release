import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import sharp from "sharp";
import { generateCsrfToken, getCsrfSessionKey, createCsrfMiddleware } from "../../server/validation";
import { GLM_LAYOUT_REVIEW_PATH } from "../../shared/glm54-layout-contract";
import { registerGlm54LayoutRoutes } from "../../server/routes/glm54-layout-review";
import { completeGlm54LayoutReview, normalizeLayoutInput } from "../../server/lib/glm54-layout-review";

const css = ".actions { width: 264px; overflow: hidden } .confirm { width: 100%; padding: 0 16px }";
const screenshot = readFileSync(new URL("../../scripts/lib/glm54-checkout.png", import.meta.url)).toString("base64");
const submissionId = "940e22c0-6ddf-4ecd-89d8-4c47f0d2990f";
const input = { css, screenshot, submissionId, consent: "public-or-synthetic-v1" };
const advice = { diagnosis: "Padding overflows the outer box.", suggestion: "Use box-sizing: border-box.", verification: "Resize the containing row." };

test("owner-only browser POST requires consent and claims one exact attempt before external work", async () => {
  const app = express();
  let enabled = true, calls = 0;
  let release!: () => void, signalEntered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { signalEntered = resolve; });
  const claimed = new Set<string>();
  const tenant = (req: express.Request) => req.headers.authorization === "Bearer customer" ? 2
    : req.headers.authorization === "Bearer owner" || req.headers.authorization === "Bearer vc_owner" ? 1 : null;
  app.use(express.json(), createCsrfMiddleware(tenant));
  registerGlm54LayoutRoutes(app, {
    authMiddleware: (req, res, next) => { if (tenant(req)) next(); else res.sendStatus(401); },
    requireAdmin: async (req, res) => {
      if (tenant(req) === 1) return 1;
      res.sendStatus(403); return null;
    },
  }, {
    key: () => enabled ? "test-only" : undefined,
    claim: async attemptKey => {
      if (claimed.has(attemptKey)) throw new Error("duplicate");
      claimed.add(attemptKey);
    },
    complete: async (source, key) => {
      calls++;
      assert.equal(source.css, css);
      assert.equal(key, "test-only");
      assert.equal(claimed.size, 1);
      signalEntered();
      await gate;
      return { model: "glm-5.4", advice };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${GLM_LAYOUT_REVIEW_PATH}`;
    const send = (body: unknown, token = "owner", csrf = true) => {
      const authorization = `Bearer ${token}`;
      const req = { headers: { authorization } } as express.Request;
      const key = getCsrfSessionKey(req, token === "customer" ? 2 : 1)!;
      return fetch(url, { method: "POST", headers: { authorization, "content-type": "application/json",
        ...(csrf ? { "x-csrf-token": generateCsrfToken(key) } : {}) }, body: JSON.stringify(body) });
    };
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await send(input, "owner", false)).status, 403);
    assert.equal((await send(input, "customer")).status, 403);
    assert.equal((await send(input, "vc_owner")).status, 403);
    assert.equal((await send({ ...input, consent: true })).status, 400);
    assert.equal((await send({ ...input, tenantId: 1 })).status, 400);
    assert.equal((await send({ ...input, screenshot: "https://example.com/private.png" })).status, 400);
    assert.equal((await send({ ...input, css: ".a { background: url(https://example.com/file) }" })).status, 400);
    assert.equal(calls, 0);
    enabled = false;
    assert.equal((await send(input)).status, 503);
    enabled = true;
    const pending = send(input);
    try {
      await entered;
      assert.equal((await send({ ...input, submissionId: "940e22c0-6ddf-4ecd-89d8-4c47f0d2990e" })).status, 429);
      assert.equal(claimed.size, 1);
    } finally {
      release();
    }
    const result = await pending;
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.deepEqual(await result.json(), { model: "glm-5.4", advice });
    assert.equal((await send(input)).status, 429);
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("fixed transport only sends stripped image and CSS with documented exact model identities", async () => {
  const source = await normalizeLayoutInput(input);
  assert.ok(source);
  const temporary = (content: unknown, model = "glm-5.4", finish_reason = "stop") => Response.json({
    model, choices: [{ finish_reason, message: { role: "assistant", content: JSON.stringify(content) } }],
  });
  let calls = 0;
  const invoke = (response: Response) => completeGlm54LayoutReview(source, "stub-key", async (url, options) => {
    calls++;
    assert.equal(url, "https://aihubmix.com/v1/chat/completions");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "coding-glm-5.4");
    assert.equal(body.max_tokens, 512);
    assert.equal(body.stream, false);
    assert.equal(body.messages.length, 2);
    assert.equal(body.tools, undefined);
    assert.ok(body.messages[1].content[1].image_url.url.startsWith("data:image/jpeg;base64,"));
    assert.ok(!String(options?.body).includes(submissionId));
    return response;
  });
  assert.deepEqual(await invoke(temporary(advice)), { model: "glm-5.4", advice });
  await assert.rejects(invoke(temporary(advice, "glm-5.3")));
  await assert.rejects(invoke(temporary(advice, "glm-5.4", "length")));
  await assert.rejects(invoke(temporary({ ...advice, tools: [] })));
  await assert.rejects(invoke(new Response("secret", { status: 403 })));
  await assert.rejects(invoke(new Response("x".repeat(25 * 1024))), /oversized_provider_body/);
  assert.equal(calls, 6);
});

test("native image boundary refuses non-static or oversized rasters and removes image metadata", async () => {
  assert.equal(await normalizeLayoutInput({ ...input, screenshot: Buffer.from("<svg width='100' height='100'/>").toString("base64") }), null);
  assert.equal(await normalizeLayoutInput({ ...input, screenshot: screenshot.slice(0, 48) }), null);
  const tooManyPixels = await sharp({
    create: { width: 2001, height: 2000, channels: 3, background: "white" },
  }).png().toBuffer();
  assert.equal(await normalizeLayoutInput({ ...input, screenshot: tooManyPixels.toString("base64") }), null);
  const withMetadata = await sharp(Buffer.from(screenshot, "base64")).withExif({
    IFD0: { Artist: "synthetic private metadata" },
  }).jpeg().toBuffer();
  assert.ok((await sharp(withMetadata).metadata()).exif);
  const normalized = await normalizeLayoutInput({ ...input, screenshot: withMetadata.toString("base64"),
    css: `${css} /* remove this comment */` });
  assert.ok(normalized);
  assert.ok(!normalized.css.includes("remove this comment"));
  const after = await sharp(Buffer.from(normalized.imageUrl.split(",")[1], "base64")).metadata();
  assert.equal(after.exif, undefined);
  assert.equal(after.format, "jpeg");
});

test("native fetch honors redirect refusal and submits no follow-up request", async () => {
  let calls = 0;
  const app = express();
  app.post("/gateway", (_req, res) => { calls++; res.redirect(307, "/must-not-follow"); });
  app.all("/must-not-follow", (_req, res) => { calls += 100; res.sendStatus(200); });
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const source = await normalizeLayoutInput(input);
    assert.ok(source);
    const destination = `http://127.0.0.1:${(server.address() as AddressInfo).port}/gateway`;
    await assert.rejects(completeGlm54LayoutReview(source, "synthetic", (url, options) => {
      assert.equal(url, "https://aihubmix.com/v1/chat/completions");
      return fetch(destination, options);
    }));
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
