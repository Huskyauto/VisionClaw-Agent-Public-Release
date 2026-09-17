export interface UnreadChannel {
  channelName: string;
  count: number;
}

export interface UnreadChannelSqlRow extends Record<string, unknown> {
  channel_name: unknown;
  count: unknown;
}

export function normalizeUnreadChannelRows(
  rows: readonly UnreadChannelSqlRow[],
): UnreadChannel[] {
  return rows.map((row) => {
    if (typeof row.channel_name !== "string" || row.channel_name.trim().length === 0) {
      throw new Error("Unread channel query returned an invalid row");
    }

    let count: number;
    if (typeof row.count === "number") {
      count = row.count;
    } else if (typeof row.count === "string" && /^(0|[1-9]\d*)$/.test(row.count)) {
      count = Number(row.count);
    } else {
      throw new Error("Unread channel query returned an invalid row");
    }
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("Unread channel query returned an invalid row");
    }

    return {
      channelName: row.channel_name,
      count,
    };
  });
}