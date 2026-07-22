import { storage } from "./storage";

const MIN_TOOLS_FOR_CAPTURE = 2;
const MAX_AUTO_MEMORIES_PER_HOUR = 8;
const MEMORY_COOLDOWN_MS = 300_000;

interface ToolChain {
  tools: string[];
  success: boolean;
  duration: number;
}

const recentCaptures = new Map<string, number>();
let capturesThisHour = 0;
let hourResetAt = Date.now() + 3_600_000;

function resetHourlyLimitIfNeeded(): void {
  if (Date.now() > hourResetAt) {
    capturesThisHour = 0;
    hourResetAt = Date.now() + 3_600_000;
  }
}

function isDuplicate(key: string): boolean {
  const last = recentCaptures.get(key);
  if (last && Date.now() - last < MEMORY_COOLDOWN_MS) return true;
  return false;
}

const USEFUL_PATTERNS: Array<{
  name: string;
  detect: (tools: string[], userQuery: string) => boolean;
  template: (tools: string[], userQuery: string) => string;
}> = [
  {
    name: "multi_step_research",
    detect: (tools) => {
      const hasSearch = tools.some(t => t === "web_search" || t === "firecrawl_search");
      const hasFetch = tools.some(t => t === "web_fetch");
      return hasSearch && hasFetch && tools.length >= 3;
    },
    template: (tools, query) =>
      `Successful research pattern: ${tools.join(" → ")} for query type: "${query.slice(0, 100)}"`,
  },
  {
    name: "code_debug_flow",
    detect: (tools) => {
      const hasExec = tools.some(t => t === "exec" || t === "exec_code");
      const hasFile = tools.some(t => t === "read_file" || t === "write_file");
      return hasExec && hasFile;
    },
    template: (tools) =>
      `Effective debug workflow: ${tools.join(" → ")}`,
  },
  {
    name: "email_compose_flow",
    detect: (tools) => {
      const hasEmail = tools.some(t => t === "send_email" || t === "draft_email");
      const hasSearch = tools.some(t => t === "search_memory" || t === "search_knowledge");
      return hasEmail && hasSearch;
    },
    template: (tools) =>
      `Email composition with context lookup: ${tools.join(" → ")}`,
  },
  {
    name: "data_analysis_pipeline",
    detect: (tools) => {
      const hasQuery = tools.some(t => t === "exec_sql" || t === "search_documents");
      const hasCalc = tools.some(t => t === "exec_code");
      return hasQuery && hasCalc;
    },
    template: (tools) =>
      `Data analysis pipeline: ${tools.join(" → ")}`,
  },
  {
    name: "file_management_flow",
    detect: (tools) => {
      const hasGDrive = tools.some(t => t === "upload_to_drive" || t === "google_drive");
      const hasFile = tools.some(t => t === "read_file" || t === "write_file" || t === "create_pdf");
      return hasGDrive && hasFile;
    },
    template: (tools) =>
      `File management with Drive sync: ${tools.join(" → ")}`,
  },
  {
    name: "browser_automation",
    detect: (tools) => {
      const hasBrowser = tools.filter(t => t === "browser").length >= 2;
      return hasBrowser;
    },
    template: (tools) =>
      `Multi-step browser automation: ${tools.join(" → ")}`,
  },
  {
    name: "delegation_workflow",
    detect: (tools) => {
      return tools.some(t => t === "delegate_task" || t === "sessions_spawn");
    },
    template: (tools) =>
      `Delegation workflow used: ${tools.join(" → ")}`,
  },
];

export async function captureToolChainMemory(
  conversationId: number,
  personaId: number | null | undefined,
  tenantId: number,
  executedTools: Array<{ name: string; input: any; output: any }>,
  userQuery: string,
  responseSuccessful: boolean
): Promise<void> {
  try {
    if (!responseSuccessful) return;
    if (executedTools.length < MIN_TOOLS_FOR_CAPTURE) return;

    resetHourlyLimitIfNeeded();
    if (capturesThisHour >= MAX_AUTO_MEMORIES_PER_HOUR) return;

    const toolNames = executedTools.map(t => t.name);
    const chainKey = toolNames.join(",");

    if (isDuplicate(chainKey)) return;

    for (const pattern of USEFUL_PATTERNS) {
      if (pattern.detect(toolNames, userQuery)) {
        const memoryText = `[auto-learned:${pattern.name}] ${pattern.template(toolNames, userQuery)}`;

        const existing = await storage.getMemoryEntries(personaId ?? undefined, 200, 0, tenantId);
        const alreadyKnown = existing.data.some((m: any) =>
          m.fact && m.fact.includes(`auto-learned:${pattern.name}`) && m.fact.includes(toolNames.slice(0, 3).join(" → "))
        );
        if (alreadyKnown) return;

        // R98.19: route through debounced memory queue. Heuristic captures
        // get default confidence 0.85 — pattern matched a known-good template
        // but came from a single observation, not explicit user signal.
        const { enqueueMemoryFact } = await import("./lib/memory-queue");
        enqueueMemoryFact({
          tenantId,
          personaId: personaId ?? null,
          fact: memoryText,
          category: "tool_pattern",
          source: "auto_capture",
          confidence: 0.85,
          confidenceSource: "heuristic_pattern_match",
        });

        recentCaptures.set(chainKey, Date.now());
        capturesThisHour++;

        console.log(`[auto-memory] Captured: ${pattern.name} (${toolNames.length} tools, conv ${conversationId})`);
        return;
      }
    }
  } catch (err) {
    console.log(`[auto-memory] Capture failed (non-fatal): ${(err as Error).message}`);
  }
}

export function getAutoMemoryStats(): { capturesThisHour: number; maxPerHour: number; recentPatterns: number } {
  resetHourlyLimitIfNeeded();
  return {
    capturesThisHour,
    maxPerHour: MAX_AUTO_MEMORIES_PER_HOUR,
    recentPatterns: recentCaptures.size,
  };
}
