import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { z } from "zod";

export type WorkspaceTarget = { personaId: number; tabId: string; userIdSuffix?: string };
export type WorkspaceState = {
  tenantId: number; mode: "agent" | "human"; revision: number;
  snapshotToken: string | null; target: WorkspaceTarget | null;
  requireFresh: boolean; freshTabs: string[];
  lastOperationId: string | null; lastOutcome: "none" | "pending" | "complete" | "uncertain";
  activity: { action: string; at: string }[];
};
export interface WorkspaceTransaction {
  read(): Promise<WorkspaceState>;
  write(state: WorkspaceState): Promise<void>;
}
export interface WorkspaceStore {
  exclusive<T>(tenantId: number, fn: (tx: WorkspaceTransaction) => Promise<T>): Promise<T>;
}
export class WorkspaceError extends Error {
  constructor(message: string, public status = 409, public code?: "browser_busy") { super(message); }
}
const humanContext = new AsyncLocalStorage<number>();
// Server-owned context only. Never read a human/approval signal from tool arguments.
export function isWorkspaceHumanAction(tenantId: number): boolean {
  return humanContext.getStore() === tenantId;
}
export function initialWorkspaceState(tenantId: number): WorkspaceState {
  return { tenantId, mode: "agent", revision: 0, snapshotToken: null, target: null,
    requireFresh: false, freshTabs: [], lastOperationId: null, lastOutcome: "none", activity: [] };
}
export function parseWorkspaceState(value: unknown, tenantId: number): WorkspaceState {
  const target = z.object({ personaId: z.number().int().positive(), tabId: z.string().regex(/^[\w-]{1,160}$/),
    userIdSuffix: z.string().regex(/^[a-z0-9_-]{1,32}$/).optional() });
  const parsed = z.object({
    tenantId: z.literal(tenantId), mode: z.enum(["agent", "human"]),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
    snapshotToken: z.string().regex(/^[a-f0-9]{64}$/).nullable(), target: target.nullable(),
    requireFresh: z.boolean(), freshTabs: z.array(z.string().max(256)).max(64),
    lastOperationId: z.string().uuid().nullable(), lastOutcome: z.enum(["none", "pending", "complete", "uncertain"]),
    activity: z.array(z.object({ action: z.string().max(100), at: z.string().datetime() })).max(20),
  }).strict().safeParse(value);
  if (!parsed.success) throw new WorkspaceError("Stored browser control is invalid; browser actions remain blocked.", 503);
  return parsed.data;
}
export function targetKey(target: WorkspaceTarget): string {
  return JSON.stringify([target.personaId, target.userIdSuffix || "", target.tabId]);
}
export function snapshotDigest(target: WorkspaceTarget, snapshot: string): string {
  return createHash("sha256").update(targetKey(target)).update("\0").update(snapshot).digest("hex");
}
export function pageElements(snapshot: string): { ref: string; role: string; label: string }[] {
  const elements: { ref: string; role: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const line of snapshot.slice(0, 100_000).split("\n")) {
    const ref = line.match(/(?:\bref[=:]\s*|\[)(e\d{1,6})\b/)?.[1]
      || line.match(/^\s*(?:-\s*)?(e\d{1,6})\s*[:\s]/)?.[1];
    const role = line.match(/\b(link|button|textbox|searchbox|combobox|checkbox|radio|option|spinbutton)\b/i)?.[1]?.toLowerCase();
    if (!ref || !role || seen.has(ref)) continue;
    seen.add(ref);
    const label = line.match(/"([^"]*)"/)?.[1] || line.replace(/\[.*?\]/g, "").replace(/^\s*-\s*/, "").trim();
    elements.push({ ref, role, label: label.slice(0, 240) || role });
    if (elements.length >= 150) break;
  }
  return elements;
}
function event(state: WorkspaceState, action: string) {
  state.activity = [...state.activity, { action, at: new Date().toISOString() }].slice(-20);
}
function fence(state: WorkspaceState, revision: number, id: string): boolean {
  if (state.lastOperationId === id) return false;
  if (state.revision !== revision) throw new WorkspaceError("Browser state changed. Refresh before trying again.");
  return true;
}
export class WorkspaceCoordinator {
  constructor(private store: WorkspaceStore) {}
  inspect<T>(tenantId: number, fn: (state: WorkspaceState) => Promise<T>) {
    return this.store.exclusive(tenantId, async tx =>
      humanContext.run(tenantId, async () => fn(await tx.read())));
  }
  control(tenantId: number, action: "take" | "return", revision: number, id: string,
    verify?: (target: WorkspaceTarget | null) => Promise<void | "expired">) {
    return this.store.exclusive(tenantId, async tx => {
      const state = await tx.read();
      if (!fence(state, revision, id)) return { state, replayed: true };
      if (action === "return") {
        if (state.mode !== "human") throw new WorkspaceError("Human control is not active.");
        if (!verify) throw new WorkspaceError("Fresh page verification is required.");
        const verified = await humanContext.run(tenantId, () => verify(state.target));
        if (verified === "expired") state.target = null;
      }
      state.mode = action === "take" ? "human" : "agent";
      state.revision++; state.snapshotToken = null;
      state.requireFresh = action === "return"; state.freshTabs = [];
      state.lastOperationId = id; state.lastOutcome = "complete";
      event(state, action === "take" ? "Human took control" : "Browser access returned to agent");
      await tx.write(state);
      return { state, replayed: false };
    });
  }
  view<T extends { snapshot?: string }>(tenantId: number, target: WorkspaceTarget,
    fn: (mode: "agent" | "human") => Promise<T>) {
    return this.store.exclusive(tenantId, async tx => humanContext.run(tenantId, async () => {
      const state = await tx.read();
      const view = await fn(state.mode);
      if (state.mode === "human" && typeof view.snapshot === "string") {
        state.target = target; state.snapshotToken = snapshotDigest(target, view.snapshot);
        await tx.write(state);
      }
      return { ...view, state };
    }));
  }
  agent<T>(tenantId: number, params: { action: string; tabId?: string; _personaId?: number; userIdSuffix?: string },
    fn: () => Promise<T>) {
    return this.store.exclusive(tenantId, async tx => {
      const state = await tx.read();
      if (state.mode === "human") throw new WorkspaceError(
        "Browser is under human control at /browser-workspace (phone-friendly). Stop browser work and wait for explicit handback; do not bypass using another engine.");
      const key = targetKey({ personaId: params._personaId || 0, tabId: params.tabId || "", userIdSuffix: params.userIdSuffix });
      if (state.requireFresh && params.action === "close_session")
        throw new WorkspaceError("After human handback, read each tab and close it explicitly; do not close the entire session.");
      if (state.requireFresh && ["navigate", "click", "type", "scroll", "extract", "close_tab"].includes(params.action)
        && !state.freshTabs.includes(key)) throw new WorkspaceError("Take a fresh snapshot of this tab after human handback before acting.");
      const result = await fn();
      if (params.action === "snapshot" && (result as any)?.ok === true && state.requireFresh) {
        state.freshTabs = [...new Set([...state.freshTabs, key])].slice(-64);
        await tx.write(state);
      }
      return result;
    });
  }
  human<T>(tenantId: number, revision: number, id: string, action: string,
    verify: (state: WorkspaceState) => Promise<void>, fn: () => Promise<T>,
    openedScope?: Pick<WorkspaceTarget, "personaId" | "userIdSuffix">) {
    return this.store.exclusive(tenantId, async tx => humanContext.run(tenantId, async () => {
      const state = await tx.read();
      if (!fence(state, revision, id)) return { state, replayed: true, result: null };
      if (state.mode !== "human") throw new WorkspaceError("Take control before changing the browser.");
      await verify(state);
      // Commit identity BEFORE remote effects. A crash cannot make a retry repeat them.
      state.revision++; state.lastOperationId = id; state.lastOutcome = "pending";
      state.snapshotToken = null; event(state, `Human browser action: ${action}`);
      await tx.write(state);
      try {
        const result = await fn();
        if (action === "open" && (result as any)?.ok === true && openedScope) {
          const tabId = (result as any).tabId;
          if (typeof tabId !== "string" || !/^[\w-]{1,160}$/.test(tabId))
            throw new WorkspaceError("The new tab could not be identified. Check the browser before repeating the action.", 502);
          state.target = { ...openedScope, tabId };
        }
        if (action === "close_tab" && (result as any)?.ok === true) state.target = null;
        state.lastOutcome = (result as any)?.ok === false ? "uncertain" : "complete";
        await tx.write(state);
        return { state, result, replayed: false };
      } catch (error) {
        state.lastOutcome = "uncertain";
        await tx.write(state);
        throw error;
      }
    }));
  }
}