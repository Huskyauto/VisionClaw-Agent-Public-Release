// Bounded public-site smoke, isolated synthetic tenant; no model calls or owner session changes.
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { executeCamofoxAction, isCamofoxConfigured } from "../server/camofox-tool";
import { pageElements, snapshotDigest } from "../server/lib/browser-workspace";
import { browserWorkspace } from "../server/lib/browser-workspace-store";

let tenantId: number | undefined;
let personaId: number | undefined;
try {
  if (!isCamofoxConfigured()) throw new Error("Camofox is not configured; live smoke cannot run");
  const persona = await pool.query("SELECT id FROM personas ORDER BY id LIMIT 1");
  personaId = persona.rows[0]?.id;
  if (!personaId) throw new Error("No persona available");
  const tenant = await pool.query("INSERT INTO tenants (email, name) VALUES ($1, $2) RETURNING id",
    [`browser-smoke-${randomUUID()}@invalid.example`, "Synthetic browser smoke"]);
  tenantId = tenant.rows[0].id;
  const base = { _tenantId: tenantId, _personaId: personaId };
  const opened = await executeCamofoxAction({ ...base, action: "open", url: "https://example.com" });
  if (!opened.ok || !opened.tabId) throw new Error("Public-site open failed");
  const snapshot = await executeCamofoxAction({ ...base, action: "snapshot", tabId: opened.tabId });
  if (!snapshot.ok || typeof snapshot.snapshot !== "string") throw new Error("Snapshot failed");
  console.log("PUBLIC SNAPSHOT FORMAT:", snapshot.snapshot.slice(0, 1200));
  console.log("PARSED CONTROLS:", JSON.stringify(pageElements(snapshot.snapshot)));
  const screenshot = await executeCamofoxAction({ ...base, action: "screenshot", tabId: opened.tabId });
  if (!screenshot.ok || !screenshot.screenshotBase64) throw new Error("Screenshot failed");
  const tabs = await executeCamofoxAction({ ...base, action: "list_tabs" });
  console.log("LIVE SMOKE", JSON.stringify({
    open: true, snapshot: true, screenshotBytes: screenshot.screenshotBase64.length,
    tabs: (tabs.tabs || []).map(t => ({ keys: Object.keys(t), tabIdPresent: !!(t.tabId || t.id) })),
  }));
  // Public Selenium fixture: type only synthetic text; never submit its form.
  const navigated = await executeCamofoxAction({ ...base, action: "navigate", tabId: opened.tabId,
    url: "https://www.selenium.dev/selenium/web/web-form.html" });
  if (!navigated.ok) throw new Error("Public form navigation failed");
  const state = await browserWorkspace.inspect(tenantId, async current => current);
  const takeover = await browserWorkspace.control(tenantId, "take", state.revision, randomUUID());
  if (takeover.state.mode !== "human") throw new Error("Live takeover failed");
  const denied = await executeCamofoxAction({ ...base, action: "list_tabs" });
  if (denied.ok || !/human control/i.test(denied.error || "")) throw new Error("Agent was not paused");
  const target = { personaId, tabId: opened.tabId };
  const inspectPage = () => browserWorkspace.view(tenantId!, target,
    () => executeCamofoxAction({ ...base, action: "snapshot", tabId: opened.tabId }));
  const first = await inspectPage();
  const field = pageElements(first.snapshot || "").find(item =>
    item.role === "textbox" && /text input/i.test(item.label));
  if (!field) throw new Error("Public form text input was not discoverable");
  for (const action of ["click", "type", "scroll"] as const) {
    const fresh = await inspectPage();
    if (!fresh.ok || typeof fresh.snapshot !== "string") throw new Error("Fresh human page read failed");
    const result = await browserWorkspace.human(tenantId, fresh.state.revision, randomUUID(), action,
      async current => {
        if (current.snapshotToken !== snapshotDigest(target, fresh.snapshot!))
          throw new Error("Live page binding changed");
      }, () => executeCamofoxAction({ ...base, action, tabId: opened.tabId,
        ref: field.ref, text: action === "type" ? "VisionClaw temporary browser check" : undefined,
        direction: "down", amount: 300 }));
    if (!result.result?.ok) throw new Error(`Live human ${action} failed`);
  }
  const typed = await inspectPage();
  if (!typed.snapshot?.includes("VisionClaw temporary browser check")) throw new Error("Typed value was not verified");
  const humanImage = await browserWorkspace.inspect(tenantId,
    () => executeCamofoxAction({ ...base, action: "screenshot", tabId: opened.tabId }));
  if (!humanImage.ok || !humanImage.screenshotBase64) throw new Error("Human screenshot failed");
  const returned = await browserWorkspace.control(tenantId, "return", typed.state.revision, randomUUID(),
    async currentTarget => {
      if (currentTarget?.tabId !== opened.tabId) throw new Error("Handback target changed");
      const verified = await executeCamofoxAction({ ...base, action: "snapshot", tabId: opened.tabId });
      if (!verified.ok) throw new Error("Handback page verification failed");
    });
  if (returned.state.mode !== "agent") throw new Error("Live handback failed");
  const resumed = await executeCamofoxAction({ ...base, action: "snapshot", tabId: opened.tabId });
  if (!resumed.ok) throw new Error("Agent fresh-read after handback failed");
  console.log("LIVE HUMAN CONTROLS", JSON.stringify({
    takeover: true, agentPaused: true, click: true, typedValueVerified: true,
    scroll: true, screenshot: true, handback: true, agentFreshRead: true,
  }));
} catch (error) {
  console.error("LIVE SMOKE FAILED:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  try {
    if (tenantId) {
      let remoteClosed = false;
      try {
        const cleanup = await browserWorkspace.inspect(tenantId,
          () => executeCamofoxAction({ _tenantId: tenantId, _personaId: personaId, action: "close_session" }));
        if (!cleanup.ok) throw new Error("Remote cleanup refused");
        remoteClosed = true;
      } catch {
        console.error("Synthetic remote session cleanup failed; retaining synthetic tenant for recovery", tenantId);
        process.exitCode = 1;
      }
      if (remoteClosed)
        await pool.query("DELETE FROM tenants WHERE id=$1 AND name=$2", [tenantId, "Synthetic browser smoke"]);
    }
  } finally {
    await pool.end();
  }
}