export const taskStateStore = new Map<number, TaskState>();

// R53.D — Boot-time rehydration. taskStateStore is in-memory; before R53 a
// server restart wiped every in-flight TASK STATE TRACKER even though
// agent_runs persists in the DB. After restart the prompt's TASK STATE
// section was empty for any conversation that had a still-running run, and
// the agent had no idea it was mid-flight. This rehydrator pulls every
// agent_runs row in 'running' or 'pending' status and rebuilds a minimal
// TaskState entry keyed by the parent conversation it belongs to (read from
// state.conversationId or state.parentConversationId). Best-effort: any row
// without a parent conversation is skipped (subagent-only runs need different
// surfacing — handled separately).
export async function rehydrateTaskStateOnBoot(): Promise<{ rehydrated: number; skipped: number }> {
  let rehydrated = 0;
  let skipped = 0;
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const res = await db.execute(sql`
      SELECT id, tenant_id, run_type, goal, status, state, steps, created_at, updated_at
      FROM agent_runs
      WHERE status IN ('running', 'pending')
        AND created_at > NOW() - INTERVAL '7 days'
    `);
    const rows = ((res as any).rows || res) as any[];
    for (const row of rows) {
      const state = row.state || {};
      const convId: number | undefined = state.conversationId || state.parentConversationId;
      if (!convId) { skipped++; continue; }
      if (taskStateStore.has(convId)) continue; // newer in-memory state wins
      const steps = Array.isArray(row.steps) ? row.steps : [];
      const completedSteps = steps.filter((s: any) => s?.status === "completed").map((s: any) => s.name || s.description || "step");
      const pendingSteps = steps.filter((s: any) => s?.status !== "completed").map((s: any) => s.name || s.description || "step");
      taskStateStore.set(convId, {
        conversationId: convId,
        intent: (state.intent as ConversationIntent) || "operations",
        currentStep: state.currentStep || (pendingSteps[0] || "resume"),
        totalSteps: steps.length || 1,
        completedSteps,
        pendingSteps,
        blockers: state.blockers || [],
        identifiers: state.identifiers || {},
        lastUserAsk: state.lastUserAsk || row.goal || "",
        lastToolUsed: state.lastToolUsed || null,
        startedAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
        decisionLog: state.decisionLog || [],
        contextLayer: state.contextLayer || "default",
      } as TaskState);
      rehydrated++;
    }
    if (rehydrated > 0 || rows.length > 0) {
      console.log(`[felix-brain] rehydrated ${rehydrated} in-flight task state(s) from agent_runs (${skipped} skipped, no parent conv)`);
    }
  } catch (e: any) {
    console.warn(`[felix-brain] rehydrateTaskStateOnBoot failed: ${e?.message}`);
  }
  return { rehydrated, skipped };
}

export interface TaskState {
  conversationId: number;
  intent: ConversationIntent;
  currentStep: string;
  totalSteps: number;
  completedSteps: string[];
  pendingSteps: string[];
  blockers: string[];
  identifiers: Record<string, string>;
  lastUserAsk: string;
  lastToolUsed: string | null;
  startedAt: number;
  updatedAt: number;
  decisionLog: DecisionEntry[];
  contextLayer: ContextLayer;
}

export interface DecisionEntry {
  what: string;
  why: string;
  timestamp: number;
}

export type ConversationIntent =
  | "presentation"
  | "research"
  | "email"
  | "document"
  | "analysis"
  | "operations"
  | "conversation"
  | "delegation"
  | "unknown";

export type ContextLayer = "vc_showcase" | "client_facing" | "internal_ops" | "casual" | "default";

const INTENT_PATTERNS: Record<ConversationIntent, RegExp[]> = {
  presentation: [
    /\b(presentation|slide|deck|pitch|keynote|narrat|present|showcase)\b/i,
    /\b(create_slides|build_presentation)\b/i,
  ],
  research: [
    /\b(research|investigate|find out|look into|deep dive|analyze|competitor|market)\b/i,
    /\b(web_search|deep_research|smart_browse)\b/i,
  ],
  email: [
    /\b(email|send|mail|reply|forward|draft|compose|outreach)\b/i,
    /\b(send_email|gmail_send)\b/i,
  ],
  document: [
    /\b(pdf|document|report|invoice|proposal|contract|brochure|whitepaper)\b/i,
    /\b(create_pdf|create_document|create_styled_report)\b/i,
  ],
  analysis: [
    /\b(analyz|compar|evaluat|assess|audit|benchmark|metric|dashboard|chart)\b/i,
    /\b(generate_chart|generate_dashboard)\b/i,
  ],
  operations: [
    /\b(schedule|heartbeat|deploy|backup|maintain|monitor|status|system|config)\b/i,
    /\b(check_system_status|heartbeat|manage_desk)\b/i,
  ],
  delegation: [
    /\b(delegate|orchestrat|assign|team|agent|sub-?agent)\b/i,
    /\b(delegate_task|orchestrate|sessions_spawn)\b/i,
  ],
  conversation: [
    /\b(hello|hi|hey|thanks|how are|what do you think|tell me about|explain)\b/i,
  ],
  unknown: [],
};

