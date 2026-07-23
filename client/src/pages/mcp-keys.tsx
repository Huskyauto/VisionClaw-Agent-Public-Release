import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, Key, Trash2, AlertTriangle } from "lucide-react";

interface McpKey {
  id: number;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface CreatedKey {
  id: number;
  name: string;
  keyPrefix: string;
  plaintext: string;
  scopes: string[];
}

const ALL_SCOPES = [
  { id: "scheduler:write", label: "scheduler:write", desc: "Schedule + cancel cross-platform social posts (DESTRUCTIVE)" },
  { id: "scheduler:read", label: "scheduler:read", desc: "List and inspect scheduled posts" },
  { id: "catalog:read", label: "catalog:read", desc: "Browse personas, output skills, platform info" },
];

export default function McpKeysPage() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["catalog:read"]);
  const [created, setCreated] = useState<CreatedKey | null>(null);

  const { data, isLoading } = useQuery<{ ok: boolean; keys: McpKey[] }>({
    queryKey: ["/api/mcp-keys"],
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/mcp-keys", { name, scopes });
      return r.json();
    },
    onSuccess: (resp) => {
      if (resp?.ok) {
        setCreated(resp.key);
        setName("");
        setScopes(["catalog:read"]);
        queryClient.invalidateQueries({ queryKey: ["/api/mcp-keys"] });
        toast({ title: "API key created", description: "Copy it now — it will not be shown again." });
      } else {
        toast({ title: "Failed", description: resp?.error || "Could not create key", variant: "destructive" });
      }
    },
  });

  const revokeMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("DELETE", `/api/mcp-keys/${id}`);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mcp-keys"] });
      toast({ title: "Key revoked" });
    },
  });

  const keys = data?.keys || [];
  const activeKeys = keys.filter((k) => !k.revokedAt);
  const revokedKeys = keys.filter((k) => !!k.revokedAt);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3" data-testid="text-page-title">
          <Key className="h-7 w-7" /> MCP API Keys
        </h1>
        <p className="text-muted-foreground mt-2">
          Per-tenant API keys for external Model Context Protocol clients (Claude Desktop, Cursor, custom
          agents) to call VCA's curated 8-tool MCP surface. Endpoint:{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">POST /mcp</code>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create new key</CardTitle>
          <CardDescription>
            Plaintext is shown <strong>exactly once</strong> at creation. Save it somewhere safe before
            closing the dialog.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Label</Label>
            <Input
              id="name"
              data-testid="input-key-name"
              placeholder="e.g. Claude Desktop laptop"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label>Scopes (fail-closed — unchecked tools will be denied)</Label>
            <div className="space-y-2">
              {ALL_SCOPES.map((s) => (
                <label key={s.id} className="flex items-start gap-3 p-2 border rounded cursor-pointer hover:bg-accent">
                  <input
                    type="checkbox"
                    className="mt-1"
                    data-testid={`checkbox-scope-${s.id.replace(":", "-")}`}
                    checked={scopes.includes(s.id)}
                    onChange={(e) => {
                      setScopes((prev) =>
                        e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id),
                      );
                    }}
                  />
                  <div className="text-sm">
                    <div className="font-mono font-medium">{s.label}</div>
                    <div className="text-muted-foreground text-xs">{s.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <Button
            data-testid="button-create-key"
            onClick={() => createMut.mutate()}
            disabled={!name.trim() || scopes.length === 0 || createMut.isPending}
          >
            {createMut.isPending ? "Creating..." : "Create key"}
          </Button>
        </CardContent>
      </Card>

      {created && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Save this key now
            </CardTitle>
            <CardDescription>This is the only time the plaintext will be visible.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code
                className="flex-1 bg-background border rounded px-3 py-2 font-mono text-sm break-all"
                data-testid="text-created-key-plaintext"
              >
                {created.plaintext}
              </code>
              <Button
                variant="outline"
                size="icon"
                data-testid="button-copy-key"
                onClick={() => copy(created.plaintext)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setCreated(null)} data-testid="button-dismiss-key">
              I've saved it — dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Active keys ({activeKeys.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : activeKeys.length === 0 ? (
            <p className="text-muted-foreground" data-testid="text-no-keys">
              No active keys yet.
            </p>
          ) : (
            <div className="space-y-3">
              {activeKeys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between gap-4 p-3 border rounded"
                  data-testid={`row-key-${k.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium" data-testid={`text-key-name-${k.id}`}>
                      {k.name}
                    </div>
                    <div className="text-sm text-muted-foreground font-mono">
                      mcp_{k.keyPrefix}_•••••••••••
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex gap-3">
                      <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                      {k.lastUsedAt && <span>Last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    data-testid={`button-revoke-${k.id}`}
                    onClick={() => revokeMut.mutate(k.id)}
                    disabled={revokeMut.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {revokedKeys.length > 0 && (
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle>Revoked ({revokedKeys.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {revokedKeys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between p-2 text-sm"
                  data-testid={`row-revoked-${k.id}`}
                >
                  <span>{k.name}</span>
                  <Badge variant="outline">Revoked {new Date(k.revokedAt!).toLocaleDateString()}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tool surface</CardTitle>
          <CardDescription>
            External MCP clients authenticated with a valid key can call these 8 tools:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm font-mono">
            <li>schedule_cross_platform_post <Badge variant="destructive">destructive</Badge></li>
            <li>cancel_scheduled_post <Badge variant="secondary">sensitive</Badge></li>
            <li>list_scheduled_posts <Badge>safe</Badge></li>
            <li>get_scheduled_post <Badge>safe</Badge></li>
            <li>list_personas <Badge>safe</Badge></li>
            <li>lookup_output_skill <Badge>safe</Badge></li>
            <li>list_output_skills <Badge>safe</Badge></li>
            <li>get_platform_info <Badge>safe</Badge></li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
