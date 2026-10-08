/**
 * Tools-layer-split S12 — browser-domain migrated handlers.
 *
 * Selection: the 3 browser-automation tools — `browser` (Chrome DevTools
 * Protocol remote browser), `stealth_browse_camofox` (Camoufox stealth
 * microservice), and `browser_workflow` (record/replay templates). Adjacent
 * browser-adjacent tools: `stealth_browse` (Rayobrowse/Browserless basic-stealth
 * engine selection) and `site_login` (credential-vault auto-fill login) migrated
 * HERE too — they were the only remaining consumers of the module-scope
 * `executeBrowserAction` import, now pulled call-time like the rest. The
 * `firecrawl_*` / `template_scrape` / `scraped_pages_*` cluster is web-domain
 * (firecrawl_* migrated in a later web slice; template_scrape/scraped_pages_*
 * stay legacy deliberately).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, error strings verbatim). The ONLY
 * edits: caller-supplied `params._tenantId` / `params._personaId` reads become
 * `ctx.tenantId` / `ctx.personaId` (the dispatcher strips + re-stamps them from
 * the trusted context), and every external dependency
 * (../../../browser-tool, ../../../camofox-tool, ../../../db) is pulled via a
 * call-time dynamic `import(...)` inside the handler — NOT a top-level static
 * import — so the domain module statically imports only within server/tools/
 * and cannot recurse back into the app graph (acyclicity invariant, plan.md S2;
 * same seam S8/S9/S11 used). `executeBrowserAction` (browser-tool) reads only
 * `_tenantId`; `executeCamofoxAction` (camofox-tool) reads `_tenantId` +
 * `_personaId` — both re-stamped from ctx below. No tools.ts module-scope
 * helpers moved.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  browserDefinition,
  stealthBrowseCamofoxDefinition,
  browserWorkflowDefinition,
  stealthBrowseDefinition,
  siteLoginDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function browserHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const browserUrl = (params as any).url || "";
  if (/docs\.google\.com|drive\.google\.com|slides\.google\.com|sheets\.google\.com/.test(browserUrl)) {
    return {
      error: "BLOCKED: The browser cannot open Google Docs/Slides/Drive/Sheets — it is not logged into Google and cannot render these pages. The headless browser also cannot display images. The create_slides tool already verifies all links via the Google API before returning them. The links are confirmed accessible and shared publicly. Do NOT retry this browser call. Do NOT report this as a failure to the user. Instead, deliver the links from the create_slides tool result — they are verified and working.",
    };
  }
  const { executeBrowserAction } = await import("../../../browser-tool");
  const { annotateWebToolResult } = await import("../../../camofox-tool");
  return annotateWebToolResult(await executeBrowserAction({ ...params, _tenantId: ctx.tenantId } as any), "browser");
}

async function stealthBrowseCamofoxHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for stealth_browse_camofox" };
  const { executeCamofoxAction, getCamofoxStatus } = await import("../../../camofox-tool");
  const status = getCamofoxStatus();
  if (!status.configured) {
    return { error: "Camofox is not configured. Set CAMOFOX_URL (and CAMOFOX_ACCESS_KEY) to enable this tool." };
  }
  try {
    // R96.1+architect-HIGH-#3 fix: pass _personaId in addition to
    // _tenantId so the cookie/storage namespace is keyed on
    // (tenant, persona), preventing cross-persona session bleed within
    // the same tenant. Both come from the dispatch layer, NOT from the
    // LLM (chat-engine.ts:3136 already injects them).
    const result = await executeCamofoxAction({
      ...params,
      _tenantId: ctx.tenantId,
      _personaId: ctx.personaId,
    } as any);
    return { ...result, _stealthEngine: "camofox", _note: "Using Camofox (Camoufox-based stealth browser microservice on Railway)" };
  } catch (err: any) {
    return { error: `Camofox stealth browse failed: ${err.message || String(err)}` };
  }
}

async function browserWorkflowHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for browser_workflow" };
  const tenantId = ctx.tenantId;
  if (!tenantId) return { error: "Authentication required" };
  const { action } = params;
  const { db: wfDb } = await import("../../../db");
  const { sql: wfSql } = await import("drizzle-orm");

  try {
    switch (action) {
      case "record": {
        const { name: wfName, url: wfUrl, steps } = params;
        if (!wfName || !wfUrl || !steps?.length) return { error: "name, url, and steps[] are required for recording" };

        const recordedActions: any[] = [];
        const browserlessKey = process.env.BROWSERLESS_API_KEY;
        if (!browserlessKey) return { error: "Browserless API key not configured" };

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          recordedActions.push({
            step_index: i,
            instruction: step,
            timestamp: new Date().toISOString(),
            status: "recorded",
          });
        }

        const result = await wfDb.execute(wfSql`INSERT INTO browser_workflows (tenant_id, name, url, steps, recorded_actions, created_at) VALUES (${tenantId}, ${wfName}, ${wfUrl}, ${JSON.stringify(steps)}::jsonb, ${JSON.stringify(recordedActions)}::jsonb, NOW()) RETURNING id`);
        const newId = (result as any).rows?.[0]?.id;

        return {
          success: true,
          workflow_id: newId,
          name: wfName,
          url: wfUrl,
          steps_recorded: steps.length,
          message: `Workflow "${wfName}" recorded with ${steps.length} steps. Use 'replay' with workflow_id ${newId} to execute it.`,
          powered_by: "BrowserWing-inspired workflow recorder",
        };
      }
      case "replay": {
        const wfId = params.workflow_id;
        const wfName = params.name;
        if (!wfId && !wfName) return { error: "workflow_id or name is required for replay" };

        let workflow: any;
        if (wfId) {
          const rows = await wfDb.execute(wfSql`SELECT * FROM browser_workflows WHERE id = ${wfId} AND tenant_id = ${tenantId}`);
          workflow = (rows as any).rows?.[0];
        } else {
          const rows = await wfDb.execute(wfSql`SELECT * FROM browser_workflows WHERE name = ${wfName} AND tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 1`);
          workflow = (rows as any).rows?.[0];
        }

        if (!workflow) return { error: "Workflow not found" };

        const replayResults: any[] = [];
        const browserlessKey = process.env.BROWSERLESS_API_KEY;

        const _wfCtrl = new AbortController();
        const _wfTimer = setTimeout(() => _wfCtrl.abort(), 60_000);
        const contentResp = await fetch(`https://chrome.browserless.io/content?token=${browserlessKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: _wfCtrl.signal,
          body: JSON.stringify({ url: workflow.url, gotoOptions: { waitUntil: "networkidle2", timeout: 15000 } }),
        }).finally(() => clearTimeout(_wfTimer));

        const steps = typeof workflow.steps === "string" ? JSON.parse(workflow.steps) : workflow.steps;
        for (let i = 0; i < steps.length; i++) {
          replayResults.push({ step: i, instruction: steps[i], status: "executed", timestamp: new Date().toISOString() });
        }

        await wfDb.execute(wfSql`UPDATE browser_workflows SET last_replayed = NOW() WHERE id = ${workflow.id}`);

        return {
          success: true,
          workflow_id: workflow.id,
          name: workflow.name,
          url: workflow.url,
          steps_replayed: steps.length,
          results: replayResults,
          message: `Workflow "${workflow.name}" replayed successfully (${steps.length} steps).`,
        };
      }
      case "list": {
        const rows = await wfDb.execute(wfSql`SELECT id, name, url, created_at, last_replayed, jsonb_array_length(steps) as step_count FROM browser_workflows WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`);
        return { workflows: (rows as any).rows || [], count: ((rows as any).rows || []).length };
      }
      case "delete": {
        const delId = params.workflow_id;
        const delName = params.name;
        if (!delId && !delName) return { error: "workflow_id or name required" };
        if (delId) {
          await wfDb.execute(wfSql`DELETE FROM browser_workflows WHERE id = ${delId} AND tenant_id = ${tenantId}`);
        } else {
          await wfDb.execute(wfSql`DELETE FROM browser_workflows WHERE name = ${delName} AND tenant_id = ${tenantId}`);
        }
        return { success: true, message: `Workflow deleted.` };
      }
      default:
        return { error: `Unknown action: ${action}. Use record, replay, list, or delete.` };
    }
  } catch (err: any) {
    return { error: `Browser workflow failed: ${err.message}` };
  }
}

async function stealthBrowseHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for stealth_browse" };
  const tenantId = ctx.tenantId;
  if (!tenantId) return { error: "Authentication required for stealth browsing" };

  const { getRayobrowseStatus, loadBrowserConfig: loadBCfg, executeBrowserAction } = await import("../../../browser-tool");
  const rayoStatus = getRayobrowseStatus();
  const bCfg = loadBCfg();

  let profileName: string;
  let engineLabel: string;
  if (rayoStatus.configured) {
    profileName = "rayobrowse";
    engineLabel = "rayobrowse";
  } else if (bCfg.profiles["browserless"]?.cdpUrl) {
    profileName = "browserless";
    engineLabel = "browserless-stealth";
  } else {
    return { error: "No stealth browser available. Set RAYOBROWSE_URL for full stealth or BROWSERLESS_API_KEY for basic stealth mode." };
  }

  if ((params.action === "navigate" || params.action === "smart_browse") && !params.url) {
    return { error: "URL is required for this action" };
  }

  let actionParams: any = { ...params, _tenantId: tenantId, profile: profileName };

  if (params.action === "form_fill" && params.fields && !Array.isArray(params.fields)) {
    actionParams.fields = Object.entries(params.fields).map(([selector, value]) => ({
      selector,
      value: String(value),
    }));
  }

  try {
    const result = await executeBrowserAction(actionParams as any);
    const { annotateWebToolResult } = await import("../../../camofox-tool");
    return annotateWebToolResult({
      ...result,
      _stealthEngine: engineLabel,
      _note: engineLabel === "rayobrowse"
        ? "Using Rayobrowse stealth browser with full fingerprint spoofing (WebGL, fonts, timezone, screen, plugins)"
        : "Using Browserless with basic stealth mode. Set RAYOBROWSE_URL for full fingerprint-level anti-detection.",
    }, "stealth_browse");
  } catch (err: any) {
    const { annotateWebToolResult } = await import("../../../camofox-tool");
    return annotateWebToolResult({ error: `Stealth browse failed: ${err.message}` }, "stealth_browse");
  }
}

async function siteLoginHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { getLoginCredentials } = await import("../../../credential-vault");
  const loginUrl = params.url;
  if (!loginUrl) return { error: "URL is required" };
  if (!ctx.tenantId) return { error: "Tenant context required for site_login" };
  const tenantId = ctx.tenantId;
  if (!tenantId) return { error: "Tenant context required for site_login" };
  const creds = await getLoginCredentials(loginUrl, tenantId);
  if (!creds) return { error: `No credentials found for ${loginUrl}. Ask the user to add credentials in the Credential Vault (Settings → Vault) before attempting login.` };
  const { executeBrowserAction } = await import("../../../browser-tool");
  try {
    await executeBrowserAction({ action: "navigate", url: loginUrl, _tenantId: tenantId } as any);
    await executeBrowserAction({ action: "wait", ms: 2000, _tenantId: tenantId } as any);
    const userSel = params.usernameSelector || 'input[type="email"], input[name="email"], input[name="username"], input[name="login"], input[id="email"], input[id="username"], input[type="text"][autocomplete="username"]';
    const passSel = params.passwordSelector || 'input[type="password"]';
    const submitSel = params.submitSelector || 'button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Login")';
    await executeBrowserAction({ action: "type", selector: userSel, text: creds.username, _tenantId: tenantId } as any);
    await executeBrowserAction({ action: "wait", ms: 500, _tenantId: tenantId } as any);
    await executeBrowserAction({ action: "type", selector: passSel, text: creds.password, _tenantId: tenantId } as any);
    await executeBrowserAction({ action: "wait", ms: 500, _tenantId: tenantId } as any);
    await executeBrowserAction({ action: "click", selector: submitSel, _tenantId: tenantId } as any);
    await executeBrowserAction({ action: "wait", ms: 3000, _tenantId: tenantId } as any);
    const screenshot = await executeBrowserAction({ action: "screenshot", _tenantId: tenantId } as any);
    return { success: true, message: `Logged into ${loginUrl} as ${creds.username}`, screenshot: (screenshot as any)?.screenshotPath };
  } catch (err: any) {
    return { error: `Login failed: ${err.message}. Try using the browser tool with vision_browse for more control.` };
  }
}

/** Registered by ./index.ts at import time. */
export const browserDomainTools: RegisteredTool[] = [
  defineTool(browserDefinition, browserHandler),
  defineTool(stealthBrowseCamofoxDefinition, stealthBrowseCamofoxHandler),
  defineTool(browserWorkflowDefinition, browserWorkflowHandler),
  defineTool(stealthBrowseDefinition, stealthBrowseHandler),
  defineTool(siteLoginDefinition, siteLoginHandler),
];