export function classifyIntent(message: string, toolsUsed?: string[]): ConversationIntent {
  let bestIntent: ConversationIntent = "unknown";
  let bestScore = 0;

  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (intent === "unknown") continue;
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(message)) score += 2;
    }
    if (toolsUsed) {
      for (const tool of toolsUsed) {
        for (const pattern of patterns) {
          if (pattern.test(tool)) score += 3;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent as ConversationIntent;
    }
  }

  if (bestScore < 2) return "conversation";
  return bestIntent;
}

export function detectContextLayer(message: string, personaId?: number, source?: string): ContextLayer {
  const lower = message.toLowerCase();

  if (/\b(vc|venture|investor|showcase|demo day|pitch|funding|raise|series\s*[a-d])\b/i.test(message)) {
    return "vc_showcase";
  }

  if (/\b(client|customer|prospect|partner|proposal|contract|deliverable for)\b/i.test(message)) {
    return "client_facing";
  }

  if (source === "whatsapp" || /\b(hey|sup|quick question|fyi|btw)\b/i.test(message)) {
    return "casual";
  }

  if (/\b(heartbeat|cron|internal|system|backup|sync|maintenance|deploy|config)\b/i.test(message)) {
    return "internal_ops";
  }

  return "default";
}

const IDENTITY_LAYERS: Record<ContextLayer, {
  tone: string;
  personality: string;
  rules: string[];
}> = {
  vc_showcase: {
    tone: "Confident, visionary, data-driven. You are presenting to engineers and VCs who evaluate 50 pitches a week.",
    personality: "Think Steve Jobs meets Jensen Huang. Bold claims backed by real metrics. Paint the future, then prove you're building it.",
    rules: [
      "Lead with the most impressive metric or capability — hook them in 10 seconds",
      "Every claim must be backed by a specific number, demo, or live proof",
      "Speak in outcomes, not features — 'We eliminated 80% of manual workflow' not 'We have an orchestration engine'",
      "Anticipate skepticism — address 'why now' and 'why you' proactively",
      "Never say 'we plan to' — say 'we built' or 'we're shipping next week'",
      "Use contrast frames: 'Traditional AI assistants do X. We do Y. Here's the difference.'",
      "Close with a clear call to action — what do you want them to DO after this presentation",
    ],
  },
  client_facing: {
    tone: "Professional, competent, reassuring. You are a trusted advisor delivering business value.",
    personality: "Like a senior McKinsey consultant — methodical, insightful, focused on ROI. Make the client feel their problem is understood and solvable.",
    rules: [
      "Start with the client's problem, not your solution",
      "Quantify everything — time saved, cost reduced, risk mitigated",
      "Provide options with a clear recommendation — don't make them decide from scratch",
      "Follow up every deliverable with next steps",
      "Use their industry's language and reference their specific context",
    ],
  },
  internal_ops: {
    tone: "Precise, efficient, no-nonsense. You are running a tight operation.",
    personality: "Like an excellent COO — focused on execution, metrics, and follow-through.",
    rules: [
      "Status updates in structured format: what changed, what's blocked, what's next",
      "Log decisions to daily notes — they're the organization's memory",
      "Automate recurring work with heartbeat tasks",
      "Surface anomalies proactively — don't wait to be asked",
    ],
  },
  casual: {
    tone: "Warm, approachable, concise. Like texting a smart colleague.",
    personality: "Friendly but competent — get to the point, help fast, be human.",
    rules: [
      "Keep responses short — 1-3 paragraphs max",
      "Skip formal structure — no bullet-point walls",
      "Answer first, elaborate only if asked",
      "Match the user's energy and communication style",
    ],
  },
  default: {
    tone: "Direct, capable, action-oriented. A CEO who gets things done.",
    personality: "Professional but not stiff. Confident but not arrogant. Results-focused.",
    rules: [
      "Act, don't narrate — call tools immediately",
      "Deliver complete results, not progress updates",
      "Every response should leave the user better off than before",
    ],
  },
};

