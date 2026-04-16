import { useLocation } from "wouter";
import { SeoHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Cpu, ArrowLeft, Users, Target, Lightbulb, Rocket, Bot, Crown, Wrench, PenTool, Shield, Search, BarChart3, Brain, Globe, Workflow } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSiteConfig } from "@/hooks/use-site-config";

const LEADERSHIP: { name: string; role: string; description: string }[] = [];

const MILESTONES = [
  { year: "2024", event: "Platform development begins" },
  { year: "2025", event: "14 AI personas, 152 tools, 37+ models live" },
  { year: "2025", event: "MCP Server integration — open protocol for any AI client" },
  { year: "2025", event: "AI Tinkerers Chicago technical showcase" },
  { year: "2026", event: "194 tools, 61 skills, 118 tables, Memory Palace, Temporal Knowledge Triples" },
];

const PERSONAS = [
  { name: "VisionClaw", role: "Personal AI Assistant", icon: Bot },
  { name: "Felix", role: "CEO & Orchestrator", icon: Crown },
  { name: "Forge", role: "CTO & Staff Engineer", icon: Wrench },
  { name: "Teagan", role: "CMO & Marketing", icon: PenTool },
  { name: "Blueprint", role: "VP Engineering", icon: Workflow },
  { name: "Chief of Staff", role: "Operations Director", icon: Crown },
  { name: "Proof", role: "QA Director", icon: Shield },
  { name: "Radar", role: "Intelligence Analyst", icon: Search },
  { name: "Neptune", role: "Wellness Specialist", icon: Globe },
  { name: "Apollo", role: "Strategy & Revenue", icon: BarChart3 },
  { name: "Atlas", role: "Data Analyst", icon: Brain },
  { name: "Cassandra", role: "Risk Analyst", icon: Shield },
  { name: "Luna", role: "Creative Director", icon: Lightbulb },
  { name: "Scribe", role: "Content Director", icon: PenTool },
];

export default function AboutPage() {
  const [, navigate] = useLocation();
  const { config } = useSiteConfig();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SeoHead
        title={`About ${config.platformName}`}
        description={`Meet the team behind ${config.platformName}. An autonomous AI corporation platform with 14 specialist agents, 194 tools, 61 skills, and 37+ AI models.`}
        canonical=""
      />
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-between gap-4 h-14">
          <button
            onClick={() => navigate("/landing")}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            data-testid="button-about-back"
          >
            <ArrowLeft className="w-4 h-4" />
            <Cpu className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg">{config.platformName}</span>
          </button>
          <ThemeToggle />
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-about-title">About {config.platformName}</h1>
        <p className="text-lg text-muted-foreground mb-10">{config.platformTagline}</p>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Target className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-semibold">Our Mission</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed text-lg">
            {config.platformName} is a multi-tenant agentic AI platform that gives every business access to a full corporate AI team. Instead of hiring separate specialists, you get 14 AI personas — each with deep expertise — working together through 194 tools and 37+ AI models. We believe powerful AI shouldn't require a Fortune 500 budget or a team of engineers. One platform, one subscription, a complete AI workforce.
          </p>
        </section>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Lightbulb className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-semibold">What Makes Us Different</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2">Multi-Agent Architecture</h3>
                <p className="text-sm text-muted-foreground">14 specialized AI personas that collaborate on complex tasks — from CEO-level strategy to code deployment to content marketing.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2">194 Integrated Tools</h3>
                <p className="text-sm text-muted-foreground">Email, Google Workspace, Stripe, browser automation, research engines, social media, presentations, memory palace, knowledge triples, and more — all accessible through natural conversation.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2">Model Flexibility</h3>
                <p className="text-sm text-muted-foreground">37+ AI models from OpenAI, Anthropic, Google, xAI, and OpenRouter. OAuth-first cost-aware routing with automatic failover ensures your work never stops.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2">Open Protocol (MCP)</h3>
                <p className="text-sm text-muted-foreground">Full Model Context Protocol server — connect any MCP-compatible AI client to the platform's complete tool suite.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Users className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-semibold">Leadership</h2>
          </div>
          {LEADERSHIP.map((person) => (
            <Card key={person.name} className="mb-4">
              <CardContent className="p-5">
                <h3 className="font-semibold text-lg">{person.name}</h3>
                <p className="text-primary text-sm mb-2">{person.role}</p>
                <p className="text-muted-foreground">{person.description}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Bot className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-semibold">The AI Team</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {PERSONAS.map((p) => (
              <div key={p.name} className="flex items-center gap-2 p-3 rounded-lg border border-border bg-card">
                <p.icon className="w-4 h-4 text-primary flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{p.role}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Rocket className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-semibold">Timeline</h2>
          </div>
          <div className="space-y-3">
            {MILESTONES.map((m, i) => (
              <div key={i} className="flex items-start gap-4 p-3 rounded-lg border border-border bg-card">
                <span className="text-primary font-bold text-sm min-w-[3rem]">{m.year}</span>
                <p className="text-sm text-muted-foreground">{m.event}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Users className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-semibold">Company Information</h2>
          </div>
          <div className="text-muted-foreground space-y-1">
            <p><strong>Platform:</strong> {config.platformName} Agent Platform</p>
          </div>
        </section>

        <div className="mt-12 pt-8 border-t border-border flex gap-3">
          <Button variant="outline" onClick={() => navigate("/landing")} data-testid="button-about-back-bottom">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
          <Button onClick={() => navigate("/contact")} data-testid="button-about-contact">
            Contact Us
          </Button>
        </div>
      </div>
    </div>
  );
}
