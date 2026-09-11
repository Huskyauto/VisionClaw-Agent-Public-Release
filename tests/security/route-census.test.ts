import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import census from "../fixtures/route-census.json";

// Count-conservation RATCHET for the server/routes.ts decomposition.
//
// SCOPE (important — this is NOT a whole-app route inventory): it counts endpoint
// registrations only within `server/routes.ts` + `server/routes/**`. Routers defined in
// OTHER files and merely mounted here (e.g. server/stripe-connect.ts) are out of scope by
// design — they are not part of the routes.ts god-file split this gate guards.
//
// STRENGTH: it is a count-conservation heuristic, NOT a per-path manifest proof. A pure
// MOVE is caught (total unchanged, routesTsInline drops). A drop that is masked by an
// unrelated add in the SAME change nets to zero and would pass — if stricter per-path
// fail-closed proof is ever needed, upgrade to a (method,path) manifest diff.
//
// Counts BOTH registration styles used in-scope —
//   app.METHOD("/path", ...)            (inline in routes.ts + register<Domain>(app) modules)
//   <name>Router.METHOD("/path", ...)   (express.Router() modules mounted via app.use;
//                                        the empty-prefix case also matches a bare `router.get(`)
// — but NOT `map.get(...)` / `cache.get(...)`, which the `app|*Router` anchor excludes.
//
// Invariants:
//   1. routes.ts inline count == fixture.routesTsInline  (any move must consciously update the fixture)
//   2. routes.ts inline count <= fixture.inlineCeiling   (ratchet — routes.ts may only shrink)
//   3. in-scope total == fixture.total (a pure move keeps total constant; a genuine add/remove
//      must update the fixture, and that diff IS the conservation proof)
//   4. fixture self-consistency: routesTsInline <= inlineCeiling
//
// The same regex runs on both sides, so relocating an endpoint (app.get -> a router module, or vice versa)
// leaves `total` unchanged. See tests/fixtures/route-census.json for the update workflow.

const ROUTE_RE = /\b(app|[A-Za-z]*[Rr]outer)\.(get|post|put|delete|patch)\(\s*["'`]/g;

function countInFile(path: string): number {
  const src = readFileSync(path, "utf8");
  const m = src.match(ROUTE_RE);
  return m ? m.length : 0;
}

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectRouteFiles(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const ROUTES_TS = "server/routes.ts";
const ROUTES_DIR = "server/routes";

const routesTsInline = countInFile(ROUTES_TS);
const total =
  routesTsInline + collectRouteFiles(ROUTES_DIR).reduce((s, f) => s + countInFile(f), 0);

test("fixture is self-consistent (routesTsInline <= inlineCeiling)", () => {
  assert.ok(
    census.routesTsInline <= census.inlineCeiling,
    `fixture invalid: routesTsInline ${census.routesTsInline} > inlineCeiling ${census.inlineCeiling}`,
  );
});

test("routes.ts inline endpoint count matches the census fixture", () => {
  assert.equal(
    routesTsInline,
    census.routesTsInline,
    `server/routes.ts has ${routesTsInline} inline endpoints, fixture says ${census.routesTsInline}. ` +
      `If you moved an endpoint OUT, ratchet routesTsInline (and inlineCeiling) DOWN in tests/fixtures/route-census.json ` +
      `and leave total unchanged. New endpoints must be registered in server/routes/<domain>.ts, not routes.ts.`,
  );
});

test("routes.ts inline count is at or below the ratchet ceiling", () => {
  assert.ok(
    routesTsInline <= census.inlineCeiling,
    `server/routes.ts grew to ${routesTsInline} inline endpoints (ceiling ${census.inlineCeiling}). ` +
      `Register new endpoints in server/routes/<domain>.ts; the ceiling only ever ratchets DOWN.`,
  );
});

test("in-scope endpoint count is conserved (pure moves must not change the total)", () => {
  assert.equal(
    total,
    census.total,
    `in-scope endpoint count is ${total}, fixture says ${census.total} ` +
      `(scope: server/routes.ts + server/routes/**). A pure move must leave total UNCHANGED. ` +
      `If you genuinely added/removed an endpoint, update total in tests/fixtures/route-census.json ` +
      `in the same change — that diff is the conservation proof.`,
  );
});
