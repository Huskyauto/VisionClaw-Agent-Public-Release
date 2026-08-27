import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Key, Plus, Copy, Trash2, ShieldAlert, Clock,
  CheckCircle2, XCircle, AlertTriangle, Eye, EyeOff
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, format } from "date-fns";

interface ApiKeyEntry {
  id: number;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  isRevoked: boolean;
  createdAt: string;
}

const AVAILABLE_SCOPES = [
  { value: "chat", label: "Chat — Send messages and create conversations" },
  { value: "read", label: "Read — Access data and analytics" },
  { value: "tools", label: "Tools — Execute platform tools" },
  { value: "admin", label: "Admin — Full administrative access" },
];

export default function ApiKeysPage() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["chat", "read"]);
  const [expiresIn, setExpiresIn] = useState("90");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const { data: keys = [], isLoading } = useQuery<ApiKeyEntry[]>({
    queryKey: ["/api/api-keys"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; scopes: string[]; expiresInDays: number | null }) => {
      const res = await apiRequest("POST", "/api/api-keys", data);
      return res.json();
    },
    onSuccess: (data) => {
      setNewKey(data.key);
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API key created" });
    },
    onError: (err: any) => toast({ title: "Failed to create key", description: err.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/api-keys/${id}/revoke`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API key revoked" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "API key deleted" });
    },
  });

  const handleCreate = () => {
    const expDays = expiresIn === "never" ? null : parseInt(expiresIn);
    createMutation.mutate({ name, scopes, expiresInDays: expDays });
  };

  const handleCloseCreate = () => {
    setCreateOpen(false);
    setNewKey(null);
    setShowKey(false);
    setName("");
    setScopes(["chat", "read"]);
    setExpiresIn("90");
  };

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      toast({ title: "API key copied to clipboard" });
    }
  };

  const activeKeys = keys.filter(k => !k.isRevoked);
  const revokedKeys = keys.filter(k => k.isRevoked);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-apikeys-title">
            <Key className="w-6 h-6 text-primary" />
            API Keys
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage programmatic access to the VisionClaw platform
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={(open) => { if (!open) handleCloseCreate(); else setCreateOpen(true); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-key">
              <Plus className="w-4 h-4 mr-2" /> Create API Key
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{newKey ? "API Key Created" : "Create New API Key"}</DialogTitle>
            </DialogHeader>
            {newKey ? (
              <div className="space-y-4 py-4">
                <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm font-medium">Copy this key now — it won't be shown again</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-background p-2 rounded font-mono break-all border" data-testid="text-new-key">
                      {showKey ? newKey : newKey.slice(0, 10) + "•".repeat(40)}
                    </code>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowKey(!showKey)}>
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={copyKey} data-testid="button-copy-key">
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleCloseCreate} data-testid="button-done-key">Done</Button>
                </DialogFooter>
              </div>
            ) : (
              <>
                <div className="space-y-4 py-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Key Name</label>
                    <Input
                      placeholder="Production API Key"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      data-testid="input-key-name"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Scopes</label>
                    <div className="space-y-2">
                      {AVAILABLE_SCOPES.map((scope) => (
                        <label key={scope.value} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={scopes.includes(scope.value)}
                            onChange={(e) => {
                              if (e.target.checked) setScopes([...scopes, scope.value]);
                              else setScopes(scopes.filter(s => s !== scope.value));
                            }}
                            className="rounded"
                            data-testid={`checkbox-scope-${scope.value}`}
                          />
                          {scope.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Expiration</label>
                    <Select value={expiresIn} onValueChange={setExpiresIn}>
                      <SelectTrigger data-testid="select-expiration">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">30 days</SelectItem>
                        <SelectItem value="90">90 days</SelectItem>
                        <SelectItem value="365">1 year</SelectItem>
                        <SelectItem value="never">Never</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button
                    onClick={handleCreate}
                    disabled={!name || scopes.length === 0 || createMutation.isPending}
                    data-testid="button-generate-key"
                  >
                    {createMutation.isPending ? "Generating..." : "Generate Key"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Key className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-keys">{keys.length}</p>
                <p className="text-xs text-muted-foreground">Total Keys</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-active-keys">{activeKeys.length}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <XCircle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-revoked-keys">{revokedKeys.length}</p>
                <p className="text-xs text-muted-foreground">Revoked</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">API Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="w-10 h-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Key className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No API keys yet</p>
              <p className="text-sm">Create your first API key for programmatic access</p>
            </div>
          ) : (
            <div className="space-y-2">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className={`flex items-center gap-4 p-3 rounded-lg border bg-card transition-colors ${
                    key.isRevoked ? "opacity-60" : "hover:bg-accent/50"
                  }`}
                  data-testid={`row-key-${key.id}`}
                >
                  <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${
                    key.isRevoked ? "bg-red-500/10" : "bg-primary/10"
                  }`}>
                    <Key className={`w-5 h-5 ${key.isRevoked ? "text-red-500" : "text-primary"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{key.name}</span>
                      {key.isRevoked && <Badge variant="destructive" className="text-xs">Revoked</Badge>}
                      {key.expiresAt && new Date(key.expiresAt) < new Date() && !key.isRevoked && (
                        <Badge variant="destructive" className="text-xs">Expired</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <code className="text-xs text-muted-foreground font-mono">{key.keyPrefix}••••••••</code>
                      {key.scopes.map(s => (
                        <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                      ))}
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Created {formatDistanceToNow(new Date(key.createdAt), { addSuffix: true })}
                      </span>
                      {key.expiresAt && (
                        <span className="text-xs text-muted-foreground">
                          Expires {format(new Date(key.expiresAt), "MMM d, yyyy")}
                        </span>
                      )}
                      {key.lastUsedAt && (
                        <span className="text-xs text-muted-foreground">
                          Last used {formatDistanceToNow(new Date(key.lastUsedAt), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                  {!key.isRevoked && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-amber-500 hover:text-amber-600"
                        onClick={() => revokeMutation.mutate(key.id)}
                        data-testid={`button-revoke-key-${key.id}`}
                      >
                        <ShieldAlert className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(key.id)}
                        data-testid={`button-delete-key-${key.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}