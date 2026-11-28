import { createLegionWorker } from "./background";
import { currentTenantId } from "../lib/tenant-context";
import { legionBackgroundEnabled, legionProxyPort, legionShutdownSignal } from "./runtime";
import { legionRequest } from "./proxy-client";
import { dispatchLocalBackground, surfaceLocalEnabled } from "./local-provider-runtime";
import { sparkRelayStore, sparkRelayEnabled } from "./spark-relay-runtime";

/** Device-specific session locks live at each native generation transport. */
export const runLegionBackground = createLegionWorker({
  enabled: legionBackgroundEnabled,
  trustedTenant: currentTenantId,
  acquire: async () => async () => {},
  request: (body, signal) => legionRequest(legionProxyPort(), "/v1/chat/completions", body, 90_000,
    AbortSignal.any([legionShutdownSignal(), ...(signal ? [signal] : [])])),
  dispatch: (body, accept, signal, task) => dispatchLocalBackground(body,
    AbortSignal.any([legionShutdownSignal(), ...(signal ? [signal] : [])]), accept, task),
  providerEnabled: (provider, candidate) => candidate?.transport === "spark-relay" ? sparkRelayEnabled() :
    provider === "surface-local" ? surfaceLocalEnabled() : legionBackgroundEnabled(),
  record: async receipt => {
    // Spark ingress accounts the native result once, even after a parent
    // timeout. Re-consuming a retained result must not double-count it.
    if (Number.isSafeInteger(receipt.relayJobId))
      return (await sparkRelayStore.get(1, receipt.relayJobId))?.result?.ledgerConfirmed === true;
    const { recordCost } = await import("../agentic/cost-ledger");
    const recorded = await recordCost({ tenantId: 1, toolName: receipt.toolName, model: receipt.model,
      tokensIn: receipt.tokensIn, tokensOut: receipt.tokensOut, costUsd: 0, operation: receipt.operation });
    return recorded;
  },
});

