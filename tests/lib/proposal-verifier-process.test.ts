import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { after, before, describe, it } from "node:test";
import { build as esbuild } from "esbuild";
import {
  __verifyProposalIsolatedForTest,
  type ProposalVerifierRuntime,
} from "../../server/lib/proposal-verifier-process";
import { stageTypeScriptStandardLibraries } from "../../scripts/package-typescript-libs";

const validResult = { status: "passed", details: "ok", durationMs: 12 };

function mockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (signal: string) => boolean;
    killCalls: string[];
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
    return true;
  };
  return child;
}

function runtime(child = mockChild(), overrides: Partial<ProposalVerifierRuntime> = {}) {
  const releaseCalls: string[] = [];
  const spawnCalls: Array<{ command: string; args: string[]; options: unknown }> = [];
  const timerCallbacks = new Map<number, () => void>();
  const timerHandles = new Map<number, ReturnType<typeof setTimeout>>();
  const release = async () => { releaseCalls.push("released"); };
  const value: ProposalVerifierRuntime = {
    acquireLane: async (_label, options) => {
      assert.equal(options?.enabled, true);
      assert.equal(typeof options?.onLost, "function");
      return release;
    },
    spawn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return child;
    },
    now: () => 100,
    setTimer: (callback, delayMs) => {
      timerCallbacks.set(delayMs, callback);
      const handle = setTimeout(() => {}, 60_000);
      timerHandles.set(delayMs, handle);
      return handle;
    },
    clearTimer: (timer) => clearTimeout(timer),
    rss: () => 500 * 1024 * 1024,
    readCgroupMemory: () => null,
    production: false,
    childBundleExists: () => true,
    ...overrides,
  };
  return {
    value,
    child,
    releaseCalls,
    spawnCalls,
    fireTimer: (delayMs: number) => {
      const handle = timerHandles.get(delayMs);
      if (handle) clearTimeout(handle);
      timerHandles.delete(delayMs);
      const callback = timerCallbacks.get(delayMs);
      timerCallbacks.delete(delayMs);
      callback?.();
    },
  };
}

function complete(child: ReturnType<typeof mockChild>, result: unknown = validResult, code: number | null = 0, signal: string | null = null) {
  child.stdout.emit("data", `PROPOSAL_VERIFY_RESULT:${JSON.stringify(result)}\n`);
  child.emit("close", code, signal);
}

