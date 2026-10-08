import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmedWorkbenchResponse, workbenchScopeKey, usableWorkbenchView, UnconfirmedWorkbenchSave, initialWorkbenchDestination, workbenchDownloadFilename } from "../../client/src/lib/browser-workbench-response";

const library = { revision: 1, folders: [], files: [] };
test("renaming a workbench label never overrides authoritative original download filename", () => {
  assert.equal(workbenchDownloadFilename('attachment; filename="original.txt"', "Renamed label"), "original.txt");
  assert.equal(workbenchDownloadFilename(null, "Fallback"), "Fallback");
});
test("move picker never retains an invisible current-folder value behind All files", () => {
  assert.equal(initialWorkbenchDestination("current", [{ id: "other" }]), "");
  assert.equal(initialWorkbenchDestination(null, [{ id: "other" }]), "");
  assert.equal(initialWorkbenchDestination("other", [{ id: "other" }]), "other");
});
test("account or auth-generation changes remount the complete local library scope", () => {
  assert.notEqual(workbenchScopeKey(1, 1, true), workbenchScopeKey(2, 2, true));
  assert.notEqual(workbenchScopeKey(1, 1, true), workbenchScopeKey(1, 2, true));
  assert.notEqual(workbenchScopeKey(1, 1, true), workbenchScopeKey(1, 1, false));
});
test("failed or unauthenticated reads mask ALL cached library state", () => {
  assert.equal(usableWorkbenchView(library, true, true), undefined);
  assert.equal(usableWorkbenchView(library, false, false), undefined);
  assert.equal(usableWorkbenchView(library, true, false), library);
});
test("truncated, empty or malformed 200 mutations are never confirmed", async () => {
  for (const body of ["{", "{}", JSON.stringify({ ...library, files: [{ fileId: 4 }] })])
    await assert.rejects(confirmedWorkbenchResponse(new Response(body, { status: 200 }), () => true, undefined, true),
      error => error instanceof UnconfirmedWorkbenchSave && error.refreshRequired);
  assert.deepEqual(await confirmedWorkbenchResponse(Response.json(library), () => true, undefined, true), library);
});
test("identity and cancellation are rechecked AFTER asynchronous body consumption", async () => {
  for (const aborted of [false, true]) {
    let current = true;
    const controller = new AbortController();
    const response = { ok: true, status: 200, json: async () => {
      if (aborted) controller.abort(); else current = false;
      return library;
    } } as Response;
    await assert.rejects(confirmedWorkbenchResponse(response, () => current, controller.signal), /expired/);
  }
});
test("remote save failures require refresh; known validation errors stay explicit", async () => {
  await assert.rejects(confirmedWorkbenchResponse(Response.json({ error: "Failed" }, { status: 503 }), () => true, undefined, true), UnconfirmedWorkbenchSave);
  await assert.rejects(confirmedWorkbenchResponse(Response.json({ error: "Folder not found" }, { status: 404 }), () => true, undefined, true), /Folder not found/);
});