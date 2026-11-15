import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { demoProjectSchema, renderDemoHtml } from "../../shared/demo-studio";
import { buildHtmlApp } from "../../server/html-app-builder";
import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

// This file also runs in the normal suite, whose parent may carry live billing
// credentials. A regression must fail offline rather than call a real provider.
process.env = { PATH: process.env.PATH, HOME: "/tmp", NODE_ENV: "test", NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT };

test("exported walkthrough seeks reproducibly and never executes entered text", () => {
  const project = demoProjectSchema.parse({
    version: 1, title: "A <real> walkthrough",
    steps: [
      { title: "Start", description: '</script><script>window.pwned=1</script>', seconds: 3 },
      { title: "Finish", description: "Review before delivery", seconds: 4 },
    ],
  });
  const dom = new JSDOM(renderDemoHtml(project), { runScripts: "dangerously", pretendToBeVisual: true });
  try {
    const win = dom.window;
    const slider = win.document.querySelector<HTMLInputElement>("#clock")!;
    assert.equal(win.document.querySelector("#step-title")!.textContent, "Start");
    assert.equal((win as unknown as { pwned?: number }).pwned, undefined);
    slider.value = "4"; slider.dispatchEvent(new win.Event("input"));
    const atFour = win.document.querySelector("#stage")!.innerHTML;
    assert.equal(win.document.querySelector("#step-title")!.textContent, "Finish");
    slider.value = "0"; slider.dispatchEvent(new win.Event("input"));
    slider.value = "4"; slider.dispatchEvent(new win.Event("input"));
    assert.equal(win.document.querySelector("#stage")!.innerHTML, atFour);
    assert.match(win.document.body.textContent!, /reconstruction/i);
    assert.equal(win.document.querySelectorAll("script[src],link[href],iframe").length, 0);
  } finally { dom.window.close(); }
});

test("strict project import rejects executable assets, excess steps and malformed bounds", () => {
  const valid = { version: 1, title: "Report", steps: [{ title: "Review", description: "", seconds: 4 }] };
  for (const screenshot of ["https://example.com/a.png", "data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)"]) {
    assert.equal(demoProjectSchema.safeParse({ ...valid, steps: [{ ...valid.steps[0], screenshot }] }).success, false);
  }
  for (const seconds of [0, 1, 31, Infinity, NaN, "6", null]) {
    assert.equal(demoProjectSchema.safeParse({ ...valid, steps: [{ ...valid.steps[0], seconds }] }).success, false);
  }
  for (const payload of [
    { ...valid, steps: [] }, { ...valid, steps: Array(13).fill(valid.steps[0]) },
    { ...valid, version: 2 }, { ...valid, html: "<script>bad()</script>" },
    { ...valid, steps: [{ ...valid.steps[0], pointer: { x: -1, y: 50 } }] },
  ]) assert.equal(demoProjectSchema.safeParse(payload).success, false);
  assert.deepEqual(demoProjectSchema.parse(JSON.parse(JSON.stringify(valid))), valid);
});

test("actual agent builder renders a demo with no provider credentials or model call", async () => {
  const result = await buildHtmlApp({
    tenantId: 1, topic: "offline-demo-regression",
    model: "this-model-must-never-be-called",
    demo: { version: 1, title: "Report walkthrough", steps: [{ title: "Review", description: "Read first", seconds: 3 }] },
    smoke_assertion: { selectors_exist: ["#clock", "#play"], text_includes: [{ selector: "#step-title", text: "Review" }] },
  });
  try {
    assert.equal(result.success, true, result.error);
    assert.equal(result.verificationScope, "static-dom-only");
    assert.equal(result.smokePassed, true);
    assert.match(await readFile(result.filePath!, "utf8"), /Illustrated reconstruction/);
  } finally { if (result.filePath) await rm(dirname(result.filePath), { recursive: true, force: true }); }
});

test("invalid deterministic inputs and failed DOM assertions never fall through to generation", async () => {
  for (const demo of [null, {}, { version: 1, title: "Bad", steps: [] }]) {
    const result = await buildHtmlApp({ tenantId: 1, topic: "invalid-demo", demo: demo as never });
    assert.equal(result.success, false);
    assert.match(result.error!, /Invalid demo project/);
    assert.equal(result.filePath, undefined);
  }
  const result = await buildHtmlApp({
    tenantId: 1, topic: "demo-rejected",
    demo: { version: 1, title: "Not delivered", steps: [{ title: "Draft", description: "", seconds: 2 }] },
    smoke_assertion: { selectors_exist: ["#does-not-exist"] },
  });
  assert.equal(result.success, false);
  assert.equal(result.filePath, undefined);
  assert.equal(result.smokePassed, false);
});

test("worst-case text stays intact and screenshot markers are data, never executable markup", () => {
  const longName = "名".repeat(47) + "A".repeat(70);
  const project = demoProjectSchema.parse({
    version: 1, title: longName, steps: [{
      title: longName, description: "0 records\n1 record\n999999999999 records\nمرحبا\n<script>bad()</script>",
      seconds: 2, screenshot: "data:image/png;base64,iVBORw0KGgo=",
      pointer: { x: 0, y: 100 },
    }],
  });
  const dom = new JSDOM(renderDemoHtml(project), { runScripts: "dangerously", pretendToBeVisual: true });
  try {
    assert.equal(dom.window.document.querySelector("#step-title")!.textContent, longName);
    assert.equal(dom.window.document.querySelector("img")!.getAttribute("src"), project.steps[0].screenshot);
    assert.equal(dom.window.document.querySelector<HTMLElement>("#pointer")!.style.top, "100%");
    assert.match(dom.window.document.querySelector("#step-copy")!.textContent!, /مرحبا/);
    assert.equal(dom.window.document.querySelectorAll("script").length, 1);
    assert.match(dom.window.document.querySelector("style")!.textContent!, /overflow-wrap:anywhere/);
    assert.equal(dom.window.document.querySelector("#play")!.textContent, "Play");
  } finally { dom.window.close(); }
});
