import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { isPathInAllowedRoots } from "../../server/lib/image-ref-jail";

test("verified media bytes remain in the image client's jail and are cleaned after use", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verified-reference-test-"));
  let resolved: { filePath: string; cleanup?: () => void } | undefined;
  try {
    const uploads = path.join(root, "uploads");
    const assets = path.join(root, "project-assets");
    const privateTemp = path.join(assets, "tenant-27", "video-editor", "tmp");
    fs.mkdirSync(uploads);
    fs.mkdirSync(privateTemp, { recursive: true });
    const input = path.join(uploads, "owned.png");
    fs.writeFileSync(input, "unverified local cache");
    const source = fs.readFileSync("server/video-editor.ts", "utf8");
    const start = source.indexOf("export async function resolveInputPath(");
    const end = source.indexOf("// ---------------------------------------------------------------------------", start);
    assert.ok(start >= 0 && end > start);
    const guard = source.slice(start, end).replace(/^export /, "").replace(/\bimport\(/g, "__fixtureImport(");
    const outputHelpers = source.slice(source.indexOf("function mediaOutputDirs("),
      source.indexOf("// R110.20"));
    const box = vm.createContext({
      fs, os, path, exports: {},
      currentTenantId: () => 27, ADMIN_TENANT_ID: 1, WORKSPACE_ROOT: root, UPLOADS_DIR: uploads,
      isPathWithin: (base: string, file: string) => {
        const relative = path.relative(base, file);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
      },
      resolveUploadsChild: (file: string) => path.join(uploads, file),
      __fixtureImport: async (name: string) => {
        assert.equal(name, "./google-drive");
        return { readTenantDriveUploadBytes: async (file: string, tenant: number) => {
          assert.equal(file, input);
          assert.equal(tenant, 27);
          return Buffer.from("verified owned bytes");
        } };
      },
    });
    vm.runInContext(transformSync(`${outputHelpers}\n${guard}\nglobalThis.guard = resolveInputPath;`, {
      loader: "ts", format: "cjs",
    }).code, box);
    resolved = await (box as any).guard(input, 27);
    assert.ok(resolved);
    assert.equal(isPathInAllowedRoots(resolved.filePath, [assets]), true);
    assert.equal(fs.readFileSync(resolved.filePath, "utf8"), "verified owned bytes");
    const staged = resolved.filePath;
    resolved.cleanup?.();
    assert.equal(fs.existsSync(staged), false);
    fs.rmSync(path.dirname(privateTemp), { recursive: true, force: true });
    const foreignDirectory = path.join(root, "foreign-tenant");
    fs.mkdirSync(foreignDirectory);
    fs.symlinkSync(foreignDirectory, path.dirname(privateTemp), "dir");
    await assert.rejects(() => (box as any).guard(input, 27), /symlink/i);
  } finally {
    resolved?.cleanup?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
