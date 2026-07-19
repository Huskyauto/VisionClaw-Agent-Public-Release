import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Heart, Play, Square, Plus, Trash2, Clock, CheckCircle2, XCircle, Activity, Pencil, X, Save, Users, ArrowRight, Bot, Send, Rocket, LayoutTemplate, Radar, Shield, TrendingUp, Hammer, BarChart3, FileText, DollarSign, Crown, Scale, BookOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { ErrorState } from "@/components/error-state";

interface HeartbeatTask {
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
  approval_status?: string;
}

interface HeartbeatLog {
  id: number;
  taskId: number | null;
  taskName: string;
  status: string;
  input: string | null;
  output: string | null;
  model: string | null;
  personaId: number | null;
  personaName: string | null;
  delegatedTasks: string | null;
  durationMs: number | null;
  createdAt: string;
}

interface AgentSummary {
  id: number;
  name: string;
  role: string;
  icon: string;
  totalTasks: number;
  enabledTasks: number;
  isActive: boolean;
}

interface HeartbeatStatus {
  running: boolean;
  totalTasks: number;
  enabledTasks: number;
  systemTasks: number;
  agents: AgentSummary[];
  recentLogs: HeartbeatLog[];
}

interface ModelInfo {
  id: string;
  label: string;
  provider: string;
}

interface PersonaInfo {
  id: number;
  name: string;
  role: string;
  icon: string;
}

const CRON_PRESETS = [
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "*/30 * * * *", label: "Every 30 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */2 * * *", label: "Every 2 hours" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 9 * * *", label: "Daily at 9 AM" },
  { value: "0 9,18 * * *", label: "Twice daily (9 AM & 6 PM)" },
];

const TASK_TYPES = [
  { value: "routine", label: "Routine" },
  { value: "reflection", label: "Self-Reflection" },
  { value: "memory_consolidation", label: "Memory Consolidation" },
  { value: "daily_planning", label: "Daily Planning" },
  { value: "delegation", label: "Delegated Task" },
];

