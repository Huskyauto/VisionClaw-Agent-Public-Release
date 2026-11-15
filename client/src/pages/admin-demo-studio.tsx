import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { demoProjectSchema, renderDemoHtml } from "@shared/demo-studio";
import type { DemoProject, DemoStep } from "@shared/demo-studio";
import { ArrowDown, ArrowUp, Download, FilePlus2, ImagePlus, Plus, ShieldCheck, Trash2, Upload, X } from "lucide-react";

type DraftStep = DemoStep & { uiId: string };
type Draft = Omit<DemoProject, "steps"> & { steps: DraftStep[] };
const initial: Draft = {
  version: 1,
  title: "A report, prepared with care",
  steps: [
    { uiId: crypto.randomUUID(), title: "Prepare the report", description: "Gather the materials needed for a clear report. This illustrated reconstruction shows a possible review flow; it is not a recording of a live system.", seconds: 7 },
    { uiId: crypto.randomUUID(), title: "Review the details", description: "Read through the draft, check the important details, and note anything that needs clarification before delivery.", seconds: 8 },
    { uiId: crypto.randomUUID(), title: "Deliver the report", description: "When the report is ready, share it with its intended audience. This walkthrough describes a process; it does not claim that any report was created or sent.", seconds: 7 },
  ],
};
const toProject = (draft: Draft): DemoProject => ({ version: 1, title: draft.title, steps: draft.steps.map(({ uiId: _uiId, ...step }) => step) });
const errorText = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Your draft is still available.";

