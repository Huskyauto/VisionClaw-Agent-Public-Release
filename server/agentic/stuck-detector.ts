import { createHash } from "node:crypto";

export interface StuckSignal {
  isStuck: boolean;
  reason?: string;
  identicalCount?: number;
}

/**
 * StuckDetector — inspired by OpenSwarm's loop-detection.
 *
 * Tracks the last N agent outputs (by stable hash) and flags the run as
 * "stuck" when the same response (or near-identical structural pattern) is
 * produced repeatedly. This prevents the supervisor from burning turns on
 * a model that's spinning in place.
 *
 * Usage:
 *   const sd = new StuckDetector();
 *   for (...) {
 *     const out = await specialist.handler(...);
 *     const signal = sd.observe(out);
 *     if (signal.isStuck) { escalate or break; }
 *   }
 */
export class StuckDetector {
  private hashes: string[] = [];
  private readonly window: number;
  private readonly threshold: number;

  constructor(opts: { window?: number; threshold?: number } = {}) {
    this.window = opts.window ?? 4;
    this.threshold = opts.threshold ?? 3;
  }

  /** Stable hash that ignores trivial whitespace + small numeric variation. */
  private fingerprint(output: any): string {
    let s: string;
    try {
      s = typeof output === "string" ? output : JSON.stringify(output);
    } catch {
      s = String(output);
    }
    // Mask only ID-shaped numbers (8+ digits) and hex tokens — short numbers
    // like loop counters or progress percentages stay distinct so that
    // legitimately incrementing work doesn't false-positive as "stuck".
    const normalized = s
      .replace(/\s+/g, " ")
      .replace(/\b\d{8,}\b/g, "<ID>")
      .replace(/0x[0-9a-f]{4,}/gi, "<HEX>")
      .toLowerCase()
      .slice(0, 4000);
    return createHash("sha1").update(normalized).digest("hex").slice(0, 16);
  }

  observe(output: any): StuckSignal {
    const fp = this.fingerprint(output);
    this.hashes.push(fp);
    if (this.hashes.length > this.window) this.hashes.shift();
    const counts = new Map<string, number>();
    for (const h of this.hashes) counts.set(h, (counts.get(h) || 0) + 1);
    const max = Math.max(...counts.values());
    if (max >= this.threshold) {
      return {
        isStuck: true,
        reason: `Same output produced ${max}× in last ${this.hashes.length} turns`,
        identicalCount: max,
      };
    }
    return { isStuck: false };
  }

  reset() {
    this.hashes = [];
  }
}
