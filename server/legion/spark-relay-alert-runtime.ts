import { db } from "../db";
import { currentTenantId, withTenantContext } from "../lib/tenant-context";
import { resolveOwnerEmail } from "../lib/owner-email";
import { sparkRelayEnabled, sparkRelayStore } from "./spark-relay-runtime";
import { createSparkRelayAlerts, sparkRelayAlertConfiguration } from "./spark-relay-alerts";
import { createSparkRelayAlertUpdater } from "./spark-relay-alert-store";
import type { RelayDatabase } from "./spark-relay-store";

const permitted = () => sparkRelayEnabled() &&
  (currentTenantId() === null || currentTenantId() === 1);

export const checkSparkRelayOwnerAlerts = createSparkRelayAlerts({
  configuration: () => sparkRelayAlertConfiguration(process.env),
  permitted,
  observe: () => sparkRelayStore.workerFreshness(1),
  update: createSparkRelayAlertUpdater(db as unknown as RelayDatabase),
  send: async notice => {
    if (!permitted() || !sparkRelayAlertConfiguration(process.env).enabled)
      throw Error("Spark notification permission revoked");
    const to = resolveOwnerEmail();
    if (!to) throw Error("Spark notification owner mailbox not configured");
    const { sendOwnerEmailVerified } = await import("../lib/owner-delivery-email");
    const restored = notice.kind === "recovery";
    await withTenantContext({ tenantId: 1, source: "cron" }, () => sendOwnerEmailVerified({
      tenantId: 1, to, stableMessageKey: `spark-relay:${notice.environment}:${notice.token}`,
      subject: restored ? "[RECOVERY] Spark backup connection restored" : "[RUNTIME] Spark backup connection offline",
      text: [
        `WHAT: Spark's backup relay connection ${restored ? "is responding again" : "has remained stale"}.`,
        "WHY IT MATTERS: This connection provides backup access to Lenovo; direct access may still work.",
        `WHEN: ${new Date().toISOString()}`,
        `WHERE: Owner-only ${notice.environment} Spark relay.`,
        `EVIDENCE: Last worker poll: ${notice.seenAt}.`,
        restored ? "A fresh worker poll was observed. This does not verify inference readiness or job success."
          : "No fresh worker poll was observed for the configured sustained stale period.",
        "ACTIONS: Observation only. No inference, retries, repairs or permission changes were performed.",
        restored ? "WHAT YOU NEED TO DO: Nothing unless backup jobs still fail."
          : "WHAT YOU NEED TO DO: Check that Spark's installed relay worker and Lenovo are connected and running.",
      ].join("\n\n"),
    }));
    console.info(`[spark-relay-alerts] ${notice.kind} owner INBOX verified`);
  },
});
