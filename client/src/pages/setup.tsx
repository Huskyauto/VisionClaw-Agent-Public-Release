import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, ArrowRight, Settings, Key, Globe, Shield, RefreshCw, ExternalLink, Copy, Check } from "lucide-react";

interface SetupStatus {
  needsSetup: boolean;
  isFreshDeploy: boolean;
  checks: {
    database: boolean;
    tenant: boolean;
    adminUser: boolean;
    siteConfig: boolean;
    aiProvider: boolean;
    email: boolean;
    payments: boolean;
    drive: boolean;
    voice: boolean;
    scraping: boolean;
    telegram: boolean;
    discord: boolean;
    crypto: boolean;
  };
}

function StatusBadge({ configured, label, envHint }: { configured: boolean; label: string; envHint?: string }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg border border-border" data-testid={`status-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      {configured ? (
        <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
      ) : (
        <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium">{label}</span>
        {!configured && envHint && (
          <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">{envHint}</p>
        )}
      </div>
      <Badge variant={configured ? "default" : "secondary"} className="ml-auto text-xs shrink-0">
        {configured ? "Configured" : "Not Set"}
      </Badge>
    </div>
  );
}

export default function SetupPage() {
  const [, navigate] = useLocation();
  const [copied, setCopied] = useState(false);

  const { data: status, isLoading, refetch } = useQuery<SetupStatus>({
    queryKey: ["/api/setup/status"],
    staleTime: 10_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Checking setup status...</div>
      </div>
    );
  }

  const checks = status?.checks || {
    database: false, tenant: false, adminUser: false, siteConfig: false,
    aiProvider: false, email: false, payments: false, drive: false,
    voice: false, scraping: false, telegram: false, discord: false, crypto: false,
  };

  const isFreshDeploy = status?.isFreshDeploy ?? true;
  const requiredDone = checks.database && checks.aiProvider && !isFreshDeploy;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-2">
          <Settings className="w-8 h-8 text-primary" />
          <h1 className="text-3xl font-bold" data-testid="text-setup-title">Platform Setup</h1>
        </div>
        {isFreshDeploy && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6 mt-4">
            <p className="text-sm font-medium text-blue-400">
              Welcome! This is a fresh deployment. Configure the items below, then create your first account to get started.
            </p>
          </div>
        )}
        <div className="flex items-center justify-between mb-8">
          <p className="text-muted-foreground">
            Set environment variables in your hosting platform's secrets/configuration panel.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-status">
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Required Configuration
              </CardTitle>
              <CardDescription>These must be configured for the platform to work.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <StatusBadge configured={checks.database} label="Database Connection" envHint="DATABASE_URL" />
              <StatusBadge configured={checks.tenant} label="Tenant Initialized" envHint="Created on first user signup" />
              <StatusBadge configured={checks.adminUser} label="Admin User" envHint="Sign up at /signup to create" />
              <StatusBadge configured={checks.siteConfig} label="Site Branding" envHint="SITE_COMPANY_NAME, SITE_OWNER_EMAIL" />
              <StatusBadge configured={checks.aiProvider} label="AI Provider" envHint="OPENAI_API_KEY or ANTHROPIC_API_KEY" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                Optional Integrations
              </CardTitle>
              <CardDescription>Enable these for additional features. The platform works without them — unconfigured features gracefully degrade.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <StatusBadge configured={checks.email} label="Email (AgentMail)" envHint="AGENTMAIL_API_KEY" />
              <StatusBadge configured={checks.payments} label="Payments (Stripe)" envHint="STRIPE_LIVE_SECRET_KEY" />
              <StatusBadge configured={checks.drive} label="Cloud Storage (Google Drive)" envHint="GOOGLE_DRIVE_ROOT_FOLDER_ID" />
              <StatusBadge configured={checks.voice} label="Voice Synthesis (ElevenLabs)" envHint="ELEVENLABS_API_KEY" />
              <StatusBadge configured={checks.scraping} label="Web Scraping" envHint="FIRECRAWL_API_KEY or BROWSERLESS_API_KEY" />
              <StatusBadge configured={checks.telegram} label="Telegram Bot" envHint="TELEGRAM_BOT_TOKEN" />
              <StatusBadge configured={checks.discord} label="Discord Bot" envHint="DISCORD_BOT_TOKEN" />
              <StatusBadge configured={checks.crypto} label="Crypto Payments (Coinbase)" envHint="COINBASE_COMMERCE_API_KEY" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Quick Reference
              </CardTitle>
              <CardDescription>Minimum variables needed to get the platform running.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 text-sm">
                <div className="grid grid-cols-[200px_1fr] gap-2 p-2 rounded bg-muted/50 font-mono">
                  <span className="font-semibold">DATABASE_URL</span>
                  <span className="text-muted-foreground">PostgreSQL connection string</span>
                </div>
                <div className="grid grid-cols-[200px_1fr] gap-2 p-2 rounded font-mono">
                  <span className="font-semibold">SESSION_SECRET</span>
                  <span className="text-muted-foreground flex items-center gap-2">
                    Random string for session encryption
                    <button
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      data-testid="button-generate-secret"
                      onClick={() => {
                        const arr = new Uint8Array(32);
                        crypto.getRandomValues(arr);
                        const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
                        navigator.clipboard.writeText(hex);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied ? "Copied!" : "Generate & copy"}
                    </button>
                  </span>
                </div>
                <div className="grid grid-cols-[200px_1fr] gap-2 p-2 rounded bg-muted/50 font-mono">
                  <span className="font-semibold">OPENAI_API_KEY</span>
                  <span className="text-muted-foreground">OpenAI API key (or ANTHROPIC_API_KEY, XAI_API_KEY, OPENROUTER_API_KEY)</span>
                </div>
                <div className="grid grid-cols-[200px_1fr] gap-2 p-2 rounded font-mono">
                  <span className="font-semibold">SITE_PLATFORM_NAME</span>
                  <span className="text-muted-foreground">Your platform's display name (shown everywhere in the UI)</span>
                </div>
                <div className="grid grid-cols-[200px_1fr] gap-2 p-2 rounded bg-muted/50 font-mono">
                  <span className="font-semibold">SITE_COMPANY_NAME</span>
                  <span className="text-muted-foreground">Your company display name</span>
                </div>
                <div className="grid grid-cols-[200px_1fr] gap-2 p-2 rounded font-mono">
                  <span className="font-semibold">SITE_OWNER_EMAIL</span>
                  <span className="text-muted-foreground">Admin contact email</span>
                </div>
              </div>
              <div className="pt-2 border-t border-border">
                <a
                  href="https://github.com/Huskyauto/VisionClaw-Agent-Public-Release/blob/main/FORK-SETUP.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  data-testid="link-fork-setup"
                >
                  <ExternalLink className="w-4 h-4" />
                  Full setup guide with all environment variables (FORK-SETUP.md)
                </a>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between pt-4">
            <div className="text-sm text-muted-foreground">
              {requiredDone ? (
                <span className="text-green-600 font-medium">All required items are configured. Platform is ready.</span>
              ) : isFreshDeploy ? (
                <span className="text-blue-500 font-medium">Set required env vars, then sign up to initialize.</span>
              ) : (
                <span className="text-yellow-600 font-medium">Some required items need configuration.</span>
              )}
            </div>
            <div className="flex gap-2">
              {isFreshDeploy && checks.database && checks.aiProvider && (
                <Button variant="outline" onClick={() => navigate("/signup")} data-testid="button-setup-signup">
                  Create Account
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              )}
              {requiredDone && (
                <Button onClick={() => navigate("/landing")} data-testid="button-setup-continue">
                  Go to Platform
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
