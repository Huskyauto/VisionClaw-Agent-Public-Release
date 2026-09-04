import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { discoverCmmcProspectsDefinition, lookupSamCompanyCageDefinition, lookupSamExactCompanyDefinition } from "./definitions";
import { getCmmcProspectingService } from "./service";
import type { CmmcCompanyLookupResult, CmmcProspectResult, SamExactCompanyLookupResult } from "./service";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstResultRow<T extends UnknownRecord>(result: unknown): T | undefined {
  if (Array.isArray(result)) return isRecord(result[0]) ? result[0] as T : undefined;
  if (!isRecord(result) || !Array.isArray(result.rows)) return undefined;
  return isRecord(result.rows[0]) ? result.rows[0] as T : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringArray(value: unknown, error: string): string[] {
  if (!Array.isArray(value)) return [];
  if (!value.every((item): item is string => typeof item === "string")) throw new Error(error);
  return value;
}

const inFlightCmmcRuns = new Map<string, Promise<CmmcProspectResult>>();
const inFlightSamCompanyLookups = new Map<string, Promise<CmmcCompanyLookupResult>>();
const inFlightSamExactLookups = new Map<string, Promise<SamExactCompanyLookupResult>>();

export async function discoverCmmcProspectsHandler(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for discover_cmmc_prospects" };
  try {
    const shouldDeliver = params.deliver !== false;
    if (!ctx.projectId) {
      return { error: "An active project is required before CMMC discovery so the verified roster can be checkpointed and delivered without another SAM.gov call. Open the intended project and retry." };
    }
    const cmmc = getCmmcProspectingService();
    const { db } = await import("../../../db");
    const { sql } = await import("drizzle-orm");
    const ownership = await db.execute(sql`
      SELECT id, name FROM projects
      WHERE id = ${ctx.projectId} AND tenant_id = ${ctx.tenantId}
      LIMIT 1
    `);
    const project = firstResultRow<{ id: unknown; name: unknown }>(ownership);
    if (!project) {
      return { error: `Active project #${ctx.projectId} is not owned by this tenant. CMMC discovery was not started and no SAM.gov quota was consumed.` };
    }
    const input = {
      tenantId: ctx.tenantId,
      query: typeof params.query === "string" ? params.query : "",
      states: stringArray(params.states, "each state must be a string"),
      dateWindow: isRecord(params.dateWindow)
        ? {
          from: typeof params.dateWindow.from === "string" ? params.dateWindow.from : "",
          to: typeof params.dateWindow.to === "string" ? params.dateWindow.to : "",
        }
        : { from: "", to: "" },
    };
    const checkpointContext = { tenantId: ctx.tenantId, projectId: ctx.projectId };
    const runKey = cmmc.cmmcProspectCacheKey(input);
    const flightKey = `${ctx.tenantId}:${ctx.projectId}:${runKey}`;
    let discoveryRun = inFlightCmmcRuns.get(flightKey);
    if (!discoveryRun) {
      discoveryRun = (async () => {
        const leaseOwner = await cmmc.acquireCmmcProspectLease(input, checkpointContext);
        if (!leaseOwner) throw new Error("This exact CMMC discovery run is already active. Retry the same call shortly; no duplicate SAM.gov request was made.");
        try {
          const recovered = await cmmc.loadCmmcProspectCheckpoint(input, checkpointContext);
          const discovered = await cmmc.discoverOrResumeCmmcProspects(input, recovered);
          if (discovered.outcome === "ok" || discovered.outcome === "partial" || discovered.outcome === "empty" || discovered.retryable) {
            await cmmc.persistCmmcProspectCheckpoint(input, checkpointContext, discovered);
          }
          return discovered;
        } finally {
          await cmmc.releaseCmmcProspectLease(input, checkpointContext, leaseOwner);
        }
      })();
      inFlightCmmcRuns.set(flightKey, discoveryRun);
    }
    let result;
    try {
      result = await discoveryRun;
    } finally {
      if (inFlightCmmcRuns.get(flightKey) === discoveryRun) inFlightCmmcRuns.delete(flightKey);
    }
    let deliveries: Array<{ fileName: string; success: boolean; artifactId?: number; fileId?: string; viewUrl?: string; downloadUrl?: string; projectFilesRegistered?: boolean; projectFilesWarning?: string; error?: string }> = [];
    if (shouldDeliver && cmmc.isCmmcProspectDeliveryReady(result)) {
      const { uploadAndShare } = await import("../../../google-drive");
      deliveries = await cmmc.deliverCmmcProspectArtifacts(
        result,
        { tenantId: ctx.tenantId, projectId: ctx.projectId },
        async (artifact: { fileName: string; mimeType: string; content: string }, idempotencyKey: string) => {
          const bytes = Buffer.from(artifact.content, "utf8");
          const { persistCmmcProspectArtifact } = await import("../../../cmmc-prospect-artifacts");
          const durable = await persistCmmcProspectArtifact({
            tenantId: ctx.tenantId!,
            projectId: ctx.projectId!,
            sourceRunKey: cmmc.cmmcProspectSourceRunKey(result.cacheKey),
            originalName: artifact.fileName,
            mimeType: artifact.mimeType,
            bytes,
          });
          const uploaded = await uploadAndShare({
            fileData: bytes,
            fileName: artifact.fileName,
            mimeType: artifact.mimeType,
            description: "CMMC prospecting output with attributable federal-source evidence",
            projectId: ctx.projectId,
            tenantId: ctx.tenantId,
            // Project deliverables need durable owner-access links, not a new
            // public permission. Some project folders intentionally inherit a
            // broader permission which Drive refuses to downgrade on a child.
            share: false,
            registerProjectFile: false,
            generatedArtifact: {
              artifactKind: "cmmc_prospect_report",
              logicalName: artifact.fileName,
              sourceRunKey: cmmc.cmmcProspectSourceRunKey(result.cacheKey),
              idempotencyKey,
              metadata: { outcome: result.outcome, candidateCount: result.candidates.length },
            },
          });
          if (uploaded.success && uploaded.fileId && ctx.projectId) {
            const { verifyDriveFileExists } = await import("../../../google-drive");
            const access = await verifyDriveFileExists(uploaded.fileId);
            if (!access.exists || access.reason !== "ok") {
              return {
                success: false,
                artifactId: uploaded.artifactId,
                fileId: uploaded.fileId,
                error: `Drive file could not be verified for the connected owner account: ${access.reason}`,
              };
            }
            const viewUrl = uploaded.viewUrl || `https://drive.google.com/file/d/${uploaded.fileId}/view`;
            const downloadUrl = uploaded.downloadUrl || `https://drive.google.com/uc?export=download&id=${uploaded.fileId}`;
            try {
              const { db } = await import("../../../db");
              const { sql } = await import("drizzle-orm");
              const existing = await db.transaction(async (tx) => {
                await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cmmc-project-file:${ctx.tenantId}:${ctx.projectId}:${artifact.fileName}:${uploaded.fileId}`}))`);
                const found = await tx.execute(sql`
                  SELECT pf.id
                  FROM project_files pf
                  JOIN projects p ON p.id = pf.project_id AND p.tenant_id = ${ctx.tenantId}
                  WHERE pf.project_id = ${ctx.projectId}
                    AND pf.file_name = ${artifact.fileName}
                    AND pf.file_url = ${viewUrl}
                  LIMIT 1
                `);
                const prior = firstResultRow<{ id: unknown }>(found);
                if (prior) return prior;
                const inserted = await tx.execute(sql`
                  INSERT INTO project_files
                    (project_id, file_name, file_path, file_url, file_type, file_size, uploaded_by)
                  SELECT
                    ${ctx.projectId}, ${artifact.fileName}, ${durable.filename}, ${viewUrl},
                    ${artifact.mimeType}, ${Buffer.byteLength(artifact.content, "utf8")}, ${"VisionClaw Agent"}
                  WHERE EXISTS (
                    SELECT 1 FROM projects
                    WHERE id = ${ctx.projectId} AND tenant_id = ${ctx.tenantId}
                  )
                  RETURNING id
                `);
                return firstResultRow<{ id: unknown }>(inserted);
              });
              if (!existing) throw new Error("tenant-scoped project file read-back failed");
              return {
                success: true,
                artifactId: uploaded.artifactId,
                fileId: uploaded.fileId,
                viewUrl,
                downloadUrl,
                projectFilesRegistered: true,
              };
            } catch (error) {
              return {
                success: false,
                artifactId: uploaded.artifactId,
                fileId: uploaded.fileId,
                viewUrl,
                downloadUrl,
                projectFilesRegistered: false,
                error: `Drive file exists but project registration failed: ${error instanceof Error ? error.message : String(error)}`,
              };
            }
          }
          return {
            success: uploaded.success,
            artifactId: uploaded.artifactId,
            fileId: uploaded.fileId,
            viewUrl: uploaded.viewUrl,
            downloadUrl: uploaded.downloadUrl,
            projectFilesRegistered: isRecord(uploaded) && typeof uploaded.projectFilesRegistered === "boolean"
              ? uploaded.projectFilesRegistered
              : undefined,
            error: uploaded.error,
            projectFilesWarning: uploaded.projectFilesWarning,
          };
        },
      );
    } else if (shouldDeliver && result.pendingStates.length > 0 && result.retryable) {
      deliveries = [{
        fileName: "artifact_set",
        success: false,
        error: `Delivery deferred safely. Verified progress was checkpointed; retry the same call to research pending states only: ${result.pendingStates.join(", ")}`,
      }];
    } else if (shouldDeliver && result.pendingStates.length > 0) {
      deliveries = [{
        fileName: "artifact_set",
        success: false,
        error: `Delivery blocked after a non-retryable SAM.gov failure. Completed states: ${result.completedStates.join(", ") || "none"}; unresolved states: ${result.pendingStates.join(", ")}`,
      }];
    } else if (shouldDeliver && result.verificationFailures.length > 0) {
      deliveries = [{
        fileName: "artifact_set",
        success: false,
        error: `Delivery blocked because source verification did not complete: ${result.verificationFailures.join(", ")}`,
      }];
    } else if (shouldDeliver) {
      deliveries = [{
        fileName: "artifact_set",
        success: false,
        error: `No prospect artifacts created because discovery ended with ${result.outcome} and ${result.candidates.length} verified rows`,
      }];
    }
    // Preserve the complete structured roster for deterministic exports and
    // consumers, while also fencing the serialized source-derived content
    // before it enters the model transcript.
    const { wrapExternalContent } = await import("../../../external-content-security");
    const { wrapped } = wrapExternalContent(JSON.stringify(result), "web_fetch", { url: "https://api.sam.gov/entity-information/v3/entities" });
    return {
      outcome: result.outcome,
      terminal: result.terminal,
      retryable: result.retryable,
      cached: result.cached,
      candidateCount: result.candidates.length,
      excludedWithoutCage: result.excludedWithoutCage,
      sourceCalls: result.sourceCalls,
      verificationCalls: result.verificationCalls,
      retrievedCount: result.retrievedCount,
      cappedCount: result.cappedCount,
      coverageComplete: result.coverageComplete,
      completedStates: result.completedStates,
      pendingStates: result.pendingStates,
      diagnostics: result.diagnostics,
      deliveries,
      fenced: wrapped,
    };
  } catch (error: unknown) {
    return { error: `CMMC prospect discovery rejected: ${errorMessage(error)}` };
  }
}

