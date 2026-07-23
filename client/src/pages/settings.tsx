import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useRef, useEffect } from "react";
import { Settings, Bot, Cpu, Brain, Save, Key, Trash2, Eye, EyeOff, Check, ExternalLink, Shield, MessageCircle, Zap, Loader2, X, Download, Upload, CloudUpload, Mic, Plus, Volume2 as Volume2Icon, Globe, Activity, RefreshCw, Flame, Terminal, FileText, GitCompare, Monitor, Link, Copy, Code, CreditCard, Wrench, Database, Coins, Clock, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AgentSettings } from "@shared/schema";
import { ErrorState } from "@/components/error-state";

const settingsSchema = z.object({
  agentName: z.string().min(1, "Name required").max(50),
  personality: z.string().min(10, "Personality must be at least 10 characters").max(2000),
  defaultModel: z.string(),
  thinkingEnabled: z.boolean(),
});

interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  tier: string;
  description: string;
}

interface ProviderKeyInfo {
  id: number;
  provider: string;
  apiKey: string;
  baseUrl: string | null;
  enabled: boolean;
}

interface ProviderConfig {
  name: string;
  baseUrl: string;
  description: string;
}

const PROVIDER_LINKS: Record<string, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  xai: "https://console.x.ai/",
  google: "https://aistudio.google.com/apikey",
  perplexity: "https://www.perplexity.ai/settings/api",
  openrouter: "https://openrouter.ai/keys",
};

