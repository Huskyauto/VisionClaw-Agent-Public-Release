import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Rocket, Image, Shield, Share2, Database, Zap, Globe, Wrench,
  Brain, Mic, Gavel, Scale, BarChart3, Search, Users, Code,
  ArrowLeft, Sparkles, CheckCircle2, Monitor, Mail, FileText,
} from "lucide-react";

interface UpdateEntry {
  version: string;
  date: string;
  title: string;
  type: "major" | "feature" | "improvement" | "fix";
  highlights: { icon: any; text: string }[];
}

const UPDATES: UpdateEntry[] = [
  {
    version: "5.6",
    date: "March 22, 2026",
    title: "AI Image Generation & Social Media Publishing",
    type: "major",
    highlights: [
      { icon: Image, text: "AI-powered image generation for social media posts using Gemini Flash — generates platform-optimized graphics and auto-uploads to Google Drive" },
      { icon: Share2, text: "Complete social post composer — creates both text content and matching AI image in one step" },
      { icon: Globe, text: "Social media publishing backend ready for X/Twitter, LinkedIn, and Instagram APIs" },
      { icon: Users, text: "Per-tenant social media account management for multi-user publishing" },
    ],
  },
  {
    version: "5.5",
    date: "March 22, 2026",
    title: "Production Hardening & Multi-Tenant Scaling",
    type: "improvement",
    highlights: [
      { icon: Database, text: "Database connection pooling with production limits (max 20 connections, idle timeout, connection timeout)" },
      { icon: Shield, text: "Closed authentication backdoor — proper 401 responses for unauthenticated requests" },
      { icon: Zap, text: "Per-tenant rate limiting replaces global limiter — each user gets their own request budget" },
      { icon: Wrench, text: "Graceful shutdown handler for zero-downtime deployments" },
      { icon: Brain, text: "Automatic cache cleanup for all in-memory data stores — prevents memory leaks at scale" },
    ],
  },
  {
    version: "5.4",
    date: "March 2026",
    title: "Virtual Browser & Web Automation",
    type: "major",
    highlights: [
      { icon: Monitor, text: "Full virtual browser integration — agents can browse the web, take screenshots, fill forms, and interact with websites" },
      { icon: Search, text: "Enhanced competitive intelligence with automated web monitoring and data extraction" },
      { icon: Code, text: "Browser-based research engine for deep web analysis and multi-page data gathering" },
    ],
  },
  {
    version: "5.3",
    date: "March 2026",
    title: "Financial Governance & Legal Compliance",
    type: "feature",
    highlights: [
      { icon: Scale, text: "Cassandra (CFO) — AI-powered financial oversight, budget management, and cost optimization" },
      { icon: Gavel, text: "Luna (Legal) — Compliance tracking, governance rules enforcement, and contract review" },
      { icon: Shield, text: "31 built-in governance rules with full audit trail and automated compliance checking" },
    ],
  },
  {
    version: "5.2",
    date: "February 2026",
    title: "CEO Orchestrator & Multi-Agent Workflows",
    type: "major",
    highlights: [
      { icon: Users, text: "CEO Orchestrator — break complex requests into execution plans delegated across specialized agents" },
      { icon: Zap, text: "Agent-to-agent delegation with automatic task handoff and result synthesis" },
      { icon: BarChart3, text: "Advanced analytics dashboard with real-time metrics and performance tracking" },
      { icon: Mail, text: "Full email management system with AI-powered triage and automated responses" },
    ],
  },
  {
    version: "5.1",
    date: "February 2026",
    title: "Voice Conversations & WhatsApp Integration",
    type: "feature",
    highlights: [
      { icon: Mic, text: "Real-time voice conversations with streaming speech-to-text and text-to-speech" },
      { icon: Globe, text: "WhatsApp integration — chat with your AI team via messaging" },
      { icon: FileText, text: "PDF generation, analysis, and form filling with automatic Google Drive upload" },
    ],
  },
  {
    version: "5.0",
    date: "January 2026",
    title: "Platform Launch — Agentic AI Corporation",
    type: "major",
    highlights: [
      { icon: Rocket, text: "Initial platform launch with 12 specialized AI personas working as a coordinated team" },
      { icon: Brain, text: "Three-tier persistent memory system — short-term, working, and long-term recall" },
      { icon: Sparkles, text: "Heartbeat engine for autonomous scheduled task execution" },
      { icon: Shield, text: "Human-in-the-loop safety system for high-risk action approval" },
    ],
  },
];

const TYPE_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  major: { color: "text-primary", bg: "bg-primary/10", label: "Major Release" },
  feature: { color: "text-blue-500", bg: "bg-blue-500/10", label: "New Feature" },
  improvement: { color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Improvement" },
  fix: { color: "text-amber-500", bg: "bg-amber-500/10", label: "Bug Fix" },
};

export default function UpdatesPage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} data-testid="button-back-home">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        </div>

        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Rocket className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-updates-title">What's New</h1>
              <p className="text-sm text-muted-foreground">Platform updates, new features, and improvements</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {UPDATES.map((update, idx) => {
            const style = TYPE_STYLES[update.type];
            return (
              <Card key={update.version} className={idx === 0 ? "border-primary/30" : ""} data-testid={`card-update-${update.version}`}>
                <CardContent className="pt-6 pb-6 px-6 space-y-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-mono">v{update.version}</Badge>
                        <Badge variant="secondary" className={`text-xs ${style.color}`}>
                          {style.label}
                        </Badge>
                        {idx === 0 && (
                          <Badge className="text-xs gap-1 bg-primary/10 text-primary border-primary/20" data-testid="badge-latest">
                            <Sparkles className="w-3 h-3" /> Latest
                          </Badge>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold">{update.title}</h3>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{update.date}</span>
                  </div>
                  <div className="space-y-3">
                    {update.highlights.map((h, hIdx) => {
                      const Icon = h.icon;
                      return (
                        <div key={hIdx} className="flex items-start gap-3">
                          <div className="w-7 h-7 rounded-md bg-muted/60 flex items-center justify-center shrink-0 mt-0.5">
                            <Icon className="w-3.5 h-3.5 text-primary" />
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">{h.text}</p>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-12 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            Have a feature request or found an issue? We'd love to hear from you.
          </p>
          <a
            href="/contact"
            className="text-sm text-primary hover:underline"
            data-testid="link-feedback-email"
          >
            Contact Us
          </a>
        </div>
      </div>
    </div>
  );
}
