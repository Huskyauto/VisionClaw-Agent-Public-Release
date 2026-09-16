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
  RotateCcw, ClipboardList, Gauge, Radar, ShieldAlert, GitCompare, Film, EyeOff,
} from "lucide-react";

import updatesData from "@/data/updates.json";
import type { LucideIcon } from "lucide-react";

interface UpdateEntry {
  version: string;
  date: string;
  title: string;
  type: "major" | "feature" | "improvement" | "fix" | "minor" | "security";
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
  RotateCcw, ClipboardList, Gauge, Radar, ShieldAlert, GitCompare, Film, EyeOff,
};

function iconFor(name: string): LucideIcon {
  return ICON_MAP[name] ?? Sparkles;
}

const UPDATES: UpdateEntry[] = [
  {
    version: "R130.1",
    date: "2026-09-16",
    title: "Attached-file review completion recovery.",
    type: "fix",
    highlights: [
      { icon: "FileCheck", text: "A request to review uploaded files can no longer end with a promise such as “Let me read/review them”; browser chat continues the work in the same turn." },
      { icon: "RotateCcw", text: "Recovery is bounded to one additional model round and may bind the stronger work model without changing tenant scope or tool-safety enforcement." },
      { icon: "Target", text: "Current attachments and explicitly referenced historical uploads are recognized, while stale attachments cannot hijack unrelated repository-file requests." },
      { icon: "CheckCircle2", text: "Verified with 7 focused regressions, TypeScript, production build, and an independent closure review with no remaining CRITICAL, HIGH, or MEDIUM findings." },
    ],
  },
  {
    version: "R130",
    date: "2026-09-15",
    title: "Readiness-gated plan repair shadow.",
    type: "improvement",
    highlights: [
      { icon: "Gauge", text: "Exact-opt-in deterministic checks score objective clarity, plan structure, dependency coherence, verification, alternatives, assumptions, and falsification evidence before plan steps begin." },
      { icon: "Network", text: "A failed current step maps to its bounded transitive dependent subgraph while unaffected current work remains preserved." },
      { icon: "AlertTriangle", text: "Repeated genuine failure waves or explicit structural evidence recommend reopening strategy; recommendations remain report-only and cannot retry or rewrite plans." },
      { icon: "ShieldCheck", text: "Content-derived event identities, tenant-qualified idempotent persistence, non-blocking writes, and visible fail-open diagnostics preserve the existing execution and authorization boundary." },
      { icon: "CheckCircle2", text: "Verified with 20 focused assertions, TypeScript, production build, stale-string and wiring gates, independent review PASS, and a clean silent-failure review. Default remains off; no production activation or deployment occurred." },
    ],
  },
  {
    version: "R129+sec",
    date: "2026-09-15",
    title: "Unified memory forgetting with anti-resurrection and durable erasure.",
    type: "security",
    highlights: [
      {
        icon: "Database",
        text: "Durable memory stores now have a complete inventory and classification with archive-before-purge, exact-opt-in mutation/report-only tenant policy, authenticated self-erasure, durable idempotent requests with crash reconciliation, retrieval exclusions, and HMAC value-free tombstones.",
      },
      {
        icon: "ShieldCheck",
        text: "App and PostgreSQL INSERT/UPDATE anti-resurrection covers canonical, content, and relationship stores. Advisory-lock races, keyset scheduler leases, atomic provenance-descendant erasure, and account offboarding with a surviving pseudonymous receipt are closed.",
      },
      {
        icon: "AlertTriangle",
        text: "CRITICAL offboarding omission is closed by relationship-first inventory, tombstone, audit, and exact-delete of every source in one transaction with live temporary-tenant proof. HIGHs closed: awaited pg-pool verification before checkout (40 concurrent sessions), strict active-policy selection with per-tenant scheduler policy, both relationship-table triggers, production provenance writers, surviving HMAC evidence, and immutable request policy/action identity with unresolved-only retries and exact durable-plus-new counts.",
      },
      {
        icon: "Lock",
        text: "MEDIUMs closed: per-child hashed-token claim fencing with atomic completion, archive timestamp, cursor starvation, claim-failure fencing, reconciliation diagnostics, migration transaction, export fail-closed behavior, and rollback completeness.",
      },
      {
        icon: "CheckCircle2",
        text: "Verified with a development-only migration; live database canonical/content/relationship/offboarding rollback proof; TypeScript; 18 focused tests; 90 security/dispatch tests; npm build; wiring audit; clean workflow startup; iterative feature review plus independent and silent-failure reviews. Production mutation/deploy remains NOT activated.",
      },
    ],
  },
  {
    version: "R128+sec5",
    date: "2026-09-15",
    title: "Timeout-resilient, replay-safe plan execution.",
    type: "security",
    highlights: [
      {
        icon: "RefreshCw",
        text: "Approved LLM plan steps keep the normal 60-second fast path, then receive one fresh 180-second retry only for known transport or deadline failures.",
      },
      {
        icon: "ShieldCheck",
        text: "HIGH — Restart recovery can no longer replay an email, Drive write, or other structured tool side effect. Any own tool property or malformed step fails closed to manual review.",
      },
      {
        icon: "Lock",
        text: "HIGH — Recovery can occur only once across process restarts. Marker absence is enforced atomically inside the tenant-scoped status update, not trusted from an earlier read.",
      },
      {
        icon: "AlertTriangle",
        text: "MEDIUM closures — terminal logs and events name the failure that actually ended the run; safety-policy aborts and explicit refusals never retry; ineligible stale rows no longer remain falsely executing or block later recoveries.",
      },
      {
        icon: "CheckCircle2",
        text: "Verified against exact 60-second production failures from plans 6279, 6282, 6286, and 6287, plus RED→GREEN resilience tests, 11/11 focused assertions, 85/85 seam tests, TypeScript, production build, 0%-error burst load through 250 concurrent requests, and iterative architect review with four remediation rounds followed by a CLEAN final pass.",
      },
    ],
  },
  {
    version: "R128+sec2",
    date: "2026-09-12",
    title: "Tenant-authority closure and explicit video delivery.",
    type: "security",
    highlights: [
      {
        icon: "ShieldCheck",
        text: "Tenant authority is now explicit across the affected paths: equal-tenant relationship backfill is complete; research jobs retain an authoritative persisted tenant; memory and heartbeat mutations require tenant scope; ambiguous webhook and capability resolution is rejected by strict matching; and Drive uploads require explicit opt-in.",
      },
      {
        icon: "Film",
        text: "Current platform totals: 417 tools, 137 capabilities, 18 personas, 177 declared / 255 live tables, 812 live indexes (557 non-PK), 68 total platform skills, 107 reference surfaces, and 41 governance rules.",
      },
    ],
  },
  ...updatesData as UpdateEntry[],
];


const TYPE_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  major: { color: "text-primary", bg: "bg-primary/10", label: "Major Release" },
  feature: { color: "text-blue-500", bg: "bg-blue-500/10", label: "New Feature" },
  improvement: { color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Improvement" },
  fix: { color: "text-amber-500", bg: "bg-amber-500/10", label: "Bug Fix" },
  minor: { color: "text-sky-500", bg: "bg-sky-500/10", label: "Minor Release" },
  security: { color: "text-red-500", bg: "bg-red-500/10", label: "Security" },
};

const DEFAULT_TYPE_STYLE = { color: "text-muted-foreground", bg: "bg-muted/50", label: "Update" };

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
            const style = TYPE_STYLES[update.type] ?? DEFAULT_TYPE_STYLE;
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
