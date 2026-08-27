import { describe, it, expect, afterEach } from "./_vitest-shim";
import fs from "fs";
import path from "path";
import {
  classifyOpenness,
  rankMatchKey,
  rankKeysMatch,
  runRankingDrivenAutoAdd,
  RANKING_AUTOADD_TAG,
  type RankedExternalModel,
  type OpenRouterModel,
} from "../../server/model-catalog";

const OVERLAY_PATH = path.join(process.cwd(), "data", "model-registry-overlay.json");

/** Snapshot the real overlay, run fn with a controlled overlay, always restore. */
function withOverlay<T>(entries: any[], fn: () => T): T {
  const existed = fs.existsSync(OVERLAY_PATH);
  const backup = existed ? fs.readFileSync(OVERLAY_PATH, "utf8") : null;
  try {
    fs.mkdirSync(path.dirname(OVERLAY_PATH), { recursive: true });
    fs.writeFileSync(OVERLAY_PATH, JSON.stringify(entries, null, 2));
    return fn();
  } finally {
    if (backup != null) fs.writeFileSync(OVERLAY_PATH, backup);
    else if (existed === false && fs.existsSync(OVERLAY_PATH)) fs.unlinkSync(OVERLAY_PATH);
  }
}

function orModel(id: string, completion: string, prompt = "0.0000005", modality = "text->text"): OpenRouterModel {
  return {
    id, name: id, context_length: 262144,
    pricing: { prompt, completion },
    architecture: { modality },
  } as OpenRouterModel;
}

function aa(name: string, slug: string, creatorSlug: string, index: number): RankedExternalModel {
  return { name, slug, creatorSlug, index, openness: classifyOpenness(creatorSlug, name) };
}

describe("classifyOpenness", () => {
  it("tags proprietary labs closed", () => {
    expect(classifyOpenness("openai", "GPT-5.6")).toBe("closed");
    expect(classifyOpenness("anthropic", "Claude Opus 4.8")).toBe("closed");
    expect(classifyOpenness("xai", "Grok 5")).toBe("closed");
    expect(classifyOpenness("cohere", "Command A")).toBe("closed");
  });
  it("tags open-weight labs open", () => {
    expect(classifyOpenness("alibaba", "Qwen3.7 Max")).toBe("open");
    expect(classifyOpenness("deepseek", "DeepSeek V4")).toBe("open");
    expect(classifyOpenness("moonshotai", "Kimi K2.6")).toBe("open");
    expect(classifyOpenness("meta", "Llama 5")).toBe("open");
  });
  it("splits Google per-model: Gemini closed, Gemma open", () => {
    expect(classifyOpenness("google", "Gemini 3 Pro")).toBe("closed");
    expect(classifyOpenness("google", "Gemma 3 27B")).toBe("open");
  });
});

describe("rankMatchKey (version-preserving)", () => {
  it("drops provider prefix, keeps version dots", () => {
    expect(rankMatchKey("qwen/qwen3.7-max")).toBe("qwen3.7max");
    expect(rankMatchKey("Qwen3.7 Max")).toBe("qwen3.7max");
  });
  it("does NOT collapse different versions together", () => {
    expect(rankMatchKey("qwen/qwen3-max")).toBe("qwen3max");
    expect(rankMatchKey("qwen/qwen3.7-max")).not.toBe(rankMatchKey("qwen/qwen3-max"));
  });
  it("canonicalizes dash-version to dot-version (registry vs AA/OR form)", () => {
    expect(rankMatchKey("claude-opus-4-8")).toBe("claudeopus4.8");
    expect(rankMatchKey("anthropic/claude-opus-4.8")).toBe("claudeopus4.8");
    expect(rankMatchKey("claude-opus-4-8")).toBe(rankMatchKey("anthropic/claude-opus-4.8"));
  });
  it("strips parenthetical effort qualifiers + date stamps", () => {
    expect(rankMatchKey("GPT-5.5 (xhigh)")).toBe("gpt5.5");
    expect(rankMatchKey("openai/gpt-5.5-preview")).toBe("gpt5.5");
    expect(rankMatchKey("anthropic/claude-3-5-sonnet-20241022")).toBe("claude3.5sonnet");
  });
});

