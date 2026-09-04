// ─────────────────────────────────────────────────────────────────────────────
// Honest reply classification taxonomy (CPT 5.6 external review, priority 2b).
//
// Replaces the binary "anything not clearly negative = positive" classifier
// for mission experiment replies with a rich taxonomy so out-of-office
// autoresponders, bounces, "wrong person" and empty messages can never inflate
// demand evidence or falsely satisfy the proof-of-premise gate.
//
// Layers:
//  1. preClassifyReply — deterministic pattern rules for the obvious cases
//     (bounce headers/senders, OOO markers, unsubscribe phrases, wrong-person,
//     no-reply automation). Pure, query-free-testable, $0.
//  2. classifyReplyRich — deterministic first, then a cheap-model one-shot
//     JSON classification for the remainder. ANY failure (model error,
//     unparseable output, unknown label) fails CLOSED to "ambiguous" — never
//     to a demand category.
//  3. Pure mappers consumed by the intake path:
//     - isDemandCategory: ONLY explicit interest categories count as demand;
//     - evidenceTypeForCategory: taxonomy → mission_evidence.type. Demand
//       categories map to positive_reply (bumps the demand rollup); explicit
//       rejections map to negative_reply; everything non-demand-non-rejection
//       (ooo, bounce, automated, wrong_person, not_now, referral, ambiguous)
//       maps to "other" — recorded for dedupe/audit but NEVER counted by
//       DEMAND_EVIDENCE_TYPES, positive_replies, or the proof-of-premise gate;
//     - pauseActionForCategory: taxonomy → enrollment transition. OOO/automated
//       are not human replies — the sequence continues; bounces and explicit
//       rejections stop it; human engagement pauses it for owner follow-up.
//
// Ambiguous handling: the caller records the evidence as "other" (dedupe) and
// routes the reply to the owner review queue instead of auto-counting.
// ─────────────────────────────────────────────────────────────────────────────

export const REPLY_CATEGORIES = [
  "interested",
  "meeting_request",
  "pricing_question",
  "referral",
  "not_now",
  "not_interested",
  "unsubscribe",
  "wrong_person",
  "out_of_office",
  "bounce",
  "automated",
  "ambiguous",
] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];

/** ONLY these reply categories count as demand for proof-of-premise. */
export const DEMAND_REPLY_CATEGORIES: readonly ReplyCategory[] = [
  "interested",
  "meeting_request",
  "pricing_question",
] as const;

export function isDemandCategory(cat: ReplyCategory): boolean {
  return (DEMAND_REPLY_CATEGORIES as readonly string[]).includes(cat);
}

/**
 * mission_evidence.type for a category. Demand → positive_reply (rollup bump);
 * explicit rejection → negative_reply; everything else → "other" (recorded
 * for dedupe + audit, never counted as demand anywhere).
 */
export function evidenceTypeForCategory(cat: ReplyCategory): "positive_reply" | "negative_reply" | "other" {
  if (isDemandCategory(cat)) return "positive_reply";
  if (cat === "not_interested" || cat === "unsubscribe") return "negative_reply";
  return "other";
}

/**
 * Enrollment transition for a category:
 *  - "stop": permanent — explicit rejection, dead address, wrong person;
 *  - "pause": a human engaged (incl. not_now / referral / ambiguous —
 *    ambiguous pauses pending owner review: fail toward NOT contacting a
 *    human who replied, never toward counting demand);
 *  - "none": not a human reply (ooo/automated) — the sequence continues.
 */
export function pauseActionForCategory(cat: ReplyCategory): "stop" | "pause" | "none" {
  switch (cat) {
    case "not_interested":
    case "unsubscribe":
    case "wrong_person":
    case "bounce":
      return "stop";
    case "out_of_office":
    case "automated":
      return "none";
    default:
      return "pause";
  }
}

// ── Layer 1: deterministic pre-classifier ───────────────────────────────────

