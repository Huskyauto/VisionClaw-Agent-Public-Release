import fs from "node:fs";
import { getAllRegisteredTools, getToolMeta } from "../server/tool-registry";

/** Catalog, not a claim that live providers or semantic outcomes were tested. */
export function buildToolVerificationCoverage() {
  const names = getAllRegisteredTools().sort();
  if (!names.length || names.length !== new Set(names).size) throw new Error("Invalid tool census");
  const tools = names.map(name => {
    const meta = getToolMeta(name);
    if (!meta) throw new Error(`Unclassified registered tool: ${name}`);
    return { name, baseline: "bounded_result_postflight", categories: meta.categories,
      artifactContractAdapter: meta.isProductOutput,
      exactWriteReadback: name === "write_file",
      independentCustomerOutcomeCertified: false,
      additionalEvidenceRequired: meta.isProductOutput
        ? ["request_acceptance", "source_visual_media_qa", "final_delivery_proof"]
        : meta.isNetworkTool
          ? ["tool_action_contract", "authoritative_provider_readback_when_consequential"]
          : ["tool_action_contract", "tenant_scoped_state_readback_when_mutating"],
    };
  });
  return { version: 1, registeredTools: tools.length, baselineCovered: tools.length,
    artifactAdapters: tools.filter(t => t.artifactContractAdapter).length,
    exactWriteReadbacks: tools.filter(t => t.exactWriteReadback).length,
    scope: "Baseline coverage is not bespoke or live-provider correctness certification.",
    knownLimits: ["Arrays/primitives preserve their shapes; receipts use diagnostics rather than a JSON wrapper.",
      "Generic local-artifact adapter is owner-only; customer deliveries retain their mandatory tenant-scoped gate.",
      "External acknowledgments, IDs, URLs and success flags are not independent completion proof.",
      "Additional tool-specific provider/state readbacks are required; this catalog does not pretend they exist."],
    tools };
}
if (process.argv[1]?.endsWith("tool-verification-coverage.ts")) {
  const report = buildToolVerificationCoverage();
  if (process.argv.includes("--write")) fs.writeFileSync("docs/tool-verification-coverage.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ registeredTools: report.registeredTools, baselineCovered: report.baselineCovered,
    artifactAdapters: report.artifactAdapters, exactWriteReadbacks: report.exactWriteReadbacks, scope: report.scope }));
}
