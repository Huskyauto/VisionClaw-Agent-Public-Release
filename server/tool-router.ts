import { buildCategoryMap, auditRegistry } from "./tool-registry";
import { classifyRequest } from "./scaffolding";
import {
  matchHintsToMessage,
  filterDeprecated,
  rankByPerformance,
  semanticRank,
} from "./tool-curator";
import { enforceToolCap, estimateSchemaTokens } from "./lib/tool-cap";

type ToolDefinition = { type: "function"; function: { name: string; description: string; parameters: any } };

export const MAX_ROUTED_TOOLS_PER_TURN = (() => {
  const raw = Number(process.env.MAX_ROUTED_TOOLS_PER_TURN);
  return Number.isFinite(raw) && raw > 0 ? raw : 40;
})();

const PERSONA_TOOL_POLICIES: Record<string, { allowed: string[]; blocked: string[]; priority: string[] }> = {
  // R80 — Imported Claude Code subagents. Listed FIRST so substring matching in
  // getPersonaBlockedTools() catches these before the generic "developer"/"researcher"
  // keys (which would otherwise match the parenthesized tier suffix in the role).
  "imported subagent (developer)": {
    // Executor-tier import: developer permissions. Per-persona autonomy_rules
    // (approve_before on tool:exec / tool:execute_code / tool:write_file) are
    // also inserted at apply time for HITL gating on top of these policies.
    allowed: ["memory", "knowledge", "notes", "web", "code", "system", "ai", "files", "tools", "experiments", "diff"],
    blocked: ["send_email", "whatsapp", "deliver_product", "draft_social_post"],
    priority: ["code", "system", "tools", "experiments"],
  },
  "imported subagent (researcher)": {
    // Advisory-tier import: STRICT read-only. Hard-blocks ALL execution paths
    // (exec, shell_exec, execute_code) and writes (write_file) at the tool-router
    // layer — the "stay advisory" prompt instruction is reinforced by enforcement.
    allowed: ["memory", "knowledge", "notes", "web", "charts", "ai", "diff", "evidence", "scraping", "competitorIntel"],
    blocked: ["exec", "shell_exec", "execute_code", "write_file", "send_email", "whatsapp", "deliver_product", "draft_social_post", "marketing_experiment"],
    priority: ["web", "evidence", "scraping", "competitorIntel", "knowledge"],
  },
  "marketing": {
    allowed: ["memory", "knowledge", "notes", "web", "marketing", "media", "charts", "files", "ai", "scraping", "evidence"],
    blocked: ["exec", "shell_exec", "google_workspace", "whatsapp", "deliver_product"],
    priority: ["marketing", "media", "web", "charts"],
  },
  "sales": {
    allowed: ["memory", "knowledge", "notes", "web", "email", "marketing", "charts", "files", "delivery", "pdf", "workspace", "ai", "crm", "leadEnrichment", "outreachSequencing", "invoicing"],
    blocked: ["exec", "shell_exec"],
    priority: ["crm", "email", "leadEnrichment", "outreachSequencing", "invoicing"],
  },
  "developer": {
    allowed: ["memory", "knowledge", "notes", "web", "code", "system", "ai", "files", "tools", "experiments", "diff"],
    blocked: ["send_email", "whatsapp", "deliver_product", "draft_social_post"],
    priority: ["code", "system", "tools", "experiments"],
  },
  "finance": {
    allowed: ["memory", "knowledge", "notes", "workspace", "pdf", "charts", "email", "files", "ai", "web", "finance", "invoicing", "expenses", "reporting", "kpi", "crm", "contracts", "legal"],
    blocked: ["exec", "shell_exec", "draft_social_post", "marketing_experiment"],
    priority: ["finance", "invoicing", "expenses", "reporting", "kpi"],
  },
  "researcher": {
    allowed: ["memory", "knowledge", "notes", "web", "charts", "files", "ai", "diff", "evidence", "scraping", "competitorIntel"],
    blocked: ["exec", "shell_exec", "send_email", "whatsapp", "deliver_product", "draft_social_post"],
    priority: ["web", "evidence", "scraping", "competitorIntel", "knowledge"],
  },
  "content": {
    allowed: ["memory", "knowledge", "notes", "web", "marketing", "media", "files", "pdf", "charts", "ai", "docs"],
    blocked: ["exec", "shell_exec", "google_workspace", "whatsapp"],
    priority: ["media", "marketing", "docs", "pdf"],
  },
  "strategy": {
    allowed: ["memory", "knowledge", "notes", "web", "charts", "ai", "files", "evidence", "competitorIntel", "reporting", "kpi", "finance", "crm", "legal"],
    blocked: ["exec", "shell_exec", "whatsapp"],
    priority: ["evidence", "competitorIntel", "reporting", "kpi", "web"],
  },
  "operations": {
    allowed: ["memory", "knowledge", "notes", "web", "email", "workspace", "files", "ai", "system", "sessions", "crews", "reporting", "kpi", "tools", "experiments"],
    blocked: [],
    priority: ["system", "sessions", "crews", "tools", "reporting"],
  },
  "legal": {
    allowed: ["memory", "knowledge", "notes", "web", "pdf", "files", "ai", "legal", "contracts", "docs"],
    blocked: ["exec", "shell_exec", "marketing_experiment", "whatsapp"],
    priority: ["legal", "contracts", "pdf", "docs"],
  },
};

