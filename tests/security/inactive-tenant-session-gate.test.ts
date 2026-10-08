import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getSessionSync, isValidSession } from "../../server/auth";

test("synchronous bearer authorization fails closed rather than trusting a cached tenant", () => {
  const staleBearer = "cached-disabled-tenant-bearer";
  assert.equal(getSessionSync(staleBearer), null);
  assert.equal(isValidSession(staleBearer), false);

  const authSource = fs.readFileSync(path.join(process.cwd(), "server/auth.ts"), "utf8");
  const syncFunction = authSource.match(/export function getSessionSync[\s\S]*?\n}\n\nasync function deleteSession/)?.[0] || "";
  assert.match(syncFunction, /return null/);
  assert.doesNotMatch(syncFunction, /return \{ tenantId: cached\.tenantId/);
});

test("sensitive bearer routes await the active-tenant session lookup", () => {
  const routesSource = fs.readFileSync(path.join(process.cwd(), "server/routes.ts"), "utf8");
  const webhookSource = fs.readFileSync(path.join(process.cwd(), "server/webhooks.ts"), "utf8");

  assert.doesNotMatch(routesSource, /\bisValidSession\b|\bgetSessionSync\b/);
  assert.match(routesSource, /await getSession\(bearer\)/);
  assert.match(routesSource, /await getSession\(sessionToken\)/);
  assert.match(webhookSource, /await getSession\(session\)/);
});