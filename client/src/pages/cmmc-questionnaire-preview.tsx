import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, FileText, ShieldCheck, TriangleAlert } from "lucide-react";
import { CMMC_L1_REQUIREMENTS, CMMC_L1_SCOPE_GUIDANCE, type CmmcStatus } from "@shared/cmmc-level1-fields";
import { cn } from "@/lib/utils";

type ControlAnswer = {
  status: CmmcStatus;
  objectiveStatuses: Record<string, CmmcStatus>;
  objectiveRationales: Record<string, string>;
  owner: string;
  evidence: string;
  evidenceDate: string;
};

const EMPTY_ANSWERS: Record<string, ControlAnswer> = Object.fromEntries(
  CMMC_L1_REQUIREMENTS.map((requirement) => [requirement.id, { status: "", objectiveStatuses: {}, objectiveRationales: {}, owner: "", evidence: "", evidenceDate: "" }]),
);

function AnswerButton({ value, selected, onClick }: { value: Exclude<CmmcStatus, "">; selected: CmmcStatus; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn("rounded-md border px-3 py-1.5 text-xs font-semibold transition", selected === value ? value === "met" ? "border-emerald-600 bg-emerald-600 text-white" : value === "not_met" ? "border-amber-600 bg-amber-600 text-white" : "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")}>{value === "met" ? "Met" : value === "not_met" ? "Not met" : "Not applicable"}</button>;
}

