import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Check, FileText, ShieldCheck, ExternalLink, Loader2, Mail, AlertTriangle, TrendingDown, GitBranch, Send, XCircle, Globe, Gauge, Sparkles, Database, Workflow, Brain, Target, ListChecks, RotateCcw } from "lucide-react";

// R125+13.4: pull UTM + referer from the URL once on mount; share across all
// lead-capture surfaces on this page so attribution survives the click.
interface AttribCtx {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referer: string | null;
}
function readAttribFromUrl(): AttribCtx {
  if (typeof window === "undefined") {
    return { utmSource: null, utmMedium: null, utmCampaign: null, utmTerm: null, utmContent: null, referer: null };
  }
  const p = new URLSearchParams(window.location.search);
  return {
    utmSource: p.get("utm_source"),
    utmMedium: p.get("utm_medium"),
    utmCampaign: p.get("utm_campaign"),
    utmTerm: p.get("utm_term"),
    utmContent: p.get("utm_content"),
    referer: document.referrer || null,
  };
}
async function postLead(payload: Record<string, unknown>): Promise<void> {
  try {
    await apiRequest("POST", "/api/public/leads/audit", payload);
  } catch {
    // best-effort; never block UX on a lead-capture failure
  }
}

const OWNER_EMAIL = "huskyauto@gmail.com";

interface AuditProduct {
  id: string;
  name: string;
  description: string | null;
  tier: "self-serve" | "done-for-you" | "enterprise" | "unknown";
  priceId: string | null;
  unitAmountCents: number | null;
  currency: string | null;
  mode: "payment" | "subscription";
}

interface AuditProductsResponse {
  generatedAt: string;
  count: number;
  products: AuditProduct[];
}

interface AuditCheckResult {
  id: string;
  label: string;
  category: string;
  status: "pass" | "warn" | "fail";
  score: number;
  maxScore: number;
  detail: string;
  recommendation?: string;
}
interface AuditRunResult {
  id: number | null;
  websiteUrl: string;
  finalUrl: string;
  overallScore: number;
  grade: string;
  checks: AuditCheckResult[];
  recommendations: string[];
  fetchedAt: string;
}

