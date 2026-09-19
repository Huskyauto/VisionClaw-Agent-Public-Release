import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("home dynamically partitions the shared release feed into three current and all older updates", () => {
  const componentSource = fs.readFileSync(
    new URL("../client/src/components/home-release-updates.tsx", import.meta.url),
    "utf8",
  );
  const homeSource = fs.readFileSync(
    new URL("../client/src/pages/home.tsx", import.meta.url),
    "utf8",
  );
  const updates = JSON.parse(fs.readFileSync(
    new URL("../client/src/data/updates.json", import.meta.url),
    "utf8",
  )) as { version: string }[];

  assert.deepEqual(updates.slice(0, 3).map((entry) => entry.version), ["R130.2", "R130.1", "R130"]);
  assert.equal(new Set(updates.map((entry) => entry.version)).size, updates.length);
  assert.match(componentSource, /HOME_VISIBLE_RELEASE_COUNT = 3/);
  assert.match(homeSource, /HOME_RELEASES\.slice\(0, HOME_VISIBLE_RELEASE_COUNT\)\.map/);
  assert.match(componentSource, /HOME_RELEASES\.slice\(HOME_VISIBLE_RELEASE_COUNT\)/);
  assert.match(componentSource, /setShowAllUpdates\(\(visible\) => !visible\)/);
  assert.match(componentSource, /showAllUpdates \? "" : "hidden"/);
});