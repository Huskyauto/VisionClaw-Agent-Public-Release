import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, Building2, Code2, ArrowRight, Mail } from "lucide-react";
import { SeoHead } from "@/components/seo-head";

type Tier = {
  id: string;
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  cta: { label: string; href: string; external?: boolean };
  highlight?: boolean;
  icon: typeof Sparkles;
  features: string[];
  footnote?: string;
};

const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "forever",
    tagline: "See what an autonomous AI corporation actually feels like.",
    icon: Sparkles,
    cta: { label: "Start Free — No Credit Card", href: "/signup" },
    features: [
      "5 conversations on the hosted instance",
      "All 16 specialist agents",
      "Access to all 391 tools",
      "PDF, Excel, Slides, Word output",
      "3-layer failure recovery",
      "No payment info required",
    ],
    footnote: "Conversations reset never — you simply upgrade or self-host when you want more.",
  },
  {
    id: "pro",
    name: "Hosted Pro",
    price: "Pay-as-you-go",
    cadence: "credit packs",
    tagline: "We run it for you. You hand it work.",
    icon: Building2,
    highlight: true,
    cta: { label: "Buy Credit Pack", href: "/store" },
    features: [
      "Everything in Free, no conversation cap",
      "Multi-tenant isolation, your own workspace",
      "All integrations available (Drive, Stripe, Email, voice)",
      "Glasses Gateway voice channel",
      "Cost-aware model routing (your usage, your bill)",
      "Owner email alerts on every delivery",
      "Priority support from the maintainer",
    ],
    footnote: "Credit packs from $10 (25 credits) up to $50 (175 credits). One credit ≈ one substantial delivery.",
  },
  {
    id: "self-host",
    name: "Self-Hosted",
    price: "$0",
    cadence: "open source",
    tagline: "Fork it. Run it. Own it. The whole platform.",
    icon: Code2,
    cta: {
      label: "Fork on GitHub",
      href: "https://github.com/Huskyauto/VisionClaw-Agent-Public-Release",
      external: true,
    },
    features: [
      "100% of the source — 391 tools (incl. R79 MarTech Bundle: build_voice_profile / get_voice_profile / generate_hooks / format_post / generate_content_matrix / score_post), 16 personas, 197 tables, 132 reference surfaces (32 skills + 62 db + 38 output-skills), 41 governance rules, AES-256-GCM encryption at rest for credentials, HMAC-SHA256 hashed auth secrets",
      "One-click deploy to Replit, Render, Railway, or Docker",
      "BYO API keys (OpenAI, Anthropic, Google, xAI, OpenRouter, Perplexity)",
      "Use your own ChatGPT Plus via OAuth — $0 inference",
      "Multi-tenant out of the box",
      "Self-improving codebase (R25 nightly research)",
      "Optional paid email/chat support — see below",
    ],
    footnote: "License covers personal & commercial self-hosting. See LICENSE on GitHub.",
  },
];

