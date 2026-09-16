import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type NoveltyStatus = "new" | "adjacent" | "overlap/rejected";

export type RevenueSurface = {
  id: string;
  name: string;
  aliases: string[];
  customerOutcome: string;
};

export type RevenueOpportunityNoveltyInput = {
  title: string;
  targetBuyer: string;
  painfulJob: string;
  paidOffer: string;
  existingSurfaceComparison: string;
  buildDelta: string;
};

export type RevenueOpportunityScores = {
  novelty: number;
  buyerPain: number;
  willingnessToPay: number;
  buildEffort: number;
  timeToProof: number;
  evidenceQuality: number;
  operationalRisk: number;
};

export type RevenueOpportunityCandidate = RevenueOpportunityNoveltyInput & {
  proofExperiment: string;
  priceCostModel: string;
  evidencePlan: string;
  operationalRisks: string;
  killCriterion: string;
  scores: RevenueOpportunityScores;
};

export type RevenueDiscoveryResponse = {
  schemaVersion: 1;
  candidates: RevenueOpportunityCandidate[];
  finalSelection: {
    candidateTitle: string;
    rationale: string;
    handoff: string;
  };
};

export type RevenueDiscoveryParseResult =
  | { ok: true; value: RevenueDiscoveryResponse }
  | { ok: false; error: string };

export type NoveltyClassification = {
  status: NoveltyStatus;
  overlaps: string[];
};

export type PersistRevenueDiscoveryArtifactsInput = {
  rootDir: string;
  prompt: string;
  rawResponse: string;
  discovery: RevenueDiscoveryResponse;
  inventory: RevenueSurface[];
  now?: Date;
};

export type PersistedRevenueDiscoveryArtifacts = {
  directory: string;
  runFile: string;
  briefs: string[];
  status: "promoted" | "rejected";
  statusCounts: Record<NoveltyStatus, number>;
  concepts: string[];
};

export type FrontierRevenueConceptSummary = {
  id: string;
  title: string;
  targetBuyer: string;
  paidOffer: string;
  buildDelta: string;
  scores: RevenueOpportunityScores;
  noveltyStatus: "new";
  humanReviewState: "needs_review";
  createdAt: string;
  sourceRunCount: number;
};

export type FrontierRevenueConcept = FrontierRevenueConceptSummary & {
  candidate: RevenueOpportunityCandidate;
  sourceRunIds: string[];
  briefMarkdown: string;
  files: {
    concept: string;
    brief: string;
    sourceRun: string;
  };
};

type FrontierRevenueConceptManifestEntry = FrontierRevenueConceptSummary & {
  archiveDirectory: string;
  contentHash: string;
  sourceRunIds: string[];
  sourceRunFiles: string[];
  sourceBriefFiles: string[];
};

type FrontierRevenueConceptManifest = {
  schema_version: 1;
  concepts: FrontierRevenueConceptManifestEntry[];
};

export type FrontierRevenueJuryRunSummary = {
  id: string;
  title: string;
  createdAt: string;
  status: "complete" | "partial" | "failed";
  aggregatorModel: string;
  concordance: number | null;
  shouldEscalate: boolean;
  proposerCount: number;
  successfulProposers: number;
};

export type FrontierRevenueJuryRun = FrontierRevenueJuryRunSummary & {
  prompt: string;
  aggregated: string;
  proposers: Array<{
    modelId: string;
    providerLane: string | null;
    provider: string | null;
    ok: boolean;
    error: string | null;
  }>;
  rawRun: Record<string, unknown>;
};

type RawFrontierRevenueJuryRun = {
  prompt?: unknown;
  question?: unknown;
  aggregated?: unknown;
  aggregatorModel?: unknown;
  proposers?: unknown;
  created_at?: unknown;
  shouldEscalate?: unknown;
  concordance?: unknown;
};

function frontierRevenueJuryRunId(fileName: string): string | null {
  if (!/^(?:frontier-income|frontier-revenue-discovery)-[a-zA-Z0-9-]+\.json$/.test(fileName)) return null;
  return fileName.slice(0, -".json".length);
}

