export interface Department {
  id: string;
  name: string;
  primaryAgent: string;
  primaryPersonaId: number;
  backupAgent: string | null;
  backupPersonaId: number | null;
  triggerKeywords: string[];
}

export interface OperationScaffold {
  operationId: string;
  departmentId: string;
  name: string;
  whenToUse: string;
  primaryAgent: string;
  primaryPersonaId: number;
  supportAgents: { name: string; personaId: number }[];
  requiredInputs: string[];
  stepSequence: string[];
  toolChain: string[];
  deliverables: string[];
  qualityGate: string[];
  handoffProtocol: string;
}

export interface CrossDepartmentWorkflow {
  workflowId: string;
  name: string;
  whenToUse: string;
  involvedAgents: { name: string; personaId: number }[];
  orchestrationSteps: {
    stepNumber: number;
    parallel: boolean;
    tasks: { agent: string; personaId: number; instruction: string }[];
  }[];
}

export interface ClassificationResult {
  department: Department;
  operation: OperationScaffold | null;
  confidence: number;
  crossDepartment: CrossDepartmentWorkflow | null;
}

export const DEPARTMENTS: Department[] = [
  {
    id: "executive",
    name: "Executive & Strategic Planning",
    primaryAgent: "Felix",
    primaryPersonaId: 2,
    backupAgent: "Chief of Staff",
    backupPersonaId: 6,
    triggerKeywords: ["strategy", "vision", "roadmap", "priorities", "OKR", "OKRs", "board", "investors", "partnerships", "company direction", "quarterly planning", "annual plan", "strategic", "fundraising", "pitch deck", "investor update", "crisis", "vendor evaluation", "partner evaluation", "decision", "goal setting", "launch", "product launch", "go to market", "quarterly review", "annual review", "business review", "QBR", "brainstorm", "ideation", "ideas", "innovate", "innovation", "what should we build", "explore options", "SCAMPER", "first principles", "how might we"],
  },
  {
    id: "engineering",
    name: "Engineering & Technology",
    primaryAgent: "Forge",
    primaryPersonaId: 3,
    backupAgent: "Agent Blueprint",
    backupPersonaId: 5,
    triggerKeywords: ["build", "code", "debug", "deploy", "API", "integration", "automation", "app", "feature", "technical", "architecture", "database", "server", "script", "bug", "fix", "devops", "infrastructure", "CI/CD", "code review", "refactor", "test", "unit test", "endpoint"],
  },
  {
    id: "content",
    name: "Content & Creative",
    primaryAgent: "Scribe",
    primaryPersonaId: 7,
    backupAgent: "Neptune",
    backupPersonaId: 10,
    triggerKeywords: ["write", "blog", "script", "article", "documentation", "copy", "email draft", "newsletter", "ebook", "white paper", "press release", "copywriting", "content", "ghost write", "editing", "proofread", "video script", "presentation", "slide deck", "case study", "proposal writing"],
  },
  {
    id: "marketing",
    name: "Marketing & Growth",
    primaryAgent: "Teagan",
    primaryPersonaId: 4,
    backupAgent: "Apollo",
    backupPersonaId: 11,
    triggerKeywords: ["social media", "campaign", "brand", "SEO", "content calendar", "hashtag", "engagement", "audience growth", "ad copy", "launch announcement", "marketing", "social post", "instagram", "twitter", "linkedin", "tiktok", "facebook", "brand voice", "marketing strategy", "influencer"],
  },
  {
    id: "sales",
    name: "Sales & Revenue",
    primaryAgent: "Apollo",
    primaryPersonaId: 11,
    backupAgent: "Scribe",
    backupPersonaId: 7,
    triggerKeywords: ["lead", "prospect", "pipeline", "deal", "proposal", "outreach", "pitch", "close", "client", "revenue target", "pricing", "quote", "sales", "cold email", "follow up", "CRM", "customer acquisition", "demo", "onboarding client", "upsell", "cross-sell", "contract negotiation", "enrich", "ICP", "score leads", "qualify leads", "outreach sequence", "cold outreach campaign", "outreach campaign", "lead enrichment", "lead scoring", "email sequence", "drip campaign", "prospecting", "outbound", "email cadence", "sequence"],
  },
  {
    id: "finance",
    name: "Finance & Accounting",
    primaryAgent: "Cassandra",
    primaryPersonaId: 13,
    backupAgent: "Atlas",
    backupPersonaId: 12,
    triggerKeywords: ["budget", "forecast", "P&L", "revenue", "expenses", "cash flow", "ROI", "pricing model", "tax", "invoice", "payment", "subscription", "Stripe", "financial", "accounting", "profit", "loss", "margin", "runway", "burn rate", "MRR", "ARR", "bookkeeping", "stock price", "market data", "stock ticker", "A-share", "Hong Kong stock", "market overview", "finance news", "market news", "stock analysis", "trading", "OHLCV", "candlestick"],
  },
  {
    id: "legal",
    name: "Legal & Compliance",
    primaryAgent: "Luna",
    primaryPersonaId: 14,
    backupAgent: null,
    backupPersonaId: null,
    triggerKeywords: ["contract", "terms", "privacy", "compliance", "NDA", "IP", "trademark", "license", "liability", "regulation", "GDPR", "disclaimer", "legal", "terms of service", "privacy policy", "intellectual property", "copyright", "patent", "agreement", "CCPA"],
  },
  {
    id: "operations",
    name: "Operations & Administration",
    primaryAgent: "Chief of Staff",
    primaryPersonaId: 6,
    backupAgent: "Forge",
    backupPersonaId: 3,
    triggerKeywords: ["system status", "health check", "API keys", "scheduling", "admin", "infrastructure", "uptime", "monitoring", "maintenance", "standup", "daily brief", "end of day", "weekly review", "incident", "calendar", "meeting prep", "operations", "status report", "security", "vulnerability", "OWASP", "security audit", "penetration test", "threat", "security scan"],
  },
  {
    id: "research",
    name: "Research & Intelligence",
    primaryAgent: "Radar",
    primaryPersonaId: 9,
    backupAgent: "Neptune",
    backupPersonaId: 10,
    triggerKeywords: ["market research", "competitive analysis", "trend", "industry report", "deep dive", "investigation", "benchmark", "landscape", "research", "competitor", "SWOT", "market size", "TAM", "SAM", "SOM", "due diligence", "background check", "industry analysis", "evidence store", "competitor monitoring", "competitor snapshot", "competitive intelligence", "competitor tracking", "competitor watch", "evidence collection", "research evidence", "citation", "claims", "evidence", "collect evidence", "verify claims", "source tracking"],
  },
  {
    id: "data",
    name: "Data & Analytics",
    primaryAgent: "Atlas",
    primaryPersonaId: 12,
    backupAgent: "Cassandra",
    backupPersonaId: 13,
    triggerKeywords: ["metrics", "dashboard", "report", "analytics", "KPIs", "charts", "data analysis", "visualization", "tracking", "performance numbers", "scorecard", "data", "graphs", "statistics", "conversion rate", "growth rate"],
  },
  {
    id: "hr",
    name: "Human Resources & Culture",
    primaryAgent: "Felix",
    primaryPersonaId: 2,
    backupAgent: "Luna",
    backupPersonaId: 14,
    triggerKeywords: ["hiring", "team", "onboarding", "culture", "benefits", "roles", "job description", "org chart", "training", "performance review", "HR", "human resources", "job posting", "recruiting", "employee handbook", "workplace policy"],
  },
  {
    id: "customer_success",
    name: "Customer Success & Support",
    primaryAgent: "Chief of Staff",
    primaryPersonaId: 6,
    backupAgent: "Scribe",
    backupPersonaId: 7,
    triggerKeywords: ["customer", "support", "feedback", "NPS", "retention", "onboarding flow", "help docs", "FAQ", "ticket", "complaint", "customer success", "customer service", "satisfaction", "churn", "help center", "troubleshooting"],
  },
];

