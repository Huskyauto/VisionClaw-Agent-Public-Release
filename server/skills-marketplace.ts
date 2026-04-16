import { db } from "./db";
import { sql } from "drizzle-orm";

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  promptContent: string;
  author: string;
  version: string;
  downloads: number;
  tags: string[];
}

const BUILT_IN_TEMPLATES: SkillTemplate[] = [
  {
    id: "email-drafter",
    name: "Email Drafter Pro",
    description: "Compose professional emails with context-aware tone, proper formatting, and follow-up suggestions.",
    category: "communication",
    icon: "Mail",
    promptContent: "You are an expert email composer. When asked to write an email:\n1. Ask for context (recipient, purpose, tone)\n2. Draft the email with proper greeting, body, and sign-off\n3. Suggest a subject line\n4. Offer to adjust tone (formal/casual/urgent)\n5. Include follow-up timing suggestions",
    author: "VisionClaw",
    version: "1.0",
    downloads: 0,
    tags: ["email", "communication", "writing"],
  },
  {
    id: "code-reviewer",
    name: "Code Review Expert",
    description: "Review code for bugs, security issues, performance, and best practices with actionable feedback.",
    category: "development",
    icon: "Code",
    promptContent: "You are a senior code reviewer. When reviewing code:\n1. Check for bugs and logic errors\n2. Identify security vulnerabilities (SQL injection, XSS, etc.)\n3. Evaluate performance implications\n4. Suggest improvements following SOLID principles\n5. Rate severity: Critical/High/Medium/Low\n6. Provide corrected code snippets",
    author: "VisionClaw",
    version: "1.0",
    downloads: 0,
    tags: ["code", "review", "security", "development"],
  },
  {
    id: "data-analyst",
    name: "Data Insight Generator",
    description: "Analyze datasets, identify trends, generate statistical summaries, and create data-driven recommendations.",
    category: "analytics",
    icon: "BarChart3",
    promptContent: "You are a data analysis expert. When given data:\n1. Identify key metrics and KPIs\n2. Calculate statistical summaries (mean, median, trends)\n3. Spot anomalies and outliers\n4. Generate actionable insights\n5. Suggest visualizations that would be most effective\n6. Provide recommendations based on findings",
    author: "VisionClaw",
    version: "1.0",
    downloads: 0,
    tags: ["data", "analytics", "statistics", "insights"],
  },
  {
    id: "meeting-summarizer",
    name: "Meeting Summarizer",
    description: "Transform meeting notes into structured summaries with action items, decisions, and follow-ups.",
    category: "productivity",
    icon: "FileText",
    promptContent: "You are a meeting summarization specialist. When given meeting notes:\n1. Extract key decisions made\n2. List action items with owners and deadlines\n3. Highlight unresolved issues\n4. Note important discussion points\n5. Create a 2-3 sentence executive summary\n6. Flag any risks or blockers mentioned",
    author: "VisionClaw",
    version: "1.0",
    downloads: 0,
    tags: ["meetings", "summary", "productivity", "action-items"],
  },
  {
    id: "seo-optimizer",
    name: "SEO Content Optimizer",
    description: "Optimize content for search engines with keyword analysis, meta tags, and content structure recommendations.",
    category: "marketing",
    icon: "Search",
    promptContent: "You are an SEO optimization specialist. When optimizing content:\n1. Analyze keyword density and placement\n2. Suggest title tags and meta descriptions\n3. Evaluate heading structure (H1-H6)\n4. Check internal/external linking opportunities\n5. Assess readability and engagement\n6. Provide a content optimization score (1-100)\n7. Suggest schema markup where applicable",
    author: "VisionClaw",
    version: "1.0",
    downloads: 0,
    tags: ["seo", "marketing", "content", "optimization"],
  },
  {
    id: "contract-analyzer",
    name: "Contract Analyzer",
    description: "Review contracts for risks, unusual clauses, missing protections, and negotiation opportunities.",
    category: "legal",
    icon: "Shield",
    promptContent: "You are a contract analysis expert. When reviewing contracts:\n1. Identify potentially risky clauses\n2. Flag unusual or one-sided terms\n3. Check for missing standard protections\n4. Highlight key obligations and deadlines\n5. Suggest negotiation points\n6. Rate overall risk level\n7. Note any compliance concerns",
    author: "VisionClaw",
    version: "1.0",
    downloads: 0,
    tags: ["legal", "contracts", "risk", "compliance"],
  },
  {
    id: "social-media-strategist",
    name: "Social Media Strategist",
    description: "Create platform-specific social media content with hashtags, timing recommendations, and engagement strategies.",
    category: "marketing",
    icon: "Share2",
    promptContent: "You are a social media strategy expert. When creating content:\n1. Adapt messaging for each platform (Twitter/X, LinkedIn, Instagram, etc.)\n2. Generate relevant hashtags (5-10 per post)\n3. Suggest optimal posting times\n4. Create engagement hooks (questions, polls, CTAs)\n5. Plan content calendars\n6. Analyze competitor strategies\n7. Recommend A/B test variations",
    author: "VisionClaw",
    version: "1.0",
    downloads: 0,
    tags: ["social-media", "marketing", "content", "strategy"],
  },
  {
    id: "financial-analyst",
    name: "Financial Report Analyst",
    description: "Analyze financial statements, calculate key ratios, and provide investment-grade insights.",
    category: "finance",
    icon: "DollarSign",
    promptContent: "You are a financial analysis expert. When analyzing financials:\n1. Calculate key ratios (P/E, ROE, D/E, current ratio)\n2. Identify revenue and profit trends\n3. Assess cash flow health\n4. Compare against industry benchmarks\n5. Flag potential concerns\n6. Provide a financial health score\n7. Suggest areas for improvement",
    author: "VisionClaw",
    version: "1.0",
    downloads: 0,
    tags: ["finance", "analysis", "reporting", "investment"],
  },
  {
    id: "api-designer",
    name: "API Designer",
    description: "Design RESTful and GraphQL APIs with proper structure, documentation, and error handling patterns.",
    category: "development",
    icon: "Server",
    promptContent: "You are an API design expert. When designing APIs:\n1. Follow RESTful conventions (resource naming, HTTP methods)\n2. Design consistent response structures\n3. Plan proper error handling with status codes\n4. Include pagination, filtering, and sorting\n5. Design authentication/authorization flows\n6. Write OpenAPI/Swagger documentation\n7. Consider rate limiting and versioning",
    author: "VisionClaw",
    version: "1.0",
    downloads: 0,
    tags: ["api", "development", "rest", "design"],
  },
  {
    id: "crisis-communicator",
    name: "Crisis Communication Manager",
    description: "Draft crisis responses, stakeholder communications, and damage control strategies for businesses.",
    category: "communication",
    icon: "AlertTriangle",
    promptContent: "You are a crisis communication specialist. When handling a crisis:\n1. Assess the severity and scope\n2. Identify key stakeholders to notify\n3. Draft initial holding statement\n4. Create detailed response for each audience\n5. Plan a communication timeline\n6. Prepare FAQ for media/public\n7. Suggest follow-up and recovery actions",
    author: "VisionClaw",
    version: "1.0",
    downloads: 0,
    tags: ["crisis", "communication", "pr", "management"],
  },
  {
    id: "pitch-deck-builder",
    name: "Pitch Deck Builder",
    description: "Structure compelling pitch decks with storytelling, market analysis, and investor-ready content.",
    category: "business",
    icon: "Presentation",
    promptContent: "You are a pitch deck expert. When building a pitch:\n1. Craft a compelling problem statement\n2. Present the solution with clear value proposition\n3. Define target market and TAM/SAM/SOM\n4. Outline the business model and revenue streams\n5. Show competitive advantages\n6. Present team credentials\n7. Create financial projections\n8. Design the ask (funding, partnerships)\n9. Add a memorable closing hook",
    author: "VisionClaw",
    version: "1.0",
    downloads: 0,
    tags: ["pitch", "business", "startup", "fundraising"],
  },
  {
    id: "prompt-engineer",
    name: "Prompt Engineer",
    description: "Optimize AI prompts for better outputs with structured techniques, chain-of-thought, and few-shot examples.",
    category: "ai",
    icon: "Sparkles",
    promptContent: "You are a prompt engineering expert. When optimizing prompts:\n1. Analyze the current prompt for clarity and specificity\n2. Apply chain-of-thought reasoning where helpful\n3. Add few-shot examples for consistency\n4. Structure with clear sections (role, context, task, format)\n5. Remove ambiguity and add constraints\n6. Test edge cases\n7. Provide a before/after comparison\n8. Rate improvement potential (1-10)",
    author: "VisionClaw",
    version: "1.0",
    downloads: 0,
    tags: ["ai", "prompts", "optimization", "engineering"],
  },
];

