// ─────────────────────────────────────────────────────────────────────────────
// R83 — Context-limit error parser (ported from Hermes Alpha model_metadata.py)
// ─────────────────────────────────────────────────────────────────────────────
// Many providers leak the actual context limit in their error text:
//   "maximum context length is 32768 tokens"
//   "context_length_exceeded: 131072"
//   "250000 tokens > 200000 maximum"
//   "model's max context length is 65536"
// Extracting that number lets the escalator learn the truth instead of
// falling back to hard-coded probe tiers.
// ─────────────────────────────────────────────────────────────────────────────

const PATTERNS: RegExp[] = [
  /(?:max(?:imum)?|limit)\s*(?:context\s*)?(?:length|size|window)?\s*(?:is|of|:)?\s*(\d{4,})/i,
  /context\s*(?:length|size|window)\s*(?:is|of|:)?\s*(\d{4,})/i,
  /(\d{4,})\s*(?:token)?\s*(?:context|limit)/i,
  />\s*(\d{4,})\s*(?:max|limit|token)/i,
  /(\d{4,})\s*(?:max(?:imum)?)\b/i,
];

export function parseContextLimitFromError(errorMsg: string | undefined | null): number | null {
  if (!errorMsg) return null;
  for (const pattern of PATTERNS) {
    const m = errorMsg.match(pattern);
    if (m && m[1]) {
      const limit = parseInt(m[1], 10);
      if (limit >= 1024 && limit <= 10_000_000) return limit;
    }
  }
  return null;
}

export const CONTEXT_PROBE_TIERS = [
  2_000_000, 1_000_000, 512_000, 200_000, 128_000, 64_000, 32_000,
];

export function getNextProbeTier(currentLength: number): number | null {
  for (const tier of CONTEXT_PROBE_TIERS) {
    if (tier < currentLength) return tier;
  }
  return null;
}
