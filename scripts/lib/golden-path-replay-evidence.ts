/** Required evidence for a replay PASS, independent of format-specific drift thresholds. */
export function replayEvidenceErrors(
  format: string,
  grade: { ok?: boolean; skipped?: boolean; metrics?: { duration_sec?: number; estimated_page_count?: number } } | undefined,
  archive: { archive_view_url?: string; archive_error?: string },
  expectedPageCount?: number,
): string[] {
  const errors: string[] = [];
  const duration = grade?.metrics?.duration_sec;
  const pageCount = grade?.metrics?.estimated_page_count;
  if (grade?.ok !== true || grade.skipped === true) errors.push("grader did not return a passing result");
  if (archive.archive_error || !archive.archive_view_url) errors.push(`archive missing review link: ${archive.archive_error || "no URL"}`);
  if (format === "video" && (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0)) {
    errors.push("grader returned no valid video duration");
  }
  if (typeof expectedPageCount === "number" && (typeof pageCount !== "number" || !Number.isFinite(pageCount) || pageCount <= 0)) {
    errors.push("grader returned no valid page count");
  }
  return errors;
}