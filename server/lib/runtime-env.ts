// Canonical production-runtime detection.
//
// Replit deployments reliably set REPLIT_DEPLOYMENT="1"; NODE_ENV is NOT
// guaranteed to be "production" in every deploy configuration. Guards that gate
// dev/workspace-ONLY behavior (self-modifying loops, file-mutating builders)
// MUST treat EITHER signal as production so they fail CLOSED — i.e. refuse to
// run — when the process is in a deployed context. Checking NODE_ENV alone
// fails OPEN (runs in prod) when NODE_ENV is absent/misset.
//
// Mirrors the inline pattern already used in server/routes/slack.ts,
// server/stripeClient.ts, server/google-drive.ts, etc.
export function isProductionRuntime(): boolean {
  return process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV === "production";
}