function ProviderKeyForm({
  providerId,
  config,
  existing,
}: {
  providerId: string;
  config: ProviderConfig;
  existing?: ProviderKeyInfo;
}) {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (data: { apiKey: string; enabled: boolean }) =>
      apiRequest("PUT", `/api/provider-keys/${providerId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider-keys"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models"] });
      setApiKey("");
      toast({ description: `${config.name} key saved` });
    },
    onError: () => toast({ description: "Failed to save key", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/provider-keys/${providerId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/provider-keys"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models"] });
      toast({ description: `${config.name} key removed` });
    },
  });

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border bg-card" data-testid={`provider-key-${providerId}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{config.name}</span>
          {existing && (
            <Badge variant="secondary" className="text-xs">
              <Check className="w-3 h-3 mr-1" /> Connected
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {PROVIDER_LINKS[providerId] && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => window.open(PROVIDER_LINKS[providerId], "_blank")}
              data-testid={`link-${providerId}-keys`}
            >
              <ExternalLink className="w-3 h-3 mr-1" /> Get Key
            </Button>
          )}
          {existing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid={`button-delete-${providerId}`}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{config.description}</p>
      {existing ? (
        <div className="flex items-center gap-2">
          <code className="text-xs bg-muted px-2 py-1 rounded flex-1 font-mono">{existing.apiKey}</code>
          <Switch
            checked={existing.enabled}
            onCheckedChange={(enabled) => saveMutation.mutate({ apiKey: "", enabled })}
            data-testid={`switch-${providerId}-enabled`}
          />
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`Enter ${config.name} API key...`}
              className="text-sm pr-8 font-mono"
              data-testid={`input-${providerId}-key`}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-full px-2"
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </Button>
          </div>
          <Button
            size="sm"
            disabled={!apiKey.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate({ apiKey: apiKey.trim(), enabled: true })}
            data-testid={`button-save-${providerId}`}
          >
            <Save className="w-3 h-3 mr-1" />
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

interface TestResult {
  connected: boolean;
  provider: string;
  detail: string;
  latencyMs?: number;
}

function TestAllKeysButton() {
  const { toast } = useToast();
  const [results, setResults] = useState<Record<string, TestResult> | null>(null);
  const [testing, setTesting] = useState(false);

  const runTest = async () => {
    setTesting(true);
    setResults(null);
    try {
      const res = await apiRequest("POST", "/api/provider-keys/test");
      const data = await res.json();
      setResults(data);
      const providers = Object.values(data) as TestResult[];
      const passed = providers.filter((p) => p.connected).length;
      const total = providers.length;
      toast({ description: `${passed}/${total} providers connected` });
    } catch {
      toast({ description: "Failed to run test", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={runTest}
        disabled={testing}
        data-testid="button-test-all-keys"
      >
        {testing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
        {testing ? "Testing..." : "Test All Keys"}
      </Button>
      {results && (
        <div className="w-full mt-2 rounded-lg border bg-muted/50 p-3 space-y-1.5 text-xs">
          {Object.entries(results).map(([id, r]) => (
            <div key={id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {r.connected ? (
                  <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                ) : (
                  <X className="w-3.5 h-3.5 text-red-500 shrink-0" />
                )}
                <span className="font-medium">{r.provider}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {r.latencyMs != null && <span>{r.latencyMs}ms</span>}
                <span className={r.connected ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                  {r.connected ? "OK" : "FAIL"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface OAuthSubStatus {
  provider: string;
  name: string;
  description: string;
  connected: boolean;
  expiresIn: string | null;
  email: string | null;
  connectedAt: string | null;
}

function BillingPortalCard() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const openPortal = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/stripe/billing-portal");
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank");
      } else {
        toast({ description: data.error || "Could not open billing portal", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ description: "No active subscription found. Subscribe to a plan first.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-primary" /> Billing & Subscription
        </CardTitle>
        <CardDescription className="text-xs">
          Manage your subscription, update payment method, view invoices, or cancel your plan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" onClick={openPortal} disabled={loading} data-testid="button-billing-portal">
          {loading ? "Opening..." : "Manage Billing"}
        </Button>
      </CardContent>
    </Card>
  );
}

function SubscriptionConnections() {
  const { toast } = useToast();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [codePasteFlow, setCodePasteFlow] = useState<{
    authUrl: string;
    state: string;
    provider: string;
  } | null>(null);
  const [pastedUrl, setPastedUrl] = useState("");

  const { data: subs, isLoading } = useQuery<OAuthSubStatus[]>({
    queryKey: ["/api/oauth-subscriptions/status"],
  });

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("oauth_success=")) {
      const provider = hash.split("oauth_success=")[1]?.split("&")[0];
      toast({ description: `${provider === "openai" ? "OpenAI" : "Google Gemini"} subscription connected` });
      queryClient.invalidateQueries({ queryKey: ["/api/oauth-subscriptions/status"] });
      window.history.replaceState(null, "", "/settings#general");
    } else if (hash.includes("oauth_error=")) {
      const error = decodeURIComponent(hash.split("oauth_error=")[1]?.split("&")[0] || "unknown");
      toast({ description: `OAuth error: ${error}`, variant: "destructive" });
      window.history.replaceState(null, "", "/settings#general");
    }
  }, []);

  const connectMutation = useMutation({
    mutationFn: async (provider: string) => {
      setConnecting(provider);
      const res = await apiRequest("POST", `/api/oauth-subscriptions/initiate/${provider}`);
      const data = await res.json();
      if (data.directConnect) {
        queryClient.invalidateQueries({ queryKey: ["/api/oauth-subscriptions/status"] });
        toast({ description: `${provider === "google" ? "Google Workspace" : provider} connected via Replit integration` });
        setConnecting(null);
      } else if (data.redirect && data.authUrl) {
        window.location.href = data.authUrl;
      } else if (data.codePaste) {
        setCodePasteFlow({ authUrl: data.authUrl, state: data.state, provider });
        setPastedUrl("");
        window.open(data.authUrl, "_blank");
      } else if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    },
    onError: (err: any) => {
      setConnecting(null);
      toast({ description: `Failed to connect: ${err.message}`, variant: "destructive" });
    },
  });

  const submitCodeMutation = useMutation({
    mutationFn: async () => {
      if (!codePasteFlow || !pastedUrl.trim()) return;
      let code = pastedUrl.trim();
      try {
        const url = new URL(code);
        code = url.searchParams.get("code") || code;
      } catch {
        // user might have pasted just the code
      }
      const res = await apiRequest("POST", "/api/oauth-subscriptions/exchange-code", {
        code,
        state: codePasteFlow.state,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Exchange failed");
    },
    onSuccess: () => {
      setCodePasteFlow(null);
      setConnecting(null);
      setPastedUrl("");
      queryClient.invalidateQueries({ queryKey: ["/api/oauth-subscriptions/status"] });
      toast({ description: "OpenAI subscription connected successfully!" });
    },
    onError: (err: any) => {
      toast({ description: `Failed: ${err.message}`, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (provider: string) => apiRequest("DELETE", `/api/oauth-subscriptions/${provider}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/oauth-subscriptions/status"] });
      toast({ description: "Subscription disconnected" });
    },
  });

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Link className="w-4 h-4 text-primary" /> Subscription OAuth
        </CardTitle>
        <CardDescription className="text-xs">
          Connect your existing monthly subscriptions to use them for inference instead of API billing. Subscription tokens are checked first before API keys.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(subs || []).map((sub) => (
          <div
            key={sub.provider}
            className="flex flex-col gap-2 p-3 rounded-lg border bg-card"
            data-testid={`oauth-sub-${sub.provider}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{sub.name}</span>
                {sub.connected ? (
                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                    <Check className="w-3 h-3 mr-1" /> Connected
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                {sub.connected ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => disconnectMutation.mutate(sub.provider)}
                    disabled={disconnectMutation.isPending}
                    data-testid={`button-disconnect-${sub.provider}`}
                  >
                    <Trash2 className="w-3 h-3 mr-1" /> Disconnect
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs"
                    onClick={() => connectMutation.mutate(sub.provider)}
                    disabled={connecting === sub.provider || connectMutation.isPending}
                    data-testid={`button-connect-${sub.provider}`}
                  >
                    {connecting === sub.provider ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <ExternalLink className="w-3 h-3 mr-1" />
                    )}
                    Connect Subscription
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{sub.description}</p>
            {sub.connected && sub.expiresIn && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Token expires in {sub.expiresIn}
                </span>
                {sub.email && (
                  <span className="flex items-center gap-1">
                    <Globe className="w-3 h-3" /> {sub.email}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}

        {codePasteFlow && (
          <div className="p-4 rounded-lg border-2 border-primary bg-primary/5 space-y-3" data-testid="code-paste-flow">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" />
              <span className="font-medium text-sm">
                Connect your {codePasteFlow.provider === "google" ? "Google" : "OpenAI"} account
              </span>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                1. A new tab opened for {codePasteFlow.provider === "google" ? "Google" : "OpenAI"} login. Sign in with your {codePasteFlow.provider === "google" ? "Google" : "ChatGPT"} account.
              </p>
              {codePasteFlow.provider === "openai" ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    2. After signing in, you'll be redirected to a page that won't load (localhost). That's normal!
                  </p>
                  <p className="text-xs text-muted-foreground">
                    3. Copy the <strong>entire URL</strong> from your browser's address bar and paste it below:
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  2. After signing in and granting permissions, you'll be redirected back automatically. If a code page appears, paste the URL below:
                </p>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 px-3 py-2 text-sm border rounded-md bg-background"
                  placeholder="Paste the URL from the address bar here..."
                  value={pastedUrl}
                  onChange={(e) => setPastedUrl(e.target.value)}
                  data-testid="input-auth-code"
                />
                <Button
                  size="sm"
                  onClick={() => submitCodeMutation.mutate()}
                  disabled={!pastedUrl.trim() || submitCodeMutation.isPending}
                  data-testid="button-submit-code"
                >
                  {submitCodeMutation.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3 mr-1" />
                  )}
                  Connect
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => window.open(codePasteFlow.authUrl, "_blank")}
              >
                <ExternalLink className="w-3 h-3 mr-1" /> Reopen {codePasteFlow.provider === "google" ? "Google" : "OpenAI"} Login
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs text-muted-foreground"
              onClick={() => {
                setCodePasteFlow(null);
                setConnecting(null);
                setPastedUrl("");
              }}
              data-testid="button-cancel-code-paste"
            >
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VoiceWakeSettings() {
  const { toast } = useToast();
  const [newTrigger, setNewTrigger] = useState("");

  const { data, isLoading } = useQuery<{ triggers: string[] }>({
    queryKey: ["/api/voice/wake"],
  });

  const mutation = useMutation({
    mutationFn: (triggers: string[]) =>
      apiRequest("POST", "/api/voice/wake", { triggers }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/voice/wake"] });
      toast({ description: "Wake words updated" });
    },
    onError: () => {
      toast({ description: "Failed to update wake words", variant: "destructive" });
    },
  });

  const triggers = data?.triggers || [];

  const addTrigger = () => {
    const t = newTrigger.trim().toLowerCase();
    if (!t || triggers.includes(t)) return;
    mutation.mutate([...triggers, t]);
    setNewTrigger("");
  };

  const removeTrigger = (trigger: string) => {
    mutation.mutate(triggers.filter((t) => t !== trigger));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Mic className="w-4 h-4 text-primary" /> Voice Wake & Talk Mode
        </CardTitle>
        <CardDescription className="text-xs">
          Configure wake words for Voice Wake detection. These trigger words activate listening when detected.
          Talk Mode provides continuous voice conversation from the chat input.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">Wake Words</Label>
          <div className="flex flex-wrap gap-1.5 mt-1.5 mb-2">
            {isLoading ? (
              <Badge variant="secondary" className="text-xs">Loading...</Badge>
            ) : triggers.length === 0 ? (
              <span className="text-xs text-muted-foreground">No wake words set</span>
            ) : (
              triggers.map((t) => (
                <Badge key={t} variant="secondary" className="text-xs gap-1 pr-1" data-testid={`wake-word-${t}`}>
                  {t}
                  <button
                    onClick={() => removeTrigger(t)}
                    className="ml-0.5 hover:text-destructive"
                    data-testid={`button-remove-wake-${t}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={newTrigger}
              onChange={(e) => setNewTrigger(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTrigger()}
              placeholder="Add wake word..."
              className="h-8 text-xs flex-1"
              data-testid="input-wake-word"
              maxLength={30}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={addTrigger}
              disabled={!newTrigger.trim() || mutation.isPending}
              data-testid="button-add-wake-word"
            >
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TTSConfigSettings() {
  const { toast } = useToast();
  const { data: ttsConfig, isLoading } = useQuery<any>({ queryKey: ["/api/tts/config"] });

  const mutation = useMutation({
    mutationFn: (config: any) => apiRequest("PUT", "/api/tts/config", config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tts/config"] });
      toast({ description: "TTS config saved" });
    },
    onError: () => toast({ description: "Failed to save TTS config", variant: "destructive" }),
  });

  if (isLoading || !ttsConfig) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Volume2Icon className="w-4 h-4 text-primary" /> Text-to-Speech Configuration
        </CardTitle>
        <CardDescription className="text-xs">
          Configure auto-TTS mode, provider, and voice settings. Supports ElevenLabs (primary), OpenAI, and Edge TTS as fallback providers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Auto-TTS Mode</Label>
            <Select
              value={ttsConfig.auto}
              onValueChange={(v) => mutation.mutate({ ...ttsConfig, auto: v })}
            >
              <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-tts-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="always">Always</SelectItem>
                <SelectItem value="inbound">Inbound Only</SelectItem>
                <SelectItem value="tagged">Tagged Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Primary Provider</Label>
            <Select
              value={ttsConfig.provider}
              onValueChange={(v) => mutation.mutate({ ...ttsConfig, provider: v })}
            >
              <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-tts-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="edge">Edge TTS (Free)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Max Text Length</Label>
            <Input
              type="number"
              className="h-8 text-xs mt-1"
              value={ttsConfig.maxTextLength}
              onChange={(e) => mutation.mutate({ ...ttsConfig, maxTextLength: parseInt(e.target.value) || 4000 })}
              data-testid="input-tts-max-length"
            />
          </div>
          <div className="flex items-end gap-2 pb-0.5">
            <Switch
              checked={ttsConfig.summarize}
              onCheckedChange={(v) => mutation.mutate({ ...ttsConfig, summarize: v })}
              data-testid="switch-tts-summarize"
            />
            <Label className="text-xs">Auto-summarize long text</Label>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground/60">
          <p>Provider fallback order: {ttsConfig.provider} → {ttsConfig.provider === "elevenlabs" ? "openai → edge" : ttsConfig.provider === "openai" ? "elevenlabs → edge" : "elevenlabs → openai"}</p>
          <p>Edge TTS requires no API key and works as a free fallback.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function HooksSettings() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ hooks: any[] }>({ queryKey: ["/api/hooks/list"] });
  const { data: logData } = useQuery<{ log: any[] }>({ queryKey: ["/api/hooks/log"] });

  const enableMutation = useMutation({
    mutationFn: (name: string) => apiRequest("POST", `/api/hooks/${name}/enable`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hooks/list"] });
      toast({ description: "Hook enabled" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: (name: string) => apiRequest("POST", `/api/hooks/${name}/disable`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hooks/list"] });
      toast({ description: "Hook disabled" });
    },
  });

  const hooks = data?.hooks || [];
  const recentLog = (logData?.log || []).slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" /> Hooks & Automation
        </CardTitle>
        <CardDescription className="text-xs">
          Event-driven hooks that fire on agent commands and messages. Enable or disable hooks to customize automation behavior.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading hooks...</div>
        ) : hooks.length === 0 ? (
          <div className="text-xs text-muted-foreground">No hooks registered</div>
        ) : (
          <div className="space-y-2">
            {hooks.map((hook) => (
              <div key={hook.name} className="flex items-center justify-between p-2 rounded-md bg-muted/30 border" data-testid={`hook-${hook.name}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">{hook.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{hook.description}</div>
                  <div className="flex gap-1 mt-0.5">
                    {hook.events.map((e: string) => (
                      <Badge key={e} variant="outline" className="text-[10px] px-1 py-0">{e}</Badge>
                    ))}
                  </div>
                </div>
                <Switch
                  checked={hook.enabled}
                  onCheckedChange={(v) => v ? enableMutation.mutate(hook.name) : disableMutation.mutate(hook.name)}
                  data-testid={`switch-hook-${hook.name}`}
                />
              </div>
            ))}
          </div>
        )}
        {recentLog.length > 0 && (
          <div>
            <Label className="text-xs">Recent Activity</Label>
            <div className="mt-1 space-y-0.5">
              {recentLog.map((entry, i) => (
                <div key={i} className="text-[11px] flex gap-2">
                  <span className={entry.status === "ok" ? "text-green-500" : "text-red-500"}>●</span>
                  <span className="text-muted-foreground">{entry.hookName}</span>
                  <span className="text-muted-foreground/60">{entry.event}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PublicChatSettings() {
  const { toast } = useToast();
  const [copied, setCopied] = useState<"link" | "widget" | "vanity" | null>(null);
  const [slugDraft, setSlugDraft] = useState("");
  const [slugError, setSlugError] = useState("");

  const { data, isLoading } = useQuery<{ enabled: boolean; token: string | null; vanitySlug: string | null }>({
    queryKey: ["/api/public-chat/config"],
  });

  const enableMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/public-chat/enable"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/public-chat/config"] });
      toast({ description: "Public chat enabled" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/public-chat/disable"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/public-chat/config"] });
      toast({ description: "Public chat disabled" });
    },
  });

  const slugMutation = useMutation({
    mutationFn: async (slug: string) => {
      const res = await apiRequest("PUT", "/api/public-chat/vanity-slug", { slug });
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/public-chat/config"] });
      toast({ description: "Custom URL saved" });
      setSlugDraft("");
      setSlugError("");
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to set custom URL";
      setSlugError(msg);
    },
  });

  const removeSlugMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/public-chat/vanity-slug"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/public-chat/config"] });
      toast({ description: "Custom URL removed" });
    },
  });

  const baseUrl = window.location.origin;
  const vanityLink = data?.vanitySlug ? `${baseUrl}/c/${data.vanitySlug}` : "";
  const chatLink = vanityLink || (data?.token ? `${baseUrl}/public-chat/${data.token}` : "");
  const widgetCode = data?.token
    ? `<script src="${baseUrl}/widget.js" data-token="${data.token}"></script>`
    : "";

  function copyText(text: string, type: "link" | "widget" | "vanity") {
    navigator.clipboard.writeText(text);
    setCopied(type);
    toast({ description: "Copied to clipboard" });
    setTimeout(() => setCopied(null), 2000);
  }

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Link className="w-4 h-4 text-primary" /> Public Chat Link & Widget
        </CardTitle>
        <CardDescription className="text-xs">
          Let anyone chat with your AI agent — no login required. Share a link or embed a chat widget on any website.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Label className="text-xs">{data?.enabled ? "Public chat is live" : "Public chat is off"}</Label>
          <Switch
            checked={data?.enabled || false}
            onCheckedChange={(checked) => checked ? enableMutation.mutate() : disableMutation.mutate()}
            data-testid="switch-public-chat"
          />
        </div>

        {data?.enabled && data?.token && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs mb-1 block">Shareable Link</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={chatLink}
                  className="text-xs h-8 font-mono bg-muted"
                  data-testid="input-public-chat-link"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  onClick={() => copyText(chatLink, "link")}
                  data-testid="button-copy-chat-link"
                >
                  {copied === "link" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  onClick={() => window.open(chatLink, "_blank")}
                  data-testid="button-open-chat-link"
                >
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </div>
            </div>

            <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
              <Label className="text-xs font-medium flex items-center gap-1">
                <Globe className="w-3 h-3 text-primary" /> Custom URL (Paid)
              </Label>
              <p className="text-[10px] text-muted-foreground">
                Choose a memorable, branded URL for your public chat instead of a random token.
              </p>
              {data?.vanitySlug ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={vanityLink}
                      className="text-xs h-8 font-mono bg-muted"
                      data-testid="input-vanity-url"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0"
                      onClick={() => copyText(vanityLink, "vanity")}
                      data-testid="button-copy-vanity-url"
                    >
                      {copied === "vanity" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0"
                      onClick={() => window.open(vanityLink, "_blank")}
                      data-testid="button-open-vanity-url"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive"
                    onClick={() => removeSlugMutation.mutate()}
                    disabled={removeSlugMutation.isPending}
                    data-testid="button-remove-vanity-slug"
                  >
                    <Trash2 className="w-3 h-3 mr-1" /> Remove custom URL
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2 items-center">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{baseUrl}/c/</span>
                    <Input
                      placeholder="your-brand"
                      value={slugDraft}
                      onChange={(e) => { setSlugDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); setSlugError(""); }}
                      className="text-xs h-8 font-mono"
                      maxLength={40}
                      data-testid="input-vanity-slug"
                    />
                    <Button
                      size="sm"
                      className="h-8 shrink-0"
                      disabled={!slugDraft.trim() || slugMutation.isPending}
                      onClick={() => slugMutation.mutate(slugDraft)}
                      data-testid="button-save-vanity-slug"
                    >
                      {slugMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    </Button>
                  </div>
                  {slugError && <p className="text-[10px] text-destructive">{slugError}</p>}
                  <p className="text-[10px] text-muted-foreground">
                    3-40 characters. Lowercase letters, numbers, and hyphens only.
                  </p>
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs mb-1 flex items-center gap-1">
                <Code className="w-3 h-3" /> Embed Widget
              </Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={widgetCode}
                  className="text-xs h-8 font-mono bg-muted"
                  data-testid="input-widget-code"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  onClick={() => copyText(widgetCode, "widget")}
                  data-testid="button-copy-widget-code"
                >
                  {copied === "widget" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Paste this snippet before the closing &lt;/body&gt; tag on any webpage to add a floating chat button.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WebhookSettings() {
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const { data, isLoading } = useQuery<{ enabled: boolean; hasToken: boolean; recentLogs: any[] }>({
    queryKey: ["/api/webhooks/config"],
  });

  const mutation = useMutation({
    mutationFn: (config: { enabled: boolean; token: string }) =>
      apiRequest("PUT", "/api/webhooks/config", config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks/config"] });
      toast({ description: "Webhook config saved" });
      setToken("");
    },
    onError: (err: any) => toast({ description: err.message || "Failed to save", variant: "destructive" }),
  });

  const enabled = data?.enabled || false;
  const recentLogs = (data?.recentLogs || []).slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" /> Webhooks
        </CardTitle>
        <CardDescription className="text-xs">
          External HTTP endpoints for triggering agent actions. POST to /api/hooks/wake (system events) or /api/hooks/agent (isolated agent runs).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => {
              if (v && !data?.hasToken && !token) {
                toast({ description: "Set a webhook token first", variant: "destructive" });
                return;
              }
              mutation.mutate({ enabled: v, token: token || "keep-existing" });
            }}
            data-testid="switch-webhooks-enabled"
          />
          <Label className="text-xs">{enabled ? "Webhooks enabled" : "Webhooks disabled"}</Label>
          <div className={`w-2 h-2 rounded-full ${enabled ? "bg-green-500" : "bg-muted-foreground/30"}`} />
        </div>
        <div>
          <Label className="text-xs">Webhook Token</Label>
          <div className="flex gap-2 mt-1">
            <div className="relative flex-1">
              <Input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={data?.hasToken ? "Token set (enter new to change)" : "Enter token (min 8 chars)"}
                className="h-8 text-xs pr-8"
                data-testid="input-webhook-token"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-8 w-8"
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </Button>
            </div>
            <Button
              size="sm"
              className="h-8"
              onClick={() => mutation.mutate({ enabled: true, token })}
              disabled={!token || token.length < 8 || mutation.isPending}
              data-testid="button-save-webhook-token"
            >
              <Check className="w-3 h-3 mr-1" /> Save
            </Button>
          </div>
        </div>
        {recentLogs.length > 0 && (
          <div>
            <Label className="text-xs">Recent Webhook Activity</Label>
            <div className="mt-1 space-y-0.5">
              {recentLogs.map((log: any, i: number) => (
                <div key={i} className="text-[11px] flex gap-2">
                  <span className={log.status === "completed" || log.status === "accepted" ? "text-green-500" : "text-red-500"}>●</span>
                  <span className="text-muted-foreground">{log.type}</span>
                  <span className="text-muted-foreground/60 truncate">{log.detail?.slice(0, 60)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="text-[11px] text-muted-foreground/60 space-y-0.5">
          <p>Auth: Bearer token via Authorization header or x-visionclaw-token header.</p>
          <p>Rate limiting: 5 failed attempts per minute per IP.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DemoModeSettings() {
  const { toast } = useToast();
  const [warming, setWarming] = useState(false);
  const [result, setResult] = useState<any>(null);

  const { data: health, refetch: refetchHealth } = useQuery<any>({
    queryKey: ["/api/drive-health"],
    refetchInterval: 30000,
  });

  const { data: onedriveHealth } = useQuery<any>({
    queryKey: ["/api/onedrive-health"],
    refetchInterval: 60000,
  });

  const demoActive = health?.demoMode === true;

  const handleWarmup = async () => {
    setWarming(true);
    try {
      const resp = await apiRequest("POST", "/api/demo/warmup");
      const data = await resp.json();
      setResult(data);
      refetchHealth();
      toast({
        title: data.ready ? "Demo Mode Ready" : "Demo Mode Warning",
        description: data.ready
          ? `Google Drive verified. Token expires in ${Math.round(data.tokenExpiresIn / 60)} min. Refresh interval set to 5 min.`
          : "Token could not be verified. Check Google Drive connection.",
        variant: data.ready ? "default" : "destructive",
      });
    } catch (err: any) {
      toast({ title: "Warm-up failed", description: err.message, variant: "destructive" });
    }
    setWarming(false);
  };

  const handleExit = async () => {
    try {
      await apiRequest("POST", "/api/demo/exit");
      setResult(null);
      refetchHealth();
      toast({ title: "Demo Mode Off", description: "Normal refresh intervals restored." });
    } catch (err: any) {
      toast({ title: "Exit failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <Card className={demoActive ? "border-cyan-500/50 shadow-cyan-500/10 shadow-md" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Monitor className="w-4 h-4 text-cyan-500" /> Demo / Presentation Mode
          {demoActive && <Badge variant="outline" className="text-[10px] border-cyan-500 text-cyan-500" data-testid="badge-demo-active">ACTIVE</Badge>}
        </CardTitle>
        <CardDescription className="text-xs">
          Pre-flight check for live demos. Verifies Google Drive, activates aggressive token refresh (5 min), and enables local file fallback if Drive goes down.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${health?.status === "ok" ? "bg-green-500" : health?.status === "fail" ? "bg-red-500" : "bg-yellow-500"}`} />
            <span className="text-muted-foreground" data-testid="text-drive-status">
              Google Drive: {health?.status || "unknown"}
              {health?.tokenExpiresIn > 0 && ` · Token: ${Math.round(health.tokenExpiresIn / 60)}min`}
              {health?.lastRefreshSource && ` · via ${health.lastRefreshSource}`}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${onedriveHealth?.connected ? "bg-green-500" : "bg-yellow-500"}`} />
            <span className="text-muted-foreground" data-testid="text-onedrive-status">
              OneDrive: {onedriveHealth?.connected ? "connected" : "not connected"}
              {onedriveHealth?.user && ` · ${onedriveHealth.user}`}
              {onedriveHealth?.fileCount !== undefined && ` · ${onedriveHealth.fileCount} files`}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          {!demoActive ? (
            <Button
              size="sm"
              onClick={handleWarmup}
              disabled={warming}
              className="bg-cyan-600 hover:bg-cyan-700 text-white"
              data-testid="button-demo-warmup"
            >
              {warming ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <Zap className="w-3 h-3 mr-1.5" />}
              {warming ? "Warming up..." : "Activate Demo Mode"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleExit}
              data-testid="button-demo-exit"
            >
              <X className="w-3 h-3 mr-1.5" /> Exit Demo Mode
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refetchHealth()}
            data-testid="button-drive-refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>

        {result && (
          <div className={`text-xs p-3 rounded-lg border ${result.ready ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`} data-testid="text-demo-result">
            <div className="font-medium mb-1">{result.ready ? "Pre-flight Check Passed" : "Pre-flight Check Failed"}</div>
            {result.details?.map((d: string, i: number) => (
              <div key={i} className="text-muted-foreground">• {d}</div>
            ))}
          </div>
        )}

        {demoActive && (
          <div className="text-[11px] text-cyan-400/80 bg-cyan-500/5 border border-cyan-500/20 rounded-lg px-3 py-2" data-testid="text-demo-info">
            Demo mode is active. Token refresh every 5 min. Health check every 5 min. All uploads auto-backup to OneDrive. If Google Drive fails, files served locally as fallback.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FelixDiagnosticCard() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ checks: { name: string; status: string; detail: string }[]; summary: { pass: number; fail: number; warn: number; total: number } } | null>(null);

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await authFetch("/api/demo/felix-check");
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Server returned ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setResult(null);
      toast({ variant: "destructive", title: "Diagnostic failed", description: err.message || "Could not run Felix diagnostic checks" });
    }
    setRunning(false);
  };

  const statusIcon = (s: string) => s === "pass" ? "✓" : s === "fail" ? "✗" : "⚠";
  const statusColor = (s: string) => s === "pass" ? "text-green-500" : s === "fail" ? "text-red-500" : "text-yellow-500";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="w-4 h-4 text-violet-500" /> Felix Presentation Diagnostic
        </CardTitle>
        <CardDescription className="text-xs">
          Run all 11 checks to verify Felix can build presentations. Checks persona, conversations, streaming config, tools, and more.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          size="sm"
          onClick={handleRun}
          disabled={running}
          className="bg-violet-600 hover:bg-violet-700 text-white"
          data-testid="button-felix-diagnostic"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <Activity className="w-3 h-3 mr-1.5" />}
          {running ? "Running checks..." : "Run Felix Diagnostic"}
        </Button>

        {result && (
          <div className="space-y-2">
            <div className={`text-xs font-medium px-3 py-2 rounded-lg border ${
              result.summary.fail === 0
                ? "bg-green-500/5 border-green-500/20 text-green-400"
                : "bg-red-500/5 border-red-500/20 text-red-400"
            }`} data-testid="text-felix-summary">
              {result.summary.pass}/{result.summary.total} passed
              {result.summary.fail > 0 && ` · ${result.summary.fail} failed`}
              {result.summary.warn > 0 && ` · ${result.summary.warn} warnings`}
              {result.summary.fail === 0 && " — All clear"}
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {result.checks.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]" data-testid={`text-felix-check-${i}`}>
                  <span className={`font-mono font-bold ${statusColor(c.status)}`}>{statusIcon(c.status)}</span>
                  <span className="text-muted-foreground font-medium">{c.name}:</span>
                  <span className="text-muted-foreground">{c.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ApiKeysSection() {
  const { toast } = useToast();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["chat", "read"]);
  const [justCreatedKey, setJustCreatedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  const { data: keys = [], isLoading } = useQuery<Array<{
    id: number; name: string; keyPrefix: string; scopes: string[];
    lastUsedAt: string | null; expiresAt: string | null; isRevoked: boolean; createdAt: string;
  }>>({ queryKey: ["/api/api-keys"] });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; scopes: string[] }) => {
      const res = await apiRequest("POST", "/api/api-keys", data);
      return await res.json();
    },
    onSuccess: (created) => {
      setJustCreatedKey(created.key);
      setNewKeyName("");
      setNewKeyScopes(["chat", "read"]);
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API key created", description: "Copy it now — it won't be shown again." });
    },
    onError: (err: any) => toast({ title: "Failed to create key", description: err.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("PATCH", `/api/api-keys/${id}/revoke`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API key revoked" });
    },
    onError: (err: any) => toast({ title: "Failed to revoke key", description: err?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/api-keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API key deleted" });
    },
    onError: (err: any) => toast({ title: "Failed to delete key", description: err?.message, variant: "destructive" }),
  });

  const toggleScope = (s: string) => {
    setNewKeyScopes((prev) => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const copyKey = async () => {
    if (!justCreatedKey) return;
    try {
      await navigator.clipboard.writeText(justCreatedKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch (err) {
      toast({
        title: "Could not copy",
        description: "Select the key text and copy it manually before dismissing this banner.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card data-testid="card-api-keys">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Key className="w-4 h-4 text-primary" /> Public API Keys
        </CardTitle>
        <CardDescription className="text-xs">
          Issue <code className="px-1 py-0.5 bg-muted rounded text-[10px]">vc_*</code> keys for external agents (Claude Code, Cursor, Gemini CLI) to call the VisionClaw API at <code className="px-1 py-0.5 bg-muted rounded text-[10px]">/api/v1</code>. See the <code className="px-1 py-0.5 bg-muted rounded text-[10px]">claude-skill/visionclaw/SKILL.md</code> for the full contract.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {justCreatedKey && (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 space-y-2" data-testid="banner-new-key">
            <div className="text-xs font-medium text-yellow-700 dark:text-yellow-400">
              Copy your new API key now — it will not be shown again:
            </div>
            <div className="flex items-center gap-2">
              <Input value={justCreatedKey} readOnly className="text-xs h-8 font-mono" data-testid="input-new-key" />
              <Button size="sm" className="h-8" onClick={copyKey} data-testid="button-copy-new-key">
                {keyCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setJustCreatedKey(null)} data-testid="button-dismiss-new-key">
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}

        {!showCreateForm ? (
          <Button size="sm" variant="outline" className="h-8" onClick={() => setShowCreateForm(true)} data-testid="button-show-create-key">
            <Plus className="w-3 h-3 mr-1" /> New API Key
          </Button>
        ) : (
          <div className="rounded-md border p-3 space-y-2" data-testid="form-create-key">
            <Input
              placeholder="Key name (e.g. 'Claude Code dev')"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="text-xs h-8"
              data-testid="input-new-key-name"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Scopes:</span>
              {["chat", "read", "tools", "admin"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScope(s)}
                  className={`px-2 py-0.5 rounded text-[10px] border transition ${
                    newKeyScopes.includes(s)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted border-border"
                  }`}
                  data-testid={`button-scope-${s}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-8"
                disabled={!newKeyName.trim() || newKeyScopes.length === 0 || createMutation.isPending}
                onClick={() => createMutation.mutate({ name: newKeyName.trim(), scopes: newKeyScopes })}
                data-testid="button-create-key"
              >
                {createMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
                Create
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => { setShowCreateForm(false); setNewKeyName(""); }} data-testid="button-cancel-create-key">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-xs text-muted-foreground py-2">Loading…</div>
        ) : keys.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No API keys yet.</div>
        ) : (
          <div className="space-y-1.5">
            {keys.map((k) => (
              <div
                key={k.id}
                className={`flex items-center gap-2 rounded-md border p-2 ${k.isRevoked ? "opacity-50" : ""}`}
                data-testid={`row-api-key-${k.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate" data-testid={`text-key-name-${k.id}`}>{k.name}</span>
                    {k.isRevoked && <Badge variant="outline" className="text-[9px] h-4">REVOKED</Badge>}
                    {k.scopes?.map((s) => (
                      <Badge key={s} variant="secondary" className="text-[9px] h-4">{s}</Badge>
                    ))}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {k.keyPrefix}…{" · "}
                    {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : "never used"}
                    {" · "}
                    created {new Date(k.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {!k.isRevoked && (
                  <Button
                    size="sm" variant="outline" className="h-7 px-2"
                    onClick={() => {
                      if (confirm(`Revoke "${k.name}"? Any external agent using this key will immediately lose access.`)) {
                        revokeMutation.mutate(k.id);
                      }
                    }}
                    disabled={revokeMutation.isPending}
                    data-testid={`button-revoke-key-${k.id}`}
                  >
                    Revoke
                  </Button>
                )}
                <Button
                  size="sm" variant="ghost" className="h-7 px-2 text-destructive"
                  onClick={() => { if (confirm(`Permanently delete "${k.name}"?`)) deleteMutation.mutate(k.id); }}
                  disabled={deleteMutation.isPending}
                  data-testid={`button-delete-key-${k.id}`}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AuthHealthSettings() {
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ providers: Record<string, any>; exitCode: number; exitLabel: string }>({
    queryKey: ["/api/auth/health"],
    refetchInterval: 5 * 60 * 1000,
  });

  const handleCheck = async () => {
    setChecking(true);
    await refetch();
    setChecking(false);
    toast({ description: "Provider health refreshed" });
  };

  const providers = data?.providers || {};
  const exitLabel = data?.exitLabel || "unchecked";

  const statusColors: Record<string, string> = {
    ok: "bg-green-500",
    expired: "bg-red-500",
    expiring_soon: "bg-yellow-500",
    error: "bg-red-400",
    disabled: "bg-muted-foreground/30",
    unchecked: "bg-muted-foreground/20",
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> Auth & Provider Health
        </CardTitle>
        <CardDescription className="text-xs">
          Monitor provider API key health. Auto-checks every 5 minutes. Status: {exitLabel}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${exitLabel === "ok" ? "bg-green-500" : exitLabel === "expired" ? "bg-red-500" : "bg-yellow-500"}`} />
            <span className="text-xs font-medium uppercase tracking-wider">
              {exitLabel === "ok" ? "All Healthy" : exitLabel === "expired" ? "Credentials Issue" : exitLabel === "expiring_soon" ? "Expiring Soon" : "Checking..."}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={handleCheck}
            disabled={checking || isLoading}
            data-testid="button-check-health"
          >
            {checking ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
            Refresh
          </Button>
        </div>
        <div className="space-y-1.5">
          {Object.entries(providers).map(([key, info]: [string, any]) => (
            <div key={key} className="flex items-center gap-2 p-1.5 rounded bg-muted/20" data-testid={`health-provider-${key}`}>
              <div className={`w-2 h-2 rounded-full ${statusColors[info.status] || statusColors.unchecked}`} />
              <span className="text-xs font-medium w-24 truncate">{info.displayName}</span>
              <span className="text-[11px] text-muted-foreground truncate flex-1">{info.detail}</span>
              {info.latencyMs != null && (
                <span className="text-[10px] text-muted-foreground/50">{info.latencyMs}ms</span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LobsterSettings() {
  const { toast } = useToast();
  const { data: listResult, isLoading } = useQuery<any>({ queryKey: ["/api/lobster/workflows"] });
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");

  const createMutation = useMutation({
    mutationFn: (data: { name: string; content: string }) => apiRequest("POST", "/api/lobster/workflows", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lobster/workflows"] });
      setShowCreate(false);
      setNewName("");
      setNewContent("");
      toast({ description: "Workflow created" });
    },
    onError: (err: any) => toast({ description: err.message || "Failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => apiRequest("DELETE", `/api/lobster/workflows/${name}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lobster/workflows"] });
      toast({ description: "Workflow deleted" });
    },
    onError: (err: any) => toast({ description: err.message || "Failed", variant: "destructive" }),
  });

  const workflows = listResult?.output?.[0]?.json?.workflows || [];
  const pendingApprovals = listResult?.output?.[0]?.json?.pendingApprovals || 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" /> Lobster Workflows
        </CardTitle>
        <CardDescription className="text-xs">
          Deterministic multi-step pipelines with approval gates. Chain commands and tools into workflows that run as one atomic operation. The agent uses the <code className="text-[10px]">lobster</code> tool to execute these.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
              {workflows.length} workflow{workflows.length !== 1 ? "s" : ""}
            </Badge>
            {pendingApprovals > 0 && (
              <Badge variant="default" className="text-[10px] h-4 px-1.5 bg-amber-500">
                {pendingApprovals} pending approval{pendingApprovals !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setShowCreate(!showCreate)} data-testid="button-create-workflow">
            <Plus className="w-3 h-3 mr-1" /> New Workflow
          </Button>
        </div>

        {showCreate && (
          <div className="space-y-2 border rounded-md p-2">
            <Input
              className="h-7 text-xs"
              placeholder="Workflow name (e.g. daily-report)"
              value={newName}
              onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              data-testid="input-workflow-name"
            />
            <Textarea
              className="text-[10px] font-mono min-h-[100px]"
              placeholder={"name: my-workflow\nsteps:\n  - id: step1\n    command: echo hello\n  - id: step2\n    tool: check_system_status\n    toolArgs: {}"}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              data-testid="input-workflow-content"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-[10px]"
                disabled={!newName || !newContent || createMutation.isPending}
                onClick={() => createMutation.mutate({ name: newName, content: newContent })}
                data-testid="button-save-workflow"
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {workflows.length > 0 && (
          <div className="space-y-1.5">
            {workflows.map((wf: any) => (
              <div key={wf.file} className="flex items-center justify-between border rounded-md px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <FileText className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs font-medium">{wf.name}</span>
                  <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                    {wf.stepCount} step{wf.stepCount !== 1 ? "s" : ""}
                  </Badge>
                  {wf.hasApprovals && (
                    <Badge variant="secondary" className="text-[9px] h-3.5 px-1">
                      has approvals
                    </Badge>
                  )}
                  {wf.args?.length > 0 && (
                    <span className="text-[9px] text-muted-foreground">
                      args: {wf.args.join(", ")}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 text-[9px] px-1.5 text-destructive"
                  onClick={() => deleteMutation.mutate(wf.name)}
                  data-testid={`button-delete-workflow-${wf.name}`}
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {workflows.length === 0 && !isLoading && (
          <p className="text-[10px] text-muted-foreground/60 text-center py-2">
            No workflows yet. Create one above or the agent can create them via the lobster tool.
          </p>
        )}

        <div className="text-[10px] text-muted-foreground/60 space-y-0.5">
          <p>Workflow files use YAML format with steps that chain commands and tools. Each step can pipe output to the next via <code className="text-[9px]">stdin: $stepId.stdout</code>.</p>
          <p>Approval gates halt execution until approved. Resume tokens persist so workflows can be continued later.</p>
          <p>The agent can also run inline pipelines: <code className="text-[9px]">echo hello | jq . | approve --prompt 'OK?'</code></p>
        </div>
      </CardContent>
    </Card>
  );
}

function ToolLoopDetectionSettings() {
  const { toast } = useToast();
  const { data: config, isLoading } = useQuery<any>({ queryKey: ["/api/loop-detection/config"] });

  const mutation = useMutation({
    mutationFn: (update: any) => apiRequest("PUT", "/api/loop-detection/config", update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loop-detection/config"] });
      toast({ description: "Loop detection config saved" });
    },
    onError: (err: any) => toast({ description: err.message || "Failed to save", variant: "destructive" }),
  });

  if (isLoading || !config) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-primary" /> Tool Loop Detection
        </CardTitle>
        <CardDescription className="text-xs">
          Guardrails to prevent the agent from getting stuck in repetitive tool-call loops. Saves tokens and prevents lockups.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={config.enabled}
            onCheckedChange={(v) => mutation.mutate({ enabled: v })}
            data-testid="switch-loop-detection-enabled"
          />
          <Label className="text-xs font-medium">{config.enabled ? "Detection enabled" : "Detection disabled"}</Label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Warning at</Label>
            <Input
              type="number"
              className="h-8 text-xs mt-1"
              value={config.warningThreshold}
              onChange={(e) => mutation.mutate({ warningThreshold: parseInt(e.target.value) || 3 })}
              data-testid="input-loop-warning"
            />
          </div>
          <div>
            <Label className="text-xs">Critical at</Label>
            <Input
              type="number"
              className="h-8 text-xs mt-1"
              value={config.criticalThreshold}
              onChange={(e) => mutation.mutate({ criticalThreshold: parseInt(e.target.value) || 5 })}
              data-testid="input-loop-critical"
            />
          </div>
          <div>
            <Label className="text-xs">Breaker at</Label>
            <Input
              type="number"
              className="h-8 text-xs mt-1"
              value={config.globalCircuitBreakerThreshold}
              onChange={(e) => mutation.mutate({ globalCircuitBreakerThreshold: parseInt(e.target.value) || 20 })}
              data-testid="input-loop-breaker"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Detectors</Label>
          <div className="flex flex-wrap gap-3">
            {[
              { key: "genericRepeat", label: "Repeat" },
              { key: "pingPong", label: "Ping-Pong" },
              { key: "knownPollNoProgress", label: "No-Progress" },
            ].map((d) => (
              <div key={d.key} className="flex items-center gap-1.5">
                <Switch
                  checked={config.detectors?.[d.key] !== false}
                  onCheckedChange={(v) => mutation.mutate({ detectors: { ...config.detectors, [d.key]: v } })}
                  data-testid={`switch-detector-${d.key}`}
                  className="scale-75"
                />
                <Label className="text-[11px]">{d.label}</Label>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground/60 space-y-0.5">
          <p>Warning: agent receives a "try different approach" message.</p>
          <p>Critical: tools are disabled and agent must respond with what it has.</p>
          <p>Circuit breaker: global fallback when too many calls produce few unique outcomes.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ExecToolSettings() {
  const { toast } = useToast();
  const [newBin, setNewBin] = useState("");

  const { data: config, isLoading } = useQuery<any>({ queryKey: ["/api/exec/config"] });

  const mutation = useMutation({
    mutationFn: (update: any) => apiRequest("PUT", "/api/exec/config", update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exec/config"] });
      toast({ description: "Exec config saved" });
    },
    onError: () => toast({ description: "Failed to save config", variant: "destructive" }),
  });

  if (isLoading || !config) return null;

  const addToAllowlist = () => {
    if (!newBin.trim()) return;
    const updated = [...(config.allowlist || []), newBin.trim()];
    mutation.mutate({ allowlist: updated });
    setNewBin("");
  };

  const removeFromAllowlist = (bin: string) => {
    const updated = (config.allowlist || []).filter((b: string) => b !== bin);
    mutation.mutate({ allowlist: updated });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Terminal className="w-4 h-4 text-primary" /> Exec Tool — Shell Execution
        </CardTitle>
        <CardDescription className="text-xs">
          Allows the agent to run shell commands. Disabled by default for safety. Uses an allowlist of permitted binaries and deny patterns for dangerous commands.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={config.enabled}
            onCheckedChange={(v) => mutation.mutate({ enabled: v })}
            data-testid="switch-exec-enabled"
          />
          <Label className="text-xs font-medium">{config.enabled ? "Exec enabled" : "Exec disabled"}</Label>
          {config.enabled && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
              ⚠ Agent can run commands
            </span>
          )}
        </div>

        <div>
          <Label className="text-xs">Security Mode</Label>
          <Select
            value={config.securityMode}
            onValueChange={(v) => mutation.mutate({ securityMode: v })}
          >
            <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-exec-security">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="deny">Deny — block all commands</SelectItem>
              <SelectItem value="allowlist">Allowlist — only permitted binaries</SelectItem>
              <SelectItem value="full">Full — allow everything (dangerous)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Timeout (seconds)</Label>
            <Input
              type="number"
              className="h-8 text-xs mt-1"
              value={config.timeoutSeconds}
              onChange={(e) => mutation.mutate({ timeoutSeconds: parseInt(e.target.value) || 30 })}
              data-testid="input-exec-timeout"
            />
          </div>
          <div>
            <Label className="text-xs">Max Output (KB)</Label>
            <Input
              type="number"
              className="h-8 text-xs mt-1"
              value={Math.round((config.maxOutputBytes || 32768) / 1024)}
              onChange={(e) => mutation.mutate({ maxOutputBytes: (parseInt(e.target.value) || 32) * 1024 })}
              data-testid="input-exec-max-output"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs">Allowlisted Binaries ({(config.allowlist || []).length})</Label>
          <div className="flex flex-wrap gap-1 mt-1 max-h-24 overflow-y-auto">
            {(config.allowlist || []).map((bin: string) => (
              <span key={bin} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-muted">
                <code>{bin}</code>
                <button
                  onClick={() => removeFromAllowlist(bin)}
                  className="text-muted-foreground hover:text-destructive ml-0.5"
                  data-testid={`button-remove-bin-${bin}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2 mt-1">
            <Input
              className="h-7 text-xs flex-1"
              value={newBin}
              onChange={(e) => setNewBin(e.target.value)}
              placeholder="Add binary name (e.g. python3)"
              onKeyDown={(e) => e.key === "Enter" && addToAllowlist()}
              data-testid="input-exec-new-bin"
            />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addToAllowlist} data-testid="button-add-bin">
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground/60 space-y-0.5">
          <p className="flex items-center gap-1"><FileText className="w-3 h-3" /> PDF analysis tool is always available — no config needed.</p>
          <p className="flex items-center gap-1"><GitCompare className="w-3 h-3" /> Diff tool is always available — generates unified or word-level diffs.</p>
          <p>Command substitution ($(), backticks) and dangerous patterns are always blocked.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function BrowserToolSettings() {
  const { toast } = useToast();
  const { data: config, isLoading, isError } = useQuery<any>({ queryKey: ["/api/browser/config"], retry: false });
  const { data: status } = useQuery<any>({ queryKey: ["/api/browser/status"], refetchInterval: 10000 });
  const [cdpUrl, setCdpUrl] = useState("");
  const [cdpInitialized, setCdpInitialized] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [healthResult, setHealthResult] = useState<any>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const isAdmin = !isError && !!config;

  const invalidateBrowser = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/browser/config"] });
    queryClient.invalidateQueries({ queryKey: ["/api/browser/status"] });
  };

  const mutation = useMutation({
    mutationFn: (update: any) => apiRequest("PUT", "/api/browser/config", update),
    onSuccess: () => { invalidateBrowser(); toast({ description: "Browser config saved" }); },
    onError: (err: any) => toast({ description: err.message || "Failed to save", variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/browser/disconnect"),
    onSuccess: () => { invalidateBrowser(); toast({ description: "Browser disconnected" }); },
  });

  const createProfileMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/browser/profiles", data),
    onSuccess: () => { invalidateBrowser(); setShowNewProfile(false); setNewProfileName(""); toast({ description: "Profile created" }); },
    onError: (err: any) => toast({ description: err.message || "Failed", variant: "destructive" }),
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (name: string) => apiRequest("DELETE", `/api/browser/profiles/${name}`),
    onSuccess: () => { invalidateBrowser(); toast({ description: "Profile deleted" }); },
    onError: (err: any) => toast({ description: err.message || "Failed", variant: "destructive" }),
  });

  const updateProfileMutation = useMutation({
    mutationFn: ({ name, data }: { name: string; data: any }) => apiRequest("PUT", `/api/browser/profiles/${name}`, data),
    onSuccess: () => { invalidateBrowser(); toast({ description: "Profile updated" }); },
    onError: (err: any) => toast({ description: err.message || "Failed", variant: "destructive" }),
  });

  if (isLoading) return null;

  const activeProfile = config?.profiles?.[config?.defaultProfile];
  if (!cdpInitialized && activeProfile?.cdpUrl) {
    setCdpUrl(activeProfile.cdpUrl);
    setCdpInitialized(true);
  }

  const checkHealth = async () => {
    setCheckingHealth(true);
    try {
      const resp = await authFetch("/api/browser/health");
      const data = await resp.json();
      setHealthResult(data);
    } catch (err: any) {
      setHealthResult({ error: err.message });
    }
    setCheckingHealth(false);
  };

  const profileNames = Object.keys(config?.profiles || {});

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Monitor className="w-4 h-4 text-primary" /> Browser Tool
        </CardTitle>
        <CardDescription className="text-xs">
          Remote browser for web navigation, screenshots, and data extraction. {!isAdmin && "Managed by your platform administrator."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => mutation.mutate({ enabled: v })}
              data-testid="switch-browser-enabled"
            />
          )}
          <Label className="text-xs font-medium">{status?.enabled ? "Enabled" : "Disabled"}</Label>
          {status && (
            <Badge
              variant={status.connected ? "default" : status.enabled ? "secondary" : "outline"}
              className="text-[10px] h-4 px-1.5"
            >
              {status.connected ? `Connected${status.uptime ? ` (${Math.floor(status.uptime / 60)}m)` : ""}` : status.enabled ? "Ready" : "Off"}
            </Badge>
          )}
          {isAdmin && status?.connected && (
            <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => disconnectMutation.mutate()} data-testid="button-browser-disconnect">
              Disconnect
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={checkingHealth} onClick={checkHealth} data-testid="button-health-check">
            {checkingHealth ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Activity className="w-3 h-3 mr-1" />}
            Test Connection
          </Button>
          {healthResult && (
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${healthResult.reachable ? (healthResult.connected ? "bg-green-500" : "bg-yellow-500") : "bg-red-500"}`} />
              <span className={`text-[10px] ${healthResult.reachable ? "text-green-500" : "text-destructive"}`}>
                {healthResult.reachable
                  ? `${healthResult.connected ? "Connected" : "Reachable"}${healthResult.version ? ` — ${healthResult.version}` : ""}${healthResult.activeSessions ? ` — ${healthResult.activeSessions} active session(s)` : ""}`
                  : `Unreachable: ${healthResult.error || "Unknown error"}`}
              </span>
            </div>
          )}
        </div>

        {status?.activeSessions > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {status.activeSessions} active browser session{status.activeSessions > 1 ? "s" : ""}
          </div>
        )}

        {isAdmin && config.enabled && (
          <div className="space-y-3 pt-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Profiles</Label>
                <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setShowNewProfile(!showNewProfile)} data-testid="button-add-profile">
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>

              {showNewProfile && (
                <div className="flex gap-2">
                  <Input
                    className="h-7 text-xs flex-1"
                    placeholder="profile-name"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                    data-testid="input-new-profile-name"
                  />
                  <Button
                    size="sm"
                    className="h-7 text-[10px]"
                    disabled={!newProfileName || createProfileMutation.isPending}
                    onClick={() => createProfileMutation.mutate({ name: newProfileName, driver: "remote", color: "#808080", label: newProfileName })}
                    data-testid="button-create-profile"
                  >
                    Create
                  </Button>
                </div>
              )}

              {profileNames.map((name) => {
                const p = config.profiles[name];
                const isDefault = config.defaultProfile === name;
                return (
                  <div key={name} className={`border rounded-md p-2 space-y-1.5 ${isDefault ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color || "#808080" }} />
                        <span className="text-xs font-medium">{name}</span>
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1">{p.driver || "remote"}</Badge>
                        {isDefault && <Badge variant="default" className="text-[9px] h-3.5 px-1">default</Badge>}
                      </div>
                      <div className="flex items-center gap-1">
                        {!isDefault && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 text-[9px] px-1.5"
                            onClick={() => mutation.mutate({ defaultProfile: name })}
                            data-testid={`button-set-default-${name}`}
                          >
                            Set default
                          </Button>
                        )}
                        {!isDefault && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 text-[9px] px-1.5 text-destructive"
                            onClick={() => deleteProfileMutation.mutate(name)}
                            data-testid={`button-delete-profile-${name}`}
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <Input
                      className="h-7 text-[10px] font-mono"
                      placeholder="CDP URL (http:// or wss://)"
                      defaultValue={p.cdpUrl || ""}
                      onBlur={(e) => {
                        if (e.target.value !== (p.cdpUrl || ""))
                          updateProfileMutation.mutate({ name, data: { cdpUrl: e.target.value } });
                      }}
                      data-testid={`input-cdp-${name}`}
                    />
                  </div>
                );
              })}
            </div>

            <details className="text-xs" data-testid="details-browser-advanced">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors font-medium">Advanced Options</summary>
              <div className="mt-2 space-y-3 pl-2 border-l border-border">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Nav Timeout (ms)</Label>
                    <Input type="number" className="h-8 text-xs mt-1" value={config.navigationTimeout} onChange={(e) => mutation.mutate({ navigationTimeout: parseInt(e.target.value) || 30000 })} data-testid="input-browser-timeout" />
                  </div>
                  <div>
                    <Label className="text-xs">Max Content Length</Label>
                    <Input type="number" className="h-8 text-xs mt-1" value={config.maxContentLength} onChange={(e) => mutation.mutate({ maxContentLength: parseInt(e.target.value) || 50000 })} data-testid="input-browser-max-content" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={config.ssrfPolicy?.allowPrivateNetwork} onCheckedChange={(v) => mutation.mutate({ ssrfPolicy: { allowPrivateNetwork: v } })} data-testid="switch-browser-private-network" className="scale-75" />
                  <Label className="text-[11px]">Allow private/internal network URLs</Label>
                </div>
              </div>
            </details>

          </div>
        )}

        <details className="text-[10px] text-muted-foreground/60">
          <summary className="cursor-pointer hover:text-muted-foreground transition-colors">Quick Start Guide & Info</summary>
          <div className="mt-2 space-y-1 pl-2 border-l border-border">
            <p><strong>How it works:</strong> The browser tool lets your AI agent navigate websites, take screenshots, fill forms, and extract content.</p>
            <p><strong>Actions:</strong> navigate, screenshot, content, click, type, evaluate, smart_browse (all-in-one), form_fill (multiple fields), tabs, snapshot, close_session.</p>
            <p><strong>Isolation:</strong> Each user gets their own browser context. Max 3 concurrent sessions, 30 actions/min.</p>
            <p><strong>Screenshots:</strong> Saved per-tenant, auto-pruned after 24h. Agents can request base64 inline screenshots.</p>
            <p><strong>Security:</strong> SSRF protection blocks private networks and cloud metadata endpoints by default.</p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function WebSearchSettings() {
  const { toast } = useToast();
  const { data: config, isLoading } = useQuery<any>({ queryKey: ["/api/search/config"] });
  const { data: status } = useQuery<any>({ queryKey: ["/api/search/status"] });

  const mutation = useMutation({
    mutationFn: (update: any) => apiRequest("PUT", "/api/search/config", update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/search/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/search/status"] });
      toast({ description: "Search config saved" });
    },
    onError: (err: any) => toast({ description: err.message || "Failed to save", variant: "destructive" }),
  });

  if (isLoading || !config) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" /> Web Search Provider
        </CardTitle>
        <CardDescription className="text-xs">
          Configure the web_search tool provider. Perplexity Sonar provides AI-powered search with citations; legacy uses Wikipedia + Jina AI.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={config.provider === "perplexity"}
            onCheckedChange={(v) => mutation.mutate({ provider: v ? "perplexity" : "legacy" })}
            data-testid="switch-search-provider"
          />
          <Label className="text-xs font-medium">
            {config.provider === "perplexity" ? "Perplexity Sonar" : "Legacy (Wikipedia + Jina)"}
          </Label>
          {status && (
            <Badge variant={status.available ? "default" : "secondary"} className="text-[10px] h-4 px-1.5">
              {status.available ? "Ready" : "Not configured"}
            </Badge>
          )}
        </div>

        {config.provider === "perplexity" && (
          <div className="space-y-2.5 pt-1">
            <div>
              <Label className="text-xs">API Key</Label>
              <Input
                type="password"
                className="h-8 text-xs mt-1 font-mono"
                placeholder="pplx-... or sk-or-..."
                defaultValue={config.perplexity?.apiKey || ""}
                onBlur={(e) => {
                  if (e.target.value !== (config.perplexity?.apiKey || ""))
                    mutation.mutate({ perplexity: { apiKey: e.target.value } });
                }}
                data-testid="input-search-api-key"
              />
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                Uses PERPLEXITY_API_KEY or OPENROUTER_API_KEY env vars if empty
              </p>
            </div>

            <div>
              <Label className="text-xs">Base URL</Label>
              <Input
                className="h-8 text-xs mt-1 font-mono"
                placeholder="Auto-detect from key prefix"
                defaultValue={config.perplexity?.baseUrl || ""}
                onBlur={(e) => {
                  if (e.target.value !== (config.perplexity?.baseUrl || ""))
                    mutation.mutate({ perplexity: { baseUrl: e.target.value } });
                }}
                data-testid="input-search-base-url"
              />
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                Leave empty to auto-detect: pplx-* → api.perplexity.ai, sk-or-* → openrouter.ai
              </p>
            </div>

            <div>
              <Label className="text-xs">Model</Label>
              <Select
                value={config.perplexity?.model || "sonar-pro"}
                onValueChange={(v) => mutation.mutate({ perplexity: { model: v } })}
              >
                <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-search-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sonar">sonar — Fast Q&A</SelectItem>
                  <SelectItem value="sonar-pro">sonar-pro — Multi-step reasoning</SelectItem>
                  <SelectItem value="sonar-reasoning-pro">sonar-reasoning-pro — Deep research</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {status && status.baseUrl && (
              <div className="text-[10px] text-muted-foreground/60">
                Resolved endpoint: {status.baseUrl}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FirecrawlSettings() {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const { data: config, isLoading } = useQuery<any>({ queryKey: ["/api/firecrawl/config"] });
  const { data: status } = useQuery<any>({ queryKey: ["/api/firecrawl/status"] });

  const mutation = useMutation({
    mutationFn: (update: any) => apiRequest("PUT", "/api/firecrawl/config", update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firecrawl/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firecrawl/status"] });
      toast({ description: "Firecrawl config saved" });
      setApiKey("");
    },
    onError: () => toast({ description: "Failed to save config", variant: "destructive" }),
  });

  const clearCacheMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/firecrawl/cache/clear"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firecrawl/status"] });
      toast({ description: "Cache cleared" });
    },
  });

  if (isLoading || !config) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Flame className="w-4 h-4 text-primary" /> Firecrawl Web Extraction
        </CardTitle>
        <CardDescription className="text-xs">
          Firecrawl provides stealth web scraping with bot circumvention and caching. Used as a fallback when standard extraction fails on JS-heavy or bot-protected pages.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={config.enabled !== false}
            onCheckedChange={(v) => mutation.mutate({ enabled: v })}
            data-testid="switch-firecrawl-enabled"
          />
          <Label className="text-xs">{config.enabled !== false ? "Firecrawl enabled" : "Firecrawl disabled"}</Label>
          <div className={`w-2 h-2 rounded-full ${status?.available ? "bg-green-500" : "bg-muted-foreground/30"}`} />
          <span className="text-[11px] text-muted-foreground">
            {status?.available ? "Ready" : "Not configured"}
          </span>
        </div>

        <div>
          <Label className="text-xs">API Key</Label>
          <div className="flex gap-2 mt-1">
            <div className="relative flex-1">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={config.apiKey ? `Current: ${config.apiKey}` : "Enter Firecrawl API key"}
                className="h-8 text-xs pr-8"
                data-testid="input-firecrawl-key"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-8 w-8"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </Button>
            </div>
            <Button
              size="sm"
              className="h-8"
              onClick={() => mutation.mutate({ apiKey })}
              disabled={!apiKey || mutation.isPending}
              data-testid="button-save-firecrawl-key"
            >
              <Check className="w-3 h-3 mr-1" /> Save
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Timeout (seconds)</Label>
            <Input
              type="number"
              className="h-8 text-xs mt-1"
              value={config.timeoutSeconds}
              onChange={(e) => mutation.mutate({ timeoutSeconds: parseInt(e.target.value) || 60 })}
              data-testid="input-firecrawl-timeout"
            />
          </div>
          <div>
            <Label className="text-xs">Cache TTL (hours)</Label>
            <Input
              type="number"
              className="h-8 text-xs mt-1"
              value={Math.round((config.maxAgeMs || 172800000) / 3600000)}
              onChange={(e) => mutation.mutate({ maxAgeMs: (parseInt(e.target.value) || 48) * 3600000 })}
              data-testid="input-firecrawl-cache-ttl"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch
              checked={config.onlyMainContent !== false}
              onCheckedChange={(v) => mutation.mutate({ onlyMainContent: v })}
              data-testid="switch-firecrawl-main-content"
            />
            <Label className="text-xs">Extract main content only</Label>
          </div>
          {status?.cache?.entries > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => clearCacheMutation.mutate()}
              disabled={clearCacheMutation.isPending}
              data-testid="button-clear-firecrawl-cache"
            >
              Clear cache ({status.cache.entries})
            </Button>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground/60 space-y-0.5">
          <p>Extraction order: Readability (Jina AI) → Firecrawl → Basic HTML cleanup</p>
          <p>Firecrawl uses stealth proxy mode for bot-protected pages.</p>
          <p>Get an API key at <a href="https://firecrawl.dev" target="_blank" rel="noopener" className="underline">firecrawl.dev</a></p>
        </div>
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function DeleteAccountSection() {
  const { toast } = useToast();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const { data: summary, refetch: refetchSummary } = useQuery<{
    conversations: number;
    messages: number;
    memories: number;
    files: number;
    fileStorageBytes: number;
    knowledgeEntries: number;
    customTools: number;
    apiKeys: number;
    accountStatus: string;
    deletionScheduledAt: string | null;
  }>({
    queryKey: ["/api/account/deletion-summary"],
    enabled: showConfirm,
  });

  const isPendingDeletion = summary?.accountStatus === "pending_deletion";
  const deletionDate = summary?.deletionScheduledAt ? new Date(summary.deletionScheduledAt) : null;
  const daysRemaining = deletionDate ? Math.max(0, Math.ceil((deletionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 30;

  const handleScheduleDeletion = async () => {
    if (confirmText !== "DELETE") return;
    setScheduling(true);
    try {
      const res = await authFetch("/api/account/schedule-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to schedule deletion");

      toast({ title: "Account deletion scheduled", description: data.message });
      refetchSummary();
      setConfirmText("");
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setScheduling(false);
    }
  };

  const handleCancelDeletion = async () => {
    setCancelling(true);
    try {
      const res = await authFetch("/api/account/cancel-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel deletion");

      toast({ title: "Deletion cancelled", description: "Your account is active again." });
      refetchSummary();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-destructive">
          <Trash2 className="w-4 h-4" /> Delete Account
        </CardTitle>
        <CardDescription className="text-xs">
          Request account deletion with a 30-day grace period. Download your data before the deadline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!showConfirm ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowConfirm(true)}
            data-testid="button-delete-account"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Delete My Account
          </Button>
        ) : isPendingDeletion ? (
          <div className="space-y-4 p-4 bg-destructive/5 border border-destructive/20 rounded-lg">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-semibold text-destructive">Account Deletion in Progress</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Your account and all data will be permanently deleted on{" "}
                  <strong className="text-foreground">
                    {deletionDate?.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                  </strong>{" "}
                  ({daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining).
                </p>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-400 mb-2">Before your data is deleted:</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>1. Go to <strong className="text-foreground">Files</strong> page and download your uploads</li>
                <li>2. Go to <strong className="text-foreground">Settings &gt; Data &gt; Export</strong> to download conversations, memories, and settings</li>
                <li>3. Remove any API keys from the Settings page if needed</li>
              </ul>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelDeletion}
                disabled={cancelling}
                data-testid="button-cancel-deletion"
              >
                {cancelling ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                {cancelling ? "Cancelling..." : "Cancel Deletion — Keep My Account"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-4 bg-destructive/5 border border-destructive/20 rounded-lg">
            <p className="text-sm font-medium text-destructive">Data that will be permanently deleted:</p>

            {summary && (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Conversations", value: summary.conversations },
                  { label: "Messages", value: summary.messages },
                  { label: "Memories", value: summary.memories },
                  { label: "Files", value: `${summary.files} (${formatBytes(summary.fileStorageBytes)})` },
                  { label: "Knowledge entries", value: summary.knowledgeEntries },
                  { label: "Custom tools", value: summary.customTools },
                  { label: "API keys", value: summary.apiKeys },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-xs py-1 px-2 bg-background/50 rounded">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium text-foreground">{value}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-400 mb-1">30-Day Grace Period</p>
              <p className="text-xs text-muted-foreground">
                After requesting deletion, you'll have 30 days to download your files and export your data.
                Your account will be deactivated immediately, but your data will remain accessible for download
                during this period. After 30 days, everything is permanently and irreversibly deleted.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Type <strong className="text-foreground">DELETE</strong> to schedule account deletion:
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
              className="text-sm"
              data-testid="input-confirm-delete"
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={confirmText !== "DELETE" || scheduling}
                onClick={handleScheduleDeletion}
                data-testid="button-confirm-delete"
              >
                {scheduling ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                {scheduling ? "Scheduling..." : "Schedule Account Deletion (30 days)"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowConfirm(false); setConfirmText(""); }}
                data-testid="button-cancel-delete"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExportImportSection() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const importMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/import", data);
      return res.json();
    },
    onSuccess: (data) => {
      setImportResult(data.imported);
      queryClient.invalidateQueries();
      toast({ description: "Import completed successfully" });
    },
    onError: () => toast({ description: "Import failed", variant: "destructive" }),
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await apiRequest("GET", "/api/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `visionclaw-export-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ description: "Export downloaded" });
    } catch {
      toast({ description: "Export failed", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleCloudBackup = async () => {
    setBackingUp(true);
    try {
      const res = await apiRequest("POST", "/api/backup/cloud");
      if (!res.ok) throw new Error("Backup failed");
      const data = await res.json();
      toast({ description: data.summary || "Backup uploaded to Google Drive" });
    } catch {
      toast({ description: "Cloud backup failed", variant: "destructive" });
    } finally {
      setBackingUp(false);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        importMutation.mutate(data);
      } catch {
        toast({ description: "Invalid JSON file", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleExport}
          disabled={exporting}
          className="flex-1"
          data-testid="button-export-data"
        >
          {exporting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
          {exporting ? "Exporting..." : "Export All Data"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={importMutation.isPending}
          className="flex-1"
          data-testid="button-import-data"
        >
          {importMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
          {importMutation.isPending ? "Importing..." : "Import Data"}
        </Button>
      </div>
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCloudBackup}
          disabled={backingUp}
          className="w-full"
          data-testid="button-cloud-backup"
        >
          {backingUp ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CloudUpload className="w-3 h-3 mr-1" />}
          {backingUp ? "Backing up to Google Drive..." : "Backup to Google Drive"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImportFile}
          className="hidden"
          data-testid="input-import-file"
        />
      </div>
      {importResult && (
        <div className="rounded-lg border bg-muted/50 p-3 text-xs space-y-1">
          <div className="font-medium text-sm mb-1">Import Results</div>
          {Object.entries(importResult).map(([key, count]) => (
            <div key={key} className="flex justify-between">
              <span className="capitalize">{key}</span>
              <span className="font-mono">{count as number}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground/60">
        Export includes conversations, messages, personas, memories, knowledge, heartbeat tasks, and skills. API keys are redacted for security. Daily automated backups run at 3 AM UTC to Google Drive.
      </p>
    </>
  );
}

function MemoryBackupSection() {
  const { toast } = useToast();
  const [backingUp, setBackingUp] = useState(false);
  const [exporting, setExporting] = useState(false);

  const statsQuery = useQuery<any>({
    queryKey: ["/api/memory/export"],
    select: (data: any) => data?.stats,
  });
  const stats = statsQuery.data;

  const handleDriveBackup = async () => {
    setBackingUp(true);
    try {
      const resp = await apiRequest("POST", "/api/memory/backup-to-drive");
      const data = await resp.json();
      if (data.driveUrl) {
        toast({
          title: "Memory backup saved to Google Drive",
          description: `${data.stats?.totalMemories || 0} memories backed up. ${data.stats?.compactionArchives || 0} conversation archives included.`,
        });
      }
    } catch (err: any) {
      toast({ title: "Backup failed", description: err.message, variant: "destructive" });
    } finally {
      setBackingUp(false);
    }
  };

  const handleDownload = async () => {
    setExporting(true);
    try {
      const resp = await authFetch("/api/memory/export");
      const data = await resp.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `memory-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Memory export downloaded", description: `${data.stats?.totalMemories || 0} memories exported.` });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <div className="text-lg font-bold text-primary" data-testid="text-memory-active">{stats.active || 0}</div>
            <div className="text-[11px] text-muted-foreground">Active Memories</div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <div className="text-lg font-bold text-amber-500" data-testid="text-memory-archived">{stats.archived || 0}</div>
            <div className="text-[11px] text-muted-foreground">Archived</div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <div className="text-lg font-bold text-muted-foreground" data-testid="text-memory-superseded">{stats.superseded || 0}</div>
            <div className="text-[11px] text-muted-foreground">Superseded</div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <div className="text-lg font-bold text-blue-500" data-testid="text-memory-archives">{stats.compactionArchives || 0}</div>
            <div className="text-[11px] text-muted-foreground">Chat Archives</div>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={handleDriveBackup}
          disabled={backingUp}
          className="flex-1"
          data-testid="button-memory-drive-backup"
        >
          {backingUp ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CloudUpload className="w-3 h-3 mr-1" />}
          {backingUp ? "Saving to Google Drive..." : "Save to Google Drive"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDownload}
          disabled={exporting}
          className="flex-1"
          data-testid="button-memory-download"
        >
          {exporting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
          {exporting ? "Downloading..." : "Download Backup"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground/60">
        Your memories are always safe. Active, archived, and superseded memories are all included in backups.
        Chat conversation archives from context compaction are preserved too — nothing is ever permanently lost.
        Google Drive backups are stored in your dedicated folder. Download gives you a local JSON file you can keep anywhere.
      </p>
    </>
  );
}

function CryptoPaymentsCard() {
  const { toast } = useToast();

  const { data: cryptoStatus, isLoading: statusLoading } = useQuery<{
    configured: boolean;
    cdpConnected: boolean;
    commerceConnected: boolean;
    connected: boolean;
    walletAddress: string | null;
    message: string;
    errors?: string[];
  }>({
    queryKey: ["/api/coinbase/status"],
    refetchInterval: 30000,
  });

  const createWallet = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/coinbase/wallet/create", { name: "visionclaw-primary", network: "base" });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/coinbase/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coinbase/wallet/balance"] });
      toast({ title: "Wallet Ready", description: `Address: ${data.address?.substring(0, 10)}...${data.address?.substring(data.address.length - 6)}` });
    },
    onError: (err: any) => {
      toast({ title: "Wallet Error", description: err.message, variant: "destructive" });
    },
  });

  const { data: balanceData } = useQuery<{
    address: string;
    network: string;
    balances: { token: string; name: string; amount: string; network: string }[];
  }>({
    queryKey: ["/api/coinbase/wallet/balance"],
    enabled: !!cryptoStatus?.cdpConnected,
    refetchInterval: 60000,
  });

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    toast({ title: "Copied", description: "Wallet address copied to clipboard" });
  };

  const isConnected = cryptoStatus?.cdpConnected || cryptoStatus?.commerceConnected;

  return (
    <div className="p-3 rounded-lg border border-border/50 bg-muted/30 space-y-2 relative" data-testid="card-crypto-payments">
      <div className="absolute top-2 right-2">
        {statusLoading ? (
          <Badge className="bg-muted text-muted-foreground text-[9px] flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" /> Checking
          </Badge>
        ) : isConnected ? (
          <Badge className="bg-green-500/20 text-green-300 text-[9px] border-green-500/30 flex items-center gap-1">
            <Check className="w-2.5 h-2.5" /> Connected
          </Badge>
        ) : cryptoStatus?.configured ? (
          <Badge className="bg-yellow-500/20 text-yellow-300 text-[9px] border-yellow-500/30 flex items-center gap-1">
            <Activity className="w-2.5 h-2.5" /> Configured
          </Badge>
        ) : (
          <Badge className="bg-violet-500/20 text-violet-300 text-[9px] border-violet-500/30 flex items-center gap-1">
            <Coins className="w-2.5 h-2.5" /> Not Set Up
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Coins className="w-3.5 h-3.5 text-violet-400" /> Crypto Payments
        </h4>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {cryptoStatus?.cdpConnected
          ? "CDP Wallet active — receive BTC, ETH, USDC directly."
          : "Accept Bitcoin, Ethereum, USDC, and more via Coinbase."}
      </p>

      <div className="flex flex-wrap gap-1.5 pt-1">
        <Badge variant="outline" className="text-[9px] border-muted-foreground/20">BTC</Badge>
        <Badge variant="outline" className="text-[9px] border-muted-foreground/20">ETH</Badge>
        <Badge variant="outline" className="text-[9px] border-muted-foreground/20">USDC</Badge>
        <Badge variant="outline" className="text-[9px] border-muted-foreground/20">USDT</Badge>
        <Badge variant="outline" className="text-[9px] border-muted-foreground/20">+More</Badge>
      </div>

      {cryptoStatus?.cdpConnected && cryptoStatus.walletAddress && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-1.5">
            <Label className="text-[9px] text-muted-foreground">Wallet Address</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0"
              onClick={() => copyAddress(cryptoStatus.walletAddress!)}
              data-testid="button-copy-wallet"
            >
              <Copy className="w-2.5 h-2.5" />
            </Button>
          </div>
          <code className="text-[9px] bg-background/50 px-2 py-1 rounded block font-mono break-all" data-testid="text-wallet-address">
            {cryptoStatus.walletAddress}
          </code>

          {balanceData?.balances && balanceData.balances.length > 0 && (
            <div className="space-y-1">
              <Label className="text-[9px] text-muted-foreground">Balances ({balanceData.network})</Label>
              {balanceData.balances.map((b, i) => (
                <div key={i} className="flex justify-between text-[9px] px-2 py-0.5 bg-background/30 rounded">
                  <span className="font-medium">{b.token}</span>
                  <span className="text-muted-foreground">{b.amount}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {cryptoStatus?.cdpConnected && !cryptoStatus?.walletAddress && (
        <Button
          size="sm"
          className="text-[10px] h-7 w-full"
          onClick={() => createWallet.mutate()}
          disabled={createWallet.isPending}
          data-testid="button-create-wallet"
        >
          {createWallet.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Coins className="w-3 h-3 mr-1" />}
          Create Wallet
        </Button>
      )}

      {!cryptoStatus?.cdpConnected && cryptoStatus?.configured && (
        <p className="text-[9px] text-yellow-400/70 italic">
          CDP credentials configured but not connected — check API key permissions.
        </p>
      )}

      {!cryptoStatus?.configured && (
        <p className="text-[9px] text-violet-400/60 italic">
          Add COINBASE_COMMERCE_PROJECT_ID and COINBASE_COMMERCE_API_KEY to enable.
        </p>
      )}

      {cryptoStatus?.message && (
        <p className="text-[9px] text-muted-foreground/70 italic" data-testid="text-crypto-status">
          {cryptoStatus.message}
        </p>
      )}

      {!cryptoStatus?.commerceConnected && cryptoStatus?.cdpConnected && (
        <p className="text-[9px] text-violet-400/50 italic">
          Commerce checkout available when you add a Commerce API key from commerce.coinbase.com
        </p>
      )}
    </div>
  );
}

function PaymentSettings() {
  const { toast } = useToast();
  const [byokSecret, setBYOKSecret] = useState("");
  const [byokPublishable, setBYOKPublishable] = useState("");
  const [showBYOKSecret, setShowBYOKSecret] = useState(false);

  const { data: tenantInfo } = useQuery<{ plan: string; isAdmin: boolean }>({
    queryKey: ["/api/tenants/me"],
  });

  const { data: paymentConfig, isLoading } = useQuery<{
    paymentMode: string;
    setupFeePaid: boolean;
    connectEnabled: boolean;
    connectAccountId: string | null;
    hasBYOKKeys: boolean;
  }>({
    queryKey: ["/api/stripe/payment-config"],
  });

  const { data: connectStatus } = useQuery<{
    connectDetails?: {
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
      detailsSubmitted: boolean;
    } | null;
  }>({
    queryKey: ["/api/stripe-connect/status"],
    enabled: !!paymentConfig?.connectAccountId,
    refetchInterval: paymentConfig?.connectAccountId && !paymentConfig?.connectEnabled ? 5000 : false,
  });

  const createConnectAccount = useMutation({
    mutationFn: () => apiRequest("POST", "/api/stripe-connect/create-account"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/payment-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stripe-connect/status"] });
      toast({ description: "Stripe Connect account created. Starting onboarding..." });
      getOnboardingLink.mutate();
    },
    onError: (err: any) => toast({ description: err.message || "Failed to create Connect account", variant: "destructive" }),
  });

  const getOnboardingLink = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/stripe-connect/onboarding-link");
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.url) window.open(data.url, "_blank");
    },
    onError: (err: any) => toast({ description: err.message || "Failed to get onboarding link", variant: "destructive" }),
  });

  const completeOnboarding = useMutation({
    mutationFn: () => apiRequest("POST", "/api/stripe-connect/complete-onboarding"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/payment-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stripe-connect/status"] });
      toast({ description: "Stripe Connect onboarding verified!" });
    },
    onError: (err: any) => toast({ description: err.message || "Failed to verify onboarding", variant: "destructive" }),
  });

  const disconnectConnect = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/stripe-connect/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/payment-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stripe-connect/status"] });
      toast({ description: "Stripe Connect disconnected" });
    },
    onError: (err: any) => toast({ description: err.message || "Failed to disconnect", variant: "destructive" }),
  });

  const saveBYOK = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/stripe/byok", { secretKey: byokSecret, publishableKey: byokPublishable }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/payment-config"] });
      setBYOKSecret("");
      setBYOKPublishable("");
      toast({ description: "Stripe keys validated and saved!" });
    },
    onError: (err: any) => toast({ description: err.message || "Invalid Stripe keys", variant: "destructive" }),
  });

  const removeBYOK = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/stripe/byok"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/payment-config"] });
      toast({ description: "BYOK keys removed" });
    },
    onError: (err: any) => toast({ description: err.message || "Failed to remove keys", variant: "destructive" }),
  });

  const setupFeeCheckout = useMutation({
    mutationFn: async (setupType: string) => {
      const res = await apiRequest("POST", "/api/stripe/setup-fee-checkout", { setupType });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (err: any) => toast({ description: err.message || "Failed to create checkout", variant: "destructive" }),
  });

  const isTrial = tenantInfo?.plan === "trial";
  const isAdmin = tenantInfo?.isAdmin;

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Key className="w-4 h-4 text-primary" /> Payment Integration
        </CardTitle>
        <CardDescription className="text-xs">
          Configure how your customers pay you. Choose managed payments or bring your own Stripe keys.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isTrial && !isAdmin && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs">
            Upgrade to a paid plan to set up payment integration.
          </div>
        )}

        {!isTrial && (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <span>Current mode:</span>
              <Badge variant={paymentConfig?.paymentMode === "none" ? "secondary" : "default"} className="text-[10px]">
                {paymentConfig?.paymentMode === "managed" ? "Managed (Stripe Connect)" :
                 paymentConfig?.paymentMode === "byok" ? "BYOK (Your Own Keys)" : "Not Configured"}
              </Badge>
              {paymentConfig?.setupFeePaid && (
                <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-400">
                  <Check className="w-2.5 h-2.5 mr-1" /> Setup Fee Paid
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg border border-border/50 bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-blue-400" /> Managed (Stripe Connect)
                  </h4>
                  <Badge variant="outline" className="text-[9px]">$99 setup</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  We handle everything. Your customers pay through Stripe, money goes directly to your bank. 3% platform fee per transaction.
                </p>

                {paymentConfig?.connectAccountId ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px]">
                      {paymentConfig?.connectEnabled ? (
                        <Badge className="bg-green-500/20 text-green-400 text-[9px]">
                          <Check className="w-2.5 h-2.5 mr-0.5" /> Active
                        </Badge>
                      ) : (
                        <Badge className="bg-yellow-500/20 text-yellow-400 text-[9px]">
                          Onboarding Incomplete
                        </Badge>
                      )}
                    </div>
                    {!paymentConfig?.connectEnabled && (
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[10px] h-7"
                          onClick={() => getOnboardingLink.mutate()}
                          disabled={getOnboardingLink.isPending}
                          data-testid="button-continue-onboarding"
                        >
                          {getOnboardingLink.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3 mr-1" />}
                          Continue Setup
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[10px] h-7"
                          onClick={() => completeOnboarding.mutate()}
                          disabled={completeOnboarding.isPending}
                          data-testid="button-verify-onboarding"
                        >
                          {completeOnboarding.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                          Verify
                        </Button>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-[10px] h-6 text-red-400 hover:text-red-300 px-1"
                      onClick={() => disconnectConnect.mutate()}
                      disabled={disconnectConnect.isPending}
                      data-testid="button-disconnect-connect"
                    >
                      <Trash2 className="w-2.5 h-2.5 mr-1" /> Disconnect
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    className="text-[10px] h-7 w-full"
                    onClick={() => {
                      if (!paymentConfig?.setupFeePaid) {
                        setupFeeCheckout.mutate("managed");
                      } else {
                        createConnectAccount.mutate();
                      }
                    }}
                    disabled={createConnectAccount.isPending || setupFeeCheckout.isPending}
                    data-testid="button-setup-connect"
                  >
                    {(createConnectAccount.isPending || setupFeeCheckout.isPending) ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    ) : (
                      <Zap className="w-3 h-3 mr-1" />
                    )}
                    {paymentConfig?.setupFeePaid ? "Connect Stripe Account" : "Pay Setup Fee & Connect"}
                  </Button>
                )}
              </div>

              <div className="p-3 rounded-lg border border-border/50 bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-orange-400" /> BYOK (Bring Your Own Keys)
                  </h4>
                  <Badge variant="outline" className="text-[9px]">$29 setup</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Use your own Stripe API keys. Full control, no platform fees. We validate and configure everything for you.
                </p>

                {paymentConfig?.hasBYOKKeys ? (
                  <div className="space-y-2">
                    <Badge className="bg-green-500/20 text-green-400 text-[9px]">
                      <Check className="w-2.5 h-2.5 mr-0.5" /> Keys Configured
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-[10px] h-6 text-red-400 hover:text-red-300 px-1"
                      onClick={() => removeBYOK.mutate()}
                      disabled={removeBYOK.isPending}
                      data-testid="button-remove-byok"
                    >
                      <Trash2 className="w-2.5 h-2.5 mr-1" /> Remove Keys
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(!paymentConfig?.setupFeePaid) ? (
                      <Button
                        size="sm"
                        className="text-[10px] h-7 w-full"
                        onClick={() => setupFeeCheckout.mutate("byok")}
                        disabled={setupFeeCheckout.isPending}
                        data-testid="button-pay-byok-fee"
                      >
                        {setupFeeCheckout.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Key className="w-3 h-3 mr-1" />}
                        Pay Setup Fee & Configure
                      </Button>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <div className="relative">
                            <Input
                              type={showBYOKSecret ? "text" : "password"}
                              placeholder="sk_live_..."
                              value={byokSecret}
                              onChange={(e) => setBYOKSecret(e.target.value)}
                              className="text-[10px] h-7 pr-8 font-mono"
                              data-testid="input-byok-secret"
                            />
                            <button
                              type="button"
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              onClick={() => setShowBYOKSecret(!showBYOKSecret)}
                            >
                              {showBYOKSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                          </div>
                          <Input
                            type="text"
                            placeholder="pk_live_..."
                            value={byokPublishable}
                            onChange={(e) => setBYOKPublishable(e.target.value)}
                            className="text-[10px] h-7 font-mono"
                            data-testid="input-byok-publishable"
                          />
                        </div>
                        <Button
                          size="sm"
                          className="text-[10px] h-7 w-full"
                          onClick={() => saveBYOK.mutate()}
                          disabled={saveBYOK.isPending || !byokSecret || !byokPublishable}
                          data-testid="button-save-byok"
                        >
                          {saveBYOK.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                          Validate & Save Keys
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <CryptoPaymentsCard />
            </div>

            <p className="text-[10px] text-muted-foreground/60">
              Managed: Stripe Connect routes payments to your bank with a 3% platform fee. BYOK: Payments go directly through your Stripe account with no platform fees. Crypto: Receive cryptocurrency via Coinbase CDP wallet or Commerce checkout. Setup fees are one-time.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface TenantRow {
  id: number;
  name: string;
  email: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  email_verified: boolean;
  trial_conversations_used: number;
  trial_max_conversations: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  account_status: string | null;
  deletion_scheduled_at: string | null;
  vanity_slug: string | null;
}

function TenantManageRow({ tenant, planColors }: { tenant: TenantRow; planColors: Record<string, string> }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const isUnlimited = tenant.trial_max_conversations >= 999999;

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PATCH", `/api/admin/tenants/${tenant.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] });
      toast({ title: "Tenant updated" });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/tenants/${tenant.id}/reset-usage`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] });
      toast({ title: "Usage reset" });
    },
  });

  return (
    <>
      <tr
        className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
        data-testid={`tenant-row-${tenant.id}`}
        onClick={() => setExpanded(!expanded)}
      >
        <td className="p-3 text-xs font-mono text-muted-foreground">{tenant.id}</td>
        <td className="p-3 font-medium">{tenant.name}</td>
        <td className="p-3 text-muted-foreground text-xs">{tenant.email}</td>
        <td className="p-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${planColors[tenant.plan] || "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"}`}>
            {tenant.plan}
          </span>
        </td>
        <td className="p-3">
          {tenant.is_active ? (
            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <Check className="w-3 h-3" /> Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-red-500">
              <X className="w-3 h-3" /> Inactive
            </span>
          )}
        </td>
        <td className="p-3">
          {tenant.email_verified ? (
            <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
          ) : (
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </td>
        <td className="p-3 text-xs text-muted-foreground">
          {isUnlimited ? (
            <span className="text-green-600 dark:text-green-400 font-medium">Unlimited</span>
          ) : (
            `${tenant.trial_conversations_used} / ${tenant.trial_max_conversations}`
          )}
        </td>
        <td className="p-3 text-xs text-muted-foreground">
          {new Date(tenant.created_at).toLocaleDateString()}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b bg-muted/20" data-testid={`tenant-controls-${tenant.id}`}>
          <td colSpan={8} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Plan</Label>
                <Select
                  defaultValue={tenant.plan}
                  onValueChange={(plan) => updateMutation.mutate({ plan })}
                  data-testid={`select-plan-${tenant.id}`}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid={`trigger-plan-${tenant.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="pro">Pro</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                    <SelectItem value="admin">Admin (Unlimited)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium">Unlimited Access</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={isUnlimited}
                    onCheckedChange={(checked) => updateMutation.mutate({ unlimited: checked })}
                    data-testid={`switch-unlimited-${tenant.id}`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {isUnlimited ? "On — no session limits" : "Off — limited sessions"}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium">Account Status</Label>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={tenant.is_active}
                    onCheckedChange={(checked) => updateMutation.mutate({ isActive: checked })}
                    data-testid={`switch-active-${tenant.id}`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {tenant.is_active ? "Active" : "Disabled"}
                  </span>
                </div>
              </div>

              {!isUnlimited && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Max Conversations</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={10000}
                      defaultValue={tenant.trial_max_conversations}
                      className="h-8 text-xs w-24"
                      data-testid={`input-max-convs-${tenant.id}`}
                      onBlur={(e) => {
                        const val = parseInt(e.target.value);
                        if (val > 0 && val !== tenant.trial_max_conversations) {
                          updateMutation.mutate({ trialMaxConversations: val });
                        }
                      }}
                    />
                    <span className="text-xs text-muted-foreground">used: {tenant.trial_conversations_used}</span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs font-medium">Actions</Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => resetMutation.mutate()}
                    disabled={resetMutation.isPending}
                    data-testid={`btn-reset-usage-${tenant.id}`}
                  >
                    {resetMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                    Reset Usage
                  </Button>
                </div>
              </div>
            </div>

            {(updateMutation.isPending || resetMutation.isPending) && (
              <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" /> Saving...
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function TenantsSection() {
  const tenantsQuery = useQuery<TenantRow[]>({
    queryKey: ["/api/admin/tenants"],
  });

  if (tenantsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading tenants...</span>
        </CardContent>
      </Card>
    );
  }

  if (tenantsQuery.error) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-sm text-destructive" data-testid="tenants-error">Failed to load tenants. Admin access required.</p>
        </CardContent>
      </Card>
    );
  }

  const tenants = tenantsQuery.data || [];

  const planColors: Record<string, string> = {
    enterprise: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    "enterprise-byok": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    admin: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    pro: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    "pro-byok": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    starter: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    "starter-byok": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    trial: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> User Management
        </CardTitle>
        <CardDescription className="text-xs">
          {tenants.length} registered user{tenants.length !== 1 ? "s" : ""}. Click a row to manage plan, limits, and access.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm" data-testid="tenants-table">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium text-xs text-muted-foreground">ID</th>
                <th className="text-left p-3 font-medium text-xs text-muted-foreground">Name</th>
                <th className="text-left p-3 font-medium text-xs text-muted-foreground">Email</th>
                <th className="text-left p-3 font-medium text-xs text-muted-foreground">Plan</th>
                <th className="text-left p-3 font-medium text-xs text-muted-foreground">Status</th>
                <th className="text-left p-3 font-medium text-xs text-muted-foreground">Verified</th>
                <th className="text-left p-3 font-medium text-xs text-muted-foreground">Sessions</th>
                <th className="text-left p-3 font-medium text-xs text-muted-foreground">Joined</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <TenantManageRow key={t.id} tenant={t} planColors={planColors} />
              ))}
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-sm text-muted-foreground">No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function getInitialSettingsTab() {
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  const validTabs = ["general", "payments", "integrations", "voice", "tools", "security", "data", "tenants"];
  return validTabs.includes(hash) ? hash : "general";
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [discordToken, setDiscordToken] = useState("");
  const [showDiscordToken, setShowDiscordToken] = useState(false);
  const [accessPin, setAccessPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [activeTab, setActiveTab] = useState(getInitialSettingsTab);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      const validTabs = ["general", "payments", "integrations", "voice", "tools", "security", "data", "tenants"];
      if (validTabs.includes(hash)) setActiveTab(hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const settingsQuery = useQuery<AgentSettings & { discordBotToken?: string | null; accessPin?: string | null }>({
    queryKey: ["/api/settings"],
  });
  const { data: settings, isLoading } = settingsQuery;

  const { data: discordStatus } = useQuery<{ connected: boolean; username?: string; guilds?: number }>({
    queryKey: ["/api/discord/status"],
    refetchInterval: 10000,
  });

  const { data: modelsData } = useQuery<{ models: ModelInfo[]; providers: Record<string, ProviderConfig> }>({
    queryKey: ["/api/models"],
  });

  const { data: providerKeysRaw } = useQuery<ProviderKeyInfo[]>({
    queryKey: ["/api/provider-keys"],
  });

  const providerKeys = providerKeysRaw || [];
  const models = modelsData?.models || [];
  const providers = modelsData?.providers || {};

  const discordMutation = useMutation({
    mutationFn: (token: string) => apiRequest("PUT", "/api/settings", { discordBotToken: token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/discord/status"] });
      setDiscordToken("");
      toast({ description: discordToken ? "Discord bot token saved" : "Discord bot disconnected" });
    },
    onError: () => toast({ description: "Failed to update Discord settings", variant: "destructive" }),
  });

  const pinMutation = useMutation({
    mutationFn: (pin: string) => apiRequest("PUT", "/api/settings", { accessPin: pin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setAccessPin("");
      toast({ description: accessPin ? "Access PIN configured" : "Access PIN removed" });
    },
    onError: () => toast({ description: "Failed to update PIN", variant: "destructive" }),
  });

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      agentName: "VisionClaw",
      personality: "You are VisionClaw, a helpful personal AI assistant. You are knowledgeable, concise, and friendly.",
      defaultModel: "gpt-5-mini",
      thinkingEnabled: false,
    },
    values: settings ? {
      agentName: settings.agentName,
      personality: settings.personality,
      defaultModel: settings.defaultModel,
      thinkingEnabled: settings.thinkingEnabled,
    } : undefined,
  });

  const saveMutation = useMutation({
    mutationFn: (data: z.infer<typeof settingsSchema>) => apiRequest("PUT", "/api/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ description: "Settings saved" });
    },
    onError: () => toast({ description: "Failed to save settings", variant: "destructive" }),
  });

  if (isLoading) return (
    <div className="h-full flex items-center justify-center text-muted-foreground">
      Loading settings...
    </div>
  );

  if (settingsQuery.isError) return <ErrorState title="Settings Error" message="Failed to load settings. Please try again." onRetry={() => settingsQuery.refetch()} />;

  const externalProviders = Object.entries(providers).filter(([id]) => id !== "replit");

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    window.history.replaceState(null, "", `#${value}`);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
            <Settings className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold" data-testid="text-settings-title">Settings</h1>
            <p className="text-sm text-muted-foreground">Configure your AI assistant</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="w-full flex flex-wrap h-auto gap-1 p-1" data-testid="settings-tabs">
            <TabsTrigger value="general" className="flex items-center gap-1.5 text-xs" data-testid="tab-general">
              <Bot className="w-3.5 h-3.5" /> General
            </TabsTrigger>
            <TabsTrigger value="payments" className="flex items-center gap-1.5 text-xs" data-testid="tab-payments">
              <CreditCard className="w-3.5 h-3.5" /> Payments
            </TabsTrigger>
            <TabsTrigger value="integrations" className="flex items-center gap-1.5 text-xs" data-testid="tab-integrations">
              <Globe className="w-3.5 h-3.5" /> Integrations
            </TabsTrigger>
            <TabsTrigger value="voice" className="flex items-center gap-1.5 text-xs" data-testid="tab-voice">
              <Mic className="w-3.5 h-3.5" /> Voice
            </TabsTrigger>
            <TabsTrigger value="tools" className="flex items-center gap-1.5 text-xs" data-testid="tab-tools">
              <Wrench className="w-3.5 h-3.5" /> Tools
            </TabsTrigger>
            <TabsTrigger value="security" className="flex items-center gap-1.5 text-xs" data-testid="tab-security">
              <Shield className="w-3.5 h-3.5" /> Security
            </TabsTrigger>
            <TabsTrigger value="data" className="flex items-center gap-1.5 text-xs" data-testid="tab-data">
              <Database className="w-3.5 h-3.5" /> Data
            </TabsTrigger>
            <TabsTrigger value="tenants" className="flex items-center gap-1.5 text-xs" data-testid="tab-tenants">
              <Users className="w-3.5 h-3.5" /> Tenants
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4">
            <DemoModeSettings />
            <FelixDiagnosticCard />
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => saveMutation.mutate(d))} className="space-y-4">

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Bot className="w-4 h-4 text-primary" /> Agent Identity
                    </CardTitle>
                    <CardDescription className="text-xs">Customize how your assistant presents itself</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="agentName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Agent Name</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="VisionClaw"
                              data-testid="input-agent-name"
                              className="text-sm"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="personality"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">System Prompt / Personality</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              rows={5}
                              placeholder="You are a helpful assistant..."
                              data-testid="input-personality"
                              className="text-sm font-mono resize-y"
                            />
                          </FormControl>
                          <FormDescription className="text-xs">
                            This is sent to the AI as the system prompt for every conversation.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-primary" /> Model Configuration
                    </CardTitle>
                    <CardDescription className="text-xs">Choose the AI model for new conversations</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="defaultModel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Default Model</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger data-testid="select-default-model" className="text-sm">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {models.map((m) => (
                                <SelectItem key={m.id} value={m.id} className="text-sm">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{m.label}</span>
                                    <span className="text-xs text-muted-foreground">— {m.description}</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="thinkingEnabled"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <FormLabel className="text-sm flex items-center gap-2">
                                <Brain className="w-3.5 h-3.5 text-primary" /> Thinking Mode
                              </FormLabel>
                              <FormDescription className="text-xs">
                                Enable visible reasoning on new conversations
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                data-testid="switch-thinking-enabled"
                              />
                            </FormControl>
                          </div>
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                <Button
                  type="submit"
                  className="w-full"
                  data-testid="button-save-settings"
                  disabled={saveMutation.isPending}
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saveMutation.isPending ? "Saving..." : "Save Settings"}
                </Button>
              </form>
            </Form>

            <SubscriptionConnections />

            <BillingPortalCard />

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Key className="w-4 h-4 text-primary" /> API Keys
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Connect external AI providers to unlock more models and enhanced BYOK usage limits. Replit AI is always available.
                    </CardDescription>
                  </div>
                  <TestAllKeysButton />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {externalProviders.map(([id, config]) => (
                  <ProviderKeyForm
                    key={id}
                    providerId={id}
                    config={config}
                    existing={providerKeys.find((k) => k.provider === id)}
                  />
                ))}
                <div className="text-[11px] text-muted-foreground bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 mt-2" data-testid="text-byok-settings-disclosure">
                  <span className="font-medium text-amber-400">BYOK Disclosure:</span> Adding your own API keys unlocks enhanced usage limits on paid plans.
                  However, response quality, speed, and reliability will depend on your chosen AI provider and model tier.
                  VisionClaw provides the agent framework, orchestration, tools, and memory — but output quality is determined by the underlying LLM service you connect.
                  For the most optimized experience, our managed plans use curated model routing for every request.
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments" className="space-y-4 mt-4">
            <PaymentSettings />
          </TabsContent>

          <TabsContent value="integrations" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-primary" /> Discord Integration
                </CardTitle>
                <CardDescription className="text-xs">
                  Connect a Discord bot to chat with VisionClaw from any Discord server or DM.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${discordStatus?.connected ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                  <span className="text-xs text-muted-foreground">
                    {discordStatus?.connected
                      ? `Connected as ${discordStatus.username} — ${discordStatus.guilds} server(s)`
                      : "Not connected"}
                  </span>
                </div>
                {settings?.discordBotToken ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={settings.discordBotToken}
                      disabled
                      className="text-xs h-8 flex-1"
                      data-testid="input-discord-token-masked"
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8"
                      data-testid="button-disconnect-discord"
                      onClick={() => discordMutation.mutate("")}
                      disabled={discordMutation.isPending}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showDiscordToken ? "text" : "password"}
                        placeholder="Bot token from Discord Developer Portal"
                        value={discordToken}
                        onChange={(e) => setDiscordToken(e.target.value)}
                        className="text-xs h-8 pr-8"
                        data-testid="input-discord-token"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-8 w-8"
                        onClick={() => setShowDiscordToken(!showDiscordToken)}
                      >
                        {showDiscordToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      className="h-8"
                      data-testid="button-save-discord-token"
                      onClick={() => discordMutation.mutate(discordToken)}
                      disabled={!discordToken || discordMutation.isPending}
                    >
                      <Check className="w-3 h-3 mr-1" /> Connect
                    </Button>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground/60">
                  Create a bot at{" "}
                  <a href="https://discord.com/developers/applications" target="_blank" rel="noopener" className="underline">
                    discord.com/developers
                  </a>
                  . Enable Message Content Intent. Invite with bot + applications.commands scopes.
                </p>
              </CardContent>
            </Card>
            <PublicChatSettings />
            <WebhookSettings />
            <HooksSettings />
          </TabsContent>

          <TabsContent value="voice" className="space-y-4 mt-4">
            <VoiceWakeSettings />
            <TTSConfigSettings />
          </TabsContent>

          <TabsContent value="tools" className="space-y-4 mt-4">
            <BrowserToolSettings />
            <WebSearchSettings />
            <FirecrawlSettings />
            <ExecToolSettings />
            <LobsterSettings />
            <ToolLoopDetectionSettings />
          </TabsContent>

          <TabsContent value="security" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" /> Security
                </CardTitle>
                <CardDescription className="text-xs">
                  Protect your VisionClaw instance with a PIN code.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2 h-2 rounded-full ${settings?.accessPin ? "bg-green-500" : "bg-yellow-500"}`} />
                  <span className="text-xs text-muted-foreground">
                    {settings?.accessPin ? "PIN protection enabled" : "No PIN — all API routes are open"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showPin ? "text" : "password"}
                      placeholder={settings?.accessPin ? "Enter new PIN to change" : "Set a PIN (4+ characters)"}
                      value={accessPin}
                      onChange={(e) => setAccessPin(e.target.value)}
                      className="text-xs h-8 pr-8"
                      data-testid="input-access-pin"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-8 w-8"
                      onClick={() => setShowPin(!showPin)}
                    >
                      {showPin ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    className="h-8"
                    data-testid="button-set-pin"
                    onClick={() => pinMutation.mutate(accessPin)}
                    disabled={!accessPin || accessPin.length < 4 || pinMutation.isPending}
                  >
                    <Check className="w-3 h-3 mr-1" /> Set
                  </Button>
                  {settings?.accessPin && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8"
                      data-testid="button-remove-pin"
                      onClick={() => pinMutation.mutate("")}
                      disabled={pinMutation.isPending}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            <ApiKeysSection />
            <AuthHealthSettings />
          </TabsContent>

          <TabsContent value="data" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Brain className="w-4 h-4 text-primary" /> Memory Backup
                </CardTitle>
                <CardDescription className="text-xs">
                  Your memories, preferences, and conversation history are automatically preserved. Back them up to Google Drive or download a local copy anytime.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <MemoryBackupSection />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Download className="w-4 h-4 text-primary" /> Data Export / Import / Cloud Backup
                </CardTitle>
                <CardDescription className="text-xs">
                  Export data locally, import from a backup, or sync to Google Drive. Automated daily backups run at 3 AM UTC.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ExportImportSection />
              </CardContent>
            </Card>
            <DeleteAccountSection />
          </TabsContent>

          <TabsContent value="tenants" className="space-y-4 mt-4">
            <TenantsSection />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
