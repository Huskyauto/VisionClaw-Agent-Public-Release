import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { renewJobLease, type AgentJob } from "../job-queue";
import { advancePackage, REPORT_KINDS, type PackageKind, type PackageState } from "./company-report-package-core";
import { createPackageTeaser, combinePackageTeasers, PACKAGE_REPORT_NAMES } from "./company-report-teasers";
import { COMPANY_REPORT_PACKAGE_FILE_PREFIX } from "./private-business-pilot-files";
import { confirmedPackageDraft, packageSectionDrafter, PACKAGE_MODEL_SEATS, packageWindowOpen } from "./company-report-production";
import { assertReportAudioUrl } from "./business-report-audio";
import { compilationValidationFailure, compilationCorrectionStopReason } from "./company-compilation-checks";
import { hasCompilationCorrectionApproval } from "./company-compilation-correction-policy";
import { hasTargetedRepairApproval, TARGETED_COMPILATION_REPAIR_GRANT } from "./company-compilation-targeted-repair";

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
    if (state.phase !== "blocked" && !packageWindowOpen(job.payload.processingWindowStartedAt || new Date(job.createdAt).toISOString()))
      throw new Error("Package processing window expired");
    const [row] = rows(await db.execute(sql`SELECT id FROM agent_jobs WHERE id=${job.id} AND tenant_id=${tenantId}
      AND kind=${PACKAGE_JOB_KIND} AND status='running' AND attempts=${job.attempts} AND lease_until>NOW()`));
    if (!row) { leaseLost = true; throw new Error("Package lease lost"); }
  };
  const checkpoint = async () => {
    await live();
    const updated = rows(await db.execute(sql`UPDATE agent_jobs SET payload=jsonb_set(payload,'{state}',${JSON.stringify(state)}::jsonb)
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
    const processingStart = Date.parse(job.payload.processingWindowStartedAt || new Date(job.createdAt).toISOString());
    if (!Number.isFinite(processingStart) || Date.now() - processingStart > 24 * 60 * 60_000) {
      state.phase = "blocked"; state.error = "Package exceeded its 24-hour processing window; retained work needs owner review.";
      await checkpoint(); return { phase: state.phase };
    }
    if (job.payload.productionVersion === 3) {
      if (state.phase !== "blocked" && state.phase !== "done") {
        if (state.research?.complete !== true) {
          state.phase = "researching";
          await checkpoint();
          if (!state.intake.website) throw new Error("A public company website is needed: enter the website in the company form.");
          const { researchCompanyPackage } = await import("./company-report-research");
          const evidence = await import("./business-report-evidence");
          const browser = await import("../camofox-tool"), audit = await import("../audit-engine");
          const { companyResearchBrowserLanes } = await import("./company-research-browser");
          state.research = await researchCompanyPackage(state.intake, tenantId, job.id, {
            collect: evidence.collectBusinessReportEvidence, live,
            fetch: url => audit.safeFetchText(url, { timeoutMs: 6000, maxBytes: 300_000, maxRedirects: 2 }),
            browse: params => browser.executeCamofoxAction(params),
            browserLanes: companyResearchBrowserLanes(params => browser.executeCamofoxAction(params)), prior: state.research,
            checkpoint: async value => { state.research = value; await checkpoint(); },
          });
          if (state.research.complete) state.phase = "drafting";
          await checkpoint();
        } else {
          const { advanceCompanyCompilation } = await import("./company-package-v3");
          const { requestCompanyCompilation } = await import("./company-compilation-runtime");
          const { acceptCompilation } = await import("./company-compilation-content");
          const { publishCompanyCompilation } = await import("./company-package-publication");
          const { publishCompanyTeaserPack } = await import("./company-package-teaser-publication");
          await advanceCompanyCompilation(state, {
            parallel: true,
            checkpoint,
            request: (op, drafts) => requestCompanyCompilation(job, state, op, drafts, live),
            accept: (op, raw) => acceptCompilation(state, op, raw),
            correct: hasCompilationCorrectionApproval(job.payload)
              ? (op, drafts, original, check) => requestCompanyCompilation(job, state, op, drafts, live, undefined, { original, check })
              : undefined,
            targetedRepair: hasTargetedRepairApproval(job) ? {
              operation: TARGETED_COMPILATION_REPAIR_GRANT.operation,
              request: (op, drafts, original, check) => requestCompanyCompilation(job, state, op, drafts, live,
                undefined, { original, check, targetedRepair: true }),
            } : undefined,
            publish: (kind, text) => publishCompanyCompilation(job, state, kind, text, {
              live, checkpoint, storeFile: (key, bytes) => storeFile(tenantId, job.id, key, bytes),
              packageFile: key => packageFile(tenantId, job.id, key),
            }),
            publishTeaser: () => publishCompanyTeaserPack(job, state, {
              live, checkpoint, storeFile: (key, bytes) => storeFile(tenantId, job.id, key, bytes),
              packageFile: key => packageFile(tenantId, job.id, key),
            }),
          });
        }
      }
    } else {
    if (job.payload.productionVersion === 2 && state.research?.complete === true)
      await (await import("./company-report-final-review")).reviewCompletePackage(job, state, live);
    await advancePackage(state, {
      researchOnly: job.payload.researchOnly === true,
      checkpoint,
      research: async () => {
        if (!state.intake.website) {
          const domain = state.intake.contactEmail?.split("@")[1]?.toLowerCase();
          if (!domain || /^(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|live|aol|icloud|me|msn|protonmail|proton)\./.test(domain))
            throw new Error("A public company website is needed: this contact email does not identify a unique business website.");
          state.intake.website = `https://${domain}/`;
          await checkpoint();
        }
        const { researchCompanyPackage } = await import("./company-report-research");
        // Inject only the live lease check; production adapters remain server-owned.
        const research = await import("./business-report-evidence");
        const browser = await import("../camofox-tool"), audit = await import("../audit-engine");
        return researchCompanyPackage(state.intake, tenantId, job.id, {
          collect: research.collectBusinessReportEvidence, live,
          fetch: url => audit.safeFetchText(url, { timeoutMs: 6000, maxBytes: 300_000, maxRedirects: 2 }),
          browse: params => browser.executeCamofoxAction(params),
          prior: state.research,
           backfillOnly: job.payload.researchOnly === true,
          checkpoint: async value => { state.research = value; await checkpoint(); },
        });
      },
      recover: async kind => {
        const [prior] = rows(await db.execute(sql`SELECT id FROM agent_jobs WHERE tenant_id=${tenantId}
          AND kind='business_report_review' AND payload->'input'->>'orderId'=${orderId(kind)}
          AND payload->'input'->>'reportOnly'='true' ORDER BY id DESC LIMIT 1`));
        return prior?.id ?? null;
      },
      canResumeDraft: async kind => {
        if (job.payload.productionVersion !== 2) return false;
        await live();
        const [current] = rows(await db.execute(sql`SELECT payload FROM agent_jobs WHERE id=${job.id}
          AND tenant_id=${tenantId} AND kind=${PACKAGE_JOB_KIND} AND status='running'
          AND attempts=${job.attempts} AND lease_until>NOW()`));
        if (!current) return false;
        const claims = Object.keys(current.payload.packageSpend || {}).filter(key => key.startsWith(`draft:${kind}:`));
        // Every paid dispatch must have a committed complete answer, or it is
        // uncertain and cannot be replayed. Unclaimed remaining sections are safe.
        return claims.every(key => !!confirmedPackageDraft(key.slice(6).split(":recovery:")[0],
          PACKAGE_MODEL_SEATS[kind].model, current.payload.packageDrafts || {}));
      },
      draft: async (kind, sharedEvidence) => {
        await live();
        const modern = job.payload.productionVersion === 2;
        const params = { intake: state.intake, tenantId, customerEmail: "", orderId: orderId(kind),
          sharedEvidence, reportOnly: true,
          ...(modern ? { sectionDrafter: packageSectionDrafter(job, kind, live), draftModelId: PACKAGE_MODEL_SEATS[kind].model,
            paidJuryBatch: `company-package:${job.id}`, operatorJobId: `company-package:${job.id}` } : {}) };
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
        const audioUrl = fulfillment.audio?.viewUrl;
        if (job.payload.productionVersion === 2 && !audioUrl) return { status: "error" };
        if (audioUrl) assertReportAudioUrl(audioUrl);
        return { status: "done", filename: fulfillment.fileName, sections: value.payload.state.approvedSections, audioUrl };
      },
      assemble: async (kind, review) => {
        await live();
        const [source] = rows(await db.execute(sql`SELECT data FROM file_storage WHERE tenant_id=${tenantId}
          AND filename=${review.filename!} AND mime_type='application/pdf' ORDER BY id DESC LIMIT 1`));
        if (typeof source?.data !== "string") throw new Error("Completed full report has no durable PDF bytes");
        await storeFile(tenantId, job.id, `${kind}-full`, Buffer.from(source.data, "base64"));
        if (!state.files.some(file => file.key === `${kind}-full`)) {
          state.files.push({ key: `${kind}-full`, label: `${PACKAGE_REPORT_NAMES[kind]} — Complete report (private)`,
            filename: `${kind}-full.pdf`, category: "full", ...(review.audioUrl ? { audioUrl: review.audioUrl } : {}) });
          await checkpoint();
        }
        const c = state.research!.coverage;
        const teaser = await packageFile(tenantId, job.id, `${kind}-teaser`) ?? await createPackageTeaser({ kind, company: state.intake.company, principalName: state.intake.principalName,
          sections: review.sections!, capturedAt: state.research!.evidence.capturedAt, evidence: state.research!.evidence,
          coverage: `${c.reviewed} rendered pages / ${c.discovered} discovered URLs; ${c.failed} failed. ${c.capped ? "Partial bounded review." : "All discovered in-scope pages visited."} See full report for limitations.` });
        await storeFile(tenantId, job.id, `${kind}-teaser`, teaser);
        return (["full", "teaser"] as const).map(category => ({ key: `${kind}-${category}`,
          label: `${PACKAGE_REPORT_NAMES[kind]} — ${category === "full" ? "Complete report (private)" : "One-page teaser"}`,
          filename: `${kind}-${category}.pdf`, category, ...(category === "full" && review.audioUrl ? { audioUrl: review.audioUrl } : {}) }));
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
    }
    if (state.phase === "done" || state.phase === "blocked") return { phase: state.phase };
    // A child may reserve spend at ANY instant. Never select then replace the
    // entire payload: that race would erase a newly committed paid claim.
    const deferred = rows(await db.execute(sql`UPDATE agent_jobs
      SET status='pending',payload=jsonb_set(payload,'{state}',${JSON.stringify(state)}::jsonb),
        next_run_at=NOW()+INTERVAL '30 seconds',lease_until=NULL,error=NULL
      WHERE id=${job.id} AND tenant_id=${tenantId} AND kind=${PACKAGE_JOB_KIND}
        AND status='running' AND attempts=${job.attempts} AND lease_until>NOW() RETURNING id`));
    if (deferred.length !== 1) throw new Error("Package defer lease lost");
    return { deferred: true };
  } catch (error) {
    if (leaseLost) throw new Error("Package lost lease; no further dispatch allowed");
    state.phase = "blocked";
    const message = error instanceof Error ? error.message : "";
    const truncated = (error as any)?.code === "COMPILATION_TRUNCATED";
    const compilationInvalid = ["COMPILATION_FORMAT_INVALID", "COMPILATION_CONTENT_INVALID"].includes((error as any)?.code);
    const compilationCheck = compilationInvalid ? compilationValidationFailure(error) : undefined;
    const corrections = Object.values((state as any).compilation?.slots ?? {}) as any[];
    const correctionStopped = corrections.some(slot => slot.phase !== "complete" && slot.correction);
    const targetedStopped = corrections.some(slot => slot.phase !== "complete" && slot.targetedRepair);
    const publicationFailures: Record<string, string> = {
      COMPANY_AUDIO_ASSEMBLY_FAILED: "Joining or validating the saved Fish audio",
      COMPANY_AUDIO_UPLOAD_FAILED: "Uploading or verifying the completed Fish MP3",
      COMPANY_PDF_RENDER_FAILED: "Rendering the PDF and embedding its audio link",
      COMPANY_PDF_DELIVERY_FAILED: "Delivering or verifying the PDF",
      COMPANY_TEASER_DELIVERY_FAILED: "Delivering or verifying the three-page customer teaser",
    };
    const publicationCode = typeof (error as any)?.code === "string" ? (error as any).code : "";
    const publicationFailure = Object.hasOwn(publicationFailures, publicationCode)
      ? publicationFailures[publicationCode] : undefined;
    const failureCode = truncated ? "output_limit" : /lease|authority|stopped/i.test(message) ? "authority" :
      /window|24.hour|deadline|timeout/i.test(message) ? "deadline" :
      /checkpoint|database|connection|storage|PDF bytes/i.test(message) ? "storage" :
      compilationInvalid || /final review|context|binding|identity|limit/i.test(message) ? "validation" : "unclassified";
    const correlationId = randomUUID();
    state.error = publicationFailure
      ? `${publicationFailure} failed (reference ${correlationId}). Saved reports and purchased audio segments are preserved; continuation reuses them.`
      : targetedStopped
      ? `The separately approved additional correction did not complete acceptance (reference ${correlationId}). ${compilationCheck ? `${compilationCheck.label} ` : ""}${compilationCorrectionStopReason(corrections.map(slot => ({ phase: slot.phase, correction: slot.targetedRepair })))} All original and corrective receipts remain saved. No further automatic paid call is authorized.`
      : correctionStopped
      ? `The one permitted corrective attempt did not complete acceptance (reference ${correlationId}). ${compilationCheck ? `${compilationCheck.label} ` : ""}${compilationCorrectionStopReason(corrections)} Original responses, correction receipts and spend reservations are preserved. No further automatic paid call will be made for this step.`
      : truncated
      ? "A model response reached its output token limit and is incomplete. Saved research and completed compilations are preserved. Use the explicit replacement control if available; ordinary Continue will not repeat this paid call."
      : compilationInvalid
      ? `The saved model response did not pass its ${(error as any).code === "COMPILATION_FORMAT_INVALID" ? "JSON format" : "evidence/content"} checks (reference ${correlationId}). ${compilationCheck ? `${compilationCheck.label} ` : ""}Research, completed reports and the response are preserved. It will not be automatically repeated.`
      : (error as any)?.code === "COMPANY_RESEARCH_TIMEOUT"
      ? message
      : error instanceof Error && /^(?:Website exceeds the (?:5,000-page|500-sitemap) safety limit|A public company website is needed:)/.test(error.message)
      ? error.message
      : error instanceof Error && error.message === "Package final review requires corrections; approved individual reports retained"
        ? error.message : `Package stopped (${failureCode}; reference ${correlationId}). Saved research and completed reports are preserved.`;
    await checkpoint();
    console.error("[company-package] blocked", { jobId: job.id, failureCode, correlationId,
      validationCheck: compilationCheck?.check,
      errorCode: typeof (error as any)?.code === "string" && /^[A-Z0-9_]{1,40}$/.test((error as any).code)
        ? (error as any).code : undefined });
    return { phase: "blocked" };
  } finally { clearInterval(heartbeat); }
}
