import { useMemo, useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Save, Send, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CMMC_L1_SCOPE_GUIDANCE, isCmmcAssessmentLocked } from "@shared/cmmc-level1-fields";
import { useToast } from "@/hooks/use-toast";

const CMMC_REQUEST_TIMEOUT_MS = 15_000;

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
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["cmmc", token],
    queryFn: async () => {
      const response = await fetchCmmc(`/api/public/cmmc/${token}`);
      if (!response.ok) throw new Error((await response.json()).error);
      return response.json();
    },
  });
  const activeDraft = draft ?? data?.assessment?.draft ?? null;
  const locked = submitted || isCmmcAssessmentLocked(data?.assessment?.status);
  const inputsDisabled = locked || isSubmitting;
  const completion = useMemo(() => {
    if (!activeDraft || !data?.requirements) return { complete: false, ready: false };
    const answers = data.requirements.every((requirement: any) => {
      const control = activeDraft.controls?.[requirement.id];
      return control?.status && requirement.objectivePrompts.every((_: string, index: number) => control.objectiveStatuses?.[String(index)]);
    });
    const ready = answers && data.requirements.every((requirement: any) => {
      const control = activeDraft.controls?.[requirement.id];
      return control.status === "met" && requirement.objectivePrompts.every((_: string, index: number) => {
        const finding = control.objectiveStatuses?.[String(index)];
        return finding === "met" || (finding === "not_applicable" && Boolean(control.objectiveRationales?.[String(index)]?.trim()));
      });
    });
    return { complete: answers, ready };
  }, [activeDraft, data]);

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
    <Card><CardHeader><CardTitle>CMMC Level 1 self-assessment preparation questionnaire</CardTitle><CardDescription>{data.disclaimer}</CardDescription></CardHeader><CardContent className="grid gap-4">
      <div><Label>FCI assessment scope</Label><p id="cmmc-scope-help" className="mt-1 text-sm text-muted-foreground">{CMMC_L1_SCOPE_GUIDANCE}</p><Textarea disabled={inputsDisabled} aria-describedby="cmmc-scope-help" value={activeDraft.systemDescription || ""} onChange={(event) => updateDraft("systemDescription", event.target.value)} /></div>
      <div className="grid gap-4 md:grid-cols-2"><div><Label>Industry CAGE code(s)</Label><p className="mt-1 text-xs text-muted-foreground">List every industry CAGE code associated with this assessment scope for SPRS preparation. Separate multiple codes with commas.</p><Input disabled={inputsDisabled} value={activeDraft.cageCodes || ""} onChange={(event) => updateDraft("cageCodes", event.target.value)} /></div><div><Label>CMMC Status Date (if already recorded)</Label><p className="mt-1 text-xs text-muted-foreground">Optional preparation field. Use YYYY-MM-DD only when an actual Status Date is known; retention is provisional until then.</p><Input disabled={inputsDisabled} type="date" value={activeDraft.cmmcStatusDate || ""} onChange={(event) => updateDraft("cmmcStatusDate", event.target.value)} /></div></div>
    </CardContent></Card>
    {data.requirements.map((requirement: any) => <Card key={requirement.id}><CardHeader><CardTitle className="text-base">{requirement.number}. {requirement.practice} — {requirement.title}</CardTitle><CardDescription>{requirement.baseline}</CardDescription></CardHeader><CardContent className="space-y-4">
      <Status disabled={inputsDisabled} value={activeDraft.controls[requirement.id].status} onChange={(value) => updateControl(requirement.id, "status", value)} label="Requirement response" />
      {requirement.objectivePrompts.map((prompt: string, index: number) => <div key={index} className="space-y-2"><Status disabled={inputsDisabled} objective value={activeDraft.controls[requirement.id].objectiveStatuses[String(index)] || ""} onChange={(value) => updateControl(requirement.id, "objectiveStatuses", value, index)} label={`${requirement.practice} [${requirement.objectiveLabels?.[index] || String.fromCharCode(97 + index)}] ${prompt}`} /><p className="text-xs text-muted-foreground">{requirement.objectiveGuidance?.[index]}</p>{activeDraft.controls[requirement.id].objectiveStatuses[String(index)] === "not_applicable" && <div><Label>Not applicable rationale</Label><p className="mt-1 text-xs text-muted-foreground">Explain why this determination is outside the stated FCI assessment scope. This rationale is required and will appear in the preparation packet.</p><Textarea disabled={inputsDisabled} value={activeDraft.controls[requirement.id].objectiveRationales?.[String(index)] || ""} onChange={(event) => updateControl(requirement.id, "objectiveRationales", event.target.value, index)} /></div>}</div>)}
      <div className="grid gap-3 md:grid-cols-3"><div><Label>Accountable owner</Label><Input disabled={inputsDisabled} value={activeDraft.controls[requirement.id].owner || ""} onChange={(event) => updateControl(requirement.id, "owner", event.target.value)} /></div><div><Label>Evidence locator (no uploads)</Label><p className="mt-1 text-xs text-muted-foreground">Name the policy, ticket, setting, inventory, or other location. Do not paste evidence contents.</p><Input disabled={inputsDisabled} value={activeDraft.controls[requirement.id].evidence || ""} onChange={(event) => updateControl(requirement.id, "evidence", event.target.value)} /></div><div><Label>Evidence date</Label><Input disabled={inputsDisabled} type="date" value={activeDraft.controls[requirement.id].evidenceDate || ""} onChange={(event) => updateControl(requirement.id, "evidenceDate", event.target.value)} /></div></div>
    </CardContent></Card>)}
    <Card><CardHeader><CardTitle>Affirming Official acknowledgment</CardTitle><CardDescription>{data.selfCertification}</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{Object.entries({ authorizedOfficialName: "Affirming Official name used as signature", authorizedOfficialTitle: "Affirming Official title", authorizedOfficialEmail: "Affirming Official business email" }).map(([key, label]) => <div key={key}><Label>{label}</Label><Input disabled={inputsDisabled} type={key === "authorizedOfficialEmail" ? "email" : "text"} value={(signature as any)[key]} onChange={(event) => setSignature({ ...signature, [key]: event.target.value })} /></div>)}</CardContent></Card>
    <div className="flex flex-wrap gap-2 pb-8"><Button disabled={inputsDisabled} variant="outline" onClick={save}><Save className="h-4 w-4 mr-2" />Save draft</Button><Button disabled={inputsDisabled || !completion.complete} onClick={submit} data-testid="button-submit-cmmc"><Send className="h-4 w-4 mr-2" />{isSubmitting ? "Submitting…" : locked ? "Response submitted" : "Submit signed response"}</Button>{message && <p className="text-sm font-medium text-foreground self-center">{message}</p>}</div>
  </main></div>;
}

function Status({ value, onChange, label, disabled, objective = false }: { value: string; onChange: (value: string) => void; label: string; disabled?: boolean; objective?: boolean }) {
  return <div><Label>{label}</Label><RadioGroup disabled={disabled} value={value} onValueChange={onChange} className="mt-2 flex flex-wrap gap-5"><div className="flex items-center gap-2"><RadioGroupItem disabled={disabled} value="met" id={`${label}-met`} /><Label htmlFor={`${label}-met`}>Met</Label></div><div className="flex items-center gap-2"><RadioGroupItem disabled={disabled} value="not_met" id={`${label}-not`} /><Label htmlFor={`${label}-not`}>Not met</Label></div>{objective && <div className="flex items-center gap-2"><RadioGroupItem disabled={disabled} value="not_applicable" id={`${label}-na`} /><Label htmlFor={`${label}-na`}>Not applicable</Label></div>}</RadioGroup></div>;
}