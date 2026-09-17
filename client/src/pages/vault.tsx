import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  KeyRound, Plus, Globe, User, Lock, Trash2, Pencil, Eye, EyeOff, Shield, ExternalLink, Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface CredentialSafe {
  id: number;
  siteName: string;
  siteUrl: string;
  authType: string;
  username: string | null;
  hasPassword: boolean;
  oauthProvider: string | null;
  notes: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

function AddCredentialDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [authType, setAuthType] = useState("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [oauthProvider, setOauthProvider] = useState("");
  const [notes, setNotes] = useState("");
  const [showPass, setShowPass] = useState(false);

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/credentials", {
        siteName, siteUrl, authType, username: username || undefined,
        password: password || undefined, oauthProvider: oauthProvider || undefined,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      toast({ title: "Credential saved" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Site Name</Label>
          <Input placeholder="Google, Salesforce, etc." value={siteName} onChange={(e) => setSiteName(e.target.value)} data-testid="input-cred-site-name" />
        </div>
        <div className="space-y-1.5">
          <Label>Site URL</Label>
          <Input placeholder="https://accounts.google.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} data-testid="input-cred-site-url" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Auth Type</Label>
        <Select value={authType} onValueChange={setAuthType}>
          <SelectTrigger data-testid="select-auth-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="password">Username & Password</SelectItem>
            <SelectItem value="oauth">OAuth / SSO</SelectItem>
            <SelectItem value="api_key">API Key</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(authType === "password" || authType === "api_key") && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{authType === "api_key" ? "Key Name / Label" : "Username / Email"}</Label>
            <Input
              placeholder={authType === "api_key" ? "API key label" : "user@example.com"}
              value={username} onChange={(e) => setUsername(e.target.value)}
              data-testid="input-cred-username"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{authType === "api_key" ? "API Key" : "Password"}</Label>
            <div className="relative">
              <Input
                type={showPass ? "text" : "password"}
                placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
                data-testid="input-cred-password"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPass(!showPass)}
                data-testid="button-toggle-password"
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {authType === "oauth" && (
        <div className="space-y-1.5">
          <Label>OAuth Provider</Label>
          <Select value={oauthProvider} onValueChange={setOauthProvider}>
            <SelectTrigger data-testid="select-oauth-provider">
              <SelectValue placeholder="Select provider..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="google">Google</SelectItem>
              <SelectItem value="microsoft">Microsoft</SelectItem>
              <SelectItem value="github">GitHub</SelectItem>
              <SelectItem value="apple">Apple</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            OAuth logins require the AI to use the browser tool to navigate the provider's login flow.
            Store your email/password for the OAuth provider here if you want auto-fill support.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <div className="space-y-1.5">
              <Label>Email / Username</Label>
              <Input placeholder="user@example.com" value={username} onChange={(e) => setUsername(e.target.value)} data-testid="input-cred-oauth-username" />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <div className="relative">
                <Input
                  type={showPass ? "text" : "password"} placeholder="••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  data-testid="input-cred-oauth-password"
                />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPass(!showPass)}>
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Notes (optional)</Label>
        <Textarea
          placeholder="Login page quirks, 2FA notes, special instructions for the AI..."
          value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          data-testid="input-cred-notes"
        />
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!siteName || !siteUrl || createMutation.isPending}
          data-testid="button-save-credential"
        >
          {createMutation.isPending ? "Saving..." : "Save Credential"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function VaultPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: credentials = [], isLoading } = useQuery<CredentialSafe[]>({
    queryKey: ["/api/credentials"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/credentials/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      toast({ title: "Credential deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete", variant: "destructive" });
    },
  });

  const authTypeBadge = {
    password: { label: "Password", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    oauth: { label: "OAuth", color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
    api_key: { label: "API Key", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto p-4 sm:p-6 max-w-4xl space-y-6 pb-20" data-testid="vault-page">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2" data-testid="text-vault-title">
              <KeyRound className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              Credential Vault
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Store login credentials for websites your AI agent needs to access
            </p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-credential">
                <Plus className="w-4 h-4 mr-1" /> Add Credential
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Add Credential</DialogTitle>
              </DialogHeader>
              <AddCredentialDialog onClose={() => setDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div className="text-sm space-y-1">
                <p className="font-medium">How it works</p>
                <p className="text-muted-foreground text-xs">
                  Passwords are encrypted with AES-256-GCM before storage. When you ask the AI to log into a website,
                  it looks up the credentials here, navigates to the login page, and auto-fills the form.
                  Just say <span className="text-foreground font-medium">"log into [site name]"</span> in any chat.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-lg bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : credentials.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Lock className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No credentials stored yet</p>
              <p className="text-xs text-muted-foreground mt-1">Add your first site login to get started</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {credentials.map((cred) => {
              const badge = authTypeBadge[cred.authType as keyof typeof authTypeBadge] || authTypeBadge.password;
              return (
                <Card key={cred.id} data-testid={`card-credential-${cred.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <Globe className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm" data-testid={`text-cred-name-${cred.id}`}>{cred.siteName}</span>
                            <Badge variant="outline" className={`text-[10px] py-0 h-4 ${badge.color}`}>
                              {badge.label}
                            </Badge>
                          </div>
                          <a
                            href={cred.siteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 mt-0.5"
                            data-testid={`link-cred-url-${cred.id}`}
                          >
                            {cred.siteUrl.replace(/^https?:\/\//, "").slice(0, 40)}
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                            {cred.username && (
                              <span className="flex items-center gap-1">
                                <User className="w-3 h-3" /> {cred.username}
                              </span>
                            )}
                            {cred.hasPassword && (
                              <span className="flex items-center gap-1">
                                <Lock className="w-3 h-3" /> ••••••••
                              </span>
                            )}
                            {cred.oauthProvider && (
                              <span className="flex items-center gap-1">
                                <Shield className="w-3 h-3" /> {cred.oauthProvider}
                              </span>
                            )}
                          </div>
                          {cred.notes && (
                            <p className="text-[10px] text-muted-foreground/70 mt-1 line-clamp-1">{cred.notes}</p>
                          )}
                          {cred.lastUsedAt && (
                            <p className="text-[10px] text-muted-foreground/50 mt-0.5 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              Last used {formatDistanceToNow(new Date(cred.lastUsedAt), { addSuffix: true })}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-red-400 shrink-0"
                        onClick={() => {
                          if (confirm(`Delete credentials for ${cred.siteName}?`)) {
                            deleteMutation.mutate(cred.id);
                          }
                        }}
                        data-testid={`button-delete-credential-${cred.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