export default function AdminDemoStudioPage() {
  const { tenant, isChecking } = useAuth();
  const [, navigate] = useLocation();
  const isOwner = !isChecking && tenant?.id === 1 && tenant?.isAdmin === true;
  const [draft, setDraft] = useState<Draft>(initial);
  const [notice, setNotice] = useState("");
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [previewProject, setPreviewProject] = useState<DemoProject | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const screenshotInputs = useRef(new Map<string, HTMLInputElement>());
  const screenshotGenerations = useRef(new Map<string, number>());
  const generationCounter = useRef(0);
  const importGeneration = useRef(0);
  const draftRevision = useRef(0);
  const currentDraft = useRef(draft);
  const ownerRef = useRef(isOwner);
  currentDraft.current = draft;
  ownerRef.current = isOwner;
  const reviseDraft = (next: Draft | ((value: Draft) => Draft)) => {
    if (!ownerRef.current) return;
    draftRevision.current++;
    setDraft(next);
  };
  const invalidateScreenshot = (id: string) => {
    const generation = ++generationCounter.current;
    screenshotGenerations.current.set(id, generation);
    return generation;
  };
  const invalidateAllScreenshots = () => {
    generationCounter.current++;
    screenshotGenerations.current.clear();
  };

  useEffect(() => {
    if (!isChecking && !isOwner) {
      importGeneration.current++;
      generationCounter.current++;
      screenshotGenerations.current.clear();
      draftRevision.current++;
      setDraft({ version: 1, title: "", steps: [] });
      setNotice("");
      setReplaceFile(null);
      setConfirmReplace(false);
      setPreviewProject(null);
      setPendingNavigation(null);
    }
  }, [isOwner, isChecking]);

  useEffect(() => {
    if (!isOwner) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isOwner]);

  useEffect(() => {
    if (!isOwner) return;
    const guardAppNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("blob:") || (anchor.target && anchor.target !== "_self")) return;
      let destination: URL;
      try { destination = new URL(anchor.href, window.location.href); } catch { return; }
      if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingNavigation(`${destination.pathname}${destination.search}${destination.hash}`);
    };
    document.addEventListener("click", guardAppNavigation, true);
    return () => document.removeEventListener("click", guardAppNavigation, true);
  }, [isOwner, navigate]);

  const parsed = useMemo(() => demoProjectSchema.safeParse(toProject(draft)), [draft]);
  const issues = parsed.success ? [] : parsed.error.issues;
  const issueFor = (path: string) => issues.find(issue => issue.path.join(".") === path)?.message;
  const previewHtml = useMemo(() => previewProject ? renderDemoHtml(previewProject) : "", [previewProject]);
  useEffect(() => {
    if (!isOwner || !parsed.success) { setPreviewProject(null); return; }
    const timer = window.setTimeout(() => setPreviewProject(parsed.data), 350);
    return () => window.clearTimeout(timer);
  }, [draft, isOwner]); // draft is local editable state; preview only advances after a short pause.

  if (isChecking) return <div className="min-h-[60dvh] bg-[#f4f2e9] p-6"><div className="mx-auto max-w-6xl space-y-4"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-80 rounded-2xl" /></div></div>;
  if (!isOwner) return <div className="flex min-h-[60dvh] items-center justify-center bg-[#f4f2e9] p-6"><Card className="max-w-md border-[#d7d5ca] bg-[#fbfaf5]"><CardContent className="p-8 text-center"><ShieldCheck className="mx-auto h-8 w-8 text-[#536b63]" /><h1 className="mt-4 font-serif text-2xl text-[#283b37]">Owner access only</h1><p className="mt-2 text-sm leading-6 text-[#697570]">Demo Studio is available to the VisionClaw owner account only.</p></CardContent></Card></div>;

  const guard = () => isOwner && !!currentDraft.current.steps.length;
  const updateStep = (id: string, update: Partial<DemoStep>) => {
    if (!guard()) return;
    reviseDraft(value => ({ ...value, steps: value.steps.map(step => step.uiId === id ? { ...step, ...update } : step) }));
  };
  const addStep = () => {
    if (!isOwner || draft.steps.length >= 12) return;
    const step: DraftStep = { uiId: crypto.randomUUID(), title: `Step ${draft.steps.length + 1}`, description: "", seconds: 6 };
    reviseDraft(value => ({ ...value, steps: [...value.steps, step] }));
  };
  const moveStep = (index: number, direction: number) => {
    if (!guard()) return;
    reviseDraft(value => {
      const next = [...value.steps], to = index + direction;
      if (to < 0 || to >= next.length) return value;
      [next[index], next[to]] = [next[to], next[index]];
      return { ...value, steps: next };
    });
  };
  const deleteStep = (id: string) => {
    if (!guard() || draft.steps.length <= 1) return;
    invalidateScreenshot(id);
    reviseDraft(value => ({ ...value, steps: value.steps.filter(step => step.uiId !== id) }));
    screenshotInputs.current.delete(id);
  };
  const loadScreenshot = async (id: string, file?: File) => {
    if (!isOwner || !file) return;
    const generation = invalidateScreenshot(id);
    const validType = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
    if (!validType || file.size > 1_000_000) {
      setNotice("Choose a PNG, JPEG or WebP image no larger than 1 MB.");
      return;
    }
    setNotice("");
    const reader = new FileReader();
    reader.onerror = () => {
      if (ownerRef.current && screenshotGenerations.current.get(id) === generation) {
        setNotice("That image could not be read. Your other edits are unchanged.");
      }
    };
    reader.onload = () => {
      if (!ownerRef.current || screenshotGenerations.current.get(id) !== generation || typeof reader.result !== "string") return;
      // Resolve by stable identity only when read completes; deleted/switched steps never receive these bytes.
      if (!currentDraft.current.steps.some(step => step.uiId === id)) return;
      updateStep(id, { screenshot: reader.result, pointer: undefined });
    };
    reader.readAsDataURL(file);
  };
  const download = (content: string, filename: string, type: string) => {
    if (!isOwner) return;
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportHtml = () => {
    if (!isOwner || !parsed.success) { setNotice("Fix the validation issues before exporting HTML."); return; }
    try { download(renderDemoHtml(parsed.data), "visionclaw-walkthrough.html", "text/html;charset=utf-8"); setNotice("HTML download requested. Check your downloads folder for the offline walkthrough."); }
    catch (error) { setNotice(errorText(error)); }
  };
  const saveJson = () => {
    if (!isOwner || !parsed.success) { setNotice("Fix the validation issues before downloading the project."); return; }
    try {
      download(JSON.stringify(parsed.data), "visionclaw-demo-project.json", "application/json");
      setNotice("Project download requested. Check your downloads folder; Demo Studio does not retain this draft.");
    } catch (error) { setNotice(`Could not start the project download: ${errorText(error)}`); }
  };
  const chooseJson = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    importGeneration.current++;
    if (!file) return;
    if (file.size > 6_000_000) { setNotice("Project files must be no larger than 6 MB."); return; }
    setNotice(""); setReplaceFile(file); setConfirmReplace(true);
  };
  const importJson = async () => {
    if (!isOwner || !replaceFile) return;
    const generation = ++importGeneration.current;
    const startingDraftRevision = draftRevision.current;
    const file = replaceFile;
    try {
      if (file.size > 6_000_000) throw new Error("Project files must be no larger than 6 MB.");
      const text = await file.text();
      if (!ownerRef.current || importGeneration.current !== generation || draftRevision.current !== startingDraftRevision) return;
      const raw: unknown = JSON.parse(text);
      const result = demoProjectSchema.safeParse(raw);
      if (!result.success) throw new Error(result.error.issues[0]?.message ?? "This project does not match the supported format.");
      const next: Draft = { ...result.data, steps: result.data.steps.map(step => ({ ...step, uiId: crypto.randomUUID() })) };
      if (JSON.stringify(toProject(next)).length > 6_000_000) throw new Error("Project must be under 6 MB.");
      if (!ownerRef.current || importGeneration.current !== generation || draftRevision.current !== startingDraftRevision) return;
      invalidateAllScreenshots();
      reviseDraft(next); setNotice("Project reopened. Changes are still only in this browser session until downloaded.");
      setConfirmReplace(false); setReplaceFile(null);
    } catch (error) {
      if (ownerRef.current && importGeneration.current === generation && draftRevision.current === startingDraftRevision) setNotice(`Could not open project: ${errorText(error)}`);
    }
  };
  const inputClass = "min-h-11 border-[#d7d8cd] bg-[#fffefa] text-[#293733] focus-visible:ring-[#769084]";

  return <div className="min-h-full overflow-y-auto bg-[#f4f2e9] text-[#293733]">
    <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-7 lg:px-9">
      <header className="mb-6 overflow-hidden rounded-[22px] border border-[#d8d7ca] bg-[#e6e9dc]">
        <div className="grid gap-5 p-5 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="min-w-0"><p className="mb-3 text-[10px] font-bold uppercase tracking-[.22em] text-[#65776a]">VisionClaw · owner workbench</p><h1 className="max-w-3xl break-words font-serif text-3xl leading-tight tracking-tight text-[#253b35] sm:text-5xl">Demo Studio</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[#596760]">Build a reusable, playable explanation. This draft lives only in this page until you download its project file.</p></div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" onChange={chooseJson} aria-label="Choose a Demo Studio project JSON file" />
            <Button variant="outline" className="min-h-11 border-[#bcc8b7] bg-[#f8f8f0] text-[#40584b]" onClick={() => isOwner && fileInput.current?.click()}><Upload className="mr-2 h-4 w-4" />Open project</Button>
            <Button variant="outline" className="min-h-11 border-[#bcc8b7] bg-[#f8f8f0] text-[#40584b]" onClick={saveJson} disabled={!parsed.success}><Download className="mr-2 h-4 w-4" />Save project JSON</Button>
            <Button className="min-h-11 bg-[#425f54] text-[#f8f6ed] hover:bg-[#314b41]" onClick={exportHtml} disabled={!parsed.success}><Download className="mr-2 h-4 w-4" />Export HTML</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[#cfd4c7] bg-[#dce2d6] px-5 py-3 text-xs text-[#596760] sm:px-8"><span className="font-semibold text-[#344d43]">Local draft only</span><span>Nothing is uploaded or saved automatically. Leaving this page may discard changes.</span><span className="ml-auto">Offline playback · reconstruction, not a live recording</span></div>
      </header>
      {notice && <div role="status" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-[#c9d4c5] bg-[#edf1e8] px-4 py-3 text-sm leading-5 text-[#40584b]"><span className="break-words">{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message" className="min-h-11 min-w-11 rounded-lg hover:bg-[#dce5d8]"><X className="mx-auto h-4 w-4" /></button></div>}
      {pendingNavigation && <div role="alertdialog" aria-labelledby="leave-title" aria-describedby="leave-desc" className="mb-5 rounded-2xl border border-[#d7c9a8] bg-[#faf5e8] p-4 sm:flex sm:items-center sm:justify-between sm:gap-5"><div className="min-w-0"><h2 id="leave-title" className="font-semibold text-[#554c35]">Leave Demo Studio?</h2><p id="leave-desc" className="mt-1 break-words text-sm leading-5 text-[#71694f]">This draft is only in this page and will be lost when you leave. Choose Save project JSON first if you want to reopen it later.</p></div><div className="mt-3 flex shrink-0 gap-2 sm:mt-0"><Button variant="outline" className="min-h-11" onClick={() => setPendingNavigation(null)}>Stay editing</Button><Button className="min-h-11 bg-[#8d5546] hover:bg-[#754436]" onClick={() => { const path = pendingNavigation; setPendingNavigation(null); navigate(path); }}>Leave without saving</Button></div></div>}
      {confirmReplace && <div role="alertdialog" aria-labelledby="replace-title" aria-describedby="replace-desc" className="mb-5 rounded-2xl border border-[#d7c9a8] bg-[#faf5e8] p-4 sm:flex sm:items-center sm:justify-between sm:gap-5"><div className="min-w-0"><h2 id="replace-title" className="font-semibold text-[#554c35]">Replace this draft?</h2><p id="replace-desc" className="mt-1 break-words text-sm leading-5 text-[#71694f]">Opening {replaceFile?.name} replaces the current page draft. Download it first if you want to keep it.</p></div><div className="mt-3 flex shrink-0 gap-2 sm:mt-0"><Button variant="outline" className="min-h-11" onClick={() => { importGeneration.current++; setConfirmReplace(false); setReplaceFile(null); }}>Keep editing</Button><Button className="min-h-11 bg-[#425f54]" onClick={importJson}>Replace draft</Button></div></div>}
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(350px,.82fr)]">
        <main className="min-w-0 space-y-5">
          <Card className="border-[#d9d7ca] bg-[#fbfaf5] shadow-sm"><CardContent className="space-y-4 p-5 sm:p-6">
            <Field label="Walkthrough title" help="A short name shown on the exported walkthrough. Up to 120 characters." error={issueFor("title")}><Input className={inputClass} maxLength={120} value={draft.title} onChange={e => reviseDraft(v => ({ ...v, title: e.target.value }))} placeholder="Example: How a report moves from draft to delivery" /></Field>
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e5e3d8] pb-3"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#748273]">Sequence / {draft.steps.length} of 12</p><h2 className="mt-1 font-serif text-2xl text-[#2f463d]">Walkthrough steps</h2></div><Button onClick={addStep} disabled={draft.steps.length >= 12} className="min-h-11 bg-[#425f54] text-[#f8f6ed] hover:bg-[#314b41]"><Plus className="mr-2 h-4 w-4" />Add step</Button></div>
            <div className="space-y-4">{draft.steps.map((step, index) => <section key={step.uiId} className="min-w-0 rounded-2xl border border-[#dcdbd0] bg-[#f6f5ed] p-4 sm:p-5" aria-labelledby={`step-heading-${step.uiId}`}>
              <div className="mb-4 flex min-w-0 items-center gap-2"><span id={`step-heading-${step.uiId}`} className="min-w-0 flex-1 break-words text-[10px] font-bold uppercase tracking-[.16em] text-[#78847a]">Step {index + 1}</span><Button variant="outline" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => moveStep(index, -1)} className="h-11 w-11 p-0"><ArrowUp className="mx-auto h-4 w-4" /></Button><Button variant="outline" aria-label={`Move step ${index + 1} down`} disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)} className="h-11 w-11 p-0"><ArrowDown className="mx-auto h-4 w-4" /></Button><Button variant="outline" aria-label={`Delete step ${index + 1}`} disabled={draft.steps.length <= 1} onClick={() => deleteStep(step.uiId)} className="h-11 w-11 border-[#e0c8c1] p-0 text-[#9b5949]"><Trash2 className="mx-auto h-4 w-4" /></Button></div>
              <div className="space-y-4"><Field label="Step title" help="Name the moment in the story. Required, up to 120 characters." error={issueFor(`steps.${index}.title`)}><Input className={inputClass} maxLength={120} value={step.title} onChange={e => updateStep(step.uiId, { title: e.target.value })} placeholder="Example: Review the draft" /></Field>
                <Field label="Description" help="Explain what the viewer should understand. Up to 1,800 characters." error={issueFor(`steps.${index}.description`)}><Textarea className={`${inputClass} min-h-28 resize-y`} maxLength={1800} value={step.description} onChange={e => updateStep(step.uiId, { description: e.target.value })} placeholder="Example: Check the figures and flag anything that needs a second look." /></Field>
                <Field label="Duration" help="Time shown for this step during playback. Choose 2–30 seconds." error={issueFor(`steps.${index}.seconds`)}><div className="flex items-center gap-3"><Input className={`${inputClass} w-28`} type="number" min={2} max={30} step={1} value={step.seconds} onChange={e => updateStep(step.uiId, { seconds: Number(e.target.value) })} /><span className="text-sm text-[#65736a]">seconds</span></div></Field>
                <div className="rounded-xl border border-dashed border-[#cbd2c5] bg-[#fbfaf5] p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-[#4d5d53]">Screenshot (optional)</p><p className="mt-1 break-words text-[11px] leading-4 text-[#7a847b]">PNG, JPEG or WebP; up to 1 MB. Stored inside the downloaded project.</p></div><input ref={node => { if (node) screenshotInputs.current.set(step.uiId, node); else screenshotInputs.current.delete(step.uiId); }} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={`Choose screenshot for step ${index + 1}`} onChange={e => { void loadScreenshot(step.uiId, e.target.files?.[0]); e.target.value = ""; }} /><Button variant="outline" className="min-h-11 shrink-0" onClick={() => screenshotInputs.current.get(step.uiId)?.click()}><ImagePlus className="mr-2 h-4 w-4" />Choose image</Button></div>
                  {step.screenshot && <div className="mt-3 flex flex-wrap items-start gap-3"><img src={step.screenshot} alt={`Screenshot for ${step.title}`} className="max-h-40 max-w-full rounded-lg border border-[#d9d7ca] object-contain" /><Button variant="outline" className="min-h-11" onClick={() => { invalidateScreenshot(step.uiId); updateStep(step.uiId, { screenshot: undefined, pointer: undefined }); }}><X className="mr-2 h-4 w-4" />Remove image</Button></div>}
                  {issueFor(`steps.${index}.screenshot`) && <p className="mt-2 text-xs text-[#9b5949]">{issueFor(`steps.${index}.screenshot`)}</p>}
                  {step.screenshot && <div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Pointer horizontal position" help="Optional marker from left edge, 0–100%." error={issueFor(`steps.${index}.pointer.x`)}><Input className={inputClass} type="number" min={0} max={100} value={step.pointer?.x ?? ""} placeholder="Example: 48" onChange={e => updateStep(step.uiId, { pointer: e.target.value === "" ? undefined : { x: Number(e.target.value), y: step.pointer?.y ?? 50 } })} /></Field><Field label="Pointer vertical position" help="Optional marker from top edge, 0–100%." error={issueFor(`steps.${index}.pointer.y`)}><Input className={inputClass} type="number" min={0} max={100} value={step.pointer?.y ?? ""} placeholder="Example: 36" onChange={e => updateStep(step.uiId, { pointer: e.target.value === "" ? undefined : { x: step.pointer?.x ?? 50, y: Number(e.target.value) } })} /></Field></div>}
                </div>
              </div>
            </section>)}</div>
            {issues.length > 0 && <div role="alert" className="rounded-xl border border-[#e4c6be] bg-[#fff3ee] p-4 text-sm text-[#8e4d40]"><p className="font-semibold">Review these fields before preview or export</p><ul className="mt-2 list-inside list-disc space-y-1">{issues.slice(0, 8).map((issue, i) => <li key={`${issue.path.join(".")}-${i}`} className="break-words">{issue.path.length ? `${issue.path.join(".")}: ` : ""}{issue.message}</li>)}</ul>{issues.length > 8 && <p className="mt-2">And {issues.length - 8} more.</p>}</div>}
          </CardContent></Card>
        </main>
        <aside className="min-w-0 xl:sticky xl:top-4">
          <Card className="overflow-hidden border-[#394f45] bg-[#334b41] text-[#f1f0e8] shadow-sm"><div className="border-b border-white/15 px-5 py-4 sm:px-6"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#b8c8b6]">Live preview</p><h2 className="mt-1 font-serif text-xl text-[#f1f0e8]">An offline walkthrough</h2><p className="mt-1 text-xs leading-5 text-[#d1d9cf]">Preview pauses at your latest valid draft. Playback controls are inside the frame.</p></div>
            {parsed.success && previewProject ? <iframe title={`Preview: ${previewProject.title || "walkthrough"}`} srcDoc={previewHtml} sandbox="allow-scripts" className="block h-[520px] w-full border-0 bg-[#101820] sm:h-[620px]" /> :
            <div className="flex min-h-[420px] flex-col items-center justify-center px-8 text-center"><div className="mb-4 h-10 w-10 animate-pulse rounded-xl bg-white/10" /><p className="font-serif text-lg">Preview needs a valid draft.</p><p className="mt-2 max-w-xs text-sm leading-5 text-[#d1d9cf]">Your text stays editable. Fix the highlighted fields, then the walkthrough will appear here.</p></div>}
            <CardContent className="space-y-3 border-t border-white/15 p-5 text-xs leading-5 text-[#d1d9cf] sm:p-6"><p><strong className="text-[#f0f0e5]">Reconstruction.</strong> These are authored explanations, not a live screen recording or proof of work.</p><p><strong className="text-[#f0f0e5]">Local until downloaded.</strong> This page does not persist drafts. Save the JSON project to reopen it later; export HTML to share an offline player.</p><p><strong className="text-[#f0f0e5]">No automatic downloads.</strong> Export and save happen only when you choose those actions.</p></CardContent>
          </Card>
        </aside>
      </div>
    </div>
  </div>;
}

function Field({ label, help, error, children }: { label: string; help: string; error?: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5"><span className="block text-xs font-semibold text-[#4d5d53]">{label}</span>{children}<span className="block break-words text-[11px] leading-4 text-[#7a847b]">{help}</span>{error && <span role="alert" className="block break-words text-xs text-[#9b5949]">{error}</span>}</label>;
}