function juryRunCreatedAt(runId: string, raw: RawFrontierRevenueJuryRun): string {
  if (typeof raw.created_at === "string" && !Number.isNaN(Date.parse(raw.created_at))) return raw.created_at;
  const timestamp = runId.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  const parsed = timestamp
    ? new Date(`${timestamp[1]}T${timestamp[2]}:${timestamp[3]}:${timestamp[4]}.${timestamp[5]}Z`)
    : new Date(Number.NaN);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function summarizeFrontierRevenueJuryRun(
  runId: string,
  raw: RawFrontierRevenueJuryRun,
): FrontierRevenueJuryRunSummary {
  const aggregated = typeof raw.aggregated === "string" ? raw.aggregated : "";
  const proposers = Array.isArray(raw.proposers) ? raw.proposers : [];
  const successfulProposers = proposers.filter((proposer) =>
    typeof proposer === "object" && proposer !== null && (proposer as { ok?: unknown }).ok === true,
  ).length;
  const status = !aggregated.trim() || /^MoA failed:/i.test(aggregated)
    ? "failed"
    : /^MoA partial result:/i.test(aggregated) || Boolean(raw.shouldEscalate)
      ? "partial"
      : "complete";
  const createdAt = juryRunCreatedAt(runId, raw);
  return {
    id: runId,
    title: `Frontier revenue jury — ${new Date(createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    })}`,
    createdAt,
    status,
    aggregatorModel: typeof raw.aggregatorModel === "string" ? raw.aggregatorModel : "(not recorded)",
    concordance: typeof raw.concordance === "number" && Number.isFinite(raw.concordance) ? raw.concordance : null,
    shouldEscalate: raw.shouldEscalate === true,
    proposerCount: proposers.length,
    successfulProposers,
  };
}

export async function listFrontierRevenueJuryRuns(rootDir: string): Promise<FrontierRevenueJuryRunSummary[]> {
  const fileNames = (await readdir(rootDir, { withFileTypes: true }))
    .map((entry) => entry.name)
    .filter((fileName) => frontierRevenueJuryRunId(fileName) !== null);
  const runs = await Promise.all(fileNames.map(async (fileName) => {
    const run = await readFrontierRevenueJuryRun(rootDir, frontierRevenueJuryRunId(fileName)!);
    if (!run) throw new Error(`Invalid frontier jury run id: ${fileName}`);
    return run;
  }));
  return runs
    .map(({ rawRun: _rawRun, ...summary }) => summary)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function readFrontierRevenueJuryRun(
  rootDir: string,
  runId: string,
): Promise<FrontierRevenueJuryRun | null> {
  if (!/^(?:frontier-income|frontier-revenue-discovery)-[a-zA-Z0-9-]+$/.test(runId)) return null;
  const runPath = await resolveExistingPathWithinRoot(rootDir, `${runId}.json`);
  if (!(await stat(runPath)).isFile()) throw new Error("Frontier jury run is not a regular file");
  const rawRun = JSON.parse(await readFile(runPath, "utf8")) as RawFrontierRevenueJuryRun;
  const summary = summarizeFrontierRevenueJuryRun(runId, rawRun);
  const proposers = Array.isArray(rawRun.proposers) ? rawRun.proposers : [];
  return {
    ...summary,
    prompt: typeof rawRun.prompt === "string"
      ? rawRun.prompt
      : typeof rawRun.question === "string" ? rawRun.question : "",
    aggregated: typeof rawRun.aggregated === "string" ? rawRun.aggregated : "",
    proposers: proposers.map((proposer) => {
      const value = typeof proposer === "object" && proposer !== null ? proposer as Record<string, unknown> : {};
      return {
        modelId: typeof value.modelId === "string" ? value.modelId : "(unknown model)",
        providerLane: typeof value.providerLane === "string" ? value.providerLane : null,
        provider: typeof value.provider === "string" ? value.provider : null,
        ok: value.ok === true,
        error: typeof value.error === "string" ? value.error : null,
      };
    }),
    rawRun: rawRun as Record<string, unknown>,
  };
}

export function isFrontierRevenueDiscoveryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.FRONTIER_REVENUE_DISCOVERY_ENABLED === "1";
}

export function isFrontierRevenueDiscoveryPaidFinalEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.FRONTIER_REVENUE_DISCOVERY_PAID_FINAL === "1";
}

