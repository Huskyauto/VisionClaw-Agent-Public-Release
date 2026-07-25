import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Route, MessageSquare, Trash2, Save } from "lucide-react";
import { SiTelegram, SiDiscord, SiWhatsapp } from "react-icons/si";

interface ChannelRoute {
  id: number;
  channel: string;
  personaId: number;
  personaName: string;
  enabled: boolean;
  createdAt: string;
}

interface Persona {
  id: number;
  name: string;
}

const CHANNELS = [
  { id: "web", name: "Web Chat", icon: MessageSquare, color: "text-blue-500" },
  { id: "telegram", name: "Telegram", icon: SiTelegram, color: "text-[#0088cc]" },
  { id: "discord", name: "Discord", icon: SiDiscord, color: "text-[#5865F2]" },
  { id: "whatsapp", name: "WhatsApp", icon: SiWhatsapp, color: "text-[#25D366]" },
  { id: "webhook", name: "Webhooks", icon: Route, color: "text-orange-500" },
  { id: "email", name: "Email", icon: MessageSquare, color: "text-purple-500" },
];

export default function ChannelRoutingPage() {
  const { toast } = useToast();
  const [selections, setSelections] = useState<Record<string, string>>({});

  const { data: routes = [], isLoading } = useQuery<ChannelRoute[]>({
    queryKey: ["/api/channel-routes"],
  });

  const { data: personas = [] } = useQuery<Persona[]>({
    queryKey: ["/api/personas"],
  });

  const saveMutation = useMutation({
    mutationFn: ({ channel, personaId }: { channel: string; personaId: number | null }) =>
      apiRequest("POST", "/api/channel-routes", { channel, personaId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channel-routes"] });
      toast({ title: "Channel routing updated" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (channel: string) => apiRequest("DELETE", `/api/channel-routes/${channel}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channel-routes"] });
      toast({ title: "Route removed — will use default agent" });
    },
  });

  const getRouteForChannel = (channel: string) => routes.find(r => r.channel === channel);

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6" data-testid="channel-routing-page">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Channel Routing</h1>
        <p className="text-muted-foreground">Assign specific AI agents to handle different communication channels.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
          <CardDescription>
            By default, all channels use the active agent. Set a channel route to automatically assign a specific agent
            to handle all messages from that channel — e.g., Felix handles Telegram, Teagan handles Discord.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4">
        {CHANNELS.map(channel => {
          const existing = getRouteForChannel(channel.id);
          const Icon = channel.icon;
          const selectedValue = selections[channel.id] ?? (existing ? String(existing.personaId) : "default");

          return (
            <Card key={channel.id} data-testid={`channel-${channel.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon className={`h-6 w-6 ${channel.color}`} />
                    <div>
                      <div className="font-medium">{channel.name}</div>
                      {existing ? (
                        <div className="text-xs text-muted-foreground">
                          Assigned to <Badge variant="outline" className="ml-1">{existing.personaName}</Badge>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">Using default (active agent)</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedValue}
                      onValueChange={val => setSelections(prev => ({ ...prev, [channel.id]: val }))}
                    >
                      <SelectTrigger className="w-48" data-testid={`select-agent-${channel.id}`}>
                        <SelectValue placeholder="Default Agent" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Default (Active Agent)</SelectItem>
                        {personas.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => {
                        const val = selections[channel.id] ?? (existing ? String(existing.personaId) : "default");
                        if (val === "default") {
                          if (existing) removeMutation.mutate(channel.id);
                        } else {
                          saveMutation.mutate({ channel: channel.id, personaId: parseInt(val) });
                        }
                      }}
                      disabled={saveMutation.isPending}
                      data-testid={`button-save-${channel.id}`}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                    {existing && (
                      <Button size="sm" variant="ghost" onClick={() => removeMutation.mutate(channel.id)} data-testid={`button-remove-${channel.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card data-testid="card-routing-info">
        <CardHeader>
          <CardTitle>Routing Examples</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p><strong>Felix (CEO)</strong> on Telegram — Strategic decisions and executive queries via mobile</p>
          <p><strong>Teagan (Marketing)</strong> on Discord — Community engagement and content creation</p>
          <p><strong>Radar (Intelligence)</strong> on Webhooks — Automated intelligence from external events</p>
          <p><strong>Forge (Engineer)</strong> on Web Chat — Technical conversations and code assistance</p>
        </CardContent>
      </Card>
    </div>
  );
}
