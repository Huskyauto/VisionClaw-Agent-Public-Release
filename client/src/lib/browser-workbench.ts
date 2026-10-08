import { authFetch, getAuthIdentityVersion } from "@/lib/queryClient";
import type { WorkbenchCommand, WorkbenchLibraryView } from "@shared/browser-workbench";
import { confirmedWorkbenchResponse, UnconfirmedWorkbenchSave, workbenchDownloadFilename } from "./browser-workbench-response";

export type WorkbenchCommandAction = WorkbenchCommand extends infer Command
  ? Command extends { action: string }
    ? Omit<Command, "revision" | "operationId">
    : never
  : never;

export const WORKBENCH_LIBRARY_URL = "/api/browser/workspace/library";
export const WORKBENCH_UPLOAD_LIMIT = 8 * 1024 * 1024;
export const WORKBENCH_TOTAL_LIMIT = 100 * 1024 * 1024;

export type VaultFile = {
  id: number;
  filename: string;
  originalName?: string;
  mimeType: string;
  size: number;
};

function assertIdentity(identity: number, signal?: AbortSignal) {
  if (getAuthIdentityVersion() !== identity) throw new Error("Your account changed. Reload this page before continuing.");
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
}

export async function loadWorkbenchLibrary(signal?: AbortSignal, identity = getAuthIdentityVersion()) {
  assertIdentity(identity, signal);
  const response = await authFetch(WORKBENCH_LIBRARY_URL, { signal, cache: "no-store" });
  assertIdentity(identity, signal);
  if (!response.ok) throw new Error(`Could not load Browser Workbench (${response.status}).`);
  return confirmedWorkbenchResponse(response, () => getAuthIdentityVersion() === identity, signal);
}

export async function loadVaultFiles(signal?: AbortSignal, identity = getAuthIdentityVersion()) {
  assertIdentity(identity, signal);
  const response = await authFetch("/api/tenant/files", { signal, cache: "no-store" });
  assertIdentity(identity, signal);
  if (!response.ok) throw new Error(`Could not load My Vault files (${response.status}).`);
  const files = await response.json();
  assertIdentity(identity, signal);
  if (!Array.isArray(files)) throw new Error("My Vault response could not be verified.");
  return files as VaultFile[];
}

export async function sendWorkbenchCommand(command: WorkbenchCommandAction, view: WorkbenchLibraryView, identity: number, signal?: AbortSignal) {
  assertIdentity(identity, signal);
  let response: Response;
  try { response = await authFetch(WORKBENCH_LIBRARY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...command, revision: view.revision, operationId: crypto.randomUUID() }),
    signal,
  }); } catch { throw new UnconfirmedWorkbenchSave(); }
  assertIdentity(identity, signal);
  return confirmedWorkbenchResponse(response, () => getAuthIdentityVersion() === identity, signal, true);
}

export async function uploadWorkbenchFile(file: File, folderId: string | null, view: WorkbenchLibraryView, identity: number, signal?: AbortSignal) {
  if (file.size > WORKBENCH_UPLOAD_LIMIT) throw new Error("Files must be 8 MB or smaller.");
  const totalBytes = view.files.reduce((total, item) => total + (Number.isFinite(item.size) ? item.size : 0), 0);
  if (totalBytes + file.size > WORKBENCH_TOTAL_LIMIT) throw new Error("This upload would exceed the 100 MB Browser Workbench library limit.");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this file."));
    reader.onabort = () => reject(new Error("File reading was cancelled."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("Could not encode this file."));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
  assertIdentity(identity, signal);
  let response: Response;
  try {
    response = await authFetch(`${WORKBENCH_LIBRARY_URL}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: view.revision,
        operationId: crypto.randomUUID(),
        folderId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        data,
      }),
      signal,
    });
  } catch {
    throw new Error("Upload status is unknown. Refresh the library before trying again; this upload will not be repeated automatically.");
  }
  assertIdentity(identity, signal);
  return confirmedWorkbenchResponse(response, () => getAuthIdentityVersion() === identity, signal, true);
}

export async function downloadWorkbenchFile(fileId: number, name: string, identity: number, signal?: AbortSignal) {
  assertIdentity(identity, signal);
  const response = await authFetch(`/api/tenant/files/${encodeURIComponent(fileId)}`, { signal, cache: "no-store" });
  assertIdentity(identity, signal);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    assertIdentity(identity, signal);
    throw new Error(body?.error || `Download failed (${response.status}).`);
  }
  const blob = await response.blob();
  assertIdentity(identity, signal);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = workbenchDownloadFilename(response.headers.get("Content-Disposition"), name);
  anchor.click();
  URL.revokeObjectURL(url);
}