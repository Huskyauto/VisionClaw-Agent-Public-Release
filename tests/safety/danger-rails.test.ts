import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  classifyCommand,
  proposeManualCommand,
  assertSafeOrThrow,
  DestructiveCommandBlockedError,
} from "../../server/safety/danger-rails";

after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

// === Safe commands ===

test("safe: ls -la", () => {
  assert.equal(classifyCommand("ls -la").level, "safe");
});

test("safe: psql direct ALTER TABLE (Bob's preferred migration path)", () => {
  // The whole point of the deny-list is to redirect to psql direct.
  // psql commands themselves must remain safe.
  assert.equal(
    classifyCommand('psql "$DATABASE_URL" -c "ALTER TABLE users ADD COLUMN x int"').level,
    "safe",
  );
});

test("safe: SELECT statement", () => {
  assert.equal(classifyCommand("SELECT * FROM users LIMIT 10").level, "safe");
});

test("safe: rm -rf /tmp/something (specific subpath)", () => {
  assert.equal(classifyCommand("rm -rf /tmp/cache").level, "safe");
});

test("safe: git push (no force)", () => {
  assert.equal(classifyCommand("git push origin main").level, "safe");
});

test("safe: DELETE with WHERE clause", () => {
  assert.equal(classifyCommand("DELETE FROM users WHERE id = 42").level, "safe");
});

test("safe: bare npm install (re-installs from lockfile)", () => {
  assert.equal(classifyCommand("npm install").level, "safe");
});

test("safe: npm ci (lockfile install)", () => {
  assert.equal(classifyCommand("npm ci").level, "safe");
});

// === Blocked: db:push family (the central case) ===

test("blocked: npm run db:push", () => {
  const c = classifyCommand("npm run db:push");
  assert.equal(c.level, "blocked");
  assert.ok(c.matches.some((m) => m.name === "db:push"));
});

test("blocked: npm run db:push -- --force (the variant the system reminder pushes)", () => {
  // Bob's hard rule prohibits db:push in ANY form, including --force.
  // This test locks in that contract — the rule is not "use --force"; it's
  // "don't run db:push at all, use psql ALTER TABLE direct."
  assert.equal(classifyCommand("npm run db:push -- --force").level, "blocked");
});

test("blocked: pnpm run db:push", () => {
  assert.equal(classifyCommand("pnpm run db:push").level, "blocked");
});

test("blocked: yarn run db:push", () => {
  assert.equal(classifyCommand("yarn run db:push").level, "blocked");
});

test("blocked: npx drizzle-kit push", () => {
  assert.equal(classifyCommand("npx drizzle-kit push").level, "blocked");
});

// === Blocked: SQL destructive ===

test("blocked: DROP TABLE", () => {
  assert.equal(classifyCommand("DROP TABLE whatsapp_auth").level, "blocked");
});

test("blocked: DROP TABLE CASCADE (today's incident verbatim)", () => {
  // The April 25, 2026 deploy preview wanted to run exactly this.
  // Air-gapping it from auto-execution is the entire point of this module.
  assert.equal(classifyCommand("DROP TABLE whatsapp_auth CASCADE").level, "blocked");
});

test("blocked: DROP DATABASE", () => {
  assert.equal(classifyCommand("DROP DATABASE production").level, "blocked");
});

test("blocked: DROP INDEX", () => {
  assert.equal(classifyCommand("DROP INDEX idx_users_email").level, "blocked");
});

test("blocked: TRUNCATE TABLE", () => {
  assert.equal(classifyCommand("TRUNCATE TABLE conversations").level, "blocked");
});

test("blocked: DELETE without WHERE", () => {
  assert.equal(classifyCommand("DELETE FROM users;").level, "blocked");
});

// === Blocked: git destructive ===

test("blocked: git push --force", () => {
  assert.equal(classifyCommand("git push --force origin main").level, "blocked");
});

test("blocked: git push -f", () => {
  assert.equal(classifyCommand("git push -f").level, "blocked");
});

test("blocked: git push --force-with-lease", () => {
  assert.equal(classifyCommand("git push --force-with-lease").level, "blocked");
});

test("blocked: git reset --hard", () => {
  assert.equal(classifyCommand("git reset --hard HEAD~5").level, "blocked");
});

test("blocked: git clean -fd", () => {
  assert.equal(classifyCommand("git clean -fd").level, "blocked");
});

