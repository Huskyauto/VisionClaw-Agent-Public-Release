/**
 * Skill-RAG — retrieval-quality judge + 4-skill router (R74.8)
 *
 * Adapted from "Skill-RAG: Diagnosing Retrieval Failure in RAG Systems"
 * (arxiv.org/abs/2604.15771, April 2026).
 *
 * The original paper uses a Hidden-State Prober that reads the residual stream
 * of an open-weight model to detect retrieval failure. We can't do that with
 * closed APIs (GPT-5.5, Claude 4.7, Gemini 3.1, DeepSeek V4), so we substitute
 * an LLM-as-judge: one cheap gpt-5-mini call asking "is this evidence sufficient?".
 *
 * The Skill Router is implemented faithfully — when the judge says "insufficient",
 * we pick one of 4 fix-skills:
 *   - rewrite: HyDE-style query reformulation
 *   - decompose: split into 2-3 sub-questions, retrieve for each
 *   - focus: narrow the query with constraints from existing context
 *   - exit: stop early; tell the chat layer to admit ignorance
 *
 * Hard time budget: 1500ms total (judge ~300ms + skill ~400ms + retrieval ~400ms).
 * Fails open (returns initial candidates unchanged) on any error.
 *
 * Gated by smart triggers — only fires when the existing retriever is weak,
 * to avoid adding judge latency to easy queries.
 */

import { getClientForModel } from "./providers";
import { vectorSearchKnowledge } from "./embeddings";

export type SkillRagSkill = "rewrite" | "decompose" | "focus" | "exit" | "none";

export interface SkillRagResult {
  candidates: any[];
  skillUsed: SkillRagSkill;
  judgeConfidence: number;
  judgeReason: string;
  rewrittenQuery?: string;
  subQuestions?: string[];
  exited: boolean;
  totalMs: number;
  invoked: boolean;
}

const TIME_BUDGET_MS = 2500;
// Note: started with gpt-5-mini for cost but it's a thinking model — eats the
// token budget before emitting JSON. Standardized to gpt-5.5 — Bob's canonical
// top-tier GPT (R125+52.1); routes via the OAuth lane.
const JUDGE_MODEL = "gpt-5.5";
const MIN_SUFFICIENT_CONFIDENCE = 0.6;

interface RagCandidate {
  id: number;
  title?: string;
  content?: string;
  category?: string;
  priority?: number;
  similarity?: number;
  source?: string;
  retrieval?: string;
}

/**
 * Decide whether Skill-RAG is worth invoking. Avoids adding judge latency
 * to every chat by only firing on weak retrievals or complex questions.
 */
export function shouldInvokeSkillRag(
  userMessage: string,
  candidates: RagCandidate[],
): { invoke: boolean; reason: string } {
  if (!userMessage || userMessage.trim().length < 5) {
    return { invoke: false, reason: "message too short" };
  }
  const wordCount = userMessage.trim().split(/\s+/).length;
  const topSim = candidates.length > 0 ? Math.max(...candidates.map((c) => c.similarity ?? 0)) : 0;
  const hasMultipleClauses = /\band\b|\bor\b|\?.+\?|;/i.test(userMessage);

  if (candidates.length === 0) {
    return { invoke: true, reason: "zero candidates retrieved" };
  }
  if (candidates.length < 3) {
    return { invoke: true, reason: `low recall (${candidates.length} candidates)` };
  }
  if (topSim < 0.5) {
    return { invoke: true, reason: `weak top match (sim=${topSim.toFixed(2)})` };
  }
  if (wordCount >= 12 && hasMultipleClauses) {
    return { invoke: true, reason: `complex multi-clause question (${wordCount}w)` };
  }
  return { invoke: false, reason: `retrieval looks healthy (top=${topSim.toFixed(2)}, n=${candidates.length})` };
}

/**
 * LLM-as-judge prober — replaces the paper's Hidden-State Prober for closed-API models.
 */
