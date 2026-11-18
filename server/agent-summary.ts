import { emitDelegationEvent, subscribeToDelegation } from "./delegation-events";


interface SummarizerEntry {
  timer: ReturnType<typeof setInterval>;
  unsub: () => void;
  cancelled: boolean;
}

const activeSummarizers = new Map<number, SummarizerEntry>();

// A cosmetic progress label does not need any model, local or hosted.
// Static outputs never echo names, tool arguments or customer activity values.
export function generateStatusSummary(recentContext: string): string {
  const recent = recentContext.slice(-500).toLowerCase();
  if (/\b(search|research|fetch|browse)\w*/.test(recent)) return "Researching task details";
  if (/\b(test|validat|verif)\w*/.test(recent)) return "Checking task results";
  if (/\b(review|analyz|inspect)\w*/.test(recent)) return "Reviewing task details";
  if (/\b(write|writ|draft|compil|generat)\w*/.test(recent)) return "Preparing task output";
  return "Processing delegated task";
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
  let lastSummary = "";
  const entry: SummarizerEntry = { timer: null as unknown as ReturnType<typeof setInterval>, unsub, cancelled: false };

  entry.timer = setInterval(async () => {
    if (entry.cancelled || isGenerating) return;

    isGenerating = true;
    try {
    if (recentActivity.length === 0) return;
    const context = recentActivity.join("\n");
    recentActivity = [];
    const summary = generateStatusSummary(context);

    if (summary !== lastSummary && !entry.cancelled) {
      lastSummary = summary;
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