export function getPersonaBlockedTools(personaRole: string): Set<string> {
  const role = personaRole.toLowerCase();
  for (const [key, policy] of Object.entries(PERSONA_TOOL_POLICIES)) {
    if (role.includes(key)) {
      return new Set(policy.blocked);
    }
  }
  return new Set();
}

const TOOL_CATEGORIES: Record<string, string[]> = buildCategoryMap();

export function runToolRegistryAudit(toolDefinitions: { function: { name: string } }[]): void {
  const warnings = auditRegistry(toolDefinitions);
  const critical = warnings.filter(w => w.includes("WARNING"));
  const info = warnings.filter(w => w.includes("INFO"));
  for (const w of critical) console.warn(w);
  for (const w of info) console.log(w);
  // R74.13y: was `critical.length` used here, which conflated per-tool
  // missing-from-registry warnings with the very_slow rate-limit warning,
  // producing misleading messages like "1 tool(s) missing" when zero tools
  // were actually missing. Count only the per-tool warnings.
  const missingToolCount = critical.filter(w => w.includes("has no registry entry")).length;
  if (missingToolCount > 0) {
    console.warn(`[tool-registry] ${missingToolCount} tool(s) missing from registry — they won't be routed to agents. Add them via registerTool() in server/tool-registry.ts`);
  } else if (critical.length === 0) {
    console.log(`[tool-registry] Audit passed: all tool definitions have registry entries${info.length > 0 ? ` (${info.length} registry-only entries)` : ""}`);
  }
}

