import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { buildResearchFrontierListUrl, buildResearchFrontierMutationRequest, clampResearchFrontierPage } from "@/lib/commercial-research-frontier";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, BarChart3, ChevronRight, CircleAlert, Compass, FlaskConical, Pencil, Plus, RefreshCw, Search, ShieldCheck, Target, X } from "lucide-react";

type ScoreInputs = Record<string, number>;
type Opportunity = {
  id: number; title: string; originType: string; originRef?: string | null; buyer: string;
  painfulJob: string; offerHypothesis: string; evidenceSummary: string; evidenceConfidence: string;
  evidenceState: string; assumptions: string[]; unknowns: string[]; risks: string[]; killCriterion: string;
  maturity: string; lifecycleStatus: string; nextTest: { type: string; description: string; successCriterion: string };
  scoreInputs: ScoreInputs; scoreResult: { rubricVersion: string; positiveTotal: number; riskTotal: number; opportunityScore: number; maxPositive: number; maxRisk: number };
  validationEvidence?: { type: string; reference: string; observedAt: string } | null;
  idempotencyKey: string; createdAt: string; updatedAt: string;
};
type ListResponse = { items?: Opportunity[]; opportunities?: Opportunity[]; total: number; page: number; limit: number };

const BASE = "/api/admin/research-frontier/opportunities";
const PAGE_SIZE = 20;
const maturities = ["concept-ready", "sales-ready", "pilot-ready", "fulfillment-ready", "revenue-validated"];
const statuses = ["active", "parked", "rejected", "archived"];
const scoreFields = [
  ["painUrgency", "Pain urgency", "positive"], ["buyerAccess", "Buyer access", "positive"],
  ["willingnessToPay", "Willingness to pay", "positive"], ["visionClawAdvantage", "VisionClaw advantage", "positive"],
  ["evidenceStrength", "Evidence strength", "positive"], ["speedToFirstSale", "Speed to first sale", "positive"],
  ["repeatability", "Repeatability", "positive"], ["deliveryConfidence", "Delivery confidence", "positive"],
  ["buildCost", "Build cost", "risk"], ["fulfillmentCost", "Fulfillment cost", "risk"],
  ["legalSafetyRisk", "Legal / safety risk", "risk"], ["integrationDependence", "Integration dependence", "risk"],
  ["supportBurden", "Support burden", "risk"],
] as const;

const emptyScores = Object.fromEntries(scoreFields.map(([key]) => [key, 0]));
const blank = (): Partial<Opportunity> => ({
  title: "", originType: "customer_pain", originRef: "", buyer: "", painfulJob: "", offerHypothesis: "",
  evidenceSummary: "", evidenceConfidence: "low", evidenceState: "unverified", assumptions: [], unknowns: [],
  risks: [], killCriterion: "", maturity: "concept-ready", lifecycleStatus: "active",
  nextTest: { type: "buyer_interview", description: "", successCriterion: "" }, scoreInputs: { ...emptyScores },
  validationEvidence: null, idempotencyKey: `frontier-${Date.now()}`,
});

function splitLines(value: string) { return value.split("\n").map(v => v.trim()).filter(Boolean); }
function labelize(value: string) { return value.replaceAll("-", " "); }
function scoreColor(score: number) { return score >= 70 ? "text-emerald-700" : score >= 45 ? "text-amber-700" : "text-rose-700"; }

