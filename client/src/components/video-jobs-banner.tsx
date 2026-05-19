// R111 — Heartbeat banner. Polls /api/video-jobs/active every 5s and shows a
// thin sticky strip above the chat input when there are active video renders.
// Click to deep-link into /jobs. Disappears when no active jobs.

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Clapperboard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type ChapterState = {
  idx: number;
  title: string;
  scene_count: number;
  status: "queued" | "rendering" | "done" | "failed";
};

type VideoJobRow = {
  jobId: string;
  title: string;
  status: string;
  totalChapters: number;
  chapters: ChapterState[];
  createdAt: string;
  updatedAt: string;
};

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m${r ? r + "s" : ""}`;
}

export function VideoJobsBanner() {
  const [, navigate] = useLocation();
  const { data } = useQuery<{ data: VideoJobRow[] }>({
    queryKey: ["/api/video-jobs/active"],
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  const jobs = data?.data || [];
  if (jobs.length === 0) return null;

  return (
    <div className="mb-2 flex flex-col gap-1.5" data-testid="video-jobs-banner">
      {jobs.slice(0, 3).map((job) => {
        const done = (job.chapters || []).filter((c) => c.status === "done").length;
        const failed = (job.chapters || []).filter((c) => c.status === "failed").length;
        const rendering = (job.chapters || []).find((c) => c.status === "rendering");
        const total = job.totalChapters;
        const phase = rendering
          ? `Ch ${rendering.idx + 1}/${total} rendering`
          : job.status === "concating" ? "Concatenating chapters"
          : job.status === "ready_to_concat" ? "Ready to concatenate"
          : `${done}/${total} done`;
        return (
          <button
            key={job.jobId}
            type="button"
            onClick={() => navigate("/jobs")}
            className="group flex items-center gap-3 px-3 py-2 rounded-md border border-cyan-700/40 bg-cyan-950/30 hover:bg-cyan-950/50 transition-colors text-left"
            data-testid={`banner-job-${job.jobId}`}
          >
            <Clapperboard className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-cyan-100 truncate">{job.title}</span>
                <span className="text-cyan-300/80">— {phase}</span>
                {failed > 0 && <span className="text-amber-300">({failed} failed)</span>}
              </div>
              <div className="mt-1 h-1 w-full rounded-full bg-cyan-900/50 overflow-hidden">
                <div
                  className="h-full bg-cyan-400 transition-all"
                  style={{ width: `${Math.max(2, (done / total) * 100)}%` }}
                />
              </div>
            </div>
            <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />
            <span className="text-[10px] text-cyan-300/70 tabular-nums shrink-0" data-testid={`banner-age-${job.jobId}`}>
              {formatAge(job.updatedAt)}
            </span>
          </button>
        );
      })}
      {jobs.length > 3 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] text-cyan-300"
          onClick={() => navigate("/jobs")}
          data-testid="banner-more-jobs"
        >
          + {jobs.length - 3} more — open dashboard
        </Button>
      )}
    </div>
  );
}
