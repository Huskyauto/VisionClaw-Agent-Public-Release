/**
 * model-registry.ts — extracted from providers.ts (Task 104 girth split,
 * 2026-07-31; mechanical move, zero behavior change). The static model
 * catalog: ModelInfo + MODEL_REGISTRY (curated models with pricing/tier
 * metadata), multimodal/exploration helpers, per-model max-output caps, and
 * tier cost estimates. Pure data + pure helpers — MUST NOT import providers.ts
 * (providers.ts imports this module and re-exports the public names so
 * existing importers are unchanged).
 */

import * as fs from "fs";
import * as path from "path";

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  tier: "fast" | "balanced" | "powerful" | "reasoning";
  description: string;
  capabilities?: ("vision" | "audio" | "image_gen" | "video" | "code" | "tools")[];
  costClass?: "free" | "cheap" | "paid";
  // R77.5 (KisMATH arxiv 2507.11408v2): training regime drives the answer-distribution shape.
  // KisMATH fig. 7-9 shows RLVR-trained models collapse to "exponential" overconfident distributions
  // with narrow exploration (good for deterministic exploitation, bad for ensembling/exploration).
  // Distilled / SFT / base models keep "bell-shape" distributions with broader exploration —
  // ideal as ensemble proposers and as the "second look" judge.
  //   "rlvr"      = trained with RL on verifiable rewards (DeepSeek-R1, OpenAI o-series, Claude RLAIF)
  //   "distilled" = distilled from a frontier model (DeepSeek-V series MTP, Gemma, Kimi, Nemotron, GLM)
  //   "sft"       = standard supervised fine-tune only (no RLVR collapse)
  //   "base"      = base / minimally post-trained
  //   "unknown"   = no public docs on training regime
  trainingRegime?: "base" | "sft" | "rlvr" | "distilled" | "unknown";
}

