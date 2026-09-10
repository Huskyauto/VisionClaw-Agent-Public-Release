import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUnreadChannelRows } from "../../server/lib/channel-row-contracts";

test("unread channel query rows are adapted to the public camelCase contract", () => {
  assert.deepEqual(
    normalizeUnreadChannelRows([
      { channel_name: "operations", count: "3" },
      { channel_name: "research", count: 1 },
    ]),
    [
      { channelName: "operations", count: 3 },
      { channelName: "research", count: 1 },
    ],
  );
});

test("malformed unread channel query rows fail closed", () => {
  const malformedRows = [
    { channel_name: "", count: "1" },
    { channel_name: 7, count: "1" },
    { channel_name: "operations", count: null },
    { channel_name: "operations", count: true },
    { channel_name: "operations", count: " " },
    { channel_name: "operations", count: "1.5" },
    { channel_name: "operations", count: 1.5 },
    { channel_name: "operations", count: Number.MAX_SAFE_INTEGER + 1 },
    { channel_name: "operations", count: -1 },
  ];

  for (const row of malformedRows) {
    assert.throws(
      () => normalizeUnreadChannelRows([row]),
      /invalid row/,
    );
  }
});