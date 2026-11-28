/** One allowlist for the database CHECK and its narrow, backward-compatible migration. */
export const AGENT_JOB_STATUSES = [
  "pending", "running", "succeeded", "failed", "failed_terminal", "cancelled",
  "relay_queued", "relay_claimed", "relay_running", "relay_complete",
  "relay_failed_before_send", "relay_uncertain", "relay_cancelled", "relay_released", "relay_worker",
] as const;