export async function judgeRetrieval(
  userMessage: string,
  candidates: RagCandidate[],
  tenantId: number,
): Promise<{
  sufficient: boolean;
  confidence: number;
  reason: string;
  suggestedSkill: SkillRagSkill;
}> {
  // R115.6 — re-sort by similarity desc before slicing. searchDocuments and
  // vectorSearchKnowledge now apply lost-in-the-middle reorder (positions 0
  // and N-1 are strongest), so programmatic top-K selection must restore
  // best→worst order. The numbered [1][2][3] format the judge sees is
  // assumed to be strongest→weakest, so the sort is required for correctness.
  const evidence = [...candidates]
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, 5)
    .map((c, i) => `[${i + 1}] ${c.title || "Untitled"}: ${(c.content || "").slice(0, 200)}`)
    .join("\n");

  const { client, actualModelId } = await getClientForModel(JUDGE_MODEL, tenantId);
  const prompt = `You are a retrieval-quality judge. Given a user question and retrieved evidence chunks, decide if the evidence directly addresses the question.

User question: ${userMessage}

Retrieved evidence (top ${Math.min(candidates.length, 5)} of ${candidates.length}):
${evidence || "(no evidence retrieved)"}

Reply ONLY with valid JSON matching this shape:
{"sufficient": boolean, "confidence": 0.0-1.0, "reason": "one short sentence", "suggested_skill": "rewrite"|"decompose"|"focus"|"exit"|"none"}

Decision rules:
- sufficient=true if evidence directly answers the question (set suggested_skill="none")
- suggested_skill="rewrite" if the answer probably is in the corpus but the words don't match (try synonyms / different phrasing)
- suggested_skill="decompose" if the question has multiple distinct parts that need separate lookups
- suggested_skill="focus" if the question is too broad and needs narrowing with a constraint
- suggested_skill="exit" if no plausible amount of retrieval would answer this from the corpus`;

  const resp: any = await client.chat.completions.create({
    model: actualModelId,
    max_completion_tokens: 800,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const txt = resp?.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(txt);
    const skill = (parsed.suggested_skill as SkillRagSkill) || "none";
    return {
      sufficient: !!parsed.sufficient,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      reason: String(parsed.reason || "").slice(0, 200),
      suggestedSkill: ["rewrite", "decompose", "focus", "exit", "none"].includes(skill) ? skill : "rewrite",
    };
  } catch {
    return {
      sufficient: candidates.length > 0,
      confidence: 0.5,
      reason: "judge parse error — failing open",
      suggestedSkill: "none",
    };
  }
}

/** Skill 1: HyDE-style query rewriting */
export async function rewriteQuery(userMessage: string, tenantId: number): Promise<string> {
  const { client, actualModelId } = await getClientForModel(JUDGE_MODEL, tenantId);
  const resp: any = await client.chat.completions.create({
    model: actualModelId,
    max_completion_tokens: 400,
    messages: [
      {
        role: "user",
        content: `Write a hypothetical 1-2 sentence answer to this question, as if it appeared in a knowledge base. Use synonyms and different phrasing than the question. Reply with just the hypothetical answer, no preamble.\n\nQuestion: ${userMessage}`,
      },
    ],
  });
  return resp?.choices?.[0]?.message?.content?.trim() || userMessage;
}

/** Skill 2: question decomposition for multi-hop retrieval */
export async function decomposeQuestion(userMessage: string, tenantId: number): Promise<string[]> {
  const { client, actualModelId } = await getClientForModel(JUDGE_MODEL, tenantId);
  const resp: any = await client.chat.completions.create({
    model: actualModelId,
    max_completion_tokens: 600,
    messages: [
      {
        role: "user",
        content: `Decompose this question into 2-3 simpler sub-questions whose answers together address it. Reply ONLY with JSON: {"sub_questions": ["q1", "q2", ...]}\n\nQuestion: ${userMessage}`,
      },
    ],
    response_format: { type: "json_object" },
  });
  try {
    const parsed = JSON.parse(resp?.choices?.[0]?.message?.content || "{}");
    const subs = Array.isArray(parsed.sub_questions)
      ? parsed.sub_questions.map((s: any) => String(s).trim()).filter((s: string) => s.length > 3)
      : [];
    return subs.slice(0, 3);
  } catch {
    return [];
  }
}

/** Skill 3: query focusing — narrow with constraints from existing context */
export async function focusQuery(
  userMessage: string,
  candidates: RagCandidate[],
  tenantId: number,
): Promise<string> {
  // R115.6 — re-sort by similarity desc before slicing (see judgeEvidence).
  const topics = [...candidates]
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, 3)
    .map((c) => c.title || c.category)
    .filter(Boolean)
    .join(", ");
  const { client, actualModelId } = await getClientForModel(JUDGE_MODEL, tenantId);
  const resp: any = await client.chat.completions.create({
    model: actualModelId,
    max_completion_tokens: 400,
    messages: [
      {
        role: "user",
        content: `Narrow this question by adding the most relevant constraint or topic anchor. Available topic context: ${topics || "(none)"}\n\nReply with just the narrowed question, no preamble.\n\nOriginal: ${userMessage}`,
      },
    ],
  });
  return resp?.choices?.[0]?.message?.content?.trim() || userMessage;
}

/** Merge new candidates into existing array, deduping by id */
function mergeUnique(existing: RagCandidate[], incoming: any[]): RagCandidate[] {
  const seen = new Set(existing.map((x) => x.id));
  const merged = [...existing];
  for (const item of incoming) {
    if (item && typeof item.id === "number" && !seen.has(item.id)) {
      merged.push({
        id: item.id,
        title: item.title,
        content: item.content,
        category: item.category,
        priority: item.priority,
        similarity: item.similarity,
        source: "skill-rag",
        retrieval: item.retrieval,
      });
      seen.add(item.id);
    }
  }
  return merged;
}

