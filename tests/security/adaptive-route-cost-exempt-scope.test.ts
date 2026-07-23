/**
 * adaptive-route-cost-exempt-scope.test.ts — lock-in for the architect review of
 * the difficulty-adaptive UP-route (auto-ensemble path).
 *
 * INVARIANT: in `server/chat-engine.ts`, `costExemptLane` may ONLY be passed to
 * getClientForModel for the up-routed MAIN turn — i.e. every line that passes
 * `costExemptLane:` must be gated by `upRouteActive`. Overflow / failover /
 * escalation getClientForModel calls must NEVER be cost-exempt, so that a Kimi
 * (high-end OpenRouter) failure safely DOWNGRADES under the $0 modelfarm policy
 * instead of leaking metered spend.
 *
 * Why a static-source test and not a processMessage integration test: the
 * gating LOGIC is already exhaustively unit-tested at the helper level
 * (`shouldUpRouteToHardModel` in tests/lib/orchestration-efficiency.test.ts).
 * The remaining risk the architect flagged is a future edit accidentally adding
 * `costExemptLane: true` (or `costExemptLane: <something always-true>`) to a
 * fallback callsite — a cost LEAK that no unit test of the pure helper can catch.
 * This source-snapshot test fails loud the moment any cost-exempt call appears
 * that is not gated by the sanctioned `upRouteActive` flag, forcing a re-audit.
 *
 * If this test goes red:
 *   - You added a `costExemptLane:` callsite NOT gated by `upRouteActive`.
 *   - If it is a new sanctioned main-turn path, gate it on `upRouteActive` (the
 *     local flag set ONLY when the adaptive hard-route model was chosen).
 *   - NEVER make a failover/escalation client cost-exempt — that defeats the
 *     safe-downgrade design.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CHAT_ENGINE = join(process.cwd(), "server", "chat-engine.ts");
const SANCTIONED_GATE = "upRouteActive";

test("every costExemptLane callsite in chat-engine is gated by upRouteActive", () => {
  const src = readFileSync(CHAT_ENGINE, "utf8");
  const lines = src.split("\n");

  const offenders: { line: number; text: string }[] = [];
  let hits = 0;

  lines.forEach((raw, i) => {
    const line = raw.trim();
    // Skip comment lines so the prose above (which mentions costExemptLane)
    // never counts as a callsite.
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) return;
    if (!/costExemptLane\s*:/.test(line)) return;
    hits += 1;
    if (!line.includes(SANCTIONED_GATE)) {
      offenders.push({ line: i + 1, text: line });
    }
  });

  // There must be at least one cost-exempt callsite (the feature exists); if it
  // drops to zero the feature was silently removed — also worth a re-audit.
  assert.ok(
    hits >= 1,
    `Expected at least one gated costExemptLane callsite in chat-engine.ts, found ${hits}. ` +
      `Did the adaptive up-route get removed? Re-audit before deleting this test.`,
  );

  assert.equal(
    offenders.length,
    0,
    `Found ${offenders.length} costExemptLane callsite(s) NOT gated by '${SANCTIONED_GATE}':\n` +
      offenders.map((o) => `  chat-engine.ts:${o.line}  ${o.text}`).join("\n") +
      `\nA cost-exempt client must ONLY be acquired for the up-routed main turn. ` +
      `Failover/escalation calls must stay metered-policy-governed so a high-end ` +
      `model failure downgrades safely instead of leaking spend.`,
  );
});
