import { createLegionDiagnostics } from "./felix-diagnostics";
import { createLegionWorker } from "./background";
import { legionBackgroundEnabled, legionProxyPort, legionShutdownSignal, legionRuntimeReady } from "./runtime";
import { legionRequest } from "./proxy-client";
import { withLocalInferenceSlot } from "./local-slots";
import { currentTenantId } from "../lib/tenant-context";
import { LEGION_MODEL } from "./model-policy";
import { db } from "../db";
import { activityLog } from "@shared/schema";

export const runLegionDiagnostics = createLegionDiagnostics({
  enabled: legionBackgroundEnabled,
  status: async signal => {
    const catalog = await legionRequest(legionProxyPort(), "/api/tags", undefined, 2500,
      AbortSignal.any([legionShutdownSignal(), signal]));
    if (!Array.isArray(catalog.models)) throw Error("Local catalog unavailable");
    return {
      modelAvailable: catalog.models.some((model: any) => model?.name === LEGION_MODEL || model?.model === LEGION_MODEL),
      transportReady: legionRuntimeReady(),
    };
  },
  infer: async signal => {
    // A fresh closure keeps exact provider output isolated across invocations.
    let rawOutput: string | undefined;
    let usageLedgerConfirmed = false;
    const active = AbortSignal.any([legionShutdownSignal(), signal]);
    const run = createLegionWorker({
      enabled: legionBackgroundEnabled,
      trustedTenant: currentTenantId,
      acquire: async () => async () => {},
      // No multi-provider dispatcher: exactly one admitted Legion request.
      request: (body, requestSignal) => withLocalInferenceSlot("legion-local",
        AbortSignal.any([active, ...(requestSignal ? [requestSignal] : [])]), async admitted => {
          const response = await legionRequest(legionProxyPort(), "/v1/chat/completions", body, 30_000, admitted);
          rawOutput = response.choices?.[0]?.message?.content;
          return response;
        }),
      record: async receipt => {
        const { recordCost } = await import("../agentic/cost-ledger");
        const recorded = await recordCost({ tenantId: 1, toolName: receipt.toolName, model: receipt.model,
          tokensIn: receipt.tokensIn, tokensOut: receipt.tokensOut, costUsd: 0,
          operation: "felix-fixed-arithmetic" });
        usageLedgerConfirmed = recorded === true;
        return recorded;
      },
    });
    const result = await run({
      tenantId: 1, task: "delegation-status", signal: active,
      messages: [{ role: "user", content: "What is 17 + 25? Reply with only the number." }],
      validateContent: content => { if (content !== "42") throw Error("Arithmetic check failed"); },
    });
    return { ...result, rawOutput, usageLedgerConfirmed };
  },
  record: async receipt => {
    const rows = await db.insert(activityLog).values({
      tenantId: 1, actorType: "agent", actorName: "Felix",
      action: "legion_synthetic_acceptance", resourceType: "local_inference",
      resourceId: String(receipt.probeId),
      description: "Fixed 17 + 25 acceptance; validated Legion provider response; no cloud fallback.",
      metadata: receipt,
    }).returning({ id: activityLog.id });
    if (!rows[0]?.id) throw Error("Synthetic receipt was not persisted");
    return rows[0].id;
  },
});
