import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { Brain, Plus, Trash2, Calendar, Tag, Clock, BookOpen, Flame, Thermometer, Snowflake, Search, Pencil, Loader2, FileUp } from "lucide-react";
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

        <Tabs defaultValue="facts" className="w-full">
          <TabsList className="w-full" data-testid="tabs-memory">
            <TabsTrigger value="facts" className="flex-1" data-testid="tab-facts">
              <Brain className="w-3.5 h-3.5 mr-1.5" />
              Durable Facts ({filteredMemories.length})
            </TabsTrigger>
            <TabsTrigger value="daily" className="flex-1" data-testid="tab-daily-notes">
              <BookOpen className="w-3.5 h-3.5 mr-1.5" />
              Daily Notes ({dailyNotes.length})
            </TabsTrigger>
          </TabsList>

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