// R51: Added `graph_memory` to ALWAYS_INCLUDE. The tool was registered in
// tool-registry.ts:144 under the "memory" category and IS surfaced when the
// router scores the "memory" category high — but in practice agents reached
// for the simpler always-available trio (update_memory / recall_context /
// store_triple) and the hierarchical graph_memory subsystem stayed at 0 rows
// for months despite having a complete tools.ts:10133 implementation.
// Surfacing it on every call lets agents discover it organically; the
// dormant subsystem (graph_memory table) should start filling within days.
// R74.13z-quint+2 (Apr 29 2026): added the six tensions/ADRs primitives so every
// persona has them in scope on every routed turn, not only when "memory" or
// "planning" categories happen to score high. Doctrine #10 says personas must
// check tensions BEFORE reasoning and ADRs BEFORE designing — that requires the
// tools to be in the router's pick on EVERY turn, not just topic-matched ones.
// R96.1 (May 3 2026): added the four web-access tiers (web_fetch, browser,
// stealth_browse, stealth_browse_camofox) to ALWAYS_INCLUDE. Bob's standing
// concern: 277 tools in the inventory means the rare-but-critical ones get
// lost. Any persona that needs to hit a website should see ALL four tiers
// of the escalation ladder on EVERY routed turn — not only when the user
// happens to type "browser" or "scrape". Combined with the new `stealth`
// keyword category and the `fallbackHint` annotation on blocked results,
// this makes Camofox mechanically discoverable instead of buried.
const ALWAYS_INCLUDE = new Set([
  "search_memory", "create_memory", "recall_context", "query_triples", "store_triple",
  "graph_memory", "orchestrate", "delegate_task", "project", "write_file", "read_file",
  "list_open_tensions", "create_tension", "resolve_tension",
  "list_adrs", "create_adr", "supersede_adr",
  "web_fetch", "browser", "stealth_browse", "stealth_browse_camofox",
  // R115.5 (Osmani "Agent Harness Engineering") — Sprint Contract pre-flight
  // done-condition pin. Every persona that generates a deliverable needs
  // pin_done_condition BEFORE generation starts and evaluate_against_contract
  // AFTER it finishes. Adding all three to ALWAYS_INCLUDE so the pattern is
  // mechanically discoverable on every routed turn (same reasoning as the
  // R96.1 web-block ladder: rare-but-critical tools must surface every turn,
  // not only when the user happens to type "contract" or "done condition").
  "pin_done_condition", "get_done_condition", "evaluate_against_contract",
  // R125+3.6 — jury_triage (3-frontier-model vote on issues/findings/CI failures)
  // is trustedPersonasOnly per destructive-tool-policy, so persona-sync filters
  // it out of non-trusted personas automatically. For trusted personas (Felix,
  // Chief of Staff, etc.) it MUST surface every turn so they reach for it on
  // borderline triage decisions instead of hand-wringing in chat. Same
  // mechanical-discoverability rule as the R96.1 web-block ladder.
  "jury_triage",
  // R125+52.41 — second_opinion (independent external cross-check via OpenRouter
  // Fusion) is NOT trustedPersonasOnly, so all 16 personas may use it. Surface it
  // every routed turn (same mechanical-discoverability rule as ensemble_query)
  // so an agent reaches for an outside check on a shaky/high-stakes answer
  // instead of committing on a hunch. The $25/day Fusion budget cap is the guard.
  "second_opinion",
  // venture_discovery (S4) — owner-only, trusted-only 9-stage business-discovery
  // loop. Like jury_triage above, it's trustedPersonasOnly so persona-sync strips
  // it from non-trusted personas automatically; for trusted personas (Felix) it
  // MUST surface every turn so they reach for it on "explore/validate this idea"
  // instead of improvising. The full spec lives in PLATFORM_TOOLS_CONTRACT so all
  // 16 personas KNOW about it (and delegate to Felix when they can't call it).
  "venture_discovery",
  // R125+35 — Public-API live-data pack (Agenvoy-inspired). Universal utility
  // tools (weather, crypto, FX, Wikipedia, Hacker News, IP geo) — free, no-auth,
  // read-only. Bob's directive: ALL 16 agents wired to utilize them, so they
  // surface every routed turn (same mechanical-discoverability rule as web_fetch).
  "fetch_weather", "fetch_crypto_price", "fetch_exchange_rate",
  "fetch_wikipedia", "fetch_hacker_news", "lookup_ip_geo",
  // R125+37 — generate_design_doc (URL → semantic DESIGN.md). Safe/LOW,
  // SSRF-jailed. Surfaced to all personas so any deliverable / design / clone
  // task can reach for it instead of eyeballing a site by hand.
  "generate_design_doc",
]);

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  memory: ["remember", "recall", "memory", "memories", "forget", "store", "save this", "what do you know about", "themes", "topics", "clusters", "overview", "high-level", "big picture", "summary of memories"],
  knowledge: ["knowledge", "document", "docs", "documentation", "search docs", "find in docs", "doc collection", "triple", "entity", "relationship", "fact", "when was", "who is", "what changed", "why did", "what causes", "led to", "because", "due to", "what does x cause", "cause", "effect", "causal"],
  notes: ["note", "notes", "daily", "journal", "log", "diary", "today"],
  conversations: ["conversation", "conversations", "chat history", "previous chat"],
  web: ["search", "google", "browse", "website", "url", "http", "fetch", "look up", "find online", "research", "web"],
  email: ["email", "mail", "inbox", "send message", "compose", "outreach", "newsletter"],
  sessions: ["session", "agent", "spawn", "delegate", "multi-agent", "sub-agent"],
  pdf: ["pdf", "document", "form", "fill out", "template", "report", "analysis", "summary", "brief", "memo", "briefing", "executive summary", "white paper", "whitepaper", "dossier", "business analysis", "financial summary", "market analysis", "competitive analysis"],
  files: ["file", "upload", "download", "drive", "google drive", "backup", "storage", "write file", "read file", "create file", "save file", "html", "mockup", "landing page", "homepage", "website"],
  workspace: ["calendar", "contacts", "sheets", "spreadsheet", "google docs", "gmail", "workspace", "schedule", "meeting", "appointment"],
  whatsapp: ["whatsapp", "wa", "text message", "messaging"],
  delivery: ["deliver", "delivery", "product", "send product", "digital product"],
  marketing: ["marketing", "social media", "tweet", "post", "content", "calendar", "campaign", "brand", "engagement", "twitter", "linkedin", "tiktok", "instagram", "image", "visual", "graphic", "publish", "compose", "create post", "generate image"],
  media: ["video", "audio", "narration", "voiceover", "tts", "text to speech", "voice over", "youtube", "ffmpeg", "mp4", "mp3", "record", "produce video", "create video", "make video", "assemble video", "generate audio", "thumbnail", "upload video", "stock photo", "stock image", "stock video", "stock footage", "pexels", "free image", "background image", "ken burns"],
  presentations: ["presentation", "slide deck", "slide", "slides", "powerpoint", "pptx", "keynote", "pitch deck", "meetup talk", "conference talk", "deck"],
  code: ["code", "execute", "run", "script", "programming", "python", "javascript", "shell", "terminal", "command", "build", "develop", "implement", "construct"],
  system: ["status", "health", "api key", "keys", "models", "providers", "system"],
  charts: ["chart", "graph", "plot", "visualize", "visualization", "data viz", "bar chart", "pie chart"],
  ai: ["delegate", "plan", "task", "workflow", "multi-step", "complex task", "lobster", "orchestrate", "corporation", "ceo", "coordinate", "multiple steps", "end to end"],
  crews: ["crew", "crews", "flow", "flows", "pipeline", "mind", "minds", "multi-agent", "team of agents", "agent team", "parallel agents", "sequential pipeline", "deliberation", "ticket"],
  tools: ["tool", "skill", "custom tool", "create tool", "manage skills", "skill seeker", "capability gap"],
  experiments: ["experiment", "improve", "self-improve", "evolve", "optimize", "a/b test", "eval", "evaluation", "sculptor", "review agent"],
  ideation: ["ideation", "ideate", "brainstorm", "idea", "innovation", "scamper", "first principles", "jobs to be done", "pre-mortem", "premortem", "how might we", "hmw", "product idea", "feature idea", "diverge", "converge", "one-pager"],
  legal: ["legal", "compliance", "regulation", "audit", "gdpr", "hipaa", "ccpa", "pci", "soc2", "ferpa", "coppa", "can-spam", "ada", "schema markup", "seo audit"],
  evidence: ["evidence", "citation", "claim", "source", "verify claim", "evidence store", "cited research", "synthesize research", "research evidence", "save evidence", "query evidence"],
  competitorIntel: ["competitor", "competitive", "competitor monitoring", "competitor tracking", "competitor watch", "competitor snapshot", "competitor changes", "competitor briefing", "competitive intelligence", "battle card"],
  leadEnrichment: ["enrich", "enrichment", "ICP", "ideal customer", "lead scoring", "score leads", "qualify leads", "lead qualification", "lead grading", "define icp"],
  outreachSequencing: ["sequence", "outreach sequence", "email sequence", "drip", "drip campaign", "cold outreach", "email cadence", "enroll", "enrollment", "follow-up sequence", "classify reply", "advance sequence"],
  userModeling: ["user model", "user profile", "preferences", "communication style", "how does the system adapt", "adapt to me", "personality", "user traits"],
  skillEvolution: ["tool performance", "tool optimization", "skill evolution", "underperforming tools", "tool failure", "optimize tools", "evolution cycle", "knowledge nudge", "nudge stats", "auto-saved knowledge"],
  scraping: ["scrape", "crawl", "firecrawl", "scraped", "site map"],
  diff: ["diff", "compare", "difference", "changes"],
  finance: ["stock", "stock price", "ticker", "market", "A-share", "Hong Kong stock", "finance news", "market news", "financial news", "market overview", "indices", "trading", "OHLCV", "candlestick", "market data", "stock data", "stock search", "Moutai", "Tencent", "market pulse", "market briefing", "forecast", "portfolio", "holdings", "diversification", "treasury", "concentration risk", "position sizing", "rebalance", "allocation", "equity", "ETF", "shares", "SMA", "volatility"],
  invoicing: ["invoice", "invoices", "billing", "bill", "receivable", "receivables", "aging", "overdue", "payment due", "accounts receivable", "ar", "net 30"],
  expenses: ["expense", "expenses", "spending", "cost", "costs", "receipt", "vendor payment", "accounts payable", "ap", "deductible", "tax deduction", "reimbursement", "expenditure"],
  crm: ["customer", "customers", "client", "clients", "prospect", "prospects", "lead", "leads", "pipeline", "deal", "sales pipeline", "crm", "contact", "follow up", "follow-up", "outreach", "relationship"],
  contracts: ["contract", "contracts", "agreement", "nda", "terms", "legal", "compliance", "signed", "signature"],
  kpi: ["kpi", "kpis", "metric", "metrics", "target", "targets", "goal", "goals", "performance", "indicator", "benchmark", "track", "tracking", "measure", "scorecard"],
  reporting: ["p&l", "profit", "loss", "profit and loss", "revenue", "cash flow", "financial report", "business health", "health score", "financial summary", "quarterly", "annual report", "balance sheet", "income statement", "bookkeeping", "accounting"],
  messaging: ["sms", "text message", "send message", "schedule message", "scheduled message", "twilio", "whatsapp", "messaging status", "outbound message", "send sms"],
  reasoning: ["think harder", "second opinion", "deep think", "ensemble", "cross-check", "cross check", "critique", "review my", "self-critique", "panel of experts", "multiple models", "consensus", "validate reasoning", "stress test this", "poke holes", "what am i missing", "audit reasoning", "audit my reasoning", "load-bearing", "load bearing", "decorative steps", "causal chain", "step audit", "verify math", "verify the math", "check arithmetic", "check the math", "math chain", "arithmetic chain", "recompute", "re-verify", "sanity check the numbers", "kismath", "reasoning audit"],
  design: ["figma", "figma.com", "design file", "design system", "mockup", "wireframe", "ui design", "design context", "node-id", "design token", "design tokens", "frame in figma", "figma node", "figjam"],
  // R96.1 — when a persona is mid-task and a website fights back, these
  // are the words that show up in the user's follow-up message OR in the
  // failed tool result the model is reasoning over. Routing this category
  // pulls in stealth_browse + stealth_browse_camofox + browser even if
  // the original task was "research" or "scrape", so the agent has the
  // escalation tier ready without needing to re-route.
  stealth: [
    "blocked", "403", "forbidden", "access denied",
    "cloudflare", "captcha", "recaptcha", "hcaptcha",
    "bot detection", "anti-scraping", "anti scraping", "anti-bot", "anti bot",
    "fingerprint", "headless detected", "browser fingerprint",
    "stealth", "stealth browse", "stealth browser", "camofox", "camoufox",
    "akamai", "datadome", "perimeterx", "incapsula", "kasada",
    "are you a robot", "are you human", "js challenge", "browser check",
    "rate limit", "too many requests", "429",
    "bypass", "evade detection", "real browser",
  ],
};

