import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { BookOpen, Plus, Trash2, Edit2, Save, X, Filter, Loader2, FileUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AgentKnowledge, Persona } from "@shared/schema";
import { ErrorState } from "@/components/error-state";

const CATEGORIES = ["decision", "insight", "plan", "learning", "reference"] as const;
const PRIORITIES = [1, 2, 3, 4, 5] as const;

const categoryColors: Record<string, string> = {
  decision: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  insight: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  plan: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  learning: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  reference: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
};

export default function KnowledgePage() {
  const { toast } = useToast();
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterPersona, setFilterPersona] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", content: "", category: "insight", priority: 3, personaId: "" as string, expiresAt: "" });
  const knowledgeFileRef = useRef<HTMLInputElement>(null);

  const personaIdParam = filterPersona !== "all" ? parseInt(filterPersona) : undefined;
  const entriesQuery = useInfiniteQuery({
    queryKey: ["/api/knowledge", personaIdParam],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams();
      if (personaIdParam) params.set("personaId", String(personaIdParam));
      params.set("limit", "100");
      params.set("offset", String(pageParam));
      const res = await apiRequest("GET", `/api/knowledge?${params}`);
      return res.json() as Promise<{ data: AgentKnowledge[]; total: number; hasMore: boolean }>;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((sum, p) => sum + p.data.length, 0);
    },
    initialPageParam: 0,
  });
  const entries = useMemo(() => entriesQuery.data?.pages.flatMap(p => p.data) ?? [], [entriesQuery.data]);
  const totalKnowledge = entriesQuery.data?.pages[0]?.total ?? 0;
  const isLoading = entriesQuery.isLoading;
  const { data: personas = [] } = useQuery<Persona[]>({ queryKey: ["/api/personas"] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/knowledge", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      resetForm();
      toast({ title: "Knowledge entry created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/knowledge/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      resetForm();
      toast({ title: "Knowledge entry updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/knowledge/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      toast({ title: "Knowledge entry deleted" });
    },
  });

  const uploadKnowledgeMutation = useMutation({
    mutationFn: async (file: File) => {
      const CHUNK_SIZE = 2 * 1024 * 1024;
      if (file.size > CHUNK_SIZE) {
        const initRes = await fetch("/api/upload/init", {
          method: "POST", credentials: "include",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
        });
        if (!initRes.ok) { const err = await initRes.json(); throw new Error(err.error || "Upload init failed"); }
        const { uploadId } = await initRes.json();
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        for (let i = 0; i < totalChunks; i++) {
          const chunkForm = new FormData();
          chunkForm.append("chunk", file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size)));
          chunkForm.append("uploadId", uploadId);
          chunkForm.append("chunkIndex", i.toString());
          chunkForm.append("totalChunks", totalChunks.toString());
          const chunkRes = await fetch("/api/upload/chunk", { method: "POST", body: chunkForm, credentials: "include", headers: getAuthHeaders() });
          if (!chunkRes.ok) { const err = await chunkRes.json(); throw new Error(err.error || `Chunk ${i + 1} failed`); }
        }
        const finalRes = await fetch("/api/knowledge/upload-chunked", {
          method: "POST", credentials: "include",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId, category: form.category, priority: form.priority, personaId: form.personaId || undefined }),
        });
        if (!finalRes.ok) { const err = await finalRes.json(); throw new Error(err.error || "Upload finalize failed"); }
        return finalRes.json();
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", form.category);
      formData.append("priority", form.priority.toString());
      if (form.personaId) formData.append("personaId", form.personaId);
      const res = await fetch("/api/knowledge/upload", { method: "POST", body: formData, credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Upload failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      toast({ title: "File imported", description: `${data.entriesCreated} knowledge entries created from ${data.fileName}` });
    },
    onError: (err: any) => toast({ title: "Upload Error", description: err.message, variant: "destructive" }),
  });

  function resetForm() {
    setForm({ title: "", content: "", category: "insight", priority: 3, personaId: "", expiresAt: "" });
    setShowForm(false);
    setEditingId(null);
  }

  function startEdit(entry: AgentKnowledge) {
    setForm({
      title: entry.title,
      content: entry.content,
      category: entry.category,
      priority: entry.priority,
      personaId: entry.personaId?.toString() || "",
      expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString().split("T")[0] : "",
    });
    setEditingId(entry.id);
    setShowForm(true);
  }

  function handleSubmit() {
    const data = {
      title: form.title.trim(),
      content: form.content.trim(),
      category: form.category,
      priority: form.priority,
      source: "user" as const,
      personaId: form.personaId ? parseInt(form.personaId) : null,
      expiresAt: form.expiresAt ? new Date(form.expiresAt) : null,
    };
    if (!data.title || !data.content) {
      toast({ title: "Title and content are required", variant: "destructive" });
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data);
    }
  }

  const filtered = entries.filter((e) => filterCategory === "all" || e.category === filterCategory);

  if (entriesQuery.isError) return <ErrorState title="Knowledge Base Error" message="Failed to load knowledge entries. Please try again." onRetry={() => entriesQuery.refetch()} />;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Knowledge Base</h1>
              <p className="text-sm text-muted-foreground">Persistent facts, decisions, and insights for long-term agent memory</p>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              ref={knowledgeFileRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.yaml,.yml,.xml,.html,.log,.xls,.xlsx,.ppt,.pptx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadKnowledgeMutation.mutate(file);
                e.target.value = "";
              }}
              data-testid="input-knowledge-file"
            />
            <Button
              variant="outline"
              onClick={() => knowledgeFileRef.current?.click()}
              disabled={uploadKnowledgeMutation.isPending}
              data-testid="button-upload-knowledge"
            >
              {uploadKnowledgeMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileUp className="w-4 h-4 mr-1" />}
              Upload File
            </Button>
            <Button
              onClick={() => { resetForm(); setShowForm(!showForm); }}
              data-testid="button-add-knowledge"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Entry
            </Button>
          </div>
        </div>

        {showForm && (
          <Card data-testid="card-knowledge-form">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                {editingId ? "Edit Knowledge Entry" : "New Knowledge Entry"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                data-testid="input-knowledge-title"
              />
              <Textarea
                placeholder="Content — facts, decisions, plans, or insights..."
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={4}
                data-testid="input-knowledge-content"
              />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger data-testid="select-knowledge-category">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={form.priority.toString()} onValueChange={(v) => setForm({ ...form, priority: parseInt(v) })}>
                  <SelectTrigger data-testid="select-knowledge-priority">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p.toString()}>P{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={form.personaId || "none"} onValueChange={(v) => setForm({ ...form, personaId: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="select-knowledge-persona">
                    <SelectValue placeholder="Persona" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">All Personas</SelectItem>
                    {personas.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                  placeholder="Expires (optional)"
                  data-testid="input-knowledge-expires"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={resetForm} data-testid="button-cancel-knowledge">
                  <X className="w-4 h-4 mr-1" /> Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-knowledge"
                >
                  <Save className="w-4 h-4 mr-1" /> {editingId ? "Update" : "Save"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-3">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-[160px]" data-testid="select-filter-category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterPersona} onValueChange={setFilterPersona}>
            <SelectTrigger className="w-[160px]" data-testid="select-filter-persona">
              <SelectValue placeholder="Persona" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Personas</SelectItem>
              {personas.map((p) => (
                <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground" data-testid="text-entry-count">
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BookOpen className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground" data-testid="text-empty-state">No knowledge entries yet. Add one to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((entry) => {
              const persona = personas.find((p) => p.id === entry.personaId);
              return (
                <Card key={entry.id} data-testid={`card-knowledge-${entry.id}`}>
                  <CardContent className="pt-4 pb-4 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-medium text-foreground" data-testid={`text-knowledge-title-${entry.id}`}>{entry.title}</h3>
                          <Badge variant="outline" className={`text-xs ${categoryColors[entry.category] || ""}`} data-testid={`badge-knowledge-category-${entry.id}`}>
                            {entry.category}
                          </Badge>
                          <Badge variant="outline" className="text-xs" data-testid={`badge-knowledge-priority-${entry.id}`}>
                            P{entry.priority}
                          </Badge>
                          {persona && (
                            <Badge variant="secondary" className="text-xs" data-testid={`badge-knowledge-persona-${entry.id}`}>
                              {persona.name}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {entry.source}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid={`text-knowledge-content-${entry.id}`}>
                          {entry.content}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span>Created: {new Date(entry.createdAt).toLocaleDateString()}</span>
                          {entry.expiresAt && (
                            <span className={new Date(entry.expiresAt) < new Date() ? "text-red-500" : ""}>
                              Expires: {new Date(entry.expiresAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => startEdit(entry)}
                          data-testid={`button-edit-knowledge-${entry.id}`}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => deleteMutation.mutate(entry.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-knowledge-${entry.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {entriesQuery.hasNextPage && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => entriesQuery.fetchNextPage()}
                  disabled={entriesQuery.isFetchingNextPage}
                  data-testid="button-load-more-knowledge"
                >
                  {entriesQuery.isFetchingNextPage ? (
                    <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Loading...</>
                  ) : (
                    <>Load More ({entries.length} of {totalKnowledge})</>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
