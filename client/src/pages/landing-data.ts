// Extracted from client/src/pages/landing.tsx (girth-gate slice, mechanical
// move — no behavior change): static landing-page data constants.
import {
  Bot, Crown, Wrench, PenTool, Workflow, Shield, Search, Globe, BarChart3,
  Activity, Scale, Gavel,
} from "lucide-react";

export const PERSONA_LIST = [
  { name: "VisionClaw", role: "Personal AI Assistant", icon: Bot, description: "Your always-on personal assistant. Handles any task, remembers everything, and knows when to call in specialists." },
  { name: "Felix", role: "CEO & Orchestrator", icon: Crown, description: "Decomposes complex requests, delegates to specialists, and delivers results in any format — PDF reports, Word docs, Excel models, slide decks." },
  { name: "Forge", role: "CTO & Staff Engineer", icon: Wrench, description: "Writes code, deploys integrations, debugs systems, reviews architecture, and builds technical solutions on demand." },
  { name: "Teagan", role: "CMO & Content Marketing", icon: PenTool, description: "Plans campaigns, creates email sequences, generates AI images, and drives marketing strategy across channels." },
  { name: "Blueprint", role: "VP Engineering", icon: Workflow, description: "Designs system architecture, plans engineering workflows, and manages multi-agent technical projects." },
  { name: "Chief of Staff", role: "Operations Director", icon: Crown, description: "Optimizes workflows, balances agent workloads, and ensures the entire corporate team runs smoothly." },
  { name: "Scribe", role: "Content Director", icon: PenTool, description: "Writes blog posts, newsletters, documentation, reports, presentations, and any long-form content." },
  { name: "Proof", role: "QA Director", icon: Shield, description: "Automatically reviews every deliverable for quality, accuracy, and completeness. Scores outputs on a 10-point scale." },
  { name: "Radar", role: "Intelligence Analyst", icon: Search, description: "Monitors competitors, scans for market opportunities, and delivers real-time intelligence briefings." },
  { name: "Neptune", role: "Deep Research Specialist", icon: Globe, description: "Deep research specialist for complex multi-source investigations, wellness guidance, companion messaging, and structured analysis." },
  { name: "Apollo", role: "Strategy & Revenue", icon: BarChart3, description: "Business strategy, revenue optimization, pricing analysis, and financial pipeline management." },
  { name: "Atlas", role: "Finance & Analytics", icon: Activity, description: "Financial analysis, KPI dashboards, trend analysis, and data-driven business recommendations." },
  { name: "Cassandra", role: "Risk & Forecasting", icon: Scale, description: "Risk assessment, financial modeling, predictive analytics, and budget governance." },
  { name: "Luna", role: "Legal & Compliance", icon: Gavel, description: "Contract safety scoring (0-100), regulatory compliance audits (9 frameworks), legal document generation (12 templates), and governance framework management." },
  { name: "Robert", role: "Late-Night Companion", icon: Bot, description: "Always-on conversational companion with a softer voice profile — for casual chat, late-night sessions, journaling, and emotional check-ins. Tenant-isolated, fully memory-aware." },
  { name: "Wellness Coach", role: "wellness & Health Coach", icon: Activity, description: "wellness journey companion — wellness-program/Wegovy/Ozempic education, side-effect triage protocols, food/protein logging, weekly weigh-in tracking, and motivational accountability messaging." },
];

export const CREDIT_PACKS = [
  { credits: 25, price: 10, perCredit: "$0.40" },
  { credits: 75, price: 25, perCredit: "$0.33" },
  { credits: 175, price: 50, perCredit: "$0.29" },
  { credits: 400, price: 100, perCredit: "$0.25" },
];

export const TASK_COSTS = [
  { task: "Quick tasks", detail: "Chat, lookups, simple tools", credits: 1 },
  { task: "Standard tasks", detail: "Research, analysis, drafts", credits: 3 },
  { task: "Deliverables", detail: "PDF, Word, Excel, Slides", credits: 5 },
  { task: "Orchestrations", detail: "Multi-agent complex workflows", credits: 10 },
];
