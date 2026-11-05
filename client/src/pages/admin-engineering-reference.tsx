import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { engineeringCategories, engineeringLibraryWriteSchema, engineeringVerdicts, verdictLabels } from "@shared/engineering-reference";
import type { EngineeringLibrary, EngineeringNote, EngineeringReference, EngineeringReferenceResponse } from "@shared/engineering-reference";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowUpRight, BookOpen, CircleAlert, FilePlus2, Link2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from "lucide-react";

const BASE = "/api/admin/engineering-reference";
const queryKey = [BASE];
type NoteDraft = Omit<EngineeringNote, "id"> & { id: string };

const emptyNote = (relatedReferenceId?: string): NoteDraft => ({
  id: crypto.randomUUID(),
  question: "",
  answer: "",
  category: "Agents",
  sourceUrl: "",
  relatedReferenceId,
});

function safeSource(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Not recorded";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

export default function AdminEngineeringReferencePage() {
  const { tenant, isChecking } = useAuth();
  const isOwner = !isChecking && tenant?.id === 1 && tenant?.isAdmin === true;
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [verdict, setVerdict] = useState("");
  const [selectedReference, setSelectedReference] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [form, setForm] = useState<NoteDraft | null>(null);
  const [editBase, setEditBase] = useState<EngineeringLibrary | null>(null);
  const [deleteBase, setDeleteBase] = useState<EngineeringLibrary | null>(null);
  const [formError, setFormError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reloadPending, setReloadPending] = useState(false);

  const query = useQuery<EngineeringReferenceResponse>({
    queryKey,
    enabled: isOwner,
    queryFn: async () => {
      const response = await apiRequest("GET", BASE);
      return response.json();
    },
  });

  // Never retain or show an owner's cached library after authorization changes.
  useEffect(() => {
    if (!isOwner) {
      queryClient.removeQueries({ queryKey });
      setForm(null);
      setEditBase(null);
      setDeleteBase(null);
      setSelectedNote(null);
      setSelectedReference(null);
      setDeleteId(null);
      setConflict(false);
    }
  }, [isOwner]);

  const references = query.data?.references ?? [];
  const notes = query.data?.notes ?? [];
  const filteredReferences = useMemo(() => references.filter(item => {
    const matchesCategory = !category || item.category === category;
    const matchesVerdict = !verdict || item.verdict === verdict;
    const haystack = [item.question, item.answer, item.guidance, item.category, item.verdict, item.nextCheck, ...item.evidence.flatMap(e => [e.path, e.detail])].join(" ").toLowerCase();
    return matchesCategory && matchesVerdict && haystack.includes(search.trim().toLowerCase());
  }), [references, category, verdict, search]);
  const filteredNotes = useMemo(() => notes.filter(item => {
    const matchesCategory = !category || item.category === category;
    const matchesRelatedVerdict = !verdict || (references.find(ref => ref.id === item.relatedReferenceId)?.verdict === verdict);
    const related = references.find(ref => ref.id === item.relatedReferenceId);
    const haystack = [item.question, item.answer, item.sourceUrl, item.category, related?.question ?? ""].join(" ").toLowerCase();
    return matchesCategory && matchesRelatedVerdict && haystack.includes(search.trim().toLowerCase());
  }), [notes, references, category, verdict, search]);
  const activeReference = references.find(item => item.id === selectedReference) ?? null;
  const activeNote = notes.find(item => item.id === selectedNote) ?? null;

  const saveLibrary = useMutation({
    mutationFn: async (payload: { version: number; notes: EngineeringNote[] }) => {
      const response = await apiRequest("PUT", BASE, payload);
      if (response.status === 409) {
        const error = new Error("This notebook changed elsewhere. Your draft is still here.");
        (error as Error & { status?: number }).status = 409;
        throw error;
      }
      return (await response.json()) as { version: number; notes: EngineeringNote[] };
    },
    onSuccess: result => {
      const current = queryClient.getQueryData<EngineeringReferenceResponse>(queryKey);
      queryClient.setQueryData<EngineeringReferenceResponse>(queryKey, {
        ...(current ?? { references: [], scope: "" }),
        version: result.version,
        notes: result.notes,
      });
      setForm(null);
      setFormError("");
      setDeleteId(null);
      setConflict(false);
      toast({ description: "Owner notebook saved." });
    },
    onError: (error: Error & { status?: number }) => {
      if (error.status === 409 || error.message.includes("409")) {
        setConflict(true);
        setFormError("A newer version exists. Your text has not been discarded. Reload only when you are ready to replace this draft with the latest notebook.");
        return;
      }
      setFormError(error.message || "Could not save. Your draft is still here.");
    },
  });

  const openNew = (relatedReferenceId?: string) => {
    if (!query.data) return;
    setEditBase({ version: query.data.version, notes: query.data.notes });
    setForm(emptyNote(relatedReferenceId));
    setFormError("");
    setConflict(false);
    setSelectedReference(relatedReferenceId ?? selectedReference);
  };
  const openEdit = (note: EngineeringNote) => {
    if (!query.data) return;
    setEditBase({ version: query.data.version, notes: query.data.notes });
    setForm({ ...note });
    setFormError("");
    setConflict(false);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!editBase || !form) return;
    const parsed = engineeringLibraryWriteSchema.safeParse({
      version: editBase.version,
      notes: [...editBase.notes.filter(note => note.id !== form.id), form],
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Check the question details and try again.");
      return;
    }
    if (form.sourceUrl && !safeSource(form.sourceUrl)) {
      setFormError("Source links must use HTTPS and must not include credentials.");
      return;
    }
    saveLibrary.mutate(parsed.data);
  };
  const confirmDelete = (id: string) => {
    if (!query.data) return;
    setFormError("");
    setDeleteBase({ version: query.data.version, notes: query.data.notes });
    setDeleteId(id);
  };
  const executeDelete = (id: string) => {
    if (!deleteBase) return;
    setFormError("");
    saveLibrary.mutate({ version: deleteBase.version, notes: deleteBase.notes.filter(note => note.id !== id) });
  };
  const reloadLatest = async () => {
    setReloadPending(true);
    try {
      const result = await query.refetch();
      if (result.isError) {
        setFormError("The latest notebook could not be loaded. Your draft is still here; try again when the connection is available.");
        return;
      }
      setForm(null);
      setFormError("");
      setConflict(false);
      setDeleteId(null);
    } finally {
      setReloadPending(false);
    }
  };

  if (isChecking) return <div className="h-full overflow-y-auto bg-[#f4f2e9] p-5 sm:p-8"><div className="mx-auto max-w-6xl space-y-4"><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div></div>;
  if (!isOwner) return <div className="flex h-full min-h-[60dvh] items-center justify-center bg-[#f4f2e9] p-6"><Card className="max-w-md border-[#d7d5ca] bg-[#fbfaf5]"><CardContent className="p-8 text-center"><ShieldCheck className="mx-auto h-8 w-8 text-[#536b63]" /><h1 className="mt-4 font-serif text-2xl text-[#283b37]">Owner access only</h1><p className="mt-2 text-sm leading-6 text-[#697570]">This engineering notebook is available to the VisionClaw owner account only.</p></CardContent></Card></div>;

  return <div className="h-full min-h-0 overflow-y-auto bg-[#f4f2e9] text-[#293733]">
    <fieldset disabled={saveLibrary.isPending || reloadPending} className="min-w-0" aria-busy={saveLibrary.isPending || reloadPending}>
    <div className="mx-auto max-w-[1450px] px-4 py-6 sm:px-7 lg:px-9">
      <header className="mb-7 overflow-hidden rounded-[22px] border border-[#d8d7ca] bg-[#e6e9dc]">
        <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div><div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[#65776a]"><BookOpen className="h-4 w-4" /> VisionClaw · Field notebook</div>
            <h1 className="max-w-3xl font-serif text-3xl leading-tight tracking-tight text-[#253b35] sm:text-5xl">Engineering, in plain language.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#596760]">Look up what we learned, what the evidence says, and what to check next. Curated comparisons stay fixed; owner notes are yours to grow.</p></div>
          <Button onClick={() => openNew()} className="h-11 shrink-0 bg-[#425f54] text-[#f8f6ed] hover:bg-[#314b41]"><Plus className="mr-2 h-4 w-4" />Add owner question</Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[#cfd4c7] bg-[#dce2d6] px-5 py-3 text-xs text-[#596760] sm:px-8"><span><strong className="text-[#344d43]">{references.length}</strong> curated comparisons</span><span><strong className="text-[#344d43]">{notes.length}</strong> owner notes</span><span className="ml-auto">{query.data?.scope || "Private working reference"} · plain text only</span></div>
      </header>

      <div className="mb-6 rounded-2xl border border-[#d9d7ca] bg-[#fbfaf5] p-3">
        <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_190px_220px]">
          <label className="relative block"><span className="sr-only">Search questions, answers, evidence</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#829087]" /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search questions, answers, evidence…" className="h-11 border-[#deddd2] bg-white pl-9 focus-visible:ring-[#769084]" /></label>
          <select aria-label="Filter by category" value={category} onChange={e => setCategory(e.target.value)} className="h-11 rounded-md border border-[#deddd2] bg-white px-3 text-sm text-[#3e4d47]"><option value="">All categories</option>{engineeringCategories.map(value => <option key={value}>{value}</option>)}</select>
          <select aria-label="Filter by verdict" value={verdict} onChange={e => setVerdict(e.target.value)} className="h-11 rounded-md border border-[#deddd2] bg-white px-3 text-sm text-[#3e4d47]"><option value="">All review verdicts</option>{engineeringVerdicts.map(value => <option key={value} value={value}>{verdictLabels[value]}</option>)}</select>
        </div>
      </div>

      {query.isLoading ? <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]"><div className="space-y-3"><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-44 rounded-2xl" /></div><Skeleton className="h-96 rounded-2xl" /></div> :
      query.isError ? <Card className="border-[#e0beba] bg-[#fff7f3]"><CardContent className="flex flex-col items-center gap-3 py-14 text-center"><CircleAlert className="h-8 w-8 text-[#a14e41]" /><h2 className="font-serif text-xl">The notebook did not open.</h2><p className="text-sm text-[#716a64]">Nothing has been changed. Try loading it again.</p><Button variant="outline" onClick={() => query.refetch()} className="min-h-11 border-[#d9b7b0]"><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></CardContent></Card> :
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <main className="min-w-0 space-y-8">
          <section aria-labelledby="owner-notes-heading">
            <div className="mb-3 flex items-end justify-between gap-3 border-b border-[#d7d5c9] pb-3"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#748273]">Written by Bob</p><h2 id="owner-notes-heading" className="mt-1 font-serif text-2xl text-[#2f463d]">Owner notes <span className="font-sans text-sm font-normal text-[#78847d]">/ editable</span></h2></div><span className="text-xs text-[#78847d]">{filteredNotes.length} shown</span></div>
            {filteredNotes.length === 0 ? <div className="rounded-2xl border border-dashed border-[#c9cec1] bg-[#eeefe7] px-5 py-8 text-center"><p className="font-serif text-lg text-[#42564c]">No saved questions match.</p><p className="mt-1 text-sm text-[#78847d]">Add a question in your own words, then keep the useful answer close.</p><Button onClick={() => openNew()} variant="outline" className="mt-4 min-h-11 border-[#c3cec2]"><Plus className="mr-2 h-4 w-4" />Write a question</Button></div> :
            <div className="space-y-3">{filteredNotes.map(note => <button key={note.id} onClick={() => { setSelectedNote(note.id); setSelectedReference(null); }} className={`w-full rounded-2xl border p-4 text-left transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-sm sm:p-5 ${selectedNote === note.id ? "border-[#758f7e] bg-[#e8eee6]" : "border-[#dcdbd0] bg-[#fbfaf5]"}`}>
              <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-[#bbc9bb] bg-[#f5f6ef] text-[#526b5d]">{note.category}</Badge><span className="text-[10px] font-bold uppercase tracking-[.15em] text-[#869087]">Owner note</span>{note.relatedReferenceId && <span className="text-xs text-[#6d7b72]">Linked comparison</span>}</div><h3 className="mt-3 font-serif text-xl leading-snug text-[#2e4038]">{note.question}</h3><p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-[#68736d]">{note.answer || "Answer not written yet."}</p>
            </button>)}</div>}
          </section>
          <section aria-labelledby="curated-heading">
            <div className="mb-3 flex items-end justify-between gap-3 border-b border-[#d7d5c9] pb-3"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#8b795b]">Reviewed comparison library</p><h2 id="curated-heading" className="mt-1 font-serif text-2xl text-[#2f463d]">Curated references <span className="font-sans text-sm font-normal text-[#78847d]">/ read-only</span></h2></div><span className="text-xs text-[#78847d]">{filteredReferences.length} shown</span></div>
            {filteredReferences.length === 0 ? <div className="rounded-2xl border border-dashed border-[#d2ccbb] bg-[#f0eee5] px-5 py-8 text-center text-sm text-[#778078]">No curated reference matches these filters.</div> :
            <div className="space-y-3">{filteredReferences.map(reference => <ReferenceCard key={reference.id} item={reference} selected={selectedReference === reference.id} onClick={() => { setSelectedReference(reference.id); setSelectedNote(null); }} />)}</div>}
          </section>
        </main>

        <aside className="min-w-0">
          {form ? <NoteForm form={form} error={formError} pending={saveLibrary.isPending} conflict={conflict} references={references} onChange={setForm} onCancel={() => { setForm(null); setFormError(""); setConflict(false); }} onSubmit={submit} onReload={reloadLatest} reloadPending={reloadPending} /> :
          activeNote ? <NoteDetail note={activeNote} references={references} deleteId={deleteId} pending={saveLibrary.isPending} error={formError} onEdit={() => openEdit(activeNote)} onDelete={() => confirmDelete(activeNote.id)} onCancelDelete={() => setDeleteId(null)} onConfirmDelete={() => executeDelete(activeNote.id)} onSelectReference={id => { setSelectedReference(id); setSelectedNote(null); }} /> :
          activeReference ? <ReferenceDetail item={activeReference} relatedNotes={notes.filter(note => note.relatedReferenceId === activeReference.id)} onAdd={() => openNew(activeReference.id)} onOpenNote={id => { setSelectedNote(id); setSelectedReference(null); }} /> :
          <Card className="sticky top-4 overflow-hidden border-[#394f45] bg-[#334b41] text-[#f1f0e8] shadow-sm"><CardContent className="p-6 sm:p-7"><div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5"><BookOpen className="h-5 w-5 text-[#d2dccb]" /></div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#b8c8b6]">Notebook guide</p><h2 className="mt-2 font-serif text-2xl leading-tight">Keep the question. Keep the evidence.</h2><p className="mt-3 text-sm leading-6 text-[#d1d9cf]">Curated entries capture reviewed comparisons. Owner notes are a separate, editable memory for practical questions Bob wants to revisit.</p><div className="mt-7 space-y-3 border-t border-white/15 pt-5 text-xs leading-5 text-[#d1d9cf]"><p><strong className="text-[#f0f0e5]">Search</strong> spans questions, answers, evidence details, and next checks.</p><p><strong className="text-[#f0f0e5]">Link a note</strong> to a curated comparison to keep the follow-up connected.</p><p><strong className="text-[#f0f0e5]">Save safely</strong> — edits use a version check; on conflict your draft stays open until you choose to reload.</p></div></CardContent></Card>}
        </aside>
      </div>}
    </div>
    </fieldset>
  </div>;
}

function ReferenceCard({ item, selected, onClick }: { item: EngineeringReference; selected: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`w-full rounded-2xl border p-4 text-left transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-sm sm:p-5 ${selected ? "border-[#b6a77d] bg-[#f3f0e4]" : "border-[#ddd9ca] bg-[#fbfaf5]"}`}>
    <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-[#d5c9a9] bg-[#f7f4e9] text-[#816f49]">{item.category}</Badge><Badge variant="outline" className="border-[#d9ddd3] text-[#68766c]">{verdictLabels[item.verdict]}</Badge><span className="ml-auto text-[10px] uppercase tracking-wider text-[#92968b]">Reviewed {dateLabel(item.reviewedAt)}</span></div>
    <h3 className="mt-3 font-serif text-xl leading-snug text-[#34443c]">{item.question}</h3><p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-[#6b746e]">{item.answer}</p><p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-[#86744d]">Inspect evidence & next check <ArrowUpRight className="h-3.5 w-3.5" /></p>
  </button>;
}

function ReferenceDetail({ item, relatedNotes, onAdd, onOpenNote }: { item: EngineeringReference; relatedNotes: EngineeringNote[]; onAdd: () => void; onOpenNote: (id: string) => void }) {
  return <Card className="sticky top-4 overflow-hidden border-[#d8d3c2] bg-[#fbfaf5] shadow-sm"><CardHeader className="border-b border-[#e8e4d8] pb-4"><div className="flex flex-wrap gap-2"><Badge variant="outline" className="border-[#d5c9a9] text-[#816f49]">{item.category}</Badge><Badge variant="outline">{verdictLabels[item.verdict]}</Badge></div><CardTitle className="mt-2 font-serif text-2xl leading-tight text-[#30443a]">{item.question}</CardTitle><p className="text-xs text-[#81877d]">Reviewed {dateLabel(item.reviewedAt)}</p></CardHeader><CardContent className="max-h-[calc(100dvh-165px)] space-y-5 overflow-y-auto p-5 text-sm leading-6">
    <section><FieldLabel>Answer</FieldLabel><p className="whitespace-pre-wrap text-[#515f57]">{item.answer}</p></section>
    <section><FieldLabel>Practical guidance</FieldLabel><p className="whitespace-pre-wrap text-[#515f57]">{item.guidance}</p></section>
    <section><FieldLabel>Evidence reviewed</FieldLabel>{item.evidence.length ? <ul className="space-y-3">{item.evidence.map((evidence, i) => <li key={`${evidence.path}-${i}`} className="rounded-xl border border-[#e4e0d4] bg-[#f5f3eb] p-3"><p className="break-all font-mono text-[11px] font-semibold text-[#586d60]">{evidence.path}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#6a746d]">{evidence.detail}</p></li>)}</ul> : <p className="text-[#788078]">No evidence details recorded.</p>}</section>
    <section className="rounded-xl border border-[#d8e0d3] bg-[#edf1e8] p-4"><FieldLabel>Next check</FieldLabel><p className="whitespace-pre-wrap text-[#47584d]">{item.nextCheck || "No next check recorded."}</p></section>
    <section><FieldLabel>Source</FieldLabel>{safeSource(item.sourceUrl) ? <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-2 break-all text-xs font-medium text-[#607967] underline decoration-[#aebcac] underline-offset-4"><Link2 className="h-3.5 w-3.5 shrink-0" />{item.sourceUrl}<ArrowUpRight className="h-3 w-3 shrink-0" /></a> : <p className="break-all text-xs text-[#81877d]">{item.sourceUrl || "No source link recorded."}</p>}</section>
    <div className="border-t border-[#e8e4d8] pt-4"><Button onClick={onAdd} className="min-h-11 w-full bg-[#425f54] text-[#f8f6ed] hover:bg-[#314b41]"><FilePlus2 className="mr-2 h-4 w-4" />Add related owner note</Button>{relatedNotes.length > 0 && <div className="mt-4"><FieldLabel>Linked owner notes</FieldLabel><div className="space-y-2">{relatedNotes.map(note => <button key={note.id} onClick={() => onOpenNote(note.id)} className="block w-full rounded-lg border border-[#dcded4] bg-white p-3 text-left font-medium text-[#4f6558] hover:bg-[#f1f4ed]">{note.question}</button>)}</div></div>}</div>
  </CardContent></Card>;
}

function NoteDetail({ note, references, deleteId, pending, error, onEdit, onDelete, onCancelDelete, onConfirmDelete, onSelectReference }: { note: EngineeringNote; references: EngineeringReference[]; deleteId: string | null; pending: boolean; error: string; onEdit: () => void; onDelete: () => void; onCancelDelete: () => void; onConfirmDelete: () => void; onSelectReference: (id: string) => void }) {
  const related = references.find(reference => reference.id === note.relatedReferenceId);
  return <Card className="sticky top-4 overflow-hidden border-[#cfd8cc] bg-[#fbfaf5] shadow-sm"><CardHeader className="border-b border-[#e5e8df] pb-4"><div className="flex items-center justify-between gap-3"><Badge variant="outline" className="border-[#bbc9bb] text-[#526b5d]">Owner note</Badge><div className="flex gap-1"><Button variant="outline" size="sm" className="min-h-10" onClick={onEdit}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button><Button variant="outline" size="icon" aria-label="Delete owner note" className="h-10 w-10 border-[#e0c8c1] text-[#9b5949]" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button></div></div><CardTitle className="mt-3 font-serif text-2xl leading-tight text-[#30443a]">{note.question}</CardTitle><Badge variant="outline" className="mt-2 w-fit border-[#d9ddd3] text-[#68766c]">{note.category}</Badge></CardHeader>
    <CardContent className="max-h-[calc(100dvh-165px)] space-y-5 overflow-y-auto p-5 text-sm leading-6"><section><FieldLabel>Answer</FieldLabel><p className="whitespace-pre-wrap text-[#515f57]">{note.answer || "No answer has been saved yet."}</p></section><section><FieldLabel>Source</FieldLabel>{note.sourceUrl && safeSource(note.sourceUrl) ? <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-[#607967] underline underline-offset-4">{note.sourceUrl}</a> : <p className="text-xs text-[#81877d]">No source link.</p>}</section>
      {related && <section><FieldLabel>Related curated comparison</FieldLabel><button onClick={() => onSelectReference(related.id)} className="w-full rounded-xl border border-[#ddd9ca] bg-[#f5f3eb] p-3 text-left font-serif leading-5 text-[#56674e] hover:bg-[#efeee4]">{related.question}</button></section>}
      {deleteId === note.id && <div className="rounded-xl border border-[#e3c7be] bg-[#fff4ef] p-4"><p className="font-semibold text-[#854c3d]">Delete this owner note?</p><p className="mt-1 text-xs leading-5 text-[#86665e]">This removes it from your saved notebook. Curated references are not affected.</p>{error && <p className="mt-2 text-xs text-[#9a4034]">{error}</p>}<div className="mt-3 flex gap-2"><Button variant="outline" className="min-h-10 flex-1" onClick={onCancelDelete}>Keep note</Button><Button className="min-h-10 flex-1 bg-[#9a5042] hover:bg-[#823f33]" disabled={pending} onClick={onConfirmDelete}>{pending ? "Deleting…" : "Delete note"}</Button></div></div>}
    </CardContent></Card>;
}

function NoteForm({ form, error, pending, conflict, references, onChange, onCancel, onSubmit, onReload, reloadPending }: { form: NoteDraft; error: string; pending: boolean; conflict: boolean; references: EngineeringReference[]; onChange: (value: NoteDraft) => void; onCancel: () => void; onSubmit: (event: FormEvent) => void; onReload: () => void; reloadPending: boolean }) {
  const field = (key: keyof NoteDraft, label: string, help: string, example: string, multiline = false, maxLength?: number) => <label className="block space-y-1.5"><span className="text-xs font-semibold text-[#4d5d53]">{label}</span>{multiline ? <Textarea value={String(form[key] ?? "")} maxLength={maxLength} onChange={e => onChange({ ...form, [key]: e.target.value })} className="min-h-24 resize-y border-[#deddd2] bg-white text-sm" placeholder={`Example: ${example}`} /> : <Input value={String(form[key] ?? "")} maxLength={maxLength} onChange={e => onChange({ ...form, [key]: e.target.value })} className="h-11 border-[#deddd2] bg-white text-sm" placeholder={`Example: ${example}`} />}<span className="block text-[11px] leading-4 text-[#7a847b]">{help}</span></label>;
  return <Card className="sticky top-4 overflow-hidden border-[#cbd7cb] bg-[#f9faf4] shadow-sm"><CardHeader className="flex-row items-center justify-between border-b border-[#e4e8de] pb-4"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#738675]">Owner notebook</p><CardTitle className="mt-1 font-serif text-xl text-[#33493d]">{references.some(ref => ref.id === form.relatedReferenceId) ? "Question about a comparison" : "Write a question"}</CardTitle></div><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Close form" onClick={onCancel}><X className="h-4 w-4" /></Button></CardHeader>
    <form onSubmit={onSubmit}><CardContent className="max-h-[calc(100dvh-220px)] space-y-4 overflow-y-auto p-5">
      <p className="text-xs leading-5 text-[#6c786f]">Keep it practical: one question, a plain-language answer, and a source if useful. Blank-field examples are prompts only; they are not saved.</p>
      {error && <div role="alert" className={`rounded-lg border p-3 text-xs leading-5 ${conflict ? "border-[#d8c997] bg-[#faf5e4] text-[#78643b]" : "border-[#e4c6be] bg-[#fff3ee] text-[#8e4d40]"}`}><CircleAlert className="mr-1 inline h-3.5 w-3.5" />{error}{conflict && <Button type="button" variant="outline" className="mt-3 min-h-10 w-full border-[#c9bd9f]" onClick={onReload} disabled={reloadPending}>{reloadPending ? "Reloading…" : "Reload latest notebook"}</Button>}</div>}
      {field("question", "Question", "Write what you want to be able to look up later. Required, 3–400 characters.", "When should retrieval stop and ask for clarification?", false, 400)}
      {field("answer", "Plain-language answer", "Explain the decision or finding without relying on jargon. Up to 12,000 characters.", "Use the smallest reliable signal first; ask when the evidence is ambiguous.", true, 12000)}
      <label className="block space-y-1.5"><span className="text-xs font-semibold text-[#4d5d53]">Category</span><select value={form.category} onChange={e => onChange({ ...form, category: e.target.value as NoteDraft["category"] })} className="h-11 w-full rounded-md border border-[#deddd2] bg-white px-3 text-sm">{engineeringCategories.map(value => <option key={value}>{value}</option>)}</select><span className="block text-[11px] leading-4 text-[#7a847b]">Choose the engineering area this question belongs to. Example: Retrieval.</span></label>
      {field("sourceUrl", "HTTPS source link (optional)", "Use a public source you trust. Links must use HTTPS and contain no username or password.", "https://docs.example.org/retrieval/overview", false, 2048)}
      <label className="block space-y-1.5"><span className="text-xs font-semibold text-[#4d5d53]">Related curated comparison (optional)</span><select value={form.relatedReferenceId ?? ""} onChange={e => onChange({ ...form, relatedReferenceId: e.target.value || undefined })} className="min-h-11 w-full rounded-md border border-[#deddd2] bg-white px-3 py-2 text-sm"><option value="">No comparison linked</option>{references.map(ref => <option key={ref.id} value={ref.id}>{ref.category} — {ref.question}</option>)}</select><span className="block text-[11px] leading-4 text-[#7a847b]">Link this note to its source comparison. Example: select the comparison you opened this form from.</span></label>
    </CardContent><div className="flex gap-2 border-t border-[#e4e8de] p-4"><Button type="button" variant="outline" className="min-h-11 flex-1" onClick={onCancel}>Cancel</Button><Button type="submit" className="min-h-11 flex-1 bg-[#425f54] text-[#f8f6ed] hover:bg-[#314b41]" disabled={pending}>{pending ? "Saving…" : "Save owner note"}</Button></div></form>
  </Card>;
}

function FieldLabel({ children }: { children: ReactNode }) { return <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.17em] text-[#79877b]">{children}</p>; }
