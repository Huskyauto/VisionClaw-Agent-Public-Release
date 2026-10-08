import { Router, type Express, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { personas } from "@shared/schema";
import { eq } from "drizzle-orm";
import { executeCamofoxAction, isCamofoxConfigured, type CamofoxResult } from "../camofox-tool";
import { checkTenantRateLimitExport } from "../browser-tool";
import { browserWorkspace } from "../lib/browser-workspace-store";
import { WorkspaceError, pageElements, snapshotDigest, targetKey, type WorkspaceState, type WorkspaceTarget } from "../lib/browser-workspace";
import { workspaceTabs, verifyWorkspaceHandback } from "../lib/browser-workspace-remote";
import { registerWorkbenchLibraryRoutes } from "./browser-workbench-library";

type Helpers = {
  authMiddleware: any;
  getTenantFromRequestAsync(req: Request): Promise<number | null>;
};
const identity = z.object({
  personaId: z.coerce.number().int().positive(),
  userIdSuffix: z.string().regex(/^[a-z0-9_-]{1,32}$/).optional(),
});
const targetSchema = identity.extend({ tabId: z.string().min(1).max(160).regex(/^[\w-]+$/) });
const operation = z.object({ revision: z.number().int().nonnegative(), operationId: z.string().uuid() });
const command = operation.extend({
  action: z.enum(["open", "navigate", "click", "type", "scroll", "close_tab"]),
  target: targetSchema.optional(),
  personaId: z.number().int().positive(),
  userIdSuffix: identity.shape.userIdSuffix,
  url: z.string().url().max(2048).optional(),
  ref: z.string().regex(/^e\d{1,6}$/).optional(),
  text: z.string().max(4000).optional(),
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  snapshotToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
function assertRemote(result: CamofoxResult) {
  if (!result.ok) throw new WorkspaceError("Remote browser unavailable or action failed. Refresh and check the page before retrying.", 502);
}
function publicState(state: WorkspaceState) {
  const { freshTabs, ...safe } = state;
  return safe;
}
async function validPersona(personaId: number) {
  const rows = await db.select({ id: personas.id }).from(personas).where(eq(personas.id, personaId)).limit(1);
  if (!rows.length) throw new WorkspaceError("Choose an available agent.", 400);
}
async function currentSnapshot(tenantId: number, target: WorkspaceTarget) {
  const result = await executeCamofoxAction({ action: "snapshot", tabId: target.tabId,
    _tenantId: tenantId, _personaId: target.personaId, userIdSuffix: target.userIdSuffix });
  assertRemote(result);
  if (typeof result.snapshot !== "string") throw new WorkspaceError("Browser did not provide fresh page state.", 502);
  return result;
}
export function registerBrowserWorkspaceRoutes(app: Express, helpers: Helpers) {
  const router = Router();
  router.use(helpers.authMiddleware);
  router.use(async (req, res, next) => {
    // API-key callers must not gain a human-control bypass around tool policies.
    if ((req as any).apiKeyId || /^Bearer\s+vc_/i.test(String(req.headers.authorization || "")))
      return res.status(403).json({ error: "Browser workspace requires a signed-in human session." });
    try {
      const tenantId = await helpers.getTenantFromRequestAsync(req);
      if (!tenantId) return res.status(401).json({ error: "Sign in to use the browser workspace." });
      if (!checkTenantRateLimitExport(tenantId)) return res.status(429).json({ error: "Too many browser requests. Wait a moment." });
      res.locals.workspaceTenant = tenantId;
      res.setHeader("Cache-Control", "no-store");
      next();
    } catch { res.status(503).json({ error: "Browser session could not be verified." }); }
  });
  const handle = (fn: (req: Request, res: Response, tenantId: number) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try { await fn(req, res, res.locals.workspaceTenant); }
      catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: "Check the browser action fields and try again." });
        if (error instanceof WorkspaceError) {
          if (error.code === "browser_busy") res.setHeader("Retry-After", "1");
          return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
        }
        console.error("[browser-workspace] Request failed", error instanceof Error ? error.name : "UnknownError");
        res.status(503).json({ error: "Browser workspace is unavailable. No automatic retry was made." });
      }
    };
  registerWorkbenchLibraryRoutes(router);
  router.get("/", handle(async (req, res, tenantId) => {
    const scope = identity.parse(req.query);
    await validPersona(scope.personaId);
    const payload = await browserWorkspace.inspect(tenantId, async state => {
      if (!isCamofoxConfigured()) return { state: publicState(state), configured: false, tabs: [] };
      const result = await executeCamofoxAction({ action: "list_tabs", _tenantId: tenantId,
        _personaId: scope.personaId, userIdSuffix: scope.userIdSuffix });
      if (!result.ok) return { state: publicState(state), configured: true, tabs: [],
        connectionError: /unauthorized|HTTP 401/i.test(result.error || "")
          ? "The remote browser rejected its access key. The owner needs to reconnect the browser service."
          : "The remote browser is unavailable. Your control setting is preserved; refresh when the connection recovers." };
      const allTabs = workspaceTabs(result);
      const targetMissing = !!state.target && state.target.personaId === scope.personaId
        && (state.target.userIdSuffix || "") === (scope.userIdSuffix || "")
        && !allTabs.some(tab => tab.tabId === state.target!.tabId);
      return { state: publicState(state), configured: true, tabs: allTabs.slice(0, 40), targetMissing };
    });
    res.json(payload);
  }));
  router.get("/view", handle(async (req, res, tenantId) => {
    const target = targetSchema.parse(req.query);
    await validPersona(target.personaId);
    const payload = await browserWorkspace.view(tenantId, target, async mode => {
      const snapshot = mode === "human" ? await currentSnapshot(tenantId, target) : null;
      const image = await executeCamofoxAction({ action: "screenshot", tabId: target.tabId,
        _tenantId: tenantId, _personaId: target.personaId, userIdSuffix: target.userIdSuffix });
      assertRemote(image);
      const base64 = image.screenshotBase64;
      if (typeof base64 !== "string" || base64.length > 8_000_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(base64))
        throw new WorkspaceError("Browser screenshot was not available in a supported format.", 502);
      return { snapshot: snapshot?.snapshot, screenshotBase64: base64,
        title: snapshot?.title, url: snapshot?.url,
        elements: pageElements(snapshot?.snapshot || ""), capturedAt: new Date().toISOString() };
    });
    // Do not expose raw page text or persist images/page values in the ledger.
    const { snapshot, ...safe } = payload;
    res.json({ ...safe, state: publicState(payload.state) });
  }));
  router.post("/control", handle(async (req, res, tenantId) => {
    const input = operation.extend({ action: z.enum(["take", "return"]) }).strict().parse(req.body);
    const result = await browserWorkspace.control(tenantId, input.action, input.revision, input.operationId, async target => {
      if (target) return verifyWorkspaceHandback(tenantId, target, executeCamofoxAction);
      else {
        if (!isCamofoxConfigured()) throw new WorkspaceError("Remote browser is unavailable; human control remains active.", 502);
        const [persona] = await db.select({ id: personas.id }).from(personas).limit(1);
        if (!persona) throw new WorkspaceError("No browser agent is available.", 502);
        workspaceTabs(await executeCamofoxAction({ action: "list_tabs", _tenantId: tenantId, _personaId: persona.id }));
      }
    });
    res.json({ ...result, state: publicState(result.state) });
  }));
  router.post("/action", handle(async (req, res, tenantId) => {
    const input = command.parse(req.body);
    await validPersona(input.personaId);
    if (input.action !== "open" && !input.target) throw new WorkspaceError("Choose a browser tab.", 400);
    if (input.target && (input.target.personaId !== input.personaId ||
      (input.target.userIdSuffix || "") !== (input.userIdSuffix || ""))) throw new WorkspaceError("Browser identity mismatch.", 400);
    if (["open", "navigate"].includes(input.action)) {
      if (!input.url) throw new WorkspaceError("Enter a public website address.", 400);
      const url = new URL(input.url);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        throw new WorkspaceError("Use a public HTTP or HTTPS address without embedded credentials.", 400);
    }
    if (input.action === "type" && typeof input.text !== "string") throw new WorkspaceError("Enter the text to type.", 400);
    const result = await browserWorkspace.human(tenantId, input.revision, input.operationId, input.action, async state => {
      if (input.action === "open") return;
      const target = input.target!;
      if (!state.target || targetKey(state.target) !== targetKey(target) || !input.snapshotToken ||
        input.snapshotToken !== state.snapshotToken) throw new WorkspaceError("Refresh this tab before acting.");
      const snapshot = await currentSnapshot(tenantId, target);
      if (snapshotDigest(target, snapshot.snapshot!) !== input.snapshotToken)
        throw new WorkspaceError("The page changed. Refresh before acting.");
      if (["click", "type"].includes(input.action)) {
        const element = pageElements(snapshot.snapshot!).find(item => item.ref === input.ref);
        if (!element) throw new WorkspaceError("That page control is stale. Refresh the page controls.");
        if (input.action === "type" && !["textbox", "searchbox", "combobox", "spinbutton"].includes(element.role))
          throw new WorkspaceError("Choose a text field to type into.", 400);
      }
    }, () => executeCamofoxAction({
      action: input.action, _tenantId: tenantId, _personaId: input.personaId,
      userIdSuffix: input.userIdSuffix, tabId: input.target?.tabId,
      url: input.url, ref: input.ref, text: input.text, direction: input.direction, amount: 550,
    }), { personaId: input.personaId, userIdSuffix: input.userIdSuffix });
    const remote = result.result;
    res.json({ state: publicState(result.state), replayed: result.replayed,
      ok: remote ? remote.ok : result.state.lastOutcome === "complete",
      tabId: remote?.tabId,
      error: remote?.ok === false || (result.replayed && result.state.lastOutcome !== "complete")
        ? "The action outcome is uncertain. Check the page; do not repeat it without verification." : undefined });
  }));
  app.use("/api/browser/workspace", router);
}