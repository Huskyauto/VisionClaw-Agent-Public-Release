import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import { isSafeUploadsHttpPath } from "../../server/lib/uploads-http-path";

function loadUploadsMiddleware(options: {
  ownersForFilename: (filename: string) => Array<{ tenantId: number }>;
  verifyUploadSig?: (filename: string, tenantId: number, expiresAt: number, signature: string) => boolean;
  rawBasenameVariant?: boolean;
}) {
  const source = readFileSync("server/routes.ts", "utf8");
  const marker = 'app.use("/uploads", ';
  const start = source.indexOf(marker);
  const end = source.indexOf("}, express.static(UPLOADS_DIR));", start);
  assert.ok(start >= 0 && end > start, "extract the actual production uploads middleware");
  let handlerSource = source.slice(start + marker.length, end + 1)
    .replaceAll('await import("./db")', "__dbModule")
    .replaceAll('await import("drizzle-orm")', "__drizzle")
    .replaceAll('await import("@shared/schema")', "__schema")
    .replaceAll('await import("./upload-signing")', "__signing");
  if (options.rawBasenameVariant) {
    handlerSource = handlerSource.replace(
      "const canonicalPath = decodeURIComponent(req.path);",
      "const canonicalPath = req.path;",
    );
  }
  const compiled = transformSync("module.exports = " + handlerSource + ";", {
    loader: "ts",
    target: "node20",
    format: "cjs",
  }).code;
  const module = { exports: undefined as any };
  const sqlFilenames: string[] = [];
  const fakeDb = {
    select() {
      return {
        from() {
          return {
            where(condition: { value: string }) {
              sqlFilenames.push(condition.value);
              return options.ownersForFilename(condition.value);
            },
          };
        },
      };
    },
  };
  vm.runInNewContext(compiled, {
    module,
    isSafeUploadsHttpPath,
    path,
    fileStorage: { filename: "filename", tenantId: "tenantId" },
    __dbModule: { db: fakeDb },
    __drizzle: { eq: (column: unknown, value: string) => ({ column, value }) },
    __schema: { fileStorage: { filename: "filename", tenantId: "tenantId" } },
    __signing: {
      verifyUploadSig: (...args: [string, number, number, string]) =>
        options.verifyUploadSig?.(...args) ?? false,
    },
    getSession: async (token: string) => token === "actor-2-session" ? { tenantId: 2 } : undefined,
    getTenantFromRequest: (req: { tenantId?: number }) => req.tenantId,
    logSilentCatch() {},
    UPLOADS_DIR: "/uploads",
  });
  return {
    handler: module.exports as (req: any, res: any, next: () => void) => Promise<void>,
    sqlFilenames,
  };
}

async function runUploadsMiddleware(
  handler: (req: any, res: any, next: () => void) => Promise<void>,
  requestPath: string,
  query: Record<string, string> = {},
) {
  let status = 0;
  let nextCalls = 0;
  const response = {
    status(value: number) { status = value; return this; },
    json() { return this; },
    setHeader() { return this; },
    on() { return this; },
  };
  await handler(
    {
      path: requestPath,
      query,
      headers: { authorization: "Bearer actor-2-session" },
      method: "GET",
    },
    response,
    () => { nextCalls++; },
  );
  return { status, nextCalls };
}

test("private Drive namespaces and encoded separators are never admitted to HTTP uploads", () => {
  for (const requestPath of [
    "/tenant-drive/2/file.txt",
    "/%74enant-drive/2/file.txt",
    "/tenant-drive%2F2%2Ffile.txt",
    "/owned%2F..%2Ftenant-drive%2F3%2Ffile.txt",
    "/%2Fother-tenant.txt",
    "/owned%5C..%5Cother-tenant.txt",
    "/owned/../other-tenant.txt",
    "/file%00.txt",
    "/bad%ZZ.txt",
  ]) assert.equal(isSafeUploadsHttpPath(requestPath), false, requestPath);
});

test("ordinary flat names and canonical presenter cache paths remain admitted", () => {
  for (const requestPath of [
    "/delivery-123-report.pdf",
    "/ordinary.txt",
    "/ordinary%20report.txt",
    "/presenter-slides/presentation_12/slide-1.png",
    "/literal%252Ffilename.txt",
  ]) assert.equal(isSafeUploadsHttpPath(requestPath), true, requestPath);
});

