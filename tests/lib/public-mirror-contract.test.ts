import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compareMirrorContract } from "../../scripts/lib/public-mirror-contract";

test("public mirror contract: missing upstream export fails closed", () => {
  const result = compareMirrorContract(
    `export interface CatalogProduct { sku: string; }\nexport function lookupProduct(sku: string): CatalogProduct | null { return null; }`,
    `export interface CatalogProduct { sku: string; }\n`,
    "server/product-catalog.ts",
  );

  assert.equal(result.ok, false);
  assert.match(result.message, /missing exported function "lookupProduct"/);
});

test("public mirror contract: default exports fail closed until explicitly modeled", () => {
  const result = compareMirrorContract(
    `export const catalog = {};\nexport default catalog;`,
    `export const catalog = {};`,
    "server/product-catalog.ts",
  );

  assert.equal(result.ok, false);
  assert.match(result.message, /unsupported export declaration/i);
});

test("public mirror contract: named default function declarations fail closed", () => {
  const result = compareMirrorContract(
    `export default function lookupProduct(sku: string): string | null { return null; }`,
    `export function lookupProduct(sku: string): string | null { return null; }`,
    "server/product-catalog.ts",
  );

  assert.equal(result.ok, false);
  assert.match(result.message, /unsupported export declaration/i);
});

test("public mirror contract: re-exports and overloads fail closed until explicitly modeled", () => {
  const reExport = compareMirrorContract(
    `export const catalog = {};\nexport { catalog as publicCatalog };`,
    `export const catalog = {};`,
    "server/product-catalog.ts",
  );
  assert.equal(reExport.ok, false);
  assert.match(reExport.message, /unsupported export declaration/i);

  const overloaded = compareMirrorContract(
    `export function lookupProduct(sku: string): string;\nexport function lookupProduct(sku: number): string;\nexport function lookupProduct(_sku: string | number): string { return ""; }`,
    `export function lookupProduct(_sku: string | number): string { return ""; }`,
    "server/product-catalog.ts",
  );
  assert.equal(overloaded.ok, false);
  assert.match(overloaded.message, /duplicate exported declaration "lookupProduct"/);
});

test("public mirror contract: duplicate interface members and overloads fail closed", () => {
  const overloadedMember = compareMirrorContract(
    `export interface Catalog { lookup(sku: string): string; lookup(id: number): string; }`,
    `export interface Catalog { lookup(id: number): string; }`,
    "server/product-catalog.ts",
  );
  assert.equal(overloadedMember.ok, false);
  assert.match(overloadedMember.message, /duplicate member "lookup"/);

  const duplicateProperty = compareMirrorContract(
    `export interface Catalog { sku: string; sku: number; }`,
    `export interface Catalog { sku: number; }`,
    "server/product-catalog.ts",
  );
  assert.equal(duplicateProperty.ok, false);
  assert.match(duplicateProperty.message, /duplicate member "sku"/);
});

test("public mirror contract: value types and literal punctuation are preserved", () => {
  const valueType = compareMirrorContract(
    `export const catalog: "a;b" = "a;b";`,
    `export const catalog: "ab" = "ab";`,
    "server/product-catalog.ts",
  );
  assert.equal(valueType.ok, false);
  assert.match(valueType.message, /signature drifted/);

  const literalMember = compareMirrorContract(
    `export interface Catalog { state: "a;b"; }`,
    `export interface Catalog { state: "ab"; }`,
    "server/product-catalog.ts",
  );
  assert.equal(literalMember.ok, false);
  assert.match(literalMember.message, /member "state" drifted/);
});

test("public mirror contract: generic and readonly API shape are preserved", () => {
  const genericFunction = compareMirrorContract(
    `export function lookupProduct<T>(): string | null { return null; }`,
    `export function lookupProduct(): string | null { return null; }`,
    "server/product-catalog.ts",
  );
  assert.equal(genericFunction.ok, false);
  assert.match(genericFunction.message, /signature drifted/);

  const genericReadonlyInterface = compareMirrorContract(
    `export interface Catalog<T> { readonly sku: string; }`,
    `export interface Catalog { sku: string; }`,
    "server/product-catalog.ts",
  );
  assert.equal(genericReadonlyInterface.ok, false);
  assert.match(genericReadonlyInterface.message, /signature drifted|member "sku" drifted/);
});

test("public mirror contract: interface inheritance is preserved", () => {
  const result = compareMirrorContract(
    `export interface Parent { sku: string; }\nexport interface Catalog extends Parent {}`,
    `export interface Parent { sku: string; }\nexport interface Catalog {}`,
    "server/product-catalog.ts",
  );

  assert.equal(result.ok, false);
  assert.match(result.message, /exported interface "Catalog" signature drifted/);
});

