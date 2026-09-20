import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { Brain, Plus, Trash2, Calendar, Tag, Clock, BookOpen, Flame, Thermometer, Snowflake, Search, Pencil, Loader2, FileUp, Layers, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { MemoryEntry, DailyNote, Persona } from "@shared/schema";
import { cn } from "@/lib/utils";
import { ErrorState } from "@/components/error-state";
import { format, formatDistanceToNow } from "date-fns";

const CATEGORY_COLORS: Record<string, string> = {
  preference: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  relationship: "bg-green-500/10 text-green-600 dark:text-green-400",
  milestone: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  status: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

const TIER_CONFIG = {
  hot: { label: "Hot", icon: Flame, className: "bg-red-500/10 text-red-500" },
  warm: { label: "Warm", icon: Thermometer, className: "bg-orange-500/10 text-orange-500" },
  cold: { label: "Cold", icon: Snowflake, className: "bg-cyan-500/10 text-cyan-500" },
};

function getRecencyTier(lastAccessed: string | Date): "hot" | "warm" | "cold" {
  const daysSince = (Date.now() - new Date(lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 7) return "hot";
  if (daysSince <= 30) return "warm";
  return "cold";
}

function MemoryEntryCard({ entry, onDelete, onEdit }: { entry: MemoryEntry; onDelete: () => void; onEdit: () => void }) {
  const tier = getRecencyTier(entry.lastAccessed);
  const tierInfo = TIER_CONFIG[tier];
  const TierIcon = tierInfo.icon;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card group" data-testid={`card-memory-${entry.id}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Badge variant="secondary" className={cn("text-xs py-0 h-5", CATEGORY_COLORS[entry.category])}>
            <Tag className="w-2.5 h-2.5 mr-1" />
            {entry.category}
          </Badge>
          <Badge variant="outline" className={cn("text-xs py-0 h-5 gap-1", tierInfo.className)} data-testid={`badge-tier-${entry.id}`}>
            <TierIcon className="w-2.5 h-2.5" />
            {tierInfo.label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
          </span>
        </div>
        <p className="text-sm">{entry.fact}</p>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {format(new Date(entry.lastAccessed), "MMM d, yyyy")}
          </span>
          <span>Source: {entry.source}</span>
          {(entry as any).accessCount > 0 && (
            <span>{(entry as any).accessCount} access{(entry as any).accessCount !== 1 ? "es" : ""}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 invisible group-hover:visible transition-opacity">
        <button
          className="p-1.5 rounded text-muted-foreground"
          onClick={onEdit}
          data-testid={`button-edit-memory-${entry.id}`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1.5 rounded text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          data-testid={`button-delete-memory-${entry.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function DailyNoteCard({ note }: { note: DailyNote }) {
  return (
    <Card data-testid={`card-daily-note-${note.date}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          {format(new Date(note.date + "T12:00:00"), "EEEE, MMMM d, yyyy")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="text-sm whitespace-pre-wrap font-mono text-muted-foreground leading-relaxed">{note.content}</pre>
      </CardContent>
    </Card>
  );
}

export default function MemoryPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newFact, setNewFact] = useState("");
  const [newCategory, setNewCategory] = useState("preference");
  const [searchQuery, setSearchQuery] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MemoryEntry | null>(null);
  const [editFact, setEditFact] = useState("");
  const [editCategory, setEditCategory] = useState("preference");
  const memoryFileRef = useRef<HTMLInputElement>(null);

  const { data: activePersona } = useQuery<Persona | null>({ queryKey: ["/api/personas/active"] });
  const personaId = activePersona?.id;
  const memoriesQuery = useInfiniteQuery({
    queryKey: ["/api/memory", personaId],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams();
      if (personaId) params.set("personaId", String(personaId));
      params.set("limit", "100");
      params.set("offset", String(pageParam));
      const res = await apiRequest("GET", `/api/memory?${params}`);
      return res.json() as Promise<{ data: MemoryEntry[]; total: number; hasMore: boolean }>;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((sum, p) => sum + p.data.length, 0);
    },
    initialPageParam: 0,
  });
  const memories = useMemo(() => memoriesQuery.data?.pages.flatMap(p => p.data) ?? [], [memoriesQuery.data]);
  const memoriesLoading = memoriesQuery.isLoading;
  const totalMemories = memoriesQuery.data?.pages[0]?.total ?? 0;
  const { data: dailyNotes = [], isLoading: notesLoading } = useQuery<DailyNote[]>({
    queryKey: ["/api/daily-notes", personaId],
    queryFn: async () => {
      const url = personaId ? `/api/daily-notes?personaId=${personaId}` : "/api/daily-notes";
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: { fact: string; category: string; source: string; personaId: number | null }) =>
      apiRequest("POST", "/api/memory", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/memory"] });
      setDialogOpen(false);
      setNewFact("");
      setNewCategory("preference");
      toast({ description: "Memory added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/memory/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/memory"] });
      toast({ description: "Memory removed" });
    },
  });

  const editMutation = useMutation({
    mutationFn: (data: { id: number; fact: string; category: string }) =>
      apiRequest("PATCH", `/api/memory/${data.id}`, { fact: data.fact, category: data.category }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/memory"] });
      setEditDialogOpen(false);
      setEditingEntry(null);
      toast({ description: "Memory updated" });
    },
  });

  const uploadMemoryMutation = useMutation({
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
        const finalRes = await fetch("/api/memory/upload-chunked", {
          method: "POST", credentials: "include",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId, category: newCategory, personaId: personaId || undefined }),
        });
        if (!finalRes.ok) { const err = await finalRes.json(); throw new Error(err.error || "Upload finalize failed"); }
        return finalRes.json();
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", newCategory);
      if (personaId) formData.append("personaId", personaId.toString());
      const res = await fetch("/api/memory/upload", { method: "POST", body: formData, credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Upload failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/memory"] });
      toast({ description: `${data.memoriesCreated} memories imported from ${data.fileName}` });
    },
    onError: (err: any) => toast({ title: "Upload Error", description: err.message, variant: "destructive" }),
  });

  const openEditDialog = (entry: MemoryEntry) => {
    setEditingEntry(entry);
    setEditFact(entry.fact);
    setEditCategory(entry.category);
    setEditDialogOpen(true);
  };

  if (memoriesQuery.isError) return <ErrorState title="Memory Error" message="Failed to load memories. Please try again." onRetry={() => memoriesQuery.refetch()} />;

  const filteredMemories = searchQuery.trim()
    ? memories.filter((m) => m.fact.toLowerCase().includes(searchQuery.toLowerCase()) || m.category.toLowerCase().includes(searchQuery.toLowerCase()))
    : memories;

  const grouped = filteredMemories.reduce<Record<string, MemoryEntry[]>>((acc, m) => {
    if (!acc[m.category]) acc[m.category] = [];
    acc[m.category].push(m);
    return acc;
  }, {});

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
              <Brain className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Memory</h1>
              <p className="text-sm text-muted-foreground">
                {memories.length} durable fact{memories.length !== 1 ? "s" : ""} stored
                {activePersona ? ` for ${activePersona.name}` : ""}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              ref={memoryFileRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.xls,.xlsx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMemoryMutation.mutate(file);
                e.target.value = "";
              }}
              data-testid="input-memory-file"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => memoryFileRef.current?.click()}
              disabled={uploadMemoryMutation.isPending}
              data-testid="button-upload-memory"
            >
              {uploadMemoryMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileUp className="w-4 h-4 mr-1" />}
              Upload File
            </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-memory">
                <Plus className="w-4 h-4 mr-1" /> Add Memory
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add Durable Fact</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label className="text-sm">Fact</Label>
                  <Textarea
                    value={newFact}
                    onChange={(e) => setNewFact(e.target.value)}
                    placeholder="e.g. User prefers TypeScript over JavaScript"
                    rows={3}
                    data-testid="input-memory-fact"
                    className="mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-sm">Category</Label>
                  <Select value={newCategory} onValueChange={setNewCategory}>
                    <SelectTrigger className="mt-1" data-testid="select-memory-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preference">Preference</SelectItem>
                      <SelectItem value="relationship">Relationship</SelectItem>
                      <SelectItem value="milestone">Milestone</SelectItem>
                      <SelectItem value="status">Status</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  disabled={!newFact.trim() || createMutation.isPending}
                  data-testid="button-save-memory"
                  onClick={() => createMutation.mutate({
                    fact: newFact.trim(),
                    category: newCategory,
                    source: "manual",
                    personaId: activePersona?.id ?? null,
                  })}
                >
                  Save Memory
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-memory"
          />
        </div>

        <Tabs defaultValue="unified" className="w-full">
          <TabsList className="w-full" data-testid="tabs-memory">
            <TabsTrigger value="unified" className="flex-1" data-testid="tab-unified">
              <Layers className="w-3.5 h-3.5 mr-1.5" />
              Unified
              <Badge variant="secondary" className="ml-2 text-[10px] px-1 py-0">R122</Badge>
            </TabsTrigger>
            <TabsTrigger value="facts" className="flex-1" data-testid="tab-facts">
              <Brain className="w-3.5 h-3.5 mr-1.5" />
              Durable Facts ({filteredMemories.length})
            </TabsTrigger>
            <TabsTrigger value="daily" className="flex-1" data-testid="tab-daily-notes">
              <BookOpen className="w-3.5 h-3.5 mr-1.5" />
              Daily Notes ({dailyNotes.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="unified" className="mt-4">
            <UnifiedMemoryPanel />
          </TabsContent>

          <TabsContent value="facts" className="mt-4 space-y-4">
            {memoriesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
              </div>
            ) : filteredMemories.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Brain className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  {searchQuery.trim() ? (
                    <p>No memories match "{searchQuery}"</p>
                  ) : (
                    <>
                      <p>No memories yet.</p>
                      <p className="text-xs mt-1">The agent learns from conversations, or you can add facts manually.</p>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                {Object.entries(grouped).map(([category, entries]) => (
                  <div key={category}>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-0.5">
                      {category} ({entries.length})
                    </h3>
                    <div className="space-y-2">
                      {entries.map((entry) => (
                        <MemoryEntryCard key={entry.id} entry={entry} onDelete={() => deleteMutation.mutate(entry.id)} onEdit={() => openEditDialog(entry)} />
                      ))}
                    </div>
                  </div>
                ))}
                {memoriesQuery.hasNextPage && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => memoriesQuery.fetchNextPage()}
                      disabled={memoriesQuery.isFetchingNextPage}
                      data-testid="button-load-more-memories"
                    >
                      {memoriesQuery.isFetchingNextPage ? (
                        <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Loading...</>
                      ) : (
                        <>Load More ({memories.length} of {totalMemories})</>
                      )}
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="daily" className="mt-4 space-y-4">
            {notesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full rounded-lg" />)}
              </div>
            ) : dailyNotes.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No daily notes yet.</p>
                  <p className="text-xs mt-1">Activity logs are recorded automatically as you chat.</p>
                </CardContent>
              </Card>
            ) : (
              dailyNotes.map((note) => (
                <DailyNoteCard key={note.id} note={note} />
              ))
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingEntry(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Memory</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-sm">Fact</Label>
                <Textarea
                  value={editFact}
                  onChange={(e) => setEditFact(e.target.value)}
                  rows={3}
                  data-testid="input-edit-memory-fact"
                  className="mt-1 text-sm"
                />
              </div>
              <div>
                <Label className="text-sm">Category</Label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger className="mt-1" data-testid="select-edit-memory-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="preference">Preference</SelectItem>
                    <SelectItem value="relationship">Relationship</SelectItem>
                    <SelectItem value="milestone">Milestone</SelectItem>
                    <SelectItem value="status">Status</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                disabled={!editFact.trim() || editMutation.isPending}
                data-testid="button-save-edit-memory"
                onClick={() => {
                  if (editingEntry) {
                    editMutation.mutate({ id: editingEntry.id, fact: editFact.trim(), category: editCategory });
                  }
                }}
              >
                Save Changes
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

// R122 Unified Memory Context — cross-source timeline panel.
const UNIFIED_SOURCES = [
  "memory_entries",
  "agent_knowledge",
  "conversation_facts",
  "mind_tickets",
  "procedure_edits",
  "agent_runs",
  "agent_trace_spans",
  "graph_memory",
  "knowledge_triples",
  "mind_events",
  "conversations",
] as const;
type UnifiedSrc = typeof UNIFIED_SOURCES[number];

const SOURCE_COLORS: Record<UnifiedSrc, string> = {
  memory_entries:    "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  agent_knowledge:   "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30",
  conversation_facts:"bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  mind_tickets:      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  procedure_edits:   "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
  agent_runs:        "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
  agent_trace_spans: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30",
  graph_memory:      "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  knowledge_triples: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/30",
  mind_events:       "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  conversations:     "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/30",
};

interface UnifiedItem {
  source: UnifiedSrc;
  id: number;
  tenantId: number;
  ts: string;
  title: string;
  body: string;
  category?: string | null;
  status?: string | null;
  personaId?: number | null;
  link?: string;
}
interface UnifiedResponse {
  tenantId: number;
  query: string | null;
  sources: UnifiedSrc[];
  sinceDays: number;
  limit: number;
  totals: Record<UnifiedSrc, number>;
  counts: Record<UnifiedSrc, number>;
  items: UnifiedItem[];
  truncated: boolean;
}

function UnifiedMemoryPanel() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sinceDays, setSinceDays] = useState(90);
  const [activeSource, setActiveSource] = useState<UnifiedSrc | null>(null);

  // Debounce the search input
  useMemo(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams();
  if (debouncedQ) params.set("q", debouncedQ);
  params.set("sinceDays", String(sinceDays));
  params.set("limit", "200");
  if (activeSource) params.set("sources", activeSource);

  const { data, isLoading, error } = useQuery<UnifiedResponse>({
    queryKey: ["/api/memory/unified", debouncedQ, sinceDays, activeSource],
    queryFn: async () => {
      const r = await fetch(`/api/memory/unified?${params.toString()}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!r.ok) throw new Error(`unified-memory ${r.status}`);
      return r.json();
    },
    staleTime: 30_000,
  });

  return (
    <div className="space-y-4" data-testid="panel-unified-memory">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search every memory surface — facts, knowledge, runs, tickets, edits, triples..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
            data-testid="input-unified-search"
          />
        </div>
        <Select value={String(sinceDays)} onValueChange={(v) => setSinceDays(Number(v))}>
          <SelectTrigger className="w-full sm:w-40" data-testid="select-unified-since">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
            <SelectItem value="3650">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Per-source totals + filter pills */}
      <Card>
        <CardContent className="p-3 flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveSource(null)}
            className={cn(
              "px-2 py-1 rounded-md text-xs font-medium border transition-colors",
              activeSource === null ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted border-border",
            )}
            data-testid="pill-source-all"
          >
            All ({data?.items.length ?? 0})
          </button>
          {UNIFIED_SOURCES.map((s) => {
            const filtered = data?.counts?.[s] ?? 0;
            const total = data?.totals?.[s] ?? 0;
            return (
              <button
                key={s}
                onClick={() => setActiveSource(activeSource === s ? null : s)}
                className={cn(
                  "px-2 py-1 rounded-md text-xs font-medium border transition-colors",
                  activeSource === s ? SOURCE_COLORS[s] + " ring-2 ring-offset-1" : SOURCE_COLORS[s],
                )}
                data-testid={`pill-source-${s}`}
                title={`${total} total in window · ${filtered} matching filter`}
              >
                {s.replace(/_/g, " ")} <span className="opacity-70">{filtered}/{total}</span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {error ? (
        <ErrorState title="Could not load unified memory" message={String((error as any)?.message || error)} />
      ) : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {debouncedQ ? `No memory items match "${debouncedQ}" in the last ${sinceDays} days.` : "No memory activity in the selected window."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="list-unified-items">
          {data.items.map((it) => (
            <Card
              key={`${it.source}-${it.id}`}
              className="hover:bg-muted/30 transition-colors"
              data-testid={`item-unified-${it.source}-${it.id}`}
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold border shrink-0 mt-0.5", SOURCE_COLORS[it.source])}>
                    {it.source.replace(/_/g, " ")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-semibold text-sm" data-testid={`text-title-${it.source}-${it.id}`}>{it.title}</span>
                      {it.status && <Badge variant="outline" className="text-[10px] px-1 py-0">{it.status}</Badge>}
                      {it.category && it.category !== it.title && <Badge variant="secondary" className="text-[10px] px-1 py-0">{it.category}</Badge>}
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        {formatDistanceToNow(new Date(it.ts), { addSuffix: true })}
                      </span>
                    </div>
                    {it.body && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-3" data-testid={`text-body-${it.source}-${it.id}`}>
                        {it.body}
                      </p>
                    )}
                    {it.link && (
                      <Link href={it.link}>
                        <a className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-1" data-testid={`link-open-${it.source}-${it.id}`}>
                          Open <ExternalLink className="w-3 h-3" />
                        </a>
                      </Link>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {data.truncated && (
            <div className="text-center text-xs text-muted-foreground py-2" data-testid="text-truncated">
              Showing top {data.items.length}. Narrow with search or source filter to see more.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
