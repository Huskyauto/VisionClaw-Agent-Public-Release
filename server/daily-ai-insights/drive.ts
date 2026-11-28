import { ROOT, sha, type DriveFile } from "./core";
import { assertOwner } from "./store";

const API = "https://www.googleapis.com/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const fields = "id,name,mimeType,parents,md5Checksum,size,trashed,appProperties";
export interface ReviewDrive {
  list(folder: string, token?: string): Promise<{ files: DriveFile[]; nextPageToken?: string }>;
  read(file: DriveFile, maxBytes: number, budget?: { remaining: number }): Promise<string>;
  dateFolder(day: string): Promise<string>;
  allocate(): Promise<string>;
  deliver(review: { outputId: string; folderId: string; day: string; markdown: string; digest: string; smoke: boolean }): Promise<void>;
}

/** Every URL host is server-owned. Report text supplies neither IDs nor paths. */
export async function createDrive(tenant: number, signal: AbortSignal,
  effect: <T>(work: () => Promise<T>) => Promise<T>,
  deps?: { token: string; fetcher: typeof fetch }): Promise<ReviewDrive> {
  assertOwner(tenant);
  const token = deps?.token ?? await (await import("../google-workspace")).getGoogleToken(tenant, "docs");
  const fetcher = deps?.fetcher ?? fetch;
  const rawRequest = async (url: string, options: RequestInit = {}, max = 1024 * 1024, budget?: { remaining: number }) => {
    const res = await fetcher(url, { ...options, signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), redirect: "error",
      headers: { Authorization: `Bearer ${token}`, ...options.headers } });
    if (!res.ok) {
      await res.body?.cancel();
      const error = new Error(`Google Drive HTTP ${res.status}`) as Error & { status: number };
      error.status = res.status;
      throw error;
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Drive returned no content");
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (budget) budget.remaining -= value.byteLength;
      if (budget && budget.remaining < 0) { await reader.cancel(); throw new Error("Combined streamed text budget exceeded"); }
      if (bytes > max) { await reader.cancel(); throw new Error("Drive response exceeded byte budget"); }
      chunks.push(value);
    }
    // ignoreBOM means preserve U+FEFF instead of silently consuming its bytes.
    // Fatal UTF-8 plus BOM preservation keeps the text hashes byte-exact.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
  };
  const request = (url: string, options: RequestInit = {}, max = 1024 * 1024, budget?: { remaining: number }) =>
    options.method && options.method !== "GET"
      ? effect(() => rawRequest(url, options, max, budget))
      : rawRequest(url, options, max, budget);
  const json = async (url: string, options?: RequestInit) => JSON.parse(await request(url, options));
  const validId = (id: string) => { if (!/^[\w-]+$/.test(id)) throw new Error("Invalid Drive ID"); return id; };
  const metadata = (id: string) => json(`${API}/files/${validId(id)}?fields=${encodeURIComponent(fields)}`);
  const inRoot = async (id: string) => {
    const seen = new Set<string>();
    for (let depth = 0; depth < 24; depth++) {
      if (id === ROOT) return;
      if (seen.has(id)) throw new Error("Drive ancestry cycle");
      seen.add(id);
      const f = await metadata(id);
      if (f.trashed || f.mimeType === "application/vnd.google-apps.shortcut" || f.parents?.length !== 1) throw new Error("Unsafe Drive ancestry");
      id = f.parents[0];
    }
    throw new Error("Drive item outside authorized ancestry depth");
  };
  const list = async (folder: string, pageToken?: string) => {
    await inRoot(folder);
    const query = new URLSearchParams({
      q: `'${validId(folder)}' in parents and trashed=false`, pageSize: "100",
      fields: `nextPageToken,files(${fields})`, orderBy: "name",
    });
    if (pageToken) query.set("pageToken", pageToken);
    return json(`${API}/files?${query}`);
  };
  const read = async (file: DriveFile, maxBytes: number, budget?: { remaining: number }) => {
    await inRoot(file.id);
    const meta = await metadata(file.id);
    if (meta.name !== file.name || meta.mimeType === FOLDER || meta.trashed ||
        (meta.size && Number(meta.size) > maxBytes)) throw new Error("Drive file changed or exceeds budget");
    const text = await request(`${API}/files/${validId(file.id)}?alt=media`, {}, maxBytes, budget);
    // Reject a reparenting race rather than granting outside-root read authority to the result.
    await inRoot(file.id);
    return text;
  };
  const ensureFolder = async (parent: string, name: string) => {
    await inRoot(parent);
    const q = new URLSearchParams({ q: `'${validId(parent)}' in parents and trashed=false and mimeType='${FOLDER}' and name='${name}'`, fields: `files(${fields})`, pageSize: "100" });
    const found = await json(`${API}/files?${q}`);
    if (found.nextPageToken || found.files?.length > 1) throw new Error("Conflicting date folders");
    if (found.files?.length === 1) return String(found.files[0].id);
    // A timeout here is surfaced, not automatically retried. Next attempt lists first.
    const created = await json(`${API}/files?fields=id`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) });
    return validId(created.id);
  };
  return {
    list, read,
    dateFolder: async day => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Invalid review day");
      return ensureFolder(await ensureFolder(ROOT, day.slice(0, 7)), day);
    },
    allocate: async () => {
      const result = await json(`${API}/files/generateIds?count=1&space=drive&type=files`);
      return validId(result.ids?.[0]);
    },
    deliver: async r => {
      await inRoot(r.folderId);
      let existing: any;
      try { existing = await metadata(r.outputId); }
      catch (e: any) { if (e.status !== 404) throw e; }
      if (!existing) {
        const boundary = `daily_insights_${r.outputId}`;
        const name = `${r.day}__visionclaw-review__${r.smoke ? "feedback" : "review"}__daily-ai-insights__${r.outputId}.md`;
        const meta = { id: r.outputId, name, mimeType: "text/markdown", parents: [r.folderId],
          appProperties: { dailyInsightsDigest: r.digest } };
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${r.markdown}\r\n--${boundary}--`;
        await json(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`, {
          method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
        });
        existing = await metadata(r.outputId);
      }
      if (existing.trashed || existing.parents?.length !== 1 || existing.parents[0] !== r.folderId ||
          existing.appProperties?.dailyInsightsDigest !== r.digest) throw new Error("Output identity/parent mismatch");
      const stored = await read(existing, 1024 * 1024);
      if (sha(stored) !== r.digest) throw new Error("Output byte read-back failed");
    },
  };
}
