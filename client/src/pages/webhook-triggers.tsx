import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Loader2, Webhook, Copy, Power, PowerOff, Clock, CheckCircle, XCircle, ChevronDown, ChevronUp } from "lucide-react";

interface WebhookTrigger {
  id: number;
  name: string;
  description: string;
  webhookKey: string;
  personaId: number | null;
  personaName: string | null;
  enabled: boolean;
  lastTriggered: string | null;
  triggerCount: number;
  createdAt: string;
}

interface TriggerEvent {
  id: number;
  triggerId: number;
  payload: any;
  responsePreview: string;
  status: string;
  createdAt: string;
}

interface Persona {
  id: number;
  name: string;
}

export default function WebhookTriggersPage() {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [personaId, setPersonaId] = useState<string>("default");
  const [expandedTrigger, setExpandedTrigger] = useState<number | null>(null);

  const { data: triggers = [], isLoading } = useQuery<WebhookTrigger[]>({
    queryKey: ["/api/triggers"],
    refetchInterval: 15000,
  });

  const { data: personas = [] } = useQuery<Persona[]>({
    queryKey: ["/api/personas"],
  });

  const { data: events = [] } = useQuery<TriggerEvent[]>({
    queryKey: ["/api/triggers", expandedTrigger, "events"],
    enabled: expandedTrigger !== null,
    queryFn: async () => {
      const res = await authFetch(`/api/triggers/${expandedTrigger}/events`);
      if (!res.ok) throw new Error("Failed to fetch events");
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 10000,
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/triggers", {
      name, description, personaId: personaId === "default" ? null : parseInt(personaId),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/triggers"] });
      toast({ title: "Webhook trigger created" });
      setShowAdd(false);
      setName(""); setDescription(""); setPersonaId("default");
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/triggers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/triggers"] });
      toast({ title: "Trigger deleted" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("POST", `/api/triggers/${id}/toggle`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/triggers"] }),
  });

  const copyUrl = (key: string) => {
    const url = `${window.location.origin}/api/trigger/${key}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Webhook URL copied!" });
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6" data-testid="webhook-triggers-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Webhook Triggers</h1>
          <p className="text-muted-foreground">Create webhook endpoints that trigger AI agent actions when called.</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)} data-testid="button-add-trigger">
          <Plus className="mr-2 h-4 w-4" /> New Trigger
        </Button>
      </div>

      {showAdd && (
        <Card data-testid="card-add-trigger">
          <CardHeader><CardTitle>Create Webhook Trigger</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input placeholder="e.g., Sentry Error Alert" value={name} onChange={e => setName(e.target.value)} data-testid="input-trigger-name" />
              </div>
              <div className="space-y-2">
                <Label>Assigned Agent</Label>
                <Select value={personaId} onValueChange={setPersonaId}>
                  <SelectTrigger data-testid="select-persona"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default (Active Agent)</SelectItem>
                    {personas.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input placeholder="What triggers this webhook?" value={description} onChange={e => setDescription(e.target.value)} data-testid="input-trigger-desc" />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending} data-testid="button-create-trigger">
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Webhook className="mr-2 h-4 w-4" />} Create
              </Button>
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {triggers.length === 0 && !showAdd ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          <Webhook className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No webhook triggers yet. Create one to receive external events.</p>
          <p className="text-xs mt-2">Use cases: Sentry errors, GitHub PRs, Stripe events, custom automations</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {triggers.map(trigger => (
            <Card key={trigger.id} data-testid={`trigger-${trigger.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Webhook className="h-5 w-5 text-primary" />
                    <div>
                      <CardTitle className="text-lg">{trigger.name}</CardTitle>
                      {trigger.description && <CardDescription>{trigger.description}</CardDescription>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {trigger.personaName && <Badge variant="outline">{trigger.personaName}</Badge>}
                    <Badge variant={trigger.enabled ? "default" : "secondary"}>
                      {trigger.enabled ? <><Power className="mr-1 h-3 w-3" />Active</> : <><PowerOff className="mr-1 h-3 w-3" />Disabled</>}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 p-2 rounded bg-muted">
                  <code className="text-xs flex-1 font-mono truncate" data-testid={`text-webhook-url-${trigger.id}`}>
                    POST {window.location.origin}/api/trigger/{trigger.webhookKey}
                  </code>
                  <Button size="sm" variant="ghost" onClick={() => copyUrl(trigger.webhookKey)} data-testid={`button-copy-${trigger.id}`}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <div className="flex items-center gap-4">
                    <span><Clock className="inline h-3 w-3 mr-1" />{trigger.triggerCount} triggers</span>
                    {trigger.lastTriggered && <span>Last: {new Date(trigger.lastTriggered).toLocaleString()}</span>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setExpandedTrigger(expandedTrigger === trigger.id ? null : trigger.id)} data-testid={`button-events-${trigger.id}`}>
                      {expandedTrigger === trigger.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} Events
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => toggleMutation.mutate({ id: trigger.id, enabled: !trigger.enabled })}>
                      {trigger.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(trigger.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {expandedTrigger === trigger.id && (
                  <div className="mt-3 space-y-2">
                    {events.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">No events yet</p>
                    ) : events.map(event => (
                      <div key={event.id} className="p-2 rounded border text-xs" data-testid={`event-${event.id}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span>
                          <Badge variant={event.status === "success" ? "default" : "destructive"} className="text-xs">
                            {event.status === "success" ? <CheckCircle className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
                            {event.status}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground truncate">{event.responsePreview}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card data-testid="card-usage-guide">
        <CardHeader><CardTitle>How to Use Webhook Triggers</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Send a POST request with JSON body to your webhook URL. The AI agent will process the payload and respond accordingly.</p>
          <div className="p-3 rounded bg-muted font-mono text-xs">
            <div>curl -X POST \</div>
            <div className="pl-4">-H "Content-Type: application/json" \</div>
            <div className="pl-4">-d '{`{"event":"error","message":"Database connection timeout","severity":"high"}`}' \</div>
            <div className="pl-4">{window.location.origin}/api/trigger/YOUR_KEY</div>
          </div>
          <p><strong>Use cases:</strong> Sentry/error monitoring, GitHub PR reviews, Stripe payment events, CI/CD notifications, scheduled cron triggers, IoT sensor data, form submissions.</p>
        </CardContent>
      </Card>
    </div>
  );
}
