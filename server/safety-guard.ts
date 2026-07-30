// =============================================================================
// SAFETY GUARD — pre-screen user input for self-harm / medical-emergency /
// medication-misuse signals before sending to the LLM. Llama-Guard-style
// classifier with a regex tier-1 for instant, zero-cost catches.
// =============================================================================
// Two tiers:
//   1) Regex heuristics — fast, deterministic, runs on EVERY message.
//   2) Llama Guard via OpenRouter — only on health/wellness personas (Robert) when
//      tier 1 didn't already flag, behind a 2.5s timeout. Falls back to "allow"
//      on any classifier failure (regex already gave us a reasonable floor).
//
// Output drives a short-circuit in chat-engine: if action === "block", we skip
// the LLM and persist a crisis-routed assistant message instead.

export type SafetyCategory =
  | "self_harm"
  | "medical_emergency"
  | "medication_misuse"
  | "safe";

export interface SafetyResult {
  safe: boolean;
  category: SafetyCategory;
  action: "allow" | "block";
  message: string; // crisis copy when blocked; empty when allowed
  source: "regex" | "llama_guard" | "regex+llama_guard";
}

export interface SafetyContext {
  personaName?: string;
  personaCategory?: string; // e.g. "wellness", "health"
  conversationId?: number;
}

