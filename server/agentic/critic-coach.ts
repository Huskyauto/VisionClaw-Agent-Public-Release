// Critic-Coach — actor-critic / reflection step for the supervisor loop.
//
// Bob's idea (2026-06-19): when an agent tries something, it doesn't work, it
// loops and tries again and STILL spins with no success, don't just halt or
// blindly upgrade the model. Instead, a SECOND independent LLM reads the actual
// failed/repeated output, diagnoses WHY it failed, and hands targeted
// "do this / don't repeat that" guidance back to the SAME primary loop for one
// more INFORMED retry (paired with a model escalation — the "Combined" mode).
//
// REVIEWER INDEPENDENCE INVARIANT (R113, shared with critique-agent.ts / ARIS
// arXiv:2605.03042): the critic runs as an ISOLATED chat completion with its own
// system prompt and a freshly-built messages array. We pass the failed output +
// recent steps as DATA inside a single user message — we never thread the
// executor's live conversation history into the critic as conversation. Sharing
// thread state with the reviewer empirically collapses critique quality.
//
// Fails OPEN: any error / unparseable result returns { ok: false } and the
// caller falls through to its existing halt behaviour. The coach must never be
// able to crash a working loop.
import { replitOpenai } from "../providers";
import { COACH_SYSTEM_PROMPT, type CriticCoaching } from "./critic-coach-core";

// Pure, provider-free helpers live in critic-coach-core.ts (so they're testable
// without loading ../providers). Re-export them so existing import sites keep
// working against this module unchanged.
export {
  decideStuckRecovery,
  buildCoachHistoryEntry,
  renderCoaching,
  COACH_SYSTEM_PROMPT,
  type CriticCoaching,
  type EscalationLevel,
} from "./critic-coach-core";

/**
 * Analyze a stuck supervisor attempt and return coaching to feed back into the
 * SAME loop for one more informed retry. Never throws — fails OPEN.
 */
export async function coachStuckAttempt(params: {
  goal: string;
  stuckReason: string;
  lastOutput: any;
  recentHistory: { specialist: string; input: any; output: any }[];
  model?: string;
}): Promise<CriticCoaching> {
  const failOpen: CriticCoaching = { ok: false, rootCause: "", guidance: "", doNotRepeat: [] };
  try {
    let lastOutputStr: string;
    try {
      lastOutputStr = typeof params.lastOutput === "string" ? params.lastOutput : JSON.stringify(params.lastOutput);
    } catch {
      lastOutputStr = String(params.lastOutput);
    }

    const recent = (params.recentHistory || []).slice(-5).map((h, i) => {
      let inStr: string;
      let outStr: string;
      try { inStr = typeof h.input === "string" ? h.input : JSON.stringify(h.input); } catch { inStr = String(h.input); }
      try { outStr = typeof h.output === "string" ? h.output : JSON.stringify(h.output); } catch { outStr = String(h.output); }
      return `Step ${i + 1} — specialist "${h.specialist}":\n  input: ${inStr.slice(0, 600)}\n  output: ${outStr.slice(0, 800)}`;
    }).join("\n\n");

    const resp = await replitOpenai.chat.completions.create({
      model: params.model || "gpt-5-mini",
      messages: [
        { role: "system", content: COACH_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `GOAL:\n${String(params.goal).slice(0, 1200)}\n\n` +
            `STUCK SIGNAL:\n${String(params.stuckReason).slice(0, 400)}\n\n` +
            `LAST OUTPUT (the one being repeated):\n${lastOutputStr.slice(0, 1800)}\n\n` +
            `RECENT STEPS:\n${recent || "(none captured)"}\n\n` +
            `Diagnose why it is stuck and give corrective guidance:`,
        },
      ],
      max_completion_tokens: 600,
      response_format: { type: "json_object" },
    });

    const content = resp.choices[0]?.message?.content;
    if (!content) return failOpen;

    const parsed = JSON.parse(content);
    const rootCause = typeof parsed.root_cause === "string" ? parsed.root_cause.trim() : "";
    const guidance = typeof parsed.guidance === "string" ? parsed.guidance.trim() : "";
    const doNotRepeat = Array.isArray(parsed.do_not_repeat)
      ? parsed.do_not_repeat.filter((s: any) => typeof s === "string" && s.trim().length > 0).map((s: string) => s.trim())
      : [];

    // Need at least actionable guidance to be worth feeding back.
    if (guidance.length < 10) return failOpen;

    return { ok: true, rootCause, guidance, doNotRepeat };
  } catch (err: any) {
    console.error(`[critic-coach] failed (failing OPEN — loop continues to existing halt): ${err?.message || String(err)}`);
    return failOpen;
  }
}