/**
 * Main entry — judge retrieval, invoke fix-skill if insufficient.
 * Returns enhanced candidate set + diagnostic info. Always fails open.
 */
export async function enhanceRetrieval(
  userMessage: string,
  initialCandidates: RagCandidate[],
  opts: { tenantId: number; persona?: string },
): Promise<SkillRagResult> {
  const t0 = Date.now();
  const baseResult: SkillRagResult = {
    candidates: initialCandidates,
    skillUsed: "none",
    judgeConfidence: 1,
    judgeReason: "",
    exited: false,
    totalMs: 0,
    invoked: false,
  };

  // R74.12 — accept both "true" and "1" so the kill switch works with either form.
  const flag = (process.env.SKILL_RAG_DISABLED || "").toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes" || flag === "on") {
    return { ...baseResult, totalMs: Date.now() - t0 };
  }

  // Smart gating — skip judge for healthy retrievals
  const gate = shouldInvokeSkillRag(userMessage, initialCandidates);
  if (!gate.invoke) {
    return { ...baseResult, judgeReason: gate.reason, totalMs: Date.now() - t0 };
  }
  console.log(`[skill-rag] invoking — ${gate.reason}`);

  try {
    const judged = await judgeRetrieval(userMessage, initialCandidates, opts.tenantId);

    if (judged.sufficient && judged.confidence >= MIN_SUFFICIENT_CONFIDENCE) {
      console.log(`[skill-rag] judge: sufficient (conf=${judged.confidence.toFixed(2)}, "${judged.reason}")`);
      return {
        ...baseResult,
        invoked: true,
        judgeConfidence: judged.confidence,
        judgeReason: judged.reason,
        totalMs: Date.now() - t0,
      };
    }

    const skill = judged.suggestedSkill === "none" ? "rewrite" : judged.suggestedSkill;
    console.log(
      `[skill-rag] judge: insufficient (conf=${judged.confidence.toFixed(2)}, "${judged.reason}") → skill=${skill}`,
    );

    if (skill === "exit") {
      return {
        ...baseResult,
        invoked: true,
        skillUsed: "exit",
        judgeConfidence: judged.confidence,
        judgeReason: judged.reason,
        exited: true,
        totalMs: Date.now() - t0,
      };
    }

    if (Date.now() - t0 > TIME_BUDGET_MS) {
      console.warn(`[skill-rag] time budget exceeded after judge — skipping skill execution`);
      return { ...baseResult, invoked: true, judgeConfidence: judged.confidence, judgeReason: judged.reason, totalMs: Date.now() - t0 };
    }

    let augmented = [...initialCandidates];
    let rewrittenQuery: string | undefined;
    let subQuestions: string[] | undefined;

    if (skill === "rewrite") {
      rewrittenQuery = await rewriteQuery(userMessage, opts.tenantId);
      console.log(`[skill-rag] rewrite → "${rewrittenQuery.slice(0, 100)}"`);
      const more = await vectorSearchKnowledge(rewrittenQuery, {
        tenantId: opts.tenantId,
        topK: 5,
        threshold: 0.25,
      });
      augmented = mergeUnique(augmented, more);
    } else if (skill === "decompose") {
      subQuestions = await decomposeQuestion(userMessage, opts.tenantId);
      console.log(`[skill-rag] decompose → ${subQuestions.length} sub-questions`);
      for (const sq of subQuestions) {
        if (Date.now() - t0 > TIME_BUDGET_MS) {
          console.warn(`[skill-rag] time budget hit during decompose loop`);
          break;
        }
        const more = await vectorSearchKnowledge(sq, { tenantId: opts.tenantId, topK: 3, threshold: 0.3 });
        augmented = mergeUnique(augmented, more);
      }
    } else if (skill === "focus") {
      rewrittenQuery = await focusQuery(userMessage, initialCandidates, opts.tenantId);
      console.log(`[skill-rag] focus → "${rewrittenQuery.slice(0, 100)}"`);
      const more = await vectorSearchKnowledge(rewrittenQuery, {
        tenantId: opts.tenantId,
        topK: 5,
        threshold: 0.3,
      });
      augmented = mergeUnique(augmented, more);
    }

    const novelCount = augmented.length - initialCandidates.length;
    console.log(`[skill-rag] skill=${skill} added ${novelCount} novel candidates (${Date.now() - t0}ms total)`);

    return {
      candidates: augmented,
      skillUsed: skill,
      judgeConfidence: judged.confidence,
      judgeReason: judged.reason,
      rewrittenQuery,
      subQuestions,
      exited: false,
      invoked: true,
      totalMs: Date.now() - t0,
    };
  } catch (e: any) {
    console.warn(`[skill-rag] error (failing open): ${e.message}`);
    return { ...baseResult, invoked: true, judgeReason: `error: ${e.message}`, totalMs: Date.now() - t0 };
  }
}
