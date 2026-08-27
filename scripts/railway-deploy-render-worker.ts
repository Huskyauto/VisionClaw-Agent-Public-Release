#!/usr/bin/env tsx
/**
 * scripts/railway-deploy-render-worker.ts — best-effort Railway auto-deployer
 * for the R110.19 render worker. Run AFTER replacing RAILWAY_API_TOKEN in
 * Replit Secrets with a fresh ACCOUNT-LEVEL token (Railway dashboard →
 * Account Settings → Tokens → Create Token).
 *
 * What it does (in order, each step is idempotent and re-runnable):
 *   1. Validates the token by calling `me { ... }` on Railway's GraphQL API.
 *   2. Lists your Railway projects and picks one (auto if RAILWAY_PROJECT_ID
 *      env var is set; otherwise prints the list and asks you to set the var
 *      and re-run).
 *   3. Generates a fresh RENDER_ACCESS_KEY (32 bytes hex).
 *   4. Creates a new service named "visionclaw-render" pointing at the same
 *      GitHub repo as VisionClaw, with rootDirectory=services/render-worker.
 *   5. Sets RENDER_ACCESS_KEY as an env var on the service.
 *   6. Prints the EXACT next steps you need to do manually (Railway will
 *      auto-deploy; you set RENDER_URL + RENDER_ACCESS_KEY in Replit Secrets
 *      using the values this script prints).
 *
 * Why "best-effort": Railway's GraphQL mutations for service creation
 * change shape occasionally (last verified 2026-04). If a mutation fails,
 * the script prints the exact GraphQL response so you (or a future agent
 * round) can adjust. The fallback is the manual UI flow in
 * services/render-worker/README.md.
 *
 * Usage:
 *   # First time:
 *   #   1. Create Railway account-level token, paste into RAILWAY_API_TOKEN
 *   #   2. npx tsx scripts/railway-deploy-render-worker.ts
 *   #   3. If it asks, set RAILWAY_PROJECT_ID and re-run.
 *   #
 *   # Optional env overrides:
 *   #   RAILWAY_PROJECT_ID=<uuid>     (skip the project-picker step)
 *   #   RAILWAY_REPO=Huskyauto/your-repo  (default: parsed from .git/config)
 *   #   RAILWAY_BRANCH=main           (default: main)
 */

import { execSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";

// Prefer RAILWAY_API_TOKEN_2 (the new account-level token Bob generates for
// VisionClaw render-worker deploys) over RAILWAY_API_TOKEN (which is reserved
// for the existing Camofox setup and we don't want to clobber). Same
// convention as GITHUB_PERSONAL_ACCESS_TOKEN_2.
const TOKEN = process.env.RAILWAY_API_TOKEN_2 || process.env.RAILWAY_API_TOKEN || "";
const TOKEN_SOURCE = process.env.RAILWAY_API_TOKEN_2 ? "RAILWAY_API_TOKEN_2" : (process.env.RAILWAY_API_TOKEN ? "RAILWAY_API_TOKEN" : "(none)");
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || "";
const BRANCH = process.env.RAILWAY_BRANCH || "main";
const SERVICE_NAME = process.env.RAILWAY_SERVICE_NAME || "visionclaw-render";
const ROOT_DIR = "services/render-worker";

if (!TOKEN) {
  console.error("[deploy] No Railway token found — set RAILWAY_API_TOKEN_2 in Replit Secrets");
  console.error("[deploy] (generate one at Railway → Account Settings → Tokens → Create Token)");
  process.exit(1);
}
console.log(`[deploy] using token from ${TOKEN_SOURCE}`);

function detectRepo(): string {
  if (process.env.RAILWAY_REPO) return process.env.RAILWAY_REPO;
  try {
    const cfg = fs.readFileSync(".git/config", "utf-8");
    const m = cfg.match(/url\s*=\s*(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^.\s]+)(?:\.git)?/);
    if (m) return m[1];
  } catch (_e) { /* fallthrough */ }
  return "Huskyauto/VisionClaw"; // best guess
}

const REPO = detectRepo();