interface TaskTemplate {
  id: string;
  name: string;
  agentName: string;
  description: string;
  type: string;
  cronExpression: string;
  model: string;
  promptContent: string;
  icon: typeof Radar;
  scheduleLabel: string;
}

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "radar-intelligence",
    name: "Daily Intelligence Scan",
    agentName: "Radar",
    description: "Scans news, trends, and competitor activity relevant to your business every morning",
    type: "routine",
    cronExpression: "0 7 * * *",
    model: "gpt-5-nano",
    promptContent: "Run a comprehensive daily intelligence scan. Review trending topics, competitor movements, industry news, and relevant market signals. Compile a brief with the top 5 most actionable insights. Flag anything that requires immediate attention. Format as a structured briefing with priority levels.",
    icon: Radar,
    scheduleLabel: "Daily at 7 AM",
  },
  {
    id: "chief-standup",
    name: "Morning Standup",
    agentName: "Chief of Staff",
    description: "Reviews today's agenda, pending tasks, and priorities for a morning briefing",
    type: "daily_planning",
    cronExpression: "0 8 * * *",
    model: "gpt-5-nano",
    promptContent: "Conduct the morning standup routine. Review all pending tasks, calendar events, and priorities for today. Summarize what was accomplished yesterday, what's planned for today, and any blockers. Check on delegated tasks from other agents and compile status updates. Deliver a concise morning briefing.",
    icon: Shield,
    scheduleLabel: "Daily at 8 AM",
  },
  {
    id: "apollo-pipeline",
    name: "Pipeline Review",
    agentName: "Apollo",
    description: "Analyzes sales pipeline, lead status, and revenue projections",
    type: "routine",
    cronExpression: "0 9 * * *",
    model: "gpt-5-nano",
    promptContent: "Review the current sales pipeline and business development status. Analyze active leads, deal stages, and conversion metrics. Identify stalled opportunities and suggest follow-up actions. Calculate projected revenue for the current period. Provide 3 specific recommendations to accelerate pipeline velocity.",
    icon: TrendingUp,
    scheduleLabel: "Daily at 9 AM",
  },
  {
    id: "forge-build",
    name: "Overnight Build Queue",
    agentName: "Forge",
    description: "Processes queued build tasks, code reviews, and technical debt items overnight",
    type: "routine",
    cronExpression: "0 23 * * *",
    model: "gpt-5-nano",
    promptContent: "Process the overnight build queue. Review any pending code changes, technical debt items, and build tasks. Run through the checklist of maintenance items: dependency updates, security patches, performance optimizations. Generate a report of completed items and any issues that need human attention in the morning.",
    icon: Hammer,
    scheduleLabel: "Daily at 11 PM",
  },
  {
    id: "atlas-scorecard",
    name: "Weekly Scorecard",
    agentName: "Atlas",
    description: "Compiles weekly KPIs, metrics, and performance scorecard every Monday",
    type: "reflection",
    cronExpression: "0 8 * * 1",
    model: "gpt-5-nano",
    promptContent: "Compile the weekly performance scorecard. Gather all key metrics from the past 7 days: tasks completed, goals progress, revenue metrics, content performance, and engagement stats. Compare against previous week and monthly targets. Highlight wins, areas needing attention, and trends. Format as a clean scorecard with red/yellow/green status indicators.",
    icon: BarChart3,
    scheduleLabel: "Monday at 8 AM",
  },
  {
    id: "scribe-content",
    name: "Content Draft",
    agentName: "Scribe",
    description: "Drafts content based on queued topics and brand voice guidelines (on-demand)",
    type: "routine",
    cronExpression: "0 10 * * *",
    model: "gpt-5-nano",
    promptContent: "Check the content queue for pending draft requests. For each queued topic, create a well-structured draft following the brand voice guidelines. Include headline options, key talking points, and a call-to-action. Ensure content aligns with current marketing themes and audience preferences. Save drafts for human review.",
    icon: FileText,
    scheduleLabel: "On-demand (10 AM default)",
  },
  {
    id: "monthly-financial-close",
    name: "Monthly Financial Close",
    agentName: "Cassandra",
    description: "Full P&L, cash flow statement, tax provision, and financial health check on the 1st of each month",
    type: "routine",
    cronExpression: "0 9 1 * *",
    model: "gpt-5-nano",
    promptContent: "Run the monthly financial close process: 1) Pull all revenue from Stripe and Coinbase for the past month, 2) Categorize all expenses, 3) Generate a Profit & Loss statement, 4) Calculate cash flow (beginning balance + inflows - outflows), 5) Provision 30% of net income for taxes (federal + Illinois state), 6) Calculate cash runway (current cash / monthly burn rate), 7) Flag any anomalies (transactions > 15% variance from prior month), 8) Produce a monthly financial summary report as a PDF and save to Google Drive. Include period-over-period comparisons.",
    icon: DollarSign,
    scheduleLabel: "Monthly (1st) at 9 AM",
  },
  {
    id: "ai-board-meeting",
    name: "AI Board Meeting",
    agentName: "Felix",
    description: "Monthly all-persona executive board report with financials, ops, risks, and decisions needed",
    type: "reflection",
    cronExpression: "0 9 1 * *",
    model: "gpt-5-nano",
    promptContent: "Conduct the monthly AI Board of Directors meeting. As CEO, gather inputs from all departments: 1) FINANCIAL SUMMARY — Pull P&L, revenue trends, cash runway, and expense breakdown, 2) OPERATIONS — Tasks completed, success rate, system health status, 3) INTELLIGENCE — Market trends, competitor activity, regulatory changes detected this month, 4) CONTENT & MARKETING — Content published, engagement metrics, pipeline, 5) ENGINEERING — System improvements, uptime, technical debt addressed, 6) RISKS & OPPORTUNITIES — Top 3 risks and top 3 opportunities identified, 7) DECISIONS NEEDED — List 3-5 high-level decisions requiring human approval. Format as a professional Board Report PDF and upload to Google Drive.",
    icon: Crown,
    scheduleLabel: "Monthly (1st) at 9 AM",
  },
  {
    id: "regulatory-sweep",
    name: "Regulatory Sweep",
    agentName: "Chief of Staff",
    description: "Weekly scan for new regulations affecting AI companies, SaaS, and Illinois business law",
    type: "routine",
    cronExpression: "0 9 * * 1",
    model: "gpt-5-nano",
    promptContent: "Run a weekly regulatory and compliance sweep: 1) Search for new federal regulations affecting AI companies, SaaS platforms, and autonomous agents, 2) Check for Illinois state business law updates and filing requirements, 3) Monitor privacy regulation changes (GDPR, CCPA, state privacy laws), 4) Scan for AI governance frameworks, executive orders, or proposed legislation, 5) Check corporate registration and filing deadlines, 6) Generate a compliance checklist with action items. Flag anything requiring immediate attention or CEO decision.",
    icon: Scale,
    scheduleLabel: "Monday at 9 AM",
  },
  {
    id: "corporation-status-report",
    name: "Corporation Status Report",
    agentName: "Felix",
    description: "Comprehensive PDF report of all corporation operations, agents, and system health",
    type: "reflection",
    cronExpression: "0 9 1 * *",
    model: "gpt-5-nano",
    promptContent: "Generate a comprehensive VisionClaw Corporation Status Report: 1) EXECUTIVE SUMMARY — Overall corporation health, key achievements, and concerns, 2) AGENT TEAM STATUS — Which AI agents are active, their recent task completions and performance, 3) OPERATIONS — Heartbeat task success rates, scheduled task execution history, 4) COMMUNICATIONS — Conversation volume, key interactions, 5) MEMORY & KNOWLEDGE — Total memories stored, knowledge base size, recent additions, 6) SYSTEM HEALTH — Database status, API provider health, uptime, 7) FINANCIAL OVERVIEW — Revenue, expenses, subscription status. Create the report as a professional PDF and upload to Google Drive.",
    icon: BookOpen,
    scheduleLabel: "Monthly (1st) at 9 AM",
  },
];

