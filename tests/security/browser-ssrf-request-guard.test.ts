/**
 * Regression guard: browser-tool request-level SSRF interception (TOCTOU fix, 2026-07-08).
 *
 * The pre-navigation isUrlAllowedWithDns() check alone is a time-of-check/time-of-use
 * gap: DNS rebinding or a redirect chain can steer the remote Browserless session to a
 * private address AFTER the check. The fix is attachSsrfRequestGuard() — a
 * page.setRequestInterception(true) + page.on("request") guard that:
 *   - aborts literal private-IP hosts + blocked hostnames on EVERY request,
 *   - re-runs the DNS-validated policy check on every NAVIGATION request (redirect hops),
 *   - fails CLOSED for navigations on guard error.
 *
 * Static-scan test (no imports of server modules — keeps the pg pool closed).
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.join(process.cwd(), "server", "browser-tool.ts"),
  "utf-8",
);

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const CODE = stripComments(SRC);

test("attachSsrfRequestGuard exists and arms request interception", () => {
  assert.match(CODE, /async function attachSsrfRequestGuard\s*\(/);
  assert.match(CODE, /page\.setRequestInterception\(true\)/);
  assert.match(CODE, /page\.on\(\s*["']request["']/);
});

test("guard aborts with blockedbyclient and re-validates navigation requests via DNS", () => {
  assert.match(CODE, /req\.abort\(\s*["']blockedbyclient["']\s*\)/);
  assert.match(CODE, /isNavigationRequest\(\)/);
  // Navigation re-validation must route through the DNS-checked policy path.
  assert.match(CODE, /isNavUrlAllowedCached\([^)]*\)/);
  const cacheFn = CODE.match(/async function isNavUrlAllowedCached[\s\S]{0,600}/);
  assert.ok(cacheFn, "isNavUrlAllowedCached must exist");
  assert.match(cacheFn![0], /isUrlAllowedWithDns\(/);
});

test("guard checks literal private-IP hosts on all requests", () => {
  assert.match(CODE, /function hostnameIsLiteralPrivateIp\s*\(/);
  const guardBody = CODE.match(/async function attachSsrfRequestGuard[\s\S]{0,3000}/);
  assert.ok(guardBody, "guard body found");
  assert.match(guardBody![0], /hostnameIsLiteralPrivateIp\(/);
  assert.match(guardBody![0], /blockedHostnames/);
});

test("guard fails CLOSED for navigations in the error path", () => {
  const guardBody = CODE.match(/async function attachSsrfRequestGuard[\s\S]{0,3000}/);
  assert.ok(guardBody, "guard body found");
  // Error handler must abort when the request is a navigation.
  assert.match(guardBody![0], /if \(isNav\) await abort\(\); else await allow\(\);/);
  // Unknown-nav state (isNavigationRequest itself threw) must default to nav = fail closed.
  assert.match(guardBody![0], /isNav = true/);
});

test("every newPage() call site is followed by applyStealthToPage (which attaches the guard)", () => {
  const lines = CODE.split("\n");
  const newPageLines: number[] = [];
  lines.forEach((line, i) => {
    if (/\.newPage\(\)/.test(line)) newPageLines.push(i);
  });
  assert.ok(newPageLines.length >= 3, `expected >=3 newPage sites, found ${newPageLines.length}`);
  for (const i of newPageLines) {
    const window = lines.slice(i, i + 4).join("\n");
    assert.match(
      window,
      /applyStealthToPage|attachSsrfRequestGuard/,
      `newPage at line ${i + 1} must be guarded within 3 lines:\n${window}`,
    );
  }
});

test("applyStealthToPage attaches the guard OUTSIDE its try/catch", () => {
  const fn = CODE.match(/async function applyStealthToPage[\s\S]*?\n\}/);
  assert.ok(fn, "applyStealthToPage found");
  const body = fn![0];
  assert.match(body, /attachSsrfRequestGuard\(page\)/);
  // The guard call must come after the closing catch — a stealth failure cannot skip it.
  const catchIdx = body.lastIndexOf("logSilentCatch");
  const guardIdx = body.lastIndexOf("attachSsrfRequestGuard");
  assert.ok(guardIdx > catchIdx, "guard attach must be after (outside) the stealth try/catch");
});

test("getPageForSession guards existing/reused pages (popup coverage)", () => {
  const fn = CODE.match(/async function getPageForSession[\s\S]*?\n\}/);
  assert.ok(fn, "getPageForSession found");
  const attaches = fn![0].match(/attachSsrfRequestGuard\(/g) || [];
  assert.ok(
    attaches.length >= 2,
    `getPageForSession must attach the guard on both reuse branches (found ${attaches.length})`,
  );
});
