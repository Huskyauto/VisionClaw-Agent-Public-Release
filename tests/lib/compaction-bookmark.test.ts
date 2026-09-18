import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompactedMessages, buildCompactionBookmarkMessage, type CompactionArchiveRef } from "../../server/compaction";
import { truncateWithSummary } from "../../server/context-window-guard";

test("compacted context names the durable archive and exact original message range", () => {
  const archive: CompactionArchiveRef = {
    id: 91,
    conversationId: 41,
    messageCount: 12,
    totalMessages: 30,
    firstMessageOrdinal: 4,
    lastMessageOrdinal: 15,
  };

  const messages = buildCompactedMessages(
    "## Decisions\nUse the durable archive.",
    [{ role: "user", content: "Continue the work." }],
    41,
    archive,
  );

  const marker = messages[0]?.content || "";
  assert.match(marker, /archive #91/i);
  assert.match(marker, /messages 4–15 of 30/i);
  assert.match(marker, /recall_context/i);
  assert.doesNotMatch(marker, /compaction-archives[\\/]/i);
});

test("a lossy free-ladder result can carry the same standalone recovery bookmark", () => {
  const bookmark = buildCompactionBookmarkMessage({
    id: 93,
    conversationId: 41,
    messageCount: 30,
    totalMessages: 30,
    firstMessageOrdinal: 1,
    lastMessageOrdinal: 30,
  });

  assert.equal(bookmark.role, "system");
  assert.match(bookmark.content, /archive #93/i);
  assert.match(bookmark.content, /messages 1–30 of 30/i);
  assert.match(bookmark.content, /recall_context/i);
});

test("context guard carries the same durable archive bookmark after truncation", () => {
  const archive: CompactionArchiveRef = {
    id: 92,
    conversationId: 41,
    messageCount: 3,
    totalMessages: 5,
    firstMessageOrdinal: 2,
    lastMessageOrdinal: 4,
  };
  const messages = [
    { role: "system", content: "system policy" },
    { role: "user", content: "first original turn" },
    { role: "assistant", content: "first response" },
    { role: "user", content: "second original turn" },
    { role: "assistant", content: "latest response" },
  ];

  const truncated = truncateWithSummary(messages, 3, archive);
  const summary = String(truncated[1]?.content || "");

  assert.match(summary, /archive #92/i);
  assert.match(summary, /messages 2–4 of 5/i);
  assert.match(summary, /recall_context/i);
});