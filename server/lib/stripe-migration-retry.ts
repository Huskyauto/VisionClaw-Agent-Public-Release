import { setTimeout as delay } from "node:timers/promises";

interface RetryHooks {
  onRetry: () => void;
  wait?: () => Promise<void>;
}

export async function runStripeMigrationsWithRetry(
  migrate: () => Promise<void>,
  { onRetry, wait = () => delay(5_000) }: RetryHooks,
): Promise<void> {
  try {
    await migrate();
    return;
  } catch (error) {
    // pg clears this timer on the initial ReadyForQuery, before the Stripe
    // migrator issues SQL. Reject lookalike errors from queries or other I/O:
    // rerunning DDL after an ambiguous failure is not safe.
    const origin = error instanceof Error ? error.stack?.split("\n", 2)[1] : undefined;
    if (!(error instanceof Error) || error.message !== "timeout expired" ||
        !origin || !/[\\/]pg[\\/]lib[\\/]client\.js:\d+:\d+\)?$/.test(origin)) {
      throw error;
    }
    onRetry();
    await wait();
  }
  // No loop: the second failure always reaches the startup error handler.
  await migrate();
}