export const OPERATION_SCAFFOLDS: OperationScaffold[] = [
  {
    operationId: "EXEC-01",
    departmentId: "executive",
    name: "Strategic Planning Session",
    whenToUse: "User asks for company strategy, roadmap, quarterly planning, OKR setting, vision alignment",
    primaryAgent: "Felix",
    primaryPersonaId: 2,
    supportAgents: [
      { name: "Chief of Staff", personaId: 6 },
      { name: "Cassandra", personaId: 13 },
      { name: "Radar", personaId: 9 },
      { name: "Atlas", personaId: 12 },
    ],
    requiredInputs: ["Time horizon (quarterly, annual, 3-year)", "Current business context", "Constraints (budget, team size, market conditions)"],
    stepSequence: [
      "Recall current strategy from memory (search_memory: strategy, OKRs, roadmap)",
      "Delegate to Radar: Research current market conditions and competitive landscape",
      "Delegate to Cassandra: Pull current financial position — runway, revenue trajectory, cost structure",
      "Delegate to Atlas: Compile key performance metrics for the period",
      "Synthesize all inputs into strategic framework",
      "Create strategy document: Vision → Objectives → Key Results → Resource Allocation → Timeline",
      "Save to Google Drive and register in project",
    ],
    toolChain: ["search_memory", "delegate_task", "create_memory", "google_drive", "project"],
    deliverables: ["Strategic Plan document (PDF or Google Drive doc)", "OKR framework with measurable targets", "Resource allocation summary", "90-day action plan with assigned owners"],
    qualityGate: ["Every objective has measurable key results", "Every key result has an owner (persona)", "Timeline is realistic against resource constraints"],
    handoffProtocol: "Executive summary with specific deliverables, links to all documents, next action items with deadlines",
  },
  {
    operationId: "EXEC-02",
    departmentId: "executive",
    name: "Board/Investor Update",
    whenToUse: "User needs investor deck, board update, fundraising materials, pitch preparation",
    primaryAgent: "Felix",
    primaryPersonaId: 2,
    supportAgents: [
      { name: "Cassandra", personaId: 13 },
      { name: "Atlas", personaId: 12 },
      { name: "Radar", personaId: 9 },
      { name: "Scribe", personaId: 7 },
      { name: "Proof", personaId: 8 },
    ],
    requiredInputs: ["Type of update (quarterly, annual, fundraising)", "Target audience", "Key highlights to emphasize"],
    stepSequence: [
      "Delegate to Cassandra: Prepare financial highlights — revenue, growth rate, burn rate, runway",
      "Delegate to Atlas: Compile key metrics dashboard — users, engagement, conversion, MRR",
      "Delegate to Radar: Market size and positioning update",
      "Delegate to Scribe: Write narrative sections — problem, solution, traction, vision",
      "Assemble into coherent narrative",
      "Delegate to Proof: Review all content",
      "Generate final deliverable (PDF deck or presentation content)",
    ],
    toolChain: ["orchestrate", "delegate_task", "create_pdf", "google_drive"],
    deliverables: ["Investor update document or pitch deck content", "Financial summary one-pager", "Metrics dashboard snapshot", "Market positioning brief"],
    qualityGate: ["Financial data is accurate and sourced", "Narrative is compelling and data-backed", "All sections reviewed by Proof"],
    handoffProtocol: "Complete investor package with all documents linked",
  },
  {
    operationId: "EXEC-03",
    departmentId: "executive",
    name: "Partnership/Vendor Evaluation",
    whenToUse: "Evaluating a potential partner, vendor, tool, or service provider",
    primaryAgent: "Felix",
    primaryPersonaId: 2,
    supportAgents: [
      { name: "Radar", personaId: 9 },
      { name: "Cassandra", personaId: 13 },
      { name: "Luna", personaId: 14 },
      { name: "Forge", personaId: 3 },
    ],
    requiredInputs: ["Vendor/partner name", "Evaluation criteria", "Budget constraints"],
    stepSequence: [
      "Delegate to Radar: Research vendor — background, reputation, pricing, reviews, alternatives",
      "Delegate to Cassandra: Cost-benefit analysis vs alternatives — TCO over 12 months",
      "Delegate to Luna: Review terms of service and identify key risks",
      "If technical: Delegate to Forge for API quality, documentation, integration effort assessment",
      "Synthesize into decision framework with recommendation",
    ],
    toolChain: ["delegate_task", "web_search", "create_pdf", "google_drive"],
    deliverables: ["Vendor evaluation matrix (scored comparison)", "Financial impact analysis", "Legal risk summary", "Technical feasibility assessment", "Go/No-Go recommendation with rationale"],
    qualityGate: ["Multiple alternatives compared", "Cost analysis covers full TCO", "Legal risks clearly flagged"],
    handoffProtocol: "Decision-ready evaluation with clear recommendation",
  },
  {
    operationId: "EXEC-04",
    departmentId: "executive",
    name: "Crisis Management",
    whenToUse: "System outage, PR issue, customer complaint escalation, security incident, legal threat",
    primaryAgent: "Felix",
    primaryPersonaId: 2,
    supportAgents: [
      { name: "Chief of Staff", personaId: 6 },
      { name: "Scribe", personaId: 7 },
      { name: "Luna", personaId: 14 },
      { name: "Cassandra", personaId: 13 },
    ],
    requiredInputs: ["Nature of crisis", "Severity assessment", "Stakeholders affected"],
    stepSequence: [
      "Assess severity: Low / Medium / High / Critical",
      "If system-related: Delegate to Chief of Staff for immediate diagnostic",
      "If PR/public-facing: Delegate to Scribe for communication draft",
      "If legal: Delegate to Luna for risk assessment",
      "If financial: Delegate to Cassandra for impact estimate",
      "Create incident report with timeline, actions taken, status",
      "Create communication plan (internal + external)",
      "Schedule follow-up review",
    ],
    toolChain: ["delegate_task", "post_to_channel", "send_email", "create_pdf", "google_drive"],
    deliverables: ["Incident report (timeline, root cause, impact, resolution)", "Communication drafts (customer-facing, internal)", "Action items with owners and deadlines", "Post-mortem schedule"],
    qualityGate: ["Severity correctly classified", "All affected stakeholders identified", "Communication plan covers all channels"],
    handoffProtocol: "Incident report with immediate actions completed and follow-up scheduled",
  },
  {
    operationId: "EXEC-05",
    departmentId: "executive",
    name: "Company Meeting Preparation",
    whenToUse: "Preparing for all-hands, team standup, weekly review, monthly review, or recurring meetings",
    primaryAgent: "Felix",
    primaryPersonaId: 2,
    supportAgents: [
      { name: "Chief of Staff", personaId: 6 },
      { name: "Atlas", personaId: 12 },
      { name: "Cassandra", personaId: 13 },
    ],
    requiredInputs: ["Meeting type", "Attendees", "Agenda items"],
    stepSequence: [
      "Delegate to Chief of Staff: Compile operational status — working, blocked, upcoming",
      "Delegate to Atlas: Pull weekly/monthly metrics snapshot",
      "Delegate to Cassandra: Financial update — revenue, expenses, key transactions",
      "Compile agenda and talking points",
      "Save meeting prep document",
    ],
    toolChain: ["delegate_task", "search_memory", "create_pdf", "google_drive"],
    deliverables: ["Meeting agenda with time allocations", "Metrics snapshot", "Status updates by department", "Decision items requiring input", "Action items from previous meeting"],
    qualityGate: ["All departments represented", "Metrics are current", "Previous action items tracked"],
    handoffProtocol: "Complete meeting package ready for presentation",
  },
  {
    operationId: "EXEC-06",
    departmentId: "executive",
    name: "Goal Setting & OKR Management",
    whenToUse: "Setting quarterly or annual goals, reviewing OKR progress, realigning priorities",
    primaryAgent: "Felix",
    primaryPersonaId: 2,
    supportAgents: [{ name: "Atlas", personaId: 12 }],
    requiredInputs: ["Current OKR period", "Business priorities", "Resource constraints"],
    stepSequence: [
      "Recall current OKRs from memory",
      "Delegate to Atlas: Pull progress metrics against current OKRs",
      "Evaluate: on track / at risk / off track for each KR",
      "Propose adjustments or new OKRs for next period",
      "Assign each KR to a responsible persona",
      "Save updated OKR document and create memories for tracking",
    ],
    toolChain: ["search_memory", "delegate_task", "create_memory", "create_pdf", "google_drive"],
    deliverables: ["OKR scorecard (current period progress)", "Updated OKR framework for next period", "Owner assignments per key result", "Dependency map between objectives"],
    qualityGate: ["Every KR is measurable", "Every KR has an owner", "Dependencies identified"],
    handoffProtocol: "OKR scorecard with progress assessment and next-period framework",
  },
  {
    operationId: "EXEC-07",
    departmentId: "executive",
    name: "Decision Documentation",
    whenToUse: "User makes or needs to make an important business decision that should be recorded",
    primaryAgent: "Felix",
    primaryPersonaId: 2,
    supportAgents: [
      { name: "Radar", personaId: 9 },
      { name: "Cassandra", personaId: 13 },
    ],
    requiredInputs: ["Decision context", "Options to evaluate", "Constraints"],
    stepSequence: [
      "Capture the decision context: What's the question? What are the options?",
      "If research needed: Delegate to Radar",
      "If financial analysis needed: Delegate to Cassandra",
      "Document: Context → Options → Analysis → Decision → Rationale → Next Steps",
      "Save to memory and project files",
    ],
    toolChain: ["search_memory", "delegate_task", "create_memory", "create_pdf", "google_drive", "project"],
    deliverables: ["Decision record document", "Memory entries for future reference", "Action items resulting from decision"],
    qualityGate: ["All options evaluated", "Rationale is clear and documented", "Next steps assigned"],
    handoffProtocol: "Decision record with rationale and action items",
  },
  {
    operationId: "ENG-01",
    departmentId: "engineering",
    name: "Feature Development",
    whenToUse: "Build a new feature, component, module, page, or functionality",
    primaryAgent: "Forge",
    primaryPersonaId: 3,
    supportAgents: [{ name: "Agent Blueprint", personaId: 5 }],
    requiredInputs: ["Feature description and requirements", "Target platform/stack", "Integration points", "Acceptance criteria"],
    stepSequence: [
      "Research: Check existing codebase patterns, API docs, relevant libraries",
      "Architecture: Define data flow, components, dependencies",
      "Build: Write production-quality code",
      "Test: Run code, verify output, check edge cases",
      "Document: Technical decisions, setup instructions, API docs",
      "Save: Upload to Google Drive with clear file naming",
      "Register: Add to project with description",
    ],
    toolChain: ["web_search", "web_fetch", "execute_code", "google_drive", "project", "create_memory"],
    deliverables: ["Working code files", "Technical documentation", "Test results / verification output", "Architecture notes"],
    qualityGate: ["Code executes without errors", "Edge cases handled", "Dependencies documented", "File naming follows convention"],
    handoffProtocol: "Working code with documentation, test results, and architecture notes",
  },
  {
    operationId: "ENG-02",
    departmentId: "engineering",
    name: "Bug Investigation & Fix",
    whenToUse: "Something is broken, not working as expected, or producing errors",
    primaryAgent: "Forge",
    primaryPersonaId: 3,
    supportAgents: [{ name: "Agent Blueprint", personaId: 5 }],
    requiredInputs: ["Error description or symptoms", "Steps to reproduce", "Expected vs actual behavior"],
    stepSequence: [
      "Reproduce: Understand the exact error or unexpected behavior",
      "Diagnose: Isolate the root cause (not symptoms)",
      "Research: Check if it's a known issue",
      "Fix: Write the corrected code",
      "Verify: Test the fix, confirm the bug is resolved",
      "Document: What was wrong, what was changed, why",
      "Save: Upload fixed files",
    ],
    toolChain: ["execute_code", "web_search", "google_drive", "project"],
    deliverables: ["Fixed code files", "Bug report: symptom → root cause → fix → verification", "Regression prevention notes"],
    qualityGate: ["Root cause identified (not just symptom patched)", "Fix verified", "No regressions introduced"],
    handoffProtocol: "Fixed code with bug report documenting cause, fix, and verification",
  },
  {
    operationId: "ENG-03",
    departmentId: "engineering",
    name: "API Integration",
    whenToUse: "Connect to a third-party API, build an integration, set up webhooks",
    primaryAgent: "Forge",
    primaryPersonaId: 3,
    supportAgents: [{ name: "Agent Blueprint", personaId: 5 }],
    requiredInputs: ["API to integrate", "Authentication requirements", "Required endpoints", "Data mapping needs"],
    stepSequence: [
      "Research the API: documentation, authentication, rate limits, endpoints",
      "Design the integration: data mapping, error handling, retry logic",
      "Build: Write integration code with proper auth, error handling, logging",
      "Test: Make real API calls, verify responses",
      "Document: Setup instructions, environment variables needed, endpoint reference",
      "Save all files",
    ],
    toolChain: ["web_fetch", "execute_code", "google_drive", "create_pdf", "project"],
    deliverables: ["Integration code with error handling", "Configuration template (env vars, API keys needed)", "Integration test results", "API reference document"],
    qualityGate: ["Auth implemented correctly", "Error handling covers all failure modes", "Rate limits respected", "Documentation complete"],
    handoffProtocol: "Working integration with docs, test results, and configuration template",
  },
  {
    operationId: "ENG-04",
    departmentId: "engineering",
    name: "Automation / Script Development",
    whenToUse: "Automate a repetitive task, build a utility script, create a workflow",
    primaryAgent: "Forge",
    primaryPersonaId: 3,
    supportAgents: [],
    requiredInputs: ["Manual process to automate", "Expected inputs/outputs", "Frequency of execution"],
    stepSequence: [
      "Define: What manual process are we automating? Inputs/outputs?",
      "Design: Workflow steps, decision points, error scenarios",
      "Build: Write the automation script",
      "Test: Run with sample data, verify outputs",
      "Document: How to run, expected inputs/outputs, scheduling if applicable",
      "Save and register",
    ],
    toolChain: ["execute_code", "google_drive", "project", "create_memory"],
    deliverables: ["Automation script (working, tested)", "Usage guide", "Sample input/output", "Scheduling recommendations"],
    qualityGate: ["Script runs without errors", "Edge cases handled", "Usage documented"],
    handoffProtocol: "Working automation with usage guide and sample data",
  },
  {
    operationId: "ENG-05",
    departmentId: "engineering",
    name: "Technical Architecture Review",
    whenToUse: "Evaluate a system design, review architecture decisions, plan a technical migration",
    primaryAgent: "Forge",
    primaryPersonaId: 3,
    supportAgents: [{ name: "Agent Blueprint", personaId: 5 }],
    requiredInputs: ["Current architecture details", "Evaluation criteria", "Constraints"],
    stepSequence: [
      "Gather: Current architecture details from memory, project files, user description",
      "Research: Best practices, comparable systems, technology options",
      "Analyze: Strengths, weaknesses, scalability, maintainability, cost",
      "Recommend: Proposed changes with rationale",
      "Document: Architecture Decision Record (ADR)",
    ],
    toolChain: ["deep_research", "search_memory", "create_pdf", "google_drive", "project"],
    deliverables: ["Architecture review document", "ADR (Architecture Decision Record)", "Recommended changes with priority", "Migration plan (if applicable)"],
    qualityGate: ["All dimensions evaluated (performance, security, scalability, cost)", "Recommendations have clear rationale", "Migration path is realistic"],
    handoffProtocol: "Architecture review with prioritized recommendations and ADR",
  },
  {
    operationId: "ENG-06",
    departmentId: "engineering",
    name: "Infrastructure / DevOps",
    whenToUse: "Server setup, deployment, CI/CD, monitoring, cloud configuration",
    primaryAgent: "Forge",
    primaryPersonaId: 3,
    supportAgents: [{ name: "Chief of Staff", personaId: 6 }],
    requiredInputs: ["Infrastructure requirements", "Target platform", "SLAs/requirements"],
    stepSequence: [
      "Assess: Current infrastructure state",
      "Research: Best practices for the target platform",
      "Build: Configuration files, deployment scripts, monitoring setup",
      "Test: Verify deployment, health checks",
      "Document: Runbook (how to deploy, rollback, monitor)",
    ],
    toolChain: ["check_system_status", "test_api_keys", "execute_code", "google_drive", "project"],
    deliverables: ["Configuration files / scripts", "Deployment runbook", "Monitoring setup documentation", "Health check verification results"],
    qualityGate: ["Deployment verified", "Rollback procedure documented", "Monitoring active"],
    handoffProtocol: "Infrastructure documentation with runbook and verification results",
  },
  {
    operationId: "ENG-07",
    departmentId: "engineering",
    name: "Code Review",
    whenToUse: "Review existing code for quality, security, performance",
    primaryAgent: "Forge",
    primaryPersonaId: 3,
    supportAgents: [{ name: "Agent Blueprint", personaId: 5 }],
    requiredInputs: ["Code to review", "Review focus areas"],
    stepSequence: [
      "Read the code",
      "Analyze: Logic, security, performance, maintainability, edge cases",
      "Rate: Critical issues / Warnings / Suggestions / Good practices observed",
      "Provide specific fix recommendations with code examples",
      "Summary with overall quality assessment",
    ],
    toolChain: ["read_file", "google_drive", "execute_code"],
    deliverables: ["Code review report with severity-rated findings", "Specific fix recommendations", "Overall quality score and assessment"],
    qualityGate: ["All critical issues identified", "Fix recommendations are specific (not vague)", "Security vulnerabilities flagged"],
    handoffProtocol: "Code review report with prioritized findings and fix recommendations",
  },
  {
    operationId: "ENG-08",
    departmentId: "engineering",
    name: "Technical Documentation",
    whenToUse: "Write API docs, system guides, developer onboarding, technical specs",
    primaryAgent: "Forge",
    primaryPersonaId: 3,
    supportAgents: [{ name: "Scribe", personaId: 7 }],
    requiredInputs: ["Subject to document", "Target audience", "Doc format (API ref, tutorial, guide, spec)"],
    stepSequence: [
      "Gather: Technical details from code, system, or user description",
      "Structure: Choose appropriate doc format",
      "Write: Clear, precise technical documentation",
      "Include: Code examples, diagrams, configuration templates",
      "Save as PDF or Google Doc",
    ],
    toolChain: ["search_memory", "web_search", "create_pdf", "google_drive", "project"],
    deliverables: ["Technical document (PDF or Google Doc)", "Registered in project files"],
    qualityGate: ["Technically accurate", "Code examples tested", "Appropriate for target audience"],
    handoffProtocol: "Complete technical documentation saved and registered",
  },
  {
    operationId: "CONTENT-01",
    departmentId: "content",
    name: "Blog Post / Article",
    whenToUse: "Write a blog post, thought leadership article, guest post, or long-form content",
    primaryAgent: "Scribe",
    primaryPersonaId: 7,
    supportAgents: [
      { name: "Proof", personaId: 8 },
      { name: "Radar", personaId: 9 },
    ],
    requiredInputs: ["Topic or brief", "Target audience", "Desired tone", "Target length", "SEO keywords (optional)"],
    stepSequence: [
      "Check memory for brand voice guidelines",
      "Research the topic",
      "Create outline: Hook → Key points → Supporting evidence → Conclusion → CTA",
      "Write the full article in publication-ready quality",
      "Include: SEO title, meta description, headers (H2/H3), internal CTA",
      "Save to Google Drive",
      "Register in project",
      "Route to Proof for quality review",
    ],
    toolChain: ["search_memory", "web_search", "deep_research", "google_drive", "project"],
    deliverables: ["Complete article (Google Drive)", "SEO metadata: title tag, meta description, focus keyword", "Suggested featured image description", "Social promotion snippet"],
    qualityGate: ["Original content", "Proper header hierarchy (H1 → H2 → H3)", "CTA included", "Factual claims sourced"],
    handoffProtocol: "Publication-ready article with SEO metadata and social snippet",
  },
  {
    operationId: "CONTENT-02",
    departmentId: "content",
    name: "Video Script",
    whenToUse: "Script for YouTube, explainer video, product demo, training video, social video",
    primaryAgent: "Scribe",
    primaryPersonaId: 7,
    supportAgents: [{ name: "Neptune", personaId: 10 }],
    requiredInputs: ["Video type and platform", "Duration target", "Style (talking head, explainer, demo)", "Key message"],
    stepSequence: [
      "Define format: duration, style",
      "Research topic if needed",
      "Write script with timing marks at 150 WPM",
      "Structure: Hook (0:00-0:15) → Problem → Solution → Details → CTA → Outro",
      "Include speaker notes, visual cues, b-roll suggestions",
      "Save to Google Drive",
    ],
    toolChain: ["search_memory", "web_search", "google_drive", "project"],
    deliverables: ["Complete script with timing marks", "Visual direction notes", "B-roll / visual asset suggestions", "Thumbnail concept", "Title and description for platform"],
    qualityGate: ["Timing marks accurate at 150 WPM", "Hook is in first 15 seconds", "CTA clear", "Visual directions included"],
    handoffProtocol: "Production-ready script with visual directions and platform metadata",
  },
  {
    operationId: "CONTENT-03",
    departmentId: "content",
    name: "Email Campaign / Sequence",
    whenToUse: "Marketing email, drip sequence, newsletter, transactional email copy",
    primaryAgent: "Scribe",
    primaryPersonaId: 7,
    supportAgents: [{ name: "Teagan", personaId: 4 }, { name: "Proof", personaId: 8 }],
    requiredInputs: ["Purpose", "Audience segment", "Desired action", "Number of emails in sequence"],
    stepSequence: [
      "Define: Purpose, audience segment, desired action",
      "Write: Subject line (A/B variants), preview text, body, CTA",
      "For sequences: Map the flow (email 1 → trigger → email 2)",
      "Include: Personalization tokens, unsubscribe note",
      "Save each email as separate document",
    ],
    toolChain: ["search_memory", "web_search", "google_drive", "project"],
    deliverables: ["Email copy per email (subject, preview, body, CTA)", "A/B subject line variants", "Sequence flow diagram", "Send timing recommendations"],
    qualityGate: ["Subject lines under 50 chars", "Preview text under 90 chars", "CTA is clear and single-focus", "Unsubscribe included"],
    handoffProtocol: "Complete email package with A/B variants and sequence flow",
  },
  {
    operationId: "CONTENT-04",
    departmentId: "content",
    name: "Presentation / Slide Deck Content",
    whenToUse: "Keynote content, pitch deck copy, webinar slides, training deck, conference talk",
    primaryAgent: "Scribe",
    primaryPersonaId: 7,
    supportAgents: [{ name: "Proof", personaId: 8 }],
    requiredInputs: ["Audience", "Duration", "Key message", "Format"],
    stepSequence: [
      "Define: Audience, duration, key message, format",
      "Create slide outline: Title → Agenda → Key slides → Summary → CTA",
      "Write: Title + body + speaker notes per slide",
      "Keep slides concise (max 6 bullet points, max 8 words per point)",
      "Suggest visuals for each slide",
    ],
    toolChain: ["search_memory", "web_search", "google_drive", "project", "create_slides", "build_presentation_distributed", "generate_audio", "read_file"],
    deliverables: ["Slide content document (title, body, speaker notes per slide)", "Visual direction per slide", "Handout version"],
    qualityGate: ["Max 6 bullet points per slide", "Max 8 words per bullet", "Speaker notes complete", "Visual suggestions included"],
    handoffProtocol: "Slide-by-slide content with speaker notes and visual directions",
  },
  {
    operationId: "CONTENT-05",
    departmentId: "content",
    name: "Business Document",
    whenToUse: "Proposal, one-pager, case study, white paper, SOW, internal memo, executive brief",
    primaryAgent: "Scribe",
    primaryPersonaId: 7,
    supportAgents: [{ name: "Proof", personaId: 8 }],
    requiredInputs: ["Document type", "Target audience", "Key content/data"],
    stepSequence: [
      "Identify document type and select appropriate template/structure",
      "Research if needed (company info, industry data, competitive context)",
      "Write in appropriate business format",
      "Include executive summary for longer documents",
      "Save as PDF with professional formatting",
    ],
    toolChain: ["search_memory", "web_search", "create_pdf", "google_drive", "project"],
    deliverables: ["Formatted business document (PDF)", "Executive summary", "Registered in project"],
    qualityGate: ["Professional formatting", "Executive summary for 2+ page docs", "Data sourced"],
    handoffProtocol: "Professional document ready for distribution",
  },
  {
    operationId: "CONTENT-06",
    departmentId: "content",
    name: "Press Release",
    whenToUse: "Company announcement, product launch, partnership, milestone, event",
    primaryAgent: "Scribe",
    primaryPersonaId: 7,
    supportAgents: [{ name: "Proof", personaId: 8 }],
    requiredInputs: ["Announcement details", "Key quotes", "Company boilerplate"],
    stepSequence: [
      "Write headline (attention-grabbing, factual)",
      "Write lead paragraph (who, what, when, where, why)",
      "Body: Key details, quotes, supporting information",
      "Include company boilerplate",
      "Add media contact information placeholder",
      "Format in AP style",
    ],
    toolChain: ["search_memory", "web_search", "create_pdf", "google_drive", "project"],
    deliverables: ["Press release (AP format)", "Distribution list recommendations", "Social media announcement version"],
    qualityGate: ["AP style formatting", "Quotes attributed", "5 Ws in lead paragraph", "Boilerplate included"],
    handoffProtocol: "Distribution-ready press release with social media version",
  },
  {
    operationId: "CONTENT-07",
    departmentId: "content",
    name: "Social Media Copy",
    whenToUse: "Social media posts, captions, thread content (when routed through Content dept)",
    primaryAgent: "Scribe",
    primaryPersonaId: 7,
    supportAgents: [{ name: "Teagan", personaId: 4 }],
    requiredInputs: ["Platform", "Topic/message", "Tone", "CTA"],
    stepSequence: [
      "Check brand voice guidelines from memory",
      "Write platform-appropriate copy",
      "Include hashtag recommendations",
      "Create multiple variants for A/B testing",
      "Include visual direction notes",
    ],
    toolChain: ["search_memory", "draft_social_post", "compose_social_post"],
    deliverables: ["Post copy with hashtags", "Multiple variants", "Visual direction", "Posting time recommendations"],
    qualityGate: ["Platform character limits respected", "Brand voice consistent", "CTA included", "Hashtags relevant"],
    handoffProtocol: "Ready-to-post copy with variants and visual directions",
  },
  {
    operationId: "CONTENT-08",
    departmentId: "content",
    name: "Audio/Video Production",
    whenToUse: "Podcast script, audio narration, video assembly, multimedia content, cinematic video, stock footage video",
    primaryAgent: "Neptune",
    primaryPersonaId: 10,
    supportAgents: [{ name: "Scribe", personaId: 7 }],
    requiredInputs: ["Content type (audio/video)", "Topic", "Duration", "Style"],
    stepSequence: [
      "If script needed: Delegate to Scribe or write script",
      "Source visuals: Use search_stock_media for professional stock photos/videos, or generate_social_image for AI images",
      "For audio: Generate narration using generate_audio",
      "For video: Assemble using create_slideshow_video or produce_video with cinematic options (ken_burns: true for motion, transition_type for style, background_music_path for music)",
      "Review output quality",
      "Upload to Google Drive",
    ],
    toolChain: ["generate_audio", "create_slideshow_video", "produce_video", "search_stock_media", "generate_social_image", "google_drive", "project"],
    deliverables: ["Audio/video file", "Script (if applicable)", "Production notes"],
    qualityGate: ["Audio is clear and properly paced", "Video transitions are smooth", "Content matches script", "Ken Burns motion enhances visual engagement"],
    handoffProtocol: "Media file with script and production notes uploaded to Drive",
  },
  {
    operationId: "MKT-01",
    departmentId: "marketing",
    name: "Social Media Campaign",
    whenToUse: "Create a social media campaign, content calendar, multi-platform strategy",
    primaryAgent: "Teagan",
    primaryPersonaId: 4,
    supportAgents: [
      { name: "Scribe", personaId: 7 },
      { name: "Atlas", personaId: 12 },
    ],
    requiredInputs: ["Campaign objective", "Target audience", "Platforms", "Duration", "Budget (if paid)"],
    stepSequence: [
      "Define campaign strategy: objective, audience, platforms, timeline",
      "Create content calendar (manage_content_calendar)",
      "Draft posts per platform (draft_social_post for each)",
      "Generate visual assets (generate_social_image)",
      "Set up tracking and analytics",
      "Schedule posts",
    ],
    toolChain: ["search_memory", "manage_content_calendar", "draft_social_post", "compose_social_post", "generate_social_image", "search_stock_media", "marketing_analytics"],
    deliverables: ["Campaign strategy document", "Content calendar", "Platform-specific posts", "Visual assets", "Analytics tracking plan"],
    qualityGate: ["Posts are platform-appropriate", "Visual assets match brand", "Calendar has consistent posting frequency", "Analytics tracking configured"],
    handoffProtocol: "Complete campaign package with calendar, posts, visuals, and tracking plan",
  },
  {
    operationId: "MKT-02",
    departmentId: "marketing",
    name: "Brand Strategy / Voice Guide",
    whenToUse: "Define or refine brand positioning, voice, messaging, visual identity guidelines",
    primaryAgent: "Teagan",
    primaryPersonaId: 4,
    supportAgents: [
      { name: "Radar", personaId: 9 },
      { name: "Scribe", personaId: 7 },
    ],
    requiredInputs: ["Current brand status", "Target market", "Competitive positioning", "Values/personality"],
    stepSequence: [
      "Research: competitor branding, market positioning",
      "Define: Brand personality, voice attributes, do/don't guidelines",
      "Create: Messaging framework (tagline, value props, elevator pitch)",
      "Document: Brand voice guide with examples",
      "Save to memory for all agents to reference",
    ],
    toolChain: ["web_search", "search_memory", "create_memory", "create_pdf", "google_drive"],
    deliverables: ["Brand voice guide", "Messaging framework", "Positioning statement", "Example content in brand voice"],
    qualityGate: ["Voice attributes are specific (not generic)", "Do/Don't examples provided", "Competitive differentiation clear"],
    handoffProtocol: "Brand guide saved to memory and Drive for team-wide reference",
  },
  {
    operationId: "MKT-03",
    departmentId: "marketing",
    name: "SEO Strategy",
    whenToUse: "Keyword research, SEO audit, content optimization, search ranking improvement",
    primaryAgent: "Teagan",
    primaryPersonaId: 4,
    supportAgents: [{ name: "Radar", personaId: 9 }, { name: "Scribe", personaId: 7 }],
    requiredInputs: ["Website/domain", "Target keywords", "Current ranking status"],
    stepSequence: [
      "Research: Target keywords, search volume, competition",
      "Audit: Current site SEO status (if applicable)",
      "Analyze: Competitor SEO strategies",
      "Create: Keyword strategy with priority targets",
      "Recommend: Content plan aligned to keywords",
    ],
    toolChain: ["web_search", "firecrawl_scrape", "firecrawl_map", "create_pdf", "google_drive"],
    deliverables: ["Keyword research report", "SEO audit findings", "Content plan aligned to keywords", "Priority keyword targets"],
    qualityGate: ["Keywords have search volume data", "Competition level assessed", "Content plan is actionable"],
    handoffProtocol: "SEO strategy with keyword targets and content plan",
  },
  {
    operationId: "MKT-04",
    departmentId: "marketing",
    name: "Marketing Analytics Review",
    whenToUse: "Campaign performance review, marketing ROI analysis, channel performance",
    primaryAgent: "Teagan",
    primaryPersonaId: 4,
    supportAgents: [{ name: "Atlas", personaId: 12 }],
    requiredInputs: ["Campaigns to review", "Time period", "KPIs of interest"],
    stepSequence: [
      "Collect: Campaign data from marketing_analytics",
      "Analyze: Performance by channel, campaign, content type",
      "Compare: Against benchmarks and previous periods",
      "Identify: Top performers and underperformers",
      "Recommend: Optimization actions",
    ],
    toolChain: ["marketing_analytics", "generate_chart", "create_pdf", "google_drive"],
    deliverables: ["Marketing performance report", "Channel comparison", "Top/bottom performer analysis", "Optimization recommendations"],
    qualityGate: ["Data is current", "Benchmarks included", "Recommendations are specific"],
    handoffProtocol: "Marketing analytics report with actionable optimization recommendations",
  },
  {
    operationId: "SALES-01",
    departmentId: "sales",
    name: "Lead Research & Outreach",
    whenToUse: "Research a prospect, prepare outreach, cold email, initial contact",
    primaryAgent: "Apollo",
    primaryPersonaId: 11,
    supportAgents: [{ name: "Radar", personaId: 9 }],
    requiredInputs: ["Prospect name/company", "Product/service to pitch", "Known pain points"],
    stepSequence: [
      "Research prospect: company, role, recent activity, pain points",
      "Check memory for any prior interactions",
      "Craft personalized outreach email",
      "Include: Personalized hook, value proposition, specific CTA, follow-up timeline",
      "Send or save as draft for approval",
    ],
    toolChain: ["web_search", "web_fetch", "search_memory", "send_email", "create_memory"],
    deliverables: ["Prospect research brief", "Personalized outreach email", "Follow-up sequence plan"],
    qualityGate: ["Research is specific to this prospect", "Email is personalized (not generic)", "CTA is clear", "Follow-up scheduled"],
    handoffProtocol: "Outreach sent or staged for approval with follow-up plan",
  },
  {
    operationId: "SALES-02",
    departmentId: "sales",
    name: "Proposal / SOW Creation",
    whenToUse: "Create a sales proposal, statement of work, quote, or pricing document",
    primaryAgent: "Apollo",
    primaryPersonaId: 11,
    supportAgents: [
      { name: "Scribe", personaId: 7 },
      { name: "Cassandra", personaId: 13 },
      { name: "Luna", personaId: 14 },
    ],
    requiredInputs: ["Client name and needs", "Scope of work", "Pricing", "Timeline"],
    stepSequence: [
      "Gather: Client requirements, scope, pricing",
      "Structure: Executive summary → Scope → Deliverables → Timeline → Pricing → Terms",
      "Calculate: Pricing with margins (delegate to Cassandra if complex)",
      "Write: Professional proposal copy (delegate to Scribe if needed)",
      "Review: Legal terms (delegate to Luna if needed)",
      "Generate: PDF with professional formatting",
    ],
    toolChain: ["search_memory", "delegate_task", "create_pdf", "google_drive", "project"],
    deliverables: ["Sales proposal (PDF)", "Pricing breakdown", "Timeline with milestones", "Terms and conditions"],
    qualityGate: ["Pricing is accurate", "Scope is clear and bounded", "Timeline is realistic", "Terms protect the company"],
    handoffProtocol: "Client-ready proposal with pricing, timeline, and terms",
  },
  {
    operationId: "SALES-03",
    departmentId: "sales",
    name: "Pipeline Management",
    whenToUse: "Review sales pipeline, deal status, forecast, pipeline health",
    primaryAgent: "Apollo",
    primaryPersonaId: 11,
    supportAgents: [{ name: "Atlas", personaId: 12 }],
    requiredInputs: ["Pipeline data", "Review period", "Targets"],
    stepSequence: [
      "Review: All active deals from memory and project files",
      "Classify: By stage (prospect, qualified, proposal, negotiation, closed)",
      "Assess: Deal health, probability, next actions needed",
      "Forecast: Expected revenue by period",
      "Recommend: Actions for stuck or at-risk deals",
    ],
    toolChain: ["search_memory", "generate_chart", "create_pdf", "google_drive"],
    deliverables: ["Pipeline review report", "Deal status by stage", "Revenue forecast", "Action items for at-risk deals"],
    qualityGate: ["Every deal has a next action", "Forecast is probability-weighted", "At-risk deals identified"],
    handoffProtocol: "Pipeline report with forecast and action items for each deal",
  },
  {
    operationId: "SALES-04",
    departmentId: "sales",
    name: "Client Follow-up",
    whenToUse: "Follow up with a client after meeting, proposal, or period of silence",
    primaryAgent: "Apollo",
    primaryPersonaId: 11,
    supportAgents: [],
    requiredInputs: ["Client name", "Last interaction context", "Purpose of follow-up"],
    stepSequence: [
      "Recall: Last interaction from memory",
      "Assess: What was promised, what's the status",
      "Draft: Follow-up email with value add (not just 'checking in')",
      "Include: Specific reference to last discussion, new value/insight, clear next step",
      "Send or save as draft",
    ],
    toolChain: ["search_memory", "send_email", "create_memory"],
    deliverables: ["Follow-up email sent", "Interaction logged in memory"],
    qualityGate: ["References specific prior interaction", "Adds value (not generic check-in)", "Clear next step included"],
    handoffProtocol: "Follow-up sent with interaction logged",
  },
  {
    operationId: "SALES-05",
    departmentId: "sales",
    name: "Competitive Battle Card",
    whenToUse: "Create competitive comparison for sales team, objection handling guides",
    primaryAgent: "Apollo",
    primaryPersonaId: 11,
    supportAgents: [{ name: "Radar", personaId: 9 }],
    requiredInputs: ["Competitor name", "Product/service to compare", "Key differentiators"],
    stepSequence: [
      "Delegate to Radar: Deep competitive research on target competitor",
      "Analyze: Feature comparison, pricing, strengths, weaknesses",
      "Create: Battle card with objection handlers",
      "Format: Quick-reference document for sales use",
    ],
    toolChain: ["delegate_task", "web_search", "create_pdf", "google_drive"],
    deliverables: ["Competitive battle card", "Feature comparison matrix", "Objection handling scripts", "Win/loss analysis"],
    qualityGate: ["Data is current", "Objection handlers are specific", "Differentiators are real (not aspirational)"],
    handoffProtocol: "Battle card ready for sales team use",
  },
  {
    operationId: "SALES-06",
    departmentId: "sales",
    name: "Product/Service Delivery",
    whenToUse: "Deliver a sold product, service, or digital asset to a client",
    primaryAgent: "Apollo",
    primaryPersonaId: 11,
    supportAgents: [{ name: "Chief of Staff", personaId: 6 }],
    requiredInputs: ["Client", "Product/service to deliver", "Delivery method"],
    stepSequence: [
      "Verify: All deliverables are complete and quality-checked",
      "Package: Organize all files and documentation",
      "Deliver: Send via appropriate channel (email, Drive, etc.)",
      "Confirm: Verify client received delivery",
      "Log: Record delivery in project and memory",
    ],
    toolChain: ["google_drive", "send_email", "create_memory", "project"],
    deliverables: ["Delivered product/files", "Delivery confirmation", "Client receipt acknowledgment"],
    qualityGate: ["All items in scope delivered", "Quality verified before sending", "Delivery confirmed"],
    handoffProtocol: "Delivery confirmation with client acknowledgment logged",
  },
  {
    operationId: "SALES-07",
    departmentId: "sales",
    name: "Lead Qualification Pipeline",
    whenToUse: "User wants to find, enrich, score, and qualify leads. ICP definition, lead enrichment from web data, automated scoring and grading, pipeline qualification.",
    primaryAgent: "Apollo",
    primaryPersonaId: 11,
    supportAgents: [{ name: "Radar", personaId: 9 }],
    requiredInputs: ["Target market or ICP description", "Lead names/companies/URLs", "Scoring criteria or priorities"],
    stepSequence: [
      "Define ICP scoring criteria using define_icp (industry, company size, role, budget signals)",
      "For each lead: enrich_lead with company URL to pull industry, size, description",
      "Run score_leads against ICP criteria — assigns 0-100 score and A-F grade",
      "Review qualify_leads pipeline — qualified (70+), nurture (40-70), disqualified (<40)",
      "Create summary report of qualified leads with recommended next actions",
      "For qualified leads, recommend enrollment in outreach sequence",
    ],
    toolChain: ["define_icp", "enrich_lead", "score_leads", "qualify_leads", "web_search", "create_memory"],
    deliverables: ["ICP scoring rule", "Enriched lead profiles", "Scored & graded lead pipeline", "Qualification summary with recommended actions"],
    qualityGate: ["ICP criteria are specific and measurable", "All leads enriched with company data", "Scores reflect real ICP fit", "Qualified leads have clear next actions"],
    handoffProtocol: "Qualified lead list with scores, grades, and recommended outreach actions",
  },
  {
    operationId: "SALES-08",
    departmentId: "sales",
    name: "Outreach Campaign",
    whenToUse: "User wants to create and run a multi-step outreach email sequence. Cold outreach, drip campaigns, follow-up sequences, email cadences.",
    primaryAgent: "Apollo",
    primaryPersonaId: 11,
    supportAgents: [{ name: "Scribe", personaId: 7 }, { name: "Proof", personaId: 8 }],
    requiredInputs: ["Campaign name and purpose", "Target audience", "Number of steps and cadence", "Key messaging/value prop"],
    stepSequence: [
      "Delegate to Scribe: Write email templates for each step (subject + body) with {{name}}, {{company}} placeholders",
      "Delegate to Proof: Review email copy for tone, grammar, and CTA clarity",
      "Create sequence using create_sequence with reviewed templates and wait intervals",
      "Enroll contacts using enroll_in_sequence with personal context for AI personalization",
      "When ready, run advance_sequence to send first step and schedule follow-ups",
      "Monitor replies with classify_reply — auto-pauses for positive/interested, stops for unsubscribe",
    ],
    toolChain: ["create_sequence", "enroll_in_sequence", "advance_sequence", "classify_reply", "list_sequences", "delegate_task", "send_email"],
    deliverables: ["Active outreach sequence with steps", "Enrolled contacts", "Sent emails with personalization", "Reply classification and sequence status report"],
    qualityGate: ["Email copy is personalized (not generic)", "Wait intervals are reasonable (3-5 days)", "Unsubscribe handling is automatic", "Reply classification triggers correct actions"],
    handoffProtocol: "Campaign status with sent/pending/replied counts and recommended follow-up actions",
  },
  {
    operationId: "RES-06",
    departmentId: "research",
    name: "Evidence-Based Research Collection",
    whenToUse: "User wants rigorous, citation-backed research. Evidence collection with confidence scoring, source tracking, contradiction detection, and synthesis into structured reports.",
    primaryAgent: "Radar",
    primaryPersonaId: 9,
    supportAgents: [{ name: "Neptune", personaId: 10 }, { name: "Proof", personaId: 8 }],
    requiredInputs: ["Research question or topic", "Scope and depth requirements", "Output format (memo, report, briefing)"],
    stepSequence: [
      "Use web_search and deep_research to gather initial findings on the topic",
      "For EACH finding, call save_evidence with: claim, source URL, source title, confidence score (0-100), theme, supporting quote",
      "Tag evidence by theme (market_size, pricing, regulation, technology, competitors, etc.)",
      "Flag contradictions between sources using the 'contradicts' field",
      "After collecting 10+ evidence items, call synthesize_research to produce a cited report",
      "Delegate to Proof: Verify citation accuracy and flag low-confidence claims",
    ],
    toolChain: ["web_search", "deep_research", "save_evidence", "query_evidence", "synthesize_research", "delegate_task"],
    deliverables: ["Evidence store with 10+ cited claims", "Synthesized research memo/report with [N] citations", "Contradiction analysis", "Open questions and research gaps identified"],
    qualityGate: ["Every claim has a source citation", "Confidence scores are calibrated (not all 80+)", "Contradictions are explicitly noted", "Synthesis references all high-confidence evidence"],
    handoffProtocol: "Research report with full evidence trail accessible via query_evidence",
  },
  {
    operationId: "RES-07",
    departmentId: "research",
    name: "Competitor Intelligence Program",
    whenToUse: "User wants to track competitors, monitor their changes, detect pricing/feature/messaging shifts, and get strategic briefings.",
    primaryAgent: "Radar",
    primaryPersonaId: 9,
    supportAgents: [{ name: "Apollo", personaId: 11 }, { name: "Scribe", personaId: 7 }],
    requiredInputs: ["Competitor names and websites", "Specific pages to monitor (pricing, product, changelog)", "Monitoring cadence"],
    stepSequence: [
      "Add each competitor to the watchlist using add_competitor with website, pricing URL, product URL, changelog URL",
      "Take initial baseline snapshots using take_competitor_snapshot for each competitor",
      "Wait for next monitoring cycle (or take second snapshot to compare)",
      "Run detect_competitor_changes to identify pricing, feature, messaging, and positioning shifts",
      "Generate executive briefing using competitor_briefing covering the monitoring period",
      "Delegate to Apollo: Translate competitive changes into sales implications and battle card updates",
    ],
    toolChain: ["add_competitor", "list_competitors", "take_competitor_snapshot", "detect_competitor_changes", "competitor_briefing", "delegate_task", "firecrawl_scrape"],
    deliverables: ["Active competitor watchlist", "Baseline snapshots for all tracked pages", "Change detection report with significance ratings", "Executive competitor briefing", "Sales implications and recommended actions"],
    qualityGate: ["All relevant competitor URLs are tracked", "Changes are categorized by type and significance", "Briefing focuses on strategic implications, not cosmetic changes", "Recommended actions are specific"],
    handoffProtocol: "Competitor briefing with watchlist status and recommended strategic responses",
  },
  {
    operationId: "FIN-01",
    departmentId: "finance",
    name: "Financial Analysis / Forecast",
    whenToUse: "Revenue forecast, financial modeling, scenario analysis, what-if planning",
    primaryAgent: "Cassandra",
    primaryPersonaId: 13,
    supportAgents: [{ name: "Atlas", personaId: 12 }],
    requiredInputs: ["Analysis type", "Data sources", "Time horizon", "Scenarios to model"],
    stepSequence: [
      "Gather: Financial data from memory, project files, user input",
      "Model: Build financial model with assumptions clearly stated",
      "Analyze: Multiple scenarios (conservative, moderate, aggressive)",
      "Visualize: Charts showing projections and scenarios",
      "Recommend: Strategic financial actions",
    ],
    toolChain: ["search_memory", "execute_code", "generate_chart", "create_pdf", "google_drive"],
    deliverables: ["Financial model with assumptions", "Scenario analysis (3 scenarios)", "Projection charts", "Strategic recommendations"],
    qualityGate: ["Assumptions clearly stated", "Multiple scenarios modeled", "Math verified", "Recommendations are actionable"],
    handoffProtocol: "Financial analysis with projections, charts, and recommendations",
  },
  {
    operationId: "FIN-02",
    departmentId: "finance",
    name: "Budget Planning",
    whenToUse: "Create or update budget, allocate resources, plan spending",
    primaryAgent: "Cassandra",
    primaryPersonaId: 13,
    supportAgents: [{ name: "Atlas", personaId: 12 }],
    requiredInputs: ["Budget period", "Revenue assumptions", "Fixed costs", "Planned investments"],
    stepSequence: [
      "Review: Current financial position and historical spending",
      "Categorize: Expenses by department/category",
      "Allocate: Resources based on priorities and constraints",
      "Calculate: Monthly cash flow projections",
      "Create: Budget document with variance tracking framework",
      "Flag items needing approval or investigation",
    ],
    toolChain: ["search_memory", "execute_code", "generate_chart", "create_pdf", "google_drive"],
    deliverables: ["Budget document with line-item detail", "Monthly cash flow projection", "Variance analysis", "Budget approval action items"],
    qualityGate: ["All categories covered", "Monthly projections provided", "Variance thresholds defined"],
    handoffProtocol: "Complete budget with cash flow projections and approval items",
  },
  {
    operationId: "FIN-03",
    departmentId: "finance",
    name: "Revenue Reporting / P&L",
    whenToUse: "Monthly close, revenue reconciliation, P&L statement, financial summary",
    primaryAgent: "Cassandra",
    primaryPersonaId: 13,
    supportAgents: [{ name: "Atlas", personaId: 12 }],
    requiredInputs: ["Reporting period", "Revenue data", "Expense data"],
    stepSequence: [
      "Pull revenue data (Stripe tools if applicable, memory, project files)",
      "Compile expenses by category",
      "Calculate: Gross revenue, net revenue, COGS, gross margin, operating expenses, net income",
      "Compare to budget/forecast",
      "Generate visualizations",
      "Write narrative: What happened, why, what it means",
    ],
    toolChain: ["search_memory", "execute_code", "generate_chart", "create_pdf", "google_drive"],
    deliverables: ["P&L statement", "Revenue breakdown chart", "Expense breakdown chart", "Budget vs. actual comparison", "Narrative summary"],
    qualityGate: ["Numbers reconcile", "Budget comparison included", "Narrative explains variances"],
    handoffProtocol: "P&L with charts, budget comparison, and narrative",
  },
  {
    operationId: "FIN-04",
    departmentId: "finance",
    name: "Pricing Strategy",
    whenToUse: "Set pricing, evaluate pricing changes, competitive pricing analysis",
    primaryAgent: "Cassandra",
    primaryPersonaId: 13,
    supportAgents: [{ name: "Radar", personaId: 9 }],
    requiredInputs: ["Product/service to price", "Cost structure", "Market context"],
    stepSequence: [
      "Research: Competitor pricing, market rates",
      "Analyze: Cost structure, target margins, volume assumptions",
      "Model: Multiple pricing tiers/options",
      "Calculate: Revenue impact per scenario",
      "Recommend: Pricing with rationale",
    ],
    toolChain: ["web_search", "execute_code", "generate_chart", "create_pdf", "google_drive"],
    deliverables: ["Pricing analysis document", "Competitor pricing comparison", "Revenue impact models per option", "Recommended pricing with rationale"],
    qualityGate: ["Competitor data is current", "Multiple options modeled", "Revenue impact calculated"],
    handoffProtocol: "Pricing recommendation with competitive comparison and revenue models",
  },
  {
    operationId: "FIN-05",
    departmentId: "finance",
    name: "Cash Flow Management",
    whenToUse: "Runway calculation, cash position update, payment timing optimization",
    primaryAgent: "Cassandra",
    primaryPersonaId: 13,
    supportAgents: [],
    requiredInputs: ["Current cash position", "Revenue projections", "Committed expenses"],
    stepSequence: [
      "Current cash position",
      "Projected inflows (committed revenue, expected deals)",
      "Projected outflows (committed expenses, planned spending)",
      "Calculate: Runway in months, monthly burn rate",
      "Flag: Payment timing risks, large upcoming expenses",
      "Recommend: Cash optimization actions",
    ],
    toolChain: ["search_memory", "execute_code", "generate_chart", "create_pdf", "google_drive"],
    deliverables: ["Cash flow projection (12-month)", "Runway calculation", "Risk flags", "Optimization recommendations"],
    qualityGate: ["Cash position is current", "Projections are conservative", "Risks clearly flagged"],
    handoffProtocol: "Cash flow projection with runway and optimization recommendations",
  },
  {
    operationId: "FIN-06",
    departmentId: "finance",
    name: "Tax Preparation",
    whenToUse: "Quarterly tax estimate, annual tax prep, tax planning, deduction tracking",
    primaryAgent: "Cassandra",
    primaryPersonaId: 13,
    supportAgents: [],
    requiredInputs: ["Tax period", "Revenue and expense data", "Deduction categories"],
    stepSequence: [
      "Compile: Revenue, expenses, deductions by category",
      "Research: Applicable tax rates, deadlines, deduction rules",
      "Calculate: Estimated tax liability",
      "Document: What records are needed, what's ready, what's missing",
      "Recommend: Tax-saving strategies if applicable",
    ],
    toolChain: ["search_memory", "web_search", "execute_code", "create_pdf", "google_drive"],
    deliverables: ["Tax estimate calculation", "Deduction summary", "Required records checklist", "Filing deadline tracker", "Tax-saving recommendations"],
    qualityGate: ["Calculations verified", "Deadlines identified", "Disclaimer: not tax advice, consult a CPA"],
    handoffProtocol: "Tax preparation package with estimates, checklists, and disclaimer",
  },
  {
    operationId: "LEGAL-01",
    departmentId: "legal",
    name: "Contract Review",
    whenToUse: "Review any contract, agreement, terms before signing",
    primaryAgent: "Luna",
    primaryPersonaId: 14,
    supportAgents: [],
    requiredInputs: ["Contract document", "Key concerns", "Negotiation position"],
    stepSequence: [
      "Obtain contract document",
      "Review clause by clause: Key terms, obligations, liabilities, termination, IP, indemnification",
      "Flag risks by severity: Critical / High / Medium / Low",
      "For each risk: What it means → Why it matters → Recommended change",
      "Overall assessment: Sign as-is / Sign with modifications / Do not sign",
      "Document recommendations",
    ],
    toolChain: ["analyze_pdf", "web_search", "create_pdf", "google_drive", "project"],
    deliverables: ["Contract review report with risk flags", "Specific recommended changes", "Overall recommendation", "Caveat: legal information, not legal advice"],
    qualityGate: ["Every clause reviewed", "Risks rated by severity", "Specific fix language provided", "Attorney consultation recommended for critical matters"],
    handoffProtocol: "Contract review report with risk-rated findings and recommendations",
  },
  {
    operationId: "LEGAL-02",
    departmentId: "legal",
    name: "Terms of Service / Privacy Policy",
    whenToUse: "Create or update ToS, privacy policy, cookie policy, acceptable use policy",
    primaryAgent: "Luna",
    primaryPersonaId: 14,
    supportAgents: [],
    requiredInputs: ["Business type", "Data collected", "Jurisdictions", "Current policies (if updating)"],
    stepSequence: [
      "Research: Current regulatory requirements (GDPR, CCPA, etc.)",
      "Review: What data is collected, how it's used, who it's shared with",
      "Draft: Comprehensive policy in plain language",
      "Include: Required disclosures, user rights, opt-out mechanisms",
      "Save as legal document",
    ],
    toolChain: ["web_search", "search_memory", "create_pdf", "google_drive"],
    deliverables: ["Terms of Service document", "Privacy Policy document", "Cookie Policy (if applicable)", "Plain-language summary for users"],
    qualityGate: ["Covers all applicable regulations", "Plain language (not just legalese)", "User rights clearly stated"],
    handoffProtocol: "Complete policy documents with plain-language summaries",
  },
  {
    operationId: "LEGAL-03",
    departmentId: "legal",
    name: "NDA / Simple Agreement Drafting",
    whenToUse: "Draft an NDA, freelancer agreement, partnership MOU, or simple contract",
    primaryAgent: "Luna",
    primaryPersonaId: 14,
    supportAgents: [],
    requiredInputs: ["Parties involved", "Scope", "Key terms", "Duration"],
    stepSequence: [
      "Define: Parties, scope, key terms, duration",
      "Research: Standard language for this type of agreement",
      "Draft: Using clear, enforceable language",
      "Include: Definitions, obligations, confidentiality, termination, governing law, dispute resolution",
      "Flag items needing attorney review",
      "Save as PDF",
    ],
    toolChain: ["web_search", "create_pdf", "google_drive"],
    deliverables: ["Draft agreement (PDF)", "Key terms summary", "Items flagged for attorney review"],
    qualityGate: ["All essential clauses included", "Language is clear and enforceable", "Attorney review items flagged"],
    handoffProtocol: "Draft agreement with key terms summary and attorney review flags",
  },
  {
    operationId: "LEGAL-04",
    departmentId: "legal",
    name: "Compliance Audit",
    whenToUse: "Regulatory review, compliance check, privacy audit, policy compliance verification",
    primaryAgent: "Luna",
    primaryPersonaId: 14,
    supportAgents: [{ name: "Cassandra", personaId: 13 }],
    requiredInputs: ["Regulations/standards to audit against", "Current practices"],
    stepSequence: [
      "Define: What regulations/standards apply (GDPR, CCPA, SOC2, industry-specific)",
      "Research: Current requirements and recent changes",
      "Audit: Current practices vs. requirements",
      "Gap analysis: What's compliant, what's not, what's partially compliant",
      "Prioritize: Critical gaps → High → Medium → Low",
      "Recommend: Remediation plan with timeline",
    ],
    toolChain: ["web_search", "search_memory", "create_pdf", "google_drive"],
    deliverables: ["Compliance audit report", "Gap analysis matrix", "Remediation plan with priorities", "Regulatory change log"],
    qualityGate: ["All applicable regulations checked", "Gaps rated by severity", "Remediation plan is actionable"],
    handoffProtocol: "Compliance audit with gap analysis and prioritized remediation plan",
  },
  {
    operationId: "LEGAL-05",
    departmentId: "legal",
    name: "IP Protection",
    whenToUse: "Trademark search, copyright questions, IP strategy, invention disclosure",
    primaryAgent: "Luna",
    primaryPersonaId: 14,
    supportAgents: [],
    requiredInputs: ["IP to protect", "Current protections", "Jurisdiction"],
    stepSequence: [
      "Research: Existing trademarks/IP in the space",
      "Assess: Current IP assets and protections",
      "Identify: Gaps in protection",
      "Recommend: Filing priorities, protection strategies",
      "Document: IP inventory",
    ],
    toolChain: ["web_search", "create_pdf", "google_drive"],
    deliverables: ["IP audit report", "Trademark search results", "Protection recommendations", "Filing priority list"],
    qualityGate: ["Comprehensive search conducted", "All IP assets inventoried", "Priority actions identified"],
    handoffProtocol: "IP audit with protection recommendations and filing priorities",
  },
  {
    operationId: "OPS-01",
    departmentId: "operations",
    name: "System Health Check",
    whenToUse: "Is everything working? Routine health check, pre-deployment verification",
    primaryAgent: "Chief of Staff",
    primaryPersonaId: 6,
    supportAgents: [{ name: "Forge", personaId: 3 }],
    requiredInputs: [],
    stepSequence: [
      "Run test_api_keys — verify all AI provider connections",
      "Run check_system_status — uptime, conversations, memory, heartbeats",
      "Check list_models — available AI models",
      "Verify Google Drive connectivity",
      "Check email system",
      "Review recent errors or anomalies",
      "Report in dashboard format with clear status indicators",
    ],
    toolChain: ["test_api_keys", "check_system_status", "list_models", "google_drive", "check_inbox"],
    deliverables: ["System health dashboard", "Status per service: Healthy / Degraded / Down", "Action items for any issues", "Response times / latency metrics"],
    qualityGate: ["Every service actually tested (not assumed)", "Specific numbers (latency in ms)", "Token expiry times noted", "Issues have proposed fixes"],
    handoffProtocol: "Health dashboard with service status, metrics, and action items",
  },
  {
    operationId: "OPS-02",
    departmentId: "operations",
    name: "Morning Standup / Daily Brief",
    whenToUse: "Daily standup, start-of-day summary, what's happening today",
    primaryAgent: "Chief of Staff",
    primaryPersonaId: 6,
    supportAgents: [],
    requiredInputs: [],
    stepSequence: [
      "Check system health (abbreviated OPS-01)",
      "Review overnight activity (get_daily_notes)",
      "Check pending tasks across personas (manage_desk: get_status)",
      "Review inbox for anything requiring attention",
      "Compile: Status → Priorities → Blockers → Today's Schedule",
    ],
    toolChain: ["check_system_status", "test_api_keys", "get_daily_notes", "manage_desk", "check_inbox"],
    deliverables: ["Morning brief document", "Today's priority list", "Blocker report", "Schedule for the day"],
    qualityGate: ["System status verified", "Overnight activity reviewed", "Priorities are actionable"],
    handoffProtocol: "Morning brief with priorities, blockers, and schedule",
  },
  {
    operationId: "OPS-03",
    departmentId: "operations",
    name: "End of Day Summary",
    whenToUse: "Daily summary, what got done today, EOD wrap-up",
    primaryAgent: "Chief of Staff",
    primaryPersonaId: 6,
    supportAgents: [],
    requiredInputs: [],
    stepSequence: [
      "Review day's activity (get_daily_notes)",
      "Compile completed work by department",
      "Note unfinished items and their status",
      "Flag anything needing attention tomorrow",
      "Write daily summary",
    ],
    toolChain: ["get_daily_notes", "search_memory", "write_daily_note"],
    deliverables: ["EOD summary", "Completed items list", "Carry-forward items", "Tomorrow's priorities"],
    qualityGate: ["All activity accounted for", "Carry-forward items have next actions", "Tomorrow's priorities set"],
    handoffProtocol: "EOD summary with completed work and tomorrow's priorities",
  },
  {
    operationId: "OPS-04",
    departmentId: "operations",
    name: "Weekly Operations Review",
    whenToUse: "Monday weekly review, operational retrospective, process improvement",
    primaryAgent: "Chief of Staff",
    primaryPersonaId: 6,
    supportAgents: [{ name: "Atlas", personaId: 12 }],
    requiredInputs: ["Week to review"],
    stepSequence: [
      "Compile daily summaries for the week",
      "Aggregate metrics from Atlas (delegate if needed)",
      "Review: What went well, what didn't, what to improve",
      "Update any operational processes",
      "Set priorities for next week",
    ],
    toolChain: ["get_daily_notes", "delegate_task", "search_memory", "create_pdf", "google_drive"],
    deliverables: ["Weekly operations report", "Metrics summary", "Process improvement recommendations", "Next week's priorities"],
    qualityGate: ["All 5 days covered", "Metrics are quantified", "Improvements are specific"],
    handoffProtocol: "Weekly ops report with metrics, improvements, and next week's plan",
  },
  {
    operationId: "OPS-05",
    departmentId: "operations",
    name: "Scheduling & Calendar Management",
    whenToUse: "Schedule meetings, manage calendar, coordinate across time zones",
    primaryAgent: "Chief of Staff",
    primaryPersonaId: 6,
    supportAgents: [],
    requiredInputs: ["What to schedule", "Participants", "Constraints"],
    stepSequence: [
      "Identify: What needs to be scheduled, who's involved, constraints",
      "Check calendar",
      "Propose times",
      "Create calendar event",
      "Send notifications if needed",
    ],
    toolChain: ["google_workspace", "send_email"],
    deliverables: ["Calendar event created", "Notifications sent", "Agenda prepared (if meeting)"],
    qualityGate: ["Time zone conflicts checked", "All participants notified", "Agenda included"],
    handoffProtocol: "Calendar event created with agenda and notifications sent",
  },
  {
    operationId: "OPS-06",
    departmentId: "operations",
    name: "Incident Response",
    whenToUse: "System outage, service degradation, critical error, security alert",
    primaryAgent: "Chief of Staff",
    primaryPersonaId: 6,
    supportAgents: [{ name: "Forge", personaId: 3 }],
    requiredInputs: ["Incident description", "Severity", "Affected services"],
    stepSequence: [
      "Assess severity immediately",
      "Classify: Severity 1 (service down) / 2 (degraded) / 3 (minor) / 4 (cosmetic)",
      "Communicate: Alert Felix, notify user",
      "Diagnose: Root cause investigation",
      "Escalate to Forge for technical fix if needed",
      "Resolve and verify",
      "Post-incident report",
    ],
    toolChain: ["check_system_status", "test_api_keys", "post_to_channel", "delegate_task", "create_pdf"],
    deliverables: ["Incident report (timeline, cause, resolution)", "Status updates (real-time)", "Post-incident review document", "Prevention recommendations"],
    qualityGate: ["Severity correctly classified", "Root cause identified", "Prevention measures recommended"],
    handoffProtocol: "Incident report with resolution timeline and prevention recommendations",
  },
  {
    operationId: "RESEARCH-01",
    departmentId: "research",
    name: "Market Research",
    whenToUse: "Market size, industry analysis, market trends, TAM/SAM/SOM",
    primaryAgent: "Radar",
    primaryPersonaId: 9,
    supportAgents: [{ name: "Neptune", personaId: 10 }],
    requiredInputs: ["Research scope and questions", "Industry/market", "Time horizon"],
    stepSequence: [
      "Define research scope and questions",
      "Search multiple sources for breadth",
      "Fetch specific pages for depth",
      "For comprehensive research: use deep_research",
      "Cross-reference findings from multiple sources",
      "Analyze: Market size, growth rate, segments, trends",
      "Structure report: Executive Summary → Market Overview → Segments → Trends → Opportunities → Risks → Sources",
    ],
    toolChain: ["web_search", "web_fetch", "deep_research", "generate_chart", "create_pdf", "google_drive", "project", "create_memory"],
    deliverables: ["Market research report (PDF)", "Market size/growth charts", "Trend analysis", "Opportunity matrix", "All sources cited"],
    qualityGate: ["Multiple sources cross-referenced", "Data recency noted", "Confidence levels stated", "Facts vs. analysis vs. speculation distinguished"],
    handoffProtocol: "Sourced market research report with charts and opportunity matrix",
  },
  {
    operationId: "RESEARCH-02",
    departmentId: "research",
    name: "Competitive Analysis",
    whenToUse: "Competitor deep dive, competitive landscape, feature comparison, battle cards",
    primaryAgent: "Radar",
    primaryPersonaId: 9,
    supportAgents: [{ name: "Neptune", personaId: 10 }],
    requiredInputs: ["Competitor(s) to analyze", "Comparison dimensions", "Your product/service for reference"],
    stepSequence: [
      "Identify competitor set (direct, indirect, emerging)",
      "Research each: Product, pricing, positioning, strengths, weaknesses, recent moves",
      "Use firecrawl tools for deep site analysis if needed",
      "Build comparison matrix",
      "Identify differentiators and vulnerabilities",
      "Strategic recommendations",
    ],
    toolChain: ["web_search", "web_fetch", "firecrawl_search", "firecrawl_scrape", "generate_chart", "create_pdf", "google_drive"],
    deliverables: ["Competitive analysis report", "Feature comparison matrix", "SWOT per competitor", "Strategic recommendations", "Battle cards for sales team"],
    qualityGate: ["All competitors researched equally", "Data is current", "Differentiators are real", "Recommendations are actionable"],
    handoffProtocol: "Competitive analysis with comparison matrix and battle cards",
  },
  {
    operationId: "RESEARCH-03",
    departmentId: "research",
    name: "Technology / Tool Research",
    whenToUse: "Evaluate tools, platforms, technologies, APIs, frameworks",
    primaryAgent: "Radar",
    primaryPersonaId: 9,
    supportAgents: [{ name: "Forge", personaId: 3 }],
    requiredInputs: ["Requirements and evaluation criteria", "Use case", "Budget constraints"],
    stepSequence: [
      "Define requirements and evaluation criteria",
      "Research candidates",
      "Compare: Features, pricing, documentation quality, community, integration effort",
      "Score against criteria",
      "Recommend with rationale",
    ],
    toolChain: ["web_search", "web_fetch", "firecrawl_scrape", "create_pdf", "google_drive"],
    deliverables: ["Technology evaluation report", "Comparison matrix (scored)", "Recommendation with rationale", "Implementation considerations"],
    qualityGate: ["Multiple alternatives compared", "Scoring criteria objective", "Recommendation has clear rationale"],
    handoffProtocol: "Technology evaluation with scored comparison and recommendation",
  },
  {
    operationId: "RESEARCH-04",
    departmentId: "research",
    name: "Industry Trend Report",
    whenToUse: "Trend tracking, emerging technology scan, what's happening in an industry",
    primaryAgent: "Radar",
    primaryPersonaId: 9,
    supportAgents: [{ name: "Neptune", personaId: 10 }],
    requiredInputs: ["Industry/domain", "Time horizon", "Focus areas"],
    stepSequence: [
      "Multi-source research (deep_research)",
      "Identify trends by category: technology, market, regulatory, behavioral",
      "Assess each: Signal strength, timeline, impact potential",
      "Extract implications for the business",
      "Structure: Key Trends → Analysis → Implications → Action Items → Sources",
    ],
    toolChain: ["deep_research", "web_search", "generate_chart", "create_pdf", "google_drive", "create_memory"],
    deliverables: ["Trend report (structured, sourced)", "Trend heat map (impact vs. timeline)", "Action items based on trends"],
    qualityGate: ["Multiple sources used", "Trends categorized", "Business implications extracted", "Action items are specific"],
    handoffProtocol: "Trend report with heat map and business action items",
  },
  {
    operationId: "RESEARCH-05",
    departmentId: "research",
    name: "Person / Company Research",
    whenToUse: "Due diligence on a person or company, background check, prospect research",
    primaryAgent: "Radar",
    primaryPersonaId: 9,
    supportAgents: [],
    requiredInputs: ["Person/company name", "Purpose of research", "Specific areas of interest"],
    stepSequence: [
      "Search across multiple sources",
      "Compile: Background, history, recent activity, reputation, connections",
      "For companies: Financials if public, leadership, products, news",
      "Note red flags or concerns",
      "Create dossier",
    ],
    toolChain: ["web_search", "web_fetch", "firecrawl_scrape", "create_pdf", "google_drive"],
    deliverables: ["Research dossier", "Key facts summary", "Red flags / concerns", "Relevance to current business context"],
    qualityGate: ["Multiple sources checked", "Red flags clearly noted", "Information is recent"],
    handoffProtocol: "Research dossier with key facts and red flag assessment",
  },
  {
    operationId: "DATA-01",
    departmentId: "data",
    name: "KPI Dashboard / Scorecard",
    whenToUse: "Create metrics dashboard, weekly scorecard, performance tracking",
    primaryAgent: "Atlas",
    primaryPersonaId: 12,
    supportAgents: [{ name: "Cassandra", personaId: 13 }],
    requiredInputs: ["KPIs to track", "Data sources", "Time period"],
    stepSequence: [
      "Define: Which KPIs to track, data sources, time period",
      "Collect data",
      "Calculate: Current values, trends, period-over-period changes",
      "Visualize: Charts per KPI",
      "Add context: What does this number mean?",
      "Compare to targets/benchmarks",
      "Save report",
    ],
    toolChain: ["execute_code", "search_memory", "generate_chart", "generate_dashboard", "create_pdf", "google_drive", "project"],
    deliverables: ["KPI dashboard (charts + commentary)", "Trend analysis per metric", "Against-target comparison", "Action recommendations for off-track metrics"],
    qualityGate: ["Every metric has context", "Trends shown (not just point-in-time)", "Benchmarks included", "Data quality issues noted"],
    handoffProtocol: "KPI dashboard with trends, targets, and action recommendations",
  },
  {
    operationId: "DATA-02",
    departmentId: "data",
    name: "Ad Hoc Analysis",
    whenToUse: "Analyze this data, what does this mean, one-time data question",
    primaryAgent: "Atlas",
    primaryPersonaId: 12,
    supportAgents: [],
    requiredInputs: ["Data to analyze", "Question to answer"],
    stepSequence: [
      "Understand the question precisely",
      "Gather or receive data",
      "Process and clean data",
      "Analyze: Patterns, outliers, correlations, trends",
      "Visualize key findings",
      "Lead with the insight (bottom line first), then supporting data",
    ],
    toolChain: ["execute_code", "generate_chart", "create_pdf", "google_drive"],
    deliverables: ["Analysis summary (insight-first)", "Supporting data and charts", "Methodology notes", "Caveats and limitations"],
    qualityGate: ["Question answered directly", "Insights lead (not just data)", "Methodology transparent", "Limitations noted"],
    handoffProtocol: "Insight-first analysis with supporting data and methodology",
  },
  {
    operationId: "DATA-03",
    departmentId: "data",
    name: "Regular Reporting",
    whenToUse: "Weekly metrics, monthly report, quarterly review — recurring compilation",
    primaryAgent: "Atlas",
    primaryPersonaId: 12,
    supportAgents: [{ name: "Cassandra", personaId: 13 }],
    requiredInputs: ["Report type", "Period", "Standard metrics"],
    stepSequence: [
      "Pull data for the reporting period",
      "Calculate standard metrics",
      "Compare: vs. prior period, vs. target, vs. benchmark",
      "Generate standard visualizations",
      "Write narrative: Headlines → Details → Recommendations",
    ],
    toolChain: ["execute_code", "search_memory", "generate_chart", "create_pdf", "google_drive"],
    deliverables: ["Period report (formatted, consistent template)", "Charts and visualizations", "Variance analysis", "Forward-looking commentary"],
    qualityGate: ["Consistent template used", "Period comparisons included", "Narrative adds context"],
    handoffProtocol: "Period report with charts, variance analysis, and forward commentary",
  },
  {
    operationId: "DATA-04",
    departmentId: "data",
    name: "Data Visualization",
    whenToUse: "Turn data into charts, graphs, or visual displays",
    primaryAgent: "Atlas",
    primaryPersonaId: 12,
    supportAgents: [],
    requiredInputs: ["Data to visualize", "Visualization preferences"],
    stepSequence: [
      "Receive or collect data",
      "Determine best visualization type",
      "Generate chart",
      "If complex: generate dashboard",
      "Add titles, labels, and context",
    ],
    toolChain: ["execute_code", "generate_chart", "generate_dashboard"],
    deliverables: ["Chart(s)", "Dashboard (if complex)", "Data interpretation notes"],
    qualityGate: ["Appropriate chart type for the data", "Labels and titles clear", "Context provided"],
    handoffProtocol: "Visualizations with interpretation notes",
  },
  {
    operationId: "HR-01",
    departmentId: "hr",
    name: "Job Description / Role Definition",
    whenToUse: "Create a job posting, define a role, write hiring requirements",
    primaryAgent: "Scribe",
    primaryPersonaId: 7,
    supportAgents: [{ name: "Luna", personaId: 14 }],
    requiredInputs: ["Role title", "Department", "Key responsibilities", "Requirements"],
    stepSequence: [
      "Define: Role title, department, reporting structure, key responsibilities",
      "Research: Market salary ranges, comparable job postings",
      "Write: Title → Summary → Responsibilities → Requirements → Nice-to-haves → Compensation → Benefits",
      "Route to Luna for compliance review (equal opportunity, legal language)",
      "Save as document",
    ],
    toolChain: ["web_search", "search_memory", "delegate_task", "create_pdf", "google_drive"],
    deliverables: ["Job description document", "Salary benchmark data", "Posting-ready version"],
    qualityGate: ["Responsibilities are specific", "Requirements are realistic", "Legal compliance reviewed", "Salary data is current"],
    handoffProtocol: "Posting-ready job description with salary benchmarks",
  },
  {
    operationId: "HR-02",
    departmentId: "hr",
    name: "Onboarding Documentation",
    whenToUse: "Create onboarding materials for new team members, contractors, or partners",
    primaryAgent: "Scribe",
    primaryPersonaId: 7,
    supportAgents: [],
    requiredInputs: ["Role", "Access needed", "Key contacts"],
    stepSequence: [
      "Define: Role, access needed, key contacts, first-week priorities",
      "Create onboarding checklist: Day 1 → Week 1 → Month 1",
      "Write welcome materials and role-specific guides",
      "Document: Tool access, communication channels, key processes",
      "Save to knowledge base and project files",
    ],
    toolChain: ["search_memory", "create_knowledge", "create_pdf", "google_drive", "project"],
    deliverables: ["Onboarding checklist", "Welcome packet", "Role-specific guide", "Access/setup requirements list"],
    qualityGate: ["Timeline is specific (Day 1, Week 1, Month 1)", "All access requirements listed", "Key contacts identified"],
    handoffProtocol: "Complete onboarding package with checklist and guides",
  },
  {
    operationId: "HR-03",
    departmentId: "hr",
    name: "Policy Documentation",
    whenToUse: "Employee handbook, workplace policies, remote work policy, expense policy",
    primaryAgent: "Scribe",
    primaryPersonaId: 7,
    supportAgents: [{ name: "Luna", personaId: 14 }],
    requiredInputs: ["Policy type", "Company context", "Legal requirements"],
    stepSequence: [
      "Research: Best practices, legal requirements",
      "Draft policy in clear language",
      "Route to Luna for legal review",
      "Save as official document",
    ],
    toolChain: ["web_search", "delegate_task", "create_pdf", "google_drive"],
    deliverables: ["Policy document", "Legal review notes", "Employee acknowledgment form (if needed)"],
    qualityGate: ["Legal review completed", "Language is clear (not jargon-heavy)", "Applicable regulations addressed"],
    handoffProtocol: "Policy document with legal review notes",
  },
  {
    operationId: "CS-01",
    departmentId: "customer_success",
    name: "Help Documentation / FAQ",
    whenToUse: "Create customer-facing help docs, FAQ, troubleshooting guides",
    primaryAgent: "Chief of Staff",
    primaryPersonaId: 6,
    supportAgents: [{ name: "Scribe", personaId: 7 }, { name: "Proof", personaId: 8 }],
    requiredInputs: ["Common questions/issues", "Product context"],
    stepSequence: [
      "Identify common questions/issues from memory, inbox, feedback",
      "Write answers in clear, non-technical language",
      "Structure: Question → Answer → Steps (if applicable) → Related topics",
      "Save to knowledge base and as document",
      "Route to Proof for accuracy review",
    ],
    toolChain: ["search_memory", "create_knowledge", "create_pdf", "google_drive", "project"],
    deliverables: ["FAQ document", "Knowledge base entries", "Troubleshooting guide"],
    qualityGate: ["Answers are non-technical", "Steps are numbered and clear", "Reviewed for accuracy"],
    handoffProtocol: "Customer-ready help documentation with knowledge base entries",
  },
  {
    operationId: "CS-02",
    departmentId: "customer_success",
    name: "Customer Communication",
    whenToUse: "Customer email response, support ticket reply, status update to client",
    primaryAgent: "Chief of Staff",
    primaryPersonaId: 6,
    supportAgents: [{ name: "Scribe", personaId: 7 }],
    requiredInputs: ["Customer issue/question", "Customer context", "Urgency level"],
    stepSequence: [
      "Understand the customer's issue/question",
      "Research answer (if needed, search memory for customer history)",
      "Draft response: Acknowledge → Answer → Next steps → Closing",
      "Send via appropriate channel",
      "Log interaction in memory",
    ],
    toolChain: ["search_memory", "web_search", "send_email", "create_memory"],
    deliverables: ["Customer communication (sent)", "Interaction logged in memory", "Follow-up scheduled if needed"],
    qualityGate: ["Issue acknowledged empathetically", "Answer is complete", "Next steps are clear", "Response is timely"],
    handoffProtocol: "Customer communication sent with interaction logged",
  },
  {
    operationId: "CS-03",
    departmentId: "customer_success",
    name: "Customer Feedback Analysis",
    whenToUse: "Analyze customer feedback, NPS results, review themes, complaint patterns",
    primaryAgent: "Chief of Staff",
    primaryPersonaId: 6,
    supportAgents: [{ name: "Atlas", personaId: 12 }],
    requiredInputs: ["Feedback data", "Analysis period"],
    stepSequence: [
      "Collect feedback data",
      "Categorize: Feature requests, bugs, praise, complaints",
      "Identify patterns and top themes",
      "Prioritize: What to address first based on frequency and severity",
      "Generate report with recommendations",
    ],
    toolChain: ["search_memory", "execute_code", "generate_chart", "create_pdf", "google_drive"],
    deliverables: ["Feedback analysis report", "Theme categorization", "Priority action items", "Trend charts"],
    qualityGate: ["Themes are data-driven", "Priorities based on frequency + severity", "Recommendations are actionable"],
    handoffProtocol: "Feedback analysis with categorized themes and priority action items",
  },
  {
    operationId: "STRAT-01",
    departmentId: "executive",
    name: "Ideation / Brainstorming Session",
    whenToUse: "User asks for new ideas, brainstorming, innovation, product ideation, what should we build, explore options, SCAMPER, first principles, how might we",
    primaryAgent: "Felix",
    primaryPersonaId: 2,
    supportAgents: [
      { name: "Radar", personaId: 9 },
      { name: "Blueprint", personaId: 5 },
      { name: "Chief of Staff", personaId: 6 },
    ],
    requiredInputs: ["Topic or challenge to ideate on", "Framework preference (optional: scamper, first_principles, jtbd, pre_mortem, hmw, constraints)", "Constraints or context"],
    stepSequence: [
      "Clarify the problem space and constraints with the user",
      "Run ideation_session tool with chosen framework (default: first_principles)",
      "Diverge phase: Generate 5–8 raw variations using the framework",
      "Delegate to Radar: Research market validation for top 2–3 directions",
      "Converge phase: Stress-test and rank the best directions",
      "Ship phase: Produce actionable one-pager with MVP scope, assumptions to validate, and Not Doing list",
      "Save winning ideas to memory and daily notes",
    ],
    toolChain: ["ideation_session", "search_memory", "create_memory", "delegate_task", "web_search", "write_daily_note", "google_drive"],
    deliverables: ["Ideation session output with framework analysis", "Ranked ideas with scoring rationale", "One-pager for top idea: MVP scope, assumptions, Not Doing list", "Saved to memory for continuity"],
    qualityGate: ["At least 5 distinct ideas generated", "Ideas are grounded in framework (not random)", "Top pick has clear MVP scope and first action step", "Assumptions are explicit and testable"],
    handoffProtocol: "One-pager with MVP scope, key assumptions, and immediate next actions",
  },
  {
    operationId: "OPS-07",
    departmentId: "operations",
    name: "Security Audit",
    whenToUse: "User asks for security review, vulnerability scan, OWASP check, security audit, penetration test, threat assessment",
    primaryAgent: "Forge",
    primaryPersonaId: 3,
    supportAgents: [
      { name: "Chief of Staff", personaId: 6 },
      { name: "Felix", personaId: 2 },
    ],
    requiredInputs: ["Target (codebase, API, infrastructure, or full)", "Scope constraints (optional)"],
    stepSequence: [
      "Determine scan scope: input_handling, auth, data_protection, infrastructure, third_party, or full",
      "Run agent_security_scan tool with specified scan types",
      "Map findings to OWASP Top 10 categories",
      "For Critical/High findings, generate exploit scenarios",
      "Prioritize: Critical → High → Medium → Low → Info",
      "Generate remediation plan with specific code fixes",
      "Report security grade and coverage summary",
    ],
    toolChain: ["agent_security_scan", "execute_code", "search_memory", "create_memory", "create_pdf", "google_drive"],
    deliverables: ["Security audit report with OWASP mapping", "Prioritized findings list with severity", "Exploit scenarios for Critical/High issues", "Remediation plan with code-level fixes", "Security grade (A–F)"],
    qualityGate: ["All 5 scan categories covered", "Every finding mapped to OWASP category", "Critical/High findings have exploit scenarios", "Remediation steps are actionable, not generic"],
    handoffProtocol: "Security audit report with grade, prioritized findings, and remediation plan",
  },
  {
    operationId: "OPS-08",
    departmentId: "operations",
    name: "User Model Review",
    whenToUse: "User asks about their preferences, how the system adapts to them, or wants to see their user profile",
    primaryAgent: "VisionClaw",
    primaryPersonaId: 1,
    supportAgents: [
      { name: "Felix", personaId: 2 },
    ],
    requiredInputs: ["Optional: specific question about user preferences"],
    stepSequence: [
      "Query user model for current profile state",
      "Present communication style and decision patterns",
      "Show personality traits and preferences",
      "If question provided, use dialectic agent to answer",
      "Suggest how the system is adapting responses based on profile",
    ],
    toolChain: ["user_model_query", "search_memory"],
    deliverables: ["User profile summary", "Adaptation insights", "Dialectic answer (if question asked)"],
    qualityGate: ["Profile data is current", "Traits are explained clearly"],
    handoffProtocol: "User profile summary with adaptation insights",
  },
  {
    operationId: "ENG-08",
    departmentId: "engineering",
    name: "Skill Evolution Cycle",
    whenToUse: "User asks to optimize tools, check tool performance, run evolution cycle, or improve underperforming tools",
    primaryAgent: "Blueprint",
    primaryPersonaId: 5,
    supportAgents: [
      { name: "Forge", personaId: 3 },
      { name: "Chief of Staff", personaId: 6 },
    ],
    requiredInputs: ["Optional: specific tool to analyze"],
    stepSequence: [
      "Pull tool performance report showing success/failure rates",
      "Identify underperforming tools (>30% failure rate)",
      "Trigger evolution cycle to analyze failure patterns",
      "Review generated optimization hints",
      "Report improvements and recommendations",
    ],
    toolChain: ["tool_performance_report", "knowledge_nudge_stats", "search_memory", "create_memory"],
    deliverables: ["Tool performance report", "Knowledge nudge statistics", "Identified failure patterns", "Optimization hints for underperforming tools"],
    qualityGate: ["All tools with 10+ calls analyzed", "Failure patterns identified for high-fail-rate tools"],
    handoffProtocol: "Performance report with evolution improvements",
  },
];

