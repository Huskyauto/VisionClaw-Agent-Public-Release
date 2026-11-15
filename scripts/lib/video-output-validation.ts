import { verifyVideoOutput, type VideoVerificationReport } from "../../server/lib/video-output-verification";
export { createStableVideoSnapshot, type StableVideoSnapshot } from "../../server/lib/video-output-snapshot";

export interface RenderedVideoValidationResult {
  ok: boolean;
  reason: string;
  report: VideoVerificationReport;
}

/** BWB keeps its stricter landscape AV contract; evaluation is shared. */
export async function validateRenderedVideo(filePath: string): Promise<RenderedVideoValidationResult> {
  const report = await verifyVideoOutput(filePath, {
    requireAudio: true, videoCodec: "h264", audioCodec: "aac", width: 1920, height: 1080,
  });
  return {
    ok: report.ok,
    reason: report.ok ? `valid h264/aac 1920x1080 render (${report.durationSeconds!.toFixed(3)}s)`
      : report.checks.filter(c => c.required && c.status !== "PASS").map(c => c.detail).join("; "),
    report,
  };
}
