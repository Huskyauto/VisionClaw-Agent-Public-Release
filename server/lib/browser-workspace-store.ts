import { pool } from "../db";
import { WorkspaceCoordinator, WorkspaceError, initialWorkspaceState, parseWorkspaceState, type WorkspaceStore } from "./browser-workspace";

const store: WorkspaceStore = {
  async exclusive(tenantId, fn) {
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new WorkspaceError("Authentication required.", 401);
    const client = await pool.connect();
    let locked = false;
    let releaseError: Error | undefined;
    try {
      const lock = await client.query("SELECT pg_try_advisory_lock(19472731, $1::int) AS locked", [tenantId]);
      locked = lock.rows[0]?.locked === true;
      if (!locked) throw new WorkspaceError("Browser is busy. Wait for the current action to finish, then try again.", 409, "browser_busy");
      return await fn({
        async read() {
          const result = await client.query(
            "SELECT state FROM browser_workspace_controls WHERE tenant_id = $1", [tenantId]);
          return result.rows.length ? parseWorkspaceState(result.rows[0].state, tenantId) : initialWorkspaceState(tenantId);
        },
        async write(state) {
          if (state.tenantId !== tenantId) throw new WorkspaceError("Browser ownership mismatch.", 403);
          await client.query(
            `INSERT INTO browser_workspace_controls (tenant_id, state, updated_at)
             VALUES ($1, $2::jsonb, now()) ON CONFLICT (tenant_id)
             DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
            [tenantId, JSON.stringify(state)],
          );
        },
      });
    } finally {
      if (locked) {
        try { await client.query("SELECT pg_advisory_unlock(19472731, $1::int)", [tenantId]); }
        catch { releaseError = new Error("Browser lock release failed"); console.error("[browser-workspace] Lock release failed; discarding connection"); }
      }
      client.release(releaseError);
    }
  },
};
export const browserWorkspace = new WorkspaceCoordinator(store);