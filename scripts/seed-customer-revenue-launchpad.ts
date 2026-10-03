/**
 * Idempotently provisions the owner-only Customer Revenue Launchpad project.
 *
 * The production application invokes the same seed at startup. This script
 * remains available for an explicit development verification run.
 */
import { seedCustomerRevenueLaunchpad } from "../server/lib/customer-revenue-launchpad-seed";

async function main() {
  const result = await seedCustomerRevenueLaunchpad();
  if (result.skippedDueToConcurrentSeed) {
    throw new Error("Launchpad seed deferred because another process holds the startup lock; retry shortly");
  }
  console.log(
    `[launchpad] ${result.created ? "created" : "reused"} project #${result.projectId}; ` +
    `pointer note ${result.pointerNoteCreated ? "created" : "already present"}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[launchpad] seed failed:", error);
    process.exit(1);
  });