import { workbenchViewSchema, type WorkbenchLibraryView } from "../../../shared/browser-workbench";

export class UnconfirmedWorkbenchSave extends Error {
  readonly refreshRequired = true;
  constructor() { super("Save status is unknown. Refresh the library before trying again; the action was not repeated."); }
}
export function workbenchScopeKey(tenantId: number | undefined, generation: number, trusted: boolean) {
  return `${tenantId ?? "none"}:${generation}:${trusted}`;
}
export function initialWorkbenchDestination(current: string | null, options: { id: string }[]) {
  return current && options.some(folder => folder.id === current) ? current : "";
}
export function workbenchDownloadFilename(disposition: string | null, fallback: string) {
  return disposition?.match(/filename="([^"]+)"/i)?.[1] || fallback;
}
export function usableWorkbenchView(data: WorkbenchLibraryView | undefined, trusted: boolean, readFailed: boolean) {
  return trusted && !readFailed ? data : undefined;
}
export async function confirmedWorkbenchResponse(response: Response, isCurrent: () => boolean,
  signal?: AbortSignal, mutation = false): Promise<WorkbenchLibraryView> {
  const check = () => {
    if (!isCurrent() || signal?.aborted) throw new Error("This browser library request belongs to an expired sign-in or page.");
  };
  check();
  let body: unknown;
  try { body = await response.json(); }
  catch {
    check();
    if (mutation) throw new UnconfirmedWorkbenchSave();
    throw new Error("The library response was incomplete. Refresh to try again.");
  }
  check();
  if (!response.ok) {
    if (mutation && response.status >= 500) throw new UnconfirmedWorkbenchSave();
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error : `Library request failed (${response.status}).`;
    throw new Error(message);
  }
  const parsed = workbenchViewSchema.safeParse(body);
  if (!parsed.success) {
    if (mutation) throw new UnconfirmedWorkbenchSave();
    throw new Error("The library response could not be verified. Refresh to try again.");
  }
  return parsed.data;
}