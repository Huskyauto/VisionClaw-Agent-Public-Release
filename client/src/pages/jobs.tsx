// R111 — Video jobs dashboard. Active tab polls /api/video-jobs/active every
// 5s; History tab loads /api/video-jobs once. Per-job card shows the chapter
// checklist, progress bar, drive link when done, and cancel button while
// active. The chat heartbeat banner deep-links here.

import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Clapperboard, CheckCircle2, XCircle, Loader2, Clock, ExternalLink, Ban, Download, PlayCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { safeUrl } from "@/lib/safe-url";
import { useToast } from "@/hooks/use-toast";

type ChapterState = {
  idx: number;
  title: string;
  scene_count: number;
  status: "queued" | "rendering" | "done" | "failed";
  duration_sec?: number;
  error?: string;
  started_at?: number;
  completed_at?: number;
};

type VideoJobRow = {
  jobId: string;
  title: string;
  status: string;
  phase?: string | null;
  totalChapters: number;
  chapters: ChapterState[];
  finalDriveUrl: string | null;
  finalWatchUrl: string | null;
  finalDownloadUrl: string | null;
  finalDurationSec: number | null;
  finalSizeBytes: number | null;
  errorMessage: string | null;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

const ACTIVE_STATUSES = new Set(["queued", "rendering", "ready_to_concat", "concating"]);

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function formatBytes(n?: number | null): string | null {
  if (!n || n <= 0) return null;
  const mb = n / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function statusBadge(status: string) {
  const map: Record<string, { color: string; label: string }> = {
    queued: { color: "bg-slate-600/40 text-slate-200", label: "Queued" },
    rendering: { color: "bg-cyan-600/40 text-cyan-100", label: "Rendering" },
    ready_to_concat: { color: "bg-indigo-600/40 text-indigo-100", label: "Ready to concat" },
    concating: { color: "bg-indigo-600/40 text-indigo-100", label: "Concatenating" },
    done: { color: "bg-emerald-600/40 text-emerald-100", label: "Done" },
    failed: { color: "bg-rose-600/40 text-rose-100", label: "Failed" },
  };
  const m = map[status] || { color: "bg-slate-600/40 text-slate-200", label: status };
  return <Badge className={m.color} data-testid={`badge-status-${status}`}>{m.label}</Badge>;
}

function ChapterRow({ ch }: { ch: ChapterState }) {
  const icon =
    ch.status === "done" ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> :
    ch.status === "failed" ? <XCircle className="w-4 h-4 text-rose-400" /> :
    ch.status === "rendering" ? <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" /> :
    <Clock className="w-4 h-4 text-slate-400" />;
  return (
    <div className="flex items-center gap-2 text-sm py-1" data-testid={`chapter-row-${ch.idx}`}>
      {icon}
      <span className="font-medium text-slate-200">Ch {ch.idx + 1}.</span>
      <span className="text-slate-300 truncate flex-1">{ch.title}</span>
      <span className="text-xs text-slate-500 tabular-nums">
        {ch.scene_count} scenes
        {ch.duration_sec ? ` · ${ch.duration_sec.toFixed(1)}s` : ""}
      </span>
      {ch.error && (
        <span className="text-xs text-rose-300 max-w-[200px] truncate" title={ch.error}>
          {ch.error}
        </span>
      )}
    </div>
  );
}

function JobCard({ job }: { job: VideoJobRow }) {
  const { toast } = useToast();
  const isActive = ACTIVE_STATUSES.has(job.status);
  const done = job.chapters.filter((c) => c.status === "done").length;
  const failed = job.chapters.filter((c) => c.status === "failed").length;
  const pct = (done / Math.max(1, job.totalChapters)) * 100;

  const cancelMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/video-jobs/${job.jobId}/cancel`),
    onSuccess: () => {
      toast({ title: "Cancel requested", description: "Runner will stop after the in-flight chapter." });
      queryClient.invalidateQueries({ queryKey: ["/api/video-jobs/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/video-jobs"] });
    },
    onError: (e: any) => toast({ title: "Cancel failed", description: e?.message, variant: "destructive" }),
  });

  const forceCancelMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/video-jobs/${job.jobId}/force-cancel`),
    onSuccess: () => {
      toast({ title: "Job force-cancelled", description: "Marked failed in DB. UI will clear immediately." });
      queryClient.invalidateQueries({ queryKey: ["/api/video-jobs/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/video-jobs"] });
    },
    onError: (e: any) => toast({ title: "Force-cancel failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card id={`job-${job.jobId}`} data-testid={`job-card-${job.jobId}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Clapperboard className="w-5 h-5 text-cyan-400 shrink-0" />
            <CardTitle className="text-base truncate" data-testid={`text-job-title-${job.jobId}`}>{job.title}</CardTitle>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {statusBadge(job.status)}
            {job.cancelRequested && <Badge variant="outline" className="text-amber-300 border-amber-600/50">Cancelling</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
          <span className="font-mono">{job.jobId}</span>
          <span>·</span>
          <span>{isActive ? `${formatAge(job.updatedAt)} elapsed` : `created ${formatAge(job.createdAt)} ago`}</span>
          <span>·</span>
          <span>{done}/{job.totalChapters} chapters{failed > 0 ? ` (${failed} failed)` : ""}</span>
          {formatBytes(job.finalSizeBytes) && (
            <>
              <span>·</span>
              <span data-testid={`text-job-size-${job.jobId}`}>{formatBytes(job.finalSizeBytes)}</span>
            </>
          )}
          {job.finalDurationSec ? (
            <>
              <span>·</span>
              <span data-testid={`text-job-duration-${job.jobId}`}>{Math.round(job.finalDurationSec)}s</span>
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isActive && job.phase && (
          <div className="flex items-center gap-2 text-xs text-cyan-300" data-testid={`text-job-phase-${job.jobId}`}>
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span className="truncate">{job.phase}</span>
          </div>
        )}
        <Progress value={pct} className="h-1.5" />
        <div className="space-y-0.5 border-t border-slate-800 pt-2">
          {job.chapters.map((ch) => <ChapterRow key={ch.idx} ch={ch} />)}
        </div>
        {job.errorMessage && (
          <div className="text-xs text-rose-300 bg-rose-950/30 border border-rose-900/50 rounded px-2 py-1.5" data-testid={`text-job-error-${job.jobId}`}>
            {job.errorMessage}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {(() => {
            const safeWatch = safeUrl(job.finalWatchUrl);
            const safeDownload = safeUrl(job.finalDownloadUrl);
            const safeDrive = safeUrl(job.finalDriveUrl);
            return (
              <>
                {safeDownload && (
                  <Button asChild size="sm" data-testid={`button-download-${job.jobId}`}>
                    <a href={safeDownload} download>
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Download MP4
                    </a>
                  </Button>
                )}
                {safeWatch && (
                  <Button asChild size="sm" variant="outline" data-testid={`button-watch-${job.jobId}`}>
                    <a href={safeWatch} target="_blank" rel="noopener noreferrer">
                      <PlayCircle className="w-3.5 h-3.5 mr-1.5" />
                      Watch
                    </a>
                  </Button>
                )}
                {safeDrive && (
                  <Button asChild size="sm" variant="outline" data-testid={`button-open-drive-${job.jobId}`}>
                    <a href={safeDrive} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                      Open in Drive
                    </a>
                  </Button>
                )}
              </>
            );
          })()}
          {isActive && !job.cancelRequested && (
            <Button
              size="sm"
              variant="outline"
              className="text-rose-300 border-rose-800/60 hover:bg-rose-950/40"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              data-testid={`button-cancel-${job.jobId}`}
            >
              <Ban className="w-3.5 h-3.5 mr-1.5" />
              {cancelMutation.isPending ? "Cancelling..." : "Cancel"}
            </Button>
          )}
          {isActive && (
            <Button
              size="sm"
              variant="outline"
              className="text-rose-200 border-rose-700 hover:bg-rose-900/50"
              onClick={() => {
                if (window.confirm("Force-cancel this job? It will be marked FAILED in the database immediately. Any in-flight ffmpeg will finish its current step then stop. Use this when the regular Cancel button is stuck.")) {
                  forceCancelMutation.mutate();
                }
              }}
              disabled={forceCancelMutation.isPending}
              data-testid={`button-force-cancel-${job.jobId}`}
            >
              <Ban className="w-3.5 h-3.5 mr-1.5" />
              {forceCancelMutation.isPending ? "Force-cancelling..." : "Force Cancel"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function JobsPage() {
  // R124 — Deep-link support. /jobs/:jobId scrolls to + highlights the matching
  // card after data loads, and auto-switches to History if the job isn't in
  // the Active list (e.g. someone shared a link to a finished render).
  const [, params] = useRoute<{ jobId: string }>("/jobs/:jobId");
  const deepJobId = params?.jobId;

  const [tab, setTab] = useState<"active" | "history">("active");

  const activeQ = useQuery<{ data: VideoJobRow[] }>({
    queryKey: ["/api/video-jobs/active"],
    refetchInterval: tab === "active" ? 5000 : false,
    refetchIntervalInBackground: true,
  });

  const historyQ = useQuery<{ data: VideoJobRow[] }>({
    queryKey: ["/api/video-jobs"],
    enabled: tab === "history" || !!deepJobId,
  });

  // Tab-switch + scroll-into-view once we know which list the deep-linked job
  // lives in. Runs whenever the relevant data refreshes.
  useEffect(() => {
    if (!deepJobId) return;
    const inActive = (activeQ.data?.data || []).some((j) => j.jobId === deepJobId);
    const inHistory = (historyQ.data?.data || []).some((j) => j.jobId === deepJobId);
    if (inActive && tab !== "active") { setTab("active"); return; }
    if (!inActive && inHistory && tab !== "history") { setTab("history"); return; }
    if (inActive || inHistory) {
      const el = document.getElementById(`job-${deepJobId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-cyan-400", "ring-offset-2", "ring-offset-slate-950");
        setTimeout(() => el.classList.remove("ring-2", "ring-cyan-400", "ring-offset-2", "ring-offset-slate-950"), 3000);
      }
    }
  }, [deepJobId, activeQ.data, historyQ.data, tab]);

  return (
    <div className="container max-w-4xl mx-auto py-6 px-4">
      <div className="flex items-center gap-3 mb-6">
        <Clapperboard className="w-7 h-7 text-cyan-400" />
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Video Jobs</h1>
          <p className="text-sm text-slate-400">Live progress on every video Felix is rendering for you.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="active" data-testid="tab-active">
            Active
            {(activeQ.data?.data?.length || 0) > 0 && (
              <Badge className="ml-2 bg-cyan-600/40 text-cyan-100">{activeQ.data!.data.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-3 mt-4">
          {activeQ.isLoading && <Skeleton className="h-32 w-full" />}
          {!activeQ.isLoading && (activeQ.data?.data?.length || 0) === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-slate-400" data-testid="text-no-active">
                <Clapperboard className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p>No video jobs running right now.</p>
                <p className="text-xs mt-1">Ask Felix to make you a video and it'll show up here in real time.</p>
              </CardContent>
            </Card>
          )}
          {(activeQ.data?.data || []).map((job) => <JobCard key={job.jobId} job={job} />)}
        </TabsContent>

        <TabsContent value="history" className="space-y-3 mt-4">
          {historyQ.isLoading && <Skeleton className="h-32 w-full" />}
          {!historyQ.isLoading && (historyQ.data?.data?.length || 0) === 0 && (
            <Card><CardContent className="py-10 text-center text-slate-400" data-testid="text-no-history">No video jobs yet.</CardContent></Card>
          )}
          {(historyQ.data?.data || []).map((job) => <JobCard key={job.jobId} job={job} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
