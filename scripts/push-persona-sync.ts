import { syncPersonaDocs, getSyncStatus } from "../server/persona-sync";

async function main() {
  const personaId = process.argv[2] === undefined ? undefined : Number(process.argv[2]);
  if (personaId !== undefined && (!Number.isSafeInteger(personaId) || personaId < 1)) {
    throw new Error("Usage: npx tsx scripts/push-persona-sync.ts [positive persona ID]");
  }
  console.log(`[push-sync] Syncing ${personaId === undefined ? "all active personas" : `persona ${personaId}`}...`);
  const t0 = Date.now();
  const result = await syncPersonaDocs(personaId);
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
  console.log(`[push-sync] OK — synced ${personaId === undefined ? "all active personas" : `persona ${personaId}`}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[push-sync] threw:", err);
  process.exit(1);
});
