import { packageDraftRequest } from "./company-report-production";
import { COMPILATION_AUTHORS, COMPILATION_SYNTHESIZER, compilationOutputTokens } from "./company-compilation-matrix";

/** Configuration only: no provider request, model-list probe or paid inference. */
export function packageConfiguration(env: Readonly<Record<string, string | undefined>> = process.env) {
  const issues: string[] = [];
  if (env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1") issues.push("Report generation is paused by the operator.");
  if (env.OWNER_JURY_DIRECT_API_ENABLED !== "1") issues.push("The owner report model route is not enabled.");
  for (const [label, keys] of [
    ["OpenAI drafting", ["OPENAI_API_KEY"]],
    ["Claude drafting", ["ANTHROPIC_API_TOKEN", "ANTHROPIC_API_KEY"]],
    ["Gemini drafting", ["OPENROUTER_API_KEY"]],
    ["Fish Audio narration", ["FISH_AUDIO_API_KEY"]],
    ["American-English Fish voice", ["FISH_VOICE_ONYX"]],
  ] as const) {
    if (!keys.some(key => env[key]?.trim())) issues.push(`${label} is not configured.`);
  }
  const models = [...COMPILATION_AUTHORS.map(seat => ({
    report: "Authors: all three categories", model: seat.model, transport: seat.lane,
    outputTokens: compilationOutputTokens({ stage: "author", lane: seat.lane }),
  })), { report: "Synthesis: all three categories", model: COMPILATION_SYNTHESIZER.model,
    transport: COMPILATION_SYNTHESIZER.lane,
    outputTokens: compilationOutputTokens({ stage: "synthesis", lane: COMPILATION_SYNTHESIZER.lane }) }];
  // Exercise the same construction used by the dispatcher, never a second
  // independently maintained request profile.
  const argon = packageDraftRequest("opportunities", []);
  const gpt = packageDraftRequest("readiness", []);
  if (!("max_completion_tokens" in argon) || argon.max_completion_tokens !== 4096 ||
      !("max_completion_tokens" in gpt) || gpt.max_completion_tokens !== 8192)
    issues.push("Report request compatibility check failed.");
  return { ready: issues.length === 0, issues, models, modelBudgetUsd: 150, audioBudgetUsd: 5,
    notice: "One submission runs nine independent compilations and three syntheses, then Fish Audio and verified PDF delivery. Maximum allowances: $150 for report models plus $5 for narration (not estimated charges). Setup checks do not spend money or guarantee provider availability." };
}