export async function lookupSamCompanyCageHandler(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for lookup_sam_company_cage" };
  try {
    const companyNames = stringArray(params.companyNames, "each company name must be a string");
    const includeInactive = params.includeInactive === true;
    const cmmc = getCmmcProspectingService();
    const flightKey = `${ctx.tenantId}:${includeInactive}:${JSON.stringify(companyNames)}`;
    let lookup = inFlightSamCompanyLookups.get(flightKey);
    if (!lookup) {
      lookup = (async () => {
        return cmmc.lookupSamCompanies({
          tenantId: ctx.tenantId as number,
          companyNames,
          includeInactive,
        });
      })();
      inFlightSamCompanyLookups.set(flightKey, lookup);
    }
    let result;
    try {
      result = await lookup;
    } finally {
      if (inFlightSamCompanyLookups.get(flightKey) === lookup) inFlightSamCompanyLookups.delete(flightKey);
    }
    const { wrapExternalContent } = await import("../../../external-content-security");
    const { wrapped } = wrapExternalContent(JSON.stringify(result), "web_fetch", {
      url: "https://api.sam.gov/entity-information/v3/entities",
    });
    return {
      outcome: result.outcome,
      terminal: result.terminal,
      retryable: result.retryable,
      resultCount: result.results.length,
      source: "Official SAM.gov Entity API",
      sourceCalls: result.sourceCalls,
      pendingNameCount: result.pendingNames.length,
      content: wrapped,
    };
  } catch (error: unknown) {
    return { error: `SAM.gov company lookup rejected: ${errorMessage(error)}` };
  }
}