async function waitForChildSpawn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("verifyProposalIsolated", () => {
  const originalLaneFlag = process.env.HEAVY_WORK_LANE_ENABLED;
  const originalConsoleError = console.error;

  before(() => {
    process.env.HEAVY_WORK_LANE_ENABLED = "0";
  });

  after(() => {
    if (originalLaneFlag === undefined) delete process.env.HEAVY_WORK_LANE_ENABLED;
    else process.env.HEAVY_WORK_LANE_ENABLED = originalLaneFlag;
    console.error = originalConsoleError;
  });

  it("requires the shared lane despite the disabled general lane flag and accepts bounded startup output", async () => {
    const { value, child, spawnCalls, releaseCalls } = runtime();
    const pending = __verifyProposalIsolatedForTest(17, 4, value);
    await waitForChildSpawn();
    child.stdout.emit("data", "[startup] optional module initialized\n");
    complete(child);
    assert.deepEqual(await pending, validResult);
    assert.equal(spawnCalls.length, 1);
    assert.ok(spawnCalls[0].args.includes("17"));
    assert.ok(spawnCalls[0].args.includes("4"));
    assert.ok(spawnCalls[0].args.some((arg) => arg.includes("max-old-space-size=2048")));
    assert.deepEqual(releaseCalls, ["released"]);
  });

  it("rejects invalid identifiers before acquiring resources", async () => {
    let acquired = false;
    const { value } = runtime(mockChild(), {
      acquireLane: async () => { acquired = true; return async () => {}; },
    });
    await assert.rejects(__verifyProposalIsolatedForTest(0, 4, value), /proposalId/);
    await assert.rejects(__verifyProposalIsolatedForTest(1, -2, value), /tenantId/);
    assert.equal(acquired, false);
  });

  it("fails closed on nonzero exit and releases the lane", async () => {
    const { value, child, releaseCalls } = runtime();
    const pending = __verifyProposalIsolatedForTest(1, 2, value);
    await waitForChildSpawn();
    complete(child, validResult, 137, null);
    await assert.rejects(pending, /exit/);
    assert.deepEqual(releaseCalls, ["released"]);
  });

  it("fails closed for malformed, absent, or duplicate protocol results", async () => {
    const malformed = runtime();
    const malformedResult = __verifyProposalIsolatedForTest(1, 2, malformed.value);
    await waitForChildSpawn();
    malformed.child.stdout.emit("data", "PROPOSAL_VERIFY_RESULT:{bad}\n");
    malformed.child.emit("close", 0, null);
    await assert.rejects(malformedResult, /protocol/);

    const absent = runtime();
    const absentResult = __verifyProposalIsolatedForTest(1, 2, absent.value);
    await waitForChildSpawn();
    absent.child.stdout.emit("data", "[startup] no result\n");
    absent.child.emit("close", 0, null);
    await assert.rejects(absentResult, /protocol/);

    const duplicate = runtime();
    const duplicateResult = __verifyProposalIsolatedForTest(1, 2, duplicate.value);
    await waitForChildSpawn();
    duplicate.child.stdout.emit("data", `PROPOSAL_VERIFY_RESULT:${JSON.stringify(validResult)}\n`);
    duplicate.child.stdout.emit("data", "PROPOSAL_VERIFY_RESULT:" + JSON.stringify(validResult) + "\n");
    duplicate.child.emit("close", 0, null);
    await assert.rejects(duplicateResult, /protocol/);
  });

  it("keeps a capacity deferral retryable even if diagnostic logging throws", async () => {
    const originalWarn = console.warn;
    try {
      console.warn = () => { throw new Error("log sink failed"); };
      const run = runtime(mockChild(), { rss: () => 1300 * 1024 ** 2 });
      await assert.rejects(
        __verifyProposalIsolatedForTest(1, 2, run.value),
        /parent RSS admission; retry later/,
      );
      assert.equal(run.spawnCalls.length, 0);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("rejects high RSS, a busy lane, and a missing production bundle", async () => {
    const memory = runtime(mockChild(), { rss: () => 1201 * 1024 * 1024 });
    await assert.rejects(__verifyProposalIsolatedForTest(1, 2, memory.value), /unavailable|retry later/i);
    assert.equal(memory.spawnCalls.length, 0);

    const busy = runtime(mockChild(), { acquireLane: async () => null });
    await assert.rejects(__verifyProposalIsolatedForTest(1, 2, busy.value), /unavailable|retry later/i);
    assert.equal(busy.spawnCalls.length, 0);

    const missing = runtime(mockChild(), {
      production: true,
      childBundleExists: () => false,
      readCgroupMemory: () => ({ maxBytes: 4 * 1024 ** 3, currentBytes: 1 * 1024 ** 3 }),
    });
    await assert.rejects(__verifyProposalIsolatedForTest(1, 2, missing.value), /bundle/i);
    assert.equal(missing.spawnCalls.length, 0);
  });

  it("rechecks RSS under the lane and releases when the parent became busy", async () => {
    let samples = 0;
    const { value, spawnCalls, releaseCalls } = runtime(mockChild(), {
      rss: () => (++samples === 1 ? 500 : 1201) * 1024 * 1024,
    });
    await assert.rejects(__verifyProposalIsolatedForTest(1, 2, value), /unavailable|retry later/i);
    assert.equal(spawnCalls.length, 0);
    assert.deepEqual(releaseCalls, ["released"]);
  });

  it("logs a lane release failure without turning a committed pass into a retry", async () => {
    const { value, child } = runtime(mockChild(), {
      acquireLane: async () => async () => { throw new Error("private connection detail"); },
    });
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => { logged.push(args); };
    const pending = __verifyProposalIsolatedForTest(1, 2, value);
    await waitForChildSpawn();
    complete(child);
    assert.deepEqual(await pending, validResult);
    assert.equal(logged.length, 1);
    assert.doesNotMatch(String(logged[0][0]), /private connection detail/);
  });

  it("kills and reaps a timed-out child before rejecting", async () => {
    const { value, child, fireTimer, releaseCalls } = runtime();
    const pending = __verifyProposalIsolatedForTest(1, 2, value);
    await waitForChildSpawn();
    fireTimer(210_000);
    assert.deepEqual(child.killCalls, ["SIGKILL"]);
    child.emit("close", null, "SIGKILL");
    await assert.rejects(pending, /timed out/i);
    assert.deepEqual(releaseCalls, ["released"]);
  });

  it("reports the blocked memory admission with bounded aggregate numbers, not job data", async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    try {
      console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
      const run = runtime(mockChild(), {
        production: true,
        readCgroupMemory: () => ({
          maxBytes: 8 * 1024 ** 3,
          currentBytes: 5.5 * 1024 ** 3,
        }),
      });
      await assert.rejects(__verifyProposalIsolatedForTest(8675309, 4, run.value), /cgroup memory admission/i);
      await assert.rejects(__verifyProposalIsolatedForTest(8675309, 4, run.value), /cgroup memory admission/i);
      assert.equal(run.spawnCalls.length, 0);
      assert.match(warnings.join("\n"), /admission deferred reason=cgroup_headroom/);
      assert.match(warnings.join("\n"), /limit_gib=8\.00 free_gib=2\.50 required_gib=3\.00/);
      assert.doesNotMatch(warnings.join("\n"), /8675309|tenant|payload|secret/i);
      assert.equal(warnings.length, 1, "repeated blocked jobs should not flood the logs");
    } finally {
      console.warn = originalWarn;
    }
  });

  it("reports an unreadable cgroup without exposing the underlying error", async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    try {
      console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
      const run = runtime(mockChild(), {
        production: true,
        readCgroupMemory: () => { throw new Error("private read failure details"); },
      });
      await assert.rejects(__verifyProposalIsolatedForTest(1, 2, run.value), /cgroup memory admission unavailable/i);
      assert.equal(run.spawnCalls.length, 0);
      assert.match(warnings.join("\n"), /admission deferred reason=cgroup_read_error/);
      assert.doesNotMatch(warnings.join("\n"), /private read failure details/);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("defers at cgroup budget reserve and kills a running child when reserve is breached", async () => {
    const nearBudget = runtime(mockChild(), {
      readCgroupMemory: () => ({ maxBytes: 4 * 1024 ** 3, currentBytes: 4 * 1024 ** 3 - 512 * 1024 ** 2 + 1 }),
    });
    await assert.rejects(__verifyProposalIsolatedForTest(1, 2, nearBudget.value), /cgroup memory admission/i);
    assert.equal(nearBudget.spawnCalls.length, 0);
    assert.deepEqual(nearBudget.releaseCalls, ["released"]);

    let samples = 0;
    const inFlight = runtime(mockChild(), {
      readCgroupMemory: () => ({
        maxBytes: 4 * 1024 ** 3,
        currentBytes: ++samples < 3
          ? 1 * 1024 ** 3
          : 4 * 1024 ** 3 - 512 * 1024 ** 2 + 1,
      }),
    });
    const pending = __verifyProposalIsolatedForTest(1, 2, inFlight.value);
    await waitForChildSpawn();
    inFlight.fireTimer(250);
    assert.deepEqual(inFlight.child.killCalls, ["SIGKILL"]);
    inFlight.child.emit("close", null, "SIGKILL");
    await assert.rejects(pending, /cgroup memory reserve/i);
    assert.deepEqual(inFlight.releaseCalls, ["released"]);
  });

  it("requires room for the child before it starts, and observable memory in production", async () => {
    const notEnoughToStart = runtime(mockChild(), {
      readCgroupMemory: () => ({
        maxBytes: 4 * 1024 ** 3,
        currentBytes: 1 * 1024 ** 3 + 1,
      }),
    });
    await assert.rejects(__verifyProposalIsolatedForTest(1, 2, notEnoughToStart.value), /cgroup memory admission/i);
    assert.equal(notEnoughToStart.spawnCalls.length, 0);

    const justEnoughToStart = runtime(mockChild(), {
      readCgroupMemory: () => ({
        maxBytes: 4 * 1024 ** 3,
        currentBytes: 1 * 1024 ** 3,
      }),
    });
    const pending = __verifyProposalIsolatedForTest(1, 2, justEnoughToStart.value);
    await waitForChildSpawn();
    complete(justEnoughToStart.child);
    assert.deepEqual(await pending, validResult);

    const unobservable = runtime(mockChild(), {
      production: true,
      readCgroupMemory: () => null,
    });
    await assert.rejects(__verifyProposalIsolatedForTest(1, 2, unobservable.value), /cgroup memory admission/i);
    assert.equal(unobservable.spawnCalls.length, 0);
  });

  it("uses a larger verifier heap only with 8 GiB capacity and 4.5 GiB free at admission", async () => {
    for (const [maxGiB, usedGiB, expectedHeap] of [
      [8, 3.5, 3072],
      [8, 3.5 + 1 / 1024, 2048],
      [4, 1, 2048],
    ]) {
      const run = runtime(mockChild(), {
        production: true,
        readCgroupMemory: () => ({
          maxBytes: maxGiB * 1024 ** 3,
          currentBytes: usedGiB * 1024 ** 3,
        }),
      });
      const pending = __verifyProposalIsolatedForTest(1, 2, run.value);
      await waitForChildSpawn();
      assert.equal(run.spawnCalls.length, 1);
      assert.ok(run.spawnCalls[0].args.includes(`--max-old-space-size=${expectedHeap}`));
      complete(run.child);
      assert.deepEqual(await pending, validResult);
    }

    const tooBusy = runtime(mockChild(), {
      production: true,
      readCgroupMemory: () => ({
        maxBytes: 8 * 1024 ** 3,
        currentBytes: 5 * 1024 ** 3 + 1,
      }),
    });
    await assert.rejects(__verifyProposalIsolatedForTest(1, 2, tooBusy.value), /cgroup memory admission/i);
    assert.equal(tooBusy.spawnCalls.length, 0);
  });

  it("reports a child spawn request and result without proposal data or changing the outcome", async () => {
    const originalInfo = console.info;
    const observations: string[] = [];
    try {
      console.info = (...args: unknown[]) => { observations.push(args.map(String).join(" ")); };
      const run = runtime(mockChild(), {
        production: true,
        readCgroupMemory: () => ({ maxBytes: 8 * 1024 ** 3, currentBytes: 3 * 1024 ** 3 }),
      });
      const pending = __verifyProposalIsolatedForTest(8675309, 4, run.value);
      await waitForChildSpawn();
      complete(run.child);
      assert.deepEqual(await pending, validResult);
      assert.match(observations.join("\n"), /child_spawn_requested heap_mb=3072/);
      assert.match(observations.join("\n"), /child_result heap_mb=3072 status=passed/);
      assert.doesNotMatch(observations.join("\n"), /8675309|tenant|payload|details/);

      console.info = () => { throw new Error("logging unavailable"); };
      const noLogs = runtime();
      const again = __verifyProposalIsolatedForTest(1, 2, noLogs.value);
      await waitForChildSpawn();
      complete(noLogs.child);
      assert.deepEqual(await again, validResult);
    } finally {
      console.info = originalInfo;
    }
  });

  it("kills the running verifier when its PostgreSQL lock is lost", async () => {
    let loseLock: (() => void) | undefined;
    const run = runtime(mockChild(), {
      acquireLane: async (_label, options) => {
        loseLock = options?.onLost;
        return async () => { run.releaseCalls.push("released"); };
      },
    });
    const pending = __verifyProposalIsolatedForTest(1, 2, run.value);
    await waitForChildSpawn();
    assert.ok(loseLock);
    loseLock();
    assert.deepEqual(run.child.killCalls, ["SIGKILL"]);
    run.child.emit("close", null, "SIGKILL");
    await assert.rejects(pending, /lost its heavy-work lane lock/i);
    assert.deepEqual(run.releaseCalls, ["released"]);
  });

  it("bounds a queued verification by its remaining lease and defers an expired lease", async () => {
    const shortLease = runtime(mockChild());
    const pending = __verifyProposalIsolatedForTest(1, 2, shortLease.value, 70_100);
    await waitForChildSpawn();
    shortLease.fireTimer(40_000);
    assert.deepEqual(shortLease.child.killCalls, ["SIGKILL"]);
    shortLease.child.emit("close", null, "SIGKILL");
    await assert.rejects(pending, /timed out/i);

    const expired = runtime(mockChild());
    await assert.rejects(
      __verifyProposalIsolatedForTest(1, 2, expired.value, 20_100),
      /lease nearly expired/i,
    );
    assert.equal(expired.spawnCalls.length, 0);
  });

  it("packages the production child with TypeScript bundled, not externally required", async () => {
    const buildSource = readFileSync("scripts/build.ts", "utf8");
    assert.match(buildSource, /const childExternals = externals\.filter\(\(dep\) => dep !== "typescript"\)/);

    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    } as Record<string, string>;
    const allowlist = new Set([
      "axios", "connect-pg-simple", "cors", "date-fns", "drizzle-orm", "drizzle-zod",
      "express", "express-rate-limit", "express-session", "jsonwebtoken", "memorystore",
      "multer", "nanoid", "nodemailer", "passport", "passport-local", "pg", "uuid",
      "ws", "zod", "zod-validation-error",
    ]);
    const externals = Object.keys(dependencies)
      .filter((dependency) => !allowlist.has(dependency) && dependency !== "typescript");
    externals.push("@coinbase/cdp-sdk");

    const result = await esbuild({
      entryPoints: ["scripts/proposal-verifier-child.ts"],
      platform: "node",
      bundle: true,
      format: "cjs",
      outfile: "dist/proposal-verifier-child.cjs",
      write: false,
      metafile: true,
      external: externals,
      logLevel: "silent",
    });
    const output = Object.values(result.metafile!.outputs).find((entry) => entry.entryPoint === "scripts/proposal-verifier-child.ts");
    assert.ok(output);
    assert.equal(output.imports.some((entry) => entry.external && /^typescript(?:\/|$)/.test(entry.path)), false);
    const normalizedInputs = Object.keys(result.metafile!.inputs).map((input) => input.replace(/\\/g, "/"));
    assert.ok(normalizedInputs.some((input) => input === "node_modules/typescript/lib/typescript.js"
      || input.endsWith("/node_modules/typescript/lib/typescript.js")));
    const bundleText = result.outputFiles?.[0]?.text ?? "";
    assert.doesNotMatch(bundleText, /require\(["']typescript["']\)/);
  });

  it("stages the bundled compiler's standard libraries alongside the production child", async () => {
    const buildSource = readFileSync("scripts/build.ts", "utf8");
    assert.match(buildSource, /await stageTypeScriptStandardLibraries\("dist"\)/);
    const directory = await mkdtemp(join(tmpdir(), "verifier-ts-libs-"));
    try {
      const count = await stageTypeScriptStandardLibraries(directory);
      assert.ok(count >= 50, "all TypeScript standard libraries must be staged");
      for (const name of ["lib.d.ts", "lib.dom.d.ts", "lib.esnext.d.ts", "lib.decorators.d.ts"]) {
        assert.equal(
          readFileSync(join(directory, name), "utf8"),
          readFileSync(join("node_modules/typescript/lib", name), "utf8"),
          `${name} must match the compiler bundled at build time`,
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});