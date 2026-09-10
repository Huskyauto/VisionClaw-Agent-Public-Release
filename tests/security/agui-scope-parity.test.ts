import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Static parity guard (no DB, no app import — avoids the pg-pool hang):
// every POST chat-scope endpoint documented/mounted in api-v1.ts must have a
// matching SCOPE_RULES entry in auth.ts, or the unmatched-non-GET fallback
// silently makes it admin-only (the exact regression the architect caught
// on /api/v1/agui/run).
//
// Hardened (second architect pass): rules are STRUCTURALLY parsed out of the
// comment-stripped SCOPE_RULES array (method + pattern + scopes together), and
// route checks replicate checkApiKeyScopes's first-match-wins iteration order —
// so a commented-out rule, a stray string literal, or an earlier broader rule
// shadowing the chat rule all fail the guard instead of slipping past it.

const authSrc = readFileSync(path.join(process.cwd(), "server/auth.ts"), "utf8");
const apiV1Src = readFileSync(path.join(process.cwd(), "server/routes/api-v1.ts"), "utf8");

type ParsedRule = { method?: string; pattern: RegExp; scopes: string[] };

function parseScopeRules(src: string): ParsedRule[] {
  const rulesBlockMatch = src.match(/SCOPE_RULES[^=]*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(rulesBlockMatch, "could not locate the SCOPE_RULES array in auth.ts");
  const rulesBlock = rulesBlockMatch![1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  // Parse each rule object IN ORDER, keeping method (optional), pattern, and scopes together.
  const ruleRe =
    /\{\s*(?:method:\s*"([A-Z]+)"\s*,\s*)?pattern:\s*\/(.+?)\/([a-z]*)\s*,\s*scopes:\s*\[([^\]]*)\]/g;
  const rules: ParsedRule[] = [];
  for (const m of rulesBlock.matchAll(ruleRe)) {
    rules.push({
      method: m[1] || undefined,
      pattern: new RegExp(m[2], m[3]),
      scopes: [...m[4].matchAll(/"([^"]+)"/g)].map((s) => s[1]),
    });
  }
  assert.ok(rules.length >= 5, `parsed too few SCOPE_RULES entries (${rules.length}) — parser drift?`);
  return rules;
}

// Mirrors checkApiKeyScopes: first rule whose method+pattern match decides.
function firstMatchingRule(rules: ParsedRule[], method: string, routePath: string): ParsedRule | null {
  for (const rule of rules) {
    if (rule.method && rule.method !== method) continue;
    if (!rule.pattern.test(routePath)) continue;
    return rule;
  }
  return null;
}

const rules = parseScopeRules(authSrc);

test("SCOPE_RULES grants chat scope to POST /api/v1/agui/run (first-match-wins, structural)", () => {
  const rule = firstMatchingRule(rules, "POST", "/api/v1/agui/run");
  assert.ok(rule, "no SCOPE_RULES entry matches POST /api/v1/agui/run (falls back to admin-only)");
  assert.ok(
    rule!.scopes.includes("chat"),
    `the FIRST SCOPE_RULES match for POST /api/v1/agui/run grants [${rule!.scopes.join(", ")}] — an earlier/broader rule is shadowing the chat rule`,
  );
});

test("every POST route mounted in api-v1.ts resolves to a SCOPE_RULES entry (no admin-only fallback)", () => {
  const mounted = [
    ...apiV1Src.matchAll(/app\.post\(\s*\n?\s*["'`](\/api\/v1\/[^"'`]+)["'`]/g),
  ].map((m) => m[1]);
  assert.ok(mounted.length >= 3, `expected to find mounted POST routes, got ${mounted.length}`);

  for (const route of mounted) {
    const concrete = route.replace(/:(\w+)/g, "123");
    const rule = firstMatchingRule(rules, "POST", concrete);
    assert.ok(
      rule,
      `POST ${route} is mounted in api-v1.ts but no SCOPE_RULES entry matches it (falls back to admin-only)`,
    );
    assert.ok(
      rule!.scopes.length > 0 && !rule!.scopes.every((s) => s === "admin"),
      `POST ${route} first-matches an admin-only SCOPE_RULES entry [${rule!.scopes.join(", ")}] — non-admin API keys are locked out; add/move a specific rule above it if unintended`,
    );
  }
});
