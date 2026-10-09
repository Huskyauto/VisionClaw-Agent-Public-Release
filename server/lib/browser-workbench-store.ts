import type { Pool } from "pg";
import { changeLibrary, commandDigest, emptyLibrary, libraryCommand, LibraryError, parseLibrary, parseUpload } from "./browser-workbench-library";
import { randomUUID } from "node:crypto";
import type { WorkbenchLibrary, WorkbenchLibraryView } from "../../shared/browser-workbench";

/** Dedicated organization only. File bytes and general Vault routes are unchanged. */
export function createWorkbenchStore(pool: Pick<Pool, "query" | "connect">) {
  function tenant(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw new LibraryError("Sign in to manage browser files.", 401);
  }
  async function read(tenantId: number): Promise<WorkbenchLibrary> {
    tenant(tenantId);
    const result = await pool.query("SELECT state FROM browser_workbench_libraries WHERE tenant_id=$1", [tenantId]);
    return result.rows.length ? parseLibrary(result.rows[0].state) : emptyLibrary();
  }
  async function view(tenantId: number, state: WorkbenchLibrary): Promise<WorkbenchLibraryView> {
    tenant(tenantId);
    const ids = state.files.map(f => f.fileId);
    const result = ids.length ? await pool.query(
      "SELECT id, mime_type, size FROM file_storage WHERE tenant_id=$1 AND id=ANY($2::int[])",
      [tenantId, ids]) : { rows: [] };
    const files = new Map(result.rows.map(f => [f.id, f]));
    return { revision: state.revision, folders: state.folders, files: state.files.map(f => {
      const owned = files.get(f.fileId);
      return { ...f, available: !!owned, mimeType: owned?.mime_type || "", size: owned?.size || 0 };
    }) };
  }
  async function mutate(tenantId: number, raw: unknown, upload = false): Promise<WorkbenchLibrary> {
    tenant(tenantId);
    const uploaded = upload ? parseUpload(raw) : undefined;
    const command = uploaded
      ? libraryCommand.parse({ revision: uploaded.input.revision, operationId: uploaded.input.operationId,
        action: "add_file", filename: `browser-${uploaded.input.operationId}`, folderId: uploaded.input.folderId })
      : libraryCommand.parse(raw);
    const digest = uploaded?.digest ?? commandDigest(command);
    const client = await pool.connect();
    let releaseError: Error | undefined;
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO browser_workbench_libraries (tenant_id,state)
        VALUES ($1,$2::jsonb) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId, JSON.stringify(emptyLibrary())]);
      const result = await client.query("SELECT state FROM browser_workbench_libraries WHERE tenant_id=$1 FOR UPDATE", [tenantId]);
      if (result.rows.length !== 1) throw new LibraryError("Browser library could not be verified.", 503);
      const state = parseLibrary(result.rows[0].state);
      const receipt = state.operations.find(o => o.id === command.operationId);
      if (receipt) {
        if (receipt.digest !== digest) throw new LibraryError("This operation was used for different content.");
        await client.query("COMMIT");
        return state;
      }
      if (command.revision !== state.revision) throw new LibraryError("The library changed. Refresh before saving.");
      let ownedFile: { id: number; name: string } | undefined;
      if (command.action === "add_file") {
        if (uploaded) {
          // Validate folder/capacity BEFORE inserting bytes. A rollback covers
          // both bytes and metadata; no Drive account or public upload is involved.
          changeLibrary(state, command, { id: 2147483647, name: uploaded.input.fileName });
          const usage = await client.query(`SELECT COALESCE(SUM(size),0)::bigint AS bytes
            FROM file_storage WHERE tenant_id=$1 AND (filename LIKE 'workbench-upload-%' OR id=ANY($2::int[]))`,
            [tenantId, state.files.map(f => f.fileId)]);
          if (Number(usage.rows[0].bytes) + uploaded.bytes.length > 100 * 1024 * 1024)
            throw new LibraryError("The browser library's 100 MB file limit has been reached.", 400);
          const files = await client.query(`INSERT INTO file_storage
            (tenant_id,filename,original_name,mime_type,size,data,is_public)
            VALUES ($1,$2,$3,$4,$5,$6,false) RETURNING id,original_name,size`,
          [tenantId, `workbench-upload-${randomUUID()}`, uploaded.input.fileName,
            uploaded.input.mimeType, uploaded.bytes.length, uploaded.input.data]);
          ownedFile = { id: files.rows[0].id, name: files.rows[0].original_name };
        } else {
          const files = await client.query(
          `SELECT id, original_name FROM file_storage WHERE tenant_id=$1 AND ${
            command.fileId !== undefined ? "id=$2" : "filename=$2"} LIMIT 2`,
          [tenantId, command.fileId ?? command.filename]);
        if (!files.rows.length) throw new LibraryError("File not found in your account.", 404);
        if (files.rows.length !== 1) throw new LibraryError("Choose this file by its Vault entry; its upload name is ambiguous.");
        ownedFile = { id: files.rows[0].id, name: String(files.rows[0].original_name) };
        }
        if (!uploaded) {
          const bytes = await client.query(`SELECT COALESCE(SUM(size),0)::bigint AS bytes
          FROM file_storage WHERE tenant_id=$1 AND (filename LIKE 'workbench-upload-%' OR id=ANY($2::int[]))`,
          [tenantId, [...state.files.map(f => f.fileId), ownedFile!.id]]);
        if (Number(bytes.rows[0].bytes) > 100 * 1024 * 1024)
          throw new LibraryError("The browser library's 100 MB file limit has been reached.", 400);
        }
      }
      const next = changeLibrary(state, command, ownedFile);
      if (uploaded) next.operations[next.operations.length - 1].digest = digest;
      await client.query("UPDATE browser_workbench_libraries SET state=$2::jsonb,updated_at=now() WHERE tenant_id=$1",
        [tenantId, JSON.stringify(next)]);
      await client.query("COMMIT");
      return next;
    } catch (error) {
      try { await client.query("ROLLBACK"); }
      catch { releaseError = new Error("Workbench rollback failed"); console.error("[browser-workbench] Transaction rollback failed"); }
      throw error;
    } finally { client.release(releaseError); }
  }
  return { read, view, mutate };
}