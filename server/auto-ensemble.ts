/**
 * Auto-Ensemble Routing — R74.9
 *
 * Decides whether the chat engine should pre-emptively invoke executeMoA()
 * (4-LLM mixture-of-agents) instead of relying on persona judgment to call
 * the ensemble_query tool.
 *
 * Personas have ensemble_query in their toolset (server/seed.ts:4619) but
 * rarely choose it because it's slow (~14s) and the personas don't always
 * recognize technical complexity. This module force-routes obvious technical
 * chats through the ensemble so users get the higher-quality synthesis.
 *
 * Strategy: classify the user message via cheap pattern heuristics first
 * (sub-millisecond, no API call). Only invoke ensemble when the heuristic
 * score is high AND the message isn't trivial. We do NOT use an LLM judge
 * here — the latency tax would defeat the purpose of pre-routing.
 *
 * Disable via AUTO_ENSEMBLE_DISABLED=true.
 */

export interface AutoEnsembleDecision {
  invoke: boolean;
  reason: string;
  score: number;
}

const TECHNICAL_KEYWORDS = [
  /\b(architect(?:ure)?|refactor|debug|optimi[sz]e|performance|scalab(?:le|ility))\b/i,
  /\b(algorithm|data\s+structure|complexity|big[-\s]?o)\b/i,
  /\b(api|endpoint|microservic|database|schema|migration|index(?:ing)?)\b/i,
  /\b(security|auth(?:entication|ori[sz]ation)?|encrypt|csrf|xss|sql\s+injection)\b/i,
  /\b(concurrenc|race\s+condition|deadlock|thread|async|await|promise)\b/i,
  /\b(typescript|python|rust|golang|javascript|react|node|express|drizzle|postgres|sql)\b/i,
  /\b(compare|trade[-\s]?off|pros\s+and\s+cons|vs\.?|versus)\b/i,
  /\b(explain\s+how|how\s+does|why\s+(?:is|does|would)|what\s+(?:are|is)\s+the\s+(?:differences?|implications?))\b/i,
  /\b(deploy|kubernetes|docker|container|terraform|infrastructure|devops)\b/i,
  /\b(machine\s+learning|neural\s+network|llm|transformer|embedding|rag|fine[-\s]?tun)\b/i,
];

const STRATEGIC_KEYWORDS = [
  /\b(strategy|roadmap|priorit(?:y|ize)|business\s+(?:case|model)|pivot|GTM|go[-\s]?to[-\s]?market)\b/i,
  /\b(analy[sz]e|analysis|deep[-\s]?dive|comprehensive|holistic)\b/i,
  /\b(implications?|consequences?|risks?|trade[-\s]?offs?|alternatives?)\b/i,
];

const TRIVIAL_PATTERNS = [
  /^(hi|hello|hey|thanks|thank\s+you|ok|okay|yes|no|sure|got\s+it|cool|nice)[\s.!?]*$/i,
  /^(what|when|where|who)\s+is\s+\w+[\s.!?]*$/i, // simple factoid
];

export function shouldAutoInvokeEnsemble(
  userMessage: string,
  opts: { hasCodeBlock?: boolean; wordCount?: number } = {},
): AutoEnsembleDecision {
  // R74.12 — accept both "true" and "1" so the documented kill switch
  // (replit.md says `AUTO_ENSEMBLE_DISABLED=1`) actually works.
  const flag = (process.env.AUTO_ENSEMBLE_DISABLED || "").toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes" || flag === "on") {
    return { invoke: false, reason: "disabled by env", score: 0 };
  }

  const msg = (userMessage || "").trim();
  if (!msg) return { invoke: false, reason: "empty message", score: 0 };

  for (const p of TRIVIAL_PATTERNS) {
    if (p.test(msg)) return { invoke: false, reason: "trivial greeting/factoid", score: 0 };
  }

  const wordCount = opts.wordCount ?? msg.split(/\s+/).length;
  const hasCodeBlock = opts.hasCodeBlock ?? /```[\s\S]*```/.test(msg);
  const questionMarks = (msg.match(/\?/g) || []).length;
  const hasMultipleQuestions = questionMarks >= 2;

  let score = 0;
  const matchedReasons: string[] = [];

  let techMatches = 0;
  for (const re of TECHNICAL_KEYWORDS) {
    if (re.test(msg)) techMatches++;
  }
  if (techMatches > 0) {
    score += Math.min(techMatches * 2, 6);
    matchedReasons.push(`${techMatches} technical pattern(s)`);
  }

  let strategicMatches = 0;
  for (const re of STRATEGIC_KEYWORDS) {
    if (re.test(msg)) strategicMatches++;
  }
  if (strategicMatches > 0) {
    score += strategicMatches * 1;
    matchedReasons.push(`${strategicMatches} strategic pattern(s)`);
  }

  if (hasCodeBlock) {
    score += 4;
    matchedReasons.push("code block");
  }
  if (hasMultipleQuestions) {
    score += 2;
    matchedReasons.push(`${questionMarks} questions`);
  }

  if (wordCount > 80) {
    score += 3;
    matchedReasons.push(`long message (${wordCount}w)`);
  } else if (wordCount > 40) {
    score += 1;
    matchedReasons.push(`medium message (${wordCount}w)`);
  }

  // Multi-clause technical compound questions
  const hasMultipleClauses = /\b(?:and|or|but|while|whereas)\b/i.test(msg);
  if (hasMultipleClauses && techMatches > 0) {
    score += 1;
    matchedReasons.push("multi-clause technical");
  }

  // Threshold tuned via R74.9 smoke tests — score=5 caught
  // legitimate compound technical/strategic queries that score=6 missed.
  const THRESHOLD = 5;
  const invoke = score >= THRESHOLD;
  return {
    invoke,
    reason: invoke
      ? `auto-ensemble (score=${score}: ${matchedReasons.join(", ")})`
      : `score=${score} below threshold ${THRESHOLD}`,
    score,
  };
}
