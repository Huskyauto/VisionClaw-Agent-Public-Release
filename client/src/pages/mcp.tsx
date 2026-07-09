import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, RefreshCw, Loader2, Server, Wrench, Power, PowerOff, Plug } from "lucide-react";

interface McpServer {
  id: number;
  name: string;
  description: string;
  serverUrl: string;
  authType: string;
  authToken: string | null;
  enabled: boolean;
  toolCount: number;
  lastConnected: string | null;
  createdAt: string;
}

interface McpTool {
  serverId: number;
  serverName: string;
  name: string;
  description: string;
}

export default function McpPage() {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [authType, setAuthType] = useState("none");
  const [authToken, setAuthToken] = useState("");

  const { data: servers = [], isLoading } = useQuery<McpServer[]>({
    queryKey: ["/api/mcp/servers"],
    refetchInterval: 30000,
  });

  const { data: tools = [] } = useQuery<McpTool[]>({
    queryKey: ["/api/mcp/tools"],
    refetchInterval: 30000,
  });

  const addMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/mcp/servers", {
      name, description, serverUrl, authType, authToken: authToken || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mcp/servers"] });
      toast({ title: "MCP server added" });
      setShowAdd(false);
      setName(""); setDescription(""); setServerUrl(""); setAuthType("none"); setAuthToken("");
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/mcp/servers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mcp/servers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mcp/tools"] });
      toast({ title: "Server removed" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("POST", `/api/mcp/servers/${id}/toggle`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mcp/servers"] }),
  });

  const discoverMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/mcp/servers/${id}/discover`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mcp/servers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mcp/tools"] });
      toast({ title: "Tools discovered!" });
    },
    onError: (err: any) => toast({ title: "Discovery failed", description: err.message, variant: "destructive" }),
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/mcp/refresh"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mcp/servers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mcp/tools"] });
      toast({ title: `Refreshed — ${data.totalTools || 0} tools available` });
    },
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6" data-testid="mcp-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">MCP Servers</h1>
          <p className="text-muted-foreground">Connect to Model Context Protocol servers for extended tool access.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} data-testid="button-refresh">
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshMutation.isPending ? "animate-spin" : ""}`} /> Refresh All
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)} data-testid="button-add-server">
            <Plus className="mr-2 h-4 w-4" /> Add Server
          </Button>
        </div>
      </div>

      {showAdd && (
        <Card data-testid="card-add-server">
          <CardHeader><CardTitle>Add MCP Server</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input placeholder="e.g., GitHub MCP" value={name} onChange={e => setName(e.target.value)} data-testid="input-server-name" />
              </div>
              <div className="space-y-2">
                <Label>Server URL</Label>
                <Input placeholder="https://mcp-server.example.com" value={serverUrl} onChange={e => setServerUrl(e.target.value)} data-testid="input-server-url" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input placeholder="Optional description" value={description} onChange={e => setDescription(e.target.value)} data-testid="input-server-desc" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Auth Type</Label>
                <Select value={authType} onValueChange={setAuthType}>
                  <SelectTrigger data-testid="select-auth-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Auth</SelectItem>
                    <SelectItem value="bearer">Bearer Token</SelectItem>
                    <SelectItem value="api_key">API Key</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {authType !== "none" && (
                <div className="space-y-2">
                  <Label>{authType === "bearer" ? "Bearer Token" : "API Key"}</Label>
                  <Input type="password" value={authToken} onChange={e => setAuthToken(e.target.value)} data-testid="input-auth-token" />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => addMutation.mutate()} disabled={!name || !serverUrl || addMutation.isPending} data-testid="button-save-server">
                {addMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plug className="mr-2 h-4 w-4" />} Connect
              </Button>
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {servers.length === 0 && !showAdd ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No MCP servers connected yet. Add a server to discover available tools.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {servers.map(server => (
            <Card key={server.id} data-testid={`server-${server.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Server className="h-5 w-5 text-primary" />
                    <div>
                      <CardTitle className="text-lg">{server.name}</CardTitle>
                      {server.description && <CardDescription>{server.description}</CardDescription>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={server.enabled ? "default" : "secondary"}>
                      {server.enabled ? <><Power className="mr-1 h-3 w-3" />Active</> : <><PowerOff className="mr-1 h-3 w-3" />Disabled</>}
                    </Badge>
                    <Badge variant="outline"><Wrench className="mr-1 h-3 w-3" />{server.toolCount} tools</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    <span className="font-mono text-xs">{server.serverUrl}</span>
                    {server.lastConnected && <span className="ml-3">Last connected: {new Date(server.lastConnected).toLocaleDateString()}</span>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => discoverMutation.mutate(server.id)} disabled={discoverMutation.isPending} data-testid={`button-discover-${server.id}`}>
                      <RefreshCw className={`mr-1 h-3 w-3 ${discoverMutation.isPending ? "animate-spin" : ""}`} /> Discover
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => toggleMutation.mutate({ id: server.id, enabled: !server.enabled })} data-testid={`button-toggle-${server.id}`}>
                      {server.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(server.id)} data-testid={`button-delete-${server.id}`}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tools.length > 0 && (
        <Card data-testid="card-discovered-tools">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Discovered Tools
              <Badge variant="secondary">{tools.length}</Badge>
            </CardTitle>
            <CardDescription>Tools available to your AI agents via MCP</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {tools.map((tool, i) => (
                <div key={`${tool.serverId}-${tool.name}-${i}`} className="p-3 rounded-lg border bg-card" data-testid={`tool-${tool.name}`}>
                  <div className="font-medium text-sm">{tool.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">{tool.description || "No description"}</div>
                  <Badge variant="outline" className="mt-2 text-xs">{tool.serverName}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
