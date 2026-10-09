import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Check, Download, File, Folder, FolderPlus, Loader2, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import type { WorkbenchFileView, WorkbenchFolder, WorkbenchLibraryView } from "@shared/browser-workbench";
import { useAuth } from "@/lib/auth";
import { getAuthIdentityVersion } from "@/lib/queryClient";
import { downloadWorkbenchFile, loadVaultFiles, loadWorkbenchLibrary, sendWorkbenchCommand, uploadWorkbenchFile, WORKBENCH_TOTAL_LIMIT, WORKBENCH_UPLOAD_LIMIT, type VaultFile, type WorkbenchCommandAction } from "@/lib/browser-workbench";

type Dialog = { kind: "folder" | "rename-folder" | "rename-file" | "move-file" | "remove-file" | "delete-folder" | "vault"; folderId?: string; fileId?: number } | null;

function formatSize(size: number) {
  if (!Number.isFinite(size) || size < 0) return "Size unavailable";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

import { workbenchScopeKey, usableWorkbenchView, UnconfirmedWorkbenchSave, initialWorkbenchDestination } from "@/lib/browser-workbench-response";

export default function BrowserWorkbenchFilesPage() {
  const { tenant, token, isReplitAuth, isChecking } = useAuth();
  const trusted = !isChecking && !!tenant && (!!token || isReplitAuth);
  return <BrowserWorkbenchFilesScope key={workbenchScopeKey(tenant?.id, getAuthIdentityVersion(), trusted)} />;
}

function BrowserWorkbenchFilesScope() {
  const { tenant, token, isReplitAuth, isChecking } = useAuth();
  const signedInRoleReady = !isChecking && !!tenant && (!!token || isReplitAuth);
  const queryClient = useQueryClient();
  const tenantId = tenant?.id;
  const identity = getAuthIdentityVersion();
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [draft, setDraft] = useState("");
  const [targetFolder, setTargetFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [vaultFiles, setVaultFiles] = useState<VaultFile[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [selectedVaultFile, setSelectedVaultFile] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => { controller.abort(); lifetime.current = null; };
  }, []);
  useEffect(() => {
    setActiveFolder(null); setDialog(null); setError(""); setRefreshRequired(false);
  }, [tenantId, identity]);

  const libraryQuery = useQuery<WorkbenchLibraryView>({
    queryKey: ["/api/browser/workspace/library", tenantId, identity],
    queryFn: ({ signal }) => loadWorkbenchLibrary(signal, identity),
    enabled: signedInRoleReady,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const view = usableWorkbenchView(libraryQuery.data, signedInRoleReady, libraryQuery.isError || refreshRequired);
  const folders = view?.folders || [];
  const files = view?.files || [];
  const currentFolder = folders.find(folder => folder.id === activeFolder) || null;
  const children = useMemo(() => folders.filter(folder => folder.parentId === activeFolder), [folders, activeFolder]);
  const currentFiles = useMemo(() => files.filter(file => file.folderId === activeFolder), [files, activeFolder]);
  const folderPath = useMemo(() => {
    const path: WorkbenchFolder[] = [];
    let current = currentFolder;
    while (current) {
      path.unshift(current);
      current = folders.find(folder => folder.id === current?.parentId) || null;
    }
    return path;
  }, [currentFolder, folders]);
  const fileById = (fileId?: number) => files.find(item => item.fileId === fileId);
  const parentFolders = folders.filter(folder => folder.id !== activeFolder);
  const folderLabel = (folder: WorkbenchFolder) => {
    const names = [folder.name];
    let parent = folders.find(item => item.id === folder.parentId);
    while (parent) {
      names.unshift(parent.name);
      parent = folders.find(item => item.id === parent?.parentId);
    }
    return names.join(" / ");
  };

  async function runCommand(command: WorkbenchCommandAction) {
    if (!view) return;
    setBusy(true); setError("");
    try {
      if (getAuthIdentityVersion() !== identity || lifetime.current?.signal.aborted) return;
      const next = await sendWorkbenchCommand(command, view, identity, lifetime.current?.signal);
      if (getAuthIdentityVersion() !== identity) return;
      queryClient.setQueryData(["/api/browser/workspace/library", tenantId, identity], next);
      setDialog(null); setDraft("");
    } catch (cause) {
      if (getAuthIdentityVersion() === identity && !lifetime.current?.signal.aborted) {
        if (cause instanceof UnconfirmedWorkbenchSave) setRefreshRequired(true);
        setError(cause instanceof Error ? cause.message : "The change was not confirmed.");
      }
    } finally { if (getAuthIdentityVersion() === identity) setBusy(false); }
  }

  async function openVault() {
    setDialog({ kind: "vault" }); setError(""); setVaultFiles([]); setSelectedVaultFile(""); setVaultLoading(true);
    try {
      const data = await loadVaultFiles(lifetime.current?.signal, identity);
      if (getAuthIdentityVersion() === identity) setVaultFiles(data);
    } catch (cause) { if (getAuthIdentityVersion() === identity) setError(cause instanceof Error ? cause.message : "Could not load My Vault."); }
    finally { if (getAuthIdentityVersion() === identity) setVaultLoading(false); }
  }

  async function addVaultFile() {
    const selected = vaultFiles.find(file => String(file.id) === selectedVaultFile);
    if (!selected || !view) return;
    await runCommand({ action: "add_file", fileId: selected.id, folderId: activeFolder });
  }

  async function uploadFile(file?: File) {
    if (!file || !view) return;
    setBusy(true); setError("");
    try {
      if (getAuthIdentityVersion() !== identity || lifetime.current?.signal.aborted) return;
      const result = await uploadWorkbenchFile(file, activeFolder, view, identity, lifetime.current?.signal);
      if (getAuthIdentityVersion() !== identity) return;
      queryClient.setQueryData(["/api/browser/workspace/library", tenantId, identity], result);
    } catch (cause) {
      if (getAuthIdentityVersion() === identity && !lifetime.current?.signal.aborted) {
        const message = cause instanceof Error ? cause.message : "Upload could not be confirmed.";
        setError(message);
        if (message.toLowerCase().includes("refresh")) setRefreshRequired(true);
      }
    }
    finally { if (getAuthIdentityVersion() === identity) setBusy(false); }
  }

  async function download(file: WorkbenchFileView) {
    setBusy(true); setError("");
    try { await downloadWorkbenchFile(file.fileId, file.name, identity, lifetime.current?.signal); }
    catch (cause) { if (getAuthIdentityVersion() === identity) setError(cause instanceof Error ? cause.message : "Download failed."); }
    finally { if (getAuthIdentityVersion() === identity) setBusy(false); }
  }

  function showDialog(next: Dialog, initial = "") { setDialog(next); setDraft(initial); setError(""); }
  const dialogFile = fileById(dialog?.fileId);
  const dialogFolder = folders.find(folder => folder.id === dialog?.folderId);
  const childCount = dialogFolder ? folders.filter(folder => folder.parentId === dialogFolder.id).length + files.filter(file => file.folderId === dialogFolder.id).length : 0;

  if (isChecking) return <main className="p-6"><div className="h-8 w-48 animate-pulse rounded bg-muted" /><div className="mt-5 h-64 animate-pulse rounded-xl bg-muted" /></main>;
  if (!signedInRoleReady) return <main className="p-8"><h1 className="text-2xl font-semibold">Sign in to view workbench files</h1></main>;
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 text-foreground md:px-8 md:py-9">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><Link href="/browser-workbench" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Browser Workbench</Link><p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">PRIVATE LIBRARY</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Workbench files</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Organize references for browser work. My Vault remains the source of file bytes; browser downloads are not imported automatically. Uploads are limited to {formatSize(WORKBENCH_UPLOAD_LIMIT)} each and {formatSize(WORKBENCH_TOTAL_LIMIT)} total.</p></div>
          <Link href="/browser-workspace" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Browser controls <ArrowRight className="h-4 w-4" /></Link>
        </header>

        <section className="mt-7 rounded-xl border border-border bg-card">
          <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between md:px-5">
            <nav aria-label="Folder path" className="flex min-h-11 flex-wrap items-center gap-1 text-sm">
              <button className="min-h-11 rounded-md px-2 font-medium hover:bg-muted" onClick={() => setActiveFolder(null)}>All files</button>
              {folderPath.map(folder => <span key={folder.id} className="flex items-center gap-1"><span className="text-muted-foreground">/</span><button className="min-h-11 rounded-md px-2 hover:bg-muted" onClick={() => setActiveFolder(folder.id)}>{folder.name}</button></span>)}
            </nav>
            <div className="flex flex-wrap gap-2">
              <button disabled={busy || !view || libraryQuery.isFetching || folders.length >= 100} onClick={() => showDialog({ kind: "folder" })} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"><FolderPlus className="h-4 w-4" /> New folder</button>
              <button disabled={busy || !view || libraryQuery.isFetching || files.length >= 500} onClick={openVault} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"><Plus className="h-4 w-4" /> Add from My Vault</button>
              <button disabled={busy || !view || libraryQuery.isFetching || refreshRequired || files.length >= 500} onClick={() => uploadInput.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Upload className="h-4 w-4" /> Upload</button>
              <button disabled={busy} onClick={() => void libraryQuery.refetch().then(result => { if (result.isSuccess) { setRefreshRequired(false); setError(""); } })} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">Refresh</button>
              <input ref={uploadInput} type="file" className="sr-only" aria-label="Choose a file to upload" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void uploadFile(file); }} />
            </div>
          </div>

          {(error || libraryQuery.error) && <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><span>{error || (libraryQuery.error instanceof Error ? libraryQuery.error.message : "Could not load your library.")}</span>{libraryQuery.error && <button onClick={() => void libraryQuery.refetch()} className="min-h-11 rounded-md border border-current px-3 font-semibold">Try again</button>}</div>}
          {view?.warning && <p role="status" className="mx-4 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800">{view.warning}</p>}

          {libraryQuery.isLoading ? <div className="space-y-3 p-5" aria-label="Loading library">{[0, 1, 2].map(index => <div key={index} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div> :
            !libraryQuery.error && children.length === 0 && currentFiles.length === 0 ? <div className="px-6 py-14 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary"><Folder className="h-5 w-5" /></span><h2 className="mt-4 font-semibold">Start a tidy browser library</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Create a folder, add an existing file from My Vault, or upload a file up to 8 MB. This library only stores organization references.</p></div> : !libraryQuery.error && <div className="divide-y divide-border">
              {children.map(folder => <div key={folder.id} className="flex flex-wrap items-center gap-3 px-4 py-2 md:px-5">
                <button onClick={() => setActiveFolder(folder.id)} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 text-left hover:text-primary"><Folder className="h-4 w-4 shrink-0 text-primary" /><span className="truncate font-medium">{folder.name}</span><span className="text-xs text-muted-foreground">Folder</span></button>
                <button aria-label={`Rename ${folder.name}`} onClick={() => showDialog({ kind: "rename-folder", folderId: folder.id }, folder.name)} className="grid h-11 w-11 place-items-center rounded-md hover:bg-muted"><Pencil className="h-4 w-4" /></button>
                <button aria-label={`Delete ${folder.name}`} onClick={() => showDialog({ kind: "delete-folder", folderId: folder.id })} className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </div>)}
              {currentFiles.map(file => <div key={file.fileId} className="flex flex-wrap items-center gap-3 px-4 py-2 md:px-5">
                <File className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{file.name}</p><p className="text-xs text-muted-foreground">{file.available ? `${file.mimeType || "File"} · ${formatSize(file.size)}` : "Original file unavailable"}</p></div>
                <div className="flex flex-wrap gap-1">
                  {file.available && <button aria-label={`Download ${file.name}`} onClick={() => void download(file)} disabled={busy} className="grid h-11 w-11 place-items-center rounded-md hover:bg-muted disabled:opacity-50"><Download className="h-4 w-4" /></button>}
                  <button aria-label={`Rename ${file.name}`} onClick={() => showDialog({ kind: "rename-file", fileId: file.fileId }, file.name)} className="grid h-11 w-11 place-items-center rounded-md hover:bg-muted"><Pencil className="h-4 w-4" /></button>
                  <button aria-label={`Move ${file.name}`} onClick={() => { setTargetFolder(initialWorkbenchDestination(file.folderId, parentFolders)); showDialog({ kind: "move-file", fileId: file.fileId }); }} className="grid h-11 w-11 place-items-center rounded-md hover:bg-muted"><MoreHorizontal className="h-4 w-4" /></button>
                  <button aria-label={`Remove ${file.name} from workbench`} onClick={() => showDialog({ kind: "remove-file", fileId: file.fileId })} className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>)}
            </div>}
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground md:px-5"><span>{folders.length} / 100 folders · {files.length} / 500 files</span><span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Private to your account</span></footer>
        </section>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">Removing a workbench item removes only its library reference. It does not delete the underlying My Vault file. Renaming changes the workbench label; the original download name stays unchanged.</p>
      </div>

      {dialog && view && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDialog(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="workbench-dialog-title" className="w-full max-w-lg rounded-t-2xl border border-border bg-background p-5 shadow-xl sm:rounded-2xl">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary">WORKBENCH LIBRARY</p><h2 id="workbench-dialog-title" className="mt-1 text-xl font-semibold">{dialog.kind === "folder" ? "Create a folder" : dialog.kind === "rename-folder" ? "Rename folder" : dialog.kind === "rename-file" ? "Rename workbench label" : dialog.kind === "delete-folder" ? "Delete folder?" : dialog.kind === "remove-file" ? "Remove from workbench?" : dialog.kind === "move-file" ? "Move file" : dialog.kind === "vault" ? "Add from My Vault" : "Upload a file"}</h2></div><button aria-label="Close dialog" disabled={busy} onClick={() => setDialog(null)} className="grid h-11 w-11 place-items-center rounded-lg hover:bg-muted"><X className="h-4 w-4" /></button></div>
          {dialog.kind === "vault" ? <div className="mt-4">
            {vaultLoading ? <div className="h-16 animate-pulse rounded bg-muted" /> : vaultFiles.length === 0 ? <p className="rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground">No available files in My Vault. Upload one there first, or upload directly into this workbench.</p> : <><label htmlFor="vault-file" className="text-sm font-medium">Choose an available file</label><select id="vault-file" value={selectedVaultFile} onChange={event => setSelectedVaultFile(event.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">Select a file…</option>{vaultFiles.map(file => <option key={file.id} value={String(file.id)}>{file.originalName || file.filename} · {formatSize(file.size)}</option>)}</select></>}
            <button disabled={busy || vaultLoading || !selectedVaultFile} onClick={() => void addVaultFile()} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Add selected file</button>
          </div> : dialog.kind === "delete-folder" || dialog.kind === "remove-file" ? <div className="mt-4">
            <p className="text-sm leading-6 text-muted-foreground">{dialog.kind === "delete-folder" ? `Delete “${dialogFolder?.name || ""}”? Folders must be empty before they can be deleted.` : `Remove “${dialogFile?.name || ""}” from this workbench? The underlying file in My Vault will remain untouched.`}</p>
            {dialog.kind === "delete-folder" && childCount > 0 && <p className="mt-3 text-sm font-medium text-amber-700">Move or remove the {childCount} item(s) inside this folder first.</p>}
            <button disabled={busy || (dialog.kind === "delete-folder" && childCount > 0)} onClick={() => dialog.kind === "delete-folder" && dialog.folderId ? void runCommand({ action: "delete_folder", folderId: dialog.folderId }) : dialog.kind === "remove-file" && dialog.fileId ? void runCommand({ action: "remove_file", fileId: dialog.fileId }) : undefined} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-destructive px-4 font-semibold text-destructive-foreground disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} {dialog.kind === "delete-folder" ? "Delete empty folder" : "Remove reference"}</button>
          </div> : dialog.kind === "move-file" ? <div className="mt-4">
            <label htmlFor="move-folder" className="text-sm font-medium">Destination folder</label><select id="move-folder" value={targetFolder} onChange={event => setTargetFolder(event.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">All files (no folder)</option>{parentFolders.map(folder => <option key={folder.id} value={folder.id}>{folderLabel(folder)}</option>)}</select>
            <button disabled={busy || !dialog.fileId} onClick={() => dialog.fileId && void runCommand({ action: "move_file", fileId: dialog.fileId, folderId: targetFolder || null })} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Move file</button>
          </div> : <form className="mt-4" onSubmit={event => { event.preventDefault(); const name = draft.trim(); if (!name) return; if (dialog.kind === "folder") void runCommand({ action: "create_folder", name, parentId: activeFolder }); else if (dialog.kind === "rename-folder" && dialog.folderId) void runCommand({ action: "rename_folder", folderId: dialog.folderId, name }); else if (dialog.kind === "rename-file" && dialog.fileId) void runCommand({ action: "rename_file", fileId: dialog.fileId, name }); }}>
            <label htmlFor="workbench-name" className="text-sm font-medium">{dialog.kind === "folder" ? "Folder name" : "New label"}</label><input id="workbench-name" autoFocus maxLength={120} value={draft} onChange={event => setDraft(event.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-input bg-background px-3 text-sm" placeholder={dialog.kind === "folder" ? "e.g. Product research" : "A clear, short name"} />
            {dialog.kind === "rename-file" && <p className="mt-2 text-xs leading-5 text-muted-foreground">This changes the workbench label only. The original file name used when downloading remains unchanged.</p>}
            <button disabled={busy || !draft.trim()} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
          </form>}
          {error && <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Changes are saved only when the server confirms the library update. If a request is interrupted, check the library before repeating it.</p>
        </section>
      </div>}
    </main>
  );
}