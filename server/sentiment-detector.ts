import { db } from "./db";
import { sql } from "drizzle-orm";

export interface SentimentSignal {
  frustration: boolean;
  urgency: boolean;
  confusion: boolean;
  satisfaction: boolean;
  score: number;
  triggers: string[];
  adaptiveDirective: string;
}

const FRUSTRATION_PATTERNS: Array<[RegExp, string, number]> = [
  [/\bwtf\b/i, "wtf", 3],
  [/\bffs\b/i, "ffs", 3],
  [/\bwth\b/i, "wth", 2],
  [/\bomg\b/i, "omg", 1],
  [/\bsmh\b/i, "smh", 2],
  [/this (is |)(so |really |absolutely |fucking |damn )?frustrat/i, "frustration-explicit", 3],
  [/this (sucks|blows|is broken|is garbage|is trash|doesn'?t work|isn'?t working|never works)/i, "negative-assessment", 3],
  [/piece of (crap|shit|junk)/i, "strong-negative", 4],
  [/what the (hell|heck|fuck)/i, "strong-frustration", 4],
  [/are you (stupid|dumb|broken|deaf|blind|useless|incompetent)/i, "directed-frustration", 5],
  [/you('re| are) (useless|worthless|terrible|awful|horrible|the worst)/i, "directed-negative", 5],
  [/i('m| am) (so |)(frustrated|annoyed|pissed|angry|mad|furious|livid)/i, "self-reported-frustration", 4],
  [/stop (doing that|repeating|ignoring|messing|screwing)/i, "correction-demand", 3],
  [/i (already|just) (told|said|asked|explained)/i, "repetition-frustration", 3],
  [/how many times/i, "repetition-frustration", 3],
  [/for the (last|third|fourth|fifth|hundredth) time/i, "repetition-extreme", 4],
  [/can you (just|please just|actually|finally)/i, "impatience", 2],
  [/why (won'?t|can'?t|doesn'?t|isn'?t|aren'?t) (it|this|that|you)/i, "why-broken", 2],
  [/seriously\??$/i, "exasperation", 2],
  [/come on\b/i, "impatience", 2],
  [/\bugh+\b/i, "ugh", 2],
  [/\bargh+\b/i, "argh", 2],
  [/!!{2,}/i, "multiple-exclamation", 1],
  [/\?\?{2,}/i, "multiple-question", 1],
  [/waste of (time|money|my time)/i, "waste", 3],
  [/forget it|never ?mind|screw it|f[*]+ (it|this|that)/i, "giving-up", 4],
  [/i give up|i quit|i('m| am) done/i, "giving-up", 4],
];

const URGENCY_PATTERNS: Array<[RegExp, string, number]> = [
  [/\basap\b/i, "asap", 2],
  [/\burgent(ly)?\b/i, "urgent", 3],
  [/right now\b/i, "right-now", 2],
  [/immediately\b/i, "immediately", 3],
  [/time sensitive\b/i, "time-sensitive", 3],
  [/deadline/i, "deadline", 2],
  [/running out of time/i, "running-out", 3],
  [/need this (done |)(today|tonight|now|yesterday|by|before)/i, "need-by", 3],
  [/hurry|rush/i, "rush", 2],
  [/critical|emergency/i, "critical", 3],
];

const CONFUSION_PATTERNS: Array<[RegExp, string, number]> = [
  [/i('m| am) (so |)(confused|lost|stuck)/i, "self-reported-confusion", 3],
  [/what (do you mean|are you talking about|is that|does that mean)/i, "clarification-needed", 2],
  [/i don'?t (understand|get it|follow|see)/i, "not-understanding", 3],
  [/that (makes no|doesn'?t make) sense/i, "nonsensical", 3],
  [/huh\??$/i, "huh", 2],
  [/\bwhat\?+$/i, "what", 2],
  [/can you (explain|clarify|break .* down|simplify)/i, "explain-request", 1],
];

const SATISFACTION_PATTERNS: Array<[RegExp, string, number]> = [
  [/\b(perfect|excellent|awesome|amazing|brilliant|fantastic|great job|well done|nice work)\b/i, "positive-feedback", 3],
  [/that('s| is) (exactly|precisely|just) what/i, "exact-match", 3],
  [/thank(s| you) (so much|a lot|a ton)/i, "strong-thanks", 2],
  [/you('re| are) (amazing|awesome|the best|incredible|great|a lifesaver)/i, "directed-positive", 4],
  [/love (it|this|that)/i, "love-it", 2],
  [/nailed it/i, "nailed-it", 3],
];

function matchPatterns(
  message: string,
  patterns: Array<[RegExp, string, number]>
): { matched: boolean; triggers: string[]; totalScore: number } {
  const triggers: string[] = [];
  let totalScore = 0;
  for (const [pattern, label, weight] of patterns) {
    if (pattern.test(message)) {
      triggers.push(label);
      totalScore += weight;
    }
  }
  return { matched: triggers.length > 0, triggers, totalScore };
}

export function detectSentiment(message: string): SentimentSignal {
  if (!message || message.length < 2) {
    return { frustration: false, urgency: false, confusion: false, satisfaction: false, score: 0, triggers: [], adaptiveDirective: "" };
  }

  const frustration = matchPatterns(message, FRUSTRATION_PATTERNS);
  const urgency = matchPatterns(message, URGENCY_PATTERNS);
  const confusion = matchPatterns(message, CONFUSION_PATTERNS);
  const satisfaction = matchPatterns(message, SATISFACTION_PATTERNS);

  const allTriggers = [
    ...frustration.triggers.map(t => `frustration:${t}`),
    ...urgency.triggers.map(t => `urgency:${t}`),
    ...confusion.triggers.map(t => `confusion:${t}`),
    ...satisfaction.triggers.map(t => `satisfaction:${t}`),
  ];

  const netScore = (frustration.totalScore + urgency.totalScore + confusion.totalScore) - satisfaction.totalScore;

  let adaptiveDirective = "";

  if (frustration.totalScore >= 4) {
    adaptiveDirective = `## SENTIMENT AWARENESS — FRUSTRATION DETECTED
The user is frustrated (signals: ${frustration.triggers.join(", ")}). Adapt your response:
- Be direct and action-oriented. Skip pleasantries and caveats.
- Lead with the solution or fix, not with empathy statements.
- If you caused the frustration (repeated errors, ignoring requests), acknowledge it in ONE sentence then immediately fix it.
- Keep response under 100 words unless the solution requires detail.
- Do NOT say "I understand your frustration" — that's hollow. Just fix the problem.`;
  } else if (frustration.totalScore >= 2) {
    adaptiveDirective = `## SENTIMENT AWARENESS — MILD FRUSTRATION
The user shows signs of impatience (signals: ${frustration.triggers.join(", ")}). Be more concise and action-focused than usual. Lead with results, not process.`;
  }

  if (confusion.totalScore >= 3) {
    adaptiveDirective += adaptiveDirective ? "\n\n" : "";
    adaptiveDirective += `## SENTIMENT AWARENESS — CONFUSION DETECTED
The user is confused (signals: ${confusion.triggers.join(", ")}). Adapt your response:
- Break your answer into numbered steps.
- Use simple, concrete language — avoid jargon.
- Give one specific example.
- Ask a focused clarifying question if the confusion source is unclear.`;
  }

  if (urgency.totalScore >= 3) {
    adaptiveDirective += adaptiveDirective ? "\n\n" : "";
    adaptiveDirective += `## SENTIMENT AWARENESS — URGENCY DETECTED
The user indicates this is time-sensitive (signals: ${urgency.triggers.join(", ")}). Prioritize speed:
- Give the fastest viable solution first, optimizations later.
- Skip extended analysis unless asked.
- If multiple approaches exist, pick the best one and execute — don't present options.`;
  }

  if (satisfaction.totalScore >= 3 && frustration.totalScore === 0) {
    adaptiveDirective = `## SENTIMENT AWARENESS — POSITIVE FEEDBACK
The user is satisfied. Maintain current approach quality. Brief acknowledgment is fine, then continue delivering value.`;
  }

  return {
    frustration: frustration.totalScore >= 2,
    urgency: urgency.totalScore >= 2,
    confusion: confusion.totalScore >= 2,
    satisfaction: satisfaction.totalScore >= 2 && frustration.totalScore === 0,
    score: netScore,
    triggers: allTriggers,
    adaptiveDirective,
  };
}

export async function logSentimentEvent(
  tenantId: number,
  conversationId: number,
  signal: SentimentSignal
): Promise<void> {
  if (signal.triggers.length === 0) return;
  try {
    await db.execute(sql`
      INSERT INTO sentiment_events (tenant_id, conversation_id, frustration, urgency, confusion, satisfaction, score, triggers, created_at)
      VALUES (${tenantId}, ${conversationId}, ${signal.frustration}, ${signal.urgency}, ${signal.confusion}, ${signal.satisfaction}, ${signal.score}, ${JSON.stringify(signal.triggers)}, NOW())
    `);
  } catch (err) {
    console.log("[sentiment] Event logging skipped (table may not exist yet):", (err as Error).message?.slice(0, 80));
  }
}
