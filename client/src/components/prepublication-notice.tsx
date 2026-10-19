import facts from "../../../docs/release-facts.json";

export const CURRENT_SOURCE_RELEASE = "R137+sec";
export const SOURCE_UPDATE_SUMMARY = `${CURRENT_SOURCE_RELEASE} — October 19, 2026 business pilots, company reports and evidence-first operations.`;
export const DEVELOPMENT_PLATFORM_SUMMARY =
  `${facts.metrics.registeredTools} total registered tools; ` +
  `${facts.metrics.declaredTables} declared / ${facts.metrics.liveTables} live development tables; ` +
  `${facts.metrics.platformIndexes} platform indexes (${facts.metrics.nonPrimaryKeyIndexes} non-PK); ` +
  `${facts.metrics.activeCapabilities} capabilities; ${facts.metrics.totalSkills} platform skills; ` +
  `${facts.metrics.activePersonas} personas; ${facts.metrics.coreRegistryModels} curated models; ` +
  `${facts.metrics.governanceRules} governance rules. Development evidence, not production telemetry.`;
export const CURRENT_PLATFORM_DESCRIPTION =
  `${SOURCE_UPDATE_SUMMARY} ${DEVELOPMENT_PLATFORM_SUMMARY} ` +
  "Recent changes add owner-only business health, release readiness, governance and cost/routing pilots; " +
  "read-only website readiness checks; company report packages with required narrated audio; private owner alert logs; " +
  "receipt-backed delivery checks, outcome-first briefings and evidence-linked video packaging. " +
  "Owner-requested live checks verified the five pilots on October 19; this is not whole-platform certification. " +
  "Earlier changes cover Treasury stock/crypto paper simulations, optional AgentID sign-in, " +
  "Robert personal support, model-route evidence, an opt-in capped owner paid fallback, " +
  "stream progress and correction-aware recovery, restricted Copilot chat and safer tenant/file boundaries. " +
  "Muse advisory coordination remains partial; owner integrations require their own setup. " +
  "Source availability is not deployment or inference proof. Production verifier completion " +
  "and an application-wide aggregate metered-AI budget remain unverified.";
