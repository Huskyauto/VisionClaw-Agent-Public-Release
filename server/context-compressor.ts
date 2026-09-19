// ─────────────────────────────────────────────────────────────────────────────
// R89 — Context compressor (ported from Hermes Alpha context_compressor.py)
// ─────────────────────────────────────────────────────────────────────────────
// Algorithm: protect first N + last N turns, summarize the middle via the
// auxiliary cheap-model client. After compression, repair orphan tool_call /
// tool_result pairs so the API never sees mismatched IDs.
//
// More robust than raw truncation in context-window-guard.ts because:
//   1. Preserves a high-fidelity summary of dropped turns
//   2. Handles tool-call/tool-result orphan repair (the #1 cause of
//      "tool_use_id mismatch" errors after compaction)
//   3. Aligns boundaries so we never split a tool group
// ─────────────────────────────────────────────────────────────────────────────

import { callAuxiliary } from "./auxiliary-client";

const CHARS_PER_TOKEN = 3.5;

export interface CompressOpts {
  protectFirstN?: number;
  protectLastN?: number;
  summaryTargetTokens?: number;
  summaryModel?: string;
  tenantId?: number;
  quiet?: boolean;
}

export interface ChatMessage {
  role: string;
  content: any;
  tool_calls?: any[];
  tool_call_id?: string;
  [k: string]: any;
}

function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / CHARS_PER_TOKEN);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += 4;
    if (typeof m.content === "string") total += estimateTokens(m.content);
    else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p?.type === "text") total += estimateTokens(p.text || "");
        else if (p?.type === "image_url") total += 765;
      }
    }
    total += estimateTokens(m.role);
  }
  return total;
}

function getToolCallId(tc: any): string {
  if (tc && typeof tc === "object") return tc.id || "";
  return "";
}

function alignBoundaryForward(messages: ChatMessage[], idx: number): number {
  while (idx < messages.length && messages[idx]?.role === "tool") idx++;
  return idx;
}

function alignBoundaryBackward(messages: ChatMessage[], idx: number): number {
  if (idx <= 0 || idx >= messages.length) return idx;
  const prev = messages[idx - 1];
  if (prev?.role === "assistant" && Array.isArray(prev.tool_calls) && prev.tool_calls.length > 0) {
    return idx - 1;
  }
  return idx;
}

function sanitizeToolPairs(messages: ChatMessage[], quiet = false): ChatMessage[] {
  const survivingCallIds = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const id = getToolCallId(tc);
        if (id) survivingCallIds.add(id);
      }
    }
  }

  const resultIds = new Set<string>();
  for (const m of messages) {
    if (m.role === "tool" && m.tool_call_id) resultIds.add(m.tool_call_id);
  }

  const orphanedResults = new Set([...resultIds].filter((x) => !survivingCallIds.has(x)));
  let cleaned = messages;
  if (orphanedResults.size > 0) {
    cleaned = cleaned.filter(
      (m) => !(m.role === "tool" && m.tool_call_id && orphanedResults.has(m.tool_call_id)),
    );
    if (!quiet) console.log(`[compress] removed ${orphanedResults.size} orphan tool result(s)`);
  }

  const missingResults = new Set([...survivingCallIds].filter((x) => !resultIds.has(x)));
  if (missingResults.size > 0) {
    const patched: ChatMessage[] = [];
    for (const m of cleaned) {
      patched.push(m);
      if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const id = getToolCallId(tc);
          if (id && missingResults.has(id)) {
            patched.push({
              role: "tool",
              content: "[Result from earlier conversation — see context summary above]",
              tool_call_id: id,
            });
          }
        }
      }
    }
    cleaned = patched;
    if (!quiet) console.log(`[compress] inserted ${missingResults.size} stub tool result(s)`);
  }

  return cleaned;
}