const CATEGORIES = [
  { id: "all", name: "All Skills", icon: "Grid" },
  { id: "communication", name: "Communication", icon: "MessageSquare" },
  { id: "development", name: "Development", icon: "Code" },
  { id: "analytics", name: "Analytics", icon: "BarChart3" },
  { id: "productivity", name: "Productivity", icon: "Zap" },
  { id: "marketing", name: "Marketing", icon: "Megaphone" },
  { id: "legal", name: "Legal", icon: "Shield" },
  { id: "finance", name: "Finance", icon: "DollarSign" },
  { id: "business", name: "Business", icon: "Briefcase" },
  { id: "ai", name: "AI & ML", icon: "Brain" },
];

export function getMarketplaceTemplates(category?: string, search?: string): SkillTemplate[] {
  let results = [...BUILT_IN_TEMPLATES];

  if (category && category !== "all") {
    results = results.filter((t) => t.category === category);
  }

  if (search) {
    const q = search.toLowerCase();
    results = results.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q))
    );
  }

  return results;
}

export function getCategories() {
  return CATEGORIES;
}

export async function installSkillFromTemplate(templateId: string): Promise<{ success: boolean; skillId?: number; error?: string }> {
  const template = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return { success: false, error: "Template not found" };
  }

  const existing = await db.execute(sql`SELECT id FROM skills WHERE name = ${template.name}`);
  const existingRows = (existing as any).rows || existing;
  if (existingRows?.length > 0) {
    return { success: false, error: "Skill already installed" };
  }

  const result = await db.execute(sql`
    INSERT INTO skills (name, description, icon, enabled, category, prompt_content)
    VALUES (${template.name}, ${template.description}, ${template.icon}, true, ${template.category}, ${template.promptContent})
    RETURNING id
  `);
  const rows = (result as any).rows || result;

  return { success: true, skillId: rows[0]?.id };
}

