import type { AgentJob } from "../job-queue";
import { hashReportBytes } from "./business-report-evidence";
import { REPORT_KINDS, type PackageState } from "./company-report-package-core";
import { callReportGemini } from "./business-report-gemini";
import { reservePackageOperation, PACKAGE_MODEL_SEATS } from "./company-report-production";
import { aggregateReviewPackets, type ApprovedPackageReport } from "./company-package-completion";
import { finalizedReportSections } from "./business-report-review";

export const packageContentDigest = (reports: ApprovedPackageReport[]) => hashReportBytes(JSON.stringify(reports));
export function packageContentReviewMatches(review: any, reports: ApprovedPackageReport[], state: PackageState): boolean {
  if (review?.approved !== true || review.digest !== packageContentDigest(reports) || !state.research) return false;
  const packetDigests = aggregateReviewPackets(reports, state.research.evidence, state.research.coverage)
    .map(p => hashReportBytes(p.packet));
  return review.manifestDigest === hashReportBytes(JSON.stringify({ digest: review.digest, packetDigests })) &&
    packetDigests.every(d => review.packets?.[d]?.approved === true && review.packets[d].report?.approved === true &&
      Array.isArray(review.packets[d].report.issues) && review.packets[d].report.issues.length === 0);
}

/** Read final reviewed text BEFORE paid narration or final PDF production. */
export async function packageApprovedContent(job: AgentJob, state: PackageState): Promise<ApprovedPackageReport[] | null> {
  const { db } = await import("../db"), { sql } = await import("drizzle-orm");
  const reports: ApprovedPackageReport[] = [];
  for (const kind of REPORT_KINDS) {
    const id = state.reports[kind]?.jobId;
    if (!id) return null;
    const result: any = await db.execute(sql`SELECT payload FROM agent_jobs WHERE id=${id}
      AND tenant_id=${job.tenantId!} AND kind='business_report_review'`);
    const child = (result.rows || result)[0]?.payload;
    if (!child || child.input?.orderId !== `company-package:${job.id}:${kind}` ||
        child.input?.tenantId !== job.tenantId || child.input?.reportOnly !== true ||
        child.input?.modelId !== PACKAGE_MODEL_SEATS[kind].model) throw new Error("Package final review report binding lost");
    if (child.state?.phase !== "finalizing" || !child.state?.approvedSections?.length ||
        child.state?.juryHistory?.at(-1)?.verdict !== "REJECT") return null;
    reports.push({ kind, model: child.input.modelId,
      sections: finalizedReportSections(child.input, child.state, child.compilerRuns) });
  }
  return reports;
}

export async function reviewCompletePackage(job: AgentJob, state: PackageState, live: () => Promise<void>) {
  const reports = await packageApprovedContent(job, state);
  if (!reports) return false;
  const { db } = await import("../db"), { sql } = await import("drizzle-orm");
  const digest = packageContentDigest(reports);
  const packets = aggregateReviewPackets(reports, state.research!.evidence, state.research!.coverage);
  const { sanitizeAgentOutput } = await import("../safety-layer");
  // Validate ALL packets before the first paid dispatch.
  if (packets.some(p => sanitizeAgentOutput(p.packet).redacted)) throw new Error("Package final review failed context safety");
  const found: any = await db.execute(sql`SELECT payload->'packageContentReview' AS receipt FROM agent_jobs
    WHERE id=${job.id} AND tenant_id=${job.tenantId!} AND kind='company_report_package'`);
  const prior = (found.rows || found)[0]?.receipt;
  const review = prior?.digest === digest ? prior : { version: 1, digest, packets: {} };
  // Freeze includes evidence identity and exact packet identities, not status alone.
  const packetDigests = packets.map(p => hashReportBytes(p.packet));
  const manifestDigest = hashReportBytes(JSON.stringify({ digest, packetDigests }));
  if (packageContentReviewMatches(review, reports, state)) return true;
  const persist = async () => {
    await live();
    const saved: any = await db.execute(sql`UPDATE agent_jobs SET payload=jsonb_set(payload,
      '{packageContentReview}',${JSON.stringify(review)}::jsonb)
      WHERE id=${job.id} AND tenant_id=${job.tenantId!} AND kind='company_report_package'
      AND attempts=${job.attempts} AND status='running' AND lease_until>NOW() RETURNING id`);
    if (!(saved.rows || saved).length) throw new Error("Package final review checkpoint lost");
  };
  for (let index = 0; index < packets.length; index++) {
    const packet = packets[index].packet, packetDigest = packetDigests[index];
    let retained = review.packets[packetDigest];
    if (retained?.approved === true) continue;
    const { report, receipt } = await callReportGemini(job.tenantId!, packet, {
      type: "object", additionalProperties: false, required: ["approved", "issues", "summary"],
      properties: { approved: { type: "boolean" }, issues: { type: "array", items: { type: "string" } }, summary: { type: "string" } },
    }, {
      assertLive: live, operationKey: `package-content-review:${job.id}:${packetDigest}`,
      ...(retained?.raw?.rawBody ? { request: async () => retained.raw } : {}),
      reserve: amount => retained?.raw?.rawBody ? Promise.resolve() :
        reservePackageOperation(job.id, job.tenantId!, `final-review:${packetDigest}`, amount, { parentAttempt: job.attempts }),
      checkpoint: async raw => {
        retained = review.packets[packetDigest] = { raw, scope: packets[index].scope };
        await persist();
      },
    });
    const approved = report?.approved === true && Array.isArray(report.issues) && report.issues.length === 0 &&
      typeof report.summary === "string" && report.summary.length >= 80 && report.summary.length <= 6000;
    review.packets[packetDigest] = { ...retained, report, receipt, approved, scope: packets[index].scope };
    await persist();
    if (!approved) throw new Error("Package final review requires corrections; approved individual reports retained");
  }
  review.approved = true;
  review.manifestDigest = manifestDigest;
  review.packetDigests = packetDigests;
  review.approvedAt = new Date().toISOString();
  await persist();
  return true;
}
