import { createHash } from "node:crypto";
import { z } from "zod";
import type { WorkbenchLibrary } from "../../shared/browser-workbench";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(120).refine(s => !/[/\\\u0000-\u001f\u007f]/.test(s), "Use a name, not a path.");
const fileId = z.number().int().positive().max(2147483647);
const base = { revision: z.number().int().nonnegative(), operationId: uuid };
export const libraryCommand = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("create_folder"), name, parentId: uuid.nullable() }).strict(),
  z.object({ ...base, action: z.literal("rename_folder"), folderId: uuid, name }).strict(),
  z.object({ ...base, action: z.literal("delete_folder"), folderId: uuid }).strict(),
  z.object({ ...base, action: z.literal("add_file"), fileId: fileId.optional(),
    filename: z.string().min(1).max(240).optional(), folderId: uuid.nullable() }).strict(),
  z.object({ ...base, action: z.literal("rename_file"), fileId, name }).strict(),
  z.object({ ...base, action: z.literal("move_file"), fileId, folderId: uuid.nullable() }).strict(),
  z.object({ ...base, action: z.literal("remove_file"), fileId }).strict(),
]).superRefine((command, ctx) => {
  if (command.action === "add_file" && (command.fileId === undefined) === (command.filename === undefined))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose exactly one file reference." });
});
const stateSchema = z.object({
  revision: z.number().int().nonnegative(),
  folders: z.array(z.object({ id: uuid, name, parentId: uuid.nullable() }).strict()).max(100),
  files: z.array(z.object({ fileId, name: z.string().min(1).max(240), folderId: uuid.nullable() }).strict()).max(500),
  operations: z.array(z.object({ id: uuid, digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(30),
}).strict();
export class LibraryError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export function emptyLibrary(): WorkbenchLibrary {
  return { revision: 0, folders: [], files: [], operations: [] };
}
export function parseLibrary(value: unknown): WorkbenchLibrary {
  const state = stateSchema.parse(value);
  const folders = new Set(state.folders.map(f => f.id));
  if (folders.size !== state.folders.length || new Set(state.files.map(f => f.fileId)).size !== state.files.length
    || new Set(state.operations.map(o => o.id)).size !== state.operations.length)
    throw new LibraryError("Library contains duplicate entries.", 503);
  for (const folder of state.folders) {
    const seen = new Set([folder.id]);
    let parent = folder.parentId;
    while (parent) {
      if (!folders.has(parent) || seen.has(parent)) throw new LibraryError("Library folder tree is invalid.", 503);
      seen.add(parent);
      parent = state.folders.find(f => f.id === parent)!.parentId;
    }
  }
  if (state.files.some(f => f.folderId && !folders.has(f.folderId)))
    throw new LibraryError("Library folder reference is invalid.", 503);
  return state;
}
export function commandDigest(value: unknown): string {
  // Canonical parsed commands have fixed key order; ignore request object key order.
  return createHash("sha256").update(JSON.stringify(libraryCommand.parse(value))).digest("hex");
}
export const libraryUpload = z.object({
  revision: z.number().int().nonnegative(), operationId: uuid, folderId: uuid.nullable(),
  fileName: z.string().min(1).max(120).regex(/^[^/\\\u0000-\u001f\u007f"]+$/),
  mimeType: z.string().max(120).regex(/^[\w.+-]+\/[\w.+-]+$/),
  data: z.string().min(4).max(11184812).regex(/^[A-Za-z0-9+/]*={0,2}$/),
}).strict();
export function parseUpload(raw: unknown) {
  const input = libraryUpload.parse(raw);
  const bytes = Buffer.from(input.data, "base64");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024 || bytes.toString("base64") !== input.data)
    throw new LibraryError("Choose a nonempty file up to 8 MB.", 413);
  return { input, bytes, digest: createHash("sha256").update(JSON.stringify(input)).digest("hex") };
}
export function changeLibrary(value: WorkbenchLibrary, raw: unknown,
  ownedFile?: { id: number; name: string }): WorkbenchLibrary {
  const state = parseLibrary(value), command = libraryCommand.parse(raw);
  const digest = commandDigest(command);
  const previous = state.operations.find(o => o.id === command.operationId);
  if (previous) {
    if (previous.digest !== digest) throw new LibraryError("This operation was already used for different content.");
    return state;
  }
  if (command.revision !== state.revision) throw new LibraryError("The library changed. Refresh before saving.");
  const folderExists = (id: string | null) => {
    if (id && !state.folders.some(f => f.id === id)) throw new LibraryError("Folder not found.", 404);
  };
  const next = structuredClone(state);
  switch (command.action) {
    case "create_folder":
      folderExists(command.parentId);
      if (next.folders.length >= 100) throw new LibraryError("The 100-folder limit has been reached.", 400);
      if (next.folders.some(f => f.parentId === command.parentId && f.name.toLowerCase() === command.name.toLowerCase()))
        throw new LibraryError("A folder with that name already exists.");
      next.folders.push({ id: command.operationId, name: command.name, parentId: command.parentId });
      break;
    case "rename_folder": {
      folderExists(command.folderId);
      const folder = next.folders.find(f => f.id === command.folderId)!;
      if (next.folders.some(f => f.id !== folder.id && f.parentId === folder.parentId && f.name.toLowerCase() === command.name.toLowerCase()))
        throw new LibraryError("A folder with that name already exists.");
      folder.name = command.name; break;
    }
    case "delete_folder":
      folderExists(command.folderId);
      if (next.folders.some(f => f.parentId === command.folderId) || next.files.some(f => f.folderId === command.folderId))
        throw new LibraryError("Move or remove the folder's contents before deleting it.");
      next.folders = next.folders.filter(f => f.id !== command.folderId); break;
    case "add_file":
      folderExists(command.folderId);
      if (!ownedFile || (command.fileId && command.fileId !== ownedFile.id))
        throw new LibraryError("File not found in your account.", 404);
      if (next.files.some(f => f.fileId === ownedFile.id)) throw new LibraryError("File is already in this workbench. Use Move.");
      if (next.files.length >= 500) throw new LibraryError("The 500-file limit has been reached.", 400);
      next.files.push({ fileId: ownedFile.id, name: ownedFile.name.slice(0, 240), folderId: command.folderId }); break;
    case "rename_file":
    case "move_file":
    case "remove_file": {
      const file = next.files.find(f => f.fileId === command.fileId);
      if (!file) throw new LibraryError("Workbench file not found.", 404);
      if (command.action === "rename_file") file.name = command.name;
      if (command.action === "move_file") { folderExists(command.folderId); file.folderId = command.folderId; }
      if (command.action === "remove_file") next.files = next.files.filter(f => f.fileId !== command.fileId);
      break;
    }
  }
  next.revision++;
  next.operations = [...next.operations, { id: command.operationId, digest }].slice(-30);
  return parseLibrary(next);
}