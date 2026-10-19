import { sql } from "drizzle-orm";
import { db } from "../db";
import { deferJob, renewJobLease, type AgentJob } from "../job-queue";
import { advancePackage, REPORT_KINDS, type PackageKind, type PackageState } from "./company-report-package-core";
import { createPackageTeaser, combinePackageTeasers, PACKAGE_REPORT_NAMES } from "./company-report-teasers";
import { COMPANY_REPORT_PACKAGE_FILE_PREFIX } from "./private-business-pilot-files";

export const PACKAGE_JOB_KIND = "company_report_package";
const rows = (result: any) => result.rows || result;
const fileName = (id: number, key: string) => `${COMPANY_REPORT_PACKAGE_FILE_PREFIX}${id}-${key}.pdf`;
export async function packageFile(tenantId: number, id: number, key: string): Promise<Buffer | null> {
  const [file] = rows(await db.execute(sql`SELECT data FROM file_storage WHERE tenant_id=${tenantId}
    AND filename=${fileName(id, key)} AND mime_type='application/pdf' ORDER BY id DESC LIMIT 1`));
  return typeof file?.data === "string" ? Buffer.from(file.data, "base64") : null;
}
async function storeFile(tenantId: number, id: number, key: string, data: Uint8Array) {
  if (data.length > 25 * 1024 * 1024) throw new Error("Package PDF exceeds private storage limit");
  const filename = fileName(id, key), bytes = Buffer.from(data);
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${filename}`}))`);
    const [prior] = rows(await tx.execute(sql`SELECT id FROM file_storage WHERE tenant_id=${tenantId} AND filename=${filename} LIMIT 1`));
    if (prior) {
      // Immutable identity: don't silently replace a completed artifact on replay.
      const [stored] = rows(await tx.execute(sql`SELECT data FROM file_storage WHERE id=${prior.id} AND tenant_id=${tenantId}`));
      if (stored.data !== bytes.toString("base64")) throw new Error("Package artifact identity conflict");
      return;
    }
    await tx.execute(sql`INSERT INTO file_storage (filename,original_name,mime_type,size,data,tenant_id)
      VALUES (${filename},${filename},'application/pdf',${bytes.length},${bytes.toString("base64")},${tenantId})`);
  });
  return filename;
}
/** Existing job leases fence every durable checkpoint; no new autonomous loop. */
export async function advanceCompanyReportPackage(job: AgentJob) {
  if (job.tenantId !== 1 || job.payload.tenantId !== job.tenantId) throw new Error("Package owner scope mismatch");
  const tenantId = job.tenantId, state = job.payload.state as PackageState;
  if (!state?.intake || !state.reports || !Array.isArray(state.files)) throw new Error("Invalid package state");
  let leaseLost = false, renewing = false;
  const live = async () => {
    if (leaseLost || process.env.REPORT_EVIDENCE_HANDOFFS_DISABLED === "1") throw new Error("Package stopped or lease lost");
    const [row] = rows(await db.execute(sql`SELECT id FROM agent_jobs WHERE id=${job.id} AND tenant_id=${tenantId}
      AND kind=${PACKAGE_JOB_KIND} AND status='running' AND attempts=${job.attempts} AND lease_until>NOW()`));
    if (!row) { leaseLost = true; throw new Error("Package lease lost"); }
  };
  const checkpoint = async () => {
    await live();
    const updated = rows(await db.execute(sql`UPDATE agent_jobs SET payload=${JSON.stringify({ ...job.payload, state })}::jsonb
      WHERE id=${job.id} AND tenant_id=${tenantId} AND kind=${PACKAGE_JOB_KIND}
      AND status='running' AND attempts=${job.attempts} AND lease_until>NOW() RETURNING id`));
    if (!updated.length) throw new Error("Package checkpoint lease lost");
  };
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    renewJobLease(job.id, job.attempts, tenantId, 300_000).then(until => { if (!until) leaseLost = true; })
      .catch(() => { leaseLost = true; }).finally(() => { renewing = false; });
  }, 30_000);
  heartbeat.unref();
  const orderId = (kind: PackageKind) => `company-package:${job.id}:${kind}`;
  const child = async (id: number, kind: PackageKind) => {
    const [value] = rows(await db.execute(sql`SELECT id,status,payload,result FROM agent_jobs WHERE id=${id}
      AND tenant_id=${tenantId} AND kind='business_report_review'`));
    const evidence = value?.payload?.input?.evidence;
    const sources = state.research?.evidence.sources;
    if (!value || value.payload?.input?.orderId !== orderId(kind) ||
        value.payload?.input?.reportOnly !== true || !sources || !Array.isArray(evidence?.sources) ||
        evidence.capturedAt !== state.research!.evidence.capturedAt ||
        evidence.sources.length !== sources.length ||
        !evidence.sources.every((source: any, index: number) => source.id === sources[index].id && source.sha256 === sources[index].sha256))
      throw new Error("Package child scope or research identity mismatch");
    return value;
  };
  try {
    if (Date.now() - new Date(job.createdAt).getTime() > 24 * 60 * 60_000) {
      state.phase = "blocked"; state.error = "Package exceeded its 24-hour processing window; retained work needs owner review.";
      await checkpoint(); return { phase: state.phase };
    }
    await advancePackage(state, {
      checkpoint,
      research: async () => {
        const { researchCompanyPackage } = await import("./company-report-research");
        // Inject only the live lease check; production adapters remain server-owned.
        const research = await import("./business-report-evidence");
        const browser = await import("../camofox-tool"), audit = await import("../audit-engine");
        return researchCompanyPackage(state.intake, tenantId, job.id, {
          collect: research.collectBusinessReportEvidence, live,
          fetch: url => audit.safeFetchText(url, { timeoutMs: 6000, maxBytes: 300_000, maxRedirects: 2 }),
          browse: params => browser.executeCamofoxAction(params),
        });
      },
      recover: async kind => {
        const [prior] = rows(await db.execute(sql`SELECT id FROM agent_jobs WHERE tenant_id=${tenantId}
          AND kind='business_report_review' AND payload->'input'->>'orderId'=${orderId(kind)}
          AND payload->'input'->>'reportOnly'='true' ORDER BY id DESC LIMIT 1`));
        return prior?.id ?? null;
      },
      draft: async (kind, sharedEvidence) => {
        await live();
        const params = { intake: state.intake, tenantId, customerEmail: "", orderId: orderId(kind),
          sharedEvidence, reportOnly: true };
        const result = kind === "readiness"
          ? await (await import("../audit-fulfillment")).fulfillReadinessAudit(params)
          : await (await import("../executive-report-fulfillment")).fulfillExecutiveReport({
            ...params, intake: { ...state.intake, focus: kind === "opportunities" ? "opportunities" : "full" },
          });
        if (!result.success || !result.pending || !result.jobId) throw new Error("Detailed report draft did not produce a confirmed review receipt");
        return result.jobId;
      },
      review: async (id, kind) => {
        const value = await child(id, kind);
        if (value.payload?.state?.phase === "blocked" || ["failed", "failed_terminal", "cancelled"].includes(value.status)) return { status: "error" };
        if (value.status !== "succeeded") return { status: "pending" };
        const fulfillment = value.payload.fulfillment;
        if (!fulfillment?.success || !fulfillment.fileName || !Array.isArray(value.payload.state?.approvedSections)) return { status: "error" };
        return { status: "done", filename: fulfillment.fileName, sections: value.payload.state.approvedSections };
      },
      assemble: async (kind, review) => {
        await live();
        const [source] = rows(await db.execute(sql`SELECT data FROM file_storage WHERE tenant_id=${tenantId}
          AND filename=${review.filename!} AND mime_type='application/pdf' ORDER BY id DESC LIMIT 1`));
        if (typeof source?.data !== "string") throw new Error("Completed full report has no durable PDF bytes");
        await storeFile(tenantId, job.id, `${kind}-full`, Buffer.from(source.data, "base64"));
        if (!state.files.some(file => file.key === `${kind}-full`)) {
          state.files.push({ key: `${kind}-full`, label: `${PACKAGE_REPORT_NAMES[kind]} — Complete report (private)`,
            filename: `${kind}-full.pdf`, category: "full" });
          await checkpoint();
        }
        const c = state.research!.coverage;
        const teaser = await packageFile(tenantId, job.id, `${kind}-teaser`) ?? await createPackageTeaser({ kind, company: state.intake.company, principalName: state.intake.principalName,
          sections: review.sections!, capturedAt: state.research!.evidence.capturedAt, evidence: state.research!.evidence,
          coverage: `${c.reviewed} rendered pages / ${c.discovered} discovered URLs; ${c.failed} failed. ${c.capped ? "Partial bounded review." : "All discovered in-scope pages visited."} See full report for limitations.` });
        await storeFile(tenantId, job.id, `${kind}-teaser`, teaser);
        return (["full", "teaser"] as const).map(category => ({ key: `${kind}-${category}`,
          label: `${PACKAGE_REPORT_NAMES[kind]} — ${category === "full" ? "Complete report (private)" : "One-page teaser"}`,
          filename: `${kind}-${category}.pdf`, category }));
      },
      combine: async () => {
        await live();
        const pdfs = await Promise.all(REPORT_KINDS.map(kind => packageFile(tenantId, job.id, `${kind}-teaser`)));
        if (pdfs.some(pdf => !pdf)) throw new Error("Teaser set incomplete");
        if (!await packageFile(tenantId, job.id, "teaser-pack"))
          await storeFile(tenantId, job.id, "teaser-pack", await combinePackageTeasers(pdfs as Buffer[]));
        if (!state.files.some(file => file.key === "teaser-pack")) state.files.push({
          key: "teaser-pack", label: "Three-page teaser pack (initial outreach)", filename: "free-teaser-pack.pdf", category: "teaser",
        });
      },
    });
    if (state.phase === "done" || state.phase === "blocked") return { phase: state.phase };
    if (!await deferJob(job.id, job.attempts, tenantId, { ...job.payload, state }, 30_000)) throw new Error("Package defer lease lost");
    return { deferred: true };
  } catch {
    if (leaseLost) throw new Error("Package lost lease; no further dispatch allowed");
    state.phase = "blocked";
    state.error = "Package interrupted. Retained research and completed reports are preserved; inspect server diagnostics before another generation.";
    await checkpoint();
    console.error(`[company-package] job=${job.id} blocked; no automatic duplicate synthesis`);
    return { phase: "blocked" };
  } finally { clearInterval(heartbeat); }
}
