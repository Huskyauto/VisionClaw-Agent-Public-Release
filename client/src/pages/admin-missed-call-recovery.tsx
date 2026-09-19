import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, authFetch } from "@/lib/queryClient";
import { calculateHvacOpportunity } from "@shared/lib/hvac-missed-call-recovery";

const fields = [
  ["contactRole", "Contact role", "Owner or office manager"],
  ["employeeBand", "Employee band", "3–30 employees"],
  ["currentPhoneHandling", "Current phone handling", "Voicemail, receptionist, overflow"],
  ["afterHoursFlow", "After-hours flow", "What happens after 5pm?"],
  ["webLeadPath", "Web-lead path", "Form → inbox → callback"],
  ["averageJobValueSource", "Average job value/source", "Stated by owner or last 30 jobs"],
  ["currentTools", "Current tools", "Phone, CRM, calendar, web form"],
  ["desiredSla", "Desired response SLA", "Under 5 minutes"],
  ["notes", "Discovery notes", "Customer-stated facts only"],
] as const;
const defaults = { monthlyInboundCalls: 100, missedCallRatePercent: 27, bookingRatePercent: 20, averageJobValueUsd: 1000 };
const questions = ["How many calls go unanswered in a normal month?", "What happens after a web lead arrives?", "Who owns follow-up and when?", "What source data can you share before any implementation?"];
const inScope = ["Missed-call text-back setup", "Web-lead intake", "Appointment follow-up", "One reporting view", "Fixed handoff and fixed support window"];
const outScope = ["Outbound sending or calling", "Live phone, CRM, calendar, or web-form integration", "Payments, checkout, or guarantees", "Automatic delivery, mission creation, or autonomous actions"];
type Workspace = any;

export default function AdminMissedCallRecoveryPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<Workspace[]>([]); const [selected, setSelected] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const newKey = () => `hvac-${crypto.randomUUID()}`;
  const [form, setForm] = useState<any>({ idempotencyKey: newKey(), prospectName: "", companyName: "", trade: "hvac", intake: {}, ...defaults, status: "discovery", readiness: {} });
  const intake = form.intake || {};
  const assumptions = { monthlyInboundCalls: form.monthlyInboundCalls, missedCallRatePercent: form.missedCallRatePercent, bookingRatePercent: form.bookingRatePercent, averageJobValueUsd: form.averageJobValueUsd };
  const estimate = useMemo(() => calculateHvacOpportunity(assumptions), [form.monthlyInboundCalls, form.missedCallRatePercent, form.bookingRatePercent, form.averageJobValueUsd]);
  const load = async () => { setLoading(true); try { const r = await authFetch("/api/admin/missed-call-recovery/workspaces"); if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`); setItems(await r.json()); setError(null); } catch (e) { setError(String(e)); throw e; } finally { setLoading(false); } };
  useEffect(() => { void load().catch(() => undefined); }, []);
  const update = (patch: any) => setForm((x: any) => ({ ...x, ...patch }));
  const save = async () => {
    const payload = selected
      ? { prospectName: form.prospectName, companyName: form.companyName, trade: form.trade, intake, assumptions, status: form.status, readiness: form.readiness }
      : { ...form, intake, assumptions, idempotencyKey: form.idempotencyKey };
    try {
      const r = selected ? await apiRequest("PATCH", `/api/admin/missed-call-recovery/workspaces/${selected.id}`, payload) : await apiRequest("POST", "/api/admin/missed-call-recovery/workspaces", payload);
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      const row = await r.json(); setSelected(row); setItems(old => [row, ...old.filter(x => x.id !== row.id)]);
      toast({ title: selected ? "Workspace updated" : "Workspace saved" });
      try { await load(); } catch (refreshError) { toast({ title: "Saved, refresh failed", description: String(refreshError), variant: "destructive" }); }
    } catch (e) { toast({ title: "Save failed", description: String(e), variant: "destructive" }); }
  };
  const proposal = `We will set up a fixed-scope seven-day missed-call recovery workflow for ${form.companyName || "your company"}: missed-call text-back, web-lead intake, appointment follow-up, one reporting view, a fixed handoff, and a fixed support window. Setup hypothesis: $1,000. Results are not guaranteed and require your source data.`;
  const brief = `${questions.join(" ")} Scope: ${inScope.join(", ")}. Exclusions: ${outScope.join(", ")}.`;
  const objections = "“We already have voicemail.” This is a bounded response and follow-up workflow, not a phone replacement. “Can you guarantee bookings?” No. Estimates are labeled and outcomes remain hypotheses until evidence exists.";
  const copy = async (text: string, label: string) => { try { if (!navigator.clipboard?.writeText) throw new Error("Clipboard is not supported in this browser."); await navigator.clipboard.writeText(text); toast({ title: `${label} copied` }); } catch (e) { toast({ title: "Copy failed", description: String(e), variant: "destructive" }); } };
  return <div className="h-full overflow-y-auto p-4 md:p-6 space-y-6">
    <header><Badge>Wedge A verdict · 24/25</Badge><h1 className="text-3xl font-semibold mt-2">HVAC Missed-Call Recovery</h1><p className="text-muted-foreground">Recover lost leads in under 5 minutes without hiring more office staff. Owner/admin workspace; no sending, calling, payment, or integration actions.</p></header>
    <Card><CardHeader><CardTitle>Saved prospect workspaces</CardTitle></CardHeader><CardContent><Button className="mb-3" onClick={() => { setSelected(null); setForm({ idempotencyKey: newKey(), prospectName: "", companyName: "", trade: "hvac", intake: {}, ...defaults, status: "discovery", readiness: {} }); }}>New workspace</Button>{loading ? "Loading workspaces…" : error ? <p className="text-destructive">{error}</p> : items.length ? items.map(w => <Button variant="outline" className="mr-2 mb-2" key={w.id} onClick={() => { setSelected(w); setForm({ ...w, ...w.assumptions }); }}>{w.companyName} · {w.status}</Button>) : <p>No saved workspaces yet. Start a discovery draft.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>1. Discovery intake · customer-stated facts</CardTitle></CardHeader><CardContent className="grid md:grid-cols-2 gap-4">{<><Input aria-label="Prospect name" placeholder="Prospect name (e.g. Maria Lopez)" value={form.prospectName} onChange={e => update({ prospectName: e.target.value })}/><Input aria-label="Company name" placeholder="Company name (e.g. Lopez Air)" value={form.companyName} onChange={e => update({ companyName: e.target.value })}/><Select value={form.trade} onValueChange={trade => update({ trade })}><SelectTrigger><SelectValue placeholder="Trade" /></SelectTrigger><SelectContent><SelectItem value="hvac">HVAC</SelectItem><SelectItem value="plumbing">Plumbing</SelectItem></SelectContent></Select>{fields.map(([key, label, example]) => <label className="text-sm space-y-1" key={key}>{label}<Input placeholder={`Example: ${example}`} value={intake[key] || ""} onChange={e => update({ intake: { ...intake, [key]: e.target.value } })}/></label>)}</>}</CardContent></Card>
    <Card><CardHeader><CardTitle>2. Calculator · editable assumptions, not verified results</CardTitle></CardHeader><CardContent className="grid md:grid-cols-4 gap-4">{([["monthlyInboundCalls","Monthly inbound calls"],["missedCallRatePercent","Observed missed-call rate (%)"],["bookingRatePercent","Assumed booking rate (%)"],["averageJobValueUsd","Average job value ($)"]] as const).map(([k, label]) => <label className="text-sm space-y-1" key={k}>{label}<Input type="number" value={form[k]} onChange={e => update({ [k]: Number(e.target.value) })}/></label>)}<div className="md:col-span-4 rounded-lg bg-muted p-4 text-sm"><b>Transparent estimate:</b> {estimate.missedCallsPerMonth.toFixed(2)} missed calls/month × {((form.bookingRatePercent || 0) / 100).toFixed(2)} booking assumption = {estimate.recoverableBookingsPerMonth.toFixed(2)} recoverable bookings; <b>${estimate.estimatedOpportunityUsdPerMonth.toLocaleString()} estimated opportunity/month</b>. Not verified revenue, savings, or a guarantee.</div></CardContent></Card>
    <Card><CardHeader><CardTitle>3. Lifecycle, readiness, and save</CardTitle></CardHeader><CardContent className="space-y-4"><Select value={form.status} onValueChange={status => update({ status })}><SelectTrigger className="w-64"><SelectValue /></SelectTrigger><SelectContent>{["discovery","proposal","ready","won","lost"].map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select><div className="grid md:grid-cols-2 gap-2 text-sm">{[["sourceDataConfirmed","Buyer confirms source data"],["leadPathDocumented","Current web-lead path documented"],["scopeReviewed","Fixed scope reviewed"],["ownerApproval","Owner approves future implementation"]].map(([key, label]) => <label key={key}><input type="checkbox" className="mr-2" checked={!!form.readiness?.[key]} onChange={e => update({ readiness: { ...form.readiness, [key]: e.target.checked } })}/>{label}</label>)}</div><Button onClick={save} disabled={!form.companyName || !form.prospectName}>Save workspace</Button></CardContent></Card>
    <div className="grid lg:grid-cols-2 gap-6"><Card><CardHeader><CardTitle>Buyer-facing proposal preview</CardTitle></CardHeader><CardContent><p className="text-sm">{proposal}</p><Button className="mt-3" variant="outline" onClick={() => copy(proposal, "Proposal")}>Copy proposal</Button></CardContent></Card><Card><CardHeader><CardTitle>Discovery brief</CardTitle></CardHeader><CardContent><p className="text-sm">{brief}</p><Button className="mt-3" variant="outline" onClick={() => copy(brief, "Discovery brief")}>Copy discovery brief</Button></CardContent></Card></div>
    <div className="grid lg:grid-cols-3 gap-6"><Card><CardHeader><CardTitle>Fixed scope · 7 days</CardTitle></CardHeader><CardContent className="text-sm"><ol className="list-decimal pl-5">{["Day 1: confirm facts and source data","Day 2: map missed-call and web-lead paths","Day 3: draft response and follow-up rules","Day 4: define reporting view","Day 5: review fixed handoff","Day 6: document support window","Day 7: buyer walkthrough and acceptance"].map(x => <li key={x}>{x}</li>)}</ol><Button className="mt-3" variant="outline" onClick={() => copy("7-day plan: confirm facts; map paths; draft rules; define reporting; review handoff; document support; walkthrough.", "7-day plan")}>Copy plan</Button></CardContent></Card><Card><CardHeader><CardTitle>In scope</CardTitle></CardHeader><CardContent className="text-sm space-y-1">{inScope.map(x => <p key={x}>✓ {x}</p>)}<Button className="mt-3" variant="outline" onClick={() => copy(inScope.join("\\n"), "In-scope list")}>Copy in-scope</Button></CardContent></Card><Card><CardHeader><CardTitle>Out of scope</CardTitle></CardHeader><CardContent className="text-sm space-y-1">{outScope.map(x => <p key={x}>× {x}</p>)}<Button className="mt-3" variant="outline" onClick={() => copy(outScope.join("\\n"), "Out-of-scope list")}>Copy exclusions</Button></CardContent></Card></div>
    <Card><CardHeader><CardTitle>Discovery questions & objections</CardTitle></CardHeader><CardContent className="grid md:grid-cols-2 gap-4 text-sm"><div>{questions.map(q => <p key={q}>• {q}</p>)}</div><div><p>{objections}</p><Button className="mt-3" variant="outline" onClick={() => copy(`${questions.join("\n")}\n\n${objections}`, "Questions & objections")}>Copy questions & objections</Button></div></CardContent></Card>
  </div>;
}