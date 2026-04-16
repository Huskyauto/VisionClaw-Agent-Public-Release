import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  FlaskConical, Plus, Play, Square, Trash2, Eye, CheckCircle2,
  XCircle, AlertTriangle, Moon, Loader2, BarChart3, Clock, Beaker,
  TrendingUp, ArrowRight, PlayCircle, Calendar, Settings2, Pencil,
  Code2, ThumbsUp, ThumbsDown, FileCode, ShieldCheck, Brain, Copy, Check,
} from "lucide-react";

const COST_MODELS = [
  { id: "z-ai/glm-5-turbo", label: "GLM-5 Turbo (Fast)", cost: "$" },
  { id: "z-ai/glm-5", label: "GLM-5 (Flagship)", cost: "$$" },
  { id: "z-ai/glm-4.7", label: "GLM-4.7 (Code/Science)", cost: "$$" },
  { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super (Reasoning)", cost: "$$" },
  { id: "deepseek/deepseek-r1", label: "DeepSeek R1 (Deep Reasoning)", cost: "$$" },
  { id: "mistralai/mistral-large-2512", label: "Mistral Large 3 (Quality)", cost: "$$" },
];

const STRATEGIES = [
  { id: "conservative", label: "Conservative", desc: "Small, incremental changes" },
  { id: "balanced", label: "Balanced", desc: "Mix of incremental and bold" },
  { id: "aggressive", label: "Aggressive", desc: "Bold, creative experiments" },
];

const SCHEDULE_PRESETS = [
  { id: "0 2 * * *", label: "Nightly at 2:00 AM" },
  { id: "0 0 * * *", label: "Nightly at Midnight" },
  { id: "0 3 * * *", label: "Nightly at 3:00 AM" },
  { id: "0 6 * * *", label: "Every Morning at 6:00 AM" },
  { id: "0 22 * * *", label: "Every Evening at 10:00 PM" },
  { id: "0 2 * * 1", label: "Weekly Monday at 2:00 AM" },
  { id: "0 2 * * 1,4", label: "Mon & Thu at 2:00 AM" },
  { id: "0 */6 * * *", label: "Every 6 Hours" },
  { id: "0 */12 * * *", label: "Every 12 Hours" },
];

const TIMEZONES = [
  { id: "America/Chicago", label: "Central (Chicago)" },
  { id: "America/New_York", label: "Eastern (New York)" },
  { id: "America/Denver", label: "Mountain (Denver)" },
  { id: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { id: "UTC", label: "UTC" },
];

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: any; label: string }> = {
    keep: { variant: "default", icon: CheckCircle2, label: "Keep" },
    discard: { variant: "secondary", icon: XCircle, label: "Discard" },
    crash: { variant: "destructive", icon: AlertTriangle, label: "Crash" },
    running: { variant: "outline", icon: Loader2, label: "Running" },
    completed: { variant: "default", icon: CheckCircle2, label: "Completed" },
    stopped_manually: { variant: "secondary", icon: Square, label: "Stopped" },
    stopped_failures: { variant: "destructive", icon: AlertTriangle, label: "Failed" },
  };
  const c = config[status] || { variant: "outline" as const, icon: Clock, label: status };
  const Icon = c.icon;
  return (
    <Badge variant={c.variant} className="gap-1" data-testid={`badge-status-${status}`}>
      <Icon className={`w-3 h-3 ${status === "running" ? "animate-spin" : ""}`} />
      {c.label}
    </Badge>
  );
}

