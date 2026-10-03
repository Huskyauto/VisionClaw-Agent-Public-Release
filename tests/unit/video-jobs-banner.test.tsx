import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

(globalThis as any).React = React;

async function renderBanner(job: Record<string, unknown>): Promise<string> {
  const { VideoJobsBanner } = await import("../../client/src/components/video-jobs-banner");
  const queryClient = new QueryClient();
  queryClient.setQueryData(["/api/video-jobs/active"], { data: [job] });
  const staticLocationHook = () => ["/chat/2", () => undefined] as const;
  return renderToStaticMarkup(
    <Router hook={staticLocationHook}>
      <QueryClientProvider client={queryClient}>
        <VideoJobsBanner />
      </QueryClientProvider>
    </Router>,
  );
}

test("active BWB job renders the sticky stage tab above chat", async () => {
  const html = await renderBanner({
    jobId: "vj_test_active_12345678",
    title: "BWB Progress UI Verification",
    status: "rendering",
    phase: "Transcribing weekly clips (2/5)",
    totalChapters: 3,
    chapters: [
      { idx: 0, title: "Chapter 1", scene_count: 3, status: "rendering" },
      { idx: 1, title: "Chapter 2", scene_count: 3, status: "queued" },
      { idx: 2, title: "Chapter 3", scene_count: 3, status: "queued" },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  assert.match(html, /data-testid="video-jobs-banner"/);
  assert.match(html, /data-testid="banner-job-vj_test_active_12345678"/);
  assert.match(html, /Transcribing weekly clips \(2\/5\)/);
  assert.match(html, /BWB Progress UI Verification/);
});

test("completed BWB job keeps the bottom tab and renders Watch, Download, Drive, and chapters actions", async () => {
  const html = await renderBanner({
    jobId: "vj_test_done_12345678",
    title: "BWB Progress UI Verification",
    status: "done",
    phase: "Done — ready to watch",
    totalChapters: 3,
    chapters: [
      { idx: 0, title: "Chapter 1", scene_count: 3, status: "done" },
      { idx: 1, title: "Chapter 2", scene_count: 3, status: "done" },
      { idx: 2, title: "Chapter 3", scene_count: 3, status: "done" },
    ],
    finalWatchUrl: "/api/video-jobs/vj_test_done_12345678/download?inline=1&exp=1&sig=safe",
    finalDownloadUrl: "/api/video-jobs/vj_test_done_12345678/download?exp=1&sig=safe",
    finalDriveUrl: "https://drive.google.com/file/d/safe-delivery/view?usp=sharing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  assert.match(html, /data-testid="banner-job-done-vj_test_done_12345678"/);
  assert.match(html, /data-testid="banner-watch-vj_test_done_12345678"/);
  assert.match(html, /data-testid="banner-download-vj_test_done_12345678"/);
  assert.match(html, /data-testid="banner-drive-vj_test_done_12345678"/);
  assert.match(html, /View chapters/);
  assert.match(html, /\/api\/video-jobs\/vj_test_done_12345678\/download\?inline=1&amp;exp=1&amp;sig=safe/);
  assert.match(html, /https:\/\/drive\.google\.com\/file\/d\/safe-delivery\/view\?usp=sharing/);
});