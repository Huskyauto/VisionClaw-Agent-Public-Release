import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Activity, CheckCircle2, AlertCircle, ChevronUp, ChevronDown } from "lucide-react";

interface ActivityItem {
  id: number;
  agent: string;
  icon: string;
  task: string;
  status: "running" | "done" | "failed";
  durationMs: number;
  startedAt: string;
  completedAt: string | null;
}

interface PulseData {
  alive: boolean;
  heartbeatRunning: boolean;
  activeCount: number;
  active: ActivityItem[];
  recent: ActivityItem[];
  timestamp: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function truncateTask(task: string, maxLen = 50): string {
  if (task.length <= maxLen) return task;
  return task.slice(0, maxLen - 3) + "...";
}

export default function ActivityPulse() {
  const [expanded, setExpanded] = useState(false);
  const [showPulse, setShowPulse] = useState(false);

  const { data: pulse } = useQuery<PulseData>({
    queryKey: ["/api/activity/pulse"],
    refetchInterval: 4000,
    staleTime: 3000,
  });

  useEffect(() => {
    if (pulse?.activeCount && pulse.activeCount > 0) {
      setShowPulse(true);
    }
  }, [pulse?.activeCount]);

  const hasActivity = pulse && (pulse.activeCount > 0 || (pulse.recent && pulse.recent.length > 0));

  if (!hasActivity && !showPulse) return null;

  const activeItems = pulse?.active || [];
  const recentItems = pulse?.recent || [];
  const isWorking = activeItems.length > 0;

  return (
    <div className="px-4 pb-1" data-testid="activity-pulse">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all duration-300",
          isWorking
            ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
            : "bg-muted/50 border border-border/50 text-muted-foreground hover:bg-muted"
        )}
        data-testid="button-toggle-activity"
      >
        {isWorking ? (
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
        ) : (
          <Activity className="w-3 h-3 shrink-0 opacity-50" />
        )}

        <span className="flex-1 text-left truncate">
          {isWorking
            ? `${activeItems.length} agent${activeItems.length > 1 ? "s" : ""} working — ${activeItems.map(a => `${a.icon} ${a.agent}`).join(", ")}`
            : "Agents idle"
          }
        </span>

        {isWorking && (
          <span className="text-[10px] opacity-70 shrink-0">
            {formatDuration(Math.max(...activeItems.map(a => a.durationMs)))}
          </span>
        )}

        {expanded ? (
          <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
        ) : (
          <ChevronUp className="w-3 h-3 shrink-0 opacity-50" />
        )}
      </button>

      {expanded && (
        <div className="mt-1 rounded-lg border border-border/50 bg-muted/30 overflow-hidden" data-testid="activity-details">
          {activeItems.length > 0 && (
            <div className="px-3 py-2 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Active</div>
              {activeItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2 text-xs" data-testid={`activity-running-${item.id}`}>
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <span className="shrink-0">{item.icon}</span>
                  <span className="font-medium shrink-0">{item.agent}</span>
                  <span className="text-muted-foreground truncate flex-1">{truncateTask(item.task)}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{formatDuration(item.durationMs)}</span>
                </div>
              ))}
            </div>
          )}

          {recentItems.length > 0 && (
            <div className={cn("px-3 py-2 space-y-1.5", activeItems.length > 0 && "border-t border-border/30")}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Recent</div>
              {recentItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2 text-xs text-muted-foreground" data-testid={`activity-recent-${item.id}`}>
                  {item.status === "done" ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-500/60 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3 h-3 text-red-500/60 shrink-0" />
                  )}
                  <span className="shrink-0">{item.icon}</span>
                  <span className="shrink-0">{item.agent}</span>
                  <span className="truncate flex-1">{truncateTask(item.task)}</span>
                  <span className="text-[10px] shrink-0">{formatDuration(item.durationMs)}</span>
                </div>
              ))}
            </div>
          )}

          {activeItems.length === 0 && recentItems.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center">No recent activity</div>
          )}
        </div>
      )}
    </div>
  );
}