test("actual uploads middleware rejects private and encoded paths before auth or static", async () => {
  const source = readFileSync("server/routes.ts", "utf8");
  const marker = 'app.use("/uploads", ';
  const start = source.indexOf(marker);
  const end = source.indexOf("}, express.static(UPLOADS_DIR));", start);
  assert.ok(start >= 0 && end > start, "extract the actual production uploads middleware");
  const handlerSource = "module.exports = " + source.slice(start + marker.length, end + 1) + ";";
  const compiled = transformSync(handlerSource, { loader: "ts", target: "node20", format: "cjs" }).code;
  const module = { exports: undefined as any };
  vm.runInNewContext(compiled, { module, isSafeUploadsHttpPath });
  for (const requestPath of ["/tenant-drive/3/file.txt", "/owned%2F..%2Ftenant-drive%2F3%2Ffile.txt", "/%2Fother.txt", "/bad%ZZ.txt"]) {
    let status = 0;
    let nextCalls = 0;
    await module.exports(
      { path: requestPath },
      { status(value: number) { status = value; return this; }, json() { return this; } },
      () => { nextCalls++; },
    );
    assert.equal(status, 404, requestPath);
    assert.equal(nextCalls, 0, "static never receives the private path");
  }
});

test("uploads middleware authorizes and classifies the once-decoded basename", async () => {
  const actor2 = { tenantId: 2 };
  const foreignOwner = { tenantId: 3 };
  const middleware = loadUploadsMiddleware({
    ownersForFilename: (filename) => filename === "victim.txt" ? [foreignOwner] : [],
    verifyUploadSig: () => true,
  });

  const foreign = await runUploadsMiddleware(middleware.handler, "/%76ictim.txt");
  assert.equal(foreign.status, 404);
  assert.equal(foreign.nextCalls, 0);
  assert.equal(middleware.sqlFilenames.at(-1), "victim.txt");

  const unsignedDelivery = await runUploadsMiddleware(
    middleware.handler,
    "/%64elivery-123-report.pdf",
  );
  assert.equal(unsignedDelivery.status, 404, "a bare session is not a capability for a rowless delivery asset");
  assert.equal(unsignedDelivery.nextCalls, 0);
  assert.equal(middleware.sqlFilenames.at(-1), "delivery-123-report.pdf");

  let signedFilename = "";
  const signedMiddleware = loadUploadsMiddleware({
    ownersForFilename: () => [],
    verifyUploadSig(filename) {
      signedFilename = filename;
      return true;
    },
  });
  const signedDelivery = await runUploadsMiddleware(
    signedMiddleware.handler,
    "/%64elivery-123-report.pdf",
    { tid: "2", exp: "1234", sig: "valid-signature" },
  );
  assert.equal(signedDelivery.nextCalls, 1);
  assert.equal(signedFilename, "delivery-123-report.pdf");

  const ownedMiddleware = loadUploadsMiddleware({
    ownersForFilename: (filename) => filename === "ordinary report.txt" || filename === "literal%2Ffilename.txt"
      ? [actor2]
      : [],
  });
  const ownedSpace = await runUploadsMiddleware(ownedMiddleware.handler, "/ordinary%20report.txt");
  assert.equal(ownedSpace.nextCalls, 1);
  assert.equal(ownedMiddleware.sqlFilenames.at(-1), "ordinary report.txt");

  const escapedPercent = await runUploadsMiddleware(
    ownedMiddleware.handler,
    "/literal%252Ffilename.txt",
  );
  assert.equal(escapedPercent.nextCalls, 1);
  assert.equal(ownedMiddleware.sqlFilenames.at(-1), "literal%2Ffilename.txt", "escaped percent is decoded exactly once");

  const oldRawBasename = loadUploadsMiddleware({
    ownersForFilename: (filename) => filename === "victim.txt" ? [foreignOwner] : [],
    rawBasenameVariant: true,
  });
  const oldVariantResult = await runUploadsMiddleware(oldRawBasename.handler, "/%76ictim.txt");
  assert.equal(oldRawBasename.sqlFilenames[0], "%76ictim.txt");
  assert.equal(oldVariantResult.nextCalls, 1, "the old raw-basename variant would fail the foreign-owner 404 regression");
});