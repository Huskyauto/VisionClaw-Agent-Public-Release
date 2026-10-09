import { z } from "zod";
export type WorkbenchFolder = { id: string; name: string; parentId: string | null };
export type WorkbenchFile = { fileId: number; name: string; folderId: string | null };
export type WorkbenchLibrary = {
  revision: number;
  folders: WorkbenchFolder[];
  files: WorkbenchFile[];
  operations: { id: string; digest: string }[];
};
export type WorkbenchFileView = WorkbenchFile & {
  available: boolean; mimeType: string; size: number;
};
export type WorkbenchLibraryView = {
  revision: number; folders: WorkbenchFolder[]; files: WorkbenchFileView[];
  warning?: string;
};
export const workbenchViewSchema = z.object({
  revision: z.number().int().nonnegative(),
  folders: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(120),
    parentId: z.string().uuid().nullable() }).strict()).max(100),
  files: z.array(z.object({ fileId: z.number().int().positive().max(2147483647),
    name: z.string().min(1).max(240), folderId: z.string().uuid().nullable(),
    available: z.boolean(), mimeType: z.string().max(120),
    size: z.number().int().nonnegative() }).strict()).max(500),
  warning: z.string().max(500).optional(),
}).strict().superRefine((state, ctx) => {
  const folderIds = new Set(state.folders.map(f => f.id));
  let invalid = folderIds.size !== state.folders.length || new Set(state.files.map(f => f.fileId)).size !== state.files.length;
  for (const folder of state.folders) {
    const visited = new Set([folder.id]);
    let parent = folder.parentId;
    while (parent) {
      if (!folderIds.has(parent) || visited.has(parent)) { invalid = true; break; }
      visited.add(parent);
      parent = state.folders.find(f => f.id === parent)!.parentId;
    }
  }
  if (invalid || state.files.some(f => f.folderId && !folderIds.has(f.folderId)))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid browser library references." });
});
export type WorkbenchCommand = {
  revision: number; operationId: string;
} & (
  | { action: "create_folder"; name: string; parentId: string | null }
  | { action: "rename_folder"; folderId: string; name: string }
  | { action: "delete_folder"; folderId: string }
  | { action: "add_file"; filename?: string; fileId?: number; folderId: string | null }
  | { action: "rename_file"; fileId: number; name: string }
  | { action: "move_file"; fileId: number; folderId: string | null }
  | { action: "remove_file"; fileId: number }
);