function extractUserMessage(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      if (typeof m.content === "string") return m.content.toLowerCase();
      if (Array.isArray(m.content)) {
        const textPart = m.content.find((p: any) => p.type === "text");
        if (textPart) return textPart.text.toLowerCase();
      }
    }
  }
  return "";
}

function scoreCategories(userMessage: string): Map<string, number> {
  const scores = new Map<string, number>();
  const msg = userMessage.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (msg.includes(kw)) {
        score += kw.includes(" ") ? 3 : 2;
      }
    }
    if (score > 0) scores.set(category, score);
  }

  return scores;
}

let lastClassificationCache: { msg: string; categories: string[]; ts: number } | null = null;

function getOperationForceCategories(userMsg: string): string[] {
  try {
    if (lastClassificationCache && lastClassificationCache.msg === userMsg && Date.now() - lastClassificationCache.ts < 5000) {
      return lastClassificationCache.categories;
    }

    const result = classifyRequest(userMsg);
    if (!result.operation || result.confidence < 0.2) {
      lastClassificationCache = { msg: userMsg, categories: [], ts: Date.now() };
      return [];
    }

    const toolChain = result.operation.toolChain;
    const forced = new Set<string>();
    for (const toolName of toolChain) {
      for (const [cat, tools] of Object.entries(TOOL_CATEGORIES)) {
        if (tools.includes(toolName)) {
          forced.add(cat);
        }
      }
    }
    const categories = [...forced];
    lastClassificationCache = { msg: userMsg, categories, ts: Date.now() };
    if (categories.length > 0) {
      console.log(`[tool-router-scaffold] Operation ${result.operation.operationId} → force categories: ${categories.join(",")}`);
    }
    return categories;
  } catch {
    return [];
  }
}