export function getIdentityLayer(layer: ContextLayer): typeof IDENTITY_LAYERS.default {
  return IDENTITY_LAYERS[layer] || IDENTITY_LAYERS.default;
}

export function getOrCreateTaskState(conversationId: number, userMessage: string, source?: string): TaskState {
  const existing = taskStateStore.get(conversationId);
  if (existing) {
    existing.updatedAt = Date.now();
    return existing;
  }

  const state: TaskState = {
    conversationId,
    intent: classifyIntent(userMessage),
    currentStep: "intake",
    totalSteps: 0,
    completedSteps: [],
    pendingSteps: [],
    blockers: [],
    identifiers: {},
    lastUserAsk: userMessage.slice(0, 500),
    lastToolUsed: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    decisionLog: [],
    contextLayer: detectContextLayer(userMessage, undefined, source),
  };

  taskStateStore.set(conversationId, state);
  return state;
}

export function updateTaskState(conversationId: number, update: Partial<TaskState>): TaskState | null {
  const state = taskStateStore.get(conversationId);
  if (!state) return null;
  Object.assign(state, update, { updatedAt: Date.now() });
  return state;
}

export function logDecision(conversationId: number, what: string, why: string): void {
  const state = taskStateStore.get(conversationId);
  if (!state) return;
  state.decisionLog.push({ what, why, timestamp: Date.now() });
  if (state.decisionLog.length > 20) {
    state.decisionLog = state.decisionLog.slice(-15);
  }
}

export function recordToolExecution(conversationId: number, toolName: string, success: boolean, identifiers?: Record<string, string>): void {
  const state = taskStateStore.get(conversationId);
  if (!state) return;

  state.lastToolUsed = toolName;
  state.updatedAt = Date.now();

  if (success) {
    if (!state.completedSteps.includes(toolName)) {
      state.completedSteps.push(toolName);
    }
    state.pendingSteps = state.pendingSteps.filter(s => s !== toolName);
  }

  if (identifiers) {
    Object.assign(state.identifiers, identifiers);
  }

  const newIntent = classifyIntent(state.lastUserAsk, state.completedSteps);
  if (newIntent !== "unknown" && newIntent !== "conversation") {
    state.intent = newIntent;
  }
}

export function clearTaskState(conversationId: number): void {
  taskStateStore.delete(conversationId);
}

const COMMON_SENSE_RULES: Record<ConversationIntent, string[]> = {
  presentation: [
    "Always use create_slides for presentations — never produce_video",
    "Include narrated Auto-Presenter link in every presentation response",
    "Set speaker notes on EVERY slide — the narrator reads these aloud",
    "Mix slide layouts for visual variety — never all TITLE_AND_BODY",
    "For 8+ slides, use build_presentation_distributed first for efficiency",
    "After building, write a detailed presenter walkthrough (3-5 paragraphs minimum)",
  ],
  research: [
    "Start with web_search for quick answers, escalate to deep_research for thorough topics",
    "Always search in English even for non-English companies",
    "Synthesize findings — don't dump raw search results",
    "Know when to stop — once you have enough info, write the answer",
    "Save important findings to knowledge base for future reference",
  ],
  email: [
    "Always include the actual Drive link for any attachment — never local URLs",
    "Verify recipient email before sending",
    "For new contacts, queue for CEO approval before sending",
    "Check the send result for errors — don't claim success if it failed",
  ],
  document: [
    "create_pdf auto-uploads to Drive — don't call google_drive separately",
    "Always include the Drive share link and download link in response",
    "Use structured sections — never a single wall of text",
    "Check for user's logo with list_uploads before building branded documents",
  ],
  analysis: [
    "Ground analysis in real data — never make up numbers",
    "Include specific data points, not vague qualitative statements",
    "Present findings in a structured format with clear recommendations",
    "If data is incomplete, say so explicitly — don't fill gaps with speculation",
  ],
  operations: [
    "Check system status before making changes",
    "For recurring tasks, create heartbeat tasks to automate",
    "Log important operations to daily notes",
    "Verify changes after applying them",
  ],
  delegation: [
    "Route to the right specialist — don't do work the sub-agent should do",
    "After delegation returns, CONTINUE with the result — don't stop",
    "Extract all findings from delegation results and present them fully",
    "If delegation fails, try an alternative specialist or do it directly",
  ],
  conversation: [
    "Be helpful and direct — answer the question first, then elaborate",
    "If the conversation turns into project work, suggest creating a project",
    "Remember important facts with create_memory",
  ],
  unknown: [
    "Classify the request and proceed with the most appropriate approach",
    "When in doubt, ask one clarifying question — then act",
  ],
};

