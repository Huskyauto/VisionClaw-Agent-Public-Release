import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Crown, Wrench, PenTool, Shield, Search, Globe,
  BarChart3, Activity, ArrowRight, MessageSquare, Brain,
  Mic, Zap, Sparkles, ChevronRight, X,
} from "lucide-react";

const STEPS = [
  {
    title: "Welcome to VisionClaw Agent",
    subtitle: "Your AI Corporation Awaits",
    content: "welcome",
  },
  {
    title: "Meet Your Team",
    subtitle: "16 Specialized AI Agents",
    content: "personas",
  },
  {
    title: "What Can You Do?",
    subtitle: "Try These to Get Started",
    content: "quickstart",
  },
];

const PERSONA_HIGHLIGHTS = [
  { name: "VisionClaw", role: "Your personal AI assistant", icon: Bot, color: "text-blue-500" },
  { name: "Felix", role: "CEO — orchestrates complex tasks", icon: Crown, color: "text-amber-500" },
  { name: "Forge", role: "Staff engineer — writes & deploys code", icon: Wrench, color: "text-orange-500" },
  { name: "Teagan", role: "Content marketing lead", icon: PenTool, color: "text-pink-500" },
  { name: "Radar", role: "Intelligence & market research", icon: Search, color: "text-cyan-500" },
  { name: "Neptune", role: "Deep research & analysis", icon: Globe, color: "text-blue-400" },
];

const QUICK_PROMPTS = [
  { label: "Research a topic", prompt: "Research the latest trends in AI agents and give me a summary", icon: Search, color: "text-cyan-500" },
  { label: "Write content", prompt: "Write a professional blog post about how AI is transforming small businesses", icon: PenTool, color: "text-pink-500" },
  { label: "Analyze data", prompt: "Analyze the competitive landscape for AI assistant platforms", icon: BarChart3, color: "text-emerald-500" },
  { label: "Plan a project", prompt: "Help me plan a product launch strategy for a SaaS startup", icon: Sparkles, color: "text-amber-500" },
  { label: "Draft an email", prompt: "Draft a cold outreach email for potential enterprise clients interested in AI automation", icon: MessageSquare, color: "text-blue-500" },
  { label: "Voice chat", prompt: "Let's have a voice conversation about my business goals", icon: Mic, color: "text-purple-500" },
];

interface OnboardingWelcomeProps {
  onDismiss: () => void;
  onStartChat: (prompt: string) => void;
}

export default function OnboardingWelcome({ onDismiss, onStartChat }: OnboardingWelcomeProps) {
  const [step, setStep] = useState(0);
  const [, navigate] = useLocation();
  const current = STEPS[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" data-testid="onboarding-overlay">
      <Card className="w-full max-w-2xl max-h-[85vh] overflow-y-auto relative">
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground z-10"
          data-testid="button-onboarding-dismiss"
        >
          <X className="w-5 h-5" />
        </button>

        <CardContent className="pt-8 pb-6 px-6 sm:px-8">
          <div className="flex items-center gap-2 mb-1">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mb-6">Step {step + 1} of {STEPS.length}</p>

          {current.content === "welcome" && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
                <Zap className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold" data-testid="text-onboarding-title">{current.title}</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                You now have access to a team of 16 specialized AI agents that can research, write, analyze, code, and run autonomous operations for you.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
                {[
                  { icon: Brain, label: "Semantic Memory", desc: "Remembers everything" },
                  { icon: Mic, label: "Voice Chat", desc: "Talk naturally" },
                  { icon: Zap, label: "Auto Tasks", desc: "Runs 24/7" },
                  { icon: Crown, label: "CEO Mode", desc: "Orchestrate teams" },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="p-3 rounded-lg border border-border text-center">
                    <Icon className="w-5 h-5 text-primary mx-auto mb-1.5" />
                    <div className="text-xs font-medium">{label}</div>
                    <div className="text-[10px] text-muted-foreground">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {current.content === "personas" && (
            <div className="space-y-4">
              <div className="text-center">
                <h2 className="text-2xl font-bold">{current.title}</h2>
                <p className="text-muted-foreground text-sm mt-1">Each agent has unique expertise. Switch between them from the sidebar.</p>
              </div>
              <div className="grid gap-2">
                {PERSONA_HIGHLIGHTS.map((p) => {
                  const Icon = p.icon;
                  return (
                    <div key={p.name} className="flex items-center gap-3 p-3 rounded-lg border border-border" data-testid={`onboarding-persona-${p.name.toLowerCase()}`}>
                      <div className="w-9 h-9 rounded-md bg-muted/50 flex items-center justify-center shrink-0">
                        <Icon className={`w-4.5 h-4.5 ${p.color}`} />
                      </div>
                      <div>
                        <div className="font-medium text-sm">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.role}</div>
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground text-center pt-1">+ 10 more specialists (Scribe, Proof, Apollo, Atlas, Cassandra, Luna, Blueprint, Chief of Staff, Robert, Wellness Coach)</p>
              </div>
            </div>
          )}

          {current.content === "quickstart" && (
            <div className="space-y-4">
              <div className="text-center">
                <h2 className="text-2xl font-bold">{current.title}</h2>
                <p className="text-muted-foreground text-sm mt-1">Click any prompt below to jump right in.</p>
              </div>
              <div className="grid gap-2">
                {QUICK_PROMPTS.map((q) => {
                  const Icon = q.icon;
                  return (
                    <button
                      key={q.label}
                      onClick={() => onStartChat(q.prompt)}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left group"
                      data-testid={`onboarding-prompt-${q.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <div className="w-9 h-9 rounded-md bg-muted/50 flex items-center justify-center shrink-0">
                        <Icon className={`w-4.5 h-4.5 ${q.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{q.label}</div>
                        <div className="text-xs text-muted-foreground truncate">{q.prompt}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mt-8 pt-4 border-t border-border">
            {step > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)} data-testid="button-onboarding-back">
                Back
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onDismiss} data-testid="button-onboarding-skip">
                Skip
              </Button>
            )}

            {step < STEPS.length - 1 ? (
              <Button size="sm" onClick={() => setStep(step + 1)} data-testid="button-onboarding-next">
                Next
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            ) : (
              <Button size="sm" onClick={onDismiss} data-testid="button-onboarding-finish">
                Start Using VisionClaw Agent
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