test("public mirror contract: unannotated public signatures fail closed", () => {
  const functionResult = compareMirrorContract(
    `export function lookupProduct() { return "catalog"; }`,
    `export function lookupProduct() { return "catalog"; }`,
    "server/product-catalog.ts",
  );
  assert.equal(functionResult.ok, false);
  assert.match(functionResult.message, /unsupported export declaration/i);

  const methodResult = compareMirrorContract(
    `export interface Catalog { lookupProduct(); }`,
    `export interface Catalog { lookupProduct(); }`,
    "server/product-catalog.ts",
  );
  assert.equal(methodResult.ok, false);
  assert.match(methodResult.message, /unsupported export declaration/i);
});

test("public mirror contract: missing required interface member fails closed", () => {
  const result = compareMirrorContract(
    `export interface CatalogProduct { sku: string; serviceType?: "report"; }`,
    `export interface CatalogProduct { sku: string; }`,
    "server/product-catalog.ts",
  );

  assert.equal(result.ok, false);
  assert.match(result.message, /interface "CatalogProduct" is missing member "serviceType"/);
});

test("public mirror contract: changed function signature fails closed", () => {
  const result = compareMirrorContract(
    `export function lookupProduct(sku: string, tenantId: number): string | null { return null; }`,
    `export function lookupProduct(sku: string): string | null { return null; }`,
    "server/product-catalog.ts",
  );

  assert.equal(result.ok, false);
  assert.match(result.message, /signature drifted/);
});

test("public mirror contract command: mismatched generated stub exits non-zero", () => {
  const root = mkdtempSync(join(tmpdir(), "public-mirror-contract-"));
  const sourceRoot = join(root, "source");
  const mirrorRoot = join(root, "mirror");
  mkdirSync(join(sourceRoot, "server"), { recursive: true });
  mkdirSync(join(mirrorRoot, "server"), { recursive: true });
  writeFileSync(
    join(sourceRoot, "server", "product-catalog.ts"),
    `export interface CatalogProduct { sku: string; }\nexport function lookupProduct(sku: string): CatalogProduct | null { return null; }\n`,
  );
  writeFileSync(join(mirrorRoot, "server", "product-catalog.ts"), `export interface CatalogProduct { sku: string; }\n`);

  try {
    const result = spawnSync(
      "npx",
      ["--no-install", "tsx", "scripts/verify-public-mirror-contract.ts", "--source-root", sourceRoot, "--mirror-root", mirrorRoot],
      { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(result.status, 1, `expected guard to fail: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /missing exported function "lookupProduct"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("public mirror contract command: a directory in place of a module emits a controlled failure", () => {
  const root = mkdtempSync(join(tmpdir(), "public-mirror-contract-invalid-path-"));
  const sourceRoot = join(root, "source");
  const mirrorRoot = join(root, "mirror");
  mkdirSync(join(sourceRoot, "server", "product-catalog.ts"), { recursive: true });
  mkdirSync(join(mirrorRoot, "server"), { recursive: true });
  writeFileSync(join(mirrorRoot, "server", "product-catalog.ts"), `export const catalog = {};`);

  try {
    const result = spawnSync(
      "npx",
      ["--no-install", "tsx", "scripts/verify-public-mirror-contract.ts", "--source-root", sourceRoot, "--mirror-root", mirrorRoot],
      { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(result.status, 1, `expected guard to fail: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /missing or unreadable module file/);
    assert.doesNotMatch(result.stderr, /EISDIR/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("public mirror contract build wiring runs after generated stubs and before verification", () => {
  const script = readFileSync("scripts/build-public-mirror.sh", "utf8");
  const stubIndex = script.indexOf("[2/5] stubbing proprietary product files");
  const guardIndex = script.indexOf("[3.8/5] verifying generated-stub contracts");
  const verifyIndex = script.indexOf("[4/5] verification");

  assert.ok(stubIndex !== -1 && guardIndex !== -1 && verifyIndex !== -1, "expected mirror stage markers missing");
  assert.ok(stubIndex < guardIndex && guardIndex < verifyIndex, "contract guard must run after stubbing and before verification/push");
  const block = script.slice(guardIndex, verifyIndex);
  assert.match(block, /verify-public-mirror-contract\.ts --mirror-root "\$DST"/);
  assert.match(block, /ABORT: public-mirror contract guard failed/);
});