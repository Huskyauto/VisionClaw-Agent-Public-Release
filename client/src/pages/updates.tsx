import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Rocket, Image, Shield, Share2, Database, Zap, Globe, Wrench,
  Brain, Mic, Gavel, Scale, BarChart3, Search, Users, Code,
  ArrowLeft, Sparkles, CheckCircle2, Monitor, Mail, FileText,
  ShoppingBag, KeyRound, Smartphone, RefreshCw, Activity, Network,
  Lock, ShieldCheck, FileCheck, AlertTriangle, Layers, Power, MessageSquare,
  ChevronDown, ChevronUp, Target, Eye, BookOpen, ThumbsUp, Cpu, DollarSign,
  RotateCcw, ClipboardList, Gauge, Radar, ShieldAlert,
} from "lucide-react";

import updatesData from "@/data/updates.json";
import type { LucideIcon } from "lucide-react";

interface UpdateEntry {
  version: string;
  date: string;
  title: string;
  type: "major" | "feature" | "improvement" | "fix";
  highlights: { icon: string; text: string }[];
}

// Release notes live in client/src/data/updates.json (changelog-as-data, Kimi-K3
// finding #3): editing a release note touches the data file only, not this
// component. Icon names in the JSON resolve through ICON_MAP below; unknown
// names fall back to Sparkles so a typo can never crash the page.
const ICON_MAP: Record<string, LucideIcon> = {
  Rocket, Image, Shield, Share2, Database, Zap, Globe, Wrench,
  Brain, Mic, Gavel, Scale, BarChart3, Search, Users, Code,
  Sparkles, CheckCircle2, Monitor, Mail, FileText,
  ShoppingBag, KeyRound, Smartphone, RefreshCw, Activity, Network,
  Lock, ShieldCheck, FileCheck, AlertTriangle, Layers, Power, MessageSquare,
  Target, Eye, BookOpen, ThumbsUp, Cpu, DollarSign,
  RotateCcw, ClipboardList, Gauge, Radar, ShieldAlert,
};

function iconFor(name: string): LucideIcon {
  return ICON_MAP[name] ?? Sparkles;
}

const UPDATES: UpdateEntry[] = updatesData as UpdateEntry[];


const TYPE_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  major: { color: "text-primary", bg: "bg-primary/10", label: "Major Release" },
  feature: { color: "text-blue-500", bg: "bg-blue-500/10", label: "New Feature" },
  improvement: { color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Improvement" },
  fix: { color: "text-amber-500", bg: "bg-amber-500/10", label: "Bug Fix" },
};

function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export default function UpdatesPage() {
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (version: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };

  return (
    <div className="h-screen overflow-y-auto bg-background pb-20">
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
            const isOpen = expanded.has(update.version);
            const summary = update.highlights[0]
              ? stripMarkdown(update.highlights[0].text).slice(0, 200) +
                (stripMarkdown(update.highlights[0].text).length > 200 ? "…" : "")
              : "";
            return (
              <Card key={update.version} className={idx === 0 ? "border-primary/30" : ""} data-testid={`card-update-${update.version}`}>
                <CardContent className="pt-6 pb-6 px-6 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs font-mono">v{update.version}</Badge>
                        <Badge variant="secondary" className={`text-xs ${style.color}`}>
                          {style.label}
                        </Badge>
                        {idx === 0 && (
                          <Badge className="text-xs gap-1 bg-primary/10 text-primary border-primary/20" data-testid="badge-latest">
                            <Sparkles className="w-3 h-3" /> Latest
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">{update.date}</span>
                      </div>
                      <h3 className="text-base font-semibold leading-snug line-clamp-2">{update.title}</h3>
                    </div>
                  </div>

                  {!isOpen && summary && (
                    <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2" data-testid={`summary-${update.version}`}>
                      {summary}
                    </p>
                  )}

                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggle(update.version)}
                      className="text-primary hover:text-primary h-8 px-2"
                      data-testid={`button-toggle-${update.version}`}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? (
                        <>Collapse <ChevronUp className="w-4 h-4 ml-1" /></>
                      ) : (
                        <>Open <ChevronDown className="w-4 h-4 ml-1" /></>
                      )}
                    </Button>
                  </div>

                  {isOpen && (
                    <div className="space-y-3 pt-2 border-t border-border/50" data-testid={`details-${update.version}`}>
                      {update.highlights.map((h, hIdx) => {
                        const Icon = iconFor(h.icon);
                        return (
                          <div key={hIdx} className="flex items-start gap-3 pt-3">
                            <div className="w-7 h-7 rounded-md bg-muted/60 flex items-center justify-center shrink-0 mt-0.5">
                              <Icon className="w-3.5 h-3.5 text-primary" />
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">{h.text}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