async function generateSummary(
  turns: ChatMessage[],
  targetTokens: number,
  summaryModel: string | undefined,
  tenantId: number | undefined,
): Promise<string | null> {
  const parts: string[] = [];
  for (const m of turns) {
    const role = (m.role || "unknown").toUpperCase();
    let content = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
    if (content.length > 2000) {
      content = content.slice(0, 1000) + "\n...[truncated]...\n" + content.slice(-500);
    }
    if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const names = m.tool_calls
        .map((tc: any) => tc?.function?.name || "?")
        .join(", ");
      content += `\n[Tool calls: ${names}]`;
    }
    parts.push(`[${role}]: ${content}`);
  }

  const prompt = `Summarize these conversation turns concisely. This summary will replace these turns in the conversation history.

Write from a neutral perspective describing:
1. What actions were taken (tool calls, searches, file operations)
2. Key information or results obtained
3. Important decisions or findings
4. Relevant data, file names, or outputs

Keep factual and informative. Target ~${targetTokens} tokens.

---
TURNS TO SUMMARIZE:
${parts.join("\n\n")}
---

Write only the summary, starting with "[CONTEXT SUMMARY]:" prefix.`;

  try {
    const result = await callAuxiliary({
      task: "compression",
      messages: [{ role: "user", content: prompt }],
      model: summaryModel,
      temperature: 0.3,
      maxTokens: targetTokens * 2,
      timeoutMs: 30_000,
      tenantId,
    });
    let summary = result.content.trim();
    if (!summary.startsWith("[CONTEXT SUMMARY]:")) summary = "[CONTEXT SUMMARY]: " + summary;
    return summary;
  } catch (e: any) {
    console.warn(`[compress] summary generation failed: ${e?.message?.slice(0, 120)}`);
    return null;
  }
}

export async function compressMessages(
  messages: ChatMessage[],
  opts: CompressOpts = {},
): Promise<{ messages: ChatMessage[]; summarized: boolean; turnsSummarized: number }> {
  const protectFirstN = opts.protectFirstN ?? 3;
  const protectLastN = opts.protectLastN ?? 4;
  const summaryTargetTokens = opts.summaryTargetTokens ?? 2500;
  const quiet = opts.quiet ?? false;

  const n = messages.length;
  if (n <= protectFirstN + protectLastN + 1) {
    return { messages, summarized: false, turnsSummarized: 0 };
  }

  let compressStart = protectFirstN;
  let compressEnd = n - protectLastN;
  compressStart = alignBoundaryForward(messages, compressStart);
  compressEnd = alignBoundaryBackward(messages, compressEnd);
  if (compressStart >= compressEnd) {
    return { messages, summarized: false, turnsSummarized: 0 };
  }

  const turnsToSummarize = messages.slice(compressStart, compressEnd);
  const summary = await generateSummary(
    turnsToSummarize,
    summaryTargetTokens,
    opts.summaryModel,
    opts.tenantId,
  );

  const compressed: ChatMessage[] = [];
  for (let i = 0; i < compressStart; i++) compressed.push({ ...messages[i] });

  if (summary) {
    const lastHeadRole = compressStart > 0 ? messages[compressStart - 1].role : "user";
    const summaryRole = ["assistant", "tool"].includes(lastHeadRole) ? "user" : "assistant";
    compressed.push({ role: summaryRole, content: summary });
  } else if (!quiet) {
    console.warn("[compress] no summary available — middle turns dropped without summary");
  }

  for (let i = compressEnd; i < n; i++) compressed.push({ ...messages[i] });

  const finalMessages = sanitizeToolPairs(compressed, quiet);

  if (!quiet) {
    const before = estimateMessagesTokens(messages);
    const after = estimateMessagesTokens(finalMessages);
    console.log(
      `[compress] ${n} → ${finalMessages.length} messages, ~${before.toLocaleString()} → ~${after.toLocaleString()} tokens (saved ~${(before - after).toLocaleString()})`,
    );
  }

  return {
    messages: finalMessages,
    summarized: !!summary,
    turnsSummarized: turnsToSummarize.length,
  };
}
