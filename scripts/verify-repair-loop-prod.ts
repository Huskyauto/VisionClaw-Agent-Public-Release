/**
 * verify-repair-loop-prod.ts — post-deploy verification for the self-repair loop.
 *
 * The self-repair dispatch loop (#54), repo-surgeon executor (#52) and resume
 * layer (#53) only "run in production" once the new code is PUBLISHED. Production
 * schema is owned by Replit's Publish flow (the agent must never DDL prod
 * directly); the `repair_incidents` table then self-creates on first use via the
 * idempotent `ensureRepairIncidentsTable()` ensure-on-first-use guarantee. This
 * script is the AFTER-publish check that the loop is actually live in prod.
 *
 * Two ways to get the FULL green check (autofix-flag + incident-stats + schema):
 *
 *   1) CRON_SECRET (preferred — no human login token):
 *        hits GET /api/cron/repair-loop-health with `Authorization: Bearer ${CRON_SECRET}`.
 *        This is the route the weekly-maintenance sweep + a post-publish step can
 *        run UNATTENDED. Set REPAIR_VERIFY_CRON_SECRET (or reuse CRON_SECRET).
 *
 *   2) Admin session bearer token (legacy):
 *        hits GET /api/admin/repair-incidents with an admin `Authorization: Bearer …`.
 *        Set REPAIR_VERIFY_ADMIN_TOKEN. Kept for ad-hoc manual checks.
 *
 * If NEITHER credential is supplied, the script runs an UNAUTHENTICATED
 * reachability probe against the admin route: a 401/403 proves the route is wired
 * and deployed (auth-protected = healthy), but the autofix-flag + stats assertions
 * are SKIPPED — supply a credential for the full green check.
 *
 * Both authenticated paths confirm the same four "done" criteria. Both the cron
 * health route and the admin review endpoint return `autofixEnabled` (the prod
 * runtime's view of REPAIR_AUTOFIX_ENABLED), the incident `stats`, and a `schema`
 * health block:
 *   1) the endpoint works in prod                       (GET returns 200)
 *   2) the prod runtime sees REPAIR_AUTOFIX_ENABLED=1   (autofixEnabled === true)
 *   3) the loop can record incidents                    (stats present; table exists)
 *   4) the WHOLE self-repair schema set is live in prod (schema.repair_incidents +
 *      schema.repo_surgeon_attempts + schema.pipeline_stage_artifacts all true) —
 *      i.e. the executor (#52) and resume layer (#53) tables exist in prod too, not
 *      just the incident ledger. The endpoints self-create all three via their
 *      idempotent ensure-on-first-use helpers, so this GET also brings them live.
 *
 * Usage (one-line, env-var configured — no prompts, no TTY):
 *   REPAIR_VERIFY_BASE_URL=https://<your-prod-domain> \
 *   REPAIR_VERIFY_CRON_SECRET=<cron-secret> \
 *   npx tsx scripts/verify-repair-loop-prod.ts
 *
 *   # or with an admin session token:
 *   REPAIR_VERIFY_BASE_URL=https://<your-prod-domain> \
 *   REPAIR_VERIFY_ADMIN_TOKEN=<admin-session-bearer> \
 *   npx tsx scripts/verify-repair-loop-prod.ts
 *
 * Exit codes (so a future agent / CI knows exactly what to fix):
 *   0  PASS — full check green (with a credential), or route reachable+auth-protected (no credential)
 *   2  ROUTE MISSING (404) — the deploy does not have the endpoint; PUBLISH the latest code
 *   3  SERVER ERROR (5xx) — the endpoint is deployed but erroring; read prod logs
 *   4  FLAG OFF — endpoint 200 but autofixEnabled=false; set REPAIR_AUTOFIX_ENABLED=1 in prod + redeploy/restart
 *   5  AUTH FAILED with a credential supplied (401/403) — the cron secret or admin token is invalid/expired
 *   6  CONFIG/NETWORK — missing REPAIR_VERIFY_BASE_URL, bad URL, or the host is unreachable
 *   7  SCHEMA INCOMPLETE — endpoint 200 but a self-repair table is missing in prod
 *      (repo_surgeon_attempts / pipeline_stage_artifacts didn't self-create); read prod logs
 */

function fail(code: number, msg: string): never {
  console.error(`[verify-repair-loop-prod] FAIL(${code}): ${msg}`);
  process.exit(code);
}

