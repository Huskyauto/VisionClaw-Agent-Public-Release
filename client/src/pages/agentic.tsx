import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Inbox, MessageSquare, Radio, ChevronDown, ChevronUp, Clock, AlertTriangle, CheckCircle2, XCircle, Zap, Hash, Users, Target, ListTodo, Eye, Shield, Play, BookOpen, ExternalLink, Calendar, FileText } from "lucide-react";
import { queryClient, authFetch } from "@/lib/queryClient";

interface DeskData {
  personaId: number;
  personaName: string;
  focusArea: string;
  statusNote: string;
  activeTasks: any[];
  queue: any[];
  waitingOn: any[];
  completedToday: number;
  lastActive: string | null;
}

interface ChannelData {
  id: number;
  name: string;
  description: string;
  category: string;
  subscriberCount?: number;
}

interface ChannelMessage {
  id: number;
  channel_name: string;
  from_persona_name: string | null;
  content: string;
  message_type: string;
  created_at: string;
  metadata: any;
}

interface EventLogEntry {
  id: number;
  event_type: string;
  source: string;
  status: string;
  data: any;
  created_at: string;
  processed_at: string | null;
  processing_result: any;
  error: string | null;
}

interface EventSubscription {
  id: number;
  event_type: string;
  persona_name: string;
  action: string;
  priority: number;
  enabled: boolean;
}

interface EventStats {
  total: number;
  pending: number;
  processed: number;
  routed: number;
  failed: number;
  noSubscribers: number;
  topEventTypes: { event_type: string; count: number }[];
}

