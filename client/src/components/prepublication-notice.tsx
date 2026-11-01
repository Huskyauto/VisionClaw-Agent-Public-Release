import facts from "../../../docs/release-facts.json";

export const CURRENT_SOURCE_RELEASE = "R137.1+sec";
export const SOURCE_UPDATE_SUMMARY = `${CURRENT_SOURCE_RELEASE} — October 31, 2026 owner preparation, bounded recovery and evidence-aware release updates.`;
export const DEVELOPMENT_PLATFORM_SUMMARY =
  `${facts.metrics.registeredTools} total registered tools; ` +
  `${facts.metrics.declaredTables} declared / ${facts.metrics.liveTables} live development tables; ` +
  `${facts.metrics.platformIndexes} platform indexes (${facts.metrics.nonPrimaryKeyIndexes} non-PK); ` +
  `${facts.metrics.activeCapabilities} capabilities; ${facts.metrics.totalSkills} platform skills; ` +
  `${facts.metrics.activePersonas} personas; ${facts.metrics.coreRegistryModels} curated models; ` +
  `${facts.metrics.governanceRules} governance rules. Development evidence, not production telemetry.`;
export const CURRENT_PLATFORM_DESCRIPTION =
  `${SOURCE_UPDATE_SUMMARY} ${DEVELOPMENT_PLATFORM_SUMMARY} ` +
  "The owner-only AI Stack Decision Review preparation package contains eight documents, including a $350 price hypothesis; " +
  "customer-specific fulfillment remains manual, with no checkout or public product launch. " +
  "Full company-package continuation and review remain in development; final report/audio delivery proof is pending. " +
  "Development updates cover chat disconnect and quota recovery, Gmail reconnect navigation, and tenant-audit checkpoint continuity. " +
  "Focused production checks verified five guarded business pilots on October 19, not the whole platform. " +
  "Focused offline regressions cover disabled-tenant authorization and per-hop app-side DNS pinning; the wider tenant audit remains degraded and incomplete. " +
  "A successful development journey, source change or saved provider cooldown is not production proof or a provider-uptime guarantee. " +
  "Muse advisory coordination remains partial; owner integrations require their own setup. " +
  "Production verifier completion and an application-wide aggregate metered-AI budget remain unverified.";