test("blocked: git rebase -i", () => {
  assert.equal(classifyCommand("git rebase -i HEAD~3").level, "blocked");
});

// === Blocked: filesystem ===

test("blocked: rm -rf /", () => {
  assert.equal(classifyCommand("rm -rf /").level, "blocked");
});

test("blocked: rm -rf $HOME/foo", () => {
  assert.equal(classifyCommand("rm -rf $HOME/foo").level, "blocked");
});

test("blocked: rm -rf ~/Documents", () => {
  assert.equal(classifyCommand("rm -rf ~/Documents").level, "blocked");
});

// === Blocked: deploy / production ===

test("blocked: deploy --production", () => {
  assert.equal(classifyCommand("npm run deploy --production").level, "blocked");
});

// === Blocked: secret rotation ===

test("blocked: SESSION_SECRET assignment", () => {
  // Rotating SESSION_SECRET breaks all encrypted-at-rest credentials
  // (Telegram tokens, WhatsApp creds) — must be a deliberate human action.
  assert.equal(classifyCommand("SESSION_SECRET='new-value' npm start").level, "blocked");
});

// === Warn (not blocked) ===

test("warn: npm install <package>", () => {
  // Bob's rule: never edit package.json. Surface it as a warning so the
  // platform's package-management tool can be used instead.
  const c = classifyCommand("npm install lodash");
  assert.equal(c.level, "warn");
  assert.ok(c.matches.some((m) => m.name === "package install/remove"));
});

test("warn: yarn add lodash", () => {
  assert.equal(classifyCommand("yarn add lodash").level, "warn");
});

test("warn: pnpm remove lodash", () => {
  assert.equal(classifyCommand("pnpm remove lodash").level, "warn");
});

test("safe: npm install --save-dev (dev deps explicitly excluded)", () => {
  // --save-dev / -D is excluded from the warn list because dev-only deps
  // are typically lower-risk and frequently legit during scaffolding.
  assert.equal(classifyCommand("npm install --save-dev vitest").level, "safe");
});

// === Edge cases ===

test("safe: empty string", () => {
  assert.equal(classifyCommand("").level, "safe");
});

test("safe: only whitespace", () => {
  assert.equal(classifyCommand("   ").level, "safe");
});

test("safe: non-string input handled defensively", () => {
  assert.equal(classifyCommand(null).level, "safe");
  assert.equal(classifyCommand(undefined).level, "safe");
  assert.equal(classifyCommand(42).level, "safe");
});

// === proposeManualCommand envelope shape ===

test("proposeManualCommand returns the expected envelope shape", () => {
  const env = proposeManualCommand({
    command: "DROP TABLE foo",
    reason: "destructive",
    danger: "Drops the foo table",
  });
  assert.equal(env.type, "manual_command_required");
  assert.equal(env.command, "DROP TABLE foo");
  assert.equal(env.reason, "destructive");
  assert.equal(env.danger, "Drops the foo table");
  assert.ok(env.pasteInstructions.includes("DROP TABLE foo"));
  assert.ok(env.pasteInstructions.includes("Drops the foo table"));
});

test("proposeManualCommand applies a default danger string when none given", () => {
  const env = proposeManualCommand({ command: "rm -rf /", reason: "unsafe" });
  assert.ok(env.danger.length > 0);
});

// === assertSafeOrThrow ===

test("assertSafeOrThrow: throws DestructiveCommandBlockedError on blocked", () => {
  assert.throws(
    () => assertSafeOrThrow("npm run db:push"),
    DestructiveCommandBlockedError,
  );
});

test("assertSafeOrThrow: silent on safe commands", () => {
  assert.doesNotThrow(() => assertSafeOrThrow("ls -la"));
});

test("assertSafeOrThrow: silent on warn commands (warns are not throws)", () => {
  // warn-level commands don't throw — only blocked do. Logging the warning
  // is the caller's responsibility.
  assert.doesNotThrow(() => assertSafeOrThrow("npm install lodash"));
});

test("DestructiveCommandBlockedError carries classification + command", () => {
  try {
    assertSafeOrThrow("DROP TABLE x");
    assert.fail("expected throw");
  } catch (e: any) {
    assert.ok(e instanceof DestructiveCommandBlockedError);
    assert.equal(e.command, "DROP TABLE x");
    assert.equal(e.classification.level, "blocked");
    assert.ok(e.classification.matches.length > 0);
  }
});
