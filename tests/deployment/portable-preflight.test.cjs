const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync, existsSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join, delimiter } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const npmExecutable = process.env.PATH.split(delimiter).map(p => join(p, "npm")).find(existsSync);
assert.ok(npmExecutable, "npm is required to exercise the actual package commands");

for (const command of ["build", "publish:preflight"]) {
  test(`${command} rejects a private lockfile before compilation or database access`, () => {
    const dir = mkdtempSync(join(tmpdir(), "portable-preflight-"));
    try {
      mkdirSync(join(dir, "tests/deployment"), { recursive: true });
      mkdirSync(join(dir, "scripts/lib"), { recursive: true });
      mkdirSync(join(dir, "bin"));
      symlinkSync(process.execPath, join(dir, "bin/node"));
      symlinkSync(npmExecutable, join(dir, "bin/npm"));
      symlinkSync("/bin/sh", join(dir, "bin/sh"));
      copyFileSync(join(root, "tests/deployment/portable-install.test.cjs"),
        join(dir, "tests/deployment/portable-install.test.cjs"));
      copyFileSync(join(root, "scripts/prepublish.ts"), join(dir, "scripts/prepublish.ts"));
      writeFileSync(join(dir, "scripts/remote-release.ts"),
        "throw new Error('REMOTE_NETWORK_REACHED');\n");
      writeFileSync(join(dir, "scripts/lib/prepublish-remote-gate.ts"),
        "throw new Error('DATABASE_CATALOG_REACHED');\n");
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        ...pkg, private: false,
        scripts: { ...pkg.scripts, check: "node -e \"throw Error('COMPILATION_REACHED')\"" },
      }));
      writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ packages: {
        "node_modules/example": {
          resolved: "https://package-firewall.replit.internal/example.tgz",
          integrity: "sha512-fixture",
        },
      } }));
      const result = spawnSync("npm", ["run", command], {
        cwd: dir, encoding: "utf8", timeout: 15_000,
        // Match checkout-before-npm-ci: no local dependency link or ambient tsx.
        env: { PATH: join(dir, "bin"), HOME: dir, XDG_CONFIG_HOME: dir, npm_config_cache: join(dir, "cache") },
      });
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      const output = result.stdout + result.stderr;
      assert.match(output, /Nonportable or integrity-free package downloads/);
      assert.doesNotMatch(output,
        /COMPILATION_REACHED|tsx:.*not found|ERR_MODULE_NOT_FOUND|REMOTE_NETWORK_REACHED|DATABASE_CATALOG_REACHED/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