export function getCommonSenseRules(intent: ConversationIntent): string[] {
  return COMMON_SENSE_RULES[intent] || COMMON_SENSE_RULES.unknown;
}

const CEO_REASONING_FRAMEWORKS: Record<string, string> = {
  decomposition: `TASK DECOMPOSITION — Before executing any complex request:
1. What is the user's ACTUAL goal? (not what they literally said — what outcome do they want?)
2. What are the 2-4 steps to get there? (not 10 — keep it focused)
3. Which steps can I delegate vs do myself?
4. What could go wrong? (pre-mortem: assume it failed — what went wrong?)
5. What does "done" look like? (specific deliverables, not vague "completed")`,

  prioritization: `PRIORITIZATION — When juggling multiple requests:
- Urgent + Important: Do NOW (client deadlines, showcase prep, broken systems)
- Important + Not Urgent: Schedule (research, strategy, tool building)
- Urgent + Not Important: Delegate (routine emails, status checks)
- Neither: Drop or defer (nice-to-haves, over-optimization)`,

  failure_recovery: `FAILURE RECOVERY — When something breaks:
1. STOP — Don't retry blindly. Read the error.
2. DIAGNOSE — What assumption was wrong? (wrong params? wrong tool? wrong approach?)
3. PIVOT — Try the next-best approach. You always have at least 3 options:
   a. Fix params and retry
   b. Use a different tool
   c. Decompose into smaller steps
   d. Delegate to a specialist
4. LEARN — If you solved it, the lesson auto-saves. Future you won't repeat this.
5. ESCALATE — Only after 3 meaningfully different attempts. Report EXACTLY what you tried.`,

  proactive_ops: `PROACTIVE INTELLIGENCE — Don't wait to be told:
- If a deliverable needs research, START researching before the user finishes typing
- If you notice a pattern (user asks for weekly reports), offer to automate it
- If a system is degraded, flag it before it becomes a crisis
- If you learn something valuable, save it to memory/knowledge NOW
- If another agent would be better suited, delegate WITHOUT being asked
- If a heartbeat task would prevent a recurring problem, create it
- Think 2 steps ahead: after delivering this, what will the user likely need NEXT?`,

  quality_mindset: `CRAFTSMANSHIP MINDSET — The standard is excellence:
- Before delivering: "Would I be proud to show this to 100 engineers?"
- Before responding: "Did I actually DO the work, or just DESCRIBE what I could do?"
- Before closing: "Does the user have everything they need, or will they have to ask again?"
- After tools: "Did I verify the output? Does the link work? Is the content complete?"
- On errors: "Am I being transparent about what failed, or hiding behind vague language?"`,
};

export function getCeoReasoningContext(intent: ConversationIntent, layer: ContextLayer): string {
  const blocks: string[] = [];

  blocks.push(CEO_REASONING_FRAMEWORKS.decomposition);

  if (intent === "presentation" || layer === "vc_showcase") {
    blocks.push(CEO_REASONING_FRAMEWORKS.quality_mindset);
  }

  if (intent === "delegation" || intent === "operations") {
    blocks.push(CEO_REASONING_FRAMEWORKS.prioritization);
  }

  blocks.push(CEO_REASONING_FRAMEWORKS.failure_recovery);
  blocks.push(CEO_REASONING_FRAMEWORKS.proactive_ops);

  return blocks.join("\n\n");
}