// -----------------------------------------------------------------------------
// Tier 1: regex heuristics. High precision; tuned to wellness / wellness harm
// surface, but the self-harm bucket is universal.
// -----------------------------------------------------------------------------
const PATTERNS: Array<{ category: SafetyCategory; rx: RegExp }> = [
  // self_harm
  { category: "self_harm", rx: /\b(kill|harm|hurt)\s+(my)?self\b/i },
  { category: "self_harm", rx: /\bsuicid(e|al)\b/i },
  { category: "self_harm", rx: /\b(want|going|plan)\s+to\s+die\b/i },
  { category: "self_harm", rx: /\bend\s+(my|it\s+all|my\s+life)\b/i },
  { category: "self_harm", rx: /\bno\s+(reason|point)\s+to\s+(live|go\s+on)\b/i },

  // medical_emergency — symptoms that demand 911/ER, not a chatbot
  { category: "medical_emergency", rx: /\b(chest\s+pain|crushing\s+pain\s+in\s+(my\s+)?chest)\b/i },
  { category: "medical_emergency", rx: /\b(can't|cannot|trouble)\s+breath(e|ing)\b/i },
  { category: "medical_emergency", rx: /\b(passed\s+out|fainted|unconscious)\b/i },
  { category: "medical_emergency", rx: /\b(severe|uncontrolled|won't\s+stop)\s+(vomit|bleeding|diarrhea)/i },
  { category: "medical_emergency", rx: /\b(stroke|heart\s+attack)\b/i },
  { category: "medical_emergency", rx: /\bhaven'?t\s+(eaten|kept\s+(food|anything)\s+down)\s+(in|for)\s+(\d+|several|many)\s*days?\b/i },
  { category: "medical_emergency", rx: /\b(blood\s+sugar|glucose)\s+(under|below)\s+(50|55|60)\b/i },
  { category: "medical_emergency", rx: /\bsuspected\s+pancreatitis\b/i },

  // medication_misuse — wellness specific
  { category: "medication_misuse", rx: /\b(double|triple|extra|two|2x|3x)\s+(dose|injection|shot)\b/i },
  { category: "medication_misuse", rx: /\btake\s+(more|extra)\s+(semaglutide|tirzepatide|ozempic|wegovy|wellness-program|zepbound)/i },
  { category: "medication_misuse", rx: /\b(skip|stop)\s+(my\s+)?(insulin|metformin|blood\s+pressure|heart)\s+(med|medication|pills?)/i },
  { category: "medication_misuse", rx: /\b(inject|use)\s+(someone\s+else'?s|expired|old)\s+(pen|semaglutide|ozempic|wegovy)/i },
  { category: "medication_misuse", rx: /\bmissed\s+(\d+|a\s+few|several|many|multiple|two|three|four|five|six|seven|eight|nine|ten)\s+doses?\b[\s\S]{0,60}\b(catch|caught|catching|make)\s+(up|them up)\b/i },
];

// -----------------------------------------------------------------------------
// Crisis copy. Empathetic, short, action-oriented. Never moralize, never
// pretend to be a clinician. Always route to human help.
// -----------------------------------------------------------------------------
const CRISIS_COPY: Record<Exclude<SafetyCategory, "safe">, string> = {
  self_harm:
    "I'm really glad you reached out. What you're describing sounds heavy, and I want you to talk to a person — not me — right now.\n\n" +
    "**Please contact one of these immediately:**\n" +
    "• **988** — Suicide & Crisis Lifeline (US, call or text)\n" +
    "• **741741** — Crisis Text Line (text HOME)\n" +
    "• **911** or your local emergency number if you're in immediate danger\n\n" +
    "Outside the US: https://findahelpline.com\n\n" +
    "I'm not the right tool for this moment, but a trained human is, and they're available 24/7.",
  medical_emergency:
    "What you're describing could be a medical emergency. I'm not able to help safely with this — please get a human clinician on the line right now.\n\n" +
    "**Please do one of these now:**\n" +
    "• **Call 911** (or your local emergency number) if symptoms are severe\n" +
    "• **Call your prescribing doctor** or the after-hours line on your prescription\n" +
    "• **Go to the nearest ER or urgent care**\n" +
    "• **Poison Control (US): 1-800-222-1222** if a medication is involved\n\n" +
    "Once you're safe and have spoken with a clinician, I'm happy to help you make sense of next steps.",
  medication_misuse:
    "I can't help with that — adjusting wellness doses, doubling up after a missed shot, or using someone else's pen carries real medical risk and needs your prescriber's input, not mine.\n\n" +
    "**Please do this first:**\n" +
    "• **Call your prescribing doctor or pharmacist** before the next dose\n" +
    "• If you've already taken extra and feel unwell (severe nausea, vomiting, dizziness, low blood sugar), call **Poison Control: 1-800-222-1222** or **911**\n\n" +
    "When you've got guidance from your prescriber, I'll help you build the routine around it.",
};

function regexScreen(text: string): SafetyResult {
  for (const { category, rx } of PATTERNS) {
    if (rx.test(text)) {
      return {
        safe: false,
        category,
        action: "block",
        message: CRISIS_COPY[category as keyof typeof CRISIS_COPY],
        source: "regex",
      };
    }
  }
  return { safe: true, category: "safe", action: "allow", message: "", source: "regex" };
}

// -----------------------------------------------------------------------------
// Tier 2: Llama Guard via OpenRouter. Only invoked for health/wellness personas
// when regex didn't fire. Hard 2.5s timeout; failure = allow.
// -----------------------------------------------------------------------------
const GUARD_MODEL = process.env.SAFETY_GUARD_MODEL || "meta-llama/llama-guard-4-12b";
const GUARD_TIMEOUT_MS = 2500;

const GUARD_SYSTEM = `You are a safety classifier for a chatbot that talks to users about wellness wellness medications.

Classify the user's last message into EXACTLY ONE category:
- self_harm — explicit suicidal ideation, self-injury intent
- medical_emergency — symptoms requiring 911/ER (severe chest pain, can't breathe, fainted, dehydration days, severe hypoglycemia, suspected pancreatitis)
- medication_misuse — request to alter wellness dosing without prescriber, double-dose, use someone else's pen, skip critical comorbid meds
- safe — anything else (questions, frustrations, side-effect chat, food talk, routine support)

Respond with ONLY a single JSON object: {"category":"...","confidence":0.0-1.0}. No prose.`;

async function llamaGuardScreen(text: string): Promise<SafetyResult | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GUARD_TIMEOUT_MS);
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": "https://visionclaw.app",
        "X-Title": "VisionClaw Safety Guard",
      },
      body: JSON.stringify({
        model: GUARD_MODEL,
        max_tokens: 40,
        temperature: 0,
        messages: [
          { role: "system", content: GUARD_SYSTEM },
          { role: "user", content: text.slice(0, 2000) },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const cat = String(parsed.category || "safe").toLowerCase() as SafetyCategory;
    const conf = Number(parsed.confidence ?? 0);
    if (cat === "safe" || !(cat in CRISIS_COPY)) {
      return { safe: true, category: "safe", action: "allow", message: "", source: "llama_guard" };
    }
    // Require confidence ≥ 0.6 to actually block from LLM tier — avoids
    // overzealous false positives on routine wellness chat.
    if (conf < 0.6) {
      return { safe: true, category: "safe", action: "allow", message: "", source: "llama_guard" };
    }
    return {
      safe: false,
      category: cat,
      action: "block",
      message: CRISIS_COPY[cat as Exclude<SafetyCategory, "safe">],
      source: "llama_guard",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// PUBLIC ENTRY
// -----------------------------------------------------------------------------
const HEALTH_PERSONA_HINTS = ["robert", "glp", "weight", "health", "medical", "wellness"];

function isHealthPersona(ctx?: SafetyContext): boolean {
  if (!ctx) return false;
  const blob = `${ctx.personaName || ""} ${ctx.personaCategory || ""}`.toLowerCase();
  return HEALTH_PERSONA_HINTS.some((h) => blob.includes(h));
}

export async function screenUserInput(
  text: string,
  ctx?: SafetyContext
): Promise<SafetyResult> {
  if (!text || text.trim().length < 3) {
    return { safe: true, category: "safe", action: "allow", message: "", source: "regex" };
  }

  const tier1 = regexScreen(text);
  if (!tier1.safe) {
    console.warn(
      `[safety-guard] BLOCK (regex/${tier1.category}) conv=${ctx?.conversationId ?? "?"} persona="${ctx?.personaName ?? "?"}"`
    );
    return tier1;
  }

  // Only spend the LLM round-trip on health/wellness personas.
  if (!isHealthPersona(ctx)) return tier1;

  const tier2 = await llamaGuardScreen(text);
  if (!tier2) return tier1;
  if (!tier2.safe) {
    console.warn(
      `[safety-guard] BLOCK (llama-guard/${tier2.category}) conv=${ctx?.conversationId ?? "?"} persona="${ctx?.personaName ?? "?"}"`
    );
    return { ...tier2, source: "regex+llama_guard" };
  }
  return tier2;
}

// Test-only export so unit tests / CLI smoke can hit the regex tier without
// touching the network.
export const __test__ = { regexScreen, CRISIS_COPY, PATTERNS };
