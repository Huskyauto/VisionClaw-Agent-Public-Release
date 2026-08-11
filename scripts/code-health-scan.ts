#!/usr/bin/env tsx
import { runCodeHealthScan } from "../server/code-health";

runCodeHealthScan({ quiet: false })
  .then((r) => {
    console.log(`\n✓ Scan ${r.scanId} complete: ${r.filesScanned} files, ${r.findings.length} findings (${r.durationMs}ms)`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
