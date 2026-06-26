import { replitOpenai } from "./providers";
import fs from "fs";
import path from "path";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { filterRealConversation, classifyIntent, getCompactionInstructionsForIntent, taskStateStore, buildIdentifierPreservationBlock } from "./felix-brain";

import { logSilentCatch } from "./lib/silent-catch";
import { getContextWindow } from "./context-window-guard";
const COMPACTION_RATIO = 0.4;
const MIN_MESSAGES_BEFORE_COMPACT = 20;
const TARGET_AFTER_COMPACT = 12;
const SUMMARY_MAX_TOKENS = 2000;
const MAX_QUALITY_RETRIES = 1;

const ARCHIVE_DIR = path.resolve(process.cwd(), "compaction-archives");

const REQUIRED_SECTIONS = [
  "## Decisions",
  "## Open TODOs",
  "## Constraints/Rules",
  "## Pending user asks",
  "## Exact identifiers",
] as const;

const STRUCTURED_COMPACTION_PROMPT = `You are a conversation compaction engine for VisionClaw, an agentic AI corporation. Summarize the older portion of a conversation into a structured, complete context summary. ZERO information loss is the goal.

You MUST produce a summary with these EXACT section headings in this order:

## Decisions
All decisions made during the conversation with rationale. Include what was chosen and why.

## Open TODOs
Active tasks, their current status (in-progress, blocked, pending), and batch operation progress (e.g., "5/17 items completed"). Include what was being done when the conversation was compacted.

## Constraints/Rules
User preferences, corrections, instructions about how they want things done. Business rules or constraints mentioned. Any "never do X" or "always do Y" directives.

## Pending user asks
The last thing the user requested and what was being done about it. Any unanswered questions or undelivered commitments.

## Exact identifiers
Preserve ALL opaque identifiers exactly as written — no shortening, no reconstruction. Include:
- Google Drive IDs, Slide deck IDs, document URLs
- Email addresses, phone numbers
- File paths, API keys (redacted), UUIDs
- Project IDs, conversation IDs, persona IDs
- Any other literal values the agent needs to reference

ADDITIONAL RULES:
- Names, numbers, dates, and specific data points mentioned by the user go in the appropriate section above
- Error messages and their resolutions go in Decisions
- DO NOT preserve old Google Drive links from completed deliveries — those are stale
- DO NOT preserve verbose tool call JSON — summarize outcomes instead
- Condense repetitive exchanges (e.g., "user asked X, agent clarified, user confirmed" → "user confirmed X")
- PRIORITIZE completeness over brevity — longer is better than losing information
- Write the summary in the same language the conversation used
- Output the structured summary directly — no preamble`;

export interface CompactionResult {
  compacted: boolean;
  summary?: string;
  removedCount?: number;
  keptCount?: number;
  archivePath?: string;
  qualityAudit?: CompactionQualityAudit;
}

export interface CompactionQualityAudit {
  ok: boolean;
  reasons: string[];
  retryCount: number;
  identifiersFound: number;
  identifiersPreserved: number;
  sectionsPresent: string[];
  sectionsMissing: string[];
}

// ─── Overflow Detection (Round 18, OpenClaw-inspired) ────────────────
// Provider-specific signatures for "context too long" / "request too large" errors.
// When matched after a normal model call fails, the caller should emergency-truncate
// tool results and retry once before bubbling the error to the user.
const OVERFLOW_SIGNATURES: RegExp[] = [
  /context.{0,15}length.{0,15}exceed/i,
  /maximum.{0,15}context.{0,15}length/i,
  /request_too_large/i,
  /prompt is too long/i,
  /reduce.{0,15}length/i,
  /string too long/i,
  /input too long/i,
  /token.{0,5}limit/i,
  /maximum number of tokens/i,
  /\bcontext_length_exceeded\b/i,
  /content too large/i,
];

export function isOverflowError(err: any): boolean {
  if (!err) return false;
  if (err.status === 413) return true;
  if (err?.code === "context_length_exceeded") return true;
  if (err?.error?.code === "context_length_exceeded") return true;
  const msg = String(err?.message || err?.error?.message || err?.body || "");
  if (!msg) return false;
  return OVERFLOW_SIGNATURES.some(rx => rx.test(msg));
}