export default function PricingPage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background" data-testid="page-pricing">
      <SeoHead
        title="Pricing — VisionClaw Agentic Corporation"
        description="Three ways to use VisionClaw: a free hosted tier with 5 conversations, pay-as-you-go credit packs on the managed instance, or fork the entire open-source platform and self-host for free."
        canonical="/pricing"
      />

      <div className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate("/landing")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-pricing-back"
          >
            ← Back to home
          </button>
          <Button onClick={() => navigate("/signup")} size="sm" data-testid="button-pricing-signup">
            Sign Up Free
          </Button>
        </div>
      </div>

      <section className="px-6 py-16 sm:py-20">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <Badge variant="secondary" className="gap-1.5" data-testid="badge-pricing-header">
            <Sparkles className="w-3.5 h-3.5" /> Honest pricing
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight" data-testid="text-pricing-title">
            Pay only for what you actually use.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Three options. Try it free, let us host it for you, or run the whole platform yourself —
            the open-source version is the same code that powers this site.
          </p>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-6">
          {TIERS.map((tier) => {
            const Icon = tier.icon;
            return (
              <Card
                key={tier.id}
                className={`relative p-6 flex flex-col gap-5 transition-shadow hover:shadow-lg ${
                  tier.highlight ? "border-primary shadow-md ring-1 ring-primary/20" : ""
                }`}
                data-testid={`card-tier-${tier.id}`}
              >
                {tier.highlight && (
                  <Badge
                    className="absolute -top-3 left-1/2 -translate-x-1/2"
                    data-testid={`badge-popular-${tier.id}`}
                  >
                    Most popular
                  </Badge>
                )}
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center">
                    <Icon className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <h2 className="text-xl font-semibold" data-testid={`text-tier-name-${tier.id}`}>
                    {tier.name}
                  </h2>
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold" data-testid={`text-tier-price-${tier.id}`}>
                      {tier.price}
                    </span>
                    <span className="text-sm text-muted-foreground">/ {tier.cadence}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">{tier.tagline}</p>
                </div>
                <ul className="space-y-2.5 text-sm flex-1">
                  {tier.features.map((feat, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2"
                      data-testid={`item-feature-${tier.id}-${i}`}
                    >
                      <Check className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
                {tier.footnote && (
                  <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-3">
                    {tier.footnote}
                  </p>
                )}
                <Button
                  variant={tier.highlight ? "default" : "outline"}
                  className="gap-2 w-full"
                  asChild={tier.cta.external}
                  onClick={tier.cta.external ? undefined : () => navigate(tier.cta.href)}
                  data-testid={`button-tier-cta-${tier.id}`}
                >
                  {tier.cta.external ? (
                    <a href={tier.cta.href} target="_blank" rel="noopener noreferrer">
                      {tier.cta.label} <ArrowRight className="w-4 h-4" />
                    </a>
                  ) : (
                    <>
                      {tier.cta.label} <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="max-w-3xl mx-auto space-y-8">
          <h2 className="text-2xl font-bold text-center" data-testid="text-faq-title">
            Pricing FAQ
          </h2>
          <div className="space-y-5">
            {[
              {
                q: "Why is the self-hosted version free when the hosted one isn't?",
                a: "Self-hosted means you bring your own Postgres, your own LLM keys, and your own server. The hosted tier exists because we eat that infrastructure cost — and the LLM provider bills — for you.",
              },
              {
                q: "Are credits one-time or recurring?",
                a: "One-time. Buy a pack when you need one. Nothing auto-renews and there's no monthly minimum.",
              },
              {
                q: "Can I migrate from hosted to self-hosted later?",
                a: "Yes. Your conversations, documents, and persona configuration export cleanly. The schema is identical because they're literally the same codebase.",
              },
              {
                q: "Do I have to be a developer to self-host?",
                a: "No. The one-click deploy buttons for Replit, Render, and Railway provision the database and start the app. You only need to paste in one LLM key. Everything else is optional and degrades gracefully.",
              },
              {
                q: "What's enterprise support look like?",
                a: "If you're a team that wants a dedicated environment, SLA, and direct access to the maintainer for tool/persona customization, email huskyauto@gmail.com.",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="border-l-2 border-border pl-4 py-1"
                data-testid={`faq-item-${i}`}
              >
                <h3 className="font-semibold mb-1">{item.q}</h3>
                <p className="text-sm text-muted-foreground">{item.a}</p>
              </div>
            ))}
          </div>

          <Card className="p-6 bg-muted/30 border-dashed">
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold mb-1">Questions before you start?</p>
                <p className="text-muted-foreground">
                  Email{" "}
                  <a
                    href="mailto:huskyauto@gmail.com"
                    className="text-primary hover:underline"
                    data-testid="link-pricing-contact"
                  >
                    huskyauto@gmail.com
                  </a>
                  . Bob (the maintainer) reads everything personally — there's no support team to filter through.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