export default function AdminResearchFrontierPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [maturity, setMaturity] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Opportunity>>(blank());
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery<ListResponse>({
    queryKey: [BASE, debouncedSearch, maturity, status, page],
    queryFn: async () => {
      const response = await apiRequest("GET", buildResearchFrontierListUrl(BASE, {
        page,
        limit: PAGE_SIZE,
        search: debouncedSearch,
        maturity,
        status,
      }));
      return response.json();
    },
  });
  const items = query.data?.items ?? query.data?.opportunities ?? [];
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE));
  const pageOutOfRange = page > pageCount;
  useEffect(() => {
    if (query.data) setPage(current => clampResearchFrontierPage(current, query.data!.total, PAGE_SIZE));
  }, [query.data]);
  const totals = useMemo(() => ({
    active: items.filter(item => item.lifecycleStatus === "active").length,
    validated: items.filter(item => item.maturity === "revenue-validated").length,
    supported: items.filter(item => ["supported", "verified"].includes(item.evidenceState)).length,
  }), [items]);

  const save = useMutation({
    mutationFn: async (request: ReturnType<typeof buildResearchFrontierMutationRequest>) => {
      const response = await apiRequest(request.method, request.url, request.body);
      return { ...(await response.json()), method: request.method };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [BASE] });
      const opportunity = data.opportunity as Opportunity;
      setSelected(opportunity); setEditing(false); setFormError("");
      toast({ description: data.method === "PATCH" ? "Opportunity updated" : "Opportunity created" });
    },
    onError: (error: Error) => setFormError(error.message || "Unable to save opportunity"),
  });

  const openCreate = () => { setSelected(null); setForm(blank()); setFormError(""); setEditing(true); };
  const openEdit = (item: Opportunity) => { setSelected(item); setForm({ ...item, scoreInputs: { ...item.scoreInputs }, nextTest: { ...item.nextTest } }); setFormError(""); setEditing(true); };
  const update = (key: string, value: unknown) => setForm(current => ({ ...current, [key]: value }));
  const updateNext = (key: string, value: string) => setForm(current => ({ ...current, nextTest: { ...(current.nextTest as Opportunity["nextTest"]), [key]: value } }));
  const updateScore = (key: string, value: number) => setForm(current => ({ ...current, scoreInputs: { ...(current.scoreInputs || emptyScores), [key]: value } }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const f = form;
    if (!f.title || !f.buyer || !f.painfulJob || !f.offerHypothesis || !f.evidenceSummary || !f.killCriterion ||
      !f.nextTest?.description || !f.nextTest?.successCriterion) {
      setFormError("Complete the required fields before saving. Each one anchors a decision.");
      return;
    }
    if (f.maturity === "revenue-validated" && (f.evidenceState !== "verified" || !f.validationEvidence?.reference)) {
      setFormError("Revenue-validated maturity requires verified evidence and a validation reference.");
      return;
    }
    const payload = {
      title: f.title, originType: f.originType, originRef: f.originRef || null, buyer: f.buyer,
      painfulJob: f.painfulJob, offerHypothesis: f.offerHypothesis, evidenceSummary: f.evidenceSummary,
      evidenceConfidence: f.evidenceConfidence, evidenceState: f.evidenceState, assumptions: f.assumptions || [],
      unknowns: f.unknowns || [], risks: f.risks || [], killCriterion: f.killCriterion, maturity: f.maturity,
      lifecycleStatus: f.lifecycleStatus, nextTest: f.nextTest, scoreInputs: f.scoreInputs || emptyScores,
      validationEvidence: f.validationEvidence || null,
    };
    save.mutate(buildResearchFrontierMutationRequest(BASE, {
      editing,
      selectedId: selected?.id ?? null,
      payload,
      idempotencyKey: f.idempotencyKey || `frontier-${Date.now()}`,
    }));
  };

  return (
    <div className="h-full overflow-y-auto bg-[hsl(42_35%_97%)] text-slate-900">
      <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
        <header className="mb-6 flex flex-col gap-5 border-b border-slate-200/80 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-teal-700"><Compass className="h-4 w-4" /> Commercial Research Frontier</div>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Choose the next revenue experiment with evidence.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">An owner-only portfolio for comparing opportunities before they become commitments. Decision support only: it does not send outreach, collect payment, create missions, publish, or trade.</p>
          </div>
          <Button onClick={openCreate} className="h-11 shrink-0 bg-teal-800 text-white hover:bg-teal-900"><Plus className="mr-2 h-4 w-4" />Create opportunity</Button>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
           {[["Portfolio", query.data?.total ?? 0, "total matches"], ["Active", totals.active, "on this page"], ["Evidence supported", totals.supported, "on this page"], ["Revenue-validated", totals.validated, "on this page"]].map(([title, value, caption]) => (
            <Card key={title} className="border-slate-200/80 bg-white/70 shadow-none"><CardContent className="p-4"><p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</p><p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{caption}</p></CardContent></Card>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
          <main className="min-w-0">
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row">
                 <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search opportunities" className="h-11 border-slate-200 pl-9" /></div>
                 <select aria-label="Maturity" value={maturity} onChange={e => { setMaturity(e.target.value); setPage(1); }} className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="">Maturity</option>{maturities.map(v => <option key={v} value={v}>{labelize(v)}</option>)}</select>
                 <select aria-label="Lifecycle" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="">Lifecycle</option>{statuses.map(v => <option key={v} value={v}>{labelize(v)}</option>)}</select>
              </div>
            </div>
            {query.isLoading ? <div className="grid gap-3 md:grid-cols-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-56 rounded-xl" />)}</div> :
               query.isError ? <Card className="border-rose-200 bg-rose-50/50"><CardContent className="flex flex-col items-center gap-3 py-14 text-center"><CircleAlert className="h-8 w-8 text-rose-600" /><p className="font-medium">Research Frontier could not load.</p><Button variant="outline" className="min-h-11" onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></CardContent></Card> :
               pageOutOfRange ? <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-56 rounded-xl" /><Skeleton className="h-56 rounded-xl" /></div> :
               items.length === 0 ? <Card className="border-dashed border-slate-300 bg-white/60"><CardContent className="py-16 text-center"><Target className="mx-auto mb-4 h-9 w-9 text-teal-700/60" /><h2 className="font-semibold">No opportunities yet</h2><p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">Capture one evidence-backed possibility, then make its smallest test explicit.</p><Button onClick={openCreate} className="mt-5 min-h-11 bg-teal-800 hover:bg-teal-900"><Plus className="mr-2 h-4 w-4" />Create opportunity</Button></CardContent></Card> :
               <><div className="grid gap-3 md:grid-cols-2">{items.map(item => <OpportunityCard key={item.id} item={item} selected={selected?.id === item.id} onClick={() => { setSelected(item); setEditing(false); }} />)}</div>
               {pageCount > 1 && <nav className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3" aria-label="Opportunity pages"><Button type="button" variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>Previous</Button><span className="text-sm text-slate-600">Page {page} of {pageCount}</span><Button type="button" variant="outline" className="min-h-11" disabled={page >= pageCount} onClick={() => setPage(current => Math.min(pageCount, current + 1))}>Next</Button></nav>}</>}
          </main>
          <aside className="min-w-0">
            {editing ? <OpportunityForm form={form} editing={!!selected} error={formError} pending={save.isPending} onCancel={() => setEditing(false)} onSubmit={submit} update={update} updateNext={updateNext} updateScore={updateScore} /> :
              selected ? <Detail item={selected} onEdit={() => openEdit(selected)} /> :
              <Card className="border-slate-200 bg-slate-900 text-slate-100 shadow-xl"><CardContent className="p-6"><FlaskConical className="mb-5 h-7 w-7 text-teal-300" /><h2 className="text-lg font-semibold">Inspect the portfolio</h2><p className="mt-2 text-sm leading-6 text-slate-300">Select an opportunity to see the evidence, smallest next test, and the deterministic score behind it.</p><div className="mt-8 border-t border-slate-700 pt-5 text-xs leading-5 text-slate-400">Scores are calculated from the rubric inputs by the server. This workspace never accepts a caller-supplied score total.</div></CardContent></Card>}
          </aside>
        </div>
      </div>
    </div>
  );
}

function OpportunityCard({ item, selected, onClick }: { item: Opportunity; selected: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`group w-full rounded-xl border p-5 text-left transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md ${selected ? "border-teal-700 bg-teal-50/70 shadow-sm" : "border-slate-200 bg-white"}`}>
    <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="mb-3 flex flex-wrap gap-1.5"><Badge variant="outline" className="border-teal-200 text-teal-800">{labelize(item.maturity)}</Badge><Badge variant="secondary">{labelize(item.lifecycleStatus)}</Badge></div><h2 className="truncate font-semibold text-slate-950">{item.title}</h2></div><span className={`shrink-0 text-2xl font-semibold ${scoreColor(item.scoreResult?.opportunityScore ?? 0)}`}>{item.scoreResult?.opportunityScore ?? "—"}<small className="text-xs font-normal text-slate-400"> /100</small></span></div>
    <p className="mt-4 line-clamp-2 text-sm leading-5 text-slate-600">{item.painfulJob}</p><div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500"><span>{labelize(item.evidenceState)} evidence</span><span className="flex items-center gap-1 text-teal-800">Inspect <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span></div>
  </button>;
}

function Detail({ item, onEdit }: { item: Opportunity; onEdit: () => void }) {
  const score = item.scoreResult;
   return <Card className="border-slate-200 bg-white shadow-sm"><CardHeader className="border-b border-slate-100 pb-4"><div className="flex justify-between gap-3"><div><p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-teal-700">Selected opportunity</p><CardTitle className="text-xl">{item.title}</CardTitle></div><Button variant="outline" size="sm" className="min-h-11" onClick={onEdit}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button></div></CardHeader><CardContent className="space-y-5 p-5 text-sm">
    <Section title="Buyer"><p className="font-medium">{item.buyer}</p><p className="mt-1 text-slate-600">{item.painfulJob}</p></Section>
    <Section title="Offer hypothesis"><p className="text-slate-700">{item.offerHypothesis}</p></Section>
    <Section title="Evidence"><div className="flex flex-wrap gap-2"><Badge>{labelize(item.evidenceState)}</Badge><Badge variant="outline">{labelize(item.evidenceConfidence)} confidence</Badge></div><p className="mt-2 text-slate-600">{item.evidenceSummary}</p>{item.originRef && <p className="mt-2 break-all text-xs text-slate-500">Source reference: {item.originRef}</p>}</Section>
    <ListSection title="Assumptions" items={item.assumptions} />
    <ListSection title="Unknowns" items={item.unknowns} />
    <ListSection title="Risks" items={item.risks} />
    <div className="rounded-lg border border-teal-100 bg-teal-50/70 p-3"><p className="text-[10px] font-bold uppercase tracking-widest text-teal-800">Smallest next test</p><p className="mt-1 font-medium">{item.nextTest.description}</p><p className="mt-2 text-xs text-teal-900/70">Success: {item.nextTest.successCriterion}</p></div>
     <div className="rounded-lg bg-slate-900 p-4 text-slate-100"><div className="flex items-center justify-between"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest"><BarChart3 className="h-4 w-4 text-teal-300" />Score explanation</p><span className={`text-2xl font-semibold ${scoreColor(score.opportunityScore)}`}>{score.opportunityScore}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><span className="text-slate-400">Positive signal</span><strong className="ml-2">{score.positiveTotal}/{score.maxPositive}</strong></div><div><span className="text-slate-400">Risk load</span><strong className="ml-2">{score.riskTotal}/{score.maxRisk}</strong></div></div><div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-700 pt-3">{scoreFields.map(([key, label, kind]) => <div key={key} className="flex items-center justify-between gap-2 text-[11px]"><span className="truncate text-slate-400">{label}</span><strong className={kind === "risk" ? "text-amber-300" : "text-teal-300"}>{item.scoreInputs[key]}/5</strong></div>)}</div><div className="mt-3 border-t border-slate-700 pt-3 text-[11px] text-slate-400">Rubric {score.rubricVersion}. Score = round((positive total ÷ 40 × 100) − (risk total ÷ 25 × 50)), bounded from 0 to 100. Totals are deterministic and server-calculated.</div></div>
    <Section title="Kill criterion"><p className="text-slate-600">{item.killCriterion}</p></Section>
  </CardContent></Card>;
}
function Section({ title, children }: { title: string; children: ReactNode }) { return <div><p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</p>{children}</div>; }
function ListSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return <Section title={title}><ul className="list-disc space-y-1 pl-4 text-slate-600">{items.map(item => <li key={item}>{item}</li>)}</ul></Section>;
}

function OpportunityForm({ form, editing, error, pending, onCancel, onSubmit, update, updateNext, updateScore }: { form: Partial<Opportunity>; editing: boolean; error: string; pending: boolean; onCancel: () => void; onSubmit: (event: FormEvent) => void; update: (key: string, value: unknown) => void; updateNext: (key: string, value: string) => void; updateScore: (key: string, value: number) => void }) {
   const field = (key: keyof Opportunity, label: string, placeholder: string, help: string, multiline = false) => <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-700">{label}</span>{multiline ? <Textarea value={(form[key] as string) || ""} onChange={e => update(key, e.target.value)} placeholder={placeholder} className="min-h-20 resize-y border-slate-200 bg-white text-sm" /> : <Input value={(form[key] as string) || ""} onChange={e => update(key, e.target.value)} placeholder={placeholder} className="h-11 border-slate-200 bg-white text-sm" />}<span className="block text-[11px] leading-4 text-slate-500">{help}</span></label>;
   return <Card className="border-teal-200 bg-[#fbfdfb] shadow-sm"><CardHeader className="flex-row items-center justify-between border-b border-slate-100 pb-4"><CardTitle className="text-lg">{editing ? "Edit opportunity" : "Create opportunity"}</CardTitle><Button variant="ghost" size="icon" className="h-11 w-11" onClick={onCancel}><X className="h-4 w-4" /></Button></CardHeader><form onSubmit={onSubmit}><CardContent className="max-h-[calc(100dvh-170px)] space-y-5 overflow-y-auto p-5">
    {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800"><CircleAlert className="mr-1 inline h-3.5 w-3.5" />{error}</div>}
    {field("title", "Title", "Example: Compliance readiness sprint for regional clinics", "Name the commercial possibility, not the feature.")}
    {field("buyer", "Buyer", "Example: Operations leaders at 20–100 person clinics", "Describe who owns the painful job and can say yes.")}
    {field("painfulJob", "Painful job", "Example: Prove readiness without losing two weeks to document chasing", "What costly, recurring job is currently hard?")}
    {field("offerHypothesis", "Offer hypothesis", "Example: A fixed-scope evidence review delivered in five business days", "State the smallest paid outcome you believe could work.", true)}
    <div className="grid gap-3 sm:grid-cols-2"><SelectField label="Origin" value={form.originType || ""} onChange={v => update("originType", v)} options={["external_report", "market_change", "customer_pain", "platform_capability", "internal_idea", "existing_research"]} /><SelectField label="Evidence confidence" value={form.evidenceConfidence || ""} onChange={v => update("evidenceConfidence", v)} options={["low", "medium", "high"]} /></div>
    {field("originRef", "Source reference", "Example: research-session:42 or https://example.com/report", "Optional. Enter the stable identifier or URL for the authoritative source.")}
    {field("evidenceSummary", "Evidence", "Example: Three operators named this delay in interviews; no payment observed yet.", "Cite what is known, how it was observed, and what remains unproven.", true)}
    <div className="grid gap-3 sm:grid-cols-2"><SelectField label="Evidence state" value={form.evidenceState || ""} onChange={v => update("evidenceState", v)} options={["unverified", "incomplete", "mixed", "supported", "contradictory", "verified"]} /><SelectField label="Maturity" value={form.maturity || ""} onChange={v => update("maturity", v)} options={maturities} /></div>
    {field("killCriterion", "Kill criterion", "Example: Park if two qualified buyers decline a paid diagnostic.", "Write the condition that should stop further investment.", true)}
    <div className="grid gap-3 sm:grid-cols-2"><ListField label="Assumptions" value={form.assumptions || []} onChange={v => update("assumptions", v)} example="Example: Buyer has budget authority" /><ListField label="Unknowns" value={form.unknowns || []} onChange={v => update("unknowns", v)} example="Example: Procurement timeline" /><ListField label="Risks" value={form.risks || []} onChange={v => update("risks", v)} example="Example: Scope expands into consulting" /><SelectField label="Lifecycle" value={form.lifecycleStatus || ""} onChange={v => update("lifecycleStatus", v)} options={statuses} /></div>
    <div className="rounded-lg border border-teal-100 bg-teal-50/50 p-4"><p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-teal-800"><ArrowRight className="h-4 w-4" />Smallest next test</p><div className="space-y-3"><SelectField label="Test type" value={form.nextTest?.type || ""} onChange={v => updateNext("type", v)} options={["buyer_interview", "manual_assessment", "landing_page", "prototype", "paid_pilot", "other"]} />{nextField("description", "Description", "Example: Ask five operations leaders to review the fixed-scope offer.", form.nextTest?.description || "", updateNext)}{nextField("successCriterion", "Success criterion", "Example: Two buyers agree to a paid pilot within 14 days.", form.nextTest?.successCriterion || "", updateNext)}</div></div>
     <div><p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-600">Rubric inputs <span className="font-normal normal-case tracking-normal">(0 low signal / 5 strong signal; risks score as load)</span></p><div className="grid grid-cols-2 gap-2">{scoreFields.map(([key, label]) => <label key={key} className="rounded-md border border-slate-200 bg-white p-2"><span className="block truncate text-[11px] text-slate-600">{label}</span><select value={form.scoreInputs?.[key] ?? 0} onChange={e => updateScore(key, Number(e.target.value))} className="mt-1 h-11 w-full bg-transparent text-sm font-semibold"><option>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>)}</div></div>
     {form.maturity === "revenue-validated" && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-800"><ShieldCheck className="h-4 w-4" />Validation evidence required</p><p className="mt-1 text-xs text-amber-900/75">Revenue-validated requires Evidence state “verified” and a reference to a payment, signed pilot, or buyer commitment.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><SelectField label="Evidence type" value={form.validationEvidence?.type || "payment"} onChange={v => update("validationEvidence", { ...(form.validationEvidence || {}), type: v, observedAt: form.validationEvidence?.observedAt || new Date().toISOString() })} options={["payment", "signed_pilot", "buyer_commitment"]} /><Input value={form.validationEvidence?.reference || ""} onChange={e => update("validationEvidence", { ...(form.validationEvidence || { type: "payment", observedAt: new Date().toISOString() }), reference: e.target.value })} placeholder="Example: Invoice 1042 or signed pilot" className="h-11 border-slate-200 bg-white" /></div></div>}
   </CardContent><div className="flex gap-2 border-t border-slate-100 p-4"><Button type="button" variant="outline" className="min-h-11 flex-1" onClick={onCancel}>Cancel</Button><Button type="submit" className="min-h-11 flex-1 bg-teal-800 hover:bg-teal-900" disabled={pending}>{pending ? "Saving…" : editing ? "Save changes" : "Create opportunity"}</Button></div></form></Card>;
}
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) { return <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-700">{label}</span><select value={value} onChange={e => onChange(e.target.value)} className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="">Choose {label.toLowerCase()}</option>{options.map(option => <option key={option} value={option}>{labelize(option)}</option>)}</select></label>; }
function ListField({ label, value, onChange, example }: { label: string; value: string[]; onChange: (value: string[]) => void; example: string }) { return <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-700">{label}</span><Textarea value={value.join("\n")} onChange={e => onChange(splitLines(e.target.value))} placeholder={example} className="min-h-16 resize-y border-slate-200 bg-white text-sm" /><span className="text-[11px] text-slate-500">One item per line.</span></label>; }
function nextField(key: string, label: string, placeholder: string, value: string, update: (key: string, value: string) => void) { return <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-700">{label}</span><Textarea value={value} onChange={e => update(key, e.target.value)} placeholder={placeholder} className="min-h-16 resize-y border-slate-200 bg-white text-sm" /></label>; }