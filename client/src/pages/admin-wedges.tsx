import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, Clock, AlertTriangle, CheckCircle2, FileText, MessageSquare, FolderOpen, Calendar } from "lucide-react";

interface WedgeStatus {
  slug: string;
  label: string;
  priceLabel: string;
  project: null | {
    id: number;
    name: string;
    status: string;
    currentState: string;
    driveFolderUrl: string | null;
    primaryConversationId: number | null;
    updatedAt: string;
  };
  heartbeat: null | {
    name: string;
    lastRunAt: string | null;
    nextRunAt: string | null;
    enabled: boolean;
    cron: string;
    isOverdue: boolean;
  };
  pendingDrafts: number;
  brainPath: string | null;
  nextAction: { label: string; href: string; urgency: "high" | "medium" | "low" };
}

interface Payload {
  tenantId: number;
  computedAt: string;
  wedges: WedgeStatus[];
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(ms);
  const sign = ms >= 0 ? "ago" : "from now";
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ${sign}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ${sign}`;
  const days = Math.round(hrs / 24);
  return `${days}d ${sign}`;
}

function urgencyClasses(u: "high" | "medium" | "low") {
  if (u === "high") return "bg-destructive text-destructive-foreground hover:bg-destructive/90";
  if (u === "medium") return "bg-primary text-primary-foreground hover:bg-primary/90";
  return "bg-secondary text-secondary-foreground hover:bg-secondary/80";
}

function WedgeCard({ w }: { w: WedgeStatus }) {
  const hasProject = !!w.project;
  const overdue = !!w.heartbeat?.isOverdue;

  return (
    <Card
      data-testid={`card-wedge-${w.slug}`}
      className={`flex flex-col ${overdue || w.pendingDrafts > 0 ? "border-destructive/60" : ""}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle data-testid={`text-wedge-label-${w.slug}`} className="text-lg">{w.label}</CardTitle>
            <CardDescription className="mt-1">{w.priceLabel}</CardDescription>
          </div>
          {hasProject ? (
            <Badge variant={w.project!.status === "active" ? "default" : "secondary"} data-testid={`badge-project-status-${w.slug}`}>
              {w.project!.status}
            </Badge>
          ) : (
            <Badge variant="destructive" data-testid={`badge-no-project-${w.slug}`}>
              <AlertTriangle className="h-3 w-3 mr-1" /> not wired
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 text-sm">
        {hasProject && (
          <div className="space-y-1 text-muted-foreground">
            <div data-testid={`text-project-name-${w.slug}`}>
              <span className="font-medium text-foreground">#{w.project!.id}</span> · {w.project!.name}
            </div>
            {w.project!.currentState && (
              <div className="line-clamp-2 italic" data-testid={`text-current-state-${w.slug}`}>{w.project!.currentState}</div>
            )}
            <div className="flex items-center gap-1 text-xs">
              <Clock className="h-3 w-3" /> updated {relTime(w.project!.updatedAt)}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="rounded-md border p-2" data-testid={`stat-drafts-${w.slug}`}>
            <div className="text-xs text-muted-foreground">Pending drafts</div>
            <div className={`text-xl font-semibold ${w.pendingDrafts > 0 ? "text-destructive" : ""}`}>{w.pendingDrafts}</div>
          </div>
          <div className="rounded-md border p-2" data-testid={`stat-heartbeat-${w.slug}`}>
            <div className="text-xs text-muted-foreground">Next heartbeat</div>
            <div className={`text-sm font-medium ${overdue ? "text-destructive" : ""}`}>
              {w.heartbeat?.nextRunAt ? relTime(w.heartbeat.nextRunAt) : "—"}
            </div>
          </div>
        </div>

        {w.heartbeat && (
          <div className="text-xs text-muted-foreground flex items-center gap-1" data-testid={`text-heartbeat-name-${w.slug}`}>
            <Calendar className="h-3 w-3" />
            <span className="truncate">{w.heartbeat.name}</span>
            {!w.heartbeat.enabled && <Badge variant="outline" className="ml-auto">disabled</Badge>}
            {overdue && <Badge variant="destructive" className="ml-auto"><AlertTriangle className="h-3 w-3 mr-0.5" />overdue</Badge>}
            {!overdue && w.heartbeat.enabled && <CheckCircle2 className="h-3 w-3 ml-auto text-primary" />}
          </div>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-2">
          <Link href={w.nextAction.href}>
            <Button
              className={`w-full justify-between ${urgencyClasses(w.nextAction.urgency)}`}
              data-testid={`button-next-action-${w.slug}`}
              aria-label={`${w.label}: ${w.nextAction.label}`}
            >
              <span className="truncate">{w.nextAction.label}</span>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </Button>
          </Link>
          <div className="flex gap-2 text-xs">
            {w.project?.primaryConversationId && (
              <Link href={`/chat/${w.project.primaryConversationId}`}>
                <Button variant="ghost" size="sm" className="h-7 px-2" data-testid={`link-chat-${w.slug}`} aria-label={`Open ${w.label} project chat`}>
                  <MessageSquare className="h-3 w-3 mr-1" /> Chat
                </Button>
              </Link>
            )}
            {w.project?.driveFolderUrl && (
              <a href={w.project.driveFolderUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="sm" className="h-7 px-2" data-testid={`link-drive-${w.slug}`} aria-label={`Open ${w.label} Drive folder in new tab`}>
                  <FolderOpen className="h-3 w-3 mr-1" /> Drive
                </Button>
              </a>
            )}
            {w.brainPath && (
              <Badge variant="outline" className="ml-auto h-7 px-2" data-testid={`badge-brain-${w.slug}`}>
                <FileText className="h-3 w-3 mr-1" /> brain
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminWedgesPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<Payload>({
    queryKey: ["/api/admin/wedges/status"],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center" data-testid="state-loading">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6 text-destructive" data-testid="state-error">
            Failed to load wedge status. {String((error as any)?.message || "")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const highUrgencyCount = data.wedges.filter(w => w.nextAction.urgency === "high").length;

  return (
    <div className="container mx-auto p-6 space-y-4" data-testid="page-admin-wedges">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="heading-wedges">Active Wedges</h1>
          <p className="text-sm text-muted-foreground mt-1">
            R125+13.8 validation tracks · click the action button to jump to what's next.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {highUrgencyCount > 0 && (
            <Badge variant="destructive" data-testid="badge-needs-attention">
              <AlertTriangle className="h-3 w-3 mr-1" /> {highUrgencyCount} need{highUrgencyCount === 1 ? "s" : ""} attention
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh" aria-label="Refresh wedge status">
            {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.wedges.map((w) => <WedgeCard key={w.slug} w={w} />)}
      </div>

      <div className="text-xs text-muted-foreground pt-2" data-testid="text-computed-at">
        Computed {relTime(data.computedAt)} · auto-refresh every 60s · 30s server cache
      </div>
    </div>
  );
}