export function buildFrontierRevenueDiscoveryPrompt(inventory: RevenueSurface[]): string {
  const existingSurfaces = inventory
    .map((surface) => `- ${surface.id}: ${surface.name}. Existing outcome: ${surface.customerOutcome} Aliases: ${surface.aliases.join("; ")}.`)
    .join("\n");

  return `
You are a novelty-first revenue discovery jury for VisionClaw, a one-owner agentic AI platform.
Your job is NOT to repackage an existing offer. Discover genuinely new, capability-adjacent revenue
products that could be built and tested by one owner with human approval for every external commitment.

Current verified capabilities: market and competitor research; tailored reports and digital documents;
websites and small web apps; marketing content; local-SMB prospect identification; outreach preparation;
and customer-delivery materials. Human approval is required before any customer message, payment,
or other external commitment. Do not promise sales, use paid advertising at scale, rely on a large support
team, or claim an unbuilt capability already exists.

The following revenue surfaces already exist. A candidate that only changes their price, vertical,
wording, channel, or presentation is overlap and must not be selected as new:
${existingSurfaces}

Generate 3 to 5 materially distinct candidates. A candidate may require one small, explicit build delta,
but must explain that delta honestly and keep its first proof experiment within 30 days. Prefer a different
buyer pain, paid deliverable, or repeatable operating loop—not a renamed audit, prospecting dossier,
creator channel service, archive rescue, CMMC play, or revenue-mission lifecycle.

For every candidate, provide a conservative 0–100 score for novelty, buyer pain, willingness to pay,
build effort (lower is easier), time to proof (lower is faster), evidence quality, and operational risk
(lower is safer). State the buyer, painful job, paid offer, comparison to existing surfaces, exact build
delta, 30-day proof experiment, conservative price/cost model, evidence plan, operational/legal risks,
and a kill criterion.

Return ONLY one JSON object with this exact shape (no Markdown):
{
  "schema_version": 1,
  "candidates": [
    {
      "title": "string",
      "target_buyer": "string",
      "painful_job": "string",
      "paid_offer": "string",
      "existing_surface_comparison": "string",
      "build_delta": "string",
      "proof_experiment": "string",
      "price_cost_model": "string",
      "evidence_plan": "string",
      "operational_risks": "string",
      "kill_criterion": "string",
      "scores": {
        "novelty": 0,
        "buyer_pain": 0,
        "willingness_to_pay": 0,
        "build_effort": 0,
        "time_to_proof": 0,
        "evidence_quality": 0,
        "operational_risk": 0
      }
    }
  ],
  "final_selection": {
    "candidate_title": "must exactly match one candidate title",
    "rationale": "string",
    "handoff": "explicitly say that a human must choose before a feature contract or Revenue Mission is created"
  }
}
`.trim();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function includesAlias(value: string, alias: string): boolean {
  const normalizedAlias = normalize(alias);
  return normalizedAlias.length > 0 && value.includes(normalizedAlias);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function loadRevenueSurfaceInventory(filePath: string): Promise<RevenueSurface[]> {
  const source = await readFile(filePath, "utf8");
  const embedded = source.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (!embedded) throw new Error(`revenue surface inventory ${filePath} must contain one JSON block`);

  let decoded: unknown;
  try {
    decoded = JSON.parse(embedded);
  } catch {
    throw new Error(`revenue surface inventory ${filePath} contains invalid JSON`);
  }
  const root = asRecord(decoded);
  if (!root || root.schema_version !== 1 || !Array.isArray(root.surfaces) || root.surfaces.length === 0) {
    throw new Error(`revenue surface inventory ${filePath} must contain schema_version 1 and non-empty surfaces`);
  }

  const surfaces: RevenueSurface[] = [];
  const seenIds = new Set<string>();
  for (const rawSurface of root.surfaces) {
    const surface = asRecord(rawSurface);
    const id = surface && requiredText(surface, "id", "id");
    const name = surface && requiredText(surface, "name", "name");
    const customerOutcome = surface && requiredText(surface, "customer_outcome", "customer_outcome");
    const aliases = surface?.aliases;
    if (
      !id ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ||
      !name ||
      !customerOutcome ||
      !Array.isArray(aliases) ||
      aliases.length === 0 ||
      aliases.some((alias) => typeof alias !== "string" || alias.trim().length === 0 || alias.length > 160) ||
      seenIds.has(id)
    ) {
      throw new Error(`revenue surface inventory ${filePath} contains an invalid surface`);
    }
    seenIds.add(id);
    surfaces.push({
      id,
      name,
      aliases: aliases.map((alias) => (alias as string).trim()),
      customerOutcome,
    });
  }
  return surfaces;
}

function requiredText(record: Record<string, unknown>, key: string, label: string): string | null {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 4_000) {
    return null;
  }
  return value.trim();
}

function requiredScore(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 80_000) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  if (candidate.startsWith("{") && candidate.endsWith("}")) return candidate;

  const start = candidate.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index++) {
    const char = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, index + 1);
    }
  }
  return null;
}

