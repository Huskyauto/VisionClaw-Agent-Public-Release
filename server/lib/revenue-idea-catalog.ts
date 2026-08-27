export type RevenueWorkspaceKey = "customer-revenue-launchpad" | "fable-5";

export type RevenueIdeaDefinition = {
  slug: string;
  title: string;
  summary: string;
  targetBuyer: string;
  validationState: string;
  briefPath: string;
  starterPrompt: string;
  linkedProjectName?: string;
};

export type RevenueWorkspaceDefinition = {
  key: RevenueWorkspaceKey;
  parentProjectName: string;
  parentProjectDescription: string;
  parentProjectTags: string[];
  ownerOnly: true;
  ideas: RevenueIdeaDefinition[];
};

const MANUAL_VALIDATION_RULE =
  "Keep this as an evidence-led, owner-approved working session. Do not send outreach, create customers, collect payment, or start fulfillment.";

const WORKSPACES: Record<RevenueWorkspaceKey, RevenueWorkspaceDefinition> = {
  "customer-revenue-launchpad": {
    key: "customer-revenue-launchpad",
    parentProjectName: "Customer Revenue Launchpad",
    parentProjectDescription:
      "Owner-only workspace for five evidence-driven customer offers. Manual validation only; no outreach, customer records, payments, or automatic fulfillment.",
    parentProjectTags: ["revenue", "launchpad", "owner-only", "manual-validation"],
    ownerOnly: true,
    ideas: [
      {
        slug: "ai-visibility-trust-audit",
        title: "AI Visibility & Trust Audit",
        summary: "Diagnose how a local business appears to AI and search systems, then identify practical trust signals to strengthen.",
        targetBuyer: "Founder or local-service owner who needs clearer AI and search discoverability",
        validationState: "First proof",
        briefPath: "project-assets/customer-revenue-launchpad/offers/01-ai-visibility-trust-audit.md",
        starterPrompt: `Help me plan one bounded first-proof test for the AI Visibility & Trust Audit. Start by clarifying the buyer signal, test scope, metric, and manual approval point. ${MANUAL_VALIDATION_RULE}`,
      },
      {
        slug: "hvac-service-growth-pack",
        title: "HVAC Service Growth Pack",
        summary: "A packaged collection of customer-retention and local-growth materials for established HVAC shops.",
        targetBuyer: "Established HVAC shop",
        validationState: "Planned",
        briefPath: "project-assets/customer-revenue-launchpad/offers/02-hvac-service-growth-pack.md",
        starterPrompt: `Help me turn the HVAC Service Growth Pack into a small, evidence-led validation plan. Identify the narrowest buyer problem, a proof artifact, and an approval checkpoint before any contact. ${MANUAL_VALIDATION_RULE}`,
      },
      {
        slug: "marketing-agency-client-operations-pack",
        title: "Marketing Agency Client Operations Pack",
        summary: "A practical operations pack for small agencies that want more consistent client delivery and visibility.",
        targetBuyer: "Small marketing agency owner",
        validationState: "Planned",
        briefPath: "project-assets/customer-revenue-launchpad/offers/03-marketing-agency-client-operations-pack.md",
        starterPrompt: `Help me define the smallest defensible validation step for the Marketing Agency Client Operations Pack. Focus on the buyer pain, an observable result, and what needs manual approval. ${MANUAL_VALIDATION_RULE}`,
      },
      {
        slug: "executive-intelligence-subscription",
        title: "Executive Intelligence Subscription",
        summary: "A recurring decision-support briefing for operators who need timely, synthesized intelligence in a narrow niche.",
        targetBuyer: "Niche operator who makes time-sensitive decisions",
        validationState: "Planned",
        briefPath: "project-assets/customer-revenue-launchpad/offers/04-executive-intelligence-subscription.md",
        starterPrompt: `Help me design a safe first validation for the Executive Intelligence Subscription. Define the niche, decision job, evidence to collect, and a manual review point before any recurring delivery. ${MANUAL_VALIDATION_RULE}`,
      },
      {
        slug: "ai-readiness-governance-audit",
        title: "AI Readiness & Governance Audit",
        summary: "An assessment to help owners prepare teams to adopt AI with practical safeguards and operating clarity.",
        targetBuyer: "Owner preparing teams to use AI responsibly",
        validationState: "Planned",
        briefPath: "project-assets/customer-revenue-launchpad/offers/05-ai-readiness-governance-audit.md",
        starterPrompt: `Help me outline an evidence-led first proof for the AI Readiness & Governance Audit. Start with the buyer's current risk, a narrow assessment scope, and a manual owner decision before anything is delivered. ${MANUAL_VALIDATION_RULE}`,
      },
    ],
  },
  "fable-5": {
    key: "fable-5",
    parentProjectName: "5 Money Making Ideas (Fable 5 Review — 2026-07-23)",
    parentProjectDescription:
      "Owner-only folder for five live revenue concepts from the Fable 5 capability-expansion review. Each idea has its own working project and supporting material.",
    parentProjectTags: ["revenue", "fable-5", "revenue-ideas", "owner-only", "workspace-folder"],
    ownerOnly: true,
    ideas: [
      {
        slug: "hvac-contractor-document-packs",
        title: "Idea 1: HVAC Contractor Document Packs",
        summary: "Fixed-price, done-for-you marketing and office packages for HVAC shops, designed as a fast path to a clear proof of demand.",
        targetBuyer: "HVAC shop owner",
        validationState: "Ready to validate",
        briefPath: "project-assets/5-money-making-ideas/idea-1-hvac-document-packs/README.md",
        linkedProjectName: "Idea 1: HVAC Contractor Document Packs",
        starterPrompt: `Help me work on the HVAC Contractor Document Packs idea. Start by choosing one narrow package and one measurable proof step. Keep the work manual and owner-approved; do not contact prospects or send anything. ${MANUAL_VALIDATION_RULE}`,
      },
      {
        slug: "visionclaw-dfy-deployment",
        title: "Idea 2: VisionClaw Done-For-You Deployment",
        summary: "Package VisionClaw installation, safety configuration, integrations, and onboarding as a professional service.",
        targetBuyer: "Operator or agency that wants an AI system deployed safely",
        validationState: "Ready to validate",
        briefPath: "project-assets/5-money-making-ideas/idea-2-dfy-deployment/README.md",
        linkedProjectName: "Idea 2: VisionClaw Done-For-You Deployment",
        starterPrompt: `Help me work on the VisionClaw Done-For-You Deployment idea. Define a narrow first engagement, proof criteria, and the manual approval needed before any outreach or delivery. ${MANUAL_VALIDATION_RULE}`,
      },
      {
        slug: "ai-native-readiness-audit",
        title: "Idea 3: AI-Native Readiness Audit — Sell It Warm",
        summary: "A warm, buyer-specific readiness assessment that turns existing AI adoption uncertainty into a clear next step.",
        targetBuyer: "Owner or team already considering AI adoption",
        validationState: "Ready to validate",
        briefPath: "project-assets/5-money-making-ideas/idea-3-ai-readiness-audit/README.md",
        linkedProjectName: "Idea 3: AI-Native Readiness Audit — Sell It Warm",
        starterPrompt: `Help me work on the AI-Native Readiness Audit idea. Identify the warm buyer signal, a bounded assessment, and evidence that would justify a next step. ${MANUAL_VALIDATION_RULE}`,
      },
      {
        slug: "niche-intelligence-subscriptions",
        title: "Idea 4: Niche Intelligence Subscriptions",
        summary: "Recurring niche research and decision support for operators who need an actionable view of a changing market.",
        targetBuyer: "Niche operator with recurring intelligence needs",
        validationState: "Ready to validate",
        briefPath: "project-assets/5-money-making-ideas/idea-4-niche-intelligence-subscriptions/README.md",
        linkedProjectName: "Idea 4: Niche Intelligence Subscriptions",
        starterPrompt: `Help me work on the Niche Intelligence Subscriptions idea. Choose a tightly defined niche, identify a recurring decision job, and design one evidence-led proof without sending or publishing anything. ${MANUAL_VALIDATION_RULE}`,
      },
      {
        slug: "marketplace-gigs-tenant-subscriptions",
        title: "Idea 5: Marketplace Gigs + Tenant Subscriptions",
        summary: "Use focused marketplace work to prove buyer demand and build toward repeatable tenant subscriptions.",
        targetBuyer: "Small business buyer with a defined AI or operations job",
        validationState: "Ready to validate",
        briefPath: "project-assets/5-money-making-ideas/idea-5-marketplace-gigs/README.md",
        linkedProjectName: "Idea 5: Marketplace Gigs + Tenant Subscriptions",
        starterPrompt: `Help me work on the Marketplace Gigs + Tenant Subscriptions idea. Select one contained service, define an evidence-based outcome, and identify the manual approval point before any marketplace action. ${MANUAL_VALIDATION_RULE}`,
      },
    ],
  },
};

export function getRevenueWorkspace(key: RevenueWorkspaceKey): RevenueWorkspaceDefinition {
  return WORKSPACES[key];
}

export function getRevenueWorkspaceByProjectName(projectName: string): RevenueWorkspaceDefinition | null {
  return Object.values(WORKSPACES).find((workspace) => workspace.parentProjectName === projectName) || null;
}

export function getRevenueWorkspaceIdea(
  key: RevenueWorkspaceKey,
  slug: string
): RevenueIdeaDefinition | null {
  return WORKSPACES[key].ideas.find((idea) => idea.slug === slug) || null;
}

export function getRevenueWorkspaceKeys(): RevenueWorkspaceKey[] {
  return Object.keys(WORKSPACES) as RevenueWorkspaceKey[];
}