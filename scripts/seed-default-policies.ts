import { createPolicy, evaluatePolicy, listPoliciesForTenant } from "../server/policy-engine";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

// R125+137.27: env-driven owner email (no hardcoded fallback — fail closed).
const OWNER_EMAIL =
  process.env.OWNER_EMAIL ||
  process.env.OWNER_ALERT_EMAIL ||
  process.env.SITE_OWNER_EMAIL ||
  process.env.SITE_CONTACT_EMAIL ||
  "";

(async () => {
  if (!OWNER_EMAIL) {
    console.error(
      "[seed] No owner email configured (OWNER_EMAIL / OWNER_ALERT_EMAIL / SITE_OWNER_EMAIL / SITE_CONTACT_EMAIL). " +
        "Refusing to seed owner-default email policies with an unknown owner identity.",
    );
    process.exit(1);
  }

  await db.execute(sql`DELETE FROM tool_policies WHERE tenant_id = 1 AND created_by = 'owner-default'`);

  const seeds = [
    {
      tenantId: 1,
      scopeKind: "tool_recipient_pattern" as const,
      scopeValue: `send_email|${OWNER_EMAIL}`,
      action: "allow" as const,
      reason: "owner-self",
      createdBy: "owner-default",
    },
    {
      tenantId: 1,
      scopeKind: "tool_recipient_pattern" as const,
      scopeValue: "send_email|*@example.com",
      action: "allow" as const,
      reason: "owner-domain",
      createdBy: "owner-default",
    },
    {
      tenantId: 1,
      scopeKind: "tool_action" as const,
      scopeValue: "google_workspace:read*",
      action: "allow" as const,
      reason: "read-only google",
      createdBy: "owner-default",
    },
    {
      tenantId: 1,
      scopeKind: "tool_action" as const,
      scopeValue: "google_workspace:list*",
      action: "allow" as const,
      reason: "read-only google list",
      createdBy: "owner-default",
    },
    {
      tenantId: 1,
      scopeKind: "tool" as const,
      scopeValue: "web_search",
      action: "allow" as const,
      reason: "research is always safe",
      createdBy: "owner-default",
    },
    {
      tenantId: 1,
      scopeKind: "tool_action" as const,
      scopeValue: "google_drive:list",
      action: "allow" as const,
      reason: "drive list",
      createdBy: "owner-default",
    },
    {
      tenantId: 1,
      scopeKind: "tool_action" as const,
      scopeValue: "google_drive:info",
      action: "allow" as const,
      reason: "drive info",
      createdBy: "owner-default",
    },
  ];

  for (const s of seeds) {
    const { id } = await createPolicy(s);
    console.log(`[seed] policy #${id} ${s.scopeKind}=${s.scopeValue} -> ${s.action}`);
  }

  const all = await listPoliciesForTenant(1);
  console.log(`[seed] tenant 1 now has ${all.length} active policies`);

  const cases = [
    { tenantId: 1, toolName: "send_email", params: { to: OWNER_EMAIL }, expect: "allow" },
    { tenantId: 1, toolName: "send_email", params: { to: "stranger@example.com" }, expect: "require_approval" },
    { tenantId: 1, toolName: "google_workspace", action: "read_message", params: {}, expect: "allow" },
    { tenantId: 1, toolName: "google_workspace", action: "send_message", params: {}, expect: "require_approval" },
    { tenantId: 1, toolName: "web_search", params: { query: "x" }, expect: "allow" },
    { tenantId: 1, toolName: "exec", params: { cmd: "ls" }, expect: "require_approval" },
  ];
  let pass = 0;
  for (const c of cases) {
    const r = await evaluatePolicy(c);
    const ok = r.decision === c.expect;
    console.log(`${ok ? "PASS" : "FAIL"} | ${c.toolName}${c.action ? ":" + c.action : ""} → ${r.decision} (expected ${c.expect}) reason=${r.reason}`);
    if (ok) pass++;
  }
  console.log(`\n[seed] ${pass}/${cases.length} smoke tests passed`);
  process.exit(pass === cases.length ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