function parseCandidate(value: unknown, index: number): RevenueOpportunityCandidate | string {
  const record = asRecord(value);
  if (!record) return `candidate ${index + 1} must be an object`;

  const fields = [
    ["title", "title"],
    ["target_buyer", "target_buyer"],
    ["painful_job", "painful_job"],
    ["paid_offer", "paid_offer"],
    ["existing_surface_comparison", "existing_surface_comparison"],
    ["build_delta", "build_delta"],
    ["proof_experiment", "proof_experiment"],
    ["price_cost_model", "price_cost_model"],
    ["evidence_plan", "evidence_plan"],
    ["operational_risks", "operational_risks"],
    ["kill_criterion", "kill_criterion"],
  ] as const;
  const parsed: Record<string, string> = {};
  for (const [sourceKey, targetKey] of fields) {
    const text = requiredText(record, sourceKey, sourceKey);
    if (!text) return `candidate ${index + 1} missing ${sourceKey}`;
    parsed[targetKey] = text;
  }

  const scoreRecord = asRecord(record.scores);
  if (!scoreRecord) return `candidate ${index + 1} missing scores`;
  const scoreKeys = [
    ["novelty", "novelty"],
    ["buyer_pain", "buyerPain"],
    ["willingness_to_pay", "willingnessToPay"],
    ["build_effort", "buildEffort"],
    ["time_to_proof", "timeToProof"],
    ["evidence_quality", "evidenceQuality"],
    ["operational_risk", "operationalRisk"],
  ] as const;
  const scores: Record<string, number> = {};
  for (const [sourceKey, targetKey] of scoreKeys) {
    const score = requiredScore(scoreRecord, sourceKey);
    if (score === null) return `candidate ${index + 1} has invalid score ${sourceKey}`;
    scores[targetKey] = score;
  }

  return {
    title: parsed.title,
    targetBuyer: parsed.target_buyer,
    painfulJob: parsed.painful_job,
    paidOffer: parsed.paid_offer,
    existingSurfaceComparison: parsed.existing_surface_comparison,
    buildDelta: parsed.build_delta,
    proofExperiment: parsed.proof_experiment,
    priceCostModel: parsed.price_cost_model,
    evidencePlan: parsed.evidence_plan,
    operationalRisks: parsed.operational_risks,
    killCriterion: parsed.kill_criterion,
    scores: scores as RevenueOpportunityScores,
  };
}

