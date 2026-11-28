import { ROOT, LIMITS, type DriveFile } from "./core";

export interface Cursor {
  root: string;
  folders: Array<{ id: string; token?: string }>;
  visited: string[];
  pending: DriveFile[];
  sweep: number;
  gaps?: Array<{ id: string; reason: string }>;
}
export const emptyCursor = (): Cursor => ({ root: ROOT, folders: [{ id: ROOT }], visited: [ROOT], pending: [], sweep: 1, gaps: [] });
export type ListPage = (folder: string, token?: string) => Promise<{ files: DriveFile[]; nextPageToken?: string }>;

/** Mutations are checkpointed by the caller after each page, never just on exit. */
export async function discover(cursor: Cursor, list: ListPage, pages = LIMITS.pages, checkpoint = async () => {}) {
  for (let n = 0; n < pages && cursor.folders.length; n++) {
    // Bound a single sweep without discarding an oversized hierarchy.
    // Pending-file pressure clears as reports are consumed. Never gate on the
    // monotonically growing visited set: that permanently wedges large trees.
    if (cursor.pending.length >= 5000) break;
    const entry = cursor.folders[0];
    let page: Awaited<ReturnType<ListPage>>;
    try { page = await list(entry.id, entry.token); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      // Never treat loss of the authorized root, throttling, auth failure or a
      // transient upstream error as a completed listing.
      const terminal = /^(Google Drive HTTP (404|410)|Unsafe Drive ancestry|Drive ancestry cycle|Drive item outside authorized ancestry depth)$/.test(message);
      if (entry.id === ROOT || !terminal) throw error;
      cursor.gaps = [...(cursor.gaps ?? []).filter(gap => gap.id !== entry.id),
        { id: entry.id, reason: message }].slice(-100);
      cursor.folders.shift();
      await checkpoint();
      continue;
    }
    if (!Array.isArray(page.files) || page.files.length > 100) throw new Error("Invalid Drive listing");
    for (const f of page.files) {
      if (!/^[\w-]+$/.test(f.id) || typeof f.name !== "string") throw new Error("Invalid Drive identity");
      if (f.mimeType === "application/vnd.google-apps.folder") {
        if (!cursor.visited.includes(f.id)) {
          cursor.visited.push(f.id);
          cursor.folders.push({ id: f.id });
        }
      } else if (f.mimeType !== "application/vnd.google-apps.shortcut" && /__report__.*__v\d+\.md$/.test(f.name)) {
        const prior = cursor.pending.findIndex(p => p.id === f.id);
        const scoped = { ...f, parents: [entry.id] };
        if (prior < 0) cursor.pending.push(scoped);
        else cursor.pending[prior] = scoped;
      }
    }
    if (page.nextPageToken) {
      if (page.nextPageToken === entry.token) throw new Error("Drive repeated a page token");
      entry.token = page.nextPageToken;
    } else cursor.folders.shift();
    await checkpoint();
  }
}