export const MODEL_REGISTRY: ModelInfo[] = [
  { id: "auto", label: "Auto Select", provider: "replit", tier: "balanced", description: "Intelligently routes to the best model for each task", costClass: "free", trainingRegime: "unknown" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "replit", tier: "powerful", description: "Latest OpenAI flagship (strongest 5.6 variant) — newest reasoning + multimodal; ChatGPT-subscription OAuth lane when connected, else flagship-lane metered", capabilities: ["vision", "audio", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gpt-5.5", label: "GPT-5.5", provider: "replit", tier: "powerful", description: "Previous OpenAI flagship — fallback behind GPT-5.6 Sol", capabilities: ["vision", "audio", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  // ── Profundo flat-lane high-end expansion (verified live /v1/models 2026-08-14) ──
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "replit", tier: "powerful", description: "OpenAI 5.6 variant (Luna) — served via Profundo flat $20/mo lane at $0 marginal", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "replit", tier: "powerful", description: "OpenAI 5.6 variant (Terra) — served via Profundo flat $20/mo lane at $0 marginal", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", provider: "replit", tier: "powerful", description: "OpenAI coding specialist — served via Profundo flat lane at $0 marginal", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic", tier: "powerful", description: "Anthropic newest mid-flagship — Claude Runner (no-tools) first, else Profundo flat lane at $0 marginal", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", tier: "fast", description: "Anthropic fast tier — Claude Runner (no-tools) first, else Profundo flat lane at $0 marginal", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "distilled" },
  { id: "minimax/minimax-m3", label: "MiniMax M3", provider: "openrouter", tier: "powerful", description: "MiniMax flagship — served via Profundo flat lane at $0 marginal", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "qwen/qwen3.6-plus", label: "Qwen 3.6 Plus", provider: "openrouter", tier: "powerful", description: "Alibaba Qwen high-end — served via Profundo flat lane at $0 marginal", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "mistralai/mistral-large", label: "Mistral Large", provider: "openrouter", tier: "powerful", description: "Mistral flagship — served via Profundo flat lane at $0 marginal", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "moonshotai/kimi-k2.7-code", label: "Kimi K2.7 Code", provider: "openrouter", tier: "balanced", description: "Moonshot coding specialist — served via Profundo flat lane at $0 marginal", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "distilled" },
  { id: "gpt-5.4", label: "GPT-5.4", provider: "replit", tier: "powerful", description: "Previous OpenAI flagship", capabilities: ["vision", "audio", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", provider: "replit", tier: "balanced", description: "Fast and cost-effective", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "o4-mini", label: "o4 Mini (legacy)", provider: "replit", tier: "reasoning", description: "Legacy alias — routes to GPT-5 Mini", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "rlvr" },

  { id: "gpt-5", label: "GPT-5", provider: "replit", tier: "powerful", description: "Coding & instruction following (upgraded from GPT-4.1, Task 72)", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "openai", tier: "balanced", description: "Balanced speed and intelligence", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "o4-mini-openai", label: "o4 Mini (OpenAI, legacy)", provider: "openai", tier: "reasoning", description: "Legacy alias — routes to GPT-5 Mini on the OpenAI API", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "rlvr" },

  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4 (Latest)", provider: "anthropic", tier: "powerful", description: "Latest Sonnet - best balanced model", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-opus-4-5", label: "Claude Opus 4 (Latest)", provider: "anthropic", tier: "powerful", description: "Latest Opus - most capable reasoning and coding", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", tier: "powerful", description: "Extended thinking, hybrid reasoning", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic", tier: "powerful", description: "Deep complex reasoning and coding", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", provider: "anthropic", tier: "powerful", description: "1M context, 128K output, hi-res vision, xhigh effort, adaptive thinking; +13% over 4.6 on coding bench (superseded as flagship by 4.8)", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic", tier: "powerful", description: "1M context, 128K output, hi-res vision, xhigh effort, adaptive thinking; supersedes Opus 4.7 (superseded as flagship by Opus 5, Bob 2026-07-24)", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic", tier: "powerful", description: "DEFAULT Anthropic flagship (Bob 2026-07-24) — verified live on api.anthropic.com /models 2026-07-24; 1M context, 128K output; $5/$25 per M (live OpenRouter rate, same as Opus 4.8); supersedes Opus 4.8; covered by the Claude Runner flat-rate lane", capabilities: ["vision", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "claude-fable-5", label: "Claude Fable 5", provider: "anthropic", tier: "powerful", description: "LAST-RESORT super-expert escalation ONLY (Bob 2026-07-01) — 1M context, 128K output, xhigh effort, adaptive thinking. METERED on the Anthropic direct key (no flat-rate lane confirmed; caused 3× ~$20/day when defaulted 2026-06-11). NEVER a default proposer/aggregator/frontier id — reach for it only when everything else fails to give a correct answer.", capabilities: ["vision", "code", "tools"], costClass: "paid", trainingRegime: "rlvr" },

  // R81 — all xai-direct Grok entries retired. The whole Grok line consolidates to
  // a single openrouter entry: x-ai/grok-4.20-multi-agent (see below in OR block).

  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", provider: "google", tier: "powerful", description: "FLAGSHIP Google model (Google I/O 2026-05-19) — frontier intelligence + action, excels at long-horizon agentic tasks and coding; promoted to high-end tier in R125+3.7 pending Gemini 3.5 Pro release. METERED — NOT on the free Replit modelfarm lane; bills the Google API key (~$0.12/call). Reserve for complex work / the jury; cheap autonomous work uses gemini-2.5-flash.", capabilities: ["vision", "audio", "video", "code", "tools"], costClass: "paid", trainingRegime: "rlvr" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", provider: "google", tier: "powerful", description: "Most powerful - agentic workflows, multimodal, complex reasoning", capabilities: ["vision", "audio", "video", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro", provider: "google", tier: "powerful", description: "Powerful agentic model and vibe-coding", capabilities: ["vision", "audio", "video", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", provider: "google", tier: "balanced", description: "Hybrid reasoning, good for daily use and high-volume", capabilities: ["vision", "audio", "video", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google", tier: "balanced", description: "Fast and capable, great cost-to-quality ratio", capabilities: ["vision", "audio", "code", "tools"], costClass: "free", trainingRegime: "rlvr" },

  { id: "sonar-pro", label: "Sonar Pro", provider: "perplexity", tier: "powerful", description: "Deep web research with citations", costClass: "paid", trainingRegime: "sft" },
  { id: "sonar", label: "Sonar", provider: "perplexity", tier: "balanced", description: "Fast web search with citations", costClass: "paid", trainingRegime: "sft" },
  { id: "sonar-reasoning-pro", label: "Sonar Reasoning Pro", provider: "perplexity", tier: "reasoning", description: "Multi-step research with reasoning", costClass: "paid", trainingRegime: "rlvr" },
  { id: "sonar-deep-research", label: "Sonar Deep Research", provider: "perplexity", tier: "powerful", description: "Exhaustive multi-source research", costClass: "paid", trainingRegime: "sft" },

  { id: "xiaomi/mimo-v2-flash", label: "MiMo V2 Flash", provider: "openrouter", tier: "balanced", description: "#1 open-source SWE-bench, 309B MoE (15B active), 256K ctx, hybrid thinking — $0.09/M in", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "xiaomi/mimo-v2-omni", label: "MiMo V2 Omni", provider: "openrouter", tier: "powerful", description: "Frontier omni-modal — image/video/audio input, visual grounding, agentic tool use — $0.40/M in", capabilities: ["vision", "audio", "video", "code", "tools"], costClass: "cheap", trainingRegime: "distilled" },

  { id: "x-ai/grok-4.20-multi-agent", label: "Grok 4.20 Multi-Agent", provider: "openrouter", tier: "powerful", description: "xAI flagship multi-agent orchestration — 2M ctx, purpose-built for parallel sub-agent coordination, $1.25/M in $2.50/M out — VisionClaw top-end workhorse for parallel project execution", capabilities: ["vision", "code", "tools"], costClass: "paid", trainingRegime: "rlvr" },
  // Verified live 2026-07-11: 200 chat completion on api.x.ai direct (emits reasoning_tokens) AND listed on OpenRouter (500K ctx, $2/$6). Routed via OpenRouter per R81 Grok consolidation.
  { id: "x-ai/grok-4.6", label: "Grok 4.6", provider: "openrouter", tier: "powerful", description: "xAI newest flagship reasoning model (verified live 2026-08-12) — 500K ctx, $2/M in $6/M out, significant benchmark jump over 4.5 at the same price. For parallel multi-agent orchestration or >500K context keep using grok-4.20-multi-agent (2M ctx, cheaper at $1.25/$2.50 per M)", capabilities: ["vision", "code", "tools"], costClass: "paid", trainingRegime: "rlvr" },
  { id: "x-ai/grok-4.5", label: "Grok 4.5", provider: "openrouter", tier: "powerful", description: "xAI previous flagship reasoning model (superseded by grok-4.6 at the same price 2026-08-12; kept as fallback + Profundo flat-lane mapping) — 500K ctx, $2/M in $6/M out", capabilities: ["vision", "code", "tools"], costClass: "paid", trainingRegime: "rlvr" },
  // xAI direct Grok build model — verified live on api.x.ai 2026-06-05 (in /v1/models list, 200 chat completion, emits reasoning_content). Routes via XAI_API_KEY direct path in getClientForModel.
  { id: "grok-build-0.1", label: "Grok Build 0.1", provider: "xai", tier: "reasoning", description: "xAI Grok build model — reasoning + agentic coding, emits reasoning_content; direct xAI API (XAI_API_KEY). Verified live 2026-06-05", capabilities: ["code", "tools"], costClass: "paid", trainingRegime: "rlvr" },

  { id: "deepseek/deepseek-v4-pro-0813", label: "DeepSeek V4 Pro", provider: "openrouter", tier: "powerful", description: "FLAGSHIP — DeepSeek's newest top-tier model (Apr 2026), best for high-quality technical workloads, ensemble proposer #1", capabilities: ["vision", "code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "openrouter", tier: "balanced", description: "Fast V4 variant for high-volume tasks", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  // Verified live on OpenRouter 2026-08-01 (200 completion via DeepInfra; reasoning model — emits reasoning tokens, needs a real token budget). Registry option ONLY — not in tier routing, MoA, or model-tiers.json.
  { id: "deepseek/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash 0731", provider: "openrouter", tier: "balanced", description: "July 2026 V4 Flash snapshot — reasoning model, 1M ctx, $0.09/M in $0.18/M out (cheapest strong-reasoning lane). Pick-by-name only; NOT a routing default", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", provider: "openrouter", tier: "powerful", description: "GPT-5 class reasoning, sparse attention, 164K ctx — $0.26/M in", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "deepseek/deepseek-r1", label: "DeepSeek R1", provider: "openrouter", tier: "reasoning", description: "Deep reasoning model — top math/code benchmarks", capabilities: ["code"], costClass: "cheap", trainingRegime: "rlvr" },

  // GLM-5.3 (launched 2026-08-14): served via the direct Z.AI lane (owner-funded;
  // ZAI_MODEL_MAP in providers.ts) — permission-gated on Z.AI's side at launch.
  // provider stays "openrouter" so when the Z.AI lane is down/denied, the request
  // falls into the normal $0-substitution ladder instead of erroring.
  { id: "z-ai/glm-5.3", label: "GLM 5.3", provider: "openrouter", tier: "powerful", description: "Z.ai 743B agentic/cyber flagship (2026-08-14) — beats Claude Opus 4.8 on Terminal Bench/DeepSWE/CyberGym; direct Z.AI lane (metered, owner-funded)", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "z-ai/glm-5.2", label: "GLM 5.2", provider: "openrouter", tier: "powerful", description: "Z.ai flagship (OpenRouter default GLM as of 2026-06-23) — top-tier reasoning + agentic coding, 1M context — $0.76/M in / $2.39/M out", capabilities: ["vision", "code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "z-ai/glm-5.1", label: "GLM 5.1", provider: "openrouter", tier: "powerful", description: "Zhipu (previous flagship) — strong reasoning, low hallucination, 202K ctx — $0.95/M in", capabilities: ["vision", "code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "z-ai/glm-4.5-air:free", label: "GLM 4.5 Air (Free)", provider: "openrouter", tier: "balanced", description: "Free Zhipu model — solid quality for zero cost, 131K ctx", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "distilled" },

  { id: "google/gemma-4-31b-it", label: "Gemma 4 31B", provider: "openrouter", tier: "balanced", description: "Google 31B dense, Apache 2.0, 256K ctx, multimodal, reasoning mode — $0.14/M in", capabilities: ["vision", "code", "tools"], costClass: "cheap", trainingRegime: "distilled" },

  { id: "z-ai/glm-5", label: "GLM-5", provider: "openrouter", tier: "powerful", description: "Z.ai (previous flagship) — #1 Chatbot Arena, agentic planning, 80K ctx — $0.72/M in", capabilities: ["vision", "code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "z-ai/glm-4.7-flash", label: "GLM-4.7 Flash", provider: "openrouter", tier: "fast", description: "30B SOTA agentic coder, 202K ctx — $0.06/M in, ultra-cheap", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },

  { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super", provider: "openrouter", tier: "powerful", description: "120B MoE (12B active), 1M ctx, Mamba-Transformer hybrid — $0.10/M in", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  // Verified live on OpenRouter 2026-07-17: 1M ctx, $0/$0 free tier, text-only, 65K max completion.
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra (Free)", provider: "openrouter", tier: "powerful", description: "NVIDIA flagship 550B MoE (55B active) — 1M ctx, Mamba-Transformer hybrid, frontier-class reasoning — FREE tier (paid variant is $0.60/M in $3.60/M out). Standing registry option, NOT in the standing jury or $0 tier routing", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "distilled" },

  { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6", provider: "openrouter", tier: "powerful", description: "1T MoE, 262K ctx, 1500 parallel tools, vision + agent swarm — $0.60/M in", capabilities: ["vision", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  // Kimi-K3 — verified live on OpenRouter 2026-07-16 (1M ctx, $3/M in $15/M out).
  // FRONTIER RESERVE ONLY (Bob 2026-07-16): NOT in the standing jury/tier routing —
  // fires solely as backfill when a main-round frontier proposer fails (see
  // FRONTIER_RESERVE in server/moa.ts). Priced like a flagship; keep out of
  // high-volume lanes.
  { id: "moonshotai/kimi-k3", label: "Kimi K3", provider: "openrouter", tier: "powerful", description: "Moonshot flagship (Jul 2026) — 1M ctx, frontier-class reasoning — $3/M in $15/M out. RESERVE proposer only, not standing-jury", capabilities: ["vision", "code", "tools"], costClass: "paid", trainingRegime: "rlvr" },

  { id: "inclusionai/ling-2.6-1t:free", label: "Ling-2.6-1T (Free)", provider: "openrouter", tier: "powerful", description: "Ant Group/InclusionAI 1T MoE — non-reasoning execution-first design, 262K ctx, optimized for useful-intelligence-per-token (skips chain-of-thought narration), strong agent/tool-call workloads — FREE", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "distilled" },
  { id: "tencent/hy3:free", label: "Hy3 (Free)", provider: "openrouter", tier: "powerful", description: "Tencent 295B MoE (21B active, top-8 of 192 experts) — configurable reasoning effort, 262K ctx, tools + structured outputs, built for agentic workflows — FREE (promo pricing, verified live 2026-07-08)", capabilities: ["code", "tools"], costClass: "free", trainingRegime: "distilled" },
  { id: "inclusionai/ling-2.6-flash", label: "Ling-2.6 Flash", provider: "openrouter", tier: "fast", description: "InclusionAI flash variant — 262K ctx, ultra-cheap ($0.08/M in, $0.24/M out), execution-first non-reasoning, ideal for high-volume agent loops", capabilities: ["code", "tools"], costClass: "cheap", trainingRegime: "distilled" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", provider: "openrouter", tier: "powerful", description: "Meta open-source flagship — vision + tools, Apache 2.0", capabilities: ["vision", "code", "tools"], costClass: "cheap", trainingRegime: "base" },
  // Verified live on OpenRouter 2026-07-17: 1M ctx, $1.25/M in $4.25/M out.
  { id: "meta/muse-spark-1.1", label: "Muse Spark 1.1", provider: "openrouter", tier: "powerful", description: "Meta Muse Spark 1.1 (Jul 2026) — 1M ctx, $1.25/M in $4.25/M out. Mid-priced metered flagship-class model; standing registry option, NOT in the standing jury or $0 tier routing", capabilities: ["code", "tools"], costClass: "paid", trainingRegime: "rlvr" },

  // R125+52.40 (Bob 2026-06-16) — OpenRouter Fusion: managed multi-model
  // deliberation (panel answers in parallel → judge compares → final model
  // synthesizes), OpenRouter's hosted equivalent of our native ensemble_query/
  // jury. Registered as an OPTIONAL backend reference for deep-research /
  // expert-critique prompts ONLY (the "cost of being wrong > a few extra
  // completions" case) — NOT a default proposer/aggregator. METERED: bills the
  // OPENROUTER_API_KEY at the SUM of every panel member + judge + final
  // completion (no free lane), so the $0-policy guard in getClientForModel
  // substitutes it away by default; a caller must pass { costExemptLane: true }
  // (or run with ALLOW_METERED_LLM=true) to actually invoke it, and MUST read
  // the real cost from the response's usage.cost (the token-based estimate is
  // meaningless for a meta-model). Evaluate via scripts/fusion-vs-moa-ab.ts.
  { id: "openrouter/fusion", label: "OpenRouter Fusion (panel+judge)", provider: "openrouter", tier: "powerful", description: "Managed multi-model deliberation — a panel answers in parallel, a judge compares them, a final model synthesizes. Optional deep-research backend reference; metered (sum of all underlying completions), not a default proposer.", capabilities: ["code", "tools"], costClass: "paid", trainingRegime: "unknown" },
];

// R110.11.2 — Auto-add overlay. The catalog watcher in server/model-catalog.ts
// writes new entries (matching MODEL_AUTOADD_WATCHLIST patterns) to
// data/model-registry-overlay.json so models like ERNIE 5.1 get into the
// registry the moment they appear on OpenRouter, without a code edit. Loaded
// once at module init; appended via push() (binding stays const, contents
// grow). Failures are loud-warned, not swallowed — a corrupt overlay file
// MUST surface so we know auto-add is silently broken.
try {
  const overlayPath = path.join(process.cwd(), "data", "model-registry-overlay.json");
  if (fs.existsSync(overlayPath)) {
    const raw = fs.readFileSync(overlayPath, "utf8").trim();
    if (raw.length > 0) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        let added = 0;
        for (const entry of parsed) {
          if (!entry || typeof entry !== "object") continue;
          if (typeof entry.id !== "string" || typeof entry.label !== "string" || typeof entry.provider !== "string" || typeof entry.tier !== "string") continue;
          if (MODEL_REGISTRY.some(m => m.id === entry.id)) continue;
          MODEL_REGISTRY.push(entry as ModelInfo);
          added++;
        }
        if (added > 0) {
          console.log(`[providers] R110.11.2 overlay: appended ${added} auto-added model(s) to MODEL_REGISTRY`);
        }
      } else {
        console.warn(`[providers] overlay file ${overlayPath} is not a JSON array — ignored`);
      }
    }
  }
} catch (err: any) {
  console.warn(`[providers] R110.11.2 overlay load failed (auto-added models NOT loaded): ${err?.message || err}`);
}

// R77.5 — KisMATH-derived helper. Returns true if the model is "exploratory" (not RLVR-collapsed) —
// useful when the router needs to pick a proposer for ensembling, debate, or open-ended reasoning.
export function isExplorationFriendly(modelId: string): boolean {
  const m = MODEL_REGISTRY.find(x => x.id === modelId);
  if (!m) return false;
  // RLVR collapses the answer distribution (KisMATH fig. 7-9), making it a poor exploration source.
  return m.trainingRegime !== "rlvr";
}

export function isModelMultimodal(modelId: string): boolean {
  const model = MODEL_REGISTRY.find(m => m.id === modelId);
  return !!(model?.capabilities?.includes("vision"));
}

export function getMultimodalModelsForTier(tier: "fast" | "balanced" | "powerful" | "reasoning"): ModelInfo[] {
  return MODEL_REGISTRY.filter(m => m.tier === tier && m.capabilities?.includes("vision"));
}

export const MODEL_MAX_OUTPUT: Record<string, number> = {
  "claude-sonnet-4-5": 16384,
  "claude-opus-4-5": 16384,
  "claude-sonnet-4-6": 65536,
  "claude-opus-4-6": 65536,
  "claude-opus-4-7": 131072,
  "claude-opus-4-8": 131072,
  "claude-opus-5": 131072,
  "claude-fable-5": 131072,
  "gpt-5.6-sol": 65536,
  "gpt-5.6-luna": 65536,
  "gpt-5.6-terra": 65536,
  "gpt-5.3-codex-spark": 65536,
  "claude-sonnet-5": 65536,
  "claude-haiku-4-5": 32768,
  "minimax/minimax-m3": 32768,
  "qwen/qwen3.6-plus": 32768,
  "mistralai/mistral-large": 32768,
  "moonshotai/kimi-k2.7-code": 32768,
  "gpt-5.5": 65536,
  "gpt-5.4": 32768,
  "gpt-5-mini": 32768,
  "gpt-5": 65536,
  "gpt-4.1": 32768,
  "gpt-4.1-mini": 32768,
  "o4-mini": 65536,
  "o4-mini-openai": 65536,
  "gemini-3.5-flash": 65536,
  "gemini-3-flash-preview": 65536,
  "gemini-3-pro-preview": 65536,
  "gemini-3.1-pro-preview": 65536,
  "gemini-2.5-flash": 65536,
  "xiaomi/mimo-v2-flash": 65536,
  "xiaomi/mimo-v2-omni": 65536,
  "x-ai/grok-4.20-multi-agent": 131072,
  "x-ai/grok-4.6": 65536,
  "x-ai/grok-4.5": 65536,
  "grok-build-0.1": 65536,
  "deepseek/deepseek-v4-pro-0813": 65536,
  "deepseek/deepseek-v4-flash": 32768,
  "deepseek/deepseek-v4-flash-0731": 32768,
  "deepseek/deepseek-v3.2": 32768,
  "deepseek/deepseek-r1": 32768,
  "z-ai/glm-5.3": 32768,
  "z-ai/glm-5.2": 32768,
  "z-ai/glm-5.1": 32768,
  "z-ai/glm-4.5-air:free": 16384,
  "google/gemma-4-31b-it": 32768,
  "z-ai/glm-5": 32768,
  "z-ai/glm-4.7-flash": 16384,
  "nvidia/nemotron-3-super-120b-a12b": 32768,
  "nvidia/nemotron-3-ultra-550b-a55b:free": 32768,
  "moonshotai/kimi-k2.6": 32768,
  "moonshotai/kimi-k3": 32768,
  "meta-llama/llama-4-maverick": 16384,
  "meta/muse-spark-1.1": 32768,
  "sonar": 16384,
  "sonar-pro": 16384,
  "sonar-reasoning-pro": 16384,
  "sonar-deep-research": 16384,
};

export function getMaxOutputTokens(modelId: string): number {
  return MODEL_MAX_OUTPUT[modelId] || 16384;
}

export const TIER_COST_ESTIMATES: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  fast: { inputPer1M: 0.10, outputPer1M: 0.40 },
  balanced: { inputPer1M: 0.40, outputPer1M: 1.60 },
  powerful: { inputPer1M: 3.00, outputPer1M: 12.00 },
  reasoning: { inputPer1M: 1.10, outputPer1M: 4.40 },
};
