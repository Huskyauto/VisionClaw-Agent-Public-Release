import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLibrary, changeLibrary, parseLibrary, parseUpload } from "../../server/lib/browser-workbench-library";
import { randomUUID } from "node:crypto";

test("folders persist with revision fencing and matching operation replay", () => {
  const input = { revision: 0, operationId: "c197e310-d705-44f1-97ba-c729973b9131",
    action: "create_folder", name: "Research", parentId: null };
  const state = changeLibrary(emptyLibrary(), input);
  assert.equal(state.folders[0].name, "Research");
  assert.equal(state.revision, 1);
  assert.deepEqual(changeLibrary(state, input), state);
  assert.throws(() => changeLibrary(state, { ...input, name: "Different" }), /operation/i);
  assert.throws(() => changeLibrary(state, { ...input, operationId: "009c9273-9b39-4078-bf8f-c12970736aae" }), /changed/i);
});

test("nested folders and file labels organize without destructive file deletion", () => {
  let state = changeLibrary(emptyLibrary(), { revision: 0, operationId: randomUUID(), action: "create_folder", name: "Work", parentId: null });
  const folderId = state.folders[0].id;
  const apply = (command: object, file?: { id: number; name: string }) => {
    state = changeLibrary(state, { revision: state.revision, operationId: randomUUID(), ...command }, file);
  };
  apply({ action: "create_folder", name: "Reports", parentId: folderId });
  assert.throws(() => apply({ action: "delete_folder", folderId }), /contents/);
  const child = state.folders[1].id;
  apply({ action: "add_file", fileId: 42, folderId: child }, { id: 42, name: "Audit.pdf" });
  assert.throws(() => apply({ action: "delete_folder", folderId: child }), /contents/);
  apply({ action: "rename_file", fileId: 42, name: "Inspection" });
  assert.equal(state.files[0].name, "Inspection");
  apply({ action: "move_file", fileId: 42, folderId: null });
  apply({ action: "delete_folder", folderId: child });
  apply({ action: "rename_folder", folderId, name: "Archive" });
  apply({ action: "remove_file", fileId: 42 });
  assert.equal(state.files.length, 0);
  apply({ action: "delete_folder", folderId });
  assert.equal(state.folders.length, 0);
});

test("unverified file ownership and ambiguous/path-shaped commands never change library", () => {
  const state = emptyLibrary();
  const cmd = { revision: 0, operationId: randomUUID(), action: "add_file", fileId: 42, folderId: null };
  assert.throws(() => changeLibrary(state, cmd), /your account/);
  assert.throws(() => changeLibrary(state, cmd, { id: 43, name: "Foreign" }), /your account/);
  assert.throws(() => changeLibrary(state, { ...cmd, filename: "also" }, { id: 42, name: "File" }));
  assert.throws(() => changeLibrary(state, { revision: 0, operationId: randomUUID(), action: "create_folder", name: "../escape", parentId: null }));
  assert.throws(() => changeLibrary(state, { ...cmd, tenantId: 1 }));
  assert.deepEqual(state, emptyLibrary());
});

test("duplicate names, nonexistent folders, cycles and malformed storage fail closed", () => {
  const state = changeLibrary(emptyLibrary(), { revision: 0, operationId: randomUUID(), action: "create_folder", name: "Work", parentId: null });
  assert.throws(() => changeLibrary(state, { revision: 1, operationId: randomUUID(), action: "create_folder", name: "work", parentId: null }), /already exists/);
  assert.throws(() => changeLibrary(state, { revision: 1, operationId: randomUUID(), action: "create_folder", name: "Next", parentId: randomUUID() }), /not found/);
  assert.throws(() => parseLibrary({ ...state, folders: [{ ...state.folders[0], parentId: state.folders[0].id }] }), /tree/);
  assert.throws(() => parseLibrary({ ...state, files: [{ fileId: 1, name: "x", folderId: randomUUID() }] }), /reference/);
  assert.throws(() => parseLibrary({}));
});

test("private upload validates bounded canonical bytes and safe names", () => {
  const input = { revision: 0, operationId: randomUUID(), folderId: null,
    fileName: "proof.txt", mimeType: "text/plain", data: Buffer.from("proof").toString("base64") };
  assert.equal(parseUpload(input).bytes.toString(), "proof");
  assert.equal(parseUpload({ ...input, data: Buffer.alloc(8 * 1024 * 1024).toString("base64") }).bytes.length, 8 * 1024 * 1024);
  for (const bad of [{ ...input, data: "x===" }, { ...input, data: "" },
    { ...input, fileName: "../proof" }, { ...input, fileName: 'x";evil.txt' },
    { ...input, tenantId: 1 }, { ...input, data: Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64") }])
    assert.throws(() => parseUpload(bad));
});