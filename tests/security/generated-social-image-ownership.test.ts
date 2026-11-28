import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";

const source = readFileSync("server/lib/social-image-tool.ts", "utf8");
const branch = source.slice(source.indexOf("export async function generateSocialImageTool(")).replace(/^export /, "");
assert.match(readFileSync("server/tools.ts", "utf8"), /return generateSocialImageTool\(params, \{ errorMessage, retryWithBackoff \}\)/);

async function generate(tenantId: unknown, referenceImagePaths: string[] = [], redirectedOutput = false) {
  const writes: string[] = [], uploads: any[] = [], authorized: string[] = [];
  let models = 0, cleaned = 0;
  const box = vm.createContext({
    Buffer, console,
    process: { cwd: () => "/workspace" },
    errorMessage: (error: Error) => error.message,
    retryWithBackoff: (work: Function) => work(),
    __fixtureImport: async (name: string) => {
      if (name.startsWith("../")) name = "./" + name.slice(3);
      if (name === "./replit_integrations/image/client") return {
        generateImage: async (_prompt: string, options: any) => {
          for (const file of options.referenceImagePaths ?? []) assert.equal(typeof file, "string");
          models++; return "data:image/png;base64,ZmFrZQ==";
        },
      };
      if (name === "./google-drive") return {
        uploadAndShare: async (options: any) => {
          uploads.push(options); return { success: true, fileId: "fixture", viewUrl: "fixture-view" };
        },
      };
      if (name === "fs/promises") return { writeFile: async (file: string) => { writes.push(file); } };
      if (name === "fs") return {
        existsSync: () => true, mkdirSync: () => {},
        realpathSync: (file: string) => redirectedOutput && file.endsWith("/tenant-7")
          ? file.replace("/tenant-7", "/tenant-8") : file,
      };
      if (name === "path") return path;
      if (name === "crypto") return { randomUUID: () => "unique-fixture" };
      if (name === "./site-config") return { siteConfig: { platformName: "fixture" } };
      if (name === "./image-ref-jail") return {
        filterAllowedRefPaths: (paths: string[]) => ({ allowed: paths, rejected: [] }),
      };
      if (name === "./video-editor") return {
        resolveInputPath: async (file: string, tenant: number) => {
          assert.equal(tenant, 7);
          authorized.push(file);
          if (file.startsWith("/workspace/project-assets/tenant-7/")) {
            return { filePath: file, cleanup: () => { cleaned++; } };
          }
          throw new Error("Media source is not owned by this tenant");
        },
      };
      throw new Error(`Unexpected fixture dependency: ${name}`);
    },
  });
  vm.runInContext(transformSync(
    `${branch}\nglobalThis.invoke = params => generateSocialImageTool(params, {errorMessage, retryWithBackoff});`,
    { loader: "ts", format: "cjs" },
  ).code.replace(/\bimport\(/g, "__fixtureImport("), box);
  const result = await (box as any).invoke({
    _tenantId: tenantId, prompt: "fixture", reference_image_paths: referenceImagePaths,
  });
  return { result, writes, uploads, authorized, models, cleaned };
}

test("generated images are stored in the authenticated tenant namespace", async () => {
  const run = await generate(7);
  assert.equal(run.result.error, undefined, run.result.error);
  assert.equal(run.writes.length, 1);
  assert.equal(path.dirname(run.writes[0]), "/workspace/project-assets/tenant-7");
  assert.equal(run.uploads[0].filePath, run.writes[0]);
  assert.equal(run.uploads[0].tenantId, 7);
});

test("missing or malformed tenant identity is rejected before generation or storage", async () => {
  for (const tenant of [undefined, null, 0, -1, "7", 1.5, NaN]) {
    const run = await generate(tenant);
    assert.ok(run.result.error);
    assert.equal(run.models, 0);
    assert.equal(run.writes.length, 0);
    assert.equal(run.uploads.length, 0);
  }
});

test("a redirected tenant output namespace is rejected before model spending or file writes", async () => {
  const run = await generate(7, [], true);
  assert.ok(run.result.error);
  assert.equal(run.models, 0);
  assert.equal(run.writes.length, 0);
  assert.equal(run.uploads.length, 0);
});

test("foreign reference images cannot reach the model even inside an allowed asset root", async () => {
  const input = "/workspace/project-assets/tenant-8/private.png";
  const run = await generate(7, [input]);
  assert.ok(run.result.error);
  assert.deepEqual(run.authorized, [input]);
  assert.equal(run.models, 0);
  assert.equal(run.writes.length, 0);
});

test("verified reference paths reach generation as paths and staged bytes are cleaned", async () => {
  const run = await generate(7, ["/workspace/project-assets/tenant-7/verified.png"]);
  assert.equal(run.result.error, undefined, run.result.error);
  assert.equal(run.models, 1);
  assert.equal(run.cleaned, 1);
});

test("a later denied reference also cleans earlier authorized staged bytes", async () => {
  const run = await generate(7, [
    "/workspace/project-assets/tenant-7/verified.png", "/workspace/project-assets/tenant-8/private.png",
  ]);
  assert.ok(run.result.error);
  assert.equal(run.models, 0);
  assert.equal(run.cleaned, 1);
});
