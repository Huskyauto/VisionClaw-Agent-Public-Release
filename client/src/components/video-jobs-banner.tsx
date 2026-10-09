// R111 — Heartbeat banner. Polls /api/video-jobs/active every 5s and shows a
// thin sticky strip above the chat input when there are active video renders.
// Click to deep-link into /jobs. Disappears when no active jobs.

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Clapperboard, Loader2, CheckCircle2, ExternalLink, Download, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { safeUrl } from "@/lib/safe-url";

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
  phase?: string | null;
  errorMessage?: string | null;
  totalChapters: number;
  chapters: ChapterState[];
  finalWatchUrl?: string | null;
  finalDownloadUrl?: string | null;
  finalDriveUrl?: string | null;
  createdAt: string;
  updatedAt: string;
};

const DISMISSED_KEY = "vc_video_jobs_banner_dismissed";
function loadDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]")); } catch { return new Set(); }
}
function saveDismissed(s: Set<string>) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(s).slice(-50))); } catch {}
}

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

  const allJobs = data?.data || [];
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  useEffect(() => { saveDismissed(dismissed); }, [dismissed]);
  const jobs = allJobs.filter((j) => !((j.status === "done" || j.status === "failed") && dismissed.has(j.jobId)));
  if (jobs.length === 0) return null;

  return (
    <div className="mb-2 flex flex-col gap-1.5" data-testid="video-jobs-banner">
      {jobs.slice(0, 3).map((job) => {
        // R124 — Done-state tile: click to watch, dismiss button on the right.
        const safeWatch = safeUrl(job.finalWatchUrl);
        const safeDownload = safeUrl(job.finalDownloadUrl);
        const safeDrive = safeUrl(job.finalDriveUrl);
        if (job.status === "done" && (safeWatch || safeDownload || safeDrive)) {
          const primary = safeWatch || safeDrive || "/jobs";
          return (
            <div
              key={job.jobId}
              className="group flex items-center gap-3 px-3 py-2 rounded-md border border-emerald-600/50 bg-emerald-950/40"
              data-testid={`banner-job-done-${job.jobId}`}
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-emerald-100 truncate">{job.title}</span>
                  <span className="text-emerald-300/80">— ready to watch</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                  {safeWatch && (
                    <a
                      href={safeWatch}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-emerald-50"
                      data-testid={`banner-watch-${job.jobId}`}
                    >
                      <ExternalLink className="w-3 h-3" /> Watch
                    </a>
                  )}
                  {safeDownload && (
                    <a
                      href={safeDownload}
                      download
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-emerald-50"
                      data-testid={`banner-download-${job.jobId}`}
                    >
                      <Download className="w-3 h-3" /> Download
                    </a>
                  )}
                  {safeDrive && (
                    <a
                      href={safeDrive}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-900/60 hover:bg-emerald-800/80 text-emerald-100 border border-emerald-700/50"
                      data-testid={`banner-drive-${job.jobId}`}
                    >
                      <ExternalLink className="w-3 h-3" /> Drive
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => navigate("/jobs")}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-emerald-300/80 hover:text-emerald-100"
                    data-testid={`banner-open-jobs-${job.jobId}`}
                  >
                    View chapters
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDismissed((prev) => { const next = new Set(prev); next.add(job.jobId); return next; }); }}
                className="text-emerald-300/60 hover:text-emerald-100 shrink-0"
                aria-label="Dismiss"
                data-testid={`banner-dismiss-${job.jobId}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
              {/* Hidden link so the whole row is still clickable to watch */}
              <a href={primary} target="_blank" rel="noopener noreferrer" className="hidden" aria-hidden tabIndex={-1}>open</a>
            </div>
          );
        }
        // R125+46 — Failed-state tile: instead of the card silently vanishing
        // when a job leaves ACTIVE_STATUSES (the BWB weekly-recap fail-closed
        // case Bob hit — "it refreshed and I lost everything"), show a red tile
        // with the failure reason + a link into /jobs + a dismiss button.
        if (job.status === "failed") {
          const reason = (job.errorMessage || job.phase || "Build failed").replace(/\s+/g, " ").trim().slice(0, 180);
          return (
            <div
              key={job.jobId}
              className="group flex items-center gap-3 px-3 py-2 rounded-md border border-red-700/50 bg-red-950/40"
              data-testid={`banner-job-failed-${job.jobId}`}
            >
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-red-100 truncate">{job.title}</span>
                  <span className="text-red-300/80">— failed</span>
                </div>
                <div className="mt-0.5 text-[11px] text-red-200/80 line-clamp-2" data-testid={`banner-fail-reason-${job.jobId}`}>
                  {reason}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => navigate("/jobs")}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-900/60 hover:bg-red-800/80 text-red-100 border border-red-700/50"
                    data-testid={`banner-open-jobs-failed-${job.jobId}`}
                  >
                    View details
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDismissed((prev) => { const next = new Set(prev); next.add(job.jobId); return next; }); }}
                className="text-red-300/60 hover:text-red-100 shrink-0"
                aria-label="Dismiss"
                data-testid={`banner-dismiss-${job.jobId}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        }
        const done = (job.chapters || []).filter((c) => c.status === "done").length;
        const failed = (job.chapters || []).filter((c) => c.status === "failed").length;
        const rendering = (job.chapters || []).find((c) => c.status === "rendering");
        const total = job.totalChapters;
        // Prefer the server-supplied free-text phase line (BWB weekly recap sets it
        // through every pre-render stage: discovering → transcribing → writing →
        // baking → narration → per-chapter render). Fall back to chapter-derived
        // text for legacy in-process jobs that only set chapters.
        const derived = rendering
          ? `Ch ${rendering.idx + 1}/${total} rendering`
          : job.status === "concating" ? "Concatenating chapters"
          : job.status === "ready_to_concat" ? "Ready to concatenate"
          : total > 0 ? `${done}/${total} done`
          : "Working…";
        const phase = job.phase || derived;
        // Progress bar: chapter-fraction when we have chapters; otherwise an
        // indeterminate sliver so the pre-render stages still show a live bar.
        const pct = total > 0 ? Math.max(2, (done / total) * 100) : 8;
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
                  style={{ width: `${pct}%` }}
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
