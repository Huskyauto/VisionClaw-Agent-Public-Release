import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("landing content is readable before scroll observers or animations run", async () => {
  const result = await build({
    entryPoints: ["client/src/components/reveal-on-scroll.tsx"],
    bundle: true, write: false, format: "cjs", platform: "node",
    jsx: "automatic", external: ["react", "react/*"],
  });
  const module = { exports: {} as { RevealOnScroll?: any } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports,
  );
  const html = renderToStaticMarkup(createElement(module.exports.RevealOnScroll, {}, "Visible section content"));
  assert.match(html, /Visible section content/);
  assert.doesNotMatch(html, /opacity-0|visibility:\s*hidden/);
});

test("published landing pages do not announce a pending publication", () => {
  const landing = readFileSync("client/src/pages/landing.tsx", "utf8");
  const release = readFileSync("client/src/components/prepublication-notice.tsx", "utf8");
  assert.doesNotMatch(landing, /<PrepublicationNotice|not yet published|publication pending/i);
  assert.doesNotMatch(release, /publication pending|not yet published/i);
});