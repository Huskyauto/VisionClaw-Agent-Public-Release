import { syncPersonaDocs, getSyncStatus } from "../server/persona-sync";

async function main() {
  console.log("[push-sync] Pushing PLATFORM_TOOLS_CONTRACT (incl. new RECURSIVE LANGUAGE MODELS section) to all active personas...");
  const t0 = Date.now();
  const result = await syncPersonaDocs();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[push-sync] Completed in ${elapsed}s`);
  console.log(`[push-sync] synced=${result.synced} personas, toolCount=${result.toolCount} (incl. recursive_synthesize), customToolCount=${result.customToolCount}, skillCount=${result.skillCount}`);
  console.log(`[push-sync] persona names: ${result.personas.join(", ")}`);

  const status = await getSyncStatus();
  console.log(`[push-sync] post-sync status: ${JSON.stringify(status, null, 2)}`);

  if (result.synced === 0) {
    console.error("[push-sync] FAIL — no personas synced");
    process.exit(1);
  }
  console.log("[push-sync] OK — every active persona now has the updated tools_doc with the recursive_synthesize guidance.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[push-sync] threw:", err);
  process.exit(1);
});