export function parseRevenueDiscoveryResponse(raw: string): RevenueDiscoveryParseResult {
  const extracted = extractJsonObject(raw);
  if (!extracted) return { ok: false, error: "discovery response must contain one bounded JSON object" };

  let decoded: unknown;
  try {
    decoded = JSON.parse(extracted);
  } catch {
    return { ok: false, error: "discovery response contains invalid JSON" };
  }

  const root = asRecord(decoded);
  if (!root || root.schema_version !== 1) {
    return { ok: false, error: "discovery response requires schema_version 1" };
  }
  if (!Array.isArray(root.candidates) || root.candidates.length < 3 || root.candidates.length > 5) {
    return { ok: false, error: "discovery response requires 3 to 5 candidates" };
  }

  const candidates: RevenueOpportunityCandidate[] = [];
  for (const [index, candidate] of root.candidates.entries()) {
    const parsed = parseCandidate(candidate, index);
    if (typeof parsed === "string") return { ok: false, error: parsed };
    candidates.push(parsed);
  }
  if (new Set(candidates.map((candidate) => normalize(candidate.title))).size !== candidates.length) {
    return { ok: false, error: "candidate titles must be distinct" };
  }

  const finalSelection = asRecord(root.final_selection);
  if (!finalSelection) return { ok: false, error: "discovery response missing final_selection" };
  const candidateTitle = requiredText(finalSelection, "candidate_title", "candidate_title");
  const rationale = requiredText(finalSelection, "rationale", "rationale");
  const handoff = requiredText(finalSelection, "handoff", "handoff");
  if (!candidateTitle || !rationale || !handoff) {
    return { ok: false, error: "final_selection requires candidate_title, rationale, and handoff" };
  }
  if (!candidates.some((candidate) => normalize(candidate.title) === normalize(candidateTitle))) {
    return { ok: false, error: "final_selection candidate_title must match a candidate" };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      candidates,
      finalSelection: { candidateTitle, rationale, handoff },
    },
  };
}