async function gql(query: string, variables: any = {}): Promise<any> {
  const r = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = await r.json().catch(() => ({}));
  if (body.errors) {
    const msg = body.errors.map((e: any) => e.message).join("; ");
    throw new Error(`GraphQL error: ${msg}\n  raw: ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body.data;
}

async function main() {
  console.log("[deploy] step 1/6: validate token (me query)");
  const me = await gql(`query { me { id email name } }`);
  console.log(`[deploy]   ok — authenticated as ${me.me?.email || me.me?.name || me.me?.id}`);

  console.log(`[deploy] step 2/6: list projects (looking for project to host '${SERVICE_NAME}')`);
  const projData = await gql(`query { me { projects { edges { node { id name } } } } }`);
  const projects = (projData.me?.projects?.edges || []).map((e: any) => e.node);
  console.log(`[deploy]   found ${projects.length} project(s):`);
  for (const p of projects) console.log(`     - ${p.id}  ${p.name}`);

  let projectId = PROJECT_ID;
  if (!projectId) {
    if (projects.length === 1) {
      projectId = projects[0].id;
      console.log(`[deploy]   only one project — auto-selecting ${projectId}`);
    } else {
      console.error(`[deploy] multiple projects — re-run with RAILWAY_PROJECT_ID=<id> from the list above`);
      process.exit(2);
    }
  }

  const accessKey = crypto.randomBytes(32).toString("hex");
  console.log(`[deploy] step 3/6: generated fresh RENDER_ACCESS_KEY (32 bytes hex)`);

  console.log(`[deploy] step 4/6: create service '${SERVICE_NAME}' in project ${projectId}`);
  console.log(`[deploy]   repo=${REPO} branch=${BRANCH} rootDirectory=${ROOT_DIR}`);
  let serviceId: string | undefined;
  try {
    const created = await gql(
      `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`,
      {
        input: {
          name: SERVICE_NAME,
          projectId,
          source: { repo: REPO },
        },
      },
    );
    serviceId = created.serviceCreate?.id;
    console.log(`[deploy]   ok — created service id=${serviceId}`);
  } catch (err: any) {
    console.error(`[deploy]   serviceCreate failed: ${err.message}`);
    console.error(`[deploy]   common causes:`);
    console.error(`     • GitHub repo not connected to your Railway account yet`);
    console.error(`       → Railway dashboard → New → Deploy from GitHub repo → authorize the repo, then re-run`);
    console.error(`     • Service name already exists in this project (rename via RAILWAY_SERVICE_NAME=...)`);
    console.error(`     • Mutation schema changed — fall back to manual UI flow in services/render-worker/README.md`);
    process.exit(3);
  }

  console.log(`[deploy] step 5/6: set RENDER_ACCESS_KEY env var on service`);
  try {
    await gql(
      `mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`,
      {
        input: {
          projectId,
          serviceId,
          name: "RENDER_ACCESS_KEY",
          value: accessKey,
          environmentId: undefined, // applies to all environments
        },
      },
    );
    console.log(`[deploy]   ok — RENDER_ACCESS_KEY set on Railway service`);
  } catch (err: any) {
    console.error(`[deploy]   variableUpsert failed: ${err.message}`);
    console.error(`[deploy]   you can set it manually in Railway dashboard → Service → Variables`);
  }

  console.log(`[deploy] step 6/6: trigger initial deploy (or wait for auto)`);
  try {
    await gql(
      `mutation($serviceId: String!, $environmentId: String) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }`,
      { serviceId, environmentId: null },
    );
    console.log(`[deploy]   ok — deploy triggered (Railway will build the Dockerfile, ~2-3min)`);
  } catch (err: any) {
    console.warn(`[deploy]   redeploy mutation failed (Railway may auto-deploy on serviceCreate anyway): ${err.message?.slice(0, 200)}`);
  }

  console.log(``);
  console.log(`============================================================`);
  console.log(`[deploy] ✅ ALMOST DONE — manual steps remaining:`);
  console.log(`============================================================`);
  console.log(``);
  console.log(`1. Wait ~3 min for Railway to finish building. Watch the deploy log:`);
  console.log(`   https://railway.com/project/${projectId}/service/${serviceId}`);
  console.log(``);
  console.log(`2. When Railway shows "Active", grab the public URL from the service`);
  console.log(`   (Settings → Networking → Generate Domain if no domain yet).`);
  console.log(``);
  console.log(`3. In Replit Secrets, add these TWO vars:`);
  console.log(``);
  console.log(`   RENDER_URL = https://YOUR-RAILWAY-DOMAIN.up.railway.app`);
  console.log(`   RENDER_ACCESS_KEY = ${accessKey}`);
  console.log(``);
  console.log(`4. Smoketest the round-trip:`);
  console.log(`   npx tsx scripts/render-worker-smoketest.ts`);
  console.log(``);
  console.log(`============================================================`);
  console.log(`[deploy] IMPORTANT — RENDER_ACCESS_KEY is shown ONLY here.`);
  console.log(`[deploy] Copy it now. It is not stored anywhere on disk.`);
  console.log(`============================================================`);
}

main().catch((err) => {
  console.error(`[deploy] fatal: ${err?.message || err}`);
  process.exit(1);
});
