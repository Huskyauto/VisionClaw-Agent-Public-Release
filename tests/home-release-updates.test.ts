import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("home initially shows exactly the three newest release cards", () => {
  const source = fs.readFileSync(
    new URL("../client/src/components/home-release-updates.tsx", import.meta.url),
    "utf8",
  );
  const initiallyVisibleMarkup = source.split('id="home-recent-historical-releases"')[0];
  const initiallyVisibleIds = [...initiallyVisibleMarkup.matchAll(/data-testid="(banner-whats-new-[^"]+)"/g)]
    .map(match => match[1]);

  assert.equal(initiallyVisibleIds.length, 3);
  assert.deepEqual(
    initiallyVisibleIds,
    [
      "banner-whats-new-r126_sec",
      "banner-whats-new-r125_155_23_sec",
      "banner-whats-new-r125_155_19",
    ],
  );
});