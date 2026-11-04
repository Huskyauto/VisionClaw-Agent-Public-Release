import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { transformSync } from "esbuild";
import * as pdf from "pdf-lib";
import { readTenantPdfInput, uniquePdfOutputName } from "../../server/lib/pdf-input-ownership";

async function fixture() {
  const doc = await pdf.PDFDocument.create();
  const page = doc.addPage();
  const field = doc.getForm().createTextField("private-value");
  field.setText("OWNED_VALUE");
  field.addToPage(page);
  const data = Buffer.from(await doc.save()).toString("base64");
  const records = [
    { filename: "owned.pdf", tenantId: 2, data },
    { filename: "foreign.pdf", tenantId: 3, data },
    { filename: "stored.pdf", tenantId: 2, data: "", storageKey: "tenant-2/uploads/stored.pdf", size: Buffer.from(data, "base64").length },
  ];
  const queries: unknown[] = [];
  const lookup = async (filename: string, tenantId: number) => {
    queries.push([filename, tenantId]);
    return records.filter(row => row.filename === filename && row.tenantId === tenantId);
  };
  const downloads: unknown[] = [];
  const download = async (tenantId: number, key: string) => {
    downloads.push([tenantId, key]);
    assert.equal(tenantId, 2);
    assert.equal(key, "tenant-2/uploads/stored.pdf");
    return Buffer.from(data, "base64");
  };
  return { data, queries, lookup, download, downloads };
}

function declarations() {
  const source = readFileSync("server/pdf-create.ts", "utf8");
  const ast = ts.createSourceFile("pdf-create.ts", source, ts.ScriptTarget.Latest, true);
  const wanted = new Set(["requirePdfTenant", "fillPdf", "editPdf", "listPdfFields", "createPdf"]);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && wanted.has(node.name.text));
  assert.equal(functions.length, wanted.size);
  return transformSync(functions.map(node => node.getText(ast)).join("\n"), { loader: "ts", format: "cjs", target: "es2022" }).code;
}

test("owned upload is loaded from tenant-filtered stored bytes, never a caller-selected local file", async () => {
  const f = await fixture();
  assert.equal(Buffer.from(await readTenantPdfInput("/uploads/owned.pdf", 2, f.lookup)).toString("base64"), f.data);
  await assert.rejects(readTenantPdfInput("foreign.pdf", 2, f.lookup), /owned upload/);
  assert.deepEqual(f.queries, [["owned.pdf", 2], ["foreign.pdf", 2]]);
});

test("missing scope and workspace/traversal paths fail before lookup", async () => {
  let queries = 0;
  const lookup = async () => { queries++; return []; };
  for (const tenant of [undefined, 0, -1, NaN, 2.5]) {
    await assert.rejects(readTenantPdfInput("owned.pdf", tenant as number, lookup), /tenantId/);
  }
  for (const file of ["../owned.pdf", "/etc/private.pdf", "server/private.pdf", "uploads/../owned.pdf", "https://example.test/a.pdf", "a\\b.pdf"]) {
    await assert.rejects(readTenantPdfInput(file, 2, lookup));
  }
  assert.equal(queries, 0);
});

test("ambiguous, missing or oversized stored content is not accepted", async () => {
  await assert.rejects(readTenantPdfInput("owned.pdf", 2, async () => []), /owned upload/);
  await assert.rejects(readTenantPdfInput("owned.pdf", 2, async () => [{ data: "a" }, { data: "b" }]), /owned upload/);
  await assert.rejects(readTenantPdfInput("owned.pdf", 2, async () => [{ data: "" }]), /stored PDF/);
  await assert.rejects(readTenantPdfInput("owned.pdf", 2, async () => [{ data: "a".repeat(70 * 1024 * 1024 + 1) }]), /oversized/);
});

