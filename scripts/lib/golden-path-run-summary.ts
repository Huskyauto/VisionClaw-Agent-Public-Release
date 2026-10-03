export interface GoldenPathSummaryRecord {
  id: string;
  format: string;
  ran_at: string;
  ok: boolean;
  artifact_size_bytes?: number;
  drift?: string;
  notes?: string;
  archive_view_url?: string;
  archive_error?: string;
  outcome?: "completed" | "not_run";
}

export interface GoldenPathFixtureIdentity {
  id: string;
  format: string;
}

export function completeGoldenPathRunRecords(
  records: GoldenPathSummaryRecord[],
  fixtures: GoldenPathFixtureIdentity[],
  missingReasonTemplate = "not run: $1 because the replay stopped before this fixture",
): GoldenPathSummaryRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const now = new Date().toISOString();
  return fixtures.map((fixture) => byId.get(fixture.id) ?? {
    id: fixture.id,
    format: fixture.format,
    ran_at: now,
    ok: false,
    outcome: "not_run",
    notes: missingReasonTemplate.replace("$1", fixture.id),
  });
}

export function formatGoldenPathRunSummary(records: GoldenPathSummaryRecord[]): string {
  const lines = ["[golden-path] INCIDENT-SUMMARY — complete per-fixture results"];
  for (const record of records) {
    const status = record.outcome === "not_run" ? "NOT-RUN" : record.ok ? "PASS" : "FAIL";
    const details = [
      record.artifact_size_bytes != null ? `${record.artifact_size_bytes}B` : "",
      record.drift || record.notes || "",
    ].filter(Boolean).join(" — ");
    lines.push(`[golden-path] ${status} ${record.id} (${record.format})${details ? ` — ${details}` : ""}`);
    if (record.archive_view_url) lines.push(`[golden-path] REVIEW ${record.id}: ${record.archive_view_url}`);
    if (record.archive_error) lines.push(`[golden-path] ARCHIVE-ERROR ${record.id}: ${record.archive_error}`);
  }
  return lines.join("\n");
}