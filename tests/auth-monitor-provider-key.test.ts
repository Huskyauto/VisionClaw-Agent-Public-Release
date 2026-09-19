import test from "node:test";
import assert from "node:assert/strict";

import { checkProvider } from "../server/auth-monitor";

test("OpenAI health uses the token parameter supported by gpt-5-mini", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  let requestBody: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    request = { url: String(url), init };
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: "connected" } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const health = await checkProvider("openai", "test-exact-key", fetchImpl);

  assert.equal(request?.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(new Headers(request?.init?.headers).get("authorization"), "Bearer test-exact-key");
  assert.equal(requestBody?.model, "gpt-5-mini");
  assert.equal(requestBody?.max_completion_tokens, 16);
  assert.equal("max_tokens" in (requestBody || {}), false);
  assert.equal(health.status, "ok");
});

test("non-OpenAI health probes preserve their provider-specific request contracts", async () => {
  const cases = [
    {
      provider: "anthropic",
      url: "https://api.anthropic.com/v1/messages",
      model: "claude-sonnet-4-5",
      keyHeader: "x-api-key",
      response: { content: [{ text: "connected" }] },
    },
    {
      provider: "xai",
      url: "https://api.x.ai/v1/chat/completions",
      model: "grok-4.6",
      keyHeader: "authorization",
      response: { choices: [{ message: { content: "connected" } }] },
    },
    {
      provider: "perplexity",
      url: "https://api.perplexity.ai/chat/completions",
      model: "sonar",
      keyHeader: "authorization",
      response: { choices: [{ message: { content: "connected" } }] },
    },
    {
      provider: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: "deepseek/deepseek-v3.2",
      keyHeader: "authorization",
      response: { choices: [{ message: { content: "connected" } }] },
    },
  ] as const;

  for (const probe of cases) {
    let request: { url: string; init?: RequestInit } | undefined;
    const fetchImpl: typeof fetch = async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify(probe.response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const health = await checkProvider(probe.provider, "test-exact-key", fetchImpl);
    const headers = new Headers(request?.init?.headers);
    const body = JSON.parse(String(request?.init?.body));

    assert.equal(request?.url, probe.url, probe.provider);
    assert.equal(
      headers.get(probe.keyHeader),
      probe.keyHeader === "authorization" ? "Bearer test-exact-key" : "test-exact-key",
      probe.provider,
    );
    assert.equal(body.model, probe.model, probe.provider);
    assert.equal(body.max_tokens, 16, probe.provider);
    assert.equal("max_completion_tokens" in body, false, probe.provider);
    assert.equal(health.status, "ok", probe.provider);
    assert.match(health.detail, /replied "connected"/, probe.provider);
  }
});

test("xAI health probes the exact supplied key and direct provider model", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      choices: [{ message: { content: "connected" } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const health = await checkProvider("xai", "test-exact-key", fetchImpl);

  assert.equal(request?.url, "https://api.x.ai/v1/chat/completions");
  assert.equal(new Headers(request?.init?.headers).get("authorization"), "Bearer test-exact-key");
  const body = JSON.parse(String(request?.init?.body));
  assert.equal(body.model, "grok-4.6");
  assert.equal(body.max_tokens, 16);
  assert.equal("max_completion_tokens" in body, false);
  assert.equal(health.status, "ok");
});

test("OpenAI health redacts a rejected exact key and classifies credential failure", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({
      error: { message: "Incorrect API key provided: secret-value" },
    }), { status: 401, headers: { "content-type": "application/json" } });

  const health = await checkProvider("openai", "secret-value", fetchImpl);

  assert.equal(health.status, "expired");
  assert.doesNotMatch(health.detail, /secret-value/);
});

test("xAI health classifies a rejected supplied key without exposing it", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({
      code: "invalid-argument",
      error: "Incorrect API key provided: secret-value",
    }), { status: 400, headers: { "content-type": "application/json" } });

  const health = await checkProvider("xai", "secret-value", fetchImpl);

  assert.equal(health.status, "expired");
  assert.doesNotMatch(health.detail, /secret-value/);
});

test("xAI health classifies a plain-text 401 as an expired credential", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("Unauthorized", { status: 401 });

  const health = await checkProvider("xai", "test-key", fetchImpl);

  assert.equal(health.status, "expired");
});

test("xAI health does not misclassify an invalid model as an expired credential", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "invalid model" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  const health = await checkProvider("xai", "test-key", fetchImpl);

  assert.equal(health.status, "error");
});

test("xAI health does not misclassify expired credits as an expired credential", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "credits expired" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });

  const health = await checkProvider("xai", "test-key", fetchImpl);

  assert.equal(health.status, "error");
});

test("xAI health does not misclassify model authorization as an expired credential", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "model Unauthorized for account" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  const health = await checkProvider("xai", "test-key", fetchImpl);

  assert.equal(health.status, "error");
});

test("xAI health times out a provider that never responds", async () => {
  const fetchImpl: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });

  const health = await checkProvider("xai", "test-key", fetchImpl, 5);

  assert.equal(health.status, "error");
  assert.match(health.detail, /timed out/i);
});