export function getCompactionInstructionsForIntent(intent: ConversationIntent): string {
  const instructions: Record<ConversationIntent, string> = {
    presentation: "Focus on preserving: slide structure and count, theme choice, speaker notes content, all Google Slides links and presenter URLs, narration status, and the presentation topic/audience. Condense research that fed into the deck.",
    research: "Focus on preserving: key findings with specific data points, sources and URLs, search queries that worked, conclusions drawn, and any remaining research gaps. Condense the search/browse process steps.",
    email: "Focus on preserving: recipient email addresses, email subject and key content, send status (sent/failed/drafted), any Drive links included, and follow-up commitments. Condense the drafting process.",
    document: "Focus on preserving: document type and structure, Drive share/download links, content outline and key sections, branding decisions (logo, colors), and delivery status. Condense the creation steps.",
    analysis: "Focus on preserving: specific data points and metrics, analysis methodology, key findings and insights, recommendations with rationale, data sources. Condense intermediate calculation steps.",
    operations: "Focus on preserving: system state changes, configuration values, heartbeat task details, error resolutions, monitoring thresholds. Condense routine status checks.",
    delegation: "Focus on preserving: which agents were delegated to, task assignments and results, cross-agent dependencies, synthesized outputs. Condense delegation handoff details.",
    conversation: "Focus on preserving: user preferences and facts shared, questions asked and answers given, important context for future conversations. Condense pleasantries.",
    unknown: "Preserve all facts, decisions, and active tasks. Condense repetitive exchanges.",
  };

  return instructions[intent] || instructions.unknown;
}

export function buildTaskStateContext(state: TaskState): string {
  const lines: string[] = [];

  const identity = getIdentityLayer(state.contextLayer);
  lines.push(`## ADAPTIVE IDENTITY — ${state.contextLayer.toUpperCase().replace(/_/g, " ")}`);
  lines.push(`Tone: ${identity.tone}`);
  lines.push(`Personality: ${identity.personality}`);
  for (const rule of identity.rules) {
    lines.push(`- ${rule}`);
  }

  lines.push(``);
  lines.push(`## TASK STATE TRACKER`);
  lines.push(`Intent: ${state.intent.toUpperCase()}`);
  lines.push(`Current step: ${state.currentStep}`);

  if (state.completedSteps.length > 0) {
    lines.push(`Completed: ${state.completedSteps.join(", ")}`);
  }
  if (state.pendingSteps.length > 0) {
    lines.push(`Pending: ${state.pendingSteps.join(", ")}`);
  }
  if (state.blockers.length > 0) {
    lines.push(`BLOCKERS: ${state.blockers.join("; ")}`);
  }

  const idEntries = Object.entries(state.identifiers);
  if (idEntries.length > 0) {
    lines.push(`Key identifiers:`);
    for (const [key, val] of idEntries.slice(0, 10)) {
      lines.push(`  ${key}: ${val}`);
    }
  }

  if (state.decisionLog.length > 0) {
    lines.push(``);
    lines.push(`Recent decisions:`);
    for (const d of state.decisionLog.slice(-5)) {
      lines.push(`  - ${d.what} (because: ${d.why})`);
    }
  }

  lines.push(`Last user ask: "${state.lastUserAsk.slice(0, 200)}"`);

  const rules = getCommonSenseRules(state.intent);
  if (rules.length > 0) {
    lines.push(``);
    lines.push(`## COMMON SENSE — ${state.intent.toUpperCase()} TASK RULES`);
    for (const rule of rules) {
      lines.push(`- ${rule}`);
    }
  }

  lines.push(``);
  lines.push(`## CEO REASONING FRAMEWORKS`);
  lines.push(getCeoReasoningContext(state.intent, state.contextLayer));

  return lines.join("\n");
}

export function buildBrainContext(conversationId: number, userMessage: string, toolsUsed?: string[], source?: string): string | null {
  const state = getOrCreateTaskState(conversationId, userMessage, source);

  if (toolsUsed && toolsUsed.length > 0) {
    const newIntent = classifyIntent(userMessage, toolsUsed);
    if (newIntent !== "unknown" && newIntent !== "conversation") {
      state.intent = newIntent;
    }
  }

  state.lastUserAsk = userMessage.slice(0, 500);
  state.contextLayer = detectContextLayer(userMessage, undefined, source);
  state.updatedAt = Date.now();

  return buildTaskStateContext(state);
}

export function buildIdentifierPreservationBlock(identifiers: Record<string, string>): string {
  const entries = Object.entries(identifiers);
  if (entries.length === 0) return "";

  const lines = [
    `## ACTIVE IDENTIFIERS (preserve exactly — do not shorten or reconstruct)`,
  ];
  for (const [key, val] of entries.slice(0, 15)) {
    lines.push(`- ${key}: \`${val}\``);
  }
  return lines.join("\n");
}

