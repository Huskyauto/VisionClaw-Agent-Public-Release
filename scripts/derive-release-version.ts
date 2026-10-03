#!/usr/bin/env tsx
import { resolve } from "node:path";
import { formatReleaseRound, readCurrentRelease } from "./lib/release-round";

try {
  const { round } = readCurrentRelease(resolve(process.cwd(), "replit.md"));
  process.stdout.write(formatReleaseRound(round).packageVersion);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}