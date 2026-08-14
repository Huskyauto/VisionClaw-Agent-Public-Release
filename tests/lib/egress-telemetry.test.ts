/**
 * R125+137.22 — egress telemetry ring buffer (pure lib, query-free).
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { recordEgress, summarizeEgress, hostOf, _resetEgressRing } from "../../server/lib/egress-telemetry";

beforeEach(() => _resetEgressRing());

test("hostOf extracts host and never throws", () => {
  assert.equal(hostOf("https://api.openai.com/v1/chat"), "api.openai.com");
  assert.equal(hostOf("not a url"), "unparseable");
});

test("records aggregate by host with error/timeout counts", () => {
  recordEgress({ host: "a.com", method: "GET", status: 200, ms: 100, outcome: "ok", source: "t" });
  recordEgress({ host: "a.com", method: "GET", status: 500, ms: 50, outcome: "http_error", source: "t" });
  recordEgress({ host: "b.com", method: "POST", status: null, ms: 8000, outcome: "timeout", source: "t" });
  const s = summarizeEgress();
  assert.equal(s.total, 3);
  const a = s.byHost.find(h => h.host === "a.com")!;
  assert.equal(a.count, 2);
  assert.equal(a.errors, 1);
  const b = s.byHost.find(h => h.host === "b.com")!;
  assert.equal(b.timeouts, 1);
  assert.equal(s.recentFailures.length, 2);
});

test("aborted is not counted as an error", () => {
  recordEgress({ host: "a.com", method: "GET", status: null, ms: 10, outcome: "aborted", source: "t" });
  const s = summarizeEgress();
  assert.equal(s.byHost[0].errors, 0);
  assert.equal(s.recentFailures.length, 0);
});

test("ring is bounded and reports drops", () => {
  for (let i = 0; i < 620; i++) {
    recordEgress({ host: `h${i % 3}.com`, method: "GET", status: 200, ms: 1, outcome: "ok", source: "t" });
  }
  const s = summarizeEgress();
  assert.equal(s.total, 500);
  assert.equal(s.droppedBeforeWindow, 120);
});
