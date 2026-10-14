import facts from "../../../docs/release-facts.json";

export const CURRENT_SOURCE_RELEASE = "R136.2";
export const SOURCE_UPDATE_SUMMARY = `${CURRENT_SOURCE_RELEASE} — October 14, 2026 source and documentation update.`;
export const DEVELOPMENT_PLATFORM_SUMMARY =
  `${facts.metrics.registeredTools} total registered tools; ` +
  `${facts.metrics.declaredTables} declared / ${facts.metrics.liveTables} live development tables; ` +
  `${facts.metrics.platformIndexes} platform indexes (${facts.metrics.nonPrimaryKeyIndexes} non-PK); ` +
  `${facts.metrics.activeCapabilities} capabilities; ${facts.metrics.totalSkills} platform skills; ` +
  `${facts.metrics.activePersonas} personas; ${facts.metrics.coreRegistryModels} curated models; ` +
  `${facts.metrics.governanceRules} governance rules. Development evidence, not production telemetry.`;
export const CURRENT_PLATFORM_DESCRIPTION =
  `${SOURCE_UPDATE_SUMMARY} ${DEVELOPMENT_PLATFORM_SUMMARY} ` +
  "Recent changes cover Treasury stock/crypto paper simulations, optional AgentID sign-in, " +
  "Robert personal support, model-route evidence, an opt-in capped owner paid fallback, " +
  "stream progress and correction-aware recovery, restricted Copilot chat and safer tenant/file boundaries. " +
  "Muse advisory coordination remains partial; owner integrations require their own setup. " +
  "Source availability is not deployment or inference proof. Production verifier completion " +
  "and an application-wide aggregate metered-AI budget remain unverified.";
