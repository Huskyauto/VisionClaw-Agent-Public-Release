import { ADMIN_TENANT_ID } from "../server/tenant-constants";
import { withTenantContext } from "../server/lib/tenant-context";
import { runReview } from "../server/daily-ai-insights/runner";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--scheduled", "--smoke"].includes(args[0])) {
    throw new Error("Usage: daily-ai-insights --scheduled | --smoke; unknown flags never run work");
  }
  const result = await withTenantContext({ tenantId: ADMIN_TENANT_ID, source: "cron" }, () =>
    runReview(ADMIN_TENANT_ID, { scheduled: args[0] === "--scheduled", smoke: args[0] === "--smoke" }));
  console.log(JSON.stringify(result));
}
main().then(() => process.exit(0)).catch(() => {
  console.error("[daily-ai-insights] failed; inspect owner-only durable status; no automatic model retry");
  process.exit(1);
});
