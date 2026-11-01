import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("complete plan review includes every step, structured inputs and escaped long text", async () => {
  const bundle = await build({
    entryPoints: ["client/src/components/plan-review-details.tsx"],
    bundle: true, write: false, format: "cjs", platform: "node",
    jsx: "automatic", external: ["react", "react/*"],
  });
  const module = { exports: {} as { default?: any } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports,
  );
  const steps = Array.from({ length: 7 }, (_, i) => ({
    n: i + 1, agent: "Felix", task: `Unique task ${i + 1}`,
    args: { note: "<script>alert('unsafe')</script>", approved: false, count: 0 },
  }));
  const longText = "Long".repeat(150);
  const html = renderToStaticMarkup(createElement(module.exports.default, {
    steps, planDetails: { objective: longText, dependencies: ["source", "review"] },
  }));
  for (let n = 1; n <= 7; n++) assert.match(html, new RegExp(`Unique task ${n}`));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|more steps/);
  assert.ok(html.includes(longText));
  assert.match(html, /false/);
  assert.match(html, /source/);
  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  const empty = renderToStaticMarkup(createElement(module.exports.default, { steps: null }));
  assert.match(empty, /No step details are available/);
});
