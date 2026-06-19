import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bot, Brain, Zap, GraduationCap, AlertTriangle, CheckCircle2,
  Clock, Activity, Users, Loader2, TrendingUp, Target
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface AgentLiveStatus {
  personaId: number;
  personaName: string;
  emoji?: string;
  catchphrase?: string;
  status: string;
  activityType: string;
  summary: string;
  conversationId?: number;
  elapsedMs: number;
}

interface ActivityEntry {
  id: number;
  tenantId: number;
  personaId: number | null;
  personaName: string;
  status: string;
  activityType: string;
  summary: string | null;
  conversationId: number | null;
  metadata: any;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

interface ActivitySummaryData {
  totalActivities: number;
  skillsLearned: number;
  orchestrationsRun: number;
  activeAgents: number;
  recentErrors: number;
  agentBreakdown: Record<string, number>;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-500/10 text-green-500 border-green-500/20",
  complete: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  failed: "bg-red-500/10 text-red-500 border-red-500/20",
  idle: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  blocked: "bg-amber-500/10 text-amber-500 border-amber-500/20",
};

const TYPE_ICONS: Record<string, typeof Bot> = {
  chat: Bot,
  orchestration: Target,
  tool_execution: Zap,
  skill_learned: GraduationCap,
  research: Brain,
  heartbeat_task: Clock,
  delegation: Users,
  error_recovery: AlertTriangle,
};

function formatElapsed(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

export default function AgentBoardPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery<ActivitySummaryData>({
    queryKey: ["/api/agent-activity/summary"],
    refetchInterval: 10000,
  });

  const { data: liveAgents, isLoading: liveLoading } = useQuery<AgentLiveStatus[]>({
    queryKey: ["/api/agent-activity/live"],
    refetchInterval: 5000,
  });

  const { data: recentActivity, isLoading: activityLoading } = useQuery<ActivityEntry[]>({
    queryKey: ["/api/agent-activity"],
    refetchInterval: 15000,
  });

  const { data: learnedSkills, isLoading: skillsLoading } = useQuery<ActivityEntry[]>({
    queryKey: ["/api/agent-activity/skills"],
    refetchInterval: 30000,
  });

  return (
    <div className="h-full overflow-y-auto flex flex-col gap-6 p-6 max-w-7xl mx-auto" data-testid="agent-board">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-board-title">Agent Board</h1>
          <p className="text-sm text-muted-foreground">Real-time view of your AI team's activity and learned capabilities</p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Activity className="w-3 h-3" />
          Live
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {summaryLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <Card data-testid="stat-active-agents">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-500">{summary?.activeAgents || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">Active Now</div>
              </CardContent>
            </Card>
            <Card data-testid="stat-skills-learned">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-violet-500">{summary?.skillsLearned || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">Skills Learned</div>
              </CardContent>
            </Card>
            <Card data-testid="stat-orchestrations">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-blue-500">{summary?.orchestrationsRun || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">Orchestrations</div>
              </CardContent>
            </Card>
            <Card data-testid="stat-total">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{summary?.totalActivities || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">Total Activities</div>
              </CardContent>
            </Card>
            <Card data-testid="stat-errors">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-red-500">{summary?.recentErrors || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">Errors (24h)</div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1" data-testid="card-live-agents">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Live Agent Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {liveLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : liveAgents && liveAgents.length > 0 ? (
              <div className="space-y-3">
                {liveAgents.map((agent, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-green-500/5 border-green-500/20"
                    data-testid={`live-agent-${idx}`}
                    title={agent.catchphrase || ""}
                  >
                    <div className="shrink-0 relative">
                      <span className="text-2xl leading-none" data-testid={`emoji-${agent.personaId}`}>{agent.emoji || "🤖"}</span>
                      <Loader2 className="w-3 h-3 text-green-500 animate-spin absolute -bottom-1 -right-1 bg-background rounded-full" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{agent.personaName}</div>
                      <div className="text-xs text-muted-foreground truncate">{agent.summary || agent.activityType}</div>
                      {agent.catchphrase && (
                        <div className="text-[10px] italic text-muted-foreground/70 truncate mt-0.5" data-testid={`catchphrase-${agent.personaId}`}>
                          “{agent.catchphrase}”
                        </div>
                      )}
                    </div>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {formatElapsed(agent.elapsedMs)}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Bot className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">All agents idle</p>
                <p className="text-xs mt-1">Start a conversation to see agents working</p>
              </div>
            )}

            {summary?.agentBreakdown && Object.keys(summary.agentBreakdown).length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-2">All-time agent activity</p>
                <div className="space-y-2">
                  {Object.entries(summary.agentBreakdown)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 8)
                    .map(([name, count]) => (
                      <div key={name} className="flex items-center justify-between text-sm">
                        <span className="truncate">{name}</span>
                        <Badge variant="secondary" className="text-xs">{count}</Badge>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2" data-testid="card-learned-skills">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-violet-500" />
              Auto-Learned Skills
              <Badge variant="secondary" className="text-xs ml-auto">{learnedSkills?.length || 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {skillsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : learnedSkills && learnedSkills.length > 0 ? (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {learnedSkills.map((skill) => {
                  const meta = skill.metadata as any;
                  return (
                    <div
                      key={skill.id}
                      className="p-3 rounded-lg border bg-violet-500/5 border-violet-500/20"
                      data-testid={`learned-skill-${skill.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm">{meta?.skillName || "Unnamed Skill"}</div>
                          <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{skill.summary}</div>
                        </div>
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {skill.createdAt ? formatDistanceToNow(new Date(skill.createdAt), { addSuffix: true }) : ""}
                        </Badge>
                      </div>
                      {meta?.toolsUsed && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {(meta.toolsUsed as string[]).slice(0, 5).map((tool: string, i: number) => (
                            <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                              {tool}
                            </Badge>
                          ))}
                          {meta.toolsUsed.length > 5 && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              +{meta.toolsUsed.length - 5}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No skills learned yet</p>
                <p className="text-xs mt-1">Skills are automatically captured when orchestrations complete successfully</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-recent-activity">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : recentActivity && recentActivity.length > 0 ? (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {recentActivity.map((entry) => {
                const Icon = TYPE_ICONS[entry.activityType] || Bot;
                const statusStyle = STATUS_STYLES[entry.status] || STATUS_STYLES.idle;
                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                    data-testid={`activity-${entry.id}`}
                  >
                    <div className={`p-1.5 rounded-md ${statusStyle}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{entry.personaName}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{entry.activityType.replace(/_/g, " ")}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{entry.summary || "No details"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge variant={entry.status === "complete" ? "default" : entry.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
                        {entry.status}
                      </Badge>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {entry.createdAt ? formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true }) : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No activity recorded yet</p>
              <p className="text-xs mt-1">Agent activities will appear here as they work on tasks</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
