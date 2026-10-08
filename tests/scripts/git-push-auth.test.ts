import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "../..");
const sha = "1234567890abcdef1234567890abcdef12345678";

function runPush(scenario: "ok" | "reject" | "auth-fail") {
  const dir = mkdtempSync(path.join(tmpdir(), "git-push-auth-"));
  try {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const trace = path.join(dir, "git-args");
    const git = path.join(bin, "git");
    writeFileSync(git, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TRACE_PATH"
if [[ "$*" == *"ls-remote"* ]]; then
  test -x "\${GIT_ASKPASS:-}" || exit 8
  test "\${GIT_TERMINAL_PROMPT:-}" = 0 || exit 8
  if [ "$SCENARIO" = auth-fail ]; then exit 128; fi
  printf '${sha}\\trefs/heads/main\\n'
elif [[ "$*" == *"config --get remote.origin.url"* ]]; then
  printf 'https://github.com/Huskyauto/VisionClaw-Agent.git\\n'
elif [[ "$*" == *"rev-parse"* ]]; then
  printf '${sha}\\n'
elif [[ "$*" == *"push"* ]]; then
  if [ "$SCENARIO" = reject ]; then echo ' ! [rejected] main -> main (fetch first)' >&2; exit 1; fi
fi
`);
    chmodSync(git, 0o700);
    const result = spawnSync("bash", ["scripts/git-push.sh", "main"], {
      cwd: repo,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        REPL_ID: "45b6d1c0-f690-443b-a4f3-d57f5cba126d",
        SELF_PUSH_REPO: "Huskyauto/VisionClaw-Agent",
        GITHUB_PERSONAL_ACCESS_TOKEN_2: "test-secret-never-in-argv",
        GITHUB_TOKEN: "",
        PATH: `${bin}:${process.env.PATH}`,
        TRACE_PATH: trace,
        SCENARIO: scenario,
      },
    });
    return { result, args: readFileSync(trace, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("private backup push authenticates without putting its token in subprocess arguments", () => {
  const { result, args } = runPush("ok");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(args, /test-secret-never-in-argv/);
  assert.doesNotMatch(result.stdout + result.stderr, /test-secret-never-in-argv/);
  assert.match(result.stdout, /pushed main/);
  assert.match(args, new RegExp(`update-ref refs/remotes/origin/main ${sha}`));
});

test("a rejected push never reports success", () => {
  const { result } = runPush("reject");
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /✓ pushed/);
});

test("authentication rejection is distinct from a push success", () => {
  const { result } = runPush("auth-fail");
  assert.equal(result.status, 3);
  assert.doesNotMatch(result.stdout, /✓ pushed/);
});