export const CROSS_DEPARTMENT_WORKFLOWS: CrossDepartmentWorkflow[] = [
  {
    workflowId: "CROSS-01",
    name: "New Product Launch",
    whenToUse: "Launching a new product, service, or major feature",
    involvedAgents: [
      { name: "Radar", personaId: 9 },
      { name: "Cassandra", personaId: 13 },
      { name: "Luna", personaId: 14 },
      { name: "Scribe", personaId: 7 },
      { name: "Apollo", personaId: 11 },
      { name: "Teagan", personaId: 4 },
      { name: "Proof", personaId: 8 },
      { name: "Felix", personaId: 2 },
    ],
    orchestrationSteps: [
      {
        stepNumber: 1,
        parallel: true,
        tasks: [
          { agent: "Radar", personaId: 9, instruction: "Market research — competitive landscape, target audience, positioning" },
          { agent: "Cassandra", personaId: 13, instruction: "Financial model — pricing, revenue projections, break-even analysis" },
          { agent: "Luna", personaId: 14, instruction: "Legal review — regulatory requirements, IP considerations" },
        ],
      },
      {
        stepNumber: 2,
        parallel: true,
        tasks: [
          { agent: "Scribe", personaId: 7, instruction: "Write launch materials — landing page copy, product description, press release" },
          { agent: "Apollo", personaId: 11, instruction: "Create sales materials — pitch deck, outreach templates, pricing sheet" },
        ],
      },
      {
        stepNumber: 3,
        parallel: true,
        tasks: [
          { agent: "Teagan", personaId: 4, instruction: "Create social media campaign — launch posts, content calendar, visual assets" },
          { agent: "Proof", personaId: 8, instruction: "Review all materials for quality and consistency" },
        ],
      },
      {
        stepNumber: 4,
        parallel: false,
        tasks: [
          { agent: "Felix", personaId: 2, instruction: "Synthesize all deliverables, create launch timeline, present to user" },
        ],
      },
    ],
  },
  {
    workflowId: "CROSS-02",
    name: "Client Onboarding Package",
    whenToUse: "Onboarding a new client with full documentation package",
    involvedAgents: [
      { name: "Apollo", personaId: 11 },
      { name: "Luna", personaId: 14 },
      { name: "Cassandra", personaId: 13 },
      { name: "Scribe", personaId: 7 },
      { name: "Chief of Staff", personaId: 6 },
      { name: "Felix", personaId: 2 },
    ],
    orchestrationSteps: [
      {
        stepNumber: 1,
        parallel: true,
        tasks: [
          { agent: "Apollo", personaId: 11, instruction: "Prepare welcome email and kickoff agenda" },
          { agent: "Luna", personaId: 14, instruction: "Generate contract / SOW for signature" },
          { agent: "Cassandra", personaId: 13, instruction: "Set up invoicing / payment schedule" },
        ],
      },
      {
        stepNumber: 2,
        parallel: true,
        tasks: [
          { agent: "Scribe", personaId: 7, instruction: "Write onboarding guide and project documentation" },
          { agent: "Chief of Staff", personaId: 6, instruction: "Set up project folder, communication channels" },
        ],
      },
      {
        stepNumber: 3,
        parallel: false,
        tasks: [
          { agent: "Felix", personaId: 2, instruction: "Package all deliverables, deliver to client" },
        ],
      },
    ],
  },
  {
    workflowId: "CROSS-03",
    name: "Quarterly Business Review (QBR)",
    whenToUse: "Quarterly business review, comprehensive business assessment",
    involvedAgents: [
      { name: "Atlas", personaId: 12 },
      { name: "Cassandra", personaId: 13 },
      { name: "Radar", personaId: 9 },
      { name: "Teagan", personaId: 4 },
      { name: "Scribe", personaId: 7 },
      { name: "Felix", personaId: 2 },
    ],
    orchestrationSteps: [
      {
        stepNumber: 1,
        parallel: true,
        tasks: [
          { agent: "Atlas", personaId: 12, instruction: "Compile all KPIs and metrics for the quarter" },
          { agent: "Cassandra", personaId: 13, instruction: "Financial summary — P&L, cash position, budget vs. actual" },
          { agent: "Radar", personaId: 9, instruction: "Market/competitive update — what changed this quarter" },
        ],
      },
      {
        stepNumber: 2,
        parallel: true,
        tasks: [
          { agent: "Teagan", personaId: 4, instruction: "Marketing performance review — campaigns, growth, engagement" },
          { agent: "Scribe", personaId: 7, instruction: "Write QBR narrative — achievements, challenges, outlook" },
        ],
      },
      {
        stepNumber: 3,
        parallel: false,
        tasks: [
          { agent: "Felix", personaId: 2, instruction: "Synthesize into QBR presentation, set next quarter priorities" },
        ],
      },
    ],
  },
  {
    workflowId: "CROSS-04",
    name: "Content Marketing Campaign",
    whenToUse: "Full content marketing push — blog series, social, email, video",
    involvedAgents: [
      { name: "Radar", personaId: 9 },
      { name: "Scribe", personaId: 7 },
      { name: "Teagan", personaId: 4 },
      { name: "Neptune", personaId: 10 },
      { name: "Proof", personaId: 8 },
    ],
    orchestrationSteps: [
      {
        stepNumber: 1,
        parallel: false,
        tasks: [
          { agent: "Radar", personaId: 9, instruction: "Research: target audience, trending topics, competitor content, SEO keywords" },
        ],
      },
      {
        stepNumber: 2,
        parallel: true,
        tasks: [
          { agent: "Scribe", personaId: 7, instruction: "Write: blog posts, email sequences, landing page copy" },
          { agent: "Teagan", personaId: 4, instruction: "Create: social media posts, content calendar, ad copy" },
          { agent: "Neptune", personaId: 10, instruction: "Produce: video scripts, audio content, visual assets" },
        ],
      },
      {
        stepNumber: 3,
        parallel: false,
        tasks: [
          { agent: "Proof", personaId: 8, instruction: "Review all content for quality, brand consistency, and accuracy" },
        ],
      },
    ],
  },
  {
    workflowId: "CROSS-05",
    name: "Market Expansion Assessment",
    whenToUse: "Evaluating entry into a new market, geography, or customer segment",
    involvedAgents: [
      { name: "Radar", personaId: 9 },
      { name: "Cassandra", personaId: 13 },
      { name: "Luna", personaId: 14 },
      { name: "Apollo", personaId: 11 },
      { name: "Felix", personaId: 2 },
    ],
    orchestrationSteps: [
      {
        stepNumber: 1,
        parallel: true,
        tasks: [
          { agent: "Radar", personaId: 9, instruction: "Market research — size, competition, barriers to entry, customer needs" },
          { agent: "Luna", personaId: 14, instruction: "Regulatory and compliance requirements for the new market" },
        ],
      },
      {
        stepNumber: 2,
        parallel: true,
        tasks: [
          { agent: "Cassandra", personaId: 13, instruction: "Financial feasibility — investment required, ROI timeline, break-even" },
          { agent: "Apollo", personaId: 11, instruction: "Sales strategy — channels, pricing, go-to-market approach" },
        ],
      },
      {
        stepNumber: 3,
        parallel: false,
        tasks: [
          { agent: "Felix", personaId: 2, instruction: "Synthesize into Go/No-Go recommendation with expansion roadmap" },
        ],
      },
    ],
  },
  {
    workflowId: "CROSS-06",
    name: "Annual Planning",
    whenToUse: "Annual business planning, year-ahead strategy, budget allocation",
    involvedAgents: [
      { name: "Atlas", personaId: 12 },
      { name: "Cassandra", personaId: 13 },
      { name: "Radar", personaId: 9 },
      { name: "Felix", personaId: 2 },
    ],
    orchestrationSteps: [
      {
        stepNumber: 1,
        parallel: true,
        tasks: [
          { agent: "Atlas", personaId: 12, instruction: "Year-in-review metrics and performance analysis" },
          { agent: "Cassandra", personaId: 13, instruction: "Financial year-in-review and next-year budget framework" },
          { agent: "Radar", personaId: 9, instruction: "Industry outlook and competitive landscape for next year" },
        ],
      },
      {
        stepNumber: 2,
        parallel: false,
        tasks: [
          { agent: "Felix", personaId: 2, instruction: "Set annual strategy, OKRs, budget allocation, and organizational priorities" },
        ],
      },
    ],
  },
];

