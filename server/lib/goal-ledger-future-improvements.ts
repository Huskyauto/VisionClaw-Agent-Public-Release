import * as fs from "node:fs/promises";

export const MAX_FUTURE_IMPROVEMENTS_BYTES = 32 * 1024;

export interface FutureImprovement {
  id: string;
  title: string;
  why: string;
  revisitTrigger: string;
  status: "deferred";
  evidence: string[];
}

export interface FutureImprovementsLedger {
  items: FutureImprovement[];
}

export type FutureImprovementsResult =
  | { status: "available"; items: FutureImprovement[] }
  | { status: "unavailable"; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseFutureImprovements(
  contents: string,
  maxBytes = MAX_FUTURE_IMPROVEMENTS_BYTES,
): FutureImprovementsLedger {
  if (Buffer.byteLength(contents, "utf8") > maxBytes) {
    throw new Error(`future-improvements ledger exceeds the ${maxBytes}-byte size limit`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("future-improvements ledger must contain valid JSON");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as any).schemaVersion !== 1 ||
    !Array.isArray((parsed as any).items) ||
    (parsed as any).items.length > 20
  ) {
    throw new Error("future-improvements ledger has an invalid top-level structure");
  }

  const items = (parsed as any).items;
  const ids = new Set<string>();
  for (const item of items) {
    if (
      !item ||
      typeof item !== "object" ||
      !isNonEmptyString(item.id) ||
      !/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.id) ||
      ids.has(item.id) ||
      !isNonEmptyString(item.title) ||
      item.title.length > 160 ||
      !isNonEmptyString(item.why) ||
      item.why.length > 500 ||
      !isNonEmptyString(item.revisitTrigger) ||
      item.revisitTrigger.length > 500 ||
      item.status !== "deferred" ||
      !Array.isArray(item.evidence) ||
      item.evidence.length === 0 ||
      item.evidence.length > 8 ||
      !item.evidence.every(isNonEmptyString)
    ) {
      throw new Error("future-improvements ledger contains an invalid future improvement");
    }
    ids.add(item.id);
  }

  return { items: items as FutureImprovement[] };
}

export async function readFutureImprovementsLedger(
  filePath: string,
): Promise<FutureImprovementsResult> {
  let handle: fs.FileHandle | undefined;
  try {
    const pathStat = await fs.lstat(filePath);
    if (!pathStat.isFile()) {
      throw new Error("tracked ledger path is not a regular file");
    }
    handle = await fs.open(filePath, "r");
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) {
      throw new Error("tracked ledger path is not a regular file");
    }
    if (fileStat.size > MAX_FUTURE_IMPROVEMENTS_BYTES) {
      throw new Error(`tracked ledger exceeds the ${MAX_FUTURE_IMPROVEMENTS_BYTES}-byte size limit`);
    }
    const buffer = Buffer.alloc(MAX_FUTURE_IMPROVEMENTS_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_FUTURE_IMPROVEMENTS_BYTES) {
      throw new Error(`tracked ledger exceeds the ${MAX_FUTURE_IMPROVEMENTS_BYTES}-byte size limit`);
    }
    const { items } = parseFutureImprovements(buffer.subarray(0, bytesRead).toString("utf8"));
    return { status: "available", items };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown read error";
    return { status: "unavailable", error: `Future improvements unavailable: ${detail}` };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}