export function emergencyTruncateMessages<T extends { role: string; content: any }>(messages: T[], maxCharsPerResult: number = 800): T[] {
  return messages.map(m => {
    if (m.role !== "tool" && m.role !== "assistant") return m;
    const content = typeof m.content === "string" ? m.content : (m.content == null ? "" : JSON.stringify(m.content));
    if (content.length <= maxCharsPerResult) return m;
    return { ...m, content: content.slice(0, maxCharsPerResult) + `\n…[truncated ${content.length - maxCharsPerResult} chars to recover from context overflow]` };
  });
}

export function shouldCompact(messageCount: number): boolean {
  return messageCount > MIN_MESSAGES_BEFORE_COMPACT;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function shouldPreemptivelyCompact(messages: { role: string; content: string }[], contextBudgetOrModelId: number | string = 120000): {
  shouldCompact: boolean;
  estimatedTokens: number;
  route: "fits" | "compact_only" | "truncate_tool_results" | "compact_and_truncate";
} {
  let totalChars = 0;
  let toolResultChars = 0;
  for (const m of messages) {
    const text = extractText(m.content);
    totalChars += text.length;
    if (m.role === "tool" || (m.role === "assistant" && text.includes('"tool_call_id"'))) {
      toolResultChars += text.length;
    }
  }
  const estimatedTokens = estimateTokens(totalChars.toString().length > 1 ? String(totalChars) : "0");
  const actualEstimate = Math.ceil(totalChars / 3.5);
  // R119: model-aware context budget. If a modelId string is passed, derive the soft
  // "compact" trigger directly from getContextWindow() so 1M-token models (Gemini 3.5,
  // GPT-5.4/5.5, Claude 4.7, DeepSeek V4, Grok 4.20) get the full headroom instead of
  // the legacy 120K default.
  //
  // NOTE: the modelId path returns the FINAL trigger budget directly (no extra *0.75)
  // — earlier R119 draft double-scaled and was actually stricter than the legacy
  // numeric default. Legacy number path keeps the historical *0.75 for backwards-compat.
  let budget: number;
  if (typeof contextBudgetOrModelId === "string") {
    const win = getContextWindow(contextBudgetOrModelId);
    // Reserve 64K for output + tool-call rounds; use 75% of the remaining headroom as
    // the soft-compact trigger. For a 1M window: ~702K. For 200K: ~102K. For 128K: 64K floor.
    budget = Math.max(64_000, Math.floor((win - 64_000) * 0.75));
  } else {
    budget = contextBudgetOrModelId * 0.75;
  }

  if (actualEstimate < budget) {
    return { shouldCompact: false, estimatedTokens: actualEstimate, route: "fits" };
  }

  const toolResultTokens = Math.ceil(toolResultChars / 3.5);
  const overflowTokens = actualEstimate - budget;

  if (toolResultTokens > overflowTokens * 1.5) {
    return { shouldCompact: false, estimatedTokens: actualEstimate, route: "truncate_tool_results" };
  }

  if (toolResultTokens > overflowTokens * 0.5) {
    return { shouldCompact: true, estimatedTokens: actualEstimate, route: "compact_and_truncate" };
  }

  return { shouldCompact: true, estimatedTokens: actualEstimate, route: "compact_only" };
}

export function truncateToolResults(messages: { role: string; content: string }[], maxCharsPerResult: number = 8000): { role: string; content: string }[] {
  return messages.map(m => {
    if (m.role !== "tool") return m;
    const text = extractText(m.content);
    if (text.length <= maxCharsPerResult) return m;
    return { ...m, content: text.slice(0, maxCharsPerResult) + "\n[...tool output truncated for context budget]" };
  });
}

export function splitForCompaction(messages: { role: string; content: string }[]): {
  toSummarize: { role: string; content: string }[];
  toKeep: { role: string; content: string }[];
} {
  if (messages.length <= MIN_MESSAGES_BEFORE_COMPACT) {
    return { toSummarize: [], toKeep: messages };
  }

  const keepCount = TARGET_AFTER_COMPACT;
  let splitIdx = messages.length - keepCount;

  if (splitIdx > 0 && splitIdx < messages.length) {
    const msgAtSplit = messages[splitIdx];
    if (msgAtSplit?.role === "tool") {
      for (let i = splitIdx - 1; i >= Math.max(0, splitIdx - 5); i--) {
        if (messages[i]?.role === "assistant") {
          splitIdx = i;
          break;
        }
      }
    }
  }

  return {
    toSummarize: messages.slice(0, splitIdx),
    toKeep: messages.slice(splitIdx),
  };
}

function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text || "";
        if (part?.type === "image_url") return "[image]";
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return String(content || "");
}