export async function lookupSamExactCompanyHandler(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for lookup_sam_exact_company" };
  try {
    const companyName = typeof params.companyName === "string" ? params.companyName : "";
    const input = {
      tenantId: ctx.tenantId,
      companyName,
      ...(typeof params.state === "string" ? { state: params.state } : {}),
      ...(typeof params.city === "string" ? { city: params.city } : {}),
      ...(typeof params.streetAddress === "string" ? { streetAddress: params.streetAddress } : {}),
      ...(typeof params.zip === "string" ? { zip: params.zip } : {}),
      ...(typeof params.websiteDomain === "string" ? { websiteDomain: params.websiteDomain } : {}),
      ...(params.aliases !== undefined
        ? { aliases: stringArray(params.aliases, "each alias must be a string") }
        : {}),
      ...(typeof params.includeInactive === "boolean" ? { includeInactive: params.includeInactive } : {}),
      ...(typeof params.maxCandidates === "number" ? { maxCandidates: params.maxCandidates } : {}),
    };
    const cmmc = getCmmcProspectingService();
    const flightKey = `${ctx.tenantId}:${JSON.stringify(input)}`;
    let lookup = inFlightSamExactLookups.get(flightKey);
    if (!lookup) {
      lookup = cmmc.lookupSamExactCompany(input);
      inFlightSamExactLookups.set(flightKey, lookup);
    }
    let result;
    try {
      result = await lookup;
    } finally {
      if (inFlightSamExactLookups.get(flightKey) === lookup) inFlightSamExactLookups.delete(flightKey);
    }
    const { wrapExternalContent } = await import("../../../external-content-security");
    const { wrapped } = wrapExternalContent(JSON.stringify(result), "web_fetch", {
      url: "https://api.sam.gov/entity-information/v3/entities",
    });
    return {
      resolutionStatus: result.resolutionStatus,
      coverageComplete: result.coverageComplete,
      matched: result.matchedEntity !== null,
      source: "Official SAM.gov Entity API",
      sourceCalls: result.sourceCalls,
      retryable: result.retryable,
      content: wrapped,
    };
  } catch (error: unknown) {
    return { error: `Exact SAM.gov company lookup rejected: ${errorMessage(error)}` };
  }
}

export const cmmcProspectingDomainTools: RegisteredTool[] = [
  defineTool(discoverCmmcProspectsDefinition, discoverCmmcProspectsHandler),
  defineTool(lookupSamCompanyCageDefinition, lookupSamCompanyCageHandler),
  defineTool(lookupSamExactCompanyDefinition, lookupSamExactCompanyHandler),
];