export function extractIdentifiersFromToolResult(toolName: string, result: any): Record<string, string> {
  const ids: Record<string, string> = {};
  if (!result || typeof result !== "object") return ids;

  if (result.presentationId) ids.presentationId = String(result.presentationId);
  if (result.narratedPresentationUrl) ids.narratedUrl = String(result.narratedPresentationUrl);
  if (result.editLink) ids.editLink = String(result.editLink);
  if (result.shareableLink) ids.shareableLink = String(result.shareableLink);
  if (result.directDownloadLink) ids.downloadLink = String(result.directDownloadLink);
  if (result.imageUrl) ids.imageUrl = String(result.imageUrl);
  if (result.folderLink) ids.folderLink = String(result.folderLink);
  if (result.fileId) ids.fileId = String(result.fileId);
  if (result.driveId) ids.driveId = String(result.driveId);
  if (result.slideUrl) ids.slideUrl = String(result.slideUrl);
  if (result.pdfLink) ids.pdfLink = String(result.pdfLink);
  if (result.presenterSessionId) ids.presenterSessionId = String(result.presenterSessionId);
  if (result.trackingId) ids.trackingId = String(result.trackingId);
  if (result.deliveryId) ids.deliveryId = String(result.deliveryId);
  if (result.messageId) ids.messageId = String(result.messageId);

  if (result.links && typeof result.links === "object") {
    for (const [k, v] of Object.entries(result.links)) {
      if (typeof v === "string" && v.startsWith("http")) {
        ids[`link_${k}`] = v;
      }
    }
  }

  return ids;
}

export function hasMeaningfulContent(message: { role: string; content: string }): boolean {
  if (!message.content) return false;
  const text = typeof message.content === "string" ? message.content : String(message.content);

  if (text.length < 3) return false;

  if (/^SYSTEM:\s*(Tool loop|Budget warning|Maximum tool|Warning —|STUCK|STOP-THE-LINE)/i.test(text)) {
    return false;
  }

  if (/^<!-- (?:auto_route|tools):/.test(text) && text.indexOf("-->") > 0) {
    const afterMeta = text.slice(text.indexOf("-->") + 3).trim();
    if (afterMeta.length < 10) return false;
  }

  if (message.role === "tool") return false;

  if (message.role === "system" && /^\[(?:CONVERSATION HISTORY|STRUCTURED CONVERSATION|COMPACTION)/.test(text)) {
    return false;
  }

  if (/^(?:ok|okay|thanks|thank you|got it|sure|yes|no|k|👍|✅)$/i.test(text.trim())) {
    return false;
  }

  return true;
}

export function filterRealConversation(messages: { role: string; content: string }[]): { role: string; content: string }[] {
  return messages.filter(hasMeaningfulContent);
}

export function countMeaningfulMessages(messages: { role: string; content: string }[]): number {
  return messages.filter(hasMeaningfulContent).length;
}

export function buildSelfReflectionPrompt(state: TaskState): string | null {
  if (state.completedSteps.length < 2) return null;

  const elapsed = Date.now() - state.startedAt;
  const minutesElapsed = Math.floor(elapsed / 60000);

  const lines: string[] = [];
  lines.push(`## SELF-REFLECTION CHECKPOINT`);

  if (minutesElapsed > 5 && state.completedSteps.length > 0 && state.pendingSteps.length === 0) {
    lines.push(`You've been working for ${minutesElapsed} minutes. Check: are you done? Does the user have their deliverable?`);
  }

  if (state.blockers.length > 0) {
    lines.push(`ACTIVE BLOCKERS: ${state.blockers.join("; ")}. Have these been resolved? If not, escalate or pivot.`);
  }

  if (state.completedSteps.length >= 5) {
    lines.push(`You've executed ${state.completedSteps.length} tools. Are you making progress or spinning? If the user's original ask was simple, you may be overcomplicating it.`);
  }

  const toolSet = new Set(state.completedSteps);
  if (toolSet.size < state.completedSteps.length * 0.6) {
    lines.push(`You're calling the same tools repeatedly. This may indicate a loop. Try a different approach.`);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    const staleThreshold = 2 * 60 * 60 * 1000;
    for (const [id, state] of taskStateStore.entries()) {
      if (now - state.updatedAt > staleThreshold) {
        taskStateStore.delete(id);
      }
    }
  }, 30 * 60 * 1000);
}
