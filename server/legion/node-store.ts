import { randomUUID } from "node:crypto";
import { openNodeState, sealNodeState, type NodeScope } from "./node-state";

interface Connection {
  query(text: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

/** Non-expiring durable fence, not a heartbeat lease. Unclean exit requires
 * owner recovery AFTER proving the previous daemon is dead; never auto-steal. */
export async function claimNodeIdentity(client: Connection, scope: NodeScope, secret: string) {
  if (scope.tenantId !== 1 || !["development", "production"].includes(scope.environment) || !secret) {
    throw new Error("Legion owner identity encryption unavailable");
  }
  await client.query(`INSERT INTO legion_node_states (tenant_id, environment)
    VALUES ($1, $2) ON CONFLICT (tenant_id, environment) DO NOTHING`, [scope.tenantId, scope.environment]);
  const holder = randomUUID();
  const claimed = await client.query(`UPDATE legion_node_states SET holder=$3, updated_at=now()
    WHERE tenant_id=$1 AND environment=$2 AND holder IS NULL RETURNING payload`,
    [scope.tenantId, scope.environment, holder]);
  if (claimed.rowCount !== 1) throw new Error("Legion identity already held; unclean exit requires owner recovery");
  // Deliberately retain fence on corrupt state: no silent fresh node.
  const payload = claimed.rows[0].payload;
  if (payload !== null && typeof payload !== "string") throw new Error("Invalid stored Legion identity");
  const state = typeof payload === "string" ? openNodeState(payload, scope, secret) : null;
  return {
    state,
    async save(value: string) {
      const encrypted = sealNodeState(value, scope, secret);
      const result = await client.query(`UPDATE legion_node_states SET payload=$4, updated_at=now()
        WHERE tenant_id=$1 AND environment=$2 AND holder=$3`,
        [scope.tenantId, scope.environment, holder, encrypted]);
      if (result.rowCount !== 1) throw new Error("Legion identity ownership lost");
    },
    /** Caller must observe daemon exit and save final state before releasing. */
    async releaseAfterStop() {
      const result = await client.query(`UPDATE legion_node_states SET holder=NULL, updated_at=now()
        WHERE tenant_id=$1 AND environment=$2 AND holder=$3`, [scope.tenantId, scope.environment, holder]);
      if (result.rowCount !== 1) throw new Error("Legion identity ownership lost");
    },
  };
}