export function classifyRevenueOpportunityNovelty(
  candidate: RevenueOpportunityNoveltyInput,
  inventory: RevenueSurface[],
): NoveltyClassification {
  const candidateText = normalize([
    candidate.title,
    candidate.targetBuyer,
    candidate.painfulJob,
    candidate.paidOffer,
    candidate.existingSurfaceComparison,
    candidate.buildDelta,
  ].join(" "));

  const matched = inventory
    .map((surface) => ({
      id: surface.id,
      matchCount: surface.aliases.filter((alias) => includesAlias(candidateText, alias)).length,
    }))
    .filter((surface) => surface.matchCount > 0);
  const overlaps = matched.map((surface) => surface.id);

  return {
    status: overlaps.length > 0 ? "overlap/rejected" : "new",
    overlaps,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function dateBucket(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function toSlug(value: string): string {
  const slug = normalize(value).replace(/\s+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return slug || "untitled-opportunity";
}

async function createFreshRunDirectory(rootDir: string, baseName: string): Promise<string> {
  await mkdir(rootDir, { recursive: true });
  for (let suffix = 1; suffix <= 100; suffix++) {
    const directory = path.join(rootDir, suffix === 1 ? baseName : `${baseName}-${suffix}`);
    try {
      await mkdir(directory);
      return directory;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`could not allocate a unique discovery output directory for ${baseName}`);
}

let atomicWriteSequence = 0;
async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${atomicWriteSequence++}`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, filePath);
}

function isWithinRoot(rootDir: string, candidatePath: string): boolean {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function resolveExistingPathWithinRoot(rootDir: string, relativePath: string): Promise<string> {
  const canonicalRoot = await realpath(rootDir);
  const requestedPath = path.resolve(canonicalRoot, relativePath);
  if (!isWithinRoot(canonicalRoot, requestedPath) || requestedPath === canonicalRoot) {
    throw new Error("frontier concept archive contains an unsafe path");
  }

  const canonicalPath = await realpath(requestedPath);
  if (!isWithinRoot(canonicalRoot, canonicalPath) || canonicalPath === canonicalRoot) {
    throw new Error("frontier concept archive contains an unsafe path");
  }
  return canonicalPath;
}

async function readConceptManifest(archiveRoot: string): Promise<FrontierRevenueConceptManifest> {
  try {
    const decoded = JSON.parse(await readFile(path.join(archiveRoot, "index.json"), "utf8")) as FrontierRevenueConceptManifest;
    if (
      !decoded ||
      decoded.schema_version !== 1 ||
      !Array.isArray(decoded.concepts) ||
      decoded.concepts.some((concept) => !concept || typeof concept.id !== "string" || typeof concept.archiveDirectory !== "string")
    ) {
      throw new Error("frontier concept archive index has an invalid shape");
    }
    return decoded;
  } catch (error: any) {
    if (error?.code === "ENOENT") return { schema_version: 1, concepts: [] };
    throw error;
  }
}

async function withArchiveLock<T>(archiveRoot: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(archiveRoot, { recursive: true });
  const lockPath = `${archiveRoot}.lock`;
  let locked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await mkdir(lockPath);
      locked = true;
      break;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!locked) throw new Error("frontier concept archive is busy");
  try {
    return await operation();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

function conceptContentHash(candidate: RevenueOpportunityCandidate): string {
  return sha256(JSON.stringify({
    title: normalize(candidate.title),
    targetBuyer: normalize(candidate.targetBuyer),
    painfulJob: normalize(candidate.painfulJob),
    paidOffer: normalize(candidate.paidOffer),
    existingSurfaceComparison: normalize(candidate.existingSurfaceComparison),
    buildDelta: normalize(candidate.buildDelta),
    proofExperiment: normalize(candidate.proofExperiment),
    priceCostModel: normalize(candidate.priceCostModel),
    evidencePlan: normalize(candidate.evidencePlan),
    operationalRisks: normalize(candidate.operationalRisks),
    killCriterion: normalize(candidate.killCriterion),
    scores: candidate.scores,
  }));
}

function manifestSummary(entry: FrontierRevenueConceptManifestEntry): FrontierRevenueConceptSummary {
  const { archiveDirectory: _, contentHash: __, sourceRunIds: ___, sourceRunFiles: ____, sourceBriefFiles: _____, ...summary } = entry;
  return summary;
}

export async function listFrontierRevenueConcepts(rootDir: string): Promise<FrontierRevenueConceptSummary[]> {
  const archiveRoot = path.join(rootDir, "archive");
  const manifest = await readConceptManifest(archiveRoot);
  return manifest.concepts
    .map(manifestSummary)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function readFrontierRevenueConcept(
  rootDir: string,
  conceptId: string,
): Promise<FrontierRevenueConcept | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,180}$/.test(conceptId)) return null;
  const archiveRoot = path.join(rootDir, "archive");
  const manifest = await readConceptManifest(archiveRoot);
  const entry = manifest.concepts.find((concept) => concept.id === conceptId);
  if (!entry) return null;

  const conceptDir = await resolveExistingPathWithinRoot(archiveRoot, entry.archiveDirectory);
  if (path.basename(conceptDir) !== conceptId) {
    throw new Error("frontier concept archive contains an unsafe path");
  }
  const conceptRecordPath = await resolveExistingPathWithinRoot(
    archiveRoot,
    path.join(entry.archiveDirectory, "concept.json"),
  );
  const briefPath = await resolveExistingPathWithinRoot(
    archiveRoot,
    path.join(entry.archiveDirectory, "README.md"),
  );
  const conceptRecord = JSON.parse(await readFile(conceptRecordPath, "utf8")) as {
    candidate: RevenueOpportunityCandidate;
    source_run_ids: string[];
  };
  const briefMarkdown = await readFile(briefPath, "utf8");
  const sourceRun = entry.sourceRunFiles[0];
  if (!sourceRun) {
    throw new Error("frontier concept source run path is unsafe");
  }
  await resolveExistingPathWithinRoot(rootDir, sourceRun);
  return {
    ...manifestSummary(entry),
    candidate: conceptRecord.candidate,
    sourceRunIds: [...entry.sourceRunIds],
    briefMarkdown,
    files: {
      concept: path.join("archive", entry.archiveDirectory, "concept.json"),
      brief: path.join("archive", entry.archiveDirectory, "README.md"),
      sourceRun,
    },
  };
}

async function archiveAcceptedConcepts(
  input: PersistRevenueDiscoveryArtifactsInput,
  runDirectory: string,
  runFile: string,
  briefs: string[],
  classifications: Array<{ candidate: RevenueOpportunityCandidate; classification: NoveltyClassification }>,
  runStatus: "promoted" | "rejected",
  now: Date,
): Promise<string[]> {
  if (runStatus !== "promoted") return [];
  const archiveRoot = path.join(input.rootDir, "archive");
  const runId = path.basename(runDirectory);
  const runRelativePath = path.relative(input.rootDir, runFile).split(path.sep).join("/");
  const accepted = classifications
    .map((item, index) => ({ ...item, index }))
    .filter(({ classification }) => classification.status === "new");
  if (accepted.length === 0) return [];

  return withArchiveLock(archiveRoot, async () => {
    const manifest = await readConceptManifest(archiveRoot);
    const usedSlugs = new Map<string, number>();
    const conceptIds: string[] = [];

    for (const { candidate, index } of accepted) {
      const contentHash = conceptContentHash(candidate);
      const existing = manifest.concepts.find((concept) => concept.contentHash === contentHash);
      const briefPath = briefs[index];
      if (!briefPath) throw new Error(`missing persisted brief for frontier concept ${candidate.title}`);
      const briefRelativePath = path.relative(input.rootDir, briefPath).split(path.sep).join("/");

      if (existing) {
        if (!existing.sourceRunIds.includes(runId)) existing.sourceRunIds.push(runId);
        if (!existing.sourceRunFiles.includes(runRelativePath)) existing.sourceRunFiles.push(runRelativePath);
        if (!existing.sourceBriefFiles.includes(briefRelativePath)) existing.sourceBriefFiles.push(briefRelativePath);
        existing.sourceRunCount = existing.sourceRunIds.length;
        conceptIds.push(existing.id);
        continue;
      }

      const baseSlug = toSlug(candidate.title);
      const seen = usedSlugs.get(baseSlug) || 0;
      usedSlugs.set(baseSlug, seen + 1);
      const id = `${seen === 0 ? baseSlug : `${baseSlug}-${seen + 1}`}-${contentHash.slice(0, 12)}`;
      const conceptDir = path.join(archiveRoot, id);
      if (!isWithinRoot(archiveRoot, conceptDir)) throw new Error("frontier concept archive path escaped its root");
      await mkdir(conceptDir);
      await atomicWriteFile(path.join(conceptDir, "concept.json"), JSON.stringify({
        schema_version: 1,
        concept_id: id,
        created_at: now.toISOString(),
        novelty_status: "new",
        human_review_state: "needs_review",
        candidate,
        source_run_ids: [runId],
        source_run_file: runRelativePath,
        source_brief_file: briefRelativePath,
        external_commitments: "none",
      }, null, 2) + "\n");
      await atomicWriteFile(path.join(conceptDir, "README.md"), await readFile(briefPath, "utf8"));
      manifest.concepts.push({
        id,
        title: candidate.title,
        targetBuyer: candidate.targetBuyer,
        paidOffer: candidate.paidOffer,
        buildDelta: candidate.buildDelta,
        scores: candidate.scores,
        noveltyStatus: "new",
        humanReviewState: "needs_review",
        createdAt: now.toISOString(),
        sourceRunCount: 1,
        archiveDirectory: id,
        contentHash,
        sourceRunIds: [runId],
        sourceRunFiles: [runRelativePath],
        sourceBriefFiles: [briefRelativePath],
      });
      conceptIds.push(id);
    }

    await atomicWriteFile(path.join(archiveRoot, "index.json"), JSON.stringify(manifest, null, 2) + "\n");
    return conceptIds;
  });
}

function briefMarkdown(
  candidate: RevenueOpportunityCandidate,
  classification: NoveltyClassification,
  finalSelection: RevenueDiscoveryResponse["finalSelection"],
): string {
  return [
    `# ${candidate.title}`,
    "",
    `**Status: ${classification.status}**`,
    classification.overlaps.length > 0
      ? `**Related existing surfaces:** ${classification.overlaps.join(", ")}`
      : "**Related existing surfaces:** none identified by the deterministic inventory gate",
    "",
    "## Buyer and paid offer",
    `- **Target buyer:** ${candidate.targetBuyer}`,
    `- **Painful job:** ${candidate.painfulJob}`,
    `- **Paid offer:** ${candidate.paidOffer}`,
    `- **Why it differs from existing work:** ${candidate.existingSurfaceComparison}`,
    "",
    "## Smallest build and proof",
    `- **Build delta:** ${candidate.buildDelta}`,
    `- **30-day proof experiment:** ${candidate.proofExperiment}`,
    `- **Conservative price/cost model:** ${candidate.priceCostModel}`,
    `- **Evidence required:** ${candidate.evidencePlan}`,
    "",
    "## Risk and stop condition",
    `- **Operational/legal risks:** ${candidate.operationalRisks}`,
    `- **Kill criterion:** ${candidate.killCriterion}`,
    "",
    "## Scores (0–100)",
    `- Novelty: ${candidate.scores.novelty}; buyer pain: ${candidate.scores.buyerPain}; willingness to pay: ${candidate.scores.willingnessToPay}`,
    `- Build effort: ${candidate.scores.buildEffort}; time to proof: ${candidate.scores.timeToProof}; evidence quality: ${candidate.scores.evidenceQuality}; operational risk: ${candidate.scores.operationalRisk}`,
    "",
    "## Human handoff",
    `- **Jury selection:** ${finalSelection.candidateTitle}`,
    `- **Rationale:** ${finalSelection.rationale}`,
    `- **Suggested handoff:** ${finalSelection.handoff}`,
    "- **Human decision required:** this brief is research only. It cannot create a feature contract, Revenue Mission, outreach experiment, payment, or customer contact.",
    "",
  ].join("\n");
}

export async function persistRevenueDiscoveryArtifacts(
  input: PersistRevenueDiscoveryArtifactsInput,
): Promise<PersistedRevenueDiscoveryArtifacts> {
  const now = input.now || new Date();
  const classifications = input.discovery.candidates.map((candidate) => ({
    candidate,
    classification: classifyRevenueOpportunityNovelty(candidate, input.inventory),
  }));
  const statusCounts: Record<NoveltyStatus, number> = {
    new: 0,
    adjacent: 0,
    "overlap/rejected": 0,
  };
  for (const { classification } of classifications) statusCounts[classification.status]++;

  const identity = sha256(JSON.stringify({
    prompt: normalize(input.prompt),
    inventory: input.inventory.map((surface) => ({
      id: surface.id,
      aliases: [...surface.aliases].map(normalize).sort(),
    })).sort((a, b) => a.id.localeCompare(b.id)),
    bucket: dateBucket(now),
  })).slice(0, 12);
  const directory = await createFreshRunDirectory(
    input.rootDir,
    `frontier-revenue-${dateBucket(now)}-${identity}`,
  );

  const selected = classifications.find(({ candidate }) =>
    normalize(candidate.title) === normalize(input.discovery.finalSelection.candidateTitle),
  );
  if (!selected) {
    throw new Error("discovery final selection disappeared after schema validation");
  }
  const status = selected.classification.status === "new" ? "promoted" : "rejected";
  const runFile = path.join(directory, "run.json");
  await atomicWriteFile(runFile, JSON.stringify({
    schema_version: 1,
    run_id: path.basename(directory),
    created_at: now.toISOString(),
    status,
    status_counts: statusCounts,
    prompt_hash: sha256(normalize(input.prompt)),
    inventory_hash: sha256(JSON.stringify(input.inventory)),
    prompt: input.prompt,
    raw_response: input.rawResponse,
    discovery: input.discovery,
    classifications: classifications.map(({ candidate, classification }) => ({
      title: candidate.title,
      ...classification,
    })),
    external_commitments: "none",
  }, null, 2) + "\n");

  const usedSlugs = new Map<string, number>();
  const briefs: string[] = [];
  for (const [index, { candidate, classification }] of classifications.entries()) {
    const baseSlug = toSlug(candidate.title);
    const seen = usedSlugs.get(baseSlug) || 0;
    usedSlugs.set(baseSlug, seen + 1);
    const slug = seen === 0 ? baseSlug : `${baseSlug}-${seen + 1}`;
    const briefPath = path.join(directory, `candidate-${String(index + 1).padStart(2, "0")}-${slug}.md`);
    await atomicWriteFile(briefPath, briefMarkdown(candidate, classification, input.discovery.finalSelection));
    briefs.push(briefPath);
  }

  const concepts = await archiveAcceptedConcepts(input, directory, runFile, briefs, classifications, status, now);
  return { directory, runFile, briefs, status, statusCounts, concepts };
}