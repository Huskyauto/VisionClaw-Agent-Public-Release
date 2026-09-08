export type OpportunityCategory =
  | "Assessment"
  | "Monitoring"
  | "Implementation"
  | "Partner"
  | "Education";

export type OpportunityEvidence = "Idea" | "Observed" | "Committed" | "Paid" | "Repeatable";

export interface IncomeOpportunity {
  slug: string;
  name: string;
  category: OpportunityCategory;
  evidence: OpportunityEvidence;
  buyer: string;
  problem: string;
  entryOffer: string;
  price: string;
  expansion: string;
  nextStep: string;
  featured?: boolean;
}

export const INCOME_OPPORTUNITIES: IncomeOpportunity[] = [
  {
    slug: "ai-automation-impact-audit",
    name: "AI Automation Impact Audit",
    category: "Assessment",
    evidence: "Idea",
    buyer: "Businesses with 20–250 employees considering automation",
    problem: "Payroll savings can hide customer loss, transition costs, errors, and lost knowledge.",
    entryOffer: "A plain-language risk snapshot comparing replacement, augmentation, and expansion.",
    price: "$497 snapshot",
    expansion: "$1,997 transition stress test, implementation, and monthly monitoring",
    nextStep: "Interview five business owners who are considering an AI change in the next 90 days.",
    featured: true,
  },
  {
    slug: "true-automation-roi-monitor",
    name: "True Automation ROI Monitor",
    category: "Monitoring",
    evidence: "Idea",
    buyer: "Companies already operating AI agents or automated workflows",
    problem: "Projected labor savings often never become measurable profit.",
    entryOffer: "Compare the original business case with actual cost, quality, revenue, and rework.",
    price: "$750 baseline review",
    expansion: "$299–$1,000 monthly monitoring",
    nextStep: "Define the ten measurements required for a credible before-and-after comparison.",
    featured: true,
  },
  {
    slug: "workforce-reabsorption-planner",
    name: "Workforce Reabsorption Planner",
    category: "Assessment",
    evidence: "Idea",
    buyer: "Employers, workforce boards, and municipalities",
    problem: "Organizations know which tasks may disappear but not where people can create new value.",
    entryOffer: "Map affected tasks to redeployment, training, new service, and growth opportunities.",
    price: "$1,500 planning packet",
    expansion: "Training plans and local economic scenario reports",
    nextStep: "Test the task-to-new-work interview with one employer and one workforce advisor.",
  },
  {
    slug: "white-label-ai-transition-reports",
    name: "White-label AI Transition Reports",
    category: "Partner",
    evidence: "Idea",
    buyer: "Fractional CFOs, accountants, HR advisors, and MSPs",
    problem: "Trusted advisors need credible AI analysis without building an internal research team.",
    entryOffer: "Customer-owned automation assessment delivered under the advisor's brand.",
    price: "$250–$500 wholesale",
    expansion: "Partner subscription and branded portal",
    nextStep: "Show a one-page sample outline to three advisors and ask what would make it sellable.",
    featured: true,
  },
  {
    slug: "responsible-automation-workshop",
    name: "Responsible Automation Workshop",
    category: "Education",
    evidence: "Idea",
    buyer: "Leadership teams, chambers, and trade associations",
    problem: "Leaders hear extreme AI claims but lack a practical framework for deciding what to automate.",
    entryOffer: "A 60–90 minute briefing on durable automation decisions and hidden ROI risks.",
    price: "$500–$7,500",
    expansion: "Assessment and implementation leads",
    nextStep: "Create a ten-slide outline and ask one local organization to critique it.",
  },
  {
    slug: "ai-trust-audit",
    name: "AI Trust Audit",
    category: "Assessment",
    evidence: "Idea",
    buyer: "Local small businesses",
    problem: "Customers and AI discovery systems cannot reliably understand or trust the business online.",
    entryOffer: "Fixed-price review of AI discoverability, public trust signals, and practical corrections.",
    price: "$497 audit",
    expansion: "$1,997 remediation and recurring monitoring",
    nextStep: "Run the existing prospecting play against a tightly bounded local niche.",
  },
  {
    slug: "executive-report-studio",
    name: "Evidence-backed Executive Report Studio",
    category: "Implementation",
    evidence: "Idea",
    buyer: "Consultants, associations, and specialist advisors",
    problem: "High-value expertise is trapped in notes and research instead of customer-ready deliverables.",
    entryOffer: "Produce a sourced, customer-owned premium report with explicit confidence labels.",
    price: "$1,500–$5,000",
    expansion: "Recurring research and white-label fulfillment",
    nextStep: "Choose one narrow report type and produce a sample from verified public evidence.",
  },
  {
    slug: "ai-cost-margin-audit",
    name: "AI Cost and Margin Audit",
    category: "Assessment",
    evidence: "Idea",
    buyer: "Companies with growing model and API bills",
    problem: "AI usage grows faster than teams can attribute cost to customers, workflows, and outcomes.",
    entryOffer: "Trace spend, find waste, and estimate savings from safer routing and workload changes.",
    price: "$750–$2,500",
    expansion: "Optimization implementation and monthly monitoring",
    nextStep: "Turn VisionClaw's observed-cost method into a customer-safe sample report.",
  },
  {
    slug: "agent-reliability-review",
    name: "Agent Reliability Review",
    category: "Assessment",
    evidence: "Idea",
    buyer: "Businesses deploying autonomous workflows",
    problem: "Automations can duplicate actions, lose deliverables, overspend, or bypass human approval.",
    entryOffer: "Review failure handling, approval boundaries, cost ceilings, and recovery paths.",
    price: "$1,997 review",
    expansion: "Hardened implementation and managed monitoring",
    nextStep: "Define a vendor-neutral checklist from proven VisionClaw reliability controls.",
  },
  {
    slug: "local-business-ai-opportunity-map",
    name: "Local Business AI Opportunity Map",
    category: "Partner",
    evidence: "Idea",
    buyer: "Chambers of commerce and economic-development groups",
    problem: "Local leaders lack a grounded view of which industries face displacement or growth opportunities.",
    entryOffer: "An evidence-labeled industry, task-exposure, and local opportunity scenario report.",
    price: "$5,000–$25,000",
    expansion: "Member workshops, assessments, and annual refreshes",
    nextStep: "Ask one local organization which decisions such a report would need to support.",
  },
];
