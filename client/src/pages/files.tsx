import { useState, useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, authFetch } from "@/lib/queryClient";
import { uploadFile } from "@/lib/upload";
import {
  Upload, File, FileText, Image, Trash2, Download, Search,
  FolderOpen, HardDrive, Grid, List, X, SortAsc, SortDesc,
  Filter, ArrowUpDown, Calendar, Weight, ExternalLink, Cloud,
} from "lucide-react";

interface TenantFile {
  id: number;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string | null;
  driveUrl: string | null;
  createdAt: string;
}

type SortField = "name" | "date" | "size" | "type";
type SortDir = "asc" | "desc";
type TypeFilter = "all" | "images" | "documents" | "data" | "text";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image;
  if (mimeType === "application/pdf") return FileText;
  return File;
}

function getFileColor(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "text-blue-500";
  if (mimeType === "application/pdf") return "text-red-500";
  if (mimeType.includes("json")) return "text-yellow-500";
  if (mimeType.includes("csv") || mimeType.includes("spreadsheet")) return "text-green-500";
  if (mimeType.includes("markdown") || mimeType.includes("text")) return "text-violet-500";
  return "text-muted-foreground";
}

function getFileCategory(mimeType: string): TypeFilter {
  if (mimeType.startsWith("image/")) return "images";
  if (mimeType === "application/pdf") return "documents";
  if (mimeType.includes("json") || mimeType.includes("csv")) return "data";
  return "text";
}

function getFileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "FILE";
}

const TYPE_FILTERS: { value: TypeFilter; label: string; icon: any }[] = [
  { value: "all", label: "All Files", icon: FolderOpen },
  { value: "images", label: "Images", icon: Image },
  { value: "documents", label: "PDFs", icon: FileText },
  { value: "data", label: "Data", icon: File },
  { value: "text", label: "Text", icon: FileText },
];

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
  { value: "type", label: "Type" },
];

