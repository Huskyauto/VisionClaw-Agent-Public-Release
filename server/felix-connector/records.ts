import { sql } from "drizzle-orm";
import { db } from "../db";
import { encryptApiKey, decryptApiKey } from "../crypto";
import { ownerTenantId } from "../agentic/autonomous-budget";
import type { OAuthRecord, OAuthRecordStore } from "./oauth";
import { ensureClientThread, setClientWorkPermission } from "./service";

/** This store is exclusively owner control-plane state, not a memory/file tool source. */
export const postgresOAuthStore: OAuthRecordStore = {
  transaction: fn => db.transaction(async tx => {
    const tenantId = ownerTenantId();
    // Serialize the small owner-only control plane across instances, including
    // registration caps and revoke/exchange races. Never held over HTTP/model work.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(711098, ${tenantId})`);
    return fn({
      async get(id) {
        const r: any = await tx.execute(sql`SELECT * FROM felix_connector_records WHERE tenant_id=${tenantId} AND id=${id} FOR UPDATE`);
        const row = r.rows[0];
        if (!row) return undefined;
        return {id: row.id, kind: row.kind, clientId: row.client_id,
          expiresAt: Math.floor(new Date(row.expires_at).getTime()/1000), data: JSON.parse(decryptApiKey(row.payload))} as OAuthRecord;
      },
      async put(row) {
        if (!process.env.SESSION_SECRET) throw new Error("Connector encryption unavailable");
        const payload = encryptApiKey(JSON.stringify(row.data));
        await tx.execute(sql`INSERT INTO felix_connector_records (id,tenant_id,kind,client_id,payload,expires_at)
          VALUES (${row.id},${tenantId},${row.kind},${row.clientId},${payload},${new Date(row.expiresAt*1000)})`);
      },
      async remove(id) { await tx.execute(sql`DELETE FROM felix_connector_records WHERE tenant_id=${tenantId} AND id=${id}`); },
      async removeClient(clientId) {
        await tx.execute(sql`DELETE FROM felix_connector_records WHERE tenant_id=${tenantId} AND client_id=${clientId} AND kind <> 'client'`);
      },
      async countClients() {
        await tx.execute(sql`DELETE FROM felix_connector_records WHERE tenant_id=${tenantId} AND expires_at < NOW()`);
        const r: any = await tx.execute(sql`SELECT count(*)::int AS n FROM felix_connector_records WHERE tenant_id=${tenantId} AND kind='client'`);
        return r.rows[0].n;
      },
      async prepareClient(clientId,ownerId,allowWork) {
        if(ownerId!==tenantId) throw new Error("owner_required");
        const binding=await ensureClientThread(clientId,ownerId,tx);
        await setClientWorkPermission(binding,allowWork,tx);
      },
    });
  }),
};
