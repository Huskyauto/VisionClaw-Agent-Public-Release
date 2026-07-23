import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarClock, Plus, Trash2, Clock, CheckCircle2, XCircle, Play, Pause,
  RefreshCw, Mail, BarChart3, Search, Globe, FileText, TrendingUp, Shield,
  Briefcase, ChevronRight, Zap, ChevronDown, ChevronUp, Loader2, Eye,
  DollarSign, Scale, Users, Crown, BookOpen,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface ScheduledTask {
  id: number;
  name: string;
  description: string;
  type: string;
  cronExpression: string;
  enabled: boolean;
  promptContent: string;
  model: string;
  personaId: number | null;
  createdBy: string;
  parentTaskId: number | null;
  runOnce: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

interface Persona {
  id: number;
  name: string;
  role: string;
  icon: string;
  isActive: boolean;
}

interface TaskLog {
  id: number;
  taskId: number | null;
  taskName: string;
  status: string;
  output: string | null;
  personaName: string | null;
  durationMs: number | null;
  createdAt: string;
}

const FREQUENCY_OPTIONS = [
  { value: "0 * * * *", label: "Every Hour", description: "Runs at the top of every hour" },
  { value: "0 */3 * * *", label: "Every 3 Hours", description: "Runs every 3 hours" },
  { value: "0 */6 * * *", label: "Every 6 Hours", description: "Runs 4 times a day" },
  { value: "0 9 * * *", label: "Daily (9 AM)", description: "Once a day at 9 AM" },
  { value: "0 9 * * 1-5", label: "Weekdays (9 AM)", description: "Monday through Friday at 9 AM" },
  { value: "0 9 * * 1", label: "Weekly (Monday)", description: "Every Monday at 9 AM" },
  { value: "0 9 1 * *", label: "Monthly (1st)", description: "First day of every month at 9 AM" },
  { value: "0 9 1 1 *", label: "Yearly (Jan 1)", description: "Once a year on January 1st" },
];

const TASK_TEMPLATES = [
  {
    name: "Daily Business Report",
    description: "Generate a daily summary of key business metrics and activities",
    icon: BarChart3,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    frequency: "0 9 * * *",
    prompt: "Generate today's business briefing report. Include: 1) Summary of all tasks completed in the last 24 hours, 2) Key metrics and trends, 3) Any issues that need attention, 4) Priorities for today. Format it professionally for executive review.",
  },
  {
    name: "Competitor Watch",
    description: "Monitor competitor activity and market changes",
    icon: Search,
    color: "text-violet-500",
    bg: "bg-violet-500/10",
    frequency: "0 9 * * 1",
    prompt: "Do a competitive intelligence scan. Search for recent news, product launches, and market activity from key competitors. Provide a brief summary of findings and highlight anything actionable.",
  },
  {
    name: "Email Digest",
    description: "Summarize and prioritize incoming emails",
    icon: Mail,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    frequency: "0 9 * * 1-5",
    prompt: "Check my inbox and create a prioritized email digest. Group emails by urgency (immediate action, follow-up, FYI). Draft quick responses for routine messages. Flag anything that needs my personal attention.",
  },
  {
    name: "Social Media Check-in",
    description: "Monitor social channels and draft content",
    icon: Globe,
    color: "text-pink-500",
    bg: "bg-pink-500/10",
    frequency: "0 */6 * * *",
    prompt: "Review our social media channels for new mentions, comments, and messages. Highlight any trending conversations relevant to our brand. Suggest 2-3 potential social posts for today based on current trends.",
  },
  {
    name: "Weekly Team Standup",
    description: "Prepare weekly progress report for the team",
    icon: Briefcase,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    frequency: "0 9 * * 1",
    prompt: "Prepare a weekly standup report covering: 1) What was accomplished last week (pull from task history), 2) What's planned for this week, 3) Any blockers or risks, 4) Key decisions needed. Make it concise and action-oriented.",
  },
  {
    name: "Security & Compliance Check",
    description: "Run routine security and system health checks",
    icon: Shield,
    color: "text-red-500",
    bg: "bg-red-500/10",
    frequency: "0 6 * * *",
    prompt: "Run a system health and security check: 1) Review recent error logs for anomalies, 2) Check if all integrations are connected and functioning, 3) Verify backup status, 4) Flag any security concerns. Report findings with severity levels.",
  },
  {
    name: "Content Pipeline",
    description: "Draft and schedule marketing content",
    icon: FileText,
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
    frequency: "0 10 * * 1,3,5",
    prompt: "Review our content calendar and draft the next piece of scheduled content. Consider current trends, upcoming events, and audience engagement data. Provide a complete draft ready for review, including headlines, body copy, and suggested visuals.",
  },
  {
    name: "Revenue & Expense Tracker",
    description: "Track financial metrics and flag anomalies",
    icon: TrendingUp,
    color: "text-green-500",
    bg: "bg-green-500/10",
    frequency: "0 8 * * 1-5",
    prompt: "Review today's financial activity: 1) New revenue/transactions, 2) Any unusual expenses or charges, 3) Subscription renewal dates coming up, 4) Cash flow summary. Flag anything that looks unusual or needs attention.",
  },
  {
    name: "Monthly Financial Close",
    description: "Full P&L, cash flow, tax provision, and financial health check",
    icon: DollarSign,
    color: "text-emerald-600",
    bg: "bg-emerald-600/10",
    frequency: "0 9 1 * *",
    prompt: "Run the monthly financial close process: 1) Pull all revenue from Stripe and Coinbase for the past month, 2) Categorize all expenses, 3) Generate a Profit & Loss statement, 4) Calculate cash flow (beginning balance + inflows - outflows), 5) Provision 30% of net income for taxes (federal + Illinois state), 6) Calculate cash runway (current cash / monthly burn rate), 7) Flag any anomalies (transactions > 15% variance from prior month), 8) Produce a monthly financial summary report as a PDF and save to Google Drive. Include period-over-period comparisons.",
  },
  {
    name: "AI Board Meeting",
    description: "Monthly all-persona board report with financials, risks, and decisions",
    icon: Crown,
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    frequency: "0 9 1 * *",
    prompt: "Conduct the monthly AI Board of Directors meeting. As CEO, gather inputs from all departments: 1) FINANCIAL SUMMARY — Pull P&L, revenue trends, cash runway, and expense breakdown, 2) OPERATIONS — Tasks completed, success rate, system health status, 3) INTELLIGENCE — Market trends, competitor activity, regulatory changes detected this month, 4) CONTENT & MARKETING — Content published, engagement metrics, pipeline, 5) ENGINEERING — System improvements, uptime, technical debt addressed, 6) RISKS & OPPORTUNITIES — Top 3 risks and top 3 opportunities identified, 7) DECISIONS NEEDED — List 3-5 high-level decisions requiring human approval. Format as a professional Board Report PDF and upload to Google Drive. This is the corporation's monthly executive summary.",
  },
  {
    name: "Regulatory Sweep",
    description: "Scan for new regulations affecting AI companies and your industry",
    icon: Scale,
    color: "text-indigo-500",
    bg: "bg-indigo-500/10",
    frequency: "0 9 * * 1",
    prompt: "Run a weekly regulatory and compliance sweep: 1) Search for new federal regulations affecting AI companies, SaaS platforms, and autonomous agents, 2) Check for Illinois state business law updates and filing requirements, 3) Monitor privacy regulation changes (GDPR, CCPA, state privacy laws), 4) Scan for AI governance frameworks, executive orders, or proposed legislation, 5) Check corporate registration and filing deadlines, 6) Generate a compliance checklist with action items. Flag anything requiring immediate attention or CEO decision. Save findings as a compliance memo.",
  },
  {
    name: "Corporation Status Report",
    description: "Generate a comprehensive PDF report of all corporation operations",
    icon: BookOpen,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    frequency: "0 9 1 * *",
    prompt: "Generate a comprehensive VisionClaw Corporation Status Report: 1) EXECUTIVE SUMMARY — Overall corporation health, key achievements, and concerns, 2) AGENT TEAM STATUS — Which AI agents are active, their recent task completions and performance, 3) OPERATIONS — Heartbeat task success rates, scheduled task execution history, 4) COMMUNICATIONS — Email activity, conversation volume, key interactions, 5) MEMORY & KNOWLEDGE — Total memories stored, knowledge base size, recent additions, 6) SYSTEM HEALTH — Database status, storage usage, API provider health, uptime, 7) SECURITY — Recent auth activity, vault usage, any security events, 8) FINANCIAL OVERVIEW — Revenue, expenses, subscription status. Create the report as a professional PDF with all sections and upload to Google Drive.",
  },
];

function getFrequencyLabel(cron: string): string {
  const match = FREQUENCY_OPTIONS.find(f => f.value === cron);
  if (match) return match.label;
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  if (min === "*" && hour === "*") return "Every minute";
  if (hour === "*") return `Every hour at :${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "*") return `Daily at ${hour}:${min.padStart(2, "0")}`;
  if (dow === "1-5") return `Weekdays at ${hour}:${min.padStart(2, "0")}`;
  if (dow === "1") return `Weekly (Mon) at ${hour}:${min.padStart(2, "0")}`;
  if (dom === "1" && mon === "*") return `Monthly (1st) at ${hour}:${min.padStart(2, "0")}`;
  return cron;
}

function CreateTaskDialog({ personas, onClose }: { personas: Persona[]; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState("0 9 * * *");
  const [prompt, setPrompt] = useState("");
  const [personaId, setPersonaId] = useState<string>("auto");
  const [runOnce, setRunOnce] = useState(false);

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/heartbeat/tasks", {
        name, description: description || name,
        cronExpression: frequency,
        promptContent: prompt,
        personaId: personaId !== "auto" ? parseInt(personaId) : null,
        runOnce,
        type: "scheduled",
        enabled: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/tasks"] });
      toast({ title: "Task scheduled" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create task", description: err.message, variant: "destructive" });
    },
  });

  const deployTemplate = (tmpl: typeof TASK_TEMPLATES[0]) => {
    setName(tmpl.name);
    setDescription(tmpl.description);
    setFrequency(tmpl.frequency);
    setPrompt(tmpl.prompt);
  };

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {!name && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Quick Start — choose a template or create your own</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TASK_TEMPLATES.slice(0, 4).map(tmpl => {
              const Icon = tmpl.icon;
              return (
                <button
                  key={tmpl.name}
                  onClick={() => deployTemplate(tmpl)}
                  className="flex items-start gap-2.5 p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
                  data-testid={`template-${tmpl.name.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className={`w-8 h-8 rounded-lg ${tmpl.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4 h-4 ${tmpl.color}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{tmpl.name}</div>
                    <div className="text-[10px] text-muted-foreground line-clamp-1">{tmpl.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Task Name</Label>
        <Input
          placeholder="e.g., Weekly Marketing Report"
          value={name} onChange={(e) => setName(e.target.value)}
          data-testid="input-task-name"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Description</Label>
        <Input
          placeholder="Brief description of what this task does"
          value={description} onChange={(e) => setDescription(e.target.value)}
          data-testid="input-task-description"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>How Often</Label>
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger data-testid="select-frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCY_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className="flex flex-col">
                    <span>{opt.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            {FREQUENCY_OPTIONS.find(f => f.value === frequency)?.description}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Assign To</Label>
          <Select value={personaId} onValueChange={setPersonaId}>
            <SelectTrigger data-testid="select-persona">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (Best Agent)</SelectItem>
              {personas.filter(p => p.isActive).map(p => (
                <SelectItem key={p.id} value={p.id.toString()}>
                  {p.icon} {p.name} — {p.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Instructions for the AI</Label>
        <Textarea
          placeholder="What should the agent do when this task runs? Be specific about the expected output..."
          value={prompt} onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          data-testid="input-task-prompt"
        />
      </div>

      <div className="flex items-center gap-2">
        <Switch checked={runOnce} onCheckedChange={setRunOnce} data-testid="switch-run-once" />
        <Label className="text-sm">Run once then disable (one-time task)</Label>
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!name || !prompt || createMutation.isPending}
          data-testid="button-save-task"
        >
          {createMutation.isPending ? "Scheduling..." : "Schedule Task"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function LogEntry({ log }: { log: TaskLog }) {
  const [expanded, setExpanded] = useState(false);
  const [fullOutput, setFullOutput] = useState<string | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);

  const toggleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (fullOutput !== null) {
      setExpanded(true);
      return;
    }
    setLoadingOutput(true);
    try {
      const res = await authFetch(`/api/heartbeat/logs/${log.id}/output`);
      if (res.ok) {
        const data = await res.json();
        setFullOutput(data.output || log.output || "(no output)");
      } else {
        setFullOutput(log.output || "(no output)");
      }
    } catch {
      setFullOutput(log.output || "(no output)");
    }
    setLoadingOutput(false);
    setExpanded(true);
  };

  return (
    <div
      className="rounded-lg bg-card border border-border overflow-hidden"
      data-testid={`log-entry-${log.id}`}
    >
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={toggleExpand}
      >
        {log.status === "success"
          ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{log.taskName}</div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-2">
            {log.personaName && <span>{log.personaName}</span>}
            <span>{formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}</span>
            {log.durationMs && <span>{(log.durationMs / 1000).toFixed(1)}s</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {log.output && !expanded && (
            <p className="text-[10px] text-muted-foreground max-w-[200px] truncate hidden sm:block">
              {log.output.slice(0, 80)}
            </p>
          )}
          <Button size="icon" variant="ghost" className="h-6 w-6" data-testid={`button-expand-log-${log.id}`}>
            {loadingOutput ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : expanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </Button>
        </div>
      </div>
      {expanded && fullOutput && (
        <div className="border-t border-border p-3 bg-muted/20" data-testid={`log-output-${log.id}`}>
          <div className="text-xs leading-relaxed whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
            {fullOutput}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScheduledTasksPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("active");

  const { data: tasks = [], isLoading } = useQuery<ScheduledTask[]>({
    queryKey: ["/api/heartbeat/tasks"],
  });

  const { data: logs = [] } = useQuery<TaskLog[]>({
    queryKey: ["/api/heartbeat/logs?limit=50"],
    refetchInterval: 30000,
  });

  const { data: personas = [] } = useQuery<Persona[]>({
    queryKey: ["/api/personas"],
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("PATCH", `/api/heartbeat/tasks/${id}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/tasks"] });
    },
    onError: () => {
      toast({ title: "Failed to update", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/heartbeat/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/tasks"] });
      toast({ title: "Task removed" });
    },
    onError: () => {
      toast({ title: "Failed to delete", variant: "destructive" });
    },
  });

  const deployTemplateMutation = useMutation({
    mutationFn: (tmpl: typeof TASK_TEMPLATES[0]) =>
      apiRequest("POST", "/api/heartbeat/tasks", {
        name: tmpl.name,
        description: tmpl.description,
        cronExpression: tmpl.frequency,
        promptContent: tmpl.prompt,
        type: "scheduled",
        enabled: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/tasks"] });
      toast({ title: "Task deployed" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to deploy", description: err.message, variant: "destructive" });
    },
  });

  const activeTasks = tasks.filter(t => t.enabled);
  const pausedTasks = tasks.filter(t => !t.enabled);

  const personaMap = new Map(personas.map(p => [p.id, p]));

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto p-4 sm:p-6 max-w-4xl space-y-6 pb-20" data-testid="scheduled-tasks-page">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2" data-testid="text-tasks-title">
              <CalendarClock className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              Automations
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Set it and forget it — your AI handles these tasks on schedule
            </p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-new-task">
                <Plus className="w-4 h-4 mr-1" /> New Task
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Schedule a Task</DialogTitle>
              </DialogHeader>
              <CreateTaskDialog personas={personas} onClose={() => setDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-card border border-border" data-testid="stat-active-tasks">
            <Play className="w-4 h-4 text-emerald-500 shrink-0" />
            <div>
              <div className="text-lg font-bold leading-none">{activeTasks.length}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Active</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-card border border-border" data-testid="stat-paused-tasks">
            <Pause className="w-4 h-4 text-amber-500 shrink-0" />
            <div>
              <div className="text-lg font-bold leading-none">{pausedTasks.length}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Paused</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-card border border-border" data-testid="stat-runs-today">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            <div>
              <div className="text-lg font-bold leading-none">
                {logs.filter(l => {
                  const d = new Date(l.createdAt);
                  const now = new Date();
                  return d.toDateString() === now.toDateString();
                }).length}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Runs Today</div>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="tabs-tasks">
            <TabsTrigger value="active" data-testid="tab-active">
              Active Tasks ({activeTasks.length})
            </TabsTrigger>
            <TabsTrigger value="templates" data-testid="tab-templates">
              Templates
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              Run History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="space-y-3 mt-4">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-20 rounded-lg bg-muted/30 animate-pulse" />
                ))}
              </div>
            ) : tasks.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CalendarClock className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No scheduled tasks yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Create one or deploy a template to get started
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-4"
                    onClick={() => setActiveTab("templates")}
                    data-testid="button-browse-templates"
                  >
                    Browse Templates
                  </Button>
                </CardContent>
              </Card>
            ) : (
              tasks.map((task) => {
                const persona = task.personaId ? personaMap.get(task.personaId) : null;
                const taskLogs = logs.filter(l => l.taskId === task.id).slice(0, 3);
                const lastStatus = taskLogs[0]?.status;
                return (
                  <Card key={task.id} className={!task.enabled ? "opacity-60" : ""} data-testid={`card-task-${task.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 text-base">
                            {persona?.icon || "🤖"}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm" data-testid={`text-task-name-${task.id}`}>{task.name}</span>
                              <Badge variant="outline" className="text-[10px] py-0 h-4">
                                {getFrequencyLabel(task.cronExpression)}
                              </Badge>
                              {task.runOnce && (
                                <Badge variant="outline" className="text-[10px] py-0 h-4 text-amber-500 border-amber-500/30">
                                  One-time
                                </Badge>
                              )}
                              {lastStatus && (
                                <span className="flex items-center gap-0.5">
                                  {lastStatus === "success"
                                    ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                    : <XCircle className="w-3 h-3 text-red-500" />}
                                </span>
                              )}
                            </div>
                            {task.description && task.description !== task.name && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground flex-wrap">
                              {persona && (
                                <span>{persona.icon} {persona.name}</span>
                              )}
                              {task.nextRunAt && (
                                <span className="flex items-center gap-0.5">
                                  <Clock className="w-2.5 h-2.5" />
                                  Next: {formatDistanceToNow(new Date(task.nextRunAt), { addSuffix: true })}
                                </span>
                              )}
                              {task.lastRunAt && (
                                <span>
                                  Last ran {formatDistanceToNow(new Date(task.lastRunAt), { addSuffix: true })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Switch
                            checked={task.enabled}
                            onCheckedChange={(enabled) => toggleMutation.mutate({ id: task.id, enabled })}
                            data-testid={`switch-task-${task.id}`}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-red-400"
                            onClick={() => {
                              if (confirm(`Delete "${task.name}"?`)) {
                                deleteMutation.mutate(task.id);
                              }
                            }}
                            data-testid={`button-delete-task-${task.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="templates" className="mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TASK_TEMPLATES.map(tmpl => {
                const Icon = tmpl.icon;
                const alreadyDeployed = tasks.some(t => t.name === tmpl.name);
                return (
                  <Card key={tmpl.name} data-testid={`template-card-${tmpl.name.toLowerCase().replace(/\s+/g, "-")}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg ${tmpl.bg} flex items-center justify-center shrink-0`}>
                          <Icon className={`w-5 h-5 ${tmpl.color}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm">{tmpl.name}</div>
                          <p className="text-xs text-muted-foreground mt-0.5">{tmpl.description}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="outline" className="text-[10px] py-0 h-4">
                              {getFrequencyLabel(tmpl.frequency)}
                            </Badge>
                            {alreadyDeployed ? (
                              <Badge variant="outline" className="text-[10px] py-0 h-4 text-emerald-500 border-emerald-500/30">
                                <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> Deployed
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-5 text-[10px] px-2"
                                onClick={() => deployTemplateMutation.mutate(tmpl)}
                                disabled={deployTemplateMutation.isPending}
                                data-testid={`button-deploy-${tmpl.name.toLowerCase().replace(/\s+/g, "-")}`}
                              >
                                Deploy
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-4 space-y-2">
            {logs.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <RefreshCw className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No task runs yet</p>
                </CardContent>
              </Card>
            ) : (
              logs.slice(0, 25).map(log => (
                <LogEntry key={log.id} log={log} />
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