const IDENTIFIER_PATTERNS = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  /https?:\/\/[^\s<>"')\]]+/gi,
  /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g,
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  /(?:^|\s)(\/[a-zA-Z0-9_\-./]+\.[a-zA-Z]{1,6})/gm,
  /\b[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:conv|project|persona|tenant)[\s_-]?(?:#|id[: ]?)?\s*\d+\b/gi,
  /docs\.google\.com\/[^\s<>"')\]]+/gi,
  /drive\.google\.com\/[^\s<>"')\]]+/gi,
  /\b1[A-Za-z0-9_-]{30,}\b/g,
];

export function extractOpaqueIdentifiers(messages: { role: string; content: string }[], maxIdentifiers: number = 15): string[] {
  const identifiers = new Set<string>();
  const fullText = messages.map(m => extractText(m.content)).join("\n");

  for (const pattern of IDENTIFIER_PATTERNS) {
    const matches = fullText.match(pattern) || [];
    for (const match of matches) {
      const trimmed = match.trim();
      if (trimmed.length >= 6 && trimmed.length <= 500) {
        identifiers.add(trimmed);
      }
      if (identifiers.size >= maxIdentifiers * 2) break;
    }
  }

  const scored = [...identifiers].map(id => {
    let score = 0;
    if (id.includes("google.com")) score += 5;
    if (id.includes("@")) score += 4;
    if (id.includes("/present/")) score += 5;
    if (/^\d{3}[-.]?\d{3}[-.]?\d{4}$/.test(id)) score += 3;
    if (/^[0-9a-f]{8}-/.test(id)) score += 3;
    if (/\.(pdf|doc|pptx|xlsx)$/i.test(id)) score += 3;
    if (id.startsWith("http")) score += 2;
    if (/conv|project|persona|tenant/i.test(id)) score += 4;
    return { id, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxIdentifiers)
    .map(s => s.id);
}

export function auditCompactionQuality(summary: string, identifiers: string[], latestUserAsk: string | null): CompactionQualityAudit {
  const reasons: string[] = [];
  const lines = summary.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const lineSet = new Set(lines);

  const sectionsPresent: string[] = [];
  const sectionsMissing: string[] = [];

  for (const section of REQUIRED_SECTIONS) {
    if (lineSet.has(section) || lines.some(l => l.startsWith(section))) {
      sectionsPresent.push(section);
    } else {
      sectionsMissing.push(section);
      reasons.push(`missing_section:${section}`);
    }
  }

  let identifiersPreserved = 0;
  for (const id of identifiers) {
    if (summary.includes(id)) {
      identifiersPreserved++;
    }
  }
  const identifierRatio = identifiers.length > 0 ? identifiersPreserved / identifiers.length : 1;
  if (identifierRatio < 0.5 && identifiers.length > 2) {
    reasons.push(`identifiers_lost:${identifiers.length - identifiersPreserved}/${identifiers.length}`);
  }

  if (latestUserAsk && latestUserAsk.length > 10) {
    const askWords = latestUserAsk.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const summaryLower = summary.toLowerCase();
    const overlap = askWords.filter(w => summaryLower.includes(w)).length;
    if (askWords.length > 0 && overlap < Math.min(2, askWords.length)) {
      reasons.push("latest_user_ask_not_reflected");
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    retryCount: 0,
    identifiersFound: identifiers.length,
    identifiersPreserved,
    sectionsPresent,
    sectionsMissing,
  };
}

export function buildStructuredFallbackSummary(previousSummary?: string): string {
  const trimmed = previousSummary?.trim() ?? "";
  if (trimmed && REQUIRED_SECTIONS.every(s => trimmed.includes(s))) {
    return trimmed;
  }
  return [
    "## Decisions",
    trimmed || "No prior history recorded.",
    "",
    "## Open TODOs",
    "None tracked.",
    "",
    "## Constraints/Rules",
    "None recorded.",
    "",
    "## Pending user asks",
    "None pending.",
    "",
    "## Exact identifiers",
    "None captured.",
  ].join("\n");
}

export async function archiveMessages(
  conversationId: number | string,
  messages: { role: string; content: string }[],
  allMessages: { role: string; content: string }[]
): Promise<string> {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `conv-${conversationId}_${timestamp}.md`;
  const archivePath = path.join(ARCHIVE_DIR, filename);

  const lines: string[] = [
    `# Compaction Archive`,
    `- Conversation: ${conversationId}`,
    `- Archived at: ${new Date().toISOString()}`,
    `- Total messages in conversation: ${allMessages.length}`,
    `- Messages archived (compacted away): ${messages.length}`,
    `- Messages kept (recent): ${allMessages.length - messages.length}`,
    ``,
    `---`,
    ``,
    `## Full Transcript of Compacted Messages`,
    ``,
  ];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const text = extractText(m.content);
    lines.push(`### Message ${i + 1} [${m.role.toUpperCase()}]`);
    lines.push(``);
    lines.push(text);
    lines.push(``);
  }

  const fullContent = lines.join("\n");
  const tmpPath = `${archivePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, fullContent, "utf-8");
    const fd = fs.openSync(tmpPath, "r+");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmpPath, archivePath);
  } catch (writeErr) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_silentErr) { logSilentCatch("server/compaction.ts", _silentErr); }
    throw writeErr;
  }
  console.log(`[compaction] Archived ${messages.length} messages to ${archivePath}`);

  try {
    const convId = typeof conversationId === "string" ? parseInt(conversationId) || 0 : conversationId;
    await db.execute(
      sql`INSERT INTO compaction_archives (conversation_id, message_count, total_messages, content) VALUES (${convId}, ${messages.length}, ${allMessages.length}, ${fullContent})`
    );
    console.log(`[compaction] Saved archive to database for conversation ${conversationId}`);
  } catch (dbErr: any) {
    console.error(`[compaction] DB archive save failed: ${dbErr.message}`);
    throw new Error(`Archive save failed — compaction blocked to protect data: ${dbErr.message}`);
  }

  return archivePath;
}

export async function extractAndSaveMemories(
  messages: { role: string; content: string }[],
  conversationId: number | string,
  tenantId?: number
): Promise<number> {
  try {
    const userMessages = messages.filter(m => m.role === "user");
    if (userMessages.length === 0) return 0;

    const userContent = userMessages
      .map(m => extractText(m.content).slice(0, 500))
      .join("\n");

    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `Extract important facts, preferences, and personal information from these user messages. Return a JSON array of objects: [{"fact": "...", "category": "preference|fact|biography|relationship|milestone|status"}]. Only include genuinely important information worth remembering long-term. Return [] if nothing notable. Return ONLY the JSON array.`,
        },
        {
          role: "user",
          content: `Extract memorable facts from these user messages (conversation ${conversationId}):\n\n${userContent.slice(0, 4000)}`,
        },
      ],
      max_completion_tokens: 500,
    });

    const rawOutput = resp.choices[0]?.message?.content?.trim() || "[]";
    let facts: any[] = [];
    try {
      const cleaned = rawOutput.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      facts = JSON.parse(cleaned);
    } catch (parseErr: any) {
      // R110.11.7 +sec — silent JSON parse → return 0 was a memory-loss vector.
      // LLM returns malformed JSON under load → user's facts/preferences for
      // this conversation are PERMANENTLY lost from long-term memory because
      // the surrounding flow proceeds with "0 memories saved" as if normal.
      // Log loud so ops can see the rate of LLM JSON failures and so the
      // memory-extraction success metric attributes correctly.
      console.warn(
        `[compaction] memory-extract JSON parse FAILED conversation=${conversationId} tenant=${tenantId} err=${String(parseErr?.message || parseErr).slice(0, 120)} raw="${rawOutput.slice(0, 160).replace(/\n/g, " ")}"`,
      );
      return 0;
    }

    if (!Array.isArray(facts) || facts.length === 0) return 0;

    let saved = 0;
    for (const f of facts.slice(0, 5)) {
      if (!f.fact || f.fact.length < 5) continue;
      try {
        await db.execute(sql`
          INSERT INTO memory_entries (fact, category, source, status, tenant_id)
          VALUES (${f.fact}, ${f.category || "fact"}, ${"compaction-extract"}, 'active', ${tenantId})
        `);
        saved++;
      } catch (_silentErr) { logSilentCatch("server/compaction.ts", _silentErr); }
    }
    if (saved > 0) {
      console.log(`[compaction] Extracted ${saved} memories from conversation ${conversationId} before compaction`);
    }
    return saved;
  } catch (err: any) {
    console.warn(`[compaction] Memory extraction failed (non-critical): ${err.message}`);
    return 0;
  }
}

function findLatestUserAsk(messages: { role: string; content: string }[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const text = extractText(messages[i].content);
      if (text.length > 5 && !text.startsWith("SYSTEM:")) {
        return text.slice(0, 500);
      }
    }
  }
  return null;
}

export async function compactMessages(
  messages: { role: string; content: string }[],
  conversationId?: number | string,
  tenantId?: number
): Promise<CompactionResult> {
  if (!shouldCompact(messages.length)) {
    return { compacted: false };
  }

  const { toSummarize, toKeep } = splitForCompaction(messages);

  if (toSummarize.length === 0) {
    return { compacted: false };
  }

  await extractAndSaveMemories(toSummarize, conversationId || "unknown", tenantId).catch(() => {});

  let archivePath: string;
  try {
    archivePath = await archiveMessages(
      conversationId || "unknown",
      toSummarize,
      messages
    );
  } catch (archiveErr: any) {
    console.error(`[compaction] SAFETY GATE: Archive failed, aborting compaction to protect messages:`, archiveErr.message);
    return { compacted: false };
  }

  const identifiers = extractOpaqueIdentifiers(toSummarize);
  const latestAsk = findLatestUserAsk(toSummarize);

  const meaningfulMessages = filterRealConversation(toSummarize);
  const noiseFiltered = toSummarize.length - meaningfulMessages.length;
  if (noiseFiltered > 0) {
    console.log(`[compaction] Real conversation filter: ${meaningfulMessages.length}/${toSummarize.length} meaningful (${noiseFiltered} noise messages filtered)`);
  }

  const toolOutcomeSummaries: string[] = [];
  for (const m of toSummarize) {
    if (m.role === "tool") {
      const text = extractText(m.content);
      const urlMatches = text.match(/https?:\/\/[^\s"')\]},]+/g);
      const idMatches = text.match(/"(?:id|fileId|presentationId|driveId|messageId|sessionId)":\s*"([^"]+)"/g);
      const statusMatch = text.match(/"(?:success|status|error)":\s*(?:"([^"]+)"|(\w+))/);
      if (urlMatches || idMatches || statusMatch) {
        const parts: string[] = [];
        if (statusMatch) parts.push(`status: ${statusMatch[1] || statusMatch[2]}`);
        if (urlMatches) parts.push(`links: ${[...new Set(urlMatches)].slice(0, 5).join(", ")}`);
        if (idMatches) parts.push(idMatches.slice(0, 3).join(", "));
        toolOutcomeSummaries.push(`TOOL_RESULT: ${parts.join(" | ")}`);
      }
    }
  }

  const transcriptParts = (meaningfulMessages.length > 0 ? meaningfulMessages : toSummarize)
    .map((m) => {
      const text = extractText(m.content);
      return `${m.role.toUpperCase()}: ${text.slice(0, 1200)}`;
    });

  if (toolOutcomeSummaries.length > 0) {
    transcriptParts.push(`\n--- TOOL OUTCOMES (preserve all URLs and IDs) ---\n${toolOutcomeSummaries.join("\n")}`);
    console.log(`[compaction] Injected ${toolOutcomeSummaries.length} distilled tool outcomes into compaction transcript`);
  }

  const transcript = transcriptParts.join("\n\n");

  let taskSpecificInstructions = "";
  try {
    const fullText = toSummarize.map(m => extractText(m.content)).join(" ");
    const intent = classifyIntent(fullText);
    if (intent !== "unknown" && intent !== "conversation") {
      taskSpecificInstructions = `\n\nTASK-SPECIFIC FOCUS (this was a ${intent.toUpperCase()} conversation):\n${getCompactionInstructionsForIntent(intent)}`;
    }
  } catch (_silentErr) { logSilentCatch("server/compaction.ts", _silentErr); }

  let summary: string | undefined;
  let qualityAudit: CompactionQualityAudit | undefined;

  for (let attempt = 0; attempt <= MAX_QUALITY_RETRIES; attempt++) {
    try {
      const identifierHint = identifiers.length > 0
        ? `\n\nCRITICAL — These identifiers MUST appear verbatim in the "## Exact identifiers" section:\n${identifiers.map(id => `- ${id}`).join("\n")}`
        : "";

      const retryHint = attempt > 0 && qualityAudit
        ? `\n\nPREVIOUS ATTEMPT FAILED QUALITY CHECK:\n${qualityAudit.reasons.map(r => `- ${r}`).join("\n")}\nFix these issues in your new summary.`
        : "";

      const resp = await replitOpenai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: STRUCTURED_COMPACTION_PROMPT },
          {
            role: "user",
            content: `Summarize this conversation history (${meaningfulMessages.length} meaningful messages out of ${toSummarize.length} total) into the required structured format. Preserve ALL facts — zero memory loss:${identifierHint}${taskSpecificInstructions}${retryHint}\n\n${transcript.slice(0, 12000)}`,
          },
        ],
        max_completion_tokens: SUMMARY_MAX_TOKENS,
      });

      summary = resp.choices[0]?.message?.content?.trim();
      if (!summary) {
        summary = buildStructuredFallbackSummary();
        console.warn(`[compaction] Empty summary from LLM, using structured fallback`);
        break;
      }

      qualityAudit = auditCompactionQuality(summary, identifiers, latestAsk);
      qualityAudit.retryCount = attempt;

      if (qualityAudit.ok) {
        console.log(`[compaction] Quality audit PASSED (attempt ${attempt + 1}, ${identifiers.length} identifiers, ${qualityAudit.sectionsPresent.length}/${REQUIRED_SECTIONS.length} sections)`);
        break;
      }

      if (attempt < MAX_QUALITY_RETRIES) {
        console.warn(`[compaction] Quality audit FAILED (attempt ${attempt + 1}): ${qualityAudit.reasons.join(", ")} — retrying`);
      } else {
        console.warn(`[compaction] Quality audit FAILED after ${attempt + 1} attempts: ${qualityAudit.reasons.join(", ")} — using best effort`);
        if (!REQUIRED_SECTIONS.every(s => summary!.includes(s))) {
          summary = buildStructuredFallbackSummary(summary);
          console.log(`[compaction] Wrapped summary in structured fallback template`);
        }
      }
    } catch (err: any) {
      console.error(`[compaction] Attempt ${attempt + 1} failed:`, err.message);
      if (attempt >= MAX_QUALITY_RETRIES) {
        summary = buildStructuredFallbackSummary();
        qualityAudit = { ok: false, reasons: ["llm_error"], retryCount: attempt, identifiersFound: identifiers.length, identifiersPreserved: 0, sectionsPresent: [], sectionsMissing: [...REQUIRED_SECTIONS] };
      }
    }
  }

  if (!summary) {
    return { compacted: false, archivePath };
  }

  return {
    compacted: true,
    summary,
    removedCount: toSummarize.length,
    keptCount: toKeep.length,
    archivePath,
    qualityAudit,
  };
}

export function buildCompactedMessages(
  summary: string,
  recentMessages: { role: string; content: string }[],
  conversationId?: number
): { role: string; content: string }[] {
  let identifierBlock = "";
  if (conversationId) {
    try {
      const existingState = taskStateStore.get(conversationId);
      if (existingState && Object.keys(existingState.identifiers).length > 0) {
        identifierBlock = buildIdentifierPreservationBlock(existingState.identifiers);
      }
    } catch (_silentErr) { logSilentCatch("server/compaction.ts", _silentErr); }
  }

  const compactionMarker = {
    role: "system" as const,
    content: `[STRUCTURED CONVERSATION SUMMARY]
The following is a structured summary of the earlier part of this conversation. It preserves all decisions, tasks, constraints, pending requests, and critical identifiers.

${summary}
${identifierBlock ? `\n${identifierBlock}\n` : ""}
[END SUMMARY — The full pre-compaction messages are preserved in the archive. Use the recall_context tool with this conversation's ID to retrieve complete original messages if you need details not in this summary. Recent messages follow below.]`,
  };

  return [compactionMarker, ...recentMessages];
}

export async function recallCompactionArchive(params: {
  conversationId: number;
  tenantId?: number;
  query?: string;
  limit?: number;
}): Promise<{ success: boolean; archives?: any[]; error?: string }> {
  // R75 — Hardened: tenantId is now REQUIRED (was previously fail-open via
  // `(tenantId || 0) = 0 OR c.tenant_id = tenantId`, which let any caller that
  // forgot to pass tenant inherit cross-tenant access). Fail-closed instead.
  if (typeof params.tenantId !== "number" || params.tenantId <= 0) {
    return { success: false, error: "tenantId is required for recallCompactionArchive (fail-closed)" };
  }
  const tenantId = params.tenantId;
  try {
    const maxResults = params.limit || 3;
    let rows: any[];

    if (params.query) {
      const searchTerm = `%${params.query}%`;
      rows = await db.execute(
        sql`SELECT ca.id, ca.conversation_id, ca.archived_at, ca.message_count, ca.total_messages, ca.content, ca.summary
            FROM compaction_archives ca
            INNER JOIN conversations c ON c.id = ca.conversation_id
            WHERE ca.conversation_id = ${params.conversationId}
              AND c.tenant_id = ${tenantId}
              AND ca.content ILIKE ${searchTerm}
            ORDER BY ca.archived_at DESC
            LIMIT ${maxResults}`
      ) as any;
    } else {
      rows = await db.execute(
        sql`SELECT ca.id, ca.conversation_id, ca.archived_at, ca.message_count, ca.total_messages, ca.content, ca.summary
            FROM compaction_archives ca
            INNER JOIN conversations c ON c.id = ca.conversation_id
            WHERE ca.conversation_id = ${params.conversationId}
              AND c.tenant_id = ${tenantId}
            ORDER BY ca.archived_at DESC
            LIMIT ${maxResults}`
      ) as any;
    }

    const archives = ((rows as any).rows || rows || []).map((r: any) => ({
      id: r.id,
      conversationId: r.conversation_id,
      archivedAt: r.archived_at,
      messageCount: r.message_count,
      totalMessages: r.total_messages,
      content: r.content?.length > 12000 ? r.content.slice(0, 12000) + "\n...(truncated, use query param to search for specific content)" : r.content,
    }));

    return {
      success: true,
      archives,
    };
  } catch (err: any) {
    // R75 — SECURITY FIX (CRITICAL): The previous filesystem fallback read files
    // by `conv-{conversationId}_*` prefix WITHOUT any tenant ownership check.
    // Because this fallback runs precisely when the DB recall has failed, we
    // cannot verify tenant ownership at all (DB is the source of truth for the
    // conversationId→tenantId mapping). Returning filesystem content here was a
    // cross-tenant data-leak path on DB outage. Fail closed instead.
    // Archived files remain on disk under ARCHIVE_DIR for forensic recovery,
    // but are no longer served via this path.
    console.warn(`[compaction] recall failed for conv=${params.conversationId} tenant=${params.tenantId ?? 'unknown'}: ${err?.message || 'unknown error'} (filesystem fallback disabled — fail-closed)`);
    return { success: false, error: err.message };
  }
}
