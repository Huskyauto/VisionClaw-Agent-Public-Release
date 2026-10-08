import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeFunnelMetrics, parseDeliveryFetch } from "../../server/delivery-funnel";

describe("computeFunnelMetrics (SSRN 6859839 produce -> ship -> adopt funnel)", () => {
  it("returns zeroed ratios and no breach on an empty funnel", () => {
    const r = computeFunnelMetrics(0, 0, 0);
    assert.equal(r.shipRatio, 0);
    assert.equal(r.adoptRatio, 0);
    assert.equal(r.breached, false);
  });

  it("computes ship and adopt ratios", () => {
    const r = computeFunnelMetrics(20, 10, 5);
    assert.equal(r.shipRatio, 0.5);
    assert.equal(r.adoptRatio, 0.5);
  });

  it("does not breach below the minimum sample even with a poor ratio", () => {
    const r = computeFunnelMetrics(5, 1, 0);
    assert.equal(r.breached, false, "too few produced to judge");
  });

  it("breaches when the shipping link is weak (produced >= 10, ship ratio < 0.7)", () => {
    const r = computeFunnelMetrics(20, 5, 5);
    assert.equal(r.breached, true);
  });

  it("breaches when the adoption link is weak (shipped >= 10, adopt ratio < 0.5)", () => {
    const r = computeFunnelMetrics(20, 18, 2);
    assert.equal(r.breached, true);
  });

  it("does not breach a healthy funnel", () => {
    const r = computeFunnelMetrics(20, 18, 15);
    assert.equal(r.breached, false);
  });

  it("clamps so the funnel can never be incoherent (adopted <= shipped <= produced)", () => {
    const r = computeFunnelMetrics(10, 50, 100);
    // shipped clamped to produced (10), adopted clamped to shipped (10)
    assert.equal(r.shipRatio, 1);
    assert.equal(r.adoptRatio, 1);
  });

  it("does not breach the adoption link while shipped sample is below the floor", () => {
    // 10 produced, all shipped clean, but only 5 shipped (< MIN_SAMPLE) means
    // the adoption ratio is too small a sample to judge.
    const r = computeFunnelMetrics(12, 9, 0);
    // ship ratio = 0.75 (>= 0.7 ok); shipped 9 < 10 so adoption not judged
    assert.equal(r.breached, false);
  });

  it("tolerates NaN / negative inputs without throwing", () => {
    const r = computeFunnelMetrics(NaN as unknown as number, -3, -1);
    assert.equal(r.shipRatio, 0);
    assert.equal(r.adoptRatio, 0);
    assert.equal(r.breached, false);
  });
});

describe("parseDeliveryFetch (adoption-honesty gate — no fabricated adoption)", () => {
  it("records a successful (200) initial full GET of a delivery file", () => {
    const r = parseDeliveryFetch({ method: "GET", baseName: "delivery-42-report.pdf", statusCode: 200 });
    assert.deepEqual(r, { record: true, deliveryId: 42 });
  });

  it("records a successful (206) bytes=0- initial range fetch", () => {
    const r = parseDeliveryFetch({ method: "GET", baseName: "delivery-7-clip.mp4", range: "bytes=0-1023", statusCode: 206 });
    assert.deepEqual(r, { record: true, deliveryId: 7 });
  });

  it("does NOT record a 404 (file never served) — the core honesty fix", () => {
    const r = parseDeliveryFetch({ method: "GET", baseName: "delivery-999-nope.pdf", statusCode: 404 });
    assert.equal(r.record, false);
  });

  it("does NOT record a 403", () => {
    const r = parseDeliveryFetch({ method: "GET", baseName: "delivery-1-x.pdf", statusCode: 403 });
    assert.equal(r.record, false);
  });

  it("does NOT record a mid-stream chunk (range not starting at 0)", () => {
    const r = parseDeliveryFetch({ method: "GET", baseName: "delivery-7-clip.mp4", range: "bytes=1024-2047", statusCode: 206 });
    assert.equal(r.record, false);
  });

  it("does NOT record a non-delivery filename", () => {
    const r = parseDeliveryFetch({ method: "GET", baseName: "logo.png", statusCode: 200 });
    assert.equal(r.record, false);
  });

  it("does NOT record a non-GET method", () => {
    const r = parseDeliveryFetch({ method: "HEAD", baseName: "delivery-3-x.pdf", statusCode: 200 });
    assert.equal(r.record, false);
  });
});
