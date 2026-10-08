import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, Bot, User, Settings, Zap, FileText, Mail,
  Clock, ChevronLeft, ChevronRight, Filter
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ActivityEntry {
  id: number;
  tenantId: number;
  actorType: string;
  actorName: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  description: string;
  metadata: any;
  createdAt: string;
}

const ACTION_ICONS: Record<string, any> = {
  team_invite: User,
  api_key_created: Settings,
  tool_executed: Zap,
  presentation_created: FileText,
  email_sent: Mail,
  research_completed: Bot,
};

const ACTION_COLORS: Record<string, string> = {
  team_invite: "bg-blue-500/10 text-blue-500",
  api_key_created: "bg-amber-500/10 text-amber-500",
  tool_executed: "bg-emerald-500/10 text-emerald-500",
  presentation_created: "bg-violet-500/10 text-violet-500",
  email_sent: "bg-cyan-500/10 text-cyan-500",
  research_completed: "bg-rose-500/10 text-rose-500",
};

export default function ActivityPage() {
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const limit = 30;

  const queryParams = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
  if (actorFilter !== "all") queryParams.set("actorType", actorFilter);

  const { data, isLoading } = useQuery<{ data: ActivityEntry[]; total: number }>({
    queryKey: ["/api/activity", actorFilter, page],
    queryFn: async () => {
      const res = await authFetch(`/api/activity?${queryParams}`);
      if (!res.ok) throw new Error("Failed to load activity");
      return res.json();
    },
  });

  const entries = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-activity-title">
            <Activity className="w-6 h-6 text-primary" />
            Activity Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Complete audit trail of all platform actions
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Select value={actorFilter} onValueChange={(v) => { setActorFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[140px]" data-testid="select-actor-filter">
                <SelectValue placeholder="All actors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actors</SelectItem>
                <SelectItem value="agent">AI Agent</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Badge variant="secondary" data-testid="text-total-entries">{total} entries</Badge>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-start gap-4">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No activity yet</p>
              <p className="text-sm">Actions will appear here as you use the platform</p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
              <div className="space-y-1">
                {entries.map((entry) => {
                  const IconComp = ACTION_ICONS[entry.action] || Activity;
                  const colorClass = ACTION_COLORS[entry.action] || "bg-muted text-muted-foreground";
                  return (
                    <div key={entry.id} className="relative flex items-start gap-4 py-3 pl-1" data-testid={`row-activity-${entry.id}`}>
                      <div className={`relative z-10 flex items-center justify-center w-10 h-10 rounded-full ${colorClass}`}>
                        <IconComp className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{entry.actorName}</span>
                          <Badge variant="outline" className="text-xs">{entry.action.replace(/_/g, " ")}</Badge>
                          {entry.resourceType && (
                            <span className="text-xs text-muted-foreground">
                              on {entry.resourceType} {entry.resourceId ? `#${entry.resourceId}` : ""}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{entry.description}</p>
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                data-testid="button-next-page"
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}