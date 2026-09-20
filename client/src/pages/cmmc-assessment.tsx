import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, Plus, Save, Send, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { CMMC_AFFIRMATION_KEYS, CMMC_L1_SCOPE_GUIDANCE, calculatedCmmcRequirementResult, describeCmmcValidationIssues, isCmmcAssessmentLocked, isCmmcLevel1SelfReady, validateCmmcSubmission } from "@shared/cmmc-level1-fields";
import { useToast } from "@/hooks/use-toast";

const CMMC_REQUEST_TIMEOUT_MS = 15_000;
const CMMC_NAVIGATION_STORAGE_PREFIX = "vc_cmmc_navigation_";

function cmmcNavigationStorageKey(token: string): string {
  let first = 2166136261;
  let second = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    first = Math.imul(first ^ token.charCodeAt(index), 16777619);
    second = Math.imul(second ^ token.charCodeAt(token.length - index - 1), 16777619);
  }
  return `${CMMC_NAVIGATION_STORAGE_PREFIX}${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

async function fetchCmmc(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CMMC_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("The questionnaire server took too long to respond. Please try again.", { cause: error });
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function CmmcAssessmentPage() {
  const [, params] = useRoute("/cmmc/assessment/:token");
  const token = params?.token || "";
  const { toast } = useToast();
  const [draft, setDraft] = useState<any>(null);
  const [signature, setSignature] = useState({ authorizedOfficialName: "", authorizedOfficialTitle: "", authorizedOfficialEmail: "" });
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [collapsedRequirements, setCollapsedRequirements] = useState<Set<string>>(new Set());
  const activeRequirementRef = useRef<string | null>(null);
  const navigationInteractedRef = useRef(false);
  const navigationRestoredRef = useRef(false);
  const navigationStorageKey = useMemo(() => cmmcNavigationStorageKey(token), [token]);
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["cmmc", token],
    queryFn: async () => {
      const response = await fetchCmmc(`/api/public/cmmc/${token}`);
      if (!response.ok) {
        const requestError = new Error((await response.json()).error) as Error & { status?: number };
        requestError.status = response.status;
        throw requestError;
      }
      return response.json();
    },
  });
  const activeDraft = draft ?? data?.assessment?.draft ?? null;
  const locked = submitted || isCmmcAssessmentLocked(data?.assessment?.status);
  const inputsDisabled = locked || isSubmitting;
  useEffect(() => {
    navigationInteractedRef.current = false;
    navigationRestoredRef.current = false;
    activeRequirementRef.current = null;
  }, [navigationStorageKey]);
  useEffect(() => {
    if ((error as (Error & { status?: number }) | null)?.status !== 404) return;
    try { localStorage.removeItem(navigationStorageKey); } catch {}
  }, [error, navigationStorageKey]);
  useEffect(() => {
    if (!data?.requirements || navigationRestoredRef.current || navigationInteractedRef.current) return;
    navigationRestoredRef.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(navigationStorageKey) || "null");
      const requirementIds = new Set<string>(data.requirements.map((requirement: any) => requirement.id));
      if (!saved || !requirementIds.has(saved.requirementId) || !Number.isFinite(saved.offset)) {
        localStorage.removeItem(navigationStorageKey);
        return;
      }
      activeRequirementRef.current = saved.requirementId;
      setCollapsedRequirements((current) => {
        const next = new Set(current);
        next.delete(saved.requirementId);
        return next;
      });
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const requirement = document.getElementById(`cmmc-requirement-${saved.requirementId}`);
        if (!navigationInteractedRef.current && requirement) {
          window.scrollTo({ top: Math.max(0, requirement.offsetTop + saved.offset), behavior: "auto" });
        }
      }));
    } catch {
      try { localStorage.removeItem(navigationStorageKey); } catch {}
    }
  }, [data?.requirements, navigationStorageKey]);
  useEffect(() => {
    if (!data?.requirements) return;
    let timeout: number | undefined;
    const updateActiveRequirement = () => {
      const anchor = window.innerHeight * 0.35;
      let closest: { id: string; distance: number } | null = null;
      for (const requirement of data.requirements) {
        const element = document.getElementById(`cmmc-requirement-${requirement.id}`);
        if (!element) continue;
        const distance = Math.abs(element.getBoundingClientRect().top - anchor);
        if (!closest || distance < closest.distance) closest = { id: requirement.id, distance };
      }
      if (closest) activeRequirementRef.current = closest.id;
    };
    const persistNavigation = () => {
      updateActiveRequirement();
      if (!activeRequirementRef.current) return;
      const requirement = document.getElementById(`cmmc-requirement-${activeRequirementRef.current}`);
      if (!requirement) return;
      try {
        localStorage.setItem(navigationStorageKey, JSON.stringify({
          requirementId: activeRequirementRef.current,
          offset: window.scrollY - requirement.offsetTop,
        }));
      } catch {}
    };
    const onScroll = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(persistNavigation, 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persistNavigation);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persistNavigation);
      persistNavigation();
    };
  }, [data?.requirements, navigationStorageKey]);
  const completion = useMemo(() => {
    if (!activeDraft || !data?.requirements) return { complete: false, ready: false, issues: [], completedRequirements: 0, completedObjectives: 0, totalRequirements: 0, totalObjectives: 0 };
    const validation = validateCmmcSubmission({
      company: "Validation Company",
      authorizedOfficialName: signature.authorizedOfficialName,
      authorizedOfficialTitle: signature.authorizedOfficialTitle,
      authorizedOfficialEmail: signature.authorizedOfficialEmail,
      typedSignature: signature.authorizedOfficialName,
      signedAt: new Date().toISOString(),
      draft: activeDraft,
    });
    const issues = describeCmmcValidationIssues(validation.missing);
    const requirementIssues = new Set(issues.map((issue) => issue.requirementId).filter(Boolean));
    const objectiveIssues = new Set(issues.filter((issue) => issue.requirementId && issue.objectiveIndex !== undefined).map((issue) => `${issue.requirementId}:${issue.objectiveIndex}`));
    const totalObjectives = data.requirements.reduce((total: number, requirement: any) => total + requirement.objectivePrompts.length, 0);
    return {
      complete: validation.ok,
      ready: isCmmcLevel1SelfReady(activeDraft),
      missing: validation.missing,
      issues,
      completedRequirements: data.requirements.filter((requirement: any) => !requirementIssues.has(requirement.id)).length,
      completedObjectives: data.requirements.reduce((total: number, requirement: any) => total + requirement.objectivePrompts.filter((_: string, index: number) => !objectiveIssues.has(`${requirement.id}:${index}`)).length, 0),
      totalRequirements: data.requirements.length,
      totalObjectives,
    };
  }, [activeDraft, data, signature]);

  if (error) return <div className="min-h-screen grid place-items-center p-6 text-center"><Card><CardContent className="p-8">{(error as Error).message}</CardContent></Card></div>;
  if (isLoading || !activeDraft) return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin" /></div>;

  const updateDraft = (field: string, value: string) => setDraft({ ...activeDraft, [field]: value });
  const updateControl = (id: string, field: string, value: string, index?: number) => setDraft((old: any) => {
    const base = old ?? activeDraft;
    const control = base.controls[id];
    return {
      ...base,
      controls: {
        ...base.controls,
        [id]: {
          ...control,
          [field]: index === undefined ? value : { ...(control[field] || {}), [String(index)]: value },
        },
      },
    };
  });
  const updateEvidenceRecords = (id: string, records: any[]) => setDraft((old: any) => {
    const base = old ?? activeDraft;
    return { ...base, controls: { ...base.controls, [id]: { ...base.controls[id], evidenceRecords: records } } };
  });
  const updateCorrectiveAction = (id: string, index: number, field: string, value: string) => setDraft((old: any) => {
    const base = old ?? activeDraft;
    const control = base.controls[id];
    const key = String(index);
    return { ...base, controls: { ...base.controls, [id]: {
      ...control,
      objectiveCorrectiveActions: {
        ...(control.objectiveCorrectiveActions || {}),
        [key]: { ...(control.objectiveCorrectiveActions?.[key] || {}), [field]: value },
      },
    } } };
  });
  const jumpTo = (sectionId: string, requirementId?: string, targetId?: string) => {
    navigationInteractedRef.current = true;
    if (requirementId) {
      activeRequirementRef.current = requirementId;
      setCollapsedRequirements((current) => {
        const next = new Set(current);
        next.delete(requirementId);
        return next;
      });
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const section = document.getElementById(sectionId);
      const target = targetId ? document.getElementById(targetId) : null;
      (target || section)?.scrollIntoView({ behavior: "smooth", block: "center" });
      const actionable = target?.matches("input, textarea, select, button") ? target : target?.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])");
      const sectionActionable = section?.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])");
      (actionable || sectionActionable || section)?.focus({ preventScroll: Boolean(target) });
    }));
  };
  const jumpToNextIssue = () => {
    const issue = completion.issues[0];
    if (issue) jumpTo(issue.sectionId, issue.requirementId, issue.targetId);
  };
  const toggleRequirement = (id: string) => setCollapsedRequirements((current) => {
    navigationInteractedRef.current = true;
    const next = new Set(current);
    if (next.has(id)) {
      next.delete(id);
      activeRequirementRef.current = id;
    } else {
      next.add(id);
    }
    return next;
  });
  const save = async () => {
    try {
      const response = await fetchCmmc(`/api/public/cmmc/${token}/draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: activeDraft }) });
      setMessage(response.ok ? "Draft saved." : "Unable to save draft.");
    } catch (saveError) {
      console.error("CMMC draft save failed", saveError);
      setMessage("Unable to save draft. Please try again.");
    }
  };
  const submit = async () => {
    if (inputsDisabled) return;
    setIsSubmitting(true);
    try {
      const response = await fetchCmmc(`/api/public/cmmc/${token}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...signature, signedAt: new Date().toISOString(), draft: activeDraft }),
      });
      const body = await response.json();
      if (response.ok) {
        setSubmitted(true);
        setMessage(completion.ready ? "Your signed response was submitted successfully." : "Your signed response has blocking findings and is not a Final Level 1 (Self) result.");
        toast({ title: "Response submitted successfully", description: "Your signed response is now locked. The packet will state whether gaps prevent a Final Level 1 (Self) result." });
      } else if (response.status === 409) {
        setSubmitted(true);
        setMessage("This response was already submitted and is now locked.");
      } else {
        setMessage(body.error || "Complete all required fields.");
        toast({ variant: "destructive", title: "Submission could not be completed", description: body.error || "Complete all required fields." });
      }
    } catch (submitError) {
      console.error("CMMC submission failed", submitError);
      setMessage("Unable to submit. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return <div className="min-h-screen bg-slate-50 py-8"><main className="mx-auto max-w-4xl px-4 space-y-5">
    {locked && <Card className="border-2 border-emerald-300 bg-emerald-50 shadow-sm"><CardContent role="status" aria-live="polite" className="flex gap-3 p-5 text-emerald-950"><CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" /><div><strong className="text-base">Response submitted successfully.</strong><p className="mt-1 text-sm">This signed assessment is locked to preserve the submitted snapshot. Your operator can generate the PDF and Word preparation packet.</p></div></CardContent></Card>}
    {completion.complete && !completion.ready && <Card className="border-2 border-amber-400 bg-amber-50"><CardContent className="flex gap-3 p-5 text-amber-950"><TriangleAlert className="mt-0.5 h-6 w-6 shrink-0" /><div><strong>Not ready for Final Level 1 (Self).</strong><p className="mt-1 text-sm">At least one response is Not met or a Not applicable determination lacks its required rationale. Level 1 does not allow POA&amp;Ms; each gap must be corrected or documented and reassessed before the organization can represent a Final Level 1 (Self) result.</p></div></CardContent></Card>}
    {activeDraft.legacyControls && <Card className="border-amber-300 bg-amber-50"><CardContent className="p-5 text-sm text-amber-950">Your prior visitor and physical-access draft answers were preserved as legacy reference. Please answer the six official PE.L1-b.1.ix assessment objectives below; the old split controls do not map one-for-one.</CardContent></Card>}
    <Card className="sticky top-2 z-20 border-slate-300 shadow-sm"><CardContent className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="font-semibold">Assessment progress</p><p className="text-sm text-muted-foreground">{completion.completedRequirements} of {completion.totalRequirements} requirements complete · {completion.completedObjectives} of {completion.totalObjectives} objectives complete</p></div>
        {!completion.complete && <Button type="button" onClick={jumpToNextIssue}>Next unfinished answer</Button>}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200" aria-label={`${completion.completedObjectives} of ${completion.totalObjectives} objectives complete`} role="progressbar" aria-valuemin={0} aria-valuemax={completion.totalObjectives} aria-valuenow={completion.completedObjectives}><div className="h-full bg-emerald-600 transition-all" style={{ width: `${completion.totalObjectives ? (completion.completedObjectives / completion.totalObjectives) * 100 : 0}%` }} /></div>
      {completion.issues.length > 0 && <details className="mt-3"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">{completion.issues.length} required {completion.issues.length === 1 ? "answer needs" : "answers need"} attention</summary><ul className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1">{completion.issues.map((issue) => <li key={issue.key}><button type="button" className="min-h-11 w-full rounded px-2 py-2 text-left text-sm text-amber-900 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => jumpTo(issue.sectionId, issue.requirementId, issue.targetId)}>{issue.label}</button></li>)}</ul></details>}
    </CardContent></Card>
    <Card id="cmmc-profile" tabIndex={-1}><CardHeader><CardTitle>CMMC Level 1 self-assessment preparation questionnaire</CardTitle><CardDescription>{data.disclaimer}</CardDescription></CardHeader><CardContent className="grid gap-4">
      <div><Label htmlFor="cmmc-field-systemDescription">FCI assessment scope</Label><p id="cmmc-scope-help" className="mt-1 text-sm text-muted-foreground">{CMMC_L1_SCOPE_GUIDANCE} Example: “FCI enters through approved email, is used by contract staff on managed workstations, and is stored in the approved cloud service.”</p><Textarea id="cmmc-field-systemDescription" disabled={inputsDisabled} aria-describedby="cmmc-scope-help" placeholder="Describe the full FCI boundary in plain language." value={activeDraft.systemDescription || ""} onChange={(event) => updateDraft("systemDescription", event.target.value)} /></div>
      <div className="grid gap-4 md:grid-cols-2">
        <div><Label htmlFor="cmmc-field-scopeType">Assessment-scope type</Label><select id="cmmc-field-scopeType" disabled={inputsDisabled} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={activeDraft.scopeType || ""} onChange={(event) => updateDraft("scopeType", event.target.value)}><option value="">Select a boundary</option><option value="enterprise">Enterprise</option><option value="enclave">Enclave</option><option value="contract_specific">Contract-specific</option><option value="other">Other defined boundary</option></select></div>
        <div><Label htmlFor="cmmc-field-inScopeLocations">In-scope locations</Label><Input id="cmmc-field-inScopeLocations" disabled={inputsDisabled} placeholder="Example: Main office and approved remote work locations" value={activeDraft.inScopeLocations || ""} onChange={(event) => updateDraft("inScopeLocations", event.target.value)} /></div>
      </div>
      <div><Label htmlFor="cmmc-field-inScopeAssetCategories">In-scope asset categories</Label><p className="mt-1 text-xs text-muted-foreground">Comma-separated categories only (for example: workstations, email, cloud/SaaS). Do not include IP addresses or sensitive diagrams.</p><Input id="cmmc-field-inScopeAssetCategories" disabled={inputsDisabled} value={(activeDraft.inScopeAssetCategories || []).join(", ")} onChange={(event) => setDraft({ ...activeDraft, inScopeAssetCategories: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></div>
      <div><Label htmlFor="cmmc-field-assetInventoryLocator">Asset inventory locator</Label><Input id="cmmc-field-assetInventoryLocator" disabled={inputsDisabled} placeholder="Example: Asset register → CMMC scope view" value={activeDraft.assetInventoryLocator || ""} onChange={(event) => updateDraft("assetInventoryLocator", event.target.value)} /></div>
      <div><Label htmlFor="cmmc-field-fciFlowSummary">FCI flow summary</Label><p className="mt-1 text-xs text-muted-foreground">Describe receive → access/process → store → transmit → archive/dispose without pasting FCI.</p><Textarea id="cmmc-field-fciFlowSummary" disabled={inputsDisabled} placeholder="Example: Received by approved email, processed on managed workstations, stored in the approved cloud service, then archived or disposed under policy." value={activeDraft.fciFlowSummary || ""} onChange={(event) => updateDraft("fciFlowSummary", event.target.value)} /></div>
      <div><Label htmlFor="cmmc-field-externalServiceProviders">External service providers</Label><p className="mt-1 text-xs text-muted-foreground">List provider/service, purpose, FCI interaction, owner, approval locator, and review date. Enter “None” when none are used.</p><Textarea id="cmmc-field-externalServiceProviders" disabled={inputsDisabled} value={activeDraft.externalServiceProviders || ""} onChange={(event) => updateDraft("externalServiceProviders", event.target.value)} /></div>
      <div className="grid gap-4 md:grid-cols-2"><div><Label htmlFor="cmmc-field-cageCodes">Industry CAGE code(s)</Label><p className="mt-1 text-xs text-muted-foreground">List every industry CAGE code associated with this assessment scope for SPRS preparation. Separate multiple codes with commas.</p><Input id="cmmc-field-cageCodes" disabled={inputsDisabled} value={activeDraft.cageCodes || ""} onChange={(event) => updateDraft("cageCodes", event.target.value)} /></div><div><Label htmlFor="cmmc-field-cmmcStatusDate">CMMC Status Date (if already recorded)</Label><p className="mt-1 text-xs text-muted-foreground">Optional preparation field. Use YYYY-MM-DD only when an actual Status Date is known; retention is provisional until then.</p><Input id="cmmc-field-cmmcStatusDate" disabled={inputsDisabled} type="date" value={activeDraft.cmmcStatusDate || ""} onChange={(event) => updateDraft("cmmcStatusDate", event.target.value)} /></div></div>
      <div className="grid gap-4 md:grid-cols-2"><div><Label htmlFor="cmmc-field-assessmentStartDate">Assessment start date</Label><Input id="cmmc-field-assessmentStartDate" disabled={inputsDisabled} type="date" value={activeDraft.assessmentStartDate || ""} onChange={(event) => updateDraft("assessmentStartDate", event.target.value)} /></div><div><Label htmlFor="cmmc-field-assessmentCompletionDate">Assessment completion date</Label><Input id="cmmc-field-assessmentCompletionDate" disabled={inputsDisabled} type="date" value={activeDraft.assessmentCompletionDate || ""} onChange={(event) => updateDraft("assessmentCompletionDate", event.target.value)} /></div></div>
      <div><Label htmlFor="cmmc-field-assessmentParticipants">Assessment participants</Label><Input id="cmmc-field-assessmentParticipants" disabled={inputsDisabled} placeholder="Example: IT Manager and President" value={activeDraft.assessmentParticipants || ""} onChange={(event) => updateDraft("assessmentParticipants", event.target.value)} /></div>
    </CardContent></Card>
    <nav aria-label="Requirement sections" className="flex gap-2 overflow-x-auto pb-1">{data.requirements.map((requirement: any) => <Button key={requirement.id} type="button" variant="outline" className="min-h-11 shrink-0" onClick={() => jumpTo(`cmmc-requirement-${requirement.id}`, requirement.id)}>{requirement.number}</Button>)}</nav>
    {data.requirements.map((requirement: any) => { const collapsed = collapsedRequirements.has(requirement.id); return <Card key={requirement.id} id={`cmmc-requirement-${requirement.id}`} tabIndex={-1}><CardHeader><button type="button" className="flex min-h-11 w-full items-start gap-2 text-left" aria-expanded={!collapsed} aria-controls={`cmmc-requirement-content-${requirement.id}`} onClick={() => toggleRequirement(requirement.id)}>{collapsed ? <ChevronRight className="mt-0.5 h-5 w-5 shrink-0" /> : <ChevronDown className="mt-0.5 h-5 w-5 shrink-0" />}<span><CardTitle className="text-base">{requirement.number}. {requirement.practice} — {requirement.title}</CardTitle><CardDescription className="mt-1">{requirement.baseline}</CardDescription></span></button></CardHeader>{!collapsed && <CardContent id={`cmmc-requirement-content-${requirement.id}`} className="space-y-4">
      {(activeDraft.controls[requirement.id].evidence || activeDraft.controls[requirement.id].evidenceDate) && !activeDraft.controls[requirement.id].implementationSummary && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><strong>Historical draft reference — not objective support.</strong><p>Prior owner: {activeDraft.controls[requirement.id].owner || "Not provided"} · Prior locator: {activeDraft.controls[requirement.id].evidence || "Not provided"} · Prior date: {activeDraft.controls[requirement.id].evidenceDate || "Not provided"}. Use this only as a starting point for the objective-specific fields below.</p></div>}
      <div className="rounded-md border bg-slate-50 p-3"><Label>Calculated requirement result — not an additional assessment question</Label><p className="mt-1 font-semibold">{calculatedCmmcRequirementResult(activeDraft.controls[requirement.id], requirement) === "met" ? "Met" : "Not met / incomplete"}</p></div>
      <div className="grid gap-3 md:grid-cols-2"><div><Label htmlFor={`cmmc-field-${requirement.id}-owner`}>Accountable control owner</Label><Input id={`cmmc-field-${requirement.id}-owner`} aria-label={`${requirement.practice}: Accountable control owner`} disabled={inputsDisabled} placeholder="Example: IT Administrator — Jordan Smith" value={activeDraft.controls[requirement.id].owner || ""} onChange={(event) => updateControl(requirement.id, "owner", event.target.value)} /></div><div><Label htmlFor={`cmmc-field-${requirement.id}-systemsCovered`}>Systems and locations covered</Label><Input id={`cmmc-field-${requirement.id}-systemsCovered`} aria-label={`${requirement.practice}: Systems and locations covered`} disabled={inputsDisabled} placeholder="Example: Managed workstations and approved cloud services at the main office" value={activeDraft.controls[requirement.id].systemsCovered || ""} onChange={(event) => updateControl(requirement.id, "systemsCovered", event.target.value)} /></div></div>
      <div><Label htmlFor={`cmmc-field-${requirement.id}-implementationSummary`}>Requirement implementation summary</Label><Textarea id={`cmmc-field-${requirement.id}-implementationSummary`} aria-label={`${requirement.practice}: Requirement implementation summary`} disabled={inputsDisabled} placeholder="Example: IT maintains the safeguard through documented procedures, managed settings, and a quarterly review." value={activeDraft.controls[requirement.id].implementationSummary || ""} onChange={(event) => updateControl(requirement.id, "implementationSummary", event.target.value)} /></div>
      <div><Label htmlFor={`cmmc-field-${requirement.id}-exceptions`}>Exceptions or limitations</Label><Input id={`cmmc-field-${requirement.id}-exceptions`} aria-label={`${requirement.practice}: Exceptions or limitations`} disabled={inputsDisabled} placeholder="None identified" value={activeDraft.controls[requirement.id].exceptions || ""} onChange={(event) => updateControl(requirement.id, "exceptions", event.target.value)} /></div>
      {requirement.objectivePrompts.map((prompt: string, index: number) => { const control = activeDraft.controls[requirement.id]; const key = String(index); const finding = control.objectiveStatuses?.[key]; const action = control.objectiveCorrectiveActions?.[key] || {}; return <div key={index} id={`cmmc-objective-${requirement.id}-${index}`} tabIndex={-1} className="scroll-mt-28 space-y-3 rounded-lg border p-4"><Status id={`cmmc-field-${requirement.id}-objective-${index}`} disabled={inputsDisabled} objective value={finding || ""} onChange={(value) => updateControl(requirement.id, "objectiveStatuses", value, index)} label={`${requirement.practice} [${requirement.objectiveLabels?.[index] || String.fromCharCode(97 + index)}] ${prompt}`} /><p className="text-xs text-muted-foreground">{requirement.objectiveGuidance?.[index]}</p>
        {finding === "met" && <><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveImplementation-${index}`}>Customer-stated implementation explanation (at least 12 words)</Label><Textarea id={`cmmc-field-${requirement.id}-objectiveImplementation-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Customer-stated implementation explanation`} disabled={inputsDisabled} placeholder="Example: IT limits this function through managed roles and reviews access each quarter." value={control.objectiveImplementations?.[key] || ""} onChange={(event) => updateControl(requirement.id, "objectiveImplementations", event.target.value, index)} /></div><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveEvidenceLocators-${index}`}>Evidence locators (one specific locator per line; no evidence contents)</Label><Textarea id={`cmmc-field-${requirement.id}-objectiveEvidenceLocators-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Evidence locators`} disabled={inputsDisabled} placeholder="Example: Identity console → Quarterly access review → September 2026" value={(control.objectiveEvidenceLocators?.[key] || []).join("\n")} onChange={(event) => setDraft((old: any) => { const base = old ?? activeDraft; const current = base.controls[requirement.id]; return { ...base, controls: { ...base.controls, [requirement.id]: { ...current, objectiveEvidenceLocators: { ...(current.objectiveEvidenceLocators || {}), [key]: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) } } } }; })} /></div><div className="grid gap-3 md:grid-cols-3"><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveAssessmentMethod-${index}`}>Assessment method</Label><select id={`cmmc-field-${requirement.id}-objectiveAssessmentMethod-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Assessment method`} disabled={inputsDisabled} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={control.objectiveAssessmentMethods?.[key] || ""} onChange={(event) => updateControl(requirement.id, "objectiveAssessmentMethods", event.target.value, index)}><option value="">Select</option><option value="examine">Examine</option><option value="interview">Interview</option><option value="test">Test</option><option value="examine_interview">Examine + Interview</option><option value="examine_test">Examine + Test</option><option value="interview_test">Interview + Test</option><option value="all_three">All three</option></select></div><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveEvidenceOwner-${index}`}>Evidence owner</Label><Input id={`cmmc-field-${requirement.id}-objectiveEvidenceOwner-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Evidence owner`} disabled={inputsDisabled} placeholder="Example: IT Manager" value={control.objectiveEvidenceOwners?.[key] || ""} onChange={(event) => updateControl(requirement.id, "objectiveEvidenceOwners", event.target.value, index)} /></div><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveEvidenceDate-${index}`}>Last verified date</Label><Input id={`cmmc-field-${requirement.id}-objectiveEvidenceDate-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Last verified date`} disabled={inputsDisabled} type="date" value={control.objectiveEvidenceDates?.[key] || ""} onChange={(event) => updateControl(requirement.id, "objectiveEvidenceDates", event.target.value, index)} /></div></div><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveAssessmentNote-${index}`}>Assessment note (optional, locator-level only)</Label><Input id={`cmmc-field-${requirement.id}-objectiveAssessmentNote-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Assessment note`} disabled={inputsDisabled} placeholder="Example: Examined the September review and tested one standard account" value={control.objectiveAssessmentNotes?.[key] || ""} onChange={(event) => updateControl(requirement.id, "objectiveAssessmentNotes", event.target.value, index)} /></div><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveConfidence-${index}`}>Preparation confidence — not a government assessment result</Label><select id={`cmmc-field-${requirement.id}-objectiveConfidence-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Preparation confidence`} disabled={inputsDisabled} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={control.objectiveConfidence?.[key] || ""} onChange={(event) => updateControl(requirement.id, "objectiveConfidence", event.target.value, index)}><option value="">Not selected</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div></>}
        {finding === "not_applicable" && <div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveRationale-${index}`}>Not applicable rationale</Label><p className="mt-1 text-xs text-muted-foreground">Explain which scope fact makes this objective inapplicable and how the excluded condition is prevented.</p><Textarea id={`cmmc-field-${requirement.id}-objectiveRationale-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Not applicable rationale`} disabled={inputsDisabled} value={control.objectiveRationales?.[key] || ""} onChange={(event) => updateControl(requirement.id, "objectiveRationales", event.target.value, index)} /></div>}
        {finding === "not_met" && <><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveGapStatement-${index}`}>Factual gap statement</Label><Textarea id={`cmmc-field-${requirement.id}-objectiveGapStatement-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Factual gap statement`} disabled={inputsDisabled} value={control.objectiveGapStatements?.[key] || ""} onChange={(event) => updateControl(requirement.id, "objectiveGapStatements", event.target.value, index)} /></div><div className="grid gap-3 md:grid-cols-2"><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveCorrectiveAction-action-${index}`}>Required corrective action</Label><Input id={`cmmc-field-${requirement.id}-objectiveCorrectiveAction-action-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Required corrective action`} disabled={inputsDisabled} value={action.action || ""} onChange={(event) => updateCorrectiveAction(requirement.id, index, "action", event.target.value)} /></div><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveCorrectiveAction-owner-${index}`}>Accountable owner</Label><Input id={`cmmc-field-${requirement.id}-objectiveCorrectiveAction-owner-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Accountable owner`} disabled={inputsDisabled} value={action.owner || ""} onChange={(event) => updateCorrectiveAction(requirement.id, index, "owner", event.target.value)} /></div><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveCorrectiveAction-targetDate-${index}`}>Target date</Label><Input id={`cmmc-field-${requirement.id}-objectiveCorrectiveAction-targetDate-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Target date`} disabled={inputsDisabled} type="date" value={action.targetDate || ""} onChange={(event) => updateCorrectiveAction(requirement.id, index, "targetDate", event.target.value)} /></div><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveCorrectiveAction-completionEvidenceLocator-${index}`}>Completion-evidence locator</Label><Input id={`cmmc-field-${requirement.id}-objectiveCorrectiveAction-completionEvidenceLocator-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Completion-evidence locator`} disabled={inputsDisabled} value={action.completionEvidenceLocator || ""} onChange={(event) => updateCorrectiveAction(requirement.id, index, "completionEvidenceLocator", event.target.value)} /></div><div><Label htmlFor={`cmmc-field-${requirement.id}-objectiveCorrectiveAction-reassessmentDate-${index}`}>Reassessment date</Label><Input id={`cmmc-field-${requirement.id}-objectiveCorrectiveAction-reassessmentDate-${index}`} aria-label={`${requirement.practice} objective ${index + 1}: Reassessment date`} disabled={inputsDisabled} type="date" value={action.reassessmentDate || ""} onChange={(event) => updateCorrectiveAction(requirement.id, index, "reassessmentDate", event.target.value)} /></div></div></>}
      </div>; })}
      <div className="space-y-3"><div className="flex items-center justify-between"><Label>Primary evidence set</Label><Button id={`cmmc-field-${requirement.id}-evidenceRecords`} type="button" size="sm" variant="outline" disabled={inputsDisabled} onClick={() => updateEvidenceRecords(requirement.id, [...(activeDraft.controls[requirement.id].evidenceRecords || []), { type: "", locator: "", owner: "", date: "", reviewFrequency: "", objectiveIds: [] }])}><Plus className="mr-1 h-4 w-4" />Add evidence record</Button></div>{(activeDraft.controls[requirement.id].evidenceRecords || []).map((record: any, recordIndex: number) => <div key={recordIndex} className="grid gap-2 rounded-md border p-3 md:grid-cols-3">{["type", "locator", "owner", "date", "reviewFrequency"].map((field) => { const fieldId = `cmmc-field-${requirement.id}-evidenceRecords-${recordIndex}-${field}`; const fieldLabel = field === "locator" ? "Locator only" : field.replace(/([A-Z])/g, " $1"); return <div key={field}><Label htmlFor={fieldId}>{fieldLabel}</Label><Input id={fieldId} aria-label={`${requirement.practice} evidence record ${recordIndex + 1}: ${fieldLabel}`} disabled={inputsDisabled} type={field === "date" ? "date" : "text"} value={record[field] || ""} onChange={(event) => { const records = [...activeDraft.controls[requirement.id].evidenceRecords]; records[recordIndex] = { ...record, [field]: event.target.value }; updateEvidenceRecords(requirement.id, records); }} /></div>; })}<div><Label htmlFor={`cmmc-field-${requirement.id}-evidenceRecords-${recordIndex}-objectiveIds`}>Objective numbers supported</Label><Input id={`cmmc-field-${requirement.id}-evidenceRecords-${recordIndex}-objectiveIds`} aria-label={`${requirement.practice} evidence record ${recordIndex + 1}: Objective numbers supported`} disabled={inputsDisabled} placeholder="1, 2" value={(record.objectiveIds || []).map((value: string) => Number(value) + 1).join(", ")} onChange={(event) => { const records = [...activeDraft.controls[requirement.id].evidenceRecords]; records[recordIndex] = { ...record, objectiveIds: event.target.value.split(",").map((value) => String(Number(value.trim()) - 1)).filter((value) => /^\d+$/.test(value)) }; updateEvidenceRecords(requirement.id, records); }} /></div><Button type="button" size="icon" variant="ghost" aria-label={`Remove evidence record ${recordIndex + 1} for ${requirement.practice}`} disabled={inputsDisabled} onClick={() => updateEvidenceRecords(requirement.id, activeDraft.controls[requirement.id].evidenceRecords.filter((_: any, i: number) => i !== recordIndex))}><Trash2 className="h-4 w-4" /></Button></div>)}</div>
    </CardContent>}</Card>; })}
    <Card id="cmmc-affirmation" tabIndex={-1}><CardHeader><CardTitle>Affirming Official acknowledgment</CardTitle><CardDescription>{data.selfCertification}</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{Object.entries({ authorizedOfficialName: "Affirming Official name used as signature", authorizedOfficialTitle: "Affirming Official title and authority basis", authorizedOfficialEmail: "Affirming Official business email" }).map(([key, label]) => <div key={key}><Label htmlFor={`cmmc-field-${key}`}>{label}</Label><Input id={`cmmc-field-${key}`} data-testid={`input-${key}`} disabled={inputsDisabled} type={key === "authorizedOfficialEmail" ? "email" : "text"} value={(signature as any)[key]} onChange={(event) => setSignature({ ...signature, [key]: event.target.value })} /></div>)}<div className="md:col-span-2 space-y-3">{CMMC_AFFIRMATION_KEYS.map((key, index) => <label key={key} htmlFor={`cmmc-field-affirmations.${key}`} className="flex items-start gap-3 text-sm"><Checkbox id={`cmmc-field-affirmations.${key}`} disabled={inputsDisabled} checked={activeDraft.affirmations?.[key] === true} onCheckedChange={(checked) => setDraft({ ...activeDraft, affirmations: { ...(activeDraft.affirmations || {}), [key]: checked === true } })} /><span>{["I reviewed the complete assessment scope.","I reviewed all 59 objective findings.","Each Met finding has a truthful implementation explanation and retrievable supporting evidence.","Not Applicable findings have scope-based rationales.","Known Not Met findings are not being represented as compliant.","I understand this packet is not an SPRS submission or third-party certification."][index]}</span></label>)}</div></CardContent></Card>
    <div className="flex flex-wrap gap-2 pb-8"><Button disabled={inputsDisabled} variant="outline" onClick={save}><Save className="h-4 w-4 mr-2" />Save draft</Button><Button disabled={inputsDisabled || !completion.complete} onClick={submit} data-testid="button-submit-cmmc"><Send className="h-4 w-4 mr-2" />{isSubmitting ? "Submitting…" : locked ? "Response submitted" : "Submit signed response"}</Button>{!completion.complete && !locked && <p className="w-full text-sm text-muted-foreground">Complete the required assessment profile, requirement support, objective-specific fields, evidence records, and all six confirmations before signing.</p>}{message && <p className="text-sm font-medium text-foreground self-center">{message}</p>}</div>
  </main></div>;
}

function Status({ id, value, onChange, label, disabled, objective = false }: { id: string; value: string; onChange: (value: string) => void; label: string; disabled?: boolean; objective?: boolean }) {
  const labelId = `${id}-label`;
  return <div id={id}><Label id={labelId}>{label}</Label><RadioGroup aria-labelledby={labelId} disabled={disabled} value={value} onValueChange={onChange} className="mt-2 flex flex-wrap gap-5"><div className="flex items-center gap-2"><RadioGroupItem aria-label={`${label}: Met`} disabled={disabled} value="met" id={`${id}-met`} /><Label htmlFor={`${id}-met`}>Met</Label></div><div className="flex items-center gap-2"><RadioGroupItem aria-label={`${label}: Not met`} disabled={disabled} value="not_met" id={`${id}-not`} /><Label htmlFor={`${id}-not`}>Not met</Label></div>{objective && <div className="flex items-center gap-2"><RadioGroupItem aria-label={`${label}: Not applicable`} disabled={disabled} value="not_applicable" id={`${id}-na`} /><Label htmlFor={`${id}-na`}>Not applicable</Label></div>}</RadioGroup></div>;
}