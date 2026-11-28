import { Client } from "pg";
import { checkSparkRelaySchema, migrateSparkRelaySchema } from "../server/legion/spark-relay-schema";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--check", "--apply-development"].includes(args[0]))
    throw Error("Use exactly --check or --apply-development");
  const apply = args[0] === "--apply-development";
  if (apply && (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT))
    throw Error("Constraint apply is permitted only in the development workspace");
  if (!process.env.DATABASE_URL) throw Error("Explicit database configuration required");
  const client = new Client({ connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 20_000 });
  try {
    await client.connect();
    const result = apply ? await migrateSparkRelaySchema(client) : await checkSparkRelaySchema(client);
    console.log(JSON.stringify({ operation: apply ? "apply-development" : "check", ...result }));
    if (!result.ready) process.exitCode = 1;
  } finally { await client.end(); }
}
main().catch(error => {
  const code = typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : "unavailable";
  console.error(`Relay constraint operation failed (${code}); no production apply is supported`);
  process.exitCode = 1;
});
