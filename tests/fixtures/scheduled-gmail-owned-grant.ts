import assert from "node:assert/strict";

// Isolated child only: no live network, database writes, or customer emails.
process.env.ADMIN_TENANT_ID = "1";
process.env.GOOGLE_OAUTH_CLIENT_ID = "offline-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "offline-client-secret";
process.env.REPLIT_CONNECTORS_HOSTNAME = "forbidden-platform.invalid";
process.env.REPL_IDENTITY = "offline-test-identity";
let refreshes = 0, sends = 0, networkViolations = 0;
let subscription: any;
let encode: (value: string) => string;
let scheduledContent = "";
globalThis.fetch = async (url, init) => {
  const address = String(url);
  if (address === "https://oauth2.googleapis.com/token") {
    assert.equal(new URLSearchParams(String(init?.body)).get("refresh_token") === "customer-owned-refresh", true);
    refreshes++;
    subscription.access_token = encode("customer-owned-access");
    subscription.expires_at = Date.now() + 3_600_000;
    return new Response(JSON.stringify({ access_token: "customer-owned-access", expires_in: 3600 }), { status: 200 });
  }
  if (address.endsWith("/gmail/v1/users/me/messages/send")) {
    assert.equal(new Headers(init?.headers).get("Authorization") === "Bearer customer-owned-access", true);
    assert.equal(JSON.parse(scheduledContent).lastDelivery.outcome, "pending");
    sends++;
    return new Response(JSON.stringify({ id: "offline-gmail-receipt" }), { status: 200 });
  }
  networkViolations++;
  throw new Error("Unexpected external request blocked");
};

const { db, pool } = await import("../../server/db");
const { encryptApiKey } = await import("../../server/crypto");
const { PgDialect } = await import("drizzle-orm/pg-core");
encode = encryptApiKey;
subscription = {
  access_token: encode("old-customer-access"),
  refresh_token: encode("customer-owned-refresh"),
  expires_at: 0, consecutive_failures: 0, is_active: true,
};
const initial = JSON.stringify({
  cron: "0 7 * * 1", prompt: "Offline scheduled mail check", status: "active",
  target: { channel: "email", email: "customer@example.test" },
  nextRunAt: new Date(Date.now() - 1000).toISOString(),
});
scheduledContent = initial;
const dialect = new PgDialect();
let failReceiptWrite = false;
(db as any).execute = async (query: any) => {
  const { sql, params } = dialect.sqlToQuery(query);
  if (sql.includes("oauth_subscriptions")) return { rows: [subscription] };
  if (sql.includes("SELECT id, title, content, tenant_id")) {
    // Both scans intentionally receive the SAME stale due occurrence.
    return { rows: [{ id: 99, title: "Offline check", content: initial, tenant_id: 7 }] };
  }
  if (sql.includes("UPDATE agent_knowledge")) {
    assert.equal(sql.includes("tenant_id ="), true);
    assert.equal(sql.includes("AND content ="), true);
    assert.equal(params[1], 99);
    assert.equal(params[2], 7);
    if (params[3] !== scheduledContent) return { rows: [] };
    const next = JSON.parse(String(params[0]));
    if (failReceiptWrite && next.lastDelivery.outcome === "accepted") throw new Error("Offline receipt write failure");
    scheduledContent = String(params[0]);
    return { rows: [{ id: 99 }] };
  }
  throw new Error("Unexpected database operation blocked");
};

try {
  const { connectGoogleViaReplit } = await import("../../server/oauth-subscriptions");
  assert.equal((await connectGoogleViaReplit(7)).success, false);
  const { getEmailChannelStatus } = await import("../../server/lib/email-channel-delivery");
  assert.equal((await getEmailChannelStatus(7)).configured, true);
  const { runDueScheduledMessages } = await import("../../server/recurring-messages");
  const first = await runDueScheduledMessages();
  assert.deepEqual(first, { fired: 1, errors: 0 });
  assert.equal(JSON.parse(scheduledContent).lastDelivery.messageId, "offline-gmail-receipt");
  assert.equal(JSON.parse(scheduledContent).lastDelivery.outcome, "accepted");
  await runDueScheduledMessages();
  assert.equal(sends, 1);

  scheduledContent = initial;
  failReceiptWrite = true;
  const failedPersistence = await runDueScheduledMessages();
  assert.equal(failedPersistence.errors, 1);
  assert.equal(JSON.parse(scheduledContent).lastDelivery.outcome, "pending");
  await runDueScheduledMessages();
  assert.equal(sends, 2);
  assert.equal(refreshes, 1);
  assert.equal(networkViolations, 0);
  console.log("OWNED_GRANT_AND_SCHEDULE_PASS");
} finally {
  await pool.end();
}