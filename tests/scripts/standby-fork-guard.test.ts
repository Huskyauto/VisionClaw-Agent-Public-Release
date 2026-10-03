import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const PRIMARY_REPL_ID = "45b6d1c0-f690-443b-a4f3-d57f5cba126d";

test("a remix cannot run the original project's startup command", () => {
  const command = ["scripts/run-primary-only.sh", "bash", "-c", "printf 'EXECUTED'"];
  const fork = spawnSync("bash", command, {
    encoding: "utf8",
    env: { ...process.env, REPL_ID: "standby-remix" },
  });
  assert.equal(fork.status, 0, fork.stderr);
  assert.doesNotMatch(fork.stdout, /EXECUTED/);
  assert.match(fork.stdout, /standby/i);

  const original = spawnSync("bash", command, {
    encoding: "utf8",
    env: { ...process.env, REPL_ID: PRIMARY_REPL_ID },
  });
  assert.equal(original.status, 0, original.stderr);
  assert.match(original.stdout, /EXECUTED/);
});

test("the remix's automatic start and audit use the primary-only gate", () => {
  const config = readFileSync(".replit", "utf8");
  assert.match(config, /^run = "bash scripts\/run-primary-only\.sh npm run dev"$/m);
  assert.match(config, /name = "Start application"[\s\S]*?args = "bash scripts\/run-primary-only\.sh npm run dev"/);
  assert.match(config, /name = "Tenant Isolation Audit Nightly"[\s\S]*?args = "bash scripts\/run-primary-only\.sh env AUDIT_SLICE_CHUNKS=20 AUDIT_MAX_SLICES=4 npx tsx scripts\/run-tenant-isolation-audit-resumable\.ts"/);
  const commands = [...config.matchAll(/task = "shell\.exec"\s+args = "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(commands.length >= 9, "check every configured executable workflow");
  for (const command of commands) {
    assert.ok(
      command.startsWith("bash scripts/run-primary-only.sh ") || command === "bash scripts/git-auto-push.sh",
      `unguarded workflow: ${command}`,
    );
  }
});

test("a fork cannot push to the original private repository, even with a token", () => {
  const result = spawnSync("bash", ["scripts/git-push.sh", "main"], {
    encoding: "utf8",
    env: {
      ...process.env,
      REPL_ID: "standby-remix",
      SELF_PUSH_REPO: "",
      GITHUB_PERSONAL_ACCESS_TOKEN_2: "",
      GITHUB_TOKEN: "",
    },
  });
  assert.equal(result.status, 6, result.stderr);
  assert.match(result.stderr, /fork.*upstream/i);
});

test("a fork's auto-push workflow exits before committing, even with the copied enable flag", () => {
  const result = spawnSync("bash", ["scripts/git-auto-push.sh"], {
    encoding: "utf8",
    timeout: 3000,
    env: {
      ...process.env,
      REPL_ID: "standby-remix",
      ENABLE_SELF_PUSH: "1",
      GITHUB_PERSONAL_ACCESS_TOKEN_2: "",
      GITHUB_TOKEN: "",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dormant remix/i);
});