describe("rankKeysMatch (boundary-safe)", () => {
  it("matches exact", () => {
    expect(rankKeysMatch("gpt5.5", "gpt5.5")).toBe(true);
  });
  it("never matches across a version boundary", () => {
    expect(rankKeysMatch("gpt5", "gpt5.5")).toBe(false);
    expect(rankKeysMatch("qwen3max", "qwen3.7max")).toBe(false);
  });
  it("allows a letter-boundary suffix extension", () => {
    expect(rankKeysMatch("deepseekv4", "deepseekv4pro")).toBe(true);
  });
  it("rejects a too-short shared base", () => {
    expect(rankKeysMatch("gpt5", "gpt5pro")).toBe(false);
  });
});

describe("runRankingDrivenAutoAdd", () => {
  afterEach(() => {
    // belt-and-suspenders: ensure overlay is valid JSON array after each test
    if (fs.existsSync(OVERLAY_PATH)) {
      const raw = fs.readFileSync(OVERLAY_PATH, "utf8").trim();
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });

  it("promotes top closed + open models that are routable on OpenRouter", () => {
    // Fixtures MUST be synthetic ids that cannot collide with the live,
    // auto-updated MODEL_REGISTRY: providers.ts appends data/model-registry-
    // overlay.json into MODEL_REGISTRY at import time, and runRankingDrivenAutoAdd
    // dedups candidates against MODEL_REGISTRY (a frozen import-time merge that
    // withOverlay([]) cannot undo). Using real model names like "qwen3.7-max"
    // makes this test fail the moment the weekly refresh adds that model to the
    // overlay. "phantom-*" ids stay hermetic. (openai ⇒ closed creator; a creator
    // not in CLOSED_WEIGHT_CREATORS ⇒ open.)
    const ranked = [
      aa("Phantom Closed Z", "phantom-closed-z", "openai", 95),
      aa("Phantom Open Z", "phantom-open-z", "acme", 90),
    ];
    const catalog = [
      orModel("openai/phantom-closed-z", "0.00001"),
      orModel("acme/phantom-open-z", "0.0000012"),
    ];
    const res = withOverlay([], () =>
      runRankingDrivenAutoAdd(ranked, catalog, { topKPerClass: 5, persist: false }),
    );
    const ids = res.promoted.map((p) => p.id).sort();
    expect(ids).toEqual(["acme/phantom-open-z", "openai/phantom-closed-z"]);
    for (const p of res.promoted) {
      expect(p.provider).toBe("openrouter");
      expect(p.description).toContain(RANKING_AUTOADD_TAG);
      expect(p.costClass).toBeTruthy();
    }
  });

  it("skips a top model with no confident OpenRouter match (fail-closed per entry)", () => {
    const ranked = [aa("Phantom X", "phantom-x", "acme", 99)];
    const catalog = [orModel("qwen/qwen3.7-max", "0.0000012")];
    const res = withOverlay([], () =>
      runRankingDrivenAutoAdd(ranked, catalog, { persist: false }),
    );
    expect(res.promoted).toHaveLength(0);
  });

  it("skips on AMBIGUOUS fuzzy match — two distinct routable ids (fail-closed, no misroute)", () => {
    // base "deepseekv9" is not in MODEL_REGISTRY, so this proves ambiguity, not dedupe.
    const ranked = [aa("DeepSeek V9", "deepseek-v9", "deepseek", 92)];
    const catalog = [
      orModel("deepseek/deepseek-v9-pro", "0.0000012"),
      orModel("deepseek/deepseek-v9-max", "0.0000015"),
    ];
    const res = withOverlay([], () =>
      runRankingDrivenAutoAdd(ranked, catalog, { persist: false }),
    );
    expect(res.promoted).toHaveLength(0);
  });

  it("still promotes on a SINGLE confident fuzzy match (suffix extension)", () => {
    const ranked = [aa("DeepSeek V9", "deepseek-v9", "deepseek", 92)];
    const catalog = [orModel("deepseek/deepseek-v9-pro", "0.0000012")];
    const res = withOverlay([], () =>
      runRankingDrivenAutoAdd(ranked, catalog, { persist: false }),
    );
    expect(res.promoted.map((p) => p.id)).toEqual(["deepseek/deepseek-v9-pro"]);
  });

  it("does NOT duplicate a model already represented in the overlay (by match-key)", () => {
    const ranked = [aa("Qwen3.7 Max", "qwen3.7-max", "alibaba", 90)];
    const catalog = [orModel("qwen/qwen3.7-max", "0.0000012")];
    const res = withOverlay(
      [{ id: "qwen/qwen3.7-max", label: "x", provider: "openrouter", tier: "balanced", description: "manual", capabilities: ["code"], costClass: "cheap" }],
      () => runRankingDrivenAutoAdd(ranked, catalog, { persist: false }),
    );
    expect(res.promoted).toHaveLength(0);
  });

  it("retires a stale ranking-driven entry not in this week's top set", () => {
    const ranked = [aa("Qwen3.7 Max", "qwen3.7-max", "alibaba", 90)];
    const catalog = [orModel("qwen/qwen3.7-max", "0.0000012")];
    const stale = {
      id: "deepseek/deepseek-v3", label: "old", provider: "openrouter", tier: "fast",
      description: `${RANKING_AUTOADD_TAG} open-weight stale`, capabilities: ["code"], costClass: "cheap",
    };
    const res = withOverlay([stale], () =>
      runRankingDrivenAutoAdd(ranked, catalog, { persist: false }),
    );
    expect(res.retired).toContain("deepseek/deepseek-v3");
  });

  it("never retires a ranking-driven entry currently in a live tier (protectedIds)", () => {
    const ranked = [aa("Qwen3.7 Max", "qwen3.7-max", "alibaba", 90)];
    const catalog = [orModel("qwen/qwen3.7-max", "0.0000012")];
    const live = {
      id: "deepseek/deepseek-v3", label: "live", provider: "openrouter", tier: "fast",
      description: `${RANKING_AUTOADD_TAG} open-weight live`, capabilities: ["code"], costClass: "cheap",
    };
    const res = withOverlay([live], () =>
      runRankingDrivenAutoAdd(ranked, catalog, { protectedIds: ["deepseek/deepseek-v3"], persist: false }),
    );
    expect(res.retired).not.toContain("deepseek/deepseek-v3");
  });

  it("never touches a NON-ranking-driven (manual/watchlist) overlay entry", () => {
    const ranked = [aa("Qwen3.7 Max", "qwen3.7-max", "alibaba", 90)];
    const catalog = [orModel("qwen/qwen3.7-max", "0.0000012")];
    const manual = {
      id: "some/manual-model", label: "manual", provider: "openrouter", tier: "fast",
      description: "hand-added, no sentinel", capabilities: ["code"], costClass: "cheap",
    };
    const res = withOverlay([manual], () =>
      runRankingDrivenAutoAdd(ranked, catalog, { persist: false }),
    );
    expect(res.retired).not.toContain("some/manual-model");
  });

  it("is fully fail-open on empty inputs", () => {
    expect(runRankingDrivenAutoAdd([], [orModel("qwen/qwen3.7-max", "0.0000012")], { persist: false }))
      .toEqual({ promoted: [], retired: [] });
    expect(runRankingDrivenAutoAdd([aa("Qwen3.7 Max", "qwen3.7-max", "alibaba", 90)], [], { persist: false }))
      .toEqual({ promoted: [], retired: [] });
  });
});
