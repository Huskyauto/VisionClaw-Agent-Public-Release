import { describe, it, expect } from "./_vitest-shim";
import {
  normalizeModelKey,
  normalizeQualityIndex,
  matchModelToExternal,
  buildExternalQualityMap,
  compositeQuality,
  DEFAULT_WEIGHTS,
  type ModelScore,
} from "../../server/model-tier-eval";

describe("normalizeModelKey", () => {
  it("drops provider prefix, dots, dashes", () => {
    expect(normalizeModelKey("anthropic/claude-opus-4.7")).toBe("claudeopus47");
    expect(normalizeModelKey("claude-opus-4")).toBe("claudeopus4");
  });
  it("strips date stamps", () => {
    expect(normalizeModelKey("anthropic/claude-opus-4-20250514")).toBe("claudeopus4");
    expect(normalizeModelKey("gemini-3-flash-202506")).toBe("gemini3flash");
  });
  it("strips noise tokens (preview/latest/fast/instruct/it)", () => {
    expect(normalizeModelKey("gpt-5.5-preview")).toBe("gpt55");
    expect(normalizeModelKey("google/gemma-3-4b-it")).toBe("gemma34b");
    expect(normalizeModelKey("anthropic/claude-opus-4.6-fast")).toBe("claudeopus46");
  });
  it("handles non-strings safely", () => {
    expect(normalizeModelKey(undefined as any)).toBe("");
    expect(normalizeModelKey("")).toBe("");
  });
});

describe("normalizeQualityIndex", () => {
  it("min-max normalizes higher=better to 0..1", () => {
    const out = normalizeQualityIndex([
      { key: "a", index: 10 },
      { key: "b", index: 20 },
      { key: "c", index: 30 },
    ]);
    expect(out.a).toBeCloseTo(0);
    expect(out.b).toBeCloseTo(0.5);
    expect(out.c).toBeCloseTo(1);
  });
  it("returns neutral 0.5 when there is no spread", () => {
    const out = normalizeQualityIndex([
      { key: "a", index: 50 },
      { key: "b", index: 50 },
    ]);
    expect(out.a).toBeCloseTo(0.5);
    expect(out.b).toBeCloseTo(0.5);
  });
  it("single entry => neutral 0.5 (never an artificial 1.0 boost)", () => {
    expect(normalizeQualityIndex([{ key: "solo", index: 99 }]).solo).toBeCloseTo(0.5);
  });
  it("drops non-finite + empty-key entries", () => {
    const out = normalizeQualityIndex([
      { key: "a", index: 10 },
      { key: "", index: 20 },
      { key: "b", index: NaN as any },
      { key: "c", index: 30 },
    ]);
    expect(Object.keys(out).sort()).toEqual(["a", "c"]);
  });
  it("empty input => empty map", () => {
    expect(normalizeQualityIndex([])).toEqual({});
  });
});

describe("matchModelToExternal", () => {
  const keys = ["claudeopus47", "gpt55", "gemini3flash", "deepseekv4"];
  it("exact normalized match", () => {
    expect(matchModelToExternal("anthropic/claude-opus-4.7", keys)).toBe("claudeopus47");
  });
  it("prefix-overlap match (registry id has extra suffix)", () => {
    // "gpt-5.5-pro" normalizes to "gpt55pro"; "gpt55" is a prefix => match
    expect(matchModelToExternal("openai/gpt-5.5-pro", keys)).toBe("gpt55");
  });
  it("returns null when nothing overlaps", () => {
    expect(matchModelToExternal("mistralai/mistral-large", keys)).toBeNull();
  });
  it("ignores too-short overlaps (< 5 chars) to avoid junk matches", () => {
    expect(matchModelToExternal("xyz", ["gpt"])).toBeNull();
  });
  it("prefers the longest overlapping key", () => {
    const out = matchModelToExternal("claude-opus-4-7-thinking", ["claudeopus", "claudeopus47"]);
    expect(out).toBe("claudeopus47");
  });
});

describe("buildExternalQualityMap", () => {
  it("maps candidate ids to 0..1 percentiles across the whole external universe", () => {
    const external = [
      { key: "openai/gpt-5.5", index: 90 },
      { key: "anthropic/claude-opus-4.7", index: 80 },
      { key: "google/gemini-3-flash", index: 70 },
    ];
    const map = buildExternalQualityMap(
      ["gpt-5.5", "claude-opus-4-7", "gemini-3-flash"],
      external,
    );
    expect(map["gpt-5.5"]).toBeCloseTo(1);
    expect(map["claude-opus-4-7"]).toBeCloseTo(0.5);
    expect(map["gemini-3-flash"]).toBeCloseTo(0);
  });
  it("omits candidates with no external match (caller applies neutral prior)", () => {
    const map = buildExternalQualityMap(
      ["mistral-large", "gpt-5.5"],
      [
        { key: "openai/gpt-5.5", index: 90 },
        { key: "anthropic/claude-opus-4.7", index: 80 },
      ],
    );
    expect(map["mistral-large"]).toBeUndefined();
    expect(map["gpt-5.5"]).toBeDefined();
  });
  it("empty external => empty map", () => {
    expect(buildExternalQualityMap(["gpt-5.5"], [])).toEqual({});
  });
});

describe("compositeQuality with externalQuality", () => {
  const base: ModelScore = {
    modelId: "m",
    batteryScore: 0.8,
    floorPass: true,
    evaluated: true,
    perProbe: {},
  };
  it("uses 0.5 neutral prior when externalQuality is missing", () => {
    const withNeutral = compositeQuality(base);
    const explicit = compositeQuality({ ...base, externalQuality: 0.5 });
    expect(withNeutral).toBeCloseTo(explicit);
  });
  it("a high external score raises composite vs a low one", () => {
    const hi = compositeQuality({ ...base, externalQuality: 1 });
    const lo = compositeQuality({ ...base, externalQuality: 0 });
    expect(hi).toBeGreaterThan(lo);
    expect(hi - lo).toBeCloseTo(DEFAULT_WEIGHTS.external);
  });
  it("weights sum to 1 so composite stays in 0..1", () => {
    expect(DEFAULT_WEIGHTS.battery + DEFAULT_WEIGHTS.telemetry + DEFAULT_WEIGHTS.external).toBeCloseTo(1);
    const perfect = compositeQuality({ ...base, batteryScore: 1, telemetryWin: 1, externalQuality: 1 });
    expect(perfect).toBeCloseTo(1);
  });
});
