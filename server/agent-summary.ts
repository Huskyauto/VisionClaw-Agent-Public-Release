import { emitDelegationEvent, subscribeToDelegation } from "./delegation-events";
import { getClientForModel } from "./providers";


interface SummarizerEntry {
  timer: ReturnType<typeof setInterval>;
  unsub: () => void;
  cancelled: boolean;
}

const activeSummarizers = new Map<number, SummarizerEntry>();

const SUMMARY_MODEL = "gpt-4.1";

async function generateStatusSummary(agentName: string, taskName: string, recentContext: string): Promise<string | null> {
  try {
    const { client, actualModelId } = await getClientForModel(SUMMARY_MODEL);
    const resp = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        {
          role: "system",
          content: `Generate a 3-5 word present-tense status summary for what agent "${agentName}" is currently doing on task "${taskName}".

Rules:
- Present tense only (e.g., "Analyzing market data")
- 3-5 words maximum
- Name the specific action, not vague descriptions
- No past tense ("Analyzed" is wrong, "Analyzing" is right)
- No vague language ("Working on it" is wrong, "Drafting proposal intro" is right)
- No punctuation at the end
- Capitalize first word only

Respond with ONLY the status summary, nothing else.`,
        },
        {
          role: "user",
          content: `Recent activity:\n${recentContext.slice(0, 500)}`,
        },
      ],
      max_completion_tokens: 30,
    });

    const summary = resp.choices[0]?.message?.content?.trim();
    if (!summary || summary.length > 60 || summary.length < 5) return null;
    const wordCount = summary.split(/\s+/).length;
    if (wordCount < 3 || wordCount > 5) return null;
    return summary;
  } catch {
    return null;
  }
}

export function startDelegationSummarizer(
  conversationId: number,
  tenantId: number,
  agentName: string,
  taskName: string,
  depth: number,
  intervalMs: number = 20000,
): void {
  stopDelegationSummarizer(conversationId);

  let recentActivity: string[] = [];

  const unsub = subscribeToDelegation(conversationId, (event: { type: string; message: string; metadata?: Record<string, unknown> }) => {
    if (event.metadata?.isSummary) return;
    recentActivity.push(`[${event.type}] ${event.message}`);
    if (recentActivity.length > 10) recentActivity = recentActivity.slice(-10);
  });

  let isGenerating = false;
  const entry: SummarizerEntry = { timer: null as unknown as ReturnType<typeof setInterval>, unsub, cancelled: false };

  entry.timer = setInterval(async () => {
    if (entry.cancelled || isGenerating) return;

    isGenerating = true;
    try {
    if (recentActivity.length === 0) {
      recentActivity.push(`Working on: ${taskName}`);
    }

    const context = recentActivity.join("\n");
    const summary = await generateStatusSummary(agentName, taskName, context);

    if (summary && !entry.cancelled) {
      emitDelegationEvent({
        conversationId,
        tenantId,
        type: "progress",
        agentName,
        depth,
        message: summary,
        metadata: { isSummary: true },
      });
    }
    } finally {
      isGenerating = false;
    }
  }, intervalMs);

  activeSummarizers.set(conversationId, entry);
}

export function stopDelegationSummarizer(conversationId: number): void {
  const entry = activeSummarizers.get(conversationId);
  if (entry) {
    entry.cancelled = true;
    clearInterval(entry.timer);
    entry.unsub();
    activeSummarizers.delete(conversationId);
  }
}