function TaskTemplate({ template, personas, onDeploy }: { template: TaskTemplate; personas: PersonaInfo[]; onDeploy: (template: TaskTemplate, personaId: number | null) => void }) {
  const matchedPersona = personas.find(p => p.name.toLowerCase() === template.agentName.toLowerCase());
  const IconComponent = template.icon;

  return (
    <Card data-testid={`template-card-${template.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <IconComponent className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm" data-testid={`text-template-name-${template.id}`}>{template.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  <Bot className="w-2.5 h-2.5 mr-0.5" /> {template.agentName}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  <Clock className="w-2.5 h-2.5 mr-0.5" /> {template.scheduleLabel}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
              <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                <span>Type: {template.type}</span>
                <span>Model: {template.model}</span>
              </div>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => onDeploy(template, matchedPersona?.id || null)}
            data-testid={`button-deploy-${template.id}`}
          >
            <Rocket className="w-3 h-3 mr-1" /> Deploy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TaskForm({ onClose, existing, personas }: { onClose: () => void; existing?: HeartbeatTask; personas: PersonaInfo[] }) {
  const { toast } = useToast();
  const [name, setName] = useState(existing?.name || "");
  const [description, setDescription] = useState(existing?.description || "");
  const [type, setType] = useState(existing?.type || "routine");
  const [cronExpression, setCronExpression] = useState(existing?.cronExpression || "*/30 * * * *");
  const [model, setModel] = useState(existing?.model || "gpt-5-nano");
  const [promptContent, setPromptContent] = useState(existing?.promptContent || "");
  const [personaId, setPersonaId] = useState<string>(existing?.personaId?.toString() || "none");

  const { data: modelsData } = useQuery<{ models: ModelInfo[] }>({ queryKey: ["/api/models"] });
  const models = modelsData?.models || [];

  const saveMutation = useMutation({
    mutationFn: (data: any) =>
      existing
        ? apiRequest("PATCH", `/api/heartbeat/tasks/${existing.id}`, data)
        : apiRequest("POST", "/api/heartbeat/tasks", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/status"] });
      toast({ description: existing ? "Task updated" : "Task created" });
      onClose();
    },
    onError: () => toast({ description: "Failed to save task", variant: "destructive" }),
  });

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{existing ? "Edit Task" : "New Heartbeat Task"}</CardTitle>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Task name" className="text-sm" data-testid="input-task-name" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Assign to Agent</Label>
            <Select value={personaId} onValueChange={setPersonaId}>
              <SelectTrigger className="text-sm" data-testid="select-task-persona"><SelectValue placeholder="System (no agent)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">System (shared)</SelectItem>
                {personas.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.name} — {p.role}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="text-sm" data-testid="select-task-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TASK_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Schedule</Label>
            <Select value={cronExpression} onValueChange={setCronExpression}>
              <SelectTrigger className="text-sm" data-testid="select-task-cron"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CRON_PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this task do?" className="text-sm" data-testid="input-task-description" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Model</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="text-sm" data-testid="select-task-model"><SelectValue /></SelectTrigger>
            <SelectContent>
              {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Prompt</Label>
          <Textarea
            value={promptContent}
            onChange={(e) => setPromptContent(e.target.value)}
            rows={5}
            placeholder="System prompt for this heartbeat task..."
            className="text-sm font-mono resize-y"
            data-testid="input-task-prompt"
          />
        </div>
        <Button
          className="w-full"
          size="sm"
          disabled={!name.trim() || !promptContent.trim() || saveMutation.isPending}
          onClick={() => saveMutation.mutate({
            name,
            description,
            type,
            cronExpression,
            model,
            promptContent,
            enabled: existing?.enabled ?? true,
            personaId: personaId === "none" ? null : parseInt(personaId),
            createdBy: existing?.createdBy || "user",
          })}
          data-testid="button-save-task"
        >
          <Save className="w-3 h-3 mr-1" />
          {saveMutation.isPending ? "Saving..." : "Save Task"}
        </Button>
      </CardContent>
    </Card>
  );
}

function DelegationForm({ personas, onClose }: { personas: PersonaInfo[]; onClose: () => void }) {
  const { toast } = useToast();
  const [targetPersona, setTargetPersona] = useState("");
  const [taskName, setTaskName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("once");

  const delegateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/heartbeat/delegate", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/status"] });
      toast({ description: `Task delegated to ${targetPersona}` });
      onClose();
    },
    onError: () => toast({ description: "Delegation failed", variant: "destructive" }),
  });

  return (
    <Card className="border-orange-500/30 bg-orange-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Send className="w-4 h-4 text-orange-500" /> Delegate Task to Agent
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Target Agent</Label>
            <Select value={targetPersona} onValueChange={setTargetPersona}>
              <SelectTrigger className="text-sm" data-testid="select-delegate-persona"><SelectValue placeholder="Choose agent..." /></SelectTrigger>
              <SelectContent>
                {personas.map((p) => <SelectItem key={p.id} value={p.name}>{p.name} — {p.role}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Schedule</Label>
            <Select value={schedule} onValueChange={setSchedule}>
              <SelectTrigger className="text-sm" data-testid="select-delegate-schedule"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Run once (next tick)</SelectItem>
                {CRON_PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Task Name</Label>
          <Input value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder="e.g. Build landing page copy" className="text-sm" data-testid="input-delegate-name" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" className="text-sm" data-testid="input-delegate-description" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Instructions for the Agent</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Detailed instructions for what this agent should do..."
            className="text-sm font-mono resize-y"
            data-testid="input-delegate-prompt"
          />
        </div>
        <Button
          className="w-full bg-orange-600 hover:bg-orange-700"
          size="sm"
          disabled={!targetPersona || !taskName.trim() || !prompt.trim() || delegateMutation.isPending}
          onClick={() => delegateMutation.mutate({ targetPersona, taskName, description, prompt, schedule })}
          data-testid="button-delegate"
        >
          <Send className="w-3 h-3 mr-1" />
          {delegateMutation.isPending ? "Delegating..." : "Delegate Task"}
        </Button>
      </CardContent>
    </Card>
  );
}

function AgentCard({ agent, tasks, onSelectAgent }: { agent: AgentSummary; tasks: HeartbeatTask[]; onSelectAgent: (id: number) => void }) {
  const agentTasks = tasks.filter(t => t.personaId === agent.id);
  const delegatedCount = agentTasks.filter(t => t.type === "delegation").length;
  const selfCreated = agentTasks.filter(t => t.createdBy.startsWith("persona:") || t.createdBy.startsWith("task:")).length;

  return (
    <div
      className="p-3 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
      onClick={() => onSelectAgent(agent.id)}
      data-testid={`agent-card-${agent.id}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="font-medium text-sm flex items-center gap-1.5">
              {agent.name}
              {agent.isActive && <Badge variant="default" className="text-[10px] px-1 py-0">Active</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">{agent.role}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold">{agent.enabledTasks}/{agent.totalTasks}</div>
          <div className="text-xs text-muted-foreground">tasks</div>
        </div>
      </div>
      {(delegatedCount > 0 || selfCreated > 0) && (
        <div className="flex gap-2 mt-2">
          {delegatedCount > 0 && <Badge variant="outline" className="text-[10px]">{delegatedCount} delegated</Badge>}
          {selfCreated > 0 && <Badge variant="secondary" className="text-[10px]">{selfCreated} self-created</Badge>}
        </div>
      )}
    </div>
  );
}

function PendingApprovals() {
  const { toast } = useToast();
  const { data: pendingTasks = [] } = useQuery<HeartbeatTask[]>({
    queryKey: ["/api/heartbeat/pending"],
    refetchInterval: 15000,
  });

  const approveMutation = useMutation({
    mutationFn: async (taskId: number) => {
      await apiRequest("POST", `/api/heartbeat/tasks/${taskId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/tasks"] });
      toast({ title: "Task approved and scheduled" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (taskId: number) => {
      await apiRequest("POST", `/api/heartbeat/tasks/${taskId}/reject`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/tasks"] });
      toast({ title: "Task rejected" });
    },
  });

  if (pendingTasks.length === 0) return null;

  return (
    <Card className="border-amber-500/50 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2" data-testid="pending-approvals-title">
          <Shield className="w-4 h-4 text-amber-500" />
          Pending Approvals
          <Badge variant="destructive" className="text-xs">{pendingTasks.length}</Badge>
        </CardTitle>
        <CardDescription>Agent-proposed tasks awaiting Felix's approval before they can run</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {pendingTasks.map((task) => (
          <div key={task.id} className="flex items-center justify-between p-3 rounded-lg border bg-card" data-testid={`pending-task-${task.id}`}>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{task.name}</div>
              <div className="text-xs text-muted-foreground truncate">{task.description}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Created {task.createdAt ? formatDistanceToNow(new Date(task.createdAt), { addSuffix: true }) : "recently"}
                {task.createdBy && ` by ${task.createdBy.replace("persona:", "agent #").replace("task:", "task #")}`}
              </div>
            </div>
            <div className="flex items-center gap-1.5 ml-3">
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs bg-green-600 hover:bg-green-700"
                onClick={() => approveMutation.mutate(task.id)}
                disabled={approveMutation.isPending}
                data-testid={`approve-task-${task.id}`}
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                onClick={() => rejectMutation.mutate(task.id)}
                disabled={rejectMutation.isPending}
                data-testid={`reject-task-${task.id}`}
              >
                <XCircle className="w-3 h-3 mr-1" />
                Reject
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function HeartbeatPage() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [showDelegation, setShowDelegation] = useState(false);
  const [editingTask, setEditingTask] = useState<HeartbeatTask | null>(null);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);

  const statusQuery = useQuery<HeartbeatStatus>({
    queryKey: ["/api/heartbeat/status"],
    refetchInterval: 10000,
  });
  const status = statusQuery.data;

  const { data: tasks } = useQuery<HeartbeatTask[]>({
    queryKey: ["/api/heartbeat/tasks"],
  });

  const { data: logs } = useQuery<HeartbeatLog[]>({
    queryKey: ["/api/heartbeat/logs"],
    refetchInterval: 15000,
  });

  const { data: personasData } = useQuery<PersonaInfo[]>({
    queryKey: ["/api/personas"],
  });
  const personas = personasData || [];

  if (statusQuery.isError) return <ErrorState title="Heartbeat Error" message="Failed to load heartbeat status. Please try again." onRetry={() => statusQuery.refetch()} />;

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("PATCH", `/api/heartbeat/tasks/${id}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/status"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/heartbeat/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/status"] });
      toast({ description: "Task deleted" });
    },
  });

  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/heartbeat/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/status"] });
      toast({ description: "Heartbeat started" });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/heartbeat/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/status"] });
      toast({ description: "Heartbeat stopped" });
    },
  });

  const deployTemplateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/heartbeat/tasks", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/heartbeat/status"] });
      toast({ description: "Template deployed successfully" });
    },
    onError: () => toast({ description: "Failed to deploy template", variant: "destructive" }),
  });

  const handleDeployTemplate = (template: TaskTemplate, personaId: number | null) => {
    deployTemplateMutation.mutate({
      name: template.name,
      description: template.description,
      type: template.type,
      cronExpression: template.cronExpression,
      model: template.model,
      promptContent: template.promptContent,
      enabled: true,
      personaId,
      createdBy: "user",
    });
  };

  const filteredTasks = selectedAgent !== null
    ? (tasks || []).filter(t => t.personaId === selectedAgent)
    : (tasks || []);

  const systemTasks = (tasks || []).filter(t => !t.personaId);
  const agentTasks = (tasks || []).filter(t => t.personaId);

  const filteredLogs = selectedAgent !== null
    ? (logs || []).filter(l => l.personaId === selectedAgent)
    : (logs || []);

  const selectedPersonaName = selectedAgent !== null
    ? personas.find(p => p.id === selectedAgent)?.name || "Unknown"
    : null;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
              <Heart className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold" data-testid="text-heartbeat-title">Heartbeat</h1>
              <p className="text-sm text-muted-foreground">Multi-agent task engine — delegate, schedule, and monitor</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowDelegation(!showDelegation); setShowForm(false); setEditingTask(null); }}
              data-testid="button-delegate-task"
            >
              <Send className="w-3 h-3 mr-1" /> Delegate
            </Button>
            {status?.running ? (
              <Button variant="outline" size="sm" onClick={() => stopMutation.mutate()} data-testid="button-stop-heartbeat">
                <Square className="w-3 h-3 mr-1" /> Stop
              </Button>
            ) : (
              <Button size="sm" onClick={() => startMutation.mutate()} data-testid="button-start-heartbeat">
                <Play className="w-3 h-3 mr-1" /> Start
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <Activity className={`w-4 h-4 ${status?.running ? "text-green-500 animate-pulse" : "text-muted-foreground"}`} />
                <div>
                  <div className="text-lg font-bold" data-testid="text-heartbeat-status">{status?.running ? "Running" : "Stopped"}</div>
                  <div className="text-xs text-muted-foreground">Engine</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-lg font-bold" data-testid="text-agent-count">{status?.agents?.length || 0}</div>
              <div className="text-xs text-muted-foreground">Agents</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-lg font-bold" data-testid="text-enabled-tasks">{status?.enabledTasks || 0} / {status?.totalTasks || 0}</div>
              <div className="text-xs text-muted-foreground">Active Tasks</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-lg font-bold" data-testid="text-recent-runs">{logs?.length || 0}</div>
              <div className="text-xs text-muted-foreground">Total Runs</div>
            </CardContent>
          </Card>
        </div>

        {showDelegation && (
          <DelegationForm
            personas={personas}
            onClose={() => setShowDelegation(false)}
          />
        )}

        {status?.agents && status.agents.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" /> Agent Roster
              </CardTitle>
              <CardDescription className="text-xs">
                Each persona operates as an independent agent with its own task queue
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedAgent === null ? "bg-primary/10 border-primary/30" : "bg-card hover:bg-accent/50"}`}
                  onClick={() => setSelectedAgent(null)}
                  data-testid="agent-card-all"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                      <Users className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">All Agents</div>
                      <div className="text-xs text-muted-foreground">{status.totalTasks} total tasks</div>
                    </div>
                  </div>
                </div>
                {status.agents.map((agent) => (
                  <div
                    key={agent.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedAgent === agent.id ? "bg-primary/10 border-primary/30" : "bg-card hover:bg-accent/50"}`}
                    onClick={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}
                    data-testid={`agent-card-${agent.id}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Bot className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <div className="font-medium text-sm flex items-center gap-1.5">
                            {agent.name}
                            {agent.isActive && <Badge variant="default" className="text-[10px] px-1 py-0">Active</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground">{agent.role}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold">{agent.enabledTasks}/{agent.totalTasks}</div>
                        <div className="text-xs text-muted-foreground">tasks</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <PendingApprovals />

        <Tabs defaultValue="tasks">
          <TabsList className="w-full">
            <TabsTrigger value="tasks" className="flex-1" data-testid="tab-tasks">
              <Clock className="w-3 h-3 mr-1" />
              Tasks {selectedPersonaName ? `(${selectedPersonaName})` : ""}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">{filteredTasks.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="templates" className="flex-1" data-testid="tab-templates">
              <LayoutTemplate className="w-3 h-3 mr-1" />
              Templates
              <Badge variant="secondary" className="ml-1.5 text-[10px]">{TASK_TEMPLATES.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex-1" data-testid="tab-logs">
              <Activity className="w-3 h-3 mr-1" />
              Run Log
              <Badge variant="secondary" className="ml-1.5 text-[10px]">{filteredLogs.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="mt-4 space-y-3">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => { setShowForm(true); setEditingTask(null); setShowDelegation(false); }} data-testid="button-new-task">
                <Plus className="w-3 h-3 mr-1" /> New Task
              </Button>
            </div>

            {(showForm || editingTask) && (
              <TaskForm
                onClose={() => { setShowForm(false); setEditingTask(null); }}
                existing={editingTask || undefined}
                personas={personas}
              />
            )}

            {filteredTasks.length > 0 ? (
              filteredTasks.map((task) => {
                const taskPersona = personas.find(p => p.id === task.personaId);
                const isDelegated = task.type === "delegation" || task.createdBy.startsWith("persona:") || task.createdBy.startsWith("task:");
                return (
                  <div key={task.id} className={`flex items-start justify-between p-3 rounded-lg border bg-card ${isDelegated ? "border-orange-500/20" : ""}`} data-testid={`heartbeat-task-${task.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{task.name}</span>
                        {taskPersona && (
                          <Badge variant="outline" className="text-[10px] border-primary/30">
                            <Bot className="w-2.5 h-2.5 mr-0.5" /> {taskPersona.name}
                          </Badge>
                        )}
                        {!taskPersona && (
                          <Badge variant="outline" className="text-[10px]">System</Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px]">{task.type}</Badge>
                        {isDelegated && (
                          <Badge className="text-[10px] bg-orange-500/20 text-orange-400 border-orange-500/30" variant="outline">
                            <ArrowRight className="w-2.5 h-2.5 mr-0.5" /> delegated
                          </Badge>
                        )}
                        {task.runOnce && (
                          <Badge className="text-[10px] bg-blue-500/20 text-blue-400 border-blue-500/30" variant="outline">one-shot</Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">{CRON_PRESETS.find((p) => p.value === task.cronExpression)?.label || task.cronExpression}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{task.description}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        <span>Model: {task.model}</span>
                        {task.lastRunAt && (
                          <span>Last run: {formatDistanceToNow(new Date(task.lastRunAt), { addSuffix: true })}</span>
                        )}
                        {task.nextRunAt && (
                          <span>Next: {formatDistanceToNow(new Date(task.nextRunAt), { addSuffix: true })}</span>
                        )}
                        {task.createdBy !== "user" && (
                          <span className="text-orange-400">Created by: {task.createdBy}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-3 shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingTask(task); setShowForm(false); setShowDelegation(false); }}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(task.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                      <Switch
                        checked={task.enabled}
                        onCheckedChange={(enabled) => toggleMutation.mutate({ id: task.id, enabled })}
                        data-testid={`switch-task-${task.id}`}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-6 text-muted-foreground text-sm">
                {selectedAgent !== null
                  ? `No tasks assigned to ${selectedPersonaName}. Delegate a task or create one.`
                  : "No heartbeat tasks yet. Create one to get started."}
              </div>
            )}
          </TabsContent>

          <TabsContent value="templates" className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Pre-built agent workflows ready to deploy with one click
              </p>
            </div>
            {TASK_TEMPLATES.map((template) => (
              <TaskTemplate
                key={template.id}
                template={template}
                personas={personas}
                onDeploy={handleDeployTemplate}
              />
            ))}
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            {filteredLogs.length > 0 ? (
              <div className="space-y-2">
                {filteredLogs.slice(0, 30).map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-lg border bg-card cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                    data-testid={`heartbeat-log-${log.id}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {log.status === "success" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-destructive" />
                        )}
                        <span className="text-sm font-medium">{log.taskName}</span>
                        {log.personaName && (
                          <Badge variant="outline" className="text-[10px] border-primary/30">
                            <Bot className="w-2.5 h-2.5 mr-0.5" /> {log.personaName}
                          </Badge>
                        )}
                        {log.model && <Badge variant="outline" className="text-[10px]">{log.model}</Badge>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {log.durationMs && <span>{log.durationMs}ms</span>}
                        <span>{formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}</span>
                      </div>
                    </div>
                    {log.delegatedTasks && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <ArrowRight className="w-3 h-3 text-orange-400" />
                        <span className="text-xs text-orange-400">{log.delegatedTasks}</span>
                      </div>
                    )}
                    {expandedLog === log.id && log.output && (
                      <div className="mt-2 p-2 rounded bg-muted text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {log.output}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground text-sm">
                {selectedAgent !== null
                  ? `No runs yet for ${selectedPersonaName}.`
                  : "No heartbeat runs yet. Tasks will execute on their schedule."}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