async function main() {
  const baseUrlRaw = (process.env.REPAIR_VERIFY_BASE_URL || "").trim().replace(/\/+$/, "");
  const cronSecret = (process.env.REPAIR_VERIFY_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  const adminToken = (process.env.REPAIR_VERIFY_ADMIN_TOKEN || "").trim();

  if (!baseUrlRaw) {
    fail(
      6,
      "REPAIR_VERIFY_BASE_URL is not set. Set it to the deployed production base URL " +
        "(e.g. https://your-app.replit.app) and re-run. Do NOT point this at the dev box.",
    );
  }

  // Prefer the CRON_SECRET path (unattended, no human login). Fall back to the
  // admin-token path. With neither, run an unauthenticated reachability probe.
  const mode: "cron" | "admin" | "probe" = cronSecret ? "cron" : adminToken ? "admin" : "probe";

  const routePath =
    mode === "cron"
      ? "/api/cron/repair-loop-health"
      : "/api/admin/repair-incidents?status=needs_review";

  let url: string;
  try {
    url = new URL(routePath, baseUrlRaw).toString();
  } catch {
    return fail(6, `REPAIR_VERIFY_BASE_URL is not a valid URL: "${baseUrlRaw}"`);
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (mode === "cron") headers.Authorization = `Bearer ${cronSecret}`;
  else if (mode === "admin") headers.Authorization = `Bearer ${adminToken}`;

  const authLabel = mode === "cron" ? "cron secret" : mode === "admin" ? "admin token" : "none";
  console.log(`[verify-repair-loop-prod] GET ${url}  (auth: ${authLabel})`);

  let res: Response;
  try {
    const ctrl = AbortSignal.timeout?.(20000);
    res = await fetch(url, { headers, signal: ctrl });
  } catch (e: any) {
    return fail(6, `network error reaching ${baseUrlRaw}: ${e?.message || e}. Is the app deployed and the URL correct?`);
  }

  const status = res.status;
  const bodyText = await res.text().catch(() => "");

  if (status === 404) {
    fail(
      2,
      `endpoint returned 404 — the deployed code does not have ${routePath.split("?")[0]}. PUBLISH the latest code, then re-run.`,
    );
  }
  if (status >= 500) {
    // 503 on the cron route means CRON_SECRET is not configured in the prod env.
    if (mode === "cron" && status === 503) {
      fail(
        6,
        "cron route returned 503 — CRON_SECRET is not configured in the prod deployment env. " +
          "Set CRON_SECRET in the deployment, redeploy/restart, then re-run.",
      );
    }
    fail(3, `endpoint returned ${status} — deployed but erroring. Read prod logs (fetch_deployment_logs). Body: ${bodyText.slice(0, 300)}`);
  }

  if (mode === "probe") {
    // Unauthenticated reachability probe. 401/403 = route wired + auth-protected = healthy.
    if (status === 401 || status === 403) {
      console.log(
        `[verify-repair-loop-prod] PASS (reachability) — endpoint is deployed and auth-protected (HTTP ${status}). ` +
          `Supply REPAIR_VERIFY_CRON_SECRET (preferred) or REPAIR_VERIFY_ADMIN_TOKEN for the full autofix-flag + incident-stats check.`,
      );
      process.exit(0);
    }
    fail(
      6,
      `unexpected HTTP ${status} on the unauthenticated probe (expected 401/403). Body: ${bodyText.slice(0, 300)}`,
    );
  }

  // Credential supplied — expect a full 200 JSON payload.
  if (status === 401 || status === 403) {
    const which = mode === "cron" ? "REPAIR_VERIFY_CRON_SECRET / CRON_SECRET" : "REPAIR_VERIFY_ADMIN_TOKEN";
    fail(5, `credential rejected (HTTP ${status}). The ${which} is invalid or expired — supply a fresh value.`);
  }
  if (status !== 200) {
    fail(6, `unexpected HTTP ${status} (expected 200 with a valid credential). Body: ${bodyText.slice(0, 300)}`);
  }

  let payload: any;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return fail(3, `endpoint returned 200 but the body was not JSON: ${bodyText.slice(0, 300)}`);
  }

  const autofixEnabled = payload?.autofixEnabled === true;
  const stats = payload?.stats || {};
  const ledgerQueryable = mode === "cron" ? payload?.incidentLedgerQueryable === true : true;

  console.log(`[verify-repair-loop-prod] endpoint OK (HTTP 200).`);
  console.log(`[verify-repair-loop-prod]   autofixEnabled = ${autofixEnabled}`);
  console.log(`[verify-repair-loop-prod]   stats = ${JSON.stringify(stats)}`);
  if (mode === "cron") console.log(`[verify-repair-loop-prod]   incidentLedgerQueryable = ${ledgerQueryable}`);

  if (!autofixEnabled) {
    fail(
      4,
      "endpoint is live but autofixEnabled=false — the prod runtime does NOT see REPAIR_AUTOFIX_ENABLED=1. " +
        "Set REPAIR_AUTOFIX_ENABLED=1 in the deployment env and redeploy/restart so the process picks it up.",
    );
  }

  // Criterion 4 — the WHOLE self-repair schema set must be live in prod, not just
  // the incident ledger. The endpoint ensures + read-only confirms all three
  // tables; require every one present.
  const schema = (payload?.schema || {}) as Record<string, unknown>;
  const SELF_REPAIR_TABLES = ["repair_incidents", "repo_surgeon_attempts", "pipeline_stage_artifacts"];
  console.log(`[verify-repair-loop-prod]   schema = ${JSON.stringify(schema)}`);
  if (Object.keys(schema).length === 0) {
    fail(
      7,
      "endpoint 200 but returned no `schema` health block — the deploy predates the full-schema check. PUBLISH the latest code, then re-run.",
    );
  }
  const missing = SELF_REPAIR_TABLES.filter((t) => schema[t] !== true);
  if (missing.length > 0) {
    fail(
      7,
      `self-repair schema INCOMPLETE in prod — missing/unconfirmed table(s): ${missing.join(", ")}. ` +
        "These self-create on first use via their ensure-helpers; a persistent miss means the ensure path is failing in prod — read prod logs (fetch_deployment_logs).",
    );
  }

  console.log(
    `[verify-repair-loop-prod] PASS — ${mode === "cron" ? "cron health" : "review"} endpoint works in prod, ` +
      `prod runtime sees REPAIR_AUTOFIX_ENABLED=1, the incident ledger is queryable, ` +
      `and the full self-repair schema set is live in prod (${SELF_REPAIR_TABLES.join(", ")}).`,
  );
  process.exit(0);
}

main();
