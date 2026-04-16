import { buildCategoryMap, auditRegistry } from "./tool-registry";

type ToolDefinition = { type: "function"; function: { name: string; description: string; parameters: any } };

const PERSONA_TOOL_POLICIES: Record<string, { allowed: string[]; blocked: string[]; priority: string[] }> = {
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
  if (critical.length > 0) {
    console.warn(`[tool-registry] ${critical.length} tool(s) missing from registry — they won't be routed to agents. Add them via registerTool() in server/tool-registry.ts`);
  } else {
    console.log(`[tool-registry] Audit passed: all tool definitions have registry entries${info.length > 0 ? ` (${info.length} registry-only entries)` : ""}`);
  }
}

const ALWAYS_INCLUDE = new Set(["search_memory", "create_memory", "recall_context", "query_triples", "store_triple", "orchestrate", "delegate_task", "project", "write_file", "read_file"]);

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  memory: ["remember", "recall", "memory", "memories", "forget", "store", "save this", "what do you know about"],
  knowledge: ["knowledge", "document", "docs", "documentation", "search docs", "find in docs", "doc collection", "triple", "entity", "relationship", "fact", "when was", "who is", "what changed"],
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
  finance: ["stock", "stock price", "ticker", "market", "A-share", "Hong Kong stock", "finance news", "market news", "financial news", "market overview", "indices", "trading", "OHLCV", "candlestick", "market data", "stock data", "stock search", "Moutai", "Tencent", "market pulse", "market briefing"],
  invoicing: ["invoice", "invoices", "billing", "bill", "receivable", "receivables", "aging", "overdue", "payment due", "accounts receivable", "ar", "net 30"],
  expenses: ["expense", "expenses", "spending", "cost", "costs", "receipt", "vendor payment", "accounts payable", "ap", "deductible", "tax deduction", "reimbursement", "expenditure"],
  crm: ["customer", "customers", "client", "clients", "prospect", "prospects", "lead", "leads", "pipeline", "deal", "sales pipeline", "crm", "contact", "follow up", "follow-up", "outreach", "relationship"],
  contracts: ["contract", "contracts", "agreement", "nda", "terms", "legal", "compliance", "signed", "signature"],
  kpi: ["kpi", "kpis", "metric", "metrics", "target", "targets", "goal", "goals", "performance", "indicator", "benchmark", "track", "tracking", "measure", "scorecard"],
  reporting: ["p&l", "profit", "loss", "profit and loss", "revenue", "cash flow", "financial report", "business health", "health score", "financial summary", "quarterly", "annual report", "balance sheet", "income statement", "bookkeeping", "accounting"],
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

    const { classifyRequest } = require("./scaffolding");
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

export function routeTools(
  allTools: ToolDefinition[],
  messages: any[],
  opts?: { maxTools?: number; forceCategories?: string[]; personaRole?: string }
): { tools: ToolDefinition[]; matchedCategories: string[]; totalAvailable: number } {
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
        const filtered = allTools.filter(t => priorityTools.has(t.function.name));
        if (filtered.length >= 5) {
          console.log(`[tool-router] Persona pre-filter (${opts.personaRole}): ${filtered.length}/${totalAvailable} tools`);
          return { tools: filtered, matchedCategories: [...policy.priority, "persona_filtered"], totalAvailable };
        }
      }
    }
    return { tools: allTools, matchedCategories: ["all"], totalAvailable };
  }

  const categoryScores = scoreCategories(userMsg);

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

  const filtered = allTools.filter(t => selectedToolNames.has(t.function.name));

  if (filtered.length < 5) {
    return { tools: allTools, matchedCategories: ["all"], totalAvailable };
  }

  console.log(`[tool-router] "${userMsg.slice(0, 60)}..." → ${matchedCategories.join(",")} (${filtered.length}/${totalAvailable} tools)`);

  return { tools: filtered, matchedCategories, totalAvailable };
}
