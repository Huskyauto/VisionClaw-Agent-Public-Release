import fs from "node:fs";
import path from "node:path";

export interface TenantAuditReportTargets {
  reportMd: string;
  reportJson: string;
  degradedReportMd: string;
  degradedReportJson: string;
}

export function writeTenantAuditReportFiles(input: {
  degraded: boolean;
  markdown: string;
  json: string;
  targets: TenantAuditReportTargets;
}): { markdownPath: string; jsonPath: string } {
  const markdownPath = input.degraded
    ? input.targets.degradedReportMd
    : input.targets.reportMd;
  const jsonPath = input.degraded
    ? input.targets.degradedReportJson
    : input.targets.reportJson;

  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(markdownPath, input.markdown);
  fs.writeFileSync(jsonPath, input.json);
  return { markdownPath, jsonPath };
}