test("normal successful Object Storage uploads remain readable through tenant-bound download", async () => {
  const f = await fixture();
  const bytes = await readTenantPdfInput("stored.pdf", 2, f.lookup, f.download);
  assert.equal(Buffer.from(bytes).toString("base64"), f.data);
  assert.deepEqual(f.downloads, [[2, "tenant-2/uploads/stored.pdf"]]);
  let calls = 0;
  const download = async () => { calls++; return new Uint8Array(); };
  for (const storageKey of ["tenant-3/uploads/foreign.pdf", "tenant-20/uploads/foreign.pdf"]) {
    await assert.rejects(readTenantPdfInput("owned.pdf", 2, async () => [{ data: "", storageKey, size: 1 }], download), /owned upload/);
  }
  await assert.rejects(readTenantPdfInput("owned.pdf", 2, async () => [{
    data: "", storageKey: "tenant-2/uploads/large.pdf", size: 51 * 1024 * 1024,
  }], download), /oversized/);
  assert.equal(calls, 0);
  await assert.rejects(readTenantPdfInput("owned.pdf", 2, async () => [{
    data: f.data, storageKey: "tenant-2/uploads/stored.pdf", size: 1,
  }], async () => new Uint8Array([1, 2])), /stored PDF/);
  await assert.rejects(readTenantPdfInput("owned.pdf", 2, async () => [{
    data: f.data, storageKey: "tenant-2/uploads/stored.pdf", size: 1,
  }], async () => { throw new Error("storage unavailable"); }), /storage unavailable/);
});

test("actual fill, edit and inspection declarations reject foreign files before parsing or writing; owned controls work", async () => {
  const f = await fixture();
  let loads = 0, writes = 0;
  const module: any = { exports: {} };
  const context: any = {
    module, exports: module.exports, Buffer, path, console,
    ...pdf,
    PDFDocument: { load: async (bytes: Uint8Array) => { loads++; return pdf.PDFDocument.load(bytes); } },
    readTenantPdfInput: (file: string, tid: number) => readTenantPdfInput(file, tid, f.lookup, f.download),
    uniquePdfOutputName,
    ensureOutputDir: () => { writes++; },
    resolveUploadsChild: (file: string) => `/uploads/${file}`,
    persistToDb: async (_name: string, _original: string, _bytes: Uint8Array, tid: number) => { assert.equal(tid, 2); },
    fs: { writeFileSync: () => { writes++; } },
  };
  vm.runInNewContext(declarations(), context);
  const fns = module.exports;
  const headerResult = await fns.createPdf({ tenantId: 2, headerImage: { path: "foreign.pdf" } });
  assert.equal(headerResult.success, false);
  assert.match(headerResult.error, /owned upload/);
  for (const name of ["fillPdf", "editPdf", "listPdfFields"]) {
    const result = name === "listPdfFields"
      ? await fns[name]("foreign.pdf", 2)
      : await fns[name]({ tenantId: 2, inputPath: "foreign.pdf", fields: {} });
    assert.equal(result.success, false, name);
    assert.match(result.error, /owned upload/, name);
  }
  assert.equal(loads, 0);
  assert.equal(writes, 0);
  for (const inputPath of ["owned.pdf", "stored.pdf"])
    for (const name of ["fillPdf", "editPdf", "listPdfFields"]) {
      const result = name === "listPdfFields"
        ? await fns[name](inputPath, 2)
        : await fns[name]({ tenantId: 2, inputPath, fields: {} });
      assert.equal(result.success, true, `${name}/${inputPath}: ${result.error}`);
      if (name === "listPdfFields") assert.equal(result.fields[0].value, "OWNED_VALUE");
    }
});

test("output names cannot alias caller-selected paths; inspection receives trusted tool context", () => {
  const a = uniquePdfOutputName("../../foreign.pdf", 2);
  const b = uniquePdfOutputName("../../foreign.pdf", 2);
  assert.notEqual(a, b);
  assert.match(a, /^pdf-2-[a-f0-9-]+-foreign\.pdf$/);
  assert.equal(path.basename(a), a);
  const source = readFileSync("server/tools/domains/documents/handlers.ts", "utf8");
  assert.match(source, /return listPdfFields\(params\.inputPath, ctx\.tenantId\)/);
  assert.doesNotMatch(source, /return listPdfFields\(params\.inputPath\);/);
  const helper = readFileSync("server/lib/pdf-input-ownership.ts", "utf8");
  assert.match(helper, /eq\(fileStorage\.filename, filename\), eq\(fileStorage\.tenantId, tenantId\)/);
  const pdfSource = readFileSync("server/pdf-create.ts", "utf8");
  assert.doesNotMatch(pdfSource, /resolveUploadPath\(/);
  assert.match(pdfSource, /headerImageBytes = params\.headerImage\s*\? await readTenantPdfInput/);
  assert.doesNotMatch(pdfSource, /resolveUploadsChild\(path\.basename\(filename\)\)/);
  assert.doesNotMatch(pdfSource, /const filename = `\$\{slug\}\.pdf`/);
});
