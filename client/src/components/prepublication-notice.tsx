import facts from "../../../docs/release-facts.json";

export const CURRENT_SOURCE_RELEASE = "R137.3+sec2";
export const SOURCE_UPDATE_SUMMARY = `${CURRENT_SOURCE_RELEASE} — November 17, 2026 legacy credential revocation checks, offline logout cleanup, Skills navigation, private-mode website guidance and current repository documentation.`;
export const DEVELOPMENT_PLATFORM_SUMMARY =
  `${facts.metrics.registeredTools} total registered tools; ` +
  `${facts.metrics.declaredTables} declared / ${facts.metrics.liveTables} live development tables; ` +
  `${facts.metrics.platformIndexes} platform indexes (${facts.metrics.nonPrimaryKeyIndexes} non-PK); ` +
  `${facts.metrics.activeCapabilities} capabilities; ${facts.metrics.totalSkills} platform skills; ` +
  `${facts.metrics.activePersonas} personas; ${facts.metrics.coreRegistryModels} curated models; ` +
  `${facts.metrics.governanceRules} governance rules. Development evidence, not production telemetry.`;
export const CURRENT_PLATFORM_DESCRIPTION =
  `${SOURCE_UPDATE_SUMMARY} ${DEVELOPMENT_PLATFORM_SUMMARY} ` +
  "Scoped evidence is not whole-platform certification. " +
  "The optional legacy MCP path now checks current account activity for cached and global owner keys and refuses authorization-store failures. " +
  "Failed remote logout no longer retains local identity or private query data; remote session revocation still requires server confirmation. " +
  "Authenticated Skills navigation reaches the workspace; private-mode public pages do not offer inaccessible contact or purchase forms. " +
  "November 6 corrections tighten tenant-scoped insight recovery, channel writes, research references and agent-run ownership. " +
  "Settings model selection and Memory navigation received focused repairs; provider health is platform-admin-only. " +
  "Engineering Q&A provides 19 source-linked comparisons and private owner notes; reference text grants no tool authority. " +
  "Webhook follow-ups preserve tenant-bound issue/PR conversation context. Saved-run confirmation is read-only and does not replay actions. " +
  "Harness diagnosis prioritizes recurring failures; schema compaction is an opt-in development trial, not proven cost savings. " +
  "Weekly video discovery reviews every selected daily upload without a short-clip duration ceiling. " +
  "PDF input ownership and mission payment association have focused source corrections; coding documentation preserves security and current owner authority. " +
  "The owner-only AI Stack Decision Review preparation package contains eight documents, including a $350 price hypothesis; " +
  "customer-specific fulfillment remains manual, with no checkout or public product launch. " +
  "Full company-package continuation and review remain in development; final report/audio delivery proof is pending. " +
  "Development updates cover chat disconnect and quota recovery, Gmail reconnect navigation, and tenant-audit checkpoint continuity. " +
  "Focused production checks verified five guarded business pilots on October 19, not the whole platform. " +
  "Focused offline regressions cover disabled-tenant authorization and per-hop app-side DNS pinning; the wider tenant audit remains degraded and incomplete. " +
  "A successful development journey, source change or saved provider cooldown is not production proof or a provider-uptime guarantee. " +
  "Muse advisory coordination remains partial; owner integrations require their own setup. " +
  "Production verifier completion and an application-wide aggregate metered-AI budget remain unverified.";
