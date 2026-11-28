import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { evaluateInvoicePilot, syntheticInvoicePilot } from "../server/lib/invoice-pilot-evaluation";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--example") {
    console.log(JSON.stringify(syntheticInvoicePilot(), null, 2));
    return;
  }
  if (args.length === 1 && args[0] === "--demo") {
    console.log(JSON.stringify(evaluateInvoicePilot(syntheticInvoicePilot()), null, 2));
    return;
  }
  if (args.length !== 2 || args[0] !== "--input" || !args[1] || args[1].startsWith("--")) {
    console.error("Usage: node --import tsx scripts/evaluate-invoice-pilot.ts --demo | --example | --input <local-json-file>");
    process.exitCode = 2;
    return;
  }
  // Open once, reject symlinks/devices/FIFOs, bound allocation even if the file
  // grows during the read, and never echo the path or source values on failure.
  const handle = await open(args[1], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    const max = 1_048_576;
    if (!info.isFile() || info.size === 0 || info.size > max) throw new Error();
    const buffer = Buffer.alloc(max + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > max) throw new Error();
    const result = evaluateInvoicePilot(JSON.parse(buffer.subarray(0, size).toString("utf8")));
    console.log(JSON.stringify(result, null, 2));
    if (!result.readyForPaidPilot) process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

main().catch(() => {
  console.error("Invoice pilot input rejected. Use a regular JSON file under 1 MiB matching the documented schema; no source values were logged.");
  process.exitCode = 2;
});
