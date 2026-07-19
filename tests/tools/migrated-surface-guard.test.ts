/**
 * Tools-layer-split S4-prep guard (plan.md): the migrated tools' REGISTERED
 * surface must be the exact same definition objects the legacy facade splices
 * into TOOL_DEFINITIONS (identity, not just deep-equality), every migrated
 * name must exist in the committed inventory baseline, and the legacy switch
 * must have NO leftover case arm for a migrated tool (divergence guard).
 *
 * Static-only reads of server/tools.ts (never imported — pg-pool hang).
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Importing the dispatcher registers the system domain handlers.
import "../../server/tools/dispatcher";
import { getMigratedDefinitions, isMigrated } from "../../server/tools/registry";
import {
  listModelsDefinition,
  templateScraperStatsDefinition,
  getUsageAnalyticsDefinition,
} from "../../server/tools/domains/system/definitions";
import {
  readOutputBlobDefinition,
  codeSliceDefinition,
  scanFileDefinition,
  readFileDefinition,
  writeFileDefinition,
  listUploadsDefinition,
  googleDriveDefinition,
} from "../../server/tools/domains/files/definitions";
import {
  scanForSecretsDefinition,
  agentSecurityScanDefinition,
  complianceAuditDefinition,
  verifyOutboundSafetyDefinition,
  scanForPromptInjectionDefinition,
} from "../../server/tools/domains/security/definitions";
import {
  searchMemoryDefinition,
  createMemoryDefinition,
  rememberForThisSessionDefinition,
  updateMemoryDefinition,
  recallContextDefinition,
  graphMemoryDefinition,
  getUnifiedMemoryContextDefinition,
  memoryGeometryScanDefinition,
} from "../../server/tools/domains/memory/definitions";
import {
  searchKnowledgeDefinition,
  knowledgeNavigateDefinition,
  createKnowledgeDefinition,
  storeTripleDefinition,
  queryTriplesDefinition,
  expireTripleDefinition,
  docSearchDefinition,
} from "../../server/tools/domains/knowledge/definitions";
import {
  webFetchDefinition,
  webSearchDefinition,
  fetchWeatherDefinition,
  fetchCryptoPriceDefinition,
  fetchExchangeRateDefinition,
  fetchWikipediaDefinition,
  fetchHackerNewsDefinition,
  lookupIpGeoDefinition,
  academicSearchDefinition,
  arxivSearchDefinition,
  pubmedSearchDefinition,
  openalexSearchDefinition,
  crossrefLookupDefinition,
  firecrawlSearchDefinition,
  firecrawlScrapeDefinition,
  readabilityExtractDefinition,
  firecrawlCrawlDefinition,
  firecrawlMapDefinition,
  scrapedPagesQueryDefinition,
  scrapedPageReadDefinition,
  scrapedPagesDeleteDefinition,
} from "../../server/tools/domains/web/definitions";
import {
  createCrewDefinition,
  createFlowDefinition,
} from "../../server/tools/domains/crews/definitions";
import {
  runBackgroundTaskDefinition,
  checkBackgroundTaskDefinition,
  listBackgroundTasksDefinition,
} from "../../server/tools/domains/background/definitions";
import {
  createPlanDefinition,
  listPlansDefinition,
  getPlanDefinition,
} from "../../server/tools/domains/minerva/definitions";
import {
  detectEmotionalStateDefinition,
  groundingInterventionDefinition,
} from "../../server/tools/domains/safety/definitions";
import {
  generateDesignDocDefinition,
} from "../../server/tools/domains/design-doc/definitions";
import {
  buildVoiceProfileDefinition,
  getVoiceProfileDefinition,
} from "../../server/tools/domains/voice-profile/definitions";
import {
  createTaskForceDefinition,
  listTaskForcesDefinition,
  chargeTaskForceDefinition,
  sunsetTaskForceDefinition,
} from "../../server/tools/domains/task-forces/definitions";
import {
  setDepartmentBudgetDefinition,
  checkDepartmentBudgetDefinition,
} from "../../server/tools/domains/department-budgets/definitions";
import {
  logExperimentDefinition,
  getExperimentsDefinition,
  runSelfImprovementDefinition,
} from "../../server/tools/domains/self-improvement/definitions";
import {
  createAbExperimentDefinition,
  recordAbEventDefinition,
} from "../../server/tools/domains/ab-optimizer/definitions";
import {
  revenueVsCostDefinition,
  agentCostSummaryDefinition,
} from "../../server/tools/domains/cost-ledger/definitions";
import {
  learnFromReferenceDefinition,
  recallReferencesDefinition,
} from "../../server/tools/domains/reference-learner/definitions";
import {
  scheduleWakeDefinition,
  cancelWakeDefinition,
  listWakesDefinition,
} from "../../server/tools/domains/wake-scheduler/definitions";
import {
  sendMessageDefinition,
  messagingStatusDefinition,
} from "../../server/tools/domains/messaging/definitions";
import {
  scheduleMessageDefinition,
  listScheduledMessagesDefinition,
  cancelScheduledMessageDefinition,
} from "../../server/tools/domains/recurring-messages/definitions";
import {
  aeoScoreDefinition,
  seoContentAuditDefinition,
  generateSchemaMarkupDefinition,
} from "../../server/tools/domains/seo/definitions";
import {
  lookupOutputSkillDefinition,
  repurposeContentDefinition,
} from "../../server/tools/domains/content-ops/definitions";
import {
  sculptorReviewDefinition,
  verifyFelixProposalSpecDefinition,
  crossCritiqueDefinition,
  listCritiquesDefinition,
  critiqueResponseDefinition,
  qualityBaselineSaveDefinition,
  qualityBaselineCheckDefinition,
  verifyDeliverableDefinition,
  verifyMathChainDefinition,
  gradeDeliverableDefinition,
  verifyDeliveryProofDefinition,
  verifyWithCoveDefinition,
} from "../../server/tools/domains/quality/definitions";
import {
  analyzePdfDefinition,
  createPdfDefinition,
  createStyledReportDefinition,
  fillPdfDefinition,
  createDocumentDefinition,
  createSpreadsheetDefinition,
  editPdfDefinition,
  listPdfFieldsDefinition,
} from "../../server/tools/domains/documents/definitions";
import {
  browserDefinition,
  stealthBrowseCamofoxDefinition,
  browserWorkflowDefinition,
  stealthBrowseDefinition,
  siteLoginDefinition,
} from "../../server/tools/domains/browser/definitions";
import {
  workspaceInitDefinition,
  workspaceUpdateStatusDefinition,
  workspaceLogArtifactDefinition,
  workspaceReadDefinition,
  workspaceFinalizeDefinition,
  workspaceListDefinition,
} from "../../server/tools/domains/workspace/definitions";
import {
  generateHooksDefinition,
  formatPostDefinition,
  generateContentMatrixDefinition,
  scorePostDefinition,
} from "../../server/tools/domains/social/definitions";
import {
  xPostTweetDefinition,
  xDeleteTweetDefinition,
  xGetTweetDefinition,
  xGetMentionsDefinition,
  xGetTimelineDefinition,
  xSearchDefinition,
  xLikeTweetDefinition,
  xRetweetDefinition,
  xGetMeDefinition,
} from "../../server/tools/domains/x-twitter/definitions";
import {
  enrichLeadDefinition,
  scoreLeadsDefinition,
  qualifyLeadsDefinition,
  createSequenceDefinition,
  enrollInSequenceDefinition,
  advanceSequenceDefinition,
  classifyReplyDefinition,
  listSequencesDefinition,
} from "../../server/tools/domains/outreach/definitions";
import {
  saveEvidenceDefinition,
  queryEvidenceDefinition,
  synthesizeResearchDefinition,
  addCompetitorDefinition,
  listCompetitorsDefinition,
  takeCompetitorSnapshotDefinition,
  detectCompetitorChangesDefinition,
  competitorBriefingDefinition,
  defineIcpDefinition,
} from "../../server/tools/domains/research-intel/definitions";
import {
  createInvoiceDefinition,
  listInvoicesDefinition,
  updateInvoiceStatusDefinition,
  invoiceAgingReportDefinition,
  logExpenseDefinition,
  listExpensesDefinition,
  expenseReportDefinition,
  recordKpiDefinition,
  kpiDashboardDefinition,
  kpiTrendDefinition,
  profitAndLossDefinition,
  revenueReportDefinition,
  cashFlowSummaryDefinition,
  businessHealthScoreDefinition,
  financialSnapshotDefinition,
} from "../../server/tools/domains/finance/definitions";
import {
  addCustomerDefinition,
  updateCustomerDefinition,
  listCustomersDefinition,
  logInteractionDefinition,
  customerPipelineDefinition,
} from "../../server/tools/domains/crm/definitions";
import {
  cancelScheduledPostDefinition,
  listScheduledPostsDefinition,
} from "../../server/tools/domains/scheduled-posts/definitions";
import {
  listProcedureEditsDefinition,
  applyProcedureEditDefinition,
  rollbackProcedureEditDefinition,
} from "../../server/tools/domains/procedures/definitions";
import {
  createContractDefinition,
  listContractsDefinition,
  updateContractStatusDefinition,
  legalReviewDefinition,
  generateLegalDocumentDefinition,
} from "../../server/tools/domains/legal/definitions";
import {
  ensembleQueryDefinition,
  juryTriageDefinition,
  secondOpinionDefinition,
} from "../../server/tools/domains/multiagent/definitions";
import {
  selfHealDefinition,
  selfHealLogDefinition,
  selfHealInspectDefinition,
} from "../../server/tools/domains/agentic/definitions";
import {
  produceVideoDefinition,
  planVideoProductionDefinition,
  mpegProduceDefinition,
  mpegProduceParallelDefinition,
  mpegConcatDefinition,
  mpegAddAudioDefinition,
} from "../../server/tools/domains/media/definitions";
import {
  deliverProductDefinition,
  deliveryStatusDefinition,
  generateEvidenceDocketDefinition,
} from "../../server/tools/domains/delivery/definitions";
import {
  setPolicyDefinition,
} from "../../server/tools/domains/governance/definitions";
import {
  deepResearchDefinition,
  parallelResearchDefinition,
  researchDigestDefinition,
  recursiveSynthesizeDefinition,
  trendResearchDefinition,
  findingsPublishDefinition,
  findingsReadDefinition,
  ingestPaperDefinition,
} from "../../server/tools/domains/research/definitions";
import {
  commitmentCreateDefinition,
  commitmentListDefinition,
  commitmentHeartbeatDefinition,
  commitmentCompleteDefinition,
  commitmentCancelDefinition,
} from "../../server/tools/domains/commitment/definitions";
import {
  attributeFailureDefinition,
  hypothesisPinDefinition,
  hypothesisListPinnedDefinition,
  planGraphEditDefinition,
  planGraphQueryDefinition,
  hypothesisAttachEvidenceDefinition,
  hypothesisEvidenceChainDefinition,
} from "../../server/tools/domains/reasoning/definitions";
import {
  inboxSenderApproveDefinition,
  inboxSenderBlockDefinition,
  inboxQuarantineListDefinition,
  inboxAllowlistListDefinition,
} from "../../server/tools/domains/inbox/definitions";
import {
  synthesizeSkillDefinition,
  listSkillCandidatesDefinition,
  promoteSkillCandidateDefinition,
  rejectSkillCandidateDefinition,
  manageSkillsDefinition,
} from "../../server/tools/domains/skills/definitions";
import {
  createToolDefinition,
  listCustomToolsDefinition,
  deleteCustomToolDefinition,
} from "../../server/tools/domains/custom-tools/definitions";
import {
  felixLoopStatusDefinition,
  listFelixLoopRunsDefinition,
  listFelixProposalsDefinition,
  approveFelixProposalDefinition,
  rejectFelixProposalDefinition,
  felixLoopRunNowDefinition,
  executeFelixProposalDefinition,
} from "../../server/tools/domains/felix-loop/definitions";
import {
  createTensionDefinition,
  listOpenTensionsDefinition,
  resolveTensionDefinition,
  createAdrDefinition,
  listAdrsDefinition,
  supersedeAdrDefinition,
} from "../../server/tools/domains/tensions/definitions";
import {
  pinDoneConditionDefinition,
  getDoneConditionDefinition,
  evaluateAgainstContractDefinition,
} from "../../server/tools/domains/sprint-contracts/definitions";
import {
  financeNewsDefinition,
  financeStockPriceDefinition,
  financeStockSearchDefinition,
  financeMarketOverviewDefinition,
} from "../../server/tools/domains/finance-market/definitions";
import {
  forecastTickerDefinition,
  analyzePortfolioDefinition,
} from "../../server/tools/domains/treasury/definitions";
import {
  runAgentEvalDefinition,
  getEvalReportDefinition,
} from "../../server/tools/domains/agent-eval/definitions";
import {
  writeScratchpadDefinition,
  readScratchpadDefinition,
} from "../../server/tools/domains/scratchpad/definitions";
import {
  introspectToolsDefinition,
  selfDiagnoseDefinition,
} from "../../server/tools/domains/self-reflection/definitions";
import {
  draftSocialPostDefinition,
  manageContentCalendarDefinition,
  marketingAnalyticsDefinition,
  marketingExperimentDefinition,
} from "../../server/tools/domains/social-marketing/definitions";
import {
  monidDiscoverDefinition,
  monidInspectDefinition,
  monidRunDefinition,
  monidCatalogBrowseDefinition,
} from "../../server/tools/domains/monid/definitions";
import { trackOutcomeDefinition } from "../../server/tools/domains/outcome-tracking/definitions";
import { ideationSessionDefinition } from "../../server/tools/domains/ideation/definitions";
import { userModelQueryDefinition } from "../../server/tools/domains/user-modeling/definitions";
import { toolPerformanceReportDefinition, detectFatigueDefinition, microSabbaticalDefinition } from "../../server/tools/domains/skill-evolution/definitions";
import {
  recordFailurePatternDefinition,
  recallFailurePatternsDefinition,
  recordStrategicWinDefinition,
  recallStrategicWinsDefinition,
} from "../../server/tools/domains/strategic-memory/definitions";
import { knowledgeNudgeStatsDefinition } from "../../server/tools/domains/knowledge-nudges/definitions";
import {
  codebaseGraphQueryDefinition,
  codebaseDiffImpactDefinition,
} from "../../server/tools/domains/codebase-graph/definitions";
import { chunkCodeDefinition } from "../../server/tools/domains/code-chunker/definitions";
import {
  createMindDefinition,
  mindTicketDefinition,
} from "../../server/tools/domains/minds/definitions";
import { compressContextDefinition } from "../../server/tools/domains/context-compressor/definitions";
import { templateScrapeDefinition } from "../../server/tools/domains/structured-extraction/definitions";
import {
  videoTranscribeWordsDefinition,
  videoCutFillersDefinition,
  videoBurnCaptionsDefinition,
} from "../../server/tools/domains/video-editor/definitions";
import {
  registerCharacterPortraitDefinition,
  listCharacterPortraitsDefinition,
  initCharacterPortraitsDefinition,
} from "../../server/tools/domains/character-portraits/definitions";
import {
  selectReferencesForFrameDefinition,
  selectBestImageDefinition,
} from "../../server/tools/domains/video-selectors/definitions";
import {
  outlookListInboxDefinition,
  outlookSearchInboxDefinition,
  outlookReadMessageDefinition,
} from "../../server/tools/domains/outlook/definitions";
import {
  sessionsListDefinition,
  sessionsHistoryDefinition,
} from "../../server/tools/domains/sessions/definitions";
import { googleWorkspaceDefinition } from "../../server/tools/domains/google-workspace/definitions";
import { sandboxRunDefinition, sandboxReportDefinition, sandboxPromoteDefinition } from "../../server/tools/domains/sandbox/definitions";

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, "data/feature-contracts/tools-layer-split/tool-inventory-baseline.txt");
const TOOLS_TS = path.join(ROOT, "server/tools.ts");

const EXPECTED_MIGRATED = new Map([
  // S4 (system domain)
  ["list_models", listModelsDefinition],
  ["template_scraper_stats", templateScraperStatsDefinition],
  ["get_usage_analytics", getUsageAnalyticsDefinition],
  // S5 (files domain) — google_drive migrated in a later slice once
  // ctx.projectId existed; write_file migrated once ctx.allowedPaths existed
  // (R125+106 trust-seam infra): _allowedPaths→ctx.allowedPaths,
  // _tenantId/_conversationId→ctx, _projectDriveFolderId passthrough. See
  // domains/files/handlers.ts header.
  ["read_output_blob", readOutputBlobDefinition],
  ["code_slice", codeSliceDefinition],
  ["scan_file", scanFileDefinition],
  ["read_file", readFileDefinition],
  ["write_file", writeFileDefinition],
  ["list_uploads", listUploadsDefinition],
  ["google_drive", googleDriveDefinition],
  // S6 (security domain) — set_policy stays legacy (owner-only governance;
  // destructive/owner-only straggler slice per contract ordering)
  ["scan_for_secrets", scanForSecretsDefinition],
  ["agent_security_scan", agentSecurityScanDefinition],
  ["compliance_audit", complianceAuditDefinition],
  ["verify_outbound_safety", verifyOutboundSafetyDefinition],
  ["scan_for_prompt_injection", scanForPromptInjectionDefinition],
  // S7 (memory domain) — mixed-category memory-adjacent tools (compress_context,
  // query_communities/causal, failure-pattern + strategic-win
  // recorders, auto_memorize_now, get_unified_memory_context,
  // memory_geometry_scan, recall_references) stay legacy per the
  // smallest-safe-batch precedent (S3); see domains/memory/handlers.ts header
  // (the workspace_* durable-artifact cluster migrated later in S13)
  ["search_memory", searchMemoryDefinition],
  ["create_memory", createMemoryDefinition],
  ["remember_for_this_session", rememberForThisSessionDefinition],
  ["update_memory", updateMemoryDefinition],
  ["recall_context", recallContextDefinition],
  ["graph_memory", graphMemoryDefinition],
  // S25f — memory cluster: unified read surface + geometry-of-consolidation audit
  ["get_unified_memory_context", getUnifiedMemoryContextDefinition],
  ["memory_geometry_scan", memoryGeometryScanDefinition],
  // S8 (knowledge domain) — mixed-category knowledge-adjacent tools
  // (recall_capabilities, query_communities/causal, chunk_code,
  // get_daily_notes, ingest_paper, academic_search, fetch_wikipedia)
  // stay legacy per the smallest-safe-batch precedent (S3);
  // see domains/knowledge/handlers.ts header. (outlook_* migrated later in S33.)
  ["search_knowledge", searchKnowledgeDefinition],
  ["knowledge_navigate", knowledgeNavigateDefinition],
  ["create_knowledge", createKnowledgeDefinition],
  ["store_triple", storeTripleDefinition],
  ["query_triples", queryTriplesDefinition],
  ["expire_triple", expireTripleDefinition],
  ["doc_search", docSearchDefinition],
  // S9 (web domain) — web-adjacent mixed tools (academic_search + per-source
  // arms, firecrawl_* / readability_extract) stay legacy per the
  // smallest-safe-batch precedent (S3); deep_research migrated to the research
  // domain and generate_design_doc migrated to the design-doc domain (S25x); the
  // browser/camofox tools migrated
  // later in S12; fetch_wikipedia (S8's stay-legacy)
  // moves HERE with the public-API pack's shared arm; see
  // domains/web/handlers.ts header
  ["web_fetch", webFetchDefinition],
  ["web_search", webSearchDefinition],
  ["fetch_weather", fetchWeatherDefinition],
  ["fetch_crypto_price", fetchCryptoPriceDefinition],
  ["fetch_exchange_rate", fetchExchangeRateDefinition],
  ["fetch_wikipedia", fetchWikipediaDefinition],
  ["fetch_hacker_news", fetchHackerNewsDefinition],
  ["lookup_ip_geo", lookupIpGeoDefinition],
  ["academic_search", academicSearchDefinition],
  ["arxiv_search", arxivSearchDefinition],
  ["pubmed_search", pubmedSearchDefinition],
  ["openalex_search", openalexSearchDefinition],
  ["crossref_lookup", crossrefLookupDefinition],
  // Firecrawl/readability cluster — firecrawl_scrape/firecrawl_crawl read
  // tenant (params._tenantId→ctx.tenantId); firecrawl_scrape recurses via
  // call-time facade executeTool import; firecrawl_crawl via ./tools/lib/retry
  ["firecrawl_search", firecrawlSearchDefinition],
  ["firecrawl_scrape", firecrawlScrapeDefinition],
  ["readability_extract", readabilityExtractDefinition],
  ["firecrawl_crawl", firecrawlCrawlDefinition],
  ["firecrawl_map", firecrawlMapDefinition],
  // S25s: scraped-page store ops (queryScrapedPages/getScrapedPageContent/
  // deleteScrapedPages from ./firecrawl; ctx.tenantId fail-closed guard).
  ["scraped_pages_query", scrapedPagesQueryDefinition],
  ["scraped_page_read", scrapedPageReadDefinition],
  ["scraped_pages_delete", scrapedPagesDeleteDefinition],
  // S25t: crews domain (create_crew/create_flow → ./crews-engine; admin-only,
  // ctx.tenantId seam replacing params._tenantId on admin check + guard + local).
  ["create_crew", createCrewDefinition],
  ["create_flow", createFlowDefinition],
  // S25u: background-tasks domain (run/check/list_background_task → ./background-tasks;
  // read-from-ctx tenant seam, no added guard).
  ["run_background_task", runBackgroundTaskDefinition],
  ["check_background_task", checkBackgroundTaskDefinition],
  ["list_background_tasks", listBackgroundTasksDefinition],
  // S25v: minerva-planner domain (create_plan/list_plans/get_plan → ./minerva-planner;
  // read-from-ctx tenant seam, pre-existing !tenantId guard narrows the type — no cast).
  // get_minerva_roster stays legacy (backed by capability-registry, different lib).
  ["create_plan", createPlanDefinition],
  ["list_plans", listPlansDefinition],
  ["get_plan", getPlanDefinition],
  // S25w: safety-layer domain (detect_emotional_state/grounding_intervention →
  // ./safety-layer; pure transforms, no trust-signal seam). stress_intervention +
  // track_intervention stay legacy (local fn / _userId); fatigue pair = different lib.
  ["detect_emotional_state", detectEmotionalStateDefinition],
  ["grounding_intervention", groundingInterventionDefinition],
  // S25x: design-doc domain (generate_design_doc → ./design-doc-tool; backing fn
  // reads params._tenantId internally → re-stamp seam from ctx.tenantId, S25q
  // precedent). deep_research was already migrated to the research domain.
  ["generate_design_doc", generateDesignDocDefinition],
  // S25y: voice-profile domain (build_voice_profile / get_voice_profile →
  // ./martech-bundle buildVoiceProfile/getVoiceProfile; sole seam reads
  // ctx.tenantId in place of the dispatcher-stripped params._tenantId — the arm
  // consumed the signal itself, so read-from-ctx, no re-stamp needed).
  ["build_voice_profile", buildVoiceProfileDefinition],
  ["get_voice_profile", getVoiceProfileDefinition],
  // S25z: task-forces domain (create/list/charge/sunset_task_force →
  // ./agentic/task-forces; read-from-ctx seam — ctx.tenantId replaces the
  // dispatcher-stripped params._tenantId on the fail-closed guard + as the
  // lib scope; create_task_force also reads ctx.personaId for the createdBy
  // audit stamp. No re-stamp needed — the arms consumed the signals directly).
  ["create_task_force", createTaskForceDefinition],
  ["list_task_forces", listTaskForcesDefinition],
  ["charge_task_force", chargeTaskForceDefinition],
  ["sunset_task_force", sunsetTaskForceDefinition],
  // S26a: department-budgets domain (set/check_department_budget →
  // ./agentic/department-budgets; read-from-ctx seam — ctx.tenantId replaces the
  // dispatcher-stripped _tenantId used for the fail-closed guard AND as the lib
  // scope; _tenantId is the ONLY stripped signal these arms read).
  ["set_department_budget", setDepartmentBudgetDefinition],
  ["check_department_budget", checkDepartmentBudgetDefinition],
  // S26b: self-improvement domain (log_experiment / get_experiments /
  // run_self_improvement → ./self-improvement; read-from-ctx seam — ctx.tenantId
  // replaces the dispatcher-stripped _tenantId used as the explicit lib arg AND
  // run_self_improvement's fail-closed guard; `personaId` in run_self_improvement
  // is the PUBLIC caller param, not the stripped _personaId).
  ["log_experiment", logExperimentDefinition],
  ["get_experiments", getExperimentsDefinition],
  ["run_self_improvement", runSelfImprovementDefinition],
  // S26b: ab-optimizer domain (create_ab_experiment / record_ab_event →
  // ./ab-optimizer; read-from-ctx seam — ctx.tenantId replaces the stripped
  // _tenantId (guard + scope); create_ab_experiment also reads ctx.personaId for
  // the experiment's personaId. Both signals ToolContext-carried).
  ["create_ab_experiment", createAbExperimentDefinition],
  ["record_ab_event", recordAbEventDefinition],
  // S26c: cost-ledger domain (revenue_vs_cost / agent_cost_summary →
  // ./agentic/cost-ledger; read-from-ctx seam — ctx.tenantId replaces the stripped
  // _tenantId used as the fail-closed guard AND the owner-only tenantId!==1 check
  // AND the lib scope; days clamp preserved).
  ["revenue_vs_cost", revenueVsCostDefinition],
  ["agent_cost_summary", agentCostSummaryDefinition],
  // S26c: reference-learner domain (learn_from_reference / recall_references →
  // ./reference-learner; read-from-ctx seam — ctx.tenantId replaces the stripped
  // _tenantId (>0 guard + scope) and ctx.personaId replaces _personaId (undefined
  // when absent); all public caller params unchanged).
  ["learn_from_reference", learnFromReferenceDefinition],
  ["recall_references", recallReferencesDefinition],
  // S26c: wake-scheduler domain (schedule_wake / cancel_wake / list_wakes →
  // ./agentic/wake-scheduler; read-from-ctx seam — ctx.tenantId replaces the
  // stripped _tenantId (fail-closed guard + lib scope) and ctx.personaId replaces
  // _personaId (null when absent) for both personaId + createdBy attribution).
  ["schedule_wake", scheduleWakeDefinition],
  ["cancel_wake", cancelWakeDefinition],
  ["list_wakes", listWakesDefinition],
  // S26d: messaging domain (send_message / messaging_status →
  // ./messaging-gateway + ./lib/outbound-redaction; pure public-param relocation —
  // NEITHER arm reads any stripped trust signal, so nothing moves to ctx).
  ["send_message", sendMessageDefinition],
  ["messaging_status", messagingStatusDefinition],
  // S26d: recurring-messages domain (schedule_message / list_scheduled_messages /
  // cancel_scheduled_message → ./recurring-messages; read-from-ctx seam —
  // ctx.tenantId replaces the stripped _tenantId used as the fail-closed guard AND
  // the lib scope; all other fields are public caller params).
  ["schedule_message", scheduleMessageDefinition],
  ["list_scheduled_messages", listScheduledMessagesDefinition],
  ["cancel_scheduled_message", cancelScheduledMessageDefinition],
  // S26e: intelligence/analytics slice (5 tools, 5 NEW domains, all clean-seam
  // read-from-ctx). track_outcome → outcome-tracking (./outcome-tracker;
  // ctx.tenantId guard "…for track_outcome"+scope, ctx.personaId||0 stamp;
  // public params.personaId in the view case stays a plain filter).
  // ideation_session → ideation (./ideation-engine + ./storage; ctx.tenantId
  // guard "…for ideation_session"+scope, ctx.personaId stamp incl. ||2 memory
  // default). user_model_query → user-modeling (./user-modeling; ctx.tenantId).
  // tool_performance_report → skill-evolution (./skill-evolution; ctx.tenantId).
  // knowledge_nudge_stats → knowledge-nudges (./knowledge-nudges; ctx.tenantId).
  // _tenantId/_personaId are the ONLY stripped signals these arms read.
  ["track_outcome", trackOutcomeDefinition],
  ["ideation_session", ideationSessionDefinition],
  ["user_model_query", userModelQueryDefinition],
  ["tool_performance_report", toolPerformanceReportDefinition],
  ["knowledge_nudge_stats", knowledgeNudgeStatsDefinition],
  // S26g: wellness fatigue pair → skill-evolution (./skill-evolution; PURE
  // transforms, SEAM: NONE — ctx unused, no stripped signal read). Same backing lib
  // as tool_performance_report (S26e), so they extend the existing domain.
  ["detect_fatigue", detectFatigueDefinition],
  ["micro_sabbatical", microSabbaticalDefinition],
  // S26h: strategic-memory slice (4 tools, 1 NEW domain, read-from-ctx seam).
  // All four had INLINE db.execute logic against memory_entries (NO backing lib
  // — bodies moved verbatim). ctx.tenantId replaces stripped _tenantId as the
  // fail-closed guard ("…requires tenant context") AND persona_id scope;
  // ctx.personaId||2 replaces (params as any)._personaId||2 as the createdBy
  // stamp. _tenantId/_personaId are the ONLY stripped signals these arms read.
  ["record_failure_pattern", recordFailurePatternDefinition],
  ["recall_failure_patterns", recallFailurePatternsDefinition],
  ["record_strategic_win", recordStrategicWinDefinition],
  ["recall_strategic_wins", recallStrategicWinsDefinition],
  // S26f: pure-relocation slice (5 tools, 2 NEW domains, ZERO trust signals read
  // — safest seam, ctx unused). seo domain: aeo_score (./lib/aeo-score) +
  // seo_content_audit (inline) + generate_schema_markup (inline). content-ops
  // domain: lookup_output_skill (./lib/output-skills) + repurpose_content
  // (./lib/content-repurposer). All five are pure public-param relocations — none
  // read _tenantId/_personaId/_conversationId/_projectId.
  ["aeo_score", aeoScoreDefinition],
  ["seo_content_audit", seoContentAuditDefinition],
  ["generate_schema_markup", generateSchemaMarkupDefinition],
  ["lookup_output_skill", lookupOutputSkillDefinition],
  ["repurpose_content", repurposeContentDefinition],
  // S27: code & knowledge intelligence slice (3 tools, 2 NEW domains, SEAM NONE
  // — pure public-param, ctx unused). codebase-graph domain:
  // codebase_graph_query + codebase_diff_impact (./lib/codebase-graph, a global
  // repo artifact — not tenant-scoped). code-chunker domain: chunk_code
  // (./code-chunker; workspace-root filesystem safety moved verbatim). None read
  // _tenantId/_personaId/_conversationId/_projectId.
  ["codebase_graph_query", codebaseGraphQueryDefinition],
  ["codebase_diff_impact", codebaseDiffImpactDefinition],
  ["chunk_code", chunkCodeDefinition],
  // S10 (quality domain) — evaluate_against_contract stays legacy (reads
  // _personaName + _userId, neither carried by ToolContext; S5 write_file
  // precedent — needs a dedicated trust-seam slice first); see
  // domains/quality/handlers.ts header
  ["sculptor_review", sculptorReviewDefinition],
  ["verify_felix_proposal_spec", verifyFelixProposalSpecDefinition],
  ["cross_critique", crossCritiqueDefinition],
  ["list_critiques", listCritiquesDefinition],
  ["critique_response", critiqueResponseDefinition],
  ["quality_baseline_save", qualityBaselineSaveDefinition],
  ["quality_baseline_check", qualityBaselineCheckDefinition],
  ["verify_deliverable", verifyDeliverableDefinition],
  ["verify_math_chain", verifyMathChainDefinition],
  ["grade_deliverable", gradeDeliverableDefinition],
  ["verify_delivery_proof", verifyDeliveryProofDefinition],
  ["verify_with_cove", verifyWithCoveDefinition],
  // S11 (documents domain) — the 8 contiguous PDF/office tools. create_slides /
  // generate_chart / create_slideshow_video cluster with the media/presentation
  // region (later slice) and `project` is workspace-domain, so all stay legacy
  // per the smallest-safe-batch precedent (S3); see
  // domains/documents/handlers.ts header. Only trust channel is _tenantId (ctx
  // seam); _projectDriveFolderId survives stripTrustSignals and migrates verbatim
  ["analyze_pdf", analyzePdfDefinition],
  ["create_pdf", createPdfDefinition],
  ["create_styled_report", createStyledReportDefinition],
  ["fill_pdf", fillPdfDefinition],
  ["create_document", createDocumentDefinition],
  ["create_spreadsheet", createSpreadsheetDefinition],
  ["edit_pdf", editPdfDefinition],
  ["list_pdf_fields", listPdfFieldsDefinition],
  // S12 (browser domain) — the 3 browser-automation tools; S25c added the two
  // remaining browser-adjacent tools (stealth_browse + site_login), which were
  // the only other consumers of the module-scope executeBrowserAction import
  // (now pulled call-time). The template_scrape / scraped_pages_* cluster is
  // web-domain (stays legacy deliberately). Trust seams: browser reads only
  // _tenantId; stealth_browse_camofox reads _tenantId + _personaId; stealth_browse
  // and site_login read only _tenantId — all re-stamped from ctx; see
  // domains/browser/handlers.ts header
  ["browser", browserDefinition],
  ["stealth_browse_camofox", stealthBrowseCamofoxDefinition],
  ["browser_workflow", browserWorkflowDefinition],
  ["stealth_browse", stealthBrowseDefinition],
  ["site_login", siteLoginDefinition],
  // S13 (workspace domain) — the 6 contiguous workspace_* durable-artifact tools
  // (task-workspace paper-trail cluster). google_workspace / calendar_sync
  // (network tools that merely share the "workspace" category) and the scattered
  // `project` tool (deferred from S11) stay legacy per the smallest-safe-batch
  // precedent (S3). Trust seams: all 6 read _tenantId (ctx seam); workspace_init
  // additionally reads _personaId — both re-stamped from ctx; see
  // domains/workspace/handlers.ts header
  ["workspace_init", workspaceInitDefinition],
  ["workspace_update_status", workspaceUpdateStatusDefinition],
  ["workspace_log_artifact", workspaceLogArtifactDefinition],
  ["workspace_read", workspaceReadDefinition],
  ["workspace_finalize", workspaceFinalizeDefinition],
  ["workspace_list", workspaceListDefinition],
  // S14 (social domain) — the 4 MarTech content/social tools (R79, after
  // Charlie Hills' social-media-skills MIT). Adjacent social tools stay legacy
  // per the smallest-safe-batch precedent (S3): the x_* Twitter cluster is the
  // dedicated S15 x-twitter slice; the scattered marketing social-post tools
  // (draft_social_post / generate_social_image / compose_social_post /
  // publish_social_post / manage_social_accounts) and the cross-platform
  // scheduler cluster (repurpose_content / schedule_cross_platform_post
  // [destructive, requireApproval, reads _personaName/_userId] /
  // cancel_scheduled_post / list_scheduled_posts) migrate in a later pass.
  // Trust seam: all 4 read only _tenantId (ctx seam); see
  // domains/social/handlers.ts header
  ["generate_hooks", generateHooksDefinition],
  ["format_post", formatPostDefinition],
  ["generate_content_matrix", generateContentMatrixDefinition],
  ["score_post", scorePostDefinition],
  // S15 (x-twitter domain) — the 9 contiguous x_* X/Twitter API tools. Adjacent
  // social tools stay legacy per the smallest-safe-batch precedent (S3): the
  // scattered marketing social-post tools (draft_social_post /
  // generate_social_image / compose_social_post / publish_social_post /
  // manage_social_accounts) and the cross-platform scheduler cluster
  // (repurpose_content / schedule_cross_platform_post [destructive,
  // requireApproval, reads _personaName/_userId] / cancel_scheduled_post /
  // list_scheduled_posts) migrate in a later pass. Trust seam: the six
  // owner-gated tools read only _tenantId (ctx seam); x_get_tweet /
  // x_get_timeline / x_search read no trust signal; see
  // domains/x-twitter/handlers.ts header
  ["x_post_tweet", xPostTweetDefinition],
  ["x_delete_tweet", xDeleteTweetDefinition],
  ["x_get_tweet", xGetTweetDefinition],
  ["x_get_mentions", xGetMentionsDefinition],
  ["x_get_timeline", xGetTimelineDefinition],
  ["x_search", xSearchDefinition],
  ["x_like_tweet", xLikeTweetDefinition],
  ["x_retweet", xRetweetDefinition],
  ["x_get_me", xGetMeDefinition],
  // S16 (outreach domain) — the 8 contiguous AI-SDR lead/sequence tools. In the
  // facade these were the LAST 8 arms of a shared case-fallthrough block whose
  // single fnMap dispatched into ./agentic-features. S16 dropped the 8 outreach
  // labels; S25k (below) then migrated the block's other 9 arms and removed the
  // whole shared block. Trust seam: all 8 read only _tenantId (ctx seam) —
  // no _personaId/_conversationId/_userId/_personaName reads in agentic-features;
  // see domains/outreach/handlers.ts header
  ["enrich_lead", enrichLeadDefinition],
  ["score_leads", scoreLeadsDefinition],
  ["qualify_leads", qualifyLeadsDefinition],
  ["create_sequence", createSequenceDefinition],
  ["enroll_in_sequence", enrollInSequenceDefinition],
  ["advance_sequence", advanceSequenceDefinition],
  ["classify_reply", classifyReplyDefinition],
  ["list_sequences", listSequencesDefinition],
  // S25k (research-intel domain) — the 9 remaining arms of that same shared
  // case-fallthrough block: research (save_evidence/query_evidence/
  // synthesize_research), competitor-intel (add_competitor/list_competitors/
  // take_competitor_snapshot/detect_competitor_changes/competitor_briefing),
  // and define_icp. All dispatched into ./agentic-features via the block's
  // fnMap; the split removes the entire shared block (brace and all). Trust
  // seam: all 9 read only _tenantId (ctx seam) — no _personaId/_conversationId/
  // _userId/_personaName reads; see domains/research-intel/handlers.ts header
  ["save_evidence", saveEvidenceDefinition],
  ["query_evidence", queryEvidenceDefinition],
  ["synthesize_research", synthesizeResearchDefinition],
  ["add_competitor", addCompetitorDefinition],
  ["list_competitors", listCompetitorsDefinition],
  ["take_competitor_snapshot", takeCompetitorSnapshotDefinition],
  ["detect_competitor_changes", detectCompetitorChangesDefinition],
  ["competitor_briefing", competitorBriefingDefinition],
  ["define_icp", defineIcpDefinition],
  // S17 (finance domain) — the 7 contiguous DB-backed invoicing + expenses
  // tools. In the facade these were individual switch arms dispatching into
  // ./business-tools with `{ ...params, tenant_id: params._tenantId }`
  // (invoice_aging_report passed only `{ tenant_id }`). The scattered
  // finance-report cluster (revenue_report / profit_and_loss /
  // cash_flow_summary / business_health_score / financial_snapshot /
  // record_kpi / kpi_dashboard / kpi_trend) is interleaved with the CRM +
  // contract regions and STAYS LEGACY per the smallest-safe-batch precedent
  // (S3); the market-data finance_* / forecast_ticker / analyze_portfolio tools
  // are network-touching and migrate later. Trust seam: all 7 read only
  // _tenantId (ctx seam) — the business-tools fns read NO
  // _personaId/_conversationId/_userId key and gate via tenantGuard; see
  // domains/finance/handlers.ts header
  ["create_invoice", createInvoiceDefinition],
  ["list_invoices", listInvoicesDefinition],
  ["update_invoice_status", updateInvoiceStatusDefinition],
  ["invoice_aging_report", invoiceAgingReportDefinition],
  ["log_expense", logExpenseDefinition],
  ["list_expenses", listExpensesDefinition],
  ["expense_report", expenseReportDefinition],
  // finance-report cluster (same _tenantId → ctx seam, business-tools dispatch;
  // added to the finance domain after the invoicing+expenses batch)
  ["record_kpi", recordKpiDefinition],
  ["kpi_dashboard", kpiDashboardDefinition],
  ["kpi_trend", kpiTrendDefinition],
  ["profit_and_loss", profitAndLossDefinition],
  ["revenue_report", revenueReportDefinition],
  ["cash_flow_summary", cashFlowSummaryDefinition],
  ["business_health_score", businessHealthScoreDefinition],
  ["financial_snapshot", financialSnapshotDefinition],
  // crm domain — the 5 contiguous DB-backed CRM tools; same _tenantId → ctx
  // seam and business-tools dispatch (customer_pipeline passes only tenant_id)
  ["add_customer", addCustomerDefinition],
  ["update_customer", updateCustomerDefinition],
  ["list_customers", listCustomersDefinition],
  ["log_interaction", logInteractionDefinition],
  ["customer_pipeline", customerPipelineDefinition],
  // S25b (scheduled-posts domain) — the 2 read/lifecycle tools reading only
  // _tenantId (→ ctx.tenantId seam; runner fns take an explicit tenantId arg).
  // The producer schedule_cross_platform_post (destructive, requireApproval,
  // reads _personaName/_userId) stays legacy — deferred to a trust-seam slice.
  ["cancel_scheduled_post", cancelScheduledPostDefinition],
  ["list_scheduled_posts", listScheduledPostsDefinition],
  // S25b (procedures domain) — list (read-only) + apply/rollback (destructive;
  // backend mutators self-enforce the platform-admin tenant gate). Same
  // _tenantId → ctx seam. The review trio (propose/approve/reject) reads
  // _personaName/_userId for attribution and stays legacy — trust-seam slice.
  ["list_procedure_edits", listProcedureEditsDefinition],
  ["apply_procedure_edit", applyProcedureEditDefinition],
  ["rollback_procedure_edit", rollbackProcedureEditDefinition],
  // S18 (legal domain) — the 3 contiguous DB-backed contract-record tools plus
  // the 2 pure-logic legal-document tools. The contract trio dispatched into
  // ./business-tools with `{ ...params, tenant_id: params._tenantId }` (trust
  // seam: _tenantId → ctx.tenantId; the business-tools fns gate via
  // tenantGuard). legal_review + generate_legal_document are self-contained
  // deterministic logic (inline RISK_PATTERNS / PROTECTIVE_CLAUSES / TEMPLATES)
  // — no DB, no tenant, no ctx read — moved verbatim; compliance_audit (S6
  // security) sits between them in the facade array as a const reference. The
  // scattered finance-report/KPI cluster + CRM tools interleave the contract
  // region and STAY LEGACY per the smallest-safe-batch precedent (S3); see
  // domains/legal/handlers.ts header
  ["create_contract", createContractDefinition],
  ["list_contracts", listContractsDefinition],
  ["update_contract_status", updateContractStatusDefinition],
  ["legal_review", legalReviewDefinition],
  ["generate_legal_document", generateLegalDocumentDefinition],
  // S19 (multiagent domain) — the 3 contiguous Mixture-of-Agents / multi-model
  // tools (ensemble_query / jury_triage / second_opinion). Each dispatched into
  // ./moa, ./lib/jury-triage, ./second-opinion respectively. Trust seam:
  // _tenantId → ctx.tenantId (fail-closed guard) + the owner metered-override
  // (params._tenantId === ADMIN_TENANT_ID → ctx.tenantId === ADMIN_TENANT_ID);
  // _invokedVia is NOT stripped by the dispatcher's TRUST_SIGNAL_KEYS so it
  // survives on params verbatim (telemetry label, not authz). aeo_score (S3
  // legacy pure-logic) sits after them in the facade array as a const reference.
  // delegate_task / debate are scattered subagent-spawners and STAY LEGACY per
  // the smallest-safe-batch precedent (S3); see domains/multiagent/handlers.ts
  ["ensemble_query", ensembleQueryDefinition],
  ["jury_triage", juryTriageDefinition],
  ["second_opinion", secondOpinionDefinition],
  // S20 (agentic domain) — the 3 contiguous self-healing supervisor tools
  // (self_heal / self_heal_log / self_heal_inspect). Each dispatched into
  // ./agentic/self-heal (attemptSelfHeal / listSelfHealAttempts /
  // getSelfHealAttempt / markPromotedToPlatform). Trust seam: _tenantId →
  // ctx.tenantId (fail-closed guard); self_heal additionally reads
  // _invokedByModel, which is NOT stripped by the dispatcher's
  // TRUST_SIGNAL_KEYS so it survives on params verbatim (telemetry label, not
  // authz). The other agentic-flavoured tools (delegate_task / autonomous_task /
  // lobster / plan_and_execute / create_plan / self_diagnose / orchestrate /
  // debate / plan_deliverable / plan_graph_edit / plan_graph_query) are
  // scattered with heavier deps and STAY LEGACY per the smallest-safe-batch
  // precedent (S3); see domains/agentic/handlers.ts header
  ["self_heal", selfHealDefinition],
  ["self_heal_log", selfHealLogDefinition],
  ["self_heal_inspect", selfHealInspectDefinition],
  // S21 (media domain) — of the 8 CONTIGUOUS media/video tools whose defs all
  // move to domains/media/definitions.ts, only 6 handlers migrate into
  // domains/media/handlers.ts: produce_video, plan_video_production, and the
  // mpeg_* quartet (mpeg_produce / mpeg_produce_parallel / mpeg_concat /
  // mpeg_add_audio). Trust seam: _tenantId → ctx.tenantId (produce_video keeps
  // its fail-closed numeric-tenant guard verbatim); _projectDriveFolderId is
  // NOT in the dispatcher's TRUST_SIGNAL_KEYS so it survives on params verbatim
  // (S11 precedent). generate_audio + create_slideshow_video STAY LEGACY (their
  // switch arms use tools.ts module-scope helpers db/sql/logSilentCatch/
  // _ffprobePath) — defs still move, only the handlers stay; see
  // domains/media/handlers.ts + definitions.ts headers.
  ["produce_video", produceVideoDefinition],
  ["plan_video_production", planVideoProductionDefinition],
  ["mpeg_produce", mpegProduceDefinition],
  ["mpeg_produce_parallel", mpegProduceParallelDefinition],
  ["mpeg_concat", mpegConcatDefinition],
  ["mpeg_add_audio", mpegAddAudioDefinition],
  // S22 (delivery domain) — BOTH delivery tools migrate (defs AND handlers):
  // deliver_product (digital-product delivery pipeline; keeps its R95
  // outbound-redaction gate on the agent-supplied email subject/body + the
  // tenant-email backfill via storage.getTenant) and delivery_status
  // (owner-only multi-channel audit + retry; keeps its inline ADMIN_TENANT_ID
  // guard + per-tenant scoping of every read). Neither switch arm uses a
  // tools.ts module-scope helper — all deps (./delivery-pipeline,
  // ./lib/outbound-redaction, the storage singleton) are call-time
  // dynamic-imported. Trust seam: both read only _tenantId → ctx.tenantId.
  // plan_deliverable is agentic-domain and STAYS LEGACY per the
  // smallest-safe-batch precedent (S3); see domains/delivery/handlers.ts header
  ["deliver_product", deliverProductDefinition],
  ["delivery_status", deliveryStatusDefinition],
  // generate_evidence_docket (portable per-deliverable Evidence Docket) — added
  // to the delivery domain: assembles the goal contract + verification verdicts
  // + jury κ + security-audit rows + delivery record + replay pointer into one
  // reviewer-facing artifact, then ships it through the SAME delivery pipeline.
  ["generate_evidence_docket", generateEvidenceDocketDefinition],
  // S23 (governance domain — destructive/owner-only stragglers LAST) — only
  // set_policy migrates (def AND handler): the owner-only R76 trust-tier policy
  // engine S6 deferred to this slice. Clean mechanical move — inline owner-only
  // guard (tenant 1) preserved verbatim, single call-time dynamic dep
  // (./policy-engine), no tools.ts module-scope helper. Trust seam: reads only
  // _tenantId → ctx.tenantId. The other stragglers STAY LEGACY — exec/lobster/
  // run_command/kill (dispatch-level owner-driven shell gate + internal-caller
  // bypass) and write_file (_allowedPaths freeze-guard trust channel not on
  // ToolContext) would touch the safety boundary the contract forbids; each
  // needs its own dedicated slice.
  ["set_policy", setPolicyDefinition],
  // research domain — the 8 plain, self-contained research-cluster tools. Each
  // was an individual switch arm dispatching into a single external module
  // (./research-pipeline, ./agentic/*, ./research-engine, ./recursive-llm,
  // ./trend-research, ./lib/parallel-findings-bus, ./lib/paper-ingest); the S8
  // knowledge / S9 web headers above flagged ingest_paper + deep_research as
  // deferred stragglers — this slice picks them up together with the rest of the
  // cluster. Trust seam: _tenantId → ctx.tenantId (findings_* keep their
  // numeric-tenant guards; deep_research + trend_research read no trust signal);
  // see domains/research/handlers.ts header
  ["deep_research", deepResearchDefinition],
  ["parallel_research", parallelResearchDefinition],
  ["research_digest", researchDigestDefinition],
  ["recursive_synthesize", recursiveSynthesizeDefinition],
  ["trend_research", trendResearchDefinition],
  ["findings_publish", findingsPublishDefinition],
  ["findings_read", findingsReadDefinition],
  ["ingest_paper", ingestPaperDefinition],
  // S25d (commitment domain) — all 5 commitment_* tools; single backing module
  // (server/commitments). Trust seam: _tenantId → ctx.tenantId; _personaName is
  // a deliberately non-stripped passthrough (commitment_create). See
  // domains/commitment/handlers.ts header.
  ["commitment_create", commitmentCreateDefinition],
  ["commitment_list", commitmentListDefinition],
  ["commitment_heartbeat", commitmentHeartbeatDefinition],
  ["commitment_complete", commitmentCompleteDefinition],
  ["commitment_cancel", commitmentCancelDefinition],
  // S25e (reasoning domain) — 7 LuaN1aoAgent reasoning nuggets across 3 backing
  // libs (failure-attribution, pinned-hypotheses, plan-graph). Trust seam:
  // _tenantId → ctx.tenantId (all 7); _conversationId → ctx.conversationId and
  // _personaId → ctx.personaId (hypothesis_pin + hypothesis_list_pinned only).
  // See domains/reasoning/handlers.ts header.
  ["attribute_failure", attributeFailureDefinition],
  ["hypothesis_pin", hypothesisPinDefinition],
  ["hypothesis_list_pinned", hypothesisListPinnedDefinition],
  ["plan_graph_edit", planGraphEditDefinition],
  ["plan_graph_query", planGraphQueryDefinition],
  ["hypothesis_attach_evidence", hypothesisAttachEvidenceDefinition],
  ["hypothesis_evidence_chain", hypothesisEvidenceChainDefinition],
  // S25g (inbox domain) — 4 R104 inbox quarantine + sender-allowlist tools,
  // one backing lib (inbox-quarantine). Trust seam: _tenantId → ctx.tenantId
  // (all 4); _personaName stays a verbatim params passthrough (non-authoritative
  // telemetry, not a trust key). See domains/inbox/handlers.ts header.
  ["inbox_sender_approve", inboxSenderApproveDefinition],
  ["inbox_sender_block", inboxSenderBlockDefinition],
  ["inbox_quarantine_list", inboxQuarantineListDefinition],
  ["inbox_allowlist_list", inboxAllowlistListDefinition],
  // S25h (skills domain) — 4 skill-synthesizer self-improvement tools, one
  // backing lib (skill-synthesizer). Trust seam: _tenantId → ctx.tenantId (all
  // 4); public params (taskSummary/userMessage/toolsUsed/outcome/status/
  // personaId/id/reason) stay verbatim — none is a trust key (personaId is the
  // declared public candidate filter, not the _personaId trust signal). See
  // domains/skills/handlers.ts header.
  ["synthesize_skill", synthesizeSkillDefinition],
  ["list_skill_candidates", listSkillCandidatesDefinition],
  ["promote_skill_candidate", promoteSkillCandidateDefinition],
  ["reject_skill_candidate", rejectSkillCandidateDefinition],
  // S25i (felix-loop domain) — 7 Felix autonomous-loop tools, one backing lib
  // (felix-loop). Trust seam: _tenantId → ctx.tenantId (all 7). The 4 owner-only
  // tools keep their VERBATIM Bob-only guard, now `ctx.tenantId !== 1` (a
  // strengthening — the owner gate can no longer be spoofed by caller params).
  // Public params (id/reason/limit/status) stay verbatim — none is a trust key.
  // verify_felix_proposal_spec already migrated in S10 (quality domain), not here.
  ["felix_loop_status", felixLoopStatusDefinition],
  ["list_felix_loop_runs", listFelixLoopRunsDefinition],
  ["list_felix_proposals", listFelixProposalsDefinition],
  ["approve_felix_proposal", approveFelixProposalDefinition],
  ["reject_felix_proposal", rejectFelixProposalDefinition],
  ["felix_loop_run_now", felixLoopRunNowDefinition],
  ["execute_felix_proposal", executeFelixProposalDefinition],
  // S25j (tensions domain) — 6 DreamGraph "Tensions + ADRs" tools, all backed
  // by storage methods (createTension/listTensions/resolveTension/createAdr/
  // listAdrs/supersedeAdr). Trust seam: _tenantId → ctx.tenantId (all 6).
  // Public params (title/tension_id/old_adr_id/etc.) stay verbatim — none is a
  // trust key. Tenant-context refusal strings keep the "(_tenantId)" fragment
  // verbatim. See domains/tensions/handlers.ts header.
  ["create_tension", createTensionDefinition],
  ["list_open_tensions", listOpenTensionsDefinition],
  ["resolve_tension", resolveTensionDefinition],
  ["create_adr", createAdrDefinition],
  ["list_adrs", listAdrsDefinition],
  ["supersede_adr", supersedeAdrDefinition],
  // S25k (sprint-contracts domain) — the 3 R115.5 "Sprint Contract" tools,
  // backed by server/lib/sprint-contract (pinDoneCondition/getDoneCondition/
  // evaluateAgainstContract). Trust seam: _tenantId → ctx.tenantId (all 3).
  // Attribution reads _personaName/_userId stay verbatim params reads (they are
  // deliberately NOT in the dispatcher's TRUST_SIGNAL_KEYS — non-authoritative
  // passthroughs, media/agentic precedent). Public params stay verbatim. Error
  // strings kept verbatim. See domains/sprint-contracts/handlers.ts header.
  ["pin_done_condition", pinDoneConditionDefinition],
  ["get_done_condition", getDoneConditionDefinition],
  ["evaluate_against_contract", evaluateAgainstContractDefinition],
  // S25l (finance-market domain) — the 4 market-data tools, backed by
  // server/finance-tools (fetchFinanceNews/fetchStockPrice/searchStocks/
  // getMarketOverview). NO trust seam: legacy arms read ZERO _-prefixed
  // signals (only public params), so handlers are pure mechanical moves with
  // just the import-path change. ctx unused. Error strings verbatim.
  ["finance_news", financeNewsDefinition],
  ["finance_stock_price", financeStockPriceDefinition],
  ["finance_stock_search", financeStockSearchDefinition],
  ["finance_market_overview", financeMarketOverviewDefinition],
  // S25m (treasury domain) — the 2 market-forecast tools, backed by
  // server/treasury (forecastTicker/analyzePortfolio). Seam: legacy arms
  // passed params._tenantId (no guard) → ctx.tenantId; both backing fns take
  // tenantId optionally, so no gate added. Coercions/defaults verbatim.
  ["forecast_ticker", forecastTickerDefinition],
  ["analyze_portfolio", analyzePortfolioDefinition],
  // S25n (agent-eval domain) — the 2 persona-benchmark tools, backed by
  // server/agent-eval (runEval/getEvalReport). Seam: legacy arms passed
  // params._tenantId (no guard) → ctx.tenantId. Clamp/reductions/summary
  // template verbatim.
  ["run_agent_eval", runAgentEvalDefinition],
  ["get_eval_report", getEvalReportDefinition],
  // S25o (scratchpad domain) — the 2 delegation-scratchpad tools, backed by
  // server/heartbeat (writeDelegationScratchpad/readDelegationScratchpad).
  // Seam: legacy arms passed params._tenantId (no guard) → ctx.tenantId (+
  // type-only cast to number); default chain-key fallback source swapped
  // params._conversationId → ctx.conversationId (it IS a stripped trust signal).
  // _personaName stays a verbatim passthrough (not a trust signal). Return
  // shapes/defaults verbatim.
  ["write_scratchpad", writeScratchpadDefinition],
  ["read_scratchpad", readScratchpadDefinition],
  // S25p (self-reflection domain) — introspect_tools (public params only, no
  // seam) + self_diagnose. Seam: _tenantId→ctx.tenantId, _personaId→ctx.personaId
  // (both stripped trust signals; narrowed to number in the truthy branches, no
  // cast). Backed by server/self-reflection.
  ["introspect_tools", introspectToolsDefinition],
  ["self_diagnose", selfDiagnoseDefinition],
  // S25q (social-marketing domain) — 4 uniform ./social-marketing passthroughs.
  // Seam: 3 of the 4 backing fns read the STRIPPED _tenantId themselves, so each
  // handler re-stamps { ...params, _tenantId: ctx.tenantId } to stay
  // behavior-identical to the legacy unstripped switch path.
  ["draft_social_post", draftSocialPostDefinition],
  ["manage_content_calendar", manageContentCalendarDefinition],
  ["marketing_analytics", marketingAnalyticsDefinition],
  ["marketing_experiment", marketingExperimentDefinition],
  // S25r (monid domain) — monid_discover / monid_inspect / monid_catalog_browse
  // read only public params; monid_run's per-tenant cost-ledger block reads
  // ctx.tenantId (the stripped _tenantId) — read-from-ctx (S25p) pattern, no
  // re-stamp. Backed by server/lib/monid (+ free local catalog snapshot).
  ["monid_discover", monidDiscoverDefinition],
  ["monid_inspect", monidInspectDefinition],
  ["monid_run", monidRunDefinition],
  ["monid_catalog_browse", monidCatalogBrowseDefinition],
  // S28 (minds domain) — create_mind / mind_ticket → server/minds-engine.
  // read-from-ctx seam: ctx.tenantId replaces the dispatcher-stripped
  // params._tenantId on the admin-gate (!== 1) + fail-closed tenant guard + the
  // local tenantId threaded into every minds-engine call; all command branches,
  // field caps + error strings verbatim. The personaId fields
  // (talkingPersonaId/thinkingPersonaId/personaId) are PUBLIC worker-assignment
  // params, NOT the stripped _personaId trust signal.
  ["create_mind", createMindDefinition],
  ["mind_ticket", mindTicketDefinition],
  // S28 (context-compressor domain) — compress_context → server/context-compressor.
  // SEAM NONE: pure message-array transform, reads no trust signals (ctx unused).
  ["compress_context", compressContextDefinition],
  // S28 (structured-extraction domain) — template_scrape → server/structured-extraction.
  // read-from-ctx seam: ctx.tenantId replaces the stripped params._tenantId
  // threaded into the backing lib's _tenantId recipe-cache scope.
  ["template_scrape", templateScrapeDefinition],
  // S29 (custom-tools domain) — create_tool / list_custom_tools /
  // delete_custom_tool → server/tool-learning. read-from-ctx seam: ctx.tenantId
  // replaces the dispatcher-stripped params._tenantId used as BOTH the
  // fail-closed guard AND the tenantId threaded into every tool-learning call;
  // error strings verbatim. Public params.description / params.name unchanged.
  ["create_tool", createToolDefinition],
  ["list_custom_tools", listCustomToolsDefinition],
  ["delete_custom_tool", deleteCustomToolDefinition],
  // S29 (skills domain) — manage_skills joins the skills domain (backed by
  // server/storage + server/auth admin gate, not the skill-synthesizer lib).
  // read-from-ctx seam: ctx.tenantId replaces the stripped params._tenantId on
  // BOTH the fail-closed tenant guard AND the admin-tenant (=== ADMIN_TENANT_ID)
  // gate; sub-command switch (list/create/update/enable/disable/delete) verbatim.
  ["manage_skills", manageSkillsDefinition],
  // S30 (video-editor domain) — video_transcribe_words / video_cut_fillers /
  // video_burn_captions → server/video-editor. SEAM NONE: all three read only
  // public request params (source / words / edit options), no stripped trust
  // signal (grepped — no _tenantId/_personaId/_conversationId/_projectId);
  // ctx unused. Result field shapes + guidance/label strings verbatim.
  ["video_transcribe_words", videoTranscribeWordsDefinition],
  ["video_cut_fillers", videoCutFillersDefinition],
  ["video_burn_captions", videoBurnCaptionsDefinition],
  // S31 (character-portraits domain) — register_character_portrait /
  // list_character_portraits / init_character_portraits → server/video/
  // portrait-registry. SEAM read-from-ctx: ctx.tenantId replaces the stripped
  // params._tenantId for the fail-closed tenant guard + tenantId threaded into
  // every portrait-registry call; init injects the facade's executeTool via a
  // lazy call-time back-edge. Guards/caps/error strings verbatim.
  ["register_character_portrait", registerCharacterPortraitDefinition],
  ["list_character_portraits", listCharacterPortraitsDefinition],
  ["init_character_portraits", initCharacterPortraitsDefinition],
  // S32 (video-selectors domain) — select_references_for_frame /
  // select_best_image → server/video/{reference-selector,best-image-selector}.
  // SEAM read-from-ctx: ctx.tenantId replaces the stripped params._tenantId for
  // the fail-closed tenant guard + tenantId threaded into the backing-lib call.
  // Coercions/result field shapes/error strings verbatim; backing libs acyclic.
  ["select_references_for_frame", selectReferencesForFrameDefinition],
  ["select_best_image", selectBestImageDefinition],
  // S33 (outlook domain) — outlook_list_inbox / outlook_search_inbox /
  // outlook_read_message → server/lib/outlook + external-content-security. The 3
  // arms shared ONE block keyed on `name`, preserved as outlookHandler(name,…).
  // SEAM read-from-ctx: ctx.tenantId replaces the stripped params._tenantId for the
  // admin-tenant gate (the ONLY trust signal these arms read); all else public.
  ["outlook_list_inbox", outlookListInboxDefinition],
  ["outlook_search_inbox", outlookSearchInboxDefinition],
  ["outlook_read_message", outlookReadMessageDefinition],
  // S33 (sessions domain) — sessions_list / sessions_history → server/sessions.
  // SEAM read-from-ctx: ctx.tenantId replaces the stripped params._tenantId as BOTH
  // the fail-closed guard AND the lib scope. sessions_send (reads _sourcePersonaName
  // — deferred carve-out) + sessions_spawn (subagent module) stay legacy.
  ["sessions_list", sessionsListDefinition],
  ["sessions_history", sessionsHistoryDefinition],
  // S34 (google-workspace domain) — google_workspace → server/google-workspace
  // (Gmail/Calendar/Contacts/Sheets/Docs/Slides backing lib, acyclic). SEAM
  // read-from-ctx: ctx.tenantId replaces the stripped params._tenantId as BOTH
  // the fail-closed guard AND the lib scope. params._projectDriveFolderId is a
  // DELIBERATELY non-stripped passthrough (read from params verbatim). create_slides
  // (larger arm, embedded PIE prompt) stays legacy — deferred to a later slice.
  ["google_workspace", googleWorkspaceDefinition],
  // Simulation Sandbox S4 (sandbox domain) — sandbox_run / sandbox_report →
  // server/lib/sandbox/replay.ts (backing lib, acyclic). SEAM read-from-ctx:
  // ctx.tenantId is the ONLY tenant source (fail-closed guard + lib scope);
  // no other trust signals read. Born-migrated (new tools, no legacy arm).
  ["sandbox_run", sandboxRunDefinition],
  ["sandbox_report", sandboxReportDefinition],
  // Improvement-list extension — sandbox_promote (jury-vetted upgrade proposals,
  // never auto-applied). Same born-migrated seam: ctx.tenantId only.
  ["sandbox_promote", sandboxPromoteDefinition],
]);

test("registered migrated definitions are the IDENTICAL objects the facade splices in", () => {
  const registered = getMigratedDefinitions();
  const byName = new Map(registered.map((d) => [d.function.name, d]));
  assert.deepEqual(
    [...byName.keys()].sort(),
    [...EXPECTED_MIGRATED.keys()].sort(),
    "migrated set must be exactly the S4 trio + S5 files six + S6 security five + S7 memory six + S8 knowledge seven + S9 web eight + S10 quality twelve + S11 documents eight + S12 browser three + S25c browser-pair two + S13 workspace six + S14 social four + S15 x-twitter nine + S16 outreach eight + S17 finance seven + S18 legal five + S19 multiagent three + S20 agentic three + S21 media six + S22 delivery three + S23 governance one + research eight + S26f seo-and-content-ops five + S26g skill-evolution fatigue-pair two + S26h strategic-memory four + S29 custom-tools three + manage_skills one + S30 video-editor three + S31 character-portraits three + S32 video-selectors two + S33 outlook three + S33 sessions two + S34 google-workspace one + simulation-sandbox three (update this test deliberately when a slice migrates more)",
  );
  for (const [name, def] of EXPECTED_MIGRATED) {
    assert.equal(byName.get(name), def, `${name}: registered definition must be the same object as definitions.ts export`);
    assert.ok(isMigrated(name));
  }
});

test("every migrated name exists in the committed inventory baseline", () => {
  const baseline = new Set(
    readFileSync(BASELINE, "utf8").split("\n").map((l) => l.trim()).filter(Boolean),
  );
  for (const name of EXPECTED_MIGRATED.keys()) {
    assert.ok(baseline.has(name), `${name} missing from tool-inventory-baseline.txt`);
  }
});

// Born-migrated tools have no legacy arm to remove, so nothing else would
// catch a missing facade splice (they'd be dispatchable but invisible to
// model tool-selection). Pin: each born-migrated definition const must be
// referenced in server/tools.ts at least twice (import + TOOL_DEFINITIONS
// splice), same static-text approach as the case-arm guard below.
const BORN_MIGRATED_DEF_CONSTS = ["sandboxRunDefinition", "sandboxReportDefinition", "sandboxPromoteDefinition"];
test("born-migrated definitions are spliced into the facade TOOL_DEFINITIONS surface", () => {
  const src = readFileSync(TOOLS_TS, "utf8");
  for (const constName of BORN_MIGRATED_DEF_CONSTS) {
    const refs = src.split(constName).length - 1;
    assert.ok(
      refs >= 2,
      `${constName} referenced ${refs}x in server/tools.ts — need import + TOOL_DEFINITIONS splice, or the tool is dispatchable but never exposed to tool selection`,
    );
  }
});

test("legacy switch has NO leftover case arm for any migrated tool", () => {
  const src = readFileSync(TOOLS_TS, "utf8");
  for (const name of EXPECTED_MIGRATED.keys()) {
    assert.ok(
      !src.includes(`case "${name}"`),
      `server/tools.ts still has a legacy case arm for migrated tool ${name} — remove it (divergence risk)`,
    );
  }
});