export const OPERATION_TOOL_MAP: Record<string, string[]> = {
  research_quick: ["web_search"],
  research_page: ["web_fetch"],
  research_deep_scrape: ["firecrawl_scrape"],
  research_multi_source: ["deep_research"],
  research_full_site: ["firecrawl_crawl"],
  research_past: ["scraped_pages_query"],
  research_docs: ["doc_search"],
  file_create_pdf: ["create_pdf"],
  file_read_pdf: ["analyze_pdf"],
  file_edit_pdf: ["edit_pdf", "fill_pdf"],
  file_storage: ["google_drive"],
  file_local: ["read_file", "list_uploads"],
  file_workspace: ["google_workspace"],
  comm_email: ["send_email"],
  comm_gmail: ["google_workspace"],
  comm_whatsapp: ["whatsapp"],
  comm_channels: ["post_to_channel", "read_channels"],
  comm_calendar: ["google_workspace"],
  analysis_code: ["execute_code"],
  analysis_chart: ["generate_chart"],
  analysis_dashboard: ["generate_dashboard"],
  analysis_llm: ["llm_task"],
  delegation_oneshot: ["delegate_task"],
  delegation_multi: ["orchestrate"],
  delegation_async: ["sessions_spawn"],
  delegation_message: ["sessions_send"],
  delegation_quality: ["critique_response"],
  delegation_debate: ["debate"],
  delegation_reasoning: ["tree_of_thought"],
  delegation_cost: ["estimate_cost"],
  memory_store: ["create_memory"],
  memory_find: ["search_memory"],
  memory_update: ["update_memory"],
  memory_log: ["write_daily_note"],
  memory_recall_events: ["get_daily_notes"],
  memory_context: ["recall_context"],
  memory_knowledge: ["search_knowledge", "create_knowledge"],
  social_draft: ["draft_social_post"],
  social_compose: ["compose_social_post"],
  social_publish: ["publish_social_post"],
  social_image: ["generate_social_image"],
  social_calendar: ["manage_content_calendar"],
  social_analytics: ["marketing_analytics"],
  social_experiment: ["marketing_experiment"],
  social_accounts: ["manage_social_accounts"],
  media_audio: ["generate_audio"],
  media_video: ["create_slideshow_video", "produce_video"],
  media_image: ["generate_social_image", "search_stock_media"],
};

function scoreKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (lower.includes(kwLower)) {
      score += kwLower.includes(" ") ? 3 : 2;
    }
  }
  return score;
}

export function classifyRequest(userMessage: string): ClassificationResult {
  const deptScores = DEPARTMENTS.map((d) => ({
    department: d,
    score: scoreKeywords(userMessage, d.triggerKeywords),
  })).sort((a, b) => b.score - a.score);

  const topDept = deptScores[0];
  if (topDept.score === 0) {
    return {
      department: DEPARTMENTS.find((d) => d.id === "operations")!,
      operation: null,
      confidence: 0,
      crossDepartment: null,
    };
  }

  const deptOps = OPERATION_SCAFFOLDS.filter(
    (op) => op.departmentId === topDept.department.id,
  );

  let bestOp: OperationScaffold | null = null;
  let bestOpScore = 0;
  for (const op of deptOps) {
    const opTerms = [
      op.name,
      op.whenToUse,
      ...op.requiredInputs,
      ...op.deliverables,
    ];
    const s = scoreKeywords(userMessage, opTerms);
    if (s > bestOpScore) {
      bestOpScore = s;
      bestOp = op;
    }
  }

  if (!bestOp && bestOpScore === 0 && deptOps.length > 0) {
    bestOp = null;
  }

  const crossWorkflow = matchCrossDepartmentWorkflow(userMessage);
  const maxPossible = topDept.department.triggerKeywords.length * 3;
  const confidence = Math.min(1, topDept.score / Math.max(maxPossible * 0.3, 1));

  return {
    department: topDept.department,
    operation: bestOp,
    confidence,
    crossDepartment: crossWorkflow,
  };
}

