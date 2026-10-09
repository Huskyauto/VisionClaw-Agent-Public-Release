/**
 * Attachment-order regression test (architect coverage gap from the derived-API
 * review): on every page-preparation path, the derived-api capture listener
 * must attach BEFORE the SSRF request guard, and the guard must always attach
 * (capture is fail-open; guard is not skippable).
 *
 * Uses fake Page objects that record instrumentation order:
 *  - capture signal  = page.on("response") listener (attachNetworkCapture)
 *  - guard signal    = page.setRequestInterception(true) + page.on("request")
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStealthToPage, getPageForSession } from "../../server/browser-tool";

function makeFakePage() {
  const events: string[] = [];
  const page: any = {
    events,
    evaluateOnNewDocument: async () => { events.push("stealth"); },
    setUserAgent: async () => {},
    setExtraHTTPHeaders: async () => {},
    setRequestInterception: async (_on: boolean) => { events.push("interception"); },
    on: (ev: string, _cb: unknown) => { events.push(`on:${ev}`); return page; },
  };
  return page as any;
}

function assertCaptureBeforeGuard(events: string[], label: string) {
  const capIdx = events.indexOf("on:response");
  const guardIdx = events.indexOf("interception");
  assert.ok(capIdx !== -1, `${label}: capture listener never attached`);
  assert.ok(guardIdx !== -1, `${label}: SSRF guard never attached`);
  assert.ok(capIdx < guardIdx, `${label}: capture must attach BEFORE guard (got ${events.join(",")})`);
  assert.ok(events.includes("on:request"), `${label}: guard request listener missing`);
}

test("applyStealthToPage: capture attaches before SSRF guard (new page path)", async () => {
  const page = makeFakePage();
  await applyStealthToPage(page, 42);
  assertCaptureBeforeGuard(page.events, "applyStealthToPage");
});

test("applyStealthToPage without tenant still always attaches the guard", async () => {
  const page = makeFakePage();
  await applyStealthToPage(page);
  assert.ok(page.events.includes("interception"), "guard skipped when tenantId absent");
});

test("getPageForSession existing-page path: capture before guard", async () => {
  const page = makeFakePage();
  const session: any = { tenantId: 42, context: { pages: async () => [page] } };
  const got = await getPageForSession(session);
  assert.equal(got, page);
  assertCaptureBeforeGuard(page.events, "existing-page");
});

test("getPageForSession tabIndex path (popup pages): capture before guard", async () => {
  const p0 = makeFakePage();
  const popup = makeFakePage(); // e.g. target=_blank page that skipped newPage
  const session: any = { tenantId: 42, context: { pages: async () => [p0, popup] } };
  const got = await getPageForSession(session, 1);
  assert.equal(got, popup);
  assertCaptureBeforeGuard(popup.events, "tabIndex/popup");
});

test("getPageForSession new-page path: capture before guard", async () => {
  const page = makeFakePage();
  const session: any = {
    tenantId: 42,
    context: { pages: async () => [], newPage: async () => page },
  };
  const got = await getPageForSession(session);
  assert.equal(got, page);
  assertCaptureBeforeGuard(page.events, "new-page");
});

test("capture failure is fail-open: guard still attaches", async () => {
  const page = makeFakePage();
  // Break the capture listener registration for "response" only.
  const origOn = page.on.bind(page);
  page.on = (ev: string, cb: unknown) => {
    if (ev === "response") throw new Error("capture attach blew up");
    return origOn(ev, cb);
  };
  await applyStealthToPage(page, 42);
  assert.ok(page.events.includes("interception"), "guard must attach even when capture throws");
  assert.ok(page.events.includes("on:request"), "guard listener must attach even when capture throws");
});
