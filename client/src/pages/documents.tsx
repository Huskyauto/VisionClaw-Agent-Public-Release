import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Library, Plus, Trash2, Search, FileText, Database, Loader2, Upload, Sparkles, FileUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiRequest, queryClient, getAuthHeaders, authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DocCollection {
  id: number;
  name: string;
  description: string;
  created_at: string;
  chunk_count: string;
  doc_count: string;
}

interface SearchResult {
  docPath: string;
  title: string;
  collection: string;
  chunkIndex: number;
  content: string;
  context: string;
  score: number;
  tokens: number;
}

interface CollectionStatus {
  collections: Array<{
    id: number;
    name: string;
    description: string;
    documents: number;
    chunks: number;
    embedded: number;
    totalTokens: number;
    embeddingCoverage: number;
  }>;
  totalDocuments: number;
  totalChunks: number;
}

export default function DocumentsPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic" | "hybrid">("keyword");
  const [searchCollection, setSearchCollection] = useState<string>("all");
  const [activeSearch, setActiveSearch] = useState("");
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [showAddDoc, setShowAddDoc] = useState<number | null>(null);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionDesc, setNewCollectionDesc] = useState("");
  const [newDocPath, setNewDocPath] = useState("");
  const [newDocContent, setNewDocContent] = useState("");
  const [newDocContext, setNewDocContext] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const collectionsQuery = useQuery<{ collections: DocCollection[] }>({
    queryKey: ["/api/doc-collections"],
  });
  const collections = collectionsQuery.data?.collections || [];

  const statusQuery = useQuery<CollectionStatus>({
    queryKey: ["/api/doc-collections/status"],
  });

  const searchResultsQuery = useQuery<{ results: SearchResult[]; total: number; query: string; mode: string }>({
    queryKey: ["/api/doc-collections/search", activeSearch, searchMode, searchCollection],
    queryFn: async () => {
      const params = new URLSearchParams({ q: activeSearch, mode: searchMode });
      if (searchCollection !== "all") params.set("collection", searchCollection);
      const res = await authFetch(`/api/doc-collections/search?${params}`);
      return res.json();
    },
    enabled: !!activeSearch,
  });

  const createCollectionMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      apiRequest("POST", "/api/doc-collections", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doc-collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/doc-collections/status"] });
      setShowCreateCollection(false);
      setNewCollectionName("");
      setNewCollectionDesc("");
      toast({ title: "Collection created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/doc-collections/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doc-collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/doc-collections/status"] });
      toast({ title: "Collection deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addDocMutation = useMutation({
    mutationFn: (data: { collectionId: number; docPath: string; content: string; context: string }) =>
      apiRequest("POST", `/api/doc-collections/${data.collectionId}/documents`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doc-collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/doc-collections/status"] });
      setShowAddDoc(null);
      setNewDocPath("");
      setNewDocContent("");
      setNewDocContext("");
      toast({ title: "Document added & indexed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const uploadFileMutation = useMutation({
    mutationFn: async ({ collectionId, file, context }: { collectionId: number; file: File; context: string }) => {
      const CHUNK_SIZE = 2 * 1024 * 1024;
      if (file.size > CHUNK_SIZE) {
        const initRes = await fetch("/api/upload/init", {
          method: "POST",
          credentials: "include",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
        });
        if (!initRes.ok) { const err = await initRes.json(); throw new Error(err.error || "Upload init failed"); }
        const { uploadId } = await initRes.json();
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const slice = file.slice(start, end);
          const chunkForm = new FormData();
          chunkForm.append("chunk", slice);
          chunkForm.append("uploadId", uploadId);
          chunkForm.append("chunkIndex", i.toString());
          chunkForm.append("totalChunks", totalChunks.toString());
          const chunkRes = await fetch("/api/upload/chunk", { method: "POST", body: chunkForm, credentials: "include", headers: getAuthHeaders() });
          if (!chunkRes.ok) { const err = await chunkRes.json(); throw new Error(err.error || `Chunk ${i + 1} failed`); }
        }
        const finalRes = await fetch(`/api/doc-collections/${collectionId}/upload-chunked`, {
          method: "POST",
          credentials: "include",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId, context: context || "" }),
        });
        if (!finalRes.ok) { const err = await finalRes.json(); throw new Error(err.error || "Upload finalize failed"); }
        return finalRes.json();
      }
      const formData = new FormData();
      formData.append("file", file);
      if (context) formData.append("context", context);
      const res = await fetch(`/api/doc-collections/${collectionId}/upload`, { method: "POST", body: formData, credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Upload failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/doc-collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/doc-collections/status"] });
      setShowAddDoc(null);
      setNewDocContext("");
      toast({ title: "File uploaded & indexed", description: `${data.fileName} — ${data.extractedLength?.toLocaleString()} characters extracted` });
    },
    onError: (err: any) => toast({ title: "Upload Error", description: err.message, variant: "destructive" }),
  });

  const embedMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/doc-collections/${id}/embed`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doc-collections/status"] });
      toast({ title: "Embeddings generated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setActiveSearch(searchQuery.trim());
    }
  };

  const status = statusQuery.data;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" data-testid="documents-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-documents-title">
            <Library className="w-6 h-6 text-primary" />
            Document Collections
          </h1>
          <p className="text-muted-foreground mt-1">
            Index documents for intelligent search — keyword, semantic, or hybrid
          </p>
        </div>
        <Dialog open={showCreateCollection} onOpenChange={setShowCreateCollection}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-collection">
              <Plus className="w-4 h-4 mr-2" />
              New Collection
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Document Collection</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Collection name"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                data-testid="input-collection-name"
              />
              <Textarea
                placeholder="Description (optional)"
                value={newCollectionDesc}
                onChange={(e) => setNewCollectionDesc(e.target.value)}
                data-testid="input-collection-description"
              />
              <Button
                onClick={() => createCollectionMutation.mutate({ name: newCollectionName, description: newCollectionDesc })}
                disabled={!newCollectionName.trim() || createCollectionMutation.isPending}
                data-testid="button-submit-collection"
              >
                {createCollectionMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {status && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold" data-testid="text-total-collections">{status.collections.length}</div>
              <p className="text-sm text-muted-foreground">Collections</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold" data-testid="text-total-documents">{status.totalDocuments}</div>
              <p className="text-sm text-muted-foreground">Documents</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold" data-testid="text-total-chunks">{status.totalChunks}</div>
              <p className="text-sm text-muted-foreground">Indexed Chunks</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Search Documents
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="Search your document collections..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1"
              data-testid="input-search-query"
            />
            <Select value={searchMode} onValueChange={(v: any) => setSearchMode(v)}>
              <SelectTrigger className="w-[140px]" data-testid="select-search-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keyword">Keyword</SelectItem>
                <SelectItem value="semantic">Semantic</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
              </SelectContent>
            </Select>
            <Select value={searchCollection} onValueChange={setSearchCollection}>
              <SelectTrigger className="w-[160px]" data-testid="select-search-collection">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Collections</SelectItem>
                {collections.map((c) => (
                  <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSearch} disabled={!searchQuery.trim()} data-testid="button-search">
              <Search className="w-4 h-4 mr-2" />
              Search
            </Button>
          </div>

          {searchResultsQuery.isLoading && (
            <div className="mt-4 space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}

          {searchResultsQuery.data && searchResultsQuery.data.results.length > 0 && (
            <div className="mt-4 space-y-3" data-testid="search-results">
              <p className="text-sm text-muted-foreground">
                {searchResultsQuery.data.total} result{searchResultsQuery.data.total !== 1 ? "s" : ""} for "{searchResultsQuery.data.query}" ({searchResultsQuery.data.mode})
              </p>
              {searchResultsQuery.data.results.map((r, i) => (
                <Card key={`${r.docPath}-${r.chunkIndex}`} className="border-l-4 border-l-primary/40">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-primary" />
                      <span className="font-medium text-sm" data-testid={`text-result-title-${i}`}>{r.title || r.docPath}</span>
                      <Badge variant="outline" className="text-xs">{r.collection}</Badge>
                      <Badge variant="secondary" className="text-xs">Score: {r.score.toFixed(3)}</Badge>
                      <span className="text-xs text-muted-foreground ml-auto">{r.tokens} tokens</span>
                    </div>
                    <p className="text-sm text-foreground/80 whitespace-pre-wrap line-clamp-4" data-testid={`text-result-content-${i}`}>
                      {r.content}
                    </p>
                    {r.context && (
                      <p className="text-xs text-muted-foreground mt-1 italic">{r.context}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {searchResultsQuery.data && searchResultsQuery.data.results.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground" data-testid="text-no-results">No results found.</p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Collections</h2>
        {collectionsQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : collections.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Database className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">No collections yet. Create one to start indexing documents.</p>
            </CardContent>
          </Card>
        ) : (
          collections.map((col) => {
            const statusInfo = status?.collections.find((s) => s.id === col.id);
            return (
              <Card key={col.id} data-testid={`card-collection-${col.id}`}>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium flex items-center gap-2" data-testid={`text-collection-name-${col.id}`}>
                        <Database className="w-4 h-4 text-primary" />
                        {col.name}
                      </h3>
                      {col.description && (
                        <p className="text-sm text-muted-foreground mt-1">{col.description}</p>
                      )}
                      <div className="flex gap-3 mt-2">
                        <Badge variant="secondary">{col.doc_count} docs</Badge>
                        <Badge variant="secondary">{col.chunk_count} chunks</Badge>
                        {statusInfo && (
                          <Badge variant={statusInfo.embeddingCoverage === 100 ? "default" : "outline"}>
                            {statusInfo.embeddingCoverage}% embedded
                          </Badge>
                        )}
                        {statusInfo && (
                          <span className="text-xs text-muted-foreground self-center">{statusInfo.totalTokens} tokens</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Dialog open={showAddDoc === col.id} onOpenChange={(open) => setShowAddDoc(open ? col.id : null)}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" data-testid={`button-add-doc-${col.id}`}>
                            <Upload className="w-4 h-4 mr-1" />
                            Add Doc
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader>
                            <DialogTitle>Add Document to {col.name}</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer"
                              onClick={() => fileInputRef.current?.click()}
                              data-testid="dropzone-doc-upload"
                            >
                              <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.yaml,.yml,.xml,.html,.ts,.js,.py,.tsx,.jsx,.log,.xls,.xlsx,.ppt,.pptx"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    uploadFileMutation.mutate({ collectionId: col.id, file, context: newDocContext });
                                  }
                                  e.target.value = "";
                                }}
                                data-testid="input-file-upload"
                              />
                              <FileUp className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                              <p className="text-sm font-medium">Upload a File</p>
                              <p className="text-xs text-muted-foreground mt-1">PDF, Word, TXT, Markdown, CSV, JSON, YAML, code files — up to 50MB</p>
                              {uploadFileMutation.isPending && (
                                <div className="flex items-center justify-center gap-2 mt-3 text-primary">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  <span className="text-sm">Processing file...</span>
                                </div>
                              )}
                            </div>
                            <div className="relative flex items-center gap-3">
                              <div className="flex-1 border-t border-border" />
                              <span className="text-xs text-muted-foreground">or paste content</span>
                              <div className="flex-1 border-t border-border" />
                            </div>
                            <Input
                              placeholder="Document path / name (e.g. meeting-notes-2026-03.md)"
                              value={newDocPath}
                              onChange={(e) => setNewDocPath(e.target.value)}
                              data-testid="input-doc-path"
                            />
                            <Textarea
                              placeholder="Paste document content here..."
                              value={newDocContent}
                              onChange={(e) => setNewDocContent(e.target.value)}
                              rows={8}
                              data-testid="input-doc-content"
                            />
                            <Input
                              placeholder="Context hint (optional — helps search relevance)"
                              value={newDocContext}
                              onChange={(e) => setNewDocContext(e.target.value)}
                              data-testid="input-doc-context"
                            />
                            <Button
                              onClick={() => addDocMutation.mutate({
                                collectionId: col.id,
                                docPath: newDocPath,
                                content: newDocContent,
                                context: newDocContext,
                              })}
                              disabled={!newDocPath.trim() || !newDocContent.trim() || addDocMutation.isPending}
                              data-testid="button-submit-doc"
                            >
                              {addDocMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
                              Index Document
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => embedMutation.mutate(col.id)}
                        disabled={embedMutation.isPending}
                        data-testid={`button-embed-${col.id}`}
                      >
                        {embedMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                        Embed
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Delete collection "${col.name}" and all its documents?`)) {
                            deleteCollectionMutation.mutate(col.id);
                          }
                        }}
                        data-testid={`button-delete-collection-${col.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
