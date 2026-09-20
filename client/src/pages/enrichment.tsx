import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sparkles, Search, Building2, Target, Flame, Thermometer, Snowflake,
  Lightbulb, Users, TrendingUp, Loader2, ArrowRight, ShieldCheck, Zap,
} from "lucide-react";

interface EnrichmentSignal { label: string; value: string; }
interface EnrichmentResult {
  id: number | null;
  inputEmail: string | null;
  companyDomain: string;
  finalUrl: string;
  companyName: string;
  oneLiner: string;
  industry: string;
  estimatedSize: string;
  signals: EnrichmentSignal[];
  icpFitScore: number;
  routing: "hot" | "warm" | "cold";
  talkingPoints: string[];
  decisionMakers: string[];
  summary: string;
}

function readAttrib() {
  if (typeof window === "undefined") return {};
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

const ROUTING_META: Record<string, { label: string; cls: string; Icon: any }> = {
  hot: { label: "Hot lead", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30", Icon: Flame },
  warm: { label: "Warm lead", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30", Icon: Thermometer },
  cold: { label: "Cold lead", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30", Icon: Snowflake },
};

export default function EnrichmentPage() {
  const [email, setEmail] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnrichmentResult | null>(null);
  const attrib = useRef(readAttrib());
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (result && resultRef.current) resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/public/enrichment/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), domain: domain.trim() || null, ...attrib.current }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  const routing = result ? ROUTING_META[result.routing] || ROUTING_META.cold : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-6 pt-20 pb-14 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted/50 text-xs font-medium text-muted-foreground mb-6">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            Smart Lead Enrichment
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto">
            Your contact form captures a name. <span className="text-primary">We capture the deal.</span>
          </h1>
          <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto">
            A work email is the start of 20 minutes of research your sales team does by hand — company, size,
            industry, buying signals, who decides. We do it the instant the lead hits submit.
          </p>

          {/* Live demo form */}
          <form onSubmit={onSubmit} className="mt-9 max-w-xl mx-auto space-y-3" data-testid="form-enrichment">
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 text-base"
                data-testid="input-email"
              />
              <Button type="submit" size="lg" className="h-12 px-6 shrink-0" disabled={loading} data-testid="button-enrich">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span className="ml-2">{loading ? "Researching…" : "Enrich this lead"}</span>
              </Button>
            </div>
            <Input
              type="text"
              placeholder="Company website (optional — we'll infer it from the email)"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="h-11 text-sm"
              data-testid="input-domain"
            />
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Live demo. We only read public website pages. Use a work email for best results.
            </p>
          </form>

          {error && (
            <div className="mt-6 max-w-xl mx-auto rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="text-error">
              {error}
            </div>
          )}
        </div>
      </section>

      {/* Result card */}
      {result && (
        <section ref={resultRef} className="max-w-4xl mx-auto px-6 py-12">
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden" data-testid="card-result">
            {/* Header */}
            <div className="p-6 sm:p-8 border-b border-border">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="w-6 h-6 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-2xl font-bold truncate" data-testid="text-company-name">{result.companyName}</h2>
                    <a href={result.finalUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all">
                      {result.companyDomain}
                    </a>
                  </div>
                </div>
                {routing && (
                  <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-semibold ${routing.cls}`} data-testid="badge-routing">
                    <routing.Icon className="w-4 h-4" />
                    {routing.label}
                  </div>
                )}
              </div>
              {result.oneLiner && <p className="mt-4 text-muted-foreground" data-testid="text-oneliner">{result.oneLiner}</p>}

              {/* Quick facts */}
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Fact label="Industry" value={result.industry} />
                <Fact label="Est. size" value={result.estimatedSize} />
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">ICP fit</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${result.icpFitScore}%` }} />
                    </div>
                    <span className="text-sm font-semibold tabular-nums" data-testid="text-icp-score">{result.icpFitScore}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 sm:p-8 grid md:grid-cols-2 gap-8">
              {result.talkingPoints.length > 0 && (
                <Block icon={Lightbulb} title="Talking points">
                  <ul className="space-y-2.5">
                    {result.talkingPoints.map((t, i) => (
                      <li key={i} className="flex gap-2 text-sm" data-testid={`text-talking-${i}`}>
                        <ArrowRight className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </Block>
              )}

              <div className="space-y-8">
                {result.decisionMakers.length > 0 && (
                  <Block icon={Users} title="Likely decision-makers">
                    <div className="flex flex-wrap gap-2">
                      {result.decisionMakers.map((d, i) => (
                        <span key={i} className="px-2.5 py-1 rounded-md bg-muted text-sm" data-testid={`text-dm-${i}`}>{d}</span>
                      ))}
                    </div>
                  </Block>
                )}

                {result.signals.length > 0 && (
                  <Block icon={TrendingUp} title="Buying signals">
                    <ul className="space-y-2">
                      {result.signals.map((s, i) => (
                        <li key={i} className="text-sm" data-testid={`text-signal-${i}`}>
                          <span className="font-medium">{s.label}:</span>{" "}
                          <span className="text-muted-foreground">{s.value}</span>
                        </li>
                      ))}
                    </ul>
                  </Block>
                )}
              </div>
            </div>

            {result.summary && (
              <div className="px-6 sm:px-8 pb-8">
                <Block icon={Target} title="Rep brief">
                  <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-summary">{result.summary}</p>
                </Block>
              </div>
            )}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-4">
            This is what every contact-form submission could look like — delivered to your CRM automatically.
          </p>
        </section>
      )}

      {/* How it works */}
      <section className="border-t border-border bg-muted/30">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold text-center">From "name + email" to a closeable lead</h2>
          <div className="mt-10 grid sm:grid-cols-3 gap-6">
            <Step n="1" icon={Search} title="Lead submits the form" body="You only ask for a work email — no 12-field form that kills conversion." />
            <Step n="2" icon={Zap} title="We research instantly" body="We read their public site and build a company + ICP-fit profile in seconds." />
            <Step n="3" icon={Target} title="Sales gets a brief" body="Industry, size, signals, decision-makers and talking points — routed hot/warm/cold." />
          </div>
          <div className="mt-12 text-center">
            <p className="text-muted-foreground">Want this wired into your own contact form and CRM?</p>
            <a href="mailto:?subject=Smart%20Lead%20Enrichment" className="inline-flex items-center gap-2 mt-4 text-primary font-medium hover:underline" data-testid="link-contact">
              Talk to us about a pilot <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">{label}</div>
      <div className="text-sm font-medium">{value || "—"}</div>
    </div>
  );
}

function Block({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Step({ n, icon: Icon, title, body }: { n: string; icon: any; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <span className="text-xs font-mono text-muted-foreground">STEP {n}</span>
      </div>
      <h3 className="font-semibold mb-1.5">{title}</h3>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
