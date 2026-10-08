import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_TENANT_ID } from "../server/auth";
import {
  buildFrontierRevenueDiscoveryPrompt,
  isFrontierRevenueDiscoveryEnabled,
  isFrontierRevenueDiscoveryPaidFinalEnabled,
  loadRevenueSurfaceInventory,
  parseRevenueDiscoveryResponse,
  persistRevenueDiscoveryArtifacts,
} from "../server/lib/frontier-revenue-discovery";
import { executeMoA, type MoAResult } from "../server/moa";

const INVENTORY_PATH = path.join("data", "money-opportunities", "existing-revenue-surfaces.md");
const DISCOVERY_ROOT = path.join("data", "money-opportunities");
const DISCOVERY_POOL = "frontier-lite" as const;
const DISCOVERY_AGGREGATOR = "gpt-5.6-sol";

function outputPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join("data", "moa-prompt-tests", `frontier-revenue-discovery-${stamp}.json`);
}

function printResult(result: MoAResult): void {
  console.log("\n=== FRONTIER JURY RESPONSES ===");
  for (const [index, proposer] of result.proposers.entries()) {
    console.log(`\n--- Jury ${index + 1}: ${proposer.modelId} [${proposer.providerLane || proposer.provider}] ---`);
    console.log(proposer.ok ? proposer.answer || "(empty response)" : `FAILED: ${proposer.error || "unknown error"}`);
  }

  console.log(`\n=== FINAL REWORK: ${result.aggregatorModel} (REWORKED + SYNTHESIZED ANSWER) ===`);
  console.log(result.aggregated);
  console.log("\n=== RUN TELEMETRY ===");
  console.log(JSON.stringify({
    responseId: result.responseId,
    concordance: result.concordance,
    shouldEscalate: result.shouldEscalate,
    totalLatencyMs: result.totalLatencyMs,
    successfulProposers: result.proposers.filter((proposer) => proposer.ok).length,
  }, null, 2));
}

function hasCompleteFrontierJury(result: MoAResult): boolean {
  const expectedLanes = ["openference", "profundo"];
  return (
    expectedLanes.every((lane) =>
      result.proposers.some((proposer) => proposer.providerLane === lane && proposer.ok && proposer.answer),
    ) &&
    result.aggregatorModel === DISCOVERY_AGGREGATOR &&
    Boolean(result.aggregated.trim())
  );
}

export async function main(): Promise<void> {
  if (!isFrontierRevenueDiscoveryEnabled()) {
    throw new Error(
      "Frontier revenue discovery is disabled. Set FRONTIER_REVENUE_DISCOVERY_ENABLED=1 for an owner-authorized run.",
    );
  }
  const inventory = await loadRevenueSurfaceInventory(INVENTORY_PATH);
  const prompt = buildFrontierRevenueDiscoveryPrompt(inventory);
  const result = await executeMoA({
    question: prompt,
    // This is an owner-operated diagnostic. Never let an environment override
    // create billing or telemetry records under an arbitrary tenant.
    tenantId: ADMIN_TENANT_ID,
    pool: DISCOVERY_POOL,
    aggregatorId: DISCOVERY_AGGREGATOR,
    // An API-key fallback is separately opt-in for this operator run. The two
    // proposer seats are pinned to flat/free providers either way.
    meteredOverride: isFrontierRevenueDiscoveryPaidFinalEnabled(),
    // Persisted discovery evidence must never claim GPT-5.6 after a free-model
    // or cross-provider fallback. Fail the run rather than relabel it.
    strictAggregatorModel: true,
    // The global metered switch must not turn an unapproved discovery run into
    // an API-key call. This remains true after the owner ceiling is exhausted.
    forbidMeteredAggregatorFallback: true,
    invokedVia: "frontier-income-prompt-test",
    restateGate: false,
    dissentQuota: false,
    autoSecondOpinion: false,
  });

  const filePath = outputPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({
    prompt,
    inventory_path: INVENTORY_PATH,
    ...result,
  }, null, 2) + "\n", "utf8");
  printResult(result);
  console.log(`\nSaved full prompt-test result to ${filePath}`);

  if (!hasCompleteFrontierJury(result)) {
    throw new Error(
      `frontier discovery jury did not complete: expected successful openference and profundo proposers plus ${DISCOVERY_AGGREGATOR} synthesis`,
    );
  }

  const parsed = parseRevenueDiscoveryResponse(result.aggregated);
  if (!parsed.ok) {
    throw new Error(`frontier discovery synthesis was rejected: ${parsed.error}`);
  }
  const artifacts = await persistRevenueDiscoveryArtifacts({
    rootDir: DISCOVERY_ROOT,
    prompt,
    rawResponse: result.aggregated,
    discovery: parsed.value,
    inventory,
  });
  console.log(
    `[frontier-revenue-discovery] run=${path.basename(artifacts.directory)} status=${artifacts.status} ` +
    `new=${artifacts.statusCounts.new} adjacent=${artifacts.statusCounts.adjacent} overlap=${artifacts.statusCounts["overlap/rejected"]}`,
  );
  console.log(`[frontier-revenue-discovery] briefs=${artifacts.briefs.join(", ")}`);
  if (artifacts.status !== "promoted") {
    throw new Error("frontier discovery produced only overlapping revenue surfaces; no candidate was promoted");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[frontier-revenue-discovery] failed:", error);
    process.exitCode = 1;
  });
}