function DesksTab() {
  const [expandedDesk, setExpandedDesk] = useState<number | null>(null);
  const desksQuery = useQuery<DeskData[]>({
    queryKey: ["/api/desks/overview"],
  });

  if (desksQuery.isLoading) {
    return <LoadingState message="Loading agent desks..." />;
  }

  const desks = desksQuery.data || [];
  const activeDesks = desks.filter(d => d.activeTasks.length > 0 || d.focusArea || d.queue.length > 0);
  const idleDesks = desks.filter(d => d.activeTasks.length === 0 && !d.focusArea && d.queue.length === 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<Users className="w-4 h-4" />} label="Total Desks" value={desks.length} />
        <StatCard icon={<Target className="w-4 h-4" />} label="Active" value={activeDesks.length} color="text-green-500" />
        <StatCard icon={<ListTodo className="w-4 h-4" />} label="Open Tasks" value={desks.reduce((s, d) => s + d.activeTasks.length, 0)} color="text-blue-500" />
        <StatCard icon={<Clock className="w-4 h-4" />} label="Queued Items" value={desks.reduce((s, d) => s + d.queue.length, 0)} color="text-yellow-500" />
      </div>

      {desks.length === 0 && <EmptyState message="No agent desks initialized yet. Desks are created when agents start using the manage_desk tool." />}

      {activeDesks.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Active Desks</h3>
          {activeDesks.map(desk => (
            <DeskCard key={desk.personaId} desk={desk} expanded={expandedDesk === desk.personaId} onToggle={() => setExpandedDesk(expandedDesk === desk.personaId ? null : desk.personaId)} />
          ))}
        </div>
      )}

      {idleDesks.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Idle Desks ({idleDesks.length})</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {idleDesks.map(desk => (
              <div key={desk.personaId} className="rounded-lg border p-3 bg-muted/20">
                <p className="text-sm font-medium">{desk.personaName}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {desk.completedToday > 0 ? `${desk.completedToday} completed today` : "No activity"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DeskCard({ desk, expanded, onToggle }: { desk: DeskData; expanded: boolean; onToggle: () => void }) {
  const taskStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
      case "blocked": return <XCircle className="w-3.5 h-3.5 text-red-500" />;
      case "in_progress": return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
      default: return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  };

  const priorityColor = (p: string) => {
    switch (p) {
      case "critical": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
      case "high": return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
      case "medium": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
      default: return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors" onClick={onToggle} data-testid={`desk-card-${desk.personaId}`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary">{desk.personaName.charAt(0)}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{desk.personaName}</p>
            {desk.focusArea && <p className="text-xs text-muted-foreground truncate">{desk.focusArea}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {desk.activeTasks.length > 0 && (
            <Badge variant="secondary" className="text-xs">{desk.activeTasks.length} task{desk.activeTasks.length !== 1 ? "s" : ""}</Badge>
          )}
          {desk.waitingOn.length > 0 && (
            <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-300">Waiting</Badge>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3 bg-muted/10">
          {desk.statusNote && (
            <p className="text-xs text-muted-foreground italic">{desk.statusNote}</p>
          )}

          {desk.activeTasks.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Active Tasks</p>
              <div className="space-y-1.5">
                {desk.activeTasks.map((task: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    {taskStatusIcon(task.status)}
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{task.title}</p>
                      {task.priority && (
                        <Badge className={`text-[10px] mt-0.5 ${priorityColor(task.priority)}`}>{task.priority}</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {desk.queue.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Queue ({desk.queue.length})</p>
              <div className="space-y-1">
                {desk.queue.slice(0, 5).map((item: any, i: number) => (
                  <p key={i} className="text-xs text-muted-foreground truncate">• {item.title}</p>
                ))}
                {desk.queue.length > 5 && <p className="text-xs text-muted-foreground">+{desk.queue.length - 5} more</p>}
              </div>
            </div>
          )}

          {desk.waitingOn.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Waiting On</p>
              {desk.waitingOn.map((w: any, i: number) => (
                <p key={i} className="text-xs text-yellow-600 dark:text-yellow-400">⏳ {w.description}</p>
              ))}
            </div>
          )}

          {desk.completedToday > 0 && (
            <p className="text-xs text-green-600 dark:text-green-400">✓ {desk.completedToday} task{desk.completedToday !== 1 ? "s" : ""} completed today</p>
          )}
        </div>
      )}
    </Card>
  );
}

function ChannelsTab() {
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const channelsQuery = useQuery<ChannelData[]>({
    queryKey: ["/api/channels"],
  });

  const messagesQuery = useQuery<ChannelMessage[]>({
    queryKey: ["/api/channels", selectedChannel, "messages"],
    queryFn: async () => {
      if (!selectedChannel) return [];
      const channel = (channelsQuery.data || []).find(c => c.name === selectedChannel);
      if (!channel) return [];
      const res = await authFetch(`/api/channels/${channel.id}/messages?limit=50`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedChannel && !!channelsQuery.data,
  });

  if (channelsQuery.isLoading) {
    return <LoadingState message="Loading channels..." />;
  }

  const channels = channelsQuery.data || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={<Hash className="w-4 h-4" />} label="Channels" value={channels.length} />
        <StatCard icon={<MessageSquare className="w-4 h-4" />} label="Selected" value={selectedChannel || "None"} />
        <StatCard icon={<Users className="w-4 h-4" />} label="Total Subscribers" value={channels.reduce((s, c) => s + (c.subscriberCount || 0), 0)} color="text-blue-500" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Channels</h3>
          {channels.map(ch => (
            <button
              key={ch.id}
              onClick={() => setSelectedChannel(ch.name)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedChannel === ch.name ? "bg-primary/10 text-primary border border-primary/20" : "hover:bg-muted/50 border border-transparent"}`}
              data-testid={`channel-btn-${ch.name}`}
            >
              <span className="font-medium">{ch.name}</span>
              {ch.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{ch.description}</p>}
            </button>
          ))}
        </div>

        <div className="md:col-span-2">
          {!selectedChannel ? (
            <EmptyState message="Select a channel to view messages." />
          ) : messagesQuery.isLoading ? (
            <LoadingState message="Loading messages..." />
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{selectedChannel}</CardTitle>
                <CardDescription className="text-xs">{(messagesQuery.data || []).length} messages</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {(messagesQuery.data || []).length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No messages in this channel yet.</p>
                  )}
                  {(messagesQuery.data || []).map((msg) => (
                    <div key={msg.id} className="rounded-lg border p-3 text-sm" data-testid={`channel-msg-${msg.id}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-xs">
                          {msg.from_persona_name || "System"}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {msg.message_type && msg.message_type !== "message" && (
                            <Badge variant="outline" className="text-[10px]">{msg.message_type}</Badge>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(msg.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{msg.content}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function EventsTab() {
  const [activeSubTab, setActiveSubTab] = useState<"log" | "subscriptions" | "stats">("log");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["log", "subscriptions", "stats"] as const).map(tab => (
          <Button
            key={tab}
            variant={activeSubTab === tab ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveSubTab(tab)}
            className="text-xs"
            data-testid={`events-subtab-${tab}`}
          >
            {tab === "log" ? "Event Log" : tab === "subscriptions" ? "Subscriptions" : "Stats"}
          </Button>
        ))}
      </div>

      {activeSubTab === "log" && <EventLogSection />}
      {activeSubTab === "subscriptions" && <EventSubscriptionsSection />}
      {activeSubTab === "stats" && <EventStatsSection />}
    </div>
  );
}

function EventLogSection() {
  const logQuery = useQuery<EventLogEntry[]>({
    queryKey: ["/api/events/log"],
  });

  if (logQuery.isLoading) return <LoadingState message="Loading event log..." />;

  const events = logQuery.data || [];

  const statusColor = (s: string) => {
    switch (s) {
      case "processed": case "routed": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
      case "pending": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
      case "failed": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
      case "no_subscribers": return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
      default: return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  return (
    <div className="space-y-3">
      {events.length === 0 && <EmptyState message="No events emitted yet. Events appear here when agents use the emit_event tool." />}

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm" data-testid="event-log-table">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-2.5 font-medium text-xs text-muted-foreground">ID</th>
              <th className="text-left p-2.5 font-medium text-xs text-muted-foreground">Event Type</th>
              <th className="text-left p-2.5 font-medium text-xs text-muted-foreground">Source</th>
              <th className="text-left p-2.5 font-medium text-xs text-muted-foreground">Status</th>
              <th className="text-left p-2.5 font-medium text-xs text-muted-foreground">Time</th>
            </tr>
          </thead>
          <tbody>
            {events.map(ev => (
              <tr key={ev.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors" data-testid={`event-row-${ev.id}`}>
                <td className="p-2.5 text-xs font-mono text-muted-foreground">{ev.id}</td>
                <td className="p-2.5">
                  <span className="text-xs font-medium">{ev.event_type}</span>
                </td>
                <td className="p-2.5 text-xs text-muted-foreground">{ev.source}</td>
                <td className="p-2.5">
                  <Badge className={`text-[10px] ${statusColor(ev.status)}`}>{ev.status}</Badge>
                </td>
                <td className="p-2.5 text-xs text-muted-foreground">{new Date(ev.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EventSubscriptionsSection() {
  const subsQuery = useQuery<EventSubscription[]>({
    queryKey: ["/api/events/subscriptions"],
  });

  if (subsQuery.isLoading) return <LoadingState message="Loading subscriptions..." />;

  const subs = subsQuery.data || [];
  const enabled = subs.filter(s => s.enabled);
  const disabled = subs.filter(s => !s.enabled);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={<Radio className="w-4 h-4" />} label="Total" value={subs.length} />
        <StatCard icon={<CheckCircle2 className="w-4 h-4" />} label="Active" value={enabled.length} color="text-green-500" />
        <StatCard icon={<XCircle className="w-4 h-4" />} label="Disabled" value={disabled.length} color="text-muted-foreground" />
      </div>

      {subs.length === 0 && <EmptyState message="No event subscriptions configured." />}

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full min-w-[500px] text-sm" data-testid="event-subs-table">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-2.5 font-medium text-xs text-muted-foreground">Event Type</th>
              <th className="text-left p-2.5 font-medium text-xs text-muted-foreground">Persona</th>
              <th className="text-left p-2.5 font-medium text-xs text-muted-foreground">Action</th>
              <th className="text-left p-2.5 font-medium text-xs text-muted-foreground">Priority</th>
              <th className="text-left p-2.5 font-medium text-xs text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {subs.map(sub => (
              <tr key={sub.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors" data-testid={`sub-row-${sub.id}`}>
                <td className="p-2.5 text-xs font-mono">{sub.event_type}</td>
                <td className="p-2.5 text-xs font-medium">{sub.persona_name}</td>
                <td className="p-2.5 text-xs text-muted-foreground">{sub.action}</td>
                <td className="p-2.5 text-xs text-muted-foreground">{sub.priority}</td>
                <td className="p-2.5">
                  {sub.enabled ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><CheckCircle2 className="w-3 h-3" /> Active</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><XCircle className="w-3 h-3" /> Disabled</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EventStatsSection() {
  const statsQuery = useQuery<EventStats>({
    queryKey: ["/api/events/stats"],
  });

  if (statsQuery.isLoading) return <LoadingState message="Loading stats..." />;

  const stats = statsQuery.data;
  if (!stats) return <EmptyState message="No event statistics available." />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <StatCard icon={<Zap className="w-4 h-4" />} label="Total Events" value={stats.total} />
        <StatCard icon={<Clock className="w-4 h-4" />} label="Pending" value={stats.pending} color="text-yellow-500" />
        <StatCard icon={<CheckCircle2 className="w-4 h-4" />} label="Processed" value={stats.processed} color="text-green-500" />
        <StatCard icon={<Radio className="w-4 h-4" />} label="Routed" value={stats.routed} color="text-blue-500" />
        <StatCard icon={<XCircle className="w-4 h-4" />} label="Failed" value={stats.failed} color="text-red-500" />
        <StatCard icon={<AlertTriangle className="w-4 h-4" />} label="No Subs" value={stats.noSubscribers} color="text-muted-foreground" />
      </div>

      {stats.topEventTypes && stats.topEventTypes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Event Types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.topEventTypes.map((t, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-xs font-mono">{t.event_type}</span>
                  <Badge variant="secondary" className="text-xs">{t.count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-lg border p-3 bg-card">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={color || "text-muted-foreground"}>{icon}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-lg font-semibold ${color || ""}`}>{value}</p>
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-8 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">{message}</span>
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-8 text-sm text-muted-foreground">{message}</div>
  );
}

function GovernorTab() {
  const { data: status, isLoading } = useQuery<{
    activeSubscriptions: number;
    disabledSubscriptions: number;
    protectedCount: number;
    lastRunAt: string | null;
    totalRules: number;
    rulesByCategory: Record<string, number>;
    recentActions: any[];
    checks: { eventType: string; hasActivity: boolean; description: string }[];
  }>({ queryKey: ["/api/governor/status"] });

  const { data: rules } = useQuery<any[]>({ queryKey: ["/api/governor/rules"] });

  const { data: frameworks } = useQuery<any[]>({ queryKey: ["/api/governor/frameworks"] });

  const [running, setRunning] = useState(false);
  const [lastReport, setLastReport] = useState<any>(null);
  const [showRules, setShowRules] = useState(false);
  const [showFrameworks, setShowFrameworks] = useState(false);
  const [expandedFramework, setExpandedFramework] = useState<number | null>(null);

  async function runEvaluation(dryRun: boolean) {
    setRunning(true);
    try {
      const res = await authFetch("/api/governor/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const report = await res.json();
      setLastReport(report);
      queryClient.invalidateQueries({ queryKey: ["/api/governor/status"] });
    } catch {}
    setRunning(false);
  }

  const categoryColors: Record<string, string> = {
    resource_management: "text-blue-500",
    cost_control: "text-orange-500",
    operations: "text-green-600",
    security: "text-red-500",
    performance: "text-purple-500",
    compliance: "text-yellow-600",
  };

  const categoryLabels: Record<string, string> = {
    resource_management: "Resource Mgmt",
    cost_control: "Cost Control",
    operations: "Operations",
    security: "Security",
    performance: "Performance",
    compliance: "Compliance",
  };

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (!status) return <p className="text-sm text-muted-foreground">Governor data unavailable.</p>;

  return (
    <div className="space-y-4">
      <Card data-testid="governor-overview">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            Process Governor — Agent Blueprint
          </CardTitle>
          <CardDescription className="text-xs">
            Rules-driven autonomous governance. Evaluates system state every 12 hours, takes action based on the corporate playbook,
            and only escalates mission-critical issues to you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <p className="text-lg font-semibold text-green-600" data-testid="governor-active">{status.activeSubscriptions}</p>
              <p className="text-[10px] text-muted-foreground">Active Subs</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <p className="text-lg font-semibold text-orange-500" data-testid="governor-disabled">{status.disabledSubscriptions}</p>
              <p className="text-[10px] text-muted-foreground">Disabled</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <p className="text-lg font-semibold text-blue-500" data-testid="governor-protected">{status.protectedCount}</p>
              <p className="text-[10px] text-muted-foreground">Protected</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <p className="text-lg font-semibold" data-testid="governor-rules-count">{status.totalRules}</p>
              <p className="text-[10px] text-muted-foreground">Active Rules</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <p className="text-xs font-medium" data-testid="governor-last-run">
                {status.lastRunAt ? new Date(status.lastRunAt).toLocaleString() : "Never"}
              </p>
              <p className="text-[10px] text-muted-foreground">Last Run</p>
            </div>
          </div>

          {status.rulesByCategory && Object.keys(status.rulesByCategory).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.entries(status.rulesByCategory).map(([cat, count]) => (
                <Badge key={cat} variant="outline" className={`text-[10px] ${categoryColors[cat] || ""}`}>
                  {categoryLabels[cat] || cat}: {count}
                </Badge>
              ))}
            </div>
          )}

          <div className="space-y-2 mb-4">
            <p className="text-xs font-medium text-muted-foreground">Business Activity Checks</p>
            {status.checks.map((c) => (
              <div key={c.eventType} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30" data-testid={`governor-check-${c.eventType}`}>
                <span className="font-mono">{c.eventType}</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{c.description}</span>
                  {c.hasActivity ? (
                    <Badge variant="default" className="text-[10px] bg-green-600">Active</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">No Activity</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => runEvaluation(true)} disabled={running} data-testid="governor-dry-run">
              {running ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
              Dry Run
            </Button>
            <Button size="sm" onClick={() => runEvaluation(false)} disabled={running} data-testid="governor-run">
              {running ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
              Run Evaluation
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowRules(!showRules)} data-testid="governor-toggle-rules">
              {showRules ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
              {showRules ? "Hide" : "Show"} Playbook
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowFrameworks(!showFrameworks)} data-testid="governor-toggle-frameworks">
              <BookOpen className="w-3 h-3 mr-1" />
              {showFrameworks ? "Hide" : "Show"} Frameworks
            </Button>
          </div>
        </CardContent>
      </Card>

      {showRules && rules && (
        <Card data-testid="governor-playbook">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ListTodo className="w-4 h-4" />
              Corporate Governance Playbook ({rules.length} rules)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {rules.map((r: any) => (
                <div key={r.id} className="p-2.5 rounded border bg-muted/20 text-xs" data-testid={`governor-rule-${r.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[9px] ${categoryColors[r.category] || ""}`}>
                        {categoryLabels[r.category] || r.category}
                      </Badge>
                      <span className="font-medium">{r.rule_name}</span>
                      {r.escalate_to_human && (
                        <Badge variant="destructive" className="text-[9px]">Escalates</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-[10px]">P{r.priority}</span>
                      <Badge variant={r.enabled ? "default" : "secondary"} className="text-[9px]">
                        {r.enabled ? "Active" : "Disabled"}
                      </Badge>
                      {r.trigger_count > 0 && (
                        <span className="text-muted-foreground text-[10px]">{r.trigger_count}x triggered</span>
                      )}
                    </div>
                  </div>
                  <p className="text-muted-foreground">{r.description}</p>
                  {r.escalation_reason && (
                    <p className="text-red-500 text-[10px] mt-1">Escalation: {r.escalation_reason}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {showFrameworks && frameworks && (
        <Card data-testid="governor-frameworks">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Governance Research Frameworks ({frameworks.length})
            </CardTitle>
            <CardDescription className="text-xs">
              Standards and research that inform our governance rules. Review dates ensure we stay current with the latest guidance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {frameworks.map((fw: any) => {
                const isExpanded = expandedFramework === fw.id;
                let principles: string[] = [];
                try { principles = typeof fw.key_principles === "string" ? JSON.parse(fw.key_principles) : (fw.key_principles || []); } catch { principles = []; }
                let rulesInformed: string[] = [];
                try { rulesInformed = typeof fw.rules_informed === "string" ? JSON.parse(fw.rules_informed) : (fw.rules_informed || []); } catch { rulesInformed = []; }
                const nextReview = fw.next_review_date ? new Date(fw.next_review_date) : null;
                const isOverdue = nextReview && nextReview < new Date();
                const categoryBadgeColors: Record<string, string> = {
                  government_standard: "text-blue-600 border-blue-300",
                  industry_framework: "text-orange-600 border-orange-300",
                  corporate_governance: "text-green-600 border-green-300",
                };
                return (
                  <div key={fw.id} className={`rounded border p-3 ${isOverdue ? "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20" : "bg-muted/20"}`} data-testid={`framework-${fw.id}`}>
                    <div className="flex items-start justify-between cursor-pointer" onClick={() => setExpandedFramework(isExpanded ? null : fw.id)}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="outline" className={`text-[9px] ${categoryBadgeColors[fw.category] || ""}`}>
                            {fw.category === "government_standard" ? "Gov Standard" : fw.category === "industry_framework" ? "Industry" : "Corporate"}
                          </Badge>
                          <span className="text-xs font-medium">{fw.name}</span>
                          {fw.status !== "active" && (
                            <Badge variant="secondary" className="text-[9px]">{fw.status}</Badge>
                          )}
                          {isOverdue && (
                            <Badge variant="destructive" className="text-[9px]">Review Overdue</Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground">{fw.organization} — {fw.version}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {fw.source_url && (
                          <a href={fw.source_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-primary" data-testid={`framework-link-${fw.id}`}>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 space-y-3 border-t pt-3">
                        <p className="text-xs text-muted-foreground">{fw.description}</p>

                        <div>
                          <p className="text-[10px] font-medium mb-1.5 flex items-center gap-1">
                            <FileText className="w-3 h-3" /> Key Principles ({principles.length})
                          </p>
                          <div className="space-y-1">
                            {principles.map((p: string, i: number) => (
                              <div key={i} className="text-[10px] p-1.5 rounded bg-muted/40 text-muted-foreground">
                                {p}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="text-[10px] font-medium mb-1.5">Rules Informed ({rulesInformed.length})</p>
                          <div className="flex flex-wrap gap-1">
                            {rulesInformed.map((r: string) => (
                              <Badge key={r} variant="outline" className="text-[9px]">{r}</Badge>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Last Reviewed: {new Date(fw.last_reviewed).toLocaleDateString()}
                          </span>
                          {nextReview && (
                            <span className={`flex items-center gap-1 ${isOverdue ? "text-amber-600 font-medium" : ""}`}>
                              <Clock className="w-3 h-3" />
                              Next Review: {nextReview.toLocaleDateString()}
                            </span>
                          )}
                        </div>

                        {fw.review_notes && (
                          <div className="text-[10px] p-2 rounded bg-blue-50 dark:bg-blue-950/30 text-muted-foreground border border-blue-200 dark:border-blue-800">
                            <span className="font-medium">Review Notes:</span> {fw.review_notes}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {lastReport && (
        <Card data-testid="governor-report">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Evaluation Report</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs mb-3 p-2 rounded bg-muted/50">{lastReport.summary}</p>
            <div className="grid grid-cols-4 gap-2 mb-3">
              <div className="text-center p-1.5 rounded bg-muted/30">
                <p className="text-sm font-semibold">{lastReport.rulesEvaluated}</p>
                <p className="text-[9px] text-muted-foreground">Evaluated</p>
              </div>
              <div className="text-center p-1.5 rounded bg-muted/30">
                <p className="text-sm font-semibold text-blue-500">{lastReport.rulesTriggered}</p>
                <p className="text-[9px] text-muted-foreground">Triggered</p>
              </div>
              <div className="text-center p-1.5 rounded bg-muted/30">
                <p className="text-sm font-semibold text-green-600">{lastReport.actionsApplied}</p>
                <p className="text-[9px] text-muted-foreground">Actions</p>
              </div>
              <div className="text-center p-1.5 rounded bg-muted/30">
                <p className="text-sm font-semibold text-red-500">{lastReport.escalations}</p>
                <p className="text-[9px] text-muted-foreground">Escalations</p>
              </div>
            </div>
            <div className="space-y-1.5">
              {lastReport.evaluations?.map((e: any, i: number) => (
                <div key={i} className={`flex items-start justify-between text-xs p-2 rounded ${e.conditionMet ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800" : "bg-muted/30"}`} data-testid={`governor-eval-${i}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge variant="outline" className={`text-[9px] ${categoryColors[e.category] || ""}`}>
                        {categoryLabels[e.category] || e.category}
                      </Badge>
                      <span className="font-medium truncate">{e.ruleName}</span>
                      {e.conditionMet && <CheckCircle2 className="w-3 h-3 text-blue-500 shrink-0" />}
                      {e.escalated && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />}
                    </div>
                    <p className="text-muted-foreground text-[10px]">{e.conditionDetail}</p>
                    {e.actionTaken && (
                      <p className="text-[10px] mt-0.5 font-medium">{e.actionTaken}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {status.recentActions && status.recentActions.length > 0 && (
        <Card data-testid="governor-history">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {status.recentActions.map((a: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30" data-testid={`governor-action-${i}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[9px] ${categoryColors[a.category] || ""}`}>
                      {categoryLabels[a.category] || a.category}
                    </Badge>
                    <span>{a.rule_name}</span>
                    {a.escalated && <AlertTriangle className="w-3 h-3 text-red-500" />}
                  </div>
                  <span className="text-muted-foreground text-[10px]">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function AgenticPage() {
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="agentic-title">
          <Radio className="w-5 h-5 text-primary" />
          Agentic Operations
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Monitor agent desks, internal channels, and the event bus in real time.</p>
      </div>

      <Tabs defaultValue="desks" className="w-full">
        <TabsList className="w-full flex h-auto gap-1 p-1" data-testid="agentic-tabs">
          <TabsTrigger value="desks" className="flex items-center gap-1.5 text-xs" data-testid="tab-desks">
            <Inbox className="w-3.5 h-3.5" /> Agent Desks
          </TabsTrigger>
          <TabsTrigger value="channels" className="flex items-center gap-1.5 text-xs" data-testid="tab-channels">
            <MessageSquare className="w-3.5 h-3.5" /> Channels
          </TabsTrigger>
          <TabsTrigger value="events" className="flex items-center gap-1.5 text-xs" data-testid="tab-events">
            <Radio className="w-3.5 h-3.5" /> Event Bus
          </TabsTrigger>
          <TabsTrigger value="governor" className="flex items-center gap-1.5 text-xs" data-testid="tab-governor">
            <Shield className="w-3.5 h-3.5" /> Governor
          </TabsTrigger>
        </TabsList>

        <TabsContent value="desks" className="mt-4">
          <DesksTab />
        </TabsContent>
        <TabsContent value="channels" className="mt-4">
          <ChannelsTab />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <EventsTab />
        </TabsContent>
        <TabsContent value="governor" className="mt-4">
          <GovernorTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