export function getPersonaPolicy(personaRole: string): { allowed: string[]; blocked: string[]; priority: string[] } | null {
  const role = personaRole.toLowerCase();
  for (const [key, policy] of Object.entries(PERSONA_TOOL_POLICIES)) {
    if (role.includes(key)) return policy;
  }
  return null;
}

export async function routeTools(
  allTools: ToolDefinition[],
  messages: any[],
  opts?: { maxTools?: number; forceCategories?: string[]; personaRole?: string; tenantId?: number }
): Promise<{ tools: ToolDefinition[]; matchedCategories: string[]; totalAvailable: number; curatorSignals?: { hintBoosts: number; semanticPicks: number; perfReranked: boolean; deprecatedDropped: number } }> {
  const maxTools = opts?.maxTools ?? 25;
  const userMsg = extractUserMessage(messages);
  const totalAvailable = allTools.length;

  if (!userMsg || userMsg.length < 3) {
    if (opts?.personaRole) {
      const policy = getPersonaPolicy(opts.personaRole);
      if (policy) {
        const priorityTools = new Set<string>(ALWAYS_INCLUDE);
        for (const cat of policy.priority) {
          const catTools = TOOL_CATEGORIES[cat] || [];
          for (const t of catTools) priorityTools.add(t);
        }
        for (const cat of policy.allowed) {
          const catTools = TOOL_CATEGORIES[cat] || [];
          for (const t of catTools) priorityTools.add(t);
          if (priorityTools.size >= maxTools) break;
        }
        let filtered = allTools.filter(t => priorityTools.has(t.function.name));
        if (filtered.length >= 5) {
          // R125+137.24 — hard cap (was: whole categories added, no slice-back).
          const capped = enforceToolCap(filtered, maxTools, ALWAYS_INCLUDE, priorityTools);
          if (capped.trimmed > 0) {
            console.log(`[tool-router] Persona pre-filter hard cap: trimmed ${capped.trimmed} overflow tools (${filtered.length}→${capped.tools.length}, max ${maxTools})`);
            filtered = capped.tools;
          }
          console.log(`[tool-router] Persona pre-filter (${opts.personaRole}): ${filtered.length}/${totalAvailable} tools`);
          return { tools: filtered, matchedCategories: [...policy.priority, "persona_filtered"], totalAvailable };
        }
      }
    }
    return { tools: allTools, matchedCategories: ["all"], totalAvailable };
  }

  const categoryScores = scoreCategories(userMsg);

  // R59 Curator: fold usage-hint matches into category scoring. A hinted
  // tool's matches boost its category by the hint score (capped) so the
  // router treats rich "use when" descriptions as additional triggers.
  let hintBoosts = 0;
  try {
    const hintMatches = matchHintsToMessage(userMsg);
    for (const [toolName, hintScore] of hintMatches) {
      hintBoosts++;
      for (const [cat, tools] of Object.entries(TOOL_CATEGORIES)) {
        if (tools.includes(toolName)) {
          const existing = categoryScores.get(cat) || 0;
          categoryScores.set(cat, existing + Math.min(8, hintScore));
        }
      }
    }
  } catch (err) {
    console.warn("[tool-router] hint expansion failed:", (err as Error).message);
  }

  if (opts?.personaRole) {
    const policy = getPersonaPolicy(opts.personaRole);
    if (policy) {
      for (const cat of policy.priority) {
        const existing = categoryScores.get(cat) || 0;
        categoryScores.set(cat, existing + 10);
      }
    }
  }

  if (opts?.forceCategories) {
    for (const fc of opts.forceCategories) {
      categoryScores.set(fc, 100);
    }
  }

  const opForce = getOperationForceCategories(userMsg);
  for (const fc of opForce) {
    if (!categoryScores.has(fc)) {
      categoryScores.set(fc, 50);
    }
  }

  if (categoryScores.size === 0) {
    return { tools: allTools, matchedCategories: ["all"], totalAvailable };
  }

  const sortedCategories = [...categoryScores.entries()]
    .sort((a, b) => b[1] - a[1]);

  const selectedToolNames = new Set<string>(ALWAYS_INCLUDE);
  const matchedCategories: string[] = [];

  for (const [category] of sortedCategories) {
    const categoryTools = TOOL_CATEGORIES[category] || [];
    matchedCategories.push(category);
    for (const toolName of categoryTools) {
      selectedToolNames.add(toolName);
    }

    if (selectedToolNames.size >= maxTools) break;
  }

  if (selectedToolNames.size < 8) {
    const relatedMap: Record<string, string[]> = {
      memory: ["knowledge", "notes"],
      knowledge: ["memory"],
      email: ["workspace"],
      marketing: ["web", "charts"],
      web: ["code", "pdf", "docs"],
      pdf: ["files", "presentations", "docs"],
      docs: ["files", "pdf", "presentations"],
      presentations: ["files", "pdf", "docs", "media"],
      workspace: ["email", "files"],
      sessions: ["ai", "crews"],
      ai: ["sessions", "code", "crews"],
      crews: ["ai", "sessions"],
      code: ["ai"],
      invoicing: ["reporting", "crm", "expenses"],
      expenses: ["reporting", "invoicing"],
      crm: ["invoicing", "reporting"],
      kpi: ["reporting", "charts"],
      reporting: ["kpi", "invoicing", "expenses", "finance", "pdf", "docs"],
      finance: ["reporting", "charts"],
      legal: ["contracts", "pdf"],
      contracts: ["legal", "crm"],
      evidence: ["web", "scraping"],
      ideation: ["web", "ai", "evidence"],
      competitorIntel: ["web", "scraping", "evidence"],
      leadEnrichment: ["crm", "outreachSequencing"],
      outreachSequencing: ["leadEnrichment", "email", "crm"],
      media: ["presentations", "files"],
      scraping: ["web", "competitorIntel"],
    };
    for (const cat of matchedCategories) {
      const related = relatedMap[cat] || [];
      for (const rc of related) {
        const rcTools = TOOL_CATEGORIES[rc] || [];
        for (const t of rcTools) selectedToolNames.add(t);
      }
    }
  }

  let filtered = allTools.filter(t => selectedToolNames.has(t.function.name));

  if (filtered.length < 5) {
    return { tools: allTools, matchedCategories: ["all"], totalAvailable };
  }

  // R59 Curator: drop soft-deprecated tools. They remain callable when
  // explicitly named via toolFilter or forceCategories, just not surfaced
  // to the model by default. SOFT_DEPRECATED_TOOLS is empty until we run
  // the 30d usage scan, so this is a no-op today.
  let deprecatedDropped = 0;
  try {
    const before = filtered.length;
    filtered = filterDeprecated(filtered);
    deprecatedDropped = before - filtered.length;
  } catch (err) {
    console.warn("[tool-router] deprecation filter failed:", (err as Error).message);
  }

  // R59 Curator: semantic fallback. If keyword routing produced a weak
  // signal (top category score < 5 AND no force-category hit AND no hint
  // boost), try to grab additional tools by embedding similarity. This
  // catches paraphrased requests the keyword router would miss.
  let semanticPicks = 0;
  const topCatScore = sortedCategories[0]?.[1] ?? 0;
  const hasStrongSignal = topCatScore >= 5 || (opts?.forceCategories?.length ?? 0) > 0 || hintBoosts > 0;
  if (!hasStrongSignal) {
    try {
      const semantic = await semanticRank(userMsg, { topK: 6, minScore: 0.30 });
      const semanticNames = new Set(semantic.map(s => s.name));
      const semanticAdds = allTools.filter(t => semanticNames.has(t.function.name) && !selectedToolNames.has(t.function.name));
      if (semanticAdds.length > 0) {
        filtered = [...filtered, ...semanticAdds];
        semanticPicks = semanticAdds.length;
        matchedCategories.push("semantic");
        for (const tool of semanticAdds) selectedToolNames.add(tool.function.name);
      }
    } catch (err) {
      console.warn("[tool-router] semantic fallback failed:", (err as Error).message);
    }
  }

  // R125+137.24 — hard cap enforcement (ChatGPT 5.6 review finding, verified):
  // the category loop above adds WHOLE categories and only breaks after the
  // selection already crossed maxTools; the related-category expansion and
  // semantic fallback can push further. Trim back to maxTools by priority
  // (Set insertion order: ALWAYS_INCLUDE → categories in score order →
  // related → semantic), never trimming the ALWAYS_INCLUDE safe set. The
  // "return allTools" escape hatches above are intentionally NOT capped —
  // they signal "routing produced no usable signal, give the model everything".
  let capTrimmed = 0;
  {
    const capped = enforceToolCap(filtered, maxTools, ALWAYS_INCLUDE, selectedToolNames);
    if (capped.trimmed > 0) {
      capTrimmed = capped.trimmed;
      filtered = capped.tools;
    }
  }

  // R59 Curator: re-rank by per-tenant performance score. ALWAYS_INCLUDE
  // tools stay at the top regardless (they're the safe fallback set);
  // remaining tools are stable-sorted by score. Tools with no history get
  // a neutral 0.5 so newcomers aren't penalised.
  let perfReranked = false;
  if (opts?.tenantId !== undefined) {
    try {
      const alwaysSet = new Set(ALWAYS_INCLUDE);
      const head = filtered.filter(t => alwaysSet.has(t.function.name));
      const tail = filtered.filter(t => !alwaysSet.has(t.function.name));
      const tailNames = tail.map(t => t.function.name);
      const rankedTailNames = await rankByPerformance(opts.tenantId, tailNames);
      const tailByName = new Map(tail.map(t => [t.function.name, t]));
      const rankedTail = rankedTailNames.map(n => tailByName.get(n)!).filter(Boolean);
      filtered = [...head, ...rankedTail];
      perfReranked = true;
    } catch (err) {
      console.warn("[tool-router] perf rerank failed:", (err as Error).message);
    }
  }

  console.log(`[tool-router] "${userMsg.slice(0, 60)}..." → ${matchedCategories.join(",")} (${filtered.length}/${totalAvailable} tools, hints:${hintBoosts}, sem:${semanticPicks}, rerank:${perfReranked}, dep:${deprecatedDropped}, capTrim:${capTrimmed}, ~${estimateSchemaTokens(filtered)} schema tok)`);

  return {
    tools: filtered,
    matchedCategories,
    totalAvailable,
    curatorSignals: { hintBoosts, semanticPicks, perfReranked, deprecatedDropped },
  };
}