const BOUNCE_SENDERS = /mailer-daemon|postmaster@|mail delivery (?:subsystem|system)|maildelivery/i;
const BOUNCE_TEXT = /delivery (?:status notification|has failed|incomplete)|undeliver(?:able|ed)|address(?: was)? not found|user unknown|mailbox (?:unavailable|not found|full)|550[- ]5\.\d|recipient .{0,20}rejected|returned to sender/i;
const OOO_TEXT = /out of (?:the )?office|auto-?reply|automatic reply|autoresponder|on (?:vacation|holiday|annual leave)|parental leave|maternity leave|paternity leave|currently (?:away|traveling)|away from (?:my )?email|limited access to (?:my )?email|will (?:respond|reply) (?:when i return|upon my return)|back (?:in the office )?on \w+/i;
const UNSUB_TEXT = /unsubscribe|remove me|opt[ -]?out|stop (?:emailing|contacting|sending)|don'?t contact|do not contact|take me off|leave me alone/i;
const NOT_INTERESTED_TEXT = /not interested|no thanks|no thank you|not a fit|we(?:'| a)re (?:all )?set|not looking for/i;
const WRONG_PERSON_TEXT = /wrong person|not the right (?:person|contact)|no longer (?:with|at|works?)|doesn'?t work here|has left the (?:company|organization)|i'?m not the (?:person|one)|not my (?:department|area)/i;
const AUTOMATED_SENDER = /no-?reply@|donotreply@|notifications?@|bounce[sd]?@/i;
const AUTOMATED_TEXT = /this is an automated (?:message|response|email)|do not reply to this (?:email|message)|automated notification/i;

/**
 * Deterministic first pass. Returns a category when a pattern rule fires,
 * null when the message needs model classification. Empty messages are
 * "ambiguous" — an empty body must never reach a demand default.
 */
export function preClassifyReply(args: { from: string; subject?: string; snippet: string }): ReplyCategory | null {
  const from = String(args.from || "");
  const text = `${args.subject || ""} ${args.snippet || ""}`.trim();
  // Sender-identity rules first: a bounce/no-reply sender is machine mail
  // regardless of body content (bounces often arrive with empty snippets and
  // must classify as bounce, not ambiguous-for-review).
  if (BOUNCE_SENDERS.test(from)) return "bounce";
  if (AUTOMATED_SENDER.test(from)) return "automated";
  // Empty BODY is unconditionally ambiguous — never demand — even when a
  // subject line exists (a subject-only reply carries the quoted/token
  // subject and zero human content; letting it reach the model could yield
  // "interested" from nothing). Architect finding, this task's core objective.
  if (!String(args.snippet || "").trim()) return "ambiguous";
  if (BOUNCE_TEXT.test(text)) return "bounce";
  if (OOO_TEXT.test(text)) return "out_of_office";
  if (AUTOMATED_TEXT.test(text)) return "automated";
  if (UNSUB_TEXT.test(text)) return "unsubscribe";
  if (WRONG_PERSON_TEXT.test(text)) return "wrong_person";
  if (NOT_INTERESTED_TEXT.test(text)) return "not_interested";
  return null;
}

// ── Layer 2: model classification (fail-closed to ambiguous) ────────────────

/**
 * Parse a model response into a category. Fail CLOSED: anything that isn't an
 * unambiguous single known label (json or bare) returns "ambiguous" — a
 * classification failure must never read as demand. Pure, exported for tests.
 */
export function parseCategoryFromModelText(text: unknown): ReplyCategory {
  if (typeof text !== "string" || !text.trim()) return "ambiguous";
  let candidate = "";
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      candidate = typeof parsed?.category === "string" ? parsed.category : "";
    } catch {
      return "ambiguous";
    }
  } else {
    candidate = text.trim().toLowerCase().replace(/^["']|["'.]+$/g, "");
  }
  candidate = candidate.trim().toLowerCase();
  return (REPLY_CATEGORIES as readonly string[]).includes(candidate)
    ? (candidate as ReplyCategory)
    : "ambiguous";
}

/**
 * Full classification: deterministic pre-pass, then a cheap-model one-shot for
 * the remainder. Every failure path lands on "ambiguous" (fail closed).
 */
export async function classifyReplyRich(args: {
  from: string;
  subject?: string;
  snippet: string;
  tenantId?: number;
}): Promise<{ category: ReplyCategory; via: "rules" | "model" | "failure" }> {
  const pre = preClassifyReply(args);
  if (pre) return { category: pre, via: "rules" };
  try {
    const { getClientForModel } = await import("../providers");
    const { client, actualModelId } = await getClientForModel("gpt-5-mini", args.tenantId);
    const resp = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        {
          role: "system",
          content:
            `Classify a reply to a cold outreach email. Respond with ONLY JSON: {"category":"<one of: ${REPLY_CATEGORIES.join(", ")}>"}. ` +
            `"interested" = explicit interest in the offer; "meeting_request" = asks for a call/meeting/demo; "pricing_question" = asks about price/cost; ` +
            `"referral" = points to a different, better-suited person; "not_now" = polite deferral ("maybe next quarter"); "not_interested" = explicit rejection; ` +
            `"unsubscribe" = demands contact stop; "wrong_person" = says they are the wrong recipient; "out_of_office" = autoresponder; "bounce" = delivery failure; ` +
            `"automated" = other machine-generated mail; "ambiguous" = anything unclear. When in doubt use "ambiguous" — NEVER guess an interest category.`,
        },
        { role: "user", content: `From: ${args.from}\nSubject: ${args.subject || ""}\n\n${String(args.snippet || "").slice(0, 1500)}` },
      ],
      max_completion_tokens: 300,
    });
    const category = parseCategoryFromModelText(resp.choices?.[0]?.message?.content ?? "");
    return { category, via: "model" };
  } catch (e: any) {
    console.warn(`[reply-classification] model classification failed — ambiguous (fail closed): ${e?.message ?? e}`);
    return { category: "ambiguous", via: "failure" };
  }
}