function statusIcon(s: AuditCheckResult["status"]) {
  if (s === "pass") return <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />;
  if (s === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />;
  return <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />;
}

function priceLabel(p?: AuditProduct, fallbackUsd?: number): string {
  if (p?.unitAmountCents != null && p.currency) {
    const amt = p.unitAmountCents / 100;
    const sym = p.currency.toLowerCase() === "usd" ? "$" : "";
    return `${sym}${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  return fallbackUsd != null ? `$${fallbackUsd.toLocaleString()}` : "Contact";
}

function useDocMeta() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Audit your AI agent platform — VisionClaw";
    const desc =
      "8 dimensions. 1 SQL-backed score. Same rubric the founder used on his own platform (he scored 60/100).";
    let metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    let created = false;
    if (!metaDesc) {
      metaDesc = document.createElement("meta");
      metaDesc.name = "description";
      document.head.appendChild(metaDesc);
      created = true;
    }
    const prevDesc = metaDesc.content;
    metaDesc.content = desc;
    return () => {
      document.title = prevTitle;
      if (created && metaDesc) {
        metaDesc.remove();
      } else if (metaDesc) {
        metaDesc.content = prevDesc;
      }
    };
  }, []);
}

function AuditResultCard({ result }: { result: AuditRunResult }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const gradeColor =
    result.grade === "A" || result.grade === "B" ? "text-green-600"
    : result.grade === "C" ? "text-amber-500" : "text-red-500";
  const ringColor =
    result.grade === "A" || result.grade === "B" ? "border-green-500/40 bg-green-500/5"
    : result.grade === "C" ? "border-amber-500/40 bg-amber-500/5" : "border-red-500/40 bg-red-500/5";
  const barColor =
    result.overallScore >= 80 ? "bg-green-500" : result.overallScore >= 65 ? "bg-amber-500" : "bg-red-500";
  const categories = Array.from(new Set(result.checks.map((c) => c.category)));

  async function capture(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || sending) return;
    setSending(true);
    try {
      await apiRequest("POST", "/api/public/leads/audit", {
        email: email.trim(),
        kind: "audit-run",
        notes: `AI Readiness ${result.overallScore}/100 (${result.grade}) for ${result.websiteUrl}`,
      });
      setSent(true);
      setEmail("");
      toast({ title: "Sent!", description: "Your full fix checklist is on its way." });
    } catch (err: any) {
      toast({ title: "Couldn't send", description: err?.message || "Try again.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6 pt-2" data-testid="audit-result">
      {/* Score banner */}
      <div className={`flex items-center gap-5 rounded-lg border p-5 ${ringColor}`}>
        <div className="flex flex-col items-center justify-center shrink-0">
          <span className={`text-5xl font-bold leading-none ${gradeColor}`} data-testid="text-audit-grade">{result.grade}</span>
          <span className="text-xs text-muted-foreground mt-1">grade</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold" data-testid="text-audit-score">{result.overallScore}</span>
            <span className="text-muted-foreground">/ 100 AI-readiness</span>
          </div>
          <p className="text-sm text-muted-foreground truncate" data-testid="text-audit-url">{result.finalUrl}</p>
          <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${result.overallScore}%` }} />
          </div>
        </div>
      </div>

      {/* Category breakdown */}
      <div className="space-y-4">
        {categories.map((cat) => {
          const items = result.checks.filter((c) => c.category === cat);
          const max = items.reduce((s, c) => s + c.maxScore, 0);
          const got = items.reduce((s, c) => s + c.score, 0);
          return (
            <div key={cat} className="space-y-2" data-testid={`category-${cat.toLowerCase().replace(/\s+/g, "-")}`}>
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">{cat}</h4>
                {max > 0 && <span className="text-xs text-muted-foreground">{got}/{max}</span>}
              </div>
              <div className="space-y-1.5">
                {items.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 text-sm" data-testid={`check-${c.id}`}>
                    {statusIcon(c.status)}
                    <div className="min-w-0">
                      <span className="font-medium">{c.label}</span>
                      <span className="text-muted-foreground"> — {c.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recommendations */}
      {result.recommendations.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-5 space-y-3" data-testid="audit-recommendations">
          <h4 className="font-semibold flex items-center gap-2"><TrendingDown className="h-4 w-4 text-primary" /> Top fixes to raise your score</h4>
          <ol className="space-y-2 list-decimal list-inside text-sm text-muted-foreground">
            {result.recommendations.map((r, i) => (<li key={i} data-testid={`recommendation-${i}`}>{r}</li>))}
          </ol>
        </div>
      )}

      {/* Email capture + upsell */}
      <div className="rounded-lg border p-5 space-y-3">
        <div className="flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Want the full fix checklist — and us to do it for you?</p>
            <p className="text-sm text-muted-foreground">Get your detailed report by email, then see the done-for-you deep audit below.</p>
          </div>
        </div>
        {sent ? (
          <p className="text-sm text-green-600 flex items-center gap-2" data-testid="text-audit-lead-sent"><Check className="h-4 w-4" /> Sent — check your inbox.</p>
        ) : (
          <form onSubmit={capture} className="flex flex-col sm:flex-row gap-2" data-testid="form-audit-lead">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="pl-9" disabled={sending} data-testid="input-audit-lead-email" />
            </div>
            <Button type="submit" disabled={sending || !email.trim()} data-testid="button-audit-lead-submit">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Email me my report <ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>
          </form>
        )}
        <Button asChild variant="outline" className="w-full sm:w-auto" data-testid="button-audit-see-pricing">
          <a href="#pricing">See done-for-you pricing <ArrowRight className="ml-2 h-4 w-4" /></a>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Use-case qualifier — "Is this an agent problem?"
// Deterministic, client-side scorecard adapted from Dataiku's "Do I need an
// agent?" triage (data sources × variability × reasoning), their 3 agent
// categories, and the value-vs-frequency prioritization. No LLM call — it's a
// pure decision aid that keeps us honest about NOT overselling an agent where
// plain automation wins, then maps qualified problems onto how VisionClaw runs
// them. Captures a high-signal lead on completion.
// ---------------------------------------------------------------------------
type QualAxisId = "dataSources" | "variability" | "reasoning" | "frequency";
interface QualOption { label: string; value: 0 | 1 | 2 }
interface QualQuestion {
  id: QualAxisId;
  icon: typeof Database;
  prompt: string;
  help: string;
  options: [QualOption, QualOption, QualOption];
}

const QUALIFIER_QUESTIONS: QualQuestion[] = [
  {
    id: "dataSources",
    icon: Database,
    prompt: "How many systems or data sources does the task touch?",
    help: "Agents earn their keep when they integrate and reason across scattered inputs. One clean source rarely needs one.",
    options: [
      { label: "One clean source", value: 0 },
      { label: "A few", value: 1 },
      { label: "Many scattered systems", value: 2 },
    ],
  },
  {
    id: "variability",
    icon: Workflow,
    prompt: "Does the work change from case to case?",
    help: "Static, repeatable steps are automation. Work that adapts to new information is agent territory.",
    options: [
      { label: "Same every time", value: 0 },
      { label: "Some variation", value: 1 },
      { label: "Highly variable", value: 2 },
    ],
  },
  {
    id: "reasoning",
    icon: Brain,
    prompt: "What does doing it well actually require?",
    help: "Fixed rules or a decision tree → automate. Judgment, synthesis, nuanced context → agent.",
    options: [
      { label: "Fixed rules", value: 0 },
      { label: "Some judgment", value: 1 },
      { label: "Real reasoning & nuance", value: 2 },
    ],
  },
  {
    id: "frequency",
    icon: Target,
    prompt: "How often does this happen?",
    help: "Frequency drives ROI — a many-times-a-day task pays back far faster than a quarterly one.",
    options: [
      { label: "Rarely", value: 0 },
      { label: "Weekly", value: 1 },
      { label: "Many times a day", value: 2 },
    ],
  },
];

type QualBand = "agent" | "borderline" | "automation";
interface QualVerdict {
  band: QualBand;
  title: string;
  blurb: string;
  category: string | null;
  categoryDesc: string | null;
  vca: string | null;
  priority: string | null;
}

function computeQualVerdict(a: Record<QualAxisId, number>): QualVerdict {
  // Core agent-vs-automation signal: integration × variability × reasoning
  // (0–6). Frequency is the ROI lever, scored separately.
  const core = a.dataSources + a.variability + a.reasoning;
  const freq = a.frequency;

  let category: string | null = null;
  let categoryDesc: string | null = null;
  let vca: string | null = null;
  if (core >= 2) {
    // Map onto Dataiku's three agent categories.
    if (a.reasoning === 2 && a.dataSources >= 1) {
      category = "Enterprise Intelligence";
      categoryDesc = "Synthesizes answers across documents and databases where plain search falls short.";
      vca = "VisionClaw runs this on its vector knowledge library + autoresearch + competitor-intel personas.";
    } else if (a.variability === 2 || a.reasoning === 2) {
      category = "Worker Augmentation";
      categoryDesc = "Accelerates a high-value, time-consuming task while a human stays in control.";
      vca = "VisionClaw runs this as a supervised persona with human-in-the-loop approval gates.";
    } else {
      category = "Process Automation";
      categoryDesc = "Runs a multi-step process across several systems that follows recognizable patterns.";
      vca = "VisionClaw runs this as an autonomous workflow with its 393-tool action layer + delegation.";
    }
  }

  let priority: string | null = null;
  if (core >= 4) {
    priority = freq === 2
      ? "Quick win — high value, high frequency. Start here."
      : freq === 1
        ? "Solid ROI — worth scoping next."
        : "Strategic — high value but infrequent; weigh the build cost.";
  }

  if (core >= 4) {
    return {
      band: "agent",
      title: "This looks like a real agent problem.",
      blurb: "It needs judgment across changing inputs and multiple sources — exactly what an agent does better than rules or a human grinding through it manually.",
      category, categoryDesc, vca, priority,
    };
  }
  if (core >= 2) {
    return {
      band: "borderline",
      title: "Borderline — automate first, revisit as an agent.",
      blurb: "There's some variability here, but not enough to justify an agent yet. Start with plain automation; if the edge cases pile up and inputs multiply, it becomes agent-worthy.",
      category, categoryDesc, vca, priority,
    };
  }
  return {
    band: "automation",
    title: "This doesn't need an agent — yet.",
    blurb: "A single source, fixed rules, and a static process are best solved with traditional automation or a simple decision tree. An agent would be over-engineering. We'll tell you that honestly rather than sell you one.",
    category: null, categoryDesc: null, vca: null, priority: null,
  };
}

function UseCaseQualifier({ attrib }: { attrib: AttribCtx }) {
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Partial<Record<QualAxisId, number>>>({});
  const [verdict, setVerdict] = useState<QualVerdict | null>(null);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const allAnswered = QUALIFIER_QUESTIONS.every((q) => answers[q.id] !== undefined);

  function pick(id: QualAxisId, value: number) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setVerdict(null);
    setSent(false);
  }

  function reveal() {
    if (!allAnswered) return;
    setVerdict(computeQualVerdict(answers as Record<QualAxisId, number>));
  }

  function reset() {
    setAnswers({});
    setVerdict(null);
    setEmail("");
    setSent(false);
  }

  async function capture(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || sending || !verdict) return;
    setSending(true);
    try {
      const summary = QUALIFIER_QUESTIONS.map((q) => {
        const v = answers[q.id];
        const opt = q.options.find((o) => o.value === v);
        return `${q.id}=${opt?.label ?? "?"}`;
      }).join(", ");
      await apiRequest("POST", "/api/public/leads/audit", {
        email: email.trim(),
        kind: "qualifier-result",
        tierInterest: verdict.band,
        icpHint: verdict.category ?? "automation",
        notes: `Use-case qualifier → ${verdict.title} ${verdict.category ? `[${verdict.category}] ` : ""}(${summary})`,
        ...attrib,
      });
      setSent(true);
      setEmail("");
      toast({ title: "Sent!", description: "We'll follow up with how to scope this — no spam sequence." });
    } catch (err: any) {
      toast({ title: "Couldn't send", description: err?.message || "Try again.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  const bandColor =
    verdict?.band === "agent" ? "border-green-500/40 bg-green-500/5"
    : verdict?.band === "borderline" ? "border-amber-500/40 bg-amber-500/5"
    : "border-muted-foreground/30 bg-muted/40";
  const bandText =
    verdict?.band === "agent" ? "text-green-600"
    : verdict?.band === "borderline" ? "text-amber-500" : "text-muted-foreground";

  return (
    <Card className="border-primary/30" data-testid="card-qualifier">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-2xl" data-testid="text-qualifier-title">
          <ListChecks className="h-6 w-6 text-primary" />
          Is this an agent problem?
        </CardTitle>
        <CardDescription>
          Not every task needs an AI agent — some just need plain automation. Answer four questions and
          get an honest verdict, plus which kind of agent fits if it's worth it. 30 seconds, no signup.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {QUALIFIER_QUESTIONS.map((q) => {
          const Icon = q.icon;
          return (
            <div key={q.id} className="space-y-2" data-testid={`qualifier-question-${q.id}`}>
              <div className="flex items-start gap-2">
                <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">{q.prompt}</p>
                  <p className="text-xs text-muted-foreground">{q.help}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label={q.prompt}>
                {q.options.map((o) => {
                  const active = answers[q.id] === o.value;
                  return (
                    <Button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={`${q.prompt} — ${o.label}`}
                      variant={active ? "default" : "outline"}
                      size="sm"
                      className="justify-start text-left h-auto py-2 whitespace-normal"
                      onClick={() => pick(q.id, o.value)}
                      data-testid={`button-qualifier-${q.id}-${o.value}`}
                    >
                      {active && <Check className="mr-2 h-3.5 w-3.5 shrink-0" />}
                      {o.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {!verdict ? (
          <Button
            type="button"
            size="lg"
            disabled={!allAnswered}
            onClick={reveal}
            className="w-full sm:w-auto"
            data-testid="button-qualifier-reveal"
          >
            {allAnswered ? <>See my verdict <ArrowRight className="ml-2 h-4 w-4" /></> : "Answer all four to see your verdict"}
          </Button>
        ) : (
          <div className="space-y-4" data-testid="qualifier-result">
            <div className={`rounded-lg border p-5 space-y-2 ${bandColor}`}>
              <p className={`font-semibold text-lg ${bandText}`} data-testid="text-qualifier-verdict">{verdict.title}</p>
              <p className="text-sm text-muted-foreground">{verdict.blurb}</p>
            </div>

            {verdict.category && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-5 space-y-1" data-testid="qualifier-category">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Best-fit agent type</p>
                <p className="font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> {verdict.category}</p>
                <p className="text-sm text-muted-foreground">{verdict.categoryDesc}</p>
                {verdict.vca && <p className="text-sm text-foreground/80 pt-1">{verdict.vca}</p>}
                {verdict.priority && <p className="text-sm font-medium pt-1" data-testid="text-qualifier-priority">{verdict.priority}</p>}
              </div>
            )}

            {/* Email capture — only meaningful for qualified/borderline problems */}
            {verdict.band !== "automation" && (
              <div className="rounded-lg border p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Want help scoping this into a real agent?</p>
                    <p className="text-sm text-muted-foreground">Send your verdict to the founder — we'll reply with how we'd build it. No spam sequence.</p>
                  </div>
                </div>
                {sent ? (
                  <p className="text-sm text-green-600 flex items-center gap-2" data-testid="text-qualifier-sent"><Check className="h-4 w-4" /> Sent — we'll be in touch.</p>
                ) : (
                  <form onSubmit={capture} className="flex flex-col sm:flex-row gap-2" data-testid="form-qualifier-lead">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="pl-9" disabled={sending} data-testid="input-qualifier-email" />
                    </div>
                    <Button type="submit" disabled={sending || !email.trim()} data-testid="button-qualifier-submit">
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Send my verdict <ArrowRight className="ml-2 h-4 w-4" /></>}
                    </Button>
                  </form>
                )}
              </div>
            )}

            <Button type="button" variant="ghost" size="sm" onClick={reset} data-testid="button-qualifier-reset">
              <RotateCcw className="mr-2 h-3.5 w-3.5" /> Start over
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground" data-testid="text-qualifier-trust">
          Honest by design: if you don't need an agent, we'll say so.
        </p>
      </CardContent>
    </Card>
  );
}

export default function AuditPage() {
  useDocMeta();
  const { toast } = useToast();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [attrib, setAttrib] = useState<AttribCtx>({
    utmSource: null, utmMedium: null, utmCampaign: null, utmTerm: null, utmContent: null, referer: null,
  });

  // Sample-request capture form (top of page) state
  const [sampleEmail, setSampleEmail] = useState("");
  const [sampleSubmitting, setSampleSubmitting] = useState(false);
  const [sampleDone, setSampleDone] = useState(false);

  // Monitoring waitlist form state
  const [waitEmail, setWaitEmail] = useState("");
  const [waitSubmitting, setWaitSubmitting] = useState(false);
  const [waitDone, setWaitDone] = useState(false);

  // Instant AI Readiness Audit (live, self-serve) state
  const [auditUrl, setAuditUrl] = useState("");
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditResult, setAuditResult] = useState<AuditRunResult | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    setAttrib(readAttribFromUrl());
  }, []);

  const { data: productsData } = useQuery<AuditProductsResponse>({
    queryKey: ["/api/public/audit/products"],
  });

  const products = productsData?.products ?? [];
  const selfServe = products.find((p) => p.tier === "self-serve");
  const dfy = products.find((p) => p.tier === "done-for-you");

  async function captureSampleLead(e: React.FormEvent) {
    e.preventDefault();
    if (!sampleEmail || sampleSubmitting) return;
    setSampleSubmitting(true);
    try {
      await apiRequest("POST", "/api/public/leads/audit", {
        email: sampleEmail,
        kind: "sample-request",
        ...attrib,
      });
      setSampleDone(true);
      setSampleEmail("");
      toast({ title: "Sample on its way", description: "You'll get the founder's audit + the 8-dimension checklist by email." });
    } catch (err: any) {
      toast({ title: "Could not capture email", description: err?.message || "Try again or email us directly.", variant: "destructive" });
    } finally {
      setSampleSubmitting(false);
    }
  }

  async function captureWaitlistLead(e: React.FormEvent) {
    e.preventDefault();
    if (!waitEmail || waitSubmitting) return;
    setWaitSubmitting(true);
    try {
      await apiRequest("POST", "/api/public/leads/audit", {
        email: waitEmail,
        kind: "monitoring-waitlist",
        tierInterest: "monitoring",
        ...attrib,
      });
      setWaitDone(true);
      setWaitEmail("");
      toast({ title: "You're on the list", description: "We'll email you when quarterly monitoring launches." });
    } catch (err: any) {
      toast({ title: "Could not capture email", description: err?.message || "Try again or email us directly.", variant: "destructive" });
    } finally {
      setWaitSubmitting(false);
    }
  }

  async function runInstantAudit(e: React.FormEvent) {
    e.preventDefault();
    if (!auditUrl.trim() || auditRunning) return;
    setAuditRunning(true);
    setAuditError(null);
    setAuditResult(null);
    try {
      const res = await apiRequest("POST", "/api/public/audit/run", { url: auditUrl.trim() });
      const body = (await res.json()) as AuditRunResult;
      setAuditResult(body);
    } catch (err: any) {
      // apiRequest throws Error("<status>: <body>"); recover the friendly
      // JSON `error` message (e.g. the 422 "couldn't reach that site").
      let msg = err?.message || "The audit could not be completed.";
      try {
        const j = JSON.parse(String(msg).replace(/^\d+:\s*/, ""));
        if (j?.error) msg = j.error;
      } catch { /* keep raw msg */ }
      setAuditError(msg);
    } finally {
      setAuditRunning(false);
    }
  }

  async function startCheckout(p: AuditProduct, tierKey: string) {
    if (!p.priceId) return;
    // R125+13.4 architect MEDIUM-1: guard against double-click race so we
    // never fire two Stripe sessions + two intent beacons for one customer.
    if (checkoutLoading) return;
    setCheckoutError(null);
    setCheckoutLoading(tierKey);
    // Fire-and-forget anonymous intent beacon so we can count clicks even
    // when the user abandons checkout. Does NOT block the redirect.
    const clickKind = p.tier === "done-for-you" ? "buy-click-done-for-you" : "buy-click-self-serve";
    postLead({
      kind: clickKind,
      tierInterest: p.tier,
      notes: `priceId=${p.priceId} tierKey=${tierKey}`,
      ...attrib,
    });
    try {
      const res = await apiRequest("POST", "/api/stripe/checkout", {
        priceId: p.priceId,
        mode: p.mode,
      });
      const body = await res.json();
      // SECURITY: only follow a verified Stripe-hosted https redirect — never
      // trust an arbitrary URL from the response for navigation.
      let safeUrl: string | null = null;
      try {
        const u = new URL(body?.url ?? "");
        if (u.protocol === "https:" && (u.hostname === "checkout.stripe.com" || u.hostname.endsWith(".stripe.com"))) {
          safeUrl = u.toString();
        }
      } catch { /* invalid URL → fall through to error */ }
      if (safeUrl) {
        window.location.href = safeUrl;
      } else {
        setCheckoutError("Could not start checkout. Try again or email us.");
        setCheckoutLoading(null);
      }
    } catch (e: any) {
      setCheckoutError(e?.message || "Checkout failed. Email us instead.");
      setCheckoutLoading(null);
    }
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl space-y-12" data-testid="page-audit">
      {/* Hero */}
      <header className="space-y-6 text-center" data-testid="section-hero">
        <div className="flex justify-center">
          <Badge variant="secondary" className="text-xs" data-testid="badge-self-audit">
            Founder's own score: 60/100 (Band C)
          </Badge>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight" data-testid="text-hero-h1">
          Audit your AI agent platform.<br />
          Get a number, not a vibes-check.
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto" data-testid="text-hero-sub">
          8 dimensions. 1 SQL-backed score. Same rubric the founder used on his own platform.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Button asChild size="lg" variant="default" data-testid="button-read-sample">
            <a href="/api/public/audit/sample" target="_blank" rel="noopener noreferrer">
              <FileText className="mr-2 h-4 w-4" />
              Read the founder's audit
              <ExternalLink className="ml-2 h-3 w-3" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline" data-testid="button-jump-pricing">
            <a href="#pricing">See pricing <ArrowRight className="ml-2 h-4 w-4" /></a>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="text-trust-line">
          Read-only DB access. Results in 2 business days. NDA on request.
        </p>
      </header>

      {/* Instant AI Readiness Audit — live, autonomous self-serve tool */}
      <section className="space-y-4" id="instant-audit" data-testid="section-instant-audit">
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl" data-testid="text-instant-audit-title">
              <Gauge className="h-6 w-6 text-primary" />
              Instant AI Readiness Audit
            </CardTitle>
            <CardDescription>
              Enter your website and get a real, scored report in seconds — how well AI assistants
              can find, read, and represent your business. Free, no signup required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={runInstantAudit} className="flex flex-col sm:flex-row gap-3" data-testid="form-instant-audit">
              <div className="relative flex-1">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={auditUrl}
                  onChange={(e) => setAuditUrl(e.target.value)}
                  placeholder="yourcompany.com"
                  className="pl-9"
                  disabled={auditRunning}
                  data-testid="input-audit-url"
                />
              </div>
              <Button type="submit" size="lg" disabled={auditRunning || !auditUrl.trim()} data-testid="button-run-audit">
                {auditRunning ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scanning…</>
                ) : (
                  <>Run free audit <ArrowRight className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </form>
            {auditError && (
              <p className="text-sm text-red-500 flex items-start gap-2" data-testid="text-audit-error">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {auditError}
              </p>
            )}
            {auditResult && <AuditResultCard result={auditResult} />}
          </CardContent>
        </Card>
      </section>

      {/* Use-case qualifier — "Is this an agent problem?" honest decision aid */}
      <section className="space-y-4" id="qualifier" data-testid="section-qualifier">
        <UseCaseQualifier attrib={attrib} />
      </section>

      {/* Founder story lead */}
      <section className="space-y-3" data-testid="section-founder-lead">
        <Card>
          <CardContent className="pt-6">
            <blockquote className="space-y-3">
              <p className="text-lg italic text-foreground" data-testid="text-founder-quote">
                "I built a 393-tool AI platform alone. Then I audited it myself and scored 60/100. Here's the audit you can run on yours."
              </p>
              <footer className="text-sm text-muted-foreground">— Bob Washburn, VisionClaw</footer>
            </blockquote>
          </CardContent>
        </Card>
      </section>

      {/* Founder audio pitch (Bob's voice via Fish Audio clone) */}
      <section className="space-y-3" data-testid="section-audio-pitch">
        <h2 className="text-2xl font-semibold" data-testid="text-audio-pitch-h2">60 seconds from the founder</h2>
        <p className="text-sm text-muted-foreground" data-testid="text-audio-pitch-caption">
          Why I built the audit, what you get, and how to pick the right tier — in my own voice.
        </p>
        <audio
          controls
          preload="metadata"
          className="w-full max-w-xl"
          data-testid="audio-founder-pitch"
        >
          <source src="/api/public/audit/pitch.mp3" type="audio/mpeg" />
          Your browser does not support audio playback.
        </audio>
      </section>

      {/* Lead capture — sample-request opt-in for visitors not ready to buy */}
      <section className="space-y-3" data-testid="section-lead-capture">
        <Card className="bg-muted/40 border-primary/20">
          <CardHeader>
            <CardTitle className="text-lg" data-testid="text-lead-capture-h">Not ready to buy yet?</CardTitle>
            <CardDescription>
              Get the founder's full self-audit (PDF) + the 8-dimension checklist by email. No follow-up sequence unless you ask.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sampleDone ? (
              <div className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2" data-testid="text-sample-done">
                <Check className="h-4 w-4" /> Check your inbox — the sample audit is on its way.
              </div>
            ) : (
              <form onSubmit={captureSampleLead} className="flex flex-col sm:flex-row gap-2 max-w-xl" data-testid="form-sample-request">
                <label htmlFor="input-sample-email" className="sr-only">Your work email</label>
                <Input
                  id="input-sample-email"
                  type="email"
                  required
                  placeholder="you@company.com"
                  aria-label="Your work email"
                  value={sampleEmail}
                  onChange={(e) => setSampleEmail(e.target.value)}
                  disabled={sampleSubmitting}
                  className="flex-1"
                  data-testid="input-sample-email"
                />
                <Button type="submit" disabled={sampleSubmitting || !sampleEmail} data-testid="button-send-sample">
                  {sampleSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-2 h-4 w-4" /> Send me the sample</>}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Why now */}
      <section className="space-y-4" data-testid="section-why-now">
        <h2 className="text-2xl font-semibold" data-testid="text-why-now-h2">Why now</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <Card data-testid="card-why-ahb">
            <CardHeader>
              <AlertTriangle className="h-5 w-5 text-foreground" />
              <CardTitle className="text-base">The AHB paper landed.</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Galisai et al. 2026 (arXiv:2604.18487) made stylistic-jailbreak defense table stakes. Most stacks haven't even read it.
            </CardContent>
          </Card>
          <Card data-testid="card-why-roi">
            <CardHeader>
              <TrendingDown className="h-5 w-5 text-foreground" />
              <CardTitle className="text-base">Boards want AI ROI.</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              After two years of agent-spend, the question is no longer 'can we' — it's 'what's actually working'. Audits answer that.
            </CardContent>
          </Card>
          <Card data-testid="card-why-sprawl">
            <CardHeader>
              <GitBranch className="h-5 w-5 text-foreground" />
              <CardTitle className="text-base">Agent sprawl is real.</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Every six months your tool count doubles and half are dead. We shipped the detector. Most teams haven't measured it.
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Problem */}
      <section className="space-y-4" data-testid="section-problem">
        <h2 className="text-2xl font-semibold" data-testid="text-problem-h2">
          You're running 5+ AI agents in production and:
        </h2>
        <ul className="space-y-3 text-base text-muted-foreground">
          <li className="flex gap-3" data-testid="problem-bullet-1">
            <span className="text-foreground font-semibold">·</span>
            Your token bill is growing faster than your revenue, and you can't attribute it per agent.
          </li>
          <li className="flex gap-3" data-testid="problem-bullet-2">
            <span className="text-foreground font-semibold">·</span>
            You can't tell which of your registered tools actually get invoked.
          </li>
          <li className="flex gap-3" data-testid="problem-bullet-3">
            <span className="text-foreground font-semibold">·</span>
            Your last tenant-isolation review was "we'll do it after the next launch."
          </li>
        </ul>
        <p className="text-sm pt-2" data-testid="text-problem-empathy">
          You're not unusual. I had the same three problems on my own platform. So I built the rubric to measure them.
        </p>
      </section>

      {/* What you get */}
      <section className="space-y-4" data-testid="section-dimensions">
        <h2 className="text-2xl font-semibold" data-testid="text-dimensions-h2">The 8 dimensions</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            ["Agent inventory hygiene", "How many of your declared agents are zombies", "15%"],
            ["Tool sprawl ratio", "Invoked-tools / registered-tools, last 30 days", "15%"],
            ["AHB safety coverage", "Intent gates + restricted categories per agent", "20%"],
            ["Tenant isolation", "% of tables enforcing tenant_id at storage layer", "20%"],
            ["Schema drift", "Dev vs prod parity", "10%"],
            ["Deliverable reliability", "% of customer outputs that landed first-try", "10%"],
            ["Multi-model jury usage", "Escalation on borderline calls", "5%"],
            ["Cost per deliverable", "Per-tenant attribution depth", "5%"],
          ].map(([name, desc, weight], i) => (
            <Card key={i} data-testid={`dimension-card-${i + 1}`}>
              <CardContent className="pt-4 flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium" data-testid={`dimension-name-${i + 1}`}>
                    {i + 1}. {name}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1" data-testid={`dimension-desc-${i + 1}`}>
                    {desc}
                  </div>
                </div>
                <Badge variant="outline" data-testid={`dimension-weight-${i + 1}`}>{weight}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card data-testid="card-deliverable">
          <CardHeader>
            <CardTitle className="text-lg">You receive</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {[
                "One composite score 0–100 with band (A/B/C/D/F)",
                "Per-dimension score with evidence (the actual SQL output)",
                "Interpretation paragraph per dimension (what the number means for your business)",
                "Prioritized remediation list (P1/P2/P3 with effort estimates)",
                "A Notion doc your team can action on Monday morning",
              ].map((line, i) => (
                <li key={i} className="flex gap-2" data-testid={`deliverable-bullet-${i + 1}`}>
                  <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      {/* Pricing */}
      <section id="pricing" className="space-y-4 scroll-mt-8" data-testid="section-pricing">
        <h2 className="text-2xl font-semibold" data-testid="text-pricing-h2">Pricing</h2>
        {checkoutError && (
          <div className="text-sm text-destructive border border-destructive/30 rounded-md p-3" data-testid="text-checkout-error">
            {checkoutError}
          </div>
        )}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Self-serve */}
          <Card className="flex flex-col" data-testid="pricing-card-self-serve">
            <CardHeader>
              <CardTitle data-testid="text-tier-self-serve">Self-Serve</CardTitle>
              <CardDescription>You run the script + rubric</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 space-y-3 text-sm">
              <div className="text-3xl font-bold" data-testid="text-price-self-serve">
                {priceLabel(selfServe, 497)}
              </div>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>Same-day turnaround</li>
                <li>Markdown report</li>
                <li>Self-audit (your whole platform)</li>
                <li>Optional NDA</li>
              </ul>
            </CardContent>
            <CardContent className="space-y-2">
              {selfServe?.priceId ? (
                <>
                  <Button
                    className="w-full"
                    onClick={() => startCheckout(selfServe, "self-serve")}
                    disabled={checkoutLoading === "self-serve"}
                    data-testid="button-buy-self-serve"
                  >
                    {checkoutLoading === "self-serve" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>Start audit <ArrowRight className="ml-2 h-4 w-4" /></>
                    )}
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" data-testid="button-email-self-serve-fallback">
                    <a href={`mailto:${OWNER_EMAIL}?subject=Self-Serve%20Audit%20%24497`}>
                      Prefer email? Reach out
                    </a>
                  </Button>
                </>
              ) : (
                <Button asChild className="w-full" variant="outline" data-testid="button-email-self-serve">
                  <a href={`mailto:${OWNER_EMAIL}?subject=Self-Serve%20Audit%20%24497`}>
                    <Mail className="mr-2 h-4 w-4" /> Email to start
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Done-For-You */}
          <Card className="flex flex-col border-primary shadow-sm relative" data-testid="pricing-card-dfy">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <Badge data-testid="badge-popular">Most popular</Badge>
            </div>
            <CardHeader>
              <CardTitle data-testid="text-tier-dfy">Done-For-You</CardTitle>
              <CardDescription>I run it end-to-end</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 space-y-3 text-sm">
              <div className="text-3xl font-bold" data-testid="text-price-dfy">
                {priceLabel(dfy, 1997)}
              </div>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>2 business days</li>
                <li>Notion doc + 60-min walkthrough call</li>
                <li>Per-tenant scoping available</li>
                <li>90-day re-audit window</li>
                <li>Standard mutual NDA</li>
              </ul>
            </CardContent>
            <CardContent className="space-y-2">
              {dfy?.priceId ? (
                <>
                  <Button
                    className="w-full"
                    onClick={() => startCheckout(dfy, "dfy")}
                    disabled={checkoutLoading === "dfy"}
                    data-testid="button-buy-dfy"
                  >
                    {checkoutLoading === "dfy" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>Book intro call <ArrowRight className="ml-2 h-4 w-4" /></>
                    )}
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" data-testid="button-email-dfy-fallback">
                    <a href={`mailto:${OWNER_EMAIL}?subject=Done-For-You%20Audit%20%241997`}>
                      Prefer email? Reach out
                    </a>
                  </Button>
                </>
              ) : (
                <Button asChild className="w-full" data-testid="button-email-dfy">
                  <a href={`mailto:${OWNER_EMAIL}?subject=Done-For-You%20Audit%20%241997`}>
                    <Mail className="mr-2 h-4 w-4" /> Email to book
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Audit Monitoring */}
          <Card className="flex flex-col" data-testid="pricing-card-monitoring">
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle data-testid="text-tier-monitoring">Audit Monitoring</CardTitle>
                <Badge variant="secondary" data-testid="badge-monitoring-coming">Coming Q3</Badge>
              </div>
              <CardDescription>Quarterly re-audit + drift alerts</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 space-y-3 text-sm">
              <div className="text-3xl font-bold" data-testid="text-price-monitoring">
                $99 <span className="text-base font-normal text-muted-foreground">/ mo</span>
              </div>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>Re-audit every quarter</li>
                <li>Zombie-agent alerts when tool usage drops to zero</li>
                <li>Drift notification when new tools/personas appear</li>
                <li>Tracks your composite score over time</li>
              </ul>
            </CardContent>
            <CardContent>
              {waitDone ? (
                <div className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2" data-testid="text-waitlist-done">
                  <Check className="h-4 w-4" /> You're on the list.
                </div>
              ) : (
                <form onSubmit={captureWaitlistLead} className="space-y-2" data-testid="form-monitoring-waitlist">
                  <label htmlFor="input-waitlist-email" className="sr-only">Email for monitoring waitlist</label>
                  <Input
                    id="input-waitlist-email"
                    type="email"
                    required
                    placeholder="you@company.com"
                    aria-label="Email for monitoring waitlist"
                    value={waitEmail}
                    onChange={(e) => setWaitEmail(e.target.value)}
                    disabled={waitSubmitting}
                    data-testid="input-waitlist-email"
                  />
                  <Button type="submit" className="w-full" variant="outline" disabled={waitSubmitting || !waitEmail} data-testid="button-monitoring-waitlist">
                    {waitSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Mail className="mr-2 h-4 w-4" /> Join the waitlist</>}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          {/* Enterprise */}
          <Card className="flex flex-col" data-testid="pricing-card-enterprise">
            <CardHeader>
              <CardTitle data-testid="text-tier-enterprise">Enterprise</CardTitle>
              <CardDescription>I + team, ongoing</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 space-y-3 text-sm">
              <div className="text-3xl font-bold" data-testid="text-price-enterprise">Custom</div>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>5-day turnaround</li>
                <li>C-suite presentation + 30-day re-audit</li>
                <li>Per-tenant guaranteed</li>
                <li>12-month unlimited re-audit window</li>
                <li>Your NDA</li>
              </ul>
            </CardContent>
            <CardContent>
              <Button asChild className="w-full" variant="outline" data-testid="button-email-enterprise">
                <a href={`mailto:${OWNER_EMAIL}?subject=Enterprise%20Audit%20Inquiry`}>
                  <Mail className="mr-2 h-4 w-4" /> Email Bob
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Competitive frame */}
      <section className="space-y-4" data-testid="section-competitive">
        <h2 className="text-2xl font-semibold" data-testid="text-competitive-h2">
          How this differs from observability tools
        </h2>
        <p className="text-muted-foreground" data-testid="text-competitive-intro">
          Galileo, Arize, LangSmith, and Humanloop instrument what your agents do at runtime. They're great — and they're complementary to us, not a substitute. They typically charge ongoing subscription pricing and require you to wire instrumentation into every agent. We're a point-in-time read of what you already have — schema, code, logs — with no instrumentation.
        </p>
        <Card data-testid="table-competitive">
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 gap-x-6">
              <div className="font-semibold text-sm pb-3 border-b" data-testid="text-competitive-col-they">
                Observability platforms
              </div>
              <div className="font-semibold text-sm pb-3 border-b" data-testid="text-competitive-col-we">
                AI-Native Readiness Audit
              </div>
              {(() => {
                const rows: Array<[string, string]> = [
                  ["Instrument runtime behavior", "Read static structure"],
                  ["Ongoing monthly subscription", "$497 one-time / $1,997 DFY"],
                  ["Need code changes to deploy", "Zero code changes"],
                  ["Tell you what happened", "Tell you what's broken"],
                  ["Compete with each other", "Complement them"],
                ];
                return rows.flatMap(([they, we], i) => {
                  const isLast = i === rows.length - 1;
                  const borderCls = isLast ? "" : "border-b";
                  return [
                    <div
                      key={`they-${i}`}
                      className={`py-2 text-sm text-muted-foreground ${borderCls}`}
                      data-testid={`competitive-they-${i + 1}`}
                    >
                      {they}
                    </div>,
                    <div
                      key={`we-${i}`}
                      className={`py-2 text-sm ${borderCls}`}
                      data-testid={`competitive-we-${i + 1}`}
                    >
                      {we}
                    </div>,
                  ];
                });
              })()}
            </div>
          </CardContent>
        </Card>
        <p className="text-sm" data-testid="text-competitive-close">
          If you already have observability and still don't know which 21 of your tools are dead, you need this.
        </p>
      </section>

      {/* Fit / unfit */}
      <section className="grid md:grid-cols-2 gap-4" data-testid="section-fit">
        <Card data-testid="card-fit">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500" /> This is for you if
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <p>You have 3+ AI agents in production.</p>
            <p>You're getting a token bill &gt; $1K/month.</p>
            <p>You serve multiple customers from one platform.</p>
            <p>Your CTO would read this page and not need anything translated.</p>
          </CardContent>
        </Card>
        <Card data-testid="card-unfit">
          <CardHeader>
            <CardTitle className="text-base">This isn't for you if</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <p>You're pre-revenue (build first, audit later).</p>
            <p>You're a single LLM wrapper (no agents = nothing to audit).</p>
            <p>You can't share read-only DB access (no proof = no real audit).</p>
            <p>You want a vendor's marketing badge (look elsewhere).</p>
            <p className="text-foreground pt-2">I'd rather decline the sale than waste your $497.</p>
          </CardContent>
        </Card>
      </section>

      {/* Founder's audit */}
      <section className="space-y-4" data-testid="section-founder-audit">
        <h2 className="text-2xl font-semibold" data-testid="text-founder-h2">
          The founder's own audit
        </h2>
        <p className="text-muted-foreground" data-testid="text-founder-blurb">
          The most credible thing I can say about this audit is that I ran it on myself first.
        </p>
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-baseline gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              <span className="text-2xl font-bold" data-testid="text-founder-score">60 / 100</span>
              <Badge variant="secondary">Band C</Badge>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 text-sm pt-2">
              <div data-testid="founder-dim-tool">Tool sprawl: <span className="font-medium">0.5/10</span> (oof)</div>
              <div data-testid="founder-dim-cost">Cost visibility: <span className="font-medium">3/10</span> (oof)</div>
              <div data-testid="founder-dim-tenant">Tenant isolation: <span className="font-medium">8.4/10</span></div>
              <div data-testid="founder-dim-ahb">AHB safety: <span className="font-medium">10/10</span></div>
            </div>
            <Button asChild variant="ghost" className="px-0 h-auto" data-testid="button-read-full-audit">
              <a href="/api/public/audit/sample" target="_blank" rel="noopener noreferrer">
                Read my full audit <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* FAQ */}
      <section className="space-y-4" data-testid="section-faq">
        <h2 className="text-2xl font-semibold">FAQ</h2>
        <div className="space-y-4 text-sm">
          {[
            ["How do you get into my system?", "Read-only Postgres role scoped to schemas we agree on. Credentials rotated after delivery. NDA available."],
            ["What if I can't give DB access?", "I can work from a 24h export of agent trace logs + your tool registry JSON. Slightly less depth on a few dimensions, same depth on the rest."],
            ["Is this a SOC 2 / security audit?", "No. Those audit your code. This audits agent behavior in production — what agents exist, what they invoke, what they cost, what they leak across tenants. Different layer."],
            ["Will you sell my data?", "No. Audit data is deleted 30 days after delivery (DFY tier) or never leaves your machine (self-serve tier). Both tiers under mutual NDA on request."],
            ["Do you publish customer scores?", "Only with explicit written permission. The default is private. I publish my own score because eating my own cooking is the entire credibility play."],
            ["What if I disagree with a score?", "The SQL behind every dimension is in the deliverable. You can rerun any query. Show me the rubric is wrong → refund. Show me the data is wrong → I rerun."],
            ["Refund policy?", "Self-serve: 7-day no-questions if the script didn't run on your DB. DFY: 100% refund if I don't deliver ≥3 actionable findings."],
          ].map(([q, a], i) => (
            <div key={i} className="border-b pb-3" data-testid={`faq-item-${i + 1}`}>
              <div className="font-medium" data-testid={`faq-q-${i + 1}`}>{q}</div>
              <div className="text-muted-foreground mt-1" data-testid={`faq-a-${i + 1}`}>{a}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="text-center space-y-4 py-8" data-testid="section-cta-bottom">
        <h2 className="text-2xl font-semibold">Ready?</h2>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {selfServe?.priceId ? (
            <Button size="lg" onClick={() => startCheckout(selfServe, "self-serve-bottom")} disabled={checkoutLoading === "self-serve-bottom"} data-testid="button-buy-self-serve-bottom">
              {checkoutLoading === "self-serve-bottom" ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{priceLabel(selfServe, 497)} self-serve <ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>
          ) : (
            <Button asChild size="lg" data-testid="button-cta-bottom-self">
              <a href={`mailto:${OWNER_EMAIL}?subject=Self-Serve%20Audit%20%24497`}>
                <Mail className="mr-2 h-4 w-4" /> $497 self-serve
              </a>
            </Button>
          )}
          <Button asChild size="lg" variant="outline" data-testid="button-cta-bottom-dfy">
            <a href={`mailto:${OWNER_EMAIL}?subject=Done-For-You%20Audit%20%241997`}>
              <Mail className="mr-2 h-4 w-4" /> $1,997 done-for-you
            </a>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Still deciding?{" "}
          <a href="/api/public/audit/sample" target="_blank" rel="noopener noreferrer" className="underline" data-testid="link-cta-bottom-sample">
            Read the founder's audit
          </a>{" "}
          — it's the best preview of what you'll get.
        </p>
      </section>

      {/* Viral footer */}
      <footer className="border-t pt-6 text-center text-xs text-muted-foreground" data-testid="text-viral-footer">
        Powered by <a href="/" className="underline" data-testid="link-powered-by">VisionClaw</a>{" "}
        — the AI agent platform that wrote this audit.{" "}
        <a href="/audit" className="underline" data-testid="link-audit-yours">Audit your own platform →</a>
      </footer>
    </div>
  );
}