export default function FilesPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: files = [], isLoading } = useQuery<TenantFile[]>({
    queryKey: ["/api/tenant/files"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileId: number) => {
      await apiRequest("DELETE", `/api/tenant/files/${fileId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/files"] });
      toast({ title: "File deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const handleUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (const file of Array.from(fileList)) {
      try {
        await uploadFile(file);
        successCount++;
      } catch (err: any) {
        failCount++;
        toast({
          title: `Failed to upload ${file.name}`,
          description: err.message,
          variant: "destructive",
        });
      }
    }

    setUploading(false);
    if (successCount > 0) {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/files"] });
      toast({
        title: `${successCount} file${successCount > 1 ? "s" : ""} uploaded`,
        description: failCount > 0 ? `${failCount} failed` : undefined,
      });
    }
  }, [toast]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  const handleDownload = useCallback(async (file: TenantFile) => {
    try {
      const res = await authFetch(`/api/tenant/files/${file.id}`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.originalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  }, [toast]);

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "name" ? "asc" : "desc");
    }
  }, [sortField]);

  const processedFiles = useMemo(() => {
    let result = [...files];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.originalName.toLowerCase().includes(q) ||
          f.mimeType.toLowerCase().includes(q) ||
          getFileExtension(f.originalName).toLowerCase().includes(q)
      );
    }

    if (typeFilter !== "all") {
      result = result.filter((f) => getFileCategory(f.mimeType) === typeFilter);
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.originalName.localeCompare(b.originalName);
          break;
        case "date":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "size":
          cmp = a.size - b.size;
          break;
        case "type":
          cmp = a.mimeType.localeCompare(b.mimeType);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [files, searchQuery, typeFilter, sortField, sortDir]);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const typeCounts = useMemo(() => {
    const counts: Record<TypeFilter, number> = { all: files.length, images: 0, documents: 0, data: 0, text: 0 };
    files.forEach((f) => { counts[getFileCategory(f.mimeType)]++; });
    return counts;
  }, [files]);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-files-title">
              <FolderOpen className="w-6 h-6 text-primary" />
              My Vault
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your personal file vault — auto-synced to Google Drive
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs" data-testid="text-file-count">
              {files.length} file{files.length !== 1 ? "s" : ""} &middot; {formatFileSize(totalSize)}
            </Badge>
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              data-testid="button-upload-file"
            >
              <Upload className="w-4 h-4 mr-2" />
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.txt,.md,.csv,.json"
            onChange={(e) => handleUpload(e.target.files)}
            data-testid="input-file-upload"
          />
        </div>

        <div
          className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/30"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid="dropzone-upload"
        >
          <Upload className={`w-8 h-8 mx-auto mb-2 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
          <p className="font-medium text-sm">
            {isDragging ? "Drop files here" : "Drag & drop files here, or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            PNG, JPG, GIF, WebP, PDF, Word, Excel, PowerPoint, TXT, MD, CSV, JSON — Max 50MB each
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" data-testid="filter-type-bar">
          {TYPE_FILTERS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTypeFilter(value)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                typeFilter === value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              data-testid={`button-filter-${value}`}
            >
              <Icon className="w-3 h-3" />
              {label}
              <span className={`ml-0.5 ${typeFilter === value ? "text-primary-foreground/70" : "text-muted-foreground/60"}`}>
                {typeCounts[value]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by filename, type, or extension..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-files"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {SORT_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => toggleSort(value)}
                className={`inline-flex items-center gap-1 px-2 py-1.5 rounded text-[11px] font-medium transition-colors ${
                  sortField === value
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                data-testid={`button-sort-${value}`}
              >
                {label}
                {sortField === value && (
                  sortDir === "asc" ? <SortAsc className="w-3 h-3" /> : <SortDesc className="w-3 h-3" />
                )}
              </button>
            ))}
          </div>
          <div className="flex border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              data-testid="button-view-grid"
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              data-testid="button-view-list"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading files...</div>
        ) : processedFiles.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground font-medium">
                {searchQuery || typeFilter !== "all" ? "No files match your filters" : "No files uploaded yet"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchQuery || typeFilter !== "all"
                  ? "Try adjusting your search or filter"
                  : "Upload images, documents, and other assets to build your knowledge base"}
              </p>
              {(searchQuery || typeFilter !== "all") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => { setSearchQuery(""); setTypeFilter("all"); }}
                  data-testid="button-clear-filters"
                >
                  Clear Filters
                </Button>
              )}
            </CardContent>
          </Card>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {processedFiles.map((file) => {
              const IconComponent = getFileIcon(file.mimeType);
              const colorClass = getFileColor(file.mimeType);
              return (
                <Card key={file.id} className="group hover:border-primary/30 transition-colors" data-testid={`card-file-${file.id}`}>
                  <CardContent className="p-3 space-y-2">
                    <div className="w-full aspect-square rounded-lg bg-muted/50 flex items-center justify-center relative overflow-hidden">
                      {file.mimeType.startsWith("image/") ? (
                        <img
                          src={`/uploads/${file.filename}`}
                          alt={file.originalName}
                          className="w-full h-full object-cover rounded-lg"
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                            (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                          }}
                        />
                      ) : null}
                      <div className={`flex flex-col items-center ${file.mimeType.startsWith("image/") ? "hidden" : ""}`}>
                        <IconComponent className={`w-10 h-10 ${colorClass}`} />
                        <span className="text-[9px] font-bold text-muted-foreground mt-1">
                          {getFileExtension(file.originalName)}
                        </span>
                      </div>
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        {file.driveUrl && (
                          <a
                            href={file.driveUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="p-2 bg-blue-500/30 rounded-lg hover:bg-blue-500/50 transition-colors"
                            data-testid={`button-drive-${file.id}`}
                            title="Open in Google Drive"
                          >
                            <Cloud className="w-4 h-4 text-white" />
                          </a>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(file); }}
                          className="p-2 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                          data-testid={`button-download-${file.id}`}
                        >
                          <Download className="w-4 h-4 text-white" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(file.id); }}
                          className="p-2 bg-red-500/30 rounded-lg hover:bg-red-500/50 transition-colors"
                          data-testid={`button-delete-${file.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-white" />
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium truncate" title={file.originalName}>
                        {file.originalName}
                      </p>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span>{formatFileSize(file.size)}</span>
                        <span className="w-0.5 h-0.5 rounded-full bg-muted-foreground/30" />
                        <span>{new Date(file.createdAt).toLocaleDateString()}</span>
                        {file.driveUrl && (
                          <>
                            <span className="w-0.5 h-0.5 rounded-full bg-muted-foreground/30" />
                            <span className="text-blue-500 flex items-center gap-0.5">
                              <Cloud className="w-2.5 h-2.5" /> Drive
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="grid grid-cols-[1fr_80px_100px_100px] gap-2 px-4 py-2 border-b border-border text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <span>Name</span>
                <span>Size</span>
                <span>Date</span>
                <span className="text-right">Actions</span>
              </div>
              <div className="divide-y divide-border">
                {processedFiles.map((file) => {
                  const IconComponent = getFileIcon(file.mimeType);
                  const colorClass = getFileColor(file.mimeType);
                  return (
                    <div
                      key={file.id}
                      className="grid grid-cols-[1fr_80px_100px_100px] gap-2 items-center px-4 py-2.5 hover:bg-muted/30 transition-colors group"
                      data-testid={`row-file-${file.id}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-7 h-7 rounded bg-muted/50 flex items-center justify-center shrink-0`}>
                          <IconComponent className={`w-3.5 h-3.5 ${colorClass}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{file.originalName}</p>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[8px] px-1 py-0 h-3 font-mono">
                              {getFileExtension(file.originalName)}
                            </Badge>
                            {file.storageKey && (
                              <Badge variant="outline" className="text-[8px] px-1 py-0 h-3 text-emerald-500 border-emerald-500/30">
                                Secure
                              </Badge>
                            )}
                            {file.driveUrl && (
                              <Badge variant="outline" className="text-[8px] px-1 py-0 h-3 text-blue-500 border-blue-500/30">
                                <Cloud className="w-2 h-2 mr-0.5" /> Drive
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                      <span className="text-xs text-muted-foreground">{new Date(file.createdAt).toLocaleDateString()}</span>
                      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {file.driveUrl && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-blue-500 hover:text-blue-600"
                            onClick={() => window.open(file.driveUrl!, "_blank")}
                            data-testid={`button-drive-${file.id}`}
                            title="Open in Google Drive"
                          >
                            <Cloud className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleDownload(file)}
                          data-testid={`button-download-${file.id}`}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => deleteMutation.mutate(file.id)}
                          data-testid={`button-delete-${file.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {processedFiles.length > 0 && (
          <p className="text-[10px] text-muted-foreground text-center">
            Showing {processedFiles.length} of {files.length} files &middot; Secured with per-tenant isolation &middot; Auto-synced to Google Drive
          </p>
        )}
      </div>
    </div>
  );
}
