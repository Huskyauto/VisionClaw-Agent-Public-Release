import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeSource } from "../../scripts/lib/codebase-source-parser";

test("extracts real dependencies anywhere, excluding comments and string examples", () => {
  const source = `
// import fake from "./comment";
const example = 'import fake from "./string"';
import type { A } from "./types";
export { thing as publicThing } from "./barrel";
async function run() { return await import("./lazy"); }
const cjs = require("./legacy");
type T = import("./type-only").T;
import legacy = require("./equals");
const computed = import(variable);
`;
  assert.deepEqual(analyzeSource("sample.ts", source).imports,
    ["./types", "./barrel", "./lazy", "./legacy", "./type-only", "./equals"]);
});

test("finds public names, aliases, destructuring and default exports, not nested declarations", () => {
  const source = `
export const { a, b: renamed, nested: { c } } = value;
export const [first, , ...rest] = list;
export async function run() {}
export interface Shape {}
export type Kind = string;
export enum State { Ready }
const hidden = 1;
export { hidden as visible };
export { type X as PublicX } from "./x";
export * as helpers from "./helpers";
export default class Engine {}
function outer() { const notPublic = 1; }
`;
  assert.deepEqual(analyzeSource("sample.ts", source).exports,
    ["Engine", "Kind", "PublicX", "Shape", "State", "a", "c", "default",
     "first", "helpers", "renamed", "rest", "run", "visible"].sort());
});