function StatsCards({ stats }: { stats: any }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card data-testid="card-stat-programs">
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Beaker className="w-3.5 h-3.5" /> Programs
          </div>
          <div className="text-2xl font-bold">{stats.programs}</div>
        </CardContent>
      </Card>
      <Card data-testid="card-stat-sessions">
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Moon className="w-3.5 h-3.5" /> Sessions
          </div>
          <div className="text-2xl font-bold">{stats.totalSessions}</div>
          {stats.activeSessions > 0 && (
            <div className="text-xs text-green-500 flex items-center gap-1 mt-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              {stats.activeSessions} active
            </div>
          )}
        </CardContent>
      </Card>
      <Card data-testid="card-stat-experiments">
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <FlaskConical className="w-3.5 h-3.5" /> Experiments
          </div>
          <div className="text-2xl font-bold">{stats.totalExperiments}</div>
        </CardContent>
      </Card>
      <Card data-testid="card-stat-keeprate">
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <TrendingUp className="w-3.5 h-3.5" /> Keep Rate
          </div>
          <div className="text-2xl font-bold">
            {stats.totalExperiments > 0
              ? `${Math.round((stats.experimentsKept / stats.totalExperiments) * 100)}%`
              : "—"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProgramForm({
  initial, onSubmit, onCancel, personas,
}: {
  initial?: any;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  personas: any[];
}) {
  const [name, setName] = useState(initial?.name || "");
  const [objective, setObjective] = useState(initial?.objective || "");
  const [constraints, setConstraints] = useState(initial?.constraints || "");
  const [metrics, setMetrics] = useState(initial?.metrics || "");
  const [strategy, setStrategy] = useState(initial?.exploration_strategy || "balanced");
  const [model, setModel] = useState(initial?.model || "z-ai/glm-5-turbo");
  const [maxExp, setMaxExp] = useState(String(initial?.max_experiments_per_session || 20));
  const [personaId, setPersonaId] = useState(String(initial?.persona_id || ""));

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">Program Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Market Analysis Deep Dive"
          data-testid="input-program-name"
        />
      </div>
      <div>
        <label className="text-sm font-medium">Research Objective</label>
        <Textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="What should this research program investigate? Be specific about the goal..."
          rows={3}
          data-testid="input-program-objective"
        />
      </div>
      <div>
        <label className="text-sm font-medium">Constraints</label>
        <Textarea
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          placeholder="Any boundaries or rules the experiments must follow..."
          rows={2}
          data-testid="input-program-constraints"
        />
      </div>
      <div>
        <label className="text-sm font-medium">Success Metrics</label>
        <Input
          value={metrics}
          onChange={(e) => setMetrics(e.target.value)}
          placeholder="How should experiment quality be evaluated?"
          data-testid="input-program-metrics"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Exploration Strategy</label>
          <Select value={strategy} onValueChange={setStrategy}>
            <SelectTrigger data-testid="select-strategy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STRATEGIES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label} — {s.desc}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium">Model</label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger data-testid="select-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COST_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label} ({m.cost})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Max Experiments Per Session</label>
          <Input
            type="number"
            value={maxExp}
            onChange={(e) => setMaxExp(e.target.value)}
            min={1}
            max={100}
            data-testid="input-max-experiments"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Assigned Persona</label>
          <Select value={personaId} onValueChange={setPersonaId}>
            <SelectTrigger data-testid="select-persona">
              <SelectValue placeholder="None (general)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (general research)</SelectItem>
              {personas.map((p: any) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name} — {p.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-program">
          Cancel
        </Button>
        <Button
          onClick={() =>
            onSubmit({
              name, objective, constraints, metrics,
              explorationStrategy: strategy, model,
              maxExperimentsPerSession: parseInt(maxExp) || 20,
              personaId: personaId && personaId !== "none" ? parseInt(personaId) : null,
            })
          }
          disabled={!name.trim() || !objective.trim()}
          data-testid="button-save-program"
        >
          {initial ? "Update" : "Create"} Program
        </Button>
      </DialogFooter>
    </div>
  );
}

function ScheduleForm({
  initial, programs, onSubmit, onCancel,
}: {
  initial?: any;
  programs: any[];
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [cronExpression, setCronExpression] = useState(initial?.cron_expression || "0 2 * * *");
  const [timezone, setTimezone] = useState(initial?.timezone || "America/Chicago");
  const [runAll, setRunAll] = useState(initial?.run_all ?? true);
  const [programId, setProgramId] = useState(String(initial?.program_id || ""));

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">Schedule Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Nightly Research Run"
          data-testid="input-schedule-name"
        />
      </div>
      <div>
        <label className="text-sm font-medium">When to Run</label>
        <Select value={cronExpression} onValueChange={setCronExpression}>
          <SelectTrigger data-testid="select-schedule-time">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCHEDULE_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">Cron: {cronExpression}</p>
      </div>
      <div>
        <label className="text-sm font-medium">Timezone</label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger data-testid="select-timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz.id} value={tz.id}>{tz.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm font-medium">What to Run</label>
        <div className="flex items-center gap-3 mt-2">
          <Switch
            checked={runAll}
            onCheckedChange={setRunAll}
            data-testid="switch-run-all"
          />
          <span className="text-sm">{runAll ? "Run All Programs" : "Run Specific Program"}</span>
        </div>
      </div>
      {!runAll && (
        <div>
          <label className="text-sm font-medium">Select Program</label>
          <Select value={programId} onValueChange={setProgramId}>
            <SelectTrigger data-testid="select-schedule-program">
              <SelectValue placeholder="Choose a program..." />
            </SelectTrigger>
            <SelectContent>
              {programs.map((p: any) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-schedule">Cancel</Button>
        <Button
          onClick={() => onSubmit({
            name,
            cronExpression,
            timezone,
            runAll,
            programId: runAll ? null : (programId ? parseInt(programId) : null),
          })}
          disabled={!name.trim() || (!runAll && !programId)}
          data-testid="button-save-schedule"
        >
          {initial ? "Update" : "Create"} Schedule
        </Button>
      </DialogFooter>
    </div>
  );
}

function ExperimentRow({ exp }: { exp: any }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const parts: string[] = [];
    parts.push(`Hypothesis: ${exp.hypothesis}`);
    if (exp.approach) parts.push(`\nApproach:\n${exp.approach}`);
    if (exp.result) parts.push(`\nResult:\n${exp.result}`);
    if (exp.metric_value) parts.push(`\nScore: ${exp.metric_value}/10`);
    if (exp.model) parts.push(`Model: ${exp.model}`);
    navigator.clipboard.writeText(parts.join("\n")).then(() => {
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="border rounded-lg p-3 hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => setExpanded(!expanded)}
      data-testid={`card-experiment-${exp.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{exp.hypothesis}</p>
          <p className="text-xs text-muted-foreground">
            {exp.program_name && <span className="mr-2">{exp.program_name}</span>}
            {exp.model && <span className="text-xs opacity-60">{exp.model}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {exp.metric_value && (
            <span className="text-sm font-mono font-bold">{exp.metric_value}/10</span>
          )}
          <StatusBadge status={exp.status} />
        </div>
      </div>
      {expanded && exp.result && (
        <div className="mt-3 pt-3 border-t">
          <div className="flex justify-end mb-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleCopy}
              data-testid={`button-copy-experiment-${exp.id}`}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy Details"}
            </Button>
          </div>
          {exp.approach && (
            <div className="mb-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">Approach</p>
              <p className="text-sm">{exp.approach}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Result</p>
            <p className="text-sm whitespace-pre-wrap">{exp.result}</p>
          </div>
          {exp.duration_ms && (
            <p className="text-xs text-muted-foreground mt-2">
              Duration: {(exp.duration_ms / 1000).toFixed(1)}s
              {exp.tokens_used ? ` | Tokens: ${exp.tokens_used.toLocaleString()}` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SessionCard({
  session, onStop,
}: {
  session: any;
  onStop: (id: number) => void;
}) {
  const [showDetail, setShowDetail] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["/api/research/sessions", session.id],
    enabled: showDetail,
    refetchInterval: session.isLive ? 5000 : false,
  });

  const detail = detailQuery.data as any;

  return (
    <Card data-testid={`card-session-${session.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{session.program_name}</CardTitle>
          <div className="flex items-center gap-2">
            <StatusBadge status={session.status} />
            {session.isLive && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onStop(session.id)}
                data-testid={`button-stop-session-${session.id}`}
              >
                <Square className="w-3 h-3 mr-1" /> Stop
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 text-sm text-muted-foreground mb-2">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            {session.experiments_kept || 0} kept
          </span>
          <span className="flex items-center gap-1">
            <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
            {session.experiments_discarded || 0} discarded
          </span>
          <span className="flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
            {session.experiments_crashed || 0} crashed
          </span>
          <span className="text-xs opacity-60">{session.model}</span>
        </div>
        {session.summary && !showDetail && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{session.summary}</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => setShowDetail(!showDetail)}
          data-testid={`button-detail-session-${session.id}`}
        >
          <Eye className="w-3 h-3 mr-1" /> {showDetail ? "Hide" : "View"} Details
        </Button>
        {showDetail && detail && (
          <div className="mt-3 space-y-2 max-h-96 overflow-y-auto">
            {detail.session?.summary && (
              <div className="p-3 bg-muted/50 rounded-lg text-sm whitespace-pre-wrap mb-3">
                {detail.session.summary}
              </div>
            )}
            {(detail.experiments || []).map((exp: any) => (
              <ExperimentRow key={exp.id} exp={exp} />
            ))}
            {(!detail.experiments || detail.experiments.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">No experiments yet</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleCard({
  schedule, onToggle, onEdit, onDelete,
}: {
  schedule: any;
  onToggle: (id: number, enabled: boolean) => void;
  onEdit: (schedule: any) => void;
  onDelete: (id: number) => void;
}) {
  const presetLabel = SCHEDULE_PRESETS.find(p => p.id === schedule.cron_expression)?.label || schedule.cron_expression;
  const tzLabel = TIMEZONES.find(t => t.id === schedule.timezone)?.label || schedule.timezone;

  return (
    <Card className={!schedule.is_enabled ? "opacity-60" : ""} data-testid={`card-schedule-${schedule.id}`}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-violet-500" />
            <span className="font-medium text-sm">{schedule.name}</span>
            {schedule.run_all ? (
              <Badge variant="default" className="text-xs">All Programs</Badge>
            ) : (
              <Badge variant="outline" className="text-xs">{schedule.program_name || "Specific"}</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={schedule.is_enabled}
              onCheckedChange={(checked) => onToggle(schedule.id, checked)}
              data-testid={`switch-enable-schedule-${schedule.id}`}
            />
            <Button size="sm" variant="ghost" onClick={() => onEdit(schedule)} data-testid={`button-edit-schedule-${schedule.id}`}>
              <Pencil className="w-3 h-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDelete(schedule.id)} data-testid={`button-delete-schedule-${schedule.id}`}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" /> {presetLabel}
          </span>
          <span>{tzLabel}</span>
          {schedule.last_run_at && (
            <span>Last: {new Date(schedule.last_run_at).toLocaleString()}</span>
          )}
          {schedule.next_run_at && schedule.is_enabled && (
            <span className="text-green-500">Next: {new Date(schedule.next_run_at).toLocaleString()}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ResearchPage() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editProgram, setEditProgram] = useState<any>(null);
  const [createScheduleOpen, setCreateScheduleOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<any>(null);
  const [tab, setTab] = useState("programs");

  const statsQuery = useQuery({ queryKey: ["/api/research/stats"], refetchInterval: 10000 });
  const programsQuery = useQuery({ queryKey: ["/api/research/programs"] });
  const sessionsQuery = useQuery({ queryKey: ["/api/research/sessions"], refetchInterval: 10000 });
  const experimentsQuery = useQuery({ queryKey: ["/api/research/experiments"] });
  const personasQuery = useQuery({ queryKey: ["/api/personas"] });
  const schedulesQuery = useQuery({ queryKey: ["/api/research/schedules"] });
  const proposalsQuery = useQuery({ queryKey: ["/api/research/code-proposals"], refetchInterval: 30000 });

  const stats = (statsQuery.data || { programs: 0, totalSessions: 0, activeSessions: 0, totalExperiments: 0, experimentsKept: 0, experimentsDiscarded: 0 }) as any;
  const programs = (programsQuery.data || []) as any[];
  const sessions = (sessionsQuery.data || []) as any[];
  const experiments = (experimentsQuery.data || []) as any[];
  const personas = (personasQuery.data || []) as any[];
  const schedules = (schedulesQuery.data || []) as any[];
  const proposals = (proposalsQuery.data || []) as any[];

  const createProgram = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/research/programs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/programs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/stats"] });
      setCreateOpen(false);
      toast({ title: "Research program created" });
    },
  });

  const updateProgram = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/research/programs/${data.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/programs"] });
      setEditProgram(null);
      toast({ title: "Program updated" });
    },
  });

  const deleteProgram = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/research/programs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/programs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/stats"] });
      toast({ title: "Program deleted" });
    },
  });

  const startSession = useMutation({
    mutationFn: (programId: number) => apiRequest("POST", "/api/research/sessions/start", { programId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/stats"] });
      toast({ title: "Research session started", description: "The autonomous loop is now running experiments." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to start session", description: err.message, variant: "destructive" });
    },
  });

  const startAll = useMutation({
    mutationFn: () => apiRequest("POST", "/api/research/sessions/start-all"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/stats"] });
      toast({
        title: "Batch research started",
        description: `Started ${data.started} session(s)${data.failed ? `, ${data.failed} failed` : ""}`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to start batch", description: err.message, variant: "destructive" });
    },
  });

  const stopSession = useMutation({
    mutationFn: (sessionId: number) => apiRequest("POST", `/api/research/sessions/${sessionId}/stop`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/stats"] });
      toast({ title: "Session stopped" });
    },
  });

  const createSchedule = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/research/schedules", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/schedules"] });
      setCreateScheduleOpen(false);
      toast({ title: "Schedule created" });
    },
  });

  const updateSchedule = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/research/schedules/${data.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/schedules"] });
      setEditSchedule(null);
      toast({ title: "Schedule updated" });
    },
  });

  const toggleSchedule = useMutation({
    mutationFn: ({ id, isEnabled }: { id: number; isEnabled: boolean }) =>
      apiRequest("PUT", `/api/research/schedules/${id}`, { isEnabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/schedules"] });
    },
  });

  const deleteSchedule = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/research/schedules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/schedules"] });
      toast({ title: "Schedule deleted" });
    },
  });

  const reviewProposal = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/research/code-proposals/${id}`, { status }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/code-proposals"] });
      toast({ title: `Proposal ${vars.status}` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update proposal", description: err.message || "Unknown error", variant: "destructive" });
    },
  });

  const applyProposal = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/research/code-proposals/${id}/apply`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/code-proposals"] });
      if (data.success) {
        toast({ title: "Proposal applied successfully", description: "Compile check passed. Change is live." });
      } else {
        toast({
          title: data.reverted ? "Auto-reverted — change failed" : "Apply failed",
          description: `Stage: ${data.stage}. ${data.error || ""}`,
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Apply failed", description: err.message || "Unknown error", variant: "destructive" });
    },
  });

  const revertProposalMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/research/code-proposals/${id}/revert`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/code-proposals"] });
      if (data.success) {
        toast({ title: "Proposal reverted", description: "Original code restored." });
      } else {
        toast({ title: "Revert failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Revert failed", description: err.message || "Unknown error", variant: "destructive" });
    },
  });

  const [expandedProposal, setExpandedProposal] = useState<number | null>(null);
  const pendingProposalCount = proposals.filter((p: any) => p.status === "ready" || p.status === "pending" || p.status === "needs_review").length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-violet-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Deep Research</h1>
              <p className="text-sm text-muted-foreground">
                Autonomous experiment loops — define a research program, let the AI run overnight
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stats.activeSessions > 0 && (
              <Badge variant="outline" className="gap-1.5 py-1.5 px-3 text-green-500 border-green-500/30">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                {stats.activeSessions} session{stats.activeSessions > 1 ? "s" : ""} running
              </Badge>
            )}
            {programs.length > 0 && (
              <Button
                onClick={() => startAll.mutate()}
                disabled={startAll.isPending || programs.length === 0}
                className="bg-violet-600 hover:bg-violet-700"
                data-testid="button-run-all"
              >
                {startAll.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <PlayCircle className="w-4 h-4 mr-1" />
                )}
                Run All Programs
              </Button>
            )}
          </div>
        </div>

        <StatsCards stats={stats} />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList data-testid="tabs-research">
            <TabsTrigger value="programs" data-testid="tab-programs">
              <Beaker className="w-4 h-4 mr-1" /> Programs
            </TabsTrigger>
            <TabsTrigger value="sessions" data-testid="tab-sessions">
              <Moon className="w-4 h-4 mr-1" /> Sessions
            </TabsTrigger>
            <TabsTrigger value="experiments" data-testid="tab-experiments">
              <FlaskConical className="w-4 h-4 mr-1" /> All Experiments
            </TabsTrigger>
            <TabsTrigger value="schedules" data-testid="tab-schedules">
              <Calendar className="w-4 h-4 mr-1" /> Schedules
            </TabsTrigger>
            <TabsTrigger value="proposals" data-testid="tab-proposals" className="relative">
              <Code2 className="w-4 h-4 mr-1" /> Code Proposals
              {pendingProposalCount > 0 && (
                <span className="ml-1.5 bg-orange-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{pendingProposalCount}</span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="programs" className="space-y-4 mt-4">
            <div className="flex justify-end">
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-create-program">
                    <Plus className="w-4 h-4 mr-1" /> New Research Program
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Create Research Program</DialogTitle>
                  </DialogHeader>
                  <ProgramForm
                    personas={personas}
                    onSubmit={(data) => createProgram.mutate(data)}
                    onCancel={() => setCreateOpen(false)}
                  />
                </DialogContent>
              </Dialog>
            </div>

            {programsQuery.isLoading && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {programs.length === 0 && !programsQuery.isLoading && (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <FlaskConical className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
                  <h3 className="font-medium mb-1">No research programs yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create a program to define what your AI agents should investigate autonomously.
                  </p>
                  <Button onClick={() => setCreateOpen(true)} data-testid="button-create-first-program">
                    <Plus className="w-4 h-4 mr-1" /> Create Your First Program
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-4">
              {programs.map((prog: any) => (
                <Card key={prog.id} data-testid={`card-program-${prog.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{prog.name}</CardTitle>
                        {prog.persona_name && (
                          <Badge variant="outline" className="text-xs">{prog.persona_name}</Badge>
                        )}
                        {!prog.is_active && <Badge variant="secondary">Inactive</Badge>}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => startSession.mutate(prog.id)}
                          disabled={startSession.isPending}
                          data-testid={`button-start-session-${prog.id}`}
                        >
                          <Play className="w-3 h-3 mr-1" /> Run
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditProgram(prog)}
                          data-testid={`button-edit-program-${prog.id}`}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteProgram.mutate(prog.id)}
                          data-testid={`button-delete-program-${prog.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-2">{prog.objective}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-xs">
                        {STRATEGIES.find((s) => s.id === prog.exploration_strategy)?.label || prog.exploration_strategy}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {COST_MODELS.find((m) => m.id === prog.model)?.label?.split("(")[0]?.trim() || prog.model}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        Max {prog.max_experiments_per_session} experiments
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Dialog open={!!editProgram} onOpenChange={(o) => !o && setEditProgram(null)}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Edit Research Program</DialogTitle>
                </DialogHeader>
                {editProgram && (
                  <ProgramForm
                    initial={editProgram}
                    personas={personas}
                    onSubmit={(data) => updateProgram.mutate({ ...data, id: editProgram.id })}
                    onCancel={() => setEditProgram(null)}
                  />
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="sessions" className="space-y-4 mt-4">
            {sessionsQuery.isLoading && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {sessions.length === 0 && !sessionsQuery.isLoading && (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Moon className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
                  <h3 className="font-medium mb-1">No sessions yet</h3>
                  <p className="text-sm text-muted-foreground">
                    Start a research program to begin an autonomous experiment session.
                  </p>
                </CardContent>
              </Card>
            )}
            {sessions.map((s: any) => (
              <SessionCard
                key={s.id}
                session={s}
                onStop={(id) => stopSession.mutate(id)}
              />
            ))}
          </TabsContent>

          <TabsContent value="experiments" className="space-y-3 mt-4">
            {experimentsQuery.isLoading && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {experiments.length === 0 && !experimentsQuery.isLoading && (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <FlaskConical className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
                  <h3 className="font-medium mb-1">No experiments yet</h3>
                  <p className="text-sm text-muted-foreground">
                    Experiments appear here as sessions run.
                  </p>
                </CardContent>
              </Card>
            )}
            <div className="flex gap-2 mb-2">
              <Badge variant="outline" className="text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1 text-green-500" />
                {experiments.filter((e: any) => e.status === "keep").length} Kept
              </Badge>
              <Badge variant="outline" className="text-xs">
                <XCircle className="w-3 h-3 mr-1" />
                {experiments.filter((e: any) => e.status === "discard").length} Discarded
              </Badge>
              <Badge variant="outline" className="text-xs">
                <AlertTriangle className="w-3 h-3 mr-1 text-destructive" />
                {experiments.filter((e: any) => e.status === "crash").length} Crashed
              </Badge>
            </div>
            {experiments.map((exp: any) => (
              <ExperimentRow key={exp.id} exp={exp} />
            ))}
          </TabsContent>

          <TabsContent value="schedules" className="space-y-4 mt-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm text-muted-foreground">
                  Set up automated schedules to run research programs on a recurring basis.
                  The system checks every minute and starts sessions when they're due.
                </p>
              </div>
              <Dialog open={createScheduleOpen} onOpenChange={setCreateScheduleOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-create-schedule">
                    <Plus className="w-4 h-4 mr-1" /> New Schedule
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Create Research Schedule</DialogTitle>
                  </DialogHeader>
                  <ScheduleForm
                    programs={programs}
                    onSubmit={(data) => createSchedule.mutate(data)}
                    onCancel={() => setCreateScheduleOpen(false)}
                  />
                </DialogContent>
              </Dialog>
            </div>

            {schedulesQuery.isLoading && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {schedules.length === 0 && !schedulesQuery.isLoading && (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Calendar className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
                  <h3 className="font-medium mb-1">No schedules yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create a schedule to automatically run research programs at set times — like a nightly batch.
                  </p>
                  <Button onClick={() => setCreateScheduleOpen(true)} data-testid="button-create-first-schedule">
                    <Plus className="w-4 h-4 mr-1" /> Create Your First Schedule
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-3">
              {schedules.map((sched: any) => (
                <ScheduleCard
                  key={sched.id}
                  schedule={sched}
                  onToggle={(id, enabled) => toggleSchedule.mutate({ id, isEnabled: enabled })}
                  onEdit={(s) => setEditSchedule(s)}
                  onDelete={(id) => deleteSchedule.mutate(id)}
                />
              ))}
            </div>

            <Dialog open={!!editSchedule} onOpenChange={(o) => !o && setEditSchedule(null)}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Edit Schedule</DialogTitle>
                </DialogHeader>
                {editSchedule && (
                  <ScheduleForm
                    initial={editSchedule}
                    programs={programs}
                    onSubmit={(data) => updateSchedule.mutate({ ...data, id: editSchedule.id })}
                    onCancel={() => setEditSchedule(null)}
                  />
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="proposals" className="space-y-4 mt-4">
            {proposalsQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : proposals.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Code2 className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
                  <h3 className="text-lg font-medium text-muted-foreground" data-testid="text-no-proposals">No Code Proposals Yet</h3>
                  <p className="text-sm text-muted-foreground/70 mt-2 max-w-md mx-auto">
                    When nightly research discovers high-scoring findings (8+/10) that could improve the platform,
                    the agents will generate concrete code proposals here for your review.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground" data-testid="text-proposal-count">
                    {proposals.length} proposal{proposals.length !== 1 ? "s" : ""} — {pendingProposalCount} awaiting review
                  </p>
                </div>

                {proposals.map((proposal: any) => {
                  const isExpanded = expandedProposal === proposal.id;
                  const validation = proposal.validation_result || {};
                  const personaName = personas.find((p: any) => p.id === proposal.persona_id)?.name || "Unknown";

                  return (
                    <Card
                      key={proposal.id}
                      className={`transition-all ${
                        proposal.status === "approved" ? "border-green-500/30 bg-green-500/5" :
                        proposal.status === "rejected" ? "border-red-500/30 bg-red-500/5 opacity-60" :
                        proposal.status === "applied" ? "border-blue-500/30 bg-blue-500/5" :
                        proposal.status === "failed" ? "border-red-500/30 bg-red-500/5" :
                        proposal.status === "reverted" ? "border-gray-500/30 bg-gray-500/5 opacity-70" :
                        proposal.status === "ready" ? "border-orange-500/30" :
                        "border-yellow-500/30"
                      }`}
                      data-testid={`card-proposal-${proposal.id}`}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <CardTitle className="text-sm font-medium leading-tight">{proposal.title}</CardTitle>
                              <Badge variant={
                                proposal.status === "ready" ? "default" :
                                proposal.status === "approved" ? "default" :
                                proposal.status === "applied" ? "default" :
                                proposal.status === "rejected" ? "destructive" :
                                "secondary"
                              } className={`text-[10px] ${
                                proposal.status === "ready" ? "bg-orange-500" :
                                proposal.status === "approved" ? "bg-green-500" :
                                proposal.status === "applied" ? "bg-blue-500" :
                                proposal.status === "failed" ? "bg-red-600" :
                                proposal.status === "reverted" ? "bg-gray-500" :
                                ""
                              }`} data-testid={`badge-status-${proposal.id}`}>
                                {proposal.status === "ready" ? "Ready for Review" :
                                 proposal.status === "needs_review" ? "Needs Review" :
                                 proposal.status === "failed" ? "Failed (Auto-Reverted)" :
                                 proposal.status === "reverted" ? "Reverted" :
                                 proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Brain className="w-3 h-3" /> {personaName}
                              </span>
                              <span className="flex items-center gap-1">
                                <FileCode className="w-3 h-3" /> {proposal.target_file}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {new Date(proposal.created_at).toLocaleDateString()}
                              </span>
                              {validation.valid && (
                                <span className="flex items-center gap-1 text-green-600">
                                  <ShieldCheck className="w-3 h-3" /> Validated
                                </span>
                              )}
                              {validation.valid === false && (
                                <span className="flex items-center gap-1 text-yellow-600">
                                  <AlertTriangle className="w-3 h-3" /> {validation.error?.substring(0, 40)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setExpandedProposal(isExpanded ? null : proposal.id)}
                              data-testid={`button-expand-${proposal.id}`}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {(proposal.status === "ready" || proposal.status === "pending" || proposal.status === "needs_review") && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                  onClick={() => reviewProposal.mutate({ id: proposal.id, status: "approved" })}
                                  disabled={reviewProposal.isPending}
                                  data-testid={`button-approve-${proposal.id}`}
                                >
                                  <ThumbsUp className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => reviewProposal.mutate({ id: proposal.id, status: "rejected" })}
                                  disabled={reviewProposal.isPending}
                                  data-testid={`button-reject-${proposal.id}`}
                                >
                                  <ThumbsDown className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                            {proposal.status === "approved" && (
                              <Button
                                size="sm"
                                className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1"
                                onClick={() => applyProposal.mutate(proposal.id)}
                                disabled={applyProposal.isPending}
                                data-testid={`button-apply-${proposal.id}`}
                              >
                                {applyProposal.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                                Safe Apply
                              </Button>
                            )}
                            {proposal.status === "applied" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-orange-600 border-orange-300 hover:bg-orange-50 text-xs gap-1"
                                onClick={() => revertProposalMut.mutate(proposal.id)}
                                disabled={revertProposalMut.isPending}
                                data-testid={`button-revert-${proposal.id}`}
                              >
                                {revertProposalMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5 rotate-180" />}
                                Revert
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardHeader>

                      {isExpanded && (
                        <CardContent className="pt-0 space-y-3">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                            <p className="text-sm" data-testid={`text-description-${proposal.id}`}>{proposal.description}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Rationale</p>
                            <p className="text-sm" data-testid={`text-rationale-${proposal.id}`}>{proposal.rationale}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Code Diff</p>
                            <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto" data-testid={`code-diff-${proposal.id}`}>
                              {proposal.code_diff}
                            </pre>
                          </div>
                          {validation && (
                            <div className="flex items-center gap-4 text-xs pt-1 border-t border-border/50">
                              <span>File exists: {validation.fileExists ? <CheckCircle2 className="w-3.5 h-3.5 inline text-green-500" /> : <XCircle className="w-3.5 h-3.5 inline text-red-500" />}</span>
                              <span>Code match: {validation.oldCodeFound ? <CheckCircle2 className="w-3.5 h-3.5 inline text-green-500" /> : <XCircle className="w-3.5 h-3.5 inline text-red-500" />}</span>
                              {proposal.source_session_id && <span>Session: #{proposal.source_session_id}</span>}
                            </div>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