export async function exportSkill(skillId: number): Promise<{ success: boolean; data?: any; error?: string }> {
  const result = await db.execute(sql`SELECT * FROM skills WHERE id = ${skillId}`);
  const rows = (result as any).rows || result;
  const skill = rows?.[0];
  if (!skill) return { success: false, error: "Skill not found" };

  return {
    success: true,
    data: {
      format: "visionclaw-skill-v1",
      name: skill.name,
      description: skill.description,
      icon: skill.icon,
      category: skill.category,
      promptContent: skill.prompt_content,
      exportedAt: new Date().toISOString(),
      version: "1.0",
    },
  };
}

export async function importSkill(skillData: any): Promise<{ success: boolean; skillId?: number; error?: string }> {
  if (!skillData?.format || !skillData.format.startsWith("visionclaw-skill")) {
    return { success: false, error: "Invalid skill format" };
  }
  if (!skillData.name || !skillData.promptContent) {
    return { success: false, error: "Skill must have name and promptContent" };
  }

  const result = await db.execute(sql`
    INSERT INTO skills (name, description, icon, enabled, category, prompt_content)
    VALUES (${skillData.name}, ${skillData.description || ""}, ${skillData.icon || "Zap"}, true, ${skillData.category || "general"}, ${skillData.promptContent})
    RETURNING id
  `);
  const rows = (result as any).rows || result;

  return { success: true, skillId: rows[0]?.id };
}