function matchCrossDepartmentWorkflow(
  userMessage: string,
): CrossDepartmentWorkflow | null {
  const crossKeywords: Record<string, string[]> = {
    "CROSS-01": ["launch", "new product", "product launch", "go to market", "GTM", "release"],
    "CROSS-02": ["client onboarding", "new client", "onboard customer", "welcome package", "kickoff"],
    "CROSS-03": ["quarterly review", "QBR", "quarterly business review", "quarterly assessment", "quarter review", "business review"],
    "CROSS-04": ["content campaign", "content marketing", "blog series", "marketing campaign", "content push"],
    "CROSS-05": ["market expansion", "new market", "enter market", "expansion", "new geography", "new segment"],
    "CROSS-06": ["annual planning", "annual plan", "year ahead", "next year plan", "yearly strategy", "annual strategy"],
  };

  let bestId: string | null = null;
  let bestScore = 0;
  for (const [id, keywords] of Object.entries(crossKeywords)) {
    const score = scoreKeywords(userMessage, keywords);
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  if (bestId && bestScore > 0) {
    return (
      CROSS_DEPARTMENT_WORKFLOWS.find((w) => w.workflowId === bestId) || null
    );
  }
  return null;
}

export function formatScaffoldForPrompt(scaffold: OperationScaffold): string {
  let prompt = `=== OPERATION SCAFFOLD ===\n`;
  prompt += `Operation: ${scaffold.operationId} — ${scaffold.name}\n`;
  prompt += `Department: ${DEPARTMENTS.find((d) => d.id === scaffold.departmentId)?.name || scaffold.departmentId}\n`;
  prompt += `You are: ${scaffold.primaryAgent}\n\n`;

  if (scaffold.requiredInputs.length > 0) {
    prompt += `REQUIRED INPUTS:\n`;
    for (const input of scaffold.requiredInputs) {
      prompt += `- ${input}\n`;
    }
    prompt += `\n`;
  }

  prompt += `STEP SEQUENCE:\n`;
  scaffold.stepSequence.forEach((step, i) => {
    prompt += `${i + 1}. ${step}\n`;
  });
  prompt += `\n`;

  prompt += `TOOL CHAIN:\n`;
  prompt += scaffold.toolChain.join(" → ") + "\n\n";

  prompt += `DELIVERABLES EXPECTED:\n`;
  for (const d of scaffold.deliverables) {
    prompt += `- ${d}\n`;
  }
  prompt += `\n`;

  prompt += `QUALITY STANDARDS:\n`;
  for (const q of scaffold.qualityGate) {
    prompt += `- ${q}\n`;
  }
  prompt += `\n`;

  prompt += `GOVERNANCE RULES:\n`;
  prompt += `- Check your trust score before acting autonomously. If trust < 60, get approval first.\n`;
  prompt += `- NEVER auto-execute: payment_action, browser_form_submit, execute_shell_destructive, kill_switch, production_data_delete — these always require CEO approval.\n`;
  prompt += `- Express lanes allow direct delegation between approved persona pairs without Felix routing. Check if one exists before going through Felix.\n`;
  prompt += `- You have a Proactive Action Budget (PAB). Before taking unsolicited actions, verify you have remaining PAB for the day.\n`;
  prompt += `- All files and documents MUST go to Google Drive. Never reference local file paths in deliverables.\n`;
  prompt += `- If you encounter a blocker, escalate immediately via project notes (noteType="blocker") rather than silently failing.\n`;
  prompt += `- For complex decisions, use collective intelligence protocols: Specialist+Critique for medium, Chain of Debates for high, Full Council for critical.\n`;
  prompt += `\n`;

  prompt += `AUTONOMY LEVELS:\n`;
  prompt += `- full_auto (trust >= 80): Execute without asking. Just do it and report results.\n`;
  prompt += `- notify_after (trust 60-79): Execute, then notify the CEO what you did.\n`;
  prompt += `- approve_before (trust 30-59): Propose your plan and wait for approval before executing.\n`;
  prompt += `- blocked (trust < 30): Cannot act autonomously. Request help from Felix.\n`;
  prompt += `\n`;

  prompt += `HANDOFF INSTRUCTIONS:\n`;
  prompt += `When complete, return with:\n`;
  prompt += `- Summary of what was done\n`;
  prompt += `- List of files created (with Google Drive links)\n`;
  prompt += `- Any issues or items needing attention\n`;
  prompt += `- Recommendations or next steps\n`;
  prompt += `=========================\n`;

  return prompt;
}

export function formatCrossWorkflowForPrompt(
  workflow: CrossDepartmentWorkflow,
): string {
  let prompt = `=== CROSS-DEPARTMENT WORKFLOW ===\n`;
  prompt += `Workflow: ${workflow.workflowId} — ${workflow.name}\n`;
  prompt += `Agents Involved: ${workflow.involvedAgents.map((a) => a.name).join(", ")}\n\n`;

  prompt += `ORCHESTRATION PLAN:\n`;
  for (const step of workflow.orchestrationSteps) {
    prompt += `\nStep ${step.stepNumber} (${step.parallel ? "parallel" : "sequential"}):\n`;
    for (const task of step.tasks) {
      prompt += `  - ${task.agent}: ${task.instruction}\n`;
    }
  }
  prompt += `\n`;

  prompt += `CROSS-DEPARTMENT GOVERNANCE:\n`;
  prompt += `- Each agent operates within their trust-based autonomy level. Do not override another agent's trust boundaries.\n`;
  prompt += `- NEVER auto-execute: payment_action, browser_form_submit, execute_shell_destructive, kill_switch, production_data_delete.\n`;
  prompt += `- Use express lanes for direct agent-to-agent delegation when available. Otherwise route through Felix.\n`;
  prompt += `- All deliverables go to Google Drive. Share Drive links, never local file paths.\n`;
  prompt += `- If any step in the orchestration fails, log it as a blocker (project noteType="blocker") and continue with remaining parallel steps.\n`;
  prompt += `- For disagreements between agents, escalate to collective intelligence (Specialist+Critique or Chain of Debates).\n`;
  prompt += `================================\n`;

  return prompt;
}

export function buildClassificationContext(): string {
  let ctx = `\n=== TASK CLASSIFICATION ENGINE ===\n`;
  ctx += `When you receive a request, classify it into a Department and Operation Type to determine the optimal execution scaffold.\n\n`;

  ctx += `DEPARTMENT ROUTING TABLE:\n`;
  for (const d of DEPARTMENTS) {
    ctx += `- ${d.name}: Primary → ${d.primaryAgent}`;
    if (d.backupAgent) ctx += `, Backup → ${d.backupAgent}`;
    ctx += `\n`;
  }
  ctx += `\n`;

  ctx += `CROSS-DEPARTMENT WORKFLOWS (use orchestrate tool):\n`;
  for (const w of CROSS_DEPARTMENT_WORKFLOWS) {
    ctx += `- ${w.workflowId}: ${w.name} — ${w.whenToUse}\n`;
  }
  ctx += `\n`;

  ctx += `QUICK DECISION MATRIX:\n`;
  const quickMap: [string, string, string, string][] = [
    ["Write a blog post about...", "Content", "CONTENT-01", "Scribe"],
    ["Build me an app that...", "Engineering", "ENG-01", "Forge"],
    ["Research the market for...", "Research", "RESEARCH-01", "Radar"],
    ["Create a social media post...", "Marketing", "MKT-01", "Teagan"],
    ["How much revenue did we...", "Finance", "FIN-03", "Cassandra"],
    ["Show me our metrics...", "Data", "DATA-01", "Atlas"],
    ["Review this contract...", "Legal", "LEGAL-01", "Luna"],
    ["Is everything working?", "Operations", "OPS-01", "Chief of Staff"],
    ["Reach out to this prospect...", "Sales", "SALES-01", "Apollo"],
    ["Enrich and score these leads...", "Sales", "SALES-07", "Apollo"],
    ["Create an outreach sequence for...", "Sales", "SALES-08", "Apollo"],
    ["Collect evidence on this topic...", "Research", "RES-06", "Radar"],
    ["Monitor our competitors...", "Research", "RES-07", "Radar"],
    ["Plan our Q2 strategy...", "Executive", "EXEC-01", "Felix (self)"],
    ["Create a job posting...", "HR", "HR-01", "Scribe"],
    ["Help the customer with...", "Customer Success", "CS-02", "Chief of Staff"],
    ["Launch our new product...", "Cross-Dept", "CROSS-01", "Felix (orchestrate)"],
    ["Do a quarterly review...", "Cross-Dept", "CROSS-03", "Felix (orchestrate)"],
  ];
  for (const [input, dept, op, agent] of quickMap) {
    ctx += `  "${input}" → ${dept} → ${op} → ${agent}\n`;
  }

  ctx += `\nWhen delegating, include the operation scaffold in the task prompt to give the agent structured guidance.\n\n`;

  ctx += `DELEGATION GOVERNANCE RULES:\n`;
  ctx += `- Before delegating, check the target agent's trust score. If trust < 30 (blocked), handle the task yourself or escalate.\n`;
  ctx += `- Use express lanes for direct delegation between approved agent pairs (bypasses Felix routing). Check findLanesForAgent() for available lanes.\n`;
  ctx += `- Each agent has a Proactive Action Budget (PAB). Do not assign proactive work to agents who have exhausted their daily PAB.\n`;
  ctx += `- NEVER delegate these actions without CEO approval: payment_action, browser_form_submit, execute_shell_destructive, kill_switch, production_data_delete.\n`;
  ctx += `- All deliverables MUST go to Google Drive. Instruct agents to use create_pdf (auto-uploads) or google_drive (manual upload). No local file paths.\n`;
  ctx += `- For complex decisions requiring multiple perspectives, use collective intelligence protocols instead of single-agent delegation.\n`;
  ctx += `- If an agent fails a task 3 times consecutively on the same express lane, the lane auto-suspends. Reroute through standard delegation.\n`;
  ctx += `- When a task is blocked, the agent should log it as a project note (noteType="blocker") and notify you immediately.\n`;
  ctx += `- Trust score thresholds: full_auto >= 80, notify_after 60-79, approve_before 30-59, blocked < 30.\n`;
  ctx += `=================================\n`;

  return ctx;
}

export function getScaffoldForDelegation(
  taskDescription: string,
  targetPersonaId: number,
): OperationScaffold | null {
  const candidateOps = OPERATION_SCAFFOLDS.filter(
    (op) =>
      op.primaryPersonaId === targetPersonaId ||
      op.supportAgents.some((sa) => sa.personaId === targetPersonaId),
  );

  if (candidateOps.length === 0) return null;

  let bestOp: OperationScaffold | null = null;
  let bestScore = 0;
  for (const op of candidateOps) {
    const allText = [op.name, op.whenToUse, ...op.deliverables, ...op.requiredInputs, ...op.stepSequence].join(" ");
    const words = allText.split(/[\s,;.]+/).filter(w => w.length > 3);
    const uniqueWords = [...new Set(words)];
    let score = scoreKeywords(taskDescription, uniqueWords);
    if (op.primaryPersonaId === targetPersonaId) score += 5;
    if (score > bestScore) {
      bestScore = score;
      bestOp = op;
    }
  }

  if (bestOp && bestScore < 8) {
    bestOp = null;
  }

  return bestOp;
}

export function getToolsForOperation(operationId: string): string[] {
  const scaffold = OPERATION_SCAFFOLDS.find(
    (op) => op.operationId === operationId,
  );
  return scaffold ? scaffold.toolChain : [];
}