export default function CmmcQuestionnairePreviewPage() {
  const [company, setCompany] = useState("Lake County Tool Works North");
  const [official, setOfficial] = useState("");
  const [scope, setScope] = useState("");
  const [cageCodes, setCageCodes] = useState("");
  const [statusDate, setStatusDate] = useState("");
  const [answers, setAnswers] = useState(EMPTY_ANSWERS);
  const [submitted, setSubmitted] = useState(false);
  const totalObjectives = CMMC_L1_REQUIREMENTS.reduce((total, requirement) => total + requirement.objectivePrompts.length, 0);
  const progress = useMemo(() => {
    const answered = CMMC_L1_REQUIREMENTS.reduce((total, requirement) => total + (answers[requirement.id]?.status ? 1 : 0) + requirement.objectivePrompts.filter((_, index) => answers[requirement.id]?.objectiveStatuses?.[String(index)]).length, 0);
    const total = CMMC_L1_REQUIREMENTS.length + totalObjectives;
    const ready = answered === total && CMMC_L1_REQUIREMENTS.every((requirement) => answers[requirement.id]?.status === "met" && requirement.objectivePrompts.every((_, index) => {
      const finding = answers[requirement.id]?.objectiveStatuses?.[String(index)];
      return finding === "met" || (finding === "not_applicable" && Boolean(answers[requirement.id]?.objectiveRationales?.[String(index)]?.trim()));
    }));
    return { answered, total, ready, complete: answered === total };
  }, [answers, totalObjectives]);
  const update = (id: string, patch: Partial<ControlAnswer>) => setAnswers((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const updateObjective = (id: string, index: number, value: CmmcStatus) => setAnswers((current) => ({ ...current, [id]: { ...current[id], objectiveStatuses: { ...current[id].objectiveStatuses, [String(index)]: value } } }));
  const updateObjectiveRationale = (id: string, index: number, value: string) => setAnswers((current) => ({ ...current, [id]: { ...current[id], objectiveRationales: { ...current[id].objectiveRationales, [String(index)]: value } } }));

  return <div className="min-h-screen overflow-y-auto bg-slate-50 text-slate-950"><main className="mx-auto max-w-6xl px-5 py-8 space-y-6">
    <header className="rounded-2xl bg-slate-950 px-6 py-8 text-white shadow-sm"><div className="flex items-start gap-4"><div className="rounded-xl bg-white/10 p-3"><ShieldCheck className="h-7 w-7" /></div><div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-200">Interactive preview</p><h1 className="mt-2 text-3xl font-bold">CMMC Level 1 self-assessment preparation</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200">This preview uses the official 15-requirement / 59-objective structure. It saves nothing, makes no SPRS submission, and never certifies a company.</p></div></div></header>
    <section className="grid gap-5 lg:grid-cols-[1.5fr,1fr]"><div className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-blue-700" /><h2 className="font-bold">Assessment profile</h2></div><div className="mt-5 grid gap-4 md:grid-cols-2"><Field label="Organization"><input value={company} onChange={(event) => setCompany(event.target.value)} className="field" /></Field><Field label="Affirming Official"><input value={official} onChange={(event) => setOfficial(event.target.value)} className="field" placeholder="Name and title" /></Field><Field label="Industry CAGE code(s)"><input value={cageCodes} onChange={(event) => setCageCodes(event.target.value)} className="field" placeholder="Separate multiple codes with commas" /></Field><Field label="CMMC Status Date (if known)"><input type="date" value={statusDate} onChange={(event) => setStatusDate(event.target.value)} className="field" /></Field><div className="md:col-span-2"><Field label="FCI assessment scope"><textarea value={scope} onChange={(event) => setScope(event.target.value)} className="field min-h-28" placeholder={CMMC_L1_SCOPE_GUIDANCE} /></Field></div></div></div>
      <aside className={cn("rounded-2xl border p-6 shadow-sm", progress.ready ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50")}><FileText className="h-6 w-6" /><h2 className="mt-3 font-bold">{progress.ready ? "Final Level 1 (Self) candidate" : "Preparation status"}</h2><p className="mt-2 text-sm leading-6">{progress.ready ? "Every requirement is Met, and every objective is Met or a documented Not applicable determination. The customer still completes its own SPRS entry and affirmation." : `${progress.answered} of ${progress.total} required responses are complete. Any Not met response or unsupported Not applicable determination prevents this preview from representing a Final Level 1 (Self) result.`}</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/80"><div className="h-full bg-slate-900 transition-all" style={{ width: `${(progress.answered / progress.total) * 100}%` }} /></div><p className="mt-3 text-xs">Evidence retention is provisional until an actual CMMC Status Date is recorded.</p></aside></section>
    {!progress.ready && progress.complete && <div className="flex gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-5 text-amber-950"><TriangleAlert className="h-5 w-5 shrink-0" /><p className="text-sm"><strong>Not ready for Final Level 1 (Self).</strong> Level 1 does not allow POA&amp;Ms. Correct and reassess every Not met gap, and document every Not applicable determination, before representing a Final Level 1 (Self) result.</p></div>}
    <section className="space-y-4">{CMMC_L1_REQUIREMENTS.map((requirement) => <article key={requirement.id} className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-700">{requirement.number}. {requirement.practice}</p><h2 className="mt-1 text-lg font-bold">{requirement.title}</h2><p className="mt-2 text-sm text-slate-600">{requirement.baseline}</p></div><div className="flex gap-2"><AnswerButton value="met" selected={answers[requirement.id]?.status} onClick={() => update(requirement.id, { status: "met" })} /><AnswerButton value="not_met" selected={answers[requirement.id]?.status} onClick={() => update(requirement.id, { status: "not_met" })} /></div></div><div className="mt-5 space-y-3">{requirement.objectivePrompts.map((prompt, index) => <div key={prompt} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><p className="max-w-3xl text-sm font-medium"><span className="mr-2 text-blue-700">{requirement.practice} [{requirement.objectiveLabels[index]}]</span>{prompt}</p><div className="flex flex-wrap gap-2"><AnswerButton value="met" selected={answers[requirement.id]?.objectiveStatuses?.[String(index)]} onClick={() => updateObjective(requirement.id, index, "met")} /><AnswerButton value="not_met" selected={answers[requirement.id]?.objectiveStatuses?.[String(index)]} onClick={() => updateObjective(requirement.id, index, "not_met")} /><AnswerButton value="not_applicable" selected={answers[requirement.id]?.objectiveStatuses?.[String(index)]} onClick={() => updateObjective(requirement.id, index, "not_applicable")} /></div></div><p className="mt-2 text-xs text-slate-500">{requirement.objectiveGuidance[index]}</p>{answers[requirement.id]?.objectiveStatuses?.[String(index)] === "not_applicable" && <div className="mt-3"><Field label="Not applicable rationale (required)"><textarea value={answers[requirement.id]?.objectiveRationales?.[String(index)] || ""} onChange={(event) => updateObjectiveRationale(requirement.id, index, event.target.value)} className="field min-h-20" placeholder="Why this determination is outside the stated FCI assessment scope" /></Field></div>}</div>)}</div><div className="mt-5 grid gap-3 md:grid-cols-3"><Field label="Accountable owner"><input className="field" value={answers[requirement.id]?.owner} onChange={(event) => update(requirement.id, { owner: event.target.value })} /></Field><Field label="Evidence locator"><input className="field" value={answers[requirement.id]?.evidence} onChange={(event) => update(requirement.id, { evidence: event.target.value })} placeholder="Policy, ticket, setting, inventory…" /></Field><Field label="Evidence date"><input className="field" type="date" value={answers[requirement.id]?.evidenceDate} onChange={(event) => update(requirement.id, { evidenceDate: event.target.value })} /></Field></div></article>)}</section>
    <section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="font-bold">Affirming Official acknowledgment</h2><p className="mt-2 text-sm leading-6 text-slate-600">The company’s Affirming Official reviews the facts, enters the result in SPRS, and makes any official affirmation there. This preview does not do those things.</p><button type="button" disabled={!progress.complete || submitted} onClick={() => setSubmitted(true)} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />{submitted ? "Preview packet prepared" : "Prepare preview packet"}</button>{submitted && <p className="mt-3 text-sm font-medium text-slate-700">{progress.ready ? "Preview complete — customer must still perform its own SPRS entry and affirmation." : "Preview complete with blocked findings — not a Final Level 1 (Self) result."}</p>}</section>
  </main></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-semibold text-slate-700"><span className="mb-1.5 block">{label}</span>{children}</label>;
}