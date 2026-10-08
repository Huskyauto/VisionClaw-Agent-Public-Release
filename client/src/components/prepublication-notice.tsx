import facts from "../../../docs/release-facts.json";

export const CURRENT_SOURCE_RELEASE = "R135.9+sec";
export const SOURCE_UPDATE_SUMMARY = `${CURRENT_SOURCE_RELEASE} — October 8, 2026 source update.`;
export const DEVELOPMENT_PLATFORM_SUMMARY =
  `${facts.metrics.registeredTools} total registered tools; ` +
  `${facts.metrics.declaredTables} declared / ${facts.metrics.liveTables} live development tables; ` +
  `${facts.metrics.platformIndexes} platform indexes (${facts.metrics.nonPrimaryKeyIndexes} non-PK); ` +
  `${facts.metrics.activeCapabilities} capabilities; ${facts.metrics.totalSkills} platform skills; ` +
  `${facts.metrics.activePersonas} personas; ${facts.metrics.coreRegistryModels} curated models; ` +
  `${facts.metrics.governanceRules} governance rules. Development evidence, not production telemetry.`;
export const CURRENT_PLATFORM_DESCRIPTION =
  `${SOURCE_UPDATE_SUMMARY} ${DEVELOPMENT_PLATFORM_SUMMARY} ` +
  "Recent source changes add restricted owner Copilot chat, subscription-first jury recovery, " +
  "scoped Haiku 5.5 content drafting, Muse Spark 1.3 selection, a Beam availability watch, " +
  "owner-only skill export and dependency patches. Owner integrations remain opt-in; " +
  "catalog presence is not inference proof. Production verification and aggregate budget enforcement remain incomplete.";
